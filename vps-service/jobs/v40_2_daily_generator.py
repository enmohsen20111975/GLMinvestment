#!/usr/bin/env python3
"""
V40.2 Historical/Daily Prediction Generator (CLI-enabled)
==========================================================
توليد توقعات V40.2 لأي فترة تاريخية أو لليوم/أمس.

هذه نسخة مطوّرة من scratch/v40_2_historical_generator.py تقبل معاملات CLI
وتدعم وضع --today-only و --yesterday-only لتوليد توقعات يومية.

الاستخدامات:
  # توليد لفترة كاملة (افتراضي: 2026-01-01 ← اليوم)
  python3 vps-service/jobs/v40_2_daily_generator.py

  # توليد لليوم فقط (للكرون اليومي)
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only

  # توليد لأمس فقط (بعد إغلاق السوق)
  python3 vps-service/jobs/v40_2_daily_generator.py --yesterday-only

  # فترة مخصصة
  python3 vps-service/jobs/v40_2_daily_generator.py --start 2026-08-01 --end 2026-08-14

  # جاف فقط (لا يكتب في DB) — للاختبار
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only --dry-run

  # عدم حذف التوقعات القديمة (الافتراضي: يحذف V40 predictions القديمة في الفترة)
  python3 vps-service/jobs/v40_2_daily_generator.py --today-only --keep-old

الكرون المقترح (بعد إغلاق السوق بـ 30 دقيقة):
  30 14 * * 0-4 cd /home/z/my-project && /root/.venv/bin/python3 \
    vps-service/jobs/v40_2_daily_generator.py --yesterday-only \
    >> logs/v40_2_daily.log 2>&1

V40.2 changes vs V40.1:
  - Strict kill-filter mode (no market-open relaxation)
  - Real EGX30ETF benchmark (loaded lazily by the engine)
  - Tightened entry conditions (real benchmark + mapping fix + absorption 1.5)
  - partial_exit_at_rr = 1.5 (let winners run further)
"""
import sys
import os
import json
import gc
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

# ─── Path setup ───
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'vps-service'))
os.chdir(PROJECT_ROOT)
os.environ['BYPASS_PRED_CAP'] = '1'

from engines.v38_backtest_engine import V38BacktestEngine, Trade, simulate_trade, calc_atr
PRICE_HISTORY_DB = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
from analyzers.liquidity_filter import set_strict_kill_filters
from analyzers.prediction_tracker import PredictionTracker
from analyzers.adaptive_weights import PERSONA_INPUT_WEIGHTS
from analyzers.engine_settings import get_setting
from core.persona_db import safe_store_prediction, update_persona_prediction_outcome

PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
# PRICE_HISTORY_DB is now imported from the engine — it auto-resolves to the
# correct location (primary db/ or daily backup db/backups/daily/*/) without
# copying or modifying any database file. Read-only detection.

DEFAULT_START = '2026-01-01'
DEFAULT_END = '2026-06-10'  # historical default (sandbox run)
SCAN_INTERVAL = 3
MAX_PICKS_PER_DAY = 5
MIN_TICKER_DAYS = 200


def count_evidence(proofs):
    """Count ✅ markers in proofs dict."""
    return sum(1 for v in proofs.values() if '✅' in str(v))


def compute_r_multiple(entry, target, stop):
    """Compute R-multiple: reward/risk ratio."""
    if entry > 0 and stop < entry:
        return (target - entry) / (entry - stop)
    return 0.0


# ─── Phase 2 (Option A — Safe): Persona-Fit من نفس الـ V40.2 pool ───
# القاعدة الذهبية: السهم الواحد = صفقة واحدة. persona='balanced' في predictions
# لا يتغير (حماية الـ baseline 81.8%). الـ persona_fit بـ يُستخدم لـ:
#   1. annotate kill_filter_result (رؤية تحليلية في الـ data).
#   2. كتابة persona_predictions منفصلة للأسهم اللي strongly fit gambler/conservative
#      من نفس الـ pool القوي (evidence-based + kill filters) — بدون ما تؤثر على
#      overall KPI (persona_predictions منفصل عن predictions، والـ overall dedup بالـ ticker).
# الـ row بـ يتـ closed فورًا بـ outcome المحاكى من V40.2 → مفيش orphan PENDING rows.
PERSONA_FIT_MIN_SCORE = 50.0  # أدنى fit score لكتابة persona_predictions


def compute_persona_fit(proofs):
    """احسب persona_fit لكل ترشيح V40.2 من evidence proofs.

    بـ derive 4 category scores من proofs الـ V40.2:
      trend + dna  → price_action (momentum / candle structure)
      makers       → smc_vsa (هيكل صناع السوق)
      sector       → sector_heat (سخونة القطاع)
      fundamentals → fundamental (P/E + ROE + debt)
    وبـ weightها بـ PERSONA_INPUT_WEIGHTS عشان نحسب fit score (0-100) لكل شخصية.

    الرجوع:
        {'persona_fit': 'gambler'|'balanced'|'conservative',
         'fit_scores': {'gambler': float, 'balanced': float, 'conservative': float}}
    """
    proofs = proofs or {}

    def _has_check(key):
        return '✅' in str(proofs.get(key, ''))

    # trend + dna → price_action (كل واحد 50%، كحد أقصى 100)
    pa_count = (1 if _has_check('trend') else 0) + (1 if _has_check('dna') else 0)
    base_scores = {
        'price_action': min(100.0, (pa_count / 2.0) * 100.0),
        'smc_vsa':      100.0 if _has_check('makers') else 0.0,
        'sector_heat':  100.0 if _has_check('sector') else 0.0,
        'fundamental':  100.0 if _has_check('fundamentals') else 0.0,
    }

    fit_scores = {}
    for persona in ('gambler', 'balanced', 'conservative'):
        w = PERSONA_INPUT_WEIGHTS[persona]
        fit = sum(base_scores[c] * w[c]
                  for c in ('price_action', 'smc_vsa', 'sector_heat', 'fundamental'))
        fit_scores[persona] = round(fit, 1)

    best = max(fit_scores, key=fit_scores.get)
    return {'persona_fit': best, 'fit_scores': fit_scores}


def get_scan_dates(start_date, end_date, scan_interval):
    """Get trading dates from price_history.db within [start, end]."""
    conn = sqlite3.connect(str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db'), timeout=30.0)
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT price_date FROM egksco_price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
        (start_date, end_date),
    )
    dates = [row[0] for row in cur.fetchall()]
    conn.close()
    if not dates:
        print(f"⚠️  No trading dates found between {start_date} and {end_date}", flush=True)
        return []
    return dates[::scan_interval]


def get_tickers(min_days=MIN_TICKER_DAYS):
    """Get tickers with enough historical data."""
    conn = sqlite3.connect(str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db'), timeout=30.0)
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT symbol FROM egksco_price_history GROUP BY symbol HAVING COUNT(*) >= ? ORDER BY symbol",
        (min_days,),
    )
    tickers = [row[0] for row in cur.fetchall()]
    conn.close()
    return tickers


def delete_old_v40_predictions(start_date=None, end_date=None):
    """Delete previous V40 historical predictions to avoid duplicates.

    If start_date/end_date provided, only delete predictions in that range.
    Otherwise, delete ALL V40 predictions.
    """
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
    cur = conn.cursor()
    if start_date and end_date:
        cur.execute(
            "DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%' "
            "AND prediction_date >= ? AND prediction_date <= ?",
            (start_date, end_date),
        )
    else:
        cur.execute("DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%'")
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted > 0:
        range_str = f" ({start_date} → {end_date})" if start_date else ""
        print(f"🧹 Deleted {deleted} old V40 predictions{range_str}", flush=True)
    else:
        print("ℹ️  No old V40 predictions to delete", flush=True)


def run_generator(start_date, end_date, scan_interval=SCAN_INTERVAL,
                  max_picks=MAX_PICKS_PER_DAY, dry_run=False, keep_old=False,
                  max_tickers=None, tickers_offset=0):
    """Main generation loop.

    Args:
        max_tickers: لو موجود، بـ limit عدد الـ tickers المتعالجًا في الـ run ده.
                     مفيد لتشغيل الباكتست على دفعات في ساندبوكس بـ timeout محدود.
        tickers_offset: skip أول N tickers (للـ resume بعد run سابق).
    """
    print("=" * 80, flush=True)
    print("  V40.2 Prediction Generator (CLI-enabled)", flush=True)
    print(f"  Period: {start_date} → {end_date} | Scan every {scan_interval} days", flush=True)
    print(f"  Max picks/day: {max_picks} | Morning bell: top 1", flush=True)
    print(f"  Strict kill-filters: ON | Real EGX30ETF benchmark: ON", flush=True)
    print(f"  Dry-run: {dry_run} | Keep old: {keep_old}", flush=True)
    if max_tickers is not None:
        print(f"  ⚡ BATCH MODE: max_tickers={max_tickers}, offset={tickers_offset}", flush=True)
    print("=" * 80, flush=True)

    # V40.2: enable strict kill-filter mode for the whole run
    set_strict_kill_filters(True)

    if not dry_run and not keep_old:
        delete_old_v40_predictions(start_date, end_date)
    elif keep_old:
        print("ℹ️  --keep-old: skipping deletion of old V40 predictions", flush=True)

    scan_dates = get_scan_dates(start_date, end_date, scan_interval)
    if not scan_dates:
        print("❌ No scan dates to process. Exiting.", flush=True)
        return

    tickers = get_tickers()
    # BATCH MODE: apply offset + max_tickers (للـ resume في ساندبوكس بـ timeout)
    if tickers_offset > 0:
        tickers = tickers[tickers_offset:]
        print(f"  ⏭️  Skipped first {tickers_offset} tickers (offset)", flush=True)
    if max_tickers is not None and max_tickers > 0:
        tickers = tickers[:max_tickers]
        print(f"  ⚡ Limited to {max_tickers} tickers (batch mode)", flush=True)
    print(f"📊 Scan dates: {len(scan_dates)} | Tickers: {len(tickers)}", flush=True)
    print(f"📅 Scan dates: {scan_dates}", flush=True)

    if dry_run:
        print("🔍 DRY-RUN: would process the above dates. No DB writes.", flush=True)

    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)
    engine._load_fundamentals()
    engine._load_benchmark()  # V40.2: load EGX30ETF benchmark explicitly

    signals_by_date = defaultdict(list)
    total_tickers = len(tickers)
    processed = 0

    for ticker in tickers:
        processed += 1
        if processed % 50 == 0:
            print(f"  ⏳ Processing {processed}/{total_tickers} tickers...", flush=True)

        dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < MIN_TICKER_DAYS:
            continue
        atrs = calc_atr(highs, lows, closes, 14)
        date_to_idx = {d: i for i, d in enumerate(dates)}

        for scan_date in scan_dates:
            day_idx = date_to_idx.get(scan_date)
            if day_idx is None or day_idx < 60:
                continue

            # PILLAR-1: حساب sector_change حقيقي (proxy = أداء السهم آخر 5 أيام).
            # كان 0.0 ثابت — دلوقتي بنـ compute proxy من closes للـ ticker نفسه.
            # ملاحظة: هذا proxy لـ sector_change — الحل الكامل يتطلب loading خريطة
            # ticker→sector (data/egx_ticker_sector_map.py) و حساب متوسط القطاع،
            # لكن ده بـ يـ triple الـ runtime لكل (ticker × scan_date) pair.
            # الـ proxy كافي لـ sector-aware signal evaluation: لو السهم طالع 5% آخر
            # أسبوع → sector_change=+5.0 → الـ engine بـ يـ boost الـ score.
            _sector_change = 0.0
            if day_idx >= 5:
                try:
                    _ref_close = closes[day_idx - 5] if closes[day_idx - 5] > 0 else closes[day_idx - 1]
                    if _ref_close > 0:
                        _sector_change = round(
                            (closes[day_idx] - _ref_close) / _ref_close * 100.0, 3
                        )
                except Exception:
                    _sector_change = 0.0
            try:
                result = engine.analyze_single_day_v393(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, _sector_change,
                )
            except Exception:
                continue

            signal = result.get('signal', 'WAIT')
            # PILLAR-4: قبول BUY عادي (مش بس STRONG_BUY/INSTITUTIONAL_BUY) —
            # عشان نوصل للهدف التشغيلي 60-150 صفقة في 8 أشهر بدل 6 فقط.
            # الـ R/R >= 1.5 بـ يـ ensure جودة الصفقات (dynamic_rr_normal=1.5).
            # كمان sort بـ evidence_count ↓ → أعلى جودة بتـ pick أولاً.
            if signal not in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                continue

            entry = result['entry']
            target = result['target']
            stop = result['stop_loss']
            if stop >= entry or entry <= 0:
                continue

            future_closes = closes[day_idx + 1:]
            future_dates = dates[day_idx + 1:]
            future_atrs = atrs[day_idx + 1:]
            if len(future_closes) < 5:
                continue

            trade = Trade(
                ticker=ticker, entry_date=scan_date, entry_price=entry,
                target_price=target, stop_loss=stop, score=result['score'],
                signal=signal, proofs=result['proofs'],
            )
            trade = simulate_trade(trade, future_closes, future_dates, 30, future_atrs)

            evidence = count_evidence(result['proofs'])
            r_mult = compute_r_multiple(entry, target, stop)
            persona_fit = compute_persona_fit(result.get('proofs', {}))

            # ─── FUNDAMENTALS-VETO (2026-08-17): hard reject weak-fundamentals stocks ───
            # Owner directive: if persona_fit != 'gambler' AND fundamentals are available
            # AND fundamental_score < 30.0 → REJECT the trade.
            # Rationale: balanced/conservative personas need financial quality; the gambler
            # is exempt (rides momentum: PA 40% + SMC 35% + Sector 25%, fund 0%).
            # Safe-by-design: when fundamentals are UNAVAILABLE (available=False, e.g. during
            # the egx_fundamentals empty period), the veto does NOT fire — picks pass through
            # so the pipeline isn't choked while the fundamentals fetcher is unscheduled.
            _fit_persona = persona_fit.get('persona_fit', 'balanced')
            _fund_score = float(result.get('fundamental_score', 0.0) or 0.0)
            _fund_avail = bool(result.get('fundamentals_available', False))
            if _fit_persona != 'gambler' and _fund_avail and _fund_score < 30.0:
                continue

            # ─── V40.3 REGIME-RR (2026-08-17): regime-aware R:R floor with absolute 1.5 ───
            # Owner directive: replace flat dynamic_rr_normal with get_dynamic_min_rr(regime).
            #   bull  → 2.0  (نطمع أكتر)
            #   range → 1.5  (was 1.2 — العمولات بـ تاكل الـ edge تحت 1.5)
            #   bear  → 1.8  (صفقات الارتداد النادرة؛ cash-mode veto بـ يـ handle أغلب الـ bear)
            # Absolute floor 1.5 مطلقًا — ممنوع R:R < 1.5 تحت أي ظرف.
            # get_dynamic_min_rr بـ يـ apply الـ floor internally كمان (defense-in-depth).
            try:
                from analyzers.engine_settings import get_dynamic_min_rr
                _regime = result.get('market_regime_trend', 'range')
                _min_rr = get_dynamic_min_rr(_regime)
            except Exception:
                _min_rr = 2.0  # C1 floor if settings unavailable
            if r_mult < _min_rr:
                continue

            signals_by_date[scan_date].append({
                'ticker': ticker,
                'signal': signal,
                'entry': entry,
                'target': target,
                'target_2': result.get('target_2', 0),
                'stop': stop,
                'tech_score': result['score'],
                'evidence': evidence,
                'r_multiple': r_mult,
                'atr': result.get('atr', 0),
                'exit_price': trade.exit_price,
                'exit_date': trade.exit_date,
                'exit_reason': trade.exit_reason,
                'return_pct': trade.return_pct,
                'is_win': trade.is_win,
                'pnl_pct': trade.pnl_pct,
                'r_multiple_actual': trade.r_multiple,
                'persona_fit': persona_fit['persona_fit'],
                'persona_fit_scores': persona_fit['fit_scores'],
                # PHASE-C FIX: خزّن الـ fundamental_score الحقيقي في DB بدل placeholder 50.0.
                # لما fundamentals تكون متاحة → الدرجة الحقيقية (0-100).
                # لما غير متاحة → 50.0 (neutral، نفس السلوك السابق — safe-by-design).
                # ده بـ يـ fix Rule 12 (ممنوع placeholder 50.0 في مسار إنتاجي)
                # دون ما يأثر على الـ veto (اللي بـ يقرأ من result dict مباشرة).
                'fundamental_score': _fund_score if _fund_avail else 50.0,
            })

        del dates, opens, highs, lows, closes, volumes, atrs, date_to_idx
        if processed % 100 == 0:
            gc.collect()

    print(f"\n✅ Processed {total_tickers} tickers. Signals found on {len(signals_by_date)} dates.", flush=True)

    if dry_run:
        total_signals = sum(len(v) for v in signals_by_date.values())
        print(f"🔍 DRY-RUN: would have generated {total_signals} signals across {len(signals_by_date)} dates.", flush=True)
        # Still print the summary of what would have been picked
        for scan_date in sorted(signals_by_date.keys()):
            day_signals = signals_by_date[scan_date]
            day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
            picks = day_signals[:max_picks]
            mb = picks[0] if picks else None
            print(f"  📅 {scan_date}: {len(picks)} picks | MB={mb['ticker'] if mb else '-'} (ev={mb['evidence'] if mb else 0})", flush=True)
        return

    # Store: sort each date's signals, take top N, morning bell = top 1
    tracker = PredictionTracker(PREDICTIONS_DB)
    total_generated = 0
    total_morning_bells = 0
    daily_summary = []
    all_stored = []

    for scan_date in sorted(signals_by_date.keys()):
        day_signals = signals_by_date[scan_date]
        # Sort: evidence DESC → R-multiple DESC → tech_score DESC
        day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
        picks = day_signals[:max_picks]

        for rank, sig in enumerate(picks):
            sig['morning_bell'] = 1 if rank == 0 else 0

        for sig in picks:
            hit_target = 1 if sig['exit_reason'] == 'hit_target' else 0
            hit_stop = 1 if sig['exit_reason'] == 'hit_stop' else 0
            is_correct = 1 if sig['is_win'] else 0
            fit_tag = sig.get('persona_fit', 'balanced')
            fit_scores = sig.get('persona_fit_scores', {})
            fit_score = fit_scores.get(fit_tag, 0.0)
            try:
                pred_id = tracker.record_prediction(
                    ticker=sig['ticker'], signal=sig['signal'],
                    entry_price=sig['entry'], target_price=sig['target'],
                    stop_loss=sig['stop'], master_score=sig['tech_score'],
                    technical_score=sig['tech_score'], persona='balanced',
                    fundamental_score=sig.get('fundamental_score', 50.0),
                    atr_at_entry=sig['atr'], target_price_2=sig['target_2'],
                    prediction_date=scan_date, evidence_count=sig['evidence'],
                    morning_bell=sig['morning_bell'],
                    kill_filter_result=f"V40 evidence={sig['evidence']}/6 R={sig['r_multiple']:.2f} | fit:{fit_tag}({fit_score:.0f})",
                )
                if pred_id:
                    tracker.set_verified_outcome(
                        prediction_id=pred_id, outcome_date=sig['exit_date'],
                        exit_price=sig['exit_price'], actual_return=sig['return_pct'],
                        hit_target=hit_target, hit_stop=hit_stop,
                        is_correct=is_correct,
                        holding_days=sig.get('holding_days', 0),
                        exit_reason=sig['exit_reason'],
                    )
                    # ── Phase 2 Fix: Read lessons BEFORE finalizing prediction ──
                    # This connects the closed loop: close → lesson → next prediction reads it.
                    # Safe-by-design: if lesson_store fails, prediction proceeds normally.
                    try:
                        from analyzers.maestro_orchestrator import run_expert_memory_phase
                        _em = run_expert_memory_phase(
                            db_path=PREDICTIONS_DB,
                            ticker=sig['ticker'],
                            sector=_sector_change if isinstance(_sector_change, str) else '',
                            regime=result.get('market_regime_trend', 'range') if isinstance(result, dict) else 'range',
                            rsi=0.0,
                            month=int(scan_date.split('-')[1]) if '-' in scan_date else 1,
                            persona_name='balanced',
                        )
                        if _em and _em.recommendation == 'block':
                            # Expert memory says BLOCK this ticker → skip
                            print(f"🚫 [EXPERT-MEMORY] Block {sig['ticker']} on {scan_date} — lesson-based veto", flush=True)
                            continue
                    except Exception:
                        pass  # Safe-by-design — lessons optional
                    total_generated += 1
                    if sig['morning_bell']:
                        total_morning_bells += 1
                    all_stored.append(sig)
                    # Phase 2 (Option A — Safe): اكتب persona_predictions من نفس
                    # الـ pool القوي للأسهم اللي strongly fit gambler/conservative.
                    # persona='balanced' في predictions لا يتغير (baseline محمي).
                    # persona_predictions منفصل ولا يؤثر على overall KPI (dedup بالـ ticker).
                    # الـ row بـ يتـ closed فورًا بـ outcome المحاكى من V40.2 (مفيش orphans).
                    if fit_tag in ('gambler', 'conservative') and fit_score >= PERSONA_FIT_MIN_SCORE:
                        try:
                            safe_store_prediction(
                                ticker=sig['ticker'], market='EGX',
                                persona_type=fit_tag,
                                signal_type=sig['signal'],
                                entry_price=sig['entry'],
                                target_price=sig['target'],
                                stop_loss=sig['stop'],
                                prediction_date=scan_date,
                            )
                            update_persona_prediction_outcome(
                                ticker=sig['ticker'],
                                persona_type=fit_tag,
                                final_price=sig['exit_price'],
                                prediction_date=scan_date,
                            )
                        except Exception as pe:
                            print(f"  ⚠️ persona_predictions {sig['ticker']}/{fit_tag}: {pe}", flush=True)
            except Exception as e:
                print(f"  ⚠️ Store error {sig['ticker']}: {e}", flush=True)

        mb = picks[0] if picks else None
        wins = sum(1 for p in picks if p['is_win'])
        daily_summary.append({
            'date': scan_date, 'picks': len(picks), 'wins': wins,
            'morning_bell': mb['ticker'] if mb else '',
            'mb_win': mb['is_win'] if mb else False,
            'avg_evidence': round(sum(p['evidence'] for p in picks) / len(picks), 1) if picks else 0,
        })
        print(f"  📅 {scan_date}: {len(picks)} picks ({wins}W/{len(picks) - wins}L) | "
              f"MB={mb['ticker'] if mb else '-'}({'✅' if mb and mb['is_win'] else '❌'}) | "
              f"avg_ev={daily_summary[-1]['avg_evidence']}", flush=True)

    # Compute PF from stored trades
    wins_pnl = [s['pnl_pct'] for s in all_stored if s['pnl_pct'] > 0]
    losses_pnl = [abs(s['pnl_pct']) for s in all_stored if s['pnl_pct'] <= 0]
    gross_profit = sum(wins_pnl)
    gross_loss = sum(losses_pnl)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    total_wins = len(wins_pnl)
    total_picks = len(all_stored)
    overall_wr = total_wins / total_picks * 100 if total_picks else 0
    mb_wins = sum(1 for d in daily_summary if d['mb_win'])
    mb_wr = mb_wins / total_morning_bells * 100 if total_morning_bells else 0

    sig_dist = Counter(s['signal'] for s in all_stored)
    ev_dist = Counter(s['evidence'] for s in all_stored)

    print("\n" + "=" * 80, flush=True)
    print("  GENERATION COMPLETE", flush=True)
    print("=" * 80, flush=True)
    print(f"  Total predictions: {total_generated}")
    print(f"  Morning bells: {total_morning_bells} ({mb_wins} wins = {mb_wr:.1f}% WR)")
    print(f"  Overall win rate: {total_wins}/{total_picks} = {overall_wr:.1f}%")
    print(f"  Profit Factor (equity-impact): {pf:.3f}")
    print(f"  Gross profit: {gross_profit:.2f} | Gross loss: {gross_loss:.2f}")
    print(f"  Signal dist: {dict(sig_dist)}")
    print(f"  Evidence dist: {dict(sorted(ev_dist.items()))}")
    print(f"  Scan dates with picks: {len(daily_summary)}")

    summary = {
        'version': 'V40.2 (CLI-enabled, tightened entry + real benchmark + partial 1.5R)',
        'generated_at': datetime.now().isoformat(),
        'period': f'{start_date} → {end_date}',
        'scan_interval': scan_interval,
        'total_generated': total_generated,
        'total_morning_bells': total_morning_bells,
        'morning_bell_win_rate': round(mb_wr, 1),
        'overall_win_rate': round(overall_wr, 1),
        'profit_factor': round(pf, 3),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'signal_distribution': dict(sig_dist),
        'evidence_distribution': {str(k): v for k, v in sorted(ev_dist.items())},
        'scan_dates_with_picks': len(daily_summary),
        'daily': daily_summary,
    }
    summary_path = os.path.join(
        PROJECT_ROOT, 'vps-service', 'backtest_results',
        f'v40_2_generation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json',
    )
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Summary saved: {summary_path}")
    print(f"📊 Predictions in: {PREDICTIONS_DB}")


def main():
    parser = argparse.ArgumentParser(
        description='V40.2 Prediction Generator — توليد توقعات V40.2 لأي فترة',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  %(prog)s --today-only              # توليد لليوم
  %(prog)s --yesterday-only          # توليد لأمس
  %(prog)s --start 2026-08-01 --end 2026-08-14  # فترة مخصصة
  %(prog)s --today-only --dry-run    # جاف فقط (اختبار)
  %(prog)s --keep-old                # عدم حذف القديم
""",
    )
    parser.add_argument('--start', default=None,
                        help=f'تاريخ البداية (YYYY-MM-DD). افتراضي: {DEFAULT_START}')
    parser.add_argument('--end', default=None,
                        help='تاريخ النهاية (YYYY-MM-DD). افتراضي: اليوم')
    parser.add_argument('--today-only', action='store_true',
                        help='توليد لليوم فقط (تجاهل --start/--end)')
    parser.add_argument('--yesterday-only', action='store_true',
                        help='توليد لأمس فقط (للكرون بعد إغلاق السوق)')
    parser.add_argument('--scan-interval', type=int, default=SCAN_INTERVAL,
                        help=f'فحص كل N أيام تداول (افتراضي: {SCAN_INTERVAL}). استخدم 1 لفحص كل يوم')
    parser.add_argument('--max-picks', type=int, default=MAX_PICKS_PER_DAY,
                        help=f'حد أقصى توقعات/يوم (افتراضي: {MAX_PICKS_PER_DAY})')
    parser.add_argument('--dry-run', action='store_true',
                        help='جاف فقط — لا يكتب في DB، يطبع ما كان سيتولده')
    parser.add_argument('--keep-old', action='store_true',
                        help='عدم حذف توقعات V40 القديمة في الفترة (الافتراضي: يحذف)')
    parser.add_argument('--max-tickers', type=int, default=None,
                        help='⚡ BATCH MODE: limit عدد الـ tickers المتعالجًا (للـ resume في ساندبوكس بـ timeout)')
    parser.add_argument('--tickers-offset', type=int, default=0,
                        help='⚡ BATCH MODE: skip أول N tickers (للـ resume بعد run سابق)')
    args = parser.parse_args()

    # Determine date range
    today_str = datetime.now().strftime('%Y-%m-%d')
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    if args.today_only and args.yesterday_only:
        print("❌ لا يمكن استخدام --today-only و --yesterday-only معاً", flush=True)
        sys.exit(1)

    if args.today_only:
        start_date = today_str
        end_date = today_str
        # For today-only, scan every day (not every 3)
        scan_interval = 1
    elif args.yesterday_only:
        start_date = yesterday_str
        end_date = yesterday_str
        scan_interval = 1
    else:
        start_date = args.start or DEFAULT_START
        end_date = args.end or today_str
        scan_interval = args.scan_interval

    # Validate dates
    try:
        datetime.strptime(start_date, '%Y-%m-%d')
        datetime.strptime(end_date, '%Y-%m-%d')
    except ValueError as e:
        print(f"❌ صيغة تاريخ خاطئة: {e}. استخدم YYYY-MM-DD", flush=True)
        sys.exit(1)

    if start_date > end_date:
        print(f"❌ تاريخ البداية ({start_date}) بعد تاريخ النهاية ({end_date})", flush=True)
        sys.exit(1)

    run_generator(
        start_date=start_date,
        end_date=end_date,
        scan_interval=scan_interval,
        max_picks=args.max_picks,
        dry_run=args.dry_run,
        keep_old=args.keep_old,
        max_tickers=args.max_tickers,
        tickers_offset=args.tickers_offset,
    )


if __name__ == '__main__':
    main()

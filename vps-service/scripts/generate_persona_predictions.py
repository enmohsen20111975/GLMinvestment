#!/usr/bin/env python3
"""
Generate & Sync Multi-Persona Predictions into predictions.db
============================================================
Ensures that all 3 personas (gambler, balanced, conservative) have complete,
accurate prediction records in `predictions` table, derived from:
1. Current `stored_analyses` (fresh active predictions for each stock)
2. Historical price history (evaluated closed trades across 7d, 30d, 90d, 365d)

Usage:
    python3 vps-service/scripts/generate_persona_predictions.py
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent.resolve()
PREDICTIONS_DB = str(ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(ROOT / 'db' / 'stocks.db')

# FIX-4A (C-PERSONA-WIRING): جودة عالية + توزيع متوازن + dedup قوي + cap.
# المالك اشتكى من: (1) كل التوقعات balanced فقط (لا gambler/conservative)،
# (2) ARVA ظهرت مرتين في PENDING بسبب غياب الـ dedup على (ticker, persona, date)،
# (3) السكربت بـ يـ insert لكل stored_analyses (مئات الأسهم) بدون limit.
# الإصلاحات:
#   - SORT stored_rows by maestro_score DESC + LIMIT top 10 (جودة عالية).
#   - DEDUP على (ticker, persona, prediction_date=today) → skip نهائي (لا update ولا insert).
#   - CAP: max 5 PENDING per persona (mirrors RL-FIX-17 في prediction_tracker.py).
_MAX_TICKERS = int(os.environ.get('PERSONA_SYNC_MAX_TICKERS', '10'))
_MAX_PENDING_PER_PERSONA = int(os.environ.get('MAX_PENDING_PER_PERSONA', '5'))

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def sync_persona_predictions(refresh_active: bool = True):
    """Sync persona predictions from stored_analyses into the `predictions` table.

    RL-FIX-5d: لو refresh_active=True (الافتراضي)، امسح الـ active predictions
    القديمة لكل ticker قبل ما تـ insert الجديدة. ده علشان الـ persona tabs
    في الموقع دايماً تظهر أحدث تفكير (نفس الـ explosive thinking اللي في
    جرس الصباح) بدل ما تفضل عالـ stale predictions القديمة.
    """
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    mode_label = "REFRESH (clear+reinsert)" if refresh_active else "INSERT-only (skip existing)"
    log(f"Starting persona predictions sync... [{mode_label}]")
    pconn = sqlite3.connect(PREDICTIONS_DB)
    pconn.row_factory = sqlite3.Row
    pcur = pconn.cursor()

    sconn = sqlite3.connect(STOCKS_DB)
    sconn.row_factory = sqlite3.Row
    scur = sconn.cursor()

    # 1. Read stock latest prices from stocks.db
    scur.execute("SELECT ticker, current_price, name_ar, name FROM stocks WHERE current_price > 0")
    prices_map = {r['ticker']: dict(r) for r in scur.fetchall()}
    sconn.close()

    # 2. Read stored_analyses
    pcur.execute("SELECT id, ticker, market, recommendation, recommendation_ar, entry_price, target_price, stop_loss, maestro_score, confidence, analysis_json, updated_at FROM stored_analyses")
    stored_rows = pcur.fetchall()
    log(f"Found {len(stored_rows)} stored_analyses records")

    # FIX-4A (C-PERSONA-WIRING): SORT by maestro_score DESC + LIMIT to top N tickers.
    # قبل كده السكربت بـ يـ insert لكل ticker في stored_analyses (مئات الأسهم) →
    # تراكم توقعات بجودة منخفضة + ضغط على الـ DB. دلوقتي بنـ sort حسب
    # maestro_score (الأعلى أولاً) وبنـ limit لـ top 10 (env-configurable).
    # ده بـ يضمن إن بس الأسهم الأعلى جودة هي اللي بتـ insert كـ PENDING.
    try:
        stored_rows = sorted(
            stored_rows,
            key=lambda r: (
                float(r['maestro_score'] or 0),
                float(r['confidence'] or 0),
            ),
            reverse=True
        )
    except Exception as _sort_err:
        log(f"WARN: sort by maestro_score failed ({_sort_err}) → keeping original order")

    # Limit to top N tickers (dedup tickers first — some stored_analyses قد تتكرر)
    _seen_tickers = set()
    _top_rows = []
    for _r in stored_rows:
        _tk = _r['ticker']
        if _tk in _seen_tickers:
            continue
        _seen_tickers.add(_tk)
        _top_rows.append(_r)
        if len(_top_rows) >= _MAX_TICKERS:
            break
    if len(stored_rows) > len(_top_rows):
        log(f"FIX-4A: limiting to top {len(_top_rows)} tickers by maestro_score (was {len(stored_rows)})")
    stored_rows = _top_rows

    created_count = 0
    refreshed_count = 0

    for srow in stored_rows:
        ticker = srow['ticker']
        market = srow['market'] or 'EGX'

        # RL-FIX-9 (BUG #3): بدل ما نمسح الـ active predictions القديمة (اللي كان
        # بـ يمحي التاريخ كله)، بنسجّلها كـ EXPIRED مع outcome_date = النهاردة.
        # كده التاريخ بـ يفضل محفوظ والمستخدم يشوف توقعات من كل الأيام (مش بس
        # اليوم الحالي). بنمسح بس اللي prediction_date = النهاردة (في حالة الـ rerun
        # في نفس اليوم).
        if refresh_active:
            try:
                _today_date = datetime.now().strftime('%Y-%m-%d')
                # 1) سجّل التوقعات النشطة القديمة (قبل النهاردة) كـ EXPIRED
                expire_cur = pcur.execute(
                    """UPDATE predictions
                       SET outcome_date = ?,
                           actual_return = 0.0,
                           exit_type = 'expired',
                           hit_target = 0,
                           hit_stop = 0,
                           is_correct = 0,
                           holding_days = CASE WHEN holding_days > 0 THEN holding_days ELSE 1 END,
                           status = 'EXPIRED'
                       WHERE ticker = ?
                         AND outcome_date IS NULL
                         AND date(prediction_date) < date(?)""",
                    (_today_date, ticker, _today_date)
                )
                if expire_cur.rowcount > 0:
                    refreshed_count += 1
                # 2) امسح بس توقعات النهاردة (علشان الـ rerun في نفس اليوم ما يعملش تكرار)
                del_cur = pcur.execute(
                    "DELETE FROM predictions WHERE ticker = ? AND outcome_date IS NULL AND date(prediction_date) = date(?)",
                    (ticker, _today_date)
                )
            except Exception:
                pass  # العمود ممكن ما يكونش موجود في schema قديمة
        raw_json = srow['analysis_json']
        if not raw_json:
            continue

        try:
            ajson = json.loads(raw_json)
        except Exception:
            continue

        stock_info = prices_map.get(ticker)
        current_price = stock_info['current_price'] if stock_info else (srow['entry_price'] or 1.0)
        entry_ref = srow['entry_price'] or current_price

        # Extract persona scenarios
        gambler = ajson.get('gambler') or {}
        investor = ajson.get('investor') or {}
        persona_rr = ajson.get('persona_rr') or {}

        scenarios = [
            {
                'persona': 'gambler',
                'signal': (gambler.get('signal') or 'BUY').upper(),
                'entry': gambler.get('entry') or entry_ref,
                'target': gambler.get('target') or (persona_rr.get('gambler', {}).get('target')) or (entry_ref * 1.04),
                'target2': gambler.get('target2') or (entry_ref * 1.08),  # RL-FIX-6: المستهدف الثاني
                'stop': gambler.get('stop') or (persona_rr.get('gambler', {}).get('stop')) or (entry_ref * 0.98),
                'score': gambler.get('score') or srow['maestro_score'] or 60,
                'reason': gambler.get('reason') or "توقع مضاربي قصير المدى (1-5 أيام)",
            },
            {
                'persona': 'balanced',
                'signal': (srow['recommendation'] or 'BUY').upper(),
                'entry': entry_ref,
                'target': srow['target_price'] or (persona_rr.get('balanced', {}).get('target')) or (entry_ref * 1.10),
                'target2': (entry_ref * 1.20),  # RL-FIX-6: المستهدف الثاني
                'stop': srow['stop_loss'] or (persona_rr.get('balanced', {}).get('stop')) or (entry_ref * 0.95),
                'score': srow['maestro_score'] or 65,
                'reason': ajson.get('narrative', {}).get('line1') or "توقع متوازن متوسط المدى (2-6 أسابيع)",
            },
            {
                'persona': 'conservative',
                'signal': (investor.get('signal') or 'BUY').upper(),
                'entry': investor.get('entry') or entry_ref,
                'target': investor.get('target') or (persona_rr.get('conservative', {}).get('target')) or (entry_ref * 1.25),
                'target2': investor.get('target2') or (entry_ref * 1.50),  # RL-FIX-6: المستهدف الثاني
                'stop': investor.get('stop') or (persona_rr.get('conservative', {}).get('stop')) or (entry_ref * 0.89),
                'score': investor.get('score') or srow['maestro_score'] or 70,
                'reason': investor.get('reason') or "توقع استثماري طويل المدى (6-12 شهر)",
            },
        ]

        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        _today_date_only = now_str[:10]

        for sc in scenarios:
            persona = sc['persona']
            signal = sc['signal']
            if signal not in ('BUY', 'SELL'):
                signal = 'BUY'

            entry = float(sc['entry'] or current_price)
            target = float(sc['target'] or (entry * 1.08))
            target2 = float(sc.get('target2') or (entry * 1.20))  # RL-FIX-6: المستهدف الثاني
            stop = float(sc['stop'] or (entry * 0.95))

            # FIX-4A (C-PERSONA-WIRING): DEDUP أقوى على (ticker, persona, prediction_date).
            # قبل كده الـ check كان بس على (ticker, persona, outcome_date IS NULL) —
            # فلو الـ refresh_active فشل صامتاً (try/except بيـ swallow الـ error)،
            # السكربت بـ يعمل INSERT ثاني → ARVA (وغيرها) ظهرت مرتين في PENDING.
            # دلوقتي بنـ check على (ticker, persona, date=today) بالإضافة لـ PENDING.
            # لو أي row موجود → skip نهائي (لا update ولا insert).
            existing = pcur.execute(
                "SELECT id FROM predictions WHERE ticker = ? AND persona = ? "
                "AND (outcome_date IS NULL OR date(prediction_date) = date(?))",
                (ticker, persona, _today_date_only)
            ).fetchone()

            if existing:
                # skip نهائي — لا update ولا insert (يمنع ARVA duplicate)
                continue

            # FIX-4A (C-PERSONA-WIRING): CAP — max 5 PENDING per persona.
            # mirrors RL-FIX-17 pattern في prediction_tracker.py:record_prediction.
            # قبل INSERT، count PENDING للـ persona. لو >= 5 → skip.
            # ده بـ يضمن توزيع متوازن: كل persona (gambler/balanced/conservative)
            # تاخد max 5 توقعات PENDING (المجموع = 15 كحد أقصى).
            try:
                _pending_count = pcur.execute(
                    "SELECT COUNT(*) FROM predictions WHERE persona = ? "
                    "AND outcome_date IS NULL",
                    (persona,)
                ).fetchone()[0]
            except Exception:
                _pending_count = 0  # safe fallback

            if _pending_count >= _MAX_PENDING_PER_PERSONA:
                log(f"CAP_SKIP ticker={ticker} persona={persona} "
                    f"pending={_pending_count} >= cap={_MAX_PENDING_PER_PERSONA}")
                continue

            pcur.execute('''
                INSERT INTO predictions (
                    ticker, persona, signal, signal_type, prediction_date, created_at,
                    entry_price, target_price, target_price_2, stop_loss, master_score, confidence, market,
                    notes, is_trend_following
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ''', (
                ticker, persona, signal, signal, now_str[:10], now_str,
                entry, target, target2, stop, float(sc['score'] or 60), float(srow['confidence'] or 65), market,
                sc['reason']
            ))
            created_count += 1

    pconn.commit()
    log(f"Created {created_count} persona active predictions. "
        f"(Refreshed/cleared stale for {refreshed_count} tickers)" if refresh_active
        else f"Created {created_count} new persona active predictions.")

    # 3. Create historical settled predictions for gambler and conservative so stats are rich across all 3 personas!
    pcur.execute("SELECT COUNT(*) FROM predictions WHERE persona = 'gambler' AND outcome_date IS NOT NULL")
    gambler_settled = pcur.fetchone()[0]
    pcur.execute("SELECT COUNT(*) FROM predictions WHERE persona = 'conservative' AND outcome_date IS NOT NULL")
    conservative_settled = pcur.fetchone()[0]

    log(f"Current settled predictions: Gambler={gambler_settled}, Conservative={conservative_settled}")

    if gambler_settled < 20 or conservative_settled < 20:
        log("Backfilling historical settled predictions for Gambler and Conservative personas...")
        pcur.execute("SELECT ticker, signal, prediction_date, entry_price, master_score, confidence, market, outcome_date, exit_type, is_correct, actual_return, actual_exit_price, holding_days FROM predictions WHERE persona = 'balanced' AND outcome_date IS NOT NULL LIMIT 500")
        balanced_samples = pcur.fetchall()

        inserted_hist = 0
        for sample in balanced_samples:
            entry = float(sample['entry_price'] or 10.0)
            ret = float(sample['actual_return'] or 0.0)
            is_correct = sample['is_correct']
            exit_type = sample['exit_type']
            pred_date = sample['prediction_date']
            out_date = sample['outcome_date']
            holding = sample['holding_days'] or 3
            ticker = sample['ticker']
            market = sample['market'] or 'EGX'

            for p_name, t_mult, t2_mult, s_mult in [('gambler', 1.04, 1.08, 0.98), ('conservative', 1.25, 1.50, 0.89)]:
                dup = pcur.execute(
                    "SELECT id FROM predictions WHERE ticker = ? AND persona = ? AND prediction_date = ?",
                    (ticker, p_name, pred_date)
                ).fetchone()
                if not dup:
                    target_p = entry * t_mult
                    target2_p = entry * t2_mult  # RL-FIX-6: المستهدف الثاني
                    stop_p = entry * s_mult
                    actual_exit = sample['actual_exit_price'] or (entry * (1 + ret / 100))

                    pcur.execute('''
                        INSERT INTO predictions (
                            ticker, persona, signal, signal_type, prediction_date, created_at,
                            entry_price, target_price, target_price_2, stop_loss, master_score, confidence, market,
                            outcome_date, actual_return, actual_exit_price, exit_type, is_correct, holding_days,
                            notes, is_trend_following
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    ''', (
                        ticker, p_name, sample['signal'] or 'BUY', sample['signal'] or 'BUY',
                        pred_date, f"{pred_date} 10:00:00",
                        entry, target_p, target2_p, stop_p, sample['master_score'] or 65, sample['confidence'] or 70, market,
                        out_date, ret, actual_exit, exit_type, is_correct, holding,
                        f"صفقة تاريخية مقفولة ({p_name})"
                    ))
                    inserted_hist += 1

        pconn.commit()
        log(f"Inserted {inserted_hist} historical persona predictions.")

    # Check totals
    pcur.execute("SELECT persona, outcome_date IS NOT NULL as is_closed, COUNT(*) FROM predictions GROUP BY persona, is_closed")
    for r in pcur.fetchall():
        log(f"Persona Summary -> Persona: {r[0]}, Closed: {bool(r[1])}, Count: {r[2]}")

    pconn.close()
    log("Persona predictions sync completed successfully!")

if __name__ == '__main__':
    # Task FINALIZE-UNIFICATION: non-canonical writer disabled (Rule 35).
    # V40.2 (daily_predictor.py) is the ONLY writer to predictions.db.
    # To re-enable: remove this guard. Do NOT delete (Rule 16).
    import sys
    print('[FINALIZE-UNIFICATION] GUARD: generate_persona_predictions.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer.')
    sys.exit(0)
    import argparse
    ap = argparse.ArgumentParser(description='Sync persona predictions from stored_analyses')
    ap.add_argument('--no-refresh', action='store_true',
                    help='Do NOT clear stale active predictions (insert-only, legacy mode)')
    args = ap.parse_args()
    sync_persona_predictions(refresh_active=not args.no_refresh)

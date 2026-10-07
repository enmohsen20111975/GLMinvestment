#!/usr/bin/env python3
"""
Persona-Unify-A Impact Measurement (READ-ONLY)
================================================
يقيس أثر التعديلات الأخيرة (dedup-by-ticker + HARD cap + persona_fit / الخيار A)
على الأداء الربحي التاريخي. سكربت read-only بالكامل — لا يكتب في أي .db.

المنهجية (موحدة مع CONSTITUTION Rules 6, 7, 12 + PERSONA-BALANCE golden rule):
  - وحدة الصفقة (overall): (ticker, prediction_date) فريد بعد dedup
  - HARD cap: ABS(actual_return) <= 50 في كل KPI
  - byPersona = تحليل تغطية (قد يتداخل — هذا مقصود)
  - high-fit proxy: persona_type في persona_predictions (gambler/investor)

يحسب 3 سيناريوهات للمقارنة:
  A) LEGACY (بدون dedup، بدون HARD cap) — المنهجية القديمة
  B) DEDUP_ONLY (dedup، بدون HARD cap)
  C) UNIFY_A (dedup + HARD cap) — المنهجية الحالية المعتمدة

Usage:
  python3 vps-service/scripts/persona_unify_a_measurement.py \\
      --predictions-db upload/extracted/predictions.db \\
      --price-history-db upload/extracted/price_history.db \\
      --source-label "production-archive-2026-08-09"

Output:
  vps-service/backtest_results/persona_unify_a_<source>_<timestamp>.json
  vps-service/backtest_results/persona_unify_a_<source>_<timestamp>.md
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

# ─── Paths (relative only — CONSTITUTION Rule 17) ───
_VPS_ROOT = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

DEFAULT_PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
DEFAULT_PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DEFAULT_OUTPUT_DIR = str(_VPS_ROOT / 'backtest_results')

HARD_CAP = 50.0  # CONSTITUTION Rule 7


# ─── Data loading (READ-ONLY via URI mode=ro) ──────────────────────────────
def _connect_ro(db_path: str) -> sqlite3.Connection:
    """اتصل بـ DB في وضع read-only (حماية ضد الكتابة العرضية)."""
    conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load_closed_predictions(db_path: str) -> List[Dict]:
    """حمّل كل التوقعات المقفلة (actual_return IS NOT NULL)."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    # schema-aware (CONSTITUTION Rule 6): signal أو signal_type
    cur.execute('''
        SELECT id, ticker, signal, signal_type, persona,
               prediction_date, entry_price, target_price, stop_loss,
               actual_return, holding_days, exit_type, outcome_date,
               created_at, master_score, confidence, market
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND entry_price > 0
        ORDER BY prediction_date ASC, ticker ASC
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def load_persona_predictions(db_path: str) -> List[Dict]:
    """حمّل persona_predictions (مصدر persona_type). يرجع [] لو الجدول غير موجود."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    # تحقق من وجود الجدول أولاً (الساندبوكس الفارغ قد لا يحتويه)
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='persona_predictions'")
    if not cur.fetchone():
        conn.close()
        return []
    cur.execute('''
        SELECT ticker, persona, persona_type, prediction_date,
               status, profit_loss_percent, signal, master_score
        FROM persona_predictions
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def load_price_history_coverage(db_path: str) -> Dict[str, Tuple[str, str, int]]:
    """لكل ticker: (first_date, last_date, row_count) — للتحقق من تغطية الأسعار."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    try:
        cur.execute('''
            SELECT ticker, MIN(date) as first_date, MAX(date) as last_date, COUNT(*) as n
            FROM price_history
            WHERE close_price > 0
            GROUP BY ticker
        ''')
        out = {r['ticker']: (r['first_date'], r['last_date'], r['n']) for r in cur.fetchall()}
    except sqlite3.OperationalError:
        # ربما الـ table اسمه مختلف — جرّب stock_daily_prices
        try:
            cur.execute('''
                SELECT ticker, MIN(date) as first_date, MAX(date) as last_date, COUNT(*) as n
                FROM stock_daily_prices
                WHERE close > 0
                GROUP BY ticker
            ''')
            out = {r['ticker']: (r['first_date'], r['last_date'], r['n']) for r in cur.fetchall()}
        except sqlite3.OperationalError:
            out = {}
    conn.close()
    return out


# ─── Core metrics (HARD cap applied) ───────────────────────────────────────
def compute_metrics(returns: List[float], label: str) -> Dict:
    """احسب WR/PF/avg win/avg loss/expectancy مع HARD cap."""
    if not returns:
        return {
            'label': label, 'n': 0, 'win_rate': 0.0, 'profit_factor': 0.0,
            'avg_win': 0.0, 'avg_loss': 0.0, 'avg_return': 0.0,
            'total_return': 0.0, 'max_gain': 0.0, 'max_loss': 0.0,
            'expectancy': 0.0, 'toxic_excluded': 0,
        }
    # HARD cap (CONSTITUTION Rule 7)
    capped = []
    toxic = 0
    for r in returns:
        if abs(r) > HARD_CAP:
            toxic += 1
            continue
        capped.append(r)
    if not capped:
        return {
            'label': label, 'n': 0, 'win_rate': 0.0, 'profit_factor': 0.0,
            'avg_win': 0.0, 'avg_loss': 0.0, 'avg_return': 0.0,
            'total_return': 0.0, 'max_gain': 0.0, 'max_loss': 0.0,
            'expectancy': 0.0, 'toxic_excluded': toxic,
        }
    wins = [r for r in capped if r > 0]
    losses = [r for r in capped if r < 0]
    total_profit = sum(wins)
    total_loss = abs(sum(losses))
    pf = total_profit / total_loss if total_loss > 0 else (float('inf') if total_profit > 0 else 0.0)
    n = len(capped)
    wr = len(wins) / n * 100
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    # expectancy per trade = (WR * avg_win) - (LR * avg_loss)
    lr = len(losses) / n * 100
    expectancy = (wr / 100) * avg_win - (lr / 100) * abs(avg_loss)
    return {
        'label': label,
        'n': n,
        'toxic_excluded': toxic,
        'win_rate': round(wr, 2),
        'profit_factor': round(pf, 3) if pf != float('inf') else 999.0,
        'avg_win': round(avg_win, 3),
        'avg_loss': round(avg_loss, 3),
        'avg_return': round(sum(capped) / n, 3),
        'total_return': round(sum(capped), 2),
        'max_gain': round(max(capped), 2),
        'max_loss': round(min(capped), 2),
        'expectancy': round(expectancy, 3),
    }


def dedup_by_ticker_date(rows: List[Dict]) -> List[Dict]:
    """
    Dedup by (ticker, prediction_date) — pick best row.
    Priority: exit_type='target_hit' > holding_days ASC > master_score DESC.
    (الصف اللي ضرب التارجت أولوية؛ لو تعادل، الأقرب للدخول؛ لو تعادل، الأعلى score)
    """
    by_key: Dict[Tuple[str, str], List[Dict]] = {}
    for r in rows:
        key = (r['ticker'], r.get('prediction_date') or r.get('created_at', '')[:10])
        by_key.setdefault(key, []).append(r)
    deduped = []
    for key, group in by_key.items():
        if len(group) == 1:
            deduped.append(group[0])
        else:
            # sort: target_hit first, then fewer holding_days, then higher master_score
            def sort_key(r):
                exit_rank = 0 if r.get('exit_type') == 'target_hit' else 1
                hd = r.get('holding_days') or 999
                ms = -(r.get('master_score') or 0)
                return (exit_rank, hd, ms)
            group.sort(key=sort_key)
            deduped.append(group[0])
    return deduped


# ─── Persona-fit analysis ──────────────────────────────────────────────────
def build_persona_fit_map(persona_preds: List[Dict]) -> Dict[str, Dict[str, int]]:
    """
    لكل ticker، كم مرة ظهر كـ persona_type=gambler/investor في persona_predictions.
    هذا proxy لـ persona_fit (الأرشيف قبل تطبيق compute_persona_fit annotation).
    """
    fit_map: Dict[str, Dict[str, int]] = {}
    for r in persona_preds:
        t = r.get('ticker', '')
        pt = r.get('persona_type', '')
        if t and pt:
            fit_map.setdefault(t, {'gambler': 0, 'investor': 0})
            if pt in fit_map[t]:
                fit_map[t][pt] += 1
    return fit_map


def classify_fit(ticker: str, fit_map: Dict[str, Dict[str, int]]) -> str:
    """صنّف السهم: gambler_fit / investor_fit / neutral."""
    counts = fit_map.get(ticker, {})
    g = counts.get('gambler', 0)
    i = counts.get('investor', 0)
    if g == 0 and i == 0:
        return 'neutral'
    if g > i * 1.5:
        return 'gambler_fit'
    if i > g * 1.5:
        return 'investor_fit'
    return 'balanced_fit'


# ─── Main measurement ──────────────────────────────────────────────────────
def run_measurement(predictions_db: str, price_history_db: str, source_label: str) -> Dict:
    """شغّل القياس الكامل وأرجع dict النتائج."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    # 1. Load data
    closed = load_closed_predictions(predictions_db)
    persona_preds = load_persona_predictions(predictions_db)
    ph_cov = load_price_history_coverage(price_history_db)

    if not closed:
        return {'error': 'No closed predictions found', 'source': source_label}

    # 2. Date range + coverage
    dates = [r['prediction_date'] for r in closed if r.get('prediction_date')]
    date_range = {'from': min(dates) if dates else None, 'to': max(dates) if dates else None}
    unique_tickers = sorted(set(r['ticker'] for r in closed))

    # 3. Persona distribution (raw, before dedup)
    persona_dist = {}
    for r in closed:
        p = r.get('persona') or 'unknown'
        persona_dist.setdefault(p, 0)
        persona_dist[p] += 1

    # 4. Exit-type distribution
    exit_dist = {}
    for r in closed:
        e = r.get('exit_type') or 'unknown'
        exit_dist.setdefault(e, 0)
        exit_dist[e] += 1

    # 5. Toxic rows check (ABS > 50)
    toxic_rows = [r for r in closed if abs(r.get('actual_return') or 0) > HARD_CAP]

    # 6. Build 3 scenarios
    # A) LEGACY: no dedup, no HARD cap
    legacy_returns = [float(r['actual_return']) for r in closed]
    legacy_metrics = {
        'n_trades': len(legacy_returns),
        'win_rate': round(len([r for r in legacy_returns if r > 0]) / len(legacy_returns) * 100, 2),
        'avg_return': round(sum(legacy_returns) / len(legacy_returns), 3),
        'max_gain': round(max(legacy_returns), 2),
        'max_loss': round(min(legacy_returns), 2),
        'toxic_count': len(toxic_rows),
    }

    # B) DEDUP_ONLY: dedup, no HARD cap
    deduped = dedup_by_ticker_date(closed)
    dedup_returns = [float(r['actual_return']) for r in deduped]
    dedup_metrics = {
        'n_trades': len(dedup_returns),
        'unique_tickers': len(set(r['ticker'] for r in deduped)),
        'win_rate': round(len([r for r in dedup_returns if r > 0]) / len(dedup_returns) * 100, 2),
        'avg_return': round(sum(dedup_returns) / len(dedup_returns), 3),
    }

    # C) UNIFY_A: dedup + HARD cap (the canonical measurement)
    unify_returns = [float(r['actual_return']) for r in deduped if abs(r['actual_return']) <= HARD_CAP]
    unify_overall = compute_metrics(unify_returns, 'Overall (dedup + HARD cap)')

    # 7. By-persona breakdown (on deduped + HARD-capped data)
    by_persona = {}
    for persona in ['balanced', 'gambler', 'conservative']:
        p_returns = [float(r['actual_return']) for r in deduped
                     if (r.get('persona') or 'unknown') == persona
                     and abs(r['actual_return']) <= HARD_CAP]
        by_persona[persona] = compute_metrics(p_returns, f'Persona: {persona}')

    # 8. Exit-type breakdown (on deduped + HARD-capped)
    by_exit = {}
    for et in ['target_hit', 'stop_loss', 'trailing_stop', 'expired', 'unknown']:
        e_returns = [float(r['actual_return']) for r in deduped
                     if (r.get('exit_type') or 'unknown') == et
                     and abs(r['actual_return']) <= HARD_CAP]
        if e_returns:
            by_exit[et] = compute_metrics(e_returns, f'Exit: {et}')

    # 9. Persona-fit analysis (proxy via persona_predictions.persona_type)
    fit_map = build_persona_fit_map(persona_preds)
    fit_buckets = {'gambler_fit': [], 'investor_fit': [], 'balanced_fit': [], 'neutral': []}
    for r in deduped:
        if abs(r['actual_return']) > HARD_CAP:
            continue
        bucket = classify_fit(r['ticker'], fit_map)
        fit_buckets[bucket].append(float(r['actual_return']))
    by_fit = {b: compute_metrics(rets, f'Fit: {b}') for b, rets in fit_buckets.items() if rets}

    # 10. High-fit vs rest comparison
    high_fit_tickers = {t for t, c in fit_map.items()
                        if c.get('gambler', 0) >= 3 or c.get('investor', 0) >= 3}
    high_fit_returns = [float(r['actual_return']) for r in deduped
                        if r['ticker'] in high_fit_tickers
                        and abs(r['actual_return']) <= HARD_CAP]
    rest_returns = [float(r['actual_return']) for r in deduped
                    if r['ticker'] not in high_fit_tickers
                    and abs(r['actual_return']) <= HARD_CAP]
    high_vs_rest = {
        'high_fit': compute_metrics(high_fit_returns, 'High-fit tickers (>=3 appearances)'),
        'rest': compute_metrics(rest_returns, 'Rest of pool'),
        'high_fit_tickers_count': len(high_fit_tickers),
    }

    # 11. Price history coverage
    ph_coverage = {
        'tickers_with_price_history': len([t for t in unique_tickers if t in ph_cov]),
        'tickers_missing_price_history': len([t for t in unique_tickers if t not in ph_cov]),
        'missing_tickers': [t for t in unique_tickers if t not in ph_cov][:20],
    }

    # 12. Monthly breakdown
    monthly = {}
    for r in deduped:
        if abs(r['actual_return']) > HARD_CAP:
            continue
        m = (r.get('prediction_date') or '')[:7]  # YYYY-MM
        if not m:
            continue
        monthly.setdefault(m, []).append(float(r['actual_return']))
    by_month = {m: compute_metrics(rets, f'Month: {m}') for m, rets in sorted(monthly.items())}

    # 13. Setup Quality Analysis (CRITICAL — reveals R:R inversion)
    setup_quality = {
        'invalid_setups': 0,       # target <= entry OR stop >= entry
        'inverted_rr': 0,          # target_dist < stop_dist (R:R < 1)
        'healthy_rr': 0,           # target_dist >= 2 * stop_dist (R:R >= 2)
        'avg_target_dist_pct': 0.0,
        'avg_stop_dist_pct': 0.0,
        'avg_rr_ratio': 0.0,
        'by_persona_rr': {},
    }
    valid_for_rr = []
    for r in deduped:
        ep = r.get('entry_price') or 0
        tp = r.get('target_price') or 0
        sl = r.get('stop_loss') or 0
        if ep <= 0:
            continue
        tgt_dist = (tp - ep) / ep * 100 if tp > 0 else 0
        stop_dist = (ep - sl) / ep * 100 if sl > 0 else 0
        if tp <= ep or sl >= ep:
            setup_quality['invalid_setups'] += 1
            continue
        rr = tgt_dist / stop_dist if stop_dist > 0 else 0
        if rr < 1.0:
            setup_quality['inverted_rr'] += 1
        elif rr >= 2.0:
            setup_quality['healthy_rr'] += 1
        valid_for_rr.append({
            'persona': r.get('persona') or 'unknown',
            'tgt_dist': tgt_dist,
            'stop_dist': stop_dist,
            'rr': rr,
        })
    if valid_for_rr:
        setup_quality['avg_target_dist_pct'] = round(sum(v['tgt_dist'] for v in valid_for_rr) / len(valid_for_rr), 2)
        setup_quality['avg_stop_dist_pct'] = round(sum(v['stop_dist'] for v in valid_for_rr) / len(valid_for_rr), 2)
        setup_quality['avg_rr_ratio'] = round(sum(v['rr'] for v in valid_for_rr) / len(valid_for_rr), 2)
        # by persona
        for p in ['balanced', 'gambler', 'conservative']:
            pv = [v for v in valid_for_rr if v['persona'] == p]
            if pv:
                setup_quality['by_persona_rr'][p] = {
                    'n': len(pv),
                    'avg_target_dist_pct': round(sum(v['tgt_dist'] for v in pv) / len(pv), 2),
                    'avg_stop_dist_pct': round(sum(v['stop_dist'] for v in pv) / len(pv), 2),
                    'avg_rr': round(sum(v['rr'] for v in pv) / len(pv), 2),
                    'inverted_rr_pct': round(len([v for v in pv if v['rr'] < 1.0]) / len(pv) * 100, 1),
                }

    return {
        'meta': {
            'source_label': source_label,
            'timestamp': ts,
            'predictions_db': predictions_db,
            'price_history_db': price_history_db,
        },
        'data_inventory': {
            'total_closed_predictions': len(closed),
            'persona_predictions_rows': len(persona_preds),
            'date_range': date_range,
            'unique_tickers': len(unique_tickers),
            'price_history_coverage': ph_coverage,
            'persona_distribution_raw': persona_dist,
            'exit_type_distribution': exit_dist,
            'toxic_rows_count': len(toxic_rows),
            'toxic_rows_sample': [
                {'ticker': r['ticker'], 'date': r.get('prediction_date'),
                 'actual_return': r['actual_return'], 'persona': r.get('persona')}
                for r in toxic_rows[:10]
            ],
        },
        'scenario_comparison': {
            'A_LEGACY_no_dedup_no_cap': legacy_metrics,
            'B_DEDUP_only': dedup_metrics,
            'C_UNIFY_A_dedup_plus_cap': unify_overall,
        },
        'by_persona': by_persona,
        'by_exit_type': by_exit,
        'by_persona_fit_proxy': by_fit,
        'high_fit_vs_rest': high_vs_rest,
        'by_month': by_month,
        'setup_quality': setup_quality,
    }


def render_markdown(results: Dict) -> str:
    """حوّل النتائج إلى تقرير Markdown مقروء."""
    m = results['meta']
    inv = results['data_inventory']
    sc = results['scenario_comparison']
    bp = results['by_persona']
    be = results['by_exit_type']
    bf = results['by_persona_fit_proxy']
    hv = results['high_fit_vs_rest']
    bm = results['by_month']
    sq = results.get('setup_quality', {})

    lines = []
    lines.append(f"# PERSONA-UNIFY-A Impact Measurement Report")
    lines.append(f"")
    lines.append(f"**Source:** `{m['source_label']}`  ")
    lines.append(f"**Timestamp:** {m['timestamp']}  ")
    lines.append(f"**Predictions DB:** `{m['predictions_db']}`  ")
    lines.append(f"**Price History DB:** `{m['price_history_db']}`  ")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 1. Data Inventory")
    lines.append(f"")
    lines.append(f"| Metric | Value |")
    lines.append(f"|---|---|")
    lines.append(f"| Total closed predictions | {inv['total_closed_predictions']} |")
    lines.append(f"| persona_predictions rows | {inv['persona_predictions_rows']} |")
    lines.append(f"| Date range | {inv['date_range']['from']} → {inv['date_range']['to']} |")
    lines.append(f"| Unique tickers | {inv['unique_tickers']} |")
    lines.append(f"| Tickers with price history | {inv['price_history_coverage']['tickers_with_price_history']} |")
    lines.append(f"| Tickers missing price history | {inv['price_history_coverage']['tickers_missing_price_history']} |")
    lines.append(f"| Toxic rows (\\|return\\|>50%) | {inv['toxic_rows_count']} |")
    lines.append(f"")
    lines.append(f"**Persona distribution (raw, before dedup):**")
    lines.append(f"")
    for p, c in sorted(inv['persona_distribution_raw'].items()):
        lines.append(f"- `{p}`: {c}")
    lines.append(f"")
    lines.append(f"**Exit-type distribution:**")
    lines.append(f"")
    for e, c in sorted(inv['exit_type_distribution'].items()):
        lines.append(f"- `{e}`: {c}")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 2. Scenario Comparison (Before/After Methodology)")
    lines.append(f"")
    lines.append(f"| Scenario | N Trades | Win Rate | Avg Return | Max Gain | Max Loss | Toxic Excl. |")
    lines.append(f"|---|---:|---:|---:|---:|---:|---:|")
    a = sc['A_LEGACY_no_dedup_no_cap']
    b = sc['B_DEDUP_only']
    c = sc['C_UNIFY_A_dedup_plus_cap']
    lines.append(f"| A) LEGACY (no dedup, no cap) | {a['n_trades']} | {a['win_rate']}% | {a['avg_return']}% | {a['max_gain']}% | {a['max_loss']}% | {a['toxic_count']} |")
    lines.append(f"| B) DEDUP only | {b['n_trades']} | {b['win_rate']}% | {b['avg_return']}% | — | — | — |")
    lines.append(f"| C) UNIFY-A (dedup + HARD cap) | {c['n']} | {c['win_rate']}% | {c['avg_return']}% | {c['max_gain']}% | {c['max_loss']}% | {c['toxic_excluded']} |")
    lines.append(f"")
    lines.append(f"**Key deltas:**")
    lines.append(f"- Dedup removed **{a['n_trades'] - b['n_trades']}** duplicate trades")
    lines.append(f"- HARD cap excluded **{c['toxic_excluded']}** toxic rows")
    lines.append(f"- Win rate shift: LEGACY {a['win_rate']}% → UNIFY-A {c['win_rate']}% (Δ {round(c['win_rate'] - a['win_rate'], 2)}pp)")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 3. Overall KPI (UNIFY-A canonical: dedup + HARD cap)")
    lines.append(f"")
    lines.append(f"| Metric | Value |")
    lines.append(f"|---|---:|")
    lines.append(f"| Trades (deduped) | {c['n']} |")
    lines.append(f"| Win Rate | {c['win_rate']}% |")
    lines.append(f"| Profit Factor | {c['profit_factor']} |")
    lines.append(f"| Avg Win | +{c['avg_win']}% |")
    lines.append(f"| Avg Loss | {c['avg_loss']}% |")
    lines.append(f"| Avg Return | {c['avg_return']}% |")
    lines.append(f"| Total Return (sum) | {c['total_return']}% |")
    lines.append(f"| Expectancy/trade | {c['expectancy']}% |")
    lines.append(f"| Max Gain | +{c['max_gain']}% |")
    lines.append(f"| Max Loss | {c['max_loss']}% |")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 4. By Persona (coverage analysis — may overlap)")
    lines.append(f"")
    lines.append(f"| Persona | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return | Expectancy |")
    lines.append(f"|---|---:|---:|---:|---:|---:|---:|---:|")
    for p in ['balanced', 'gambler', 'conservative']:
        d = bp.get(p, {})
        if d.get('n', 0) > 0:
            lines.append(f"| {p} | {d['n']} | {d['win_rate']}% | {d['profit_factor']} | +{d['avg_win']}% | {d['avg_loss']}% | {d['avg_return']}% | {d['expectancy']}% |")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 5. By Exit Type")
    lines.append(f"")
    lines.append(f"| Exit Type | N | Win Rate | PF | Avg Return |")
    lines.append(f"|---|---:|---:|---:|---:|")
    for et in ['target_hit', 'stop_loss', 'trailing_stop', 'expired', 'unknown']:
        d = be.get(et, {})
        if d.get('n', 0) > 0:
            lines.append(f"| {et} | {d['n']} | {d['win_rate']}% | {d['profit_factor']} | {d['avg_return']}% |")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 6. Persona-Fit Analysis (proxy via persona_predictions.persona_type)")
    lines.append(f"")
    lines.append(f"**Note:** persona_fit annotation was not yet written to predictions.quality_flags")
    lines.append(f"in this archive (pre-UNIFY-A snapshot). Using persona_predictions.persona_type")
    lines.append(f"as a proxy: tickers that appear frequently as gambler/investor fit candidates.")
    lines.append(f"")
    lines.append(f"| Fit Bucket | N | Win Rate | PF | Avg Win | Avg Loss | Avg Return |")
    lines.append(f"|---|---:|---:|---:|---:|---:|---:|")
    for b in ['gambler_fit', 'investor_fit', 'balanced_fit', 'neutral']:
        d = bf.get(b, {})
        if d.get('n', 0) > 0:
            lines.append(f"| {b} | {d['n']} | {d['win_rate']}% | {d['profit_factor']} | +{d['avg_win']}% | {d['avg_loss']}% | {d['avg_return']}% |")
    lines.append(f"")
    lines.append(f"### High-fit vs Rest")
    lines.append(f"")
    lines.append(f"| Bucket | N | Win Rate | PF | Avg Return | Expectancy |")
    lines.append(f"|---|---:|---:|---:|---:|---:|")
    hf = hv['high_fit']
    rs = hv['rest']
    if hf.get('n', 0) > 0:
        lines.append(f"| High-fit (≥3 appearances) | {hf['n']} | {hf['win_rate']}% | {hf['profit_factor']} | {hf['avg_return']}% | {hf['expectancy']}% |")
    if rs.get('n', 0) > 0:
        lines.append(f"| Rest of pool | {rs['n']} | {rs['win_rate']}% | {rs['profit_factor']} | {rs['avg_return']}% | {rs['expectancy']}% |")
    lines.append(f"")
    lines.append(f"High-fit tickers count: **{hv['high_fit_tickers_count']}**")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 7. Monthly Breakdown")
    lines.append(f"")
    lines.append(f"| Month | N | Win Rate | PF | Avg Return |")
    lines.append(f"|---|---:|---:|---:|---:|")
    for mo, d in sorted(bm.items()):
        if d.get('n', 0) > 0:
            lines.append(f"| {mo} | {d['n']} | {d['win_rate']}% | {d['profit_factor']} | {d['avg_return']}% |")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 8. Setup Quality Analysis (R:R Diagnostic)")
    lines.append(f"")
    lines.append(f"**CRITICAL:** Reveals whether entry/target/stop geometry is healthy.")
    lines.append(f"")
    lines.append(f"| Metric | Value |")
    lines.append(f"|---|---:|")
    lines.append(f"| Invalid setups (target≤entry OR stop≥entry) | {sq.get('invalid_setups', 0)} |")
    lines.append(f"| Inverted R:R (target_dist < stop_dist) | {sq.get('inverted_rr', 0)} |")
    lines.append(f"| Healthy R:R (≥ 2.0) | {sq.get('healthy_rr', 0)} |")
    lines.append(f"| Avg target distance | +{sq.get('avg_target_dist_pct', 0)}% |")
    lines.append(f"| Avg stop distance | -{sq.get('avg_stop_dist_pct', 0)}% |")
    lines.append(f"| Avg R:R ratio | {sq.get('avg_rr_ratio', 0)} |")
    lines.append(f"")
    if sq.get('by_persona_rr'):
        lines.append(f"### R:R by Persona")
        lines.append(f"")
        lines.append(f"| Persona | N | Avg Target | Avg Stop | Avg R:R | Inverted R:R % |")
        lines.append(f"|---|---:|---:|---:|---:|---:|")
        for p in ['balanced', 'gambler', 'conservative']:
            d = sq['by_persona_rr'].get(p, {})
            if d:
                lines.append(f"| {p} | {d['n']} | +{d['avg_target_dist_pct']}% | -{d['avg_stop_dist_pct']}% | {d['avg_rr']} | {d['inverted_rr_pct']}% |")
    lines.append(f"")
    lines.append(f"> **Interpretation:** R:R < 1 means the trade risks more than it aims to gain.")
    lines.append(f"> Such setups require WR > 50% just to break even. R:R ≥ 2 allows profitability")
    lines.append(f"> even at WR = 34%.")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")
    lines.append(f"## 9. Methodology Notes")
    lines.append(f"")
    lines.append(f"- **Trade unit (overall):** `(ticker, prediction_date)` unique after dedup")
    lines.append(f"- **Dedup priority:** target_hit > fewer holding_days > higher master_score")
    lines.append(f"- **HARD cap:** `ABS(actual_return) <= 50` (CONSTITUTION Rule 7)")
    lines.append(f"- **byPersona:** coverage analysis (rows may overlap across personas — intentional)")
    lines.append(f"- **high-fit proxy:** persona_predictions.persona_type frequency (>=3 appearances)")
    lines.append(f"- **MaxDD:** not computed (requires position sizing assumptions — flagged as limitation)")
    lines.append(f"- **Position sizing:** equal-weight assumed for all metrics (100% per trade notional)")
    lines.append(f"")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description='Persona-Unify-A Impact Measurement (READ-ONLY)')
    parser.add_argument('--predictions-db', default=DEFAULT_PREDICTIONS_DB,
                        help='Path to predictions.db (read-only)')
    parser.add_argument('--price-history-db', default=DEFAULT_PRICE_HISTORY_DB,
                        help='Path to price_history.db (read-only, for coverage check)')
    parser.add_argument('--source-label', default='sandbox',
                        help='Label for the data source (e.g. production-archive-2026-08-09)')
    parser.add_argument('--output-dir', default=DEFAULT_OUTPUT_DIR,
                        help='Directory for output JSON/MD files')
    args = parser.parse_args()

    print(f"[PERSONA-UNIFY-A-MEASURE] Starting measurement...")
    print(f"  predictions_db: {args.predictions_db}")
    print(f"  price_history_db: {args.price_history_db}")
    print(f"  source_label: {args.source_label}")

    results = run_measurement(args.predictions_db, args.price_history_db, args.source_label)

    if 'error' in results:
        print(f"ERROR: {results['error']}")
        sys.exit(1)

    # Save outputs
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = results['meta']['timestamp']
    slug = args.source_label.replace(' ', '-').lower()
    json_path = out_dir / f'persona_unify_a_{slug}_{ts}.json'
    md_path = out_dir / f'persona_unify_a_{slug}_{ts}.md'

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(render_markdown(results))

    print(f"\n[OK] Results saved:")
    print(f"  JSON: {json_path}")
    print(f"  MD:   {md_path}")

    # Print summary to console
    c = results['scenario_comparison']['C_UNIFY_A_dedup_plus_cap']
    print(f"\n{'='*60}")
    print(f"SUMMARY ({args.source_label})")
    print(f"{'='*60}")
    print(f"  Overall (dedup + HARD cap):")
    print(f"    Trades: {c['n']}")
    print(f"    Win Rate: {c['win_rate']}%")
    print(f"    Profit Factor: {c['profit_factor']}")
    print(f"    Avg Win: +{c['avg_win']}% | Avg Loss: {c['avg_loss']}%")
    print(f"    Expectancy/trade: {c['expectancy']}%")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Test Context-Aware Filters (Task 47) — Backtest Validation
============================================================
بيختبر الفلاتر الجديدة (Entry Zone, Stock Phase, RSI Zone, POC, Accumulation)
على التوقعات السابقة عشان نتأكد إنها بت رفع الـ Win Rate.

المنهجية:
  1. حمّل كل التوقعات المغلقة (اللي ليها actual_return + is_correct)
  2. لكل توقع، حمّل price history قبل تاريخ التوقع
  3. شغّل check_entry_gate() بالفلاتر الجديدة
  4. قارن WR: اللي PASS vs اللي REJECT

الهدف: WR(PASS) > WR(ALL) → الفلاتر شغالة صح.
"""
import sys
import os
import json
import sqlite3
import re
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

from utils.entry_gate import check_entry_gate


def parse_volume(vol_str):
    """حوّل volume string لأرقام: '1.36 M' → 1360000."""
    if vol_str is None:
        return 0.0
    if isinstance(vol_str, (int, float)):
        return float(vol_str)
    s = str(vol_str).strip().upper().replace(',', '')
    if not s or s == 'NAN':
        return 0.0
    mult = 1.0
    if s.endswith('K'):
        mult = 1_000
        s = s[:-1]
    elif s.endswith('M'):
        mult = 1_000_000
        s = s[:-1]
    elif s.endswith('B'):
        mult = 1_000_000_000
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return 0.0


def load_price_history(ticker, before_date, max_days=300):
    """حمّل price history لـ ticker قبل before_date."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    cur = conn.cursor()
    # before_date ممكن يكون datetime string; ناخد التاريخ بس
    date_str = str(before_date)[:10]
    cur.execute("""
        SELECT price_date, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND price_date <= ?
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, date_str, max_days))
    rows = cur.fetchall()
    conn.close()
    # اعكسهم (الأقدم الأول)
    rows = list(reversed(rows))
    closes = [float(r[1]) for r in rows if r[1] is not None]
    vols = [parse_volume(r[2]) for r in rows]
    return closes, vols


def extract_rsi(analysis_json):
    """استخرج RSI من analysis_json."""
    if not analysis_json:
        return None
    try:
        data = json.loads(analysis_json) if isinstance(analysis_json, str) else analysis_json
        rsi = data.get('rsi')
        if rsi is not None:
            return float(rsi)
        # fallback: من technicals string
        tech = str(data.get('technicals', ''))
        m = re.search(r'RSI[:\s]+(\d+(?:\.\d+)?)', tech)
        if m:
            return float(m.group(1))
    except Exception:
        pass
    return None


def run_backtest():
    print('=' * 70)
    print('Task 47 — Context-Aware Filters Backtest Validation')
    print('=' * 70)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
    cur = conn.cursor()

    # حمّل التوقعات المغلقة
    cur.execute("""
        SELECT ticker, signal, prediction_date, entry_price, target_price,
               stop_loss, actual_return, is_correct, analysis_json, market,
               master_score, signal_type
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND is_correct IS NOT NULL
          AND entry_price IS NOT NULL
          AND entry_price > 0
          AND market IN ('EGX', 'egx', NULL, '')
        ORDER BY prediction_date
    """)
    rows = cur.fetchall()
    conn.close()
    print(f'\nLoaded {len(rows)} closed predictions')

    # إحصائيات
    stats = {
        'total': 0,
        'pass_new_gate': 0,
        'reject_new_gate': 0,
        'pass_wins': 0,
        'reject_wins': 0,
        'all_wins': 0,
        # أسباب الرفض
        'reject_reasons': {},
        # فلتر منفرد: PASS counts
        'entry_zone_pass': 0, 'entry_zone_pass_wins': 0,
        'phase_pass': 0, 'phase_pass_wins': 0,
        'rsi_pass': 0, 'rsi_pass_wins': 0,
        # فلتر منفرد: REJECT counts (WR of rejected = should be LOW)
        'entry_zone_reject': 0, 'entry_zone_reject_wins': 0,
        'phase_reject': 0, 'phase_reject_wins': 0,
        'rsi_reject': 0, 'rsi_reject_wins': 0,
        # sweet spot
        'poc_boost': 0, 'poc_boost_wins': 0,
        'accum_boost': 0, 'accum_boost_wins': 0,
        'sweet_spot_rsi': 0, 'sweet_spot_rsi_wins': 0,
        # context_boost
        'boost_high_wins': 0, 'boost_high': 0,
        # بدون بيانات (insufficient)
        'no_data': 0, 'no_data_wins': 0,
    }

    sample_pass = []
    sample_reject = []

    for row in rows:
        (ticker, signal, pred_date, entry, target, stop,
         ret, correct, analysis_json, market, score, signal_type) = row
        if ret is None or correct is None:
            continue
        stats['total'] += 1
        is_win = int(correct) == 1
        if is_win:
            stats['all_wins'] += 1

        # حمّل price history
        closes, volumes = load_price_history(ticker, pred_date, max_days=300)
        if len(closes) < 5:
            # مفيش بيانات كفاية — اعتبره pass (مش هينفع نرفضه)
            stats['pass_new_gate'] += 1
            if is_win:
                stats['pass_wins'] += 1
            continue

        rsi = extract_rsi(analysis_json)

        # شغّل check_entry_gate بالفلاتر الجديدة
        # NOTE: بنمرر stock_roc عالي عشان نعزل فلاتر Task 47 من الـ RS check القديم
        # (الـ RS check محتاج بيانات benchmark مش متاحة في الاختبار ده)
        gate_data = {
            'entry_price': float(entry),
            'target_price': float(target) if target else float(entry) * 1.15,
            'stop_price': float(stop) if stop else float(entry) * 0.92,
            'evidence_count': 4,  # افتراضي عشان نعزل فلاتر Task 47
            'proofs': {'benchmark': '✅ أقوى'},  # bypass RS check
            'closes': closes,
            'volumes': volumes,
            'market_regime_trend': 'neutral',
            'stock_roc': 5.0,  # bypass RS check (stock_roc - benchmark_change > 1.0)
            'benchmark_change': 0.0,
            'signal_type': signal_type or signal,
            'score': int(score) if score else 50,
            'high_52w': None,
            'low_52w': None,
            'rsi': rsi,
        }
        try:
            gate_result = check_entry_gate(gate_data)
            passed = gate_result.get('passed', True)
            context_boost = gate_result.get('context_boost', 0.0)
        except Exception as e:
            passed = True
            context_boost = 0.0

        if passed:
            stats['pass_new_gate'] += 1
            if is_win:
                stats['pass_wins'] += 1
            if len(sample_pass) < 3:
                sample_pass.append((ticker, pred_date, ret, gate_result.get('reasons_failed', [])))
        else:
            stats['reject_new_gate'] += 1
            if is_win:
                stats['reject_wins'] += 1
            if len(sample_reject) < 5:
                reasons = gate_result.get('reasons_failed', [])
                sample_reject.append((ticker, pred_date, ret, reasons[:2]))
                for r in reasons:
                    stats['reject_reasons'][r[:60]] = stats['reject_reasons'].get(r[:60], 0) + 1

        # فلتر منفرد: entry_zone
        checks = gate_result.get('checks', [])
        _had_data = True
        for c in checks:
            if c['name'] == 'entry_zone':
                if c['passed']:
                    stats['entry_zone_pass'] += 1
                    if is_win:
                        stats['entry_zone_pass_wins'] += 1
                    if 'بيانات غير كافية' in c.get('reason', '') or 'مدى غير صالح' in c.get('reason', ''):
                        _had_data = False
                else:
                    stats['entry_zone_reject'] += 1
                    if is_win:
                        stats['entry_zone_reject_wins'] += 1
            if c['name'] == 'stock_phase':
                if c['passed']:
                    stats['phase_pass'] += 1
                    if is_win:
                        stats['phase_pass_wins'] += 1
                else:
                    stats['phase_reject'] += 1
                    if is_win:
                        stats['phase_reject_wins'] += 1
            if c['name'] == 'rsi_zone':
                if c['passed']:
                    stats['rsi_pass'] += 1
                    if is_win:
                        stats['rsi_pass_wins'] += 1
                    if c.get('sweet_spot'):
                        stats['sweet_spot_rsi'] += 1
                        if is_win:
                            stats['sweet_spot_rsi_wins'] += 1
                else:
                    stats['rsi_reject'] += 1
                    if is_win:
                        stats['rsi_reject_wins'] += 1

        if not _had_data:
            stats['no_data'] += 1
            if is_win:
                stats['no_data_wins'] += 1

        # soft signals
        soft = gate_result.get('soft_signals', {})
        poc = soft.get('poc_distance', {})
        if poc.get('boost', 0) >= 0.3:
            stats['poc_boost'] += 1
            if is_win:
                stats['poc_boost_wins'] += 1
        accum = soft.get('accumulation', {})
        if accum.get('boost', 0) >= 0.15:
            stats['accum_boost'] += 1
            if is_win:
                stats['accum_boost_wins'] += 1

        # context boost high
        if context_boost >= 0.4:
            stats['boost_high'] += 1
            if is_win:
                stats['boost_high_wins'] += 1

    # ─── التقرير ──────────────────────────────────────────────────────────
    print('\n' + '=' * 70)
    print('RESULTS')
    print('=' * 70)

    total = stats['total']
    all_wr = (stats['all_wins'] / total * 100) if total > 0 else 0
    pass_wr = (stats['pass_wins'] / stats['pass_new_gate'] * 100) if stats['pass_new_gate'] > 0 else 0
    reject_wr = (stats['reject_wins'] / stats['reject_new_gate'] * 100) if stats['reject_new_gate'] > 0 else 0

    print(f'\n📊 TOTAL: {total} predictions | ALL WR = {all_wr:.1f}%')
    print(f'   PASS new gate: {stats["pass_new_gate"]} ({stats["pass_new_gate"]/total*100:.1f}%) | WR = {pass_wr:.1f}%  {"✅" if pass_wr > all_wr else "❌"}')
    print(f'   REJECT:        {stats["reject_new_gate"]} ({stats["reject_new_gate"]/total*100:.1f}%) | WR = {reject_wr:.1f}%  {"✅ GOOD (low)" if reject_wr < all_wr else "⚠️"}')

    improvement = pass_wr - all_wr
    print(f'\n🎯 IMPROVEMENT: WR {all_wr:.1f}% → {pass_wr:.1f}% ({improvement:+.1f}%)')

    # فلتر منفرد
    print('\n── INDIVIDUAL FILTER PERFORMANCE ──')
    print(f'   {"Filter":<32} {"PASS":>6} {"WR":>7} {"REJECT":>7} {"WR":>7} {"Δpass":>7}')
    for name, p, pw, r, rw in [
        ('Entry Zone (position<60%)', stats['entry_zone_pass'], stats['entry_zone_pass_wins'],
         stats['entry_zone_reject'], stats['entry_zone_reject_wins']),
        ('Stock Phase (not CORRECTION)', stats['phase_pass'], stats['phase_pass_wins'],
         stats['phase_reject'], stats['phase_reject_wins']),
        ('RSI Zone (<60)', stats['rsi_pass'], stats['rsi_pass_wins'],
         stats['rsi_reject'], stats['rsi_reject_wins']),
    ]:
        pwr = (pw / p * 100) if p > 0 else 0
        rwr = (rw / r * 100) if r > 0 else 0
        delta = pwr - all_wr
        marker = '✅' if delta > 0 else ('⚠️' if delta > -5 else '❌')
        rej_marker = '✅' if (rwr < all_wr and r > 5) else '  '
        print(f'   {name:<32} {p:>6} {pwr:>6.1f}% {r:>7} {rwr:>6.1f}% {delta:>+6.1f}% {marker} {rej_marker}')

    # Sweet spots
    print('\n── SWEET SPOT VALIDATION ──')
    for name, p, w in [
        ('RSI sweet spot (30-50)', stats['sweet_spot_rsi'], stats['sweet_spot_rsi_wins']),
        ('POC boost (10-20% below)', stats['poc_boost'], stats['poc_boost_wins']),
        ('Accum boost (1.2+)', stats['accum_boost'], stats['accum_boost_wins']),
        ('High context boost (≥0.4)', stats['boost_high'], stats['boost_high_wins']),
    ]:
        wr = (w / p * 100) if p > 0 else 0
        delta = wr - all_wr
        marker = '✅' if delta > 5 else ('⚠️' if delta > 0 else '❌')
        print(f'   {name:<32} {p:>5} trades | WR={wr:>5.1f}% (Δ{delta:>+5.1f}%) {marker}')

    # No data
    if stats['no_data'] > 0:
        nd_wr = (stats['no_data_wins'] / stats['no_data'] * 100) if stats['no_data'] > 0 else 0
        print(f'\n   ⚠️ No price history data: {stats["no_data"]} trades | WR={nd_wr:.1f}% (passed by default)')

    # أسباب الرفض
    print('\n── TOP REJECT REASONS ──')
    sorted_reasons = sorted(stats['reject_reasons'].items(), key=lambda x: -x[1])[:8]
    for reason, cnt in sorted_reasons:
        print(f'   {cnt}× {reason}')

    # عينات
    print('\n── SAMPLE PASSES ──')
    for s in sample_pass:
        print(f'   {s[0]} @ {str(s[1])[:10]} → return={s[2]:.1f}%')

    print('\n── SAMPLE REJECTS ──')
    for s in sample_reject:
        print(f'   {s[0]} @ {str(s[1])[:10]} → return={s[2]:.1f}% | reasons: {s[3]}')

    print('\n' + '=' * 70)
    if improvement > 2:
        print(f'✅✅ SUCCESS: الفلاتر رفعت WR بـ {improvement:+.1f}% — شغالة صح!')
    elif improvement > 0:
        print(f'✅ OK: تحسّن طفيف {improvement:+.1f}% — الفلاتر بتساعد')
    else:
        print(f'⚠️ WARNING: ما فيش تحسّن ({improvement:+.1f}%) — راجع الـ thresholds')
    print('=' * 70)


if __name__ == '__main__':
    run_backtest()

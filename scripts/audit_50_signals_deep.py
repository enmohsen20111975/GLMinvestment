#!/usr/bin/env python3
"""
audit_50_signals_deep.py — TITAN-HEAVY-PUMP-2-AUDIT-50
======================================================

الفحص الآني الجذري لـ 50 إشارة من Documentation/AUDIT_50_SIGNALS_SAMPLE.md
ضد الأسعار الفعلية في stock_daily_prices (db/stocks.db).

المنهجية (مختلفة عن verify_all_radar_signals.py):
- قراءة فقط (file:db/stocks.db?mode=ro) — لا تعديل لأي جدول.
- لكل إشارة: نقرأ الأسعار بعد signal_date (حتى 30 يوم تداول).
- نقطة بوقت: chronological day-by-day، "من يضرب أولًا يفوز".
- قاعدة محافظة صارمة (conservative same-day rule):
    لو ضرب الهدف (+5%) والوقف (-5%) في نفس اليوم
    → verified_loss (لا نفترض تنفيذًا favourable دون intraday tick data).
- خصم 0.40% عمولات وانزلاق من العائد المحقق.

CRITICAL (Rule 27 — NO-FAKE-DATA):
- نستخدم فقط stock_daily_prices من db/stocks.db.
- لو لا توجد أسعار بعد signal_date → audited_status="undetermined".
- لا نلجأ إلى بيانات الـ markdown المضمّنة داخل الجداول (لأن المصدر
  الرسمي الوحيد المعتمد هو stock_daily_prices في db/stocks.db).

OUTPUT:
- db/reports/forensic_sample_audit_results.json (idempotent — نفس الناتج
  كل تشغيل لأن المدخلات (markdown + DB) لا تتغير).
- stdout summary + sanity checks.

USAGE:
    python3 scripts/audit_50_signals_deep.py

EXIT CODES:
    0 — success
    1 — fatal error (DB missing, markdown missing, parse failure, etc.)
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# المسارات (Rule 17 — ROOT-CAUSE-FIRST): repo-relative.
# ─────────────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get('PROJECT_ROOT') or str(_SCRIPT_DIR.parent))
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
AUDIT_MD = PROJECT_ROOT / 'Documentation' / 'AUDIT_50_SIGNALS_SAMPLE.md'
REPORT_DIR = PROJECT_ROOT / 'db' / 'reports'
REPORT_JSON = REPORT_DIR / 'forensic_sample_audit_results.json'

# ─────────────────────────────────────────────────────────────────────────────
# المنهجية (Methodology constants) — مطابقة لتكليف TITAN-HEAVY-PUMP-2-AUDIT-50.
# ─────────────────────────────────────────────────────────────────────────────
TARGET_PCT = 5.0                       # +5% target
STOP_PCT = -5.0                        # -5% stop-loss
COMMISSION_SLIPPAGE_PCT = 0.40         # 0.40% commission + slippage
FETCH_DAYS = 30                        # نافذة الفحص: 30 يوم تداول بعد signal_date.

# ─────────────────────────────────────────────────────────────────────────────
# 1) قراءة الـ 50 إشارة من AUDIT_50_SIGNALS_SAMPLE.md
# ─────────────────────────────────────────────────────────────────────────────
# نمط الصف في جدول الـ markdown (أول 52 سطر):
#   | 1 | **ACAP** | 2026-10-11 | 8.05 | 8.45 | 7.65 | `verified_loss` | — |
# الأعمدة: # | Ticker | signal_date | entry_price | target (+5%) | stop (-5%)
#          | recorded_status | win/exit_date
_ROW_PATTERN = re.compile(
    r'^\|\s*(\d+)\s*\|\s*\*\*([A-Z0-9]+)\*\*\s*\|\s*'
    r'(\d{4}-\d{2}-\d{2})\s*\|\s*'
    r'([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*'
    r'`?(\w+)`?\s*\|\s*([^|]+?)\s*\|?\s*$'
)


def parse_signals_from_markdown(md_path: Path) -> List[dict]:
    """
    استخراج الـ 50 إشارة من جدول الـ markdown في أول 52 سطر.

    يعيد قائمة dicts بـ: index, ticker, signal_date, entry_price,
    target_price, stop_price, recorded_status, win_exit_date.

    ملاحظة: بعض الإشارات مكررة (مثل ACAP تظهر مرتين) — نُبقيها كما هي
    (50 إشارة بالضبط) لأن التكليف صريح في ذلك.
    """
    if not md_path.exists():
        raise FileNotFoundError(f'AUDIT markdown not found: {md_path}')

    text = md_path.read_text(encoding='utf-8')
    lines = text.splitlines()

    signals: List[dict] = []
    for line in lines:
        m = _ROW_PATTERN.match(line.strip())
        if not m:
            continue
        idx = int(m.group(1))
        ticker = m.group(2)
        signal_date = m.group(3)
        entry_price = float(m.group(4))
        target_price = float(m.group(5))
        stop_price = float(m.group(6))
        recorded_status = m.group(7)
        win_exit_raw = m.group(8).strip()
        # تنظيف win_exit_date — قد يكون "—" أو تاريخ فارغ.
        win_exit_date: Optional[str] = None
        if win_exit_raw and win_exit_raw != '—' and win_exit_raw != '-':
            win_exit_date = win_exit_raw

        signals.append({
            'index': idx,
            'ticker': ticker,
            'signal_date': signal_date,
            'entry_price': entry_price,
            'target_price': target_price,
            'stop_price': stop_price,
            'recorded_status': recorded_status,
            'win_exit_date': win_exit_date,
        })

    return signals


# ─────────────────────────────────────────────────────────────────────────────
# 2) قراءة الأسعار من stock_daily_prices (read-only)
# ─────────────────────────────────────────────────────────────────────────────
def fetch_prices_after(conn: sqlite3.Connection, ticker: str, signal_date: str,
                       limit: int = FETCH_DAYS) -> List[Tuple[str, float, float, float, float]]:
    """
    قراءة ما يصل إلى `limit` يوم تداول AFTER signal_date (strictly after)
    من جدول stock_daily_prices.

    Returns: list of (price_date, open, high, low, close) مرتبة تصاعديًا حسب التاريخ.

    DATA-QUALITY FIX (مطابق لـ verify_all_radar_signals.py):
    - high/low NULL أو 0 → نستخدم close.
    - لو high < close أو low > close أو low > high (OHLC مستحيل) → نستخدم close
      لكل من high و low (conservative — يعامل اليوم كـ flat close). هذا آمن Rule 27
      لأن close هو القيمة الموثوقة.
    """
    rows = conn.execute(
        """
        SELECT price_date AS d, open AS o, high AS h, low AS l, close AS c
        FROM stock_daily_prices
        WHERE ticker = ?
          AND price_date > ?
          AND close IS NOT NULL
          AND close > 0
        ORDER BY price_date ASC
        LIMIT ?
        """,
        (ticker, signal_date, limit),
    ).fetchall()

    out: List[Tuple[str, float, float, float, float]] = []
    for r in rows:
        close = float(r['c']) if r['c'] is not None else 0.0
        if close <= 0:
            continue
        high = float(r['h']) if r['h'] is not None and r['h'] > 0 else close
        low = float(r['l']) if r['l'] is not None and r['l'] > 0 else close
        openp = float(r['o']) if r['o'] is not None and r['o'] > 0 else close
        # DATA-QUALITY FIX: OHLC مستحيل → استخدم close لكل القمم/القيعان.
        if high < close or low > close or low > high:
            high = close
            low = close
        out.append((str(r['d']), openp, high, low, close))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 3) تطبيق القواعد المحافظة (conservative same-day rule)
# ─────────────────────────────────────────────────────────────────────────────
def audit_one_signal(signal: dict, prices: List[Tuple[str, float, float, float, float]]) -> dict:
    """
    تطبيق القواعد المحافظة على إشارة واحدة.

    القواعد (chronological + conservative same-day):
    - نمرّ على الأيام بعد signal_date تصاعديًا.
    - في كل يوم:
        (a) target_hit = high >= target_price
        (b) stop_hit   = low  <= stop_price
      - لو (a) و (b) في نفس اليوم → verified_loss (قاعدة محافظة صارمة).
      - لو (a) فقط → verified_win.
      - لو (b) فقط → verified_loss.
      - لو لا (a) ولا (b) → نكمل لليوم التالي.
    - لو لم يضرب أي منهما خلال نافذة الفحص → undetermined (لا يمكن الحسم).

    Returns: dict يحوي:
        audited_status: "verified_win" | "verified_loss" | "undetermined"
        first_hit_date: str | None
        first_hit_type: "target" | "stop" | "same_day" | "none" | None
        gross_return_pct: float | None
        net_return_pct: float | None  (بعد خصم 0.40%)
        days_to_resolved: int | None
        audit_note: str
        prices_found: int
    """
    entry = signal['entry_price']
    target = signal['target_price']
    stop = signal['stop_price']

    result = {
        'audited_status': 'undetermined',
        'first_hit_date': None,
        'first_hit_type': None,
        'gross_return_pct': None,
        'net_return_pct': None,
        'days_to_resolved': None,
        'audit_note': '',
        'prices_found': len(prices),
    }

    # حماية: لو entry/target/stop غير صالح.
    if entry <= 0 or target <= 0 or stop <= 0:
        result['audit_note'] = (
            f'entry/target/stop غير صالح (entry={entry}, target={target}, stop={stop}).'
        )
        return result

    # حماية: لا توجد أسعار بعد signal_date → undetermined.
    if not prices:
        result['audit_note'] = (
            f'لا توجد أسعار في stock_daily_prices بعد signal_date '
            f'({signal["signal_date"]}). لا يمكن التقييم.'
        )
        return result

    # ── التقييم الزمني (chronological) ──
    for i, (d, _open, high, low, _close) in enumerate(prices, start=1):
        target_hit = high >= target
        stop_hit = low <= stop

        if target_hit and stop_hit:
            # القاعدة المحافظة الصارمة: لو ضرب الهدف والوقف في نفس اليوم
            # → verified_loss (لا نفترض favourable execution).
            result['audited_status'] = 'verified_loss'
            result['first_hit_date'] = d
            result['first_hit_type'] = 'same_day'
            result['days_to_resolved'] = i
            result['gross_return_pct'] = round(STOP_PCT, 4)             # -5.0
            result['net_return_pct'] = round(STOP_PCT - COMMISSION_SLIPPAGE_PCT, 4)  # -5.40
            result['audit_note'] = (
                f'target+stop both hit on {d} (day {i}) — conservative rule → verified_loss. '
                f'high={high:.4f} >= target={target:.4f} AND low={low:.4f} <= stop={stop:.4f}.'
            )
            return result

        if target_hit:
            # الهدف فقط → verified_win.
            result['audited_status'] = 'verified_win'
            result['first_hit_date'] = d
            result['first_hit_type'] = 'target'
            result['days_to_resolved'] = i
            result['gross_return_pct'] = round(TARGET_PCT, 4)             # +5.0
            result['net_return_pct'] = round(TARGET_PCT - COMMISSION_SLIPPAGE_PCT, 4)  # +4.60
            result['audit_note'] = (
                f'target hit on {d} (day {i}) — high={high:.4f} >= target={target:.4f}. '
                f'stop not yet hit (low={low:.4f} > stop={stop:.4f}).'
            )
            return result

        if stop_hit:
            # الوقف فقط → verified_loss.
            result['audited_status'] = 'verified_loss'
            result['first_hit_date'] = d
            result['first_hit_type'] = 'stop'
            result['days_to_resolved'] = i
            result['gross_return_pct'] = round(STOP_PCT, 4)             # -5.0
            result['net_return_pct'] = round(STOP_PCT - COMMISSION_SLIPPAGE_PCT, 4)  # -5.40
            result['audit_note'] = (
                f'stop hit on {d} (day {i}) — low={low:.4f} <= stop={stop:.4f}. '
                f'target not yet hit (high={high:.4f} < target={target:.4f}).'
            )
            return result

    # لو لم يضرب أي منهما خلال نافذة الفحص → undetermined.
    result['audited_status'] = 'undetermined'
    result['first_hit_type'] = 'none'
    result['audit_note'] = (
        f'neither target ({target:.4f}) nor stop ({stop:.4f}) hit within '
        f'{len(prices)} trading days after signal_date.'
    )
    return result


# ─────────────────────────────────────────────────────────────────────────────
# 4) تصنيف المقارنة بين recorded vs audited
# ─────────────────────────────────────────────────────────────────────────────
def classify_match(recorded_status: str, audited_status: str) -> str:
    """
    صنف المقارنة بين النتيجة المسجلة والنتيجة المُدقّقة:
    - "match": النتيجة المسجلة = النتيجة المُدقّقة (both verified_win/loss).
    - "changed": النتيجة تغيرت (recorded=verified_loss لكن audit=verified_win
                 أو العكس).
    - "undetermined": audit لم يستطع الحسم (no prices / no hit)
                     أو recorded_status ليست verified_win/loss.
    """
    definitive = {'verified_win', 'verified_loss'}
    if audited_status not in definitive:
        return 'undetermined'
    if recorded_status not in definitive:
        return 'undetermined'
    if audited_status == recorded_status:
        return 'match'
    return 'changed'


# ─────────────────────────────────────────────────────────────────────────────
# 5) Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    print('=== audit_50_signals_deep.py [TITAN-HEAVY-PUMP-2-AUDIT-50] ===')
    print(f'PROJECT_ROOT: {PROJECT_ROOT}')
    print(f'STOCKS_DB:    {STOCKS_DB}')
    print(f'AUDIT_MD:     {AUDIT_MD}')
    print(f'REPORT_JSON:  {REPORT_JSON}')
    print()

    if not STOCKS_DB.exists():
        print(f'FATAL: stocks.db not found at {STOCKS_DB}', file=sys.stderr)
        return 1
    if not AUDIT_MD.exists():
        print(f'FATAL: AUDIT_50_SIGNALS_SAMPLE.md not found at {AUDIT_MD}',
              file=sys.stderr)
        return 1

    # 1) قراءة الـ 50 إشارة من markdown.
    signals = parse_signals_from_markdown(AUDIT_MD)
    print(f'[parse] استخرجت {len(signals)} إشارة من markdown.')
    if len(signals) != 50:
        print(f'WARNING: expected 50 signals, got {len(signals)}.', file=sys.stderr)
    print()

    # 2) فحص كل إشارة ضد stock_daily_prices.
    audited_signals: List[dict] = []
    latest_db_date: Optional[str] = None
    conn = sqlite3.connect(f'file:{STOCKS_DB}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # Precheck: latest price_date في DB — للشفافية.
        latest_db_date = conn.execute(
            'SELECT MAX(price_date) FROM stock_daily_prices'
        ).fetchone()[0]
        print(f'[precheck] latest price_date in stock_daily_prices: {latest_db_date}')
        # Precheck: عدد الصفوف الكلي.
        total_rows = conn.execute(
            'SELECT COUNT(*) FROM stock_daily_prices'
        ).fetchone()[0]
        print(f'[precheck] total rows in stock_daily_prices: {total_rows:,}')
        print()

        for sig in signals:
            prices = fetch_prices_after(conn, sig['ticker'], sig['signal_date'])
            audit = audit_one_signal(sig, prices)
            match_class = classify_match(sig['recorded_status'], audit['audited_status'])

            audited_signals.append({
                'index': sig['index'],
                'ticker': sig['ticker'],
                'signal_date': sig['signal_date'],
                'entry_price': sig['entry_price'],
                'target_price': sig['target_price'],
                'stop_price': sig['stop_price'],
                'recorded_status': sig['recorded_status'],
                'audited_status': audit['audited_status'],
                'match': match_class == 'match',
                'classification': match_class,
                'first_hit_date': audit['first_hit_date'],
                'first_hit_type': audit['first_hit_type'],
                'gross_return_pct': audit['gross_return_pct'],
                'net_return_pct': audit['net_return_pct'],
                'days_to_resolved': audit['days_to_resolved'],
                'prices_found_in_db': audit['prices_found'],
                'audit_note': audit['audit_note'],
            })
    finally:
        conn.close()

    # 3) حساب الإحصائيات.
    total = len(audited_signals)
    matched = sum(1 for s in audited_signals if s['classification'] == 'match')
    changed = sum(1 for s in audited_signals if s['classification'] == 'changed')
    undetermined = sum(1 for s in audited_signals if s['classification'] == 'undetermined')

    recorded_win = sum(1 for s in audited_signals if s['recorded_status'] == 'verified_win')
    recorded_loss = sum(1 for s in audited_signals if s['recorded_status'] == 'verified_loss')
    audited_win = sum(1 for s in audited_signals if s['audited_status'] == 'verified_win')
    audited_loss = sum(1 for s in audited_signals if s['audited_status'] == 'verified_loss')

    recorded_win_rate = (recorded_win / total * 100) if total else 0.0
    audited_win_rate = (audited_win / total * 100) if total else 0.0

    # net_win_rate_after_commission: نسبة verified_win من الإجمالي بعد تطبيق
    # المنهجية المحافظة + خصم 0.40%. الخصم 0.40% لا يقلب التصنيف (لأن الفوز
    # عند +5% يبقى فوزًا عند +4.60%، والخسارة عند -5% تبقى خسارة عند -5.40%)،
    # إذن net_win_rate = audited_win / total. لكن قد تختلف عن recorded_win_rate
    # لأن القاعدة المحافظة قد تقلب بعض verified_win → verified_loss.
    net_win_rate = (audited_win / total * 100) if total else 0.0

    # المتوسطات — فقط للإشارات التي تم الحسم فيها (لديها gross/net return).
    gross_returns = [s['gross_return_pct'] for s in audited_signals
                     if s['gross_return_pct'] is not None]
    net_returns = [s['net_return_pct'] for s in audited_signals
                   if s['net_return_pct'] is not None]
    avg_gross = (sum(gross_returns) / len(gross_returns)) if gross_returns else 0.0
    avg_net = (sum(net_returns) / len(net_returns)) if net_returns else 0.0

    summary = {
        'total_signals': total,
        'matched': matched,
        'changed': changed,
        'undetermined': undetermined,
        'recorded_win_count': recorded_win,
        'audited_win_count': audited_win,
        'recorded_loss_count': recorded_loss,
        'audited_loss_count': audited_loss,
        'recorded_win_rate_pct': round(recorded_win_rate, 2),
        'audited_win_rate_pct': round(audited_win_rate, 2),
        'net_win_rate_after_commission_pct': round(net_win_rate, 2),
        'avg_gross_return_pct': round(avg_gross, 4),
        'avg_net_return_pct': round(avg_net, 4),
    }

    # 4) بناء الـ JSON الكامل.
    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': 'Documentation/AUDIT_50_SIGNALS_SAMPLE.md',
        'stocks_db': str(STOCKS_DB),
        'latest_db_price_date': latest_db_date,
        'methodology': {
            'evaluation': 'chronological day-by-day with conservative same-day rule',
            'same_day_target_and_stop': 'verified_loss (conservative)',
            'commission_slippage_pct': COMMISSION_SLIPPAGE_PCT,
            'target_pct': TARGET_PCT,
            'stop_pct': STOP_PCT,
            'fetch_days': FETCH_DAYS,
            'data_source': 'stock_daily_prices (db/stocks.db, read-only)',
            'rule_27_no_fake_data': True,
        },
        'summary': summary,
        'signals': audited_signals,
    }

    # 5) كتابة JSON (idempotent — نفس المدخلات = نفس الناتج).
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[output] wrote: {REPORT_JSON}')
    print()

    # 6) طباعة الملخص على stdout.
    print('=== FORENSIC AUDIT: 50 SIGNALS DEEP ===')
    print(f'Total signals: {total}')
    print(f'Matched (recorded = audited): {matched} ({matched/total*100:.1f}%)')
    print(f'Changed: {changed} ({changed/total*100:.1f}%)')
    print(f'Undetermined: {undetermined} ({undetermined/total*100:.1f}%)')
    print()
    print(f'Recorded win rate: {recorded_win_rate:.2f}% ({recorded_win}/{total})')
    print(f'Audited win rate:  {audited_win_rate:.2f}% ({audited_win}/{total})')
    print(f'Net win rate (after {COMMISSION_SLIPPAGE_PCT}% commission): {net_win_rate:.2f}%')
    print()
    print(f'Avg gross return: {avg_gross:.4f}%')
    print(f'Avg net return:   {avg_net:.4f}%')
    print()

    changed_list = [s for s in audited_signals if s['classification'] == 'changed']
    print('=== CHANGED SIGNALS (sample) ===')
    if not changed_list:
        print('  (no changed signals)')
    for s in changed_list[:10]:
        print(f'  #{s["index"]} {s["ticker"]} {s["signal_date"]}: '
              f'recorded={s["recorded_status"]} -> audited={s["audited_status"]} (changed!)')
    print()

    # 7) Sanity checks (مطابقة لتكليف TITAN-HEAVY-PUMP-2-AUDIT-50).
    print('=== SANITY CHECKS ===')
    sanity_ok = True

    # 7a) total_signals == 50.
    if total == 50:
        print(f'  [OK] total_signals = 50')
    else:
        print(f'  [FAIL] total_signals = {total} (expected 50)')
        sanity_ok = False

    # 7b) matched + changed + undetermined == 50.
    if matched + changed + undetermined == total:
        print(f'  [OK] matched({matched}) + changed({changed}) + undetermined({undetermined}) = {total}')
    else:
        print(f'  [FAIL] sum = {matched + changed + undetermined} != {total}')
        sanity_ok = False

    # 7c) net_win_rate <= recorded_win_rate (الخصم 0.40% + القاعدة المحافظة
    #     لا يجب أن ترفع الـ win rate فوق المسجل).
    if net_win_rate <= recorded_win_rate or recorded_win_rate == 0:
        print(f'  [OK] net_win_rate ({net_win_rate:.2f}%) <= recorded_win_rate ({recorded_win_rate:.2f}%)')
    else:
        print(f'  [FAIL] net_win_rate ({net_win_rate:.2f}%) > recorded_win_rate ({recorded_win_rate:.2f}%)')
        sanity_ok = False

    # 7d) data availability check — نطبع WARNING لو كل الإشارات undetermined
    #     بسبب نقص بيانات الأسعار.
    if undetermined == total:
        print(f'  [WARNING] كل الإشارات ({total}) undetermined — راجع latest_db_price_date '
              f'({latest_db_date}) و signal_date للإشارات. قد لا توجد أسعار بعد signal_date.')
    print()

    if not sanity_ok:
        print('SANITY CHECKS FAILED — راجع النتائج أعلاه.', file=sys.stderr)
        return 1

    print('All sanity checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

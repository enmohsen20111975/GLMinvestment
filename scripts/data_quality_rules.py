#!/usr/bin/env python3
"""
data_quality_rules.py — قواعد جودة البيانات الموحّدة (CLEAN / TOXIC / PENDING)
=================================================================================

WHY
---
الإنتاج كان ملوّث بصفوف كارثية:
  - AGIN:  entry=0.002, target=−9.696, exit≈46.5  → return ملايين %
  - UNFO:  entry=0.31,  exit≈72                  → ±23000 %
  - target سالب، entry تافه، stop≥entry، R:R≤0 …

ده بـ يخرب أي قياس (متوسط عائد، نسبة نجاح، retrospective، Phase-1a).
الوحدة دي بـ توحّد:

  1) WRITE-TIME REJECTION (W1–W9) — قواعد الرفض وقت الكتابة.
     بـ تتس_called من `record_prediction` قبل INSERT. لو أي قاعدة اشتعلت
     → لا حفظ + log `[PRED_REJECT]`. ده يمنع إعادة التسمم من المصدر.

  2) CLEAN / TOXIC / PENDING — تصنيف للقياس التاريخي.
     - clean  = مقفول + entry>0.05 + target>0 + stop>0 + |ret|≤50 + signal معروف
     - toxic  = عكس ذلك، أو exit/entry يشبه سبليت (>20× أو <0.05)
     - pending = لسه مفتوح (outcome_date IS NULL)

  3) compute_return() — معادلة العائد الصحيحة BUY/SELL.

القواعد دي هي الـ source of truth الوحيد لكل الـ scripts (purge، phase1a،
التقارير، الـ UI). بحيث أي قياس = "clean فقط".

Usage
-----
    from data_quality_rules import (
        validate_write, classify_quality, compute_return,
        CLEAN, TOXIC, PENDING,
    )

    # Write-time (record_prediction):
    ok, code, reason = validate_write(signal, entry, target, stop)
    if not ok:
        print(f"[PRED_REJECT] ticker={t} {code} {reason}")
        return None

    # Historical classification (purge / reports):
    quality = classify_quality(row_dict)
"""
import os
import sqlite3
from typing import Dict, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────────
# Labels
# ──────────────────────────────────────────────────────────────────────────────
CLEAN = 'clean'
TOXIC = 'toxic'
PENDING = 'pending'

# ──────────────────────────────────────────────────────────────────────────────
# Thresholds (موحّدة — لو غيرتها هنا، بـ يتغير كل اللي بيعتمد عليها)
# ──────────────────────────────────────────────────────────────────────────────
MIN_ENTRY_PRICE = 0.05        # W2: entry < ده = تافه (split/penny artifact)
MAX_REASONABLE_RETURN = 50.0  # CLEAN: |actual_return| ≤ ده (%) — فوقه = toxic/split
TARGET_DEV_MAX = 0.40         # W9: target أبعد من 40% من entry = غير معقول
STOP_DEV_MAX = 0.25           # W9: stop أبعد من 25% من entry = غير معقول
SPLIT_RATIO_HIGH = 20.0       # TOXIC: exit/entry > 20× = يشبه سبليت
SPLIT_RATIO_LOW = 0.05        # TOXIC: exit/entry < 0.05 = يشبه سبليت معكوس

# Signals المعروفة (كل اللي غير ده = مش معروف → مش clean)
KNOWN_BUY_SIGNALS = ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
KNOWN_SELL_SIGNALS = ('SELL', 'REDUCE')
KNOWN_HOLD_SIGNALS = ('HOLD',)
KNOWN_SIGNALS = KNOWN_BUY_SIGNALS + KNOWN_SELL_SIGNALS + KNOWN_HOLD_SIGNALS


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _f(v, default=0.0) -> float:
    """Safe float — None/''/garbage → default."""
    try:
        if v is None:
            return default
        f = float(v)
        return f
    except (TypeError, ValueError):
        return default


def normalize_signal(signal) -> str:
    """Upper + strip. '' لو None."""
    if not signal:
        return ''
    return str(signal).strip().upper()


def is_buy_signal(signal) -> bool:
    return normalize_signal(signal) in KNOWN_BUY_SIGNALS


def is_sell_signal(signal) -> bool:
    return normalize_signal(signal) in KNOWN_SELL_SIGNALS


def is_known_signal(signal) -> bool:
    return normalize_signal(signal) in KNOWN_SIGNALS


def normalize_ticker(ticker) -> str:
    """Upper + strip. عشان مطابقة الشموع (ticker case mismatch = Eligible=0)."""
    if not ticker:
        return ''
    return str(ticker).strip().upper()


def ticker_variants(ticker) -> list:
    """كل أشكال الـ ticker اللي ممكن تكون في price_history.

    الإنتاج عنده تكرار بـ suffixes مختلفة ('.CA', '_E', ISIN، …). ده بـ يولّد
    candidates عشان الـ purge script يجربهم كلهم لما بـ يعمل backfill الشموع.
    """
    base = normalize_ticker(ticker)
    if not base:
        return []
    variants = [base]
    # strip common suffixes
    for suf in ('.CA', '.CAIRO', '_E', '-E', '.EG', '.EX'):
        if base.endswith(suf):
            variants.append(base[:-len(suf)])
    # strip leading prefixes
    for pre in ('EGX', 'EGS'):
        if base.startswith(pre) and len(base) > len(pre):
            variants.append(base[len(pre):])
    # dedup preserving order
    seen = set()
    out = []
    for v in variants:
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def compute_return(entry_price: float, exit_price: float, signal: str) -> float:
    """العائد الصحيح حسب الاتجاه.

    BUY/ACCUMULATE:  (exit - entry) / entry * 100
    SELL/REDUCE:     (entry - exit) / entry * 100
    غير ذلك:          BUY formula (fallback)

    Returns 0.0 لو entry≤0 (مش نكتب NaN في DB).
    """
    entry = _f(entry_price)
    exit_ = _f(exit_price)
    if entry <= 0:
        return 0.0
    if is_sell_signal(signal):
        return (entry - exit_) / entry * 100
    # BUY / default
    return (exit_ - entry) / entry * 100


# ──────────────────────────────────────────────────────────────────────────────
# WRITE-TIME REJECTION (W1–W9)
# ──────────────────────────────────────────────────────────────────────────────
# دي الـ hard gate وقت الكتابة. بـ تتس_called من record_prediction قبل INSERT.
# لو أي واحدة اشتعلت → لا حفظ + log [PRED_REJECT].
# الـ maestro guards (1ب/1ج/ATR) بـ تعدّل target/stop قبل ما يوصلوا هنا،
# فالـ W rules دي = خط الدفاع الأخير (defense in depth) لو أي caller bypass.
# ──────────────────────────────────────────────────────────────────────────────

def validate_write(
    signal: str,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    *,
    allow_extreme: bool = False,
) -> Tuple[bool, str, str]:
    """تحقّق من قواعد الكتابة W1–W9.

    Args:
        signal: BUY/SELL/...
        entry_price, target_price, stop_loss
        allow_extreme: لو True، W9 (الانحراف غير المعقول) بـ يتخطّى.
            للـ manual/admin inserts الموثّقة بس. الافتراضي False.

    Returns:
        (ok, rule_code, reason)
        ok=True  → اكتب (كل القواعد عدت)
        ok=False → ارفض + rule_code (زي 'W2') + reason
    """
    sig = normalize_signal(signal)
    entry = _f(entry_price)
    target = _f(target_price) if target_price is not None else 0.0
    stop = _f(stop_loss) if stop_loss is not None else 0.0

    # W1: entry ≤ 0
    if entry <= 0:
        return False, 'W1', f'entry_price={entry} ≤ 0'

    # W2: entry < 0.05 (trivial / penny / split artifact)
    if entry < MIN_ENTRY_PRICE:
        return False, 'W2', f'entry_price={entry} < {MIN_ENTRY_PRICE} (trivial)'

    # W3: target ≤ 0
    if target <= 0:
        return False, 'W3', f'target_price={target} ≤ 0'

    # W4: stop ≤ 0
    if stop <= 0:
        return False, 'W4', f'stop_loss={stop} ≤ 0'

    # W5 / W6: BUY direction — target must be > entry, stop must be < entry
    if is_buy_signal(sig) or sig in ('HOLD', ''):
        # Treat unknown/HOLD as BUY for direction validation (defensive)
        if target <= entry:
            return False, 'W5', f'BUY target={target} ≤ entry={entry} (inverted)'
        if stop >= entry:
            return False, 'W6', f'BUY stop={stop} ≥ entry={entry} (inverted)'

    # W7: SELL direction — target must be < entry, stop must be > entry
    if is_sell_signal(sig):
        if target >= entry:
            return False, 'W7', f'SELL target={target} ≥ entry={entry} (inverted)'
        if stop <= entry:
            return False, 'W7', f'SELL stop={stop} ≤ entry={entry} (inverted)'

    # W8: R:R ≤ 0 (risk ≤ 0 → meaningless)
    # BUY: risk = entry - stop, reward = target - entry
    # SELL: risk = stop - entry, reward = entry - target
    if is_sell_signal(sig):
        risk = stop - entry
        reward = entry - target
    else:
        risk = entry - stop
        reward = target - entry
    if risk <= 0:
        return False, 'W8', f'risk={risk} ≤ 0 (entry/stop inverted for {sig})'
    rr = reward / risk if risk > 0 else 0
    if rr <= 0:
        return False, 'W8', f'R:R={rr:.3f} ≤ 0 (reward≤0 for {sig})'

    # W9: انحراف غير معقول (target > 40% من entry أو stop > 25% من entry)
    # ده بـ يلتقط data corruption مش legitimate large targets.
    # الـ 1c guard (R:R≥1.5 + ATR stop ≤25%) بـ يخلّي الـ target ≤ 37.5% → ما
    # بـ يشتعلش على trades guarded. بـ يشتعل على legacy/unguarded absurd values.
    if not allow_extreme:
        target_dev = abs(target - entry) / entry
        stop_dev = abs(entry - stop) / entry
        if target_dev > TARGET_DEV_MAX:
            return False, 'W9', f'target deviation {target_dev:.2%} > {TARGET_DEV_MAX:.0%} (use allow_extreme=True for documented exceptions)'
        if stop_dev > STOP_DEV_MAX:
            return False, 'W9', f'stop deviation {stop_dev:.2%} > {STOP_DEV_MAX:.0%} (use allow_extreme=True for documented exceptions)'

    return True, 'OK', 'all write rules passed'


# ──────────────────────────────────────────────────────────────────────────────
# HISTORICAL CLASSIFICATION (CLEAN / TOXIC / PENDING)
# ──────────────────────────────────────────────────────────────────────────────

def _looks_like_split(entry_price: float, exit_price: float) -> bool:
    """هل exit/entry يشبه stock split؟
    > 20× أو < 0.05× → آكد سبليت/feed artifact → toxic.
    """
    entry = _f(entry_price)
    exit_ = _f(exit_price)
    if entry <= 0 or exit_ <= 0:
        return False
    ratio = exit_ / entry
    return ratio > SPLIT_RATIO_HIGH or ratio < SPLIT_RATIO_LOW


def classify_quality(row: Dict) -> str:
    """صنّف صف predictions إلى clean / toxic / pending.

    Args:
        row: dict-like مع مفاتيح:
            outcome_date, entry_price, target_price, stop_loss, signal,
            actual_return (اختياري — بـ يتعاد حسابه لو exit_price متاح),
            actual_exit_price / exit_price (اختياري)

    Returns:
        'clean' | 'toxic' | 'pending'
    """
    outcome_date = row.get('outcome_date')
    # pending = لسه مفتوح
    if not outcome_date:
        return PENDING

    entry = _f(row.get('entry_price'))
    target = _f(row.get('target_price'))
    stop = _f(row.get('stop_loss'))
    signal = row.get('signal') or row.get('signal_type') or ''
    actual_return = _f(row.get('actual_return'))

    # exit price: actual_exit_price (الأحدث) > exit_price (القديم)
    exit_price = _f(row.get('actual_exit_price')) or _f(row.get('exit_price'))

    # TOXIC checks (أي واحد بـ يكفي)
    # 1) split-like exit/entry ratio
    if exit_price > 0 and _looks_like_split(entry, exit_price):
        return TOXIC

    # 2) entry ≤ 0.05 أو target ≤ 0 أو stop ≤ 0
    if entry <= 0 or entry < MIN_ENTRY_PRICE:
        return TOXIC
    if target <= 0:
        return TOXIC
    if stop <= 0:
        return TOXIC

    # 3) |actual_return| > 50 بعد إعادة الحساب
    # prefer recomputed return لو exit_price متاح
    if exit_price > 0 and entry > 0:
        actual_return = compute_return(entry, exit_price, signal)
    if abs(actual_return) > MAX_REASONABLE_RETURN:
        return TOXIC

    # 4) signal مش معروف
    if not is_known_signal(signal):
        return TOXIC

    # كل شروط CLEAN اتجاوزت → clean
    return CLEAN


# ──────────────────────────────────────────────────────────────────────────────
# Quality flags (تفاصيل لماذا toxic) — للـ quality_flags column
# ──────────────────────────────────────────────────────────────────────────────

def compute_quality_flags(row: Dict) -> str:
    """سلسلة flags مفصولة بـ '|' تشرح ليه الصف toxic (أو '' لو clean).

    مثال: 'split_like|entry_trivial|return_extreme'
    """
    flags = []
    entry = _f(row.get('entry_price'))
    target = _f(row.get('target_price'))
    stop = _f(row.get('stop_loss'))
    signal = row.get('signal') or row.get('signal_type') or ''
    actual_return = _f(row.get('actual_return'))
    exit_price = _f(row.get('actual_exit_price')) or _f(row.get('exit_price'))

    if exit_price > 0 and entry > 0 and _looks_like_split(entry, exit_price):
        flags.append('split_like')
    if entry <= 0:
        flags.append('entry_zero')
    elif entry < MIN_ENTRY_PRICE:
        flags.append('entry_trivial')
    if target <= 0:
        flags.append('target_zero')
    if stop <= 0:
        flags.append('stop_zero')
    if exit_price > 0 and entry > 0:
        actual_return = compute_return(entry, exit_price, signal)
    if abs(actual_return) > MAX_REASONABLE_RETURN:
        flags.append(f'return_extreme({actual_return:.1f}%)')
    if not is_known_signal(signal):
        flags.append(f'signal_unknown({signal})')
    return '|'.join(flags)


# ──────────────────────────────────────────────────────────────────────────────
# SQL helpers (للـ purge script ولأي report)
# ──────────────────────────────────────────────────────────────────────────────

CLEAN_WHERE = (
    "outcome_date IS NOT NULL "
    "AND entry_price > {min_entry} "
    "AND target_price > 0 "
    "AND stop_loss > 0 "
    "AND ABS(actual_return) <= {max_ret} "
    "AND (signal IS NOT NULL AND TRIM(UPPER(signal)) IN ({signals}))"
).format(
    min_entry=MIN_ENTRY_PRICE,
    max_ret=MAX_REASONABLE_RETURN,
    signals=','.join(f"'{s}'" for s in KNOWN_SIGNALS),
)

# معادلة إعادة حساب العائد (SQL) — BUY/SELL
RECOMPUTE_RETURN_SQL = """
CASE
    WHEN entry_price IS NULL OR entry_price <= 0 THEN 0
    WHEN UPPER(TRIM(COALESCE(signal, signal_type, ''))) IN ('SELL', 'REDUCE')
         AND COALESCE(actual_exit_price, exit_price, 0) > 0
        THEN (entry_price - COALESCE(actual_exit_price, exit_price)) / entry_price * 100
    WHEN COALESCE(actual_exit_price, exit_price, 0) > 0
        THEN (COALESCE(actual_exit_price, exit_price) - entry_price) / entry_price * 100
    ELSE actual_return
END
"""


def ensure_quality_columns(conn: sqlite3.Connection, table: str = 'predictions'):
    """أضف أعمدة data_quality + quality_flags لو مش موجودين.

    Idempotent — آمن تـ runها كذا مرة.
    """
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table})")
    existing = {row[1].lower() for row in cur.fetchall()}

    migrations = [
        ('data_quality', 'TEXT'),
        ('quality_flags', 'TEXT'),
    ]
    added = []
    for col_name, col_def in migrations:
        if col_name.lower() not in existing:
            try:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")
                added.append(col_name)
            except Exception as e:
                # ممكن column اتضاف بالتوازي من process تاني → ignore
                if 'duplicate column' not in str(e).lower():
                    raise
    if added:
        conn.commit()
    return added


# ──────────────────────────────────────────────────────────────────────────────
# Smoke test (لما يـ run كـ script مباشر)
# ──────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=== data_quality_rules smoke test ===")
    # W rules
    cases = [
        ('BUY', 0.002, -9.696, 0.001, 'AGIN disaster'),
        ('BUY', 10.0, 10.3, 9.0, 'normal BUY'),
        ('BUY', 10.0, 9.5, 9.0, 'inverted target (W5)'),
        ('BUY', 10.0, 12.0, 11.0, 'inverted stop (W6)'),
        ('SELL', 10.0, 9.5, 10.5, 'normal SELL'),
        ('SELL', 10.0, 10.5, 9.5, 'inverted SELL (W7)'),
        ('BUY', 10.0, 60.0, 9.0, 'extreme target (W9)'),
        ('BUY', 10.0, 12.0, 5.0, 'extreme stop (W9)'),
        ('BUY', 10.0, 60.0, 9.0, 'extreme allowed', True),
    ]
    for c in cases:
        allow = c[5] if len(c) > 5 else False
        ok, code, reason = validate_write(c[0], c[1], c[2], c[3], allow_extreme=allow)
        tag = 'PASS' if ok else 'REJECT'
        print(f"  [{tag}] {c[4]:28s} {code}: {reason}")

    print("\n=== classify_quality ===")
    rows = [
        {'outcome_date': None, 'entry_price': 10, 'target_price': 12, 'stop_loss': 9, 'signal': 'BUY', 'actual_return': 0},
        {'outcome_date': '2026-01-01', 'entry_price': 10, 'target_price': 12, 'stop_loss': 9, 'signal': 'BUY', 'actual_exit_price': 11.5, 'actual_return': 15},
        {'outcome_date': '2026-01-01', 'entry_price': 0.002, 'target_price': -9.696, 'stop_loss': 0.001, 'signal': 'BUY', 'actual_exit_price': 46.5, 'actual_return': 0},
        {'outcome_date': '2026-01-01', 'entry_price': 10, 'target_price': 12, 'stop_loss': 9, 'signal': 'BUY', 'actual_exit_price': 72, 'actual_return': 620},
        {'outcome_date': '2026-01-01', 'entry_price': 10, 'target_price': 12, 'stop_loss': 9, 'signal': 'WEIRD', 'actual_return': 5},
    ]
    for r in rows:
        q = classify_quality(r)
        f = compute_quality_flags(r)
        print(f"  {q:8s} flags='{f}'  entry={r.get('entry_price')} exit={r.get('actual_exit_price','-')} sig={r.get('signal')}")

    print("\n=== compute_return ===")
    print(f"  BUY  entry=10 exit=11.5 → {compute_return(10, 11.5, 'BUY'):.2f}%")
    print(f"  SELL entry=10 exit=8.5  → {compute_return(10, 8.5, 'SELL'):.2f}%")
    print(f"  BUY  entry=10 exit=9    → {compute_return(10, 9, 'BUY'):.2f}%")
    print("\nOK")

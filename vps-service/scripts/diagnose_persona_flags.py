#!/usr/bin/env python3
"""PERSONA-FLAGS-FIX (v3.57.0) — تشخيص لماذا is_gambler_opportunity / is_investor_opportunity = 0.

يجب تشغيله من جذر مشروع vps-service على الإنتاج/localhost:

    python3 scripts/diagnose_persona_flags.py BONY
    python3 scripts/diagnose_persona_flags.py BONY AREH COMI
    python3 scripts/diagnose_persona_flags.py            # آخر 10 صفوف BUY

ي output لكل سهم:
  1) قيم fund من stocks.db (last_update, volume, current_price, turnover_egp, ...)
  2) نتيجة كل بوابة على حدة (is_live_stock_strict / _passes_quality_gate /
     _passes_gambler_confirmation / is_live_stock_loose / _passes_investor_fundamental)
  3) النتيجة النهائية is_gambler_opportunity / is_investor_opportunity
  4) محاكاة الـ OLD path (بدون updated_at في stored) vs NEW path (مع updated_at=now)

ده بيخلّي تـ أكّد السبب الجذري قبل وبعد الـ fix.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

# Ensure project root is on sys.path
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

try:
    from core.opportunity_quality import (
        is_live_stock_strict,
        is_live_stock_loose,
        is_gambler_opportunity,
        is_investor_opportunity,
        _passes_quality_gate,
        _passes_gambler_confirmation,
        _passes_investor_fundamental,
        compute_persona_flags,
        _parse_last_update_age_hours,
        _newest_age_hours,
        _f,
        BUY_FAMILY,
        OPPORTUNITY_MIN_SCORE,
        OPPORTUNITY_MIN_RR,
        OPPORTUNITY_MIN_TURNOVER,
        OPPORTUNITY_MIN_CONFIDENCE,
        LIVE_STRICT_MAX_AGE_HOURS,
        LIVE_LOOSE_MAX_AGE_DAYS,
    )
except ImportError as _e:
    print(f"[FATAL] cannot import core.opportunity_quality: {_e}")
    print(f"        run from vps-service root:  python3 scripts/diagnose_persona_flags.py BONY")
    sys.exit(2)

try:
    from data.analyses import _load_stocks_fundamentals_for_persona
except ImportError as _e:
    print(f"[FATAL] cannot import data.analyses: {_e}")
    sys.exit(2)


# ──────────────────────────────────────────────────────────────────────────────
def _fmt(v, w=22):
    if v is None:
        return str('None')[:w]
    s = str(v)
    return s[:w]


def _bar(ok: bool) -> str:
    return 'PASS ✅' if ok else 'FAIL ❌'


def _print_fund(ticker: str, fund: dict) -> None:
    print(f"  ── stocks.db fundamentals for {ticker} ──")
    if not fund:
        print("    (EMPTY — ticker not in stocks.db or loader failed)")
        return
    keys = [
        'last_update', 'is_suspended', 'volume', 'avg_volume', 'volume_ratio',
        'current_price', 'turnover_egp', 'value_traded',
        'change_1d', 'change_1m', 'volatility', 'pe_ratio', 'roe',
        'fair_value_upside', 'dividend_yield', 'rsi', 'sector',
    ]
    for k in keys:
        if k in fund:
            v = fund[k]
            extra = ''
            if k == 'last_update' and v:
                age = _parse_last_update_age_hours(v)
                extra = f"  → age={age:.1f}h" if age is not None else "  → age=UNPARSEABLE ❌"
            elif k == 'last_update' and not v:
                extra = "  → EMPTY (strict/loose will need stored.updated_at fallback)"
            print(f"    {k:<18} = {_fmt(v, 30)}{extra}")


def _print_gate_breakdown(label: str, rec: dict, fund: dict, stored: dict) -> None:
    """اطبع نتيجة كل بوابة فرعية عشان نعرف بالظبط فين الفشل."""
    print(f"\n  ── {label} ──")

    live_strict = is_live_stock_strict(fund, stored)
    live_loose = is_live_stock_loose(fund, stored)
    qg = _passes_quality_gate(rec, fund, stored)
    gc = _passes_gambler_confirmation(rec, fund, stored)
    inv_fund = _passes_investor_fundamental(rec, fund, stored)

    print(f"    is_live_stock_strict      {_bar(live_strict)}")
    print(f"    is_live_stock_loose       {_bar(live_loose)}")
    print(f"    _passes_quality_gate      {_bar(qg)}")
    print(f"    _passes_gambler_confirm   {_bar(gc)}")
    print(f"    _passes_investor_fund     {_bar(inv_fund)}")

    # أسباب الفشل التفصيلية
    if not live_strict:
        age = _newest_age_hours(fund.get('last_update'), stored.get('updated_at'), stored.get('last_update'))
        vol = _f(fund.get('volume'), 0) or _f(stored.get('volume'), 0)
        turn = (_f(stored.get('turnover_egp'), 0) or _f(fund.get('turnover_egp'), 0)
                or _f(fund.get('value_traded'), 0))
        price = _f(fund.get('current_price'), 0) or _f(stored.get('current_price'), 0)
        susp = _f(fund.get('is_suspended'), 0) or _f(stored.get('is_suspended'), 0)
        reasons = []
        if susp >= 1:
            reasons.append("is_suspended=1")
        if age is None:
            reasons.append(f"no parseable timestamp (fund.last_update={fund.get('last_update')!r}, stored.updated_at={stored.get('updated_at')!r})")
        elif age > LIVE_STRICT_MAX_AGE_HOURS:
            reasons.append(f"age={age:.1f}h > {LIVE_STRICT_MAX_AGE_HOURS}h")
        if vol < 10000:
            reasons.append(f"volume={vol} < 10000")
        if turn < OPPORTUNITY_MIN_TURNOVER:
            reasons.append(f"turnover={turn} < {OPPORTUNITY_MIN_TURNOVER}")
        if price <= 0:
            reasons.append(f"current_price={price} <= 0")
        print(f"      strict fail reasons: {'; '.join(reasons) or '?'}")

    if not qg:
        rec_lower = (rec.get('recommendation') or '').lower()
        reasons = []
        if rec_lower not in BUY_FAMILY:
            reasons.append(f"recommendation={rec.get('recommendation')!r} not in BUY_FAMILY")
        if _f(rec.get('maestro_score')) < OPPORTUNITY_MIN_SCORE:
            reasons.append(f"score={_f(rec.get('maestro_score'))} < {OPPORTUNITY_MIN_SCORE}")
        if _f(rec.get('risk_reward')) < OPPORTUNITY_MIN_RR:
            reasons.append(f"rr={_f(rec.get('risk_reward'))} < {OPPORTUNITY_MIN_RR}")
        if _f(rec.get('confidence')) < OPPORTUNITY_MIN_CONFIDENCE:
            reasons.append(f"confidence={_f(rec.get('confidence'))} < {OPPORTUNITY_MIN_CONFIDENCE}")
        turn = (_f(stored.get('turnover_egp'), 0) or _f(fund.get('turnover_egp'), 0)
                or _f(fund.get('value_traded'), 0))
        if turn < OPPORTUNITY_MIN_TURNOVER:
            reasons.append(f"turnover={turn} < {OPPORTUNITY_MIN_TURNOVER}")
        print(f"      quality_gate fail reasons: {'; '.join(reasons) or '?'}")

    g = is_gambler_opportunity(rec, fund, stored)
    i = is_investor_opportunity(rec, fund, stored)
    print(f"    → is_gambler_opportunity  = {int(g)}")
    print(f"    → is_investor_opportunity = {int(i)}")


def diagnose_ticker(ticker: str, rec_override: dict | None = None) -> None:
    ticker = (ticker or '').upper()
    print(f"\n{'='*72}")
    print(f"  TICKER: {ticker}")
    print(f"{'='*72}")

    fund_map = _load_stocks_fundamentals_for_persona() or {}
    fund = fund_map.get(ticker, {})
    _print_fund(ticker, fund)

    # بناء rec بالقيم الحقيقية من fund (stocks.db) مش hardcoded.
    # PERSONA-FLAGS-FIX (v3.58.0): قبل كده كان diagnose بـ يستخدم turnover=100M
    # synthetic فكان بـ يخلي is_gambler=1 دايماً → مضلّل. دلوقتي بنستخدم
    # fund.turnover_egp / fund.volume / fund.current_price الحقيقية.
    now_iso = time.strftime('%Y-%m-%d %H:%M:%S')
    if rec_override:
        rec = dict(rec_override)
    else:
        # قيم default لو fund فاضي (sandbox/missing ticker)
        _turn = float(fund.get('turnover_egp') or 0) or float(fund.get('value_traded') or 0)
        _vol = float(fund.get('volume') or 0)
        _price = float(fund.get('current_price') or 0)
        rec = {
            'ticker': ticker,
            'recommendation': 'strong_buy',
            'maestro_score': 100.0,
            'risk_reward': 1.74,
            'confidence': 78.0,
            'turnover_egp': _turn if _turn > 0 else None,
            # live-stock fallbacks (من fund الحقيقي)
            'updated_at': now_iso,
            'volume': _vol,
            'current_price': _price,
            'is_suspended': int(fund.get('is_suspended') or 0),
        }
        if not fund:
            print("  ⚠️  fund EMPTY — diagnose can't verify real turnover/volume/price.")
            print("      This ticker is NOT in stocks.db (or stocks.db failed to load).")
            print("      The write path will also see fund={} → quality_gate may fail on turnover.")

    # ── محاكاة مسار الكتابة الفعلي (ما يحدث في _build_stored_analysis_row) ──
    # turnover_egp fallback chain: stock.turnover_egp → stock.value_traded → entry*vol
    _sim_turn = rec.get('turnover_egp')
    _sim_stock = {
        'turnover_egp': fund.get('turnover_egp'),
        'value_traded': fund.get('value_traded'),
    }
    _sim_src = '?'
    if _sim_turn is not None and _sim_turn > 0:
        _sim_src = 'param/explicit'
    elif _sim_stock.get('turnover_egp') and float(_sim_stock['turnover_egp'] or 0) > 0:
        _sim_turn = float(_sim_stock['turnover_egp'])
        _sim_src = 'stock.turnover_egp'
    elif _sim_stock.get('value_traded') and float(_sim_stock['value_traded'] or 0) > 0:
        _sim_turn = float(_sim_stock['value_traded'])
        _sim_src = 'stock.value_traded'
    else:
        _sim_turn = None
        _sim_src = 'NONE (→ quality_gate will FAIL on turnover < 500k)'
    print(f"\n  ── write-path turnover simulation ──")
    print(f"    stock.turnover_egp  = {fund.get('turnover_egp')}")
    print(f"    stock.value_traded  = {fund.get('value_traded')}")
    print(f"    → resolved turnover = {_sim_turn}  (source: {_sim_src})")
    if _sim_turn is None or float(_sim_turn or 0) < 500_000:
        print(f"    ⚠️  turnover < 500k → quality_gate FAILS → is_gambler will be 0")

    # ── NEW path (with updated_at=now in stored) ──
    # compute_persona_flags builds `stored` internally from rec; call it directly:
    flags_new = compute_persona_flags(rec, fund, rec.get('volume_ratio', 1.0) or 1.0)
    print(f"\n  compute_persona_flags (NEW path, rec.updated_at={now_iso!r}):")
    print(f"    is_gambler = {flags_new.get('is_gambler')}")
    print(f"    is_investor = {flags_new.get('is_investor')}")
    print(f"    gambler_rank = {flags_new.get('gambler_rank')}")
    print(f"    investor_rank = {flags_new.get('investor_rank')}")

    # تفصيل البوابات للـ NEW path
    stored_sim_new = {
        'volume_ratio': rec.get('volume_ratio', 1.0) or 1.0,
        'turnover_egp': rec.get('turnover_egp'),
        'updated_at': rec.get('updated_at'),
        'volume': rec.get('volume'),
        'current_price': rec.get('current_price'),
        'is_suspended': rec.get('is_suspended'),
    }
    _print_gate_breakdown('NEW path gate breakdown (stored has updated_at=now)', rec, fund, stored_sim_new)

    # ── OLD path (simulated: no updated_at/volume/current_price in stored) ──
    stored_old = {
        'volume_ratio': rec.get('volume_ratio', 1.0) or 1.0,
        'turnover_egp': rec.get('turnover_egp'),
    }
    _print_gate_breakdown('OLD path gate breakdown (stored missing updated_at — the bug)', rec, fund, stored_old)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if not args:
        print("[usage] python3 scripts/diagnose_persona_flags.py BONY [AREH COMI ...]")
        print("        Pass one or more tickers to diagnose why their persona flags are 0/1.")
        print("        Example:  python3 scripts/diagnose_persona_flags.py BONY AREH")
        return 1
    tickers = args

    for tk in tickers:
        diagnose_ticker(tk)

    print(f"\n{'='*72}")
    print("  SUMMARY")
    print(f"{'='*72}")
    print("  Compare OLD path (the bug) vs NEW path (the fix) for each ticker above.")
    print("  If OLD = 0 and NEW = 1 for is_gambler → the fix resolves the root cause.")
    print("  If both = 0 → check the 'fail reasons' lines to see which gate still blocks.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

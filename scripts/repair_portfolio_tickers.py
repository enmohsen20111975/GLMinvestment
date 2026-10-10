#!/usr/bin/env python3
"""
repair_portfolio_tickers.py — تنظيف stock_ticker في portfolio_assets
=======================================================================
portfolio_assets.stock_ticker فيه صفوف تالفة بتخلي حساب التطهير يفوّت مراكز:

    'FWRYFawry For Banking Technology And Electronic PaymentD'  → FWRY
    'VLMRA'                                                       → VLMR
    'INTEGRATED'                                                  → غير قابل للإصلاح
    '4160'                                                        → مش ticker (صندوق/سند)
    NULL (سبائك · دايموند · كلاود · مشغولات)                     → أصل مش سهم

السكربت **بيقترح** الإصلاح فقط لما يكون الدليل قاطع:
  1) الرمز موجود كما هو في stocks.ticker
  2) أول run من أحرف كبيرة في النص = ticker موجود فعلاً (FWRYFawry… → FWRY)
  3) أقرب ticker بمسافة تحرير 1 (VLMRA → VLMR)
ومش بيلمس أي صف مش متأكد منه — بيسجّله في التقرير بدل ما يخمن.

dry-run هو الافتراضي. البيانات دي مالية، فالتعديل محتاج --apply صريح.

الاستخدام:
    python3 scripts/repair_portfolio_tickers.py
    python3 scripts/repair_portfolio_tickers.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "db"
STOCKS_DB = DATA_DIR / "stocks.db"
REPORT_DIR = PROJECT_ROOT / "scripts" / "output"

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
MAX_EDIT_DISTANCE = 1


def log(msg):
    print(msg, flush=True)


def edit_distance_le1(a: str, b: str) -> bool:
    """>1 مسافة تحرير؟ (a='VLMRA', b='VLMR' → True)"""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > MAX_EDIT_DISTANCE:
        return False
    if la == lb:
        diff = sum(1 for x, y in zip(a, b) if x != y)
        return diff <= MAX_EDIT_DISTANCE
    # different lengths → one insert/delete
    short, long_ = (a, b) if la < lb else (b, a)
    i = j = 0
    skipped = 0
    while i < len(short) and j < len(long_):
        if short[i] == long_[j]:
            i += 1
            j += 1
        else:
            skipped += 1
            if skipped > MAX_EDIT_DISTANCE:
                return False
            j += 1
    return True


def load_tickers():
    if not STOCKS_DB.exists():
        log("❌ stocks.db مش موجود: %s" % STOCKS_DB)
        sys.exit(1)
    conn = sqlite3.connect("file:%s?mode=ro" % STOCKS_DB, uri=True, timeout=20)
    rows = conn.execute(
        "SELECT ticker, name, market FROM stocks WHERE market = 'EGX'").fetchall()
    conn.close()
    tickers = {}
    for tk, nm, mk in rows:
        if tk:
            t = tk.strip().upper()
            tickers[t] = nm
    return tickers


def resolve(raw, tickers):
    """يرجّع (ticker|None, method, confidence)."""
    if raw is None:
        return None, "null_ticker", None
    s = str(raw).strip()
    if not s:
        return None, "empty", None
    up = s.upper()

    if TICKER_RE.match(up) and up in tickers:
        return up, "exact", "high"
    if TICKER_RE.match(up):
        return None, "valid_but_unknown", None

    # 'FWRYFawry For Banking…' → جرّب الأطول للأقصر: FWRYFA, FWRYF, FWRY…
    # (لو جرّبنا الأطول بس، FWRYFA مش ticker وبيضيع opportunity)
    for n in range(6, 2, -1):
        cand = up[:n]
        if TICKER_RE.match(cand) and cand in tickers:
            return cand, "leading_run_%d" % n, "high"

    up2 = re.sub(r"[^A-Z0-9]", "", up)
    if TICKER_RE.match(up2) and up2 in tickers:
        return up2, "stripped_non_alnum", "high"

    # fuzzy: نفس الطول تقريباً ومسافة 1
    cands = [t for t in tickers if edit_distance_le1(up2, t)]
    if len(cands) == 1:
        return cands[0], "edit_distance_1", "medium"
    if len(cands) > 1:
        return None, "ambiguous_fuzzy:%s" % ",".join(sorted(cands)[:5]), None

    return None, "unresolvable", None


def main():
    ap = argparse.ArgumentParser(description="Clean portfolio_assets.stock_ticker")
    ap.add_argument("--apply", action="store_true", help="execute (default dry-run)")
    args = ap.parse_args()

    tickers = load_tickers()
    log("=" * 74)
    log("🧹 repair_portfolio_tickers — %s" % ("APPLY" if args.apply else "DRY-RUN"))
    log("🗄️  %s" % STOCKS_DB)
    log("🔑 EGX tickers: %d" % len(tickers))
    log("=" * 74)

    conn = sqlite3.connect(STOCKS_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, user_id, portfolio_id, name, stock_ticker, quantity, "
        "avg_buy_price, asset_class FROM portfolio_assets ORDER BY id").fetchall()

    fixes, blocked, clean = [], [], 0
    for r in rows:
        target, method, conf = resolve(r["stock_ticker"], tickers)
        entry = {"id": r["id"], "user_id": r["user_id"], "name": r["name"],
                 "old": r["stock_ticker"], "new": target, "method": method,
                 "confidence": conf,
                 "quantity": r["quantity"], "avg_buy_price": r["avg_buy_price"]}
        if target and str(r["stock_ticker"]).strip().upper() != target:
            fixes.append(entry)
            log("  🔧 %-14s → %-8s [%s/%s]  (%s)"
                % (str(r["stock_ticker"])[:14], target, method, conf, (r["name"] or "")[:24]))
        elif target:
            clean += 1
        else:
            blocked.append(entry)
            log("  ⛔ %-14s [%s]  (%s)"
                % (str(r["stock_ticker"])[:14], method, (r["name"] or "")[:24]))

    if args.apply and fixes:
        conn.execute("BEGIN")
        for f in fixes:
            conn.execute("UPDATE portfolio_assets SET stock_ticker=?, updated_at=datetime('now') "
                         "WHERE id=?", (f["new"], f["id"]))
        conn.commit()
        log("\n✅ اتصلّح %d صف" % len(fixes))
    conn.close()

    log("─" * 74)
    log("سليم=%d · قابل للإصلاح=%d · محتاج تدخل بشري=%d"
        % (clean, len(fixes), len(blocked)))
    if not args.apply and fixes:
        log("ℹ️  DRY-RUN — شغّل بـ --apply لتطبيق الإصلاح")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rp = REPORT_DIR / ("portfolio_ticker_repair_%s.json"
                       % datetime.now().strftime("%Y%m%d_%H%M%S"))
    rp.write_text(json.dumps({"applied": args.apply, "clean": clean,
                              "fixes": fixes, "needs_manual": blocked},
                             ensure_ascii=False, indent=2), encoding="utf-8")
    log("📄 التقرير: %s" % rp.relative_to(PROJECT_ROOT))
    log("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
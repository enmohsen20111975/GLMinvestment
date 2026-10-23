#!/usr/bin/env python3
"""
repair_tab_symbols.py — إصلاح رموز tab_* في data_engine.db
=====================================================================
المشكلة:
    جداول tab_* (fundamentals) متخزّنة بـ symbol = TICKER + الاسم ملزوقين
    بدون فاصل، لأن الـ scraper القديم كان بياخد الحقلين من نفس الـ DOM cell:

        'AALRالعامة' · 'ABUKابوقير' · 'ADCIأدكوD' · 'ACFRAlexandria' · 'ACTFAct'

    النتيجة:
        1. أي JOIN بـ stocks.ticker بيفشل → tab_dividends看似 فيها 285 سهم
           مصرى بس صفر منهم بيتطابق مع أي ticker عندنا.
        2. fetch_corporate_actions.py (cron يومي) بيقرأ نفس الجدول →
           predictions.db.corporate_actions فيها 106 صف ipo وصفر dividend.

الإصلاح:
    طول emulsif prefximation من ticker معروف (أدق) → البادئة اللاتينية قبل أول
    حرف عربي → مطابقة بالاسم. مع dry-run افتراضي + backup قبل التعديل.

الاستخدام:
    python3 scripts/repair_tab_symbols.py              # dry-run (default)
    python3 scripts/repair_tab_symbols.py --apply      # نفّذ + backup
    python3 scripts/repair_tab_symbols.py --apply --tables tab_dividends
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "db"
DB_FILE = str(DATA_DIR / "data_engine.db")
STOCKS_DB = str(DATA_DIR / "stocks.db")
REPORT_DIR = PROJECT_ROOT / "scripts" / "output"

ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_SUFFIX_RE = re.compile(r"\.(CA|EGX|EGXCA|COM|SA)$")
_ALNUM_RE = re.compile(r"[^A-Z0-9]")

DEFAULT_TABLES = [
    "tab_dividends", "tab_income_statement", "tab_balance_sheet",
    "tab_cash_flow", "tab_valuation", "tab_profitability",
    "tab_performance", "tab_technical_analysis",
]

# tab_*.market بيتخزّن بالعربي، stocks.db.market بالإنجليزي.
# الربط لازم يكون market-aware: فيه tickers بتتكرر بين الأسواق
# (مثل NBK / ASC / MENA موجودة في EGX و KSE بنفس الرمز لكن شركات مختلفة)،
# ومطابقة البادئة بدون السوق بتوجّه السهم لسوق غلط.
MARKET_MAP = {
    "مصر": "EGX",
    "السعودية": "TADAWUL",
    "الكويت": "KSE",
    "قطر": "QSE",
    "امارات": "UAE",
    "البحرين": "BAH",
    "عمان": "OMX",
}
# أسماء الأسواق اللي تسربت في عمود symbol (= column-shift bug class)
MARKET_NAME_LEAKS = set(MARKET_MAP) | {"السعودية", "مصر"}


def log(msg):
    print(msg, flush=True)


def normalize(raw):
    if not raw:
        return None
    s = _SUFFIX_RE.sub("", str(raw).strip().upper())
    s = _ALNUM_RE.sub("", s)
    return s or None


def latin_prefix(raw):
    """'ABUKابوقير' → 'ABUK' (اللاتيني قبل أول حرف عربي)."""
    if not raw or not ARABIC_RE.search(str(raw)):
        return None
    m = re.match(r"^([A-Za-z0-9]{1,10})", str(raw).strip())
    return m.group(1).upper() if m else None


def load_resolver():
    """يرجّع字典: ticker→market، و per-market ticker lists، و name→ticker."""
    known, by_name, by_market = {}, {}, {}
    if not os.path.exists(STOCKS_DB):
        log("⚠️ stocks.db مش موجود — المطابقة هتكون بالحرف العربي بس")
        return known, by_name, by_market
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(%s, writable=False).__enter__()
    rows = conn.execute("SELECT ticker, name, name_ar, market FROM stocks").fetchall()
    conn.close()
    for tk, nm, na, mk in rows:
        if not tk:
            continue
        t = tk.strip().upper()
        known[t] = mk
        by_market.setdefault(mk, set()).add(t)
        by_name.setdefault(normalize(t) or "", (t, mk))
        for cand in (nm, na):
            n = normalize(cand)
            if n:
                by_name.setdefault(n, (t, mk))
    return known, by_name, by_market


# populated in main()
KNOWN: dict = {}
BY_NAME: dict = {}
BY_MARKET: dict = {}
LONGEST: list = []


def resolve(symbol, market):
    """يرجّع (ticker, method). market = عمود market في صف tab_*."""
    raw = str(symbol or "").strip()
    if not raw:
        return None, "empty"
    # row where a market name leaked into the symbol column → not repairable
    if raw in MARKET_NAME_LEAKS:
        return None, "market_name_leak"

    want = MARKET_MAP.get(str(market or "").strip())
    pool = BY_MARKET.get(want, set()) if want else set()
    up = raw.upper()

    # 1) exact داخل السوق المطلوب
    if up in pool:
        return up, "exact_market"
    # 2) exact في أي سوق
    if up in KNOWN:
        return up, "exact_any_market"
    # 3) أطول ticker معروف في السوق المطلوب يبدأ بنفس البادئة
    #    (يحل 'ACFRAlexandria' → 'ACFR' و 'ARABRECالشركة' → 'ARABREC')
    for k in LONGEST:
        if up.startswith(k) and k in pool:
            return k, "prefix_market"
    # 4) البادئة اللاتينية قبل أول حرف عربي، متحققة داخل السوق المطلوب
    lp = latin_prefix(raw)
    if lp and lp in pool:
        return lp, "arabic_split_market"
    # 5) بالاسم (نفس السوق أولاً)
    n = normalize(raw)
    if n and n in BY_NAME:
        return BY_NAME[n][0], "name"
    # 6) prefix في أي سوق (أخيرة — بتسبب تعارضات، فبنبلّغ عنها)
    for k in LONGEST:
        if up.startswith(k):
            return k, "prefix_any_market"
    return None, "unresolved"


known_sorted_set: set = set()


def non_null_count(conn, table, row_id):
    """عدد الـ columns غير الفاضية في الصف — بيتقارن بيه عند دمج صف مكرر."""
    cols = [c[1] for c in conn.execute('PRAGMA table_info("%s")' % table)
            if c[1] != "id"]
    if not cols:
        return 0
    row = conn.execute(
        'SELECT %s FROM "%s" WHERE id = ?' % (", ".join('"%s"' % c for c in cols), table),
        (row_id,)).fetchone()
    if row is None:
        return 0
    return sum(1 for v in row if v is not None and str(v).strip() != "")


def repair_table(conn, table, apply_changes):
    cols = {r[1] for r in conn.execute('PRAGMA table_info("%s")' % table)}
    if not {"symbol", "market"}.issubset(cols):
        log("  ⏭️  %s: مفيش (symbol, market) — اتخطّى" % table)
        return {"table": table, "skipped": True}

    unique_cols = []
    for idx in conn.execute('PRAGMA index_list("%s")' % table):
        if idx[2]:  # unique
            unique_cols.append(
                [r[2] for r in conn.execute('PRAGMA index_info("%s")' % idx[1])])
    has_unique = any(set(u) >= {"symbol", "market"} for u in unique_cols)

    rows = conn.execute('SELECT id, symbol, market FROM "%s"' % table).fetchall()
    plan, unresolved, leaks = [], [], []
    for row_id, symbol, market in rows:
        target, how = resolve(symbol, market)
        if target is None:
            (leaks if how == "market_name_leak" else unresolved).append(symbol)
            continue
        if target == str(symbol).strip().upper():
            continue
        plan.append({"id": row_id, "old": symbol, "new": target,
                     "how": how, "market": market,
                     "cross_market": how.endswith("any_market")})

    cross = sum(1 for p in plan if p["cross_market"])
    log("  📊 %s: %d صف · %d محتاج إصلاح · %d unresolved · %d market-leak · %d cross-market"
        % (table, len(rows), len(plan), len(unresolved), len(leaks), cross))
    for p in plan[:5]:
        log("      %-22s → %-8s (%s)" % (p["old"][:22], p["new"], p["how"]))
    if len(plan) > 5:
        log("      … و%d كمان" % (len(plan) - 5))

    merged = 0
    if apply_changes and plan:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = "%s_pre_repair_%s" % (table, ts)
        conn.execute("DROP TABLE IF EXISTS %s" % bak)
        conn.execute("CREATE TABLE %s AS SELECT * FROM %s" % (bak, table))
        log("      💾 backup: %s" % bak)

        for p in plan:
            if has_unique:
                dup = conn.execute(
                    'SELECT id FROM "%s" WHERE UPPER(symbol)=UPPER(?) AND market IS ? AND id != ?'
                    % table, (p["new"], p["market"], p["id"])).fetchone()
                if dup:
                    a, b = p["id"], dup[0]
                    score_a = non_null_count(conn, table, a)
                    score_b = non_null_count(conn, table, b)
                    if score_b > score_a:
                        # الصف الموجود أنضف → نحذف اللي بنيناه
                        conn.execute('DELETE FROM "%s" WHERE id=?' % table, (a,))
                        merged += 1
                        continue
                    conn.execute('DELETE FROM "%s" WHERE id=?' % table, (b,))
                    merged += 1
            conn.execute('UPDATE "%s" SET symbol=? WHERE id=?' % table,
                         (p["new"], p["id"]))
        conn.commit()
        log("      ✅ %d صف اتصلّح · %d صف اتدمج" % (len(plan), merged))

    return {"table": table, "rows": len(rows), "to_fix": len(plan),
            "cross_market": sum(1 for p in plan if p["cross_market"]),
            "unresolved": sorted(set(unresolved)),
            "market_leaks": sorted(set(leaks)), "merged": merged,
            "backup": bak if (apply_changes and plan) else None,
            "sample": plan[:8]}


def main():
    global KNOWN, BY_NAME, BY_MARKET, LONGEST

    ap = argparse.ArgumentParser(description="Repair corrupted tab_* symbols")
    ap.add_argument("--apply", action="store_true", help="execute (default dry-run)")
    ap.add_argument("--tables", nargs="*", default=DEFAULT_TABLES)
    args = ap.parse_args()

    KNOWN, BY_NAME, BY_MARKET = load_resolver()
    LONGEST = sorted(KNOWN, key=len, reverse=True)

    log("=" * 66)
    log("🔧 repair_tab_symbols — %s" % ("APPLY" if args.apply else "DRY-RUN"))
    log("🗄️  %s" % DB_FILE)
    log("🔑 tickers معروفة: %d · أسواق: %s"
        % (len(KNOWN), ", ".join("%s=%d" % (k, len(v)) for k, v in sorted(BY_MARKET.items()))))
    log("=" * 66)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_FILE, writable=False).__enter__()
    conn.execute("PRAGMA foreign_keys=OFF")
    reports = []
    for t in args.tables:
        reports.append(repair_table(conn, t, args.apply))
    conn.close()

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rp = REPORT_DIR / ("tab_symbol_repair_%s.json"
                       % datetime.now().strftime("%Y%m%d_%H%M%S"))
    rp.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")

    total_fix = sum(r.get("to_fix", 0) for r in reports)
    total_unres = sum(len(r.get("unresolved", [])) for r in reports)
    total_cross = sum(r.get("cross_market", 0) for r in reports)
    total_leak = sum(len(r.get("market_leaks", [])) for r in reports)
    log("─" * 66)
    log("الإجمالي: %d صف محتاج إصلاح" % total_fix)
    log("  unresolved=%d · market-leak=%d · cross-market=%d"
        % (total_unres, total_leak, total_cross))
    if total_cross:
        log("  ⚠️ cross-market rows محتاجة مراجعة يدوية (الـ ticker موجود بس في سوق تاني)")
    log("📄 التقرير: %s" % rp.relative_to(PROJECT_ROOT))
    if not args.apply:
        log("ℹ️  DRY-RUN — شغّل بـ --apply لتطبيق التعديل")
    log("=" * 66)
    return 0


if __name__ == "__main__":
    sys.exit(main())
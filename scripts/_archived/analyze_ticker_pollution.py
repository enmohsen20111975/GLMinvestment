#!/usr/bin/env python3
"""
analyze_ticker_pollution.py — فحص وتنظيف تلوث رموز الأسهم (Task DATA-CLEAN-004)
============================================================================

يحلل جدول `stocks` في db/stocks.db ويصنّف الأسهم إلى:
  - clean (سليم): رمز قياسي 2-8 أحرف لاتينية أو رقمي (TADAWUL) أو بـ _ (ARAB_R2)
  - polluted_explicit (ملوث صريح): يحتوي مسافات أو أحرف عربية أو علامات ترقيم
  - polluted_concat (ملوث مدمج): رمز على شكل <TICKER><NAME>D بدون مسافات
  - mismatched_market (مُصنّف خطأ): name_ar يذكر دولة لا تطابق market
  - null_price (بدون سعر): current_price NULL أو 0
  - duplicate_group (مكرر): نفس name_ar يتكرر بأكثر من ticker
  - egksco_missing: رموز egksco_stocks غير موجودة في stocks.EGX
  - egx_not_in_egksco: رموز EGX غير موجودة في egksco_stocks (للمراجعة)

المخرجات:
  1) db/stocks_cleanup_report.json — تقرير JSON شامل
  2) جدول stocks_cleanup_report في stocks.db — توثيق المشاكل (آمن: لا يمسح بيانات)
  3) طباعة ملخص على stdout

القاعدة: لا يحذف أي صف. فقط يصنّف ويوثّق ويقترح.
الاستخدام:
    python3 scripts/analyze_ticker_pollution.py            # فحص + تقرير
    python3 scripts/analyze_ticker_pollution.py --apply    # تطبيق is_active=0 على الملوث الصريح
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

# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"
REPORT_JSON = PROJECT_ROOT / "db" / "stocks_cleanup_report.json"

# Clean ticker patterns
RE_CLEAN_ALPHA = re.compile(r"^[A-Z]{2,8}(_[A-Z0-9]+)?$")  # COMI, ETEL, ARAB_R2, EFIH
RE_CLEAN_NUMERIC = re.compile(r"^[0-9]{3,6}$")              # TADAWUL numeric (1010, 2222)
RE_KSE_LONG = re.compile(r"^[A-Z]{9,12}$")                  # KSE long: ALTIJARIA, INTEGRATED
RE_TRAILING_PUNCT = re.compile(r"[.\-]$")                   # trailing period/dash
RE_ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F]")

# Country patterns -> expected market, using regex for safer word-boundary matching.
# Important: avoid matching "مصر" inside "المصرف" / "المصرفية" / "مصرفية" (false positives).
# - Egypt: "مصر" NOT followed by ف/ي/ا/و/ة, OR explicit "المصرية" / "مصرية" / "مصر لل"
# - Qatar: "قطر" anywhere (matches "قطروعمان" too)
# - Saudi: "السعودية" or "سعودي"
# - Kuwait: "الكويت"
COUNTRY_PATTERNS = [
    (re.compile(r"قطر"), "QSE"),
    (re.compile(r"السعودية|سعودي"), "TADAWUL"),
    (re.compile(r"الكويت"), "KSE"),
    # Egypt: must NOT be part of المصرف/مصرفية/مصارفة
    (re.compile(r"مصر(?![فياوة])|المصري|مصرية"), "EGX"),
]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def classify_ticker(ticker: str, has_price_history: bool, clean_tickers_set: set[str]) -> tuple[str, str | None]:
    """
    Return (category, suggested_clean_ticker_or_None).
    Categories: clean, polluted_explicit, polluted_concat, kse_long_valid
    """
    if not ticker:
        return "polluted_explicit", None

    # Explicit pollution: spaces, arabic chars, lowercase, trailing punctuation
    if " " in ticker:
        return "polluted_explicit", _extract_base(ticker, clean_tickers_set)
    if RE_ARABIC.search(ticker):
        return "polluted_explicit", _extract_base(ticker, clean_tickers_set)
    if any(c.islower() for c in ticker):
        return "polluted_explicit", _extract_base(ticker, clean_tickers_set)
    if RE_TRAILING_PUNCT.search(ticker):
        return "polluted_explicit", _extract_base(ticker, clean_tickers_set)

    # Clean numeric (TADAWUL)
    if RE_CLEAN_NUMERIC.match(ticker):
        return "clean", None

    # Clean alpha (EGX/QSE/short KSE)
    if RE_CLEAN_ALPHA.match(ticker):
        return "clean", None

    # KSE long uppercase (ALTIJARIA, INTEGRATED, MUNTAZAHAT, WARBABANK, ...)
    # — but verify it has price_history, otherwise it's likely "ticker+name+D" concatenation
    if RE_KSE_LONG.match(ticker):
        if has_price_history:
            return "kse_long_valid", None
        # No history → try to match a short ticker prefix (e.g., KORAKORRAD -> KORA)
        base = _extract_base(ticker, clean_tickers_set)
        if base:
            return "polluted_concat", base
        # else: unknown long ticker without history — flag for review
        return "kse_long_no_history_review", None

    # Anything else > 12 chars (e.g., EGS30AJ1C016-EGP, EGS385S1C012)
    # These are EGSE codes — legitimate but not standard tickers. Flag for review.
    if re.match(r"^[A-Z]{3,4}\d", ticker):
        return "egse_code_review", None

    # Fallback: polluted
    return "polluted_explicit", _extract_base(ticker, clean_tickers_set)


def _extract_base(polluted_ticker: str, clean_tickers_set: set[str]) -> str | None:
    """Try to find a known clean ticker that is a prefix of the polluted one."""
    if not polluted_ticker:
        return None
    # Try prefix lengths 8 down to 3
    for L in range(min(8, len(polluted_ticker)), 2, -1):
        pref = polluted_ticker[:L]
        if pref in clean_tickers_set:
            return pref
    return None


def _extract_candidate_base(polluted_ticker: str) -> str | None:
    """
    For polluted tickers WITHOUT a known clean counterpart, extract the leading
    ASCII-uppercase run as a 'candidate' clean ticker (for review/renaming).
    Skips EGSE-style codes (EGS30AJ1C016-EGP...) since their 'clean' version
    is the bare EGSE code itself, not a short trading ticker.
    """
    if not polluted_ticker:
        return None
    # Skip EGSE codes (start with EGS + digit)
    if re.match(r"^EGS[A-Z0-9]", polluted_ticker) or re.match(r"^EEGS", polluted_ticker):
        return None
    # Skip EEGS variant (typo in source)
    m = re.match(r"^([A-Z]{3,8})", polluted_ticker)
    return m.group(1) if m else None


# ──────────────────────────────────────────────────────────────────────────
# Main analysis
# ──────────────────────────────────────────────────────────────────────────

def main(apply: bool = False) -> int:
    if not STOCKS_DB.exists():
        print(f"ERROR: {STOCKS_DB} not found", file=sys.stderr)
        return 1

    print(f"▶ Analyzing {STOCKS_DB} …")
    con = sqlite3.connect(STOCKS_DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # Backup table for safety (only if --apply)
    if apply:
        print("▶ --apply mode: backing up stocks table to stocks_backup_cleanup_004 …")
        cur.execute("DROP TABLE IF EXISTS stocks_backup_cleanup_004")
        cur.execute("CREATE TABLE stocks_backup_cleanup_004 AS SELECT * FROM stocks")
        con.commit()
        print("  ✓ Backup created.")

    # ── 1. Load all stocks
    rows = list(cur.execute(
        "SELECT id, ticker, name, name_ar, market, sector, current_price, is_active "
        "FROM stocks"
    ))
    print(f"  Total rows in stocks: {len(rows)}")

    # Distinct markets
    markets = {}
    for r in rows:
        markets[r["market"]] = markets.get(r["market"], 0) + 1
    print(f"  Markets: {markets}")

    # ── 2. Build clean-tickers set (for prefix matching)
    clean_tickers_set: set[str] = set()
    for r in rows:
        tk = r["ticker"] or ""
        if RE_CLEAN_ALPHA.match(tk) or RE_CLEAN_NUMERIC.match(tk):
            clean_tickers_set.add(tk)
    print(f"  Reference clean tickers (for prefix matching): {len(clean_tickers_set)}")

    # ── 3. Load price-history presence
    ph_counts: dict[str, int] = {}
    if PRICE_HISTORY_DB.exists():
        ph_con = sqlite3.connect(PRICE_HISTORY_DB)
        ph_cur = ph_con.cursor()
        for tk, cnt in ph_cur.execute(
            "SELECT ticker, COUNT(*) FROM price_history GROUP BY ticker"
        ):
            ph_counts[tk] = cnt
        ph_con.close()
        print(f"  Price-history ticker counts loaded: {len(ph_counts)}")
    else:
        print(f"  WARNING: {PRICE_HISTORY_DB} not found — assuming no price history.")

    # ── 4. egksco_stocks reference (official EGX list)
    try:
        egksco_syms = set(
            r[0] for r in cur.execute("SELECT symbol FROM egksco_stocks")
        )
        print(f"  egksco_stocks reference symbols: {len(egksco_syms)}")
    except sqlite3.OperationalError:
        egksco_syms = set()
        print("  WARNING: egksco_stocks table not found.")

    # ── 5. Classify each row
    classifications = []
    for r in rows:
        tk = r["ticker"] or ""
        has_hist = ph_counts.get(tk, 0) > 0
        cat, suggested = classify_ticker(tk, has_hist, clean_tickers_set)
        classifications.append({
            "id": r["id"],
            "ticker": tk,
            "name_ar": r["name_ar"],
            "market": r["market"],
            "current_price": r["current_price"],
            "is_active": r["is_active"],
            "category": cat,
            "suggested_clean_ticker": suggested,
            "candidate_clean_ticker": _extract_candidate_base(tk) if not suggested else None,
            "price_history_rows": ph_counts.get(tk, 0),
        })

    # ── 6. Aggregate categories
    cat_counts: dict[str, int] = {}
    for c in classifications:
        cat_counts[c["category"]] = cat_counts.get(c["category"], 0) + 1
    print(f"  Category counts: {cat_counts}")

    # ── 7. Polluted explicit (definitely broken — spaces, Arabic, lowercase, trailing punct)
    polluted_explicit = [
        c for c in classifications
        if c["category"] == "polluted_explicit"
    ]
    polluted_concat = [
        c for c in classifications
        if c["category"] == "polluted_concat"
    ]
    egse_review = [
        c for c in classifications
        if c["category"] == "egse_code_review"
    ]
    kse_long_review = [
        c for c in classifications
        if c["category"] == "kse_long_no_history_review"
    ]

    # ── 8. Mismatched market (name_ar mentions a country that doesn't match market)
    mismatched = []
    for c in classifications:
        nar = c["name_ar"] or ""
        for pat, expected_mkt in COUNTRY_PATTERNS:
            if pat.search(nar) and c["market"] != expected_mkt:
                # If market=EGX and the name also mentions Egypt, it's a joint-venture
                # name like "السعودية المصرية" → keep EGX (Egypt-listed entity)
                if c["market"] == "EGX":
                    eg_pat = next((p for p, m in COUNTRY_PATTERNS if m == "EGX"), None)
                    if eg_pat and eg_pat.search(nar):
                        continue
                mismatched.append({
                    "id": c["id"],
                    "ticker": c["ticker"],
                    "name_ar": nar,
                    "market": c["market"],
                    "expected_market": expected_mkt,
                    "country_found": pat.pattern,
                })
                break

    # ── 9. Null/zero price
    null_price = [
        {
            "id": c["id"],
            "ticker": c["ticker"],
            "name_ar": c["name_ar"],
            "market": c["market"],
            "current_price": c["current_price"],
        }
        for c in classifications
        if c["current_price"] is None or c["current_price"] == 0
    ]

    # ── 10. Duplicate groups (same name_ar with different tickers)
    by_name_ar: dict[str, list[dict]] = {}
    for c in classifications:
        if not c["name_ar"]:
            continue
        # Normalize: strip and collapse spaces
        key = re.sub(r"\s+", " ", c["name_ar"]).strip()
        by_name_ar.setdefault(key, []).append(c)
    duplicates = []
    for key, items in by_name_ar.items():
        if len(items) > 1:
            duplicates.append({
                "name_ar": key,
                "count": len(items),
                "entries": [
                    {
                        "id": i["id"],
                        "ticker": i["ticker"],
                        "market": i["market"],
                        "category": i["category"],
                        "current_price": i["current_price"],
                        "price_history_rows": i["price_history_rows"],
                    }
                    for i in items
                ],
            })
    duplicates.sort(key=lambda d: -d["count"])

    # ── 11. egksco cross-check
    egx_tickers_in_stocks = set(
        r["ticker"] for r in rows if r["market"] == "EGX"
    )
    egksco_missing = sorted(egksco_syms - egx_tickers_in_stocks)
    egx_not_in_egksco = sorted(egx_tickers_in_stocks - egksco_syms)

    # ── 12. Build report
    report = {
        "task_id": "DATA-CLEAN-004",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "databases": {
            "stocks_db": str(STOCKS_DB.relative_to(PROJECT_ROOT)),
            "price_history_db": str(PRICE_HISTORY_DB.relative_to(PROJECT_ROOT))
                if PRICE_HISTORY_DB.exists() else None,
        },
        "summary": {
            "total_stocks_rows": len(rows),
            "markets": markets,
            "category_counts": cat_counts,
            "polluted_explicit_count": len(polluted_explicit),
            "polluted_concat_count": len(polluted_concat),
            "egse_code_review_count": len(egse_review),
            "kse_long_no_history_review_count": len(kse_long_review),
            "mismatched_market_count": len(mismatched),
            "null_or_zero_price_count": len(null_price),
            "duplicate_name_groups_count": len(duplicates),
            "egksco_missing_from_egx_count": len(egksco_missing),
            "egx_not_in_egksco_count": len(egx_not_in_egksco),
            "total_polluted_to_deactivate": len(polluted_explicit) + len(polluted_concat),
        },
        "polluted_explicit": polluted_explicit,
        "polluted_concat": polluted_concat,
        "egse_code_review": egse_review,
        "kse_long_no_history_review": kse_long_review,
        "mismatched_market": mismatched,
        "null_or_zero_price": null_price,
        "duplicate_name_groups": duplicates,
        "egksco_missing_from_egx": egksco_missing,
        "egx_not_in_egksco": egx_not_in_egksco,
        "recommendations": {
            "deactivate_polluted_explicit": [
                {
                    "id": c["id"],
                    "ticker": c["ticker"],
                    "clean_ticker": c["suggested_clean_ticker"],
                    "candidate_clean_ticker": c["candidate_clean_ticker"],
                    "reason": "ticker contains spaces/Arabic/punctuation"
                        + (f" — clean counterpart {c['suggested_clean_ticker']} exists, deactivate this duplicate"
                           if c["suggested_clean_ticker"] else
                           (f" — no clean counterpart in DB; candidate base = {c['candidate_clean_ticker']} (review: rename or deactivate)"
                            if c["candidate_clean_ticker"] else
                            " — no clean counterpart in DB; review manually")),
                }
                for c in polluted_explicit
            ],
            "deactivate_polluted_concat": [
                {
                    "id": c["id"],
                    "ticker": c["ticker"],
                    "clean_ticker": c["suggested_clean_ticker"],
                    "reason": "ticker is concatenation of <clean_ticker><name>D — duplicate of existing clean ticker",
                }
                for c in polluted_concat
            ],
            "review_egse_codes": [
                {
                    "id": c["id"],
                    "ticker": c["ticker"],
                    "reason": "EGSE security-code style; not a standard EGX trading ticker. Review manually whether to keep or map to short ticker.",
                }
                for c in egse_review
            ],
            "review_kse_long_no_history": [
                {
                    "id": c["id"],
                    "ticker": c["ticker"],
                    "reason": "Long uppercase KSE-style ticker but no price history — likely pollution or stale entry.",
                }
                for c in kse_long_review
            ],
            "fix_mismatched_markets": [
                {
                    "id": m["id"],
                    "ticker": m["ticker"],
                    "name_ar": m["name_ar"],
                    "current_market": m["market"],
                    "suggested_market": m["expected_market"],
                    "reason": f"name_ar mentions '{m['country_found']}' but market is {m['market']}",
                }
                for m in mismatched
            ],
            "merge_duplicate_groups": [
                {
                    "name_ar": d["name_ar"],
                    "keep_ticker": next(
                        (e["ticker"] for e in sorted(
                            d["entries"],
                            key=lambda x: (
                                x["category"] != "clean",
                                -(x["price_history_rows"] or 0),
                                x["ticker"] is None,
                            ),
                        ) if e["category"] == "clean"),
                        None,
                    ),
                    "all_tickers": [e["ticker"] for e in d["entries"]],
                }
                for d in duplicates
            ],
            "add_egksco_missing": [
                {"ticker": tk, "reason": "present in egksco_stocks (official EGX source) but missing from stocks table"}
                for tk in egksco_missing
            ],
        },
        "note": (
            "No rows were deleted (per project rule #2). "
            "Use --apply to set is_active=0 on polluted_explicit + polluted_concat rows. "
            "A backup table stocks_backup_cleanup_004 is created when --apply is used."
        ),
    }

    # ── 13. Write JSON report
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n✓ JSON report written: {REPORT_JSON}")
    print(f"  Size: {REPORT_JSON.stat().st_size:,} bytes")

    # ── 14. Create stocks_cleanup_report table (idempotent)
    cur.execute("DROP TABLE IF EXISTS stocks_cleanup_report")
    cur.execute("""
        CREATE TABLE stocks_cleanup_report (
            id INTEGER PRIMARY KEY,
            stock_id INTEGER,
            ticker TEXT,
            market TEXT,
            category TEXT,
            suggested_clean_ticker TEXT,
            reason TEXT,
            price_history_rows INTEGER,
            reviewed INTEGER DEFAULT 0,
            action_taken TEXT,
            detected_at TEXT,
            FOREIGN KEY (stock_id) REFERENCES stocks(id)
        )
    """)
    now = datetime.now().isoformat(timespec="seconds")
    rows_to_insert = []
    for c in polluted_explicit:
        rows_to_insert.append((
            c["id"], c["ticker"], c["market"], "polluted_explicit",
            c["suggested_clean_ticker"],
            "ticker contains spaces/Arabic chars/lowercase/trailing punctuation",
            c["price_history_rows"], 0, None, now,
        ))
    for c in polluted_concat:
        rows_to_insert.append((
            c["id"], c["ticker"], c["market"], "polluted_concat",
            c["suggested_clean_ticker"],
            f"ticker = <base>{c['suggested_clean_ticker' ] or '?'}<name>D — duplicate of clean ticker",
            c["price_history_rows"], 0, None, now,
        ))
    for c in egse_review:
        rows_to_insert.append((
            c["id"], c["ticker"], c["market"], "egse_code_review",
            None, "EGSE-style security code — review whether to map to short ticker",
            c["price_history_rows"], 0, None, now,
        ))
    for c in kse_long_review:
        rows_to_insert.append((
            c["id"], c["ticker"], c["market"], "kse_long_no_history_review",
            c["suggested_clean_ticker"],
            "Long uppercase ticker without price history — likely pollution or stale",
            c["price_history_rows"], 0, None, now,
        ))
    for m in mismatched:
        rows_to_insert.append((
            m["id"], m["ticker"], m["market"], "mismatched_market",
            None,
            f"name_ar mentions '{m['country_found']}' but market={m['market']} (expected {m['expected_market']})",
            ph_counts.get(m["ticker"], 0), 0, None, now,
        ))
    for n in null_price:
        # Skip if already in another category for this stock_id
        if any(r[0] == n["id"] for r in rows_to_insert):
            continue
        rows_to_insert.append((
            n["id"], n["ticker"], n["market"], "null_or_zero_price",
            None, "current_price IS NULL or = 0",
            ph_counts.get(n["ticker"], 0), 0, None, now,
        ))
    cur.executemany(
        "INSERT INTO stocks_cleanup_report "
        "(stock_id, ticker, market, category, suggested_clean_ticker, reason, "
        "price_history_rows, reviewed, action_taken, detected_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows_to_insert,
    )
    con.commit()
    print(f"\n✓ Table stocks_cleanup_report created with {len(rows_to_insert)} entries")

    # ── 15. Apply is_active=0 if requested
    if apply:
        deactivate_ids = (
            [c["id"] for c in polluted_explicit]
            + [c["id"] for c in polluted_concat]
        )
        if deactivate_ids:
            placeholders = ",".join("?" * len(deactivate_ids))
            cur.execute(
                f"UPDATE stocks SET is_active = 0, updated_at = ? "
                f"WHERE id IN ({placeholders})",
                (now, *deactivate_ids),
            )
            con.commit()
            print(f"\n✓ Applied is_active=0 to {len(deactivate_ids)} polluted rows")
        else:
            print("\n✓ No polluted rows to deactivate")
    else:
        print("\n▶ Dry-run mode — no is_active changes. Use --apply to deactivate polluted rows.")

    con.close()

    # ── 16. Print summary
    print("\n" + "=" * 70)
    print("SUMMARY — DATA-CLEAN-004")
    print("=" * 70)
    print(f"Total stocks rows:                 {len(rows):>6}")
    for m, n in sorted(markets.items(), key=lambda x: -x[1]):
        print(f"  market={m:<10}                  {n:>6}")
    print(f"\nCategories:")
    for cat, n in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat:<32}  {n:>6}")
    print(f"\nIssues found:")
    print(f"  Polluted explicit (broken):      {len(polluted_explicit):>6}")
    print(f"  Polluted concat (ticker+name+D): {len(polluted_concat):>6}")
    print(f"  EGSE codes (review):             {len(egse_review):>6}")
    print(f"  KSE long no-history (review):    {len(kse_long_review):>6}")
    print(f"  Mismatched markets:              {len(mismatched):>6}")
    print(f"  Null/zero current_price:         {len(null_price):>6}")
    print(f"  Duplicate name_ar groups:        {len(duplicates):>6}")
    print(f"  EGKSco symbols missing in EGX:   {len(egksco_missing):>6}")
    print(f"  EGX tickers not in egksco:       {len(egx_not_in_egksco):>6}")
    print(f"\nTotal polluted to deactivate:     {len(polluted_explicit) + len(polluted_concat):>6}")
    print(f"Reports:")
    print(f"  JSON:  {REPORT_JSON}")
    print(f"  Table: stocks_cleanup_report in {STOCKS_DB.name}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze ticker pollution in db/stocks.db")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply is_active=0 on polluted_explicit + polluted_concat rows "
             "(creates a backup table first). Default is dry-run.",
    )
    args = parser.parse_args()
    sys.exit(main(apply=args.apply))

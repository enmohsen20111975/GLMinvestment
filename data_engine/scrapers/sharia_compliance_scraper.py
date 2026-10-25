#!/usr/bin/env python3
"""
🕌 Shariah Compliance Scraper — بيانات التوافق الشرعي والتطهير (EGX)
============================================================================
المصدر: https://stocks.templatesnippet.com  (static JSON، مفتوح، CORS allowed)

الصفحة /stocks client-rendered بالكامل، والبيانات كلها في ملف JSON ثابت:
    /data/stocks_merged.json   → 253 سهم × 32 حقل × 8 مصادر شرعية

ليه ملف JSON مش API؟
    - robots.txt بيمنع /api/ بس /data/ مفتوح
    - Access-Control-Allow-Origin: *  → ينفع من المتصفح أو السيرفر
    - مفيش تسجيل دخول ولا rate limit
    - ETag + Last-Modified موجودين → طلب شرطي (If-None-Match) بتكلفة ~0

الجدول: القاعدة الأساسية هي **معيار S&P** (نسبة التطهير × الأرباح المستلمة).
باقي المنهجيات (مصفّى / كاشف / أسطول) تُخزَّن كـ rates تكميلية في
sharia_purification_rates للاستخدام الاختياري، مش للحاسبة الأساسية.

الربط مع بياناتنا:
    stocks.db . stocks . ticker (market='EGX')  ==  المصدر . symbol
   zaijoin مباشر على الـ ticker (98% من الـ 253).
    `aaoifi_haram_earning_per_share` مرفوض (قيمه 4.7e-08 ج.م/سهم — غير
    متسقة مع نسبة S&P رياضياً) → بيتسجل للتوثيق فقط مع aaoifi_usable=0.

الاستخدام:
    python3 data_engine/scrapers/sharia_compliance_scraper.py            # fetch + write
    python3 data_engine/scrapers/sharia_compliance_scraper.py --dry-run  # preview only
    python3 data_engine/scrapers/sharia_compliance_scraper.py --force    # ignore ETag
    python3 data_engine/scrapers/sharia_compliance_scraper.py --sync-stocks
        # برضو يعبّي stocks.is_halal / compliance_* في stocks.db (opt-in)
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "db"

# ─── Try the canonical DB router, fall back to relative paths ────────────────
try:
    sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
    from utils.db_paths import DBPaths  # type: ignore

    DB_FILE = DBPaths.DATA_ENGINE_DB
    STOCKS_DB_FILE = DBPaths.STOCKS_DB
    MARKET_DB_FILE = DBPaths.MARKET_DB
except Exception:  # pragma: no cover - standalone execution fallback
    DB_FILE = str(DATA_DIR / "data_engine.db")
    STOCKS_DB_FILE = str(DATA_DIR / "stocks.db")
    MARKET_DB_FILE = str(DATA_DIR / "market.db")

SOURCE_URL = "https://stocks.templatesnippet.com/data/stocks_merged.json"
STATE_FILE = DATA_DIR / "sharia_scrape_state.json"
SNAPSHOT_FILE = DATA_DIR / "sharia_scrape_latest.json"

HTTP_TIMEOUT = 60
USER_AGENT = "GLMinvestment-ShariahScraper/1.0 (+weekly sync)"

ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_SUFFIX_RE = re.compile(r"\.(CA|EGX|EGXCA|COM|SA)$")
_ALNUM_RE = re.compile(r"[^A-Z0-9]")

# ─── المصدر الشرعي: metadata + خريطة الحقول ─────────────────────────────────
# methodology:
#   'S&P'          → التطهير = نسبة × (توزيعات + ربح رأسمالي)   [أساسي]
#   'PURIFICATION' → نسبة تطهير جاهزة، التوزيعات فقط             [تكميلي]
#   'LIST'         → قائمة ثنائية (متوافق / غير متوافق) بس
#   'CONSENSUS'    → اجماع 3 من 8 قوائم
SOURCES = {
    "halal_bourse": {
        "name_ar": "بورصة حلال",
        "methodology": "LIST",
        "url": "https://halalbourse.com",
    },
    "musaffa": {
        "name_ar": "مصفّى",
        "methodology": "PURIFICATION",
        "purification_basis": "dividends_only",
        "url": "https://musaffa.com",
    },
    "kashif": {
        "name_ar": "كاشف",
        "methodology": "PURIFICATION",
        "purification_basis": "dividends_only",
        "url": "https://kashif.app",
    },
    "halal_invest": {
        "name_ar": "حلال إنفست",
        "methodology": "LIST",
        "url": "https://halalinvest.com",
        "stale": True,
    },
    "faisal_bank": {
        "name_ar": "بنك فيصل الإسلامي المصري",
        "methodology": "LIST",
        "url": "https://fib.com.eg",
    },
    "osoul": {
        "name_ar": "أسطول لتداول الأوراق المالية",
        "methodology": "LIST",
        "url": "https://osoul-securities.com",
    },
    "thndr": {
        "name_ar": "ثندر / Islamicly",
        "methodology": "LIST",
        "url": "https://thndr.net",
    },
    "mohamed_ramadan_sharia": {
        "name_ar": "جروب الأسهم الشرعية فقط",
        "methodology": "CONSENSUS",
        "url": "",
    },
}

ACTIVE_SOURCES = [k for k, v in SOURCES.items() if not v.get("stale")]
CONSENSUS_MIN = 6  # أعلى من 6 مصادر من 8 → is_halal_consensus = 1

VALID_STATUS = {"compliant", "non_compliant", "doubtful", "not_available"}


def log(msg):
    print("[%s] %s" % (datetime.now().strftime("%H:%M:%S"), msg), flush=True)


# ─── HTTP with conditional GET ──────────────────────────────────────────────
def fetch_json(force=False):
    """Fetch stocks_merged.json. Returns (payload, meta). meta.status in
    {'ok', 'not_modified'} — 'not_modified' reuses the cached snapshot."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    state = {}
    if SNAPSHOT_FILE.exists():
        try:
            state = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
        except Exception:
            state = {}

    if not force:
        if state.get("etag"):
            headers["If-None-Match"] = state["etag"]
        elif state.get("last_modified"):
            headers["If-Modified-Since"] = state["last_modified"]

    req = urllib.request.Request(SOURCE_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            body = resp.read()
            meta = {
                "status": "ok",
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
                "http_date": resp.headers.get("Date"),
            }
    except urllib.error.HTTPError as e:
        if e.code == 304 and state.get("raw"):
            log("304 Not Modified — المصدر ما اتغيرش، بنستخدم الكاش")
            return json.loads(state["raw"]), {"status": "not_modified"}
        raise
    except Exception as e:
        if state.get("raw"):
            log("فشل الاتصال (%s) — بنستخدم الكاش المحلي" % str(e)[:60])
            return json.loads(state["raw"]), {"status": "cache_fallback"}
        raise

    return json.loads(body.decode("utf-8")), meta


# ─── Symbol handling ────────────────────────────────────────────────────────
def normalize_symbol(raw):
    """'efg.ca ' → 'EFG'. Baad-lou bar b7awl ama ted5ol fe regex ghالباً."""
    if not raw:
        return None
    s = str(raw).strip().upper()
    s = _SUFFIX_RE.sub("", s)
    s = _ALNUM_RE.sub("", s)
    return s or None


def arabic_prefix(raw):
    """الرمز اللاتيني اللي قبل أول حرف عربي: 'ABUKابوقير' → 'ABUK'."""
    if not raw:
        return None
    s = str(raw).strip()
    if not ARABIC_RE.search(s):
        return None
    m = re.match(r"^([A-Za-z0-9]{1,10})", s)
    return m.group(1).upper() if m else None


_DIACRITICS_RE = re.compile(r"[\u064B-\u0652\u0640]")
_NON_NAME_RE = re.compile(r"[^\w\u0600-\u06FF]+", re.UNICODE)


def normalize_name(raw):
    """مفتاح مطابقة للأسماء — بيحافظ على العربي.

    normalize_symbol unsuitable هنا: بيشيل كل حرف عربي وده بيخلي كل
    الأسماء العربية تتحول لمفتاح فاضي. الشكل النهائي بيشيل التشكيل
    (الهمزات والتطويل) ويوحّد المسافات وعلامات الترقيم.
    """
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    s = _DIACRITICS_RE.sub("", s)
    s = (s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
          .replace("ى", "ي").replace("ة", "ه"))
    s = _NON_NAME_RE.sub(" ", s)
    s = " ".join(s.split())
    return s or None


def to_float(value):
    """'6.00 EGP' → 6.0 · '0.00%' → 0.0 · '' → None"""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(m.group(0)) if m else None


def _table_exists(conn, table):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    return row is not None


def load_ticker_index():
    """كل مصادر الـ master عندنا — مش stocks.db بس.

    السبب: `stocks.db.stocks` فيه 383 ticker EGX بس، وفيه rows بـ ticker
    غلط (EFG محفوظ كـ HRHO · انترناشيونال بزنيس محفوظ كـ IBCT)، وكمان
    فيه أسهم ناقصة أصلاً (MBEN مش موجودة في أي جدول). و`market.db.stocks`
    (الهدف المعماري) فيه 454 ticker EGX وأسماؤه أنضف.

    مفاتيح:
        tickers      → set من كل tickers الـ EGX (مع fallback لو مفيش market col)
        name_index   → normalized(name|name_ar) → [(ticker, market, source_table)]
    """
    tickers, name_index, word_index = set(), {}, {}

    def harvest(db_path, table, ticker_col, market_filter="EGX"):
        if not os.path.exists(db_path):
            return
        try:
            conn = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True, timeout=15)
        except Exception as e:
            log("تحذير: %s (%s)" % (db_path, str(e)[:50]))
            return
        where_tbl = "%s.%s" % (os.path.basename(db_path), table)
        try:
            if not _table_exists(conn, table):
                return
            cols = {r[1] for r in conn.execute('PRAGMA table_info("%s")' % table)}
            if ticker_col not in cols:
                return
            name_cols = [c for c in ("name", "name_ar", "company") if c in cols]
            if not name_cols:
                return
            select = ", ".join(['"%s"' % c for c in [ticker_col] + name_cols])
            q = "SELECT %s FROM \"%s\"" % (select, table)
            if market_filter and "market" in cols:
                q += " WHERE market = '%s'" % market_filter
            for row in conn.execute(q):
                tk = (row[0] or "").strip().upper()
                if not tk:
                    continue
                tickers.add(tk)
                for idx, cname in enumerate(name_cols, start=1):
                    raw_name = row[idx]
                    if not raw_name:
                        continue
                    # الاسم العربي بيتسجل بمفتاح عربي — normalize_symbol
                    # بيمسح الحروف العربية كلها فلازم normalize_name.
                    key = normalize_name(raw_name)
                    if key:
                        name_index.setdefault(key, []).append((tk, where_tbl))
                    # reverse word index: الرمز ك كلمة كاملة جوه أي اسم
                    for w in re.findall(r"[A-Za-z][A-Za-z.&-]{2,}", str(raw_name)):
                        word_index.setdefault(w.strip(".&-").upper(), set()).add(tk)
        except Exception as e:
            log("تحذير: %s.%s (%s)" % (db_path, table, str(e)[:50]))
        finally:
            conn.close()

    harvest(STOCKS_DB_FILE, "stocks", "ticker")
    harvest(MARKET_DB_FILE, "stocks", "ticker")
    harvest(STOCKS_DB_FILE, "egksco_stocks", "symbol", market_filter=None)
    harvest(STOCKS_DB_FILE, "stocks_backup", "ticker", market_filter=None)
    return tickers, name_index, word_index


def load_known_tickers():
    """set بسيط بكل tickers الـ EGX (متوافق مع الاستدعاء القديم)."""
    return load_ticker_index()[0]


def resolve_aliases(records):
    """يبني خريطة raw_symbol → ticker عندنا مع درجة ثقة.

    المنهجيات مرتبة من الأقوى للأضعف:
      exact_ticker            نفس الرمز في أي master          → high
      arabic_prefix_ticker    الرمز ملزوق باسم عربي → فصله      → high
      name_exact_code_differs نفس الاسم (عربي/إنجليزي) بالظبط → medium + review
      symbol_in_name          الرمز كلمة كاملة في اسم الشركة عندنا → medium + review

    `code_differs` و `symbol_in_name` مش بيتطبّقوا صامت — بيتسجلوا في
    sharia_symbol_map بـ needs_review=1 لأن تغيّر الرمز محتاج تأكيد بشري
    (زي ما VLMR و VLMRA كلهم في stocks.db وطلعوا شركتين مختلفتين).
    """
    tickers, name_index, word_index = load_ticker_index()
    if not tickers:
        log("⚠️ مفيش أي master ticker اتقرا — الـ alias resolution هيتخطّى")
        return {}, set(), []

    source_symbols = {
        str(r.get("symbol") or "").strip().upper()
        for r in records if r.get("symbol")
    }

    mapping, unresolved, review = {}, set(), []

    for rec in records:
        raw = str(rec.get("symbol") or "").strip().upper()
        if not raw:
            continue
        name_ar = (rec.get("name_ar") or "").strip()
        name_en = (rec.get("name_en") or "").strip()

        if raw in tickers:
            mapping[raw] = (raw, "exact_ticker", "high", 0, "", rec)
            continue

        ap = arabic_prefix(raw)
        if ap and ap in tickers:
            mapping[raw] = (ap, "arabic_prefix_ticker", "high", 0, "", rec)
            continue

        hit = None
        # 1) نفس الاسم بالظبط (عربي أو إنجليزي)
        for cand in (name_ar, name_en):
            key = normalize_name(cand)
            if key and key in name_index:
                tk, where = name_index[key][0]
                hit = ("name_exact_code_differs", tk, "medium", 1, where)
                break
        # 2) الرمز ك كلمة كاملة جوه اسم الشركة عندنا
        if hit is None and len(raw) >= 3:
            cands = word_index.get(raw) or set()
            # نستبعد ticker نفسه لو موجود (ده exact اتغطى فوق)
            cands = {t for t in cands if t != raw}
            if len(cands) == 1:
                tk = next(iter(cands))
                hit = ("symbol_in_name", tk, "medium", 1, "stocks.db.stocks|market.db.stocks")

        if hit:
            method, tk, conf, review_flag, where = hit
            # ── collision guard ──
            # لو المصدر نفسه فيه symbol = tk (سهم تاني مستقل)، يبقى ده
            # تعارض مش alias: رمزان مختلفان في المصدر بنفس الاسم العربي
            # (زي KORA و KORRA، أو زي VLMR و VLMRA عندنا). الدمج هنا
            # هيخلط شركتين مختلفتين — فبنرفض الربط ونبلّغ.
            if tk != raw and tk in source_symbols:
                review.append((
                    raw, tk, "collision_with_existing_source_symbol", "conflict",
                    where, name_ar or name_en or raw,
                    "المصدر فيه '%s' كسهم مستقل بنفس الاسم — محتاج قرار بشري" % tk,
                ))
                unresolved.add(raw)
                continue
            mapping[raw] = (tk, method, conf, review_flag, where, rec)
            review.append((raw, tk, method, conf, where, name_ar or name_en or raw, ""))
        else:
            unresolved.add(raw)

    return mapping, unresolved, review


def record_has_data(rec):
    """السجلات اللي مفيهاش أي بيانات شرعية خالص — نتجاهلها.

    معيار الحذف: لا category ولا رقم مالي ولا حكم من أي مصدر. السجلات
    اللي category فيها فاضي بس فيها أحكام مصادر (زي KORA / KORRA) لازم
    تفضل — الحكم الشرعي هو أهم حاجة في الجدول.
    """
    if rec.get("category"):
        return True
    if any(rec.get(k) is not None
           for k in ("sp_haram_earning_percentage", "aaoifi_haram_earning_per_share",
                     "dividend", "dividend_yield", "zakat")):
        return True
    for key in SOURCES:
        st = (rec.get(key) or {}).get("status")
        if st in VALID_STATUS:
            return True
    return False


# ─── Schema ─────────────────────────────────────────────────────────────────
DDL = [
    """
    CREATE TABLE IF NOT EXISTS sharia_sources (
        source_key     TEXT PRIMARY KEY,
        name_ar        TEXT,
        methodology    TEXT,
        purification_basis TEXT,
        source_url     TEXT,
        is_active      INTEGER DEFAULT 1,
        last_synced_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sharia_source_status (
        symbol          TEXT NOT NULL,
        source_key      TEXT NOT NULL,
        status          TEXT,
        percentage      REAL,
        note            TEXT,
        sector          TEXT,
        grade           TEXT,
        statement_date  TEXT,
        source_updated  TEXT,
        synced_at       TEXT,
        PRIMARY KEY (symbol, source_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sharia_metrics (
        symbol                   TEXT PRIMARY KEY,
        raw_symbol               TEXT,
        name_ar                  TEXT,
        category                  TEXT,
        category_ar               TEXT,
        market                    TEXT,
        sp_haram_earning_pct      REAL,
        aaoifi_per_share          REAL,
        aaoifi_usable             INTEGER DEFAULT 0,
        haram_earnings_pct        REAL,
        loans_pct                 REAL,
        zakat_per_share           REAL,
        dividend                  REAL,
        dividend_yield            REAL,
        core_activity_ok          INTEGER,
        cash_liquidity_ok         INTEGER,
        haram_investments_ok      INTEGER,
        compliant_sources_count   INTEGER DEFAULT 0,
        active_sources_count      INTEGER DEFAULT 0,
        is_halal_consensus        INTEGER DEFAULT 0,
        alias_method              TEXT,
        alias_confidence          TEXT,
        needs_review              INTEGER DEFAULT 0,
        kashif_purity             REAL,
        kashif_haram_pct          REAL,
        kashif_statement_date     TEXT,
        musaffa_grade             TEXT,
        osoul_haram_pct           REAL,
        osoul_loans_pct           REAL,
        osoul_deposits_pct        REAL,
        osoul_liquid_assets_pct   REAL,
        osoul_avg_market_cap      REAL,
        osoul_total_assets        REAL,
        source_updated_max        TEXT,
        synced_at                 TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sharia_purification_rates (
        symbol         TEXT NOT NULL,
        method_key     TEXT NOT NULL,
        method_name_ar TEXT,
        rate_pct       REAL,
        basis          TEXT,
        is_primary     INTEGER DEFAULT 0,
        source_updated TEXT,
        synced_at      TEXT,
        PRIMARY KEY (symbol, method_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sharia_symbol_map (
        source_symbol   TEXT PRIMARY KEY,
        resolved_ticker TEXT,
        match_method    TEXT,
        confidence      TEXT,
        needs_review    INTEGER DEFAULT 0,
        source_name_ar  TEXT,
        matched_in      TEXT,
        resolved_at     TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sharia_history (
        symbol                 TEXT NOT NULL,
        snapshot_date          TEXT NOT NULL,
        compliant_count        INTEGER,
        active_count           INTEGER,
        sp_haram_earning_pct   REAL,
        is_halal_consensus     INTEGER,
        PRIMARY KEY (symbol, snapshot_date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sharia_status_symbol ON sharia_source_status(symbol)",
    "CREATE INDEX IF NOT EXISTS idx_sharia_status_source ON sharia_source_status(source_key, status)",
    "CREATE INDEX IF NOT EXISTS idx_sharia_rates_method ON sharia_purification_rates(method_key, is_primary)",
    "CREATE INDEX IF NOT EXISTS idx_sharia_metrics_consensus ON sharia_metrics(is_halal_consensus, compliant_sources_count)",
]

STOCKS_DDL = [
    "ALTER TABLE stocks ADD COLUMN is_halal INTEGER DEFAULT 0",
    "ALTER TABLE stocks ADD COLUMN compliance_status TEXT",
    "ALTER TABLE stocks ADD COLUMN compliance_note TEXT",
    "ALTER TABLE stocks ADD COLUMN compliance_last_reviewed TEXT",
    "ALTER TABLE stocks ADD COLUMN sharia_purification_pct REAL",
]


# ─── Transform ──────────────────────────────────────────────────────────────
def build_rows(records, alias_map, now):
    """يحوّل الـ JSON الخام إلى صفوف جاهزة للكتابة."""
    today = now[:10]
    status_rows, metric_rows, rate_rows, hist_rows = [], [], [], []
    map_rows = []

    for rec in records:
        if not record_has_data(rec):
            continue
        raw = str(rec.get("symbol") or "").strip().upper()
        alias = alias_map.get(raw)
        if alias:
            sym = alias[0]
            alias_method, alias_conf = alias[1], alias[2]
            needs_review = alias[3]
        else:
            sym = normalize_symbol(raw)
            alias_method, alias_conf, needs_review = "unresolved", "none", 1
        if not sym:
            continue

        map_rows.append((
            raw, sym, alias_method, alias_conf, needs_review,
            (rec.get("name_ar") or "").strip() or None,
            alias[4] if alias else None,
            now,
        ))

        compliant = 0
        active_seen = 0
        source_dates = []

        for key in SOURCES:
            node = rec.get(key) or {}
            st = (node.get("status") or "").strip() or None
            pct = to_float(node.get("percentage"))
            upd = (node.get("last_updated") or "").strip() or None

            if st in VALID_STATUS:
                active_seen += 1
                if st == "compliant":
                    compliant += 1
            if upd:
                source_dates.append(upd[:10])

            status_rows.append((
                sym, key, st, pct,
                (node.get("note") or "").strip() or None,
                (node.get("sector") or "").strip() or None,
                (node.get("grade") or "").strip() or None,
                (node.get("statement_date") or "").strip() or None,
                upd, now,
            ))

        sp_pct = to_float(rec.get("sp_haram_earning_percentage"))
        aaoifi = to_float(rec.get("aaoifi_haram_earning_per_share"))
        osoul = rec.get("osoul") or {}
        kashif = rec.get("kashif") or {}
        musaffa = rec.get("musaffa") or {}

        metric_rows.append((
            sym, raw,
            (rec.get("name_ar") or "").strip() or None,
            (rec.get("category") or "").strip() or None,
            (rec.get("category_ar") or "").strip() or None,
            rec.get("market") or "EGX",
            sp_pct,
            aaoifi,
            0,  # aaoifi_usable=0 — القيمة المنشورة غير متسقة مع sp% رياضياً
            to_float(rec.get("haram_earnings_percentage")),
            to_float(rec.get("loans_percentage")),
            to_float(rec.get("zakat")),
            to_float(rec.get("dividend")),
            to_float(rec.get("dividend_yield")),
            _bool_int(rec.get("core_activity_compliant")),
            _bool_int(rec.get("cash_liquidity_compliant")),
            _bool_int(rec.get("haram_investments_compliant")),
            compliant, active_seen,
            1 if compliant >= CONSENSUS_MIN else 0,
            alias_method, alias_conf, needs_review,
            to_float(kashif.get("purity")),
            to_float(kashif.get("haram_percentage")),
            (kashif.get("statement_date") or "").strip() or None,
            (musaffa.get("grade") or "").strip() or None,
            to_float(osoul.get("haram_percentage")),
            to_float(osoul.get("loans_percentage")),
            to_float(osoul.get("deposits_percentage")),
            to_float(osoul.get("liquid_assets_percentage")),
            to_float(osoul.get("avg_market_cap")),
            to_float(osoul.get("total_assets")),
            max(source_dates) if source_dates else None,
            now,
        ))

        # ── نسب التطهير: S&P أساسي + الباقي تكميلي ──
        if sp_pct is not None:
            rate_rows.append((
                sym, "S&P", "معيار S&P الشرعية", sp_pct,
                "dividends_plus_capital_gain", 1,
                max(source_dates) if source_dates else None, now,
            ))
        for mkey, node, basis in (
            ("musaffa", musaffa, "dividends_only"),
            ("kashif", kashif, "dividends_only"),
            ("osoul", osoul, "dividends_only"),
        ):
            rate = to_float(node.get("haram_percentage"))
            if rate is None and mkey == "musaffa":
                rate = to_float(node.get("percentage"))
            if rate is None:
                continue
            rate_rows.append((
                sym, mkey, SOURCES[mkey]["name_ar"], rate, basis, 0,
                (node.get("last_updated") or "").strip() or None, now,
            ))

        hist_rows.append((
            sym, today, compliant, active_seen, sp_pct,
            1 if compliant >= CONSENSUS_MIN else 0,
        ))

    return status_rows, metric_rows, rate_rows, hist_rows, map_rows


def _bool_int(v):
    return None if v is None else (1 if v else 0)


# ─── Write ──────────────────────────────────────────────────────────────────
# أعمدة بتتحمل على sharia_metrics لو الجدول موجود من نسخة أقدم.
# CREATE TABLE IF NOT EXISTS مش بيضيف عمود جديد على جدول موجود.
METRICS_MIGRATIONS = [
    ("alias_method", "TEXT"),
    ("alias_confidence", "TEXT"),
    ("needs_review", "INTEGER DEFAULT 0"),
]


def _ensure_columns(cur, table, columns):
    existing = {r[1] for r in cur.execute('PRAGMA table_info("%s")' % table)}
    added = []
    for name, coltype in columns:
        if name not in existing:
            cur.execute('ALTER TABLE "%s" ADD COLUMN "%s" %s' % (table, name, coltype))
            added.append(name)
    return added


def write_db(rows, dry_run=False):
    status_rows, metric_rows, rate_rows, hist_rows, map_rows = rows
    if dry_run:
        log("[dry-run] status=%d metrics=%d rates=%d history=%d symbol_map=%d (مفيش كتابة)"
            % (len(status_rows), len(metric_rows), len(rate_rows),
               len(hist_rows), len(map_rows)))
        return

    conn = sqlite3.connect(DB_FILE, timeout=60)
    cur = conn.cursor()
    for ddl in DDL:
        cur.execute(ddl)
    added = _ensure_columns(cur, "sharia_metrics", METRICS_MIGRATIONS)
    if added:
        log("🗄️  أعمدة جديدة في sharia_metrics: %s" % ", ".join(added))
    now = datetime.now(timezone.utc).isoformat()
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_sources "
        "(source_key, name_ar, methodology, purification_basis, source_url, is_active, last_synced_at) "
        "VALUES (?,?,?,?,?,?,?)",
        [(k, v["name_ar"], v["methodology"], v.get("purification_basis"),
          v.get("url"), 0 if v.get("stale") else 1, now) for k, v in SOURCES.items()],
    )
    cur.execute("DELETE FROM sharia_source_status")
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_source_status "
        "(symbol, source_key, status, percentage, note, sector, grade, statement_date, source_updated, synced_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)", status_rows)
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_metrics "
        "(symbol, raw_symbol, name_ar, category, category_ar, market, "
        " sp_haram_earning_pct, aaoifi_per_share, aaoifi_usable, haram_earnings_pct, loans_pct, "
        " zakat_per_share, dividend, dividend_yield, core_activity_ok, cash_liquidity_ok, "
        " haram_investments_ok, compliant_sources_count, active_sources_count, is_halal_consensus, "
        " alias_method, alias_confidence, needs_review, "
        " kashif_purity, kashif_haram_pct, kashif_statement_date, musaffa_grade, "
        " osoul_haram_pct, osoul_loans_pct, osoul_deposits_pct, osoul_liquid_assets_pct, "
        " osoul_avg_market_cap, osoul_total_assets, source_updated_max, synced_at) "
        "VALUES (" + ",".join(["?"] * 35) + ")", metric_rows)
    cur.execute("DELETE FROM sharia_purification_rates")
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_purification_rates "
        "(symbol, method_key, method_name_ar, rate_pct, basis, is_primary, source_updated, synced_at) "
        "VALUES (?,?,?,?,?,?,?,?)", rate_rows)
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_history "
        "(symbol, snapshot_date, compliant_count, active_count, sp_haram_earning_pct, is_halal_consensus) "
        "VALUES (?,?,?,?,?,?)", hist_rows)
    cur.execute("DELETE FROM sharia_symbol_map")
    cur.executemany(
        "INSERT OR REPLACE INTO sharia_symbol_map "
        "(source_symbol, resolved_ticker, match_method, confidence, needs_review, "
        " source_name_ar, matched_in, resolved_at) "
        "VALUES (?,?,?,?,?,?,?,?)", map_rows)
    conn.commit()
    conn.close()
    log("✅ كُتب في %s" % DB_FILE)


def sync_stocks_flags(metric_rows):
    """يعبّي stocks.is_halal + compliance_* — opt-in (--sync-stocks)."""
    if not os.path.exists(STOCKS_DB_FILE):
        log("تحذير: stocks.db مش موجود")
        return
    conn = sqlite3.connect(STOCKS_DB_FILE, timeout=60)
    cur = conn.cursor()
    existing = {r[1] for r in cur.execute("PRAGMA table_info(stocks)")}
    applied = []
    for ddl in STOCKS_DDL:
        col = ddl.split("ADD COLUMN")[1].strip().split()[0]
        if col not in existing:
            try:
                cur.execute(ddl)
                applied.append(col)
            except sqlite3.OperationalError:
                pass
    if applied:
        log("أعمدة جديدة في stocks: %s" % ", ".join(applied))
    else:
        log("أعمدة compliance موجودة بالفعل")

    today = datetime.now(timezone.utc).date().isoformat()
    n = 0
    for row in metric_rows:
        sym = row[0]
        cnt = row[17]
        consensus = row[19]
        sp_pct = row[6]
        cur.execute(
            "UPDATE stocks SET is_halal=?, compliance_status=?, compliance_note=?, "
            "compliance_last_reviewed=?, sharia_purification_pct=? WHERE ticker=?",
            (
                consensus,
                "halal" if consensus else "non_halal",
                "متوافق في %d/%d مصدر شرعي" % (cnt, row[18]),
                today, sp_pct, sym,
            ),
        )
        n += cur.rowcount if cur.rowcount > 0 else 0
    conn.commit()
    conn.close()
    log("✅ حدّث %d صف في stocks.is_halal" % n)


def write_state(meta):
    if not meta or meta.get("status") != "ok":
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({
        "etag": meta.get("etag"),
        "last_modified": meta.get("last_modified"),
        "last_sync": datetime.now(timezone.utc).isoformat(),
    }, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Shariah compliance scraper (EGX)")
    ap.add_argument("--dry-run", action="store_true", help="بدون كتابة في الـ DB")
    ap.add_argument("--force", action="store_true", help="تجاهل الـ ETag")
    ap.add_argument("--sync-stocks", action="store_true",
                    help="عبّي stocks.is_halal + compliance_* (schema change)")
    args = ap.parse_args()

    log("=" * 60)
    log("🕌 Shariah Compliance Scraper — EGX")
    log("📡 %s" % SOURCE_URL)
    log("=" * 60)

    payload, meta = fetch_json(force=args.force)
    if not isinstance(payload, list) or not payload:
        log("❌ استجابة غير متوقعة من المصدر")
        return 1

    log("📦 %d سجل من المصدر (meta: %s)" % (len(payload), meta.get("status")))

    alias_map, unresolved, review = resolve_aliases(payload)
    log("🔗 alias resolution: %d/%d مربوطين · %d غير موجودين · %d محتاج مراجعة يدوية"
        % (len(alias_map), len(payload), len(unresolved), len(review)))
    if review:
        log("   ⚠️  الرمز مختلف عن المصدر — بيتسجل ومتخليش على نظرة واحدة:")
        for item in review:
            src, tk, method, conf, where, nm = item[:6]
            extra = " — %s" % item[6] if len(item) > 6 and item[6] else ""
            log("      %-8s → %-8s  [%s / %s]%s" % (src, tk, method, conf, extra))
            log("          في %s  (%s)" % (where or "-", (nm or "")[:46]))
    if unresolved:
        log("   ⚠️ غير موجودين في أي master عندنا: %s" % ", ".join(sorted(unresolved)))

    now = datetime.now(timezone.utc).isoformat()
    rows = build_rows(payload, alias_map, now)
    write_db(rows, dry_run=args.dry_run)

    if not args.dry_run:
        # cache + state (مهم لو حصل 304 الأسبوع اللي بعده)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_FILE.write_text(json.dumps(
            {"raw": json.dumps(payload, ensure_ascii=False),
             "fetched_at": now}, ensure_ascii=False), encoding="utf-8")
        write_state(meta)

    if args.sync_stocks and not args.dry_run:
        sync_stocks_flags(rows[1])

    status_rows, metric_rows, rate_rows, hist_rows, map_rows = rows
    sp_ready = sum(1 for r in rate_rows if r[5] == 1)
    # metric_cols: 19=is_halal_consensus · 21=alias_confidence · 22=needs_review
    consensus = sum(1 for r in metric_rows if r[19] == 1)
    pending = sum(1 for r in metric_rows if r[22] == 1)
    log("─" * 60)
    log("📊 metrics=%d · source_status=%d · purification_rates=%d (S&P=%d)"
        % (len(metric_rows), len(status_rows), len(rate_rows), sp_ready))
    log("✅ stocks متوافق في %d مصدر أو أكتر: %d سهم" % (CONSENSUS_MIN, consensus))
    if pending:
        log("🔍 محتاجة مراجعة alias: %d سهم (شوف sharia_symbol_map)" % pending)
    log("═" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())

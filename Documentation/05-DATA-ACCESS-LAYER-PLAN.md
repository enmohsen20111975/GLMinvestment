# 05 — خطة طبقة الوصول للبيانات (النسخة النهائية v3)

> **الحالة:** معتمدة للتنفيذ — Phase 0 (Audit) مكتمل  
> **التاريخ:** 2026-10-22 (محدّث بعد الـ audit الفعلي)  
> **المرجعية:** Rule 20 (Python=Brain) + Rule 28 (No-duplication) + Rule 66 (Source-authority) + Rule 56 (No dynamic SQL)  
> **السابق:** `archive/05-DATA-ACCESS-LAYER-PLAN-v1.md` (ملغاة — مخالفة Rule 20)

---

## 📊 نتيجة الـ Audit الفعلي (Phase 0 — مكتمل)

تم استخراج كل SQL queries من الـ 143 route اللي بتفتح DB مباشرة (بدون Python proxy).

### الأرقام الحقيقية

| المؤشر | القيمة | المصدر |
|---|---|---|
| إجمالي API routes | 464 | `find src/app/api -name "route.ts" \| wc -l` |
| Routes بتستخدم `better-sqlite3` مباشرة | 100 | `grep -rln "new Database\|\.prepare(" src/app/api/` |
| Routes هجينة (Python + DB fallback) | 22 | بتـ fetch من Python + بتفتح DB كـ fallback |
| Routes DB-ONLY (لا Python خالص) | 143 | بتفتح DB مباشرة بدون أي Python |
| **SQL queries فريدة (normalized)** | **186** | بعد `sed "s/'[^']*'/?/g" \| sort \| uniq` |
| Routes معقدة (logic > 5 سطور compute) | 15 | فيها `.reduce()` / `.map()` / joins / aggregations |
| Routes بسيطة (SELECT + return) | 128 | ممكن تتحول لـ generic query |
| Python endpoints موجودة بالفعل | 446 | `grep -rnE "@.*\.route\(" vps-service/api/*.py` |
| Python blueprints موجودة | 37 | `grep -rln "Blueprint" vps-service/api/*.py` |

### توزيع الـ DB usage

| DB | عدد الـ routes اللي بتـ read منها |
|---|---|
| `stocks.db` | 216 |
| `predictions.db` | 121 |
| `data_engine.db` | 111 |
| `price_history.db` | 35 |
| `auth.db` | 21 |
| `news.db` | 20 |
| `intraday.db` | 9 |

### الـ Top 30 queries الأكثر تكراراً

```
 32  SELECT name FROM sqlite_master WHERE type='table'
 15  SELECT COUNT(*) as c FROM predictions
 10  SELECT * FROM portfolio_assets
  6  SELECT COUNT(*) as count FROM stocks
  5  UPDATE stocks SET ...
  5  SELECT id FROM stocks WHERE ticker = ?
  5  SELECT * FROM stocks WHERE ...
  4  SELECT name, price, change_percent FROM stocks WHERE symbol = ?
  4  SELECT current_price FROM stocks WHERE ticker = ?
  4  SELECT close_price FROM stock_price_history WHERE stock_id = ?
  4  SELECT COUNT(*) as c FROM radar_signal_tracking
  4  DELETE FROM market_news WHERE ...
  3  SELECT ticker, name, name_ar FROM stocks WHERE ...
  3  SELECT * FROM investors_data WHERE ...
  3  INSERT INTO stocks ...
  2  SELECT ticker, name_ar, current_price FROM stocks WHERE ...
```

### الـ 15 routes المعقدة (محتاجة Python endpoints مخصصة)

| Route | السطور | الـ compute | السبب |
|---|---|---|---|
| `predictions/honest-tracking/list` | 818 | 20 | joins + aggregations + KPI alignment |
| `radar/accuracy` | 740 | 24 | backtest calculations + stats |
| `admin/platform-performance` | 657 | 37 | multi-DB joins + complex metrics |
| `predictions/honest-tracking/stats` | 640 | 45 | win-rate calculations + HARD caps |
| `finance/calculate-values` | 638 | 43 | financial formulas |
| `admin/users` | 628 | 28 | user management + subscription logic |
| `admin/db-manager/repair` | 586 | 9 | DB repair operations |
| `maker-radar/timeline` | 575 | 15 | timeline aggregation |
| `admin/system-resources` | 556 | 27 | system monitoring |
| `market/sync-live` | 533 | 17 | live sync logic |
| `portfolio/rescue` | 527 | 17 | rescue calculations |
| `egx/investors` | 525 | 14 | investor flow + auto-seed |
| `predictions/expert-consensus` | 479 | 21 | consensus engine |
| `deal-advisor/[ticker]` | 1012 | 21 | deal advisor logic |
| `market/scheduled-sync` | 530 | 8 | scheduled sync |

---

## 🏛️ المعمارية الجديدة (AFTER)

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                   │
└──────────────────────────┬──────────────────────────────┘
                           │ fetch('/api/*')
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Next.js API Routes (464)                    │
│                                                          │
│  ┌───────────────┐  ┌───────────────────────────────┐   │
│  │ Category A    │  │ Category B (proxy to Python)  │   │
│  │ ~15 routes    │  │ ~449 routes                   │   │
│  │ Auth/Sub/     │  │                               │   │
│  │ Paywall       │  │  /api/proxy/[...path]         │   │
│  │               │  │  /api/python/[...path]        │   │
│  │ → queryDb()   │  │  /api/proxy-prod/[...path]   │   │
│  │   (Phase 3)  │  │                               │   │
│  └───────┬───────┘  └───────────┬───────────────────┘   │
│          │                      │                       │
└──────────┼──────────────────────┼───────────────────────┘
           │                      │ fetch('http://127.0.0.1:8010/...')
           │                      │ + X-User-Id + X-User-Tier
           ▼                      ▼
   ┌──────────────┐  ┌──────────────────────────────────┐
   │  auth.db     │  │     Python Backend (:8010)       │
   │  (Prisma)    │  │     vps-service/main.py           │
   └──────────────┘  │                                   │
                     │  ┌─────────────────────────────┐  │
                     │  │ Flask Blueprints (37)       │  │
                     │  │ + Generic Query Executor     │  │
                     │  │   (NEW — 1 endpoint +        │  │
                     │  │    186 query registry)       │  │
                     │  └──────────┬──────────────────┘  │
                     │             │                     │
                     │  ┌──────────▼──────────────────┐  │
                     │  │ core/db_manager.py          │  │
                     │  │ (single entry for ALL DBs)   │  │
                     │  └──────────┬──────────────────┘  │
                     │             │                     │
                     │  ┌──────────▼──────────────────┐  │
                     │  │ source_authority.py          │  │
                     │  │ + ticker_validator.py        │  │
                     │  │ + write_guarded()            │  │
                     │  └─────────────────────────────┘  │
                     └───────────────┬───────────────────┘
                                     │
                                     ▼
                     ┌──────────────────────────────────┐
                     │       SQLite Databases            │
                     │                                   │
                     │  ✅ price_history.db (canonical)  │
                     │  ✅ stocks.db (metadata+active)   │
                     │  ✅ predictions.db                 │
                     │  ✅ data_engine.db                │
                     │  ✅ intraday.db                    │
                     │  ✅ news.db                        │
                     │  ✅ auth.db (Node-owned)          │
                     │                                   │
                     │  ❌ gold_prices.db (phantom)       │
                     │  ❌ historical.db (not found)      │
                     │  ❌ community.db (alias mismatch)  │
                     └──────────────────────────────────┘
```

### الـ layers (4 نظيفة)

```
Layer 4: Browser (React SPA)                    ✅
Layer 3: Next.js API Routes (auth + proxy)      ✅
         ├─ Category A: auth.db (queryDb helper)
         └─ Category B: proxy → Python
Layer 2: Python Backend (Business Logic)        ✅
         └─ core/db_manager.py (single entry)
              ├─ Generic Query Executor (NEW)
              ├─ 15 domain-specific endpoints
              └─ source_authority + ticker_validator
Layer 1: SQLite Databases (canonical sources)   ✅
```

---

## 🔑 المبادئ الحاكمة (Non-negotiables)

| المبدأ | القاعدة | التطبيق |
|---|---|---|
| **Python = Brain** | Rule 20 | كل business data read عبر Python endpoint. TS = proxy فقط. |
| **No new layer** | Rule 28 | ممنوع طبقة TS سابعة. `shared-db.ts` + `api-client.ts` + `db_manager.py` = كافيين. |
| **Source Authority** | Rule 66 | كل مصدر بيانات له canonical واحد. `write_guarded()` إلزامي. |
| **No dynamic SQL from user** | Rule 56 | الـ Generic Query Executor = whitelist registry فقط. مش user-provided SQL. |
| **No business logic in TS** | Rule 20 + 67 | TS مجرد forwarder. حتى validation = Python. |
| **Evidence-based** | Rule 68 | كل claim بـ grep/COUNT/curl قبل الـ commit. |
| **Push after each task** | Rule 75 | كل task = commit + push + worklog entry. |
| **No new file without approval** | Rule 4 | كل إضافة ملف = موافقة المالك أولاً. |

---

## 📅 خطة التنفيذ (4-5 أيام)

### 🔵 Phase 1 — إصلاح ملكية البيانات (يوم 1، صبح)

**الهدف:** كل domain له canonical source واحد. إزالة الـ phantom DBs.

#### 1.1 — إزالة `gold_prices.db` phantom

```bash
# فحص:
grep -rn "gold_prices.db" src/ vps-service/ scripts/ 2>/dev/null
# النتيجة المتوقعة: 3 ملفات بتشير لـ gold_prices.db

# الإصلاح:
# في كل ملف: استبدل gold_prices.db بـ data_engine.db (الـ gold_prices table موجودة هناك)
# ملفات متوقعة:
#   src/lib/sqlite-admin.ts
#   src/app/api/admin/db-backup/route.ts
#   src/app/api/admin/system-health/route.ts (أو ما يعادله)
```

**التحقق:** `grep -rn "gold_prices.db" src/ vps-service/` = 0 results.

#### 1.2 — إزالة `historical.db` references

```bash
# فحص:
grep -rn "historical\.db" src/ vps-service/ scripts/ 2>/dev/null
# historical.db مش موجود على الساند بوكس ولا الإنتاج
# بس ممكن يكون referenced في الكود

# الإصلاح:
# لو فيه references → استبدل بـ price_history.db (للـ EGX)
# أو data_engine.db.historical_data (للـ multi-market)
```

#### 1.3 — تأكيد canonical sources

| Domain | Canonical Source | Notes |
|---|---|---|
| EGX prices | `price_history.db.price_history` | 1.4M rows على الإنتاج |
| EGX metadata | `stocks.db.stocks` | 353 active tickers (بعد purge) |
| Predictions | `predictions.db.predictions` + `stored_analyses` | |
| Fundamentals | `data_engine.db` (tab_* tables + gold/silver/exchange) | |
| Intraday | `intraday.db.stock_intraday` | |
| Auth | `auth.db` (Node-owned, Prisma) | |
| News | `news.db.market_news` | |

**الـ Deliverable:** ملف `scripts/audit/canonical_sources.json` يوثّق كل domain + مصدره.

**Gate:** المالك يراجع قبل الانتقال لـ Phase 2.

---

### 🟢 Phase 2 — بناء Generic Query Executor (يوم 1، بعد الظهر)

**الهدف:** Python endpoint واحد + 186 query في registry. آمن (whitelist + parameterized).

#### 2.1 — إنشاء `vps-service/api/generic_query.py`

**الـ architecture:**

```python
"""
generic_query.py — Generic Query Executor (Rule 56 compliant)
=============================================================
بدل 143 Python endpoint، نكتب 1 endpoint + QUERY_REGISTRY.

Security (Rule 56 — No dynamic SQL from user):
- كل query مسجّلة في QUERY_REGISTRY (whitelist).
- مفيش user-provided SQL أبداً.
- كل params = ? placeholders (parameterized).
- كل table/column = fixed string (مش من user input).
"""

QUERY_REGISTRY = {
    # === stocks.db ===
    "stocks.by_ticker": {
        "db": "stocks.db",
        "sql": "SELECT ticker, name, name_ar, market, sector, current_price, "
               "change_percent, volume, last_update "
               "FROM stocks WHERE ticker = ? AND (is_active = 1 OR is_active IS NULL)",
        "params": ["ticker"],
        "returns": "single",
    },
    "stocks.by_market": {
        "db": "stocks.db",
        "sql": "SELECT ticker, name_ar, current_price, change_percent, sector "
               "FROM stocks WHERE market = ? AND (is_active = 1 OR is_active IS NULL) "
               "ORDER BY ticker",
        "params": ["market"],
        "returns": "list",
    },
    "stocks.count_by_market": {
        "db": "stocks.db",
        "sql": "SELECT COUNT(*) as count FROM stocks "
               "WHERE market = ? AND (is_active = 1 OR is_active IS NULL)",
        "params": ["market"],
        "returns": "single",
    },
    # === predictions.db ===
    "predictions.open": {
        "db": "predictions.db",
        "sql": "SELECT * FROM predictions WHERE outcome_date IS NULL "
               "ORDER BY prediction_date DESC LIMIT ?",
        "params": ["limit"],
        "returns": "list",
    },
    "predictions.closed": {
        "db": "predictions.db",
        "sql": "SELECT * FROM predictions WHERE outcome_date IS NOT NULL "
               "ORDER BY outcome_date DESC LIMIT ?",
        "params": ["limit"],
        "returns": "list",
    },
    "predictions.by_ticker": {
        "db": "predictions.db",
        "sql": "SELECT * FROM predictions WHERE ticker = ? "
               "ORDER BY prediction_date DESC LIMIT ?",
        "params": ["ticker", "limit"],
        "returns": "list",
    },
    "predictions.performance": {
        "db": "predictions.db",
        "sql": "SELECT COUNT(*) as total, "
               "SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins, "
               "AVG(actual_return) as avg_return "
               "FROM predictions WHERE outcome_date IS NOT NULL",
        "params": [],
        "returns": "single",
    },
    "predictions.count": {
        "db": "predictions.db",
        "sql": "SELECT COUNT(*) as c FROM predictions",
        "params": [],
        "returns": "single",
    },
    # === stored_analyses ===
    "stored_analyses.by_market": {
        "db": "predictions.db",
        "sql": "SELECT * FROM stored_analyses WHERE market = ? "
               "ORDER BY maestro_score DESC LIMIT ?",
        "params": ["market", "limit"],
        "returns": "list",
    },
    # === price_history.db ===
    "price_history.candles": {
        "db": "price_history.db",
        "sql": "SELECT date, open_price, high_price, low_price, close_price, volume "
               "FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?",
        "params": ["ticker", "limit"],
        "returns": "list",
    },
    # === news.db ===
    "news.latest": {
        "db": "news.db",
        "sql": "SELECT * FROM market_news ORDER BY published_at DESC LIMIT ?",
        "params": ["limit"],
        "returns": "list",
    },
    # === data_engine.db ===
    "data_engine.gold_prices": {
        "db": "data_engine.db",
        "sql": "SELECT * FROM gold_prices ORDER BY timestamp DESC LIMIT ?",
        "params": ["limit"],
        "returns": "list",
    },
    # ... باقي الـ 186 query تسجّل هنا
}

# Flask blueprint
generic_query_bp = Blueprint('generic_query', __name__, url_prefix='/api/db/query')

@generic_query_bp.route('/<query_name>', methods=['GET'])
def execute_query(query_name):
    if query_name not in QUERY_REGISTRY:
        return jsonify({"success": False, "error": f"unknown query: {query_name}"}), 404

    cfg = QUERY_REGISTRY[query_name]
    db_name = cfg["db"]
    sql = cfg["sql"]
    param_names = cfg["params"]

    # Bind params from query string
    bound = []
    for p in param_names:
        val = request.args.get(p)
        if val is None:
            return jsonify({"success": False, "error": f"missing param: {p}"}), 400
        # Type coercion
        if val.isdigit():
            bound.append(int(val))
        else:
            try:
                bound.append(float(val))
            except ValueError:
                bound.append(val)

    # Execute via db_manager (single entry — Rule 66)
    try:
        rows = db_manager.query(db_name, sql, bound)
        if cfg["returns"] == "single" and rows:
            return jsonify({"success": True, "data": dict(rows[0])})
        return jsonify({"success": True, "data": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
```

#### 2.2 — تسجيل الـ 186 query

كل query من الـ audit تُسجّل في `QUERY_REGISTRY` بالـ format:
```python
"domain.query_name": {
    "db": "stocks.db",           # أي DB
    "sql": "SELECT ... FROM ... WHERE ... AND (is_active = 1 OR is_active IS NULL)",
    "params": ["ticker", "limit"],  # أسماء الـ params
    "returns": "single" | "list",
}
```

**قواعد التسجيل:**
1. كل query فيها `AND (is_active = 1 OR is_active IS NULL)` لو بتـ read من `stocks`.
2. كل params = `?` placeholders (Rule 56).
3. أي query بتـ return ticker لازم تـ filter بـ `validate_ticker()`.
4. مفيش user-provided SQL أبداً.

**الـ Deliverable:** `vps-service/api/generic_query.py` + 186 query في الـ registry.

---

### 🟡 Phase 3 — تحويل 143 route لـ proxy (يوم 2)

**الهدف:** كل route من الـ 143 تبقى proxy للـ Python.

#### 3.1 — الـ 128 route البسيطة (generic query)

كل route تتـ convert لـ:

```typescript
// src/app/api/predictions/tracking/route.ts
// BEFORE: 80 سطر (open DB + SQL + map + return)
// AFTER: 5 سطور (proxy)

import { proxyToPython } from '@/lib/api-client';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToPython(req, '/api/db/query/predictions.open');
}
```

#### 3.2 — الـ 15 route المعقدة (domain-specific endpoints)

كل route تتـ convert لـ:

```typescript
// src/app/api/predictions/honest-tracking/stats/route.ts
// BEFORE: 640 سطر (complex calculations)
// AFTER: 5 سطور (proxy to Python endpoint مخصص)

import { proxyToPython } from '@/lib/api-client';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToPython(req, '/api/predictions/honest-tracking/stats');
}
```

والـ Python endpoint المخصص:

```python
# vps-service/api/prediction_tracking_routes.py
@bp.route('/api/predictions/honest-tracking/stats', methods=['GET'])
def honest_tracking_stats():
    # Complex logic هنا (ported من TS)
    # db_manager.query(...) + calculations
    return jsonify({"success": True, "data": result})
```

#### 3.3 — الـ 22 route الهجينة (شيل الـ DB fallback)

```typescript
// BEFORE:
const PY = 'http://127.0.0.1:8010';
const data = await fetch(`${PY}/api/...`).catch(() => null);
if (!data) {
  // fallback: open DB directly ← REMOVE THIS
  const db = new Database('db/stocks.db');
  ...
}

// AFTER:
import { proxyToPython } from '@/lib/api-client';
export async function GET(req: NextRequest) {
  return proxyToPython(req, '/api/...');
  // NO fallback — Python is the single source (Rule 20)
}
```

#### 3.4 — الـ checklist لكل route (Rule 68)

```
لكل route:
1. grep proof: الـ route بيفتح DB مباشرة (before screenshot)
2. Python endpoint موجود (curl 200 + correct payload)
3. حذف better-sqlite3 import من الـ route
4. استبدال بـ proxyToPython(req, '/api/...')
5. curl smoke test — نفس النتيجة قبل/بعد (snapshot diff)
6. commit + push (Rule 75)
7. worklog entry بأرقام before/after
```

---

### 🔵 Phase 4 — توسيع shared-db.ts (يوم 3، صبح)

**الهدف:** helper موحّد لـ Category A فقط (auth/subscription/paywall).

```typescript
// في src/lib/shared-db.ts — extension فقط، مش ملف جديد
export function queryDb<T>(
  db: 'auth',
  sql: string,
  params: unknown[] = []
): T[] {
  // آمن: db = 'auth' فقط (whitelist)
  // آمن: sql = parameterized (Rule 56)
  //用途: auth/subscription/paywall routes فقط
}
```

**ممنوع:**
- ❌ Business logic في الـ helper.
- ❌ Queries لـ stocks / price_history / data_engine (دول Python domain).
- ❌ Caching layer جوه الـ helper (يستخدم `api-client.ts` caching بدل).

---

### 🟢 Phase 5 — Centralized ticker validation (يوم 3، بعد الظهر)

**الهدف:** منع UBEEU / ISIN من الدخول من المصدر.

**المهام:**
1. `ticker_validator.py` موجود — يُربط في `us_stock_scraper.py` + `multi_market_scraper.py` (2 scrapers لسه بدون validation).
2. `sync_scanner_to_db.py` — يـ filter tickers مش valid قبل الـ INSERT.
3. `auto_poster.py` — يـ verify إن الـ ticker valid قبل الـ publish.
4. Python endpoints — أي endpoint بيرجع stocks list يـ filter بـ `is_active=1` + `validate_ticker()`.

---

### 🟣 Phase 6 — Verification + Monitoring (يوم 3، مساء)

**المهام:**
1. **Re-run latency baseline** — مقارنة مع Phase 0.
2. **Smoke tests** — 20 route أساسي.
3. **تحديث documentation:**
   - `01-ARCHITECTURE.md` — updated layers.
   - `02-DATABASES-AND-DATA.md` — updated access patterns.
   - `ENGINES-MASTER-REFERENCE.md` — updated Layer 7 (scrapers).
4. **report نهائي للمالك** في `worklog.md`.

---

## ⚠️ المخاطر + الإجراءات

| الخطر | الاحتمال | الإجراء |
|---|---|---|
| Route يتحول لـ Python endpoint مش موجود | متوسط | Phase 0 audit يكشف gaps → نضيف endpoints في Python أولاً |
| Regression في route متحوّل | متوسط | Snapshot test قبل/بعد لكل route + git revert |
| Performance regression | متوسط | Latency baseline × 1.15 = الحد الأقصى |
| Conflict مع شغل الفريق | متوسط | Rule 76 — `git pull` + `worklog` review قبل كل مرحلة |
| Generic executor = SQL injection | منخفض | Whitelist registry + parameterized SQL (Rule 56) — مفيش user-provided SQL |
| 128 عميل على الإنتاج | عالي | snapshot test لكل route + deploy batch-by-batch + rollback جاهز |

---

## 🚦 Gate Approval (الموافقات المطلوبة)

| Gate | المطلوب |
|---|---|
| **بدء Phase 1** | موافقة المالك على الخطة ككل |
| **Phase 1 → 2** | تأكيد إن phantom DBs اتـ remove + canonical sources متأكدة |
| **Phase 2 → 3** | مراجعة الـ generic_query.py + الـ registry |
| **Phase 3 → 4** | تأكيد إن 50% من routes اتحوّلت بنجاح (snapshot tests pass) |
| **Phase 4 → 5** | تأكيد إن كل routes Category C اتحوّلت |
| **Phase 5 → 6** | موافقة على إضافة `queryDb` لـ `shared-db.ts` (Rule 4) |
| **Phase 6 (final)** | مراجعة report نهائي + تحديث الوثائق |

---

## 📊 معايير النجاح (Acceptance Criteria)

| المعيار | القيمة المستهدفة |
|---|---|
| عدد routes بتفتح DB مباشرة | **15 (Category A فقط)** |
| عدد sources لـ EGX price | **1 (`price_history.db.price_history`)** |
| عدد reference لـ `gold_prices.db` phantom | **0** |
| Ticker pollution (UBEEU, ISIN) في `stocks.db` active | **0** |
| Latency regression | **≤ 15% من baseline** |
| Rule 20 violations | **0** في business data |
| Rule 28 violations (duplicate helpers) | **0** (لا DAL جديد) |
| Rule 56 violations (dynamic SQL) | **0** (whitelist registry) |
| تغطية `ticker_validator` في scrapers | **6/6** |
| ملفات جديدة في `src/lib/` | **0** (Rule 4 — توسيع الموجود) |

---

## 📝 الـ Deliverables النهائية

1. `scripts/audit/01_unique_queries.csv` — 186 query فريدة (مكتمل).
2. `scripts/audit/02_complex_routes.csv` — 15 route معقدة (مكتمل).
3. `vps-service/api/generic_query.py` — endpoint واحد + 186 query registry.
4. 143 route متحوّل لـ proxy (5 سطور بدل 50-500).
5. 15 Python endpoint مخصص للـ complex routes.
6. `src/lib/shared-db.ts` — `queryDb` helper (Phase 4).
7. `data_engine/scrapers/ticker_validator.py` — مربوط في 6/6 scrapers.
8. `worklog.md` — entry لكل task بالـ before/after.
9. `01-ARCHITECTURE.md` + `02-DATABASES-AND-DATA.md` محدّثين.
10. `archive/05-DATA-ACCESS-LAYER-PLAN-v1.md` — كـ negative reference.

---

## 🔄 الـ Rollback Plan

| السيناريو | الإجراء |
|---|---|
| Generic query executor وقع | `git revert HEAD` (يرجّع الـ 143 route القديمة) |
| Route متحوّل وقع | `git revert <commit>` للـ route المعنية بس |
| Python backend وقع | الـ 22 route الهجينة كان فيها fallback — نرجّع الـ fallback مؤقتاً |
| Performance regression | نقيس latency × 1.15 — لو زاد، نوقف + نحقق |

---

## 📋 الـ Timeline النهائي

| اليوم | المرحلة | المدة | المخرجات |
|---|---|---|---|
| **يوم 1 صبح** | Phase 1 (Data Ownership) | 3-4 ساعات | phantom removal + canonical sources |
| **يوم 1 بعد الظهر** | Phase 2 (Generic Query Executor) | 3-4 ساعات | `generic_query.py` + 186 query registry |
| **يوم 2 صبح** | Phase 3a (128 simple routes) | 3-4 ساعات | 128 route متحوّل لـ proxy |
| **يوم 2 بعد الظهر** | Phase 3b (15 complex routes) | 3-4 ساعات | 15 Python endpoint مخصص + 15 route متحوّل |
| **يوم 2 مساء** | Phase 3c (22 hybrid routes) | 1-2 ساعة | شيل الـ DB fallback |
| **يوم 3 صبح** | Phase 4 (shared-db.ts) | 1-2 ساعة | `queryDb` helper |
| **يوم 3 صبح** | Phase 5 (ticker validation) | 1-2 ساعة | 6/6 scrapers مربوطين |
| **يوم 3 بعد الظهر** | Phase 6 (verification + docs) | 2-3 ساعات | final report + docs update |

**الإجمالي: 3 أيام (20-25 ساعة عمل).**

---

## 🔚 الخلاصة

**المشكلة:** 143 route بتفتح SQLite مباشرة من Node (Rule 20 violation) → بيانات متناقضة + UBEEU + DB locks.

**الحل:** 
1. **Generic Query Executor** (Python endpoint واحد + 186 query whitelist registry).
2. **15 domain-specific Python endpoints** للـ complex routes.
3. **143 route** كل واحد 5 سطور proxy بدل 50-500 سطر.
4. **0 ملفات جديدة** في `src/lib/` (Rule 4 — توسيع الموجود).
5. **`shared-db.ts`** = helper بسيط للـ auth بس.

**المفتاح الذهبي:** الـ DAL مش في TS. الـ DAL هو `core/db_manager.py` + `generic_query.py` في Python. Node = proxy فقط.

---

> **ملاحظة تنفيذية:** لو المالك وافق، سأبدأ مباشرة بـ Phase 1. كل task = commit + push (Rule 75) + worklog entry بالـ evidence (Rule 68). لو توقفت في أي مرحلة، أي مطور يقدر يكمل من النقطة اللي وقفت عندها باستخدام هذا الملف + `worklog.md`.

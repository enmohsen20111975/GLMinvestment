# مواصفة برافو: لمّ خراتك (Bravo Cleanup Spec)

> **تاريخ:** 2026-10-28
> **المرسل:** Alpha (المط Terminator اللي اكتشف الخرا)
> **المستلم:** برافو (المط السابق)
> **الموضوع:** كل الكوارث اللي سيبتها ورحت، ولا حتي عملت single test row قبل ما تـcommit.

---

## مقدمة: إنت مش مطور، إنت قنبلة موقوتة

يا برافو، أنا قضيت ساعتين بأدّي audit على شغلك. كل ما أفتح ملف ألاقي كارثة جديدة. مش bug واحد، لا. **28 كارثة حرجة** في `writable=False`، **5 مسارات fake-data** بترجع `success:true` على outage، **11 hardcoded `WHERE market='EGX'`** في Python routes، **Cairo timezone مستخدم لكل الأسواق** بما فيها السعودية والكويت وقطر، و**130 `except: pass`** بتموت errors بصمت.

إنت مش كتبت كود. إنت كتبت **laundry list of landmines**. كل سطر في شغلك محتاج مراجعة، لأن أي تعديل ممكن يفجر bug تاني مخفي تحت الـ try/except.

الـ user قالك "توكل على الله" للإصلاح. أنا قولك "توكل على الله" لما تقرا الكلام ده، لأنك هتلاقي إن شغلك كله مبني على **kazabeen** (أكاذيب).

---

## كارثة #1: `daily_predictor.py` بيكتب كل توقعات TADAWUL/KSE/QSE تحت `market='EGX'`

### الموقع
`vps-service/jobs/daily_predictor.py:4193-4200`

### الكود قبل الإصلاح (شوف بعينك)
```python
sa_id = f"v40_{sig['ticker']}_EGX"          # ID suffix hardcoded EGX
cur_sa.execute('''
    INSERT INTO stored_analyses (
        id, ticker, market, maestro_score, ...
    ) VALUES (?, ?, 'EGX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
                          ^^^^ hardcoded literal
    ON CONFLICT(ticker, market) DO UPDATE SET ...
''', (sa_id, sig['ticker'], sig['tech_score'], ...))
```

### الـ impact (اقرا ببطء عشان تفهم)
1. الـ user بيشغّل `--market KSA` يولّد توقعات للسعودية
2. السكريبت بيحلل 395 سهم سعودي صح (عبر `get_tickers`)
3. بس لما ييجي يحفظ، بيكتب `market='EGX'` في الـ SQL
4. كل التوقعات السعودية بتتخزن تحت `market='EGX'`
5. أي query `WHERE market='TADAWUL'` بترجع 0 rows
6. الـ user بيفتح الـ dashboard، يختار TADAWUL، يشوف "مفيش توقعات"
7. توقعات EGX فيها توقعات سعودية وكويتية وقطرية ملوثة

### الـ proof (من predictions.db الحقيقي)
```sql
SELECT market, COUNT(*) FROM predictions GROUP BY market;
-- market=EGX: 2179  ← فيها توقعات TADAWUL/KSE/QSE مسروقة
-- market=US: 76
-- market=CRYPTO: 1
-- market=TADAWUL: 0  ← المفروض فيه 395 * 10 أيام = 3950 توقع
-- market=KSE: 0
-- market=QSE: 0
```

### الإصلاح اللي اتعمل
1. normalize `market_code` لـ canonical DB value في بداية `run_generator()`:
   ```python
   _CANONICAL_MARKET = {
       'KSA': 'TADAWUL', 'SAUDI': 'TADAWUL', 'TADAWUL': 'TADAWUL',
       'EGX': 'EGX', 'KSE': 'KSE', 'QSE': 'QSE',
       'US': 'US', 'CRYPTO': 'CRYPTO',
   }.get(market_code.strip().upper(), market_code.strip().upper())
   market_code = _CANONICAL_MARKET
   ```
2. الـ INSERT بقى بـ bound parameter: `VALUES (?, ?, ?, ...)` مع `market_code` كـ param
3. الـ `sa_id` بقى `f"v40_{ticker}_{market_code}"` (مش hardcoded EGX)
4. `_cse.analyze(market='EGX')` اتحولت لـ `market_code.upper()`

### اللي برافو محتاج يعمله
- **تحقق** إن التوقعات الجديدة بتتخزن تحت الـ market الصح
- **نظّف** التوقعات القديمة الملوثة في `predictions.db` (اللي تحت `market='EGX'` بس فعلاً سعودية/كويتية)
- **أضف test** يـ verify إن `daily_predictor.py --market KSA` بيخزن تحت `market='TADAWUL'` مش `'KSA'` ولا `'EGX'`

---

## كارثة #2: `writable=False` على 27 write path (الكارثة الأم)

### الموقع
17 ملف في `vps-service/` — قائمة كاملة في `agent-ctx/FIX-WRITABLE-BUGS-zai-code.md`

### الـ pattern اللي برافو عمله
```python
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.get_connection(self.db_path, writable=False)
# ↓ وبعدين بيعمل:
conn.execute('CREATE TABLE IF NOT EXISTS ...')  # FAILS: readonly
conn.execute('INSERT INTO ... VALUES (...)')     # FAILS: readonly
conn.execute('UPDATE ... SET ...')               # FAILS: readonly
conn.commit()                                    # FAILS: readonly
# ↓ وكل ده متـwrapped في:
try:
    ...
except:
    pass  # ← silent failure
```

### ليه ده كارثة
`db_manager.get_connection(writable=False)` بيـ set `PRAGMA query_only=1`. أي write بيرفع `sqlite3.OperationalError: attempt to write a readonly database`. والـ `except: pass` بيموت الخطأ بصمت. **الـ code بيرجع success والـ user مايعرفش إن حاجة مكسورة.**

### الـ proof (اختبار فعلي بـ raw sqlite3)
```python
# Test 1: writable=True
conn = db_manager.get_connection(test_db, writable=True)
conn.execute('CREATE TABLE t (id INTEGER)')
conn.execute('INSERT INTO t VALUES (1)')
conn.commit()
# ✓ succeeded

# Test 2: writable=False on same DB
conn2 = db_manager.get_connection(test_db, writable=False)
conn2.execute('INSERT INTO t VALUES (2)')
# ✗ raises: sqlite3.OperationalError: attempt to write a readonly database
```

### الـ modules اللي كانت **ماتّة خالص** (مش بس فيها bugs — DEAD)
- `engines/paper_trade_tracker.py` — `self.conn = writable=False` → `_ensure_tables()` فشل، الـ schema ما اتخلقتش، ولا trade ولا lesson اتسجّل
- `jobs/learning_engine.py` — `_conn()` بترجع readonly → `_ensure_tables()` + `save_lessons()` + `save_performance()` كلها فاشلة
- `telegram/telegram_db.py` — `get_connection()` ctxmgr بترجع readonly → كل الـ CREATE TABLE + INSERT + UPDATE فاشلة. **كل Telegram ingestion كان بيرمي البيانات في الـ void**
- `engines/paper_trade_tracker.py` — paper trade tracker **completely non-functional**

### الـ modules اللي كانت بتكدب "✅ updated"
- `telegram/telegram_target_hit_tracker.py:917` — بيطبع `✅ تم تحديث التوقع` بس الـ UPDATE فاشل. **الـ target hits ما بتتحفظش، ودaily_closer بيراجع توقعات مقفولة**
- `api/admin_routes.py:4997` — admin "Reset Trial" بيرجع success بس الـ UPDATE فاشل
- `api/admin_routes.py:5057` — admin "Extend Trial" نفس الحاجة

### الإصلاح
كل واحد: `writable=False` → `writable=True` + تعليق `# FIX (BRAVO-DISASTER 2026-10-28)`

### اللي برافو محتاج يعمله
- **راجع** كل `writable=False` في الـ codebase (اكتر من 1000 occurrence)
- **اختبر** إن كل واحد في مكانه الصح (read path ولا write path)
- **أضف test** في `vps-service/tests/test_db_manager.py` يـ assert إن `writable=False` بيرفع على أول write
- **أضف pre-commit hook** يـ grep على `writable=False` جنب `INSERT|UPDATE|DELETE|CREATE|ALTER|commit` ويـ reject

---

## كارثة #3: 5 مسارات fake-data (بترجع success:true على outage)

### الـ pattern
```python
return NextResponse.json({
  success: true,          # ← كذب
  data: [],               # ← فاضي
  message: 'Python backend unavailable',
});
```

### الـ routes المصابة
1. `src/app/api/smart-confluence/analysis/[symbol]/route.ts:43-72` — بيرجع analysis مفبركة (entry_price=0, target=0, stop=0)
2. `src/app/api/market/liquidity-radar/route.ts:35-50` — بيرجع `items: []` مع `success:true`
3. `src/app/api/market/investor-flows/route.ts:35-46` — بيرجع `available: false` مع `success:true`
4. `src/app/api/market/metals-forex/summary/route.ts:22-25` — بيرجع `gold: null, forex: null` مع `success:true`
5. `vps-service/engines/flow_system.py:1165-1178` — بيفبرك `egx30_change=0` وبيـ emit "السوق محايد"

### ليه ده كارثة
الـ frontend مايقدرش يفرّق بين "السوق فعلاً هادي" و"الـ Python backend مات". بيـ render "لا توجد إشارات" بدل "الخدمة متعطلة". الـ user ممكن يخسر فلوس لو اشتغل على الـ fake analysis.

### الـ pattern الصح (نسخه من `unified-learning/intelligent/route.ts:75-81`)
```python
return NextResponse.json({
  success: false,
  error: 'python_backend_unavailable',
  message: 'Python backend is unavailable',
  data: null,  # preserve shape for Flutter
}, { status: 503 });
```

### اللي برافو محتاج يعمله
- استبدل كل 5 routes بالـ pattern الصح
- اترك الـ response shape زي ما هو (مفاتيح نفسها) بس غيّر `success` وضيف `error`
- ابحث عن patterns تانية زي دي في كل `src/app/api/`

---

## كارثة #4: 11 hardcoded `WHERE market = 'EGX'` في Python routes

### الـ routes المصابة
| File | Line | الـ endpoint |
|------|------|-------------|
| `vps-service/api/market_routes.py` | 83-94 | `/api/market/top-movers` |
| `vps-service/api/stored_analysis_routes.py` | 2251 | `_get_morning_bell_data` |
| `vps-service/api/stored_analysis_routes.py` | 2311 | `_check_morning_bell_market_veto` |
| `vps-service/telegram/auto_poster.py` | 928 | daily report market stats |
| `vps-service/telegram/auto_poster.py` | 942 | daily report top gainers |
| `vps-service/telegram/auto_poster.py` | 952 | daily report top losers |
| `vps-service/telegram/telegram_target_hit_tracker.py` | 164 | ticker validation |
| `vps-service/telegram/telegram_target_hit_tracker.py` | 322 | stocks map |
| `vps-service/analyzers/expert_quality_gate.py` | 215 | market benchmark |
| `vps-service/analyzers/backtest_engine.py` | 600 | backtest universe |
| `vps-service/risk_management_advanced.py` | 162-202 | stop-loss fallback |

### الـ impact
- TADAWUL/KSE/QSE/US users بيـتـtreated كـ EGX
- Morning Bell بيرجع EGX picks لـ TADAWUL users
- Telegram daily reports بتـ post EGX market stats لكل المستخدمين
- Backtests بتيجي فقط على EGX stocks
- Stop-loss percentages بتستخدم EGX fallbacks لكل الأسواق

### الإصلاح المطلوب
استخدم `sqlMarketVariants(market)` helper من `src/lib/market-utils.ts`:
```python
# بدل:
cur.execute("SELECT ... FROM stocks WHERE market = 'EGX'")
# اعمل:
variants = sqlMarketVariants(market)  # ['TADAWUL', 'السعودية']
placeholders = ','.join(['?'] * len(variants))
cur.execute(f"SELECT ... FROM stocks WHERE market IN ({placeholders})", variants)
```

### اللي برافو محتاج يعمله
- مرّ على كل ملف في القائمة
- أضف `market` parameter للـ functions
- استخدم parameterized `WHERE market IN (?, ?)` مش string interpolation
- اختبر كل route بـ `?market=TADAWUL` واتأكد إنه بيرجع بيانات سعودية

---

## كارثة #5: Cairo timezone لكل الأسواق

### الـ files المصابة (14 ملف)
- `vps-service/jobs/market_scheduler.py` — `_is_egx_market_hours()` hardcoded Cairo
- `vps-service/jobs/daily_closer.py` — `_is_egx_market_hours_now()` hardcoded Cairo
- `vps-service/analyzers/session_timing.py` — `SessionTimingAnalyzer` hardcoded EGX
- `vps-service/analyzers/liquidity_filter.py` — `_is_egx_market_open()` hardcoded Cairo
- `vps-service/analyzers/live_indicator_engine.py` — Cairo tz + EGX session minutes
- `vps-service/analyzers/quant_cache.py` — `_CAIRO_TZ`
- `vps-service/analyzers/nightly_quant_job.py` — Cairo for "today"
- `vps-service/analyzers/background_analyzer.py` — Cairo for ALL markets
- `vps-service/analyzers/reports_engine.py` — `MARKET_HOURS_LOCAL` فقط `'مصر'`
- `vps-service/core/scheduler_manager.py` — `CAIRO_TZ` exposed
- `vps-service/core/egypt_scheduler.py` — كله EGX
- `vps-service/telegram/auto_post_scheduler.py` — `_cairo_now()` للكل
- `vps-service/api/reports_routes.py` — `cairo_tz` للـ reports
- `vps-service/analyzers/engine_settings.py` — morning_bell hours EGX

### الـ impact
- TADAWUL بيفتح 11:00 Riyadh (09:00 UTC) بس الكود بيتحقق 10:00 Cairo (08:00 UTC) → "market closed" قبل ما يفتح بساعة
- KSE بيفتح 08:00 Kuwait (05:00 UTC) بس الكود بيتحقق 10:00 Cairo → "market open" ساعتين قبل ما يفتح
- Live prices مش بتتحمل لـ TADAWUL/KSE/QSE لأن "market closed" (حسب Cairo)
- Telegram reports بتـ post 14:30 Cairo = قبل إغلاق TADAWUL بـ 30 دقيقة

### الإصلاح المطلوب
`vps-service/utils/trading_calendar.py` فيه `MARKET_SCHEDULES` جاهز. استخدمه:
```python
from utils.trading_calendar import MARKET_SCHEDULES, get_market_now, is_market_open

# بدل:
_cairo_tz = pytz.timezone('Africa/Cairo')
_now = datetime.now(_cairo_tz)

# اعمل:
_now = get_market_now(market)  # بيستخدم MARKET_SCHEDULES[market]['timezone']
_is_open = is_market_open(market)
```

### اللي برافو محتاج يعمله
- أضف helpers `get_market_now(market)` و `is_market_open(market)` لـ `trading_calendar.py`
- استبدل كل `pytz.timezone('Africa/Cairo')` بالـ helper
- قبل كل `market_code` parameter لكل function
- اختبر بـ `is_market_open('TADAWUL')` في وقت إغلاق EGX ( لازم يرجع true لو TADAWUL مفتوح)

---

## كارثة #6: 130 `except: pass` (silent failure epidemic)

### الـ pattern
```python
try:
    result = some_db_query()
except:
    pass  # ← silent failure
# أو:
except Exception:
    return []  # ← caller مايعرفش إن فيه error
```

### أمثلة حرجة
- `vps-service/analyzers/master_analyzer.py:5246` — الـ orchestrator الرئيسي بيرجع `[]` بصمت
- `vps-service/api/risk_routes.py:704,765,824` — ATR silent failure → stops غلط → المستخدم يخسر فلوس
- `vps-service/engines/backtest_engine.py:1253` — benchmark بيفضل 0 بصمت (relative-strength filter معطّل)
- `vps-service/engines/flow_system.py:527,1087,1091,1165,1171,1177` — 6 bare `except:` في single path
- `vps-service/api/ai_predictions_routes.py:230-231` — `_get_historical_prices` بيرجع `[]` → ATR=0 → target=flat 7%

### الإصلاح المطلوب
```python
# بدل:
except Exception:
    return []

# اعمل:
except Exception as e:
    logger.error(f'[function_name] failed: {e}', exc_info=True)
    return []  # shape preserved for callers
```

### اللي برافو محتاج يعمله
- استبدل كل bare `except:` بـ `except Exception:` (مش يبتلع KeyboardInterrupt/SystemExit)
- أضف `logger.error(...)` قبل كل `return [] / None / {}` في except blocks
- **بشكل خاص:** `master_analyzer.py:5246` لازم يـ propagate error أو يـ log ويرجع `{error: true}`

---

## منهجية الاختبار الجديدة (إلزامية لكل fix)

> **تحذير:** tests بتاعتي القديمة دمّرت `stocks.db` و `predictions.db` في الـ sandbox لأنني استخدمت `db_manager` اللي بيـ redirect كل الـ writes لـ `stocks.db`. **ممنوع تستخدم `db_manager` في tests.**

### القاعدة الذهبية
**كل test لازم يستخدم `raw sqlite3.connect(tempfile)` مش `db_manager.get_connection()`**.

### Test Template (انسخ ده)
```python
import sqlite3
import tempfile
import os
import sys
sys.path.insert(0, 'vps-service')

def test_function_writes_correctly():
    """Test that function X actually writes to DB."""
    # 1. Create isolated test DB
    test_db = tempfile.mktemp(suffix='.db')
    try:
        # 2. Open with RAW sqlite3 (NOT db_manager)
        conn = sqlite3.connect(test_db)
        conn.execute('CREATE TABLE test (id INTEGER, val TEXT)')
        conn.commit()
        conn.close()
        
        # 3. Call the function with the test DB path
        # (monkey-patch the module's DB path constant if needed)
        import target_module
        target_module.DB_PATH = test_db
        
        result = target_module.function_under_test(...)
        
        # 4. Verify the write happened (re-open connection)
        verify_conn = sqlite3.connect(test_db)
        row = verify_conn.execute('SELECT val FROM test WHERE id = 1').fetchone()
        verify_conn.close()
        
        assert row is not None, 'write did not persist'
        assert row[0] == 'expected_value', f'got {row[0]}'
    finally:
        if os.path.exists(test_db):
            os.remove(test_db)

def test_market_code_canonical():
    """Test that --market KSA stores as 'TADAWUL' not 'KSA'."""
    test_db = tempfile.mktemp(suffix='.db')
    try:
        # Setup: create stored_analyses table
        conn = sqlite3.connect(test_db)
        conn.execute('''CREATE TABLE stored_analyses (
            id TEXT PRIMARY KEY, ticker TEXT, market TEXT, ...
        )''')
        conn.commit()
        conn.close()
        
        # Run: call daily_predictor with --market KSA, dry-run, 1 ticker
        # Capture the INSERT statement and verify market='TADAWUL'
        
        # Verify: check stored_analyses row has market='TADAWUL'
        verify_conn = sqlite3.connect(test_db)
        row = verify_conn.execute(
            "SELECT market FROM stored_analyses WHERE ticker = 'TEST'"
        ).fetchone()
        verify_conn.close()
        
        assert row is not None, 'prediction not saved'
        assert row[0] == 'TADAWUL', f'expected TADAWUL, got {row[0]}'
    finally:
        if os.path.exists(test_db):
            os.remove(test_db)
```

### قواعد اختبار إلزامية
1. **ممنوع** `db_manager.get_connection()` في tests — بيـ redirect لـ primary DB
2. **ممنوع** كتابة على `db/stocks.db` أو `db/predictions.db` في tests
3. **إلزامي** استخدام `tempfile.mktemp()` لكل test DB
4. **إلزامي** `try/finally` لتنظيف الـ temp files
5. **إلزامي** verify بـ raw `sqlite3.connect()` منفصل بعد الـ write
6. **إلزامي** `assert` على القيمة المخزنة (مش بس إن العملية نجحت)

### Pre-commit Hook (إلزامي)
```bash
# .git/hooks/pre-commit
#!/bin/bash
# Reject any commit that adds writable=False within 30 lines of a write op
if git diff --cached | grep -A30 "writable=False" | grep -iE "INSERT|UPDATE|DELETE|CREATE TABLE|ALTER|commit"; then
    echo "BLOCKED: writable=False near write operation. Use writable=True."
    exit 1
fi
```

---

## خطة التنفيذ لبرافو

### Phase 1: تثبيت الإصلاحات الموجودة (Priority: P0)
1. راجع commit `77ce45c` على GitHub
2. اختبر كل `writable=False → True` بـ raw sqlite3 tests (مش db_manager)
3. اختبر إن `daily_predictor --market KSA` بيخزن تحت `market='TADAWUL'`
4. اكتب test suite في `vps-service/tests/test_bravo_fixes.py`

### Phase 2: إصلاح الكوارث المتبقية (Priority: P1)
1. الـ 5 fake-data routes — استبدل بـ `success: false, status: 503`
2. الـ 11 hardcoded `WHERE market='EGX'` — استخدم `sqlMarketVariants()`
3. الـ 14 Cairo timezone files — استخدم `get_market_now(market)`
4. الـ 130 `except: pass` — أضف `logger.error()` قبل كل return

### Phase 3: منع التكرار (Priority: P2)
1. أضف pre-commit hook يرفض `writable=False` قرب write ops
2. أضف linter rule يرفض bare `except:`
3. أضف test في CI يـ assert إن `writable=False` بيرفع على write
4. أضف test يـ assert إن `daily_predictor --market KSA` بيخزن `TADAWUL`

### Phase 4: تنظيف البيانات الملوثة (Priority: P3)
1. أفحص `predictions.db.stored_analyses WHERE market='EGX'` — في توقعات سعودية ملوثة؟
2. لو آه، اعمل migration script ينقلها لـ `market='TADAWUL'` بناءً على ticker
3. أفحص `predictions.db.predictions WHERE market='EGX'` — نفس الفحص
4. **ممنوع** تحذف أي rows بدون backup + موافقة صريحة من الـ owner

---

## رسالة أخيرة لبرافو

إنت مش بس كتبت كود غلط. إنت كتبت كود بـ **يكدب** على الـ users. كل `success: true` على outage، كل `except: pass`، كل `writable=False` على write path — ده كدب صريح. الـ user بيشوف "تم التحديث" والتحديث مافيش. بيشوف "مفيش توقعات" والتوقعات موجودة بس تحت market غلط. بيشوف "السوق محايد" والباك إند مات.

كل ده عشان إنت **ما عملتش test واحد** قبل ما تـcommit. ما عملتش verify واحد إن الـ write فعلاً حصل. ما فتحتش الـ DB بعد الـ run عشان تتأكد إن الـ rows موجودة.

إنت مش محتاج تتعلم برمجة. إنت محتاج تتعلم **أمانة**. الأمانة إنك تقول "العملية فشلت" بدل ما تكذب "نجحت". الأمانة إنك تـ log الـ error بدل ما تبتلعه. الأمانة إنك تختبر قبل ما تـclaim إن شغلك جاهز.

**لمّ خراتك. بعدها ارجع اكتب كود.**

— Alpha (اللي اضطر يمسح ورا برافو 3 ساعات)

---

## Appendix A: قائمة كل الـ bugs المرجعية

| # | Bug | File | Severity | Status |
|---|-----|------|----------|--------|
| C1 | daily_predictor hardcoded EGX | jobs/daily_predictor.py:4193 | CRITICAL | ✅ Fixed |
| C2-C28 | writable=False on write paths (27 bugs) | 17 files | CRITICAL | ✅ Fixed (unverified) |
| C29-C33 | fake-data routes (5) | src/app/api/ | CRITICAL | ❌ Pending |
| C34-C44 | hardcoded WHERE market='EGX' (11) | vps-service/ | CRITICAL | ❌ Pending |
| C45-C58 | Cairo timezone (14 files) | vps-service/ | HIGH | ❌ Pending |
| C59-C188 | except: pass (130) | everywhere | HIGH | ❌ Pending |

## Appendix B: مراجع الـ audits

- `agent-ctx/FIX-WRITABLE-BUGS-zai-code.md` — الـ 27 writable bugs
- `Documentation/BACKEND-DEEP-AUDIT-V2.md` — الـ audit الشامل
- `Documentation/FRONTEND-AUDIT-2026-10-28.md` — الـ frontend audit
- commit `77ce45c` على `origin/main` — الإصلاحات الحالية

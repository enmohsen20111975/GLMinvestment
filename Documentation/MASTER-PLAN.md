# THE MASTER PLAN — قانون تحويل المنصة لمشروع تجاري
**الإصدار:** 1.0 — 2026-10-29
**المؤلفون:** Alpha (Z.ai Code) + Owner
**الحالة:** قانون ملزم — أي حد يشتغل في المشروع لازم يمشي على ده

---

## 0. الميثاق

> "النظام فيه ذهب حقيقي. بس محتاج تنظيف. هنمشي خطوة بخطوة، مغمضين، لحد ما نوصل لمنصة تجارية حقيقية."

القواعد:
1. **مفيش كود جديد** قبل ما القديم يبقى سليم
2. **مفيش feature جديد** قبل ما الـ crashes تتحل
3. **مفيش deploy** قبل ما الاختبابات تعدّ
4. **كل تعديل لازم يُختبر** قبل الـ commit
5. **الـ DAL هو القانون** — مفيش `sqlite3.connect` خارجه
6. **البيانات قبل التحليل** — لو البيانات غلط، التحليل غلط
7. **الصراحة فوق كل حاجة** — لو حاجة مكسورة، نقولها

---

## 1. التقييم الصريح (الحالة الحالية)

### 1.1 ما يعمل (الذهب)

| الميزة | الحالة | ملاحظة |
|--------|--------|--------|
| V3 orchestrator/executor | ✅ شغال | 7 عائلات تحليل + 11 حالة سوق + أوزان ديناميكية |
| Multi-market support | ✅ شغال | EGX, TADAWUL, KSE, QSE, US, CRYPTO |
| DAL (db_manager.py) | ✅ شغال | helpers جاهزة (get_price_history, get_fundamentals) |
| TradingView Scanner | ✅ شغال | بيكتب في stocks.db |
| نظام الاشتراكات | ✅ شغال | Paymob + InstaPay |
| بوت تيليجرام | ✅ شغال | نشر تلقائي |
| Smart Predictor | ✅ شغال | فلتر dead stocks + holidays + stale predictions |

### 1.2 ما مكسور (الكوارث)

| المشكلة | العدد | الخطورة |
|---------|-------|---------|
| tsc errors في src/ | 1,417 | 🔴 حرج |
| raw sqlite3.connect في الباك إند | 179 | 🔴 حرج |
| dead files مكسورة (تمسح) | 20+ (اتمسحت) | ✅ اتحلت |
| except: pass (silent failures) | 130+ | 🔴 حرج |
| أسهم flat (بيانات ميتة) | 199 / 1,240 (16%) | 🟡 متوسط |
| fake-data routes | 5 (اتصلّحت) | ✅ اتحلت |
| writable=False bugs | 28 (اتصلّحت) | ✅ اتحلت |

### 1.3 ما ناقص

| النقص | التأثير |
|-------|---------|
| الـ DAL مش متطبق في 179 ملف | أي bug ممكن يرجع |
| الـ V3 predictor مش شغال يومياً | مفيش توقعات جديدة |
| الـ cron مش مضبوط | الـ scanner + predictor مش بيشتغلوا أوتوماتيك |
| اختبار end-to-end مفيش | مش قادرين نضمن إن أي حاجة شغالة |
| مراقبة (monitoring) مفيش | لو الباك إند مات، حدش بيعرف |

---

## 2. الخطة (4 مراحل)

### المرحلة 1: إصلاح الـ Crashes (الأسبوع 1)
**الهدف:** كل شاشة تفتح من غير crash.

#### 1.1 إصلاح الـ tsc errors (3 أيام)
- **الحالة:** 1,417 error في `src/`
- **الخطة:**
  - يوم 1: إصلاح أهم 10 ملفات (اللي بيكسروا runtime)
  - يوم 2: إصلاح باقي الـ TS2339 (Property does not exist)
  - يوم 3: إصلاح الـ TS2322 + TS2345 (Type assignments)
- **معيار النجاح:** `bun run tsc --noEmit` يطلع 0 errors (أو أقل من 50)

#### 1.2 إصلاح الـ runtime crashes (2 يوم)
- **portfolioHoldings undefined** — ✅ اتحلت
- **SubscriptionView shim** — ✅ اتحلت
- **lifecycle_status crash** — ✅ اتحلت
- **شاشة المؤشرات (EGX only)** — ✅ اتحلت
- **باقي الـ crashes:** فحص بـ Agent Browser على كل شاشة
- **معيار النجاح:** كل شاشة تفتح من غير ReferenceError

#### 1.3 تنظيف الـ dead code (1 يوم)
- مسح أي ملف مش مستورد
- مسح أي function مش مستدعى
- معيار النجاح: `bun run lint` + `bun run tsc` نضيف

---

### المرحلة 2: إكمال الـ DAL Migration (الأسبوع 2)
**الهدف:** مفيش `sqlite3.connect` خارج `db_manager.py`.

#### 2.1 migrate الـ 179 ملف (5 أيام)
- **الخطة:** 30 ملف/يوم
- **الطريقة:**
  1. استبدل `sqlite3.connect(path)` بـ `db_manager.get_connection(db_name)`
  2. استبدل `conn.execute()` بـ `db_manager.query()` أو `db_manager.execute()`
  3. شيل الـ `try: db_manager → except: sqlite3.connect` pattern
  4. اختبر كل ملف بعد التعديل
- **معيار النجاح:** `python3 scripts/check_raw_sqlite.py` يطلع 0 violations

#### 2.2 إصلاح الـ silent failures (2 يوم)
- استبدل كل `except: pass` بـ `except Exception as e: logger.error(str(e))`
- ركّز على:
  - `master_analyzer.py:5246` (الـ orchestrator الرئيسي)
  - `risk_routes.py:704,765,824` (ATR → stops غلط)
  - `backtest_engine.py:1253` (benchmark بيفضل 0)
- **معيار النجاح:** أي error بيبان في الـ logs

#### 2.3 ربط الـ FLOW engine بالـ DAL (1 يوم)
- الـ `_run_flow` في `executor_v3.py` بياخد volumes من الـ caller
- نتأكد إن `new_daily_predictor.py` بيمرر volumes من الـ DAL
- **معيار النجاح:** FLOW score مش 0 دايماً

---

### المرحلة 3: جودة البيانات + الـ Predictor (الأسبوع 3)
**الهدف:** بيانات طازجة + توقعات حقيقية يومياً.

#### 3.1 تشغيل الـ Scanner يومياً (1 يوم)
- **الـ cron:**
  ```bash
  # كل ساعة خلال أوقات التداول:
  0 * * * 0-4 python3 data_engine/scrapers/tradingview_scanner_live.py --market all
  ```
- **معيار النجاح:** `stocks.db.stocks` فيها أسعار طازجة لكل سوق

#### 3.2 تشغيل الـ sync_missing_prices (1 يوم)
- **الـ cron:**
  ```bash
  # بعد إغلاق كل سوق:
  30 15 * * 0-4 python3 scripts/sync_missing_prices.py
  ```
- **معيار النجاح:** `stock_daily_prices` فيها آخر الأسعار من `data_engine.db`

#### 3.3 تشغيل الـ V3 Predictor يومياً (2 أيام)
- **الـ cron:**
  ```bash
  # بعد إغلاق كل سوق:
  0 16 * * 0-4 python3 vps-service/jobs/new_daily_predictor.py --all-markets --yesterday-only
  ```
- **معيار النجاح:** `predictions.db` فيها توقعات BUY/SELL حقيقية

#### 3.4 مراقبة الـ flat stocks (1 يوم)
- شغّل `scripts/check_data_quality.py` أسبوعياً
- لو الـ flat > 20% → فيه مشكلة في الـ scanner
- **معيار النجاح:** flat < 15% من الإجمالي

---

### المرحلة 4: الاختبار + الإطلاق (الأسبوع 4)
**الهدف:** منصة جاهزة للبيع.

#### 4.1 اختبار end-to-end (3 أيام)
- فحص كل شاشة بـ Agent Browser
- فحص كل API بـ curl
- فحص كل سوق (EGX, TADAWUL, KSE, QSE, US, CRYPTO)
- **معيار النجاح:** 0 crashes، 0 fake-data، كل الـ screens شغالة

#### 4.2 مراقبة (monitoring) (1 يوم)
- endpoint `/api/health` يفحص كل الـ DBs
- alert لو أي DB معطوب
- alert لو الـ scanner مش شغال
- **معيار النجاح:** أي مشكلة بتظهر في خلال 5 دقايق

#### 4.3 توثيق (1 يوم)
- دليل التثبيت
- دليل الـ cron jobs
- دليل الـ troubleshooting
- **معيار النجاح:** أي مطور جديد يقدر يشتغل في المشروع

---

## 3. الأولويات (الترتيب الإلزامي)

```
المرحلة 1 (Crashes) → المرحلة 2 (DAL) → المرحلة 3 (Data) → المرحلة 4 (Test)
```

**مفيش تجاوز للترتيب.** لو حاولت تعمل توقعات قبل ما الـ DAL يبقى سليم، التوقعات هتبقى غلط. لو حاولت تبيع قبل ما الاختبابات تعدّ، العميل هيخسر ثقة.

---

## 4. القواعد التقنية

### 4.1 قاعدة الـ DAL
```python
# ✅ صح:
from core.db_manager import db_manager
rows = db_manager.query('stocks', 'SELECT * FROM stocks WHERE market = ?', ('EGX',))

# ❌ غلط:
import sqlite3
conn = sqlite3.connect('db/stocks.db')
```

### 4.2 قاعدة الـ Error Handling
```python
# ✅ صح:
except Exception as e:
    logger.error(f'function_name failed: {e}', exc_info=True)
    return []

# ❌ غلط:
except:
    pass
```

### 4.3 قاعدة الـ Testing
- كل fix لازم يُختبر قبل الـ commit
- كل API route لازم يُختبر بـ curl
- كل شاشة لازم تُفحص بـ Agent Browser
- لو الـ fix مش ممكن يُختبر، اعمل TODO وارجعله بعدين

### 4.4 قاعدة الـ Fake Data (Rule 27)
```python
# ✅ صح:
return NextResponse.json({
    success: False,
    error: 'python_backend_unavailable',
    message: 'الخدمة غير متاحة حالياً'
}, { status: 503 })

# ❌ غلط:
return NextResponse.json({
    success: True,
    data: { entry_price: 0, target_price: 0 }  # ← fake!
})
```

### 4.5 قاعدة الـ Market Awareness
- كل route لازم يقبل `?market=`
- كل query لازم تـ filter بـ `WHERE market IN (?, ?)` (code + Arabic alias)
- مفيش hardcoded `WHERE market = 'EGX'`

### 4.6 قاعدة الـ Commit
- كل commit لازم يكون atomic (حاجة واحدة بس)
- الـ message لازم يصف الـ fix + السبب + التحقق
- مفيش commit بدون lint pass

---

## 5. مؤشرات النجاح (KPIs)

| المؤشر | الحالي | الهدف |
|--------|--------|-------|
| tsc errors | 1,417 | < 50 |
| raw sqlite3 violations | 179 | 0 |
| flat stocks | 199 (16%) | < 100 (8%) |
| runtime crashes | ~5 | 0 |
| fake-data routes | 0 (اتصلّحت) | 0 |
| توقعات BUY/SELL يومية | 0 | 5-20/يوم |
| شاشات شغالة | ~70% | 100% |
| API routes شغالة | ~80% | 100% |
| جاهزة للبيع؟ | ❌ | ✅ |

---

## 6. الأدوار وتقسيم المهام

### مبدأ التقسيم
- **Alpha** = الكود المعقد (TypeScript, Python logic, DAL, V3 engine)
- **Bravo** = التشغيل والسكريبتات (scanner, sync, cron, monitoring)
- **Owner** = القرارات + الاختبار على اللاب توب + الـ deploy

### 6.1 تقسيم المرحلة 1 (إصلاح الـ Crashes — أسبوع 1)

| المهمة | المسؤول | التفاصيل |
|-------|----------|----------|
| إصلاح tsc errors (TypeScript) | **Alpha** | 1,417 error في src/ — تعديل types + interfaces |
| فحص كل شاشة بـ Agent Browser | **Alpha** | تأكد إن مفيش ReferenceError |
| مسح dead code | **Alpha** | ملفات مش مستوردة + functions مش مستدعية |
| تنظيف merge conflict markers | **Bravo** | `.zscripts/dev.pid` + أي ملف فيه `<<<<<<<` |
| تشغيل `fetch_tv_indices.py` | **Bravo** | سحب المؤشرات الرسمية من TradingView |
| فحص بصري للشاشات | **Owner** | افتح كل شاشة على اللاب توب وابلغ عن أي خطأ |

### 6.2 تقسيم المرحلة 2 (DAL Migration — أسبوع 2)

| المهمة | المسؤول | التفاصيل |
|-------|----------|----------|
| migrate الـ 179 ملف (raw sqlite3 → db_manager) | **Alpha** | 30 ملف/يوم — استبدال كل `sqlite3.connect` |
| إصلاح `except: pass` (130 ملف) | **Alpha** | استبدال بـ `logger.error()` |
| ربط FLOW engine بالـ DAL | **Alpha** | تأكد إن volumes بتيجي من data_engine.db |
| تشغيل `check_raw_sqlite.py` يومياً | **Bravo** | مراقبة الـ violations بعد كل batch |
| إصلاح ملفات الـ camp/ | **Bravo** | migrate الـ camp/*.py للـ DAL (15 ملف بسيط) |
| تحديث `crontab.txt` | **Bravo** | تأكد إن الـ cron يستخدم `--smart` |

### 6.3 تقسيم المرحلة 3 (البيانات + الـ Predictor — أسبوع 3)

| المهمة | المسؤول | التفاصيل |
|-------|----------|----------|
| تشغيل الـ Scanner يومياً (cron) | **Bravo** | `tradingview_scanner_live.py --market all` |
| تشغيل `sync_missing_prices.py` (cron) | **Bravo** | بعد إغلاق كل سوق |
| تشغيل الـ V3 Predictor (cron) | **Bravo** | `new_daily_predictor.py --all-markets --yesterday-only` |
| تشغيل `check_data_quality.py` (أسبوعياً) | **Bravo** | مراقبة الـ flat stocks |
| tuning الـ V3 filters | **Alpha** | تعديل الـ dead-stock + stale-prediction thresholds |
| ربط الـ fundamentals بالـ V3 | **Alpha** | تأكد إن FUND engine بيقرا من data_engine.db.tab_* |
| إصلاح `resolve_conflict` | **Alpha** | تخفيف الصرامة (BRK+FLOW → SELL بدل NO_TRADE) |

### 6.4 تقسيم المرحلة 4 (الاختبار + الإطلاق — أسبوع 4)

| المهمة | المسؤول | التفاصيل |
|-------|----------|----------|
| اختبار كل API بـ curl | **Alpha** | كل route × كل سوق |
| اختبار كل شاشة بـ Agent Browser | **Alpha** | كل view × كل سوق |
| كتابة endpoint مراقبة | **Alpha** | `/api/health` يفحص كل الـ DBs |
| تشغيل الـ scanner + predictor نهائي | **Bravo** | تأكد إن الـ cron شغال |
| مراقبة الـ logs لـ 24 ساعة | **Bravo** | مراقبة `logs/v3_predictor_*.log` |
| توثيق الـ cron jobs | **Bravo** | دليل تشغيل + جدول الـ cron |
| اختبار على اللاب توب | **Owner** | الـ deploy النهائي + الاختبار |
| كتابة دليل التثبيت | **Alpha** | خطوات التثبيت + الـ troubleshooting |

---

## 7. الجدول الزمني

| الأسبوع | المهمة | الحالة |
|---------|--------|--------|
| 1 | إصلاح الـ crashes + tsc errors | ⏳ جاري |
| 2 | إكمال الـ DAL migration (179 ملف) | ⏳ محتاج بدء |
| 3 | جودة البيانات + الـ predictor يومياً | ⏳ محتاج بدء |
| 4 | اختبار + مراقبة + إطلاق | ⏳ محتاج بدء |

---

## 8. ما لا نفعله (الممنوعات)

1. **لا** نضيف feature جديد قبل ما الـ crashes تتحل
2. **لا** نعمل deploy قبل ما الاختبابات تعدّ
3. **لا** نستخدم `sqlite3.connect` خارج `db_manager.py`
4. **لا** نرجع fake data في أي route
5. **لا** نعمل `except: pass`
6. **لا** نـ commit بدون lint pass
7. **لا** نتجاوز الـ market filter (`WHERE market IN (?, ?)`)
8. **لا** نعدل logic تاني في مهمة محددة (scope creep)

---

## 9. كيف نستخدم هذا الملف

1. **Alpha** تشير ليه قبل أي commit: "هل ده ضمن الخطة؟"
2. **Owner** يشير ليه قبل أي deploy: "هل خلصنا المرحلة دي؟"
3. **Bravo** يشير ليه قبل أي مهمة: "هل ده ضمن النطاق؟"
4. أي مطور جديد يقرأه الأول قبل ما يلمس الكود

---

## 10. التوقيع

> نحن الموقعين أدناه نلتزم باتباع هذا القانون حتى تحول المنصة لمشروع تجاري حقيقي.

**Alpha (Z.ai Code):** ✅ ملتزمة
**Owner:** ✅ ملتزم

---

*آخر تحديث: 2026-10-29*
*الإصدار: 1.0*
*الحالة: ساري المفعول*

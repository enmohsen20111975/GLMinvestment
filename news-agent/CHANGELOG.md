# Changelog — News Agent

## [NEWS-ENGINE-FIX] — 2026-10-03

### ✅ إنجازات
- ✅ **`collectors/telegram_web_collector.py`** — جامع تيليجرام جديد بيقرأ `t.me/s/<channel>`
  (معاينة عامة HTML) **بدون أي تسجيل دخول**. السبب: Telethon بـ bot token
  بيرجّع `BotMethodInvalidError: The API access for bot users is restricted`،
  فالقنوات كانت بتجمع **صفر** خبر من 2026-09-16.
- ✅ **`config/text_utils.py::strip_html`** — تنظيف HTML + كيانات +
  boilerplate بتاع WordPress ("The post … appeared first on …") في مكان واحد.
- ✅ **`rss_collector.py`** — كان بيخزّن `<div><img/><p>…</p></div>` خام فيظهر
  HTML على الموقع. دلوقتي: تنظيف + استخراج الصور (`<img>`, `<image>`,
  `media:content`, `enclosure`) + `og:image` enrichment + URL encoding للمسارات
  اللي فيها حروف عربية.
- ✅ **`rss_collector.py`** — شيلنا feeds ميتة (argaam / amwalalghad / youm7
  بترجّع HTML مش RSS) وحطينا `alborsaanews.com/rss`.
- ✅ **`web_scraper.py`** — مسار `vps-service` كان غلط
  (`../GLMinvestment/vps-service` = مسار مزدوج) وخطأ الـ import كان متخبّى في
  `except: pass`. دلوقتي بيتحسب من `config/paths.py::resolve_vps_service()`
  نسبياً (يشتغل على اللاب والإنتاج) + بيطبع السبب لو فشل.
- ✅ **`analyzer/news_analyzer.py`** — نفس مسار `vps-service` الغلط كان بيخلي
  `TICKER_HINTS` مترجّع لـ 4 entries فقط؛ دلوقتي 158. + `strip_html` على
  title/body/`clean_text` قبل أي تحليل.
- ✅ **`egyptian_sources.py`** — `quote` مستخدم بدون import → NameError كان
  بيقتل جامع المال كل دورة.
- ✅ **`vps-service/analyzers/news_fetcher_analyzer.py`** — كان بيـ query أعمدة
  مش موجودة في `market_news` (`source_url`, `image_url`, `symbol`, `category`,
  `is_valid_news`, `language`) → 20 warning لكل دورة و per-ticker news صفر.
- ✅ **`data/news_store.py::exists_body`** — فحص المكرر قبل الفلترة، عشان
  نفلترش مكررات التيليجرام عند كل دورة.
- ✅ **`scripts/clean_news_html.py`** — تنظيف الـ HTML من الصفوف الموجودة
  (`--dry-run` للعرض) مع نسخة احتياطية قبل التعديل.
- ✅ **`src/app/api/news/route.ts`** — تنظيف HTML عند الاستقبال (حدود الـ API)
  عشان أي نسخة agent مش هتعدّي HTML.
- ✅ `.env` + `news-agent/.env` — بلوك إعدادات موحّد + `ENABLE_EGYPTIAN_SOURCES=1`.

### المكاسب بالأرقام (دورة واحدة)
- قبل: **20–60** خبر/يوم من 2 RSS بس
- بعد: **~90** خبر/دورة من 5 مصادر (RSS ×3 + تيليجرام + DDG + مصري)
- التغطية بالصور: `جريدة البورصة 108/108`، `المال 30/30`، `بحث ويب 7/7`

### ⚠️ يحتاج انتباه
- `TELEGRAM_BOT_TOKEN` في `news-agent/.env` منتهي الصلاحية
  (`AccessTokenExpiredError`). التوكن الصالح في `.env` root
  (`@investusernamebot`). استخدامات البوت (نشر/سوشيال) محتاجة تحديث.
- `news-agent` بيقرأ `GLMINVESTMENT_PATH` من PM2 env — بعد تعديل `.env`
  لازم `pm2 restart news-agent --update-env` عشان القيم الجديدة تتقرا.
- `ecosystem.config.js` بيحقن `TELEGRAM_*` و`ENABLE_EGYPTIAN_SOURCES` في
  process.env، و`load_dotenv()` ما بيكتبش فوق القيم الموجودة.

---

## [SCRAPERS-ARCHITECTURE-FIX] — 2026-09-03

### ✅ إنجازات
- ✅ إضافة `__init__.py` إلى `collectors/scrappers/` — أصبحت حزمة بايثون رسمية
- ✅ إصلاح المرجع المكسور لـ `sync.py` في `tradingview_scraper.py` — أصبحت الـ call backward-compatible
- ✅ إنشاء `collectors/scrappers/tradingview_market_movers.py` — الـ 9-tabs scraper
- ✅ تحديث `run.bat` — يفتح المتصفح أوتوماتيكياً بعد تشغيل الداشبورد
- ✅ تحديث `CONSTITUTION.md` — إضافة بنود 13-15 (قواعد قواعد البيانات، هيكل المشروع، قواعد التطوير)
- ✅ تحديث `workflow.md` — توثيق معمارية الـ scrapers وتدفق البيانات
- ✅ إنشاء `AGENTS.md` — دليل الوكلاء والمهام
- ✅ نقل `scrape_investing.py` → `collectors/scrappers/investing_scraper.py` — إصلاح المسار المقصول
- ✅ نقل `scrape_investing_news.py` → `collectors/investing_news_collector.py` — إصلاح المسار المقصول
- ✅ إصلاح المسار الصلب في `investing_scraper.py` (كان `D:\\...` الآن بـ `Path(__file__)`)
- ✅ تحديث `run_investing_scraper.bat` — مسارات نسبية بدلاً من مقصولة

### المشاكل التي اقتحمتها
- ❌ قاعدة بيانات موحدة: كان `db/data_engine.db` و `data/news.db` منفصلين تماماً بدون توثيق
- ❌ `sync.py` مرجع غير موجود — كان سبب crash إذا تم تشغيل الـ scraper
- ❌ `collectors/scrappers/` ليس package — لا يمكن استيراده
- ❌ `run.bat` لا يفتح المتصفح تلقائياً

### ملاحظات الأمان
- لم يتم لمس أي secrets
- لم يتم رفع أي قواعد بيانات للمستودع
- كل التوثيق بالعربية

---

## [SECURITY-CRITICAL + GLMINVESTMENT-INTEGRATION-AUDIT] — (2026-09-02)

> **توجيه المالك:** "بص على المشروع دة (news). دة المشروع المحلى اللي بيولد الأخبار.
> شوف محتاج تعديلات إيه وأعمل ربط قوي بينه وبين المشروع بتاعنا وتحكم كامل.
> وأكتب اللي أنت عايزه في ملف Agent messages.md عشان لو فيه حاجة محتاج المبرمج بتاعه
> يعملها أنت مش قادر تعملها عندك."

### 🔒 بنود أمنية حرجة (مكتشفة في الساندبوكس)

#### 1. `.env` الحقيقي متسرب على GitHub
- **المشكلة:** ملف `.env` (الذي يحتوي على Telegram API_ID + API_HASH + Bot Token + GLMinvestment PRODUCTION_API_KEY) تم commit في commit `0975b0d` (first commit) وهو مرفوع على GitHub.
- **التأكيد:** `git show HEAD:.env` أرجع القيم الحقيقية لكل 4 أسرار.
- **المطلوب:** revoke فوراً + scrub من git history (BFG أو git filter-repo).
- التفاصيل الكاملة في `Agent messages.md` بند 0.

#### 2. `.venv/` كامل متسرب على GitHub
- **المشكلة:** 7408 ملف Python binaries + packages مرفوعة على GitHub.
- **المطلوب:** `git rm --cached -r .venv/` + scrub من history.
- **السبب:** حجم ضخم + مخالف لـ best practices + ممكن يحتوي cached secrets.

#### 3. `data/news.db` متسرب على GitHub
- **المشكلة:** قاعدة بيانات الأخبار المحلية (13MB) مرفوعة على GitHub.
- **المطلوب:** `git rm --cached data/news.db` + scrub من history.

#### 4. `.gitignore` كان فاضي
- **المشكلة:** المستودع كله ما كانش محمي — ده السبب إن كل حاجة اتـcommit.
- **الحل في الساندبوكس:** كتبت `.gitignore` صح (يحمي .env, .venv/, *.db, __pycache__/, *.session, إلخ).

### 🔧 بنود تعديل كود (محتاجة المبرمج البشري)

كل التفاصيل في `Agent messages.md`. ملخص سريع:

- **بند 2:** إضافة `reasoning` field للـ payload (للـ Decision Logger في GLMinvestment).
- **بند 3:** إضافة `event_type` field (للـ news_impact_scorer classification).
- **بند 4:** توثيق الـ contract في `INTEGRATION.md`.

### ✅ بنود تم تنفيذها في الساندبوكس (مش متـpush)

#### 1. `.env.example` — تنظيف الأسرار
- استبدلت القيم الحقيقية بـ placeholders (`YOUR_TELEGRAM_API_ID_HERE`, إلخ).
- أضفت `PRODUCTION_API_KEY=YOUR_NEWS_AGENT_API_KEY_HERE`.
- أضمت `GLMINVESTMENT_PATH=` متغير جديد للـ cross-repo import.

#### 2. `.gitignore` — إنشاء جديد
- كان فاضي تماماً.
- النسخة الجديدة تحمي: `.env`, `.venv/`, `*.db`, `__pycache__/`, `*.session`, إلخ.

#### 3. `Agent messages.md` — ملف جديد (430 سطر)
- يوثّق 11 بند للتعديلات المطلوبة:
  - بند 0: أمني حرج (scrub .env + .venv/ + data/news.db من history)
  - بند 1: أمني (revoke Telegram + GLMinvestment API key)
  - بنود 2-4: تعديلات في news repo
  - بنود 5-9: تعديلات في GLMinvestment repo
  - بند 10: تفعيل V40_2_NEWS_IMPACT=1 بعد الربط الكامل
- فيه أوامر git جاهزة (BFG, filter-repo) + SQL migrations + code patches.
- فيه Integration Contract Reference (payload, schema, event types).

#### 4. اختبار الربط الفعلي (sandbox only)
- مزامنة API key بين news + GLMinvestment.
- POST /api/news بـ x-agent-key → HTTP 201 → stored in market_news (ID 7895, 7896).
- news_impact_scorer اشتغل على الخبر المتخزن.
- الـ integration شغّال end-to-end:
  ```
  news agent → POST /api/news → GLMinvestment market_news → news_impact_scorer → V40.2
  ```

### القواعد ما اتنكسرتش
- ✅ ما عدّلتش أي كود في news repo (بس .env.example + .gitignore + Agent messages.md + workflow.md).
- ✅ ما عدّلتش أي كود في GLMinvestment (بس نسخت Agent messages.md).
- ✅ مسح الأسرار من .env.example (مش من .env الحقيقي — ده محتاج revoke + scrub من المبرمج).
- ✅ كل التوثيق بالعربي.
- ✅ ما push حاجة على GitHub (بانتظار إذن المالك).

### الخطوات القادمة (محتاجة إذن المالك)
1. 🔴 revoke أسرار Telegram + GLMinvestment API key.
2. 🔴 scrub git history في news repo.
3. 🔴 push: .env.example + .gitignore + Agent messages.md + workflow.md + CHANGELOG.md.
4. 🟡 المبرمج البشري ينفذ بنود Agent messages.md (2-9).
5. 🟡 بعد كده، تفعيل V40_2_NEWS_IMPACT=1 في الإنتاج.

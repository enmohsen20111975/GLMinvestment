# DCS — نظام الرسم الهرمي الطبقي + التحكم بالعناصر (وثيقة التخيل)

> **الحالة**: وثيقة رؤية (Vision) — غير منفّذة الآن. كُتبت بتفصيل بناءً على طلب المالك.
> **المؤلف**: برافو 2 (Chief Quant & Data Engine Specialist) — 2026-10-15
> **المرجع**: البنية الحالية تعمل (Layer 0 حي على `/` بـ 23 عقدة + 20 حافة + 33 نقطة متحركة). هذه الوثيقة تمدّد التصور لطبقات + تحكم + عزل + سحب تاريخي.

---

## 1. الفكرة الجوهرية

الرسمة الحالية (Layer 0) تُظهر المصنع من الأعلى. المطلوب:

1. **هرمية طبقية (Drill-down)**: أي عقدة قابلة للفتح كطبقة أعمق تعرض مكوناتها الداخلية بنفس أسلوب P&ID (صناديق + خطوط + حركة).
2. **خصائص + تحكم لكل عنصر**: لوحة جانبية تُظهر خصائص العنصر المحدد + أزرار تحكم (تشغيل/إيقاف/عزل/سحب بفترة).
3. **عزل (Isolation)**: عتم كل ما عدا عنصر محدد (مثل سكرابر موقع معيّن) لمتابعة تدفقه منفرداً.
4. **تحكم فوري بالسكرابرات**: إيقاف Yahoo، تشغيل سحب من Yahoo بفترة من-إلى، عزل سكرابر موقع ما.

الخلاصة: شاشة SCADA هرمية قابلة للغوص + لوحة تحكم بالعناصر + عزل + مهام سحب مجدولة.

---

## 2. البنية الطبقية (Layered Topology)

### Layer 0 — نظرة المصنع (موجودة الآن)
- 23 عقدة: مصادر بيانات (EGX/KSA, Crypto, Gold) → قواعد بيانات (stocks/price_history/predictions/market/intraday) → محركات (analysis_engine_v2, Canonical ATR/RSI, core_scoring, dynamic_target, backtest) → بوابات قرارات (R/R Guard ≥1.5, Falling-Knife) → مخرجات (Live Signals, AI Predictions, Telegram, DCS Screen, Admin Panel) + Jobs band (Cron, daily_predictor).

### Layer 1 — الغوص داخل أي عقدة
كل عقدة لها `children` (مكوناتها الداخلية) تُرسم كـ P&ID فرعي:

| العقدة (Layer 0) | مكوناتها الداخلية (Layer 1) |
|---|---|
| `analysis_engine_v2` | data_loader → indicators(ATR/RSI) → scoring → target → R/R gate → signal_emitter |
| `db_stocks` (stocks.db) | الجداول (egksco_stocks, cached_analysis, egksco_sync_status, ...) كصناديق + عدد صفوف + آخر كتابة |
| `src_egx` (EGX/KSA Feeds) | السكرابرات الفردية: Yahoo scraper, EGX official scraper, KSA scraper (لكل واحدة: source URL, schedule, last_run, success/fail) |
| `gate_rr` (R/R Guard) | دخله (signals) → المقارنة (rr ≥ 1.5؟) → فرعين (PASS → out_signals, KILL → out_rejected) + عدادات |
| `out_signals` (Live Signals) | tail الإشارات + جدول آخر N إشارة |
| `job_cron` | قائمة وظائف crontab.txt (daily_predictor, intraday_scanner, market_scheduler, learning_engine...) بحالة كل وظيفة |

### Layer 2 — الغوص أعمق
مثال: داخل `Yahoo scraper` (Layer 1) → Layer 2 يُظهر:
- fetch loop (request → retry → parse → normalize)
- rate limiter (طلبات/دقيقة)
- cache (آخر استجابة)
- error handler (محاولات إعادة، circuit breaker)
- backfill queue (مهام السحب التاريخي المعلّقة)

### التنقل
- **Breadcrumb** أعلى: `Layer 0: System > Data Engine > Yahoo Scraper > Fetch Loop`.
- زر **Back** للطبقة الأعلى.
- **Zoom/Pan**: عجلة الفأرة + سحب، pinch على الموبايل.
- البقاء على نفس السياق الزمني (الساعة + حالة المحرك) عبر كل الطبقات.

---

## 3. لوحة الخصائص + التحكم (Properties & Control Panel)

عند تحديد أي عقدة (نقرة)، تنفتح لوحة جانبية يمنى تعرض:

### خصائص (Read)
- `id`, `type`, `state` (running/ok/idle/stopped/unknown), `sub`.
- `last_run`, `last_activity`, `dependencies` (من/إلى).
- إعداداته الحالية (config: فترة ATR, حد R/R, rate limit, schedule cron-expr...).
- سجل آخر N حدث (logs tail).

### أزرار تحكم (Write) — حسب النوع
| نوع العنصر | أزرار التحكم |
|---|---|
| **Scraper** (سكرابر) | ▶ Start · ⏸ Stop · 🔁 Trigger Now · 🎯 Isolate · 📅 Backfill (date range picker) · ⚙ Settings |
| **Engine** (محرك) | ▶ Start · ⏸ Stop · 🔁 Restart · 📋 View Logs · ⚙ Adjust Settings |
| **Database** | 📋 Schema · 📊 Row Counts · 🕐 Last Write · 💾 Backup · 🔒 Read-only toggle |
| **Decision Gate** | 📋 Pass/Killed · ⚙ Threshold (e.g., R/R minimum = 1.5) · 🔁 Re-evaluate |
| **Output** | 📋 View Feed · ⏸ Pause · ▶ Resume |
| **Job** (وظيفة) | ▶ Run Now · ⏸ Disable · ⚙ Schedule (cron expr) |

### خطوط التحكم الحية (Control Lines)
عند إطلاق أي تحكم، يظهر **خط تحكم كهرماني متقطّع** (amber dashed) من مصدر الأمر (لوحة الأدمن أو لوحة الـ DCS) إلى العنصر المستهدف، بنقطة متحركة تتجه نحوه — يبيّن أن الأمر وصل. ثم تتغير حالة العقدة (أحمر للإيقاف، أخضر للتشغيل).

---

## 4. وضع العزل (Isolation Mode)

**"افصل السكرابر بتاع موقع ما"** — عند اختيار Isolate على عنصر:
- كل ما عداه يُعتم (opacity 0.15) — يبقى العنصر المُعزول + تدفقه الكامل (من المصدر إلى الـ DB) وحدهما بارزين.
- خطوط التدفق المرتبطة فقط تُحرك (الباقي ثابت).
- لوحة التحكم تتمركز على العنصر المُعزول (خصائصه + أزراره في المقدمة).
- زر **Exit Isolation** للرجوع للعرض الكامل.

حالات الاستخدام:
- عزل سكرابر Yahoo وحده لمتابعة fetch → parse → DB.
- عزل محرك backtest لمتابعة queue → run → results.

---

## 5. التحكم بالسكرابرات + السحب التاريخي (Backfill)

**"اوقف ياهو او اشغل سحب بيانات من ياهو بتريخ من كذا الى كذا"** — هذا السيناريو المحوري:

### إيقاف سكرابر
- زر ⏸ Stop على `Yahoo scraper` → عقدته تحمر، حوافها تتوقف (لا نقاط متحركة)، job_cron يُحدّث (disables that job).
- صادق: يُسجّل في audit log (من أوقف، متى، لماذا).

### تشغيل سحب تاريخي (Backfill with date range)
- زر 📅 Backfill → يفتح **date-range picker** (from / to) + اختيار الرموز (symbols) + الفترة (daily/intraday).
- عند التأكيد:
  1. تُنشأ مهمة backfill في `backfill queue` (Layer 2 داخل السكرابر).
  2. يظهر **خط تدفق تاريخي** (بمظهر مختلف — بنفسجي أو سماوي غامق) من السكرابر إلى الـ DB بنقاط متحركة تمثل الصفحات تُسحب.
  3. يظهر **شريط تقدّم** على عقدة السكرابر (e.g., 4,200/6542 bars — 64%).
  4. عند الانتهاء، يتوقف الخط التاريخي، ويعود السكرابر لحالته (نشط للاستقبال اللحظي).
- صادق: لا بيانات وهمية — السحب فعلي من Yahoo، والعدّاد من الصفوف المكتوبة فعلاً في price_history.

### جدولة
- كل مهمة backfill مُجدولة بـ cron expr أو one_time (epoch ms) — تستخدم نظام cron الحالي في GLMinvestment.

---

## 6. نموذج البيانات المطلوب (Backend additions — للتنفيذ لاحقاً)

### توسيع الطبقة (Hierarchical Topology)
```
GET /api/dcs/topology                          # Layer 0 (موجود)
GET /api/dcs/topology/{nodeId}                # Layer 1+ (أبناء العقدة)
```
كل عقدة تُمدّ لتشمل: `children: [nodeId...]`، `properties: {...}`، `controls: [action...]`.

### التحكم (Control API — يستهدف الباك إند الإنتاجي)
```
POST /api/dcs/control/{nodeId}/{action}
  body: { params?: { from, to, symbols, ... } }
  → { ok: bool, job_id?: str, message: str }
GET  /api/dcs/node/{nodeId}/logs?limit=50
GET  /api/dcs/node/{nodeId}/status            # حالة لحظية + آخر نشاط
```
أمثلة:
- `POST /api/dcs/control/scraper_yahoo/stop`
- `POST /api/dcs/control/scraper_yahoo/backfill {from:"2024-01-01", to:"2024-06-30", symbols:["COMI","TCFI"]}`
- `POST /api/dcs/control/eng_analysis/restart`

### البيانات الوصفية للسكرابرات (Scraper metadata)
لكل سكرابر: `source_url`, `schedule_cron`, `last_run`, `success_count`, `fail_count`, `rate_limit_per_min`, `circuit_breaker_state`, `backfill_jobs: [{id, from, to, progress, status}]`.

### مصدر الحقيقة (Single source of truth)
- البنية (topology) ثابتة (hardcoded في Python — هي معمارية المشروع).
- الحالات (states) ديناميكية من التيليمتري الحقيقي.
- أوامر التحكم تُوجّه للباك إند الإنتاجي (لن تعمل في الساندبوكس — تُظهر "REQUIRES PRODUCTION BACKEND" بصدق).

---

## 7. تجربة المستخدم (UI/UX)

### التخطيط
- **أعلى**: Header (العنوان + LIVE + الساعة + حالة المحرك الصادقة) + Breadcrumb (الطبقة الحالية).
- **وسط**: منطقة الـ SVG (الرسمة الهرمية) — قابلة للـ zoom/pan.
- **يمين**: لوحة الخصائص + التحكم (تنفتح عند تحديد عقدة؛ تنطوي افتراضياً).
- **أسفل**: Legend + Sticky footer (Bravo 2 · Python calc brain · Rule 4/67b · No mock).

### التفاعل
- **نقرة على عقدة**: تفتح لوحة الخصائص يمين (تحديد، لا غوص).
- **نقرة مزدوجة / زر "Drill In"**: غوص للطبقة الأعمق (أبناء العقدة).
- **نقرة على مساحة فارغة**: إلغاء التحديد.
- **Search**: بحث باسم سكرابر/محرك → تمييز + قفز إليه.
- **Filter by type**: إظهار السكرابرات فقط / المحركات فقط / ...
- **Time slider** (اختياري متقدم): إعادة عرض الحالة في وقت ماضي (replay) — بصدق (من اللوغ).

### الجماليات
- نفس الثيم الصناعي الداكن (#0a0e14) + LEDs نيون + monospace.
- الطبقات: كل طبقة أعمق في لوحة أفتح قليلاً (إحساس عمق).
- الانتقال بين الطبقات: animation (zoom-in على العقدة المفتوحة).

---

## 8. مراحل التنفيذ (Phases — للتنفيذ لاحقاً، ليست الآن)

| المرحلة | النطاق | الجدوى |
|---|---|---|
| **P1** | هرمية الطبقة (node.children) + التنقل (drill-down + breadcrumb + back) | الغوص البصري — لا تحكم بعد |
| **P2** | لوحة الخصائص (قراءة فقط) — تظهر خصائص/حالة/إعدادات العقدة المحددة | فهم تفاصيل كل عنصر |
| **P3** | أوامر التحكم (start/stop/restart/trigger) — Control API + خطوط تحكم حية | تحكم فوري بالمحركات/السكرابرات |
| **P4** | وضع العزل (Isolation) — تعتيم الباقي + تركيز تدفق العنصر | متابعة عنصر منفرداً |
| **P5** | السحب التاريخي (Backfill) — date-range picker + خط تاريخي + شريط تقدّم + جدولة | السيناريو المحوري (Yahoo from-to) |
| **P6** | Search/Filter + Time-replay (من اللوغ) | التشغيل والتحقيق |

كل مرحلة مستقلة + تُختبر بـ Agent Browser قبل الاعتماد.

---

## 9. ملاحظات دستورية (Constitution notes)

- **القاعدة 27 (لا بيانات وهمية)**: كل حالة على الرسمة من تيليمتري حقيقي. لو لا تيليمتري لعنصر → حالة `unknown` (كهرماني) بصدق. في الساندبوكس، أوامر التحكم تُظهر "REQUIRES PRODUCTION BACKEND" بصدق (لا محاكاة تنفيذ).
- **القاعدة 4/67b (Python = calc brain)**: كل الحسابات (ATR/RSI/thresholds/R/R) في Python. لوحة التحكم ترسل أوامر فقط — لا تعيد حساب.
- **القاعدة 81 (لا --force)**: أوامر التحكم لا تُجبر — تنفّذ عبر الـ API الرسمي للباك إند.
- **القاعدة 20 (R/R ≥ 1.5)**: بوابة R/R على الرسمة تُبيّن العتبة + عدد المارّين/المرفوضين — مرئية.
- **السكين الساقطة (Falling Knife)**: بوابة منفصلة على الرسمة تُبيّن الأسهم الممنوعة من إشارات شراء في اتجاه هابط.

---

## 10. الحالة الحالية مقابل الرؤية

| الجانب | الآن (منفّذ) | الرؤية (هذه الوثيقة) |
|---|---|---|
| الطبقة 0 (نظرة المصنع) | ✅ حي (23 عقدة، 20 حافة، 33 نقطة متحركة، بانر IDLE صادق) | ✓ |
| هرمية الطبقات (drill-down) | ❌ | P1 |
| لوحة الخصائص (قراءة) | ❌ | P2 |
| أوامر التحكم | ❌ | P3 |
| وضع العزل | ❌ | P4 |
| السحب التاريخي بفترة | ❌ | P5 |
| الباك إند الإنتاجي متصل | ❌ (المحرك IDLE، snapshot 2026-10-10) | يلزم deploy + تشغيل المحركات |

---

## الخلاصة

هذه الرؤية تُحوّل الـ DCS من **راسماً أحادياً** إلى **نظام SCADA هرمي قابل للغوص + التحكم بالعناصر + العزل + السحب التاريخي** — وكأنّك تتجوّل داخل مصنع حقيقي تُشغّل وتُوقف خطوطه وتراقب تدفقه.

**التنفيذ مؤجّل** بناءً على توجيه المالك: الأولوية الآن **إقامة المشروع الأساسي** (المحركات/قواعد البيانات/الخط الإنتاجي الفعلي)، ثم نعود لهذه الطبقات لاحقاً.

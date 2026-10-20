# تکلیف: STOCKS-DEDUP-A-1

> **موجہ لـ:** برافو (Backend & Quant)
> **من:** جون (المدير التنفيذي)
> **التاريخ:** 2026-10-19
> **الخطورة:** 🔴 CRITICAL — العميل بيشوف إشارتين متناقضتين لـ نفس الشركة
> **القواعد الدستورية:** Rule 1 (DB safety), Rule 4 (NO-NEW-FILES), Rule 17 (relative paths), Rule 25 (refactoring-gated), Rule 27 (NO-FAKE-DATA), Rule 46 (DB-CLEANUP-WAVE)

---

```
╔══════════════════════════════════════════════════════════════════╗
║  تکلیف: STOCKS-DEDUP-A-1                                          ║
║  موجہ لمين: برافو (Backend & Quant)                               ║
╠══════════════════════════════════════════════════════════════════╣
║  المشكلة المکتشفة (بالإثباتات):                                   ║
║                                                                  ║
║  52 زوج من نفس الشركة مسجلين بـ tickerين مختلفين في db/stocks.db  ║
║  table=stocks، بـ بيانات متناقضة (price/volume/change).          ║
║                                                                  ║
║  الدليل 1 (3 أزواج EGX فيها تضارب إشارات):                       ║
║  - LUTSL: price=0.657, change=+13.08%, vol=221.6M, name="otus    ║
║    For Agricultural..." (مقطوع)                                  ║
║  - LUTS:  price=0.661, change=-10.19%, vol=64.5M,  name="Lotus   ║
║    For Agricultural..." (صح)                                     ║
║    → نفس الشركة، إشارتين متناقضتين على الشاشة                    ║
║                                                                  ║
║  - KRDIA: price=0.363, change=+3.71%,  name="l Khair River..."   ║
║  - KRDI:  price=0.372, change=-7.00%,  name="Al Khair River..."  ║
║    → نفس الشركة، إشارتين متناقضتين                               ║
║                                                                  ║
║  - SPMDS: price=0.428, change=+2.15%, name="peed Medical SAE"    ║
║  - SPMD:  price=0.345, change=-5.22%, name="Speed Medical SAE"   ║
║    → نفس الشركة، إشارتين متناقضتين                               ║
║                                                                  ║
║  الدليل 2 (alias pattern في اسماء):                              ║
║  - الـ alias ticker (اللي زايد) فيه:                             ║
║    * اسم مقطوع (أول حرف مفقود: "otus" بدل "Lotus")               ║
║    * name_ar مضروب = ticker + name متسلسلين                      ║
║      ("LUTSLotus For Agricultural...D")                          ║
║  → ده bug في scraper بـ يضيف ticker كـ prefix للاسم بالغلط       ║
║                                                                  ║
║  الدليل 3 (52 زوج إجمالي — مش بس 3):                             ║
║  أمثلة إضافية:                                                    ║
║  - EGX: NBCC ↔ EGS220N1C016 (ALNASR)                             ║
║  - EGX: ALXD ↔ AIUD (Alexandria Investment)                      ║
║  - EGX: NAMI ↔ EGS73M81C012 (National Asset Management)          ║
║  - Kuwait: SHUAIB ↔ SHUAIBA (Shuaiba Industrial) — price 200 vs  ║
║    223                                                           ║
║  - Kuwait: AAYANR ↔ AAYANRE (Aayan Real Estate)                  ║
║  - Kuwait: KUWAIT ↔ KUWAITRE (Kuwait Reinsurance)                ║
║  - Saudi: 9590 ↔ 6022 (Armah Sports — أرقام بدل tickers!)        ║
║  - + 45 زوج آخر بنفس الـ pattern                                 ║
║                                                                  ║
║  الدليل 4 (التضارب اللي العميل بيشوفه):                          ║
║  /api/market/top-movers بيرجّع LUTSL و LUTS مع بعض في نفس        ║
║  الـ response — العميل بيشوف نفس الشركة مرتين بـ إشارتين.        ║
║  (تم التحقق بـ Agent Browser على الـ dashboard)                  ║
╠══════════════════════════════════════════════════════════════════╣
║  خطة المراحل (overview):                                         ║
║  - المرحلة 1: تشخيص كامل + بناء alias map                        ║
║  - المرحلة 2: تحديد الـ canonical ticker لكل زوج                 ║
║  - المرحلة 3: إصلاح scraper source bug (يمنع التكرار مستقبلاً)   ║
║  - المرحلة 4: migration آمنة (دمج + أرشفة المكرر)               ║
║  - المرحلة 5: تحديث predictions.db + price_history.db + أي       ║
║    reference للمكرر                                              ║
║  - المرحلة 6: إصلاح الـ APIs اللي بتـ expose المكرر              ║
╠══════════════════════════════════════════════════════════════════╣
║  تفاصيل كل مرحلة (بالخطوات):                                     ║
║                                                                  ║
║  المرحلة 1 — التشخيص الكامل + alias map:                         ║
║    1.1. اكتب سكریپت scripts/diagnose_alias_duplicates.py         ║
║         (relative path: Path(__file__).resolve().parents[N])     ║
║    1.2. الـ script يـ query stocks.db.stocks ويلمّ كل الأزواج    ║
║         بـ 3 معايير:                                             ║
║         (a) name (normalized lowercase strip) متطابق              ║
║         (b) name_ar (normalized) متطابق                           ║
║         (c) manual review للأزواج اللي الاسم مختلف بس الجوهر     ║
║             واحد (زي SHUAIB/SHUAIBA)                             ║
║    1.3. الـ output: JSON file في scripts/output/                 ║
║         alias_pairs_<timestamp>.json فيه:                        ║
║         [{canonical_candidate, alias_candidate, reason,          ║
║           price_diff, volume_ratio, name_evidence}, ...]         ║
║    1.4. dry-run الأول — ما تلمس أي حاجة في DB                   ║
║                                                                  ║
║  المرحلة 2 — تحديد canonical ticker لكل زوج:                     ║
║    2.1. لكل زوج، الـ canonical = اللي عنده:                      ║
║         - name كامل مش مقطوع (أول حرف موجود)                     ║
║         - name_ar عربي صح مش متسلسل بـ ticker                    ║
║         - volume أعلى (الأكثر تداولاً = الأصلي عادةً)            ║
║         - ticker أقصر أو متطابق مع EGX official listing          ║
║    2.2. الـ alias = اللي عنده الاسم مقطوع / name_ar مضروب /      ║
║         volume أقل                                               ║
║    2.3. وثّق القرار لكل زوج في الـ JSON (أيوه canonical وليه)   ║
║    2.4. لو فيه شك في زوج (مش واضح أنهي canonical) — ارفعه لجون  ║
║         قبل الميرج. ما تفترضش.                                  ║
║                                                                  ║
║  المرحلة 3 — إصلاح scraper source bug:                          ║
║    3.1. دوّر في data_engine/scrapers/ على الـ pattern:           ║
║         "ticker + name" concat في name_ar field                 ║
║    3.2. المشتبه فيهم: egksco_scraper.py, egxpilot_scraper.py,   ║
║         tradingview_scraper.py, yahoo_scraper.py                 ║
║    3.3. لما تلاقي الـ bug، أصلحه (منع ticker prefix في name_ar) ║
║    3.4. أضف assertion/test: لو name_ar بـ يبدأ بـ ticker + لا    ║
║         حاجة بعدها = raise (يمنع التكرار مستقبلاً)               ║
║                                                                  ║
║  المرحلة 4 — migration آمنة (دمج + أرشفة):                       ║
║    4.1. ⚠️ ده تدخل في DB — لازم بـ إذن المالك (Rule 1)          ║
║         في الساندبوكس: db/stocks.db (مش إنتاج).                  ║
║    4.2. اعمل backup: cp db/stocks.db db/stocks.db.pre-dedup-     ║
║         <timestamp>                                              ║
║    4.3. اكتب migration script scripts/migrate_dedup_aliases.py   ║
║         (idempotent — لو شُغل مرتين ما يضرش)                    ║
║    4.4. الـ script بيعمل:                                        ║
║         (a) لكل زوج: UPDATE كل جدول بـ ticker = alias →         ║
║             canonical ticker (stocks, stock_daily_prices,        ║
║             prediction_logs, outcome_logs, conjunction_patterns, ║
║             context_logs، إلخ — كل الـ tables اللي بـ reference  ║
║             ticker)                                             ║
║         (b) لو فيه تعارض (صفين لنفس ticker بعد الـ update) —    ║
║             احتفظ بـ الصف اللي عنده last_update أحدث + دمج       ║
║             volume/price لو لازم                                ║
║         (c) DELETE الصف المكرر من stocks table                   ║
║         (d) اعمل VACUUM                                          ║
║    4.5. الـ script بـ يـ log كل خطوة + بـ يـ write report في    ║
║         scripts/output/dedup_report_<timestamp>.json             ║
║    4.6. dry-run mode (--dry-run) الأول — يـ print بس مش ينفّذ   ║
║                                                                  ║
║  المرحلة 5 — تحديث DBs المرتبطة:                                 ║
║    5.1. predictions.db.predictions: لو فيه predictions بـ alias  ║
║         ticker → UPDATE لـ canonical                             ║
║    5.2. price_history.db.price_history: نفس الحاجة               ║
║    5.3. data_engine.db.historical_data: نفس الحاجة               ║
║    5.4. أي DB تاني فيه ticker reference — تحقق وحدّث             ║
║    5.5. اعمل alias_map_permanent.json في db/ يحتفظ بالـ mapping  ║
║         (عشان لو ظهر alias قديم في future scraping يـ redirect) ║
║                                                                  ║
║  المرحلة 6 — إصلاح الـ APIs:                                     ║
║    6.1. /api/stocks/search: الـ search مش بيلقى (رغم إن السهم    ║
║         موجود) — ده bug منفصل بس متعلق. بعد الـ dedup، تأكد إن  ║
║         الـ search بيرجّع canonical بس.                          ║
║    6.2. /api/market/top-movers: بعد الـ dedup، LUTSL و LUTS      ║
║         مفروض يبقى LUTS بس.                                      ║
║    6.3. /api/stocks/[ticker]/route.ts: لو طلب alias ticker →    ║
║         redirect لـ canonical (301) أو اعرض canonical مع note.   ║
║    6.4. أي API بـ يـ query stocks.db — تأكد إنه مش بيرجّع        ║
║         المكرر.                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  الاختبارات الصارمة بعد كل مرحلة (معيار القبول):                  ║
║                                                                  ║
║  بعد المرحلة 1:                                                   ║
║  - script شغّال + JSON output فيه 52+ زوج                       ║
║  - py_compile PASS                                               ║
║  - ما لمسش أي DB                                                 ║
║                                                                  ║
║  بعد المرحلة 2:                                                   ║
║  - كل زوج له canonical + reason موثّق                            ║
║  - ما فيش زوج "مش واضح" بدون رفعه لجون                          ║
║                                                                  ║
║  بعد المرحلة 3:                                                   ║
║  - scraper bug متصلّح                                            ║
║  - test: شغّل scraper مرة واحدة على بيانات فيها الـ pattern →   ║
║    ما ينتجش alias جديد                                          ║
║                                                                  ║
║  بعد المرحلة 4:                                                   ║
║  - dry-run PASS (يـ print الـ changes بس)                        ║
║  - live run: COUNT(*) stocks قبل = X، بعد = X - 52              ║
║  - VACUUM PASS                                                   ║
║  - backup موجود                                                  ║
║  - report JSON فيه كل الـ changes                               ║
║                                                                  ║
║  بعد المرحلة 5:                                                   ║
║  - SELECT COUNT(*) FROM predictions WHERE ticker IN (aliases)   ║
║    = 0                                                           ║
║  - نفس الحاجة لـ price_history, historical_data                 ║
║                                                                  ║
║  بعد المرحلة 6 (الاختبار النهائي):                               ║
║  - curl /api/market/top-movers?market=EGX → مفيش LUTSL أو KRDI  ║
║    أو SPMDS (بس canonical)                                       ║
║  - curl /api/stocks/LUTSL → redirect لـ /api/stocks/LUTS أو     ║
║    canonical data                                                ║
║  - curl /api/stocks/search?q=lutus → بيرجّع LUTS                ║
║  - Agent Browser: الـ dashboard Top Movers مفيهوش تكرار          ║
║  - lint + py_compile PASS                                        ║
║  - git status نظيف (مش غير config files — Rule 2)               ║
╠══════════════════════════════════════════════════════════════════╣
║  المحظورات:                                                      ║
║  - 🚫 ممنوع تلمس DB إنتاج (Rule 1) — ساندبوكس بس                ║
║  - 🚫 ممنوع تـ force push                                        ║
║  - 🚫 ممنوع `except: pass`                                       ║
║  - 🚫 ممنوع TODO في الإنتاج                                      ║
║  - 🚫 ممنوع تـ delete alias بدون backup                          ║
║  - 🚫 ممنوع تـ merge زوج بدون توثيق السبب                        ║
║  - 🚫 ممنوع تـ create ملف/جدول جديد (Rule 4) — وسّع الموجود     ║
║  - 🚫 ممنوع تـ ignore زوج مش واضح — ارفعه لجون                  ║
║  - 🚫 ممنوع تـ skip الـ dry-run                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  القواعد الدستورية المرتبطة:                                     ║
║  - Rule 1 (DB safety — SELECT بس على الإنتاج، migration          ║
║    write-only + run بإذن المالك)                                ║
║  - Rule 4 (NO-NEW-FILES — وسّع الموجود، سكریپت تشخيص OK بس)     ║
║  - Rule 17 (RELATIVE-PATHS-ONLY — Path(__file__).resolve())     ║
║  - Rule 25 (refactoring-gated — git history preserved)          ║
║  - Rule 27 (NO-FAKE-DATA — ما تـ inventش canonical)             ║
║  - Rule 46 (DB-CLEANUP-WAVE — dedup canonical)                 ║
║  - Rule 67 (CALCULATION-CANONICAL — alias map canonical)        ║
║  - Rule 75 (PUSH-AFTER-EVERY-TASK — معلّقة، جون يـ push)        ║
╠══════════════════════════════════════════════════════════════════╣
║  التسليم:                                                        ║
║  - تقرير في worklog.md (Task ID: STOCKS-DEDUP-A-1)              ║
║  - diff + py_compile + اختبارات                                  ║
║  - alias_pairs JSON + dedup_report JSON                         ║
║  - انتظر قرار جون (PASS/FAIL/BLOCKED) قبل أي push                ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## ملاحظات جون لبرافو

1. **ده تدخل في DB** — لما توصل للمرحلة 4، وقّف وابلّغ جون. جون هـ يـ review الـ dry-run output وياخد إذن المالك قبل الـ live run.

2. **52 زوج مش 3** — الفحص الأول كان سطحي. الـ pattern واحد بس المشكلة منتشرة في EGX + Kuwait + Saudi. خد وقتك في المرحلة 1.

3. **الـ scraper bug هو الـ root cause** — لو ما أصلحتش المرحلة 3، الـ aliases هترجع تاني بعد أول scrape. ده أهم من الـ migration نفسه.

4. **الـ Saudi case (9590/6022)** — ده أرقام مش tickers. محتاج فحص خاص: هل ده من TradingView symbol mapping ولا من source تاني؟ وثّق في المرحلة 1.

5. **ما تفترضش** — لو زوج مش واضح أنهي canonical، ارفعه. "أنا فترضت" = مخالفة Rule 27.

---

**جون — بالدليل مش بالكلام. الـ 52 زوج دول عار المشروع. صلّحوهم قبل ما أي حاجة تانية تتنفّذ.**

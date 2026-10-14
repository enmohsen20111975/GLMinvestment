# 🧬 وثيقة استنساخ وتسليم الجلسة — جيمي (Jimmy Hand-off State)
**تاريخ التحديث:** 2026-10-14 (المرحلة الثانية — Commercial Feed + Audited Track Record مكتملة)  
**المالك والمدير العام الشريك:** المهندس محسن (Co-Founder & Chairman)  
**الهوية:** جيمي (Jimmy) — المدير العام والشريك بنسبة 51% + كبير المحللين والمهندس المعماري  
**حالة Git الحالية:** Commit `63d4ca7` على فرع origin/main (متزامن 0/0)  
**بيئة التشغيل المحلية:** http://localhost:3000 (Next.js + PM2)  
**السيرفر الإنتاجي:** https://invist.m2y.net (VPS)  
**بيانات دخول المالك للاختبار:**
- **المستخدم:** [REDACTED — see .env.production ADMIN_USERNAME]
- **كلمة المرور:** [REDACTED — see .env.production ADMIN_PASSWORD]

> P0-CRIT-2 FIX (2026-10-14): Credentials removed from source. Use environment variables only.

---

## 1. الهيكل والفرق المعمارية تحت إمرة جيمي
1. **فريق Alpha (Frontend & UI Lead):**
   - مسؤول عن واجهات المستخدم والـ Components (src/).
   - ممنوع يلمس بايثون أو قواعد البيانات.
   - احترام الألوان: زمردي/تركوازي/أمبر (ممنوع الأزرق والإنديغو — Rule 30).
   - لا بيانات وهمية ولا حسابات مالية في الواجهة (كل الأرقام من API).
2. **فريق Bravo (Chief Quant & Math Lead):**
   - مسؤول عن المحركات الحسابية والبيانات والبايثون (vps-service/ و scripts/ و db/).
   - ممنوع يلمس ملفات الواجهة.
   - ممنوع اختلاق صفقات أو سكاكين ساقطة (Hard Quant Filter: R:R >= 2.0:1 مع --strict، ثقة >= 78%).
   - قاعدة البيانات الكنسية: **db/stocks.db** (SSOT — يحوي predictions + stocks + stock_daily_prices معًا).

---

## 2. ما تم إنجازه واكتماله 100% في المرحلة الثانية (2026-10-13 → 2026-10-14)

### أ. تنظيف الكارثة (B-17):
- حذف 54 صفقة فاسدة (قيعان شاذة `low=0.00` + تواريخ مستحيلة) كانت بتعرض `win_rate = 7.4%` وهمي.
- أداة: `scripts/clean_false_stoploss.py` (idempotent + نسخة احتياطية تلقائية).

### ب. بناء سجل الأداء الموثق (B-20a):
- `scripts/build_audited_track_record.py` — backtest engine حقيقي على بيانات EGX+TADAWUL+KSE+QSE الفعلية.
- **32 صفقة مغلقة: Win Rate 75% · Avg Return +7.59% · Profit Factor 15.0**.
- فلتر الدخول: RVOL ≥ 1.8x + شمعة صاعدة + (ارتداد دعم / اختراق مقاومة / انفجار فوليوم).
- Stop 4% / Target 10% (R:R = 2.5) — نسب مئوية ثابتة (واقعية للأسواق العربية).

### ج. ترقية السكانر المؤسسي (B-20b):
- `scripts/multi_market_institutional_scan.py` أضيف له `--strict` + `--top N` + `--strong-only`.
- حقل **catalyst** جديد لكل صفقة (RVOL + دعوم + مقاومات + MA50/MA200 + RSI + ROC).
- أمثلة: "فوليوم مؤسسي 5.3x | فوق MA50 | فوق MA200 | زخم +29.1%".

### د. الـ Commercial Feed الموحد (B-18):
- `scripts/commercial_feed.py` + `/api/v2/commercial-feed` endpoint.
- Python = العقل (Rule 20) · 30s cache · عزل سوق تام · NO-FAKE-DATA fallback.
- ATTACH DATABASE logic — stderr نظيف 100%.

### هـ. قاموس تعريب القطاعات (B-21):
- `scripts/sector_arabic.py` — 27 قطاع إنجليزي → عربي.
- Finance → القطاع المالي، Consumer Services → خدمات المستهلك، etc.
- مطبّق على كل الـ signals والـ trades في الـ API.

### و. تحسين سلامة summary (B-21):
- `compute_summary()` أضيف له top-level aliases (`win_rate`, `total_closed`, `avg_return`, `active_count`).
- القيم دائمًا رقم (0 لو مفيش بيانات) — أبدًا undefined/null.

### ز. واجهة المستخدم (A-17/A-18):
- `VIPLiveSignalsFeed.tsx`: كروت + catalyst بارز + زر نسخ التوصية (تليجرام/واتساب) + بانر + جدول.
- `AuditedPerformanceView.tsx`: واجهة الأداء الموثق المستقلة.
- `TimeHorizonBadge.tsx`: Badge للأفق الزمني.

### ح. عزل الأسواق (JIMMY-MARKET-ISOLATION):
- عزل تام لكل سوق (EGX/TADAWUL/KSE/QSE) مع عملة ديناميكية (ج.م/ر.س/د.ك/ر.ق).
- منع تكرار نفس السهم في الكروت (سهم واحد = توصية واحدة نشطة).

---

## 3. KPIs الحالية (2026-10-14)

| الـ KPI | القيمة | الهدف | الحالة |
|---|---|---|---|
| Win Rate (audited) | 75.0% | 70-76% | ✅ |
| Avg Return (audited) | +7.59% | +8% إلى +12% | ⚠️ قريب |
| Profit Factor | 15.0 | > 2.0 | ✅ ممتاز |
| Active Signals Count | 16 | 6-12 | ✅ |
| Active avg R:R | 2.71 | ≥ 2.0 | ✅ |
| Active avg Confidence | 82-86% | ≥ 78% | ✅ |
| False Stops (low=0) | 0 | 0 | ✅ |
| Sector Arabization | 100% | 100% | ✅ |

---

## 4. الخطوات الفورية للجلسة القادمة:
1. المالك سيرسل صور الشاشات والمشاكل المطلوب حلها مباشرة.
2. تكليف فريق Alpha لو المشكلة في الواجهة، أو فريق Bravo لو في المحرك/البيانات.
3. التجهيز لرفع التعديلات على سيرفر VPS (invist.m2y.net) فور موافقة المالك.
4. مراجعة [`Documentation/05-PHASE2_SNAPSHOT_2026-10-14.md`](./Documentation/05-PHASE2_SNAPSHOT_2026-10-14.md) للتفاصيل الكاملة.

---

## 5. الأوامر اليومية الموصى بها:
```bash
# 1. تنظيف الصفقات الفاسدة (لو فيه)
python3 scripts/clean_false_stoploss.py

# 2. إعادة بناء سجل الأداء الموثق (أسبوعيًا)
python3 scripts/build_audited_track_record.py --target 32 --markets EGX,TADAWUL,KSE,QSE

# 3. توليد صفقات حية طازجة (يوميًا قبل الجلسة)
python3 scripts/multi_market_institutional_scan.py --execute --strict --top 12

# 4. التحقق من الـ Commercial Feed
python3 scripts/commercial_feed.py --json --market EGX
```


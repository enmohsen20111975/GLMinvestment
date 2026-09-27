# أدوات الإنتاج الجاهزة (Production-Ready Tools)

> **تاريخ الإصدار:** V40.2 — أغسطس 2026
> **الهدف:** أدوات تشخيص وتقييم وحماية جاهزة للتشغيل على السيرفر الإنتاجي

---

## 📋 المحتويات

1. [سكريبت تشخيص التوصيات](#1-سكريبت-تشخيص-التوصيات)
2. [سكريبت التقييم (Backtest)](#2-سكريبت-التقييم-backtest)
3. [أداة الحماية المؤقتة](#3-أداة-الحماية-المؤقتة)
4. [تعليمات التشغيل على الإنتاج](#4-تعليمات-التشغيل-على-الإنتاج)

---

## 1. سكريبت تشخيص التوصيات

**الملف:** `vps-service/tools/diagnose_predictions.py`

يقرأ من جدول التوقعات الفعلي (`predictions` في `predictions.db`) ويحسب على آخر 30 و 60 يومًا:

- عدد التوصيات (الكل / المستوطة / المعلقة)
- Win Rate
- متوسط العائد (للرابحة / للخاسرة / الإجمالي)
- Profit Factor
- أداء جرس الصباح منفصل (`morning_bell = 1`)
- توزيع الخسائر vs الأرباح (histogram)
- توزيع الأدلة (`evidence_count`) للـ V40
- Max Drawdown (من منحنى equity)

**الإخراج:**
- تقرير واضح في الترمينال
- ملف JSON مفصل
- ملف Markdown قابل للقراءة

**المزايا:**
- ✅ آمن: يفتح قاعدة البيانات في وضع readonly
- ✅ خفيف: استعلامات SQL مجمّعة
- ✅ لا يعدّل أي بيانات
- ✅ exit code للتنبيه: 0 = سليم، 2 = WR<40% أو PF<1.0

### الاستخدام

```bash
# أساسي (كل الأوقات + 30/60 يوم)
python3 vps-service/tools/diagnose_predictions.py

# فلترة حسب persona
python3 vps-service/tools/diagnose_predictions.py --persona balanced

# فلترة حسب market
python3 vps-service/tools/diagnose_predictions.py --market EGX

# مسار DB مخصص
python3 vps-service/tools/diagnose_predictions.py --db /path/to/predictions.db

# تحديد فترة إضافية
python3 vps-service/tools/diagnose_predictions.py --days 90
```

### الإخراج

الملفات تُحفظ في: `vps-service/backtest_results/`
- `diagnosis_YYYYMMDD_HHMMSS.json` — تفاصيل كاملة
- `diagnosis_YYYYMMDD_HHMMSS.md` — تقرير Markdown

---

## 2. سكريبت التقييم (Backtest)

**الملف:** `vps-service/tools/evaluate_predictions.py`

يعيد محاكاة التوصيات المخزنة فعليًا ضد بيانات الأسعار الحقيقية (`price_history.db`):

- Win Rate / Profit Factor
- متوسط الربح / متوسط الخسارة
- Max Drawdown (مع Position Sizing)
- Total Return / Equity النهائي
- أداء جرس الصباح منفصل
- توزيع أسباب الخروج (hit_target / hit_stop / expired / trailing_stop)
- **فحص جودة البيانات:** مقارنة النتائج المحسوبة vs المخزنة

**المزايا:**
- ✅ خفيف جدًا (756 صفقة في 0.1 ثانية)
- ✅ يحمّل سعر كل سهم مرة واحدة فقط (cache)
- ✅ يقدر يشتغل في background (`nohup` / `screen`)
- ✅ آمن: readonly على قواعد البيانات
- ✅ وضعان: `simple` (سريع) و `full` (مع partial_exit + trailing)

### الاستخدام

```bash
# أساسي (simple mode، كل التوصيات المستوطة)
python3 vps-service/tools/evaluate_predictions.py

# وضع full (مع partial_exit + trailing — أدق لكن أبطأ قليلًا)
python3 vps-service/tools/evaluate_predictions.py --mode full

# آخر 60 يوم فقط
python3 vps-service/tools/evaluate_predictions.py --days 60

# حد أقصى 200 صفقة (للتجربة السريعة)
python3 vps-service/tools/evaluate_predictions.py --limit 200

# تخصيص نسبة المخاطرة
python3 vps-service/tools/evaluate_predictions.py --risk-pct 2.0

# حفظ تفاصيل كل صفقة
python3 vps-service/tools/evaluate_predictions.py --save-trades

# ملخص قصير فقط (للـ cron)
python3 vps-service/tools/evaluate_predictions.py --quiet
```

### التشغيل في Background

```bash
# بطريقة nohup
nohup python3 vps-service/tools/evaluate_predictions.py --mode full > eval.log 2>&1 &
tail -f eval.log

# بطريقة screen
screen -dmS eval python3 vps-service/tools/evaluate_predictions.py --mode full
screen -r eval  # للعودة للجلسة
```

### الإخراج

الملفات تُحفظ في: `vps-service/backtest_results/`
- `evaluation_YYYYMMDD_HHMMSS_simple.json` — مقاييس + صفقات (مع `--save-trades`)
- `evaluation_YYYYMMDD_HHMMSS_simple.md` — تقرير Markdown

---

## 3. أداة الحماية المؤقتة

**الملفات:**
- `vps-service/tools/toggle_protection.py` — أداة CLI للتحكم
- `src/lib/protection/display-protection.ts` — مكتبة Next.js
- `db/display_protection.json` — ملف التكوين (runtime، gitignored)
- `db/display_protection.example.json` — القالب (مرفق)

تتيح تقييد العرض مؤقتًا على العملاء:

| الوضع | الوصف |
|-------|-------|
| `off` | 🔴 معطّل — كل التوقعات معروضة (افتراضي) |
| `morning_bell` | 🟢 جرس الصباح فقط (أعلى توقع/يوم) |
| `top_confidence` | 🟡 أعلى N توقعات ثقة/يوم |
| `hide_weak` | 🟠 إخفاء الإشارات الضعيفة (evidence < N أو score < M) |

**المعايرات المتاحة:**
- `--top-n N` (لـ top_confidence): عدد التوقعات/يوم (default: 3)
- `--min-evidence N` (لـ hide_weak): أدنى evidence_count (default: 4)
- `--min-score M` (لـ hide_weak): أدنى master_score (default: 70)
- `--min-confidence C` (لـ hide_weak): أدنى confidence (default: 70)

### الاستخدام

```bash
# عرض الحالة الحالية
python3 vps-service/tools/toggle_protection.py status

# تفعيل جرس الصباح فقط (الأكثر أمانًا)
python3 vps-service/tools/toggle_protection.py morning_bell --by "admin" --reason "مراجعة جودة"

# تفعيل أعلى 3 توقعات ثقة
python3 vps-service/tools/toggle_protection.py top_confidence --top-n 3

# إخفاء الإشارات الضعيفة
python3 vps-service/tools/toggle_protection.py hide_weak --min-evidence 4 --min-score 70

# اختصار: 'on' = morning_bell
python3 vps-service/tools/toggle_protection.py on

# إلغاء الحماية
python3 vps-service/tools/toggle_protection.py off
```

### كيف يعمل

1. الـ CLI يكتب التكوين في `db/display_protection.json`
2. الـ Next.js API routes بتقرأ الملف (مع cache 30 ثانية):
   - `/api/predictions/honest-tracking/list` — قائمة التوقعات
   - `/api/predictions/honest-tracking/live-tracking` — التتبع اللحظي
3. الفلتر يُطبّق على مستويين:
   - **SQL-level** (لكفاءة عالية): `morning_bell = 1` أو `evidence_count >= N OR master_score >= M`
   - **JS-level** (لـ top_confidence): تجميع حسب (date, persona) وأخذ top-N
4. الـ API response بيرجع حقل `protection` يوضح الوضع الحالي

**ملاحظة:** التفعيل فوري تقريبًا (خلال 30 ثانية بسبب cache). لإلغاء الـ cache فورًا، أعد تشغيل Next.js.

---

## 4. تعليمات التشغيل على الإنتاج

### المتطلبات الأساسية

- Python 3.9+ (مع `sqlite3` مدمج — لا حاجة لـ pip install)
- قواعد البيانات في مكانها:
  - `db/predictions.db`
  - `db/price_history.db` (للتقييم فقط)

### الخطوة 1: سحب التحديثات

```bash
cd /path/to/project
git pull origin main
```

### الخطوة 2: تشخيص سريع (5 دقائق)

```bash
# شغّل التشخيص وراجع الأرقام
python3 vps-service/tools/diagnose_predictions.py

# راجع التقرير
cat vps-service/backtest_results/diagnosis_*.md | tail -40
```

**ماذا تبحث عن:**
- Win Rate ≥ 40% في آخر 30 يوم؟
- Profit Factor ≥ 1.0؟
- جرس الصباح WR ≥ 50%؟
- لو أي رقم ضعيف → فعّل الحماية (الخطوة 4)

### الخطوة 3: تقييم تفصيلي (10 دقائق)

```bash
# تقييم كل التوصيات (simple mode — سريع)
python3 vps-service/tools/evaluate_predictions.py --mode simple

# لو عايز تقييم أدق (مع partial + trailing)
python3 vps-service/tools/evaluate_predictions.py --mode full --save-trades

# راجع النتائج
cat vps-service/backtest_results/evaluation_*.md | tail -30
```

**ماذا تبحث عن:**
- PF المحسوب vs المخزن — هل فيه فرق كبير؟ (data quality)
- MaxDD معقول (< 30%)؟
- exit_reasons: نسبة hit_stop عالية؟ → المشكلة في entry conditions

### الخطوة 4: تفعيل الحماية (لو لزم)

```bash
# لو الأرقام ضعيفة، فعّل جرس الصباح فقط فورًا
python3 vps-service/tools/toggle_protection.py morning_bell --by "$(whoami)" --reason "WR منخفض - مراجعة"

# تحقق من التفعيل
python3 vps-service/tools/toggle_protection.py status

# اختبر الـ API (تأكد إن protection يظهر في الرد)
curl -s "http://localhost:3000/api/predictions/honest-tracking/list?limit=5" | python3 -m json.tool | grep protection
```

**الفلتر بيتطبّق خلال 30 ثانية.** العملاء هيشوفوا بس جرس الصباح.

### الخطوة 5: مراقبة مستمرة (اختياري)

```bash
# cron يومي للتشخيص (3 صباحًا)
crontab -e
# أضف:
0 3 * * * cd /path/to/project && python3 vps-service/tools/diagnose_predictions.py --quiet >> /var/log/prediction_diagnosis.log 2>&1

# لو exit code = 2 (WR<40% أو PF<1.0)، تقدر تضيف تنبيه:
# 0 3 * * * cd /path/to/project && python3 vps-service/tools/diagnose_predictions.py --quiet || /path/to/alert_script.sh
```

### الخطوة 6: إلغاء الحماية (بعد الإصلاح)

```bash
python3 vps-service/tools/toggle_protection.py off
```

---

## 📁 ملخص الملفات

```
vps-service/tools/
├── diagnose_predictions.py      # أداة التشخيص (readonly، آمن)
├── evaluate_predictions.py      # أداة التقييم/Backtest (readonly، خفيف)
└── toggle_protection.py         # أداة الحماية المؤقتة (CLI)

src/lib/protection/
└── display-protection.ts        # مكتبة Next.js لقراءة التكوين وتطبيق الفلتر

db/
├── display_protection.json      # تكوين runtime (gitignored)
└── display_protection.example.json  # القالب (مرفق في git)
```

## ⚠️ ملاحظات مهمة

1. **كل الأدوات readonly** على قواعد البيانات — لا تخاف من تشغيلها على الإنتاج
2. **الحماية مؤقتة** — صُممت للتشغيل السريع وقت الأزمات، ليست بديلًا عن إصلاح جودة التوقعات
3. **الـ cache 30 ثانية** — أي تغيير في الحماية يظهر خلال 30 ثانية
4. **exit codes:**
   - `0` = كل شيء سليم
   - `2` = WR < 40% أو PF < 1.0 (للتنبيه في cron)
   - `1` = خطأ (DB غير موجود، إلخ)
5. **لو عندك multiple personas** — شغّل التشخيص لكل persona منفصلة:
   ```bash
   python3 vps-service/tools/diagnose_predictions.py --persona balanced
   python3 vps-service/tools/diagnose_predictions.py --persona gambler
   python3 vps-service/tools/diagnose_predictions.py --persona conservative
   ```

---

## 🔄 سير العمل الموصى به

```
كل صباح:
  1. python3 vps-service/tools/diagnose_predictions.py --quiet
  2. لو exit code = 2 → راجع التقرير
  3. لو الأرقام ضعيفة → toggle_protection.py morning_bell
  4. شغّل evaluate_predictions.py أسبوعيًا للمتابعة التفصيلية
  5. بعد تحسين التوقعات → toggle_protection.py off
```

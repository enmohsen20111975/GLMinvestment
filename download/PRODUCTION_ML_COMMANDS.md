# 🚀 أوامر السيرفر — تدريب ML Overlay + التوقعات الجديدة

> **السيرفر الإنتاجي:** `/root/GLMinvestment/`
> **آخر commit على GitHub:** `4b359a59` — `feat(ml-overlay): رفع ملفات ML على GitHub للسيرفر`
> **التاريخ:** 2026-10-06

---

## 📋 ما تم رفعه على GitHub (للسيرفر)

| الملف | الحجم | الوصف |
|---|---|---|
| `vps-service/analyzers/feature_extractor.py` | 10 KB | استخراج 10 features |
| `vps-service/analyzers/train_ml_model.py` | 10 KB | XGBoost + StratifiedKFold |
| `vps-service/ml_models/ml_overlay_v1.pkl` | 154 KB | النموذج (متدرب على 86 عينة) |
| `scripts/output/ml_training_data.json` | 55 KB | بيانات التدريب |
| `scripts/output/ml_model_metrics.json` | 1.8 KB | metrics |

**ملاحظة مهمة:** الـ ML Overlay **معطّل** من `daily_predictor.py` (REVERTED). لازم تفعّله بعد التدريب الناجح على السيرفر.

---

## ⚠️ قبل البدء: تحقق من حالة السيرفر

```bash
# 1. سحب آخر التحديثات من GitHub
cd /root/GLMinvestment
git pull origin main

# 2. التحقق من آخر commit (لازم يكون 4b359a59)
git log --oneline -3

# 3. التحقق من الملفات الجديدة موجودة
ls -la vps-service/analyzers/feature_extractor.py
ls -la vps-service/analyzers/train_ml_model.py
ls -la vps-service/ml_models/ml_overlay_v1.pkl

# 4. التحقق من حالة الخدمات
pm2 status

# 5. التحقق من الذاكرة المتاحة
free -h

# 6. التحقق من المساحة على القرص
df -h /root
```

---

## 🧠 المرحلة 1: تثبيت مكتبات ML على السيرفر

```bash
cd /root/GLMinvestment

# تفعيل الـ venv
source vps-service/venv/bin/activate
# أو:
# source .venv/bin/activate  (لو الـ venv في الجذر)

# تثبيت المكتبات
pip install xgboost lightgbm hmmlearn arch scikit-learn

# التحقق من التثبيت
python3 -c "
import xgboost; print(f'xgboost: {xgboost.__version__}')
from hmmlearn import hmm; print('hmmlearn: OK')
import arch; print(f'arch: {arch.__version__}')
import sklearn; print(f'sklearn: {sklearn.__version__}')
"

# خروج من الـ venv
deactivate
```

**الوقت المتوقع:** 2-3 دقائق

---

## 📊 المرحلة 2: تدريب النموذج على بيانات السيرفر الحقيقية

### الخطوة 2.1: استخراج features من كل التوقعات

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# استخراج features من كل التوقعات المحسومة (TARGET_HIT + STOPPED)
python3 vps-service/analyzers/feature_extractor.py

# النتيجة المتوقعة على السيرفر:
# - Total resolved predictions: 1000+ (مش 86 زي الساندبوكس)
# - سيتم حفظ JSON في scripts/output/ml_training_data.json
```

### الخطوة 2.2: تدريب النموذج

```bash
# تدريب XGBoost بـ StratifiedKFold
python3 vps-service/analyzers/train_ml_model.py

# النتيجة المتوقعة:
# - Avg Accuracy: 90%+
# - النموذج محفوظ في: vps-service/ml_models/ml_overlay_v1.pkl
# - metrics في: scripts/output/ml_model_metrics.json
```

### الخطوة 2.3: اختبار النموذج

```bash
# اختبار سريع على سهم معين
python3 -c "
import sys
sys.path.insert(0, 'vps-service')
from analyzers.feature_extractor import extract_features_for_prediction
from analyzers.train_ml_model import predict_probability

# استخدم آخر توقع لـ COMI
pred_row = {
    'ticker': 'COMI',
    'entry_price': 125.16,
    'target_price': 140,
    'stop_loss': 116,
    'prediction_date': '2026-10-06',
    'master_score': 80,
    'atr_at_entry': 3.5,
    'status': 'active',
}
features = extract_features_for_prediction(pred_row)
proba = predict_probability(features)
print(f'COMI ML probability: {proba*100:.1f}%')
"

deactivate
```

**الوقت المتوقع:** 1-2 دقيقة

---

## ✅ المرحلة 3: تفعيل الـ ML Overlay في الكود

> ⚠️ **مهم:** لو النموذج في المرحلة 2 رجّع accuracy ≥ 85% → نفعّل الـ ML
> لو أقل → نأجل التفعيل

### الخطوة 3.1: تفعيل الـ ML Overlay

```bash
cd /root/GLMinvestment

# تفعيل الـ ML في daily_predictor.py
# السطر 2928 — ابحث عن: "ML OVERLAY (Task IMPROVEMENT-08"
# لو مش موجود → الإضافة مش متفعّلة، أضفها يدوياً:

# (السكريبت ده بيضيف الـ ML Overlay code لو مش موجود)
python3 -c "
import re
path = 'vps-service/jobs/daily_predictor.py'
with open(path, 'r') as f:
    content = f.read()
# ... الكود موجود في commit 5ed1f36d قبل الـ REVERT
# لازم تعمل git checkout 5ed1f36d~1 -- vps-service/jobs/daily_predictor.py
# لكن ده متقدم — ينصح بمراجعة المبرمج
"
```

**البديل الأسهل:** أضفت الكود مُعطّل في comment. شيل علامة الـ comment:

```bash
cd /root/GLMinvestment

# ابحث عن الـ ML Overlay code (معطّل)
grep -n "ML OVERLAY" vps-service/jobs/daily_predictor.py
# لو موجود → شيل الـ # من أول كل سطر
# لو مش موجود → لازم نضيفه يدوياً (راجع المبرمج)
```

### الخطوة 3.2: إعادة بناء + إعادة تشغيل

```bash
# إعادة بناء Next.js (لو فيه تعديلات في src/)
# بس الكود الحالي بـ Python بس — مش محتاج build

# إعادة تشغيل Python backend
pm2 restart python-backend --update-env

# التحقق
sleep 5
curl -s http://127.0.0.1:8010/health | python3 -m json.tool
```

---

## 🎯 المرحلة 4: توليد توقعات جديدة (مع ML Overlay)

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# توليد توقعات لليوم
python3 vps-service/jobs/daily_predictor.py --today-only --force

# أو توليد لآخر 7 أيام
python3 vps-service/jobs/daily_predictor.py --start 2026-09-29 --end 2026-10-06 --force

# مشاهدة الـ log
tail -50 /tmp/v402_run.log

deactivate
```

**النتيجة المتوقعة:**
- توقعات جديدة مكتوبة في `predictions.db`
- كل توقع فيه `ml_confidence_pct` (لو ML مفعّل)
- كل توقع فيه `analysis_reason` (نص عربي شارح)
- كل توقع فيه `target_3` (DNA projection)

---

## 📈 المرحلة 5: باك-تست على الوضع الجديد

### الخطوة 5.1: باك-تست آخر 7 أيام

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# مسح التوقعات القديمة في الفترة (احذر — بيحذف بيانات!)
python3 -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
n = conn.execute(\"DELETE FROM predictions WHERE prediction_date BETWEEN '2026-09-29' AND '2026-10-06'\").rowcount
conn.commit()
print(f'Deleted {n} old predictions')
conn.close()
"

# تشغيل باك-تست
python3 vps-service/jobs/daily_predictor.py --start 2026-09-29 --end 2026-10-06 --force > /tmp/backtest.log 2>&1

# إحصائيات
python3 -c "
import sqlite3
from collections import Counter
conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
rows = conn.execute(\"SELECT signal, status, master_score FROM predictions WHERE prediction_date BETWEEN '2026-09-29' AND '2026-10-06'\").fetchall()
print(f'Total predictions: {len(rows)}')
sig_dist = Counter(r['signal'] for r in rows)
for s, n in sig_dist.most_common():
    print(f'  {s}: {n}')
"

deactivate
```

### الخطوة 5.2: باك-تست شهر كامل (لمراقبة الأداء)

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# باك-تست على آخر 30 يوم
python3 vps-service/jobs/daily_predictor.py --start 2026-09-06 --end 2026-10-06 --force > /tmp/backtest_30d.log 2>&1

# الـ log هيكون كبير — خد منه آخر 100 سطر
tail -100 /tmp/backtest_30d.log

deactivate
```

---

## 📊 المرحلة 6: فحص النتائج + التقارير

### الخطوة 6.1: فحص التوقعات الجديدة

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

# فحص آخر 20 توقع
python3 -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
rows = conn.execute('''
    SELECT ticker, signal, master_score, entry_price, target_price, stop_loss,
           prediction_date, ml_confidence_pct
    FROM predictions
    ORDER BY id DESC LIMIT 20
''').fetchall()
for r in rows:
    ml = f' ML={r[\"ml_confidence_pct\"]}%' if r['ml_confidence_pct'] else ''
    print(f'{r[\"prediction_date\"]} {r[\"ticker\"]:8s} {r[\"signal\"]:12s} score={r[\"master_score\"]} entry={r[\"entry_price\"]} target={r[\"target_price\"]} stop={r[\"stop_loss\"]}{ml}')
"

deactivate
```

### الخطوة 6.2: إحصائيات شاملة

```bash
cd /root/GLMinvestment
source vps-service/venv/bin/activate

python3 -c "
import sqlite3
from collections import Counter
conn = sqlite3.connect('db/predictions.db')
rows = conn.execute('SELECT signal, status, COUNT(*) FROM predictions GROUP BY signal, status ORDER BY signal, status').fetchall()
print('=== Predictions distribution ===')
for r in rows:
    print(f'  {r[0]:12s} {r[1]:10s}: {r[2]}')
"

deactivate
```

---

## 🔄 المرحلة 7: إعادة تدريب دوري (Cron Job)

> **موصى به:** إعادة تدريب النموذج أسبوعياً (كل ليلة جمعة)

### إعداد الـ cron job:

```bash
# فتح crontab
crontab -e

# أضف السطر ده (كل ليلة جمعة 1:00 صباحاً):
0 1 * * 5 cd /root/GLMinvestment && source vps-service/venv/bin/activate && python3 vps-service/analyzers/feature_extractor.py && python3 vps-service/analyzers/train_ml_model.py >> logs/ml_retrain.log 2>&1

# احفظ + خرج
```

---

## 🛠 في حالة المشاكل

### لو الـ ML مكسور

```bash
# 1. عطّل الـ ML Overlay مؤقتاً (راجع daily_predictor.py)
# 2. أعد التشغيل
pm2 restart python-backend --update-env

# 3. شغل توقعات بدون ML
python3 vps-service/jobs/daily_predictor.py --today-only --force
```

### لو الـ predictions.db اتلفت

```bash
# استرجاع من آخر backup
cd /root/GLMinvestment
cp db/_backups/predictions_*.bak db/predictions.db

# أو من GitHub (آخر DB snapshot)
# (مش متوفر — لازم ترفعه من لوحة الأدمن)
```

### لو فيه OOM (نفاد الذاكرة)

```bash
# 1. أوقف أي عمليات ثقيلة
pm2 stop python-backend

# 2. حرّر الذاكرة
sync && echo 3 > /proc/sys/vm/drop_caches

# 3. أعد التشغيل
pm2 start python-backend --update-env

# 4. متابعة
pm2 monit
```

---

## 📋 Checklist نهائي

- [ ] `git pull origin main` نجح
- [ ] آخر commit = `4b359a59`
- [ ] ملفات ML موجودة (`feature_extractor.py` + `train_ml_model.py` + `ml_overlay_v1.pkl`)
- [ ] مكتبات ML مثبتة (`xgboost` + `hmmlearn` + `arch`)
- [ ] `feature_extractor.py` اشتغل (يفضل ≥500 عينة)
- [ ] `train_ml_model.py` اشتغل (Avg Accuracy ≥ 85%)
- [ ] ML Overlay مفعّل في `daily_predictor.py`
- [ ] Python backend اتعمل restart
- [ ] `/api/health` يرجع `ok`
- [ ] توقعات جديدة اتولّدت
- [ ] باك-تست على آخر 7 أيام اتعمل
- [ ] cron job لإعادة التدريب اتضبط

---

## 📞 الدعم

لو فيه أي مشكلة، ارسل الـ output الكامل للأمر ده:
```bash
cd /root/GLMinvestment
git log --oneline -3
pm2 status
free -h
df -h
```

# 🚀 أوامر اللابتوب (meme@meme) — تدريب ML Overlay

> **المسار:** `/home/meme/my_apps/GLMinvestment/`
> **المستخدم:** meme (مش root)
> **التاريخ:** 2026-10-06

---

## ⚠️ المشاكل اللي عندك (الحلول):

| المشكلة | السبب | الحل |
|---|---|---|
| `cd /root/GLMinvestment: Permission denied` | أنت مش root | استخدم `/home/meme/my_apps/GLMinvestment` |
| `vps-service/venv/bin/activate: No such file` | مفيش venv على اللابتوب | إنشاء venv جديد |
| `externally-managed-environment` | Python 3.12 على Debian يمنع pip install global | استخدم venv + activate |

---

## 🧠 المرحلة 1: إنشاء venv على اللابتوب

```bash
# 1. اذهب لمجلد المشروع
cd /home/meme/my_apps/GLMinvestment

# 2. إنشاء Python venv جديد
python3 -m venv vps-service/venv

# 3. تفعيل الـ venv
source vps-service/venv/bin/activate

# 4. تحديث pip
pip install --upgrade pip

# 5. تثبيت المكتبات الأساسية من requirements.txt
pip install -r vps-service/requirements.txt

# 6. تثبيت مكتبات ML
pip install xgboost lightgbm hmmlearn arch scikit-learn

# 7. تثبيت a2wsgi (مطلوب من main.py لو هتشغل backend)
pip install a2wsgi

# 8. التحقق من التثبيت
python3 -c "
import xgboost; print(f'✅ xgboost: {xgboost.__version__}')
from hmmlearn import hmm; print('✅ hmmlearn: OK')
import arch; print(f'✅ arch: {arch.__version__}')
import sklearn; print(f'✅ scikit-learn: {sklearn.__version__}')
import flask; print(f'✅ flask: {flask.__version__}')
"

# 9. للخروج من الـ venv (لو محتاج)
# deactivate
```

**الوقت المتوقع:** 5-7 دقائق (تحميل + تثبيت)

---

## 📊 المرحلة 2: تدريب النموذج على بيانات اللابتوب

> **ملاحظة مهمة:** اللابتوب عندك بياناته أحدث من الساندبوكس لأنك بتسحب DBs من الإنتاج بشكل دوري

```bash
# 1. تأكد إن venv مفعل
cd /home/meme/my_apps/GLMinvestment
source vps-service/venv/bin/activate

# 2. استخراج features من كل التوقعات المحسومة
python3 vps-service/analyzers/feature_extractor.py

# النتيجة المتوقعة:
# - Total resolved predictions: 500-1500 (مش 86 زي الساندبوكس)
# - سيتم حفظ JSON في scripts/output/ml_training_data.json

# 3. تدريب النموذج
python3 vps-service/analyzers/train_ml_model.py

# النتيجة المتوقعة:
# - Avg Accuracy: 90%+ (لأنه عندك بيانات أكثر)
# - النموذج محفوظ في: vps-service/ml_models/ml_overlay_v1.pkl
# - metrics في: scripts/output/ml_model_metrics.json

# 4. للخروج من الـ venv
deactivate
```

**الوقت المتوقع:** 2-3 دقائق

---

## ✅ المرحلة 3: اختبار النموذج

```bash
cd /home/meme/my_apps/GLMinvestment
source vps-service/venv/bin/activate

# اختبار على آخر توقع لـ COMI
python3 -c "
import sys
sys.path.insert(0, 'vps-service')
from analyzers.feature_extractor import extract_features_for_prediction
from analyzers.train_ml_model import predict_probability

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
print()
print('Features:')
for k, v in features.items():
    if k not in ('target', 'ticker', 'prediction_date'):
        print(f'  {k}: {v:.4f}')
"

deactivate
```

---

## 🎯 المرحلة 4: توليد توقعات جديدة (لو عايز تشغل على اللابتوب)

> ⚠️ **ملاحظة:** اللابتوب عندك DBs حقيقية — التوقعات هتنكتب في `predictions.db` الحقيقي. لو مش عايز تعدّل الإنتاج، **تجاهل المرحلة دي**.

```bash
cd /home/meme/my_apps/GLMinvestment
source vps-service/venv/bin/activate

# توليد توقعات لليوم
python3 vps-service/jobs/daily_predictor.py --today-only --force

# أو توليد لآخر 7 أيام
python3 vps-service/jobs/daily_predictor.py --start 2026-09-29 --end 2026-10-06 --force

deactivate
```

---

## 📈 المرحلة 5: باك-تست على الوضع الجديد

```bash
cd /home/meme/my_apps/GLMinvestment
source vps-service/venv/bin/activate

# باك-تست آخر 7 أيام
python3 vps-service/jobs/daily_predictor.py --start 2026-09-29 --end 2026-10-06 --force > /tmp/backtest.log 2>&1

# مشاهدة الإحصائيات
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

---

## 🚀 الخطوة النهائية: رفع النموذج المُدرّب للابتوب على GitHub

> **مهم:** بعد ما تدرّب النموذج على اللابتوب ببيانات حقيقية، ارفعه على GitHub عشان السيرفر يستفيد منه.

```bash
cd /home/meme/my_apps/GLMinvestment

# 1. git add النموذج الجديد + الـ metrics
git add vps-service/ml_models/ml_overlay_v1.pkl
git add scripts/output/ml_training_data.json
git add scripts/output/ml_model_metrics.json

# 2. commit
git commit -m "feat(ml-overlay): إعادة تدريب النموذج على بيانات اللابتوب (1500+ عينة)

- تم تدريب النموذج على بيانات الإنتاج الحقيقية من اللابتوب
- Avg Accuracy: XX% (اكتب الرقم الحقيقي)
- جاهز للتفعيل على السيرفر الإنتاجي
"

# 3. push على GitHub
git push origin main
```

---

## 🛠 في حالة المشاكل

### لو venv ما اشتغلش

```bash
# حذف venv القديم + إنشاء جديد
rm -rf vps-service/venv
python3 -m venv vps-service/venv
source vps-service/venv/bin/activate
pip install --upgrade pip
```

### لو pip install فشل (externally-managed)

```bash
# لو لسه بتظهر رسالة externally-managed-environment
# معناه إن venv مش مفعّل. تأكد:
which python3  # لازم يرجع: /home/meme/my_apps/GLMinvestment/vps-service/venv/bin/python3
which pip      # لازم يرجع: /home/meme/my_apps/GLMinvestment/vps-service/venv/bin/pip
```

### لو Python 3.12 مش متوفر

```bash
# تثبيت Python 3.11 أو 3.12
sudo apt update
sudo apt install python3.12 python3.12-venv python3.12-dev
```

### لو فيه أخطاء في الـ DBs

```bash
# استخراج DBs من GitHub (آخر backup)
cd /home/meme/my_apps/GLMinvestment/data
ls -la *.zip  # شوف آخر backup
unzip db_backup_*.zip -d ../db/
```

---

## 📋 Checklist نهائي للابتوب

- [ ] `git pull origin main` نجح (آخر commit = `60cd9be9`)
- [ ] `python3 -m venv vps-service/venv` نجح
- [ ] `source vps-service/venv/bin/activate` نجح
- [ ] `pip install xgboost hmmlearn arch scikit-learn` نجح
- [ ] `python3 vps-service/analyzers/feature_extractor.py` اشتغل (≥500 عينة)
- [ ] `python3 vps-service/analyzers/train_ml_model.py` اشتغل (Avg Accuracy ≥ 85%)
- [ ] اختبار `predict_probability` رجّع قيم منطقية (≥50%)
- [ ] `git add` + `commit` + `push` للنموذج المُدرّب على GitHub

---

## 📞 بعد ما تخلص

ابعتلي الـ output الكامل لأمر:
```bash
cd /home/meme/my_apps/GLMinvestment
source vps-service/venv/bin/activate
python3 vps-service/analyzers/feature_extractor.py
python3 vps-service/analyzers/train_ml_model.py
```

عشان أشوف الأرقام وأقولك الخطوة التالية.

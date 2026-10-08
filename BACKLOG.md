# 📋 BACKLOG — المهام المعلّقة (Phase 2+)

> **آخر تحديث:** 2026-10-07
> **المسؤول:** الوكيل (Z.ai Code) — تحت إشراف المالك
> **المرجع:** Rule 71 (AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST)

---

## 🔴 مهام عاجلة (قبل أي حاجة تانية)

### 1. رفع نموذج اللابتوب على GitHub + سحبه على السيرفر
- **السبب:** نموذج اللابتوب أفضل (588 عينة، Accuracy=93.2%) من السيرفر (270 عينة، 82.2%)
- **الأمر على اللابتوب:**
  ```bash
  cd /home/meme/my_apps/GLMinvestment
  git add vps-service/ml_models/ml_overlay_v1.pkl
  git add scripts/output/ml_training_data.json
  git add scripts/output/ml_model_metrics.json
  git commit -m "feat(ml): نموذج 588 عينة — Accuracy 93.2%"
  git push origin main
  ```
- **الأمر على السيرفر:**
  ```bash
  cd /root/GLMinvestment
  git pull origin main
  pm2 restart python-backend --update-env
  ```

### 2. تحديث السيرفر بآخر الكود (HMM + UI + Telegram)
- **السبب:** السيرفر لسه مش محدّث بآخر commits (HMM + WHO IS BUYING + DNA + analysis_reason + UI badges)
- **الأمر:**
  ```bash
  cd /root/GLMinvestment
  git pull origin main
  pm2 restart python-backend --update-env
  python3 vps-service/jobs/daily_predictor.py --today-only --force
  ```
- **التحقق:** لازم تشوف في الـ log:
  - `🧠 [HMM-ACCUMULATION]` أو `[HMM-MARKUP]`
  - `🏦 [WHO-INST-BUY]`
  - `[DNA-PROJECTION]`
  - `📝 [ANALYSIS-REASON]`

### 3. تفعيل الـ ML Overlay (بعد التحقق من #2)
- **السبب:** الـ ML Overlay معطّل (REVERTED في commit `5ed1f36d`) — محتاج إعادة تفعيل يدوي
- **الطريقة:** إضافة كود الـ ML Overlay في `daily_predictor.py` بعد `analysis_reason` (line ~2928)
- **الكود جاهز في:** commit `bf0dcd5e` (لكن ده قبل HMM — محتاج دمج يدوي)
- **التوصية:** فعّل الـ ML بعد ما HMM يشتغل على السيرفر + تتأكد إنه شغال صح

---

## 🟡 مهام Phase 2 (بعد تجميع بيانات أكثر)

### 4. إعادة تدريب الـ ML Overlay بـ StandardScaler
- **المشكلة:** الـ features في الـ prediction بتختلف عن الـ training (distribution mismatch)
- **الحل:** تطبيق `StandardScaler` على الـ features قبل التدريب + الـ prediction
- **المتطلبات:** ≥500 عينة تدريبية (اللابتوب عنده 588 ✅)
- **الملفات:** `feature_extractor.py` + `train_ml_model.py`

### 5. Walk-Forward Validation صحيح
- **المشكلة:** دلوقتي بنستخدم `StratifiedKFold` (مش walk-forward حقيقي)
- **الحل:** استخدام `TimeSeriesSplit` بعد ما يكون عندنا بيانات كافية في كل فترة زمنية
- **المتطلبات:** ≥1000 عينة موزعة على ≥6 شهور

### 6. الطبقة 3: GARCH Exits (Volatility Forecasting)
- **الهدف:** خروج ذكي قبل الـ whipsaw باستخدام `GARCH(1,1)`
- **المكتبة:** `arch` (مثبتة ✅)
- **الملف المستهدف:** `vps-service/analyzers/short_holding_exit.py`
- **المنطق:**
  - لو GARCH بيتنبأ إن التقلب هيزيد 2× بكرة → تفعيل trailing stop صارم
  - بدل انتظار الهدف → خروج كامل فوري
- **المتطلبات:** بيانات أسعار يومية كافية (موجودة ✅)

### 7. الطبقة 4: Tick CVD (Cumulative Volume Delta)
- **الهدف:** كشف Wash Trades بدقة 100% بدلاً من التقديرات
- **المشكلة:** EGX ما بيوفرش Level 2 data / Tick Data
- **الحل البديل:** استخدام intraday.db لو فيه بيانات tick
- **الملف المستهدف:** `vps-service/utils/shared_liquidity.py`
- **المنطق:** حساب CVD من بيانات الصفقات الفردية بدلاً من CLV estimation
- **المتطلبات:** بيانات Tick Data (غير متوفرة حالياً)

---

## 🟢 مهام Phase 3 (تحسينات إضافية)

### 8. مراقبة أداء التحسينات (بعد 7-14 يوم)
- **الهدف:** قياس الـ actual_return للتوقعات الجديدة
- **المتطلبات:** انتظار 7-14 يوم من تاريخ التوقع
- **القياس:**
  - Win Rate قبل/بعد التحسينات
  - Profit Factor قبل/بعد
  - Signal Distribution (هل STRONG_BUY زادت فعلاً؟)
  - WHO IS BUYING accuracy (هل الأسهم المؤسساتية ربحت فعلاً؟)
  - HMM accuracy (هل Accumulation → ربح فعلاً؟)

### 9. إعادة تدريب أسبوعي (Cron Job)
- **الهدف:** الحفاظ على دقة النموذج
- **التكرار:** كل ليلة جمعة 1:00 صباحاً
- **الأمر:**
  ```bash
  # crontab -e
  0 1 * * 5 cd /root/GLMinvestment && source vps-service/venv/bin/activate && python3 vps-service/analyzers/feature_extractor.py && python3 vps-service/analyzers/train_ml_model.py >> logs/ml_retrain.log 2>&1
  ```

### 10. Drift Detection (مراقبة انحراف النموذج)
- **الهدف:** إنذار لو الـ Win Rate للإشارات اللي الـ ML وافق عليها نزل تحت 60%
- **التنفيذ:** سكريبت مراقبة أسبوعي في `scripts/ml_drift_check.py`
- **الإجراء:** لو drift → إعادة تدريب عاجلة

### 11. تحليل ORTE (48 توقع خاسر)
- **المشكلة:** ORTE ظهر 48 مرة، 29 max consecutive losses
- **التحليل:** ليه النظام بيرجع لنفس السهم الخاسر؟
- **الحل المقترح:** Ticker Cooldown (مُفعّل ✅) + تحليل أعمق للـ detector

### 12. تحليل persona gambler (66.67% WR)
- **المشكلة:** persona gambler عنده أقل Win Rate (66.67%)
- **التحليل:** هل فعلاً محتاج تعديل فلاتر؟ ولا البيانات قليلة؟
- **الحل المقترح:** مراجعة thresholds الخاصة بـ gambler

### 13. فلترة بيانات 2025 القديمة (backfill)
- **المشكلة:** فيه 50 توقع من 2025-09-22 بـ +50% return (backfill قديم)
- **الحل:** فلترة التوقعات قبل 2026-01-01 من تحليل الأداء
- **التنفيذ:** `WHERE prediction_date >= '2026-01-01'` في كل queries

---

## 📦 الملفات المُضافة في الجلسة (كلها على GitHub)

| الملف | الحجم | الوصف | الحالة |
|---|---|---|---|
| `vps-service/analyzers/feature_extractor.py` | 10 KB | استخراج 10 features | ✅ مرفوع |
| `vps-service/analyzers/train_ml_model.py` | 10 KB | XGBoost + StratifiedKFold | ✅ مرفوع |
| `vps-service/analyzers/hmm_market_regime.py` | 8 KB | HMM Market Regime (4 states) | ✅ مرفوع |
| `vps-service/ml_models/ml_overlay_v1.pkl` | 154 KB | النموذج المُدرّب | ✅ مرفوع (تحتاج رفع نسخة اللابتوب) |
| `scripts/output/ml_training_data.json` | 55 KB | بيانات التدريب | ✅ مرفوع |
| `scripts/output/ml_model_metrics.json` | 1.8 KB | metrics | ✅ مرفوع |
| `download/PRODUCTION_ML_COMMANDS.md` | 12 KB | أوامر السيرفر | ✅ مرفوع |
| `download/LAPTOP_ML_COMMANDS.md` | 11 KB | أوامر اللابتوب | ✅ مرفوع |

---

## 📊 commits على GitHub (14 commits جديدة في الجلسة)

```
c91ce9f2  docs: worklog نهائي
6c311957  feat(ui+telegram): analysis_reason + badges
91f20bd2  feat(hmm-regime): HMM Market Regime
31f7c616  docs: أوامر اللابتوب
60cd9be9  docs: أوامر السيرفر
4b359a59  feat(ml-overlay): رفع ملفات ML
5ed1f36d  docs: ML Overlay REVERTED
43033b50  docs: تحديث SYSTEM_HOW_IT_THINKS
7688759d  feat(analysis-reason): نص عربي شارح
dbd5d8d7  feat(dna-projection): target_3
bf0dcd5e  feat(who-is-buying): institutional vs retail
c2ade8c6  feat(thresholds): STRONG_BUY 80→78
efa40d69  feat(v402): ticker cooldown
dc08cee6  feat(constitution): Rule 71
```

---

## ✅ Checklist للجلسة القادمة

- [ ] رفع نموذج اللابتوب على GitHub
- [ ] سحب التحديثات على السيرفر (`git pull`)
- [ ] إعادة تشغيل Python backend (`pm2 restart`)
- [ ] تشغيل توقعات جديدة + التحقق من HMM + WHO + DNA + analysis_reason
- [ ] تفعيل الـ ML Overlay (بعد التحقق)
- [ ] باك-تست على آخر 7 أيام على السيرفر
- [ ] إعداد cron job لإعادة التدريب الأسبوعي
- [ ] مراقبة الأداء بعد 7-14 يوم

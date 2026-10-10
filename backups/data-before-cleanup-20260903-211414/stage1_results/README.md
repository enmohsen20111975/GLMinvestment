# اختبار المرحلة 1 — V4-Daily v2

سكربت مستقل لاختبار كاشف التجميع الهادئ على بيانات EGX الحقيقية.

## الاستخدام

```bash
# الطريقة الافتراضية (الـ DBs في db/)
python3 scripts/run_stage1_test.py

# لو الـ DBs في مكان تاني
DB_DIR=/path/to/dbs python3 scripts/run_stage1_test.py
```

## المتطلبات

- Python 3.8+
- DB فيه جدول أسعار يومية EGX:
  - `db/data_engine.db` → جدول `egksco_price_history` (الإنتاج)
  - أو `db/price_history.db` → جدول `price_history`
- الجدول لازم يحتوي على: symbol/ticker, date, open, high, low, close, volume

## اللي بيعمله السكربت

1. يكتشف الـ DB والجدول تلقائياً
2. يلاقي كل الأسهم الانفجارية (≥ +15% في يوم واحد)
3. يختبر 5 تكوينات:
   - **A**: v1 baseline (score≥35, no filters)
   - **B**: v2 strict (score≥45, vol≥1.5x, multi-day)
   - **C**: v2 strict (score≥55, vol≥1.5x, multi-day)
   - **D**: v2 relaxed (score≥45, vol≥1.2x, multi-day)
   - **E**: v2 no-multi-day (score≥45, vol≥1.2x, no multi-day)
4. لكل تكوين يحسب:
   - Recall (على الأسهم الانفجارية)
   - Precision (إشارة صحيحة = ≥ +10% خلال 5 أيام)
   - Profit Factor (وقف -8%، هدف +15%، 10 أيام)
   - Max Drawdown
5. يحفظ النتائج في:
   - `data/stage1_results/stage1_v4_daily_v2_<timestamp>.txt` — للقراءة
   - `data/stage1_results/stage1_v4_daily_v2_<timestamp>.json` — للتحليل

## معايير النجاح

- Precision ≥ 25%
- Profit Factor ≥ 1.5
- Recall ≥ 35%
- Max DD ≤ baseline

## الفلاتر التلاتة (V4-Daily v2)

1. **اتجاه مؤكد**: السعر فوق SMA20 + SMA20 ≥ SMA50 (≤ -3%)
2. **حجم يوم الإشارة**: بين vol_confirm_min× و vol_confirm_max× MA20
3. **تأكيد يومين**: الإشارة لازم تكررت في يوم من آخر 3 أيام

## تخصيص التكوينات

عدّل `configs` في السكربت (سطر ~620) لإضافة تكوينات جديدة:

```python
configs = [
    ('A', 'v1 baseline (≥35)', dict(min_score=35), 'v1'),
    ('F', 'v2 custom', dict(min_score=50, vol_confirm_min=1.3,
                            vol_confirm_max=4.0, require_multi_day=False), 'v2'),
    # ... إلخ
]
```

## ملاحظات

- السكربت مستقل تماماً (مفيش imports خارجية غير stdlib)
- يكتشف الـ DB تلقائياً، فبيشتغل على أي سيرفر
- الـ scan_dates بتتختار تلقائياً من البيانات المتاحة
- كل تشغيل بيحفظ ملف جديد بـ timestamp (مش بيكتب فوق القديم)

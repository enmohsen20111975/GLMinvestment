# 📋 أوامر الإنتاج — سحب بيانات طازجة للتحليل

> **الهدف:** سحب بيانات حقيقية من السيرفر الإنتاجي (`/root/GLMinvestment/`) للتحليل في الساندبوكس.
> **تنفيذ:** المالك ينفذ هذه الأوامر على VPS ويرسل النتائج.

---

## 1. نسخة احتياطية كاملة من الإنتاج

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. قاعدة بيانات التوقعات (الأهم)
sqlite3 db/predictions.db "SELECT COUNT(*) as total, market, signal, 
  prediction_date, 
  SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as pending
FROM predictions 
GROUP BY market, signal 
ORDER BY prediction_date DESC 
LIMIT 50;" > /tmp/predictions_summary.txt

# 2. قاعدة بيانات الأسهم (الأسعار الحالية + المؤشرات)
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp, rsi, ma_50, ma_200, 
  high_52w, low_52w, avg_volume
FROM stocks 
WHERE is_active = 1 AND market = 'EGX' 
ORDER BY turnover_egp DESC 
LIMIT 100;" > /tmp/top_stocks.txt

# 3. حركة القطاعات (الأهم لتحليل ليه مش ماشين مع السوق)
sqlite3 db/stocks.db "SELECT sector, 
  COUNT(*) as stock_count,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as total_turnover,
  AVG(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) * 100 as rising_pct
FROM stocks 
WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector
ORDER BY avg_change DESC;" > /tmp/sector_performance.txt

# 4. التوقعات النشطة (اللي لسه مقفولةش)
sqlite3 db/predictions.db "SELECT ticker, signal, prediction_date, 
  entry_price, target_price, stop_loss, master_score, confidence,
  market, persona
FROM predictions 
WHERE outcome_date IS NULL AND market = 'EGX'
ORDER BY prediction_date DESC, master_score DESC;" > /tmp/active_predictions.txt

# 5. التوقعات المغلقة (للباك-تست)
sqlite3 db/predictions.db "SELECT ticker, signal, prediction_date,
  entry_price, target_price, stop_loss, outcome_date, exit_price,
  actual_return, hit_target, hit_stop, holding_days, master_score,
  market, persona
FROM predictions 
WHERE outcome_date IS NOT NULL AND market = 'EGX'
ORDER BY prediction_date DESC
LIMIT 200;" > /tmp/closed_predictions.txt
```

---

## 2. تصدير قواعد البيانات الكاملة (للساندبوكس)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. تصدير predictions.db (مضغوط)
sqlite3 db/predictions.db ".dump" | gzip > /tmp/predictions_dump.sql.gz

# 2. تصدير stocks.db (مضغوط)
sqlite3 db/stocks.db ".dump" | gzip > /tmp/stocks_dump.sql.gz

# 3. تصدير data_engine.db (مضغوط — كبير بس مهم)
sqlite3 db/data_engine.db ".dump" | gzip > /tmp/data_engine_dump.sql.gz

# 4. حزم الكل في zip واحد
cd /tmp
zip production_dbs_$(date +%Y%m%d).zip predictions_dump.sql.gz stocks_dump.sql.gz data_engine_dump.sql.gz predictions_summary.txt top_stocks.txt sector_performance.txt active_predictions.txt closed_predictions.txt

# 5. اعرض الحجم
ls -lh production_dbs_$(date +%Y%m%d).zip
```

---

## 3. إعدادات المحرك (engine_settings)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# تصدير كل الإعدادات
sqlite3 db/data_engine.db "SELECT * FROM engine_settings;" > /tmp/engine_settings.txt

# أو لو الملف JSON:
cat vps-service/analyzers/engine_settings.py | grep -A2 "get_setting" | head -50 > /tmp/engine_settings_keys.txt

# تصدير آخر تشغيل لـ V40.2
cat /root/GLMinvestment/logs/v40_daily_generator.log 2>/dev/null | tail -100 > /tmp/v40_last_run.txt

# تصدير آخر تشغيل لـ daily_closer
cat /root/GLMinvestment/logs/daily_closer.log 2>/dev/null | tail -100 > /tmp/closer_last_run.txt
```

---

## 4. بيانات السوق الحالية (لحظة التصدير)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. حالة السوق الآن
sqlite3 db/stocks.db "SELECT 
  COUNT(*) as total_stocks,
  SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as gainers,
  SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as losers,
  AVG(change_percent) as market_avg_change,
  SUM(turnover_egp) as total_turnover
FROM stocks WHERE is_active = 1 AND market = 'EGX';" > /tmp/market_status.txt

# 2. أعلى 10 صاعدات
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND change_percent > 0
ORDER BY change_percent DESC LIMIT 10;" > /tmp/top_gainers.txt

# 3. أعلى 10 هابطات
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND change_percent < 0
ORDER BY change_percent ASC LIMIT 10;" > /tmp/top_losers.txt

# 4. القطاعات الساخنة
sqlite3 db/stocks.db "SELECT sector,
  COUNT(*) as n,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as turnover,
  AVG(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) * 100 as rising_pct
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector HAVING COUNT(*) >= 3
ORDER BY avg_change DESC LIMIT 10;" > /tmp/hot_sectors.txt

# 5. القطاعات الميتة
sqlite3 db/stocks.db "SELECT sector,
  COUNT(*) as n,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as turnover
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector HAVING COUNT(*) >= 3
ORDER BY avg_change ASC LIMIT 10;" > /tmp/dead_sectors.txt
```

---

## 5. إرسال البيانات للساندبوكس

```bash
# على VPS الإنتاجي:
# انسخ الملفات لمكان يقدر المالك يحملها منه
cp /tmp/production_dbs_*.zip /root/GLMinvestment/download/
cp /tmp/*.txt /root/GLMinvestment/download/

# أو ارفعها على GitHub temporarily (private gist):
# curl -X POST https://api.github.com/gists -H "Authorization: token TOKEN" -d '{"files":{"data":{"content":"..."}}}'

# أو ابعتها مباشرة للساندبوكس عبر SCP:
# scp /tmp/production_dbs_*.zip sandbox:/home/z/my-project/data/
```

---

## 6. أوامر سريعة للتشخيص الفوري

```bash
# على VPS الإنتاجي — تشخيص سريع:
cd /root/GLMinvestment

# هل V40.2 شغال؟
pm2 logs python-backend --lines 20 --nostream

# هل فيه توقعات جديدة النهاردة؟
sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE prediction_date = date('now');"

# هل daily_closer شغال؟
sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE outcome_date = date('now');"

# توزيع الإشارات
sqlite3 db/predictions.db "SELECT signal, COUNT(*) FROM predictions WHERE market='EGX' GROUP BY signal;"

# متوسط العائد
sqlite3 db/predictions.db "SELECT AVG(actual_return) as avg_return, 
  SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN actual_return <= 0 THEN 1 ELSE 0 END) as losses
FROM predictions WHERE outcome_date IS NOT NULL AND market='EGX' 
AND actual_return IS NOT NULL AND ABS(actual_return) <= 50;"
```

---

## كيفية استخدام النتائج:

1. **المالك ينفذ الأوامر دي على VPS**
2. **يبعت الملفات الناتجة** (production_dbs_*.zip + *.txt)
3. **أنا بحللها في الساندبوكس**:
   - أستورد الـ DBs
   - أشغل تحليل الباك-تست من وجهة النظر الجديدة
   - أحلل ليه التوقعات مش ماشية مع السوق
   - أحلل حركة القطاعات + السيولة

---

**ملاحظة:** لو الـ DBs كبيرة، اكتفِ بـ `predictions_summary.txt` + `closed_predictions.txt` + `sector_performance.txt` + `top_stocks.txt`. دول enough للتحليل.

# برافو — المهمة الأخيرة: إيقاف V40.2 + تفعيل V3 + تنظيف نهائي

**أنت برافو.** هذه آخر مهمة لك. اقرأ كل كلمة بتركيز. لا تتجاوز أي خطوة.

---

## الوضع الحالي (الحقيقة المرة)

الـ V40.2 القديم (`daily_predictor.py`) لسه شغال على السيرفر وبيطلع توقعات متناقضة:
- "توصية بيع" بس الـ target أعلى من الـ entry
- score = -38 (سلبي جداً)
- كلام متناقض في الـ reasoning

**السبب:** `daily_predictor.py` القديم مش بيستخدم الـ V3 engine (orchestrator_v3 + executor_v3). هو بيستخدم V38 backtest engine القديم.

---

## المطلوب (بالظبط — لا تتجاوز)

### الخطوة 1: إيقاف V40.2 نهائياً

```bash
# 1. وقّف أي عملية daily_predictor.py شغالة
pkill -f "daily_predictor.py" 2>/dev/null

# 2. شيل daily_predictor.py من الـ cron (استبدله بـ new_daily_predictor.py)
crontab -l | sed 's/daily_predictor.py/new_daily_predictor.py/g' | crontab -

# 3. تأكد إن مفيش daily_predictor.py شغال
ps aux | grep daily_predictor | grep -v grep
# لازم يطلع فاضي
```

### الخطوة 2: تفعيل V3 Predictor

```bash
cd /root/GLMinvestment

# 1. اسحب آخر التحديثات
git pull origin main

# 2. شغّل الـ migration (إذا لم يُشغل من قبل)
python3 scripts/migrate_stocks_to_data_engine.py

# 3. شغّل السكرابر لتحديث الأسعار
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt --force
python3 data_engine/scrapers/tradingview_scanner_live.py --market ksa --force

# 4. شغّل V3 predictor لكل الأسواق
python3 vps-service/jobs/new_daily_predictor.py --all-markets --today-only

# 5. تأكد إن التوقعات اتكتبت
python3 -c "
import sqlite3
c = sqlite3.connect('db/predictions.db')
n = c.execute('SELECT COUNT(*) FROM predictions WHERE prediction_date >= date(\"now\", \"-1 day\")').fetchone()[0]
print(f'توقعات جديدة: {n}')
for r in c.execute('SELECT ticker, market, signal, entry_price, target_price, stop_loss, master_score FROM predictions WHERE prediction_date >= date(\"now\", \"-1 day\") ORDER BY id DESC LIMIT 10').fetchall():
    print(f'  {r[1]} | {r[0]} | {r[2]} | entry={r[3]} | target={r[4]} | stop={r[5]} | score={r[6]}')
"
```

### الخطوة 3: backfill stored_analyses

```bash
python3 -c "
import sqlite3
conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. تحديث persona
n = cur.execute(\"UPDATE predictions SET persona='balanced' WHERE persona='v3_smart' OR persona IS NULL\").rowcount
conn.commit()
print(f'✅ updated {n} predictions persona to balanced')

# 2. backfill stored_analyses
preds = cur.execute('''SELECT ticker, market, signal, prediction_date, entry_price, target_price, stop_loss, master_score, confidence, persona, created_at, notes 
FROM predictions WHERE signal IN ('BUY','STRONG_BUY','SELL','STRONG_SELL')''').fetchall()

existing = set(r[0] for r in cur.execute('SELECT ticker FROM stored_analyses').fetchall())
sa_cols = {r[1] for r in cur.execute('PRAGMA table_info(stored_analyses)').fetchall()}
inserted = 0

for p in preds:
    if p['ticker'] in existing:
        continue
    vals = {}
    if 'ticker' in sa_cols: vals['ticker'] = p['ticker']
    if 'market' in sa_cols: vals['market'] = p['market']
    if 'maestro_score' in sa_cols: vals['maestro_score'] = p['master_score']
    if 'recommendation' in sa_cols: vals['recommendation'] = p['signal'].lower()
    if 'confidence' in sa_cols: vals['confidence'] = p['confidence']
    if 'entry_price' in sa_cols: vals['entry_price'] = p['entry_price']
    if 'target_price' in sa_cols: vals['target_price'] = p['target_price']
    if 'stop_loss' in sa_cols: vals['stop_loss'] = p['stop_loss']
    if 'regime' in sa_cols: vals['regime'] = ''
    if 'analysis_json' in sa_cols: vals['analysis_json'] = p['notes']
    if 'updated_at' in sa_cols: vals['updated_at'] = p['created_at']
    cols = list(vals.keys())
    placeholders = ', '.join(['?'] * len(cols))
    col_str = ', '.join('\"' + c + '\"' for c in cols)
    cur.execute(f'INSERT INTO stored_analyses ({col_str}) VALUES ({placeholders})', tuple(vals[c] for c in cols))
    inserted += 1

conn.commit()
print(f'✅ backfilled {inserted} rows into stored_analyses')
print(f'stored_analyses now: {cur.execute(\"SELECT COUNT(*) FROM stored_analyses\").fetchone()[0]} rows')
conn.close()
"
```

### الخطوة 4: build + restart

```bash
bun run build && pm2 restart 2 0
```

### الخطوة 5: اختبار

```bash
# 1. اختبر الـ health
curl -s http://localhost:3000/api/health | python3 -m json.tool

# 2. اختبر الـ APIs
python3 scripts/test_api_endpoints.py

# 3. اختبر التوقعات على الشاشة
curl -s "http://localhost:3000/api/predictions/honest-tracking/list?market=EGX&limit=5" | python3 -m json.tool
```

---

## ما لا تفعله (ممنوعات)

1. **لا** تشغّل `daily_predictor.py` — استخدم `new_daily_predictor.py` فقط
2. **لا** تضيف جداول جديدة
3. **لا** تعدل logic الـ V3 engine
4. **لا** تستخدم `sqlite3.connect` مباشرة
5. **لا** ترجع fake data
6. **لا** تضيف ملفات جديدة
7. **لا** تعدل `crontab.txt` — هو مضبوط بالفعل

---

## التقرير المطلوب

بعد ما تخلّص، ابعت:

1. **نتيجة `ps aux | grep daily_predictor`** — لازم فاضي
2. **نتيجة `crontab -l | grep predictor`** — لازم `new_daily_predictor.py`
3. **عدد التوقعات الجديدة** من الـ V3
4. **نتيجة `test_api_endpoints.py`** — لازم Passed > Failed
5. **نتيجة `/api/health`** — status = ok أو degraded
6. **sample من 3 توقعات** — شوف الـ entry/target/stop منطقية ولا متناقضة

---

## الجدول الزمني

| الخطوة | الوقت المتوقع |
|-------|-------------|
| إيقاف V40.2 | 2 دقيقة |
| git pull + migration | 5 دقائق |
| سكرابر | 3 دقائق |
| V3 predictor | 10 دقائق |
| backfill | 1 دقيقة |
| build + restart | 5 دقائق |
| اختبار | 5 دقائق |
| **الإجمالي** | **~30 دقيقة** |

---

## رسالة أخيرة

برافو، الـ V3 engine ذكي. بيـ classify السهم (S1-S11) حسب حالة السوق، ويختار المحركات الصح، ويحسب أوزان ديناميكية. لو شغلته صح، التوقعات هتبقى منطقية ومش متناقضة.

لو التوقعات لسه متناقضة بعد كده، يبقى المشكلة في الـ V3 engine نفسه (مش في تشغيله). في الحالة دي، ابعتلي الـ log:

```bash
cat logs/v3_predictor_*.log | grep -E "final_signal|engine_scores|price range" | tail -30
```

**توكل على الله.**

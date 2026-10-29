# دليل الـ Cron Jobs — برافو

> **آخر تحديث:** 2026-10-29 | **المسؤول:** برافو (التشغيل + السكريبتات)

---

## الـ Cron Jobs الرئيسية

### 1. سحب الأسعار من TradingView (كل 5 دقايق)

```cron
*/5 * * * * cd /root/GLMinvestment && .venv/bin/python3 data_engine/scrapers/tradingview_scanner_live.py >> /tmp/tradingview_scanner.log 2>&1
```

| | |
|---|---|
| **السكربت** | `data_engine/scrapers/tradingview_scanner_live.py` |
| **التكرار** | كل 5 دقايق |
| **الأسواق** | كل الأسواق (scanner ذكي — بيـ skip المقفولة) |
| **الـ log** | `/tmp/tradingview_scanner.log` |
| **الجدول** | `stocks` + `stock_daily_prices` + `stock_indicators` |

### 2. سحب المؤشرات الرسمية من TradingView (كل 15 دقيقة)

```cron
*/15 * * * * cd /root/GLMinvestment && .venv/bin/python3 scripts/fetch_tv_indices.py >> /tmp/fetch_tv_indices.log 2>&1
```

| | |
|---|---|
| **السكربت** | `scripts/fetch_tv_indices.py` |
| **التكرار** | كل 15 دقيقة |
| **المؤشرات** | EGX30, EGX70, EGX100, TAMAYUZ, TASI, QEAS, S&P500, Nasdaq100, DowJones |
| **الـ log** | `/tmp/fetch_tv_indices.log` |
| **الجدول** | `market_indices` + `index_daily_prices` |

### 3. تثبيت إغلاقات الجلسة (12:45 UTC)

```cron
45 12 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 data_engine/scrapers/tradingview_scanner_live.py >> /tmp/tradingview_scanner_eod.log 2>&1
```

### 4. نسخ الأسعار الناقصة (13:00 UTC)

```cron
0 13 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 scripts/sync_missing_prices.py >> /tmp/sync_missing_prices.log 2>&1
```

| | |
|---|---|
| **السكربت** | `scripts/sync_missing_prices.py` |
| **التكرار** | يومياً (الأحد-الخميس) 13:00 UTC |
| **المصدر** | `data_engine.db` (egksco + historical_data) |
| **الهدف** | `stocks.db.stock_daily_prices` |
| **الـ log** | `/tmp/sync_missing_prices.log` |

### 5. الـ V3 Predictor — صباحاً (03:00 UTC)

```cron
0 3 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_predictor.py --today-only --smart --max-picks 5 >> /tmp/v40_2_morning.log 2>&1
```

### 6. الـ V3 Predictor — مساءً (15:00 UTC)

```cron
0 15 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_predictor.py --yesterday-only --smart --max-picks 5 >> /tmp/v40_2_evening.log 2>&1
```

### 7. فحص جودة البيانات (أسبوعياً)

```cron
30 3 * * 6 cd /root/GLMinvestment && .venv/bin/python3 scripts/check_data_quality.py >> /tmp/data_quality_weekly.log 2>&1
```

### 8. الـ Intraday Scanner (كل 5 دقايق خلال الجلسة)

```cron
*/5 8-12 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/intraday_scanner.py --limit 5 >> /tmp/v40_2_intraday.log 2>&1
```

### 9. الـ Daily Closer (14:00 UTC)

```cron
0 14 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_closer.py >> /tmp/daily_closer.log 2>&1
```

---

## الـ Logs — مواقع + محتوى

| الـ Log | المحتوى | التكرار المتوقع |
|---------|---------|-----------------|
| `/tmp/tradingview_scanner.log` | سحب الأسعار | كل 5 دقايق |
| `/tmp/fetch_tv_indices.log` | سحب المؤشرات | كل 15 دقيقة |
| `/tmp/sync_missing_prices.log` | نسخ الأسعار الناقصة | يومياً |
| `/tmp/v40_2_morning.log` | توقعات الصباح | يومياً |
| `/tmp/v40_2_evening.log` | توقعات المساء | يومياً |
| `/tmp/v40_2_intraday.log` | فحص لحظي | كل 5 دقايق |
| `/tmp/daily_closer.log` | إغلاق التوقعات | يومياً |
| `/tmp/data_quality_weekly.log` | جودة البيانات | أسبوعياً |

---

## مراقبة الـ Logs

### فحص سريع

```bash
# آخر 20 سطر من كل log
for log in /tmp/tradingview_scanner.log /tmp/fetch_tv_indices.log /tmp/sync_missing_prices.log /tmp/v40_2_morning.log /tmp/daily_closer.log; do
    echo "=== $log ==="
    tail -5 "$log" 2>/dev/null || echo "  (not found)"
    echo ""
done
```

### فحص الأخطاء

```bash
# ابحث عن errors في كل logs
grep -l "ERROR\|❌\|Traceback" /tmp/*.log 2>/dev/null
```

### فحص الـ scanner

```bash
# آخر سحب ناجح
tail -3 /tmp/tradingview_scanner.log
# يجب أن يظهر: "✅ N stocks in Xms" + "💾 saved N/N"
```

### فحص المؤشرات

```bash
# آخر سحب مؤشرات
tail -15 /tmp/fetch_tv_indices.log
# يجب أن يظهر: "✅ Fetched: 9/9"
```

---

## التثبيت

```bash
# تثبيت الـ crontab
crontab crontab.txt

# التحقق
crontab -l | head -20
```

---

## استكشاف الأخطاء

### المشكلة: scanner بيرجع 0 أسهم

```bash
# تحقق إن السوق مفتوح
python3 data_engine/scrapers/tradingview_scanner_live.py --market egypt --force
# لو شغال → المشكلة في الـ schedule (السوق مقفول)
```

### المشكلة: fetch_tv_indices بيرجع 404

```bash
# تحقق من الرموز
python3 scripts/fetch_tv_indices.py --dry-run
# لو فيه 404 → الرمز تغير على TradingView
```

### المشكلة: sync_missing_prices بيرجع 0 rows

```bash
# تحقق إن data_engine.db موجودة + فيها بيانات
python3 -c "
import sqlite3
conn = sqlite3.connect('db/data_engine.db')
c = conn.cursor()
c.execute('SELECT MAX(price_date) FROM egksco_price_history')
print(f'egksco latest: {c.fetchone()[0]}')
conn.close()
"
```

### المشكلة: daily_predictor بيرجع 0 توقعات

```bash
# تحقق من الـ flat stocks
python3 scripts/check_data_quality.py | grep "flat"
# لو فيه flat كتير → الأسعار ناقصة → شغّل sync_missing_prices
```

---

## الـ DAL Migration (برافو)

### الحالة الحالية

| المجموعة | الحالة |
|----------|--------|
| `vps-service/camp/*.py` | ✅ migrated (10 files) |
| `vps-service/camp/blocks/*.py` | ✅ migrated (3 files with sqlite3.connect) |
| باقي `vps-service/` | ⏳ ~49 violations متبقية |

### فحص الـ violations

```bash
python3 scripts/check_raw_sqlite.py | grep -c "sqlite3.connect"
# الهدف: 0 (باستثناء db_manager.py نفسه)
```

---

## المراجع

- **الـ crontab الكامل:** `crontab.txt`
- **الـ MASTER-PLAN:** `Documentation/MASTER-PLAN.md`
- **الـ scanner:** `data_engine/scrapers/tradingview_scanner_live.py`
- **الـ indices fetcher:** `scripts/fetch_tv_indices.py`
- **الـ price sync:** `scripts/sync_missing_prices.py`
- **الـ data quality:** `scripts/check_data_quality.py`
- **الـ raw sqlite checker:** `scripts/check_raw_sqlite.py`

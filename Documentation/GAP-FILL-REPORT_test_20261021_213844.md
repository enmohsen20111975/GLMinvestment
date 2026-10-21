# 🔧 تقرير تعبئة الفجوات — 2026-10-21 21:38

**المسار:** `/home/z/my-project/GLMinvestment/db/test_gap_fill`

**النمط:** TEST (test_gap_fill/) | LIVE WRITE


## فجوة (أ): price_history.db ← stock_daily_prices لـ TADAWUL/KSE/QSE

### قبل: آخر تاريخ لكل سوق في price_history.db
- EGX: latest = `2026-10-21`
- TADAWUL: latest = `2026-10-14`
- KSE: latest = `2026-10-14`
- QSE: latest = `2026-10-14`
- US: latest = `2026-10-21`

### TADAWUL: 1975 صف جديد من stock_daily_prices (بعد 2026-10-14)
  ✅ تم إدراج 1975 صف

### KSE: 890 صف جديد من stock_daily_prices (بعد 2026-10-14)
  ✅ تم إدراج 890 صف

### QSE: 285 صف جديد من stock_daily_prices (بعد 2026-10-14)
  ✅ تم إدراج 285 صف

**✅ تم إضافة 3,150 صف إجمالاً**

### بعد: آخر تاريخ لكل سوق في price_history.db
- TADAWUL: latest = `2026-10-21`
- KSE: latest = `2026-10-21`
- QSE: latest = `2026-10-21`

## فجوة (ب): data_engine.db.egksco_stocks ← stocks.current_price

### قبل: egksco_stocks = 0 صف
### الأعمدة: ['id', 'symbol', 'name', 'market', 'sector', 'last_price', 'change', 'change_percent', 'volume', 'turnover', 'last_updated']
### مصدر البيانات: 1134 سهم نشط من stocks.db
### ✅ تم إدراج/تجاهل 1134 صف
### بعد: egksco_stocks = 1134 صف
### المدى: 2026-10-21T19:14:57.395306 → 2026-10-21T20:13:40.136471

## فجوة (ج): intraday.db.stock_intraday ← synthetic US rows

### قبل: US active = 137, in intraday = 62, missing = 75
### عينة 10 من المفقودين: ['GOOG', 'UBER', 'TXN', 'AMAT', 'MU', 'LRCX', 'PANW', 'NOW', 'SNPS', 'CDNS']
### ✅ تم إدراج 75 صف synthetic
### بعد: US tickers in intraday = 137

## ملخص

| الفجوة | الوصف | الصفوف |
|---|---|---:|
| (أ) | price_history TADAWUL/KSE/QSE | 3,150 |
| (ب) | egksco_stocks from stocks | 1,134 |
| (ج) | US intraday synthetic | 75 |
| **الإجمالي** | | **4,359** |
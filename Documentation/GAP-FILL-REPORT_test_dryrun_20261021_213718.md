# 🔧 تقرير تعبئة الفجوات — 2026-10-21 21:37

**المسار:** `/home/z/my-project/GLMinvestment/db/test_gap_fill`

**النمط:** TEST (test_gap_fill/) | DRY RUN


## فجوة (أ): price_history.db ← stock_daily_prices لـ TADAWUL/KSE/QSE

### قبل: آخر تاريخ لكل سوق في price_history.db
- EGX: latest = `2026-10-21`
- TADAWUL: latest = `2026-10-14`
- KSE: latest = `2026-10-14`
- QSE: latest = `2026-10-14`
- US: latest = `2026-10-21`

### TADAWUL: 1975 صف جديد من stock_daily_prices (بعد 2026-10-14)

### KSE: 890 صف جديد من stock_daily_prices (بعد 2026-10-14)

### QSE: 285 صف جديد من stock_daily_prices (بعد 2026-10-14)

**[DRY RUN] سيتم إضافة 3,150 صف إجمالاً**

### بعد: آخر تاريخ لكل سوق في price_history.db
- TADAWUL: latest = `2026-10-14`
- KSE: latest = `2026-10-14`
- QSE: latest = `2026-10-14`

## فجوة (ب): data_engine.db.egksco_stocks ← stocks.current_price

### قبل: egksco_stocks = 0 صف
### الأعمدة: ['id', 'symbol', 'name', 'market', 'sector', 'last_price', 'change', 'change_percent', 'volume', 'turnover', 'last_updated']
### مصدر البيانات: 1134 سهم نشط من stocks.db
### [DRY RUN] سيتم إدراج 1134 صف (INSERT OR IGNORE)
### بعد: egksco_stocks = 0 صف

## فجوة (ج): intraday.db.stock_intraday ← synthetic US rows

### قبل: US active = 137, in intraday = 62, missing = 75
### عينة 10 من المفقودين: ['GOOG', 'UBER', 'TXN', 'AMAT', 'MU', 'LRCX', 'PANW', 'NOW', 'SNPS', 'CDNS']
### [DRY RUN] سيتم إدراج 75 صف synthetic (price=current_price, timestamp=now)
### بعد: US tickers in intraday = 62

## ملخص

| الفجوة | الوصف | الصفوف |
|---|---|---:|
| (أ) | price_history TADAWUL/KSE/QSE | 3,150 |
| (ب) | egksco_stocks from stocks | 1,134 |
| (ج) | US intraday synthetic | 75 |
| **الإجمالي** | | **4,359** |
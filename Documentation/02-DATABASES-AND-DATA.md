# 02 — قواعد البيانات ومصادر الحقيقة

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. استراتيجية الطبقات

| Tier | DB | الوصف |
|------|-----|-------|
| Write-Heavy (Raw) | data_engine.db, intraday.db | بيانات أولية من scrapers |
| Read-Heavy (Synced) | stocks.db, price_history.db | متزامنة من data_engine |
| Brain Output | predictions.db | كل مخرجات المحركات |
| User State | auth.db, news.db | مستخدمون + أخبار |

## 2. مصادر البيانات

| المصدر | البيانات | التخزين | الحالة |
|--------|---------|---------|--------|
| TradingView | أسعار + screener | data_engine.db.stocks | ✅ نشط |
| EGKSCO | أساسيات EGX + أسعار | data_engine.db (tab_*) | ✅ نشط |
| CoinGecko | BTC/ETH OHLCV | data_engine.db.crypto_prices | ✅ نشط |
| Metals/Forex | XAU, XAG, Oil, EUR/USD | data_engine.db.gold_prices | ✅ نشط |
| World Bank | Egypt CPI | stocks.db.macro_indicators | ✅ يدوي |
| RSS (EGX) | أخبار | news.db.market_news | ✅ نشط |
| Ollama | تحليل أخبار LLM | في الذاكرة | ✅ نشط |

## 3. قواعد الملكية

- كل DB لها **كاتب واحد** (writer) و**قرّاء متعددون** (readers)
- `stocks.db`: data_engine بيـ sync فيها، الباقي بيقرأ
- `predictions.db`: Python analyzers بتكتب، Next.js بيقرأ
- `auth.db`: NextAuth بيـ write، API routes بتقرأ

## 4. نسخ احتياطية

| النوع | الموقع | الحجم |
|------|-------|-------|
| DB snapshot | `db_release_20261025/` | ~1.5 GB (مضغوط) |
| Weekly backup | `data/db_backup_*` | متغير |
| Code backup | `db/code_backup_*` | ~50 MB |

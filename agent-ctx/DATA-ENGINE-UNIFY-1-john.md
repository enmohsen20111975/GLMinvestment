# 🐉 خطة توحيد محرك البيانات — DATA-ENGINE-UNIFY-1

> **موجہ لـ:** جون (منفّذ) + المالك (قرار)
> **التاريخ:** 2026-10-19
> **الهدف:** تحويل محرك البيانات من فوضى (6 scrapers + 18 writers + 13 schema mismatches) لـ **كتلة واحدة موحدة**.
> **القواعد:** Rule 1 (DB safety), Rule 4 (NO-NEW-FILES), Rule 17 (relative paths), Rule 20 (Python=Brain), Rule 25 (refactoring-gated), Rule 27 (NO-FAKE-DATA), Rule 46 (DB-CLEANUP-WAVE), Rule 67 (CALCULATION-CANONICAL), Rule 73 (SINGLE-DISPLAY-SOURCE).
> **المبدأ:** جراحة قلب — حذر شديد. كل خطوة بـ backup + dry-run + اختبار.

---

## 🎯 الـ Canonical Flow المستهدف (بعد التوحيد)

```
┌─────────────────────────────────────────────────────────────┐
│  المصادر الخارجية (1 source per asset class)                  │
│  EGX stocks   → EGKSCO (canonical)                          │
│  TADAWUL/KSE/QSE → TradingView REST (canonical)             │
│  Crypto → CoinGecko (canonical)                             │
│  Metals/Forex → metals.dev + Daleelak (canonical)           │
│  News → NewsAPI + GNews (canonical)                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  data_engine.db (المصدر الوحيد للـ raw data)                  │
│  • stocks (1 ticker per company, EN uppercase)              │
│  • egksco_price_history / crypto_prices / gold_prices       │
│  • tab_* (schema موحد: symbol PK + rich columns)            │
└─────────────────┬───────────────────────────────────────────┘
                  │ sync.py (الناقل الوحيد)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  stocks.db (الـ consumption layer)                            │
│  • stocks (ticker = canonical, market = 'EGX')              │
│  • stock_daily_prices                                         │
│  • user data (watchlist, portfolio, alerts)                  │
└─────────────────────────────────────────────────────────────┘
```

**القواعد الحديدية بعد التوحيد:**
1. **مصدر واحد per asset class** (مش 3 مصادر للـ EGX).
2. **data_engine.db = المصدر الوحيد للـ raw data**. أي scraper يكتب هنا بس.
3. **sync.py = الناقل الوحيد** من data_engine.db لـ stocks.db.
4. **ممنوع أي ملف يكتب في stocks.db مباشرة** (لا seed scripts، لا eodhd، لا egksco_scraper propagation).
5. **ticker canonical = English uppercase** (MNHD مش MASR).
6. **market canonical = English code** ('EGX' مش 'مصر').
7. **name_ar = Arabic only** (لو مش متوفر، NULL — مش English fallback).

---

## 📋 المراحل (8 مراحل، كل واحدة بـ backup + dry-run + اختبار)

### المرحلة 1 — إيقاف الـ pollution sources (fix bugs الحرجة)
**الهدف:** منع الـ data من إنها تتـ pollute تاني وأنا بشتغل.

1.1. **`vps-service/scripts/seed_official_stocks.py`** — BUG: ticker = اسم عربي.
   - **الفعل:** أرشفة الملف لـ `archive/` (مش delete — Rule 16). لو محتاجينه، نعمله rewrite بـ tickers رسمية.

1.2. **`vps-service/data/eodhd_fetcher.py:141`** — BUG: English name في name_ar.
   - **الفعل:** عدّل الـ INSERT: `name_ar = NULL` (مش `name`). الـ Arabic names لازم تيجي من EGKSCO بس.

1.3. **`vps-service/data/egksco_scraper.py:676,698,892`** — propagation لـ stocks.db مباشرة.
   - **الفعل:** شيل الـ propagation block. الـ sync.py هو اللي ينقل.

1.4. **`vps-service/scripts/seed_egx_stocks.py` + `seed_multi_market_stocks.py`** — seed scripts.
   - **الفعل:** أرشفتهم لـ `archive/`. الـ tickers الرسمية لازم تيجي من EGKSCO بس.

1.5. **`data_engine/scrapers/egxpilot_scraper.py` + `yahoo_scraper.py`** — deprecated.
   - **الفعل:** أرشفتهم لـ `archive/`.

**اختبار المرحلة 1:** شغّل أي scraper → ما يـ polluteش stocks.db مباشرة. lint + py_compile PASS.

---

### المرحلة 2 — توحيد tab_* schema
**الهدف:** إنهاء الـ schema conflict في tab_valuation + tab_profitability.

2.1. **drop tab_* tables الـ 8** من data_engine.db (backup الأول!).
2.2. **recreate بـ schema موحد** (symbol PK + rich columns من update_fundamentals):
   ```sql
   CREATE TABLE tab_valuation (
     symbol TEXT PRIMARY KEY,
     market TEXT,
     pe_ratio REAL, pb_ratio REAL, ps_ratio REAL, peg_ratio REAL,
     market_cap REAL, last_updated TEXT
   );
   ```
2.3. **عدّل `tradingview_scraper.py`** — يستخدم الـ schema الجديد (مش `data TEXT`).
2.4. **عدّل `update_fundamentals.py`** — يستخدم `symbol` (مش `ticker`) كـ PK.
2.5. **fix الـ column shift** في tab_* (symbol='السعودية' → symbol=ticker فعلي).

**اختبار المرحلة 2:** شغّل tradingview_scraper → tab_valuation فيها rich columns (مش data TEXT). SELECT symbol, pe_ratio FROM tab_valuation LIMIT 5 → أرقام حقيقية.

---

### المرحلة 3 — توحيد market codes
**الهدف:** كل الـ DBs تستخدم 'EGX' (مش 'مصر').

3.1. **migration script** (dry-run الأول): `UPDATE stocks SET market='EGX' WHERE market='مصر'` في:
   - data_engine.db.stocks
   - stocks.db.stocks
   - historical.db.historical_prices
3.2. **عدّل الـ scrapers** اللي بـ write 'مصر' → 'EGX':
   - egksco_scraper.py:362 (market='مصر')
   - yahoo_scraper.py:212
   - egxpilot_scraper.py:290
3.3. **عدّل sync.py** — شيل الـ map 'مصر'→'EGX' (ما يحتاجش).

**اختبار المرحلة 3:** SELECT market, COUNT(*) FROM stocks GROUP BY market → مفيش 'مصر'.

---

### المرحلة 4 — إيقاف egksco_price_history DEPRECATED
**الهدف:** Rule 46 enforcement — price_history.db هو الـ canonical.

4.1. **عدّل `vps-service/data/egksco_scraper.py:845`** — شيل الـ propagation لـ egksco_price_history.
4.2. **migration**: انقل أي data مش موجودة من data_engine.db.egksco_price_history لـ price_history.db.price_history.
4.3. **drop** data_engine.db.egksco_price_history (backup الأول).

**اختبار المرحلة 4:** SELECT COUNT(*) FROM data_engine.db.egksco_price_history → table مش موجود. price_history.db.price_history فيه الـ data.

---

### المرحلة 5 — canonical ticker resolver
**الهدف:** مفيش tickerين لـ نفس الشركة.

5.1. **اعمل `data_engine/canonical_ticker.py`** — module فيه:
   - `CANONICAL_TICKERS`: dict من EGX official tickers (MNHD, KAHA, CALT, PACL, ...).
   - `resolve_ticker(raw_ticker)`: يرجّع canonical ticker.
   - `is_canonical(ticker)`: boolean.
5.2. **عدّل كل scrapers** تستخدم `resolve_ticker()` قبل INSERT.
5.3. **migration**: UPDATE كل الـ tickers في data_engine.db + stocks.db لـ canonical.

**اختبار المرحلة 5:** SELECT COUNT(DISTINCT ticker) FROM stocks.db.stocks WHERE name LIKE '%Lotus%' → 1 (مش 2).

---

### المرحلة 6 — توحيد BTC namespace
**الهدف:** BTC price واحد في كل الـ DBs.

6.1. **fix price_history.db.price_history** — DELETE BTC rows اللي source='egx_investment_migration' (data غلط).
6.2. **عدّل الـ scrapers** تستخدم 'BTC-USDT' (مش 'BTC') في price_history.db عشان ما يتعارضش مع EGX.
6.3. **canonical source** = data_engine.db.crypto_prices.

**اختبار المرحلة 6:** SELECT AVG(close) FROM price_history WHERE ticker='BTC' → NULL (مش 201.88).

---

### المرحلة 7 — cleanup الـ dead DBs
**الهدف:** شيل الـ DBs الميتة.

7.1. **crypto.db** (0 rows) — أرشفة + شيل.
7.2. **historical.db** (aliased لـ data_engine.db) — انقل الـ data لـ data_engine.db.historical_data + أرشفة historical.db.
7.3. **decision_log.db** (208 rows single pattern) — أرشفة.
7.4. **paper_trading.db** (3 rows) — أرشفة.

**اختبار المرحلة 7:** ls db/*.db → مفيش crypto.db ولا historical.db.

---

### المرحلة 8 — garage + index
**الهدف:** اودّي الأكواد الميتة لـ garage + حدّث index.

8.1. **اعمل `archive/garage/`** — مكان للأكواد المؤرشفة.
8.2. **انقل لـ garage:**
   - 6 ملفات orphan في data_engine/scrapers/
   - 6 ملفات orphan في vps-service/analyzers/
   - maestro_routes.py + 4 routes في src/app/api/maestro/
   - MaestroWidget.tsx
   - 6 نسخ patch_rootpage_v1..v6
   - 3 نسخ egx_arabic_lookup.py (وحّد لـ data/)
   - .original, .disabled, .preserved files
8.3. **اعمل `archive/garage/INDEX.md`** — list كل ملف + السبب + تاريخ الأرشفة.
8.4. **اختبارات كتير** قبل أي delete دائم — الأرشفة أول، الـ delete بعد ما نتأكد.

**اختبار المرحلة 8:** lint + tsc + py_compile PASS. الـ dev server بيـ render. الـ APIs شغّالة.

---

## ⚠️ المحظورات

- 🚫 ما تـ deleteش أي ملف قبل archive + اختبار.
- 🚫 ما تـ dropش أي DB table قبل backup.
- 🚫 ما تـ runش migration بدون dry-run.
- 🚫 ما تـ stopش الـ dev server لمدة طويلة (الـ preview لازم يفضل شغّال).
- 🚫 ما تـ pushش بدون إذن المالك (Rule 75).
- 🚫 ما تـ skipش أي اختبار.

---

## 📊 التسليم

بعد كل مرحلة:
1. **worklog entry** (Task ID: DATA-ENGINE-UNIFY-1-stage-N).
2. **diff + lint + py_compile + اختبار**.
3. **انتظر قرار المالك** (PASS/FAIL/BLOCKED) قبل المرحلة التالية.

---

**جون — جراحة قلب. حذر شديد. كل خطوة بـ backup + dry-run + اختبار. مفيش skip.**

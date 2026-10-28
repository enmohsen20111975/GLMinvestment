# برافو — مهمة: نسخ الأسعار الناقصة من data_engine.db لـ stocks.db

## الحالة
- فرعك: `bravo/predictor-test-on-main` مبني على `origin/main` @ `77ce45c`
- الـ `data_engine.db` متاح على الـ sandbox (531MB، 29 جدول)
- الـ `stocks.db` متاح (26MB، 53 جدول)
- آخر تاريخ في الـ DBs الاتنين: `2026-10-25`

## المطلوب (فقط — لا تتجاوز)

### الهدف
نسخ الأسعار الناقصة من `data_engine.db` لـ `stocks.db.stock_daily_prices` بطريقة **UPSERT**.

### القواعد الإلزامية

1. **UPSERT فقط** — متمسحش `stock_daily_prices`. استخدم `ON CONFLICT(ticker, price_date) DO UPDATE`.
2. **ترتيب الأعمدة** — كل عمود لازم يروح مكانه الصح. شوف `stock_daily_prices` schema:
   ```
   ticker, symbol, price_date, open, high, low, close, close_price, 
   volume, change_percent, market, fetch_time, open_price, high_price, low_price
   ```

3. **المصادر بالترتيب** (لو فيه تعارض، المصدر الأول يكسب):
   - **1. `egksco_price_history`** (EGX فقط — المصدر الرسمي المصري)
     - columns: `symbol, price_date, open_price, high_price, low_price, close_price, volume`
   - **2. `historical_data`** (كل الأسواق — Yahoo + مصادر)
     - columns: `symbol, date, open, high, low, close, volume`

4. **النسخ بـ "الأحدث بس"**:
   - لكل ticker، شوف آخر تاريخ في `stock_daily_prices`
   - لو فيه أسعار أحدث في `data_engine.db` → UPSERTها
   - لو مفيش أي تاريخ → انسخ آخر 60 يوم بس

5. **الـ script موجود**: `scripts/sync_missing_prices.py` — أنا كتبته، شغّله وجرب.
   - جرّب الأول: `python3 scripts/sync_missing_prices.py --market EGX --dry-run`
   - لو شغال: `python3 scripts/sync_missing_prices.py --market EGX`
   - بعد كده: `python3 scripts/sync_missing_prices.py` (كل الأسواق)

6. **بعد الـ sync**:
   - شغّل `python3 scripts/check_data_quality.py` عشان تتأكد إن الأسهم flat قلّت
   - شغّل `python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only --dry-run --max-tickers 5` عشان تتأكد إن الـ V3 بيلاقي بيانات

### ما لا تفعله

- **لا** تعمل `REPLACE` أو `DELETE` على `stock_daily_prices`
- **لا** تعدل أي logic تاني في `daily_predictor.py` أو `new_daily_predictor.py`
- **لا** تدمج على `main` — شغّل على فرعك وأبعت التقرير بس

## التقرير المطلوب

بعد ما تخلّص، ابعت:
1. **SHA** اللي اتعمل عليه الـ sync
2. **عدد الصفوف** اللي اتعملها UPSERT (لكل سوق)
3. **عدد الأسهم flat** قبل وبعد الـ sync (من `check_data_quality.py`)
4. **آخر تاريخ** في `stock_daily_prices` بعد الـ sync
5. **sample** من الـ V3 predictor بعد الـ sync (3 أسهم — شوف الـ engine_scores)

---

## السياق (مش لازم تقراه بس عشان تفهم)

المشكلة الأصلية: الـ V3 predictor (الـ orchestrator + executor) بيحلل الأسهم بـ المحركات الصغيرة (TREND, MOM, MR, BRK, FLOW, FUND, EVENT). بس لما الـ أسعار flat (نفس السعر 60 يوم)، الـ engines بتطلع scores افتراضية غلط.

الحل: نتأكد إن `stock_daily_prices` فيها أسعار حقيقية (مش flat). الـ `data_engine.db` فيها البيانات الصح — محتاجين ننسخها.

---

برافو، ركّز. ده شغل مهم. لا تكسر حاجة، لا تعمل REPLACE، لا تعدل logic تاني. بس UPSERT الأسعار الناقصة وابعت التقرير.

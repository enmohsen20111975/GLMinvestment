# Smart Predictor — توقعات ذكية بدل الـ brute force

## المشكلة

برافو عمل `daily_predictor.py` بـ brute force:
```python
DEFAULT_START = '2026-01-01'  # من أول السنة!
for scan_date in scan_dates:     # 280 يوم
    for ticker in tickers:       # 289 سهم EGX
        engine.analyze(ticker, scan_date)  # 80,000 تحليل عشان 5 توقعات/يوم
```

النتيجة:
- 163 ساعة لـ EGX كامل (7 أيام)
- بيحلل أسهم ميتة، أيام إجازات، توقعات موجودة بالفعل
- "Incremental mode" بتاع برافو = patch على غباء (scan_log عشان يتخطى)

## الحل: Smart Predictor

```python
# scripts/smart_predictor.py

def run_smart(market_code, days_back=1):
    """
    توقعات ذكية:
    1. اشتغل من آخر تاريخ في الـ DB (مش من 1 يناير)
    2. فلتر أيام الإجازات
    3. فلتر الأسهم الميتة (change% ≈ 0 أو < -3%)
    4. فلتر الأسهم مش في الـ radar (مش نشطة سيولياً)
    5. فلتر الأسهم اللي ليها توقع بالفعل
    6. حلل الباقي بس (10-30 سهم بدل 289)
    """
    
    # 1. آخر تاريخ في الـ DB
    last_date = get_last_prediction_date(market_code)
    if not last_date:
        last_date = (today - timedelta(days=days_back)).strftime('%Y-%m-%d')
    
    # 2. الأيام اللي محتاج نـ scanها
    scan_dates = [
        d for d in date_range(last_date + 1, today)
        if is_trading_day(d, market_code)  # فلتر جمعة/سبت/عيد
    ]
    
    # 3. الأسهم النشطة من الـ radar (الـ radar عمل شغله)
    radar_picks = read_radar_cache(market_code)
    if radar_picks:
        candidate_tickers = [p['ticker'] for p in radar_picks['stocks']]
    else:
        # fallback: كل الأسهم النشطة
        candidate_tickers = get_active_tickers(market_code)
    
    # 4. لكل يوم، فلتر أكتر
    for scan_date in scan_dates:
        # 4a. الأسهم اللي مفيهاش توقع في الـ DB
        existing = get_existing_tickers(market_code, scan_date)
        todo = [t for t in candidate_tickers if t not in existing]
        
        # 4b. فلتر الأسهم الميتة (change% ≈ 0 أو < -3%)
        alive = filter_dead_stocks(todo, scan_date, market_code)
        
        # 5. حلل بس اللي فات كل الفلاتر
        for ticker in alive:
            signal = engine.analyze(ticker, scan_date)
            if signal and signal.signal_type == 'BUY':
                save_prediction(signal, market_code)
        
        print(f"  [{scan_date}] candidates={len(candidate_tickers)} "
              f"→ after_filters={len(alive)} → saved={len(saved)}")


def filter_dead_stocks(tickers, scan_date, market_code):
    """
    فلتر الأسهم الميتة:
    - change% ≈ 0 (±0.5%) → سهم واقف، مش هيعمل توقع مفيد
    - change% < -3% → سهم خسران جامد، مش هنعمل توقع شراء
    
    رجّع بس الأسهم اللي فيها حركة (صعود أو هبوط بسيط).
    """
    alive = []
    conn = get_stocks_db()
    for ticker in tickers:
        row = conn.execute(
            "SELECT change_percent FROM stocks WHERE ticker = ? AND market = ?",
            (ticker, market_code)
        ).fetchone()
        if not row or row[0] is None:
            continue
        change = float(row[0])
        # فلتر: -3% < change < +0.5% → ميت (واقف أو خسران)
        # سمح: change >= +0.5% (صاعد) أو change <= -3% (خسران جامد = ممكن SELL signal)
        # بس للـ BUY predictions بس، نفلتر الخسران كمان
        if -3.0 <= change <= 0.5:
            continue  # سهم ميت
        alive.append(ticker)
    conn.close()
    return alive


def get_last_prediction_date(market_code):
    """آخر تاريخ في predictions table للسوق ده."""
    conn = get_predictions_db()
    row = conn.execute(
        "SELECT MAX(prediction_date) FROM predictions WHERE market = ?",
        (market_code,)
    ).fetchone()
    conn.close()
    return row[0] if row and row[0] else None


def get_existing_tickers(market_code, scan_date):
    """الأسهم اللي ليها توقع بالفعل في اليوم ده."""
    conn = get_predictions_db()
    rows = conn.execute(
        "SELECT ticker FROM predictions WHERE market = ? AND prediction_date LIKE ?",
        (market_code, f"{scan_date}%")
    ).fetchall()
    conn.close()
    return {r[0] for r in rows}


def is_trading_day(date_str, market_code):
    """هل اليوم ده يوم تداول؟ (فلتر جمعة/سبت/عيد)."""
    from utils.trading_calendar import is_trading_day as _is_trading_day
    import datetime
    dt = datetime.datetime.strptime(date_str, '%Y-%m-%d')
    return _is_trading_day(dt, market_code)


def read_radar_cache(market_code):
    """اقرأ آخر radar JSON للسوق ده."""
    import json, os
    from pathlib import Path
    # الـ radar بيكتب في scripts/output/maker_radar_{MARKET}_{date}.json
    radar_dir = Path('scripts/output')
    # أحدث ملف للسوق ده
    pattern = f"maker_radar_{market_code}_*.json"
    files = sorted(radar_dir.glob(pattern), reverse=True)
    if not files:
        return None
    with open(files[0]) as f:
        return json.load(f)


def get_active_tickers(market_code):
    """fallback: كل الأسهم النشطة (لو الـ radar فاضي)."""
    conn = get_stocks_db()
    rows = conn.execute(
        "SELECT ticker FROM stocks WHERE market = ? AND is_active = 1 AND current_price > 0",
        (market_code,)
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]
```

## الأرقام المتوقعة

| | برافو | Smart Predictor |
|---|---|---|
| الأيام | 280 | 1-5 (من آخر تاريخ) |
| الأسهم | 289 (EGX) | 10-30 (radar picks) |
| إجمالي التحليلات | 80,000 | 30-150 |
| الوقت | ~163 ساعة | ~2-10 دقايق |
| الأسهم الميتة | متحللة | مفلترة |
| أيام الإجازات | متحللة | مفلترة |
| التوقعات الموجودة | متعاد | مفلترة |

## الـ filters اللي بنطبقها

1. **فلتر التاريخ**: من `last_date + 1` لليوم (مش من 1 يناير)
2. **فلتر يوم الإجازة**: `is_trading_day(date, market)` — يتخطى جمعة/سبت/عيد
3. **فلتر الـ radar**: أسهم الـ radar بس (نشطة سيولياً)
4. **فلتر التوقعات الموجودة**: skip لو فيه توقع بالفعل
5. **فلتر الأسهم الميتة**: change% بين -3% و +0.5% → skip (واقف أو خسران)
6. **فلتر السيولة** (اختياري): turnover < threshold → skip

## الاستخدام

```bash
# EGX فقط (اليوم)
python3 scripts/smart_predictor.py --market EGX --today-only

# كل الأسواق (أمس — للـ cron بعد إغلاق السوق)
python3 scripts/smart_predictor.py --all-markets --yesterday-only

# فترة محددة
python3 scripts/smart_predictor.py --market TADAWUL --start 2026-10-25 --end 2026-10-28
```

## الـ cron المقترح

```bash
# بعد إغلاق كل سوق:
# EGX يقفل 14:30 Cairo → 15:00
# TADAWUL يقفل 15:00 Riyadh → 15:30 Cairo
# KSE يقفل 13:30 Kuwait → 14:30 Cairo
# QSE يقفل 13:00 Qatar → 14:00 Cairo
# US يقفل 22:00 NY → 05:00 Cairo (+1 day)

30 15 * * 1-5 cd /path/to/GLMinvestment && python3 scripts/smart_predictor.py --all-markets --yesterday-only
```

## الجدول الزمني

1. **Phase 1**: كتابة `smart_predictor.py` (1-2 ساعة)
2. **Phase 2**: ربطه بـ `daily_predictor.py` V40.2 engine
3. **Phase 3**: اختبار على EGX (1 يوم)
4. **Phase 4**: cron للأسواق كلها
5. **Phase 5**: مراقبة + tuning الـ filters

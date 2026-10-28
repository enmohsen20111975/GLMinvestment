# Smart Predictor — انتقل لـ daily_predictor.py

## تاريخ
- 2026-10-28: تم دمج الـ smart logic من `scripts/smart_predictor.py` جوه
  `vps-service/jobs/daily_predictor.py` نفسه.

## ليه؟
`daily_predictor.py` هو اللي بيتشغل من كل مكان (cron, market_scheduler, scripts).
لو سيبنا `smart_predictor.py` منفصل، حد ممكن يشغل `daily_predictor.py` بالغلط
ويرجع للـ brute force.

## الاستخدام الصحيح دلوقتي

```bash
# smart mode (للـ cron اليومي):
python3 vps-service/jobs/daily_predictor.py --today-only --smart

# بدون smart (للـ backtest الكامل):
python3 vps-service/jobs/daily_predictor.py --start 2026-01-01 --end 2026-10-28
```

## الـ filters اللي بيتطبقوا مع --smart
1. فلتر أيام الإجازات (is_trading_day)
2. فلتر الأسهم الميتة (change% بين -3% و +0.5%)
3. فلتر التوقعات اللي لسه valid (السعر ما تغيرش >1%)

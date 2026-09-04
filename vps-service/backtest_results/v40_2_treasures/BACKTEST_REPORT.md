# V40.2 Backtest Report — with Treasures

**Period:** 2026-02-01 → 2026-08-27

**Initial Capital:** 100,000 EGP

**Final Capital:** 101,354.20 EGP

**Total Return:** +1.35%

**Max Drawdown:** -39.80%

---

## Treasures Used

1. **Screener Lists** (data_engine.db.screener_lists): most_active + unusual_volume + top_gainers
2. **Fundamentals** (data_engine.db.tab_valuation + tab_profitability): P/E < 50, ROE > 5%
3. **Position Sizing** (volatility-based): 55% for high-vol, 80% for normal, 100% for low-vol
4. **Trailing Stop**: 10% trailing stop for trend following

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Total Trades | 68 |
| Win Rate | 36.76% |
| Avg Win | +13.44% |
| Avg Loss | -6.55% |
| Profit Factor | 1.19| Max Drawdown | -39.80% |

## Exit Reasons

| Reason | Count |
|--------|-------|
| stop_loss | 36 |
| take_profit | 12 |
| trailing_stop | 4 |
| backtest_end | 16 |

## Top 10 Trades

| Ticker | Entry | Exit | PnL% | Reason | P/E | ROE |
|--------|-------|------|------|--------|-----|-----|
| AMOC | 1.41 | 1.69 | +20.00% | take_profit | 4.44 | 10.0 |
| HELI | 5.97 | 7.16 | +20.00% | take_profit | 22.82 | 18.0 |
| SWDY | 91.90 | 110.28 | +20.00% | take_profit | 40.96 | 15.0 |
| TMGH | 79.80 | 95.77 | +20.00% | take_profit | 24.61 | 15.0 |
| HRHO | 23.40 | 28.08 | +20.00% | take_profit | 17.02 | 18.0 |
| HELI | 6.50 | 7.79 | +20.00% | take_profit | 22.82 | 18.0 |
| AMER | 2.79 | 3.35 | +20.00% | take_profit | 39.47 | 15.0 |
| PHDC | 10.62 | 12.75 | +20.00% | take_profit | 14.52 | 15.0 |
| AMOC | 1.58 | 1.90 | +20.00% | take_profit | 4.44 | 10.0 |
| OCDI | 18.74 | 22.48 | +20.00% | take_profit | 22.72 | 12.0 |

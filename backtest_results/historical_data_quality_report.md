# Historical Data Quality Report

**Window:** 2026-06-25 to 2026-10-25

| Market | Rows | Tickers | Range | Status |
|--------|------|---------|-------|--------|
| EGX | 36,742 | 463 | 2026-06-25..2026-10-25 | TESTABLE |
| TADAWUL | 29,818 | 395 | 2026-07-19..2026-10-22 | TESTABLE |
| KSE | 11,721 | 180 | 2026-07-19..2026-10-22 | TESTABLE |
| QSE | 5,034 | 67 | 2026-07-19..2026-10-22 | TESTABLE |
| US | 13,600 | 241 | 2026-06-25..2026-10-23 | BLOCKED — US tickers are EGX collisions, not real US market data |
| CRYPTO | 2,326,664 | 235 | 2026-06-26 00:09:45..2026-10-25 15:07:11 | BLOCKED — intraday data, not daily OHLCV for backtest |

**EGX missing sessions:** 2 (out of 87 expected)
**EGX OHLC validity:** 12-17% invalid (flagged, documented)

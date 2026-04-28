# Task: Create all Flutter data model files for EGX Investment Platform

## Files Created (16 model files + 1 barrel export)

### 1. `market_status.dart`
- `MarketStatus` class with `isMarketHours`, `status`, `cairoTime`, `weekday`, timing fields
- `fromJson` with null-safety, `toJson`

### 2. `market_summary.dart`
- `MarketSummary` class with `totalStocks`, `gainers`, `losers`, `unchanged`, EGX index counts, volume/value
- `fromJson` with snake_case fallback, `toJson`

### 3. `market_index.dart`
- `MarketIndex` class with `symbol`, `name`, `nameAr`, `value`, `previousClose`, `change`, `changePercent`
- `isPositive` getter, `toJson`

### 4. `stock.dart`
- `StockMini` — compact stock representation (ticker, name, prices, change, volume)
- `Stock extends StockMini` — full stock with 30+ fields (OHLC, fundamentals, technicals, membership flags)
- `StockListResponse` — paginated list wrapper (stocks, total, page, pageSize, totalPages)
- `totalVolume` getter for non-null volume access in `Stock`

### 5. `market_overview.dart`
- `MarketOverview` — composite model combining `MarketStatus`, `MarketSummary`, `MarketIndex` list, `StockMini` lists
- Imports and reuses `MarketStatus`, `MarketSummary`, `MarketIndex`, `StockMini`

### 6. `price_history.dart`
- `PriceHistoryPoint` — OHLCV candle with `DateTime date`
- `PriceHistorySummary` — aggregated stats (highest, lowest, avg, change%)
- `PriceHistoryResponse` — full response wrapper with success flag, data list, summary

### 7. `gold_prices.dart`
- `GoldKarat` — individual gold karat price (key, nameAr, pricePerGram, change)
- `GoldOunce` — gold/silver ounce price
- `SilverPrice` — silver per gram
- `BullionItem` — generic bullion item
- `GoldPricesResponse` — full response with nested Map-based karats and bullion parsing
- `GoldHistoryPoint` — historical gold price point

### 8. `currency.dart`
- `CurrencyRate` — currency pair (code, nameAr, buyRate, sellRate, change, isMajor)
- `CurrencyResponse` — full response with centralBankRate, currency list
- `getByCode()` helper method

### 9. `recommendation.dart`
- `Recommendation` — main model with 20+ fields
- `Confidence` — overall, dataQuality, modelAgreement
- `QualityScore` — total, profitability, growth, financialSafety, efficiency, valuation
- `MomentumScore` — score, trend, supportResistance, signalConfluence, volumeConfirmation
- `FairValue` — averageFairValue, grahamNumber, peFairValue, dcfFairValue, upsidePotential, marginOfSafety
- `EntryStrategy` — immediateBuyPrice, dipBuyLevel, cashReservePct
- `ExitStrategy` — targetPrice, stopLoss, timeHorizon (+ riskRewardRatio getter)
- `PositionSizing` — kellyPct, adjustedPct, sharesCount, maxRiskPerStock
- `RiskAssessment` — level, maxDrawdown, keyRisks list

### 10. `deep_analysis.dart`
- `DeepAnalysis` — full analysis with scores, trend, action (Arabic support), price targets, strengths/risks
- `PriceTargets` — support, resistance, upsideTarget
- `TechnicalIndicators` — rsiSignal, maSignal, volumeSignal, momentum

### 11. `ai_insights.dart`
- `AiInsights` — market-wide sentiment with score, breadth, volatility, sector rankings, stock statuses
- `TopSector` — sector name, count, avgChangePercent
- `StockStatusItem` — individual stock status with score, components, fair value, verdict
- `StatusComponents` — momentum, liquidity, valuation, income, tradedValue (+ average getter)

### 12. `portfolio.dart`
- `UserAsset` — portfolio holding with purchase/current prices, gain/loss, alerts
- `PortfolioImpactItem` — impact analysis per asset with alerts, concentration checks
- `PortfolioImpactSummary` — portfolio-wide stats (total value, gain/loss, day impact, risk)
- `PortfolioImpactThresholds` — configurable alert thresholds
- `PortfolioImpactRecommendation` — AI recommendation with Arabic support
- `PortfolioImpactResponse` — full impact response with all sub-models

### 13. `watchlist.dart`
- `WatchlistItem` — watchlist entry with price alerts (above/below/percent) and embedded `Stock`
- Convenience getters: `hasAlerts`, `ticker`, `nameAr`, `currentPrice`, etc.

### 14. `user.dart`
- `User` — user profile with subscription tier, risk tolerance, activity status
- `AuthResponse` — login/register response with user and API key

### 15. `smart_tip.dart`
- `SmartTip` — investment tip with category and author
- `TipCategory` — category metadata with Arabic name, count, icon

### 16. `stock_news.dart`
- `StockNews` — news article with sentiment, relevance scores, categories
- `StockNewsResponse` — response wrapper with news list and overall sentiment
- `OverallSentiment` — aggregated sentiment with score, label (Arabic), confidence

### 17. `models.dart` (barrel export)
- Exports all 16 model files for convenient single import

## Design Decisions
- All `fromJson` accept `dynamic` type for JSON parsing safety
- Both camelCase and snake_case field names handled with fallbacks
- Safe number parsing via `int.tryParse()` and `double.tryParse()`
- Null-safety throughout with `??` operators and null defaults
- Top-level helper functions per file (prefixed with `_` for privacy)
- Computed getters for common derived values (`isPositive`, `isPremium`, `hasAlerts`, etc.)
- `Stock extends StockMini` with `totalVolume` getter for non-null access
- `WatchlistItem` has convenience getters delegating to embedded `Stock`

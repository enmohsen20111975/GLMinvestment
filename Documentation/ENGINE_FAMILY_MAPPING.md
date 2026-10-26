# ENGINE FAMILY MAPPING

> Verified mapping between analysis families (from owner policy) and actual engines.

| Family | Engine | Path | Verified |
|--------|--------|------|----------|
| TREND | technical | vps-service/analyzers/technical.py | ✅ |
| TREND | technical_weighted | vps-service/analyzers/technical_weighted.py | ✅ |
| TREND | technical_target_engine | vps-service/analyzers/technical_target_engine.py | ✅ |
| TREND | multi_timeframe_engine | vps-service/analyzers/multi_timeframe_engine.py | ✅ |
| MOM | breakout_signal | vps-service/analyzers/breakout_signal.py | ✅ |
| MOM | sniper_engine | vps-service/analyzers/sniper_engine.py | ✅ |
| MR | candlestick | vps-service/analyzers/candlestick.py | ✅ |
| MR | candle_probability_engine | vps-service/analyzers/candle_probability_engine.py | ✅ |
| MR | fibonacci | vps-service/analyzers/fibonacci.py | ✅ |
| MR | support_resistance_calculator | vps-service/analyzers/support_resistance_calculator.py | ✅ |
| BRK | smc_engine | vps-service/analyzers/smc_engine.py | ✅ |
| BRK | ai_pattern_analyzer | vps-service/analyzers/ai_pattern_analyzer.py | ✅ |
| BRK | institutional_levels | vps-service/analyzers/institutional_levels.py | ✅ |
| FLOW | liquidity_filter | vps-service/analyzers/liquidity_filter.py | ✅ |
| FLOW | volume_profile | vps-service/analyzers/volume_profile.py | ✅ |
| FUND | fundamental | vps-service/analyzers/fundamental.py | ✅ |
| FUND | fundamental_engine | vps-service/analyzers/fundamental_engine.py | ✅ |
| FUND | fundamental_scorer | vps-service/analyzers/fundamental_scorer.py | ✅ |
| FUND | fair_value_calculator | vps-service/analyzers/fair_value_calculator.py | ✅ |
| FUND | dividend_checker | vps-service/analyzers/dividend_checker.py | ✅ |
| EVENT | news_fetcher_analyzer | vps-service/analyzers/news_fetcher_analyzer.py | ✅ |
| EVENT | news_impact_scorer | vps-service/analyzers/news_impact_scorer.py | ✅ |
| EVENT | sentiment_analyzer | vps-service/analyzers/sentiment_analyzer.py | ✅ |

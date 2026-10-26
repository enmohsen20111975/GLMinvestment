# ORCHESTRATOR ENGINE INVENTORY

> **Total engines:** 116 | **Date:** 2026-10-26

| # | Engine | Path | Type | Lines | Output | Classes |
|---|--------|------|------|-------|--------|---------|
| 1 | adaptive_weights | vps-service/analyzers/adaptive_weights.py | unknown | 791 | score | AdaptiveWeights,AdaptiveWeightsEngine |
| 2 | ai_pattern_analyzer | vps-service/analyzers/ai_pattern_analyzer.py | pattern/structure | 784 | signal+score | PatternResult,for |
| 3 | ai_sentiment | vps-service/analyzers/ai_sentiment.py | news/sentiment | 269 | score |  |
| 4 | alert_system | vps-service/analyzers/alert_system.py | unknown | 288 | unknown | AlertSystem |
| 5 | background_analyzer | vps-service/analyzers/background_analyzer.py | unknown | 2739 | signal+score | أو,BackgroundAnalyzer |
| 6 | backtest_engine | vps-service/analyzers/backtest_engine.py | prediction/tracking | 1267 | signal+score | BacktestEngine |
| 7 | bag_holder_rescue | vps-service/analyzers/bag_holder_rescue.py | unknown | 1195 | score | BagHolderRescue |
| 8 | board_of_analysts | vps-service/analyzers/board_of_analysts.py | unknown | 834 | signal+score | BaseAnalyst,TechnicalAnalyst |
| 9 | breakout_signal | vps-service/analyzers/breakout_signal.py | momentum/breakout | 212 | signal |  |
| 10 | candle_probability_engine | vps-service/analyzers/candle_probability_engine.py | pattern/structure | 377 | score | CandleProbabilityResult,CandleProbabilityEngine |
| 11 | candlestick | vps-service/analyzers/candlestick.py | pattern/structure | 492 | signal | CandleDirection,CandleData |
| 12 | confidence_engine | vps-service/analyzers/confidence_engine.py | scoring/confluence | 498 | signal+score |  |
| 13 | confluence_engine_v3 | vps-service/analyzers/confluence_engine_v3.py | scoring/confluence | 1233 | signal+score | TechnicalSignal,FundamentalScore |
| 14 | conviction_engine | vps-service/analyzers/conviction_engine.py | scoring/confluence | 433 | signal+score | ConvictionResult |
| 15 | core_scoring_engine | vps-service/analyzers/core_scoring_engine.py | scoring/confluence | 2576 | signal+score | TechnicalScorer,VolumeScorer |
| 16 | crypto_analyzer | vps-service/analyzers/crypto_analyzer.py | crypto-specific | 1142 | signal+score | CryptoPrice,OHLCV |
| 17 | crypto_circuit | vps-service/analyzers/crypto_circuit.py | crypto-specific | 260 | signal+score | CircuitBreakerResult,CryptoCircuitBreaker |
| 18 | crypto_disclosure_engine | vps-service/analyzers/crypto_disclosure_engine.py | crypto-specific | 418 | score |  |
| 19 | crypto_maestro | vps-service/analyzers/crypto_maestro.py | crypto-specific | 466 | signal+score | CryptoMaestroResult,CryptoMaestroOrchestrator |
| 20 | crypto_news_fetcher | vps-service/analyzers/crypto_news_fetcher.py | news/sentiment | 391 | score |  |
| 21 | crypto_quality_gate | vps-service/analyzers/crypto_quality_gate.py | crypto-specific | 1226 | signal+score | FactorResult,CryptoQGResult |
| 22 | crypto_regime | vps-service/analyzers/crypto_regime.py | regime/macro | 268 | signal+score | CryptoRegime,CryptoRegimeDetector |
| 23 | crypto_strict_filters | vps-service/analyzers/crypto_strict_filters.py | crypto-specific | 444 | unknown |  |
| 24 | decision_logger | vps-service/analyzers/decision_logger.py | unknown | 348 | score |  |
| 25 | dividend_checker | vps-service/analyzers/dividend_checker.py | fundamental | 346 | signal+score | DividendInfo,DividendScore |
| 26 | dynamic_context_engine | vps-service/analyzers/dynamic_context_engine.py | unknown | 462 | score | DynamicContext,بكل |
| 27 | dynamic_target_engine | vps-service/analyzers/dynamic_target_engine.py | unknown | 1851 | signal+score | ExitSignal,EntrySignal |
| 28 | egx_disclosure_engine | vps-service/analyzers/egx_disclosure_engine.py | unknown | 934 | signal+score |  |
| 29 | egx_stocks_dictionary | vps-service/analyzers/egx_stocks_dictionary.py | unknown | 526 | unknown |  |
| 30 | engine_settings | vps-service/analyzers/engine_settings.py | unknown | 1530 | signal+score |  |
| 31 | enhanced_indicators | vps-service/analyzers/enhanced_indicators.py | unknown | 393 | signal+score | EnhancedIndicatorResult,EnhancedIndicators |
| 32 | enhanced_prediction_tracker | vps-service/analyzers/enhanced_prediction_tracker.py | prediction/tracking | 1027 | signal+score | PredictionResult,EnhancedPredictionTracker |
| 33 | expert_memory_bridge | vps-service/analyzers/expert_memory_bridge.py | unknown | 558 | signal+score | ExpertRec,ExpertConsensus |
| 34 | expert_quality_gate | vps-service/analyzers/expert_quality_gate.py | unknown | 1046 | signal+score | TestResult,ExpertVerdict |
| 35 | fair_value_calculator | vps-service/analyzers/fair_value_calculator.py | fundamental | 494 | signal | FairValueResult,FairValueCalculator |
| 36 | feedback_loop | vps-service/analyzers/feedback_loop.py | unknown | 349 | signal | FeedbackLoop |
| 37 | fibonacci | vps-service/analyzers/fibonacci.py | pattern/structure | 281 | signal | FibonacciLevel,FibonacciAnalyzer |
| 38 | fundamental | vps-service/analyzers/fundamental.py | fundamental | 178 | signal+score | FundamentalMetrics,for |
| 39 | fundamental_data_provider | vps-service/analyzers/fundamental_data_provider.py | fundamental | 812 | score | FundamentalData,FundamentalDataProvider |
| 40 | fundamental_engine | vps-service/analyzers/fundamental_engine.py | fundamental | 372 | signal+score | FundamentalVerdict,FundamentalEngine |
| 41 | fundamental_enhanced | vps-service/analyzers/fundamental_enhanced.py | fundamental | 648 | signal+score | EnhancedFundamentalMetrics,for |
| 42 | fundamental_relative | vps-service/analyzers/fundamental_relative.py | fundamental | 362 | score | FundamentalMetrics,for |
| 43 | fundamental_scorer | vps-service/analyzers/fundamental_scorer.py | fundamental | 569 | signal+score | PiotroskiScore,AltmanZScore |
| 44 | fusion_engine | vps-service/analyzers/fusion_engine.py | scoring/confluence | 745 | signal+score | FusionEngineV20 |
| 45 | golden_hunter | vps-service/analyzers/golden_hunter.py | unknown | 411 | signal |  |
| 46 | hmm_market_regime | vps-service/analyzers/hmm_market_regime.py | regime/macro | 309 | unknown | HMMMarketRegime |
| 47 | hunting_engine | vps-service/analyzers/hunting_engine.py | unknown | 1253 | score |  |
| 48 | institutional_decision_engine | vps-service/analyzers/institutional_decision_engine.py | unknown | 1507 | signal+score |  |
| 49 | institutional_levels | vps-service/analyzers/institutional_levels.py | unknown | 571 | signal |  |
| 50 | intraday_reader | vps-service/analyzers/intraday_reader.py | unknown | 291 | unknown |  |
| 51 | kimi_fixes | vps-service/analyzers/kimi_fixes.py | unknown | 572 | signal+score | SignalValidation |
| 52 | learning_file_storage | vps-service/analyzers/learning_file_storage.py | unknown | 306 | unknown | LearningFileStorage |
| 53 | liquidity_filter | vps-service/analyzers/liquidity_filter.py | liquidity/volume | 1111 | signal | LiquidityLevel,LiquidityProfile |
| 54 | live_indicator_engine | vps-service/analyzers/live_indicator_engine.py | unknown | 1143 | signal+score | LiveIndicatorEngine |
| 55 | live_news_integration | vps-service/analyzers/live_news_integration.py | news/sentiment | 432 | signal+score |  |
| 56 | market_daily_report | vps-service/analyzers/market_daily_report.py | unknown | 907 | signal+score | MarketDailyReport |
| 57 | market_regime_engine | vps-service/analyzers/market_regime_engine.py | regime/macro | 1380 | signal+score | Regime,RegimeIndicators |
| 58 | master_analyzer | vps-service/analyzers/master_analyzer.py | unknown | 5793 | signal+score | MasterAnalysis,لـ |
| 59 | multi_path_detector | vps-service/analyzers/multi_path_detector.py | unknown | 502 | unknown |  |
| 60 | multi_timeframe_engine | vps-service/analyzers/multi_timeframe_engine.py | unknown | 317 | signal+score | MultiTimeframeResult,TimeframeResult |
| 61 | narrative_generator | vps-service/analyzers/narrative_generator.py | unknown | 315 | signal+score |  |
| 62 | news_fetcher_analyzer | vps-service/analyzers/news_fetcher_analyzer.py | news/sentiment | 908 | signal+score |  |
| 63 | news_impact_scorer | vps-service/analyzers/news_impact_scorer.py | news/sentiment | 618 | score |  |
| 64 | news_stop_filter | vps-service/analyzers/news_stop_filter.py | risk/position | 365 | signal+score | NewsStopFilterResult,CircuitBreakerResult |
| 65 | nightly_quant_job | vps-service/analyzers/nightly_quant_job.py | unknown | 247 | unknown |  |
| 66 | patterns | vps-service/analyzers/patterns.py | pattern/structure | 281 | score | PatternType,Pattern |
| 67 | persona_gambler | vps-service/analyzers/persona_gambler.py | filter/utility | 839 | signal+score | GamblerResult |
| 68 | persona_investor | vps-service/analyzers/persona_investor.py | filter/utility | 1162 | signal+score | InvestorResult |
| 69 | persona_screener | vps-service/analyzers/persona_screener.py | filter/utility | 1951 | signal+score | PersonaScreener |
| 70 | position_manager | vps-service/analyzers/position_manager.py | risk/position | 463 | signal+score |  |
| 71 | position_sizing | vps-service/analyzers/position_sizing.py | risk/position | 179 | unknown |  |
| 72 | prediction_optimizer | vps-service/analyzers/prediction_optimizer.py | prediction/tracking | 1586 | signal+score | OptimizedSignal,_DeprecatedRegimeAtrMultipliers |
| 73 | prediction_tracker | vps-service/analyzers/prediction_tracker.py | prediction/tracking | 1429 | signal+score | Prediction,for |
| 74 | production_data_client | vps-service/analyzers/production_data_client.py | unknown | 593 | unknown | ProductionDataClient |
| 75 | quant_cache | vps-service/analyzers/quant_cache.py | unknown | 508 | score |  |
| 76 | quant_engine | vps-service/analyzers/quant_engine.py | unknown | 316 | score | QuantEngine |
| 77 | quant_overdrive | vps-service/analyzers/quant_overdrive.py | unknown | 381 | score | SMFIResult,MonteCarloResult |
| 78 | radar_integration | vps-service/analyzers/radar_integration.py | unknown | 415 | score |  |
| 79 | real_backtester | vps-service/analyzers/real_backtester.py | prediction/tracking | 492 | signal+score | BacktestResult,RealBacktester |
| 80 | real_return_engine | vps-service/analyzers/real_return_engine.py | unknown | 465 | unknown | taxonomy,or |
| 81 | regime_detector | vps-service/analyzers/regime_detector.py | regime/macro | 311 | unknown | RegimeDetector |
| 82 | regime_filter | vps-service/analyzers/regime_filter.py | regime/macro | 246 | unknown |  |
| 83 | reports_engine | vps-service/analyzers/reports_engine.py | unknown | 1933 | signal+score | ReportsEngine |
| 84 | risk | vps-service/analyzers/risk.py | risk/position | 319 | signal | RiskAssessment,RiskManager |
| 85 | risk_adaptive | vps-service/analyzers/risk_adaptive.py | risk/position | 715 | signal | SignalStrength,LiquidityLevel |
| 86 | scoring_fix | vps-service/analyzers/scoring_fix.py | scoring/confluence | 513 | signal+score |  |
| 87 | screener | vps-service/analyzers/screener.py | filter/utility | 655 | score |  |
| 88 | screener_integration | vps-service/analyzers/screener_integration.py | filter/utility | 351 | signal+score |  |
| 89 | seasonality_first_engine | vps-service/analyzers/seasonality_first_engine.py | unknown | 548 | signal+score | ConfluenceSignal,SeasonalityFirstEngine |
| 90 | seasonality_scorer | vps-service/analyzers/seasonality_scorer.py | unknown | 438 | signal+score | SeasonalityScore,SeasonalityScorer |
| 91 | sector_relative | vps-service/analyzers/sector_relative.py | unknown | 470 | signal+score | SectorRelativeScore,SectorRelativeAnalyzer |
| 92 | sentiment_analyzer | vps-service/analyzers/sentiment_analyzer.py | news/sentiment | 592 | signal+score | SentimentResult,for |
| 93 | session_timing | vps-service/analyzers/session_timing.py | filter/utility | 327 | signal | SessionPhase,SessionAnalysis |
| 94 | short_holding_exit | vps-service/analyzers/short_holding_exit.py | unknown | 609 | unknown |  |
| 95 | smart_portfolio_monitor | vps-service/analyzers/smart_portfolio_monitor.py | trend/technical | 472 | signal | StockSignal,WealthPlan |
| 96 | smc_engine | vps-service/analyzers/smc_engine.py | pattern/structure | 452 | signal+score | SMCEngine |
| 97 | sniper_detector | vps-service/analyzers/sniper_detector.py | momentum/breakout | 220 | unknown |  |
| 98 | sniper_engine | vps-service/analyzers/sniper_engine.py | momentum/breakout | 2028 | signal+score | SniperResult,SniperEngine |
| 99 | social_card_generator | vps-service/analyzers/social_card_generator.py | unknown | 902 | unknown | SocialCardGenerator |
| 100 | stock_dna_analyzer | vps-service/analyzers/stock_dna_analyzer.py | unknown | 1186 | score | StockDNA,StockDNAAnalyzer |
| 101 | stock_notebook | vps-service/analyzers/stock_notebook.py | unknown | 1071 | score |  |
| 102 | strict_entry_filters | vps-service/analyzers/strict_entry_filters.py | unknown | 829 | signal |  |
| 103 | support_resistance_calculator | vps-service/analyzers/support_resistance_calculator.py | pattern/structure | 943 | unknown |  |
| 104 | technical | vps-service/analyzers/technical.py | trend/technical | 613 | signal+score | TechnicalIndicators,for |
| 105 | technical_explainer | vps-service/analyzers/technical_explainer.py | trend/technical | 718 | signal+score |  |
| 106 | technical_target_engine | vps-service/analyzers/technical_target_engine.py | trend/technical | 888 | signal+score | TechnicalTargetResult,TechnicalTargetEngine |
| 107 | technical_weighted | vps-service/analyzers/technical_weighted.py | trend/technical | 542 | signal+score | TechnicalIndicators,for |
| 108 | ticker_cooldown | vps-service/analyzers/ticker_cooldown.py | filter/utility | 168 | signal |  |
| 109 | timing | vps-service/analyzers/timing.py | filter/utility | 194 | score | MarketSession,TimingAnalysis |
| 110 | trader_levels_engine | vps-service/analyzers/trader_levels_engine.py | unknown | 271 | unknown |  |
| 111 | unified_analysis | vps-service/analyzers/unified_analysis.py | unknown | 467 | signal+score |  |
| 112 | unified_learning_engine | vps-service/analyzers/unified_learning_engine.py | unknown | 1365 | signal+score | LearningParameters,IterationResult |
| 113 | unified_maestro | vps-service/analyzers/unified_maestro.py | unknown | 613 | signal+score | UnifiedMaestroResult,ArabMarketsMaestro |
| 114 | v68_oracle | vps-service/analyzers/v68_oracle.py | unknown | 734 | signal+score |  |
| 115 | v82_analyzer | vps-service/analyzers/v82_analyzer.py | unknown | 775 | signal+score | V82Signal,V82Analyzer |
| 116 | volume_profile | vps-service/analyzers/volume_profile.py | liquidity/volume | 344 | signal+score | VolumeProfileResult,VolumeProfileAnalyzer |

## Type Distribution

- unknown: 50
- fundamental: 8
- filter/utility: 8
- pattern/structure: 7
- news/sentiment: 6
- scoring/confluence: 6
- crypto-specific: 6
- prediction/tracking: 5
- regime/macro: 5
- risk/position: 5
- trend/technical: 5
- momentum/breakout: 3
- liquidity/volume: 2

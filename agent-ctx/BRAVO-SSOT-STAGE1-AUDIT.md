# 📋 جدول الحصر — المرحلة 1 (Audit & Mapping)

**Task ID:** BRAVO-SSOT-REFACTOR / Stage-1
**التاريخ:** 2026-10-21

---

## إحصائية التكرار الإجمالية:

| الفئة | العدد |
|-------|------:|
| إجمالي دوال calc_* للمؤشرات | 77 |
| في canonical (analyzers/indicators/) | 9 |
| **مكررة خارج canonical** | **68 (88%)** |
| دوال مكررة (>= 2 ملفات) | 41 |
| backtest scripts | 15 |
| backfill scripts | 15 |
| fix scripts | 25 |
| diagnose scripts | 14 |
| radar scripts | 14 |

---

## جدول الدوال المكررة (41 دالة):

### ATR (الأكثر تكراراً — 17 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `calc_atr` | core_scoring_engine, sniper_engine, enhanced_indicators, backtest_engine | → delegate لـ canonical |
| `_calculate_atr` | dynamic_context_engine, technical_target_engine, support_resistance, crypto_quality_gate | → delegate |
| `_safe_atr` | strict_entry_filters, v68_oracle, golden_hunter | → delegate |
| `_compute_atr` | unified_analysis, multi_target_exit, ai_predictions_routes | → delegate |
| `_calc_atr` | v82_analyzer, prediction_optimizer, crypto_lab_scheduler | → delegate |
| `compute_atr` | backfill_to_predictions, backfill_with_personas, backtesting_engine, dynamic_exit_optimizer | → delegate |
| `calculate_atr` | (in scripts) | → delegate |

### RSI (12 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `_rsi` | multi_timeframe_engine, short_holding_exit, strict_entry_filters, crypto_strict_filters | → delegate |
| `compute_rsi` | backfill_to_predictions, backfill_with_personas, backtesting_engine, backfill_historical | → delegate |
| `_calc_rsi` | prediction_optimizer, historical_trade_generator, crypto_lab_scheduler | → delegate |
| `rsi` | technical_weighted, technical, glminvestment_engines/core | → delegate |
| `calc_rsi` | migrate_calc_indicators (already delegates ✅) | OK |

### MACD (11 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `_calc_macd` | prediction_optimizer, master_analyzer, crypto_lab_scheduler, chart_routes | → delegate |
| `calc_macd` | core_scoring_engine, sniper_engine, enhanced_indicators | → delegate |
| `macd` | technical_weighted, technical, indicators/ma | OK (canonical) |
| `calculate_macd` | crypto_analyzer, historical_backfill_engine | → delegate |

### SMA/EMA (15 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `_sma` | multi_timeframe_engine, short_holding_exit, strict_entry_filters, v82_analyzer | → delegate |
| `sma` | technical_weighted, technical, indicators/ma, glminvestment_engines/core | OK (canonical) |
| `calc_sma` | core_scoring_engine, sniper_engine, backtest_engine | → delegate |
| `_compute_sma` | persona_screener, multi_target_exit | → delegate |
| `_ema` | v82_analyzer, golden_hunter, crypto_lab_scheduler | → delegate |
| `ema` | technical_weighted, technical, indicators/ma, glminvestment_engines/core | OK (canonical) |
| `calc_ema` | sniper_engine, enhanced_indicators, backtest_engine | → delegate |
| `_ema_seeded` | master_analyzer, chart_routes | → delegate |

### Bollinger (7 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `calc_bollinger` | core_scoring_engine, enhanced_indicators, indicators/bollinger | OK (canonical) |
| `calc_bollinger_bands` | sniper_engine, backtest_engine | → delegate |
| `_calc_bollinger` | prediction_optimizer, crypto_lab_scheduler | → delegate |
| `bollinger_bands` | technical_weighted, technical | → delegate |
| `calculate_bollinger` | crypto_analyzer, historical_backfill_engine | → delegate |

### ADX/VWAP (4 تعريف):
| الدالة | الملفات | الإجراء |
|--------|---------|---------|
| `_calc_adx` | prediction_optimizer, market_regime | → delegate |
| `calc_adx` | enhanced_indicators, indicators/adx | OK (canonical) |
| `calc_vwap` | sniper_engine, indicators/vwap | OK (canonical) |

---

## السكريبتات المتشابهة (تكرار بنسبة > 80%):

### Backtest scripts (15 — كلها متشابهة 80%+):
| السكريبت | السوق | الإجراء |
|----------|-------|---------|
| backtest_egx.py | EGX | → unified scanner |
| backtest_egx_corrected.py | EGX | → unified scanner |
| backtest_tadawul.py | TADAWUL | → unified scanner |
| backtest_tadawul_corrected.py | TADAWUL | → unified scanner |
| backtest_kse.py | KSE | → unified scanner |
| backtest_kse_corrected.py | KSE | → unified scanner |
| backtest_qse.py | QSE | → unified scanner |
| backtest_crypto.py | CRYPTO | → unified scanner |
| backtest_full.py | ALL | → unified scanner |
| backtest_4months_all_stocks.py | ALL | → unified scanner |
| backtest_hybrid_v2.py | ALL | → unified scanner |
| backtest_momentum_uncap.py | ALL | → unified scanner |
| backtest_unified_pipeline.py | ALL | → unified scanner |
| backtest_with_risk_management.py | ALL | → unified scanner |
| backtesting_engine.py | ALL | → unified scanner |

### ملاحظة:
- 15 سكريبت backtest كلها بتعمل نفس الحاجة بس لأسواق/فترات مختلفة
- المفروض كلها تتحول لـ: `run_market_scanner(market, timeframe, config)`

---

## الخلاصة:
- **68 دالة مكررة** لازم تتحول لـ delegation (88% من الدوال!)
- **15 سكريبت backtest** لازم تتحول لـ unified scanner واحد
- الـ canonical موجود (9 functions في analyzers/indicators/) — بس محتاجين نربط الـ 68 المكررة بيه

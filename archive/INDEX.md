# 📦 Archive Index — الأرشيف المرجعي

> **المبدأ:** مفيش حاجة بتتمسح كده. كل حاجة بتتنقل لـ `archive/` عشان لو احتجناها تكون سهلة الرجوع.

---

## archive/old-scripts/backtest/ (15 script)
سكريبتات backtest المتشابهة (80%+ تكرار) — اتـ استبدلت بـ `core/unified_scanner.py`.

| السكريبت | السوق | الاستبدال |
|----------|-------|-----------|
| backtest_egx.py | EGX | unified_scanner.run_market_scanner('EGX') |
| backtest_egx_corrected.py | EGX | unified_scanner.run_market_scanner('EGX') |
| backtest_tadawul.py | TADAWUL | unified_scanner.run_market_scanner('TADAWUL') |
| backtest_tadawul_corrected.py | TADAWUL | unified_scanner.run_market_scanner('TADAWUL') |
| backtest_kse.py | KSE | unified_scanner.run_market_scanner('KSE') |
| backtest_kse_corrected.py | KSE | unified_scanner.run_market_scanner('KSE') |
| backtest_qse.py | QSE | unified_scanner.run_market_scanner('QSE') |
| backtest_crypto.py | CRYPTO | unified_scanner.run_market_scanner('CRYPTO') |
| backtest_full.py | ALL | unified_scanner.run_market_scanner() |
| backtest_4months_all_stocks.py | ALL | unified_scanner |
| backtest_hybrid_v2.py | ALL | unified_scanner |
| backtest_momentum_uncap.py | ALL | unified_scanner |
| backtest_unified_pipeline.py | ALL | unified_scanner |
| backtest_with_risk_management.py | ALL | unified_scanner |
| backtesting_engine.py | ALL | unified_scanner |

## archive/old-scripts/backfill/ (8 script)
سكريبتات backfill one-shot — اتـ استبدلت بـ canonical delegation.

| السكريبت | الوظيفة | الاستبدال |
|----------|---------|-----------|
| backfill_to_predictions.py | backfill predictions | canonical indicators |
| backfill_with_personas.py | backfill personas | canonical indicators |
| backfill_historical_predictions.py | backfill historical | canonical indicators |
| backfill_confidence.py | backfill confidence | canonical indicators |
| backfill_intraday.py | backfill intraday | canonical indicators |
| backfill_signal_memory.py | backfill signals | canonical indicators |
| dynamic_exit_optimizer.py | exit optimization | canonical indicators |
| production_backtest_tf.py | production backtest | unified_scanner |

## archive/old-scripts/ (11 script — من Stage 6 سابق)
سكريبتات dead code من مراحل سابقة.

| السكريبت | السبب |
|----------|-------|
| backtest_sniper.py | dead (0 callers) |
| honest_backtest_regime.py | dead (0 callers) |
| honest_backtest_egx.py | dead (0 callers) |
| honest_backtest_trend.py | dead (0 callers) |
| comprehensive_ab_backtest.py | dead (0 callers) |
| persona_unify_a_measurement.py | dead (0 callers) |
| diagnose_missed_opportunities.py | dead (0 callers) |
| true_forward_test.py | dead (0 callers) |
| diagnose_data_pipeline.py | dead (0 callers) |
| egx_sniper_backtest.py | dead (0 callers) |
| maestro_backfill_v2.py | dead (0 callers) |

---

## الإحصائيات:
- **total archived:** 34 script
- **backtest scripts:** 15 (→ unified_scanner)
- **backfill scripts:** 8 (→ canonical delegation)
- **dead scripts:** 11 (→ archive)
- **unified_scanner.py:** محرك فحص موحد واحد لكل الأسواق

## كيفية الرجوع لأي ملف:
```bash
# لعرض ملف مؤرشف:
cat archive/old-scripts/backtest/backtest_egx.py

# لاسترجاع ملف من الأرشيف:
git mv archive/old-scripts/backtest/backtest_egx.py vps-service/scripts/backtest_egx.py
```

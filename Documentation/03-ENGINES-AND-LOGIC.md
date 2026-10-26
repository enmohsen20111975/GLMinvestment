# 03 — المحركات والمنطق الاستثماري

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:
1. **Rule-Based** (110 محرك تحليلي)
2. **Statistical** (Bayesian + HMM + Monte Carlo)
3. **LLM-Augmented** (Ollama glm-fast:latest — 40% وزن فقط)

## 2. المحرك المركزي: master_analyzer.py

- **5,794 LOC** — يجمع 9 مصادر دليل
- 8 قواعد ذهبية (Hard Veto)
- عتبات الإشارة: STRONG_BUY≥78, BUY≥65, ACCUMULATE≥55, NEUTRAL 45-54, AVOID<45

## 3. فهرس المحركات (8 فئات)

### 3.1 Master/Fusion (10 engines)
master_analyzer, core_scoring_engine, confluence_engine_v3, institutional_decision_engine, v68_oracle, fusion_engine, unified_maestro, hunting_engine, seasonality_first_engine

### 3.2 Technical/Indicator (16 engines)
technical, technical_weighted, technical_target, enhanced_indicators, multi_timeframe, live_indicator_engine, candlestick, candle_probability, patterns, fibonacci, volume_profile, smc_engine, multi_path_detector, support_resistance_calculator, dynamic_target_engine, breakout_signal

### 3.3 Regime/Risk/Liquidity (15 engines)
market_regime_engine (1380 LOC), regime_detector, regime_filter, hmm_market_regime, crypto_regime, risk, risk_adaptive, liquidity_filter, strict_entry_filters, crypto_quality_gate, expert_quality_gate, expert_memory_bridge, ticker_cooldown

### 3.4 Fundamental/Seasonality (12 engines)
fundamental_scorer (Piotroski + Altman Z), fundamental_relative, fair_value_calculator, real_return_engine, seasonality_scorer, dividend_checker, sector_relative

### 3.5 Prediction Tracking/Learning (12 engines)
prediction_tracker, unified_learning_engine (THE LEARNING BRAIN), prediction_optimizer, adaptive_weights, quant_overdrive (Monte Carlo 500 paths), quant_cache

### 3.6 Persona/Position/Portfolio (10 engines)
persona_screener (7 personas), persona_investor, persona_gambler, position_manager, smart_portfolio_monitor, bag_holder_rescue, short_holding_exit, stock_dna_analyzer

### 3.7 Rescue Framework (5 modules — جديد)
loss_attribution (6-cause taxonomy), rescue_classifier (A/B/C/D + INSUFFICIENT_DATA), averaging_simulator (5×5 grid), liquidity_allocator (4 actions), monitoring_plan

### 3.8 Reporting (8 engines)
narrative_generator, social_card_generator, reports_engine, market_daily_report, conviction_engine, confidence_engine

## 4. نظام Confluence Scoring

```
FINAL = w1×Tech + w2×SMC + w3×Vol + w4×Fund + w5×Regime + w6×Persona + w7×Season + w8×News

SMC weight = 60% (dominant)
Technical = 15%
Volume = 10%
Fundamentals = 15%
```

## 5. Market Regime (3 حالات)

| Regime | Threshold | Position Size |
|--------|-----------|---------------|
| DEFENSIVE | EGX30 drops 5% in 5d | Half size, threshold 70+ |
| NORMAL | default | Full size, threshold 65+ |
| AGGRESSIVE | EGX30 up 8% in 5d | +25% size, threshold 55+ |

Hysteresis: 2-3 days to prevent flip-flop.

## 6. Minervini Stages

| Stage | الشرط | الإشارة |
|-------|-------|---------|
| 1 (Base) | price ≈ 200SMA flat | NEUTRAL |
| 2 (Bull) | price > 200SMA rising + Golden Cross + ADX≥25 | BUY |
| 3 (Top) | price > 200SMA but flattening | AVOID |
| 4 (Bear) | price < 200SMA falling | STRONG_AVOID (HARD VETO) |

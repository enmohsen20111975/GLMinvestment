# ENGINE_CONTRACTS.md — Master Analyzer + Pipeline
> **Phase 3 deliverable:** unified decision source + engine contracts
> **Branch:** main | **Date:** 2026-10-26

---

## 1. Master Analyzer Contract (the unified decision source)

### Inputs
```python
MasterAnalyzer.analyze(
    ticker: str,           # EGX stock symbol (e.g. 'COMI')
    prices: List[float],   # closing prices, oldest→newest (min 50 for full analysis)
    volumes: List[float],   # volumes matching prices
    market_pulse: dict,    # optional: real-time market regime
    history: List[Dict],   # optional: prediction history for learning
    **kwargs
) → MasterAnalysis
```

### Outputs (MasterAnalysis dataclass — key fields)
```python
MasterAnalysis = {
    # Final decision (UNIFIED SOURCE)
    recommendation: str,       # STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL | NO_TRADE
    master_score: float,        # 0-100 weighted score
    
    # Price levels
    entry_price: float,
    stop_loss: float,
    target_price: float,
    current_price: float,
    
    # Risk management
    risk_reward_ratio: float,
    suggested_position_size: float,  # % of capital
    
    # Confidence
    conviction_score: float,
    conviction_level: str,
    
    # Metadata
    signal_type: str,
    reasons: List[str],
    data_quality: str,       # fresh | stale | very_stale
    analyzed_at: str,
}
```

### Thresholds (canonical — single source of truth)
```python
THRESHOLDS = {
    'STRONG_BUY': 78,
    'BUY': 65,
    'HOLD': 45,
    'SELL': 35,
    'STRONG_SELL': 25,
}
# master_score >= 78 → STRONG_BUY
# master_score >= 65 → BUY
# master_score >= 45 → HOLD
# master_score >= 35 → SELL (was ACCUMULATE)
# master_score < 25 → STRONG_SELL
```

---

## 2. Decision Pipeline (actual execution order)

```
1. Market Data (price_history.db) → prices + volumes
2. Data Validation → staleness check, market='EGX' filter
3. Liquidity Filter → skip if turnover < threshold
4. Market Regime → DEFENSIVE / NORMAL / AGGRESSIVE
5. Technical Analysis → RSI, ATR, MA, SMC, Support/Resistance
6. Fundamental Analysis → sector-relative scoring
7. Confluence Scoring → 8-layer weighted combination
8. Conviction Engine → confidence level
9. Risk Profile → entry, stop, target, R:R
10. Position Sizing → suggested_position_size (% of capital)
11. Final Decision → recommendation (from master_score vs THRESHOLDS)
12. Output → MasterAnalysis dataclass
```

### Authority per stage
| Stage | Engine | Authority |
|---|---|---|
| 1-2 | data layer | data source + validation |
| 3 | liquidity_filter | can BLOCK (skip analysis) |
| 4 | market_regime_engine | adjusts confidence, cannot block |
| 5-6 | technical + fundamental | scoring only, no recommendation |
| 7 | confluence_engine_v3 | weighted combination |
| 8 | conviction_engine | confidence level |
| 9-10 | risk + position_sizing | entry/stop/target/size |
| 11 | **master_analyzer (FINAL)** | **only source of recommendation** |

### Conflict resolution
- If liquidity_filter blocks → NO_TRADE (overrides everything)
- If market_regime = DEFENSIVE → threshold raised (+5 to STRONG_BUY/BUY)
- If conviction_level = LOW → downgrade recommendation one level
- If risk_reward < 1.0 → downgrade to HOLD

---

## 3. Position Manager Contract

### Inputs
```python
manage_position(
    prediction: dict,     # from MasterAnalysis
    current_price: float,
    price_lookup_fn: callable,
) → position_action: dict
```

### Outputs
```python
position_action = {
    action: str,       # HOLD | TRIM | EXIT | ADD
    reason: str,
    current_return: float,
    holding_days: int,
    target_progress: float,
}
```

### Connection to master_analyzer
- `master_analyzer` emits `suggested_position_size` + `entry_price` + `stop_loss`
- `position_manager` takes ACTIVE predictions (post-entry) and manages them
- **Gap identified:** `position_manager` is NOT called during initial analysis — only for tracking
- **Fix proposed:** integrate `position_manager` check into master_analyzer.analyze() to prevent new signals that conflict with existing positions

---

## 4. Engines Inventory (production-active)

### Tier 1 — Core (always runs)
| Engine | File | Role | Tests? |
|---|---|---|---|
| master_analyzer | analyzers/master_analyzer.py | FINAL decision | pending |
| market_regime_engine | analyzers/market_regime_engine.py | regime detection | pending |
| liquidity_filter | analyzers/liquidity_filter.py | tradeable filter | pending |
| confluence_engine_v3 | analyzers/confluence_engine_v3.py | 8-layer scoring | pending |
| conviction_engine | analyzers/conviction_engine.py | confidence level | pending |

### Tier 2 — Analysis (contributes scores)
| Engine | File | Role |
|---|---|---|
| technical | analyzers/technical.py | RSI, MA, MACD |
| technical_weighted | analyzers/technical_weighted.py | weighted technical |
| fundamental | analyzers/fundamental.py | P/E, EPS, sector |
| fundamental_scorer | analyzers/fundamental_scorer.py | fundamental scoring |
| smc_engine | analyzers/smc_engine.py | order blocks, FVG |
| support_resistance_calculator | analyzers/support_resistance_calculator.py | levels |
| candlestick | analyzers/candlestick.py | patterns |
| fibonacci | analyzers/fibonacci.py | fib levels |

### Tier 3 — Risk & Position
| Engine | File | Role |
|---|---|---|
| risk | analyzers/risk.py | risk assessment |
| risk_adaptive | analyzers/risk_adaptive.py | adaptive risk |
| position_manager | analyzers/position_manager.py | active position management |
| position_sizing | analyzers/position_sizing.py | initial size calc |

### Tier 4 — Auxiliary (optional/contextual)
| Engine | File | Role |
|---|---|---|
| news_impact_scorer | analyzers/news_impact_scorer.py | news sentiment |
| sentiment_analyzer | analyzers/sentiment_analyzer.py | market sentiment |
| seasonality_scorer | analyzers/seasonality_scorer.py | seasonal patterns |
| ticker_cooldown | analyzers/ticker_cooldown.py | repeat signal prevention |

---

## 5. Sub-engines that MUST NOT emit recommendations

The following engines compute intermediate scores but **must not** emit a final `recommendation` field. Only `master_analyzer` does.

| Engine | Current behavior | Fix needed? |
|---|---|---|
| technical.py | emits `recommendation` | YES — change to `technical_signal` |
| fundamental.py | emits `recommendation` | YES — change to `fundamental_signal` |
| smc_engine.py | emits `recommendation` | YES — change to `smc_signal` |
| candlestick.py | emits `pattern_type` | NO — correct |
| conviction_engine.py | emits `conviction_action` | NO — correct (not recommendation) |

**Rule:** any field named `recommendation` in the output MUST come from `master_analyzer`. Sub-engines emit `*_signal` (intermediate).

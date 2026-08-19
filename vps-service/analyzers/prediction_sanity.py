"""
Prediction Sanity Gate — بوابة سلامة التوقعات
================================================
فلاتر صارمة عشان نمنع التوقعات الوهمية

Hard Limits:
- MAX_PREDICTIONS_PER_DAY = 5
- R_R_MAX = 10.0
- TARGET_MAX_PERCENT = 50.0
- MIN_PRICE = 1.0
- RSI must be calculated (not default 50, not 0)
- Confidence must be calculated (not default 87)
- Stop loss must be set (> 0)

Round 3 Fixes:
- R/R > 10.0 → REJECT (was 5.0, then 10.0 — keeping 10.0 but ENFORCING)
- Target > 50% → REJECT (EGX max realistic)
- Stop loss = 0 → REJECT (no stop loss = no risk management)
- RSI = 0 → REJECT (calc_rsi returns 0 for insufficient data)

Round 3.1 FIX: NO time-based auto-expire!
- Dead predictions: only expire if price is ±2% from entry for 30+ days
- Active predictions: keep tracking regardless of age
- "التوقع بيتقفل عشان السعر، مش عشان الوقت"

Author: Bug-fix Agent (Task 2) — Round 3 updated
"""

# ═══════════════════════════════════════════════════════════════
# HARD LIMITS — عتبات صارمة
# ═══════════════════════════════════════════════════════════════

MAX_PREDICTIONS_PER_DAY = 5
R_R_MAX = 10.0          # 🔴 Round 3: MAX R/R ratio — anything above is fantasy
TARGET_MAX_PERCENT = 50.0  # 🔴 Round 3: 50% max for Egyptian market (EGX daily limit is 20%, multi-day can reach 50%)
MIN_PRICE = 1.0
DEFAULT_RSI = 50.0       # Legacy: if RSI equals this, it likely wasn't calculated (now calc_rsi returns None)
DEFAULT_CONFIDENCE = 87.0  # If confidence equals this exactly, it likely wasn't calculated
DEAD_PREDICTION_DAYS = 30     # 🔴 Round 3.1: Only expire if price is dead (±2% from entry) for 30+ days
DEAD_PRICE_THRESHOLD = 0.02   # 🔴 Round 3.1: ±2% from entry = "dead" — no real price movement
HIDDEN_MARKETS = ['الكويت', 'قطر', 'السعودية', 'السعوديه', 'KSE', 'QSE', 'TADAWUL', 'Kuwait', 'Qatar', 'Saudi Arabia', 'Saudi']  # 🔴 Round 3: Markets without real APIs


def sanity_check_prediction(stock_data: dict) -> tuple:
    """
    Sanity check for any prediction.
    Returns: (is_valid: bool, reason: str)

    Checks:
    1. Penny stock filter (price < MIN_PRICE)
    2. Stop loss must be set (> 0) — Round 3: no stop loss = no risk management
    3. Unrealistic target percentage (target - entry) / entry > TARGET_MAX_PERCENT
    4. Unrealistic R/R ratio (> R_R_MAX)
    5. Penny stock pump detection (price < 0.5 AND target > 10x)
    6. Default RSI check (RSI == 50.0 or 0 means not calculated) — Round 3: RSI=0 is also fake
    7. Default confidence check (confidence == 87.0 means not calculated)

    Note: Only applies strict checks to BUY signals.
    HOLD/SELL signals pass through (they aren't actionable recommendations).
    """
    ticker = stock_data.get('ticker', '')
    current_price = stock_data.get('current_price', 0)
    risk = stock_data.get('risk_profile', {})
    entry = risk.get('entry_price', current_price) if isinstance(risk, dict) else current_price
    target = risk.get('target_price', 0) if isinstance(risk, dict) else 0
    stop = risk.get('stop_loss_price', 0) if isinstance(risk, dict) else 0
    rr = risk.get('risk_reward_ratio', 0) if isinstance(risk, dict) else 0
    signal = stock_data.get('signal', 'HOLD')

    # Non-actionable signals always pass
    if signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'):
        return True, 'OK'

    # ─── 1. Minimum price ───
    if entry < MIN_PRICE:
        return False, f'Penny stock ({entry:.2f} < {MIN_PRICE})'

    # ─── 2. Stop loss must be set — Round 3: no stop loss = no risk management ───
    if stop <= 0:
        return False, f'No stop loss set (stop_loss=0) — prediction rejected'
    # Stop loss must be below entry for BUY signals
    if stop >= entry:
        return False, f'Stop loss above/below entry (stop={stop:.2f}, entry={entry:.2f}) — invalid'

    # ─── 3. Target percentage check ───
    if entry > 0 and target > 0:
        target_pct = ((target - entry) / entry) * 100
        if target_pct > TARGET_MAX_PERCENT:
            return False, f'Target unrealistic ({target_pct:.1f}% > {TARGET_MAX_PERCENT}%)'

    # ─── 4. R/R ratio check ───
    if rr > R_R_MAX:
        return False, f'R/R unrealistic ({rr:.1f} > {R_R_MAX})'
    # Also calculate R/R manually if not provided or looks wrong
    if rr <= 0 and entry > 0 and target > 0 and stop > 0 and stop < entry:
        risk = entry - stop
        reward = target - entry
        if risk > 0:
            actual_rr = reward / risk
            if actual_rr > R_R_MAX:
                return False, f'R/R unrealistic (calculated: {actual_rr:.1f} > {R_R_MAX})'

    # ─── 5. Penny stock pump detection ───
    if entry < 0.5 and target > entry * 10:
        return False, f'Penny stock pump ({entry:.2f} -> {target:.2f})'

    # ─── 6. RSI not calculated (HARD REJECT) ───
    rsi = stock_data.get('rsi', None)
    # RSI=None means no data — reject
    # RSI=50 is legacy default — reject
    # RSI=0 means calculation returned 0 (insufficient data) — REJECT (Round 3)
    if rsi is None:
        return False, f'RSI not calculated (insufficient price data) — prediction rejected'
    if rsi == DEFAULT_RSI:
        return False, f'RSI appears to be default value ({rsi}) — prediction rejected'
    if rsi == 0:
        return False, f'RSI=0 (insufficient price data for calculation) — prediction rejected'

    # ─── 7. Confidence not calculated (HARD REJECT) ───
    confidence = stock_data.get('confidence', None)
    if confidence is None or confidence == DEFAULT_CONFIDENCE:
        return False, f'Confidence not calculated (value={confidence}) — prediction rejected'

    return True, 'OK'


def filter_predictions(predictions: list, max_predictions: int = MAX_PREDICTIONS_PER_DAY) -> tuple:
    """
    Filter a list of predictions through the sanity gate.
    Only keeps BUY signals that pass all checks.
    Sorts by master_score descending.
    Limits to max_predictions.

    Returns: (valid_predictions: list, rejected: list[dict])
        Each rejected item: {'ticker': str, 'reason': str, 'signal': str}
    """
    valid = []
    rejected = []

    for pred in predictions:
        signal = pred.get('signal', 'HOLD')

        # Only consider actionable signals for recommendations
        if signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'):
            continue

        # ─── Round 3: Filter out hidden markets (Kuwait/Qatar — no real APIs) ───
        market = (pred.get('market', '') or '').upper()
        market_ar = pred.get('market', '') or ''
        if any(hm.upper() == market or hm == market_ar for hm in HIDDEN_MARKETS):
            ticker = pred.get('ticker', '???')
            rejected.append({'ticker': ticker, 'reason': f'Market hidden (no real API: {market or market_ar})', 'signal': signal})
            continue

        # ─── Disaster #1 FIX: Minimum price filter (penny stocks) ───
        risk = pred.get('risk_profile', {})
        entry = risk.get('entry_price', pred.get('current_price', 0)) if isinstance(risk, dict) else pred.get('current_price', 0)
        if entry < MIN_PRICE:
            ticker = pred.get('ticker', '???')
            rejected.append({'ticker': ticker, 'reason': f'Penny stock ({entry:.2f} < {MIN_PRICE})', 'signal': signal})
            continue

        is_valid, reason = sanity_check_prediction(pred)

        if is_valid:
            valid.append(pred)
        else:
            ticker = pred.get('ticker', '???')
            rejected.append({
                'ticker': ticker,
                'reason': reason,
                'signal': signal,
            })

    # Sort by master_score descending
    valid.sort(key=lambda x: x.get('master_score', 0), reverse=True)

    # Limit
    valid = valid[:max_predictions]

    return valid, rejected

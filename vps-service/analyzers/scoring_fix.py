"""
Scoring Fix - إصلاح نظام النقاط
================================

المشكلة: كل الأسهم بتاخد "احتفاظ" لأن الـ scores كلها 50
الحل: نظام نقاط أكثر حساسية

Author: دليل الاستثمار
"""

# ============================================================================
# FIXED THRESHOLDS - أكثر حساسية
# ============================================================================

# القديم (مشكلة):
# STRONG_BUY >= 80  → صعب جداً يوصل له
# BUY >= 65         → صعب
# ACCUMULATE >= 50  → كل حاجة بتقع هنا
# HOLD >= 35        → 

# الجديد (أفضل):
FIXED_THRESHOLDS = {
    'STRONG_BUY': 70,    # أقل من 80 - أسهل
    'BUY': 58,           # أقل من 65
    'ACCUMULATE': 48,    # أقل من 50
    'HOLD_HIGH': 42,     # نطاق HOLD: 42-48
    'HOLD_LOW': 35,
    'REDUCE': 28,        # أعلى من 25
    'SELL': 20,          # أعلى من 15
    'STRONG_SELL': 10,
}


# ============================================================================
# SCORE MULTIPLIERS - تعزيز النقاط
# ============================================================================

def calculate_enhanced_score(
    technical_score: float,
    fundamental_score: float,
    timing_score: float,
    pattern_score: float,
    market_regime_score: float,
    price_change_24h: float = 0,
    volume_ratio: float = 1.0,
    rsi: float = 50,
) -> float:
    """
    حساب النقاط المحسن
    
    التعديلات:
    1. تعزيز النقاط بناءً على Price Change
    2. تعزيز النقاط بناءً على Volume
    3. تعزيز النقاط بناءً على RSI extremes
    """
    # الأوزان الأساسية
    weights = {
        'technical': 0.40,
        'fundamental': 0.30,
        'timing': 0.15,
        'pattern': 0.10,
        'market_regime': 0.05,
    }
    
    # حساب الـ base score
    base_score = (
        technical_score * weights['technical'] +
        fundamental_score * weights['fundamental'] +
        timing_score * weights['timing'] +
        pattern_score * weights['pattern'] +
        market_regime_score * weights['market_regime']
    )
    
    # التعديلات الإضافية
    adjustments = 0.0
    
    # 1. Price Change Adjustment
    if price_change_24h != 0:
        # لو السهم طلع كتير = مبالغة = تقليل
        # لو السهم نزل كتير = فرصة = زيادة
        if price_change_24h > 5:
            adjustments -= 5  # طالع كتير - خطر
        elif price_change_24h > 3:
            adjustments -= 2
        elif price_change_24h < -5:
            adjustments += 8  # نزل كتير - فرصة
        elif price_change_24h < -3:
            adjustments += 4
    
    # 2. Volume Adjustment
    if volume_ratio > 2.0:
        adjustments += 5  # سيولة عالية = اهتمام
    elif volume_ratio > 1.5:
        adjustments += 2
    elif volume_ratio < 0.5:
        adjustments -= 5  # سيولة ضعيفة = تجاهل
    
    # 3. RSI Adjustment
    if rsi < 30:
        adjustments += 10  # Oversold = فرصة شراء
    elif rsi < 40:
        adjustments += 5
    elif rsi > 70:
        adjustments -= 10  # Overbought = خطر
    elif rsi > 60:
        adjustments -= 5
    
    # Final score
    final_score = base_score + adjustments
    
    # Clamp between 0 and 100
    final_score = max(0, min(100, final_score))
    
    return round(final_score, 2)


def get_signal_from_score(score: float) -> tuple:
    """
    تحويل النقاط إلى إشارة
    
    Returns:
        tuple: (signal, signal_ar)
    """
    if score >= FIXED_THRESHOLDS['STRONG_BUY']:
        return ('STRONG_BUY', 'شراء قوي')
    elif score >= FIXED_THRESHOLDS['BUY']:
        return ('BUY', 'شراء')
    elif score >= FIXED_THRESHOLDS['ACCUMULATE']:
        return ('ACCUMULATE', 'تجميع')
    elif score >= FIXED_THRESHOLDS['HOLD_LOW']:
        return ('HOLD', 'احتفاظ')
    elif score >= FIXED_THRESHOLDS['REDUCE']:
        return ('REDUCE', 'تخفيف')
    elif score >= FIXED_THRESHOLDS['SELL']:
        return ('SELL', 'بيع')
    else:
        return ('STRONG_SELL', 'بيع قوي')


def calculate_real_target_stop(
    entry_price: float,
    score: float,
    support: float = None,
    resistance: float = None,
    volatility: float = 3.0,
    atr: float = None,
    atr_pct: float = None,
    high_30d: float = None,
    low_30d: float = None,
    ticker: str = None,
    rsi: float = None,
    volume: float = None,
    volume_sma_20: float = None,
    macd_histogram: float = None,
    prev_macd_histogram: float = None,
    candlestick_pattern: str = None,
    candlestick_direction: str = None,
    zone: str = None,
) -> dict:
    """
    حساب الهدف والوقف الحقيقي — بناءً على التحليل الفنى والشموع اليابانية
    ================================================================
    
    القاعدة الذهبية: "مفيش target = entry * 1.10 تاني"
    كل سهم له دعم ومقاومة حقيقيين من الشموع.
    الوقف على الدعم، الهدف على المقاومة، R/R يتحسب من المسافة الحقيقية.
    
    PRIMARY: Uses DynamicTargetEngine (4-layer stop + 5-layer target + Fibonacci + exit signals)
    FALLBACK: Legacy calculation if dynamic engine not available
    """
    # Safety check for invalid entry price
    if not entry_price or entry_price <= 0:
        return {
            'target_price': 0.0,
            'target_pct': 0.0,
            'stop_loss': 0.0,
            'stop_pct': 0.0,
            'risk_reward': 0.0,
            'entry_price': 0.0,
        }
    
    # ========================================
    # PRIMARY: Use Dynamic Target Engine
    # ========================================
    try:
        from analyzers.dynamic_target_engine import calculate_dynamic_targets
        result = calculate_dynamic_targets(
            ticker=ticker or 'UNKNOWN',
            entry_price=entry_price,
            score=score,
            persona='balanced',  # scoring_fix uses balanced as default
            support=support,
            resistance=resistance,
            atr=atr,
            atr_pct=atr_pct,
            high_30d=high_30d,
            low_30d=low_30d,
            volatility=volatility,
            rsi=rsi,
            volume=volume,
            volume_sma_20=volume_sma_20,
            macd_histogram=macd_histogram,
            prev_macd_histogram=prev_macd_histogram,
            candlestick_pattern=candlestick_pattern or '',
            candlestick_direction=candlestick_direction or '',
            zone=zone,
        )
        # Return in legacy-compatible format + new fields
        return result
    except ImportError:
        pass  # Fall through to legacy calculation
    except Exception as e:
        print(f"[scoring_fix] DynamicTargetEngine error: {e}")
        pass  # Fall through to legacy calculation
    
    # ========================================
    # FALLBACK: Legacy calculation
    # ========================================
    
    # ========================================
    # STEP 1: Calculate STOP LOSS
    # Priority: Support → ATR → Volatility fallback
    # ========================================
    
    stop_candidates = []  # List of (stop_price, method, confidence)
    
    # Method 1: Support-based stop (HIGHEST PRIORITY)
    # If there's a support level below entry, stop just below it
    if support and support > 0 and support < entry_price:
        support_stop = support * 0.97  # 3% below support (allows wiggle room)
        support_stop_pct = (entry_price - support_stop) / entry_price
        # Only use if stop is reasonable (0.5% - 25%)
        if 0.005 <= support_stop_pct <= 0.25:
            stop_candidates.append((support_stop, 'SUPPORT', 1.0))
    
    # Method 2: ATR-based stop (from candlestick analysis)
    # ATR measures the REAL range of price movement including gaps
    # Stop = entry - (1.5 × ATR) — covers 1.5 average true ranges
    if atr and atr > 0 and entry_price > 0:
        atr_stop = entry_price - (1.5 * atr)
        atr_stop_pct = (entry_price - atr_stop) / entry_price
        if 0.005 <= atr_stop_pct <= 0.25:
            stop_candidates.append((atr_stop, 'ATR', 0.9))
    elif atr_pct and atr_pct > 0:
        # ATR as percentage already provided
        atr_stop_pct = atr_pct * 1.5 / 100.0
        if 0.005 <= atr_stop_pct <= 0.25:
            stop_candidates.append((entry_price * (1 - atr_stop_pct), 'ATR_PCT', 0.9))
    
    # Method 3: Low of 30 days
    if low_30d and low_30d > 0 and low_30d < entry_price:
        low_stop = low_30d * 0.98  # 2% below 30-day low
        low_stop_pct = (entry_price - low_stop) / entry_price
        if 0.005 <= low_stop_pct <= 0.25:
            stop_candidates.append((low_stop, 'LOW_30D', 0.7))
    
    # Method 4: Volatility-based stop (FALLBACK)
    if volatility <= 0:
        volatility = 3.0
    vol_stop_pct = volatility * 1.2 / 100.0
    vol_stop_pct = max(0.01, min(0.20, vol_stop_pct))
    stop_candidates.append((entry_price * (1 - vol_stop_pct), 'VOLATILITY', 0.5))
    
    # Choose the best stop: prefer higher-confidence methods
    # But also consider: we want a stop that's not too tight (gets hit by noise)
    # and not too wide (risks too much capital)
    if stop_candidates:
        # Sort by confidence (highest first), then pick the tightest stop among high-confidence
        stop_candidates.sort(key=lambda x: (-x[2], x[0]))
        # Use the highest confidence method
        stop_loss = stop_candidates[0][0]
        stop_method = stop_candidates[0][1]
    else:
        stop_loss = entry_price * 0.92  # 8% default
        stop_method = 'DEFAULT'
    
    # Score adjustment: tighter stop for high confidence signals
    actual_stop_pct = (entry_price - stop_loss) / entry_price
    if score >= 70:
        # Tighten by 15%
        tighter_stop = entry_price - (entry_price - stop_loss) * 0.85
        stop_loss = tighter_stop
        stop_method += '+TIGHT'
    elif score < 48:
        # Widen by 20%
        wider_stop = entry_price - (entry_price - stop_loss) * 1.2
        stop_loss = wider_stop
        stop_method += '+WIDE'
    
    # Ensure stop is below entry
    if stop_loss >= entry_price:
        stop_loss = entry_price * 0.92
    
    # Recalculate actual stop percentage
    actual_stop_pct = (entry_price - stop_loss) / entry_price
    
    # ========================================
    # STEP 2: Calculate TARGET
    # Priority: Resistance → R:R from stop → High 30d → Volatility
    # ========================================
    
    target_candidates = []
    
    # Score-based minimum R:R ratio
    if score >= 70:
        min_rr = 3.0
    elif score >= 58:
        min_rr = 2.5
    elif score >= 48:
        min_rr = 2.0
    else:
        min_rr = 1.5
    
    # Method 1: Resistance-based target (HIGHEST PRIORITY)
    if resistance and resistance > entry_price:
        resistance_target = resistance * 0.98  # 2% below resistance
        resistance_target_pct = (resistance_target - entry_price) / entry_price
        # Only use if it gives a reasonable R:R
        rr_from_resistance = resistance_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0
        if rr_from_resistance >= 1.0:  # At least 1:1 R:R
            target_candidates.append((resistance_target, 'RESISTANCE', 1.0))
    
    # Method 2: R:R based target (derived from stop loss)
    rr_target = entry_price + (entry_price - stop_loss) * min_rr
    rr_target_pct = (rr_target - entry_price) / entry_price
    if 0.01 <= rr_target_pct <= 0.60:
        target_candidates.append((rr_target, f'RR_{min_rr}', 0.85))
    
    # Method 3: High of 30 days
    if high_30d and high_30d > entry_price:
        high_target = high_30d * 0.98  # 2% below 30-day high
        high_target_pct = (high_target - entry_price) / entry_price
        if high_target_pct >= 0.01:
            target_candidates.append((high_target, 'HIGH_30D', 0.7))
    
    # Method 4: Volatility-based target (FALLBACK)
    vol_target_pct = actual_stop_pct * min_rr
    if 0.01 <= vol_target_pct <= 0.60:
        target_candidates.append((entry_price * (1 + vol_target_pct), 'VOLATILITY', 0.5))
    
    # Choose the best target
    if target_candidates:
        # Prefer resistance-based if available, then R:R-based
        target_candidates.sort(key=lambda x: (-x[2], -x[0]))
        # But ensure minimum R:R
        best = target_candidates[0]
        target_price = best[0]
        target_method = best[1]
        
        # Check if the best target meets minimum R:R
        actual_target_pct = (target_price - entry_price) / entry_price
        actual_rr = actual_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0
        
        # If best target doesn't meet min R:R, try R:R-based instead
        if actual_rr < min_rr and len(target_candidates) > 1:
            for tc in target_candidates:
                tc_pct = (tc[0] - entry_price) / entry_price
                tc_rr = tc_pct / actual_stop_pct if actual_stop_pct > 0 else 0
                if tc_rr >= min_rr:
                    target_price = tc[0]
                    target_method = tc[1]
                    break
            else:
                # None meet min R:R, use R:R-based target
                target_price = entry_price + (entry_price - stop_loss) * min_rr
                target_method = f'RR_{min_rr}_ENFORCED'
    else:
        target_price = entry_price * 1.10  # 10% default
        target_method = 'DEFAULT'
    
    # Ensure target is above entry
    if target_price <= entry_price:
        target_price = entry_price + (entry_price - stop_loss) * min_rr
    
    # ========================================
    # STEP 3: Final calculations
    # ========================================
    
    actual_target_pct = (target_price - entry_price) / entry_price
    actual_stop_pct = (entry_price - stop_loss) / entry_price
    
    # Risk-Reward Ratio
    risk = entry_price - stop_loss
    reward = target_price - entry_price
    risk_reward = reward / risk if risk > 0 else 0
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
    except Exception:
        pass  # keep inline risk_reward computed above
    
    return {
        'target_price': round(target_price, 2),
        'target_pct': round(actual_target_pct * 100, 1),
        'target_basis': target_method.lower(),
        'target_detail': f'Legacy via {target_method}',
        'stop_loss': round(stop_loss, 2),
        'stop_pct': round(actual_stop_pct * 100, 1),
        'stop_basis': stop_method.lower(),
        'stop_detail': f'Legacy via {stop_method}',
        'risk_reward': round(risk_reward, 2),
        'rr_valid': risk_reward >= 1.5,
        'entry_price': entry_price,
        'stop_method': stop_method,
        'target_method': target_method,
        'atr_14': atr or 0,
        'support_level': support or 0,
        'resistance_level': resistance or 0,
        'swing_low': low_30d or 0,
        'swing_high': high_30d or 0,
        'candlestick_context': '',
        'candlestick_pattern': candlestick_pattern or '',
        'exit_score': 0,
        'exit_signals': [],
        'entry_signals': [],
        'recommendation': '',
        'zone': zone or 'middle',
    }


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def analyze_stock_quick(
    ticker: str,
    current_price: float,
    price_change_24h: float = 0,
    volume_ratio: float = 1.0,
    rsi: float = 50,
    support: float = None,
    resistance: float = None,
    volatility: float = 3.0,
) -> dict:
    """
    تحليل سريع لسهم
    
    للـ endpoints اللي مش عندها كل البيانات
    """
    # Calculate technical score (simplified)
    technical_score = 50
    
    # Adjust for price change
    if price_change_24h < -5:
        technical_score += 15
    elif price_change_24h < -3:
        technical_score += 8
    elif price_change_24h > 5:
        technical_score -= 10
    elif price_change_24h > 3:
        technical_score -= 5
    
    # Adjust for volume
    if volume_ratio > 2:
        technical_score += 10
    elif volume_ratio > 1.5:
        technical_score += 5
    elif volume_ratio < 0.5:
        technical_score -= 10
    
    # Adjust for RSI
    if rsi < 30:
        technical_score += 15
    elif rsi < 40:
        technical_score += 8
    elif rsi > 70:
        technical_score -= 15
    elif rsi > 60:
        technical_score -= 8
    
    # Clamp
    technical_score = max(10, min(90, technical_score))
    
    # Use simplified scores for other components
    fundamental_score = 50
    timing_score = 50
    pattern_score = 50
    market_regime_score = 50
    
    # Calculate enhanced score
    master_score = calculate_enhanced_score(
        technical_score=technical_score,
        fundamental_score=fundamental_score,
        timing_score=timing_score,
        pattern_score=pattern_score,
        market_regime_score=market_regime_score,
        price_change_24h=price_change_24h,
        volume_ratio=volume_ratio,
        rsi=rsi,
    )
    
    # Get signal
    signal, signal_ar = get_signal_from_score(master_score)
    
    # Calculate target/stop
    risk = calculate_real_target_stop(
        entry_price=current_price,
        score=master_score,
        support=support,
        resistance=resistance,
        volatility=volatility,
    )
    
    return {
        'ticker': ticker,
        'signal': signal,
        'signal_ar': signal_ar,
        'master_score': master_score,
        'confidence': min(50 + abs(master_score - 50), 95),
        **risk,
        'timestamp': __import__('datetime').datetime.now().isoformat(),
    }

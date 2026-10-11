"""
Gate Analysis Engine (Python=Brain canonical — P1-PARALLEL-ENGINES-FIX 2026-10-12)
===================================================================================

Replaces:
  - src/lib/gate-analyzer.ts (1066 LOC) — the 5-gate analysis engine
  - src/lib/dynamic-analysis-engine.ts (969 LOC) — the BB-squeeze + dynamic
    parameter matrix engine (only `detectBBSqueeze()` was imported by
    gate-analyzer; the rest of dynamic-analysis-engine was already orphan).

Per Rule 20 (Python=Brain) + Rule 28 (NO-DUPLICATION) + Rule 67
(CALCULATION-CANONICAL): all analysis logic lives in Python. The Node route
is now a pure proxy (`src/app/api/stocks/[ticker]/gate-analysis/route.ts`).

This module is a 1:1 port of the TypeScript engines. It uses the canonical
Python MarketProfile from `config.unified_config.MARKET_PROFILES` for the
per-market thresholds (RSI zones, min price floor, min_rr, etc.).

Output shape matches `GateAnalysisOutput` (TypeScript interface) so callers
(`GateAnalysisView.tsx`) don't need to change.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional


# ─── MarketProfile accessor (canonical Python — Rule 20) ──────────────────
def _get_market_profile(market_code: Optional[str]) -> Dict[str, Any]:
    """Return a dict-shaped MarketProfile for the given market (default: EGX).

    Mirrors the TS-side `getMarketProfile(market)` exactly. Returns a plain
    dict so callers can use `.get('field')` style without dataclass imports.
    """
    if not market_code:
        market_code = 'EGX'
    market_code = str(market_code).strip().upper()

    try:
        from config.unified_config import MARKET_PROFILES
        mp = MARKET_PROFILES.get(market_code) or MARKET_PROFILES.get('EGX')
        if mp is None:
            raise KeyError("no profile")
        return {
            'market_code': mp.market_code,
            'market_name': mp.market_name,
            'market_name_ar': mp.market_name_ar,
            'currency': mp.currency,
            'min_rr': float(mp.min_rr),
            'target_min_pct': float(mp.target_min_pct),
            'stop_max_pct': float(mp.stop_max_pct),
            'rsi_overbought': float(mp.rsi_overbought),
            'rsi_oversold': float(mp.rsi_oversold),
            'min_volume_filter': int(getattr(mp, 'min_volume_filter', 0) or 0),
            'min_price': float(getattr(mp, 'min_price', 0.5) or 0.5),
            'stop_atr_mult': float(getattr(mp, 'stop_atr_mult', 2.0) or 2.0),
        }
    except Exception:
        return {
            'market_code': market_code,
            'market_name': 'Egyptian Exchange',
            'market_name_ar': 'البورصة المصرية',
            'currency': 'EGP',
            'min_rr': 1.8,
            'target_min_pct': 2.5,
            'stop_max_pct': 7.0,
            'rsi_overbought': 70.0,
            'rsi_oversold': 30.0,
            'min_volume_filter': 1_000_000,
            'min_price': 0.5,
            'stop_atr_mult': 2.0,
        }


def _market_name_ar(market_code: Optional[str]) -> str:
    return _get_market_profile(market_code)['market_name_ar']


# ─── Input shape (matches GateAnalysisInput from TS) ─────────────────────
class GateAnalysisInput(dict):
    """Dict-typed input — accepts all GateAnalysisInput fields.

    Field set (mirrors the TS interface exactly):
      close, open, high, low, volume, avgVolume20, rsi,
      macdLine, signalLine, macdHist, atr,
      sma20, sma50, sma200,
      support1, support2, resistance1, resistance2,
      sectorPerformance (optional), bollingerWidthPct (optional),
      market (optional — used for MarketProfile lookup),
      bollingerWidthHistory (optional list).
    """
    pass


# ─── Regime config (matches RegimeConfig TS interface) ───────────────────
def _get_regime_config(trend_bull: bool, trend_bear: bool, trend_range: bool,
                       profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Returns the regime-dependent configuration based on trend detection."""
    mp = profile or _get_market_profile(None)
    base_volume = round(mp['min_volume_filter'] * 0.4) if mp['min_volume_filter'] > 0 else 50_000

    if trend_bull:
        return {
            'minVolumeThreshold': base_volume,
            'supportZonePct': 2.5,
            'resistanceZonePct': 3.0,
            'rsiBuyThreshold': max(20, mp['rsi_oversold'] - 5),
            'rsiSellThreshold': min(95, mp['rsi_overbought'] + 5),
            'minRrThreshold': mp['min_rr'],
            'minGates': 4,
            'confirmationStrict': False,
        }
    if trend_bear:
        return {
            'minVolumeThreshold': round(base_volume * 1.5),
            'supportZonePct': 1.5,
            'resistanceZonePct': 2.0,
            'rsiBuyThreshold': max(15, mp['rsi_oversold'] - 10),
            'rsiSellThreshold': min(90, mp['rsi_overbought'] - 5),
            'minRrThreshold': mp['min_rr'] + 0.5,
            'minGates': 5,
            'confirmationStrict': True,
        }
    # Range
    return {
        'minVolumeThreshold': round(base_volume * 1.25),
        'supportZonePct': 2.0,
        'resistanceZonePct': 2.5,
        'rsiBuyThreshold': max(18, mp['rsi_oversold'] - 8),
        'rsiSellThreshold': min(92, mp['rsi_overbought'] + 2),
        'minRrThreshold': mp['min_rr'] + 0.3,
        'minGates': 4,
        'confirmationStrict': True,
    }


# ─── Market stage (6 stages with Arabic labels) ──────────────────────────
def _get_market_stage(close: float, sma20: float, sma50: float, sma200: float,
                      trend_bull: bool, trend_bear: bool, trend_range: bool) -> Dict[str, Any]:
    if trend_bull and close > sma200:
        return {'stage': 'Strong Bull', 'stageAr': 'صاعد قوي',
                'refinedBull': True, 'refinedBear': False, 'refinedRange': False}
    if trend_bull and close <= sma200:
        return {'stage': 'Weak Bull / Correction', 'stageAr': 'تصحيح صاعد',
                'refinedBull': True, 'refinedBear': False, 'refinedRange': False}
    if trend_bear and close < sma200:
        return {'stage': 'Strong Bear', 'stageAr': 'هابط قوي',
                'refinedBull': False, 'refinedBear': True, 'refinedRange': False}
    if trend_bear and close >= sma200:
        return {'stage': 'Weak Bear', 'stageAr': 'هابط ضعيف',
                'refinedBull': False, 'refinedBear': True, 'refinedRange': False}
    # Range (or fallback)
    return {'stage': 'Range', 'stageAr': 'عرضي',
            'refinedBull': False, 'refinedBear': False, 'refinedRange': True}


# ─── Number formatting helpers ────────────────────────────────────────────
def _fmt_int(n: int) -> str:
    """Locale-aware integer formatting (TS uses toLocaleString)."""
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return str(n)


def _fmt_float(n: float, decimals: int = 2) -> str:
    try:
        return f"{float(n):.{decimals}f}"
    except (TypeError, ValueError):
        return "0.00"


# ─── Gate implementations ─────────────────────────────────────────────────
def _evaluate_gate1(inp: Dict[str, Any], config: Dict[str, Any],
                    min_price_floor: float = 1.0) -> Dict[str, Any]:
    """Gate 1 — Liquidity."""
    volume = float(inp.get('volume', 0) or 0)
    close = float(inp.get('close', 0) or 0)
    threshold = config['minVolumeThreshold']
    passed = volume > threshold and close > min_price_floor
    if passed:
        reason = (f"Volume {_fmt_int(int(volume))} > {_fmt_int(int(threshold))} threshold, "
                  f"price {_fmt_float(close)} > {min_price_floor}")
        reason_ar = (f"الحجم {_fmt_int(int(volume))} أعلى من الحد {_fmt_int(int(threshold))}، "
                     f"السعر {_fmt_float(close)}")
    else:
        vol_part = (f"≤ {_fmt_int(int(threshold))} threshold"
                    if volume <= threshold else "OK")
        price_part = (f", price {_fmt_float(close)} ≤ {min_price_floor}"
                      if close <= min_price_floor else "")
        reason = f"Volume {_fmt_int(int(volume))} {vol_part}{price_part}"
        reason_ar = f"الحجم {_fmt_int(int(volume))} أقل من الحد {_fmt_int(int(threshold))}"
    return {'passed': passed, 'name': 'Liquidity', 'nameAr': 'السيولة',
            'reason': reason, 'reasonAr': reason_ar}


def _evaluate_gate2(inp: Dict[str, Any], trend_bull: bool, trend_bear: bool,
                    trend_range: bool, persona: str) -> Dict[str, Any]:
    """Gate 2 — Trend."""
    if persona == 'gambler':
        passed = not trend_bear
        if passed:
            reason = ('Gambler: Bull trend accepted (close > SMA20 > SMA50)' if trend_bull
                      else 'Gambler: Range trend accepted (not bearish)')
        else:
            reason = 'Gambler: Bear trend rejected (close < SMA20 < SMA50)'
    else:
        passed = trend_bull
        if passed:
            reason = 'Investor: Bull trend confirmed (close > SMA20 > SMA50)'
        elif trend_bear:
            reason = 'Investor: Bear trend — not accepted'
        else:
            reason = 'Investor: Range — bull trend required'

    if passed:
        if persona == 'gambler':
            reason_ar = 'المضارب: الاتجاه مقبول'
        else:
            reason_ar = 'المستثمر: الاتجاه الصاعد مؤكد'
    else:
        if persona == 'gambler':
            reason_ar = 'المضارب: الاتجاه الهابط مرفوض'
        else:
            reason_ar = 'المستثمر: يتطلب اتجاه صاعد'

    return {'passed': passed, 'name': 'Trend', 'nameAr': 'الاتجاه',
            'reason': reason, 'reasonAr': reason_ar}


def _evaluate_gate3_proximity(inp: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Gate 3 — Support/Resistance proximity (returns gate + proximity flags)."""
    close = float(inp.get('close', 0) or 0)
    s1 = float(inp.get('support1', 0) or 0)
    s2 = float(inp.get('support2', 0) or 0)
    r1 = float(inp.get('resistance1', 0) or 0)
    r2 = float(inp.get('resistance2', 0) or 0)

    supports = [s for s in [s1, s2] if s > 0 and s < close]
    nearest_support = max(supports) if supports else 0
    resistances = [r for r in [r1, r2] if r > 0 and r > close]
    nearest_resistance = min(resistances) if resistances else 0

    dist_to_support = ((close - nearest_support) / close * 100.0) if nearest_support > 0 else 999.0
    dist_to_resistance = ((nearest_resistance - close) / close * 100.0) if nearest_resistance > 0 else 999.0

    near_support = dist_to_support < config['supportZonePct']
    near_resistance = dist_to_resistance < config['resistanceZonePct']
    passed = near_support and not near_resistance

    if passed:
        reason = (f"Near support ({dist_to_support:.1f}% < {config['supportZonePct']}%), "
                  f"away from resistance ({dist_to_resistance:.1f}%)")
        reason_ar = f"قريب من الدعم ({dist_to_support:.1f}%)، بعيد عن المقاومة"
    elif near_resistance:
        reason = (f"Near resistance ({dist_to_resistance:.1f}% < {config['resistanceZonePct']}%) "
                  f"— too close to sell zone")
        reason_ar = f"قريب من المقاومة ({dist_to_resistance:.1f}%)"
    else:
        reason = f"Far from support ({dist_to_support:.1f}% ≥ {config['supportZonePct']}%)"
        reason_ar = f"بعيد عن الدعم ({dist_to_support:.1f}%)"

    return {
        'gate': {'passed': passed, 'name': 'Support/Resistance',
                 'nameAr': 'الدعم/المقاومة',
                 'reason': reason, 'reasonAr': reason_ar},
        'nearestSupport': nearest_support,
        'nearestResistance': nearest_resistance,
        'distanceToSupportPct': dist_to_support,
        'distanceToResistancePct': dist_to_resistance,
        'nearSupport': near_support,
        'nearResistance': near_resistance,
    }


def _evaluate_gate4(inp: Dict[str, Any], config: Dict[str, Any],
                    nearest_support: float, nearest_resistance: float) -> Dict[str, Any]:
    """Gate 4 — Risk/Reward (dynamic ATR-based)."""
    close = float(inp.get('close', 0) or 0)
    atr = float(inp.get('atr', 0) or 0)

    atr_pct = (atr / close * 100.0) if close > 0 else 0.0

    if atr_pct > 5:
        atr_target_mult, atr_stop_mult = 1.5, 1.0
    elif atr_pct >= 2:
        atr_target_mult, atr_stop_mult = 2.0, 1.5
    else:
        atr_target_mult, atr_stop_mult = 2.5, 2.0

    min_target_pct = 1.5
    min_stop_pct = 0.8
    atr_target_pct = max((atr_pct * atr_target_mult) / 100.0, min_target_pct / 100.0)
    atr_stop_pct = max((atr_pct * atr_stop_mult) / 100.0, min_stop_pct / 100.0)

    target_price = close * (1 + atr_target_pct)
    stop_loss = close * (1 - atr_stop_pct)

    if nearest_resistance > 0 and nearest_resistance < target_price:
        target_price = nearest_resistance
    if nearest_support > 0 and nearest_support > stop_loss and nearest_support < close:
        stop_loss = nearest_support

    target_price = max(target_price, close * 1.001)
    stop_loss = min(stop_loss, close * 0.999)

    target_pct = ((target_price - close) / close) * 100.0 if close > 0 else 0.0
    stop_pct = ((close - stop_loss) / close) * 100.0 if close > 0 else 0.0
    rr_ratio = target_pct / stop_pct if stop_pct > 0 else 0.0

    passed = rr_ratio >= config['minRrThreshold']

    if passed:
        reason = (f"R/R {rr_ratio:.2f} ≥ {config['minRrThreshold']} "
                  f"(target +{target_pct:.1f}%, stop -{stop_pct:.1f}%)")
        reason_ar = f"نسبة {rr_ratio:.2f} أعلى من الحد {config['minRrThreshold']}"
    else:
        reason = (f"R/R {rr_ratio:.2f} < {config['minRrThreshold']} "
                  f"(target +{target_pct:.1f}%, stop -{stop_pct:.1f}%)")
        reason_ar = f"نسبة {rr_ratio:.2f} أقل من الحد {config['minRrThreshold']}"

    return {
        'gate': {'passed': passed, 'name': 'Risk/Reward',
                 'nameAr': 'نسبة المخاطرة/العائد',
                 'reason': reason, 'reasonAr': reason_ar},
        'entryPrice': close,
        'targetPrice': target_price,
        'stopLoss': stop_loss,
        'targetPct': target_pct,
        'stopPct': stop_pct,
        'rrRatio': rr_ratio,
        'atrPct': atr_pct,
    }


def _evaluate_gate5(inp: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Gate 5 — Confirmation."""
    macd_line = float(inp.get('macdLine', 0) or 0)
    signal_line = float(inp.get('signalLine', 0) or 0)
    rsi = float(inp.get('rsi', 0) or 0)
    volume = float(inp.get('volume', 0) or 0)
    avg_vol = float(inp.get('avgVolume20', 0) or 0)

    macd_bullish = macd_line > signal_line
    rsi_in_range = rsi < config['rsiSellThreshold']
    volume_confirmed = volume > avg_vol * 1.2

    if config['confirmationStrict']:
        passed = macd_bullish and rsi_in_range and volume_confirmed
    else:
        passed = macd_bullish and (rsi_in_range or volume_confirmed)

    conditions: List[str] = []
    conditions.append('MACD bullish' if macd_bullish else 'MACD bearish')
    conditions.append((f"RSI {rsi:.1f} < {config['rsiSellThreshold']}")
                       if rsi_in_range else (f"RSI {rsi:.1f} ≥ {config['rsiSellThreshold']}"))
    conditions.append('Volume > 1.2× avg' if volume_confirmed else 'Volume ≤ 1.2× avg')

    mode = 'strict' if config['confirmationStrict'] else 'relaxed'
    if passed:
        reason = f"Confirmed: {', '.join(conditions)} [{mode} mode]"
        reason_ar = 'مؤكد: ' + '، '.join(
            'MACD صاعد' if c.startswith('MACD bullish')
            else 'RSI في النطاق' if c.startswith('RSI')
            else 'حجم مرتفع' if c.startswith('Volume >')
            else c for c in conditions
        )
    else:
        reason = f"Failed: {', '.join(conditions)} [{mode} mode]"
        reason_ar = 'غير مؤكد: شروط غير مكتملة'

    return {'passed': passed, 'name': 'Confirmation', 'nameAr': 'التأكيد',
            'reason': reason, 'reasonAr': reason_ar}


# ─── Signal determination (priority chain — exact Pine order) ─────────────
def _determine_signal(ctx: Dict[str, Any]) -> Dict[str, Any]:
    inp = ctx['input']
    config = ctx['config']

    # 1. R/R ≤ 0 → AVOID
    if ctx['rrRatio'] <= 0:
        return {'signal': 'AVOID', 'signalAr': 'تجنب', 'signalColor': 'bg-gray-500',
                'narrative': (f"نسبة المخاطرة/العائد غير صالحة ({ctx['rrRatio']:.2f}). "
                              "تجنب هذا السهم.")}

    # 2. R/R < 1.0 → WAIT
    if ctx['rrRatio'] < 1.0:
        return {'signal': 'WAIT', 'signalAr': 'انتظر', 'signalColor': 'bg-yellow-500',
                'narrative': (f"نسبة المخاطرة/العائد {ctx['rrRatio']:.2f} أقل من 1.0. "
                              "المخاطرة أعلى من العائد المتوقع. انتظر تحسن الظروف.")}

    # 3. Near resistance → WAIT (or BUY if bull breakout with volume)
    if ctx['nearResistance'] and not ctx['nearSupport']:
        if ctx['trendBull'] and ctx['macdBullish'] and ctx['volumeRatio'] > 1.5:
            return {'signal': 'BUY', 'signalAr': 'شراء', 'signalColor': 'bg-green-500',
                    'narrative': 'قريب من المقاومة لكن مع اتجاه صاعد قوي وكسر محتمل بحجم مرتفع. يمكن الشراء مع مراقبة المقاومة.'}
        return {'signal': 'WAIT', 'signalAr': 'انتظر', 'signalColor': 'bg-yellow-500',
                'narrative': (f"السهم قريب من المقاومة ({ctx['distanceToResistancePct']:.1f}%) "
                              "وليس قرب الدعم. انتظر تراجعاً للدعم أو كسر المقاومة.")}

    # 4. Break support × 0.98 + below SMA20 → SELL
    close = float(inp.get('close', 0) or 0)
    sma20 = float(inp.get('sma20', 0) or 0)
    if ctx['nearestSupport'] > 0 and close < ctx['nearestSupport'] * 0.98 and close < sma20:
        return {'signal': 'SELL', 'signalAr': 'بيع', 'signalColor': 'bg-red-500',
                'narrative': (f"كسر الدعم الرئيسي (أقل من {ctx['nearestSupport']:.2f} × 0.98) "
                              "وأسفل المتوسط 20. إشارة بيع واضحة.")}

    # 5. RSI > 75 + above SMA20 + negative MACD hist → SELL_STRONG
    rsi = float(inp.get('rsi', 0) or 0)
    macd_hist = float(inp.get('macdHist', 0) or 0)
    if rsi > 75 and close > sma20 and macd_hist < 0:
        return {'signal': 'SELL_STRONG', 'signalAr': 'بيع قوي', 'signalColor': 'bg-red-700',
                'narrative': (f"RSI عند {rsi:.1f} (تشبع شرائي) + فوق SMA20 + MACD سالب. "
                              "إشارة بيع قوية — توقف خسارة فوري.")}

    # 6. RSI > 65 + above SMA20 + volume > 2× avg → SELL
    if rsi > 65 and close > sma20 and ctx['volumeRatio'] > 2.0:
        return {'signal': 'SELL', 'signalAr': 'بيع', 'signalColor': 'bg-red-500',
                'narrative': (f"RSI عند {rsi:.1f} (مرتفع) + حجم مرتفع جداً "
                              f"({ctx['volumeRatio']:.1f}× المتوسط). إشارة بيع.")}

    # 7. 5/5 gates + R/R ≥ 2.0 → BUY_STRONG
    if ctx['gatesPassed'] == 5 and ctx['rrRatio'] >= 2.0:
        return {'signal': 'BUY_STRONG', 'signalAr': 'شراء قوي', 'signalColor': 'bg-emerald-600',
                'narrative': (f"جميع البوابات الخمس مكتملة + نسبة عائد/مخاطرة {ctx['rrRatio']:.2f} ≥ 2.0. "
                              f"فرصة شراء قوية! الهدف {ctx['targetPrice']:.2f} (+{ctx['targetPct']:.1f}%)، "
                              f"وقف الخسارة {ctx['stopLoss']:.2f} (-{ctx['stopPct']:.1f}%).")}

    # 8. min_gates passed + R/R ≥ threshold → BUY
    if ctx['gatesPassed'] >= ctx['minGates'] and ctx['rrRatio'] >= config['minRrThreshold']:
        return {'signal': 'BUY', 'signalAr': 'شراء', 'signalColor': 'bg-green-500',
                'narrative': (f"{ctx['gatesPassed']}/5 بوابات مكتملة + نسبة {ctx['rrRatio']:.2f} ≥ "
                              f"{config['minRrThreshold']}. إشارة شراء. الهدف "
                              f"{ctx['targetPrice']:.2f} (+{ctx['targetPct']:.1f}%).")}

    # 9. RSI < 25 + near support + volume > 1.5× + MACD rising → BUY_CONTRARIAN
    macd_line = float(inp.get('macdLine', 0) or 0)
    signal_line = float(inp.get('signalLine', 0) or 0)
    if (rsi < 25 and ctx['nearSupport'] and ctx['volumeRatio'] > 1.5):
        hist_rising = macd_hist > 0 or macd_line > signal_line
        if hist_rising:
            return {'signal': 'BUY_CONTRARIAN', 'signalAr': 'شراء عكسي',
                    'signalColor': 'bg-amber-500',
                    'narrative': (f"RSI عند {rsi:.1f} (تشبع بيعي شديد) + قرب الدعم + حجم مرتفع + "
                                  "MACD يتحسن. فرصة شراء عكسية للمضاربين.")}

    # 10. 2+ gates + < min_gates + near support + R/R ≥ 1.0 → ACCUMULATE
    if (ctx['gatesPassed'] >= 2 and ctx['gatesPassed'] < ctx['minGates']
            and ctx['nearSupport'] and ctx['rrRatio'] >= 1.0):
        return {'signal': 'ACCUMULATE', 'signalAr': 'تجميع', 'signalColor': 'bg-primary',
                'narrative': (f"{ctx['gatesPassed']}/5 بوابات مكتملة (أقل من المطلوب {ctx['minGates']}) "
                              f"لكن قرب الدعم ونسبة {ctx['rrRatio']:.2f} مقبولة. يمكن التجميع التدريجي.")}

    # 11. Default → WAIT
    return {'signal': 'WAIT', 'signalAr': 'انتظر', 'signalColor': 'bg-yellow-500',
            'narrative': (f"الشروط غير مكتملة ({ctx['gatesPassed']}/5 بوابات، "
                          f"R/R {ctx['rrRatio']:.2f}). انتظر تأكيد أقوى قبل الدخول.")}


# ─── Stock strength + market proxy ────────────────────────────────────────
def _compute_stock_strength(inp: Dict[str, Any], sector_performance: Optional[float] = None,
                            market_label: Optional[str] = None) -> Dict[str, Any]:
    """Simple strength scoring — mirrors TS computeStockStrength."""
    close = float(inp.get('close', 0) or 0)
    rsi = float(inp.get('rsi', 0) or 0)
    macd_line = float(inp.get('macdLine', 0) or 0)
    signal_line = float(inp.get('signalLine', 0) or 0)
    sma20 = float(inp.get('sma20', 0) or 0)
    sma50 = float(inp.get('sma50', 0) or 0)

    score = 50  # neutral base

    if rsi > 50:
        score += min((rsi - 50) / 2.0, 25)
    else:
        score -= min((50 - rsi) / 2.0, 25)

    if macd_line > signal_line:
        score += 15
    else:
        score -= 15

    if close > sma20:
        score += 5
    else:
        score -= 5
    if sma20 > sma50:
        score += 5
    else:
        score -= 5

    score = max(0, min(100, score))

    market_ar = market_label or _market_name_ar(None)
    proxy = 'EGX Market' if market_ar == 'البورصة المصرية' else 'Market'
    proxy_ar = market_ar

    if sector_performance is not None:
        if sector_performance > 1:
            proxy, proxy_ar = 'Sector Leading', 'قطاع رائد'
        elif sector_performance < -1:
            proxy, proxy_ar = 'Sector Lagging', 'قطاع متأخر'
        else:
            proxy, proxy_ar = 'Sector Neutral', 'قطاع محايد'

    return {'strength': round(score), 'proxy': proxy, 'proxyAr': proxy_ar}


# ─── BB Squeeze detection (from dynamic-analysis-engine.ts) ─────────────
def _detect_bb_squeeze(bb_width_pct: Optional[float],
                        bb_width_history: Optional[List[float]] = None) -> Dict[str, Any]:
    """Detect Bollinger Band squeeze state.

    Formula (mirrors TS):
      BB Width = (4 * SD) / MA20 (as % of price)
      Squeeze = BB Width < avg(BB Width, 20 periods) * 0.6
    """
    empty = {'level': 'NONE', 'bbWidthPct': 0.0, 'bbWidthTrend': 'stable',
            'avgWidth20': 0.0, 'squeezeScore': 0,
            'descriptionAr': 'بيانات غير كافية'}
    if bb_width_pct is None or bb_width_pct <= 0:
        return empty

    history: List[float] = list(bb_width_history or []) or [bb_width_pct]
    avg_width = sum(history) / len(history)

    # Trend: compare recent 5 vs previous 10
    recent5 = history[-5:]
    prev10 = history[-15:-5]
    trend = 'stable'
    if recent5 and prev10:
        avg_recent = sum(recent5) / len(recent5)
        avg_prev = sum(prev10) / len(prev10)
        if avg_prev > 0:
            change = (avg_recent - avg_prev) / avg_prev
            if change < -0.15:
                trend = 'narrowing'
            elif change > 0.15:
                trend = 'widening'

    ratio = (bb_width_pct / avg_width) if avg_width > 0 else 1.0
    if ratio < 0.4:
        level, score, desc = 'EXTREME_SQUEEZE', 95, 'انضغاط بولنجر شديد — انفجار سعري وشيك جداً'
    elif ratio < 0.6:
        level, score, desc = 'SQUEEZE', 75, 'انضغاط بولنجر — احتمال حركة قوية قريبة'
    elif ratio < 0.8 and trend == 'narrowing':
        level, score, desc = 'NARROWING', 50, 'النطاق بيتضيق تدريجياً — راقب الكسر'
    else:
        level = 'NONE'
        score = round(max(0.0, (1 - ratio) * 50))
        desc = 'لا يوجد انضغاط'

    if trend == 'narrowing' and level != 'NONE':
        score = min(100, score + 10)

    return {
        'level': level,
        'bbWidthPct': round(bb_width_pct * 100) / 100,
        'bbWidthTrend': trend,
        'avgWidth20': round(avg_width * 100) / 100,
        'squeezeScore': score,
        'descriptionAr': desc,
    }


# ─── MAIN: analyze_gates ──────────────────────────────────────────────────
def analyze_gates(input_data: Dict[str, Any], persona: str = 'gambler') -> Dict[str, Any]:
    """1:1 port of `analyzeGates(input, persona)` from gate-analyzer.ts.

    Args:
        input_data: dict with GateAnalysisInput fields.
        persona: 'gambler' (aggressive) or 'investor' (conservative).

    Returns: dict matching GateAnalysisOutput shape.
    """
    if persona not in ('gambler', 'investor'):
        persona = 'gambler'

    # ARCH-OPTION-2: load MarketProfile
    market_profile = _get_market_profile(input_data.get('market'))

    # Step 1: Detect trend
    close = float(input_data.get('close', 0) or 0)
    sma20 = float(input_data.get('sma20', 0) or 0)
    sma50 = float(input_data.get('sma50', 0) or 0)
    sma200 = float(input_data.get('sma200', 0) or 0)

    trend_bull = close > sma20 and sma20 > sma50
    trend_bear = close < sma20 and sma20 < sma50
    trend_range = not trend_bull and not trend_bear

    # Step 2: Regime config
    config = _get_regime_config(trend_bull, trend_bear, trend_range, market_profile)

    # Step 3: Market stage
    market_stage_info = _get_market_stage(close, sma20, sma50, sma200,
                                          trend_bull, trend_bear, trend_range)
    market_stage = market_stage_info['stage']
    market_stage_ar = market_stage_info['stageAr']

    # Step 4: Support/Resistance proximity (Gate 3 needs it)
    sr_proximity = _evaluate_gate3_proximity(input_data, config)
    nearest_support = sr_proximity['nearestSupport']
    nearest_resistance = sr_proximity['nearestResistance']
    near_support = sr_proximity['nearSupport']
    near_resistance = sr_proximity['nearResistance']
    dist_to_support = sr_proximity['distanceToSupportPct']
    dist_to_resistance = sr_proximity['distanceToResistancePct']

    # Step 5: Evaluate all 5 gates
    gate1 = _evaluate_gate1(input_data, config, market_profile['min_price'])
    gate2 = _evaluate_gate2(input_data, trend_bull, trend_bear, trend_range, persona)
    gate3 = sr_proximity['gate']
    gate4_result = _evaluate_gate4(input_data, config, nearest_support, nearest_resistance)
    gate4 = gate4_result['gate']
    gate5 = _evaluate_gate5(input_data, config)

    gates = [gate1, gate2, gate3, gate4, gate5]
    gates_passed = sum(1 for g in gates if g['passed'])

    # Step 6: Volume ratio
    avg_volume = float(input_data.get('avgVolume20', 0) or 0)
    volume = float(input_data.get('volume', 0) or 0)
    volume_ratio = (volume / avg_volume) if avg_volume > 0 else 0

    # Step 7: MACD bullish flag
    macd_line = float(input_data.get('macdLine', 0) or 0)
    signal_line = float(input_data.get('signalLine', 0) or 0)
    macd_bullish = macd_line > signal_line

    # Step 8: Determine signal
    signal_ctx = {
        'input': input_data, 'config': config,
        'gatesPassed': gates_passed, 'minGates': config['minGates'],
        'rrRatio': gate4_result['rrRatio'],
        'trendBull': trend_bull, 'trendBear': trend_bear, 'trendRange': trend_range,
        'nearSupport': near_support, 'nearResistance': near_resistance,
        'distanceToSupportPct': dist_to_support,
        'distanceToResistancePct': dist_to_resistance,
        'nearestSupport': nearest_support,
        'macdBullish': macd_bullish,
        'volumeRatio': volume_ratio,
        'targetPrice': gate4_result['targetPrice'],
        'stopLoss': gate4_result['stopLoss'],
        'targetPct': gate4_result['targetPct'],
        'stopPct': gate4_result['stopPct'],
        'atrPct': gate4_result['atrPct'],
        'marketStage': market_stage, 'marketStageAr': market_stage_ar,
        'persona': persona,
    }
    signal_result = _determine_signal(signal_ctx)

    # Step 9: Stock strength & market proxy
    sector_perf = input_data.get('sectorPerformance')
    sector_perf = float(sector_perf) if sector_perf is not None else None
    strength_info = _compute_stock_strength(input_data, sector_perf, market_profile['market_name_ar'])

    # Step 9.5: BB Squeeze bonus
    squeeze_result = None
    squeeze_bonus_applied = False
    if input_data.get('bollingerWidthPct') is not None:
        bb_history = input_data.get('bollingerWidthHistory') or []
        squeeze_result = _detect_bb_squeeze(
            float(input_data.get('bollingerWidthPct') or 0),
            list(bb_history) if bb_history else None,
        )
        if squeeze_result['level'] in ('SQUEEZE', 'EXTREME_SQUEEZE'):
            effective_min_gates = max(2, config['minGates'] - 1)
            if effective_min_gates < config['minGates']:
                squeeze_bonus_applied = True
                # Re-evaluate: if we now pass the lowered bar, upgrade WAIT signals
                if (gates_passed >= effective_min_gates
                        and signal_result['signal'] == 'WAIT'
                        and trend_bull and volume_ratio > 1.2):
                    signal_result['signal'] = 'BUY'
                    signal_result['signalAr'] = 'شراء (انضغاط بولنجر + حجم)'
                    signal_result['signalColor'] = 'bg-emerald-500/20 text-emerald-400'
                    signal_result['narrative'] += (
                        f"\n\n⚡ BB Squeeze active (score: {squeeze_result['squeezeScore']}) — "
                        "explosive move expected. Volume confirming direction."
                    )

    # Step 10: Assemble output
    return {
        'signal': signal_result['signal'],
        'signalAr': signal_result['signalAr'],
        'signalColor': signal_result['signalColor'],

        'marketStage': market_stage,
        'marketStageAr': market_stage_ar,
        'trendBull': trend_bull,
        'trendBear': trend_bear,
        'trendRange': trend_range,

        'gates': gates,
        'gatesPassed': gates_passed,
        'minGates': max(2, config['minGates'] - 1) if squeeze_bonus_applied else config['minGates'],

        'entryPrice': gate4_result['entryPrice'],
        'targetPrice': gate4_result['targetPrice'],
        'stopLoss': gate4_result['stopLoss'],
        'targetPct': gate4_result['targetPct'],
        'stopPct': gate4_result['stopPct'],
        'rrRatio': gate4_result['rrRatio'],

        'rsiBuyThreshold': config['rsiBuyThreshold'],
        'rsiSellThreshold': config['rsiSellThreshold'],
        'minRrThreshold': config['minRrThreshold'],
        'atrPct': gate4_result['atrPct'],

        'volumeRatio': volume_ratio,

        'stockStrength': strength_info['strength'],
        'marketProxy': strength_info['proxy'],
        'marketProxyAr': strength_info['proxyAr'],

        'narrative': signal_result['narrative'],

        'persona': persona,

        'bbSqueeze': ({
            'level': squeeze_result['level'],
            'bbWidthPct': squeeze_result['bbWidthPct'],
            'bbWidthTrend': squeeze_result['bbWidthTrend'],
            'squeezeScore': squeeze_result['squeezeScore'],
            'descriptionAr': squeeze_result['descriptionAr'],
        } if squeeze_result else None),
        'squeezeBonusApplied': squeeze_bonus_applied,
    }

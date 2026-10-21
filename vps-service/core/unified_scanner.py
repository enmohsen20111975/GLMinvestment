"""
core/unified_scanner.py — محرك الفحص الموحد (Unified Scanner Engine)
=====================================================================
**BRAVO-SSOT-REFACTOR Stage 2**: محرك فحص واحد لكل الأسواق والتايم فريم.

يستقبل إعدادات ديناميكية (market + timeframe + strategy_config) ويرجع DataFrame.
السلوك الخاص بكل سوق (أوقات العمل، رموز الأسهم) من MARKET_PROFILES.

Usage:
    from core.unified_scanner import run_market_scanner
    results = run_market_scanner(
        market_name='EGX',
        timeframe='daily',
        strategy_config={'min_score': 50, 'min_rr': 1.5}
    )
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ScanConfig:
    """إعدادات الفحص الديناميكية."""
    market_name: str = 'EGX'
    timeframe: str = 'daily'  # daily, weekly, intraday
    min_score: float = 50.0
    min_rr: float = 1.5  # Rule: R/R >= 1.5
    max_picks: int = 5
    min_turnover_egp: float = 1_500_000  # Rule: liquidity filter
    max_volume_ratio: float = 15.0  # Rule: cap phantom volume
    fomo_spike_threshold: float = 4.0  # Rule: anti-FOMO
    min_atr_stop_pct: float = 5.0  # Rule 8: ATR stop [5%, 9%]
    max_atr_stop_pct: float = 9.0
    strategy: str = 'confluence'  # confluence, whale, pullback, trend
    extra_filters: Dict[str, Any] = field(default_factory=dict)


def run_market_scanner(
    market_name: str,
    timeframe: str = 'daily',
    strategy_config: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """محرك الفحص الموحد — يفحص سوق معين ويرجع النتائج.

    Args:
        market_name: اسم السوق (EGX, TADAWUL, KSE, QSE, CRYPTO, GOLD, US)
        timeframe: الإطار الزمني (daily, weekly, intraday)
        strategy_config: إعدادات الاستراتيجية (min_score, min_rr, etc.)

    Returns:
        List of stock results with signals + indicators + confluence proofs.
    """
    config = ScanConfig(
        market_name=market_name.upper(),
        timeframe=timeframe,
        **(strategy_config or {})
    )

    logger.info(f"[UnifiedScanner] market={config.market_name}, tf={config.timeframe}, strategy={config.strategy}")

    # 1. تحديد السوق + الـ tickers
    tickers = _get_market_tickers(config.market_name)
    if not tickers:
        logger.warning(f"[UnifiedScanner] no tickers for market={config.market_name}")
        return []

    # 2. فحص كل سهم
    results = []
    for ticker in tickers:
        try:
            result = _scan_single_stock(ticker, config)
            if result:
                results.append(result)
        except Exception as e:
            logger.debug(f"[UnifiedScanner] {ticker} error: {e}")

    # 3. فلترة + ترتيب
    filtered = _apply_filters(results, config)
    sorted_results = _sort_and_cap(filtered, config)

    logger.info(f"[UnifiedScanner] scanned={len(tickers)}, results={len(results)}, final={len(sorted_results)}")
    return sorted_results


def _get_market_tickers(market: str) -> List[str]:
    """احصل على قائمة tickers للسوق من DB المناسب."""
    import sqlite3
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[2]
    tickers = []

    db_map = {
        'EGX': ('db/stocks.db', "SELECT ticker FROM stocks WHERE is_active = 1 AND ticker NOT GLOB '[0-9]*'"),
        'TADAWUL': ('db/stocks.db', "SELECT ticker FROM stocks WHERE market = 'TADAWUL' AND is_active = 1"),
        'KSE': ('db/stocks.db', "SELECT ticker FROM stocks WHERE market = 'KSE' AND is_active = 1"),
        'QSE': ('db/stocks.db', "SELECT ticker FROM stocks WHERE market = 'QSE' AND is_active = 1"),
        'CRYPTO': ('db/data_engine.db', "SELECT symbol FROM crypto_prices GROUP BY symbol"),
        'GOLD': ('db/data_engine.db', "SELECT DISTINCT 'GOLD' as ticker"),  # single ticker
    }

    db_path, query = db_map.get(market, ('db/stocks.db', "SELECT ticker FROM stocks WHERE is_active = 1"))
    full_path = project_root / db_path

    if not full_path.exists():
        return []

    try:
        conn = sqlite3.connect(f"file:{full_path}?mode=ro", uri=True, timeout=5.0)
        rows = conn.execute(query).fetchall()
        conn.close()
        tickers = [r[0] for r in rows if r[0]]
    except Exception as e:
        logger.error(f"[UnifiedScanner] DB error: {e}")

    return tickers[:200]  # cap for performance


def _scan_single_stock(ticker: str, config: ScanConfig) -> Optional[Dict[str, Any]]:
    """فحص سهم واحد — يستخدم canonical indicators فقط (Rule 67)."""
    import sqlite3
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[2]

    # 1. قراءة بيانات السعر من price_history.db
    ph_db = project_root / 'db' / 'price_history.db'
    if not ph_db.exists():
        return None

    try:
        conn = sqlite3.connect(f"file:{ph_db}?mode=ro", uri=True, timeout=5.0)
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ?
            ORDER BY date DESC LIMIT 30
        """, (ticker,)).fetchall()
        conn.close()
    except Exception:
        return None

    if not rows or len(rows) < 15:
        return None

    # استخراج arrays
    closes = [r[4] or 0 for r in reversed(rows) if r[4]]
    highs = [r[2] or 0 for r in reversed(rows) if r[2]]
    lows = [r[3] or 0 for r in reversed(rows) if r[3]]
    volumes = [r[5] or 0 for r in reversed(rows) if r[5]]

    if len(closes) < 15:
        return None

    current_price = closes[-1]
    if current_price <= 0:
        return None

    # 2. حساب المؤشرات من canonical (Rule 67 — NO inline)
    import sys
    vps_root = str(project_root / 'vps-service')
    if vps_root not in sys.path:
        sys.path.insert(0, vps_root)

    from analyzers.indicators import (
        calc_rsi, calc_atr, calc_bollinger, calc_mfi, calc_adx, sma, ema, macd
    )

    rsi = calc_rsi(closes, 14)
    atr = calc_atr(highs, lows, closes, 14)
    bb = calc_bollinger(closes, 20, 2.0)
    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50) if len(closes) >= 50 else None
    ema12 = ema(closes, 12)
    macd_val = macd(closes)
    mfi = calc_mfi(highs, lows, closes, volumes, 14) if len(volumes) >= 15 else None
    adx = calc_adx(highs, lows, closes, 14) if len(closes) >= 28 else None

    # 3. حساب metrics إضافية
    chg_1d = ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) >= 2 and closes[-2] > 0 else 0
    vol_avg = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 1
    vol_ratio = min(volumes[-1] / vol_avg if vol_avg > 0 else 0, config.max_volume_ratio)
    close_pct = ((closes[-1] - min(lows[-10:])) / (max(highs[-10:]) - min(lows[-10:]) + 0.01)) * 100 if len(lows) >= 10 else 50
    support = min(lows[-20:]) if len(lows) >= 20 else min(lows)
    resistance = max(highs[-20:]) if len(highs) >= 20 else max(highs)
    dist_to_support = ((current_price - support) / support * 100) if support > 0 else 100
    dist_to_resistance = ((resistance - current_price) / current_price * 100) if current_price > 0 else 100

    # 4. Liquidity filter (Rule: turnover >= 1.5M)
    turnover = current_price * volumes[-1] if volumes else 0
    is_illiquid = turnover < config.min_turnover_egp

    # 5. Anti-FOMO (Rule: chg > 4% = pullback wait)
    is_fomo = chg_1d > config.fomo_spike_threshold

    # 6. ATR stop + target (Rule 8: [5%, 9%])
    atr_pct = (atr / current_price * 100) if atr and current_price > 0 else 0
    atr_pct = max(config.min_atr_stop_pct, min(config.max_atr_stop_pct, atr_pct))
    stop_loss = current_price * (1 - atr_pct / 100)
    target_price = current_price * (1 + atr_pct * 1.8 / 100)  # R/R = 1.8
    risk = current_price - stop_loss
    reward = target_price - current_price
    rr = round(reward / risk, 2) if risk > 0 else 0

    # 7. Confluence proofs
    proofs = 0
    reasons = []

    if vol_ratio >= 2.0 and chg_1d > 0:
        proofs += 1; reasons.append(f"vol_surge={vol_ratio:.1f}x")
    if vol_ratio >= 1.5 and close_pct >= 70:
        proofs += 1; reasons.append(f"accum={close_pct:.0f}%")
    if current_price >= resistance * 0.98 and chg_1d > 0:
        proofs += 1; reasons.append("breakout")
    if rsi and 40 <= rsi <= 60 and vol_ratio >= 1.2:
        proofs += 1; reasons.append(f"rsi_neutral={rsi:.0f}")
    if dist_to_support <= 3.0 and chg_1d > -1.0:
        proofs += 1; reasons.append(f"near_support={dist_to_support:.1f}%")

    # 8. Distribution veto
    dist_warn = 0
    if chg_1d < -2.0 and vol_ratio >= 1.5:
        dist_warn += 1
    if adx and adx['minus_di'] > adx['plus_di'] * 1.5:
        dist_warn += 1

    # 9. Decision
    if is_illiquid:
        signal, track = 'HOLD', 'ILLIQUID'
    elif dist_warn >= 2:
        signal, track = 'HOLD', 'DISTRIBUTION_VETO'
    elif rr < config.min_rr:
        signal, track = 'HOLD', 'LOW_RR'  # Rule: R/R >= 1.5
    elif is_fomo and proofs >= 2:
        signal, track = 'WATCH', 'PULLBACK_WAIT'
    elif proofs >= 3:
        signal, track = 'STRONG_BUY', 'WHALE_CONFLUENCE'
    elif proofs == 2:
        signal, track = 'BUY', 'CONFIRMED'
    elif proofs == 1:
        signal, track = 'WATCH', 'WEAK_PROOF'
    else:
        signal, track = 'HOLD', 'NO_PROOF'

    # 10. Score (0-100)
    score = min(100, proofs * 20 + (10 if rsi and 40 <= rsi <= 60 else 0) + (10 if vol_ratio >= 1.5 else 0))

    return {
        'ticker': ticker,
        'market': config.market_name,
        'timeframe': config.timeframe,
        'current_price': round(current_price, 2),
        'chg_1d': round(chg_1d, 2),
        'rsi': rsi,
        'atr': atr,
        'atr_pct': round(atr_pct, 2),
        'bollinger': bb,
        'sma20': sma20,
        'sma50': sma50,
        'macd': macd_val,
        'mfi': mfi,
        'adx': adx,
        'vol_ratio': round(vol_ratio, 2),
        'turnover': round(turnover, 0),
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'dist_to_support': round(dist_to_support, 2),
        'dist_to_resistance': round(dist_to_resistance, 2),
        'entry_price': round(current_price, 2),
        'stop_loss': round(stop_loss, 2),
        'target_price': round(target_price, 2),
        'risk_reward': rr,
        'proofs': proofs,
        'score': score,
        'signal': signal,
        'track': track,
        'reasons': reasons,
        'is_illiquid': is_illiquid,
        'is_fomo': is_fomo,
    }


def _apply_filters(results: List[Dict], config: ScanConfig) -> List[Dict]:
    """تطبيق الفلاتر الإلزامية."""
    filtered = []
    for r in results:
        # Rule: R/R >= 1.5 (except HOLD)
        if r['signal'] in ('BUY', 'STRONG_BUY') and r['risk_reward'] < config.min_rr:
            r['signal'] = 'HOLD'
            r['track'] = 'LOW_RR'
        # Rule: no illiquid stocks in BUY signals
        if r['is_illiquid'] and r['signal'] in ('BUY', 'STRONG_BUY'):
            r['signal'] = 'HOLD'
            r['track'] = 'ILLIQUID'
        # Rule: min_score
        if r['score'] < config.min_score and r['signal'] in ('BUY', 'STRONG_BUY'):
            r['signal'] = 'WATCH'
            r['track'] = 'LOW_SCORE'

        filtered.append(r)

    return filtered


def _sort_and_cap(results: List[Dict], config: ScanConfig) -> List[Dict]:
    """ترتيب + cap على عدد النتايج."""
    # ترتيب: BUY/STRONG_BUY الأول، ثم حسب proofs + score
    signal_priority = {'STRONG_BUY': 0, 'BUY': 1, 'WATCH': 2, 'HOLD': 3}
    results.sort(key=lambda r: (signal_priority.get(r['signal'], 4), -r['proofs'], -r['score']))
    return results[:config.max_picks]

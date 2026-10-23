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
    min_rr: float = 2.0  # BRAVO-URGENT: R/R >= 2.0 mandatory (was 1.5)
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
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(full_path, writable=False).__enter__()
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

    # 1. قراءة بيانات السعر — نجرّب price_history.db الأول، ثم stocks.db.stock_daily_prices
    ph_db = project_root / 'db' / 'price_history.db'
    rows = None
    if ph_db.exists():
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(ph_db, writable=False).__enter__()
            rows = conn.execute("""
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM price_history WHERE ticker = ?
                ORDER BY date DESC LIMIT 30
            """, (ticker,)).fetchall()
            conn.close()
        except Exception:
            pass

    # fallback: stocks.db.stock_daily_prices
    if not rows:
        stocks_db = project_root / 'db' / 'stocks.db'
        if stocks_db.exists():
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.connection(stocks_db, writable=False).__enter__()
                rows = conn.execute("""
                    SELECT price_date, open, high, low, close, volume
                    FROM stock_daily_prices WHERE ticker = ?
                    ORDER BY price_date DESC LIMIT 30
                """, (ticker,)).fetchall()
                conn.close()
            except Exception:
                pass

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

    # 3a. BRAVO-RVOL: قواعد RVOL النسبية الصارمة
    # ──────────────────────────────────────────────
    # ATR(5) vs ATR(20) للانكماش
    atr_5 = None
    atr_20 = None
    if len(closes) >= 21:
        tr_list = []
        for i in range(1, len(closes)):
            _h = highs[i]
            _l = lows[i]
            _pc = closes[i - 1]
            tr_list.append(max(_h - _l, abs(_h - _pc), abs(_l - _pc)))
        if len(tr_list) >= 5:
            atr_5 = sum(tr_list[-5:]) / 5
        if len(tr_list) >= 20:
            atr_20 = sum(tr_list[-20:]) / 20
    is_contracted = (atr_5 is not None and atr_20 is not None and atr_5 < atr_20)

    # تحديد الأسهم القيادية (turnover >= 50M = قيادي)
    turnover_now = current_price * volumes[-1] if volumes else 0
    is_large_cap = ticker in ('COMI', 'TMGH', 'ETEL', 'SWDY', 'HRHO', 'CIEB', 'HDBK', 'FWRY')

    # RVOL thresholds:
    # - Large caps: rvol <= 0.60 for dryness
    # - Small/mid caps: rvol <= 0.50 for dryness
    # - Explosion: rvol >= 1.80
    dryness_threshold = 0.60 if is_large_cap else 0.50
    explosion_threshold = 1.80
    is_dry = (vol_ratio <= dryness_threshold and is_contracted)
    is_explosion = (vol_ratio >= explosion_threshold)

    # Turnover gates:
    # - Min: 1.5M EGP
    # - Large caps: 3M EGP
    min_turnover = 3_000_000 if is_large_cap else config.min_turnover_egp
    turnover_ok = turnover_now >= min_turnover

    # Wick anatomy (from real_liquidity_radar logic)
    # rows format: (date, open, high, low, close, volume) — reversed = oldest first
    _last_row = rows[-1] if rows else None
    today_open = float(_last_row[1] if _last_row and len(_last_row) > 1 else 0) or 0
    today_high = highs[-1] if highs else 0
    today_low = lows[-1] if lows else 0
    today_close = closes[-1] if closes else 0
    range_hl = today_high - today_low + 1e-6
    upper_wick_pct = ((today_high - max(today_open, today_close)) / range_hl) * 100
    lower_wick_pct = ((min(today_open, today_close) - today_low) / range_hl) * 100

    # Distribution risk: rvol >= 1.80 + price in upper third OR upper wick >= 40%
    is_distribution_risk = is_explosion and (close_pct >= 67 or upper_wick_pct >= 40)

    # Accumulation buy: price at support + lower wick >= 40%
    is_accumulation_buy = (dist_to_support <= 3.0 and lower_wick_pct >= 40 and not is_explosion)

    # 3b. Macro Location — التموضع السعري (52-week high/low)
    # نقرأ high_52w/low_52w من stocks.db (لو متاح)
    high_52w = max(highs) if highs else current_price
    low_52w = min(lows) if lows else current_price
    try:
        stocks_db = project_root / 'db' / 'stocks.db'
        if stocks_db.exists():
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            sconn = db_manager.connection(stocks_db, writable=False).__enter__()
            srow = sconn.execute(
                "SELECT high_52w, low_52w FROM stocks WHERE ticker = ?", (ticker,)
            ).fetchone()
            sconn.close()
            if srow and srow[0] and srow[0] > 0:
                high_52w = srow[0]
            if srow and srow[1] and srow[1] > 0:
                low_52w = srow[1]
    except Exception:
        pass

    dist_to_52w_high = round(((high_52w - current_price) / high_52w * 100), 2) if high_52w > 0 else 0
    dist_to_52w_low = round(((current_price - low_52w) / low_52w * 100), 2) if low_52w > 0 else 0

    # Macro location classification:
    # NEAR_HIGH: within 5% of 52w high (طاير في القمة — FOMO risk)
    # NEAR_LOW: within 10% of 52w low (مخلص تصحيح في القاع — فرصة دخول)
    # MID_RANGE: بين الاثنين
    if dist_to_52w_high <= 5.0:
        macro_location = 'NEAR_HIGH'
    elif dist_to_52w_low <= 10.0:
        macro_location = 'NEAR_LOW'
    else:
        macro_location = 'MID_RANGE'

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

    # 7. BRAVO-QUAD-SCORE: السكور الرباعي (30/30/20/20) — لا معادلات V38
    # ────────────────────────────────────────────────────────────
    # 30% Volume Profile (المسافة من POC + Value Area)
    # 30% SMC (Order Block + كسر الهيكل)
    # 20% رادار السيولة الواقعي (من real_liquidity_radar)
    # 20% الموسمية الإحصائية للشهر الحالي

    # ── 7a. Volume Profile Score (0-30) ──
    # المسافة من منتصف الـ range = قرب من POC
    vp_score = 0.0
    if vol_ratio >= 2.0 and chg_1d > 0:
        vp_score += 15  # volume surge + price up = قوي
    elif vol_ratio >= 1.5 and close_pct >= 70:
        vp_score += 12  # accumulation
    elif vol_ratio >= 1.2:
        vp_score += 6
    # قرب من POC (منتصف الـ range)
    if 40 <= close_pct <= 80:
        vp_score += 10
    elif 30 <= close_pct <= 90:
        vp_score += 5
    vp_score = min(30.0, vp_score)

    # ── 7b. SMC Score (0-30) — Order Block + Structure Break ──
    smc_score = 0.0
    if current_price >= resistance * 0.98 and chg_1d > 0:
        smc_score += 15  # كسر مقاومة = structure break
    if dist_to_support <= 3.0 and chg_1d > -1.0:
        smc_score += 10  # قرب دعم = order block
    if adx and adx.get('adx', 0) > 25:
        smc_score += 5  # ترند قوي
    smc_score = min(30.0, smc_score)

    # ── 7c. Real Liquidity Radar Score (0-20) ──
    liq_score = 0.0
    liq_classification = 'SUSPICIOUS_WATCH'
    liq_reason = ''
    liq_mlr = 0.0
    try:
        from core.real_liquidity_radar import analyze_liquidity
        # convert rows to dict format for liquidity radar
        liq_input = []
        for r in reversed(rows):
            liq_input.append({
                'open': r[1] if len(r) > 1 else 0,
                'high': r[2] if len(r) > 2 else 0,
                'low': r[3] if len(r) > 3 else 0,
                'close': r[4] if len(r) > 4 else 0,
                'volume': r[5] if len(r) > 5 else 0,
            })
        liq_result = analyze_liquidity(ticker, liq_input)
        liq_classification = liq_result.classification
        liq_reason = liq_result.reason_ar
        liq_mlr = liq_result.mlr

        if liq_classification == 'ACCUMULATION_CONFIRMED':
            liq_score = 20.0
        elif liq_classification == 'DRY_EXPLOSION_READY':
            liq_score = 16.0
        elif liq_classification == 'SUSPICIOUS_WATCH':
            liq_score = 8.0
        # DIRTY_DISTRIBUTION + FALLING_KNIFE = 0 (vetoed below)
    except Exception as e:
        logger.debug(f"liquidity radar failed for {ticker}: {e}")

    # ── 7d. Seasonality Score (0-20) ──
    season_score = 10.0  # default neutral
    try:
        from datetime import datetime
        month = datetime.now().month
        # موسمية بسيطة: شهور الربيع (Mar-May) + خريف (Sep-Nov) = إيجابي للـ EGX
        if month in (3, 4, 5, 9, 10, 11):
            season_score = 16.0
        elif month in (12, 1, 2):
            season_score = 8.0
        else:
            season_score = 12.0
    except Exception:
        pass

    # ── 7e. Net Score (0-100) ──
    score = round(vp_score + smc_score + liq_score + season_score, 1)
    proofs = int(vp_score / 10) + int(smc_score / 10) + int(liq_score / 10)  # backward compat
    reasons = [
        f"VP={vp_score:.0f}/30",
        f"SMC={smc_score:.0f}/30",
        f"Liq={liq_score:.0f}/20 ({liq_classification})",
        f"Season={season_score:.0f}/20",
    ]

    # 8. Distribution veto (enhanced with liquidity radar)
    dist_warn = 0
    if chg_1d < -2.0 and vol_ratio >= 1.5:
        dist_warn += 1
    if adx and adx['minus_di'] > adx['plus_di'] * 1.5:
        dist_warn += 1
    if liq_classification in ('DIRTY_DISTRIBUTION', 'FALLING_KNIFE'):
        dist_warn += 2  # auto-veto

    # 9. Decision (BRAVO-URGENT: RVOL gates + R/R >= 2.0 + math invariants)
    # Math invariant: stop_loss < current_price <= entry_price < target_price
    # R/R >= 2.0 mandatory — أي صفقة < 2.0 تُعدم فوراً
    if liq_classification == 'FALLING_KNIFE':
        signal, track = 'HOLD', 'FALLING_KNIFE_VETO'
    elif is_illiquid or not turnover_ok:
        signal, track = 'HOLD', 'ILLIQUID'
    elif is_distribution_risk:
        # rvol >= 1.80 + upper third OR upper wick >= 40% = DISTRIBUTION_RISK
        signal, track = 'HOLD', 'DISTRIBUTION_RISK'
    elif dist_warn >= 2:
        signal, track = 'HOLD', 'DISTRIBUTION_VETO'
    elif rr < config.min_rr:
        signal, track = 'HOLD', 'LOW_RR'  # R/R < 2.0 = إعدام فوري
    elif liq_classification == 'DIRTY_DISTRIBUTION':
        signal, track = 'HOLD', 'DIRTY_DIST'
    elif is_fomo and score >= 50 and macro_location != 'NEAR_LOW':
        signal, track = 'WATCH', 'PEAK_MINEFIELD_WAIT'
    elif is_accumulation_buy and score >= 60:
        # price at support + lower wick >= 40% = ACCUMULATION_BUY
        signal, track = 'STRONG_BUY', 'ACCUMULATION_BUY'
    elif score >= 70 and liq_classification in ('ACCUMULATION_CONFIRMED', 'DRY_EXPLOSION_READY'):
        signal, track = 'STRONG_BUY', 'GOLDEN_DIP'
    elif score >= 60:
        signal, track = 'BUY', 'CONFIRMED'
    elif score >= 40:
        signal, track = 'WATCH', 'WEAK_PROOF'
    else:
        signal, track = 'HOLD', 'NO_PROOF'

    # 10. Exit Protocol (TP1 + Trailing + Time Stop)
    tp1_price = round(current_price * 1.065, 2)  # +6.5%
    tp2_price = round(current_price * 1.15, 2)    # +15%

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
        'high_52w': round(high_52w, 2),
        'low_52w': round(low_52w, 2),
        'dist_to_52w_high': dist_to_52w_high,
        'dist_to_52w_low': dist_to_52w_low,
        'macro_location': macro_location,
        'entry_price': round(current_price, 2),
        'stop_loss': round(stop_loss, 2),
        'target_price': round(target_price, 2),
        'risk_reward': rr,
        # BRAVO-QUAD-SCORE breakdown
        'vp_score': vp_score,
        'smc_score': smc_score,
        'liq_score': liq_score,
        'season_score': season_score,
        # Real Liquidity Radar
        'liquidity_classification': liq_classification,
        'liquidity_reason': liq_reason,
        'liquidity_mlr': liq_mlr,
        # Exit Protocol
        'tp1_price': tp1_price,
        'tp2_price': tp2_price,
        'trailing_stop_pct': 2.5,
        'max_hold_days': 5,
        'exit_protocol': 'TP1_6PCT_TIME_STOP_5D',
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

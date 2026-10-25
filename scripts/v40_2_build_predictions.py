#!/usr/bin/env python3
"""
V40.2 Predictions Builder — Based on Backtest Insights
=======================================================
يبني توقعات جديدة بناءً على نتايج الـ backtest:

الخلاصة من الـ backtest:
  - 12 trade وصلت +20% (take profit)
  - الـ top performers: AMOC, HELI, SWDY, TMGH, HRHO, AMER, PHDC, OCDI
  - الـ fundamental filter الناجح: P/E < 25 + ROE > 10%

الـ prediction strategy:
  1. نختار الـ stocks اللي في screener (most_active + unusual_volume)
  2. نطبّق fundamental filter (P/E < 25 + ROE > 10%)
  3. نحسب ATR-based position size
  4. نحدد entry/stop/target بناءً على آخر price
  5. نضيف news sentiment (لو موجود)
  6. نحفظ في predictions.db.predictions table
"""
import os
import sys
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
import math

# Setup paths
PROJECT_ROOT = Path('/home/z/my-project')
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

# Database paths
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# Output
OUTPUT_JSON = PROJECT_ROOT / 'vps-service' / 'backtest_results' / 'v40_2_treasures' / 'predictions.json'
OUTPUT_MD = PROJECT_ROOT / 'vps-service' / 'backtest_results' / 'v40_2_treasures' / 'PREDICTIONS.md'

print('=' * 70)
print('V40.2 Predictions Builder — Based on Backtest Insights')
print('=' * 70)


def load_top_candidates():
    """Load top candidates using screener + fundamentals (treasures)."""
    print('\n[1/3] Loading candidates using screener + fundamentals...')

    # 1. Get screener tickers
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    cur = conn.execute('''
        SELECT DISTINCT symbol FROM screener_lists
        WHERE category IN ('most_active', 'unusual_volume', 'top_gainers')
        AND market = 'مصر'
    ''')
    screener_tickers = sorted({r[0] for r in cur.fetchall()})
    print(f'  ✓ Screener tickers: {len(screener_tickers)}')
    conn.close()

    # 2. Get fundamentals from stocks.db (the canonical source for EGX)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    placeholders = ','.join('?' * len(screener_tickers))
    cur = conn.execute(f'''
        SELECT ticker, name, current_price, pe_ratio, pb_ratio, roe, roa,
               dividend_yield, market_cap, beta, ma_50, ma_200, rsi,
               support, resistance, high_52w, low_52w
        FROM stocks
        WHERE ticker IN ({placeholders})
        AND pe_ratio IS NOT NULL AND pe_ratio > 0 AND pe_ratio < 25
        AND roe IS NOT NULL AND roe > 10
        AND current_price IS NOT NULL AND current_price > 0
        AND is_active = 1
    ''', screener_tickers)
    candidates = []
    for row in cur.fetchall():
        (ticker, name, price, pe, pb, roe, roa, div_yield, mc, beta,
         ma50, ma200, rsi, support, resistance, high52w, low52w) = row
        candidates.append({
            'ticker': ticker,
            'name': name,
            'price': float(price) if price else 0,
            'pe': float(pe),
            'pb': float(pb) if pb else None,
            'roe': float(roe),
            'roa': float(roa) if roa else None,
            'dividend_yield': float(div_yield) if div_yield else None,
            'market_cap': float(mc) if mc else None,
            'beta': float(beta) if beta else None,
            'ma_50': float(ma50) if ma50 else None,
            'ma_200': float(ma200) if ma200 else None,
            'rsi': float(rsi) if rsi else None,
            'support': float(support) if support else None,
            'resistance': float(resistance) if resistance else None,
            'high_52w': float(high52w) if high52w else None,
            'low_52w': float(low52w) if low52w else None,
        })
    conn.close()
    print(f'  ✓ Candidates with strong fundamentals (P/E < 25, ROE > 10%): {len(candidates)}')
    return candidates


def load_price_history(ticker, days=60):
    """Load recent price history for a ticker."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    cur = conn.execute('''
        SELECT price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol = ?
        ORDER BY price_date DESC
        LIMIT ?
    ''', (ticker, days))
    rows = list(cur.fetchall())[::-1]  # Reverse to chronological order
    conn.close()
    return rows


def calculate_atr(price_data, period=14):
    """Calculate Average True Range — Rule 54: delegates to canonical Wilder's."""
    # Rule 54: استخدم canonical Wilder's smoothing (مش SMA)
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _vps = _Path(__file__).resolve().parents[1] / 'vps-service'
        if str(_vps) not in _sys.path:
            _sys.path.insert(0, str(_vps))
        from analyzers.indicators import calc_atr as _canonical_atr
        highs = [float(r[2] or 0) for r in price_data]
        lows = [float(r[3] or 0) for r in price_data]
        closes = [float(r[4] or 0) for r in price_data]
        return _canonical_atr(highs, lows, closes, period)
    except Exception:
        # fallback آمن لو canonical مش متاح
        if len(price_data) < period + 1:
            return None
        trs = []
        for i in range(1, len(price_data)):
            high = price_data[i][2] or 0
            low = price_data[i][3] or 0
            prev_close = price_data[i-1][4] or 0
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
            trs.append(tr)
        return sum(trs[-period:]) / period if len(trs) >= period else None


def calculate_rsi(price_data, period=14):
    """Calculate RSI — Rule 54: delegates to canonical Wilder's."""
    # Rule 54: استخدم canonical Wilder's smoothing (مش SMA)
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _vps = _Path(__file__).resolve().parents[1] / 'vps-service'
        if str(_vps) not in _sys.path:
            _sys.path.insert(0, str(_vps))
        from analyzers.indicators import calc_rsi as _canonical_rsi
        closes = [float(r[4] or 0) for r in price_data]
        return _canonical_rsi(closes, period)
    except Exception:
        # fallback آمن لو canonical مش متاح
        if len(price_data) < period + 1:
            return None
        gains = []
        losses = []
        for i in range(1, len(price_data)):
            prev = price_data[i-1][4] or 0
            curr = price_data[i][4] or 0
            change = curr - prev
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))


def calculate_position_size(atr, close_price):
    """Volatility-based position sizing."""
    if not atr or not close_price or close_price <= 0:
        return 1.0, 'NORMAL'
    atr_pct = (atr / close_price) * 100
    if atr_pct >= 6:
        return 0.55, 'HIGH_VOL'
    elif atr_pct >= 3:
        return 0.80, 'NORMAL'
    else:
        return 1.0, 'LOW_VOL'


def build_predictions():
    """Build V40.2 predictions for top candidates."""
    candidates = load_top_candidates()
    if not candidates:
        print('\n❌ No candidates found.')
        return []

    print(f'\n[2/3] Building predictions for {len(candidates)} candidates...')

    predictions = []
    today = datetime.now().strftime('%Y-%m-%d')

    for c in candidates:
        ticker = c['ticker']
        # Load recent price history
        price_data = load_price_history(ticker, days=60)
        if len(price_data) < 15:
            continue

        # Get latest price
        latest = price_data[-1]
        latest_date = latest[0]
        latest_close = latest[4] or latest[1]
        if not latest_close or latest_close <= 0:
            continue

        # Calculate indicators
        atr = calculate_atr(price_data)
        rsi_14 = calculate_rsi(price_data)
        if not atr:
            continue

        atr_pct = (atr / latest_close) * 100
        pos_size, vol_class = calculate_position_size(atr, latest_close)

        # V40.2 scoring (simplified):
        # 1. Trend (price vs MA50)
        score = 50  # Base
        if c['ma_50'] and latest_close > c['ma_50']:
            score += 10  # Above MA50 = bullish
        if c['ma_200'] and latest_close > c['ma_200']:
            score += 10  # Above MA200 = strong bullish
        # 2. Fundamentals
        if c['pe'] < 15:
            score += 15  # Cheap valuation
        elif c['pe'] < 20:
            score += 8
        if c['roe'] > 15:
            score += 15  # High ROE
        elif c['roe'] > 12:
            score += 8
        if c['dividend_yield'] and c['dividend_yield'] > 5:
            score += 5  # High dividend
        # 3. RSI
        if rsi_14 is not None:
            if rsi_14 < 30:
                score += 10  # Oversold
            elif rsi_14 > 70:
                score -= 10  # Overbought
        # 4. Volume spike (today vs avg)
        recent_volumes = [r[5] or 0 for r in price_data[-5:]]
        avg_vol = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 0
        latest_vol = latest[5] or 0
        if avg_vol > 0 and latest_vol > avg_vol * 1.5:
            score += 5  # Volume spike (treasure #3)
        # Clamp score
        score = max(0, min(100, score))

        # Determine signal
        if score >= 75:
            signal = 'STRONG_BUY'
        elif score >= 60:
            signal = 'BUY'
        elif score >= 45:
            signal = 'HOLD'
        elif score >= 30:
            signal = 'SELL'
        else:
            signal = 'STRONG_SELL'

        # Entry/Stop/Target based on ATR (Rule 8: stop 3-9%)
        stop_pct = max(3, min(9, atr_pct * 1.5))  # ATR-based, clamped to 3-9%
        target_pct = stop_pct * 2.5  # R:R = 1:2.5

        entry_price = latest_close
        stop_price = entry_price * (1 - stop_pct / 100)
        target_price = entry_price * (1 + target_pct / 100)

        # Risk per share
        risk_per_share = entry_price - stop_price
        reward_per_share = target_price - entry_price
        rr_ratio = reward_per_share / risk_per_share if risk_per_share > 0 else 0

        prediction = {
            'ticker': ticker,
            'name': c['name'],
            'date': today,
            'signal': signal,
            'score': score,
            'entry_price': round(entry_price, 2),
            'stop_loss': round(stop_price, 2),
            'target_price': round(target_price, 2),
            'stop_pct': round(stop_pct, 2),
            'target_pct': round(target_pct, 2),
            'rr_ratio': round(rr_ratio, 2),
            'position_size_mult': pos_size,
            'volatility_class': vol_class,
            'atr': round(atr, 4),
            'atr_pct': round(atr_pct, 2),
            'rsi_14': round(rsi_14, 2) if rsi_14 else None,
            'fundamentals': {
                'pe': c['pe'],
                'pb': c['pb'],
                'roe': c['roe'],
                'roa': c['roa'],
                'dividend_yield': c['dividend_yield'],
                'market_cap': c['market_cap'],
            },
            'technical': {
                'ma_50': c['ma_50'],
                'ma_200': c['ma_200'],
                'rsi': c['rsi'],
                'support': c['support'],
                'resistance': c['resistance'],
                'high_52w': c['high_52w'],
                'low_52w': c['low_52w'],
            },
            'latest_date': latest_date,
            'treasures_used': [
                'screener_lists',
                'fundamentals_stocks_db',
                'atr_position_sizing',
                'rsi_filter',
                'volume_spike',
            ],
        }
        predictions.append(prediction)

    # Sort by score (highest first)
    predictions.sort(key=lambda x: x['score'], reverse=True)
    print(f'  ✓ Built {len(predictions)} predictions')
    return predictions


def save_predictions(predictions):
    """Save predictions to JSON and Markdown."""
    if not predictions:
        print('\n❌ No predictions to save.')
        return

    print(f'\n[3/3] Saving {len(predictions)} predictions...')

    # Save JSON
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_predictions': len(predictions),
            'predictions': predictions,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f'  ✓ JSON: {OUTPUT_JSON}')

    # Save Markdown
    with open(OUTPUT_MD, 'w', encoding='utf-8') as f:
        f.write('# V40.2 Predictions — Based on Backtest Insights\n\n')
        f.write(f'**Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n\n')
        f.write(f'**Total Predictions:** {len(predictions)}\n\n')
        f.write('---\n\n')
        f.write('## Treasures Used\n\n')
        f.write('1. **Screener Lists** (data_engine.db.screener_lists): most_active + unusual_volume + top_gainers\n')
        f.write('2. **Fundamentals** (stocks.db.stocks): P/E < 25, ROE > 10%\n')
        f.write('3. **ATR Position Sizing**: 55% for high-vol, 80% for normal, 100% for low-vol\n')
        f.write('4. **RSI Filter**: +10 for oversold, -10 for overbought\n')
        f.write('5. **Volume Spike**: +5 for unusual volume (today > 1.5x avg)\n\n')
        f.write('---\n\n')
        f.write('## Top Predictions\n\n')
        f.write('| # | Ticker | Signal | Score | Entry | Stop | Target | R/R | Vol | P/E | ROE |\n')
        f.write('|---|--------|--------|-------|-------|------|--------|-----|-----|-----|-----|\n')
        for i, p in enumerate(predictions[:15], 1):
            vol_emoji = '🔴' if p['volatility_class'] == 'HIGH_VOL' else '🟢' if p['volatility_class'] == 'LOW_VOL' else '🟡'
            f.write(f"| {i} | {p['ticker']} | {p['signal']} | {p['score']} | "
                    f"{p['entry_price']:.2f} | {p['stop_loss']:.2f} | {p['target_price']:.2f} | "
                    f"{p['rr_ratio']:.1f} | {vol_emoji} {p['position_size_mult']:.0%} | "
                    f"{p['fundamentals']['pe']:.1f} | {p['fundamentals']['roe']:.1f}% |\n")
        f.write('\n## All Predictions\n\n')
        for p in predictions:
            f.write(f'### {p["ticker"]} — {p["signal"]} (Score: {p["score"]}/100)\n\n')
            f.write(f'- **Name:** {p["name"]}\n')
            f.write(f'- **Latest Date:** {p["latest_date"]}\n')
            f.write(f'- **Entry:** {p["entry_price"]:.2f} EGP\n')
            f.write(f'- **Stop Loss:** {p["stop_loss"]:.2f} EGP (-{p["stop_pct"]:.1f}%)\n')
            f.write(f'- **Target:** {p["target_price"]:.2f} EGP (+{p["target_pct"]:.1f}%)\n')
            f.write(f'- **R/R Ratio:** {p["rr_ratio"]:.2f}\n')
            f.write(f'- **Position Size:** {p["position_size_mult"]:.0%} (volatility: {p["volatility_class"]})\n')
            f.write(f'- **ATR:** {p["atr"]:.4f} ({p["atr_pct"]:.2f}%)\n')
            f.write(f'- **RSI(14):** {p["rsi_14"] or "N/A"}\n')
            f.write(f'- **P/E:** {p["fundamentals"]["pe"]:.1f} | **P/B:** {p["fundamentals"].get("pb") or "N/A"}\n')
            f.write(f'- **ROE:** {p["fundamentals"]["roe"]:.1f}% | **Div Yield:** {p["fundamentals"].get("dividend_yield") or "N/A"}%\n')
            f.write(f'- **MA50:** {p["technical"]["ma_50"] or "N/A"} | **MA200:** {p["technical"]["ma_200"] or "N/A"}\n')
            f.write(f'- **52w High:** {p["technical"]["high_52w"] or "N/A"} | **52w Low:** {p["technical"]["low_52w"] or "N/A"}\n\n')
    print(f'  ✓ Markdown: {OUTPUT_MD}')

    # Print summary
    print('\n' + '=' * 70)
    print('PREDICTIONS SUMMARY')
    print('=' * 70)
    buy_count = sum(1 for p in predictions if p['signal'] in ('BUY', 'STRONG_BUY'))
    hold_count = sum(1 for p in predictions if p['signal'] == 'HOLD')
    sell_count = sum(1 for p in predictions if p['signal'] in ('SELL', 'STRONG_SELL'))
    print(f'Total: {len(predictions)} | BUY: {buy_count} | HOLD: {hold_count} | SELL: {sell_count}')
    print(f'\nTop 5 Predictions:')
    for i, p in enumerate(predictions[:5], 1):
        print(f'  {i}. {p["ticker"]:6s} {p["signal"]:12s} Score={p["score"]:3d} '
              f'Entry={p["entry_price"]:8.2f} Target={p["target_price"]:8.2f} '
              f'R/R={p["rr_ratio"]:.1f} Vol={p["volatility_class"]}')


if __name__ == '__main__':
    predictions = build_predictions()
    save_predictions(predictions)

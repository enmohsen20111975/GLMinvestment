#!/usr/bin/env python3
"""
Screener Data Integration for V40.2
====================================
يربط بيانات screener_lists + tab_* fundamentals + bid/ask من data_engine.db
بـ V40.2 بشكل هندسي صحيح (مخفّض من MasterAnalyzer).

المصادر:
  1. screener_lists (data_engine.db) — 8 قوائم: most_active, unusual_volume, إلخ
  2. tab_valuation + tab_profitability (data_engine.db) — P/E, ROE, margins
  3. intraday_prices (intraday.db) — bid/ask لآخر سعر

التأثير على V40.2:
  - Screener tags: boost/veto score (+10 لـ unusual_volume, -8 لـ penny)
  - Fundamentals: boost لو ROE > 15% + P/E < 15
  - Bid/Ask spread: لو spread ضيق (< 0.5%) → سيولة عالية → boost

CONSTITUTION compliance:
  - Rule 20: Python = brain (كل logic هنا)
  - Rule 27: NO-FAKE-DATA (بيانات حقيقية من DB)
  - Rule 29: UNIFIED-SYSTEM (module واحد موحّد)
  - Rule 17: RELATIVE-PATHS (مسارات نسبية)

Author: Z.ai Code
Date: 2026-09-03
"""
from __future__ import annotations
import os
import sqlite3
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Paths (relative — Rule 17)
_VPS_ROOT = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = _VPS_ROOT.parent
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
INTRADAY_DB = str(_PROJECT_ROOT / 'db' / 'intraday.db')

# Screener boost values (from MasterAnalyzer SCREENER_BOOSTS)
SCREENER_BOOSTS = {
    'unusual_volume':  +10.0,
    'undervalued':     +9.0,
    'most_active':     +8.0,
    'high_dividend':   +6.0,
    'high_net_income': +5.0,
    'top_losers':      +0.0,   # لا boost مباشر
    'top_gainers':     -6.0,   # فخ القمة
    'penny':           -8.0,   # فخ قرشية
}

# Thresholds
TOP_GAINERS_VETO_RSI = 70.0
GOOD_ROE_THRESHOLD = 15.0
GOOD_PE_THRESHOLD = 15.0
TIGHT_SPREAD_PCT = 0.5  # spread < 0.5% = سيولة عالية


def get_screener_tags(ticker: str) -> Dict[str, Any]:
    """
    قراءة تصنيف السهم من screener_lists في data_engine.db.
    Reuses MasterAnalyzer's function logic but standalone (no MasterAnalyzer dep).
    """
    result = {'tags': [], 'list_types': {}, 'is_gold': False, 'is_trap': False, 'has_data': False}
    if not ticker or not os.path.exists(DATA_ENGINE_DB):
        return result
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('SELECT 1 FROM screener_lists LIMIT 1')
        except Exception:
            conn.close()
            return result
        result['has_data'] = True
        rows = conn.execute(
            'SELECT category, list_type FROM screener_lists WHERE symbol = ?',
            (ticker.upper(),)
        ).fetchall()
        conn.close()
        for r in rows:
            cat = r['category']
            lt = r['list_type']
            result['tags'].append(cat)
            result['list_types'][cat] = lt
            if lt == 'gold':
                result['is_gold'] = True
            elif lt == 'trap':
                result['is_trap'] = True
    except Exception as e:
        logger.debug(f"screener_tags error for {ticker}: {e}")
    return result


def get_fundamentals_boost(ticker: str) -> Dict[str, Any]:
    """
    قراءة fundamentals من tab_valuation + tab_profitability في data_engine.db.
    Returns boost (+5 لو ROE > 15% + P/E < 15) + veto (لو P/E > 100).
    """
    result = {'has_data': False, 'pe': None, 'roe': None, 'net_margin': None,
              'boost': 0.0, 'veto': False, 'reason': ''}
    if not ticker or not os.path.exists(DATA_ENGINE_DB):
        return result
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        # FIX-WAVE-2-DATA (AUDIT-DEEP-3 #1): tab_valuation/tab_profitability
        # use `symbol` column (NOT `ticker`). Some rows have an Arabic suffix
        # (e.g. "COMIالبنك", "NBKبنك"), so we also LIKE-match the ticker prefix
        # to catch merged symbols. Rule 56 (P0-WAVE-SQLI): both parameters are
        # parameterized via `?` — no string interpolation.
        # tab_valuation
        val_row = conn.execute(
            'SELECT symbol, pe_ratio, pb_ratio FROM tab_valuation '
            'WHERE symbol = ? OR symbol LIKE ? LIMIT 1',
            (ticker, ticker + '%')
        ).fetchone()
        # tab_profitability
        prof_row = conn.execute(
            'SELECT symbol, roe, net_margin FROM tab_profitability '
            'WHERE symbol = ? OR symbol LIKE ? LIMIT 1',
            (ticker, ticker + '%')
        ).fetchone()
        conn.close()
        if val_row:
            result['has_data'] = True
            result['pe'] = float(val_row['pe_ratio']) if val_row['pe_ratio'] else None
        if prof_row:
            result['has_data'] = True
            result['roe'] = float(prof_row['roe']) if prof_row['roe'] else None
            result['net_margin'] = float(prof_row['net_margin']) if prof_row['net_margin'] else None
        # Boost logic
        if result['roe'] and result['roe'] > GOOD_ROE_THRESHOLD:
            if result['pe'] and result['pe'] < GOOD_PE_THRESHOLD and result['pe'] > 0:
                result['boost'] = +5.0
                result['reason'] = f'ROE={result["roe"]:.1f}% + P/E={result["pe"]:.1f} → fundamentals قوية'
        # Veto: P/E > 100 = bubble
        if result['pe'] and result['pe'] > 100:
            result['veto'] = True
            result['reason'] = f'P/E={result["pe"]:.0f} → bubble risk'
    except Exception as e:
        logger.debug(f"fundamentals error for {ticker}: {e}")
    return result


def get_bid_ask_spread(ticker: str) -> Dict[str, Any]:
    """
    قراءة آخر bid/ask من intraday.db.intraday_prices.
    Returns spread + liquidity assessment.
    """
    result = {'has_data': False, 'bid': None, 'ask': None, 'spread_pct': None,
              'is_liquid': False, 'boost': 0.0}
    if not ticker or not os.path.exists(INTRADAY_DB):
        return result
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(INTRADAY_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            '''SELECT bid, ask FROM intraday_prices
               WHERE ticker = ? AND bid > 0 AND ask > 0
               ORDER BY price_time DESC LIMIT 1''',
            (ticker.upper(),)
        ).fetchone()
        conn.close()
        if row and row['bid'] and row['ask'] and float(row['bid']) > 0 and float(row['ask']) > 0:
            bid = float(row['bid'])
            ask = float(row['ask'])
            spread = ask - bid
            mid = (ask + bid) / 2
            spread_pct = (spread / mid * 100) if mid > 0 else 0
            result['has_data'] = True
            result['bid'] = bid
            result['ask'] = ask
            result['spread_pct'] = round(spread_pct, 3)
            result['is_liquid'] = spread_pct < TIGHT_SPREAD_PCT
            if result['is_liquid']:
                result['boost'] = +3.0  # سيولة عالية = ميكرز موجودين
    except Exception as e:
        logger.debug(f"bid/ask error for {ticker}: {e}")
    return result


def apply_screener_data_to_v402(ticker: str, score: int, signal: str,
                                 rsi: float = 50.0, current_price: float = 0.0) -> Dict[str, Any]:
    """
    تطبيق بيانات screener + fundamentals + bid/ask على V40.2 score + signal.

    Args:
        ticker: رمز السهم
        score: الـ score الحالي من V40.2 (0-100)
        signal: الإشارة الحالية (BUY/STRONG_BUY/INSTITUTIONAL_BUY)
        rsi: قيمة RSI (لـ top_gainers veto)
        current_price: السعر الحالي (لـ top_losers reversal check)

    Returns:
        {
            'adjusted_score': int (0-100),
            'adjusted_signal': str,
            'screener_tags': list,
            'fundamentals': dict,
            'bid_ask': dict,
            'boost_notes': list[str],  # أسباب الـ boost/veto
            'veto': bool,             # لو true → V40.2 يجب رفض التوقع
        }
    """
    adjusted_score = score
    adjusted_signal = signal
    boost_notes = []
    veto = False

    # 1. Screener tags
    screener = get_screener_tags(ticker)
    if screener['has_data'] and screener['tags']:
        for tag in screener['tags']:
            boost = SCREENER_BOOSTS.get(tag, 0.0)
            if tag == 'top_gainers' and rsi >= TOP_GAINERS_VETO_RSI:
                # Veto: top_gainers + RSI عالي = FOMO
                veto = True
                boost_notes.append(f'top_gainers + RSI={rsi:.0f} → VETO (FOMO)')
            elif tag == 'penny':
                # Veto: penny stocks = فخ
                veto = True
                boost_notes.append(f'penny → VETO (فخ قرشية)')
            elif boost != 0:
                adjusted_score = max(0, min(100, adjusted_score + int(boost)))
                if boost > 0:
                    boost_notes.append(f'{tag} +{boost:.0f}pts')
                else:
                    boost_notes.append(f'{tag} {boost:.0f}pts')

    # 2. Fundamentals
    fundamentals = get_fundamentals_boost(ticker)
    if fundamentals['has_data']:
        if fundamentals['veto']:
            veto = True
            boost_notes.append(f'P/E={fundamentals["pe"]:.0f} → VETO (bubble)')
        elif fundamentals['boost'] > 0:
            adjusted_score = max(0, min(100, adjusted_score + int(fundamentals['boost'])))
            boost_notes.append(f'fundamentals +{fundamentals["boost"]:.0f}pts ({fundamentals["reason"]})')

    # 3. Bid/Ask spread
    bid_ask = get_bid_ask_spread(ticker)
    if bid_ask['has_data'] and bid_ask['boost'] > 0:
        adjusted_score = max(0, min(100, adjusted_score + int(bid_ask['boost'])))
        boost_notes.append(f'bid/ask spread={bid_ask["spread_pct"]:.2f}% → +{bid_ask["boost"]:.0f}pts (سيولة عالية)')

    return {
        'adjusted_score': adjusted_score,
        'adjusted_signal': adjusted_signal,
        'screener_tags': screener.get('tags', []),
        'screener_is_gold': screener.get('is_gold', False),
        'screener_is_trap': screener.get('is_trap', False),
        'fundamentals': {
            'pe': fundamentals.get('pe'),
            'roe': fundamentals.get('roe'),
            'net_margin': fundamentals.get('net_margin'),
        },
        'bid_ask': {
            'bid': bid_ask.get('bid'),
            'ask': bid_ask.get('ask'),
            'spread_pct': bid_ask.get('spread_pct'),
            'is_liquid': bid_ask.get('is_liquid', False),
        },
        'boost_notes': boost_notes,
        'veto': veto,
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Screener Data Integration — Self Test")
    print("=" * 70)

    test_tickers = ['COMI', 'ABUK', 'EAST', 'SWDY', 'DAPH']

    for ticker in test_tickers:
        print(f"\n--- {ticker} ---")

        # Screener tags
        screener = get_screener_tags(ticker)
        print(f"  Screener: has_data={screener['has_data']}, tags={screener['tags']}, gold={screener['is_gold']}, trap={screener['is_trap']}")

        # Fundamentals
        fund = get_fundamentals_boost(ticker)
        print(f"  Fundamentals: has_data={fund['has_data']}, P/E={fund['pe']}, ROE={fund['roe']}, boost={fund['boost']}, veto={fund['veto']}")

        # Bid/Ask
        ba = get_bid_ask_spread(ticker)
        print(f"  Bid/Ask: has_data={ba['has_data']}, bid={ba['bid']}, ask={ba['ask']}, spread={ba['spread_pct']}%, liquid={ba['is_liquid']}")

        # Full integration
        result = apply_screener_data_to_v402(ticker, score=70, signal='BUY', rsi=55, current_price=100)
        print(f"  → adjusted_score={result['adjusted_score']}, veto={result['veto']}")
        if result['boost_notes']:
            for note in result['boost_notes']:
                print(f"    {note}")

    print(f"\n{'='*70}")
    print("✓ Self test complete")


def get_delta_volume_data(ticker: str) -> Dict[str, Any]:
    """جلب آخر delta_volume لسهم من data_engine.db.egksco_price_history.

    Delta Volume = حجم الشراء - حجم البيع (محسوب من بيانات OHLCV).
    Pressure: STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL

    OWNER DIRECTIVE (2026-10-07): "بلاش منه خلاص" — Order Flow اتشال من القرار.
    الـ function دي بتستخدم للـ UI DISPLAY ONLY (مش gate، مش boost، مش veto).
    الـ A/B test السابق أثبت إن delta_volume على daily candles بيضر النتايج
    (PF -0.31, WR -1.46%). شيلناه من القرار وسبناه للـ display فقط.

    Returns: dict with delta_volume, delta_pct, pressure, buy_volume, sell_volume
    """
    import sqlite3 as _sql
    result = {
        'has_data': False, 'delta_volume': None, 'delta_pct': None,
        'pressure': 'NEUTRAL', 'buy_volume': None, 'sell_volume': None,
    }
    try:
        _db = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
        _conn = _sql.connect(_db, timeout=5)
        _conn.row_factory = _sql.Row
        row = _conn.execute('''
            SELECT delta_volume, delta_pct, pressure, buy_volume, sell_volume
            FROM egksco_price_history
            WHERE symbol = ? AND delta_volume IS NOT NULL
            ORDER BY price_date DESC LIMIT 1
        ''', (ticker,)).fetchone()
        _conn.close()
        if row and row['delta_volume'] is not None:
            result['has_data'] = True
            result['delta_volume'] = row['delta_volume']
            result['delta_pct'] = row['delta_pct']
            result['pressure'] = row['pressure'] or 'NEUTRAL'
            result['buy_volume'] = row['buy_volume']
            result['sell_volume'] = row['sell_volume']
    except Exception:
        pass
    return result

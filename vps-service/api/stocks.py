"""
Stock Routes (Blueprint)
========================
Stock screener API — preset scans, fair-value computation, and weekly/monthly stats.

Endpoints:
- GET /api/stocks/presets        — Pre-computed or on-the-fly screener presets
- GET /api/stocks/presets/list   — List of available preset definitions
- GET /api/stocks/computed       — All stocks enriched with fair_value + 1w/1m stats

Supports market filtering:
- EGX: Egyptian Stock Exchange
- TADAWUL: Saudi Stock Exchange
- KSE: Kuwait Stock Exchange
- QSE: Qatar Stock Exchange
- DFM: Dubai Financial Market
- ADX: Abu Dhabi Securities Exchange

The /api/stocks/presets endpoint tries the persisted `screener_presets` table first
(populated by the daily cron). If empty, it falls back to ON-THE-FLY computation
from live stocks + stock_daily_prices, ensuring the UI always has data even
before/after market close.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from flask import Blueprint, jsonify, request

from utils.db_paths import DBPaths
from utils.helpers import parse_volume
from utils.fair_value import calc_fundamental_fair_value as _canonical_fundamental_fair_value, calc_upside_percent as _canonical_upside_percent


stocks_bp = Blueprint('stocks screener', __name__)


# ============================================================================
# CONSTANTS
# ============================================================================

VALID_PRESETS = ['most_active', 'undervalued', 'overvalued', 'top_gainers', 'top_losers', 'top_dividends', 'lowest_risk']

PRESET_NAMES = {
    'most_active': 'الأكثر نشاطا',
    'undervalued': 'الأسهم الأقل من القيمة العادلة',
    'overvalued': 'الأسهم الأعلى من القيمة العادلة',
    'top_gainers': 'الأكثر ربحا',
    'top_losers': 'الأكثر خسارة',
    'top_dividends': 'الأكثر توزيعات',
    'lowest_risk': 'الأقل مخاطرة',
}

PRESET_META = [
    {'id': 'most_active', 'name_ar': 'الأكثر نشاطا', 'icon': '🔥', 'desc': 'الأعلى قيمة تداول'},
    {'id': 'undervalued', 'name_ar': 'الأقل من القيمة العادلة', 'icon': '💎', 'desc': 'فرصة صعود > 5%'},
    {'id': 'overvalued', 'name_ar': 'الأعلى من القيمة العادلة', 'icon': '⚠️', 'desc': 'فرصة هبوط > 5%'},
    {'id': 'top_gainers', 'name_ar': 'الأكثر ربحا', 'icon': '📈', 'desc': 'أعلى تغير إيجابي'},
    {'id': 'top_losers', 'name_ar': 'الأكثر خسارة', 'icon': '📉', 'desc': 'أعلى تغير سلبي'},
    {'id': 'top_dividends', 'name_ar': 'الأكثر توزيعات', 'icon': '💵', 'desc': 'أعلى عائد توزيعات'},
    {'id': 'lowest_risk', 'name_ar': 'الأقل مخاطرة', 'icon': '🛡️', 'desc': 'أقل تذبذب + أفضل ملاءة'},
]

# Default lookback windows for 1w (5 trading days) / 1m (21 trading days)
WEEK_DAYS = 5
MONTH_DAYS = 21


# ============================================================================
# HELPERS
# ============================================================================

def _to_float(value) -> float | None:
    """Best-effort conversion to float — returns None for NULL/empty/garbage."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace('\u202f', '').replace(' ', '')
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _calc_fair_value(pe_ratio, eps, book_value_per_share, current_price=None, pb_ratio=None, ma_200=None) -> float | None:
    """Estimate fair value per share — BRAVO UNIFY: delegates to canonical utils.fair_value."""
    return _canonical_fundamental_fair_value(
        pe_ratio=pe_ratio, eps=eps, book_value_per_share=book_value_per_share,
        current_price=current_price, pb_ratio=pb_ratio, ma_200=ma_200,
    )


def _calc_upside_percent(fair_value, current_price) -> float | None:
    """upside_percent = ((fair_value - current_price) / current_price) * 100 — BRAVO UNIFY: delegates to canonical."""
    return _canonical_upside_percent(fair_value, current_price)


def _get_daily_stats(conn: sqlite3.Connection, ticker: str) -> dict:
    """
    Fetch last 21 daily prices + volumes for a ticker and compute:
    - change_1w (5d % change), change_1m (21d % change)
    - volume_week (avg of last 5), volume_month (avg of last 21)
    """
    rows = conn.execute(
        """
        SELECT price_date, close, volume
        FROM stock_daily_prices
        WHERE ticker = ?
        ORDER BY price_date DESC
        LIMIT ?
        """,
        (ticker, MONTH_DAYS + 1),
    ).fetchall()

    if not rows:
        return {'change_1w': None, 'change_1m': None,
                'volume_week': None, 'volume_month': None}

    closes = []
    vols = []
    for r in rows:
        c = _to_float(r['close'])
        v = parse_volume(r['volume']) if r['volume'] is not None else 0
        if c is not None and c > 0:
            closes.append(c)
        vols.append(v)

    current_close = closes[0] if closes else None

    # Week change: current vs close WEEK_DAYS days ago
    change_1w = None
    if len(closes) > WEEK_DAYS and closes[WEEK_DAYS] and closes[WEEK_DAYS] > 0:
        change_1w = round(((current_close - closes[WEEK_DAYS]) / closes[WEEK_DAYS]) * 100, 2)

    # Month change: current vs close MONTH_DAYS days ago
    change_1m = None
    if len(closes) > MONTH_DAYS and closes[MONTH_DAYS] and closes[MONTH_DAYS] > 0:
        change_1m = round(((current_close - closes[MONTH_DAYS]) / closes[MONTH_DAYS]) * 100, 2)

    # Volume averages
    volume_week = None
    volume_month = None
    if vols:
        week_slice = vols[:WEEK_DAYS]
        month_slice = vols[:MONTH_DAYS]
        week_nonzero = [v for v in week_slice if v > 0]
        month_nonzero = [v for v in month_slice if v > 0]
        if week_nonzero:
            volume_week = round(sum(week_nonzero) / len(week_nonzero))
        if month_nonzero:
            volume_month = round(sum(month_nonzero) / len(month_nonzero))

    return {
        'change_1w': change_1w,
        'change_1m': change_1m,
        'volume_week': volume_week,
        'volume_month': volume_month,
    }


def _enrich_stock_row(row: sqlite3.Row, daily_stats: dict | None = None) -> dict:
    """
    Convert a raw stocks-table row (sqlite3.Row) into the enriched preset payload.
    `daily_stats` is optional precomputed stats (avoids re-querying when caller batches).
    """
    ticker = row['ticker']
    current_price = _to_float(row['current_price']) or 0.0
    previous_close = _to_float(row['previous_close']) or 0.0

    # change_1d (today's %) — prefer stored change_percent, fallback to calc
    change_1d = _to_float(row['change_percent'])
    if (change_1d is None) and previous_close and previous_close > 0 and current_price > 0:
        change_1d = round(((current_price - previous_close) / previous_close) * 100, 2)

    # Volume today (raw volume may be text like "2.28M")
    volume_today = parse_volume(row['volume']) if row['volume'] is not None else 0

    # Turnover today (EGP) = current_price × volume
    turnover_egp = round(current_price * volume_today, 2) if (current_price and volume_today) else 0.0

    # Fair value + upside (with pb_ratio / ma_200 fallbacks for stocks missing pe_ratio/book_value)
    fair_value = _calc_fair_value(
        row['pe_ratio'], row['eps'], row['book_value_per_share'],
        current_price=current_price,
        pb_ratio=row['pb_ratio'],
        ma_200=row['ma_200'],
    )
    upside_percent = _calc_upside_percent(fair_value, current_price)

    stats = daily_stats or {
        'change_1w': None, 'change_1m': None,
        'volume_week': None, 'volume_month': None,
    }

    market_cap_raw = row['market_cap']
    # FIX (Aug 2026): Use suffix-aware parse_market_cap (handles '377.55\u202fM',
    # '1.2 B', '449.82B EGP'). Falls back to _to_float for plain numbers.
    try:
        from core.database import parse_market_cap
        market_cap_num = parse_market_cap(market_cap_raw)
    except ImportError:
        market_cap_num = _to_float(market_cap_raw)
    if market_cap_num is None and market_cap_raw is not None:
        # Last-resort fallback to old parse_volume (returns int * multiplier)
        market_cap_num = parse_volume(market_cap_raw)

    pe_ratio = _to_float(row['pe_ratio'])

    keys = row.keys() if hasattr(row, 'keys') else []
    return {
        'ticker': ticker,
        'name': row['name'],
        'name_ar': row['name_ar'],
        'market': row['market'] or 'EGX',
        'sector': row['sector'] or '—',
        'current_price': current_price,
        'previous_close': previous_close or None,
        'change_1d': change_1d,
        'change_1w': stats.get('change_1w'),
        'change_1m': stats.get('change_1m'),
        'volume': volume_today,
        'volume_week': stats.get('volume_week'),
        'volume_month': stats.get('volume_month'),
        'turnover_egp': turnover_egp,
        'fair_value': fair_value,
        'upside_percent': upside_percent,
        'market_cap': market_cap_num,
        'pe_ratio': pe_ratio,
        'eps': _to_float(row['eps']),
        'book_value_per_share': _to_float(row['book_value_per_share']),
        'dividend_yield': _to_float(row['dividend_yield']) if 'dividend_yield' in keys else None,
        'beta': _to_float(row['beta']) if 'beta' in keys else None,
        'current_ratio': _to_float(row['current_ratio']) if 'current_ratio' in keys else None,
        'roe': _to_float(row['roe']) if 'roe' in keys else None,
        'egx30_member': bool(row['is_egx30']) if 'is_egx30' in keys and row['is_egx30'] else False,
        'egx70_member': bool(row['is_egx70']) if 'is_egx70' in keys and row['is_egx70'] else False,
        'egx100_member': bool(row['is_egx100']) if 'is_egx100' in keys and row['is_egx100'] else False,
    }


def _fetch_live_enriched_stocks(market: str = '', limit: int = 200) -> list[dict]:
    """
    Pull all (or filtered) stocks + their daily stats, return enriched list.
    Used as the on-the-fly fallback when screener_presets is empty.
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DBPaths.STOCKS_DB, writable=False)
    conn.row_factory = sqlite3.Row
    try:
        if market:
            rows = conn.execute(
                """
                SELECT * FROM stocks
                WHERE current_price > 0
                  AND (is_active = 1 OR is_active IS NULL)
                  AND market = ?
                ORDER BY ticker
                LIMIT ?
                """,
                (market.upper(), limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM stocks
                WHERE current_price > 0 AND (is_active = 1 OR is_active IS NULL)
                ORDER BY ticker
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        enriched: list[dict] = []
        for r in rows:
            stats = _get_daily_stats(conn, r['ticker'])
            enriched.append(_enrich_stock_row(r, stats))
        return enriched
    finally:
        conn.close()


def _filter_and_sort_preset(stocks: list[dict], preset: str, period: str, limit: int) -> list[dict]:
    """Apply preset-specific filtering + sorting on an enriched stocks list."""
    if preset == 'most_active':
        filtered = [s for s in stocks if (s.get('turnover_egp') or s.get('volume') or 0) > 0]
        if not filtered:
            filtered = list(stocks)
        filtered.sort(key=lambda s: (s.get('turnover_egp') or (s.get('volume') or 0) * (s.get('current_price') or 1)), reverse=True)
    elif preset == 'top_gainers':
        col = 'change_1d' if period == '1d' else ('change_1w' if period == '1w' else 'change_1m')
        filtered = [s for s in stocks if s.get(col) is not None and s.get(col) > 0]
        if not filtered:
            filtered = [s for s in stocks if s.get(col) is not None]
        filtered.sort(key=lambda s: s.get(col) or 0, reverse=True)
    elif preset == 'top_losers':
        col = 'change_1d' if period == '1d' else ('change_1w' if period == '1w' else 'change_1m')
        filtered = [s for s in stocks if s.get(col) is not None and s.get(col) < 0]
        if not filtered:
            filtered = [s for s in stocks if s.get(col) is not None]
        filtered.sort(key=lambda s: s.get(col) or 0, reverse=False)
    elif preset == 'undervalued':
        filtered = [s for s in stocks if s.get('upside_percent') is not None and s['upside_percent'] >= 5]
        if not filtered:
            filtered = [s for s in stocks if s.get('upside_percent') is not None]
            filtered.sort(key=lambda s: s.get('upside_percent') or 0, reverse=True)
        else:
            filtered.sort(key=lambda s: s.get('upside_percent') or 0, reverse=True)
    elif preset == 'overvalued':
        filtered = [s for s in stocks if s.get('upside_percent') is not None and s['upside_percent'] <= -5]
        if not filtered:
            filtered = [s for s in stocks if s.get('upside_percent') is not None]
            filtered.sort(key=lambda s: s.get('upside_percent') or 0, reverse=False)
        else:
            filtered.sort(key=lambda s: s.get('upside_percent') or 0, reverse=False)
    elif preset == 'top_dividends':
        filtered = [s for s in stocks if (s.get('dividend_yield') or 0) > 0]
        if not filtered:
            filtered = list(stocks)
        filtered.sort(key=lambda s: s.get('dividend_yield') or 0, reverse=True)
    elif preset == 'lowest_risk':
        filtered = [s for s in stocks if (s.get('beta') or 1.0) <= 1.2 or (s.get('current_ratio') or 0) > 0.8]
        if not filtered:
            filtered = list(stocks)
        filtered.sort(key=lambda s: (s.get('beta') if s.get('beta') is not None else 1.0))
    else:
        filtered = list(stocks)

    return filtered[:limit]


# ============================================================================
# ROUTES
# ============================================================================

@stocks_bp.route('/api/stocks/presets/list', methods=['GET'])
def list_presets():
    """Return the list of available screener presets."""
    return jsonify({'success': True, 'presets': PRESET_META})


@stocks_bp.route('/api/stocks/presets', methods=['GET'])
def get_stock_presets():
    """
    Get pre-computed screener presets from screener_presets table.
    Falls back to ON-THE-FLY computation when table is empty.

    Query params:
    - preset: one of VALID_PRESETS (required)
    - market: filter by market (EGX, TADAWUL, KSE, QSE, DFM, ADX)
    - period: 1d (default) | 1w | 1m — used by gainers/losers
    - limit: max results (default 50, capped at 200)
    """
    conn = None
    try:
        preset = (request.args.get('preset') or '').strip()
        market = (request.args.get('market') or '').strip()
        period = (request.args.get('period') or '1d').strip()
        limit = min(request.args.get('limit', 50, type=int), 200)

        if preset not in VALID_PRESETS:
            return jsonify({
                'success': False,
                'error': f'Invalid preset. Available: {VALID_PRESETS}',
            }), 400

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(DBPaths.STOCKS_DB, writable=False)
        conn.row_factory = sqlite3.Row

        # Ensure table exists (matches existing schema)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS screener_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                preset TEXT NOT NULL,
                ticker TEXT NOT NULL,
                name TEXT,
                name_ar TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                current_price REAL,
                previous_close REAL,
                change_1d REAL,
                change_1w REAL,
                change_1m REAL,
                volume INTEGER,
                volume_week INTEGER,
                volume_month INTEGER,
                turnover_egp REAL,
                fair_value REAL,
                upside_percent REAL,
                market_cap REAL,
                pe_ratio REAL,
                computed_at TEXT DEFAULT (datetime('now')),
                UNIQUE(ticker, market, preset)
            )
        """)
        conn.commit()

        # ── Try persisted table first ──
        where_extra = ''
        if preset == 'undervalued':
            where_extra = 'AND upside_percent IS NOT NULL AND upside_percent >= 5'
        elif preset == 'overvalued':
            where_extra = 'AND upside_percent IS NOT NULL AND upside_percent <= -5'
        elif preset in ('top_gainers', 'top_losers'):
            if period == '1w':
                where_extra = 'AND change_1w IS NOT NULL'
            elif period == '1m':
                where_extra = 'AND change_1m IS NOT NULL'

        order_col = 'turnover_egp'
        order_dir = 'DESC'
        if preset == 'undervalued':
            order_col, order_dir = 'upside_percent', 'DESC'
        elif preset == 'overvalued':
            order_col, order_dir = 'upside_percent', 'ASC'
        elif preset == 'top_gainers':
            if period == '1w':
                order_col = 'change_1w'
            elif period == '1m':
                order_col = 'change_1m'
            else:
                order_col = 'change_1d'
            order_dir = 'DESC'
        elif preset == 'top_losers':
            if period == '1w':
                order_col = 'change_1w'
            elif period == '1m':
                order_col = 'change_1m'
            else:
                order_col = 'change_1d'
            order_dir = 'ASC'

        params = [preset]
        query = f"""
            SELECT ticker, name, name_ar, market, sector,
                   current_price, previous_close,
                   change_1d, change_1w, change_1m,
                   volume, volume_week, volume_month,
                   turnover_egp, fair_value, upside_percent,
                   market_cap, pe_ratio, computed_at
            FROM screener_presets
            WHERE preset = ?
            {where_extra}
        """
        if market:
            query += ' AND market = ?'
            params.append(market)
        query += f' ORDER BY {order_col} {order_dir} LIMIT ?'
        params.append(limit)

        rows = conn.execute(query, params).fetchall()

        if rows:
            results = []
            for r in rows:
                results.append({
                    'ticker': r['ticker'],
                    'name': r['name'],
                    'name_ar': r['name_ar'],
                    'market': r['market'],
                    'sector': r['sector'],
                    'current_price': r['current_price'],
                    'previous_close': r['previous_close'],
                    'change_1d': r['change_1d'],
                    'change_1w': r['change_1w'],
                    'change_1m': r['change_1m'],
                    'volume': r['volume'],
                    'volume_week': r['volume_week'],
                    'volume_month': r['volume_month'],
                    'turnover_egp': r['turnover_egp'],
                    'fair_value': r['fair_value'],
                    'upside_percent': r['upside_percent'],
                    'market_cap': r['market_cap'],
                    'pe_ratio': r['pe_ratio'],
                })
            scan_date = rows[0]['computed_at']
            return jsonify({
                'success': True,
                'preset': preset,
                'preset_name': PRESET_NAMES.get(preset, preset),
                'period': period,
                'count': len(results),
                'scan_date': scan_date,
                'source': 'persisted',
                'results': results,
            })

        # ── Fallback: ON-THE-FLY computation ──
        conn.close()
        conn = None

        enriched = _fetch_live_enriched_stocks(market=market, limit=500)
        results = _filter_and_sort_preset(enriched, preset, period, limit)

        return jsonify({
            'success': True,
            'preset': preset,
            'preset_name': PRESET_NAMES.get(preset, preset),
            'period': period,
            'count': len(results),
            'scan_date': datetime.now().isoformat(),
            'source': 'live_computed',
            'results': results,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


@stocks_bp.route('/api/stocks/computed', methods=['GET'])
def get_computed_stocks():
    """
    Return all stocks enriched with fair_value + 1w/1m stats (on-the-fly).
    Heavier than /api/stocks/list — use when you need fair_value or change_1w/1m
    for the full universe.

    Query params:
    - market: filter by market
    - limit: max results (default 200, capped at 500)
    """
    try:
        market = (request.args.get('market') or '').strip()
        limit = min(request.args.get('limit', 200, type=int), 500)
        enriched = _fetch_live_enriched_stocks(market=market, limit=limit)
        return jsonify({
            'success': True,
            'count': len(enriched),
            'market_filter': market.upper() if market else None,
            'stocks': enriched,
            'data': enriched,
            'source': 'live_computed',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

"""
Advanced Screener Routes Blueprint
====================================
شاشة فلترة الأسهم الموحدة — على نمط TradingView Screener

الـ logic كله في Python (يقرأ stocks.db) — Node مجرد proxy.

Endpoints:
- GET /api/screener/advanced — فلترة متقدمة + بيانات كاملة + أعلى الأرباح/الخسائر
"""

import sqlite3
from flask import Blueprint, request, jsonify

from utils.db_paths import DBPaths

advanced_screener_bp = Blueprint('advanced_screener', __name__)


def _get_stocks_conn():
    """Get a connection to stocks.db."""
    conn = sqlite3.connect(DBPaths.STOCKS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _safe_float(val, default=None):
    try:
        if val is None:
            return default
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


@advanced_screener_bp.route('/api/screener/advanced', methods=['GET'])
def advanced_screener():
    """
    شاشة فلترة الأسهم الموحدة — TradingView-style screener.

    Query params:
      - market: EGX | Tadawul | Kuwait | Qatar (default: EGX)
      - sector: filter by sector (LIKE)
      - sort: ticker | change_percent | volume | market_cap | pe_ratio | roe |
              rsi | turnover_egp | dividend_yield | high_52w | low_52w
              (default: turnover_egp)
      - order: asc | desc (default: desc)
      - limit: max 500 (default: 100)
      - min_price: minimum current_price
      - max_price: maximum current_price
      - min_volume: minimum volume
      - min_turnover: minimum turnover_egp
      - min_change: minimum ABS(change_percent)
      - trend: up | down | neutral
      - above_ma: 50 | 200 | both
      - rsi_oversold: 1 (RSI < 30)
      - rsi_overbought: 1 (RSI > 70)
      - volume_surge: 1 (volume > 1.5× avg_volume)
      - near_52w_high: 1 (within 5% of high_52w)
      - near_52w_low: 1 (within 5% of low_52w)

    Returns:
      - stocks: list of full stock data
      - total: count
      - sectors: list of distinct sectors for filter dropdown
      - summary: {total, advancers, decliners, avg_change, total_turnover}
    """
    try:
        market = request.args.get('market', 'EGX').strip()
        sector = request.args.get('sector', '').strip()
        sort_by = request.args.get('sort', 'turnover_egp').strip()
        order = request.args.get('order', 'desc').strip().lower()
        limit = min(int(request.args.get('limit', '100')), 500)

        # Optional filters
        min_price = request.args.get('min_price', type=float)
        max_price = request.args.get('max_price', type=float)
        min_volume = request.args.get('min_volume', type=float)
        min_turnover = request.args.get('min_turnover', type=float)
        min_change = request.args.get('min_change', type=float)
        trend_filter = request.args.get('trend', '').strip().lower()
        above_ma = request.args.get('above_ma', '').strip()
        rsi_oversold = request.args.get('rsi_oversold', '0') == '1'
        rsi_overbought = request.args.get('rsi_overbought', '0') == '1'
        volume_surge = request.args.get('volume_surge', '0') == '1'
        near_52w_high = request.args.get('near_52w_high', '0') == '1'
        near_52w_low = request.args.get('near_52w_low', '0') == '1'

        # Validate sort field (prevent SQL injection)
        valid_sorts = {'ticker', 'change_percent', 'volume', 'market_cap', 'pe_ratio',
                       'roe', 'rsi', 'turnover_egp', 'dividend_yield', 'high_52w',
                       'low_52w', 'avg_volume', 'current_price', 'name'}
        if sort_by not in valid_sorts:
            sort_by = 'turnover_egp'
        order_dir = 'DESC' if order == 'desc' else 'ASC'

        conn = _get_stocks_conn()
        try:
            # Build query
            where_clauses = ['is_active = 1', 'current_price > 0']
            params = []

            if market and market != 'ALL':
                where_clauses.append('market = ?')
                params.append(market)

            if sector:
                where_clauses.append('sector LIKE ?')
                params.append(f'%{sector}%')

            if min_price is not None:
                where_clauses.append('current_price >= ?')
                params.append(min_price)

            if max_price is not None:
                where_clauses.append('current_price <= ?')
                params.append(max_price)

            if min_volume is not None:
                where_clauses.append('volume >= ?')
                params.append(min_volume)

            if min_turnover is not None:
                where_clauses.append('turnover_egp >= ?')
                params.append(min_turnover)

            if min_change is not None:
                where_clauses.append('ABS(change_percent) >= ?')
                params.append(min_change)

            if trend_filter == 'up':
                where_clauses.append('change_percent > 0')
            elif trend_filter == 'down':
                where_clauses.append('change_percent < 0')
            elif trend_filter == 'neutral':
                where_clauses.append('ABS(change_percent) < 0.5')

            if above_ma == '50':
                where_clauses.append('ma_50 IS NOT NULL AND current_price > ma_50')
            elif above_ma == '200':
                where_clauses.append('ma_200 IS NOT NULL AND current_price > ma_200')
            elif above_ma == 'both':
                where_clauses.append('ma_50 IS NOT NULL AND ma_200 IS NOT NULL AND current_price > ma_50 AND current_price > ma_200')

            if rsi_oversold:
                where_clauses.append('rsi IS NOT NULL AND rsi < 30')
            if rsi_overbought:
                where_clauses.append('rsi IS NOT NULL AND rsi > 70')

            if volume_surge:
                where_clauses.append('avg_volume IS NOT NULL AND avg_volume > 0 AND volume > avg_volume * 1.5')

            if near_52w_high:
                where_clauses.append('high_52w IS NOT NULL AND high_52w > 0 AND current_price >= high_52w * 0.95')
            if near_52w_low:
                where_clauses.append('low_52w IS NOT NULL AND low_52w > 0 AND current_price <= low_52w * 1.05')

            where_sql = ' AND '.join(where_clauses)

            # Fetch stocks
            query = f"""
                SELECT ticker, name, name_ar, market, sector, industry,
                       current_price, change_percent, volume, market_cap,
                       pe_ratio, pb_ratio, eps, roe, roa, debt_to_equity,
                       dividend_yield, profit_margin, ma_50, ma_200, rsi,
                       trend, signal, beta, high_52w, low_52w, avg_volume,
                       turnover_egp, value_traded, is_egx30, is_egx70, is_egx100,
                       free_float_percentage, dps_ttm, book_value_per_share,
                       support, resistance
                FROM stocks
                WHERE {where_sql}
                ORDER BY {sort_by} {order_dir}
                LIMIT ?
            """
            params.append(limit)

            rows = conn.execute(query, params).fetchall()

            # Build result
            stocks = []
            for r in rows:
                vol = _safe_float(r['volume'], 0) or 0
                avg_vol = _safe_float(r['avg_volume'], 0) or 0
                vol_surge = (avg_vol > 0 and vol > avg_vol * 1.5)
                current = _safe_float(r['current_price'], 0) or 0
                high52 = _safe_float(r['high_52w'])
                low52 = _safe_float(r['low_52w'])
                dist_high = ((current - high52) / high52 * 100) if (high52 and high52 > 0 and current > 0) else None
                dist_low = ((current - low52) / low52 * 100) if (low52 and low52 > 0 and current > 0) else None

                stocks.append({
                    'ticker': r['ticker'],
                    'name': r['name'] or r['ticker'],
                    'name_ar': r['name_ar'] or r['name'] or r['ticker'],
                    'market': r['market'] or '',
                    'sector': r['sector'] or '',
                    'industry': r['industry'] or '',
                    'current_price': round(current, 2),
                    'change_percent': round(_safe_float(r['change_percent'], 0) or 0, 2),
                    'volume': int(vol),
                    'market_cap': round(_safe_float(r['market_cap'], 0) or 0, 0),
                    'pe_ratio': _safe_float(r['pe_ratio']),
                    'pb_ratio': _safe_float(r['pb_ratio']),
                    'eps': _safe_float(r['eps']),
                    'roe': _safe_float(r['roe']),
                    'roa': _safe_float(r['roa']),
                    'debt_to_equity': _safe_float(r['debt_to_equity']),
                    'dividend_yield': _safe_float(r['dividend_yield']),
                    'profit_margin': _safe_float(r['profit_margin']),
                    'ma_50': _safe_float(r['ma_50']),
                    'ma_200': _safe_float(r['ma_200']),
                    'rsi': _safe_float(r['rsi']),
                    'trend': r['trend'] or '',
                    'signal': _safe_float(r['signal']),
                    'beta': _safe_float(r['beta']),
                    'high_52w': high52,
                    'low_52w': low52,
                    'avg_volume': int(avg_vol) if avg_vol else 0,
                    'turnover_egp': round(_safe_float(r['turnover_egp'], 0) or 0, 0),
                    'value_traded': round(_safe_float(r['value_traded'], 0) or 0, 0),
                    'is_egx30': bool(r['is_egx30']),
                    'is_egx70': bool(r['is_egx70']),
                    'is_egx100': bool(r['is_egx100']),
                    'free_float_percentage': _safe_float(r['free_float_percentage']),
                    'dps_ttm': _safe_float(r['dps_ttm']),
                    'book_value_per_share': _safe_float(r['book_value_per_share']),
                    'support': _safe_float(r['support']),
                    'resistance': _safe_float(r['resistance']),
                    'volume_surge': vol_surge,
                    'above_ma_50': bool(r['ma_50'] and current > r['ma_50']),
                    'above_ma_200': bool(r['ma_200'] and current > r['ma_200']),
                    'distance_from_52w_high': round(dist_high, 1) if dist_high is not None else None,
                    'distance_from_52w_low': round(dist_low, 1) if dist_low is not None else None,
                })

            # Get sectors list
            sector_rows = conn.execute("""
                SELECT DISTINCT sector FROM stocks
                WHERE is_active = 1 AND sector IS NOT NULL AND sector != ''
                ORDER BY sector
            """).fetchall()
            sectors = [r['sector'] for r in sector_rows]

            # Summary
            total = len(stocks)
            advancers = sum(1 for s in stocks if s['change_percent'] > 0)
            decliners = sum(1 for s in stocks if s['change_percent'] < 0)
            avg_change = sum(s['change_percent'] for s in stocks) / total if total > 0 else 0
            total_turnover = sum(s['turnover_egp'] for s in stocks)

            return jsonify({
                'success': True,
                'stocks': stocks,
                'total': total,
                'sectors': sectors,
                'summary': {
                    'total': total,
                    'advancers': advancers,
                    'decliners': decliners,
                    'unchanged': total - advancers - decliners,
                    'avg_change': round(avg_change, 2),
                    'total_turnover': round(total_turnover, 0),
                    'volume_surge_count': sum(1 for s in stocks if s['volume_surge']),
                },
                'filters': {
                    'market': market,
                    'sector': sector,
                    'sort': sort_by,
                    'order': order_dir,
                    'limit': limit,
                },
            })
        finally:
            conn.close()
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }), 500


def register_advanced_screener_routes(app):
    """Register the advanced screener blueprint."""
    app.register_blueprint(advanced_screener_bp)

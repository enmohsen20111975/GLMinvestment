"""
Sector Tracking Routes Blueprint
=================================
Endpoints لتتبع حركة القطاعات (السيولة + الزخم + الحركة)

الـ logic كله في Python (engine/flow_system.py + analyzers) — Node مجرد proxy.

Endpoints:
- GET /api/sectors/tracking — تتبع شامل للقطاعات (heatmap + rotation + stocks per sector)
- GET /api/sectors/<sector_name>/stocks — الأسهم المنتمية لقطاع محدد
"""

import sqlite3
from flask import Blueprint, request, jsonify

from utils.db_paths import DBPaths

# Phase 8.4: ApiResponseCache — endpoint-level response caching
try:
    from core.cache_manager import api_cache
    _API_CACHE_AVAILABLE = True
except Exception:
    _API_CACHE_AVAILABLE = False

sector_tracking_bp = Blueprint('sector_tracking', __name__)


def _get_stocks_conn():
    """Get a connection to stocks.db."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DBPaths.STOCKS_DB, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def _safe_float(val, default=0.0):
    try:
        if val is None:
            return default
        f = float(val)
        if f != f:  # NaN check
            return default
        return f
    except (TypeError, ValueError):
        return default


@sector_tracking_bp.route('/api/sectors/tracking', methods=['GET'])
def get_sector_tracking():
    """
    تتبع شامل لحركة القطاعات — يجمع heatmap + rotation + stocks per sector.

    Query params:
      - market: فلترة بالسوق (EGX، إلخ) — default: EGX
      - with_rotation: 1 لإضافة detect_sector_rotation (default: 0 — أبطأ)
      - with_stocks: 1 لإضافة قائمة الأسهم لكل قطاع (default: 1)
      - sort: ترتيب القطاعات (avg_change | turnover | stock_count | breadth |
              gainers | losers | turnover_pct | sector | heat_level |
              total_market_cap | leader_change) — default: turnover
      - order: asc | desc — default: desc
      - min_avg_change: فلترة القطاعات بمتوسط تغير ≥ القيمة (default: لا فلتر)
      - heat_level: فلترة بـ heat level (HOT | WARM | NEUTRAL | COOL | COLD)

    Returns:
      - sectors: list of {sector, stock_count, avg_change, turnover, turnover_pct,
                          breadth, heat_level, heat_ar, gainers, losers,
                          leader_ticker, leader_change, total_market_cap,
                          stocks: [...]}
          - stocks[]: {ticker, name, name_ar, current_price, change_percent,
                       volume, turnover_egp, market_cap, avg_volume, volume_surge,
                       rsi, ma_50, ma_200, above_ma50, trend,
                       high_52w, low_52w, distance_from_52w_high, distance_from_52w_low}
      - rotation (optional): {entering: [...], leaving: [...], stable: [...],
                              rotation_signals: [...]}
      - market_summary: {total_stocks, total_sectors, advancers, decliners,
                         avg_change, total_turnover}
    """
    try:
        market = request.args.get('market', 'EGX').strip()
        with_rotation = request.args.get('with_rotation', '0') == '1'
        with_stocks = request.args.get('with_stocks', '1') == '1'
        # NEW: sort + filter params for table view
        sort_by = request.args.get('sort', 'turnover').strip()
        order = request.args.get('order', 'desc').strip().lower()
        min_avg_change = request.args.get('min_avg_change', type=float)
        heat_level_filter = request.args.get('heat_level', '').strip().upper()

        # Validate sort field
        valid_sorts = {'avg_change', 'turnover', 'stock_count', 'breadth',
                       'gainers', 'losers', 'turnover_pct', 'sector', 'heat_level',
                       'total_market_cap', 'leader_change'}
        if sort_by not in valid_sorts:
            sort_by = 'turnover'
        order_dir = 'desc' if order == 'desc' else 'asc'

        # ── Phase 8.4: ApiResponseCache check ────────────────────────────────
        # Cache key includes ALL filter params so different views get separate
        # cache entries. TTL=300s (sector data changes on minute-scale).
        _cache_params = {
            'market': market,
            'with_rotation': str(with_rotation),
            'with_stocks': str(with_stocks),
            'sort': sort_by,
            'order': order_dir,
            'min_avg_change': str(min_avg_change) if min_avg_change is not None else '',
            'heat_level': heat_level_filter or '',
        }
        if _API_CACHE_AVAILABLE:
            _cached = api_cache.get('sector_tracking', params=_cache_params)
            if _cached is not None:
                _cached['cached'] = True
                _cached['cache_ttl'] = 300
                return jsonify(_cached)

        # === Use the existing FlowSystemEngine.get_sector_heatmap() ===
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine(DBPaths.STOCKS_DB)
        heatmap = engine.get_sector_heatmap()

        # Filter by market if specified (heatmap returns all markets)
        # Note: heatmap groups by sector across all markets. For per-market,
        # we filter the stocks per sector below.

        # === Get stocks per sector (with all the data: liquidity, momentum, change) ===
        conn = _get_stocks_conn()
        try:
            # Get all active stocks with their sector + key fields
            stocks_query = """
                SELECT ticker, name, name_ar, market, sector,
                       current_price, change_percent, volume, market_cap,
                       avg_volume, rsi, ma_50, ma_200, high_52w, low_52w,
                       trend, is_active
                FROM stocks
                WHERE is_active = 1
                  AND current_price > 0
                  AND sector IS NOT NULL AND sector != ''
            """
            if market and market != 'ALL':
                stocks_query += " AND market = ?"
                params = (market,)
            else:
                params = ()

            all_stocks = conn.execute(stocks_query, params).fetchall()

            # Group stocks by sector
            stocks_by_sector = {}
            for s in all_stocks:
                sector = s['sector']
                if sector not in stocks_by_sector:
                    stocks_by_sector[sector] = []
                stocks_by_sector[sector].append(dict(s))

            # Sort each sector's stocks by change_percent DESC (top movers first)
            for sector in stocks_by_sector:
                stocks_by_sector[sector].sort(
                    key=lambda x: _safe_float(x.get('change_percent')),
                    reverse=True
                )

            # === Compute market summary ===
            total_stocks = len(all_stocks)
            advancers = sum(1 for s in all_stocks if _safe_float(s['change_percent']) > 0)
            decliners = sum(1 for s in all_stocks if _safe_float(s['change_percent']) < 0)
            avg_change = sum(_safe_float(s['change_percent']) for s in all_stocks) / total_stocks if total_stocks > 0 else 0
            total_turnover = sum(_safe_float(s['volume']) * _safe_float(s['current_price']) for s in all_stocks)

            # === Enrich heatmap with: leader_ticker, stocks list (per market filter) ===
            enriched_sectors = []
            for h in heatmap:
                sector_name = h['sector']
                sector_stocks = stocks_by_sector.get(sector_name, [])

                # Filter heatmap by market if specified (recompute sector stats
                # from the market-filtered stocks)
                if market and market != 'ALL' and sector_stocks:
                    # Recompute heatmap stats from filtered stocks
                    stock_count = len(sector_stocks)
                    avg_ch = sum(_safe_float(s['change_percent']) for s in sector_stocks) / stock_count if stock_count > 0 else 0
                    turnover = sum(_safe_float(s['volume']) * _safe_float(s['current_price']) for s in sector_stocks)
                    gainers = sum(1 for s in sector_stocks if _safe_float(s['change_percent']) > 0)
                    losers = sum(1 for s in sector_stocks if _safe_float(s['change_percent']) < 0)
                    breadth = (gainers / stock_count * 100) if stock_count > 0 else 0

                    # Heat level (same logic as FlowSystemEngine)
                    if avg_ch > 2 and turnover > total_turnover * 0.15:
                        heat = "HOT"; heat_ar = "نار 🔥"
                    elif avg_ch > 0.5:
                        heat = "WARM"; heat_ar = "دافئ"
                    elif avg_ch < -2:
                        heat = "COLD"; heat_ar = "بارد ❄️"
                    elif avg_ch < -0.5:
                        heat = "COOL"; heat_ar = "بارد"
                    else:
                        heat = "NEUTRAL"; heat_ar = "محايد"
                else:
                    stock_count = h['stock_count']
                    avg_ch = h['avg_change']
                    # BRAVO-TURNOVER-FIX (2026-10-20, owner directive):
                    # الـ h['turnover'] من FlowSystemEngine تراكمي تاريخي (163 مليار).
                    # خلطه مع total_turnover اللحظي (7.45 مليار) بـ يـطلع 2194% — فضيحة.
                    # الحل: recompute من sector_stocks (نفس مصدر total_turnover = لحظي يومي).
                    turnover = sum(_safe_float(s['volume']) * _safe_float(s['current_price']) for s in sector_stocks) if sector_stocks else 0
                    gainers = h['gainers']
                    losers = h['losers']
                    breadth = h['breadth']
                    heat = h['heat']
                    heat_ar = h['heat_ar']

                # Leader ticker (top stock in sector)
                leader_ticker = sector_stocks[0]['ticker'] if sector_stocks else None
                leader_change = _safe_float(sector_stocks[0]['change_percent']) if sector_stocks else None

                # Total market cap for the sector (sum of all sector stocks' market_cap)
                sector_market_cap = sum(_safe_float(s.get('market_cap')) for s in sector_stocks)

                # Stocks list (limited to top 20 per sector for performance)
                stocks_list = []
                if with_stocks and sector_stocks:
                    for s in sector_stocks[:20]:
                        vol = _safe_float(s['volume'])
                        price = _safe_float(s['current_price'])
                        avg_vol = _safe_float(s.get('avg_volume'))
                        vol_surge = (avg_vol > 0 and vol > avg_vol * 1.5)
                        turnover_egp = vol * price
                        # Distance from 52-week high / low (in %)
                        high_52w = _safe_float(s.get('high_52w'))
                        low_52w = _safe_float(s.get('low_52w'))
                        if high_52w > 0 and price > 0:
                            dist_from_high = round(((high_52w - price) / high_52w) * 100, 1)
                        else:
                            dist_from_high = None
                        if low_52w > 0 and price > 0:
                            dist_from_low = round(((price - low_52w) / low_52w) * 100, 1)
                        else:
                            dist_from_low = None
                        # Above / below MA50
                        ma_50_val = _safe_float(s.get('ma_50'))
                        above_ma50 = (ma_50_val > 0 and price > ma_50_val) if ma_50_val else None
                        stocks_list.append({
                            'ticker': s['ticker'],
                            'name': s['name'] or s['ticker'],
                            'name_ar': s.get('name_ar') or s['name'] or s['ticker'],
                            'current_price': round(price, 4),
                            'change_percent': round(_safe_float(s['change_percent']), 2),
                            'volume': int(vol) if vol else 0,
                            'turnover_egp': round(turnover_egp, 0),
                            'market_cap': _safe_float(s.get('market_cap')),
                            'avg_volume': int(avg_vol) if avg_vol else 0,
                            'volume_surge': vol_surge,
                            'rsi': _safe_float(s.get('rsi')) if s.get('rsi') else None,
                            'ma_50': _safe_float(s.get('ma_50')) if s.get('ma_50') else None,
                            'ma_200': _safe_float(s.get('ma_200')) if s.get('ma_200') else None,
                            'above_ma50': above_ma50,
                            'trend': s.get('trend'),
                            'high_52w': high_52w if high_52w else None,
                            'low_52w': low_52w if low_52w else None,
                            'distance_from_52w_high': dist_from_high,
                            'distance_from_52w_low': dist_from_low,
                        })

                enriched_sectors.append({
                    'sector': sector_name,
                    'stock_count': stock_count,
                    'avg_change': round(avg_ch, 2),
                    'turnover': round(turnover, 0),
                    'turnover_pct': round((turnover / total_turnover * 100) if total_turnover > 0 else 0, 1),
                    'gainers': gainers,
                    'losers': losers,
                    'breadth': round(breadth, 1),
                    'heat_level': heat,
                    'heat_ar': heat_ar,
                    'leader_ticker': leader_ticker,
                    'leader_change': round(leader_change, 2) if leader_change is not None else None,
                    'total_market_cap': round(sector_market_cap, 0),
                    'stocks': stocks_list,
                })

            # Sort sectors by requested field (sort + order from query params)
            reverse = (order_dir == 'desc')

            # Mixed-type sort: separate numeric and string keys to avoid Python
            # comparing str vs float. We sort by (type_rank, value) where
            # numbers rank first (0), strings second (1), None/unknown last (2).
            def _typed_sort_key(x):
                v = x.get(sort_by)
                if isinstance(v, bool):
                    return (0, int(v))
                if isinstance(v, (int, float)) and v == v:  # not NaN
                    return (0, v)
                if isinstance(v, str):
                    return (1, v.lower())
                # None / unknown → last
                return (2, '')

            enriched_sectors.sort(key=_typed_sort_key, reverse=reverse)

            # Apply filters (min_avg_change + heat_level)
            if min_avg_change is not None:
                enriched_sectors = [s for s in enriched_sectors if s['avg_change'] >= min_avg_change]
            if heat_level_filter:
                enriched_sectors = [s for s in enriched_sectors if s['heat_level'] == heat_level_filter]

            # === Optional: rotation detection ===
            rotation = None
            if with_rotation:
                try:
                    rotation = engine.detect_sector_rotation(lookback_days=5, min_turnover_change=0.3)
                except Exception as rot_e:
                    rotation = {'error': str(rot_e)}

            # Build response payload (Phase 8.4: cached before jsonify).
            _response_data = {
                'success': True,
                'market': market,
                'sectors': enriched_sectors,
                'market_summary': {
                    'total_stocks': total_stocks,
                    'total_sectors': len(enriched_sectors),
                    'advancers': advancers,
                    'decliners': decliners,
                    'breadth': round((advancers - decliners) / total_stocks * 100, 1) if total_stocks > 0 else 0,
                    'avg_change': round(avg_change, 2),
                    'total_turnover': round(total_turnover, 0),
                },
                'rotation': rotation,
                'filters': {
                    'market': market,
                    'with_rotation': with_rotation,
                    'with_stocks': with_stocks,
                    'sort': sort_by,
                    'order': order_dir,
                    'min_avg_change': min_avg_change,
                    'heat_level': heat_level_filter or None,
                },
            }
            # ── Phase 8.4: cache + return fresh response ────────────────────
            _response_data['cached'] = False
            _response_data['cache_ttl'] = 300
            if _API_CACHE_AVAILABLE:
                api_cache.set('sector_tracking', _response_data, ttl=300, params=_cache_params)
            return jsonify(_response_data)
        finally:
            conn.close()
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }), 500


@sector_tracking_bp.route('/api/sectors/<path:sector_name>/stocks', methods=['GET'])
def get_sector_stocks(sector_name):
    """الأسهم المنتمية لقطاع محدد (مع كل البيانات: سيولة، زخم، تغير)."""
    try:
        market = request.args.get('market', 'EGX').strip()
        limit = min(int(request.args.get('limit', '100')), 500)
        sort_by = request.args.get('sort', 'change_percent')  # change_percent, volume, market_cap
        order = request.args.get('order', 'desc')

        # Validate sort field
        valid_sorts = {'change_percent', 'volume', 'market_cap', 'current_price'}
        if sort_by not in valid_sorts:
            sort_by = 'change_percent'
        order_dir = 'DESC' if order.lower() == 'desc' else 'ASC'

        conn = _get_stocks_conn()
        try:
            query = f"""
                SELECT ticker, name, name_ar, market, sector,
                       current_price, change_percent, volume, market_cap,
                       avg_volume, rsi, ma_50, ma_200, high_52w, low_52w, trend
                FROM stocks
                WHERE is_active = 1
                  AND current_price > 0
                  AND sector LIKE ?
            """
            params = [f"%{sector_name}%"]
            if market and market != 'ALL':
                query += " AND market = ?"
                params.append(market)

            query += f" ORDER BY {sort_by} {order_dir} LIMIT ?"
            params.append(limit)

            rows = conn.execute(query, params).fetchall()

            stocks = []
            for s in rows:
                vol = _safe_float(s['volume'])
                avg_vol = _safe_float(s.get('avg_volume'))
                vol_surge = (avg_vol > 0 and vol > avg_vol * 1.5)
                stocks.append({
                    'ticker': s['ticker'],
                    'name': s['name'] or s['ticker'],
                    'name_ar': s.get('name_ar') or s['name'] or s['ticker'],
                    'market': s['market'],
                    'sector': s['sector'],
                    'current_price': _safe_float(s['current_price']),
                    'change_percent': round(_safe_float(s['change_percent']), 2),
                    'volume': int(vol) if vol else 0,
                    'market_cap': _safe_float(s.get('market_cap')),
                    'avg_volume': int(avg_vol) if avg_vol else 0,
                    'volume_surge': vol_surge,
                    'rsi': _safe_float(s.get('rsi')) if s.get('rsi') else None,
                    'ma_50': _safe_float(s.get('ma_50')) if s.get('ma_50') else None,
                    'ma_200': _safe_float(s.get('ma_200')) if s.get('ma_200') else None,
                    'high_52w': _safe_float(s.get('high_52w')) if s.get('high_52w') else None,
                    'low_52w': _safe_float(s.get('low_52w')) if s.get('low_52w') else None,
                    'trend': s.get('trend'),
                })

            return jsonify({
                'success': True,
                'sector': sector_name,
                'market': market,
                'count': len(stocks),
                'stocks': stocks,
            })
        finally:
            conn.close()
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def register_sector_tracking_routes(app):
    """Register the sector tracking blueprint."""
    app.register_blueprint(sector_tracking_bp)

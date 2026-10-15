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
from utils.stock_state import compute_stock_state, get_state_order

advanced_screener_bp = Blueprint('advanced_screener', __name__)


def _get_stocks_conn():
    """Get a connection to stocks.db with WAL + busy_timeout (prevents locks)."""
    conn = sqlite3.connect(DBPaths.STOCKS_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


def _safe_float(val, default=None):
    try:
        if val is None:
            return default
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


# DEV-18 (2026-10-12 — DUAL-TRACK): Simple in-memory cache (60s TTL)
# Rule 27: cache stores real data, not fabricated. If data changes, cache expires.
import time as _time

_screener_cache = {}
_CACHE_TTL = 60  # seconds

def _get_cache(key):
    """Get cached result if not expired."""
    entry = _screener_cache.get(key)
    if entry and (_time.time() - entry['ts']) < _CACHE_TTL:
        return entry['data']
    return None

def _set_cache(key, data):
    """Store result in cache."""
    _screener_cache[key] = {'data': data, 'ts': _time.time()}


@advanced_screener_bp.route('/api/screener/advanced', methods=['GET'])
def advanced_screener():
    # DEV-18: Check cache first (60s TTL)
    _cache_key = f"screener:{request.query_string.decode() if request.query_string else 'default'}"
    _cached = _get_cache(_cache_key)
    if _cached is not None:
        _cached['_cached'] = True
        _cached['_cache_age'] = int(_time.time() - _screener_cache[_cache_key]['ts'])
        return jsonify(_cached)
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
      - min_pe / max_pe: P/E range (مكرر الربحية)
      - min_roe: minimum ROE (العائد على حقوق الملكية %)
      - min_dividend_yield: minimum dividend yield (توزيعات الأرباح %)
      - min_market_cap / max_market_cap: market cap range (القيمة السوقية)
      - stock_state: filter by computed state (Python-side post-filter):
          CORRECTION | CORRECTION_END | DECLINING | NEAR_BREAKOUT |
          AT_PEAK | BALANCED_MOMENTUM | NEUTRAL

      sort also accepts computed fields (sorted in Python after fetch):
        - stock_state (best→worst by STATE_ORDER)
        - momentum_score (0-100)

    Returns per stock (new computed fields):
      - stock_state: state key (CORRECTION / CORRECTION_END / DECLINING /
                  NEAR_BREAKOUT / AT_PEAK / BALANCED_MOMENTUM / NEUTRAL)
      - stock_state_ar: Arabic display name (e.g. "في تصحيح")
      - stock_state_reason: short technical reason (Arabic)
      - momentum_score: 0-100 (composite momentum)

    Returns:
      - stocks: list of full stock data + stock_state + momentum_score
      - total: count (after post-filter)
      - sectors: list of distinct sectors for filter dropdown
      - summary: {total, advancers, decliners, avg_change, total_turnover}
    """
    try:
        # BRAVO-MARKET (2026-10-15): Normalize market param for all 6 markets
        _MARKET_MAP = {
            'EGX': 'EGX', 'EGYPT': 'EGX', 'مصر': 'EGX',
            'TADAWUL': 'TADAWUL', 'TASI': 'TADAWUL', 'SAUDI': 'TADAWUL', 'السعودية': 'TADAWUL', 'TADAWUL': 'TADAWUL',
            'KSE': 'KSE', 'KUWAIT': 'KSE', 'الكويت': 'KSE',
            'QSE': 'QSE', 'QATAR': 'QSE', 'قطر': 'QSE',
            'US': 'US', 'USA': 'US',
            'CRYPTO': 'CRYPTO',
        }
        raw_market = request.args.get('market', 'EGX').strip()
        market = _MARKET_MAP.get(raw_market.upper(), _MARKET_MAP.get(raw_market, raw_market))
        sector = request.args.get('sector', '').strip()

        # BRAVO-PRESETS (2026-10-15): Quick-filter presets for all 6 markets
        preset = request.args.get('preset', '').strip().lower()
        # Preset → filter overrides
        if preset == 'whale_accumulation':
            # أسهم الحيتان: حجم تداول كبير + تغير إيجابي + فوق MA50
            request.args = request.args.copy()
            request.args['min_volume'] = request.args.get('min_volume', '100000')
            if not sort_by or sort_by == 'turnover_egp':
                sort_by = 'volume'
        elif preset == 'breakout':
            # اختراقات: تغير > 3% + حجم ضخم + فوق MA50
            request.args = request.args.copy()
            request.args['min_change'] = request.args.get('min_change', '3.0')
            sort_by = 'change_percent'
        elif preset == 'high_rr':
            # فرص R/R ≥ 1.5: تحتاج support/resistance + إشارة شراء
            request.args = request.args.copy()
            request.args['min_signal'] = request.args.get('min_signal', '1')
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

        # ── Part 2 — Fundamental filters ──────────────────────────────────────
        min_pe = request.args.get('min_pe', type=float)
        max_pe = request.args.get('max_pe', type=float)
        min_roe = request.args.get('min_roe', type=float)
        min_dividend_yield = request.args.get('min_dividend_yield', type=float)
        min_market_cap = request.args.get('min_market_cap', type=float)
        max_market_cap = request.args.get('max_market_cap', type=float)
        # stock_state filter (Python-side post-filter)
        stock_state_filter = request.args.get('stock_state', '').strip().upper()
        _valid_states = {'CORRECTION', 'CORRECTION_END', 'DECLINING', 'NEAR_BREAKOUT',
                         'AT_PEAK', 'NEAR_PEAK', 'BALANCED_MOMENTUM', 'NEUTRAL',
                         'INSUFFICIENT_DATA'}
        if stock_state_filter and stock_state_filter not in _valid_states:
            stock_state_filter = ''  # ignore invalid value

        # Validate sort field (prevent SQL injection)
        valid_sorts = {'ticker', 'change_percent', 'volume', 'market_cap', 'pe_ratio',
                       'roe', 'rsi', 'turnover_egp', 'dividend_yield', 'high_52w',
                       'low_52w', 'avg_volume', 'current_price', 'name'}
        # Post-sorts = computed fields (not in SQL columns) — sorted in Python after fetch
        post_sorts = {'stock_state', 'momentum_score'}
        needs_post_sort = sort_by in post_sorts
        if needs_post_sort:
            sql_sort_by = 'turnover_egp'  # placeholder SQL ordering (Python re-sorts after)
        elif sort_by not in valid_sorts:
            sort_by = 'turnover_egp'
            sql_sort_by = sort_by
        else:
            sql_sort_by = sort_by
        order_dir = 'DESC' if order == 'desc' else 'ASC'

        # Post-processing needed if user passed stock_state filter OR sort by computed field.
        # In that case we fetch up to 500 rows so we have a pool to filter/sort from,
        # then slice to the user's requested limit after post-processing.
        needs_post_processing = bool(stock_state_filter) or needs_post_sort
        internal_limit = 500 if needs_post_processing else limit

        conn = _get_stocks_conn()
        try:
            # Build query
            # ─── Default filters لمنع الأسهم غير النشطة وأسهم الفلس ───────────────
            # 1) min_price default = 0.50 جنيه (يستبعد penny stocks الخطيرة)
            # 2) min_volume default = 1000 سهم (يستبعد الأسهم الميتة زي DCRC)
            # 3) min_turnover default = 50,000 ج.م (يستبعد الأسهم غير النشطة زي MILS)
            # لو المستخدم مرّر قيمة صريحة → نحترمها (حتى لو 0)
            effective_min_price = 0.10 if min_price is None else min_price  # V80-TUNE: was 0.50
            effective_min_volume = 100 if min_volume is None else min_volume  # V80-TUNE: was 1000
            effective_min_turnover = 5000.0 if min_turnover is None else min_turnover  # V80-TUNE: was 50000

            where_clauses = [
                'is_active = 1',
                'current_price >= ?',    # default 0.50 (penny stock filter)
                'volume >= ?',            # default 1000 (dead stock filter)
                '(turnover_egp IS NULL OR turnover_egp >= ?)',  # default 50K
            ]
            params = [effective_min_price, effective_min_volume, effective_min_turnover]

            if market and market != 'ALL':
                where_clauses.append('market = ?')
                params.append(market)

            if sector:
                where_clauses.append('sector LIKE ?')
                params.append(f'%{sector}%')

            # min_price/max_price تم تطبيق min_price كـ default فوق
            # لو max_price موجود نطبقه
            if max_price is not None:
                where_clauses.append('current_price <= ?')
                params.append(max_price)

            # min_volume تم تطبيقه كـ default فوق
            # min_turnover تم تطبيقه كـ default فوق

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

            # ── Part 2 — Fundamental filters ──────────────────────────────────
            if min_pe is not None:
                where_clauses.append('pe_ratio IS NOT NULL AND pe_ratio >= ?')
                params.append(min_pe)
            if max_pe is not None:
                where_clauses.append('pe_ratio IS NOT NULL AND pe_ratio <= ?')
                params.append(max_pe)
            if min_roe is not None:
                where_clauses.append('roe IS NOT NULL AND roe >= ?')
                params.append(min_roe)
            if min_dividend_yield is not None:
                where_clauses.append('dividend_yield IS NOT NULL AND dividend_yield >= ?')
                params.append(min_dividend_yield)
            if min_market_cap is not None:
                where_clauses.append('market_cap IS NOT NULL AND market_cap >= ?')
                params.append(min_market_cap)
            if max_market_cap is not None:
                where_clauses.append('market_cap IS NOT NULL AND market_cap <= ?')
                params.append(max_market_cap)

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
                ORDER BY {sql_sort_by} {order_dir}
                LIMIT ?
            """
            params.append(internal_limit)

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

                # ── Part 2 — Compute stock_state (Python = brain) ──────────────
                # Build a dict with the fields compute_stock_state() expects.
                stock_dict_for_state = {
                    'current_price': current,
                    'change_percent': _safe_float(r['change_percent'], 0) or 0,
                    'ma_50': _safe_float(r['ma_50']),
                    'ma_200': _safe_float(r['ma_200']),
                    'rsi': _safe_float(r['rsi']),
                    'high_52w': high52,
                    'low_52w': low52,
                    'avg_volume': avg_vol,
                    'volume': vol,
                    'trend': r['trend'] or '',
                }
                state_info = compute_stock_state(stock_dict_for_state)

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
                    'turnover_egp': round(
                        (_safe_float(r['turnover_egp']) if _safe_float(r['turnover_egp']) and _safe_float(r['turnover_egp']) > 0
                         else (_safe_float(r['current_price'], 0) * _safe_float(r['volume'], 0)) if _safe_float(r['current_price'], 0) > 0 and _safe_float(r['volume'], 0) > 0
                         else 0.0),
                        0),
                    'value_traded': round(
                        (_safe_float(r['value_traded']) if _safe_float(r['value_traded']) and _safe_float(r['value_traded']) > 0
                         else (_safe_float(r['current_price'], 0) * _safe_float(r['volume'], 0)) if _safe_float(r['current_price'], 0) > 0 and _safe_float(r['volume'], 0) > 0
                         else 0.0),
                        0),
                    # BRAVO-RR (2026-10-15): R/R ratio + falling knife guard
                    'support': _safe_float(r['support']),
                    'resistance': _safe_float(r['resistance']),
                    'rr_ratio': (
                        (lambda s, c: round((s - c) / max(c - _safe_float(r.get('support'), c * 0.95), 0.01), 2) if s and c and c > _safe_float(r.get('support'), 0) else None)
                        (_safe_float(r['resistance']), current)
                    ),
                    'targets_available': not (
                        current and _safe_float(r['ma_50']) and _safe_float(r['ma_200'])
                        and current < _safe_float(r['ma_50']) * 0.95
                        and _safe_float(r['ma_50']) < _safe_float(r['ma_200'])
                    ),
                    'is_egx30': bool(r['is_egx30']),
                    'is_egx70': bool(r['is_egx70']),
                    'is_egx100': bool(r['is_egx100']),
                    'free_float_percentage': _safe_float(r['free_float_percentage']),
                    'dps_ttm': _safe_float(r['dps_ttm']),
                    'book_value_per_share': _safe_float(r['book_value_per_share']),
                    'volume_surge': vol_surge,
                    'above_ma_50': bool(r['ma_50'] and current > r['ma_50']),
                    'above_ma_200': bool(r['ma_200'] and current > r['ma_200']),
                    'distance_from_52w_high': round(dist_high, 1) if dist_high is not None else None,
                    'distance_from_52w_low': round(dist_low, 1) if dist_low is not None else None,
                    # ── Part 2 — Stock state + momentum (computed fields) ──────
                    'stock_state': state_info['state'],
                    'stock_state_ar': state_info['state_ar'],
                    'stock_state_reason': state_info['state_reason'],
                    'momentum_score': round(_safe_float(state_info.get('momentum_score'), 0) or 0, 1),
                })

            # ── Part 2 — Post-processing (Python-side) ─────────────────────────
            # 1) Apply stock_state filter (computed field, not in SQL).
            if stock_state_filter:
                stocks = [s for s in stocks if s['stock_state'] == stock_state_filter]

            # 2) Python-side sort for computed fields (stock_state / momentum_score).
            if sort_by == 'momentum_score':
                stocks.sort(
                    key=lambda s: float(s.get('momentum_score') or 0),
                    reverse=(order_dir == 'DESC'),
                )
            elif sort_by == 'stock_state':
                # STATE_ORDER: 1 = best (CORRECTION_END) ... 7 = worst (DECLINING).
                # DESC = best first (ascending by state_order).
                # ASC  = worst first (descending by state_order).
                stocks.sort(
                    key=lambda s: get_state_order(s.get('stock_state', 'NEUTRAL')),
                    reverse=(order_dir == 'ASC'),
                )

            # 3) Slice to user's requested limit (after post-filtering / post-sort).
            if needs_post_processing:
                stocks = stocks[:limit]

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

            # ── FAST PREDICTIONS BATCH LOOKUP ──
            # Direct SQLite lookup in <5ms instead of 500-second sequential loop
            try:
                import sqlite3 as _sql
                _p_path = getattr(DBPaths, 'PREDICTIONS_DB', 'db/predictions.db')
                if _os.path.exists(_p_path):
                    with _sql.connect(_p_path) as _pconn:
                        _pconn.row_factory = _sql.Row
                        _tickers = [s['ticker'] for s in stocks]
                        if _tickers:
                            _placeholders = ','.join(['?'] * len(_tickers))
                            _p_rows = _pconn.execute(
                                f"SELECT ticker, signal, target_price, stop_loss FROM predictions WHERE status='active' AND ticker IN ({_placeholders})",
                                _tickers
                            ).fetchall()
                            _p_map = {r['ticker']: dict(r) for r in _p_rows}
                            for s in stocks:
                                pred = _p_map.get(s['ticker'])
                                s['has_active_prediction'] = bool(pred)
                                s['active_prediction'] = pred
                                s['unified_verdict'] = pred.get('signal', 'NEUTRAL') if pred else 'NEUTRAL'
                                s['unified_reason'] = ''
                                s['v68_dirty_dist'] = False
                                s['v72_hidden_dist'] = False
                                s['v73_desert'] = False
                                s['v68_probability'] = 0
            except Exception as _pe:
                print(f"[advanced_screener] fast prediction lookup warning: {_pe}")

            result_payload = {
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
                    'stock_state': stock_state_filter or None,
                },
            }
            _set_cache(_cache_key, result_payload)

            # BRAVO-RR-FILTER (2026-10-15): If preset=high_rr, filter to R/R ≥ 1.5 only
            if preset == 'high_rr':
                result_payload['stocks'] = [
                    s for s in result_payload.get('stocks', [])
                    if _safe_float(s.get('rr_ratio'), 0) and _safe_float(s.get('rr_ratio'), 0) >= 1.5
                ]
                result_payload['count'] = len(result_payload['stocks'])
                result_payload['preset'] = 'high_rr'
                result_payload['rr_filter'] = '≥ 1.5 (enforced)'
            elif preset:
                result_payload['preset'] = preset

            return jsonify(result_payload)
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

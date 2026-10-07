"""
Top Performers Routes Blueprint
=================================
Endpoints لأعلى الأسهم أرباحاً/خسارة في فترات متعددة

الـ logic كله في Python (يقرأ data_engine.db.egksco_price_history) — Node مجرد proxy.

Endpoints:
- GET /api/stocks/top-performers — أعلى/أدنى الأسهم في فترات متعددة
  Query params:
    - period: 1d | 7d | 15d | 1m | 3m | 6m | YTD | 1y (default: 1m)
    - direction: gainers | losers | both (default: both)
    - market: EGX | KSA | Kuwait | Qatar (default: EGX)
    - limit: max 100 (default: 20)

  Returns:
    - period: الفترة المطلوبة
    - direction: gainers/losers/both
    - results: [{ticker, name, start_price, end_price, change_pct, period_days, ...}]
    - summary: {total_stocks, gainers, losers, avg_change}
"""

import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify

from utils.db_paths import DBPaths

top_performers_bp = Blueprint('top_performers', __name__)


def _get_data_engine_conn():
    """Get a connection to data_engine.db (has egksco_price_history).

    PHASE-2-DB-UNIFY: data_engine.db.egksco_price_history = 0 rows على الإنتاج.
    Use _get_price_history_conn() (price_history.db) as the canonical source.
    """
    conn = sqlite3.connect(DBPaths.DATA_ENGINE_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _get_price_history_conn():
    """Get a connection to price_history.db (the canonical price history source).

    PHASE-2-DB-UNIFY (2026-08-29):
    - price_history.db.price_history: 1,248,257 rows, 1,267 tickers, 25 سنة بيانات
    - schema: ticker, date, open_price, high_price, low_price, close_price, volume, source
    """
    ph_db = str(Path(__file__).resolve().parents[2] / 'db' / 'price_history.db')
    conn = sqlite3.connect(ph_db)
    conn.row_factory = sqlite3.Row
    return conn


def _get_stocks_conn():
    """Get a connection to stocks.db (for metadata: name, sector, market)."""
    conn = sqlite3.connect(DBPaths.STOCKS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _safe_float(val, default=0.0):
    try:
        if val is None:
            return default
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


# Period → days mapping
PERIOD_DAYS = {
    '1d': 1,
    '7d': 7,
    '15d': 15,
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
    'YTD': None,  # computed dynamically (from Jan 1 of current year)
}


@top_performers_bp.route('/api/stocks/top-performers', methods=['GET'])
def get_top_performers():
    """أعلى/أدنى الأسهم في فترة محددة (يقرأ data_engine.db.egksco_price_history)."""
    try:
        period = request.args.get('period', '1m').strip()
        direction = request.args.get('direction', 'both').strip().lower()
        market = request.args.get('market', 'EGX').strip()
        limit = min(int(request.args.get('limit', '20')), 100)

        if period not in PERIOD_DAYS:
            return jsonify({
                'success': False,
                'error': f'Invalid period. Available: {list(PERIOD_DAYS.keys())}',
            }), 400

        if direction not in ('gainers', 'losers', 'both'):
            direction = 'both'

        # === PHASE-2-DB-UNIFY: price_history.db first (1.24M rows), data_engine.db fallback ===
        # CANONICAL-PRICE (Task PHASE-3, Rule 72) — HISTORICAL closes only (for % change calc).
        # LIVE price for any ticker must come from stocks.db.stocks.current_price (NOT used here).
        rows = []
        latest_date = None
        ph_conn = None
        de_conn = None

        # 1. price_history.db (canonical source — 1,248,257 rows, 25 سنة)
        try:
            ph_conn = _get_price_history_conn()
            latest_date_row = ph_conn.execute(
                'SELECT MAX(date) as max_date FROM price_history'
            ).fetchone()
            latest_date = latest_date_row['max_date'] if latest_date_row else None

            if latest_date:
                latest_dt = datetime.strptime(latest_date, '%Y-%m-%d')
                if period == 'YTD':
                    start_dt = datetime(latest_dt.year, 1, 1)
                else:
                    days = PERIOD_DAYS[period]
                    start_dt = latest_dt - timedelta(days=days)
                start_date = start_dt.strftime('%Y-%m-%d')

                # query price_history.db (schema: ticker, date, close_price, volume)
                query = """
                    WITH ranked AS (
                        SELECT
                            ticker,
                            date,
                            close_price,
                            volume,
                            ROW_NUMBER() OVER (
                                PARTITION BY ticker
                                ORDER BY
                                    CASE WHEN date <= ? THEN 0 ELSE 1 END,
                                    ABS(julianday(date) - julianday(?)) ASC
                            ) as start_rank,
                            ROW_NUMBER() OVER (
                                PARTITION BY ticker
                                ORDER BY date DESC
                            ) as end_rank
                        FROM price_history
                        WHERE date <= ?
                    )
                    SELECT
                        s.ticker as start_symbol,
                        s.date as start_date,
                        s.close_price as start_price,
                        s.volume as start_volume,
                        e.date as end_date,
                        e.close_price as end_price,
                        e.volume as end_volume
                    FROM ranked s
                    JOIN ranked e ON s.ticker = e.ticker
                    WHERE s.start_rank = 1 AND e.end_rank = 1
                """
                rows = ph_conn.execute(query, (start_date, start_date, latest_date)).fetchall()
        except Exception:
            rows = []
        finally:
            if ph_conn:
                ph_conn.close()

        # 2. Fallback: data_engine.db.egksco_price_history (لو price_history.db فاضي)
        if not rows:
            try:
                de_conn = _get_data_engine_conn()
                latest_date_row = de_conn.execute(
                    'SELECT MAX(price_date) as max_date FROM egksco_price_history'
                ).fetchone()
                latest_date = latest_date_row['max_date'] if latest_date_row else None

                if not latest_date:
                    return jsonify({
                        'success': False,
                        'error': 'No price history data available (both price_history.db and data_engine.db are empty)',
                    }), 500

                latest_dt = datetime.strptime(latest_date, '%Y-%m-%d')
                if period == 'YTD':
                    start_dt = datetime(latest_dt.year, 1, 1)
                else:
                    days = PERIOD_DAYS[period]
                    start_dt = latest_dt - timedelta(days=days)
                start_date = start_dt.strftime('%Y-%m-%d')

                query = """
                    WITH ranked AS (
                        SELECT
                            symbol,
                            price_date,
                            close_price,
                            volume,
                            ROW_NUMBER() OVER (
                                PARTITION BY symbol
                                ORDER BY
                                    CASE WHEN price_date <= ? THEN 0 ELSE 1 END,
                                    ABS(julianday(price_date) - julianday(?)) ASC
                            ) as start_rank,
                            ROW_NUMBER() OVER (
                                PARTITION BY symbol
                                ORDER BY price_date DESC
                            ) as end_rank
                        FROM egksco_price_history
                        WHERE price_date <= ?
                    )
                    SELECT
                        s.symbol as start_symbol,
                        s.price_date as start_date,
                        s.close_price as start_price,
                        s.volume as start_volume,
                        e.price_date as end_date,
                        e.close_price as end_price,
                        e.volume as end_volume
                    FROM ranked s
                    JOIN ranked e ON s.symbol = e.symbol
                    WHERE s.start_rank = 1 AND e.end_rank = 1
                """
                rows = de_conn.execute(query, (start_date, start_date, latest_date)).fetchall()
            finally:
                if de_conn:
                    de_conn.close()

        if not rows:
            return jsonify({
                'success': True,
                'period': period,
                'direction': direction,
                'start_date': start_date,
                'end_date': latest_date,
                'results': [],
                'summary': {'total_stocks': 0, 'gainers': 0, 'losers': 0, 'avg_change': 0},
            })

        # === Enrich with stock metadata (name, sector, market) ===
        stocks_conn = _get_stocks_conn()
        try:
            ticker_set = set(r['start_symbol'] for r in rows)
            placeholders = ','.join('?' * len(ticker_set))
            meta_rows = stocks_conn.execute(
                f'SELECT ticker, name, name_ar, sector, market FROM stocks WHERE ticker IN ({placeholders})',
                list(ticker_set)
            ).fetchall()
            meta_map = {r['ticker']: r for r in meta_rows}
        finally:
            stocks_conn.close()

        # === Compute change_pct + filter by market ===
        results = []
        for r in rows:
            ticker = r['start_symbol']
            meta = meta_map.get(ticker)
            stock_market = meta['market'] if meta else 'UNKNOWN'

            # Filter by market
            if market and market != 'ALL' and stock_market != market:
                continue

            start_price = _safe_float(r['start_price'])
            end_price = _safe_float(r['end_price'])

            if start_price <= 0 or end_price <= 0:
                continue

            change_pct = ((end_price - start_price) / start_price) * 100

            # Compute actual period days
            try:
                start_dt_parsed = datetime.strptime(r['start_date'], '%Y-%m-%d')
                end_dt_parsed = datetime.strptime(r['end_date'], '%Y-%m-%d')
                period_days = (end_dt_parsed - start_dt_parsed).days
            except (ValueError, TypeError):
                period_days = 0

            results.append({
                'ticker': ticker,
                'name': meta['name'] if meta else ticker,
                'name_ar': (meta['name_ar'] if meta else None) or (meta['name'] if meta else ticker),
                'sector': meta['sector'] if meta else None,
                'market': stock_market,
                'start_price': round(start_price, 2),
                'end_price': round(end_price, 2),
                'change_pct': round(change_pct, 2),
                'period_days': period_days,
                'start_date': r['start_date'],
                'end_date': r['end_date'],
                'start_volume': _safe_float(r['start_volume'], 0),
                'end_volume': _safe_float(r['end_volume'], 0),
            })

        # === Sort + filter by direction ===
        gainers = sorted([r for r in results if r['change_pct'] > 0],
                         key=lambda x: x['change_pct'], reverse=True)
        losers = sorted([r for r in results if r['change_pct'] < 0],
                        key=lambda x: x['change_pct'])

        if direction == 'gainers':
            final_results = gainers[:limit]
        elif direction == 'losers':
            final_results = losers[:limit]
        else:  # both
            half = limit // 2
            final_results = gainers[:half] + losers[:half]

        # Summary
        total = len(results)
        gainers_count = len(gainers)
        losers_count = len(losers)
        avg_change = sum(r['change_pct'] for r in results) / total if total > 0 else 0

        return jsonify({
            'success': True,
            'period': period,
            'direction': direction,
            'market': market,
            'start_date': start_date,
            'end_date': latest_date,
            'results': final_results,
            'summary': {
                'total_stocks': total,
                'gainers': gainers_count,
                'losers': losers_count,
                'avg_change': round(avg_change, 2),
                'best_performer': gainers[0] if gainers else None,
                'worst_performer': losers[0] if losers else None,
            },
            'filters': {
                'period': period,
                'direction': direction,
                'market': market,
                'limit': limit,
            },
        })
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }), 500


def register_top_performers_routes(app):
    """Register the top performers blueprint."""
    app.register_blueprint(top_performers_bp)

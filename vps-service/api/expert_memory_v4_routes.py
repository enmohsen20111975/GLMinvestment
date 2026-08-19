# DEPRECATED: This route is not registered in lightweight_server.py
"""
Expert Memory V4 API Routes
===========================

API endpoints for personal trading memory

@authorM2yDevelopers Team
"""

from flask import Blueprint, request, jsonify
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.expert_memory_v4 import ExpertMemoryV4, PatternRecord
import sqlite3

# Blueprint
v4_bp = Blueprint('expert_memory_v4', __name__, url_prefix='/api/v4')

# Database path
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'predictions.db')


def get_memory():
    """Get ExpertMemoryV4 instance"""
    return ExpertMemoryV4(DB_PATH)


@v4_bp.route('/insight/<ticker>', methods=['GET'])
def get_insight(ticker):
    """
    Get analyst insight for a ticker

    Query params:
        current_price: Current price (optional)
        support: Support level (optional)
        resistance: Resistance level (optional)
    """
    try:
        memory = get_memory()

        current_price = request.args.get('current_price', type=float)
        support = request.args.get('support', type=float)
        resistance = request.args.get('resistance', type=float)

        insight = memory.get_analyst_insight(ticker, current_price, support, resistance)

        return jsonify({
            "success": True,
            "data": {
                "ticker": insight.ticker,
                "total_trades": insight.total_trades,
                "wins": insight.wins,
                "losses": insight.losses,
                "open_positions": insight.open_positions,
                "win_rate": insight.win_rate,
                "avg_pnl": insight.avg_pnl,
                "best_pattern": insight.best_pattern,
                "best_pattern_win_rate": insight.best_pattern_win_rate,
                "worst_pattern": insight.worst_pattern,
                "worst_pattern_win_rate": insight.worst_pattern_win_rate,
                "favorite_support": insight.favorite_support,
                "similar_cases": insight.similar_cases,
                "suggestion": insight.suggestion,
                "confidence": insight.confidence,
                "pattern_breakdown": insight.pattern_breakdown
            }
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/similar', methods=['GET'])
def get_similar():
    """
    Get similar patterns

    Query params:
        ticker: Ticker symbol
        pattern_type: Pattern type
        entry_price: Entry price (optional)
        support_level: Support level (optional)
    """
    try:
        memory = get_memory()

        ticker = request.args.get('ticker')
        pattern_type = request.args.get('pattern_type', '')
        entry_price = request.args.get('entry_price', type=float)
        support_level = request.args.get('support_level', type=float)

        if not ticker:
            return jsonify({"success": False, "error": "ticker is required"}), 400

        similar = memory.get_similar_patterns(ticker, pattern_type, entry_price, support_level)

        return jsonify({
            "success": True,
            "data": similar
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/record-trade', methods=['POST'])
def record_trade():
    """
    Record a new trade

    Body:
        ticker: Stock symbol
        ticker_name: Stock name
        pattern_type: Pattern type (دعم/ارتداد, T+1, etc.)
        entry_price: Entry price
        target_1: First target (optional)
        target_2: Second target (optional)
        stop_loss: Stop loss (optional)
        support_level: Support level (optional)
        resistance_level: Resistance level (optional)
        timeframe: Timeframe (optional)
        notes: Notes (optional)
        sector: Sector (optional)
    """
    try:
        memory = get_memory()
        data = request.get_json()

        record = PatternRecord(
            ticker=data.get('ticker', ''),
            ticker_name=data.get('ticker_name', ''),
            pattern_type=data.get('pattern_type', ''),
            entry_price=data.get('entry_price', 0),
            target_1=data.get('target_1'),
            target_2=data.get('target_2'),
            stop_loss=data.get('stop_loss'),
            support_level=data.get('support_level'),
            resistance_level=data.get('resistance_level'),
            timeframe=data.get('timeframe', 'غير محدد'),
            notes=data.get('notes', ''),
            sector=data.get('sector', ''),
            trade_date=data.get('trade_date')
        )

        trade_id = memory.record_trade(record)

        return jsonify({
            "success": True,
            "trade_id": trade_id,
            "message": f"Trade recorded successfully for {record.ticker}"
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/update-outcome/<int:trade_id>', methods=['PUT'])
def update_outcome(trade_id):
    """
    Update trade outcome

    Body:
        outcome: win, loss, neutral
        pnl_pct: Profit/loss percentage
        close_date: Close date (optional)
        notes: Additional notes (optional)
    """
    try:
        memory = get_memory()
        data = request.get_json()

        outcome = data.get('outcome', 'neutral')
        pnl_pct = data.get('pnl_pct', 0)
        close_date = data.get('close_date')
        notes = data.get('notes')

        success = memory.update_trade_outcome(trade_id, outcome, pnl_pct, close_date, notes)

        return jsonify({
            "success": success,
            "message": f"Trade {trade_id} updated to {outcome}" if success else "Trade not found"
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/stats', methods=['GET'])
def get_stats():
    """
    Get overall statistics
    """
    try:
        memory = get_memory()
        stats = memory.get_all_stats()

        return jsonify({
            "success": True,
            "data": stats
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/alerts', methods=['POST'])
def get_alerts():
    """
    Get alerts based on current prices

    Body:
        prices: Dict of {ticker: current_price}
    """
    try:
        memory = get_memory()
        data = request.get_json()
        prices = data.get('prices', {})

        alerts = memory.get_alerts(prices)

        return jsonify({
            "success": True,
            "data": alerts
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/history/<ticker>', methods=['GET'])
def get_history(ticker):
    """
    Get full trade history for a ticker
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute('''
            SELECT id, ticker, ticker_name, pattern_type, pattern_normalized,
                   entry_price, target_1, stop_loss, support_level, resistance_level,
                   outcome, pnl_pct, trade_date, close_date, notes, sector
            FROM v4_patterns
            WHERE ticker = ?
            ORDER BY trade_date DESC
        ''', (ticker,))

        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()

        history = []
        for row in rows:
            history.append(dict(zip(columns, row)))

        conn.close()

        return jsonify({
            "success": True,
            "ticker": ticker,
            "count": len(history),
            "data": history
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/patterns', methods=['GET'])
def list_patterns():
    """
    List all pattern types with stats
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute('''
            SELECT pattern_normalized, COUNT(*) as total,
                   SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins,
                   SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) as losses,
                   AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE NULL END) as avg_pnl
            FROM v4_patterns
            GROUP BY pattern_normalized
            ORDER BY total DESC
        ''')

        patterns = []
        for row in cursor.fetchall():
            total_closed = (row[2] or 0) + (row[3] or 0)
            win_rate = (row[2] / total_closed * 100) if total_closed > 0 else 0

            patterns.append({
                "pattern": row[0],
                "total": row[1],
                "wins": row[2],
                "losses": row[3],
                "win_rate": round(win_rate, 1),
                "avg_pnl": round(row[4] or 0, 2)
            })

        conn.close()

        return jsonify({
            "success": True,
            "data": patterns
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/unbiased-stats', methods=['GET'])
def get_unbiased_stats():
    """
    Get unbiased statistics (selection bias adjusted)
    """
    try:
        memory = get_memory()
        stats = memory.get_unbiased_stats()
        return jsonify({
            "success": True,
            "data": stats
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v4_bp.route('/auto-close', methods=['POST'])
def auto_close_trades():
    """
    Auto close open trades based on current price data
    Body:
        {
            "prices": {
                "COMI": {"close": 135.5, "high": 138.0, "low": 134.0},
                ...
            }
        }
    """
    try:
        memory = get_memory()
        data = request.get_json() or {}
        prices = data.get('prices', {})
        
        closed_count = memory.auto_close_open_trades(prices)
        return jsonify({
            "success": True,
            "closed_count": closed_count,
            "message": f"Closed {closed_count} open trades automatically"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# For Flask app registration
def register_v4_routes(app):
    """Register V4 routes with Flask app"""
    app.register_blueprint(v4_bp)
    print("✅ Expert Memory V4 routes registered")

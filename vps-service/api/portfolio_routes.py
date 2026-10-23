"""
Portfolio API Routes
====================
API endpoints لإدارة المحافظ

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md

Endpoints:
- POST /api/portfolio/create - إنشاء محفظة
- GET  /api/portfolio/state - حالة المحفظة
- POST /api/portfolio/position/add - إضافة مركز
- POST /api/portfolio/position/check-stops - فحص الستوبات
- POST /api/portfolio/position/partial-exit - خروج جزئي
- POST /api/portfolio/position/close - إغلاق مركز
- POST /api/portfolio/strategy/plan - تخطيط استراتيجية دخول
- POST /api/portfolio/strategy/recommend - توقعة باستراتيجية
- POST /api/portfolio/heat/calculate - حساب حرارة المحفظة
- POST /api/portfolio/heat/check-position - التحقق من مركز جديد
- POST /api/portfolio/rebalance/suggest - اقتراح إعادة توازن
- POST /api/portfolio/journal/open - فتح صفقة
- POST /api/portfolio/journal/close - إغلاق صفقة
- POST /api/portfolio/journal/reflect - إضافة تأمل
- GET  /api/portfolio/journal/stats - إحصائيات
- GET  /api/portfolio/journal/recent - آخر الصفقات
- GET  /api/portfolio/dashboard - لوحة التحكم الكاملة
"""

from flask import Blueprint, jsonify, request
from core.auth_middleware import require_admin
from datetime import datetime
from typing import Dict, Optional
import sys
import os
import logging
import sqlite3
from contextlib import contextmanager

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _PORT_ROUTES_DBM_AVAILABLE = True
except Exception as _pr_err:
    _PORT_ROUTES_DBM_AVAILABLE = False
    print(f"[portfolio_routes] db_manager not available ({_pr_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect."""
    ctx = None
    conn = None
    try:
        if _PORT_ROUTES_DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass

logger = logging.getLogger(__name__)

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from portfolio.position_manager import PositionManager, PositionState, TradingPattern
from portfolio.portfolio_heat import PortfolioHeatCalculator, HeatLevel
# BRAVO UNIFY (Rule 67): delegate risk-based position sizing to canonical
from utils.position_sizing import calculate_risk_based_position as _canonical_risk_position
from portfolio.strategies import (
    EntryStrategies, StrategyType,
    PlannedScaleInStrategy, PyramidUpStrategy, ThreeZoneHuntStrategy
)
from portfolio.trade_journal import (
    TradeJournal, TradeGrade, EmotionalState
)

# Create Blueprint
portfolio_bp = Blueprint('portfolio', __name__, url_prefix='/api/portfolio')

# Initialize
entry_strategies = EntryStrategies()
trade_journal = TradeJournal()

# --- Portfolio State persistence (SQLite) ---
_PORTFOLIO_SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS portfolio_state (
        portfolio_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 100000,
        cash REAL NOT NULL DEFAULT 30000,
        peak_value REAL NOT NULL DEFAULT 100000,
        persona TEXT NOT NULL DEFAULT 'balanced',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        stop_loss_pct REAL NOT NULL DEFAULT 8.0,
        sector TEXT NOT NULL DEFAULT 'unknown',
        correlation_group TEXT,
        FOREIGN KEY (portfolio_id) REFERENCES portfolio_state(portfolio_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pp_portfolio ON portfolio_positions(portfolio_id);
"""

_schema_ready = False

def _get_portfolio_db_path():
    from pathlib import Path
    return str(Path(__file__).parent.parent.parent / 'db' / 'predictions.db')

def _ensure_portfolio_schema():
    global _schema_ready
    if _schema_ready:
        return
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_es_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_es_ctx = _dbm.connection(_get_portfolio_db_path(), writable=True)
                conn = _pr_es_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_portfolio_db_path())
            _pr_es_ctx = None
        conn.executescript(_PORTFOLIO_SCHEMA_SQL)
        conn.commit()
        conn.close()
        _schema_ready = True
    except sqlite3.Error as e:
        logger.error("فشل إنشاء schema portfolio_state: %s", e)

def _get_portfolio_conn():
    # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
    try:
        if _PORT_ROUTES_DBM_AVAILABLE:
            _ctx = _dbm.connection(_get_portfolio_db_path(), writable=True)
            return _ctx.__enter__()
    except Exception:
        pass
    # Phase 7.1: migrated
    from core.db_manager import db_manager
    conn = db_manager.connection(_get_portfolio_db_path(), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn

def _save_portfolio_state(portfolio_id: str, user_id: str, value: float,
                          cash: float, peak_value: float, persona: str):
    _ensure_portfolio_schema()
    now = datetime.now().isoformat()
    try:
        conn = _get_portfolio_conn()
        conn.execute(
            """INSERT INTO portfolio_state
               (portfolio_id, user_id, value, cash, peak_value, persona, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(portfolio_id) DO UPDATE SET
               value=excluded.value, cash=excluded.cash,
               peak_value=excluded.peak_value, persona=excluded.persona,
               updated_at=excluded.updated_at""",
            (portfolio_id, user_id, value, cash, peak_value, persona, now, now),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as e:
        logger.error("فشل حفظ portfolio_state: %s", e)

def _load_portfolio_state(portfolio_id: str) -> Optional[dict]:
    _ensure_portfolio_schema()
    try:
        conn = _get_portfolio_conn()
        row = conn.execute(
            "SELECT * FROM portfolio_state WHERE portfolio_id=?", (portfolio_id,)
        ).fetchone()
        if not row:
            conn.close()
            return None
        result = dict(row)
        positions = conn.execute(
            "SELECT * FROM portfolio_positions WHERE portfolio_id=?", (portfolio_id,)
        ).fetchall()
        result["positions"] = [dict(p) for p in positions]
        conn.close()
        return result
    except sqlite3.Error as e:
        logger.error("فشل تحميل portfolio_state: %s", e)
        return None

def _save_portfolio_positions(portfolio_id: str, positions: list):
    _ensure_portfolio_schema()
    try:
        conn = _get_portfolio_conn()
        conn.execute("DELETE FROM portfolio_positions WHERE portfolio_id=?", (portfolio_id,))
        for pos in positions:
            conn.execute(
                """INSERT INTO portfolio_positions
                   (portfolio_id, ticker, value, stop_loss_pct, sector, correlation_group)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (portfolio_id, pos.get("ticker", "UNKNOWN"),
                 pos.get("value", 0), pos.get("stop_loss_pct", 8.0),
                 pos.get("sector", "unknown"), pos.get("correlation_group")),
            )
        conn.commit()
        conn.close()
    except sqlite3.Error as e:
        logger.error("فشل حفظ portfolio_positions: %s", e)


@require_admin
@portfolio_bp.route('/create', methods=['POST'])
def create_portfolio():
    """إنشاء محفظة جديدة"""
    try:
        data = request.get_json() or {}
        
        user_id = data.get('user_id', 'default')
        portfolio_value = float(data.get('portfolio_value', 100000))
        cash = float(data.get('cash', portfolio_value * 0.30))
        persona = data.get('persona', 'balanced')
        
        portfolio_id = f"portfolio_{user_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        _save_portfolio_state(portfolio_id, user_id, portfolio_value, cash, portfolio_value, persona)
        
        state = _load_portfolio_state(portfolio_id)
        
        return jsonify({
            "success": True,
            "portfolio_id": portfolio_id,
            "message": "تم إنشاء المحفظة بنجاح",
            "state": state
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/state', methods=['GET'])
def get_portfolio_state():
    """الحصول على حالة المحفظة"""
    try:
        portfolio_id = request.args.get('portfolio_id', 'default')
        
        portfolio = _load_portfolio_state(portfolio_id)
        
        if not portfolio:
            # Create default portfolio
            now = datetime.now().isoformat()
            _save_portfolio_state(portfolio_id, "default", 100000, 30000, 100000, "balanced")
            portfolio = _load_portfolio_state(portfolio_id)
        
        positions = portfolio.get("positions", [])
        
        # Calculate heat
        calculator = PortfolioHeatCalculator(
            portfolio_value=portfolio["value"],
            cash=portfolio["cash"],
            peak_value=portfolio["peak_value"]
        )
        
        for pos in positions:
            calculator.add_position(
                ticker=pos.get("ticker", "UNKNOWN"),
                value=pos.get("value", 0),
                stop_loss_pct=pos.get("stop_loss_pct", 8.0),
                sector=pos.get("sector", "unknown")
            )
        
        state = calculator.calculate_heat()
        
        return jsonify({
            "success": True,
            "portfolio": portfolio,
            "heat_analysis": state.to_dict()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/strategy/plan', methods=['POST'])
def plan_strategy():
    """تخطيط استراتيجية دخول"""
    try:
        data = request.get_json() or {}
        
        ticker = data.get('ticker', '').upper()
        current_price = float(data.get('current_price', 0))
        max_budget = float(data.get('max_budget', 100000))
        strategy_type = data.get('strategy_type', 'planned_scale_in')
        stop_loss_pct = float(data.get('stop_loss_pct', 8.0))
        support_levels = data.get('support_levels')
        
        if not ticker or current_price <= 0:
            return jsonify({"success": False, "error": "ticker and current_price required"}), 400
        
        if strategy_type == 'planned_scale_in':
            strategy = PlannedScaleInStrategy()
            result = strategy.plan(ticker, current_price, max_budget, stop_loss_pct=stop_loss_pct)
        elif strategy_type == 'pyramid_up':
            strategy = PyramidUpStrategy()
            base_shares = int(data.get('base_shares', 1000))
            result = strategy.plan(ticker, current_price, base_shares)
        elif strategy_type == 'three_zone':
            strategy = ThreeZoneHuntStrategy()
            result = strategy.plan(ticker, current_price, max_budget)
        else:
            return jsonify({"success": False, "error": f"Unknown strategy: {strategy_type}"}), 400
        
        return jsonify({
            "success": True,
            "strategy": result.to_dict()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/strategy/recommend', methods=['POST'])
def recommend_strategy():
    """توقعة بأفضل استراتيجية"""
    try:
        data = request.get_json() or {}
        
        current_price = float(data.get('current_price', 0))
        market_condition = data.get('market_condition', 'neutral')
        risk_tolerance = int(data.get('risk_tolerance', 5))
        holding_period = data.get('holding_period', 'medium')
        
        result = entry_strategies.recommend_strategy(
            current_price=current_price,
            market_condition=market_condition,
            risk_tolerance=risk_tolerance,
            holding_period=holding_period
        )
        
        return jsonify({
            "success": True,
            "recommendation": result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/heat/calculate', methods=['POST'])
def calculate_heat():
    """حساب حرارة المحفظة"""
    try:
        data = request.get_json() or {}
        
        portfolio_value = float(data.get('portfolio_value', 100000))
        cash = float(data.get('cash', 30000))
        peak_value = float(data.get('peak_value', portfolio_value))
        positions = data.get('positions', [])
        
        calculator = PortfolioHeatCalculator(
            portfolio_value=portfolio_value,
            cash=cash,
            peak_value=peak_value
        )
        
        for pos in positions:
            calculator.add_position(
                ticker=pos.get('ticker', 'UNKNOWN'),
                value=float(pos.get('value', 0)),
                stop_loss_pct=float(pos.get('stop_loss_pct', 8.0)),
                sector=pos.get('sector', 'unknown'),
                correlation_group=pos.get('correlation_group')
            )
        
        state = calculator.calculate_heat()
        
        return jsonify({
            "success": True,
            "portfolio_state": state.to_dict()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/heat/check-position', methods=['POST'])
def check_new_position():
    """التحقق من إمكانية فتح مركز جديد"""
    try:
        data = request.get_json() or {}
        
        portfolio_value = float(data.get('portfolio_value', 100000))
        cash = float(data.get('cash', 30000))
        existing_positions = data.get('positions', [])
        new_value = float(data.get('new_position_value', 0))
        new_stop_pct = float(data.get('new_stop_loss_pct', 8.0))
        
        calculator = PortfolioHeatCalculator(
            portfolio_value=portfolio_value,
            cash=cash
        )
        
        for pos in existing_positions:
            calculator.add_position(
                ticker=pos.get('ticker', 'UNKNOWN'),
                value=float(pos.get('value', 0)),
                stop_loss_pct=float(pos.get('stop_loss_pct', 8.0)),
                sector=pos.get('sector', 'unknown')
            )
        
        result = calculator.check_new_position_allowed(new_value, new_stop_pct)
        
        return jsonify({
            "success": True,
            "check": result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/rebalance/suggest', methods=['POST'])
def suggest_rebalance():
    """اقتراح إعادة التوازن"""
    try:
        data = request.get_json() or {}
        
        portfolio_value = float(data.get('portfolio_value', 100000))
        cash = float(data.get('cash', 30000))
        positions = data.get('positions', [])
        macro_regime = data.get('macro_regime', 'neutral')
        target_allocations = data.get('target_allocations')
        
        calculator = PortfolioHeatCalculator(
            portfolio_value=portfolio_value,
            cash=cash
        )
        
        for pos in positions:
            calculator.add_position(
                ticker=pos.get('ticker', 'UNKNOWN'),
                value=float(pos.get('value', 0)),
                stop_loss_pct=float(pos.get('stop_loss_pct', 8.0)),
                sector=pos.get('sector', 'unknown')
            )
        
        result = calculator.suggest_rebalancing(
            target_allocations=target_allocations,
            macro_regime=macro_regime
        )
        
        return jsonify({
            "success": True,
            "rebalancing": result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/position/evaluate', methods=['POST'])
def evaluate_position():
    """تقييم مركز واحد"""
    try:
        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        shares = int(data.get('shares', 0))
        stop_loss = float(data.get('stop_loss', 0))
        target = float(data.get('target', 0))
        
        if entry_price <= 0:
            return jsonify({"success": False, "error": "entry_price required"}), 400
        
        # Calculate metrics
        current_price = current_price or entry_price
        shares = shares or 100
        
        if stop_loss <= 0:
            stop_loss = entry_price * 0.92
        
        if target <= 0:
            target = entry_price * 1.15
        
        return_pct = ((current_price - entry_price) / entry_price) * 100
        risk = entry_price - stop_loss
        reward = target - entry_price
        risk_reward = reward / risk if risk > 0 else 0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target, stop_loss, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above
        heat_contribution = (current_price * shares * (1 - stop_loss/entry_price)) / 100000  # per 100K portfolio
        
        return jsonify({
            "success": True,
            "evaluation": {
                "entry_price": entry_price,
                "current_price": current_price,
                "return_pct": round(return_pct, 2),
                "shares": shares,
                "position_value": round(current_price * shares, 2),
                "stop_loss": stop_loss,
                "target": target,
                "risk_reward": round(risk_reward, 2),
                "risk_amount": round((entry_price - stop_loss) * shares, 2),
                "reward_amount": round((target - entry_price) * shares, 2),
                "heat_contribution_pct": round(heat_contribution * 100, 4),
                "signal": "profit" if return_pct > 0 else "loss",
                "recommendation": "ابحث عن جني أرباح" if return_pct > 10 else "انتظر" if return_pct > -5 else "راجع الستوب"
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# JOURNAL ENDPOINTS
# ============================================================================

@require_admin
@portfolio_bp.route('/journal/open', methods=['POST'])
def journal_open_trade():
    """فتح صفقة في السجل"""
    try:
        data = request.get_json() or {}
        
        trade = trade_journal.open_trade(
            ticker=data.get('ticker', '').upper(),
            direction=data.get('direction', 'long'),
            entry_price=float(data.get('entry_price', 0)),
            shares=int(data.get('shares', 0)),
            planned_stop=float(data.get('planned_stop', 0)),
            planned_target=float(data.get('planned_target', 0)),
            entry_reason=data.get('entry_reason', ''),
            entry_reason_ar=data.get('entry_reason_ar', ''),
            strategy=data.get('strategy', 'planned_scale_in'),
            persona=data.get('persona', 'balanced'),
            market_condition=data.get('market_condition', 'neutral')
        )
        
        return jsonify({
            "success": True,
            "trade": trade,
            "message": "تم فتح الصفقة في السجل"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/journal/close', methods=['POST'])
def journal_close_trade():
    """إغلاق صفقة في السجل"""
    try:
        data = request.get_json() or {}
        
        result = trade_journal.close_trade(
            trade_id=data.get('trade_id', ''),
            exit_price=float(data.get('exit_price', 0)),
            exit_reason=data.get('exit_reason', 'manual'),
            exit_reason_ar=data.get('exit_reason_ar', 'إغلاق يدوي')
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/journal/reflect', methods=['POST'])
def journal_add_reflection():
    """إضافة تأمل لصفقة"""
    try:
        data = request.get_json() or {}
        
        emotional = None
        if data.get('emotional_state'):
            try:
                emotional = EmotionalState(data['emotional_state'])
            except ValueError:
                pass
        
        grade = None
        if data.get('grade'):
            try:
                grade = TradeGrade(data['grade'])
            except ValueError:
                pass
        
        result = trade_journal.add_reflection(
            trade_id=data.get('trade_id', ''),
            mistake=data.get('mistake'),
            mistake_ar=data.get('mistake_ar'),
            lesson=data.get('lesson'),
            lesson_ar=data.get('lesson_ar'),
            emotional_state=emotional,
            followed_plan=data.get('followed_plan', True),
            grade=grade,
            notes=data.get('notes')
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/journal/stats', methods=['GET'])
def journal_stats():
    """إحصائيات السجل"""
    try:
        days = request.args.get('days', 30, type=int)
        stats = trade_journal.get_statistics(days)
        return jsonify({"success": True, "statistics": stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/journal/recent', methods=['GET'])
def journal_recent():
    """أحدث الصفقات"""
    try:
        limit = request.args.get('limit', 20, type=int)
        trades = trade_journal.get_recent_trades(limit)
        return jsonify({"success": True, "trades": trades, "count": len(trades)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/journal/open-trades', methods=['GET'])
def journal_open_trades():
    """الصفقات المفتوحة"""
    try:
        trades = trade_journal.get_open_trades()
        return jsonify({"success": True, "trades": trades, "count": len(trades)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DASHBOARD
# ============================================================================

def _batch_compute_flow(positions):
    """B1: احسب flow_direction لكل position في batch واحد (NO N+1).

    تقرأ آخر 5 أيام من price_history.db لكل tickers مرة واحدة.
    تحسب delta_volume (buy_volume - sell_volume) + flow_score (-100..100).

    Returns:
        dict: {ticker: {flow_direction, flow_strength, flow_score}}
    """
    if not positions:
        return {}

    tickers = [p.get('ticker', '') for p in positions if p.get('ticker')]
    if not tickers:
        return {}

    result = {}
    try:
        ph_db = str(PROJECT_ROOT / 'db' / 'price_history.db')
        if not os.path.exists(ph_db):
            # No price_history.db → return null for all (Rule 27)
            for t in tickers:
                result[t] = {'flow_direction': None, 'flow_strength': None, 'flow_score': None}
            return result

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(ph_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Batch query: last 5 days for all tickers at once
        placeholders = ','.join('?' for _ in tickers)
        cur.execute(f"""
            SELECT ticker, date, close_price, volume, buy_volume, sell_volume
            FROM price_history
            WHERE ticker IN ({placeholders})
            AND close_price > 0 AND volume > 0
            ORDER BY ticker, date DESC
        """, tickers)

        # Group by ticker (last 5 days each)
        ticker_data = {}
        for row in cur.fetchall():
            t = row['ticker']
            if t not in ticker_data:
                ticker_data[t] = []
            if len(ticker_data[t]) < 5:  # last 5 days
                ticker_data[t].append(dict(row))

        conn.close()

        # Calculate flow for each ticker
        for ticker, days in ticker_data.items():
            if len(days) < 2:
                result[ticker] = {'flow_direction': None, 'flow_strength': 'weak', 'flow_score': 0}
                continue

            # Use buy_volume/sell_volume if available, else approximate from MFM
            total_buy = sum(d.get('buy_volume', 0) or 0 for d in days)
            total_sell = sum(d.get('sell_volume', 0) or 0 for d in days)
            total_vol = sum(d.get('volume', 0) or 0 for d in days)

            if total_vol <= 0:
                result[ticker] = {'flow_direction': None, 'flow_strength': 'weak', 'flow_score': 0}
                continue

            # If buy_volume/sell_volume not available, approximate using close position
            if total_buy == 0 and total_sell == 0:
                # Approximate: close in upper half = buy, lower half = sell
                for d in days:
                    close = d.get('close_price', 0) or 0
                    # Use MFM approximation: ((close - low) - (high - close)) / (high - low)
                    # Since we don't have high/low here, use day-to-day direction
                    pass
                # Fallback: use price direction
                if len(days) >= 2:
                    price_change = (days[0]['close_price'] - days[-1]['close_price']) / days[-1]['close_price'] * 100
                    if price_change > 1:
                        total_buy = total_vol * 0.6
                        total_sell = total_vol * 0.4
                    elif price_change < -1:
                        total_buy = total_vol * 0.4
                        total_sell = total_vol * 0.6
                    else:
                        total_buy = total_vol * 0.5
                        total_sell = total_vol * 0.5

            delta = total_buy - total_sell
            # Normalize to -100..100
            if total_vol > 0:
                flow_score = int((delta / total_vol) * 200)  # ×200 for wider range
                flow_score = max(-100, min(100, flow_score))
            else:
                flow_score = 0

            # Direction
            if flow_score > 20:
                flow_direction = 'inflow'
            elif flow_score < -20:
                flow_direction = 'outflow'
            else:
                flow_direction = 'neutral'

            # Strength
            abs_score = abs(flow_score)
            if abs_score > 60:
                flow_strength = 'strong'
            elif abs_score > 30:
                flow_strength = 'moderate'
            else:
                flow_strength = 'weak'

            result[ticker] = {
                'flow_direction': flow_direction,
                'flow_strength': flow_strength,
                'flow_score': flow_score,
            }

        # Fill missing tickers with null (Rule 27)
        for t in tickers:
            if t not in result:
                result[t] = {'flow_direction': None, 'flow_strength': None, 'flow_score': None}

        return result

    except Exception as e:
        logger.error(f"[_batch_compute_flow] error: {e}")
        for t in tickers:
            result[t] = {'flow_direction': None, 'flow_strength': None, 'flow_score': None}
        return result


@portfolio_bp.route('/dashboard', methods=['GET'])
def portfolio_dashboard():
    """لوحة تحكم المحفظة الكاملة + B1: flow_direction لكل position"""
    try:
        portfolio_id = request.args.get('portfolio_id', 'default')

        portfolio = _load_portfolio_state(portfolio_id)
        if not portfolio:
            _save_portfolio_state(portfolio_id, "default", 100000, 30000, 100000, "balanced")
            portfolio = _load_portfolio_state(portfolio_id)

        positions = portfolio.get("positions", [])

        # B1: flow_direction — batch query (NO N+1)
        # اقرأ آخر 5 أيام من price_history.db لكل tickers مرة واحدة
        flow_map = _batch_compute_flow(positions)

        # Add flow_direction to each position
        for pos in positions:
            ticker = pos.get('ticker', '')
            flow = flow_map.get(ticker, {})
            pos['flow_direction'] = flow.get('flow_direction')
            pos['flow_strength'] = flow.get('flow_strength')
            pos['flow_score'] = flow.get('flow_score')

        # Heat calculation
        calculator = PortfolioHeatCalculator(
            portfolio_value=portfolio["value"],
            cash=portfolio["cash"],
            peak_value=portfolio["peak_value"]
        )
        for pos in positions:
            calculator.add_position(
                ticker=pos.get("ticker", "UNKNOWN"),
                value=pos.get("value", 0),
                stop_loss_pct=pos.get("stop_loss_pct", 8.0),
                sector=pos.get("sector", "unknown")
            )
        state = calculator.calculate_heat()
        
        # Journal stats
        journal_stats = trade_journal.get_statistics(30)
        open_trades = trade_journal.get_open_trades()
        
        return jsonify({
            "success": True,
            "dashboard": {
                "portfolio": {
                    "id": portfolio["portfolio_id"],
                    "value": portfolio["value"],
                    "cash": portfolio["cash"],
                    "cash_pct": round((portfolio["cash"] / portfolio["value"]) * 100, 1) if portfolio["value"] > 0 else 0,
                    "peak_value": portfolio["peak_value"],
                    "persona": portfolio["persona"],
                    "positions_count": len(positions)
                },
                "heat_analysis": state.to_dict(),
                "journal": {
                    "stats": journal_stats,
                    "open_trades": open_trades,
                    "open_count": len(open_trades)
                },
                "timestamp": datetime.now().isoformat(),
                "source": "python_backend_portfolio"
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRADING PATTERNS INFO
# ============================================================================

@portfolio_bp.route('/patterns', methods=['GET'])
def get_trading_patterns():
    """معلومات أنماط التداول"""
    patterns = [
        {
            "id": "hunter",
            "name_ar": "الصيّاد",
            "name_en": "The Hunter",
            "type": "Swing Trading",
            "duration": "5-30 يوم",
            "max_open": "3-5",
            "target_pct": "10-25%",
            "stop_pct": "7-12%",
            "description": "مسح أسبوعي → 10 فرص → 3 صفقات",
            "win_rate_target": "> 40%",
            "rr_target": "> 2.0",
            "expected_annual": "25-40%"
        },
        {
            "id": "farmer",
            "name_ar": "المزارع",
            "name_en": "The Farmer",
            "type": "Position Trading",
            "duration": "3-12 شهر",
            "max_open": "5-10",
            "target_pct": "30-100%",
            "stop_pct": "15-25%",
            "description": "تجميع تدريجي لشركات 'جواهر'",
            "win_rate_target": "> 60%",
            "rr_target": "> 1.5",
            "expected_annual": "15-25% + توزيعات"
        },
        {
            "id": "sniper",
            "name_ar": "القناص",
            "name_en": "The Sniper",
            "type": "Momentum Trading",
            "duration": "1-5 أيام",
            "max_open": "1-2",
            "target_pct": "5-15%",
            "stop_pct": "3-5%",
            "description": "اختراق قمة 20 يوم + Volume Spike",
            "win_rate_target": "> 50%",
            "rr_target": "> 1.5",
            "expected_annual": "5-10% شهرياً"
        },
        {
            "id": "lawyer",
            "name_ar": "المحامي",
            "name_en": "The Lawyer",
            "type": "Event-Driven",
            "duration": "1-4 أسابيع",
            "max_open": "2-4",
            "target_pct": "10-30%",
            "stop_pct": "5-10%",
            "description": "تداول حول أحداث معروفة (Earnings, CBE)",
            "win_rate_target": "> 45%",
            "rr_target": "> 2.0",
            "expected_annual": "20-30%"
        },
        {
            "id": "guard",
            "name_ar": "الحارس",
            "name_en": "The Guard",
            "type": "Hedging",
            "duration": "مستمر",
            "max_open": "غير محدود",
            "target_pct": "حماية",
            "stop_pct": "2-5% تكلفة التحوط",
            "description": "حماية المحفظة من الانهيارات",
            "win_rate_target": "N/A",
            "rr_target": "N/A",
            "expected_annual": "توفير 30% في الأزمات"
        }
    ]
    
    return jsonify({
        "success": True,
        "patterns": patterns
    })


@portfolio_bp.route('/rules', methods=['GET'])
def get_portfolio_rules():
    """قواعد إدارة المحفظة الذهبية"""
    rules = {
        "entry_rules": [
            {"id": 1, "rule": "لا تضع أكثر من 25% من الميزانية في الدفعة الأولى", "reason": "احتفظ بذخيرة"},
            {"id": 2, "rule": "كل دفعة لاحقة بسعر أقل 3-5%", "reason": "النزول البسيط = ضوضاء وليس فرصة"},
            {"id": 3, "rule": "الحجم يزيد في الأسعار المنخفضة (بحد أقصى 2x)", "reason": "تقليل المتوسط"},
            {"id": 4, "rule": "لكل دفعة Stop Loss خاص", "reason": "حماية كل استثمار"},
            {"id": 5, "rule": "الحد الأقصى 4 دفعات", "reason": "أكثر من 4 = زواج فاشل مع السهم"},
            {"id": 6, "rule": "لا تدخل إلا إذا R:R >= 1.5", "reason": "المخاطرة لا تستحق العائد"}
        ],
        "profit_rules": [
            {"id": 1, "rule": "+10% → اجني 30%", "reason": "الربح في الجيب"},
            {"id": 2, "rule": "+15% → اجني 25% المتبقي", "reason": "تحقيق المزيد"},
            {"id": 3, "rule": "+25% → اجني 25% المتبقي", "reason": "حماية مكاسب كبيرة"},
            {"id": 4, "rule": "+7% → ارفع الستوب لـ Entry + 1%", "reason": "لا تدع الربح يتحول لخسارة"}
        ],
        "drawdown_rules": [
            {"level": "0-5%", "action": "طبيعي. لا إجراء.", "emotion": "هادئ"},
            {"level": "5-10%", "action": "مراجعة. رفع ستوبات.", "emotion": "يقظ"},
            {"level": "10-15%", "action": "تخفيف 20% إجباري.", "emotion": "حذر"},
            {"level": "15-20%", "action": "تخفيف 40%. إغلاق المضاربات.", "emotion": "قلق"},
            {"level": "20-25%", "action": "تخفيف 60%. إبقاء الجواهر فقط.", "emotion": "ذعر"},
            {"level": "> 25%", "action": "إغلاق 80%. وقف كامل.", "emotion": "انهيار"}
        ],
        "psychology_enemies": [
            {"enemy": "التعلق", "symptom": "'أعرف هذا السهم من 5 سنين'", "treatment": "السهم لا يعرفك"},
            {"enemy": "الأمل", "symptom": "'هيرجع بس استنى'", "treatment": "الأمل ليس استراتيجية. الستوب هو الأمل"},
            {"enemy": "الخوف", "symptom": "بيع الرابح بسرعة", "treatment": "قاعدة Breakeven"},
            {"enemy": "الطمع", "symptom": "زيادة الحجم في الرابح", "treatment": "قاعدة Ladder"},
            {"enemy": "الغضب", "symptom": "'السوق ظالم!' → انتقام", "treatment": "3 خسائر = وقف 3 أيام"},
            {"enemy": "الملل", "symptom": "تداول لأنك لا تفعل شيئاً", "treatment": "النقد = مركز"},
            {"enemy": "الأنا", "symptom": "'أنا محلل لا أخطئ'", "treatment": "Journal. كل خسارة = درس"}
        ]
    }
    
    return jsonify({
        "success": True,
        "rules": rules
    })


# ============================================================
# Smart Portfolio Monitor — تفعيل (يوليو 2026)
# ============================================================
# ده الـ module اللي كان dead code. دلوقتي مربوط بـ API.
# بيحلّل كل سهم في محفظة المستخدم ويعطي:
#   - TAKE_PROFIT (ربح ≥15%)
#   - SELL (RSI>70 + ربح >5%)
#   - STOP_LOSS (خسارة ≥8%)
#   - BUY_MORE (RSI<30 + خسارة >3% — فرصة متوسط)
#   - HOLD
# ============================================================

_smart_monitor = None

def _get_smart_monitor():
    """Lazy singleton — ما يتلّعمش غير لما المستخدم يطلب الـ endpoint."""
    global _smart_monitor
    if _smart_monitor is None:
        try:
            from analyzers.smart_portfolio_monitor import SmartPortfolioMonitor
            _smart_monitor = SmartPortfolioMonitor()
        except Exception as e:
            logger.error(f"SmartPortfolioMonitor init failed: {e}")
            return None
    return _smart_monitor


@portfolio_bp.route('/smart-monitor', methods=['GET'])
def smart_portfolio_monitor():
    """تحليل ذكي لمحفظة المستخدم — بيع/شراء/احتفاظ لكل سهم.

    Query params:
      user_id — معرف المستخدم (مطلوب)

    Returns:
      summary + stock_signals (مع action لكل سهم) + wealth_plan + alerts
    """
    user_id = request.args.get('user_id', '').strip()
    if not user_id:
        return jsonify({
            "success": False,
            "error": "user_id مطلوب"
        }), 400

    monitor = _get_smart_monitor()
    if not monitor:
        return jsonify({
            "success": False,
            "error": "SmartPortfolioMonitor غير متاح — راجع logs"
        }), 503

    try:
        result = monitor.analyze_user_portfolio(user_id)
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        logger.exception(f"smart-monitor failed for user {user_id}")
        return jsonify({
            "success": False,
            "error": f"Internal error: {e}"
        }), 500


@portfolio_bp.route('/smart-monitor/signals', methods=['GET'])
def smart_monitor_signals():
    """الإشارات النشطة فقط (SELL/TAKE_PROFIT/STOP_LOSS/BUY_MORE) — بدون HOLD.

    أسرع endpoint للواجهة الأمامية: بيرجع بس الأسهم اللي محتاجة إجراء.
    """
    user_id = request.args.get('user_id', '').strip()
    if not user_id:
        return jsonify({"success": False, "error": "user_id مطلوب"}), 400

    monitor = _get_smart_monitor()
    if not monitor:
        return jsonify({"success": False, "error": "SmartPortfolioMonitor غير متاح"}), 503

    try:
        result = monitor.analyze_user_portfolio(user_id)
        active_signals = [
            s for s in result.get('stock_signals', [])
            if s.get('action') in ('SELL', 'TAKE_PROFIT', 'STOP_LOSS', 'BUY_MORE')
        ]
        return jsonify({
            "success": True,
            "user_id": user_id,
            "timestamp": result.get('timestamp'),
            "active_count": len(active_signals),
            "signals": active_signals,
            "alerts": result.get('alerts', []),
            "summary": {
                k: v for k, v in (result.get('summary') or {}).items()
                if k in ('total_assets', 'total_pnl', 'total_pnl_pct',
                         'sell_count', 'buy_more_count', 'hold_count')
            }
        })
    except Exception as e:
        logger.exception(f"smart-monitor/signals failed for user {user_id}")
        return jsonify({"success": False, "error": f"Internal error: {e}"}), 500


# ============================================================
# Portfolio Holdings — الشكل الكامل للواجهة (يوليو 2026)
# ============================================================
# بيرجع المحفظة grouped by نوع الأصل (stocks/gold/...) بالشكل
# اللي الصفحة بتوقعه (assets.* + summary.*)، ويرفق لكل سهم القرار
# الذكي (action/action_ar/reason/alerts) المحسوب في بايثون عبر
# SmartPortfolioMonitor — من غير أي حساب في النود (النود مجر عرض).

def _empty_summary():
    return {
        # Legacy keys (backward compat)
        "total_value": 0,
        "total_cost": 0,
        "total_profit_loss": 0,
        "total_profit_loss_percent": 0,
        # New keys (PORTFOLIO-PRICE-FIX-005)
        "total_invested": 0,
        "total_current_value": 0,
        "total_profit_loss_pct": 0,
    }


def _fallback_last_close(ticker: str) -> Optional[float]:
    """
    PORTFOLIO-PRICE-FIX-005: لو stocks.current_price غير متوفر (NULL/0)،
    نقرأ آخر close_price من price_history.db (نُفضّل مصدر egksco ثم migration).

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.

    CANONICAL-PRICE (Task PHASE-3, Rule 72) — this is the FALLBACK only.
    Primary LIVE source = stocks.db.stocks.current_price (caller responsibility).
    """
    if not ticker:
        return None
    try:
        from data.prices import load_price_history
        history = load_price_history(ticker, limit=1)
        if history:
            close = history[-1].get('close')
            if close and close > 0:
                return float(close)
    except Exception as e:
        logger.warning(f"holdings: _fallback_last_close failed for {ticker}: {e}")
    return None


@require_admin
@portfolio_bp.route('/holdings', methods=['GET'])
def portfolio_holdings():
    """محفظة العميل grouped + قرارات ذكية لكل سهم."""
    try:
        import sqlite3 as _sql
        from analyzers.smart_portfolio_monitor import SmartPortfolioMonitor

        user_id = request.args.get('user_id', '').strip()
        if not user_id:
            return jsonify({
                "success": True,
                "user_id": "",
                "assets": {"stocks": [], "gold": [], "real_estate": [], "deposits": [],
                           "certificates": [], "funds": [], "currencies": []},
                "summary": _empty_summary(),
            })

        monitor = SmartPortfolioMonitor()
        conn = _sql.connect(monitor.stocks_db)
        conn.row_factory = _sql.Row
        cur = conn.cursor()

        portfolio_id = request.args.get('portfolio_id', '').strip()
        if portfolio_id and portfolio_id != 'master' and portfolio_id != 'all':
            if portfolio_id == 'default':
                rows = cur.execute("""
                    SELECT p.*, s.current_price as live_price, s.change_percent,
                           s.rsi, s.signal, s.trend
                    FROM portfolio_assets p
                    LEFT JOIN stocks s
                      ON s.ticker = p.stock_ticker OR s.ticker = UPPER(p.stock_ticker)
                    WHERE (p.user_id = ? OR p.user_id = 'default') AND (p.portfolio_id = 'default' OR p.portfolio_id IS NULL OR p.portfolio_id = '')
                    ORDER BY p.type, p.stock_ticker
                """, (user_id,)).fetchall()
            else:
                rows = cur.execute("""
                    SELECT p.*, s.current_price as live_price, s.change_percent,
                           s.rsi, s.signal, s.trend
                    FROM portfolio_assets p
                    LEFT JOIN stocks s
                      ON s.ticker = p.stock_ticker OR s.ticker = UPPER(p.stock_ticker)
                    WHERE (p.user_id = ? OR p.user_id = 'default') AND (p.portfolio_id = ? OR p.portfolio_id = CAST(? AS TEXT))
                    ORDER BY p.type, p.stock_ticker
                """, (user_id, portfolio_id, portfolio_id)).fetchall()
        else:
            rows = cur.execute("""
                SELECT p.*, s.current_price as live_price, s.change_percent,
                       s.rsi, s.signal, s.trend
                FROM portfolio_assets p
                LEFT JOIN stocks s
                  ON s.ticker = p.stock_ticker OR s.ticker = UPPER(p.stock_ticker)
                WHERE (p.user_id = ? OR p.user_id = 'default')
                ORDER BY p.type, p.stock_ticker
            """, (user_id,)).fetchall()

        # Query portfolio_positions (stock holdings)
        if portfolio_id and portfolio_id != 'master' and portfolio_id != 'all':
            if portfolio_id == 'default':
                pos_rows = cur.execute("""
                    SELECT pp.id, pp.user_id, 'stock' as type, s.name_ar as name,
                           (pp.shares * pp.buy_price) as total_invested, (pp.shares * s.current_price) as current_value,
                           pp.shares as quantity, pp.buy_price as avg_buy_price, pp.ticker as stock_ticker,
                           pp.portfolio_id, s.current_price as live_price, s.change_percent
                    FROM portfolio_positions pp
                    LEFT JOIN stocks s ON s.ticker = pp.ticker OR s.ticker = UPPER(pp.ticker)
                    WHERE (pp.user_id = ? OR pp.user_id = 'default') AND (pp.portfolio_id = 'default' OR pp.portfolio_id IS NULL OR pp.portfolio_id = '')
                """, (user_id,)).fetchall()
            else:
                pos_rows = cur.execute("""
                    SELECT pp.id, pp.user_id, 'stock' as type, s.name_ar as name,
                           (pp.shares * pp.buy_price) as total_invested, (pp.shares * s.current_price) as current_value,
                           pp.shares as quantity, pp.buy_price as avg_buy_price, pp.ticker as stock_ticker,
                           pp.portfolio_id, s.current_price as live_price, s.change_percent
                    FROM portfolio_positions pp
                    LEFT JOIN stocks s ON s.ticker = pp.ticker OR s.ticker = UPPER(pp.ticker)
                    WHERE (pp.user_id = ? OR pp.user_id = 'default') AND (pp.portfolio_id = ? OR pp.portfolio_id = CAST(? AS TEXT))
                """, (user_id, portfolio_id, portfolio_id)).fetchall()
        else:
            pos_rows = cur.execute("""
                SELECT pp.id, pp.user_id, 'stock' as type, s.name_ar as name,
                       (pp.shares * pp.buy_price) as total_invested, (pp.shares * s.current_price) as current_value,
                       pp.shares as quantity, pp.buy_price as avg_buy_price, pp.ticker as stock_ticker,
                       pp.portfolio_id, s.current_price as live_price, s.change_percent
                FROM portfolio_positions pp
                LEFT JOIN stocks s ON s.ticker = pp.ticker OR s.ticker = UPPER(pp.ticker)
                WHERE (pp.user_id = ? OR pp.user_id = 'default')
            """, (user_id,)).fetchall()

        all_rows = [dict(r) for r in rows] + [dict(r) for r in pos_rows]

        updates_to_apply: list[tuple[float, str, int]] = []

        try:
            monitor_result = monitor.analyze_user_portfolio(user_id)
            signals_by_ticker = {
                s["ticker"]: s for s in monitor_result.get("stock_signals", [])
            }
        except Exception as e:
            logger.warning(f"holdings: smart monitor failed: {e}")
            signals_by_ticker = {}

        groups = {k: [] for k in (
            "stocks", "gold", "real_estate", "deposits",
            "certificates", "funds", "currencies",
        )}
        total_value = 0.0
        total_cost = 0.0
        now_iso = datetime.now().isoformat()

        for r in all_rows:
            atype = r.get("type")

            if atype == "stock":
                qty = r.get("quantity") or 0
                avg = r.get("avg_buy_price") or 0
                live = r.get("live_price") or 0
                if not live or live <= 0:
                    fallback = _fallback_last_close(r.get("stock_ticker"))
                    if fallback and fallback > 0:
                        live = fallback
                cost_basis = (avg * qty) if qty else (r.get("total_invested") or 0)
                market_value = (live * qty) if qty else (r.get("current_value") or 0)
                pl = market_value - cost_basis
                pl_pct = (pl / cost_basis * 100) if cost_basis > 0 else 0
                sig = signals_by_ticker.get(r.get("stock_ticker") or "") or {}

                asset_id = r.get("id")
                try:
                    if asset_id is not None and qty and "weight_grams" in r:
                        updates_to_apply.append((round(market_value, 4), now_iso, int(asset_id)))
                except (TypeError, ValueError):
                    pass

                groups["stocks"].append({
                    "id": str(r.get("id")),
                    "portfolio_id": str(r.get("portfolio_id") or "2"),
                    "stock_symbol": r.get("stock_ticker") or "",
                    "stock_name": r.get("name") or r.get("stock_ticker") or "",
                    "shares": qty,
                    "avg_cost": avg,
                    "current_price": live,
                    "market_value": round(market_value, 2),
                    "cost_basis": round(cost_basis, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                    "action": sig.get("action"),
                    "action_ar": sig.get("action_ar"),
                    "reason": sig.get("reason"),
                    "alerts": sig.get("alerts") or [],
                })
            elif atype in ("gold", "silver"):
                pl = market_value - cost_basis
                pl_pct = (pl / cost_basis * 100) if cost_basis > 0 else 0
                sig = signals_by_ticker.get(r.get("stock_ticker") or "") or {}

                # PORTFOLIO-PRICE-FIX-005: حدّث current_value في DB ليكون
                # متسقاً مع ما يراه المستخدم في الـ UI (حل المشكلة الأساسية
                # "current_value=0.0 في DB بينما الـ API يحسبه live").
                asset_id = r.get("id")
                try:
                    if asset_id is not None and qty:
                        updates_to_apply.append((round(market_value, 4), now_iso, int(asset_id)))
                except (TypeError, ValueError):
                    pass

                groups["stocks"].append({
                    "id": str(r.get("id")),
                    "stock_symbol": r.get("stock_ticker") or "",
                    "stock_name": r.get("name") or r.get("stock_ticker") or "",
                    "shares": qty,
                    "avg_cost": avg,
                    "current_price": live,
                    "market_value": round(market_value, 2),
                    "cost_basis": round(cost_basis, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                    "action": sig.get("action"),
                    "action_ar": sig.get("action_ar"),
                    "reason": sig.get("reason"),
                    "alerts": sig.get("alerts") or [],
                    "confidence": sig.get("confidence"),
                    "stop_loss": sig.get("stop_loss"),
                    "take_profit": sig.get("take_profit"),
                    "rsi": sig.get("rsi"),
                })
                total_value += market_value
                total_cost += cost_basis

            elif atype in ("bank", "certificate", "deposit", "fund"):
                invested = float(r.get("total_invested") or 0)
                rate = float(r.get("interest_rate") or r.get("certificate_return_rate") or 0)
                added_at_str = r.get("added_at")
                
                yearly_int = invested * (rate / 100.0) if rate > 0 and invested > 0 else 0.0
                monthly_int = yearly_int / 12.0
                daily_int = yearly_int / 365.0
                
                days_elapsed = 0
                if added_at_str:
                    try:
                        dt_added = datetime.fromisoformat(str(added_at_str).replace("Z", "+00:00").split("+")[0])
                        days_elapsed = max(0, (datetime.now() - dt_added).days)
                    except Exception:
                        days_elapsed = 0
                
                accrued_int = daily_int * days_elapsed
                curr_val = float(r.get("current_value") or 0)
                if curr_val <= 0 or abs(curr_val - invested) < 0.01:
                    curr_val = invested + accrued_int
                
                pl = curr_val - invested
                pl_pct = (pl / invested * 100.0) if invested > 0 else 0.0
                
                item_obj = {
                    "id": str(r.get("id")),
                    "name": r.get("name") or "حساب / شهادة",
                    "bank_name": r.get("bank_name") or r.get("name") or "البنك",
                    "deposit_type": "FIXED",
                    "principal_amount": round(invested, 2),
                    "total_invested": round(invested, 2),
                    "interest_rate": rate,
                    "certificate_return_rate": rate,
                    "annual_return_rate": rate,
                    "yearly_interest": round(yearly_int, 2),
                    "monthly_interest": round(monthly_int, 2),
                    "daily_interest": round(daily_int, 2),
                    "interest_accrued": round(accrued_int, 2),
                    "accrued_interest": round(accrued_int, 2),
                    "days_elapsed": days_elapsed,
                    "current_value": round(curr_val, 2),
                    "total_value": round(curr_val, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                    "certificate_name": r.get("name") or "شهادة",
                    "total_return": round(accrued_int, 2),
                    "fund_name": r.get("fund_name") or r.get("name") or "صندوق استثمار",
                    "fund_type": r.get("fund_type") or "equity",
                }

                if atype == "certificate":
                    groups["certificates"].append(item_obj)
                elif atype == "fund":
                    groups["funds"].append(item_obj)
                else:
                    groups["deposits"].append(item_obj)

                total_value += curr_val
                total_cost += invested

            elif atype == "gold":
                w = float(r.get("weight_grams") or 0)
                ppg = float(r.get("purchase_price_per_gram") or 0)
                karat = int(r.get("karat") or 24)
                total_cost_g = float(r.get("total_invested") or (ppg * w))
                
                live_cpg = 4200.0 if karat == 24 else (3675.0 if karat == 21 else (3150.0 if karat == 18 else 4200.0))
                
                curr_val = (w * live_cpg) if (w > 0 and live_cpg > 0) else float(r.get("current_value") or 0)
                if curr_val <= 0:
                    curr_val = total_cost_g
                
                pl = curr_val - total_cost_g
                pl_pct = (pl / total_cost_g * 100.0) if total_cost_g > 0 else 0.0

                groups["gold"].append({
                    "id": str(r.get("id")),
                    "name": r.get("name") or "ذهب",
                    "weight_grams": w,
                    "purchase_price_per_gram": ppg,
                    "total_cost": round(total_cost_g, 2),
                    "total_invested": round(total_cost_g, 2),
                    "karat": karat,
                    "current_price_per_gram": live_cpg,
                    "current_value": round(curr_val, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                })
                total_value += curr_val
                total_cost += total_cost_g

            elif atype == "currency":
                amt = float(r.get("quantity") or 0)
                buy_rate = float(r.get("avg_buy_price") or 0)
                total_cost_curr = float(r.get("total_invested") or (amt * buy_rate))
                curr_code = (r.get("stock_ticker") or r.get("name") or "USD").upper()
                
                rates = {"USD": 48.5, "EUR": 52.8, "GBP": 62.5, "SAR": 12.9, "AED": 13.2}
                live_rate = rates.get(curr_code, 48.5)
                
                curr_val = (amt * live_rate) if (amt > 0 and live_rate > 0) else float(r.get("current_value") or total_cost_curr)
                if curr_val <= 0:
                    curr_val = total_cost_curr
                
                pl = curr_val - total_cost_curr
                pl_pct = (pl / total_cost_curr * 100.0) if total_cost_curr > 0 else 0.0

                groups["currencies"].append({
                    "id": str(r.get("id")),
                    "currency_code": curr_code,
                    "currency_name": r.get("name") or curr_code,
                    "amount": amt,
                    "purchase_rate": buy_rate,
                    "purchase_cost_egp": round(total_cost_curr, 2),
                    "total_invested": round(total_cost_curr, 2),
                    "current_rate": live_rate,
                    "current_value_egp": round(curr_val, 2),
                    "current_value": round(curr_val, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                })
                total_value += curr_val
                total_cost += total_cost_curr

            elif atype == "real_estate":
                purchase = float(r.get("total_invested") or 0)
                est_val = float(r.get("current_value") or purchase)
                if est_val <= 0:
                    est_val = purchase
                pl = est_val - purchase
                pl_pct = (pl / purchase * 100.0) if purchase > 0 else 0.0

                groups["real_estate"].append({
                    "id": str(r.get("id")),
                    "name": r.get("name") or "عقار",
                    "property_type": "APARTMENT",
                    "purchase_price": round(purchase, 2),
                    "total_invested": round(purchase, 2),
                    "estimated_value": round(est_val, 2),
                    "current_value": round(est_val, 2),
                    "profit_loss": round(pl, 2),
                    "profit_loss_percent": round(pl_pct, 2),
                    "is_rented": False,
                })
                total_value += est_val
                total_cost += purchase

            else:
                continue

        # PORTFOLIO-PRICE-FIX-005: تنفيذ batch update لـ current_value
        # عشان DB يبقى متسق مع القيم التي يعرضها الـ API.
        try:
            if updates_to_apply:
                cur.executemany(
                    "UPDATE portfolio_assets SET current_value = ?, updated_at = ? WHERE id = ?",
                    updates_to_apply,
                )
                conn.commit()
                logger.info(f"holdings: refreshed current_value for {len(updates_to_apply)} stock assets (user={user_id})")
        except Exception as e:
            logger.warning(f"holdings: failed to persist current_value updates: {e}")
        finally:
            conn.close()

        total_pl = total_value - total_cost
        total_pl_pct = (total_pl / total_cost * 100) if total_cost > 0 else 0
        summary = {
            # Legacy keys (backward compat)
            "total_value": round(total_value, 2),
            "total_cost": round(total_cost, 2),
            "total_profit_loss": round(total_pl, 2),
            "total_profit_loss_percent": round(total_pl_pct, 2),
            # New keys (PORTFOLIO-PRICE-FIX-005)
            "total_invested": round(total_cost, 2),
            "total_current_value": round(total_value, 2),
            "total_profit_loss_pct": round(total_pl_pct, 2),
        }

        return jsonify({"success": True, "user_id": user_id, "assets": groups, "summary": summary})
    except Exception as e:
        logger.exception("portfolio/holdings failed")
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Trade Recorder API — تسجيل صفقات المستخدم الفعلية + التحليل
# ============================================================
# ده كان dead code تماماً — الـ TradeRecorder مكتوب كويس بس
# مفيش API endpoint يوصله. دلوقتي مربوط:
#   POST /api/portfolio/trades/record-buy
#   POST /api/portfolio/trades/record-sell
#   GET  /api/portfolio/trades/list
#   GET  /api/portfolio/trades/outcomes
#   GET  /api/portfolio/trades/performance
#   POST /api/portfolio/trades/learn
# ============================================================

_trade_recorder = None

def _get_trade_recorder():
    global _trade_recorder
    if _trade_recorder is None:
        try:
            from ai.trade_recorder import TradeRecorder
            _trade_recorder = TradeRecorder()
        except Exception as e:
            logger.error(f"TradeRecorder init failed: {e}")
            return None
    return _trade_recorder


@require_admin
@portfolio_bp.route('/trades/record-buy', methods=['POST'])
def record_buy_trade():
    """تسجيل صفقة شراء فعلية"""
    try:
        data = request.get_json() or {}
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        result = rec.record_buy(
            user_id=data.get('user_id', 'default'),
            ticker=data.get('ticker', ''),
            price=float(data.get('price', 0)),
            quantity=float(data.get('quantity', 0)),
            trade_date=data.get('trade_date'),
            notes=data.get('notes', ''),
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/trades/record-sell', methods=['POST'])
def record_sell_trade():
    """تسجيل صفقة بيع فعلية + حساب الـ outcome تلقائياً"""
    try:
        data = request.get_json() or {}
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        result = rec.record_sell(
            user_id=data.get('user_id', 'default'),
            ticker=data.get('ticker', ''),
            price=float(data.get('price', 0)),
            quantity=float(data.get('quantity', 0)),
            trade_date=data.get('trade_date'),
            notes=data.get('notes', ''),
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/trades/list', methods=['GET'])
def list_user_trades():
    """قائمة صفقات المستخدم (BUY + SELL)"""
    try:
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        user_id = request.args.get('user_id', 'default')
        limit = request.args.get('limit', 50, type=int)
        trades = rec.get_user_trades(user_id, limit)
        return jsonify({"success": True, "trades": trades, "count": len(trades)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/trades/outcomes', methods=['GET'])
def list_trade_outcomes():
    """نتائج الصفقات المغلقة"""
    try:
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        user_id = request.args.get('user_id') or None
        limit = request.args.get('limit', 50, type=int)
        outcomes = rec.get_trade_outcomes(user_id, limit)
        return jsonify({"success": True, "outcomes": outcomes, "count": len(outcomes)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/trades/performance', methods=['GET'])
def get_trade_performance():
    """إحصائيات أداء الصفقات"""
    try:
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        user_id = request.args.get('user_id') or None
        stats = rec.get_performance_stats(user_id)
        return jsonify({"success": True, "performance": stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/trades/learn', methods=['POST'])
def trigger_learning():
    """تشغيل حلقة التعلم على الصفقات غير المحلّلة"""
    try:
        rec = _get_trade_recorder()
        if not rec:
            return jsonify({"success": False, "error": "TradeRecorder غير متاح"}), 503

        data = request.get_json() or {}
        user_id = data.get('user_id') or None
        summary = rec.learn_from_trades(user_id)
        return jsonify({"success": True, "learning": summary})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


__all__ = ['portfolio_bp']


# ============================================================
# Equity Curve + P&L History + Cash Transactions — تتبع رأس المال
# ============================================================
# جداول جديدة في predictions.db:
#   equity_snapshots    — سجل يومي لقيمة المحفظة (منحنى رأس المال)
#   cash_transactions   — إيداعات/سحوبات
#   portfolio_pnl_history — سجل أرباح/خسائر يومية
# ============================================================

_EQUITY_SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS equity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        total_value REAL NOT NULL DEFAULT 0,
        total_invested REAL NOT NULL DEFAULT 0,
        cash_balance REAL NOT NULL DEFAULT 0,
        pnl REAL NOT NULL DEFAULT 0,
        pnl_pct REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_equity_user_date ON equity_snapshots(user_id, snapshot_date);

    CREATE TABLE IF NOT EXISTS cash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        transaction_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cash_user ON cash_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(transaction_date);

    CREATE TABLE IF NOT EXISTS portfolio_pnl_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        ticker TEXT,
        pnl REAL NOT NULL DEFAULT 0,
        pnl_pct REAL NOT NULL DEFAULT 0,
        record_date TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pnl_user_date ON portfolio_pnl_history(user_id, record_date);
"""

_equity_schema_ready = False

def _ensure_equity_schema():
    global _equity_schema_ready
    if _equity_schema_ready:
        return
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_eqs_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_eqs_ctx = _dbm.connection(_get_portfolio_db_path(), writable=True)
                conn = _pr_eqs_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_portfolio_db_path())
            _pr_eqs_ctx = None
        conn.executescript(_EQUITY_SCHEMA_SQL)
        conn.commit()
        conn.close()
        _equity_schema_ready = True
    except sqlite3.Error as e:
        logger.error("فشل إنشاء equity schema: %s", e)


# ============================================================
# Equity Curve Endpoints
# ============================================================

@require_admin
@portfolio_bp.route('/equity/snapshot', methods=['POST'])
def record_equity_snapshot():
    """تسجيل لقطة يومية لقيمة المحفظة"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        snapshot_date = data.get('snapshot_date', datetime.now().strftime('%Y-%m-%d'))
        total_value = float(data.get('total_value', 0))
        total_invested = float(data.get('total_invested', 0))
        cash_balance = float(data.get('cash_balance', 0))
        pnl = float(data.get('pnl', total_value - total_invested))
        pnl_pct = float(data.get('pnl_pct', (pnl / total_invested * 100) if total_invested > 0 else 0))

        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        conn.execute(
            """INSERT INTO equity_snapshots
               (user_id, snapshot_date, total_value, total_invested, cash_balance, pnl, pnl_pct)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, snapshot_date, total_value, total_invested, cash_balance, pnl, pnl_pct),
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "تم تسجيل اللقطة"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/equity/curve', methods=['GET'])
def get_equity_curve():
    """منحنى رأس المال — كل اللقطات المسجلة"""
    try:
        user_id = request.args.get('user_id', 'default')
        days = request.args.get('days', 90, type=int)
        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        cutoff = (datetime.now() - __import__('datetime').timedelta(days=days)).strftime('%Y-%m-%d')
        rows = conn.execute(
            """SELECT * FROM equity_snapshots
               WHERE user_id=? AND snapshot_date >= ?
               ORDER BY snapshot_date ASC""",
            (user_id, cutoff),
        ).fetchall()
        conn.close()

        snapshots = [dict(r) for r in rows]
        meta = {}
        if snapshots:
            first = snapshots[0]
            last = snapshots[-1]
            total_pnl = last["total_value"] - first["total_value"]
            meta = {
                "start_value": first["total_value"],
                "end_value": last["total_value"],
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round((total_pnl / first["total_value"] * 100) if first["total_value"] > 0 else 0, 2),
                "peak_value": max(s["total_value"] for s in snapshots),
                "trough_value": min(s["total_value"] for s in snapshots),
                "days_tracked": len(snapshots),
            }

        return jsonify({"success": True, "snapshots": snapshots, "meta": meta, "count": len(snapshots)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Cash Transactions Endpoints
# ============================================================

@require_admin
@portfolio_bp.route('/cash/record', methods=['POST'])
def record_cash_transaction():
    """تسجيل إيداع أو سحب"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        txn_type = data.get('transaction_type', 'deposit')
        amount = float(data.get('amount', 0))
        txn_date = data.get('transaction_date', datetime.now().strftime('%Y-%m-%d'))
        notes = data.get('notes', '')

        if txn_type not in ('deposit', 'withdrawal'):
            return jsonify({"success": False, "error": "transaction_type must be deposit or withdrawal"}), 400

        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        conn.execute(
            """INSERT INTO cash_transactions
               (user_id, transaction_type, amount, transaction_date, notes)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, txn_type, amount, txn_date, notes),
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "تم تسجيل المعاملة"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/cash/transactions', methods=['GET'])
def list_cash_transactions():
    """قائمة الإيداعات والسحوبات"""
    try:
        user_id = request.args.get('user_id', 'default')
        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        rows = conn.execute(
            """SELECT * FROM cash_transactions
               WHERE user_id=?
               ORDER BY transaction_date DESC, id DESC""",
            (user_id,),
        ).fetchall()
        conn.close()

        transactions = [dict(r) for r in rows]
        total_deposits = sum(t["amount"] for t in transactions if t["transaction_type"] == "deposit")
        total_withdrawals = sum(t["amount"] for t in transactions if t["transaction_type"] == "withdrawal")

        return jsonify({
            "success": True,
            "transactions": transactions,
            "count": len(transactions),
            "summary": {
                "total_deposits": round(total_deposits, 2),
                "total_withdrawals": round(total_withdrawals, 2),
                "net_flow": round(total_deposits - total_withdrawals, 2),
            },
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# P&L History Endpoints
# ============================================================

@require_admin
@portfolio_bp.route('/pnl/record', methods=['POST'])
def record_pnl():
    """تسجيل ربح/خسارة"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        ticker = data.get('ticker')
        pnl = float(data.get('pnl', 0))
        pnl_pct = float(data.get('pnl_pct', 0))
        record_date = data.get('record_date', datetime.now().strftime('%Y-%m-%d'))
        source = data.get('source', 'manual')

        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        conn.execute(
            """INSERT INTO portfolio_pnl_history
               (user_id, ticker, pnl, pnl_pct, record_date, source)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, ticker, pnl, pnl_pct, record_date, source),
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "تم تسجيل P&L"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/pnl/history', methods=['GET'])
def get_pnl_history():
    """سجل الأرباح/الخسائر"""
    try:
        user_id = request.args.get('user_id', 'default')
        days = request.args.get('days', 30, type=int)
        _ensure_equity_schema()
        conn = _get_portfolio_conn()
        cutoff = (datetime.now() - __import__('datetime').timedelta(days=days)).strftime('%Y-%m-%d')
        rows = conn.execute(
            """SELECT * FROM portfolio_pnl_history
               WHERE user_id=? AND record_date >= ?
               ORDER BY record_date DESC, id DESC""",
            (user_id, cutoff),
        ).fetchall()
        conn.close()

        records = [dict(r) for r in rows]
        total_pnl = sum(r["pnl"] for r in records)
        wins = [r for r in records if r["pnl"] > 0]
        losses = [r for r in records if r["pnl"] < 0]

        return jsonify({
            "success": True,
            "records": records,
            "count": len(records),
            "summary": {
                "total_pnl": round(total_pnl, 2),
                "wins": len(wins),
                "losses": len(losses),
                "win_rate": round(len(wins) / len(records) * 100, 1) if records else 0,
                "avg_win": round(sum(r["pnl"] for r in wins) / len(wins), 2) if wins else 0,
                "avg_loss": round(sum(r["pnl"] for r in losses) / len(losses), 2) if losses else 0,
            },
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Hard Protection Engine API — حماية صلبة قبل تنفيذ الصفقات
# ============================================================

from portfolio.hard_protection import HardProtectionEngine, hard_protection_engine


@require_admin
@portfolio_bp.route('/protection/check', methods=['POST'])
def check_protections():
    """فحص كل الحمايات قبل تنفيذ صفقة"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        ticker = data.get('ticker', 'UNKNOWN')
        trade_value_pct = float(data.get('trade_value_percent', 0))
        current_vix = data.get('current_vix')

        result = hard_protection_engine.check_all_protections(
            user_id=user_id, ticker=ticker,
            trade_value_percent=trade_value_pct,
            current_vix=current_vix if current_vix else None,
        )
        return jsonify({"success": True, "protection": result.to_dict()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/protection/state', methods=['GET'])
def get_protection_state():
    """حالة المستخدم في الحماية الصلبة"""
    try:
        user_id = request.args.get('user_id', 'default')
        state = hard_protection_engine.get_user_state(user_id)
        locks = hard_protection_engine.get_all_locks()
        return jsonify({
            "success": True,
            "user_state": state,
            "active_locks": locks,
            "current_vix": hard_protection_engine.current_vix,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/protection/record-trade', methods=['POST'])
def record_protection_trade():
    """تسجيل نتيجة صفقة في محرك الحماية"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        ticker = data.get('ticker', 'UNKNOWN')
        result = data.get('result', 'profit')
        pnl_pct = float(data.get('pnl_percent', 0))
        position_pct = float(data.get('position_percent', 0))

        hard_protection_engine.record_trade(
            user_id=user_id, ticker=ticker,
            result=result, pnl_percent=pnl_pct,
            position_percent=position_pct,
        )
        return jsonify({"success": True, "message": "تم تسجيل نتيجة الصفقة"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/protection/reset-daily', methods=['POST'])
def reset_daily_protection():
    """إعادة تعيين الخسارة اليومية"""
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        hard_protection_engine.reset_daily(user_id)
        return jsonify({"success": True, "message": "تم إعادة تعيين اليومي"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# POSITION-SIZING-024: Position Sizing + T+2 Settlement Endpoints
# ============================================================
# - GET  /api/portfolio/position-size?ticker=X&entry=Y&stop=Z&user_id=U
#       يحسب suggested_position_size_pct بناءً على risk 2% + قواعد 5%/30%
# - GET  /api/portfolio/available-cash?user_id=U
#       يرجّع السيولة المتاحة فعلياً (بعد خصم T+2)
# - POST /api/portfolio/record-settlement
#       يسجّل صفقة buy/sell في pending_settlements
# - GET  /api/portfolio/pending-settlements?user_id=U
#       يرجّع قائمة الصفقات المعلّقة (للتسوية)
# ============================================================

from portfolio.hard_protection import (
    calculate_available_cash,
    record_pending_trade,
    list_pending_settlements,
    T2_SETTLEMENT_DAYS,
)


def _get_portfolio_value_for_user(user_id: str) -> float:
    """قراءة قيمة المحفظة لليوزر من predictions.db (portfolio_state.value)
    fallback: 100000.
    """
    try:
        conn = _get_portfolio_conn()
        row = conn.execute(
            "SELECT value FROM portfolio_state WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        conn.close()
        if row and row['value'] is not None:
            return float(row['value'])
    except Exception:
        pass
    # fallback: لو portfolio_state فارغة، نحاول نجمع current_value من stocks.db
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_gpv_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_gpv_ctx = _dbm.connection(_get_stocks_db_path(), writable=False)
                stocks_conn = _pr_gpv_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            stocks_conn = sqlite3.connect(_get_stocks_db_path())
            _pr_gpv_ctx = None
        stocks_conn.row_factory = sqlite3.Row
        row = stocks_conn.execute(
            "SELECT COALESCE(SUM(current_value), 0) AS total FROM portfolio_assets WHERE user_id=?",
            (user_id,),
        ).fetchone()
        stocks_conn.close()
        if row and row['total'] is not None and float(row['total']) > 0:
            return float(row['total'])
    except Exception:
        pass
    return 100000.0


def _get_stocks_db_path() -> str:
    from pathlib import Path
    return str(Path(__file__).parent.parent.parent / 'db' / 'stocks.db')


def _get_existing_position_value(user_id: str, ticker: str) -> float:
    """قراءة قيمة المركز الحالي للسهم للمستخدم من stocks.db."""
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_epv_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_epv_ctx = _dbm.connection(_get_stocks_db_path(), writable=False)
                conn = _pr_epv_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_stocks_db_path())
            _pr_epv_ctx = None
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT current_value FROM portfolio_assets WHERE user_id=? AND UPPER(stock_ticker)=UPPER(?) AND type='stock' LIMIT 1",
            (user_id, ticker),
        ).fetchone()
        conn.close()
        if row and row['current_value'] is not None:
            return float(row['current_value'])
    except Exception:
        pass
    return 0.0


def _get_total_exposure_value(user_id: str) -> float:
    """إجمالي التعرض للسوق (مجموع قيم كل المراكز المفتوحة)."""
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_tev_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_tev_ctx = _dbm.connection(_get_stocks_db_path(), writable=False)
                conn = _pr_tev_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_stocks_db_path())
            _pr_tev_ctx = None
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT COALESCE(SUM(current_value), 0) AS total FROM portfolio_assets WHERE user_id=? AND type='stock'",
            (user_id,),
        ).fetchone()
        conn.close()
        if row and row['total'] is not None:
            return float(row['total'])
    except Exception:
        pass
    return 0.0


@portfolio_bp.route('/position-size', methods=['GET'])
def calculate_position_size():
    """GET /api/portfolio/position-size?ticker=X&entry=Y&stop=Z&user_id=U&target=T

    يحسب suggested_position_size_pct:
        risk_amount        = portfolio_value * 0.02   (2% من المحفظة = أقصى خسارة)
        risk_per_share     = entry - stop
        shares             = risk_amount / risk_per_share
        position_value     = shares * entry
        suggested_pct      = (position_value / portfolio_value) * 100

    القواعد:
        - حجم الصفقة = 5% كحد أقصى للسهم الواحد (لو تجاوز، يُقصّر لـ 5%)
        - أقصى تعرض للسوق = 30% (لو تجاوز، يُقصّر لما تبقى من الـ 30%)
        - لو السيولة المتاحة (T+2) < حجم الصفقة → signal=HOLD + warning
    """
    try:
        ticker = (request.args.get('ticker') or '').upper().strip()
        entry = float(request.args.get('entry') or 0)
        stop = float(request.args.get('stop') or 0)
        target = request.args.get('target')
        target = float(target) if target else None
        user_id = request.args.get('user_id', 'default')

        if not ticker or entry <= 0 or stop <= 0:
            return jsonify({
                "success": False,
                "error": "ticker, entry (>0), stop (>0) are required"
            }), 400

        if stop >= entry:
            return jsonify({
                "success": False,
                "error": "stop must be < entry for a long position (risk_per_share must be positive)"
            }), 400

        # 1) حساب المحفظة + السيولة المتاحة (T+2)
        portfolio_value = _get_portfolio_value_for_user(user_id)
        cash_info = calculate_available_cash(user_id)
        available_cash = float(cash_info.get('available_cash', 0))

        # 2) حساب الـ risk-based position size
        #    BRAVO UNIFY (Rule 67): delegate core calculation to canonical utils.position_sizing
        #    canonical بـ يطبق max_position_pct cap (5% per ticker هنا)
        _pos_result = _canonical_risk_position(
            capital=portfolio_value,
            entry=entry,
            stop=stop,
            risk_pct=2.0,  # 2% max loss
            direction="BUY",
            max_position_pct=5.0,  # 5% max per single ticker
        )
        if _pos_result is None:
            return jsonify({
                "success": False,
                "error": "position sizing failed: invalid entry/stop"
            }), 400
        risk_amount = _pos_result['risk_amount']
        risk_per_share = _pos_result['risk_per_share']
        shares = _pos_result['position_size']
        position_value = _pos_result['position_value']
        suggested_pct = _pos_result['position_pct']
        capped_by_ticker = (suggested_pct >= 5.0)

        # 3) تطبيق قواعد الـ caps
        #    (a) 5% max per single ticker
        max_per_ticker_pct = 5.0
        capped_by_ticker = False
        if suggested_pct > max_per_ticker_pct:
            suggested_pct = max_per_ticker_pct
            position_value = portfolio_value * (suggested_pct / 100)
            shares = position_value / entry
            capped_by_ticker = True

        #    (b) 30% max total exposure
        existing_position_value = _get_existing_position_value(user_id, ticker)
        total_exposure_existing = _get_total_exposure_value(user_id)
        max_total_exposure_value = portfolio_value * 0.30
        room_in_exposure = max_total_exposure_value - total_exposure_existing
        capped_by_exposure = False
        if position_value > room_in_exposure:
            position_value = max(0, room_in_exposure)
            shares = position_value / entry if entry > 0 else 0
            suggested_pct = (position_value / portfolio_value * 100) if portfolio_value > 0 else 0
            capped_by_exposure = True

        # 4) فحص السيولة المتاحة
        position_warning = None
        signal = "BUY"  # افتراضياً BUY لو التوصية سمحت
        if available_cash < position_value:
            position_warning = (
                f"سيولة غير كافية - انتظر تسوية T+2 "
                f"(مطلوب {position_value:.2f}، متاح {available_cash:.2f})"
            )
            signal = "HOLD"

        # 5) لو existing_position_value كبير (≥ 5%) ننبه
        existing_position_pct = (existing_position_value / portfolio_value * 100) if portfolio_value > 0 else 0
        if existing_position_pct >= max_per_ticker_pct:
            position_warning = (
                position_warning or
                f"تعرضك الحالي على {ticker} = {existing_position_pct:.1f}% (الحد الأقصى 5%)"
            )

        # 6) R:R
        risk_reward = None
        if target and entry and stop and entry != stop:
            risk_reward = round((target - entry) / (entry - stop), 2)
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                risk_reward = compute_risk_reward(entry, target, stop, fallback=risk_reward)
            except Exception:
                pass  # keep inline risk_reward computed above

        response = {
            "success": True,
            "ticker": ticker,
            "user_id": user_id,
            "entry": round(entry, 4),
            "stop": round(stop, 4),
            "target": round(target, 4) if target else None,
            "risk_reward": risk_reward,
            "portfolio_value": round(portfolio_value, 2),
            "available_cash": round(available_cash, 2),
            "available_cash_breakdown": cash_info,
            "risk_amount": round(risk_amount, 2),
            "risk_per_share": round(risk_per_share, 4),
            "shares": round(shares, 2),
            "position_value": round(position_value, 2),
            "suggested_position_size_pct": round(suggested_pct, 2),
            "existing_position_value": round(existing_position_value, 2),
            "existing_position_pct": round(existing_position_pct, 2),
            "total_exposure_existing": round(total_exposure_existing, 2),
            "max_total_exposure_pct": 30.0,
            "max_per_ticker_pct": max_per_ticker_pct,
            "capped_by_ticker_rule": capped_by_ticker,
            "capped_by_exposure_rule": capped_by_exposure,
            "signal": signal,
            "position_warning": position_warning,
            "settlement_days": T2_SETTLEMENT_DAYS,
        }
        return jsonify(response)
    except Exception as e:
        logger.exception("portfolio/position-size failed")
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/available-cash', methods=['GET'])
def get_available_cash():
    """GET /api/portfolio/available-cash?user_id=U
    يرجّع السيولة المتاحة فعلياً (بعد خصم T+2).
    """
    try:
        user_id = request.args.get('user_id', 'default')
        info = calculate_available_cash(user_id)
        return jsonify({"success": True, **info})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/record-settlement', methods=['POST'])
def record_settlement():
    """POST /api/portfolio/record-settlement
    يسجّل صفقة buy/sell في pending_settlements (لأجل حساب T+2).

    Body:
        user_id, ticker, side ('buy'|'sell'), quantity, price,
        trade_date (optional ISO), notes (optional)
    """
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        ticker = (data.get('ticker') or '').upper().strip()
        side = (data.get('side') or '').lower().strip()
        quantity = float(data.get('quantity') or 0)
        price = float(data.get('price') or 0)
        notes = data.get('notes', '')

        if side not in ('buy', 'sell'):
            return jsonify({"success": False, "error": "side must be 'buy' or 'sell'"}), 400
        if not ticker or quantity <= 0 or price <= 0:
            return jsonify({"success": False, "error": "ticker, quantity (>0), price (>0) required"}), 400

        trade_date = None
        if data.get('trade_date'):
            try:
                trade_date = datetime.fromisoformat(data['trade_date'])
            except Exception:
                trade_date = None

        row_id = record_pending_trade(
            user_id=user_id, side=side, ticker=ticker,
            quantity=quantity, price=price,
            trade_date=trade_date, notes=notes,
        )
        if row_id < 0:
            return jsonify({"success": False, "error": "failed to record settlement"}), 500

        # رجّع السيولة المتاحة المُحدّثة
        info = calculate_available_cash(user_id)
        return jsonify({
            "success": True,
            "settlement_id": row_id,
            "updated_available_cash": info,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/pending-settlements', methods=['GET'])
def get_pending_settlements():
    """GET /api/portfolio/pending-settlements?user_id=U&only_unsettled=1
    يرجّع قائمة الصفقات المعلّقة (للتسوية).
    """
    try:
        user_id = request.args.get('user_id', 'default')
        only_unsettled = request.args.get('only_unsettled', '0') == '1'
        rows = list_pending_settlements(user_id, only_unsettled=only_unsettled)
        return jsonify({
            "success": True,
            "user_id": user_id,
            "count": len(rows),
            "settlements": rows,
            "settlement_days": T2_SETTLEMENT_DAYS,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# MULTI-PORTFOLIO-032: Multi-Portfolio Architecture
# ============================================================
# جدول جديد: portfolios — المحفظة الأم + المحافظ الفرعية (Sub-Accounts)
# يربط المستخدم بحسابات متعددة من وسطاء مختلفين (ثاندر، مباشر، بينانس).
#
# Schema:
#   portfolios(id, user_id, name, broker, market, currency, is_master, ...)
#   + ALTER TABLE portfolio_state ADD COLUMN portfolio_id (FK)
#   + ALTER TABLE equity_snapshots ADD COLUMN portfolio_id (FK)
#   + ALTER TABLE cash_transactions ADD COLUMN portfolio_id (FK)
# ============================================================

_MULTI_PORTFOLIO_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    broker TEXT DEFAULT 'manual',
    market TEXT DEFAULT 'EGX',
    currency TEXT DEFAULT 'EGP',
    color TEXT DEFAULT 'blue',
    is_master INTEGER DEFAULT 0,
    initial_capital REAL DEFAULT 100000,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_user_master ON portfolios(user_id, is_master);
"""

_multi_portfolio_schema_ready = False


def _ensure_multi_portfolio_schema():
    """إنشاء جدول portfolios + إضافة عمود portfolio_id للجداول القديمة (migration آمن)."""
    global _multi_portfolio_schema_ready
    if _multi_portfolio_schema_ready:
        return
    _ensure_portfolio_schema()
    _ensure_equity_schema()
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_mps_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_mps_ctx = _dbm.connection(_get_portfolio_db_path(), writable=True)
                conn = _pr_mps_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_portfolio_db_path())
            _pr_mps_ctx = None
        conn.executescript(_MULTI_PORTFOLIO_SCHEMA_SQL)
        conn.commit()

        alter_statements = [
            "ALTER TABLE portfolios ADD COLUMN color TEXT DEFAULT 'blue'",
            "ALTER TABLE portfolio_state ADD COLUMN portfolio_id INTEGER",
            "ALTER TABLE portfolio_positions ADD COLUMN portfolio_id INTEGER",
            "ALTER TABLE equity_snapshots ADD COLUMN portfolio_id INTEGER",
            "ALTER TABLE cash_transactions ADD COLUMN portfolio_id INTEGER",
            "ALTER TABLE portfolio_pnl_history ADD COLUMN portfolio_id INTEGER",
        ]
        for stmt in alter_statements:
            try:
                conn.execute(stmt)
                conn.commit()
                logger.info("✓ Migration: %s", stmt[:60])
            except sqlite3.OperationalError:
                pass

        index_statements = [
            "CREATE INDEX IF NOT EXISTS idx_ps_pid ON portfolio_state(portfolio_id)",
            "CREATE INDEX IF NOT EXISTS idx_pp_pid2 ON portfolio_positions(portfolio_id)",
            "CREATE INDEX IF NOT EXISTS idx_es_pid ON equity_snapshots(portfolio_id)",
            "CREATE INDEX IF NOT EXISTS idx_ct_pid ON cash_transactions(portfolio_id)",
        ]
        for stmt in index_statements:
            try:
                conn.execute(stmt)
                conn.commit()
            except sqlite3.OperationalError:
                pass

        conn.close()
        _multi_portfolio_schema_ready = True
    except sqlite3.Error as e:
        logger.error("فشل إنشاء multi-portfolio schema: %s", e)


def _ensure_default_master_portfolio(user_id: str) -> int:
    """ينشئ محفظة أم افتراضية للمستخدم لو مفيش واحدة (idempotent)."""
    _ensure_multi_portfolio_schema()
    try:
        conn = _get_portfolio_conn()
        row = conn.execute(
            "SELECT id FROM portfolios WHERE user_id=? AND is_master=1 LIMIT 1",
            (user_id,),
        ).fetchone()
        if row:
            conn.close()
            return row["id"]
        conn.execute(
            """INSERT INTO portfolios (user_id, name, broker, market, currency, color, is_master, initial_capital)
               VALUES (?, ?, 'master', 'EGX', 'EGP', 'emerald', 1, 100000)""",
            (user_id, "المحفظة الأم"),
        )
        conn.commit()
        new_id = conn.execute(
            "SELECT id FROM portfolios WHERE user_id=? AND is_master=1 LIMIT 1",
            (user_id,),
        ).fetchone()["id"]
        conn.close()
        return new_id
    except sqlite3.Error as e:
        logger.error("فشل إنشاء default master portfolio: %s", e)
        return -1


@require_admin
@portfolio_bp.route('/accounts/create', methods=['POST'])
def create_sub_portfolio():
    """POST /api/portfolio/accounts/create
    أنشئ محفظة فرعية (Sub-Portfolio) للمستخدم.
    """
    try:
        _ensure_multi_portfolio_schema()
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        name = (data.get('name') or '').strip()
        broker = (data.get('broker') or 'manual').strip()
        market = (data.get('market') or 'EGX').strip()
        currency = (data.get('currency') or 'EGP').strip()
        color = (data.get('color') or 'blue').strip()
        initial_capital = float(data.get('initial_capital', 0))

        if not name:
            return jsonify({"success": False, "error": "name مطلوب"}), 400

        master_id = _ensure_default_master_portfolio(user_id)

        conn = _get_portfolio_conn()
        cur = conn.execute(
            """INSERT INTO portfolios (user_id, name, broker, market, currency, color, is_master, initial_capital)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
            (user_id, name, broker, market, currency, color, initial_capital),
        )
        conn.commit()
        new_id = cur.lastrowid
        conn.close()

        return jsonify({
            "success": True,
            "portfolio": {
                "id": new_id,
                "user_id": user_id,
                "name": name,
                "broker": broker,
                "market": market,
                "currency": currency,
                "color": color,
                "is_master": False,
                "initial_capital": initial_capital,
            },
            "master_portfolio_id": master_id,
            "message": f"تم إنشاء محفظة '{name}' بنجاح",
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/accounts/update', methods=['POST'])
def update_sub_portfolio():
    """POST /api/portfolio/accounts/update
    تعديل بيانات محفظة فرعية.
    """
    try:
        _ensure_multi_portfolio_schema()
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        portfolio_id = data.get('portfolio_id')
        name = (data.get('name') or '').strip()
        broker = (data.get('broker') or 'manual').strip()
        market = (data.get('market') or 'EGX').strip()
        currency = (data.get('currency') or 'EGP').strip()
        color = (data.get('color') or 'blue').strip()
        initial_capital = float(data.get('initial_capital', 0))

        if not portfolio_id:
            return jsonify({"success": False, "error": "portfolio_id مطلوب"}), 400
        if not name:
            return jsonify({"success": False, "error": "name مطلوب"}), 400

        conn = _get_portfolio_conn()
        conn.execute(
            """UPDATE portfolios 
               SET name=?, broker=?, market=?, currency=?, color=?, initial_capital=?, updated_at=datetime('now')
               WHERE id=? AND user_id=?""",
            (name, broker, market, currency, color, initial_capital, portfolio_id, user_id),
        )
        conn.commit()
        conn.close()

        return jsonify({
            "success": True,
            "message": f"تم تحديث بيانات المحفظة '{name}' بنجاح",
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/accounts', methods=['GET'])
def list_portfolios():
    """GET /api/portfolio/accounts?user_id=U
    يرجّع كل محافظ المستخدم (الأم + الفرعية).
    """
    try:
        _ensure_multi_portfolio_schema()
        user_id = request.args.get('user_id', 'default')
        master_id = _ensure_default_master_portfolio(user_id)

        conn = _get_portfolio_conn()
        rows = conn.execute(
            """SELECT * FROM portfolios WHERE user_id=? ORDER BY is_master DESC, id ASC""",
            (user_id,),
        ).fetchall()
        conn.close()

        portfolios = [dict(r) for r in rows]
        # حوّل is_master من int إلى bool
        for p in portfolios:
            p["is_master"] = bool(p["is_master"])

        return jsonify({
            "success": True,
            "user_id": user_id,
            "master_portfolio_id": master_id,
            "count": len(portfolios),
            "portfolios": portfolios,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/accounts/delete', methods=['POST'])
def delete_sub_portfolio():
    """POST /api/portfolio/accounts/delete
    احذف محفظة فرعية (لا يمكن حذف الأم).

    Body: { user_id, portfolio_id }
    """
    try:
        _ensure_multi_portfolio_schema()
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        portfolio_id = int(data.get('portfolio_id', 0))

        conn = _get_portfolio_conn()
        # تحقق إنها ليست الماستر
        row = conn.execute(
            "SELECT is_master FROM portfolios WHERE id=? AND user_id=? LIMIT 1",
            (portfolio_id, user_id),
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "المحفظة غير موجودة"}), 404
        if row["is_master"]:
            conn.close()
            return jsonify({"success": False, "error": "لا يمكن حذف المحفظة الأم"}), 400

        conn.execute("DELETE FROM portfolios WHERE id=?", (portfolio_id,))
        # امسح الصفقات المرتبطة (soft delete — نترك الـ equity_snapshots للسجل)
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "تم حذف المحفظة الفرعية"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@portfolio_bp.route('/master', methods=['GET'])
def get_master_portfolio():
    """GET /api/portfolio/master?user_id=U
    يجلب كل المحافظ الفرعية ويجمع (Aggregate):
      - total_value (cash + invested)
      - cash
      - invested_amount
      - net_pnl
    + positions لكل محفظة فرعية.
    + equity_curve موحّد (يجمع النقاط اليومية لكل المحافظ).
    """
    try:
        _ensure_multi_portfolio_schema()
        _ensure_equity_schema()
        user_id = request.args.get('user_id', 'default')
        days = request.args.get('days', 90, type=int)
        master_id = _ensure_default_master_portfolio(user_id)

        conn = _get_portfolio_conn()

        # 1. اجلب كل المحافظ الفرعية
        sub_rows = conn.execute(
            """SELECT * FROM portfolios WHERE user_id=? AND is_master=0 ORDER BY id ASC""",
            (user_id,),
        ).fetchall()
        sub_portfolios = [dict(r) for r in sub_rows]

        # 2. لكل محفظة فرعية: اجلب آخر equity_snapshot + positions
        aggregated = {
            "total_value": 0.0,
            "cash": 0.0,
            "invested_amount": 0.0,
            "net_pnl": 0.0,
            "net_pnl_pct": 0.0,
        }
        portfolio_details = []
        for sp in sub_portfolios:
            sp_id = sp["id"]
            
            # 1. اجلب آخر snapshot لهذه المحفظة
            snap = conn.execute(
                """SELECT * FROM equity_snapshots
                   WHERE user_id=? AND (portfolio_id=? OR portfolio_id = CAST(? AS TEXT))
                   ORDER BY snapshot_date DESC LIMIT 1""",
                (user_id, sp_id, sp_id),
            ).fetchone()
            
            sp_cash = float(snap["cash_balance"]) if snap else float(sp.get("initial_capital", 0))

            # 2. اجلب الأصول المسجلة لهذه المحفظة الفرعية من portfolio_assets و portfolio_positions
            assets_rows = conn.execute(
                """SELECT total_invested, current_value, stock_ticker, type
                   FROM portfolio_assets
                   WHERE user_id=? AND (portfolio_id=? OR portfolio_id = CAST(? AS TEXT))""",
                (user_id, sp_id, sp_id),
            ).fetchall()

            positions_rows = conn.execute(
                """SELECT p.shares, p.buy_price, s.current_price as live_price
                   FROM portfolio_positions p
                   LEFT JOIN stocks s ON s.ticker = p.ticker OR s.ticker = UPPER(p.ticker)
                   WHERE (p.user_id=? OR p.user_id='default') AND (p.portfolio_id=? OR p.portfolio_id = CAST(? AS TEXT))""",
                (user_id, sp_id, sp_id),
            ).fetchall()

            sp_invested = sum(float(a["total_invested"] or 0) for a in assets_rows)
            sp_assets_val = sum(float(a["current_value"] or a["total_invested"] or 0) for a in assets_rows)

            for pos in positions_rows:
                sh = float(pos["shares"] or 0)
                bp = float(pos["buy_price"] or 0)
                lp = float(pos["live_price"] or bp)
                sp_invested += sh * bp
                sp_assets_val += sh * lp

            sp_value = sp_assets_val + sp_cash
            sp_pnl = sp_assets_val - sp_invested
            positions_count = len(assets_rows) + len(positions_rows)

            aggregated["total_value"] += sp_value
            aggregated["cash"] += sp_cash
            aggregated["invested_amount"] += sp_invested
            aggregated["net_pnl"] += sp_pnl

            pnl_pct = round((sp_pnl / sp_invested * 100) if sp_invested > 0 else 0.0, 2)

            portfolio_details.append({
                "id": sp_id,
                "name": sp["name"],
                "broker": sp["broker"],
                "market": sp["market"],
                "currency": sp["currency"],
                "color": sp.get("color", "blue"),
                "initial_capital": float(sp.get("initial_capital", 0)),
                "current_value": round(sp_value, 2),
                "cash": round(sp_cash, 2),
                "invested": round(sp_invested, 2),
                "pnl": round(sp_pnl, 2),
                "pnl_pct": pnl_pct,
                "positions_count": positions_count,
            })

        # net_pnl_pct إجمالي
        if aggregated["invested_amount"] > 0:
            aggregated["net_pnl_pct"] = round(
                aggregated["net_pnl"] / aggregated["invested_amount"] * 100, 2
            )
        aggregated["total_value"] = round(aggregated["total_value"], 2)
        aggregated["cash"] = round(aggregated["cash"], 2)
        aggregated["invested_amount"] = round(aggregated["invested_amount"], 2)
        aggregated["net_pnl"] = round(aggregated["net_pnl"], 2)

        # 3. Equity Curve موحّد — اجمع النقاط اليومية لكل المحافظ
        cutoff = (datetime.now() - __import__('datetime').timedelta(days=days)).strftime('%Y-%m-%d')
        all_snaps = conn.execute(
            """SELECT snapshot_date, portfolio_id,
                      SUM(total_value) as total_value,
                      SUM(total_invested) as total_invested,
                      SUM(cash_balance) as cash_balance,
                      SUM(pnl) as pnl
               FROM equity_snapshots
               WHERE user_id=? AND snapshot_date >= ?
               GROUP BY snapshot_date
               ORDER BY snapshot_date ASC""",
            (user_id, cutoff),
        ).fetchall()
        master_curve = []
        for s in all_snaps:
            invested = float(s["total_invested"] or 0)
            master_curve.append({
                "date": s["snapshot_date"],
                "total_value": round(float(s["total_value"] or 0), 2),
                "invested": round(invested, 2),
                "cash": round(float(s["cash_balance"] or 0), 2),
                "pnl": round(float(s["pnl"] or 0), 2),
                "pnl_pct": round(
                    (float(s["pnl"] or 0) / invested * 100) if invested > 0 else 0, 2
                ),
            })

        conn.close()

        return jsonify({
            "success": True,
            "user_id": user_id,
            "master_portfolio_id": master_id,
            "aggregated": aggregated,
            "sub_portfolios": portfolio_details,
            "sub_portfolios_count": len(portfolio_details),
            "equity_curve": master_curve,
            "equity_curve_days": days,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/accounts/<int:portfolio_id>/state', methods=['GET'])
def get_sub_portfolio_state(portfolio_id: int):
    """GET /api/portfolio/accounts/<id>/state?user_id=U
    يرجّع حالة محفظة فرعية محددة (positions + آخر snapshot).
    """
    try:
        _ensure_multi_portfolio_schema()
        _ensure_equity_schema()
        user_id = request.args.get('user_id', 'default')

        conn = _get_portfolio_conn()
        pf = conn.execute(
            "SELECT * FROM portfolios WHERE id=? AND user_id=? LIMIT 1",
            (portfolio_id, user_id),
        ).fetchone()
        if not pf:
            conn.close()
            return jsonify({"success": False, "error": "المحفظة غير موجودة"}), 404
        pf_dict = dict(pf)
        pf_dict["is_master"] = bool(pf_dict["is_master"])

        # positions
        positions = conn.execute(
            "SELECT * FROM portfolio_positions WHERE portfolio_id=?",
            (portfolio_id,),
        ).fetchall()
        positions_list = [dict(p) for p in positions]

        # آخر snapshot
        snap = conn.execute(
            """SELECT * FROM equity_snapshots
               WHERE user_id=? AND (portfolio_id=? OR portfolio_id IS NULL)
               ORDER BY snapshot_date DESC LIMIT 1""",
            (user_id, portfolio_id),
        ).fetchone()
        snap_dict = dict(snap) if snap else None

        conn.close()
        return jsonify({
            "success": True,
            "portfolio": pf_dict,
            "positions": positions_list,
            "latest_snapshot": snap_dict,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/accounts/<int:portfolio_id>/equity-curve', methods=['GET'])
def get_sub_portfolio_equity_curve(portfolio_id: int):
    """GET /api/portfolio/accounts/<id>/equity-curve?user_id=U&days=90
    منحنى رأس المال لمحفظة فرعية محددة.
    """
    try:
        _ensure_equity_schema()
        user_id = request.args.get('user_id', 'default')
        days = request.args.get('days', 90, type=int)
        cutoff = (datetime.now() - __import__('datetime').timedelta(days=days)).strftime('%Y-%m-%d')

        conn = _get_portfolio_conn()
        rows = conn.execute(
            """SELECT * FROM equity_snapshots
               WHERE user_id=? AND (portfolio_id=? OR portfolio_id IS NULL)
                     AND snapshot_date >= ?
               ORDER BY snapshot_date ASC""",
            (user_id, portfolio_id, cutoff),
        ).fetchall()
        conn.close()

        snapshots = [dict(r) for r in rows]
        meta = {}
        if snapshots:
            first = snapshots[0]
            last = snapshots[-1]
            total_pnl = last["total_value"] - first["total_value"]
            meta = {
                "start_value": first["total_value"],
                "end_value": last["total_value"],
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round((total_pnl / first["total_value"] * 100) if first["total_value"] > 0 else 0, 2),
                "peak_value": max(s["total_value"] for s in snapshots),
                "trough_value": min(s["total_value"] for s in snapshots),
                "days_tracked": len(snapshots),
            }

        return jsonify({
            "success": True,
            "portfolio_id": portfolio_id,
            "snapshots": snapshots,
            "meta": meta,
            "count": len(snapshots),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


__all__ = ['portfolio_bp']


# ============================================================
# SCREENER-046: Custom Watchlists CRUD
# ============================================================

_WATCHLIST_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS user_watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    tickers TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uw_user ON user_watchlists(user_id);
"""

_watchlist_schema_ready = False


def _ensure_watchlist_schema():
    global _watchlist_schema_ready
    if _watchlist_schema_ready:
        return
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _pr_wls_ctx = None
        try:
            if _PORT_ROUTES_DBM_AVAILABLE:
                _pr_wls_ctx = _dbm.connection(_get_portfolio_db_path(), writable=True)
                conn = _pr_wls_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(_get_portfolio_db_path())
            _pr_wls_ctx = None
        conn.executescript(_WATCHLIST_SCHEMA_SQL)
        conn.commit()
        conn.close()
        _watchlist_schema_ready = True
    except sqlite3.Error as e:
        logger.error("Watchlist schema error: %s", e)


@require_admin
@portfolio_bp.route('/watchlists', methods=['GET'])
def list_watchlists():
    """GET /api/portfolio/watchlists?user_id=U"""
    try:
        _ensure_watchlist_schema()
        import json as _json
        user_id = request.args.get('user_id', 'default')
        conn = _get_portfolio_conn()
        rows = conn.execute(
            "SELECT * FROM user_watchlists WHERE user_id=? ORDER BY id ASC",
            (user_id,),
        ).fetchall()
        conn.close()
        watchlists = []
        for r in rows:
            d = dict(r)
            try:
                d['tickers'] = _json.loads(d.get('tickers', '[]'))
            except Exception:
                d['tickers'] = []
            watchlists.append(d)
        return jsonify({
            "success": True, "user_id": user_id,
            "count": len(watchlists), "watchlists": watchlists,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/watchlists/create', methods=['POST'])
def create_watchlist():
    """POST /api/portfolio/watchlists/create — Body: {user_id, name, tickers?}"""
    try:
        _ensure_watchlist_schema()
        import json as _json
        data = request.get_json() or {}
        user_id = data.get('user_id', 'default')
        name = (data.get('name') or '').strip()
        tickers = data.get('tickers', [])
        if not name:
            return jsonify({"success": False, "error": "name مطلوب"}), 400
        tickers_json = _json.dumps(tickers if isinstance(tickers, list) else [])
        conn = _get_portfolio_conn()
        cur = conn.execute(
            "INSERT INTO user_watchlists (user_id, name, tickers) VALUES (?, ?, ?)",
            (user_id, name, tickers_json),
        )
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({
            "success": True,
            "watchlist": {"id": new_id, "user_id": user_id, "name": name, "tickers": tickers},
            "message": f"تم إنشاء قائمة '{name}' بنجاح",
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/watchlists/<int:wl_id>/add', methods=['POST'])
def add_to_watchlist(wl_id: int):
    """POST /api/portfolio/watchlists/<id>/add — Body: {ticker}"""
    try:
        _ensure_watchlist_schema()
        import json as _json
        data = request.get_json() or {}
        ticker = (data.get('ticker') or '').upper().strip()
        if not ticker:
            return jsonify({"success": False, "error": "ticker مطلوب"}), 400
        conn = _get_portfolio_conn()
        row = conn.execute("SELECT tickers FROM user_watchlists WHERE id=?", (wl_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "قائمة غير موجودة"}), 404
        try:
            tickers = _json.loads(row['tickers'] or '[]')
        except Exception:
            tickers = []
        if ticker not in tickers:
            tickers.append(ticker)
        conn.execute(
            "UPDATE user_watchlists SET tickers=?, updated_at=datetime('now') WHERE id=?",
            (_json.dumps(tickers), wl_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "watchlist_id": wl_id, "tickers": tickers,
                        "message": f"تمت إضافة {ticker}"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/watchlists/<int:wl_id>/remove', methods=['POST'])
def remove_from_watchlist(wl_id: int):
    """POST /api/portfolio/watchlists/<id>/remove — Body: {ticker}"""
    try:
        _ensure_watchlist_schema()
        import json as _json
        data = request.get_json() or {}
        ticker = (data.get('ticker') or '').upper().strip()
        conn = _get_portfolio_conn()
        row = conn.execute("SELECT tickers FROM user_watchlists WHERE id=?", (wl_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "قائمة غير موجودة"}), 404
        try:
            tickers = _json.loads(row['tickers'] or '[]')
        except Exception:
            tickers = []
        tickers = [t for t in tickers if t != ticker]
        conn.execute(
            "UPDATE user_watchlists SET tickers=?, updated_at=datetime('now') WHERE id=?",
            (_json.dumps(tickers), wl_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "watchlist_id": wl_id, "tickers": tickers,
                        "message": f"تمت إزالة {ticker}"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@portfolio_bp.route('/watchlists/<int:wl_id>', methods=['DELETE'])
def delete_watchlist(wl_id: int):
    """DELETE /api/portfolio/watchlists/<id>?user_id=U"""
    try:
        _ensure_watchlist_schema()
        user_id = request.args.get('user_id', 'default')
        conn = _get_portfolio_conn()
        conn.execute("DELETE FROM user_watchlists WHERE id=? AND user_id=?", (wl_id, user_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "تم حذف قائمة المتابعة"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# P4-BACKEND-INFLATION: Real Return + Bag-Holder Rescue
# ============================================================================
# محرك العائد الحقيقي (بعد خصم التضخم) + محرك إنقاذ الأسهم المزنوقة.
# كلا المحركين بيكتبوا/يقرأوا من db/stocks.db مباشرةً (Python stdlib only).
# ----------------------------------------------------------------------------


@portfolio_bp.route('/real-return', methods=['GET'])
def real_return():
    """GET /api/portfolio/real-return?user_id=<id>

    محرك العائد الحقيقي:
      - يقرأ التضخم من `macro_indicators` (fallback 30%)
      - يحسب العائد الحقيقي لكل أصل = nominal_yield - inflation_rate
      - يولّد تحذيرات "فلوسك بتذوب" بالعربي لكل أصل خاسر
      - يرجّع ملخص مرجح لكل المحفظة
    """
    try:
        # Late import so a missing analyzer never breaks the whole blueprint.
        try:
            from analyzers.real_return_engine import RealReturnEngine
        except ImportError:
            # Fallback: vps-service/ is on sys.path via the blueprint loader.
            import importlib
            mod = importlib.import_module('analyzers.real_return_engine')
            RealReturnEngine = mod.RealReturnEngine

        user_id = (request.args.get('user_id') or 'default').strip() or 'default'
        result = RealReturnEngine().evaluate_portfolio(user_id)
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        logger.exception("real_return error")
        return jsonify({'success': False, 'error': str(e)}), 500


@portfolio_bp.route('/bag-holder-rescue', methods=['GET'])
def bag_holder_rescue():
    """GET /api/portfolio/bag-holder-rescue?ticker=<T>&purchase_price=<P>&shares=<S>

    محرك إنقاذ الأسهم المزنوقة:
      - يقارن سعر الشراء بالقمة/القاع التاريخي
      - يفحص ربحانية الشركة (fundamentals)
      - يرجّع توصية: HOLD / AVERAGE_DOWN / CUT_LOSS + تقرير بالعربي

    معاملات الاستعلام مدعومة بأسماء متعددة (backward-compatible):
      - purchase_price  OR  buy_price
      - shares          OR  quantity

    الاستجابة: يحتوي على `data` (المخطط الجديد) + أسماء حقول قديمة على
    المستوى الأعلى (buy_zone_ar, all_time_high, reasoning) عشان الواجهة
    القديمة (`BagHolderRescuePanel.tsx`) تكمل شغل بدون تغيير.
    """
    try:
        try:
            from analyzers.bag_holder_rescue import BagHolderRescue
        except ImportError:
            import importlib
            mod = importlib.import_module('analyzers.bag_holder_rescue')
            BagHolderRescue = mod.BagHolderRescue

        ticker = (request.args.get('ticker') or '').upper().strip()
        # Accept both `purchase_price` (new) and `buy_price` (legacy) for
        # backward compatibility with the existing frontend panel.
        purchase_price_str = (
            request.args.get('purchase_price')
            or request.args.get('buy_price')
            or '0'
        )
        # Accept both `shares` (new) and `quantity` (legacy).
        shares_str = (
            request.args.get('shares')
            or request.args.get('quantity')
            or '0'
        )

        try:
            purchase_price = float(purchase_price_str)
        except (TypeError, ValueError):
            purchase_price = 0.0
        try:
            shares = float(shares_str)
        except (TypeError, ValueError):
            shares = 0.0

        if not ticker:
            return jsonify({'success': False, 'error': 'ticker مطلوب'}), 400
        if purchase_price <= 0:
            return jsonify({
                'success': False,
                'error': 'purchase_price (أو buy_price) مطلوب ويجب أن يكون > 0',
            }), 400

        result = BagHolderRescue().analyze(ticker, purchase_price, shares)

        # ── Legacy field aliases (top-level) ──────────────────────────────
        # The previous `misc_bp` route exposed fields under different names
        # (`buy_price`, `all_time_high`, `buy_zone_ar`, `reasoning`). The
        # existing frontend (`BagHolderRescuePanel.tsx`) reads those names
        # directly off the top-level JSON. Merge them here so the old UI
        # keeps working unchanged.
        legacy_buy_zone_ar = {
            'AT_PEAK':     '🚨 عند القمة التاريخية',
            'NEAR_PEAK':   '⚠️ في النص العلوي',
            'MID_RANGE':   '✅ في النص (سعر معقول)',
            'NEAR_BOTTOM': '🟢 قرب القاع التاريخي',
            'AT_BOTTOM':   '🟢 قرب القاع التاريخي',
        }.get(result.get('purchase_vs_peak'), '✅ في النص (سعر معقول)')

        response_payload = {
            'success': True,
            'data': result,
            # New canonical fields (also top-level for convenience):
            'ticker':              result['ticker'],
            'purchase_price':      result['purchase_price'],
            'current_price':       result['current_price'],
            'shares':              result['shares'],
            'loss_pct':            result['loss_pct'],
            'loss_egp':            result['loss_egp'],
            'recommendation':      result['recommendation'],
            'recommendation_ar':   result['recommendation_ar'],
            'urgency':             result['urgency'],
            'reasoning_ar':        result['reasoning_ar'],
            'purchase_vs_peak':    result['purchase_vs_peak'],
            'historical_high':     result['historical_high'],
            'historical_low':      result['historical_low'],
            'recovery_needed_pct': result['recovery_needed_pct'],
            'company_profitable':  result['company_profitable'],
            # Legacy aliases (old field names):
            'buy_price':           result['purchase_price'],
            'quantity':            result['shares'],
            'all_time_high':       result['historical_high'],
            'all_time_low':        result['historical_low'],
            'buy_zone':            result['purchase_vs_peak'].lower(),
            'buy_zone_ar':         legacy_buy_zone_ar,
            'reasoning':           result['reasoning_ar'],
            'is_profitable':       result['company_profitable'],
        }
        return jsonify(response_payload)
    except Exception as e:
        logger.exception("bag_holder_rescue error")
        return jsonify({'success': False, 'error': str(e)}), 500

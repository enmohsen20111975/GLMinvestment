# DEPRECATED: This route is not registered in lightweight_server.py
"""
Walk-Forward Backtest for Maestro System
الـ Backtest المتحرك لنظام المايسترو

Tests the Maestro Orchestrator on historical data with multiple windows.
يختبر الـ Maestro Orchestrator على البيانات التاريخية مع عدة نوافذ.

Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY

@version 1.0.0
"""

from flask import Blueprint, jsonify, request
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
import sqlite3
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.maestro_orchestrator import (
    MaestroOrchestrator,
    run_maestro_analysis,
    PERSONA_CONFIGS
)

# Create Blueprint
wf_bp = Blueprint('walk_forward', __name__, url_prefix='/api/walk-forward')

# Database path
try:
    from config import DATABASE_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))


# ==================== DATA CLASSES ====================

@dataclass
class Trade:
    """صفقة واحدة"""
    window: int
    ticker: str
    signal_date: str
    entry_price: float
    stop_loss: float
    target: float
    maestro_score: float
    recommendation: str
    persona: str
    regime: str
    
    # Results
    exit_date: str = ''
    exit_price: float = 0.0
    result: str = 'pending'  # 'win', 'loss', 'timeout'
    pnl_pct: float = 0.0
    holding_days: int = 0


@dataclass
class WindowResult:
    """نتائج نافذة واحدة"""
    window: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    total_signals: int
    trades: List[Trade] = field(default_factory=list)
    
    # Statistics
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    total_profit: float = 0.0
    total_loss: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    
    # By persona
    by_persona: Dict = field(default_factory=dict)
    
    # By regime
    by_regime: Dict = field(default_factory=dict)


@dataclass
class BacktestResult:
    """نتائج الـ Backtest الكاملة"""
    success: bool
    timestamp: str
    data_range: Dict
    windows: List[WindowResult]
    
    # Aggregate statistics
    aggregate: Dict
    
    # Decision
    decision: Dict


# ==================== HELPER FUNCTIONS ====================

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_stock_history_range(conn, ticker: str, start_date: str, end_date: str) -> List[Dict]:
    """الحصول على تاريخ السهم في فترة معينة"""
    cursor = conn.cursor()
    
    # Get stock_id
    cursor.execute('SELECT id FROM stocks WHERE ticker = ?', (ticker,))
    row = cursor.fetchone()
    if not row:
        return []
    
    stock_id = row['id']
    
    cursor.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM stock_price_history
        WHERE stock_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
    ''', (stock_id, start_date, end_date))
    
    return [dict(row) for row in cursor.fetchall()]


def get_all_tickers(conn) -> List[str]:
    """الحصول على كل الأسهم اللي ليها بيانات"""
    cursor = conn.cursor()
    cursor.execute('''
        SELECT DISTINCT s.ticker
        FROM stocks s
        INNER JOIN stock_price_history h ON s.id = h.stock_id
        WHERE s.is_active = 1 OR s.is_active IS NULL
    ''')
    return [row['ticker'] for row in cursor.fetchall()]


def get_stock_info(conn, ticker: str) -> Optional[Dict]:
    """الحصول على معلومات السهم"""
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM stocks WHERE ticker = ?', (ticker,))
    row = cursor.fetchone()
    return dict(row) if row else None


def simulate_trade(
    entry_price: float,
    stop_loss: float,
    target: float,
    future_data: List[Dict],
    is_buy: bool = True,
    max_days: int = 10
) -> Tuple[float, str, int]:
    """
    محاكاة الصفقة
    
    Returns:
        (exit_price, result, holding_days)
    """
    if not future_data:
        return entry_price, 'timeout', 0
    
    for i, day in enumerate(future_data[:max_days]):
        high = day.get('high_price', day.get('close_price', 0))
        low = day.get('low_price', day.get('close_price', 0))
        close = day.get('close_price', 0)
        
        if is_buy:
            # Check if target hit
            if target > 0 and high >= target:
                return target, 'win', i + 1
            # Check if stop loss hit
            if stop_loss > 0 and low <= stop_loss:
                return stop_loss, 'loss', i + 1
        else:  # SELL
            if target > 0 and low <= target:
                return target, 'win', i + 1
            if stop_loss > 0 and high >= stop_loss:
                return stop_loss, 'loss', i + 1
    
    # Timeout - exit at last close
    last_close = future_data[-1].get('close_price', entry_price) if future_data else entry_price
    return last_close, 'timeout', min(max_days, len(future_data))


# ==================== MAIN BACKTEST ENGINE ====================

class WalkForwardBacktest:
    """محرك الـ Walk-Forward Backtest"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.orchestrator = MaestroOrchestrator(db_path)
    
    def get_data_range(self) -> Dict:
        """الحصول على نطاق البيانات المتاحة"""
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT MIN(date), MAX(date) FROM stock_price_history')
        row = cursor.fetchone()
        
        cursor.execute('SELECT COUNT(DISTINCT stock_id) FROM stock_price_history')
        stocks_count = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM stock_price_history')
        records_count = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            'min_date': row[0],
            'max_date': row[1],
            'stocks_count': stocks_count,
            'records_count': records_count
        }
    
    def run_single_window(
        self,
        window_num: int,
        train_start: str,
        train_end: str,
        test_start: str,
        test_end: str,
        persona: str = 'balanced',
        min_score: int = 55
    ) -> WindowResult:
        """تشغيل نافذة واحدة"""
        
        conn = get_db()
        tickers = get_all_tickers(conn)
        
        window_result = WindowResult(
            window=window_num,
            train_start=train_start,
            train_end=train_end,
            test_start=test_start,
            test_end=test_end,
            total_signals=0
        )
        
        print(f"[Window {window_num}] Testing {len(tickers)} stocks")
        print(f"  Train: {train_start} to {train_end}")
        print(f"  Test: {test_start} to {test_end}")
        
        for ticker in tickers:
            try:
                # Get stock info
                stock_info = get_stock_info(conn, ticker)
                if not stock_info:
                    continue
                
                # Get training data (for analysis)
                train_data = get_stock_history_range(conn, ticker, train_start, train_end)
                if len(train_data) < 30:
                    continue
                
                # Run Maestro analysis
                result = run_maestro_analysis(
                    ticker,
                    stock_info,
                    train_data,
                    self.db_path,
                    {'persona_type': persona}
                )
                
                maestro_score = result.get('maestro_score', 0)
                recommendation = result.get('recommendation', 'hold')
                
                # Filter by score and recommendation
                if maestro_score < min_score:
                    continue
                if recommendation not in ['buy', 'strong_buy']:
                    continue
                
                window_result.total_signals += 1
                
                # Get test data (for simulation)
                test_data = get_stock_history_range(conn, ticker, test_start, test_end)
                
                if not test_data:
                    continue
                
                # Entry price (first day of test)
                entry_price = test_data[0].get('open_price', test_data[0].get('close_price', 0))
                if entry_price <= 0:
                    entry_price = train_data[-1].get('close_price', 0)
                
                # Get stop and target from result
                stop_loss = result.get('stop_loss', entry_price * 0.92)
                target = result.get('target', entry_price * 1.15)
                
                # Simulate trade
                future_data = test_data[1:]  # Skip first day (entry)
                exit_price, trade_result, holding_days = simulate_trade(
                    entry_price, stop_loss, target, future_data, is_buy=True
                )
                
                # Calculate P&L
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                
                # Create trade record
                trade = Trade(
                    window=window_num,
                    ticker=ticker,
                    signal_date=train_end,
                    entry_price=round(entry_price, 3),
                    stop_loss=round(stop_loss, 3),
                    target=round(target, 3),
                    maestro_score=maestro_score,
                    recommendation=recommendation,
                    persona=persona,
                    regime=result.get('phases', {}).get('regime', {}).get('phase', 'range'),
                    exit_date=test_data[-1].get('date', test_end) if test_data else test_end,
                    exit_price=round(exit_price, 3),
                    result=trade_result,
                    pnl_pct=round(pnl_pct, 2),
                    holding_days=holding_days
                )
                
                window_result.trades.append(trade)
                
            except Exception as e:
                print(f"  Error processing {ticker}: {e}")
                continue
        
        conn.close()
        
        # Calculate window statistics
        self._calculate_window_stats(window_result)
        
        print(f"  Signals: {window_result.total_signals}, Trades: {len(window_result.trades)}")
        print(f"  Win Rate: {window_result.win_rate:.1f}%, PF: {window_result.profit_factor:.2f}")
        
        return window_result
    
    def _calculate_window_stats(self, window: WindowResult):
        """حساب إحصائيات النافذة"""
        if not window.trades:
            return
        
        wins = [t for t in window.trades if t.result == 'win']
        losses = [t for t in window.trades if t.result == 'loss']
        
        window.wins = len(wins)
        window.losses = len(losses)
        
        total = len(window.trades)
        window.win_rate = (window.wins / total * 100) if total > 0 else 0
        
        window.total_profit = sum(t.pnl_pct for t in wins)
        window.total_loss = abs(sum(t.pnl_pct for t in losses if t.pnl_pct < 0))
        
        window.profit_factor = window.total_profit / window.total_loss if window.total_loss > 0 else 0
        
        window.avg_win = window.total_profit / window.wins if window.wins > 0 else 0
        window.avg_loss = window.total_loss / window.losses if window.losses > 0 else 0
        
        # By persona
        window.by_persona = {'balanced': {
            'trades': total,
            'wins': window.wins,
            'win_rate': window.win_rate
        }}
        
        # By regime
        regimes = {}
        for t in window.trades:
            if t.regime not in regimes:
                regimes[t.regime] = {'trades': 0, 'wins': 0, 'pnl': 0}
            regimes[t.regime]['trades'] += 1
            if t.result == 'win':
                regimes[t.regime]['wins'] += 1
            regimes[t.regime]['pnl'] += t.pnl_pct
        
        for r in regimes:
            regimes[r]['win_rate'] = (regimes[r]['wins'] / regimes[r]['trades'] * 100) if regimes[r]['trades'] > 0 else 0
        
        window.by_regime = regimes
    
    def run_full_backtest(
        self,
        persona: str = 'balanced',
        min_score: int = 55
    ) -> BacktestResult:
        """تشغيل الـ Backtest الكامل"""
        
        data_range = self.get_data_range()
        
        print(f"\n{'='*60}")
        print(f"WALK-FORWARD BACKTEST - MAESTRO SYSTEM")
        print(f"{'='*60}")
        print(f"Data Range: {data_range['min_date']} to {data_range['max_date']}")
        print(f"Stocks: {data_range['stocks_count']}, Records: {data_range['records_count']}")
        print(f"Persona: {persona}, Min Score: {min_score}")
        print(f"{'='*60}\n")
        
        # Define windows based on available data
        # Window 1: Train Dec 2024 - Feb 2025, Test Mar 2025
        # Window 2: Train Jan 2025 - Mar 2025, Test Apr 2025
        
        windows_config = [
            {
                'num': 1,
                'train_start': '2024-12-01',
                'train_end': '2025-02-28',
                'test_start': '2025-03-01',
                'test_end': '2025-03-31'
            },
            {
                'num': 2,
                'train_start': '2025-01-01',
                'train_end': '2025-03-31',
                'test_start': '2025-04-01',
                'test_end': '2025-04-30'
            }
        ]
        
        windows_results = []
        
        for config in windows_config:
            window_result = self.run_single_window(
                window_num=config['num'],
                train_start=config['train_start'],
                train_end=config['train_end'],
                test_start=config['test_start'],
                test_end=config['test_end'],
                persona=persona,
                min_score=min_score
            )
            windows_results.append(window_result)
        
        # Calculate aggregate statistics
        aggregate = self._calculate_aggregate(windows_results)
        
        # Decision
        decision = self._make_decision(aggregate)
        
        return BacktestResult(
            success=True,
            timestamp=datetime.now().isoformat(),
            data_range=data_range,
            windows=windows_results,
            aggregate=aggregate,
            decision=decision
        )
    
    def _calculate_aggregate(self, windows: List[WindowResult]) -> Dict:
        """حساب الإحصائيات المجمعة"""
        all_trades = []
        for w in windows:
            all_trades.extend(w.trades)
        
        if not all_trades:
            return {
                'total_trades': 0,
                'avg_win_rate': 0,
                'avg_profit_factor': 0,
                'consistency': 0
            }
        
        wins = [t for t in all_trades if t.result == 'win']
        losses = [t for t in all_trades if t.result == 'loss']
        
        total_trades = len(all_trades)
        total_wins = len(wins)
        total_losses = len(losses)
        
        win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
        
        total_profit = sum(t.pnl_pct for t in wins)
        total_loss = abs(sum(t.pnl_pct for t in losses if t.pnl_pct < 0))
        profit_factor = total_profit / total_loss if total_loss > 0 else 0
        
        # Consistency (how consistent are win rates across windows)
        win_rates = [w.win_rate for w in windows if w.total_signals > 0]
        if len(win_rates) >= 2:
            avg_diff = sum(abs(win_rates[i] - win_rates[i-1]) for i in range(1, len(win_rates))) / (len(win_rates) - 1)
            consistency = max(0, 100 - avg_diff * 2)
        else:
            consistency = 100
        
        # Max drawdown
        cumulative_pnl = 0
        max_cumulative = 0
        max_drawdown = 0
        
        for trade in all_trades:
            cumulative_pnl += trade.pnl_pct
            if cumulative_pnl > max_cumulative:
                max_cumulative = cumulative_pnl
            drawdown = max_cumulative - cumulative_pnl
            if drawdown > max_drawdown:
                max_drawdown = drawdown
        
        # By regime
        by_regime = {}
        for t in all_trades:
            if t.regime not in by_regime:
                by_regime[t.regime] = {'trades': 0, 'wins': 0, 'pnl': 0}
            by_regime[t.regime]['trades'] += 1
            if t.result == 'win':
                by_regime[t.regime]['wins'] += 1
            by_regime[t.regime]['pnl'] += t.pnl_pct
        
        for r in by_regime:
            by_regime[r]['win_rate'] = (by_regime[r]['wins'] / by_regime[r]['trades'] * 100) if by_regime[r]['trades'] > 0 else 0
        
        return {
            'total_trades': total_trades,
            'wins': total_wins,
            'losses': total_losses,
            'win_rate': round(win_rate, 2),
            'profit_factor': round(profit_factor, 2),
            'total_profit': round(total_profit, 2),
            'total_loss': round(total_loss, 2),
            'avg_win': round(total_profit / total_wins, 2) if total_wins > 0 else 0,
            'avg_loss': round(total_loss / total_losses, 2) if total_losses > 0 else 0,
            'max_drawdown': round(max_drawdown, 2),
            'consistency': round(consistency, 1),
            'by_regime': by_regime
        }
    
    def _make_decision(self, aggregate: Dict) -> Dict:
        """اتخاذ قرار بناءً على النتائج"""
        win_rate = aggregate.get('win_rate', 0)
        profit_factor = aggregate.get('profit_factor', 0)
        max_drawdown = aggregate.get('max_drawdown', 0)
        
        if win_rate >= 60 and profit_factor >= 1.5:
            status = 'PUBLISH_NOW'
            message = '✅ ننشر فوراً - النتائج ممتازة!'
            message_en = 'Publish immediately - Excellent results!'
        elif win_rate >= 55 and profit_factor >= 1.2:
            status = 'PUBLISH_CAUTIOUS'
            message = '⚠️ ننشر بحذر - نتائج جيدة'
            message_en = 'Publish with caution - Good results'
        elif win_rate >= 50 and profit_factor >= 1.0:
            status = 'NEEDS_ADJUSTMENT'
            message = '❌ نعدل المعاملات - النتائج مقبولة'
            message_en = 'Adjust parameters - Acceptable results'
        else:
            status = 'OVERHAUL_NEEDED'
            message = '❌❌ نراجع النظام كله - النتائج ضعيفة'
            message_en = 'System overhaul needed - Poor results'
        
        return {
            'status': status,
            'message': message,
            'message_en': message_en,
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'max_drawdown': max_drawdown,
            'thresholds': {
                'win_rate_target': 60,
                'profit_factor_target': 1.5,
                'max_drawdown_limit': 15
            }
        }


# ==================== API ENDPOINTS ====================

@wf_bp.route('/run', methods=['GET', 'POST'])
def run_walk_forward():
    """تشغيل Walk-Forward Backtest"""
    try:
        # Get parameters
        persona = request.args.get('persona', 'balanced')
        min_score = int(request.args.get('min_score', 55))
        
        engine = WalkForwardBacktest(DATABASE_PATH)
        result = engine.run_full_backtest(persona, min_score)
        
        # Convert to dict for JSON
        return jsonify({
            'success': result.success,
            'timestamp': result.timestamp,
            'data_range': result.data_range,
            'windows': [
                {
                    'window': w.window,
                    'train_start': w.train_start,
                    'train_end': w.train_end,
                    'test_start': w.test_start,
                    'test_end': w.test_end,
                    'total_signals': w.total_signals,
                    'trades_count': len(w.trades),
                    'wins': w.wins,
                    'losses': w.losses,
                    'win_rate': w.win_rate,
                    'profit_factor': w.profit_factor,
                    'total_profit': w.total_profit,
                    'total_loss': w.total_loss,
                    'avg_win': w.avg_win,
                    'avg_loss': w.avg_loss,
                    'by_persona': w.by_persona,
                    'by_regime': w.by_regime,
                    'trades': [
                        {
                            'ticker': t.ticker,
                            'signal_date': t.signal_date,
                            'entry_price': t.entry_price,
                            'exit_price': t.exit_price,
                            'maestro_score': t.maestro_score,
                            'recommendation': t.recommendation,
                            'regime': t.regime,
                            'result': t.result,
                            'pnl_pct': t.pnl_pct,
                            'holding_days': t.holding_days
                        } for t in w.trades[:20]  # Limit trades in response
                    ]
                } for w in result.windows
            ],
            'aggregate': result.aggregate,
            'decision': result.decision
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@wf_bp.route('/status', methods=['GET'])
def get_status():
    """حالة نظام الـ Backtest"""
    try:
        engine = WalkForwardBacktest(DATABASE_PATH)
        data_range = engine.get_data_range()
        
        return jsonify({
            'success': True,
            'data_range': data_range,
            'available_windows': [
                {
                    'window': 1,
                    'train': 'Dec 2024 - Feb 2025',
                    'test': 'Mar 2025'
                },
                {
                    'window': 2,
                    'train': 'Jan 2025 - Mar 2025',
                    'test': 'Apr 2025'
                }
            ],
            'personas': list(PERSONA_CONFIGS.keys())
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@wf_bp.route('/test-all-personas', methods=['GET'])
def test_all_personas():
    """اختبار كل الشخصيات"""
    try:
        results = {}
        engine = WalkForwardBacktest(DATABASE_PATH)
        
        for persona in PERSONA_CONFIGS.keys():
            print(f"\nTesting persona: {persona}")
            result = engine.run_full_backtest(persona, PERSONA_CONFIGS[persona].get('min_score', 55))
            
            results[persona] = {
                'win_rate': result.aggregate['win_rate'],
                'profit_factor': result.aggregate['profit_factor'],
                'total_trades': result.aggregate['total_trades'],
                'decision': result.decision['message']
            }
        
        # Find best persona
        best_persona = max(results.items(), key=lambda x: x[1]['win_rate'])
        
        return jsonify({
            'success': True,
            'results_by_persona': results,
            'best_persona': {
                'name': best_persona[0],
                'stats': best_persona[1]
            }
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

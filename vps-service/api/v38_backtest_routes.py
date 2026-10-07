#!/usr/bin/env python3
"""
V38 Backtest API Routes
========================
API endpoints for the V38 Institutional Decision Engine backtest:

  GET  /api/v38-backtest/results       — Get latest backtest results
  POST /api/v38-backtest/run           — Run a new backtest (async)
  GET  /api/v38-backtest/status        — Check if backtest is running
  GET  /api/v38-backtest/trades        — Get trade-level results
  GET  /api/v38-backtest/summary       — Summary KPIs for dashboard

Author: GLMinvestment V38 — Institutional Decision Engine
"""

import os
import sys
import json
import threading
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

from flask import Blueprint, jsonify, request

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

BACKTEST_RESULTS_DIR = str(_PROJECT_ROOT / 'vps-service' / 'backtest_results')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# ---------------------------------------------------------------------------
# Blueprint
# ---------------------------------------------------------------------------
v38_backtest_bp = Blueprint('v38_backtest', __name__)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
_backtest_state = {
    'running': False,
    'progress': '',
    'last_result_file': None,
    'error': None,
    'started_at': None,
    'completed_at': None,
}


def _find_latest_result() -> Optional[str]:
    """Find the most recent V38 backtest result file."""
    if not os.path.exists(BACKTEST_RESULTS_DIR):
        return None
    
    result_files = [
        f for f in os.listdir(BACKTEST_RESULTS_DIR)
        if f.startswith('v38_') and f.endswith('.json') and 'trades' not in f
    ]
    
    if not result_files:
        return None
    
    # Sort by modification time
    result_files.sort(
        key=lambda f: os.path.getmtime(os.path.join(BACKTEST_RESULTS_DIR, f)),
        reverse=True
    )
    
    return os.path.join(BACKTEST_RESULTS_DIR, result_files[0])


def _load_result(filepath: str) -> Dict[str, Any]:
    """Load a backtest result JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        return {'error': str(e)}


# ---------------------------------------------------------------------------
# GET /api/v38-backtest/results
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/results', methods=['GET'])
def get_results():
    """Get the latest V38 backtest results."""
    try:
        # Check for specific file
        file_param = request.args.get('file', '')
        if file_param:
            filepath = os.path.join(BACKTEST_RESULTS_DIR, file_param)
            if os.path.exists(filepath):
                result = _load_result(filepath)
                return jsonify({'success': True, 'source': file_param, 'data': result})
        
        # Find latest
        latest = _find_latest_result()
        if not latest:
            return jsonify({
                'success': False,
                'error': 'No V38 backtest results found. Run a backtest first.',
                'hint': 'POST /api/v38-backtest/run to start a backtest',
            }), 404
        
        result = _load_result(latest)
        return jsonify({
            'success': True,
            'source': os.path.basename(latest),
            'data': result,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GET /api/v38-backtest/summary
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/summary', methods=['GET'])
def get_summary():
    """Get summary KPIs for the dashboard."""
    try:
        latest = _find_latest_result()
        if not latest:
            return jsonify({'success': False, 'error': 'No results found'}), 404
        
        result = _load_result(latest)
        
        # Extract key KPIs
        summary = {
            'total_tickers_tested': result.get('total_tickers_tested', 0),
            'total_trades': result.get('total_trades', 0),
            'winning_trades': result.get('winning_trades', 0),
            'losing_trades': result.get('losing_trades', 0),
            'win_rate': result.get('win_rate', 0),
            'avg_return': result.get('avg_return', 0),
            'total_return_pct': result.get('total_return_pct', 0),
            'profit_factor': result.get('profit_factor', 0),
            'sharpe_ratio': result.get('sharpe_ratio', 0),
            'max_drawdown_pct': result.get('max_drawdown_pct', 0),
            'avg_holding_days': result.get('avg_holding_days', 0),
            'avg_risk_reward': result.get('avg_risk_reward', 0),
            'model_quality': result.get('model_quality', ''),
            'model_quality_ar': result.get('model_quality_ar', ''),
            'adaptive_threshold_final': result.get('adaptive_threshold_final', 75),
            'by_signal': result.get('by_signal', {}),
            'by_proof_count': result.get('by_proof_count', {}),
            'monthly_returns': result.get('monthly_returns', {}),
            'top_winners': result.get('top_winners', [])[:5],
            'top_losers': result.get('top_losers', [])[:5],
            'source_file': os.path.basename(latest),
            'max_consecutive_wins': result.get('max_consecutive_wins', 0),
            'max_consecutive_losses': result.get('max_consecutive_losses', 0),
            'calmar_ratio': result.get('calmar_ratio', 0),
            'gross_profit': result.get('gross_profit', 0),
            'gross_loss': result.get('gross_loss', 0),
        }
        
        return jsonify({'success': True, 'summary': summary})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GET /api/v38-backtest/trades
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/trades', methods=['GET'])
def get_trades():
    """Get trade-level results."""
    try:
        latest = _find_latest_result()
        if not latest:
            return jsonify({'success': False, 'error': 'No results found'}), 404
        
        # Find trades file
        trades_file = latest.replace('.json', '_trades.json')
        if not os.path.exists(trades_file):
            return jsonify({'success': False, 'error': 'Trades file not found'}), 404
        
        with open(trades_file, 'r', encoding='utf-8') as f:
            trades = json.load(f)
        
        # Pagination
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))
        sort_by = request.args.get('sort', 'entry_date')
        sort_dir = request.args.get('dir', 'desc')
        
        # Filter
        signal_filter = request.args.get('signal', '')
        if signal_filter:
            trades = [t for t in trades if t.get('signal') == signal_filter]
        
        # Sort
        reverse = sort_dir == 'desc'
        if sort_by == 'return_pct':
            trades.sort(key=lambda t: t.get('return_pct', 0), reverse=reverse)
        elif sort_by == 'score':
            trades.sort(key=lambda t: t.get('score', 0), reverse=reverse)
        else:
            trades.sort(key=lambda t: t.get('entry_date', ''), reverse=reverse)
        
        # Paginate
        total = len(trades)
        start = (page - 1) * per_page
        end = start + per_page
        paginated = trades[start:end]
        
        return jsonify({
            'success': True,
            'total': total,
            'page': page,
            'per_page': per_page,
            'trades': paginated,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# POST /api/v38-backtest/run
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/run', methods=['POST'])
def run_backtest():
    """Start a new V38 backtest (async)."""
    global _backtest_state
    
    if _backtest_state['running']:
        return jsonify({
            'success': False,
            'error': 'Backtest already running',
            'progress': _backtest_state['progress'],
        }), 409
    
    try:
        data = request.get_json(silent=True) or {}
        threshold = int(data.get('threshold', 75))
        scan_interval = int(data.get('scan_interval', 5))
        start_date = data.get('start_date', '2025-06-01')
        end_date = data.get('end_date', datetime.now().strftime('%Y-%m-%d'))
        min_days = int(data.get('min_days', 200))
        all_stocks = data.get('all_stocks', True)
        tickers = data.get('tickers', [])
        
        def _run_async():
            global _backtest_state
            try:
                _backtest_state['running'] = True
                _backtest_state['started_at'] = datetime.now().isoformat()
                _backtest_state['error'] = None
                
                from engines.backtest_engine import V38BacktestEngine
                engine = V38BacktestEngine(buy_threshold=threshold)
                
                if all_stocks and not tickers:
                    tickers_list = engine.get_tickers(min_days=min_days)
                    _backtest_state['progress'] = f'Found {len(tickers_list)} tickers'
                else:
                    tickers_list = tickers if tickers else engine.get_tickers(min_days=min_days)[:50]
                
                _backtest_state['progress'] = f'Running backtest on {len(tickers_list)} tickers...'
                
                summary = engine.run_backtest(
                    tickers=tickers_list,
                    start_date=start_date,
                    end_date=end_date,
                    scan_interval=scan_interval,
                    verbose=False,
                )
                
                # Save results
                from dataclasses import asdict
                output_path = os.path.join(
                    BACKTEST_RESULTS_DIR,
                    f'v38_backtest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
                )
                os.makedirs(BACKTEST_RESULTS_DIR, exist_ok=True)
                
                result_dict = asdict(summary)
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(result_dict, f, indent=2, ensure_ascii=False, default=str)
                
                # Save trades
                trades_path = output_path.replace('.json', '_trades.json')
                trades_data = [asdict(t) for t in engine.trades]
                with open(trades_path, 'w', encoding='utf-8') as f:
                    json.dump(trades_data, f, indent=2, ensure_ascii=False, default=str)
                
                _backtest_state['last_result_file'] = output_path
                _backtest_state['progress'] = f'Completed: {summary.total_trades} trades, WR={summary.win_rate:.1f}%, PF={summary.profit_factor:.2f}'
                _backtest_state['completed_at'] = datetime.now().isoformat()
                
            except Exception as e:
                _backtest_state['error'] = str(e)
                _backtest_state['progress'] = f'Error: {str(e)}'
            finally:
                _backtest_state['running'] = False
        
        thread = threading.Thread(target=_run_async, daemon=True)
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Backtest started',
            'params': {
                'threshold': threshold,
                'scan_interval': scan_interval,
                'start_date': start_date,
                'end_date': end_date,
                'all_stocks': all_stocks,
            },
        })
    except Exception as e:
        _backtest_state['running'] = False
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GET /api/v38-backtest/status
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/status', methods=['GET'])
def get_status():
    """Check backtest running status."""
    return jsonify({
        'success': True,
        'running': _backtest_state['running'],
        'progress': _backtest_state['progress'],
        'error': _backtest_state['error'],
        'started_at': _backtest_state['started_at'],
        'completed_at': _backtest_state['completed_at'],
        'last_result_file': _backtest_state['last_result_file'],
    })


# ---------------------------------------------------------------------------
# GET /api/v38-backtest/health
# ---------------------------------------------------------------------------
@v38_backtest_bp.route('/api/v38-backtest/health', methods=['GET'])
def health():
    """Health check."""
    latest = _find_latest_result()
    return jsonify({
        'success': True,
        'service': 'v38_backtest',
        'version': '1.0.0',
        'has_results': latest is not None,
        'latest_result': os.path.basename(latest) if latest else None,
        'endpoints': [
            '/api/v38-backtest/results',
            '/api/v38-backtest/summary',
            '/api/v38-backtest/trades',
            '/api/v38-backtest/run',
            '/api/v38-backtest/status',
        ],
    })

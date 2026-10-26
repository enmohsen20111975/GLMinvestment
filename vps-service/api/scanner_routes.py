"""
Scanner Routes Blueprint
========================
Endpoints للـ Scanner (البحث السريع)

Endpoints:
- GET /api/scanner/quick - فحص سريع
"""

import time
from core.auth_middleware import require_admin
from datetime import datetime
from flask import Blueprint, request, jsonify

from core.database import DatabaseManager
from analyzers.technical import TechnicalAnalyzer

scanner_bp = Blueprint('scanner', __name__)

# Initialize
db = DatabaseManager()
tech_analyzer = TechnicalAnalyzer()

# Cache for scanner results
_scanner_cache = {
    'timestamp': 0,
    'results': []
}
CACHE_DURATION = 60  # 60 seconds


@scanner_bp.route('/api/scanner/quick', methods=['GET'])
def quick_scan():
    """Quick scan of stocks for trading signals."""
    try:
        limit = request.args.get('limit', 100, type=int)
        limit = min(limit, 500)  # Max 500 instead of 50
        
        # Check cache
        now = time.time()
        if _scanner_cache['results'] and (now - _scanner_cache['timestamp']) < CACHE_DURATION:
            results = _scanner_cache['results'][:limit]
            return jsonify({
                "success": True,
                "cached": True,
                "timestamp": datetime.now().isoformat(),
                "stocks_analyzed": len(results),
                "results": results
            })
        
        stocks = db.get_all_stocks()[:limit]
        results = []
        
        for stock in stocks:
            ticker = stock.get('ticker')
            if not ticker:
                continue
            
            history = db.get_price_history(ticker, 100)
            
            if len(history) >= 50:
                closes = [h['close'] for h in history]
                prediction = tech_analyzer.generate_prediction(closes, ticker)
                
                results.append({
                    "ticker": ticker,
                    "name": stock.get('name'),
                    "current_price": stock.get('current_price'),
                    "signal": prediction.get('signal'),
                    "confidence": prediction.get('confidence'),
                    "score": prediction.get('score')
                })
        
        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        
        # Update cache
        _scanner_cache['timestamp'] = now
        _scanner_cache['results'] = results
        
        return jsonify({
            "success": True,
            "cached": False,
            "timestamp": datetime.now().isoformat(),
            "stocks_analyzed": len(results),
            "results": results
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# ADVANCED SCANNER (FOR ADMIN DAILY ANALYSIS IN NEXT.JS)
# ============================================================================

_advanced_scan_state = {
    'status': 'idle',
    'is_running': False,
    'progress': 0,
    'current_stock': '',
    'total_stocks': 0,
    'processed_stocks': 0,
    'results': [],
    'scan_date': '',
    'scan_timestamp': '',
    'duration_ms': 0
}

@scanner_bp.route('/api/advanced-scanner/status', methods=['GET'])
def advanced_scan_status():
    """الحصول على حالة الفحص المتقدم الجاري حالياً"""
    return jsonify({
        "success": True,
        "status": _advanced_scan_state['status'],
        "is_running": _advanced_scan_state['is_running'],
        "progress": _advanced_scan_state['progress'],
        "current_stock": _advanced_scan_state['current_stock'],
        "total_stocks": _advanced_scan_state['total_stocks'],
        "processed_stocks": _advanced_scan_state['processed_stocks'],
        "scan_date": _advanced_scan_state['scan_date'],
        "scan_timestamp": _advanced_scan_state['scan_timestamp'],
        "duration_ms": _advanced_scan_state['duration_ms']
    })

@require_admin
@scanner_bp.route('/api/advanced-scanner/run', methods=['POST'])
def run_advanced_scan():
    """
    تشغيل الفحص اليومي المتقدم الشامل متوافق تماماً مع Next.js
    """
    global _advanced_scan_state
    
    if _advanced_scan_state['is_running']:
        return jsonify({
            "success": False,
            "error": "هناك فحص متقدم قيد التشغيل بالفعل"
        }), 400
        
    try:
        import os
        from pathlib import Path
        
        try:
            from config import DATABASE_PATH
        except ImportError:
            _base_dir = Path(__file__).parent.parent.parent.resolve()
            DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
            
        from analyzers.master_analyzer import MasterAnalyzer, load_merged_history
        from utils.helpers import parse_volume
        
        # 1. تهيئة الحالة وقراءة المعاملات
        data = request.get_json() or {}
        min_volume = data.get('min_volume', 1000)
        include_dead_stocks = data.get('include_dead_stocks', False)
        
        # جلب كل الأسهم من قاعدة البيانات
        stocks = db.get_all_stocks()
        if not include_dead_stocks:
            # تصفية الأسهم النشطة فقط باستخدام parse_volume لتجنب مشاكل مقارنة النصوص
            stocks = [s for s in stocks if s.get('current_price', 0) > 0 and parse_volume(s.get('volume', 0)) >= min_volume]
            
        total_stocks = len(stocks)
        
        start_time = time.time()
        today = datetime.now().strftime('%Y-%m-%d')
        timestamp = datetime.now().isoformat()
        
        _advanced_scan_state.update({
            'status': 'running',
            'is_running': True,
            'progress': 0,
            'current_stock': '',
            'total_stocks': total_stocks,
            'processed_stocks': 0,
            'results': [],
            'scan_date': today,
            'scan_timestamp': timestamp,
            'duration_ms': 0
        })
        
        # تهيئة المحلل
        analyzer = MasterAnalyzer(DATABASE_PATH)
        scan_results = []
        processed = 0
        
        print(f"[AdvancedScanner] Starting scan for {total_stocks} stocks...")
        
        for stock in stocks:
            ticker = stock.get('ticker')
            if not ticker:
                continue
                
            _advanced_scan_state['current_stock'] = ticker
            
            try:
                # تشغيل التحليل الشامل
                analysis = analyzer.analyze(ticker)
                
                # BRAVO-PRODUCTION-INTEGRATION: apply Risk Gate after analysis
                # Risk Gate is independent — cannot be bypassed by high score.
                # Uses EXISTING decision_logger.py (not a new DB).
                try:
                    import sys as _sys
                    _vps_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '')
                    if _vps_path not in _sys.path:
                        _sys.path.insert(0, _vps_path)
                    from core.risk_gate import apply_risk_gate
                    from analyzers.decision_logger import log_decision as _log_decision
                    
                    _raw_sig = getattr(analysis, 'signal', 'HOLD')
                    _score = getattr(analysis, 'master_score', 0)
                    _rp = getattr(analysis, 'risk_profile', {}) or {}
                    if not isinstance(_rp, dict): _rp = {}
                    _rr = _rp.get('risk_reward_ratio', 2.0)
                    _pos = getattr(analysis, 'suggested_position_size', 5.0) or 5.0
                    
                    _final_sig, _risk_warns, _final_pos = apply_risk_gate(
                        signal=_raw_sig, master_score=_score,
                        risk_profile={'risk_reward_ratio': _rr},
                        position_size_pct=_pos,
                    )
                    
                    # Risk Gate overrides signal if it rejects
                    if _final_sig == 'NO_TRADE':
                        analysis.signal = 'NO_TRADE'
                        analysis.signal_ar = 'لا تتداول'
                        # Log rejection using EXISTING decision_logger
                        _log_decision(
                            symbol=ticker,
                            decision_type='reject_entry',
                            reason_code='risk_gate_blocked',
                            reason_text='; '.join(_risk_warns),
                            flag_active='RISK_GATE',
                            score_before=int(_score) if _score else 0,
                            score_after=0,
                        )
                    else:
                        # Log accepted decision
                        _log_decision(
                            symbol=ticker,
                            decision_type='accept_entry',
                            reason_code='risk_gate_passed',
                            reason_text=f'signal={_final_sig} score={_score}',
                            flag_active='RISK_GATE',
                            score_before=int(_score) if _score else 0,
                            score_after=int(_score) if _score else 0,
                        )
                    
                    if _risk_warns:
                        _old_reason = getattr(analysis, 'reason', '') or ''
                        analysis.reason = f"{_old_reason} | Risk: {'; '.join(_risk_warns)}"[:500]
                    
                    if _final_pos != _pos:
                        analysis.suggested_position_size = _final_pos
                    
                except Exception:
                    pass  # Risk gate optional — don't break scan if unavailable
                
                # تصفية الأسهم غير الصالحة للتداول
                if not include_dead_stocks and not analysis.is_tradeable:
                    processed += 1
                    _advanced_scan_state['processed_stocks'] = processed
                    _advanced_scan_state['progress'] = int((processed / total_stocks) * 100)
                    continue
                
                # جلب مؤشر RSI والاتجاه
                prices, volumes = analyzer._get_price_data(ticker)
                rsi_val = 50.0
                rsi_sig = 'NEUTRAL'
                macd_sig = 'NEUTRAL'
                bollinger_pos = 'MIDDLE'
                stoch_k = 50.0
                sma20 = None
                sma50 = None
                
                # حساب المؤشرات الفنية الإضافية لعرضها في Prisma
                if len(prices) >= 20:
                    # RSI
                    from analyzers.core_scoring_engine import calc_rsi, calc_macd, calc_sma, calc_bollinger
                    rsi_val = calc_rsi(prices)
                    # FIX-1 Step 4: calc_rsi returns None when insufficient data
                    # (per owner directive + Rule 24 — no placeholder 50.0)
                    if rsi_val is not None:
                        if rsi_val >= 70:
                            rsi_sig = 'OVERBOUGHT'
                        elif rsi_val <= 30:
                            rsi_sig = 'OVERSOLD'
                        
                    # MACD
                    if len(prices) >= 26:
                        _, _, macd_dir = calc_macd(prices)
                        macd_sig = macd_dir.upper()
                        
                    # SMA
                    sma20 = calc_sma(prices, 20)
                    sma50 = calc_sma(prices, 50) if len(prices) >= 50 else None
                    
                    # Bollinger
                    bb_upper, bb_mid, bb_lower = calc_bollinger(prices)
                    current_price = prices[-1]
                    if current_price >= bb_upper:
                        bollinger_pos = 'ABOVE_UPPER'
                    elif current_price <= bb_lower:
                        bollinger_pos = 'BELOW_LOWER'
                    elif current_price > bb_mid:
                        bollinger_pos = 'UPPER_HALF'
                    else:
                        bollinger_pos = 'LOWER_HALF'
                
                risk_profile = analysis.risk_profile or {}
                
                # بناء النتيجة المتوافقة مع الـ schema في Next.js Prisma DB
                scan_results.append({
                    "symbol": ticker,
                    "name": stock.get('name') or analysis.name or ticker,
                    "is_alive": analysis.is_tradeable,
                    "vitality_score": int(analysis.master_score),
                    "price": float(stock.get('current_price') or prices[-1] if prices else 0),
                    "change_percent": float(stock.get('change_percent') or 0),
                    "volume": parse_volume(stock.get('volume')),
                    "trend": "UPTREND" if analysis.market_regime_score > 60 else "DOWNTREND" if analysis.market_regime_score < 40 else "NEUTRAL",
                    "trend_ar": "صاعد" if analysis.market_regime_score > 60 else "هابط" if analysis.market_regime_score < 40 else "محايد",
                    "overall_score": float(analysis.master_score),
                    "rsi": float(rsi_val),
                    "rsi_signal": rsi_sig,
                    "macd_signal": macd_sig,
                    "bollinger_position": bollinger_pos,
                    "stochastic_k": float(stoch_k),
                    "sma_20": float(sma20) if sma20 is not None else None,
                    "sma_50": float(sma50) if sma50 is not None else None,
                    "recommendation": analysis.signal,
                    "recommendation_ar": analysis.signal_ar,
                    "entry_price": float(risk_profile.get('entry_price') or 0),
                    "stop_loss": float(risk_profile.get('stop_loss_price') or 0),
                    "take_profit_1": float(risk_profile.get('target_price') or 0),
                    "risk_level": "HIGH" if risk_profile.get('volatility_adjustment', 0) > 4 else "LOW" if risk_profile.get('volatility_adjustment', 0) < 2 else "MEDIUM"
                })
                
            except Exception as e:
                print(f"[AdvancedScanner] Error analyzing {ticker}: {e}")
                
            processed += 1
            _advanced_scan_state['processed_stocks'] = processed
            _advanced_scan_state['progress'] = int((processed / total_stocks) * 100)
            
        duration = int((time.time() - start_time) * 1000)
        
        # تحديث الحالة النهائية
        _advanced_scan_state.update({
            'status': 'completed',
            'is_running': False,
            'progress': 100,
            'results': scan_results,
            'duration_ms': duration
        })
        
        # حساب إحصائيات المجموعات
        buy_opps = [r for r in scan_results if r['recommendation'] in ['BUY', 'STRONG_BUY', 'ACCUMULATE']]
        sell_opps = [r for r in scan_results if r['recommendation'] in ['SELL', 'STRONG_SELL', 'REDUCE']]
        
        response_data = {
            "success": True,
            "scan_date": today,
            "scan_timestamp": timestamp,
            "duration_ms": duration,
            "batches_processed": 1,
            "total_stocks": total_stocks,
            "alive_stocks": len([r for r in scan_results if r['is_alive']]),
            "dead_stocks": len([r for r in scan_results if not r['is_alive']]),
            "buy_opportunities": len(buy_opps),
            "sell_opportunities": len(sell_opps),
            "results": scan_results
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        _advanced_scan_state.update({
            'status': 'failed',
            'is_running': False
        })
        import traceback
        print(f"[AdvancedScanner] Error in daily scan: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

"""
Enhanced Prediction Tracker
============================
نظام تتبع التوقعات المحسن مع تتبع تفصيلي للنتائج

المميزات:
- تتبع تاريخ الوصول للهدف والوقف
- حساب العائد الفعلي وأيام الاحتفاظ
- إحصائيات الأداء حسب السوق
- تصدير التقارير

Author: GLMinvestment Platform
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import os

# مسارات قواعد البيانات
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'data_engine', 'data', 'data_engine.db')


@dataclass
class PredictionResult:
    """نتيجة تقييم التوقع"""
    prediction_id: str
    symbol: str
    status: str
    entry_price: float
    current_price: float
    target_price: float
    stop_loss: float
    signal_type: str
    actual_return: Optional[float] = None
    hit_target: bool = False
    hit_stop: bool = False
    target_hit_date: Optional[str] = None
    stop_hit_date: Optional[str] = None
    evaluation_date: Optional[str] = None
    holding_days: int = 0
    market: str = ''


class EnhancedPredictionTracker:
    """
    متتبع التوقعات المحسن
    
    يوفر:
    - تقييم التوقعات الفردية والجماعية
    - تتبع تاريخ الوصول للهدف والوقف
    - إحصائيات الأداء التفصيلية
    - تصدير التقارير
    """
    
    def __init__(self, predictions_db: str = None, data_engine_db: str = None):
        """
        تهيئة المتتبع
        
        Args:
            predictions_db: مسار قاعدة بيانات التوقعات
            data_engine_db: مسار قاعدة بيانات محرك البيانات
        """
        self.predictions_db = predictions_db or PREDICTIONS_DB
        self.data_engine_db = data_engine_db or DATA_ENGINE_DB
        
    def _get_predictions_connection(self) -> sqlite3.Connection:
        """الحصول على اتصال بقاعدة بيانات التوقعات"""
        return sqlite3.connect(self.predictions_db)
    
    def _get_data_engine_connection(self) -> sqlite3.Connection:
        """الحصول على اتصال بقاعدة بيانات محرك البيانات"""
        return sqlite3.connect(self.data_engine_db)
    
    def get_current_price(self, symbol: str, market: str = None) -> Optional[float]:
        """
        الحصول على السعر الحالي للسهم
        
        Args:
            symbol: رمز السهم
            market: السوق (EGX, TADAWUL, KSE, QSE, CRYPTO)
            
        Returns:
            السعر الحالي أو None إذا لم يوجد
        """
        conn = self._get_data_engine_connection()
        cursor = conn.cursor()
        
        try:
            # للعملات الرقمية
            if market == 'CRYPTO' or symbol in ['BTC', 'ETH', 'BNB']:
                cursor.execute('''
                    SELECT price_usd FROM crypto_prices 
                    WHERE symbol = ? OR symbol = ?
                    ORDER BY timestamp DESC LIMIT 1
                ''', (symbol, symbol + 'USDT'))
                row = cursor.fetchone()
                if row:
                    return row[0]
            
            # للأسهم - البحث في جدول stocks
            cursor.execute('''
                SELECT price FROM stocks WHERE symbol = ?
            ''', (symbol,))
            row = cursor.fetchone()
            if row:
                return row[0]
            
            # البحث في جدول stock_prices
            cursor.execute('''
                SELECT price FROM stock_prices 
                WHERE symbol = ?
                ORDER BY timestamp DESC LIMIT 1
            ''', (symbol,))
            row = cursor.fetchone()
            if row:
                return row[0]
            
            return None
            
        finally:
            conn.close()
    
    def evaluate_prediction(self, symbol: str, current_price: float = None) -> PredictionResult:
        """
        تقييم توقع واحد
        
        Args:
            symbol: رمز السهم
            current_price: السعر الحالي (اختياري - سيتم جلبه إذا لم يحدد)
            
        Returns:
            PredictionResult: نتيجة التقييم
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            # جلب التوقع المعلق
            cursor.execute('''
                SELECT id, stock_symbol, stock_name_ar, signal_type, entry_price, 
                       target_price, stop_loss, prediction_date, status, market,
                       target_hit_date, stop_hit_date
                FROM aiPrediction 
                WHERE stock_symbol = ? AND status = 'PENDING'
                ORDER BY prediction_date DESC LIMIT 1
            ''', (symbol,))
            
            row = cursor.fetchone()
            if not row:
                return PredictionResult(
                    prediction_id='',
                    symbol=symbol,
                    status='NOT_FOUND',
                    entry_price=0,
                    current_price=0,
                    target_price=0,
                    stop_loss=0,
                    signal_type=''
                )
            
            pred_id, stock_symbol, stock_name, signal_type, entry_price, \
                target_price, stop_loss, prediction_date, status, market, \
                target_hit_date, stop_hit_date = row
            
            # الحصول على السعر الحالي
            if current_price is None:
                current_price = self.get_current_price(symbol, market)
            
            if current_price is None:
                return PredictionResult(
                    prediction_id=pred_id,
                    symbol=symbol,
                    status='PRICE_UNAVAILABLE',
                    entry_price=entry_price or 0,
                    current_price=0,
                    target_price=target_price or 0,
                    stop_loss=stop_loss or 0,
                    signal_type=signal_type or '',
                    market=market or ''
                )
            
            # حساب الأيام
            holding_days = 0
            try:
                pred_date = datetime.strptime(prediction_date, '%Y-%m-%d')
                holding_days = (datetime.now() - pred_date).days
            except:
                pass
            
            # التحقق من الوصول للهدف أو الوقف
            today = datetime.now().strftime('%Y-%m-%d')
            hit_target = False
            hit_stop = False
            new_status = status
            actual_return = None
            
            if signal_type == 'BUY':
                # لشراء: الهدف أعلى، الوقف أدنى
                if current_price >= target_price:
                    hit_target = True
                    new_status = 'TARGET_HIT'
                    if not target_hit_date:
                        target_hit_date = today
                elif current_price <= stop_loss:
                    hit_stop = True
                    new_status = 'STOP_HIT'
                    if not stop_hit_date:
                        stop_hit_date = today
                        
            elif signal_type == 'SELL':
                # لبيع: الهدف أدنى، الوقف أعلى
                if current_price <= target_price:
                    hit_target = True
                    new_status = 'TARGET_HIT'
                    if not target_hit_date:
                        target_hit_date = today
                elif current_price >= stop_loss:
                    hit_stop = True
                    new_status = 'STOP_HIT'
                    if not stop_hit_date:
                        stop_hit_date = today
            
            # حساب العائد الفعلي
            if entry_price and entry_price > 0:
                actual_return = ((current_price - entry_price) / entry_price) * 100
            
            # تحديث قاعدة البيانات
            cursor.execute('''
                UPDATE aiPrediction SET
                    status = ?,
                    final_price = ?,
                    profit_loss_percent = ?,
                    hit_target = ?,
                    hit_stop_loss = ?,
                    target_hit_date = ?,
                    stop_hit_date = ?,
                    evaluation_date = ?,
                    actual_return = ?,
                    holding_days = ?,
                    updated_at = ?
                WHERE id = ?
            ''', (
                new_status,
                current_price,
                actual_return,
                1 if hit_target else 0,
                1 if hit_stop else 0,
                target_hit_date,
                stop_hit_date,
                today if (hit_target or hit_stop) else None,
                actual_return,
                holding_days,
                datetime.now().isoformat(),
                pred_id
            ))
            
            conn.commit()
            
            return PredictionResult(
                prediction_id=pred_id,
                symbol=symbol,
                status=new_status,
                entry_price=entry_price or 0,
                current_price=current_price,
                target_price=target_price or 0,
                stop_loss=stop_loss or 0,
                signal_type=signal_type or '',
                actual_return=actual_return,
                hit_target=hit_target,
                hit_stop=hit_stop,
                target_hit_date=target_hit_date,
                stop_hit_date=stop_hit_date,
                evaluation_date=today if (hit_target or hit_stop) else None,
                holding_days=holding_days,
                market=market or ''
            )
            
        finally:
            conn.close()
    
    def batch_evaluate_predictions(self, market: str = None) -> Dict[str, Any]:
        """
        تقييم كل التوقعات المعلقة
        
        Args:
            market: السوق المحدد (اختياري)
            
        Returns:
            Dict: ملخص نتائج التقييم
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            # جلب التوقعات المعلقة
            if market:
                cursor.execute('''
                    SELECT stock_symbol, market FROM aiPrediction 
                    WHERE status = 'PENDING' AND market = ?
                ''', (market,))
            else:
                cursor.execute('''
                    SELECT stock_symbol, market FROM aiPrediction 
                    WHERE status = 'PENDING'
                ''')
            
            pending = cursor.fetchall()
            conn.close()
            
            results = {
                'total_evaluated': 0,
                'targets_hit': 0,
                'stops_hit': 0,
                'still_pending': 0,
                'errors': 0,
                'details': []
            }
            
            for symbol, pred_market in pending:
                try:
                    result = self.evaluate_prediction(symbol)
                    results['total_evaluated'] += 1
                    
                    if result.status == 'TARGET_HIT':
                        results['targets_hit'] += 1
                    elif result.status == 'STOP_HIT':
                        results['stops_hit'] += 1
                    elif result.status == 'PENDING':
                        results['still_pending'] += 1
                    else:
                        results['errors'] += 1
                    
                    results['details'].append({
                        'symbol': symbol,
                        'status': result.status,
                        'return': result.actual_return
                    })
                    
                except Exception as e:
                    results['errors'] += 1
                    results['details'].append({
                        'symbol': symbol,
                        'status': 'ERROR',
                        'error': str(e)
                    })
            
            return results
            
        except Exception as e:
            if conn:
                conn.close()
            return {'error': str(e)}
    
    def get_prediction_history(self, market: str = None, days: int = 30) -> List[Dict]:
        """
        سجل التوقعات مع النتائج
        
        Args:
            market: السوق (اختياري)
            days: عدد الأيام السابقة
            
        Returns:
            List[Dict]: قائمة التوقعات
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            
            if market:
                cursor.execute('''
                    SELECT id, stock_symbol, stock_name_ar, signal_type, entry_price,
                           target_price, stop_loss, prediction_date, status,
                           final_price, profit_loss_percent, hit_target, hit_stop_loss,
                           target_hit_date, stop_hit_date, evaluation_date,
                           actual_return, holding_days, market, maestro_score, confidence
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND market = ?
                    ORDER BY prediction_date DESC
                ''', (since_date, market))
            else:
                cursor.execute('''
                    SELECT id, stock_symbol, stock_name_ar, signal_type, entry_price,
                           target_price, stop_loss, prediction_date, status,
                           final_price, profit_loss_percent, hit_target, hit_stop_loss,
                           target_hit_date, stop_hit_date, evaluation_date,
                           actual_return, holding_days, market, maestro_score, confidence
                    FROM aiPrediction 
                    WHERE prediction_date >= ?
                    ORDER BY prediction_date DESC
                ''', (since_date,))
            
            rows = cursor.fetchall()
            
            history = []
            for row in rows:
                history.append({
                    'id': row[0],
                    'symbol': row[1],
                    'name': row[2],
                    'signal_type': row[3],
                    'entry_price': row[4],
                    'target_price': row[5],
                    'stop_loss': row[6],
                    'prediction_date': row[7],
                    'status': row[8],
                    'final_price': row[9],
                    'profit_loss_percent': row[10],
                    'hit_target': bool(row[11]),
                    'hit_stop_loss': bool(row[12]),
                    'target_hit_date': row[13],
                    'stop_hit_date': row[14],
                    'evaluation_date': row[15],
                    'actual_return': row[16],
                    'holding_days': row[17],
                    'market': row[18],
                    'maestro_score': row[19],
                    'confidence': row[20]
                })
            
            return history
            
        finally:
            conn.close()
    
    def get_performance_stats(self, market: str = None, days: int = 30) -> Dict[str, Any]:
        """
        إحصائيات الأداء
        
        Args:
            market: السوق (اختياري)
            days: عدد الأيام
            
        Returns:
            Dict: إحصائيات الأداء
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            
            # إحصائيات أساسية
            if market:
                cursor.execute('''
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
                        SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as targets_hit,
                        SUM(CASE WHEN status = 'STOP_HIT' THEN 1 ELSE 0 END) as stops_hit,
                        AVG(actual_return) as avg_return,
                        AVG(holding_days) as avg_holding_days,
                        AVG(maestro_score) as avg_score,
                        AVG(confidence) as avg_confidence
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND market = ?
                ''', (since_date, market))
            else:
                cursor.execute('''
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
                        SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as targets_hit,
                        SUM(CASE WHEN status = 'STOP_HIT' THEN 1 ELSE 0 END) as stops_hit,
                        AVG(actual_return) as avg_return,
                        AVG(holding_days) as avg_holding_days,
                        AVG(maestro_score) as avg_score,
                        AVG(confidence) as avg_confidence
                    FROM aiPrediction 
                    WHERE prediction_date >= ?
                ''', (since_date,))
            
            row = cursor.fetchone()
            
            total = row[0] or 0
            pending = row[1] or 0
            targets_hit = row[2] or 0
            stops_hit = row[3] or 0
            evaluated = targets_hit + stops_hit
            
            # إحصائيات حسب نوع الإشارة
            if market:
                cursor.execute('''
                    SELECT signal_type, COUNT(*), 
                           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END),
                           AVG(actual_return)
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND market = ?
                    GROUP BY signal_type
                ''', (since_date, market))
            else:
                cursor.execute('''
                    SELECT signal_type, COUNT(*), 
                           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END),
                           AVG(actual_return)
                    FROM aiPrediction 
                    WHERE prediction_date >= ?
                    GROUP BY signal_type
                ''', (since_date,))
            
            by_signal = {}
            for sig_row in cursor.fetchall():
                by_signal[sig_row[0]] = {
                    'total': sig_row[1],
                    'targets_hit': sig_row[2],
                    'avg_return': round(sig_row[3] or 0, 2)
                }
            
            # إحصائيات حسب السوق
            if not market:
                cursor.execute('''
                    SELECT market, COUNT(*), 
                           SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END),
                           SUM(CASE WHEN status = 'STOP_HIT' THEN 1 ELSE 0 END),
                           AVG(actual_return)
                    FROM aiPrediction 
                    WHERE prediction_date >= ?
                    GROUP BY market
                ''', (since_date,))
                
                by_market = {}
                for mkt_row in cursor.fetchall():
                    by_market[mkt_row[0]] = {
                        'total': mkt_row[1],
                        'targets_hit': mkt_row[2],
                        'stops_hit': mkt_row[3],
                        'avg_return': round(mkt_row[4] or 0, 2)
                    }
            else:
                by_market = {}
            
            # أفضل وأسوأ التوقعات
            if market:
                cursor.execute('''
                    SELECT stock_symbol, actual_return, signal_type
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND market = ? AND actual_return IS NOT NULL
                    ORDER BY actual_return DESC LIMIT 5
                ''', (since_date, market))
            else:
                cursor.execute('''
                    SELECT stock_symbol, actual_return, signal_type
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND actual_return IS NOT NULL
                    ORDER BY actual_return DESC LIMIT 5
                ''', (since_date,))
            
            best_predictions = [
                {'symbol': r[0], 'return': r[1], 'signal': r[2]}
                for r in cursor.fetchall()
            ]
            
            if market:
                cursor.execute('''
                    SELECT stock_symbol, actual_return, signal_type
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND market = ? AND actual_return IS NOT NULL
                    ORDER BY actual_return ASC LIMIT 5
                ''', (since_date, market))
            else:
                cursor.execute('''
                    SELECT stock_symbol, actual_return, signal_type
                    FROM aiPrediction 
                    WHERE prediction_date >= ? AND actual_return IS NOT NULL
                    ORDER BY actual_return ASC LIMIT 5
                ''', (since_date,))
            
            worst_predictions = [
                {'symbol': r[0], 'return': r[1], 'signal': r[2]}
                for r in cursor.fetchall()
            ]
            
            win_rate = (targets_hit / evaluated * 100) if evaluated > 0 else 0
            
            return {
                'period_days': days,
                'market': market or 'ALL',
                'total_predictions': total,
                'pending': pending,
                'evaluated': evaluated,
                'targets_hit': targets_hit,
                'stops_hit': stops_hit,
                'win_rate': round(win_rate, 2),
                'avg_return': round(row[4] or 0, 2),
                'avg_holding_days': round(row[5] or 0, 1),
                'avg_maestro_score': round(row[6] or 0, 1),
                'avg_confidence': round(row[7] or 0, 1),
                'by_signal_type': by_signal,
                'by_market': by_market,
                'best_predictions': best_predictions,
                'worst_predictions': worst_predictions
            }
            
        finally:
            conn.close()
    
    def check_target_hit(self, prediction_id: str) -> Dict[str, Any]:
        """
        التحقق من الوصول للهدف
        
        Args:
            prediction_id: معرف التوقع
            
        Returns:
            Dict: نتيجة التحقق
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT stock_symbol, signal_type, entry_price, target_price, stop_loss,
                       status, market, target_hit_date, stop_hit_date
                FROM aiPrediction WHERE id = ?
            ''', (prediction_id,))
            
            row = cursor.fetchone()
            if not row:
                return {'error': 'Prediction not found', 'prediction_id': prediction_id}
            
            symbol, signal_type, entry_price, target_price, stop_loss, \
                status, market, target_hit_date, stop_hit_date = row
            
            # الحصول على السعر الحالي
            current_price = self.get_current_price(symbol, market)
            
            if current_price is None:
                return {
                    'prediction_id': prediction_id,
                    'symbol': symbol,
                    'status': status,
                    'error': 'Current price unavailable'
                }
            
            # التحقق من الوصول
            hit_target = False
            hit_stop = False
            
            if signal_type == 'BUY':
                hit_target = current_price >= target_price
                hit_stop = current_price <= stop_loss
            elif signal_type == 'SELL':
                hit_target = current_price <= target_price
                hit_stop = current_price >= stop_loss
            
            return {
                'prediction_id': prediction_id,
                'symbol': symbol,
                'signal_type': signal_type,
                'entry_price': entry_price,
                'target_price': target_price,
                'stop_loss': stop_loss,
                'current_price': current_price,
                'status': status,
                'hit_target': hit_target,
                'hit_stop': hit_stop,
                'target_hit_date': target_hit_date,
                'stop_hit_date': stop_hit_date,
                'distance_to_target_pct': round(((target_price - current_price) / current_price) * 100, 2) if current_price > 0 else 0,
                'distance_to_stop_pct': round(((current_price - stop_loss) / current_price) * 100, 2) if current_price > 0 else 0
            }
            
        finally:
            conn.close()
    
    def get_pending_predictions(self, market: str = None, limit: int = 100) -> List[Dict]:
        """
        الحصول على التوقعات المعلقة
        
        Args:
            market: السوق (اختياري)
            limit: الحد الأقصى للنتائج
            
        Returns:
            List[Dict]: قائمة التوقعات المعلقة
        """
        conn = self._get_predictions_connection()
        cursor = conn.cursor()
        
        try:
            if market:
                cursor.execute('''
                    SELECT id, stock_symbol, stock_name_ar, signal_type, entry_price,
                           target_price, stop_loss, prediction_date, market,
                           maestro_score, confidence
                    FROM aiPrediction 
                    WHERE status = 'PENDING' AND market = ?
                    ORDER BY maestro_score DESC, prediction_date DESC
                    LIMIT ?
                ''', (market, limit))
            else:
                cursor.execute('''
                    SELECT id, stock_symbol, stock_name_ar, signal_type, entry_price,
                           target_price, stop_loss, prediction_date, market,
                           maestro_score, confidence
                    FROM aiPrediction 
                    WHERE status = 'PENDING'
                    ORDER BY maestro_score DESC, prediction_date DESC
                    LIMIT ?
                ''', (limit,))
            
            rows = cursor.fetchall()
            
            pending = []
            for row in rows:
                # الحصول على السعر الحالي
                current_price = self.get_current_price(row[1], row[8])
                
                pending.append({
                    'id': row[0],
                    'symbol': row[1],
                    'name': row[2],
                    'signal_type': row[3],
                    'entry_price': row[4],
                    'target_price': row[5],
                    'stop_loss': row[6],
                    'prediction_date': row[7],
                    'market': row[8],
                    'maestro_score': row[9],
                    'confidence': row[10],
                    'current_price': current_price,
                    'potential_return': round(((row[5] - row[4]) / row[4]) * 100, 2) if row[4] > 0 else 0,
                    'risk_ratio': round(abs((row[5] - row[4]) / (row[4] - row[6])), 2) if row[4] != row[6] else 0
                })
            
            return pending
            
        finally:
            conn.close()
    
    def export_report(self, market: str = None, days: int = 30, format: str = 'json') -> str:
        """
        تصدير تقرير التوقعات
        
        Args:
            market: السوق (اختياري)
            days: عدد الأيام
            format: تنسيق التصدير (json, csv)
            
        Returns:
            str: محتوى التقرير
        """
        stats = self.get_performance_stats(market, days)
        history = self.get_prediction_history(market, days)
        
        # نص المشاركة على السوشيال ميديا
        social_share = {
            'text': 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈',
            'links': {
                'website': 'https://invist.m2y.net',
                'android_app': 'https://play.google.com/store/apps/details?id=com.egx.investment',
                'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
                'telegram': 'https://t.me/Arabian_investment_guide'
            }
        }
        
        if format == 'json':
            return json.dumps({
                'stats': stats,
                'history': history,
                'exported_at': datetime.now().isoformat(),
                'social_share': social_share
            }, ensure_ascii=False, indent=2)
        
        elif format == 'csv':
            import io
            output = io.StringIO()
            
            # Header
            output.write('Symbol,Name,Signal,Entry,Target,Stop,Status,Return,Date,Market\n')
            
            for h in history:
                output.write(f'{h["symbol"]},{h["name"]},{h["signal_type"]},'
                           f'{h["entry_price"]},{h["target_price"]},{h["stop_loss"]},'
                           f'{h["status"]},{h["actual_return"] or ""},'
                           f'{h["prediction_date"]},{h["market"]}\n')
            
            # Add social share text at the end
            output.write('\n')
            output.write('#' + '=' * 80 + '\n')
            output.write(f'# انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈\n')
            output.write('#' + '=' * 80 + '\n')
            output.write('# 🔗 روابطنا الرسمية:\n')
            output.write('# 🌐 الموقع الإلكتروني: https://invist.m2y.net\n')
            output.write('# 📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment\n')
            output.write('# 📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048\n')
            output.write('# ✈️ تليجرام: https://t.me/Arabian_investment_guide\n')
            
            return output.getvalue()
        
        return ''


# تشغيل اختبار
if __name__ == '__main__':
    tracker = EnhancedPredictionTracker()
    
    print("=" * 60)
    print("نظام تتبع التوقعات المحسن - Enhanced Prediction Tracker")
    print("=" * 60)
    
    # إحصائيات الأداء
    print("\n📊 إحصائيات الأداء (30 يوم):")
    stats = tracker.get_performance_stats()
    print(f"  إجمالي التوقعات: {stats['total_predictions']}")
    print(f"  معلقة: {stats['pending']}")
    print(f"  تم تقييمها: {stats['evaluated']}")
    print(f"  أهداف محققة: {stats['targets_hit']}")
    print(f"  وقوف مفعلة: {stats['stops_hit']}")
    print(f"  نسبة النجاح: {stats['win_rate']}%")
    print(f"  متوسط العائد: {stats['avg_return']}%")
    
    # التوقعات المعلقة
    print("\n⏳ التوقعات المعلقة (أعلى 5):")
    pending = tracker.get_pending_predictions(limit=5)
    for p in pending:
        print(f"  {p['symbol']} ({p['market']}): {p['signal_type']} - "
              f"Score: {p['maestro_score']}, Entry: {p['entry_price']}")

"""
Real Backtesting System
=======================
نظام اختبار حقيقي على البيانات التاريخية

هذا النظام:
1. يختبر التوقعات على بيانات الماضي
2. يحسب Win Rate الحقيقي
3. يحدد نقاط القوة والضعف

Author: دليل الاستثمار
"""

import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.master_analyzer import MasterAnalyzer
from config import DATABASE_PATH, PRICE_HISTORY_DB_PATH


@dataclass
class BacktestResult:
    """Result of a single backtest prediction."""
    ticker: str
    signal: str
    prediction_date: str
    
    # Prices
    entry_price: float
    target_price: float
    stop_loss: float
    
    # Outcome
    exit_price: float
    actual_return: float
    holding_days: int
    
    # Result
    hit_target: bool
    hit_stop: bool
    is_correct: bool
    
    # Scores at prediction time
    master_score: float
    technical_score: float
    fundamental_score: float
    ai_pattern_score: float


class RealBacktester:
    """
    نظام الاختبار الحقيقي
    
    يختبر النظام على بيانات الماضي:
    - يحدد تاريخ الاختبار
    - يشغل التحليل بالبيانات المتاحة
    - يقارن النتائج بالواقع
    - يحسب Win Rate
    """
    
    def __init__(self, db_path: str = DATABASE_PATH, history_db_path: str = PRICE_HISTORY_DB_PATH):
        self.db_path = db_path
        self.history_db_path = history_db_path
        
        # Broken stocks to exclude (ratio issues)
        self.excluded_stocks = set()
        self._identify_broken_stocks()
    
    def _identify_broken_stocks(self):
        """Identify stocks with broken price data (ratio > 5x or < 0.2x)."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn_stocks = db_manager.get_connection(self.db_path, writable=False)
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn_history = db_manager.get_connection(self.history_db_path, writable=False)
        
        cursor_stocks = conn_stocks.cursor()
        cursor_history = conn_history.cursor()
        
        # Get all stocks with current price
        cursor_stocks.execute('SELECT ticker, current_price FROM stocks WHERE current_price > 0')
        stocks = cursor_stocks.fetchall()
        
        for ticker, current_price in stocks:
            cursor_history.execute('''
                SELECT close_price FROM price_history 
                WHERE ticker = ? 
                ORDER BY date DESC 
                LIMIT 1
            ''', (ticker,))
            
            row = cursor_history.fetchone()
            if row and row[0] and row[0] > 0:
                history_price = row[0]
                ratio = current_price / history_price
                
                # Exclude if ratio is unreasonable
                if ratio > 5.0 or ratio < 0.2:
                    self.excluded_stocks.add(ticker)
        
        conn_stocks.close()
        conn_history.close()
        
        print(f"[Backtester] Identified {len(self.excluded_stocks)} broken stocks to exclude")
    
    def get_historical_prices(
        self, 
        ticker: str, 
        end_date: str,
        lookback_days: int = 100
    ) -> Tuple[List[float], List[float], List[str]]:
        """
        Get historical prices up to a specific date.
        
        Args:
            ticker: Stock symbol
            end_date: End date (YYYY-MM-DD)
            lookback_days: Number of days to look back
            
        Returns:
            Tuple: (prices, volumes, dates)
        """
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.history_db_path, writable=False)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT close_price, volume, date
            FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC
            LIMIT ?
        ''', (ticker, end_date, lookback_days))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows or len(rows) < 20:
            return [], [], []
        
        # Reverse to chronological order
        rows = list(reversed(rows))
        
        prices = [row[0] for row in rows if row[0] and row[0] > 0]
        volumes = [row[1] for row in rows if row[1]]
        dates = [row[2] for row in rows]
        
        return prices, volumes, dates
    
    def get_future_price(
        self,
        ticker: str,
        start_date: str,
        days_ahead: int
    ) -> Optional[float]:
        """Get price N days after a date."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.history_db_path, writable=False)
        cursor = conn.cursor()
        
        # Calculate target date
        start = datetime.strptime(start_date, '%Y-%m-%d')
        target_date = (start + timedelta(days=days_ahead)).strftime('%Y-%m-%d')
        
        cursor.execute('''
            SELECT close_price
            FROM price_history
            WHERE ticker = ? AND date >= ?
            ORDER BY date ASC
            LIMIT 1
        ''', (ticker, target_date))
        
        row = cursor.fetchone()
        conn.close()
        
        return row[0] if row and row[0] else None
    
    def run_backtest(
        self,
        prediction_date: str,
        holding_days: int = 10,
        min_liquidity: int = 100000,
        top_n: int = 30
    ) -> Dict:
        """
        Run backtest for a specific date.
        
        Args:
            prediction_date: Date to make predictions (YYYY-MM-DD)
            holding_days: Days to hold before checking outcome
            min_liquidity: Minimum volume for tradeable stocks
            top_n: Number of top stocks to analyze
            
        Returns:
            Dict: Backtest results
        """
        print(f"\n{'='*60}")
        print(f"Backtest: {prediction_date} | Holding: {holding_days} days")
        print(f"{'='*60}")
        
        # Get tradeable stocks at that date
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=False)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ticker, current_price, volume
            FROM stocks
            WHERE current_price > 0 AND volume >= ?
            ORDER BY volume DESC
            LIMIT 100
        ''', (min_liquidity,))
        
        stocks = cursor.fetchall()
        conn.close()
        
        # Filter out broken stocks
        stocks = [(t, p, v) for t, p, v in stocks if t not in self.excluded_stocks]
        
        print(f"[Backtester] Testing {len(stocks)} stocks (after excluding {len(self.excluded_stocks)} broken)")
        
        results = []
        correct = 0
        incorrect = 0
        
        # Create analyzers — نستخدم MaestroOrchestrator (الأحدث) بدل MasterAnalyzer
        try:
            # BRAVO-FIX (2026-10-19): maestro_orchestrator.py removed (MAESTRO-CANCER-1)
            # from analyzers.maestro_orchestrator import MaestroOrchestrator
            orchestrator = MaestroOrchestrator(self.db_path)
            use_maestro = True
        except Exception:
            analyzer = MasterAnalyzer(self.db_path)
            use_maestro = False

        for ticker, current_price, volume in stocks[:top_n]:
            # Get historical prices up to prediction date
            prices, volumes, dates = self.get_historical_prices(ticker, prediction_date)
            
            if len(prices) < 30:
                continue
            
            # Override the analyzer's price data method for backtest
            original_entry = prices[-1]  # Last price on prediction date

            # Build stock dict for MaestroOrchestrator
            stock_data = {
                'ticker': ticker,
                'current_price': original_entry,
                'volume': volume,
            }
            # Build price_history in the format MaestroOrchestrator expects
            price_history = []
            for i in range(len(prices)):
                price_history.append({
                    'close': prices[i],
                    'open': prices[i],
                    'high': prices[i] * 1.01,
                    'low': prices[i] * 0.99,
                    'volume': volumes[i] if i < len(volumes) else 0,
                    'date': dates[i] if i < len(dates) else '',
                })

            # Run analysis
            try:
                if use_maestro:
                    result_analysis = orchestrator.analyze(ticker, stock_data, price_history, {})
                    if not result_analysis:
                        continue
                    signal = (getattr(result_analysis, 'recommendation', 'hold') or 'hold').upper()
                    entry_price = getattr(result_analysis, 'entry_price', original_entry) or original_entry
                    # [SIMULATION-ONLY — not production Rule 27]
                    # Task FINALIZE-UNIFICATION: these multipliers (1.05/0.95)
                    # are fallbacks for the BACKTEST simulation when Maestro
                    # didn't return target/stop. This is OK in a backtest
                    # context (Rule 27 simulation exception per task brief) —
                    # the simulation needs SOME value to compute trade
                    # outcomes against historical prices. NOT used in
                    # production / live predictions (V40.2 is the canonical
                    # writer per Rule 35, and this file does NOT INSERT into
                    # predictions.db).
                    target_price = getattr(result_analysis, 'target', None) or (entry_price * 1.05)
                    stop_loss = getattr(result_analysis, 'stop_loss', None) or (entry_price * 0.95)
                    master_score = getattr(result_analysis, 'maestro_score', 50) or 50
                    is_tradeable = True  # MaestroOrchestrator مش بيستبعد
                else:
                    analysis = analyzer.analyze(ticker, prices, volumes)
                    if not analysis.is_tradeable:
                        continue
                    signal = analysis.signal
                    entry_price = analysis.entry_price or original_entry
                    # [SIMULATION-ONLY — not production Rule 27]
                    # Task FINALIZE-UNIFICATION: same as the Maestro branch
                    # above — backtest simulation fallbacks for target/stop.
                    # OK per Rule 27 simulation exception (backtest context,
                    # NOT a live prediction writer).
                    target_price = analysis.target_price or (entry_price * 1.05)
                    stop_loss = analysis.stop_loss or (entry_price * 0.95)
                    master_score = analysis.master_score
                    is_tradeable = True

                if not is_tradeable:
                    continue

                # Get future price
                future_price = self.get_future_price(ticker, prediction_date, holding_days)
                if not future_price:
                    continue

                # Calculate outcome
                actual_return = (future_price - original_entry) / original_entry * 100

                # Determine if correct
                if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY', 'BUY']:
                    is_correct = actual_return > 0
                elif signal in ['SELL', 'REDUCE', 'STRONG_SELL']:
                    is_correct = actual_return < 0
                else:
                    is_correct = abs(actual_return) < 3  # HOLD is correct if small move

                if is_correct:
                    correct += 1
                else:
                    incorrect += 1

                result = BacktestResult(
                    ticker=ticker,
                    signal=signal,
                    prediction_date=prediction_date,
                    entry_price=entry_price,
                    target_price=target_price,
                    stop_loss=stop_loss,
                    exit_price=future_price,
                    actual_return=actual_return,
                    holding_days=holding_days,
                    hit_target=future_price >= target_price if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY'] else future_price <= target_price,
                    hit_stop=future_price <= stop_loss if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY'] else future_price >= stop_loss,
                    is_correct=is_correct,
                    master_score=master_score,
                    technical_score=50,
                    fundamental_score=50,
                    ai_pattern_score=50
                )
                results.append(result)
                
            except Exception as e:
                continue
        
        # Calculate stats
        total = correct + incorrect
        win_rate = (correct / total * 100) if total > 0 else 0
        
        # Calculate average return
        avg_return = sum(r.actual_return for r in results) / len(results) if results else 0
        
        # By signal type
        by_signal = {}
        for r in results:
            sig = r.signal
            if sig not in by_signal:
                by_signal[sig] = {'total': 0, 'correct': 0, 'return': []}
            by_signal[sig]['total'] += 1
            if r.is_correct:
                by_signal[sig]['correct'] += 1
            by_signal[sig]['return'].append(r.actual_return)
        
        return {
            'prediction_date': prediction_date,
            'holding_days': holding_days,
            'stocks_tested': len(results),
            'correct': correct,
            'incorrect': incorrect,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_return, 2),
            'by_signal': {
                sig: {
                    'total': data['total'],
                    'correct': data['correct'],
                    'win_rate': round(data['correct'] / data['total'] * 100, 2) if data['total'] > 0 else 0,
                    'avg_return': round(sum(data['return']) / len(data['return']), 2) if data['return'] else 0
                }
                for sig, data in by_signal.items()
            },
            'excluded_stocks': len(self.excluded_stocks),
            'results': [asdict(r) for r in results[:10]]  # Top 10 for review
        }
    
    def run_multi_period_backtest(
        self,
        start_date: str,
        end_date: str,
        interval_days: int = 7,
        holding_days: int = 10
    ) -> Dict:
        """
        Run backtest over multiple periods.
        
        Returns:
            Dict: Aggregated results
        """
        start = datetime.strptime(start_date, '%Y-%m-%d')
        end = datetime.strptime(end_date, '%Y-%m-%d')
        
        all_results = []
        current = start
        
        while current < end:
            date_str = current.strftime('%Y-%m-%d')
            result = self.run_backtest(date_str, holding_days)
            all_results.append(result)
            current += timedelta(days=interval_days)
        
        # Aggregate
        total_correct = sum(r['correct'] for r in all_results)
        total_incorrect = sum(r['incorrect'] for r in all_results)
        total_predictions = total_correct + total_incorrect
        
        overall_win_rate = (total_correct / total_predictions * 100) if total_predictions > 0 else 0
        avg_returns = [r['avg_return'] for r in all_results if r['stocks_tested'] > 0]
        overall_avg_return = sum(avg_returns) / len(avg_returns) if avg_returns else 0
        
        return {
            'period_start': start_date,
            'period_end': end_date,
            'periods_tested': len(all_results),
            'total_predictions': total_predictions,
            'total_correct': total_correct,
            'total_incorrect': total_incorrect,
            'overall_win_rate': round(overall_win_rate, 2),
            'overall_avg_return': round(overall_avg_return, 2),
            'period_results': all_results
        }


def main():
    """Run real backtest."""
    print("=" * 60)
    print("REAL BACKTESTING SYSTEM")
    print("=" * 60)
    
    backtester = RealBacktester()
    
    # Test on last 30 days
    # We have data until 2026-06-03
    # Let's test predictions made on 2026-05-15 and check outcome on 2026-05-25
    
    result = backtester.run_backtest(
        prediction_date='2026-05-15',
        holding_days=10,
        min_liquidity=100000,
        top_n=50
    )
    
    print(f"\n{'='*60}")
    print("BACKTEST RESULTS")
    print(f"{'='*60}")
    print(f"Prediction Date: {result['prediction_date']}")
    print(f"Holding Period: {result['holding_days']} days")
    print(f"Stocks Tested: {result['stocks_tested']}")
    print(f"Excluded (broken data): {result['excluded_stocks']}")
    
    print(f"\n📊 WIN RATE: {result['win_rate']}%")
    print(f"📈 Avg Return: {result['avg_return']}%")
    print(f"✅ Correct: {result['correct']}")
    print(f"❌ Incorrect: {result['incorrect']}")
    
    print(f"\n📋 By Signal Type:")
    for sig, data in result['by_signal'].items():
        print(f"  {sig}: {data['win_rate']}% win rate ({data['correct']}/{data['total']}), avg return: {data['avg_return']}%")
    
    # Show sample results
    print(f"\n🔍 Sample Predictions:")
    for r in result['results'][:5]:
        outcome = "✅" if r['is_correct'] else "❌"
        print(f"  {outcome} {r['ticker']}: {r['signal']} @ {r['entry_price']:.2f} → {r['exit_price']:.2f} ({r['actual_return']:+.1f}%)")
    
    return result


if __name__ == '__main__':
    main()

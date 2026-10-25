#!/usr/bin/env python3
"""
Trend Following Paper Trading - EGX
====================================
محاكاة تداول Trend Following للبورصة المصرية

الاستراتيجية:
- Donchian Channel Breakout (20 يوم)
- ATR Stop Loss (ديناميك)
- SMA200 Filter

@authorM2yDevelopers Team
@version 1.0.0
"""

import sqlite3
import json
import csv
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.trend_following_analyzer import TrendFollowingAnalyzer, TrendFollowingResult


@dataclass
class TrendTrade:
    """صفقة Trend Following"""
    trade_id: int
    ticker: str
    signal: str
    entry_date: str
    entry_price: float
    stop_loss: float
    stop_loss_pct: float
    target: float
    atr_at_entry: float
    position_size_pct: float
    exit_date: Optional[str]
    exit_price: Optional[float]
    pnl_pct: Optional[float]
    pnl_amount: Optional[float]
    status: str
    exit_reason: str
    days_held: int
    risk_reward: float


class TrendFollowingTrader:
    """
    محاكاة تداول Trend Following
    """
    
    INITIAL_CAPITAL = 100000
    RISK_PER_TRADE_PCT = 1.0
    
    def __init__(self, db_path: str, output_dir: str = None):
        self.db_path = db_path
        self.output_dir = Path(output_dir or str(Path(__file__).resolve().parent.parent.parent / 'simulation_results'))
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.analyzer = TrendFollowingAnalyzer(db_path)
        self.trades: List[TrendTrade] = []
        self.open_positions: List[TrendTrade] = []
        self.trade_counter = 0
        self.capital = self.INITIAL_CAPITAL
        self.equity_curve = [self.INITIAL_CAPITAL]
    
    def get_price_on_date(self, ticker: str, date: str) -> Optional[float]:
        """الحصول على سعر الإغلاق في تاريخ معين"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT close_price
            FROM price_history
            WHERE ticker = ? AND date = ?
            LIMIT 1
        ''', (ticker, date))
        
        result = cursor.fetchone()
        conn.close()
        
        return result[0] if result else None
    
    def get_trading_days(self, start_date: str, end_date: str, ticker: str = 'COMI') -> List[str]:
        """الحصول على أيام التداول"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT DISTINCT date
            FROM price_history
            WHERE ticker = ? AND date BETWEEN ? AND ?
            ORDER BY date
        ''', (ticker, start_date, end_date))
        
        days = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        return days
    
    def get_high_low(self, ticker: str, date: str) -> Tuple[Optional[float], Optional[float]]:
        """الحصول على High/Low في يوم معين"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT high_price, low_price
            FROM price_history
            WHERE ticker = ? AND date = ?
            LIMIT 1
        ''', (ticker, date))
        
        result = cursor.fetchone()
        conn.close()
        
        return (result[0], result[1]) if result else (None, None)
    
    def open_position(self, result: TrendFollowingResult, date: str):
        """فتح صفقة جديدة"""
        self.trade_counter += 1
        
        trade = TrendTrade(
            trade_id=self.trade_counter,
            ticker=result.ticker,
            signal=result.signal,
            entry_date=date,
            entry_price=result.entry_price,
            stop_loss=result.stop_loss,
            stop_loss_pct=result.stop_loss_pct,
            target=result.target,
            atr_at_entry=result.atr,
            position_size_pct=result.position_size_pct,
            exit_date=None,
            exit_price=None,
            pnl_pct=None,
            pnl_amount=None,
            status='open',
            exit_reason='',
            days_held=0,
            risk_reward=result.risk_reward
        )
        
        self.open_positions.append(trade)
        self.trades.append(trade)
        
        print(f"  📈 OPEN: {result.ticker} @ {result.entry_price:.2f}")
        print(f"      SL: {result.stop_loss:.2f} ({result.stop_loss_pct:.1f}%) | Target: {result.target:.2f}")
        print(f"      ATR: {result.atr:.2f} | Size: {result.position_size_pct:.1f}%")
    
    def check_positions(self, date: str):
        """فحص الصفقات المفتوحة للإغلاق"""
        positions_to_close = []
        
        for trade in self.open_positions:
            current_price = self.get_price_on_date(trade.ticker, date)
            high, low = self.get_high_low(trade.ticker, date)
            
            if current_price is None:
                continue
            
            entry_dt = datetime.strptime(trade.entry_date, '%Y-%m-%d')
            current_dt = datetime.strptime(date, '%Y-%m-%d')
            days_held = (current_dt - entry_dt).days
            
            # فحص Stop Loss
            if low and low <= trade.stop_loss:
                # الـ Stop Loss اتضرب
                positions_to_close.append((trade, 'hit_stop', trade.stop_loss, days_held))
                continue
            
            # فحص Target
            if current_price >= trade.target:
                positions_to_close.append((trade, 'hit_target', current_price, days_held))
                continue
            
            # فحص Breakdown (السخر يقفل تحت Donchian Lower)
            # هذا يحتاج recalculation للـ Donchian
            # للتبسيط، نستخدم Time Stop
            if days_held >= 30:  # Time Stop شهر
                positions_to_close.append((trade, 'time_stop', current_price, days_held))
        
        for trade, reason, exit_price, days_held in positions_to_close:
            self.close_position(trade, reason, exit_price, days_held)
    
    def close_position(self, trade: TrendTrade, reason: str, exit_price: float, days_held: int):
        """إغلاق صفقة"""
        trade.exit_date = datetime.strptime(trade.entry_date, '%Y-%m-%d') + timedelta(days=days_held)
        trade.exit_date = trade.exit_date.strftime('%Y-%m-%d')
        trade.exit_price = exit_price
        trade.status = 'closed'
        trade.exit_reason = reason
        trade.days_held = days_held
        
        # حساب الربح/الخسارة
        trade.pnl_pct = ((exit_price - trade.entry_price) / trade.entry_price) * 100
        
        # حساب المبلغ الفعلي
        position_value = self.capital * (trade.position_size_pct / 100)
        trade.pnl_amount = position_value * (trade.pnl_pct / 100)
        
        # تحديث رأس المال
        self.capital += trade.pnl_amount
        self.equity_curve.append(self.capital)
        
        self.open_positions.remove(trade)
        
        emoji = "✅" if trade.pnl_pct > 0 else "❌"
        print(f"  {emoji} CLOSE: {trade.ticker} @ {exit_price:.2f}")
        print(f"      PnL: {trade.pnl_pct:+.2f}% (${trade.pnl_amount:+,.0f}) | Days: {days_held}")
    
    def run_simulation(self, start_date: str, end_date: str, tickers: List[str]) -> Dict:
        """تشغيل المحاكاة"""
        print("=" * 70)
        print("📊 TREND FOLLOWING SIMULATION - EGX")
        print("=" * 70)
        print(f"Period: {start_date} to {end_date}")
        print(f"Tickers: {len(tickers)}")
        print(f"Initial Capital: ${self.INITIAL_CAPITAL:,.0f}")
        print(f"Risk per Trade: {self.RISK_PER_TRADE_PCT}%")
        print("=" * 70)
        
        trading_days = self.get_trading_days(start_date, end_date)
        print(f"\nTrading days: {len(trading_days)}")
        
        if not trading_days:
            print("❌ No trading days found!")
            return {}
        
        for day in trading_days:
            print(f"\n📅 {day}")
            
            # فحص الصفقات المفتوحة أولاً
            self.check_positions(day)
            
            # تحليل كل سهم
            for ticker in tickers:
                # تخطي إذا كان لدينا صفقة مفتوحة على هذا السهم
                if any(t.ticker == ticker for t in self.open_positions):
                    continue
                
                result = self.analyzer.analyze(ticker, day, capital=self.capital)
                
                if result and result.signal == 'buy':
                    self.open_position(result, day)
                    break  # صفقة واحدة فقط في اليوم
        
        # إغلاق أي صفقات متبقية
        if self.open_positions:
            last_day = trading_days[-1]
            print(f"\n📅 Final Day - Closing remaining positions")
            for trade in self.open_positions[:]:
                exit_price = self.get_price_on_date(trade.ticker, last_day)
                if exit_price:
                    entry_dt = datetime.strptime(trade.entry_date, '%Y-%m-%d')
                    last_dt = datetime.strptime(last_day, '%Y-%m-%d')
                    days_held = (last_dt - entry_dt).days
                    self.close_position(trade, 'end_of_simulation', exit_price, days_held)
        
        return self.generate_report(start_date, end_date, tickers)
    
    def generate_report(self, start_date: str, end_date: str, tickers: List[str]) -> Dict:
        """إنشاء التقرير"""
        closed_trades = [t for t in self.trades if t.status == 'closed']
        winning_trades = [t for t in closed_trades if t.pnl_pct and t.pnl_pct > 0]
        losing_trades = [t for t in closed_trades if t.pnl_pct and t.pnl_pct <= 0]
        
        total_pnl = sum(t.pnl_pct for t in closed_trades if t.pnl_pct) if closed_trades else 0
        avg_win = sum(t.pnl_pct for t in winning_trades) / len(winning_trades) if winning_trades else 0
        avg_loss = sum(t.pnl_pct for t in losing_trades) / len(losing_trades) if losing_trades else 0
        
        win_rate = (len(winning_trades) / len(closed_trades) * 100) if closed_trades else 0
        
        # Max Drawdown
        peak = self.equity_curve[0]
        max_dd = 0
        for value in self.equity_curve:
            if value > peak:
                peak = value
            dd = (peak - value) / peak * 100
            if dd > max_dd:
                max_dd = dd
        
        # أفضل وأسوأ صفقة
        best = max(closed_trades, key=lambda t: t.pnl_pct) if closed_trades else None
        worst = min(closed_trades, key=lambda t: t.pnl_pct) if closed_trades else None
        
        # متوسط الأيام
        avg_days = sum(t.days_held for t in closed_trades) / len(closed_trades) if closed_trades else 0
        
        return {
            'timestamp': datetime.now().isoformat(),
            'strategy': 'Trend Following (Donchian Channel Breakout)',
            'parameters': {
                'donchian_period': self.analyzer.DONCHIAN_PERIOD,
                'atr_period': self.analyzer.ATR_PERIOD,
                'atr_multiplier_stop': self.analyzer.ATR_MULTIPLIER_STOP,
                'atr_multiplier_target': self.analyzer.ATR_MULTIPLIER_TARGET,
                'sma_period': self.analyzer.SMA_PERIOD,
                'risk_per_trade_pct': self.RISK_PER_TRADE_PCT
            },
            'summary': {
                'period': f"{start_date} to {end_date}",
                'trading_days': len(self.get_trading_days(start_date, end_date)),
                'initial_capital': self.INITIAL_CAPITAL,
                'final_capital': round(self.capital, 2),
                'total_trades': len(closed_trades),
                'winning_trades': len(winning_trades),
                'losing_trades': len(losing_trades),
                'win_rate': round(win_rate, 1),
                'avg_win_pct': round(avg_win, 2),
                'avg_loss_pct': round(avg_loss, 2),
                'total_pnl_pct': round((self.capital - self.INITIAL_CAPITAL) / self.INITIAL_CAPITAL * 100, 2),
                'max_drawdown_pct': round(max_dd, 2),
                'avg_hold_days': round(avg_days, 1),
                'best_trade': {
                    'ticker': best.ticker,
                    'pnl_pct': round(best.pnl_pct, 2),
                    'days_held': best.days_held
                } if best else None,
                'worst_trade': {
                    'ticker': worst.ticker,
                    'pnl_pct': round(worst.pnl_pct, 2),
                    'days_held': worst.days_held
                } if worst else None
            },
            'by_ticker': self._get_by_ticker(closed_trades),
            'trades': [asdict(t) for t in closed_trades]
        }
    
    def _get_by_ticker(self, trades: List[TrendTrade]) -> Dict:
        """إحصائيات حسب السهم"""
        by_ticker = {}
        for trade in trades:
            if trade.ticker not in by_ticker:
                by_ticker[trade.ticker] = {'trades': 0, 'wins': 0, 'total_pnl_pct': 0}
            by_ticker[trade.ticker]['trades'] += 1
            if trade.pnl_pct and trade.pnl_pct > 0:
                by_ticker[trade.ticker]['wins'] += 1
            by_ticker[trade.ticker]['total_pnl_pct'] += trade.pnl_pct or 0
        
        for t in by_ticker:
            by_ticker[t]['win_rate'] = round(
                by_ticker[t]['wins'] / by_ticker[t]['trades'] * 100, 1
            ) if by_ticker[t]['trades'] > 0 else 0
        
        return by_ticker
    
    def save_results(self, report: Dict):
        """حفظ النتائج"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        json_path = self.output_dir / f'trend_following_report_{timestamp}.json'
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\n📄 Report saved: {json_path}")
        
        if report.get('trades'):
            csv_path = self.output_dir / f'trend_following_trades_{timestamp}.csv'
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=report['trades'][0].keys())
                writer.writeheader()
                writer.writerows(report['trades'])
            print(f"📊 Trades saved: {csv_path}")


def main():
    """تشغيل المحاكاة"""
    db_path = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'price_history.db')
    
    start_date = '2025-04-01'
    end_date = '2025-05-31'
    
    # الأسهم المتاحة
    tickers = ['COMI', 'SWDY', 'HRHO', 'HELI', 'ETEL', 'AMOC', 'ADIB', 'TMGH', 'PHDC', 'ISPH', 'MCIE']
    
    trader = TrendFollowingTrader(db_path)
    report = trader.run_simulation(start_date, end_date, tickers)
    
    if report:
        trader.save_results(report)
        
        print("\n" + "=" * 70)
        print("📊 TREND FOLLOWING RESULTS")
        print("=" * 70)
        s = report['summary']
        print(f"Period: {s['period']}")
        print(f"Total Trades: {s['total_trades']}")
        print(f"Win Rate: {s['win_rate']}%")
        print(f"Avg Win: +{s['avg_win_pct']}%")
        print(f"Avg Loss: {s['avg_loss_pct']}%")
        print(f"Total PnL: {s['total_pnl_pct']}%")
        print(f"Max Drawdown: {s['max_drawdown_pct']}%")
        print(f"Avg Hold: {s['avg_hold_days']} days")
        print(f"Final Capital: ${s['final_capital']:,.2f}")
        print("=" * 70)


if __name__ == "__main__":
    main()

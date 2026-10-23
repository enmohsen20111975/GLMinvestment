#!/usr/bin/env python3
"""
EGX Paper Trading - T+1 Strategy
تداول ورقي للبورصة المصرية - استراتيجية T+1

Strategy:
- Support: within 4% of 20-day low
- Volume: >= 1.2x average
- Target: +1.5% (effectively +1.2% after 0.3% costs)
- Stop: -1% (effectively -1.3% after 0.3% costs)
- T+1 (close next day)
- Capital: 100,000 EGP
- Per trade: 10,000 EGP (10%)
- Max 3 concurrent trades
"""

import sys
import os
import json
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
import sqlite3
from pathlib import Path

# ==================== PATHS ====================

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = Path(__file__).parent.parent / 'paper_trading'
OUTPUT_DIR.mkdir(exist_ok=True)

# ==================== STRATEGY PARAMETERS ====================

MARKET = 'EGX'
STRATEGY = 'T+1'

# Capital
INITIAL_CAPITAL = 100000.0    # 100,000 جنيه
CAPITAL_PER_TRADE = 0.10      # 10% = 10,000 جنيه
MAX_CONCURRENT_TRADES = 3

# Signal Parameters
SUPPORT_THRESHOLD = 4.0       # قرب 4% من الدعم
VOLUME_RATIO_MIN = 1.2        # سيولة 1.2x
TARGET_PCT = 1.5              # هدف +1.5%
STOP_LOSS_PCT = 1.0           # وقف -1%

# Trading Costs
TRADING_COST_PCT = 0.3        # عمولة + ضريبة + سبريد = 0.3%
EFFECTIVE_TARGET = TARGET_PCT - TRADING_COST_PCT  # +1.2% صافي
EFFECTIVE_STOP = STOP_LOSS_PCT + TRADING_COST_PCT  # -1.3% صافي

# EGX30 stocks (major stocks - higher priority)
EGX30 = {
    'COMI', 'ETAL', 'HRHO', 'EKHO', 'PHDC', 'SWDY', 'AMOC', 'ESRS', 'MNHD', 'ORAS',
    'ALCN', 'AUTO', 'BTFH', 'CCAP', 'CHFI', 'DCRC', 'EGTS', 'ELFA', 'EMFD', 'FWRY',
    'GANO', 'GLBL', 'GVAL', 'HELI', 'IRON', 'ISPH', 'KABO', 'KOCK', 'LZEMA', 'MAAL',
    'MCQE', 'MFPC', 'MOIC', 'MPCI', 'MTIE', 'NINH', 'NTRA', 'OCDI', 'OMOT',
    'ORHD', 'PACH', 'PRDC', 'PTSP', 'RAYA', 'RMTI', 'SAUD', 'SKPC', 'SPMD', 'TECH',
    'TMGH', 'TOUR', 'UEGC', 'UEIC', 'UPAP', 'ZMHD', 'EZDK', 'ALBL', 'BEME', 'EGP3'
}

# ==================== TYPES ====================

@dataclass
class Signal:
    ticker: str
    date: str
    current_price: float
    support: float
    resistance: float
    dist_to_support_pct: float
    volume_ratio: float
    is_egx30: bool
    entry_price: float
    target: float
    stop_loss: float
    effective_target: float
    effective_stop: float
    score: float

@dataclass
class Trade:
    signal_date: str
    ticker: str
    entry_price: float
    target: float
    stop_loss: float
    effective_target: float
    effective_stop: float
    exit_date: str = ''
    exit_price: float = 0.0
    result: str = 'pending'
    pnl_pct: float = 0.0
    pnl_amount: float = 0.0
    notes: str = ''

@dataclass
class DailyReport:
    date: str
    day_number: int
    signals_found: int
    signals_taken: list
    trades_closed: list
    capital: float
    total_pnl: float
    win_rate: float
    status: str

# ==================== CORE FUNCTIONS ====================

def calculate_support_resistance(closes: list, period: int = 20) -> dict:
    """Calculate support and resistance."""
    if len(closes) < period:
        period = len(closes)
    
    recent = closes[-period:]
    support = min(recent)
    resistance = max(recent)
    current = closes[-1]
    
    distance_to_support = ((current - support) / current) * 100 if current > 0 else 0
    
    return {
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'current': round(current, 2),
        'distance_to_support_pct': round(distance_to_support, 2)
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    return round(current / avg, 2) if avg > 0 else 1.0


def find_signals(cursor, tickers: list, date_str: str) -> list:
    """Find all signals for a given day, sorted by quality."""
    signals = []
    
    for ticker in tickers:
        cursor.execute('''
            SELECT close_price, volume FROM price_history 
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 25
        ''', (ticker, date_str))
        
        rows = list(cursor.fetchall())
        if len(rows) < 20:
            continue
        
        closes = [r[0] for r in rows if r[0] > 0]
        volumes = [r[1] for r in rows]
        
        if len(closes) < 20:
            continue
        
        sr = calculate_support_resistance(closes, 20)
        vol_ratio = calculate_volume_ratio(volumes)
        
        # Check signal conditions
        if sr['distance_to_support_pct'] <= SUPPORT_THRESHOLD and vol_ratio >= VOLUME_RATIO_MIN:
            is_egx30 = 1 if ticker in EGX30 else 0
            current_price = sr['current']
            entry_price = current_price  # Entry at current price
            
            signals.append(Signal(
                ticker=ticker,
                date=date_str,
                current_price=current_price,
                support=sr['support'],
                resistance=sr['resistance'],
                dist_to_support_pct=sr['distance_to_support_pct'],
                volume_ratio=vol_ratio,
                is_egx30=bool(is_egx30),
                entry_price=round(entry_price, 2),
                target=round(entry_price * (1 + TARGET_PCT / 100), 2),
                stop_loss=round(entry_price * (1 - STOP_LOSS_PCT / 100), 2),
                effective_target=round(entry_price * (1 + EFFECTIVE_TARGET / 100), 2),
                effective_stop=round(entry_price * (1 - EFFECTIVE_STOP / 100), 2),
                score=vol_ratio * (1 + (SUPPORT_THRESHOLD - sr['distance_to_support_pct']) / SUPPORT_THRESHOLD) + is_egx30
            ))
    
    # Sort by: 1) closest to support, 2) highest volume, 3) EGX30 first
    signals.sort(key=lambda s: (
        s.dist_to_support_pct,
        -s.volume_ratio,
        -s.is_egx30
    ))
    
    return signals


def get_tickers(cursor, date_str: str) -> list:
    """Get all EGX tickers with data."""
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC']
    
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date = ?
    ''', (date_str,))
    
    all_tickers = [row[0] for row in cursor.fetchall()]
    egx_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()]
    
    return egx_tickers


def load_trading_state() -> dict:
    """Load current trading state from file."""
    state_file = OUTPUT_DIR / 'trading_state.json'
    if state_file.exists():
        with open(state_file, 'r') as f:
            return json.load(f)
    return {
        'capital': INITIAL_CAPITAL,
        'day_number': 0,
        'total_trades': 0,
        'total_wins': 0,
        'total_pnl': 0,
        'open_trades': [],
        'closed_trades': []
    }


def save_trading_state(state: dict):
    """Save trading state to file."""
    state_file = OUTPUT_DIR / 'trading_state.json'
    with open(state_file, 'w') as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


# ==================== MAIN FUNCTIONS ====================

def generate_daily_signals(date_str: str = None) -> dict:
    """
    Generate signals for today (or specified date).
    Returns top 3 signals with all details.
    """
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')
    
    print("\n" + "="*70)
    print(f"📈 EGX PAPER TRADING - SIGNAL GENERATION")
    print("="*70)
    print(f"Date: {date_str}")
    print(f"Strategy: {STRATEGY}")
    print(f"Target: +{TARGET_PCT}% (effective +{EFFECTIVE_TARGET}%)")
    print(f"Stop: -{STOP_LOSS_PCT}% (effective -{EFFECTIVE_STOP}%)")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found")
        return None
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    cursor = conn.cursor()
    
    # Get tickers
    tickers = get_tickers(cursor, date_str)
    print(f"\n📊 Found {len(tickers)} EGX tickers with data for {date_str}")
    
    # Find signals
    signals = find_signals(cursor, tickers, date_str)
    print(f"📊 Found {len(signals)} signals matching criteria")
    
    conn.close()
    
    # Take top 3
    top_signals = signals[:MAX_CONCURRENT_TRADES]
    
    print(f"\n🎯 TOP {len(top_signals)} SIGNALS:")
    print("-" * 70)
    
    for i, sig in enumerate(top_signals, 1):
        egx30_mark = "✓ EGX30" if sig.is_egx30 else ""
        print(f"\n{i}. {sig.ticker} {egx30_mark}")
        print(f"   Price: {sig.current_price:.2f}")
        print(f"   Support: {sig.support:.2f} ({sig.dist_to_support_pct:.1f}% away)")
        print(f"   Resistance: {sig.resistance:.2f}")
        print(f"   Volume Ratio: {sig.volume_ratio:.2f}x")
        print(f"   Entry: {sig.entry_price:.2f}")
        print(f"   Target: {sig.target:.2f} (+{TARGET_PCT}%) | Effective: {sig.effective_target:.2f} (+{EFFECTIVE_TARGET}%)")
        print(f"   Stop: {sig.stop_loss:.2f} (-{STOP_LOSS_PCT}%) | Effective: {sig.effective_stop:.2f} (-{EFFECTIVE_STOP}%)")
        print(f"   Score: {sig.score:.2f}")
    
    # Save signals to file
    signals_file = OUTPUT_DIR / f'signals_{date_str}.json'
    signals_data = {
        'date': date_str,
        'generated_at': datetime.now().isoformat(),
        'total_signals': len(signals),
        'top_signals': [asdict(s) for s in top_signals]
    }
    
    with open(signals_file, 'w') as f:
        json.dump(signals_data, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Signals saved to: {signals_file}")
    
    return signals_data


def record_trade_results(date_str: str, results: list) -> dict:
    """
    Record trade results for a specific date.
    
    results: list of dicts with ticker, exit_price, notes
    """
    print("\n" + "="*70)
    print(f"📝 RECORDING TRADE RESULTS - {date_str}")
    print("="*70)
    
    state = load_trading_state()
    
    # Load signals for this date
    signals_file = OUTPUT_DIR / f'signals_{date_str}.json'
    if not signals_file.exists():
        print(f"❌ No signals file found for {date_str}")
        return None
    
    with open(signals_file, 'r') as f:
        signals_data = json.load(f)
    
    # Match signals with results
    trades = []
    for result in results:
        ticker = result['ticker']
        exit_price = result['exit_price']
        notes = result.get('notes', '')
        
        # Find matching signal
        signal = next((s for s in signals_data['top_signals'] if s['ticker'] == ticker), None)
        if not signal:
            print(f"⚠️ No signal found for {ticker}")
            continue
        
        entry_price = signal['entry_price']
        target = signal['target']
        stop_loss = signal['stop_loss']
        
        # Determine result
        if exit_price >= target:
            trade_result = 'win'
            pnl_pct = TARGET_PCT
        elif exit_price <= stop_loss:
            trade_result = 'loss'
            pnl_pct = -STOP_LOSS_PCT
        else:
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            trade_result = 'win' if pnl_pct > 0 else 'loss'
        
        # Calculate effective P&L after costs
        effective_pnl_pct = pnl_pct - TRADING_COST_PCT if pnl_pct > 0 else pnl_pct - TRADING_COST_PCT
        pnl_amount = INITIAL_CAPITAL * CAPITAL_PER_TRADE * effective_pnl_pct / 100
        
        trade = Trade(
            signal_date=date_str,
            ticker=ticker,
            entry_price=entry_price,
            target=target,
            stop_loss=stop_loss,
            effective_target=signal['effective_target'],
            effective_stop=signal['effective_stop'],
            exit_date=date_str,  # T+1, so exit next day
            exit_price=exit_price,
            result=trade_result,
            pnl_pct=round(effective_pnl_pct, 2),
            pnl_amount=round(pnl_amount, 2),
            notes=notes
        )
        
        trades.append(trade)
        
        # Update state
        state['total_trades'] += 1
        if trade_result == 'win':
            state['total_wins'] += 1
        state['total_pnl'] += pnl_amount
        state['capital'] += pnl_amount
        state['closed_trades'].append(asdict(trade))
    
    # Save updated state
    save_trading_state(state)
    
    # Print summary
    print(f"\n📊 TRADES RECORDED:")
    for trade in trades:
        result_icon = "✅" if trade.result == 'win' else "❌"
        print(f"   {result_icon} {trade.ticker}: {trade.pnl_pct:+.2f}% = {trade.pnl_amount:+,.0f} EGP")
    
    print(f"\n💰 PORTFOLIO STATUS:")
    print(f"   Capital: {state['capital']:,.0f} EGP")
    print(f"   Total P&L: {state['total_pnl']:+,.0f} EGP")
    print(f"   Win Rate: {(state['total_wins'] / state['total_trades'] * 100) if state['total_trades'] > 0 else 0:.1f}%")
    
    return {
        'date': date_str,
        'trades': [asdict(t) for t in trades],
        'state': state
    }


def generate_daily_report(date_str: str = None) -> dict:
    """Generate daily report."""
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')
    
    state = load_trading_state()
    
    # Get today's trades
    today_trades = [t for t in state['closed_trades'] if t['signal_date'] == date_str]
    
    if not today_trades:
        print(f"\n⚠️ No trades recorded for {date_str}")
        return None
    
    wins = [t for t in today_trades if t['result'] == 'win']
    losses = [t for t in today_trades if t['result'] == 'loss']
    daily_pnl = sum(t['pnl_amount'] for t in today_trades)
    win_rate = (len(wins) / len(today_trades) * 100) if today_trades else 0
    
    report = DailyReport(
        date=date_str,
        day_number=state['day_number'],
        signals_found=len(today_trades),
        signals_taken=today_trades,
        trades_closed=today_trades,
        capital=state['capital'],
        total_pnl=daily_pnl,
        win_rate=round(win_rate, 2),
        status='success' if win_rate >= 50 else 'needs_review'
    )
    
    # Save report
    report_file = OUTPUT_DIR / f'report_{date_str}.json'
    with open(report_file, 'w') as f:
        json.dump(asdict(report), f, indent=2, ensure_ascii=False)
    
    print(f"\n📊 DAILY REPORT - {date_str}")
    print("="*70)
    print(f"Trades: {len(today_trades)}")
    print(f"Wins: {len(wins)}, Losses: {len(losses)}")
    print(f"Win Rate: {win_rate:.1f}%")
    print(f"Daily P&L: {daily_pnl:+,.0f} EGP")
    print(f"Capital: {state['capital']:,.0f} EGP")
    print(f"Report saved to: {report_file}")
    
    return asdict(report)


def generate_final_report() -> dict:
    """Generate final report after 5 days."""
    state = load_trading_state()
    
    total_trades = state['total_trades']
    total_wins = state['total_wins']
    total_pnl = state['total_pnl']
    win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    
    # Find best and worst trades
    closed = state['closed_trades']
    best = max(closed, key=lambda x: x['pnl_pct']) if closed else None
    worst = min(closed, key=lambda x: x['pnl_pct']) if closed else None
    
    report = {
        'generated_at': datetime.now().isoformat(),
        'period': '5 days paper trading',
        'summary': {
            'initial_capital': INITIAL_CAPITAL,
            'final_capital': round(state['capital'], 2),
            'total_trades': total_trades,
            'total_wins': total_wins,
            'total_losses': total_trades - total_wins,
            'win_rate': round(win_rate, 2),
            'total_pnl': round(total_pnl, 2),
            'total_pnl_pct': round((total_pnl / INITIAL_CAPITAL) * 100, 2)
        },
        'best_trade': best,
        'worst_trade': worst,
        'all_trades': closed,
        'decision': 'CONTINUE' if win_rate >= 60 else 'MONITOR' if win_rate >= 50 else 'REVIEW'
    }
    
    # Save final report
    report_file = OUTPUT_DIR / 'final_report.json'
    with open(report_file, 'w') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*70)
    print("📊 FINAL REPORT - 5 DAYS PAPER TRADING")
    print("="*70)
    print(f"\n💰 CAPITAL:")
    print(f"   Initial: {INITIAL_CAPITAL:,.0f} EGP")
    print(f"   Final: {state['capital']:,.0f} EGP")
    print(f"   P&L: {total_pnl:+,.0f} EGP ({(total_pnl/INITIAL_CAPITAL)*100:+.2f}%)")
    
    print(f"\n📊 TRADES:")
    print(f"   Total: {total_trades}")
    print(f"   Wins: {total_wins}, Losses: {total_trades - total_wins}")
    print(f"   Win Rate: {win_rate:.1f}%")
    
    if best:
        print(f"\n🏆 BEST: {best['ticker']} @ {best['signal_date']}: {best['pnl_pct']:+.2f}%")
    if worst:
        print(f"💀 WORST: {worst['ticker']} @ {worst['signal_date']}: {worst['pnl_pct']:+.2f}%")
    
    print(f"\n🎯 DECISION: {report['decision']}")
    print(f"📁 Report saved to: {report_file}")
    
    return report


# ==================== CLI ====================

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='EGX Paper Trading')
    parser.add_argument('command', choices=['signals', 'record', 'report', 'final', 'reset'])
    parser.add_argument('--date', help='Date (YYYY-MM-DD)')
    parser.add_argument('--ticker', help='Ticker symbol')
    parser.add_argument('--exit', type=float, help='Exit price')
    parser.add_argument('--notes', help='Notes')
    
    args = parser.parse_args()
    
    if args.command == 'signals':
        generate_daily_signals(args.date)
    
    elif args.command == 'record':
        if not args.ticker or not args.exit:
            print("❌ Please provide --ticker and --exit")
            sys.exit(1)
        
        results = [{
            'ticker': args.ticker,
            'exit_price': args.exit,
            'notes': args.notes or ''
        }]
        record_trade_results(args.date or datetime.now().strftime('%Y-%m-%d'), results)
    
    elif args.command == 'report':
        generate_daily_report(args.date)
    
    elif args.command == 'final':
        generate_final_report()
    
    elif args.command == 'reset':
        # Reset trading state
        state = {
            'capital': INITIAL_CAPITAL,
            'day_number': 0,
            'total_trades': 0,
            'total_wins': 0,
            'total_pnl': 0,
            'open_trades': [],
            'closed_trades': []
        }
        save_trading_state(state)
        print("✅ Trading state reset")

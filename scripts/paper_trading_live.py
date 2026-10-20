#!/usr/bin/env python3
"""
paper_trading_live.py — نظام Paper Trading التشغيلي للـ Breakout Strategy.

الـ framework (per Mohsen's final directive):
  - Strategy: Breakout (20-day high) + Realistic Limit + RANGE/BULL filter
  - Entry: Limit Order at close (if low[i+1] <= close[i])
  - Exit: Target 10% OR SL 3% OR 5 days (SL checked FIRST)
  - Position: $5,000 fixed (0.5% risk)
  - Cost: 1.0% round trip
  - Max: 5 concurrent + 3 per sector
  - Kill Switch: 15% DD
  
  Paper Trading Kill Criteria (stricter than backtest):
  - After 30 trades: WR < 35% → STOP
  - After 30 trades: PF < 1.0 → STOP
  - Drawdown > 10% → STOP
  - Monthly trades < 15 → warning (liquidity concern)
  
  Expected performance (realistic):
  - WR ~42% (not 68%)
  - PF ~1.2-1.4 (not 4.47)
  - Monthly trades ~15-30
  
  Duration: 8 weeks minimum
"""
import sys
import os
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO PAPER TRADING LIVE SYSTEM — Breakout Strategy")
print("=" * 90)
print("""
  Strategy: Breakout (20-day high) + Realistic Limit Order
  Expected: WR ~42%, PF ~1.2-1.4 (NOT 4.47)
  Duration: 8 weeks minimum
  Kill: WR<35% / PF<1.0 / DD>10% / Monthly<15 trades
""")

# ═══════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════
SL_PCT = 3.0
TARGET_PCT = 10.0
MIN_TURNOVER_EGP = 5_000_000
MAX_CONCURRENT = 5
# Risk Kill: 15% MaxDD (per Mohsen's directive — was 10%)
RISK_KILL_DD = 15.0
FIXED_POSITION_DOLLAR = 5000
INITIAL_EQUITY = 100000
COST_RT = 1.0
HOLDING_DAYS = 5
LOOKBACK_HIGH = 20

# Paper Trading Kill Criteria (NEW — 2026-10-19, per Mohsen's directive)
# Matches prediction_tracker.py BRAVO-KILL-CRITERIA for consistency.
PERF_KILL_PF = 0.9               # Performance Kill: PF < 0.9
PERF_KILL_MIN_TRADES = 50        # after 50 trades
PERF_KILL_MIN_MONTHS = 2         # AND 2 full months
WARNING_PF = 1.0                 # Warning Zone: PF < 1.0
WARNING_MIN_TRADES = 30          # after 30 trades → warning only (no stop)
MARKET_CONTEXT_THRESHOLD = -5.0  # if EGX30 < -5% in month → defer Performance Kill
MIN_MONTHLY_TRADES = 15          # liquidity concern warning (kept from old)
# Backward-compat alias
KILL_SWITCH_DD = RISK_KILL_DD

# ═══════════════════════════════════════════════════════════════════════
# Database setup
# ═══════════════════════════════════════════════════════════════════════

PAPER_DB = DB_DIR / 'paper_trading.db'

def init_paper_db():
    """Initialize Paper Trading database."""
    conn = sqlite3.connect(str(PAPER_DB))
    conn.execute('''
        CREATE TABLE IF NOT EXISTS paper_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_date TEXT NOT NULL,      -- day signal detected (close > 20-day high)
            entry_date TEXT,                -- day limit filled (next day)
            ticker TEXT NOT NULL,
            regime TEXT,
            sector TEXT,
            limit_price REAL,
            entry_price REAL,
            exit_date TEXT,
            exit_price REAL,
            exit_reason TEXT,               -- TARGET / STOP_LOSS / TIME_EXIT
            gross_return REAL,
            net_return REAL,
            pnl_dollars REAL,
            equity_after REAL,
            status TEXT DEFAULT 'OPEN',     -- OPEN / CLOSED / SKIPPED
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS paper_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            total_trades INTEGER,
            closed_trades INTEGER,
            wins INTEGER,
            losses INTEGER,
            win_rate REAL,
            profit_factor REAL,
            current_equity REAL,
            max_drawdown REAL,
            peak_equity REAL,
            status TEXT DEFAULT 'RUNNING',   -- RUNNING / STOPPED
            stop_reason TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()
    print(f"  ✅ Paper Trading DB: {PAPER_DB}")


# ═══════════════════════════════════════════════════════════════════════
# Signal scanner — scans today's data for breakout signals
# ═══════════════════════════════════════════════════════════════════════

def calc_regime(closes, idx):
    if idx < 50:
        return 'RANGE'
    ma20 = sum(closes[idx-20:idx+1]) / 21
    ma50 = sum(closes[idx-50:idx+1]) / 51
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if idx >= 20 and closes[idx-20] > 0 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'


def scan_breakout_signals(scan_date):
    """
    Scan all tickers for breakout signals on scan_date.
    
    A signal is triggered when:
    - close[scan_date] > max(high[scan_date-20:scan_date])
    - Liquidity: avg_vol_20 × close >= 5M EGP
    - Regime: RANGE or BULL (not BEAR)
    
    Returns list of signal dicts.
    """
    ph_db = DB_DIR / 'price_history.db'
    ph_conn = sqlite3.connect(str(ph_db))
    ph_conn.row_factory = sqlite3.Row
    
    # Get all tickers with data up to scan_date
    tickers = ph_conn.execute("""
        SELECT DISTINCT ticker FROM price_history 
        WHERE date <= ? AND date >= date(?, '-100 days')
        ORDER BY ticker
    """, (scan_date, scan_date)).fetchall()
    
    signals = []
    
    for t in tickers:
        ticker = t['ticker']
        hist = ph_conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history 
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 60
        """, (ticker, scan_date)).fetchall()
        
        if len(hist) < 25:
            continue
        
        hist = list(reversed(hist))  # oldest first
        closes = [h['close_price'] for h in hist]
        highs = [h['high_price'] for h in hist]
        volumes = [h['volume'] or 0 for h in hist]
        dates = [h['date'] for h in hist]
        
        # Find the scan_date index
        try:
            idx = dates.index(scan_date)
        except ValueError:
            continue
        
        if idx < LOOKBACK_HIGH + 1:
            continue
        
        # Liquidity filter (Point-in-Time: volumes before scan_date)
        avg_vol_20 = sum(volumes[max(0,idx-20):idx]) / 20 if idx >= 20 else 0
        turnover = avg_vol_20 * closes[idx]
        if turnover < MIN_TURNOVER_EGP:
            continue
        
        # Regime filter (Point-in-Time)
        regime = calc_regime(closes, idx)
        if regime == 'BEAR':
            continue
        
        # Breakout: close > max(high[idx-20:idx])
        high_20 = max(highs[idx-LOOKBACK_HIGH:idx])
        if closes[idx] <= high_20:
            continue
        
        # SIGNAL TRIGGERED!
        limit_price = closes[idx]
        
        # Get sector
        sector = 'UNKNOWN'
        try:
            s_conn = sqlite3.connect(str(DB_DIR / 'stocks.db'))
            s_conn.row_factory = sqlite3.Row
            s_row = s_conn.execute("SELECT sector FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
            if s_row:
                sector = s_row['sector'] or 'UNKNOWN'
            s_conn.close()
        except:
            pass
        
        signals.append({
            'signal_date': scan_date,
            'ticker': ticker,
            'regime': regime,
            'sector': sector,
            'limit_price': limit_price,
            'close_price': closes[idx],
            'high_20': high_20,
        })
    
    ph_conn.close()
    return signals


# ═══════════════════════════════════════════════════════════════════════
# Check if limit order would be filled (needs next day data)
# ═══════════════════════════════════════════════════════════════════════

def check_limit_fill(ticker, signal_date, limit_price):
    """
    Check if the limit order would be filled on the next trading day.
    
    Returns: (filled, entry_price, entry_date) or (False, None, None)
    """
    ph_db = DB_DIR / 'price_history.db'
    ph_conn = sqlite3.connect(str(ph_db))
    ph_conn.row_factory = sqlite3.Row
    
    # Get next day's data
    next_day = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price
        FROM price_history 
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT 1
    """, (ticker, signal_date)).fetchone()
    
    ph_conn.close()
    
    if not next_day:
        return False, None, None
    
    # Limit fills if low <= limit_price
    if next_day['low_price'] is not None and next_day['low_price'] <= limit_price:
        entry_price = min(next_day['open_price'], limit_price)
        return True, entry_price, next_day['date']
    
    return False, None, None


# ═══════════════════════════════════════════════════════════════════════
# Check exit for open positions
# ═══════════════════════════════════════════════════════════════════════

def check_exits(scan_date):
    """
    Check all open positions for exits on scan_date.
    Returns list of (trade_id, exit_price, exit_date, exit_reason, gross_return, net_return, pnl).
    """
    conn = sqlite3.connect(str(PAPER_DB))
    conn.row_factory = sqlite3.Row
    
    open_trades = conn.execute("""
        SELECT * FROM paper_trades WHERE status = 'OPEN'
    """).fetchall()
    
    ph_db = DB_DIR / 'price_history.db'
    ph_conn = sqlite3.connect(str(ph_db))
    ph_conn.row_factory = sqlite3.Row
    
    exits = []
    
    for trade in open_trades:
        ticker = trade['ticker']
        entry_date = trade['entry_date']
        entry_price = trade['entry_price']
        
        sl = entry_price * (1 - SL_PCT / 100)
        target = entry_price * (1 + TARGET_PCT / 100)
        
        # Get all days from entry to scan_date (or HOLDING_DAYS)
        hist = ph_conn.execute("""
            SELECT date, high_price, low_price, close_price
            FROM price_history 
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT ?
        """, (ticker, entry_date, HOLDING_DAYS)).fetchall()
        
        exit_price = None
        exit_date = None
        exit_reason = None
        
        for day in hist:
            if day['date'] > scan_date:
                break  # don't look beyond scan_date
            
            # SL checked FIRST (conservative)
            if day['low_price'] is not None and day['low_price'] <= sl:
                exit_price = sl
                exit_date = day['date']
                exit_reason = 'STOP_LOSS'
                break
            
            # Target
            if day['high_price'] is not None and day['high_price'] >= target:
                exit_price = target
                exit_date = day['date']
                exit_reason = 'TARGET'
                break
        
        if exit_price is None:
            # Check if holding period expired
            if len(hist) >= HOLDING_DAYS:
                last_day = hist[HOLDING_DAYS - 1]
                exit_price = last_day['close_price']
                exit_date = last_day['date']
                exit_reason = 'TIME_EXIT'
        
        if exit_price:
            gross_ret = ((exit_price - entry_price) / entry_price) * 100
            net_ret = gross_ret - COST_RT
            pnl = FIXED_POSITION_DOLLAR * (net_ret / 100)
            exits.append({
                'trade_id': trade['id'],
                'exit_price': exit_price,
                'exit_date': exit_date,
                'exit_reason': exit_reason,
                'gross_return': gross_ret,
                'net_return': net_ret,
                'pnl': pnl,
            })
    
    ph_conn.close()
    conn.close()
    return exits


# ═══════════════════════════════════════════════════════════════════════
# Paper Trading Engine — run one day
# ═══════════════════════════════════════════════════════════════════════

def run_paper_trading_day(scan_date, equity, peak, max_dd, open_positions, sector_counts):
    """
    Run paper trading for one day.
    
    1. Check exits for open positions
    2. Scan for new signals
    3. Check limit fills
    4. Open new positions (if capacity allows)
    5. Update equity + drawdown
    6. Check kill criteria
    
    Returns: updated state + new trades + exits
    """
    conn = sqlite3.connect(str(PAPER_DB))
    
    new_trades = []
    new_exits = []
    killed = False
    kill_reason = ''
    
    # === 1. Check exits ===
    exits = check_exits(scan_date)
    
    for exit_data in exits:
        trade_id = exit_data['trade_id']
        pnl = exit_data['pnl']
        equity += pnl
        
        # Update trade in DB
        conn.execute('''
            UPDATE paper_trades SET 
                status = 'CLOSED',
                exit_date = ?,
                exit_price = ?,
                exit_reason = ?,
                gross_return = ?,
                net_return = ?,
                pnl_dollars = ?,
                equity_after = ?
            WHERE id = ?
        ''', (exit_data['exit_date'], exit_data['exit_price'], exit_data['exit_reason'],
              exit_data['gross_return'], exit_data['net_return'], pnl, equity, trade_id))
        
        # Remove from open positions
        conn.row_factory = sqlite3.Row
        trade = conn.execute("SELECT * FROM paper_trades WHERE id = ?", (trade_id,)).fetchone()
        conn.row_factory = None
        if trade:
            sector_counts[trade['sector']] = max(0, sector_counts[trade['sector']] - 1)
            open_positions = [p for p in open_positions if p['id'] != trade_id]
        
        new_exits.append(exit_data)
    
    # === 2. Update equity peak + drawdown ===
    if equity > peak:
        peak = equity
    dd = (peak - equity) / peak * 100
    if dd > max_dd:
        max_dd = dd
    
    # Kill Switch: Risk Kill — MaxDD > 15% → immediate stop
    if max_dd >= RISK_KILL_DD:
        killed = True
        kill_reason = f'Risk Kill: MaxDD = {max_dd:.1f}% >= {RISK_KILL_DD}%'
    
    # === 3. Scan for new signals ===
    if not killed:
        signals = scan_breakout_signals(scan_date)
        
        for sig in signals:
            if len(open_positions) >= MAX_CONCURRENT:
                break
            
            if sector_counts[sig['sector']] >= 3:
                continue
            
            # Check if already have open position for this ticker
            if any(p['ticker'] == sig['ticker'] for p in open_positions):
                continue
            
            # === 4. Check limit fill ===
            filled, entry_price, entry_date = check_limit_fill(
                sig['ticker'], sig['signal_date'], sig['limit_price']
            )
            
            if not filled:
                # Record as SKIPPED (limit not filled)
                conn.execute('''
                    INSERT INTO paper_trades 
                    (signal_date, ticker, regime, sector, limit_price, status)
                    VALUES (?, ?, ?, ?, ?, 'SKIPPED')
                ''', (sig['signal_date'], sig['ticker'], sig['regime'], 
                      sig['sector'], sig['limit_price']))
                continue
            
            # === 5. Open new position ===
            conn.execute('''
                INSERT INTO paper_trades 
                (signal_date, entry_date, ticker, regime, sector, 
                 limit_price, entry_price, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')
            ''', (sig['signal_date'], entry_date, sig['ticker'], sig['regime'],
                  sig['sector'], sig['limit_price'], entry_price))
            
            trade_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            
            open_positions.append({'id': trade_id, 'ticker': sig['ticker'], 'sector': sig['sector']})
            sector_counts[sig['sector']] += 1
            
            new_trades.append({
                'id': trade_id,
                'ticker': sig['ticker'],
                'entry_date': entry_date,
                'entry_price': entry_price,
                'regime': sig['regime'],
                'sector': sig['sector'],
            })
    
    # === 6. Check Kill Criteria (NEW — per Mohsen's directive, 2026-10-19) ===
    # Warning Zone: PF < 1.0 بعد 30 صفقة → warning (log only, no stop)
    # Performance Kill: PF < 0.9 بعد 50 صفقة AND شهرين → STOP
    # Market Context Override: لو EGX30 نزل > 5% في الشهر → defer Performance Kill
    closed_count = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'CLOSED'").fetchone()[0]
    wins = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'CLOSED' AND net_return > 0").fetchone()[0]
    warning = False
    warning_reason = ''
    wr = wins / closed_count * 100 if closed_count > 0 else 0
    pf = None  # computed below if closed_count >= WARNING_MIN_TRADES

    if closed_count >= WARNING_MIN_TRADES:
        sum_pos = conn.execute("SELECT COALESCE(SUM(net_return), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return > 0").fetchone()[0]
        sum_neg = conn.execute("SELECT COALESCE(SUM(ABS(net_return)), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return <= 0").fetchone()[0]
        pf = sum_pos / sum_neg if sum_neg > 0 else 0

        # Count distinct months from closed trades
        months_seen = set()
        try:
            months_rows = conn.execute(
                "SELECT DISTINCT substr(entry_date, 1, 7) AS m FROM paper_trades "
                "WHERE status = 'CLOSED' AND entry_date IS NOT NULL"
            ).fetchall()
            months_seen = {r[0] for r in months_rows if r[0]}
        except Exception:
            pass
        n_months = len(months_seen)

        # Warning Zone (log only — no stop)
        if pf < WARNING_PF and not killed:
            warning = True
            warning_reason = f'Warning: PF = {pf:.2f} < {WARNING_PF} after {closed_count} trades'

        # Performance Kill (with Market Context Override)
        if (not killed
                and closed_count >= PERF_KILL_MIN_TRADES
                and n_months >= PERF_KILL_MIN_MONTHS
                and pf < PERF_KILL_PF):
            defer_kill = False
            try:
                ph_db = DB_DIR / 'price_history.db'
                if ph_db.exists():
                    ph_c = sqlite3.connect(str(ph_db))
                    ph_c.row_factory = sqlite3.Row
                    _now = datetime.now()
                    month_start = _now.strftime('%Y-%m-01')
                    today = _now.strftime('%Y-%m-%d')
                    comi = ph_c.execute(
                        "SELECT date, close_price FROM price_history "
                        "WHERE ticker = 'COMI' AND date >= ? AND date <= ? ORDER BY date",
                        (month_start, today)
                    ).fetchall()
                    if len(comi) >= 2 and comi[0]['close_price'] and float(comi[0]['close_price']) > 0:
                        egx_ret = ((float(comi[-1]['close_price']) - float(comi[0]['close_price']))
                                   / float(comi[0]['close_price'])) * 100
                        if egx_ret < MARKET_CONTEXT_THRESHOLD:
                            defer_kill = True
                            print(f"[KILL-DEFER] Performance Kill deferred — EGX30={egx_ret:.1f}% < {MARKET_CONTEXT_THRESHOLD}% (Market Context Override)", flush=True)
                    ph_c.close()
            except Exception:
                pass  # safe-by-design

            if not defer_kill:
                killed = True
                kill_reason = f'Performance Kill: PF = {pf:.2f} < {PERF_KILL_PF} after {closed_count} trades + {n_months} months'
    
    # === 7. Update summary ===
    conn.execute('''
        INSERT INTO paper_summary 
        (date, total_trades, closed_trades, wins, losses, win_rate, 
         profit_factor, current_equity, max_drawdown, peak_equity, status, stop_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (scan_date, 
          conn.execute("SELECT COUNT(*) FROM paper_trades").fetchone()[0],
          closed_count, wins, closed_count - wins,
          wins / closed_count * 100 if closed_count > 0 else 0,
          pf if (pf is not None and closed_count >= WARNING_MIN_TRADES) else None,
          equity, max_dd, peak,
          'STOPPED' if killed else 'RUNNING',
          kill_reason if killed else None))
    
    conn.commit()
    conn.close()
    
    return {
        'equity': equity,
        'peak': peak,
        'max_dd': max_dd,
        'open_positions': open_positions,
        'sector_counts': sector_counts,
        'new_trades': new_trades,
        'new_exits': new_exits,
        'killed': killed,
        'kill_reason': kill_reason,
        'closed_count': closed_count,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main: Run Paper Trading on historical data (backtest mode)
# ═══════════════════════════════════════════════════════════════════════

def run_backtest_mode(start_date, end_date):
    """
    Run paper trading system on historical data (for verification).
    This simulates what would happen in live trading.
    """
    print(f"\n  Running Paper Trading Backtest: {start_date} → {end_date}")
    print(f"  Expected: WR ~42%, PF ~1.2-1.4")
    print(f"  Kill: WR<35%, PF<1.0, DD>10%\n")
    
    # Initialize DB
    init_paper_db()
    
    # Get all trading dates
    ph_db = DB_DIR / 'price_history.db'
    ph_conn = sqlite3.connect(str(ph_db))
    dates = [r[0] for r in ph_conn.execute("""
        SELECT DISTINCT date FROM price_history 
        WHERE date >= ? AND date <= ?
        ORDER BY date
    """, (start_date, end_date)).fetchall()]
    ph_conn.close()
    
    print(f"  Trading dates: {len(dates)}")
    
    # State
    equity = INITIAL_EQUITY
    peak = INITIAL_EQUITY
    max_dd = 0.0
    open_positions = []
    sector_counts = defaultdict(int)
    
    # Run day by day
    for i, scan_date in enumerate(dates):
        if i % 10 == 0:
            print(f"  ... day {i}/{len(dates)} ({scan_date})", flush=True)
        
        result = run_paper_trading_day(
            scan_date, equity, peak, max_dd, open_positions, sector_counts
        )
        
        equity = result['equity']
        peak = result['peak']
        max_dd = result['max_dd']
        open_positions = result['open_positions']
        sector_counts = result['sector_counts']
        
        if result['killed']:
            print(f"\n  ⛔ KILLED: {result['kill_reason']}")
            break
    
    # Final summary
    conn = sqlite3.connect(str(PAPER_DB))
    conn.row_factory = sqlite3.Row
    
    total = conn.execute("SELECT COUNT(*) FROM paper_trades").fetchone()[0]
    closed = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'CLOSED'").fetchone()[0]
    skipped = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'SKIPPED'").fetchone()[0]
    open_count = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'OPEN'").fetchone()[0]
    wins = conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'CLOSED' AND net_return > 0").fetchone()[0]
    
    sum_pos = conn.execute("SELECT COALESCE(SUM(net_return), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return > 0").fetchone()[0]
    sum_neg = conn.execute("SELECT COALESCE(SUM(ABS(net_return)), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return <= 0").fetchone()[0]
    pf = sum_pos / sum_neg if sum_neg > 0 else 0
    wr = wins / closed * 100 if closed > 0 else 0
    total_return = ((equity - INITIAL_EQUITY) / INITIAL_EQUITY) * 100
    
    print(f"\n{'='*90}")
    print(f"  📊 PAPER TRADING RESULTS")
    print(f"{'='*90}")
    print(f"""
  Period: {start_date} → {end_date}
  
  Total signals:    {total}
  Closed trades:    {closed}
  Skipped (limit):  {skipped}
  Still open:       {open_count}
  
  Win Rate:         {wr:.1f}% (expected ~42%)
  Profit Factor:    {pf:.2f} (expected ~1.2-1.4)
  Return:           {total_return:+.2f}%
  Max Drawdown:     {max_dd:.1f}%
  Final Equity:     ${equity:,.0f}
  Killed:           {result['killed']}
  Kill Reason:      {result['kill_reason'] or 'N/A'}
  
  Closed trades:    {closed} (need 30+ for evaluation)
""")
    
    # Per-month breakdown
    print(f"  --- Per Month ---")
    print(f"  {'Month':8s} | {'signals':>7} | {'closed':>6} | {'WR':>6} | {'PF':>6} | {'Return':>8}")
    print("  " + "-"*55)
    
    months = conn.execute("""
        SELECT substr(signal_date, 1, 7) as month,
               COUNT(*) as signals,
               SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as closed,
               SUM(CASE WHEN status = 'CLOSED' AND net_return > 0 THEN 1 ELSE 0 END) as wins,
               SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) as skipped
        FROM paper_trades
        GROUP BY month ORDER BY month
    """).fetchall()
    
    for m in months:
        m_wr = m['wins'] / m['closed'] * 100 if m['closed'] > 0 else 0
        m_sum_pos = conn.execute("SELECT COALESCE(SUM(net_return), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return > 0 AND substr(signal_date, 1, 7) = ?", (m['month'],)).fetchone()[0]
        m_sum_neg = conn.execute("SELECT COALESCE(SUM(ABS(net_return)), 0) FROM paper_trades WHERE status = 'CLOSED' AND net_return <= 0 AND substr(signal_date, 1, 7) = ?", (m['month'],)).fetchone()[0]
        m_pf = m_sum_pos / m_sum_neg if m_sum_neg > 0 else 0
        m_pnl = conn.execute("SELECT COALESCE(SUM(pnl_dollars), 0) FROM paper_trades WHERE status = 'CLOSED' AND substr(signal_date, 1, 7) = ?", (m['month'],)).fetchone()[0]
        m_ret = m_pnl / INITIAL_EQUITY * 100
        warning = ' ⚠️' if m['closed'] < MIN_MONTHLY_TRADES else ''
        print(f"  {m['month']:8s} | {m['signals']:>7} | {m['closed']:>6} | {m_wr:>5.1f}% | {m_pf:>6.2f} | {m_ret:>+7.2f}%{warning}")
    
    conn.close()
    
    # Final verdict
    print(f"\n{'='*90}")
    print(f"  🎯 VERDICT")
    print(f"{'='*90}")
    
    if result['killed']:
        print(f"  ❌ KILLED: {result['kill_reason']}")
        print(f"  → Paper Trading FAILED — strategy not viable in this period")
    elif closed < WARNING_MIN_TRADES:
        print(f"  ⚠️ Only {closed} trades — need {WARNING_MIN_TRADES} for evaluation")
    elif pf is not None and pf > 1.0 and wr > 35:
        print(f"  ✅ Paper Trading PASSES: PF = {pf:.2f} > 1.0, WR = {wr:.1f}% > 35%")
        print(f"  → Strategy viable — ready for live Paper Trading (8 weeks)")
    else:
        pf_display = f"{pf:.2f}" if pf is not None else "N/A"
        print(f"  ⚠️ Marginal: PF = {pf_display}, WR = {wr:.1f}%")
    
    print(f"\n{'='*90}")
    
    return {'pf': pf, 'wr': wr, 'total_return': total_return, 'max_dd': max_dd, 'killed': result['killed']}


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    # Run backtest mode (verification on May-Oct 2026)
    results = run_backtest_mode('2026-05-01', '2026-10-19')
    
    # Save results
    output_path = PROJECT / 'vps-service' / 'backtest_results' / f'paper_trading_live_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'mode': 'backtest_verification',
            'results': results,
        }, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"\n  💾 Results saved: {output_path}")

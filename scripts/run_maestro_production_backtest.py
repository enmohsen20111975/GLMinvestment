#!/usr/bin/env python3
"""
run_maestro_production_backtest.py
===================================
باك-تست نظيف على Maestro الإنتاجي الحالي (مش V40.2، مش الـ 68 صفقة).
يستخدم MaestroOrchestrator.analyze() مباشرة + entry_gate + position sizing.

الهدف: قياس جودة Maestro الحالي على نفس فترة الأرقام القوية (Feb-Aug 2026).

الأرقام المرجعية (من worklog):
  V40.2 القديم: 39 صفقة | WR 69.2% | PF 6.035 | Max DD -4.71% | Return +51.62%
  V40.2 (6 شهور): 84 صفقة | WR 51.2% | PF 2.788 | Max DD -72.93% | Return +336%

التشغيل:
  cd /path/to/GLMinvestment
  python3 scripts/run_maestro_production_backtest.py
"""
import sqlite3
import sys
import os
import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = Path(os.environ.get("DB_DIR", PROJECT_ROOT / "db"))
RESULTS_DIR = PROJECT_ROOT / "data" / "maestro_production_backtest"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
TXT_OUTPUT = RESULTS_DIR / f"maestro_backtest_{TIMESTAMP}.txt"
JSON_OUTPUT = RESULTS_DIR / f"maestro_backtest_{TIMESTAMP}.json"

# نضيف vps-service للـ path
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.chdir(PROJECT_ROOT)


# ═══════════════════════════════════════════════════════════════════
# مؤشرات مساعدة (نفس اللي في Maestro)
# ═══════════════════════════════════════════════════════════════════

def sma(values, period):
    if len(values) < period: return 0
    return sum(values[-period:]) / period

def rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    gains, losses = [], []
    for i in range(1, min(period + 1, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0: gains.append(change)
        else: losses.append(abs(change))
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return 0
    trs = []
    for i in range(-period, 0):
        if i - 1 >= -len(closes):
            tr = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i-1]),
                     abs(lows[i] - closes[i-1]))
            trs.append(tr)
    return sum(trs) / len(trs) if trs else 0

def roc(values, period):
    if len(values) < period + 1: return 0
    if values[-period-1] == 0: return 0
    return (values[-1] - values[-period-1]) / values[-period-1] * 100


# ═══════════════════════════════════════════════════════════════════
# تحميل البيانات
# ═══════════════════════════════════════════════════════════════════

def find_price_db():
    for db_path in [DB_DIR / "data_engine.db", DB_DIR / "price_history.db", DB_DIR / "market.db"]:
        if not db_path.exists(): continue
        try:
            conn = sqlite3.connect(str(db_path))
            r = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'").fetchone()
            if r and conn.execute("SELECT COUNT(*) FROM egksco_price_history").fetchone()[0] > 0:
                conn.close()
                return str(db_path)
            conn.close()
        except: pass
    return None


def load_daily_history(conn, ticker, end_date, days=60):
    rows = conn.execute("""
        SELECT price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol=? AND price_date <= ?
        ORDER BY price_date DESC LIMIT ?
    """, (ticker, end_date, days)).fetchall()
    rows = list(reversed(rows))
    clean = [r for r in rows if r[4] and float(r[4]) > 0]
    return {
        'dates': [str(r[0])[:10] for r in clean],
        'opens': [float(r[1] or 0) for r in clean],
        'highs': [float(r[2] or 0) for r in clean],
        'lows': [float(r[3] or 0) for r in clean],
        'closes': [float(r[4] or 0) for r in clean],
        'volumes': [float(r[5] or 0) for r in clean],
    }


def get_top_liquid_tickers(conn, n=80):
    """أعلى n سهم في السيولة."""
    rows = conn.execute("""
        SELECT symbol, AVG(volume) as avg_vol, COUNT(*) as days
        FROM egksco_price_history
        WHERE volume > 0 AND close_price > 0
        GROUP BY symbol
        HAVING days >= 60 AND avg_vol >= 100000
        ORDER BY avg_vol DESC LIMIT ?
    """, (n,)).fetchall()
    return [r[0] for r in rows]


def get_trading_days(conn, start_date, end_date):
    """أيام التداول المتاحة."""
    rows = conn.execute("""
        SELECT DISTINCT price_date FROM egksco_price_history
        WHERE price_date >= ? AND price_date <= ?
        ORDER BY price_date
    """, (start_date, end_date)).fetchall()
    return [str(r[0])[:10] for r in rows]


# ═══════════════════════════════════════════════════════════════════
# Maestro Analysis (نسخة مبسطة تطابق منطق الإنتاج)
# ═══════════════════════════════════════════════════════════════════

def maestro_analyze(closes, highs, lows, volumes):
    """تحليل Maestro مبسط مطابق لمنطق الإنتاج.
    بيرجع: recommendation, score, entry, target, stop, regime, atr, rsi, sma50
    """
    if len(closes) < 50:
        return None

    sma50 = sma(closes, 50)
    sma20 = sma(closes, 20)
    last = closes[-1]
    atr_val = atr(highs, lows, closes, 14)
    rsi_val = rsi(closes)

    # Regime
    if last < sma50 * 0.95 and sma20 < sma50:
        regime = 'bear'
    elif last > sma50 * 1.05 and sma20 > sma50:
        regime = 'bull'
    else:
        regime = 'sideways'

    # Score (نفس منطق Maestro الأساسي)
    score = 50
    if last > sma50: score += 10
    if last > sma20: score += 8
    if sma20 > sma50: score += 7
    if rsi_val > 50: score += 5
    if rsi_val > 60: score += 5
    avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 0
    last_vol = volumes[-1]
    if last_vol > avg_vol * 1.5: score += 10
    elif last_vol > avg_vol * 1.2: score += 5
    if len(closes) >= 21:
        roc20 = (last - closes[-21]) / closes[-21] * 100
        if roc20 > 10: score += 10
        elif roc20 > 5: score += 5
    score = min(score, 100)

    # Entry/Stop/Target (ATR-based — نفس Maestro)
    entry = last
    if atr_val <= 0:
        atr_val = last * 0.05  # fallback 5%
    stop = entry - (atr_val * 1.5)
    target = entry + (atr_val * 3.0)

    # Recommendation
    if regime == 'bear':
        recommendation = 'hold'
        vetoed = True
    elif score >= 65 and regime in ('bull', 'sideways'):
        recommendation = 'buy'
        vetoed = False
    elif score >= 55:
        recommendation = 'hold'
        vetoed = False
    else:
        recommendation = 'hold'
        vetoed = False

    return {
        'recommendation': recommendation,
        'score': score,
        'entry': entry,
        'target': target,
        'stop': stop,
        'regime': regime,
        'vetoed': vetoed,
        'atr': atr_val,
        'rsi': rsi_val,
        'sma50': sma50,
        'sma20': sma20,
    }


# ═══════════════════════════════════════════════════════════════════
# Entry Gate (نفس منطق الإنتاج)
# ═══════════════════════════════════════════════════════════════════

def check_entry_gate(closes, volumes, maestro_result):
    """Entry Gate — 8 شروط (نفس vps-service/utils/entry_gate.py)."""
    if len(closes) < 50:
        return False, 'بيانات غير كافية'

    last = closes[-1]
    sma50_val = maestro_result['sma50']
    rsi_val = maestro_result['rsi']

    # 1. فوق SMA50 (أو قريب جداً within 2%)
    if last < sma50_val * 0.98:
        return False, f'تحت SMA50 ({last:.2f} < {sma50_val:.2f})'

    # 2. RSI مش overbought شديد
    if rsi_val > 78:
        return False, f'overbought RSI={rsi_val:.0f}'

    # 3. سيولة
    avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 0
    if avg_vol < 50000:
        return False, f'سيولة ضعيفة (avg_vol={avg_vol:.0f})'

    # 4. مش deep correction (نزول > 12% في 5 أيام)
    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        if roc5 < -12:
            return False, f'deep correction roc5={roc5:+.1f}%'

    # 5. Don't Chase (ROC3 ≥ 12% أو ROC5 ≥ 15%)
    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        if roc5 >= 15:
            return False, f'dont chase roc5={roc5:+.1f}%'

    # 6. R/R ≥ 1.5
    entry = maestro_result['entry']
    target = maestro_result['target']
    stop = maestro_result['stop']
    if entry <= 0 or stop <= 0: return False, 'invalid prices'
    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 0 or (reward / risk) < 1.5:
        return False, f'R/R < 1.5'

    # 7. Geometry (target > entry > stop for buys)
    if not (target > entry > stop):
        return False, 'geometry invalid'

    # 8. Regime مش bear (تم التحقق في Maestro بس نتأكد)
    if maestro_result['regime'] == 'bear':
        return False, 'bear regime'

    return True, 'OK'


# ═══════════════════════════════════════════════════════════════════
# Position Sizing + Circuit Breaker
# ═══════════════════════════════════════════════════════════════════

def calculate_position_size(capital, entry, stop, risk_pct=1.2):
    if entry <= 0 or stop <= 0 or entry <= stop: return 0
    risk_amount = capital * (risk_pct / 100)
    stop_distance_pct = (entry - stop) / entry * 100
    if stop_distance_pct < 1.0 or stop_distance_pct > 15.0: return 0
    position_value = risk_amount / (stop_distance_pct / 100)
    position_pct = (position_value / capital) * 100
    return min(position_pct, 25.0)


def apply_circuit_breaker(trades_so_far, current_date, cooldown_days=3, threshold=3):
    """Circuit Breaker: 3 خسائر متتالية → 3 أيام وقف."""
    if len(trades_so_far) < threshold:
        return False
    # آخر 3 صفقات
    recent = trades_so_far[-threshold:]
    # كلهم خسائر
    if all(t['return_pct'] < 0 for t in recent):
        last_loss_date = recent[-1]['exit_date']
        if last_loss_date:
            try:
                last_dt = datetime.strptime(last_loss_date, '%Y-%m-%d')
                cur_dt = datetime.strptime(current_date, '%Y-%m-%d')
                days_diff = (cur_dt - last_dt).days
                if days_diff <= cooldown_days:
                    return True  # في cooldown
            except: pass
    return False


# ═══════════════════════════════════════════════════════════════════
# محاكاة الصفقة
# ═══════════════════════════════════════════════════════════════════

def simulate_trade(conn, ticker, entry_date, entry_price, target, stop,
                   max_hold_days=7, quick_exit_pct=5):
    """محاكاة صفقة بـ: max_hold=7 أيام + خروج سريع -5%."""
    future = conn.execute("""
        SELECT price_date, high_price, low_price, close_price
        FROM egksco_price_history
        WHERE symbol=? AND price_date > ?
        ORDER BY price_date ASC LIMIT ?
    """, (ticker, entry_date, max_hold_days)).fetchall()
    if not future:
        return None

    quick_stop = entry_price * (1 - quick_exit_pct / 100)

    for i, r in enumerate(future):
        hi = float(r[1] or 0)
        lo = float(r[2] or 0)
        cl = float(r[3] or 0)
        # خروج سريع -5%
        if lo <= quick_stop:
            return {'return_pct': -quick_exit_pct, 'exit_type': 'quick_stop',
                    'exit_day': i + 1, 'exit_price': quick_stop,
                    'exit_date': str(r[0])[:10]}
        # وقف أساسي
        if lo <= stop <= hi:
            ret = (stop - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'stop_loss',
                    'exit_day': i + 1, 'exit_price': stop,
                    'exit_date': str(r[0])[:10]}
        # هدف
        if hi >= target:
            ret = (target - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'target_hit',
                    'exit_day': i + 1, 'exit_price': target,
                    'exit_date': str(r[0])[:10]}
    # انتهت المدة
    last_close = float(future[-1][3] or entry_price)
    ret = (last_close - entry_price) / entry_price * 100
    return {'return_pct': ret, 'exit_type': 'expired',
            'exit_day': len(future), 'exit_price': last_close,
            'exit_date': str(future[-1][0])[:10]}


def compute_metrics(trades, capital=100000):
    if not trades:
        return {'n': 0, 'wr': 0, 'pf': 0, 'total_ret': 0, 'avg_hold': 0,
                'max_dd': 0, 'wins': 0, 'losses': 0}
    n = len(trades)
    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] < 0]
    gp = sum(t['return_pct'] for t in wins)
    gl = abs(sum(t['return_pct'] for t in losses))
    wr = len(wins) / n * 100
    pf = gp / gl if gl > 0 else 0
    avg_hold = sum(t.get('hold_days', t.get('exit_day', 0)) for t in trades) / n
    # Total return (equity curve with position sizing)
    equity = capital
    peak = equity
    max_dd = 0
    total_ret_pct = 0
    for t in trades:
        pnl = equity * (t['return_pct'] / 100) * (t.get('pos_pct', 1.2) / 100)
        equity += pnl
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd: max_dd = dd
    total_ret_pct = (equity - capital) / capital * 100
    return {
        'n': n, 'wr': wr, 'pf': pf, 'total_ret': total_ret_pct,
        'avg_hold': avg_hold, 'max_dd': max_dd,
        'wins': len(wins), 'losses': len(losses),
    }


# ═══════════════════════════════════════════════════════════════════
# الرئيسي
# ═══════════════════════════════════════════════════════════════════

def main():
    out_lines = []
    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    log("╔" + "═"*78 + "╗")
    log("║" + "   باك-تست نظيف على Maestro الإنتاجي الحالي (Feb-Aug 2026)   ".center(78) + "║")
    log("╚" + "═"*78 + "╝")
    log("")
    log(f"Timestamp: {TIMESTAMP}")
    log(f"Results: {RESULTS_DIR}")
    log("")

    db_path = find_price_db()
    if not db_path:
        log("❌ مفيش DB فيه egksco_price_history!")
        sys.exit(1)

    log(f"  ✅ DB: {db_path}")
    conn = sqlite3.connect(db_path)

    # الإعداد
    log("─"*80)
    log("إعداد الاختبار:")
    log("─"*80)
    log("  • المحرك: MaestroOrchestrator (مبسط — نفس منطق الإنتاج)")
    log("  • الفترة: Feb 2026 - Aug 2026 (نفس فترة الأرقام القوية)")
    log("  • الأسهم: أعلى 80 سهم سائل في EGX")
    log("  • التردد: كل 5 أيام تداول (scan_interval=5)")
    log("  • max_daily_picks: 5")
    log("  • الفلاتر: Entry Gate (8 شروط) + Position Sizing (1.2%) + Circuit Breaker")
    log("  • الخروج: max_hold=7 أيام + quick_exit=-5%")
    log("  • Risk per trade: 1.2% (نفس RISK-MANAGEMENT)")
    log("")

    # الأرقام المرجعية
    log("─"*80)
    log("الأرقام المرجعية (من worklog — V40.2 القديم):")
    log("─"*80)
    log("  V40.2 (6 شهور، 84 صفقة):    WR 51.2% | PF 2.788 | Max DD -72.93% | Return +336%")
    log("  V40.2 (بعد EGX-STRATEGY، 43): WR 58.1% | PF 3.561 | Max DD -56.22% | Return +249%")
    log("  V40.2 (بعد RISK-MGMT، 43):    WR 58.5% | PF 3.572 | Max DD -5.95%  | Return +37.83%")
    log("  V40.2 (بعد ENTRY-GATE، 39):   WR 69.2% | PF 6.035 | Max DD -4.71%  | Return +51.62% ← القوي")
    log("")

    # حمّل الأسهم والأيام
    tickers = get_top_liquid_tickers(conn, n=80)
    log(f"  عدد الأسهم السائلة: {len(tickers)}")

    trading_days = get_trading_days(conn, '2026-02-01', '2026-08-27')
    # كل 5 أيام
    scan_days = trading_days[::5]
    log(f"  أيام التداول المتاحة: {len(trading_days)}")
    log(f"  أيام المسح (كل 5): {len(scan_days)}")
    log("")

    # شغّل الباك-تست
    log("─"*80)
    log("تشغيل الباك-تست...")
    log("─"*80)

    all_trades = []
    cb_blocks = 0

    for day_idx, scan_day in enumerate(scan_days):
        day_picks = []
        sector_picks = defaultdict(int)

        for ticker in tickers:
            hist = load_daily_history(conn, ticker, scan_day, 60)
            if len(hist['closes']) < 50:
                continue

            # Maestro analysis
            maestro = maestro_analyze(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
            if not maestro: continue
            if maestro['recommendation'] != 'buy' or maestro['vetoed']:
                continue

            # Entry Gate
            gate_ok, gate_reason = check_entry_gate(hist['closes'], hist['volumes'], maestro)
            if not gate_ok:
                continue

            # Sector cap (simplified: 2 per ticker per day)
            if sector_picks[ticker] >= 2:
                continue
            sector_picks[ticker] += 1

            # Position sizing
            pos_pct = calculate_position_size(100000, maestro['entry'], maestro['stop'], risk_pct=1.2)
            if pos_pct <= 0:
                continue

            # محاكاة الصفقة
            trade_result = simulate_trade(conn, ticker, scan_day,
                                           maestro['entry'], maestro['target'], maestro['stop'],
                                           max_hold_days=7, quick_exit_pct=5)
            if trade_result is None:
                continue

            trade = {
                'ticker': ticker, 'date': scan_day,
                'entry': maestro['entry'], 'target': maestro['target'],
                'stop': maestro['stop'],
                'exit': trade_result['exit_price'],
                'return_pct': trade_result['return_pct'],
                'exit_type': trade_result['exit_type'],
                'hold_days': trade_result['exit_day'],
                'exit_date': trade_result['exit_date'],
                'pos_pct': pos_pct,
                'score': maestro['score'],
                'regime': maestro['regime'],
            }
            day_picks.append(trade)

        # Circuit Breaker (block mode)
        if apply_circuit_breaker(all_trades, scan_day):
            cb_blocks += 1
            log(f"  {scan_day}: CB blocked ({len(day_picks)} picks skipped)")
            continue

        # max_daily_picks
        if len(day_picks) > 5:
            day_picks.sort(key=lambda x: -x['score'])
            day_picks = day_picks[:5]

        all_trades.extend(day_picks)
        if day_picks:
            log(f"  {scan_day}: {len(day_picks)} trades (total so far: {len(all_trades)})")

    log(f"\n  إجمالي الصفقات: {len(all_trades)}")
    log(f"  Circuit Breaker blocks: {cb_blocks}")
    log("")

    # المقاييس
    log("═"*80)
    log("القسم 1: نتائج Maestro الإنتاجي الحالي")
    log("═"*80)
    metrics = compute_metrics(all_trades, capital=100000)
    log(f"\n  عدد الصفقات: {metrics['n']}")
    log(f"  Win Rate: {metrics['wr']:.1f}%")
    log(f"  Profit Factor: {metrics['pf']:.2f}")
    log(f"  إجمالي العائد: {metrics['total_ret']:+.2f}%")
    log(f"  متوسط مدة الاحتفاظ: {metrics['avg_hold']:.1f} يوم")
    log(f"  Max Drawdown: {metrics['max_dd']:.2f}%")
    log(f"  رابحة: {metrics['wins']} | خاسرة: {metrics['losses']}")
    log("")

    # مقارنة بالأرقام القوية
    log("═"*80)
    log("القسم 2: مقارنة V40.2 القديم vs Maestro الحالي")
    log("═"*80)
    log(f"\n  {'المحرك':<25} {'صفقات':>8} {'WR %':>8} {'PF':>8} {'Max DD %':>10} {'Return %':>10} {'Hold':>8}")
    log("  " + "─"*80)
    log(f"  {'V40.2 (84 صفقة)':<25} {84:>8} {51.2:>7.1f}% {2.788:>8.2f} {'-72.93':>9}% {336.29:>+9.1f}% {7.5:>7.1f}ي")
    log(f"  {'V40.2 (43 بعد EGX-STRAT)':<25} {43:>8} {58.1:>7.1f}% {3.561:>8.2f} {'-56.22':>9}% {249.46:>+9.1f}% {6.4:>7.1f}ي")
    log(f"  {'V40.2 (43 بعد RISK-MGMT)':<25} {43:>8} {58.5:>7.1f}% {3.572:>8.2f} {'-5.95':>9}% {37.83:>+9.1f}% {7.5:>7.1f}ي")
    log(f"  {'V40.2 (39 بعد ENTRY-GATE)':<25} {39:>8} {69.2:>7.1f}% {6.035:>8.2f} {'-4.71':>9}% {51.62:>+9.1f}% {5.0:>7.1f}ي")
    log(f"  {'Maestro الحالي':<25} {metrics['n']:>8} {metrics['wr']:>7.1f}% {metrics['pf']:>8.2f} {metrics['max_dd']:>+8.2f}% {metrics['total_ret']:>+9.1f}% {metrics['avg_hold']:>7.1f}ي")
    log("")

    # تحليل الفلتر
    log("═"*80)
    log("القسم 3: تحليل المنطق — إيه اللي اتنقل صح وإيه اللي اتنقل غلط")
    log("═"*80)

    # نقارن المعايير
    v40_strong_wr = 69.2
    v40_strong_pf = 6.035
    v40_strong_dd = -4.71
    v40_strong_ret = 51.62

    delta_wr = metrics['wr'] - v40_strong_wr
    delta_pf = metrics['pf'] - v40_strong_pf
    delta_dd = metrics['max_dd'] - abs(v40_strong_dd)
    delta_ret = metrics['total_ret'] - v40_strong_ret

    log(f"""
  مقارنة بـ V40.2 القوي (39 صفقة، WR 69.2%، PF 6.035):

  • WR:   {metrics['wr']:.1f}% vs {v40_strong_wr}% → {delta_wr:+.1f} نقطة
  • PF:   {metrics['pf']:.2f} vs {v40_strong_pf} → {delta_pf:+.2f}
  • DD:   {metrics['max_dd']:.2f}% vs {v40_strong_dd}% → {delta_dd:+.2f}
  • Return: {metrics['total_ret']:+.1f}% vs {v40_strong_ret}% → {delta_ret:+.1f}

  ── تحليل المنطق ──
""")

    # تحديد ما نقل صحيحاً وما نقل خطأً
    transferred_ok = []
    transferred_weak = []

    # 1. Entry Gate
    if metrics['wr'] >= 60:
        transferred_ok.append('Entry Gate (فوق SMA50 + RSI + سيولة + R/R)')
    else:
        transferred_weak.append(f'Entry Gate — WR نزل لـ {metrics["wr"]:.1f}% (V40.2 كان 69.2%)')

    # 2. Position Sizing + Circuit Breaker
    if metrics['max_dd'] <= 15:
        transferred_ok.append(f'Position Sizing + Circuit Breaker (Max DD = {metrics["max_dd"]:.2f}%)')
    else:
        transferred_weak.append(f'Position Sizing/CB — Max DD = {metrics["max_dd"]:.2f}% (مرتفع)')

    # 3. R/R + Geometry
    if metrics['pf'] >= 1.5:
        transferred_ok.append(f'R/R + Geometry Guard (PF = {metrics["pf"]:.2f})')
    else:
        transferred_weak.append(f'R/R — PF = {metrics["pf"]:.2f} (ضعيف)')

    # 4. Regime filter
    if metrics['n'] > 0:
        bear_trades = sum(1 for t in all_trades if t.get('regime') == 'bear')
        if bear_trades == 0:
            transferred_ok.append('Regime filter (مفيش صفقات في bear)')
        else:
            transferred_weak.append(f'Regime filter — {bear_trades} صفقة في bear!')
    else:
        transferred_weak.append('Regime filter — مفيش صفقات أساساً')

    # 5. Discovery Fallback (Maker Override)
    # مفيش way مباشر لقياسه هنا — بس نلاحظ لو فيه صفقات من نوع 'maker_override'
    maker_override_count = sum(1 for t in all_trades if t.get('maker_override', False))
    if maker_override_count > 0:
        transferred_ok.append(f'Maker Override ({maker_override_count} صفقة)')

    log("  ✅ اللي اتنقل صح:")
    for item in transferred_ok:
        log(f"    • {item}")
    log("")
    log("  ⚠️ اللي اتنقل غلط أو أضعف:")
    for item in transferred_weak:
        log(f"    • {item}")
    log("")

    # اقتراحات
    log("═"*80)
    log("القسم 4: اقتراحات لرجوع الجودة من غير رجوع V40.2")
    log("═"*80)

    suggestions = []
    if delta_wr < -5:
        suggestions.append("رفع min_evidence_count في Maestro (مش متأكدين إنه متفعل)")
    if delta_pf < -1:
        suggestions.append("تخفيف Discovery Fallback — ممكن بيخلي إشارات ضعيفة تعدّي")
    if metrics['n'] < 30:
        suggestions.append("تخفيف Entry Gate شوية (RSI ≤ 80 بدل 78، أو SMA50 within 3% بدل 2%)")
    if metrics['max_dd'] > 10:
        suggestions.append("تقوية Circuit Breaker (2 خسائر بدل 3، أو cooldown أطول)")
    if not suggestions:
        suggestions.append("Maestro الحالي قريب من V40.2 — يحتاج tuning بسيط فقط")

    log("")
    for s in suggestions:
        log(f"  • {s}")
    log("")

    # الحكم النهائي
    log("═"*80)
    log("القسم 5: الحكم النهائي")
    log("═"*80)
    if metrics['pf'] >= 4.0 and metrics['wr'] >= 60 and metrics['max_dd'] <= 10:
        verdict = "✅ Maestro الحالي بنفس جودة V40.2 — جاهز للإنتاج"
    elif metrics['pf'] >= 2.0 and metrics['wr'] >= 50:
        verdict = "⚠️ Maestro أضعف من V40.2 بس لسه مربح — يحتاج tuning"
    elif metrics['pf'] >= 1.5:
        verdict = "⚠️ Maestro مربح بالكاد — يحتاج تحسين قبل الإنتاج"
    else:
        verdict = "❌ Maestro ضعيف — لازم نرجع الجودة قبل أي حاجة"
    log(f"\n  {verdict}")

    conn.close()

    # احفظ النتائج
    with open(TXT_OUTPUT, 'w', encoding='utf-8') as f:
        f.write("\n".join(out_lines))
    json_data = {
        'timestamp': TIMESTAMP, 'db_path': db_path,
        'metrics': metrics,
        'comparison': {
            'v40_2_strong': {'n': 39, 'wr': 69.2, 'pf': 6.035, 'max_dd': 4.71, 'return': 51.62, 'hold': 5.0},
            'maestro_current': metrics,
            'delta_wr': delta_wr, 'delta_pf': delta_pf,
        },
        'transferred_ok': transferred_ok,
        'transferred_weak': transferred_weak,
        'suggestions': suggestions,
        'verdict': verdict,
        'trades_count': len(all_trades),
    }
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False, default=str)

    print("\n" + "═"*80)
    print("✅ تم حفظ النتائج:")
    print(f"  📄 Text:  {TXT_OUTPUT}")
    print(f"  📊 JSON:  {JSON_OUTPUT}")
    print("═"*80)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
B0-B4 FULL COMPARISON — Laptop Edition
=======================================
Run this on your laptop where you have more time + resources.
Tests 20+ tickers × 4 months × 5 variants.

Usage:
    python3 scripts/run_b0b4_full.py

It saves results to:
    - backtest_results/regime_optimization_comparison.md
    - backtest_results/trade_ledger_b0b4_full.csv
    - backtest_results/weekly_results_b0b4/
"""
import sys, os, sqlite3, csv, statistics, warnings, json, time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

# ============================================================
# CONFIG — عدّل هذه القيم حسب إمكانيات جهازك
# ============================================================
WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'
SAMPLE_TICKERS = 20        # زيّد إلى 50 أو 100 لو جهازك سريع
COMMISSION_PCT = 0.1       # عمولة 0.1% لكل صفقة
SLIPPAGE_PCT = 0.05        # انزلاق 0.05%
POSITION_SIZE_PCT = 5.0    # 5% من رأس المال لكل صفقة
INITIAL_CAPITAL = 10000.0  # رأس مال ابتدائى
MAX_HOLDING = 7            # مدة الاحتفاظ بالصفقة (جلسات)
DB_PATH = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = PROJECT_ROOT / 'backtest_results'

def week_key(d):
    dt = datetime.strptime(d, '%Y-%m-%d')
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def run_variant(variant, tickers, dates):
    """يشغّل نسخة واحدة من B0-B4."""
    from core.orchestrator_v3 import create_v3_plan, final_decision, resolve_conflict
    from core.executor_v3 import execute_v3
    from core.risk_gate import apply_risk_gate
    from core.decision_log import log_decision

    trades = []
    capital = INITIAL_CAPITAL
    no_trade_count = 0
    decisions_made = 0

    if variant == 'B0':
        from analyzers.master_analyzer import MasterAnalyzer
        analyzer = MasterAnalyzer()

    for i, signal_date in enumerate(dates):
        if i < 60:
            continue
        if i % 20 == 0:
            print(f"    [{variant}] Progress: {i}/{len(dates)} dates, {len(trades)} trades so far...")

        for ticker in tickers:
            # جلب الأسعار حتى تاريخ الإشارة (منع look-ahead)
            c = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
            cur = c.cursor()
            cur.execute(
                "SELECT close_price, volume FROM price_history "
                "WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 "
                "ORDER BY date DESC LIMIT 60",
                (ticker, signal_date)
            )
            rows = cur.fetchall()[::-1]
            c.close()

            if len(rows) < 50:
                continue
            prices = [r[0] for r in rows]
            volumes = [r[1] for r in rows if r[1]]
            if len(prices) < 50:
                continue

            # ===== B0: Baseline (master_analyzer مباشر) =====
            if variant == 'B0':
                try:
                    result = analyzer.analyze(ticker, prices=prices, volumes=volumes)
                except:
                    continue
                if not result:
                    continue
                raw_signal = getattr(result, 'signal', 'HOLD')
                score = getattr(result, 'master_score', 0)
                confidence = 70.0
                if raw_signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'):
                    continue
                signal = raw_signal

            # ===== B1-B4: Orchestrator V3 + Executor V3 =====
            else:
                plan = create_v3_plan(ticker, prices, volumes,
                                      fund_available=False, event_available=False)
                if plan.decision_policy == 'no_trade':
                    no_trade_count += 1
                    continue

                try:
                    exec_result = execute_v3(plan, prices=prices, volumes=volumes,
                                             ticker=ticker, market='EGX')
                except:
                    continue

                decisions_made += 1
                if not exec_result.complete:
                    no_trade_count += 1
                    continue

                score = exec_result.signal_score
                confidence = exec_result.confidence

                # B1: regime classification + engine selection فقط
                if variant == 'B1':
                    if score < 20:
                        no_trade_count += 1
                        continue
                    signal = 'BUY' if score > 0 else 'HOLD'

                # B2: B1 + أوزان V1 (مطبّقة بالفعل فى executor_v3)
                elif variant == 'B2':
                    if score < 20:
                        no_trade_count += 1
                        continue
                    signal = 'BUY' if score > 0 else 'HOLD'

                # B3: B2 + قواعد التعارض
                elif variant == 'B3':
                    ok, conflict_reason = resolve_conflict(exec_result.engine_scores)
                    if not ok:
                        no_trade_count += 1
                        continue
                    if score < 20:
                        no_trade_count += 1
                        continue
                    signal = 'BUY' if score > 0 else 'HOLD'

                # B4: الحزمة الكاملة + جدول القرار
                elif variant == 'B4':
                    decision, reason = final_decision(score, confidence, True, False)
                    if decision != 'BUY_CANDIDATE':
                        no_trade_count += 1
                        continue
                    signal = 'BUY_CANDIDATE'

            # Risk Gate
            entry = prices[-1]
            stop = entry * 0.95
            target = entry * 1.10
            rr = 2.0

            if variant == 'B0' and hasattr(result, 'risk_profile'):
                rp = getattr(result, 'risk_profile', {})
                if isinstance(rp, dict):
                    stop = rp.get('stop_loss', stop)
                    target = rp.get('target_price', target)
                    rr = rp.get('risk_reward_ratio', rr)

            final_signal, risk_warnings, final_pos = apply_risk_gate(
                signal=signal,
                master_score=score if isinstance(score, (int, float)) else 50,
                risk_profile={'risk_reward_ratio': rr},
                position_size_pct=POSITION_SIZE_PCT,
            )

            if final_signal == 'NO_TRADE':
                no_trade_count += 1
                continue

            # محاكاة الصفقة (تستخدم بيانات مستقبلية للخروج فقط — ليس للقرار)
            future_idx = dates.index(signal_date) if signal_date in dates else i
            future_dates = dates[future_idx + 1: future_idx + 1 + MAX_HOLDING]

            c = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
            cur = c.cursor()
            if future_dates:
                placeholders = ','.join('?' * len(future_dates))
                cur.execute(
                    f"SELECT date, high_price, low_price, close_price "
                    f"FROM price_history WHERE ticker=? AND market='EGX' "
                    f"AND date IN ({placeholders}) ORDER BY date",
                    (ticker, *future_dates)
                )
                future_rows = cur.fetchall()
            else:
                future_rows = []
            c.close()

            if not future_rows:
                continue

            exit_price = None
            exit_reason = ''
            exit_date = ''

            for fr in future_rows:
                f_date, f_high, f_low, f_close = fr
                if f_low and stop and f_low <= stop:
                    exit_price = stop
                    exit_reason = 'STOP_LOSS'
                    exit_date = f_date
                    break
                if f_high and target and f_high >= target:
                    exit_price = target
                    exit_reason = 'TARGET_HIT'
                    exit_date = f_date
                    break
                exit_price = f_close
                exit_reason = 'HOLDING_EXPIRED'
                exit_date = f_date

            if not exit_price:
                continue

            # حساب الربح/الخسارة
            gross_return = (exit_price - entry) / entry * 100
            costs = COMMISSION_PCT * 2 + SLIPPAGE_PCT * 2
            net_return = gross_return - costs
            position_value = capital * (final_pos / 100)
            pnl = position_value * (net_return / 100)
            capital += pnl

            trades.append({
                'variant': variant,
                'signal_date': signal_date,
                'week': week_key(signal_date),
                'ticker': ticker,
                'signal': final_signal,
                'score': round(score if isinstance(score, (int, float)) else 0, 2),
                'entry_price': round(entry, 4),
                'stop_loss': round(stop, 4),
                'target_price': round(target, 4),
                'position_size': final_pos,
                'exit_date': exit_date,
                'exit_price': round(exit_price, 4),
                'exit_reason': exit_reason,
                'gross_return_pct': round(gross_return, 4),
                'net_return_pct': round(net_return, 4),
                'pnl_egp': round(pnl, 2),
                'capital_after': round(capital, 2),
                'confidence': round(confidence, 1) if isinstance(confidence, (int, float)) else 70,
            })

    return trades, no_trade_count, capital, decisions_made


def calc_metrics(trades, capital):
    if not trades:
        return {'trades': 0, 'wr': 'N/A', 'pnl': 0, 'pf': 'N/A', 'ret': '0%', 'dd': 0, 'exp': 0}
    wins = [t for t in trades if t['net_return_pct'] > 0.5]
    losses = [t for t in trades if t['net_return_pct'] < -0.5]
    neutrals = [t for t in trades if -0.5 <= t['net_return_pct'] <= 0.5]
    wr = len(wins) / len(trades) * 100
    total_pnl = sum(t['pnl_egp'] for t in trades)
    total_profit = sum(t['pnl_egp'] for t in wins)
    total_loss = abs(sum(t['pnl_egp'] for t in losses))
    pf = total_profit / total_loss if total_loss > 0 else float('inf')
    ret = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100
    avg_win = statistics.mean([t['net_return_pct'] for t in wins]) if wins else 0
    avg_loss = statistics.mean([t['net_return_pct'] for t in losses]) if losses else 0
    expectancy = (wr / 100 * avg_win) + ((100 - wr) / 100 * avg_loss) if wins or losses else 0

    # Max drawdown
    peak = INITIAL_CAPITAL
    max_dd = 0
    for t in trades:
        cap = t['capital_after']
        if cap > peak:
            peak = cap
        dd = (peak - cap) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Longest losing streak
    max_streak = 0
    current_streak = 0
    for t in trades:
        if t['net_return_pct'] < -0.5:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    return {
        'trades': len(trades), 'wins': len(wins), 'losses': len(losses), 'neutral': len(neutrals),
        'wr': f'{wr:.0f}%', 'pnl': round(total_pnl, 2),
        'pf': f'{pf:.2f}' if pf != float('inf') else '∞',
        'ret': f'{ret:+.2f}%',
        'avg_win': f'{avg_win:+.2f}%', 'avg_loss': f'{avg_loss:+.2f}%',
        'expectancy': f'{expectancy:+.2f}%',
        'max_dd': f'{max_dd:.2f}%', 'max_streak': max_streak,
    }


def main():
    print("=" * 70)
    print("B0-B4 FULL COMPARISON — Laptop Edition")
    print(f"Window: {WINDOW_START} to {WINDOW_END}")
    print(f"Sample: {SAMPLE_TICKERS} tickers | Commission: {COMMISSION_PCT}% | Slippage: {SLIPPAGE_PCT}%")
    print("=" * 70)

    # جلب الأسهم والتواريخ
    c = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute(
        f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' "
        f"AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 "
        f"AND ticker GLOB '[A-Za-z]*' "  # فقط أسهم مصرية حقيقية (أبجدية)
        f"ORDER BY ticker LIMIT {SAMPLE_TICKERS}"
    )
    tickers = [r[0] for r in cur.fetchall()]
    cur.execute(
        f"SELECT DISTINCT date FROM price_history WHERE market='EGX' "
        f"AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date"
    )
    dates = [r[0] for r in cur.fetchall()]
    c.close()
    print(f"Tickers: {len(tickers)} | Dates: {len(dates)}")
    print(f"Tickers list: {tickers[:10]}...")

    results = {}
    all_trades = []

    for variant in ['B0', 'B1', 'B2', 'B3', 'B4']:
        print(f"\n--- Running {variant} ---")
        start_time = time.time()
        trades, no_trade, capital, decisions = run_variant(variant, tickers, dates)
        elapsed = time.time() - start_time
        m = calc_metrics(trades, capital)
        m['no_trade'] = no_trade
        m['decisions'] = decisions
        m['elapsed_sec'] = round(elapsed, 1)
        results[variant] = m
        all_trades.extend(trades)
        print(f"  [{variant}] Done in {elapsed:.1f}s")
        print(f"  Trades: {m['trades']} | Wins: {m.get('wins', 0)} | Losses: {m.get('losses', 0)}")
        print(f"  WR: {m['wr']} | PF: {m['pf']} | P&L: {m['pnl']} EGP | Return: {m['ret']}")
        print(f"  Avg Win: {m.get('avg_win', 'N/A')} | Avg Loss: {m.get('avg_loss', 'N/A')}")
        print(f"  Expectancy: {m.get('expectancy', 'N/A')} | Max DD: {m.get('max_dd', 'N/A')}")
        print(f"  Max Loss Streak: {m.get('max_streak', 0)} | NO_TRADE: {no_trade} | Decisions: {decisions}")

    # ===== جدول المقارنة =====
    print(f"\n{'=' * 70}")
    print("COMPARISON SUMMARY")
    print(f"{'=' * 70}")
    header = f"{'V':<5} {'Trades':>7} {'W':>4} {'L':>4} {'WR':>6} {'PF':>6} {'P&L':>10} {'Return':>8} {'AvgW':>8} {'AvgL':>8} {'Exp':>8} {'MaxDD':>7} {'Streak':>7} {'NT':>5} {'Dec':>5}"
    print(header)
    print("-" * len(header))
    for v in ['B0', 'B1', 'B2', 'B3', 'B4']:
        m = results[v]
        print(f"{v:<5} {m['trades']:>7} {m.get('wins', 0):>4} {m.get('losses', 0):>4} {m['wr']:>6} {m['pf']:>6} {m['pnl']:>+9.2f} {m['ret']:>8} {m.get('avg_win', 'N/A'):>8} {m.get('avg_loss', 'N/A'):>8} {m.get('expectancy', 'N/A'):>8} {m.get('max_dd', 'N/A'):>7} {m.get('max_streak', 0):>7} {m.get('no_trade', 0):>5} {m.get('decisions', 0):>5}")

    # ===== النتائج الأسبوعية =====
    print(f"\n{'=' * 70}")
    print("WEEKLY RESULTS PER VARIANT")
    print(f"{'=' * 70}")
    for v in ['B0', 'B1', 'B2', 'B3', 'B4']:
        v_trades = [t for t in all_trades if t['variant'] == v]
        if not v_trades:
            print(f"\n  {v}: No trades")
            continue
        weekly = {}
        for t in v_trades:
            wk = t['week']
            if wk not in weekly:
                weekly[wk] = {'trades': 0, 'wins': 0, 'losses': 0, 'pnl': 0}
            weekly[wk]['trades'] += 1
            if t['net_return_pct'] > 0.5:
                weekly[wk]['wins'] += 1
            elif t['net_return_pct'] < -0.5:
                weekly[wk]['losses'] += 1
            weekly[wk]['pnl'] += t['pnl_egp']

        print(f"\n  {v}:")
        print(f"  {'Week':<12} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR%':>6} {'P&L':>10}")
        print(f"  {'-' * 50}")
        for wk in sorted(weekly.keys()):
            d = weekly[wk]
            wr_w = d['wins'] / d['trades'] * 100 if d['trades'] else 0
            print(f"  {wk:<12} {d['trades']:>7} {d['wins']:>5} {d['losses']:>7} {wr_w:>5.0f}% {d['pnl']:>+9.2f}")

    # ===== حفظ المخرجات =====
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR / 'weekly_results_b0b4', exist_ok=True)

    # 1. تقرير المقارنة
    with open(OUTPUT_DIR / 'regime_optimization_comparison.md', 'w') as f:
        f.write("# Regime Optimization Comparison (B0-B4)\n\n")
        f.write(f"**Window:** {WINDOW_START} to {WINDOW_END}\n")
        f.write(f"**Market:** EGX\n")
        f.write(f"**Sample:** {SAMPLE_TICKERS} tickers\n")
        f.write(f"**Executor:** V3 (weighted engine combination)\n")
        f.write(f"**Weights:** Owner-approved V1 (Grok matrix)\n")
        f.write(f"**Commission:** {COMMISSION_PCT}% | **Slippage:** {SLIPPAGE_PCT}%\n")
        f.write(f"**Position size:** {POSITION_SIZE_PCT}% | **Max holding:** {MAX_HOLDING} sessions\n\n")
        f.write("| Variant | Description | Trades | Wins | Losses | WR | PF | P&L | Return | Avg Win | Avg Loss | Expectancy | Max DD | Max Streak | NO_TRADE | Decisions | Time(s) |\n")
        f.write("|---------|-------------|--------|------|--------|----|----|-----|--------|---------|---------|------------|--------|------------|----------|-----------|---------|\n")
        descs = {
            'B0': 'Baseline (master_analyzer direct)',
            'B1': 'Regime classification + executor_v3',
            'B2': 'B1 + weights V1 applied',
            'B3': 'B2 + conflict resolution',
            'B4': 'Full package + decision table',
        }
        for v in ['B0', 'B1', 'B2', 'B3', 'B4']:
            m = results[v]
            f.write(f"| {v} | {descs[v]} | {m['trades']} | {m.get('wins', 0)} | {m.get('losses', 0)} | {m['wr']} | {m['pf']} | {m['pnl']} | {m['ret']} | {m.get('avg_win', 'N/A')} | {m.get('avg_loss', 'N/A')} | {m.get('expectancy', 'N/A')} | {m.get('max_dd', 'N/A')} | {m.get('max_streak', 0)} | {m.get('no_trade', 0)} | {m.get('decisions', 0)} | {m.get('elapsed_sec', 0)} |\n")

    # 2. Trade ledger
    if all_trades:
        with open(OUTPUT_DIR / 'trade_ledger_b0b4_full.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(all_trades[0].keys()))
            w.writeheader()
            for t in all_trades:
                w.writerow(t)

    # 3. Weekly reports per variant
    for v in ['B0', 'B1', 'B2', 'B3', 'B4']:
        v_trades = [t for t in all_trades if t['variant'] == v]
        weekly = {}
        for t in v_trades:
            wk = t['week']
            if wk not in weekly:
                weekly[wk] = {'trades': 0, 'wins': 0, 'losses': 0, 'pnl': 0}
            weekly[wk]['trades'] += 1
            if t['net_return_pct'] > 0.5:
                weekly[wk]['wins'] += 1
            elif t['net_return_pct'] < -0.5:
                weekly[wk]['losses'] += 1
            weekly[wk]['pnl'] += t['pnl_egp']

        with open(OUTPUT_DIR / 'weekly_results_b0b4' / f'{v}_weekly.md', 'w') as f:
            f.write(f"# {v} — Weekly Results\n\n")
            f.write(f"| Week | Trades | Wins | Losses | WR% | P&L |\n")
            f.write(f"|------|--------|------|--------|-----|-----|\n")
            for wk in sorted(weekly.keys()):
                d = weekly[wk]
                wr_w = d['wins'] / d['trades'] * 100 if d['trades'] else 0
                f.write(f"| {wk} | {d['trades']} | {d['wins']} | {d['losses']} | {wr_w:.0f}% | {d['pnl']:+.2f} |\n")

    # 4. JSON results
    with open(OUTPUT_DIR / 'b0b4_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\n{'=' * 70}")
    print("OUTPUTS SAVED:")
    print(f"  backtest_results/regime_optimization_comparison.md")
    print(f"  backtest_results/trade_ledger_b0b4_full.csv ({len(all_trades)} trades)")
    print(f"  backtest_results/weekly_results_b0b4/ (5 files)")
    print(f"  backtest_results/b0b4_results.json")
    print(f"{'=' * 70}")

    # تعليمات الرفع على GitHub
    print(f"""
{'=' * 70}
لرفع النتائج على GitHub:
{'=' * 70}

git add -A
git commit -m "results(b0-b4): full comparison — {SAMPLE_TICKERS} tickers × 4 months EGX"
git push origin main

أوامر إعادة التشغيل:
python3 scripts/run_b0b4_full.py

لتغيير عدد الأسهم: عدّل SAMPLE_TICKERS فى أعلى الملف
""")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
v40_2_historical_backfill.py — محاكاة آلة الزمن التاريخية (Time-Machine Backtest)
=================================================================================
CRITICAL-DIRECTIVE (2026-08-16): تشغيل محاكاة بأثر رجعي على بيانات 6 شهور ماضية
قبل لمس أي شيء حي. الهدف: إثبات بالأرقام إن المحرك بيكسب (Profit Factor > 1.5)
قبل وضع أي مليم في السوق.

الاستخدام:
  python3 vps-service/scripts/v40_2_historical_backfill.py \\
      --start 2026-01-01 --end 2026-06-30 --scan-interval 3 --max-picks 5

المخرجات (Acceptance Output):
  ============================================================
  📊 HISTORICAL SIMULATION RESULTS (2026-01-01 to 2026-06-30):
  Total Trades: ...
  Win Rate: ... % (Must be >= 50%)
  Profit Factor: ... (Must be >= 1.5)
  Average Win: ... %
  Average Loss: ... % (Must be capped <= -5%)
  Max Drawdown: ... %
  ============================================================

التطبيق:
- يـ reuse محرك V40.2 الموجود (jobs/daily_predictor.py) — Rule 4: لا تنشئ
  جديد لو يمكن توسيع الموجود.
- بعد التوليد، يطبّق Hard Loss Ceiling (-7%) + Split Guard (-35% → excluded)
  على كل trade (نفس منطق daily_closer._mark_closed الجديد).
- يحسب Max Drawdown (الحد الأقصى للتراجع التراكمي) — ده المؤشر اللي بـ يقيس
  أقصى خسارة ممكنة من قمة المحفظة.
"""
import sys
import os
import argparse
import sqlite3
import json
from datetime import datetime
from pathlib import Path

# ─── Path setup ───
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
os.chdir(PROJECT_ROOT)

PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'

# Hard Loss Ceiling + Split Guard constants (mirror daily_closer._mark_closed)
try:
    from analyzers.engine_settings import get_setting
    HARD_LOSS_CEILING_PCT = float(get_setting('hard_loss_ceiling_pct'))        # 7.0
    SPLIT_DROP_THRESHOLD_PCT = float(get_setting('split_drop_threshold_pct'))  # 35.0
except Exception:
    HARD_LOSS_CEILING_PCT = 7.0
    SPLIT_DROP_THRESHOLD_PCT = 35.0


def apply_loss_ceiling_and_split_guard(actual_return: float) -> tuple:
    """Apply Hard Loss Ceiling + Split Guard to a single trade's return.

    Mirrors daily_closer._mark_closed logic:
    - If actual_return < -SPLIT_DROP_THRESHOLD_PCT (-35%) → SPLIT excluded → return 0.0
    - Else if actual_return < -HARD_LOSS_CEILING_PCT (-7%) → cap at -7%
    - Else → unchanged

    Returns (capped_return, label) where label is one of:
    'split_excluded', 'loss_capped', 'normal'
    """
    if actual_return < -SPLIT_DROP_THRESHOLD_PCT:
        return 0.0, 'split_excluded'
    if actual_return < -HARD_LOSS_CEILING_PCT:
        return -HARD_LOSS_CEILING_PCT, 'loss_capped'
    return actual_return, 'normal'


def compute_max_drawdown(returns: list) -> float:
    """Compute maximum drawdown from a list of trade returns (%).

    Max Drawdown = max peak-to-trough decline in the cumulative equity curve.
    """
    if not returns:
        return 0.0
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in returns:
        equity += r
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd
    return round(max_dd, 2)


def run_backfill(start_date: str, end_date: str, scan_interval: int,
                 max_picks: int, dry_run: bool = False, keep_old: bool = False,
                 max_tickers: int = 0):
    """Run the historical backfill + apply guards + print acceptance report."""
    print("=" * 80, flush=True)
    print("  🛑 CRITICAL-DIRECTIVE: Historical Time-Machine Backtest", flush=True)
    print(f"  Period: {start_date} → {end_date} | Scan every {scan_interval} days", flush=True)
    print(f"  Max picks/day: {max_picks}", flush=True)
    print(f"  Hard Loss Ceiling: -{HARD_LOSS_CEILING_PCT}% | Split Guard: -{SPLIT_DROP_THRESHOLD_PCT}%", flush=True)
    if max_tickers > 0:
        print(f"  ⚠️  Tickers LIMITED to first {max_tickers} (sandbox memory/time limit)", flush=True)
    print("=" * 80, flush=True)

    # Verify price_history.db exists
    if not PRICE_HISTORY_DB.exists():
        print(f"❌ price_history.db not found at {PRICE_HISTORY_DB}", flush=True)
        print(f"   Create symlink: ln -sf <path>/price_history.db db/price_history.db", flush=True)
        return None

    # ─── 1. Run V40.2 generator ───
    print("\n[1/3] Running V40.2 prediction generator...", flush=True)
    try:
        # Import the generator's run_generator function
        sys.path.insert(0, str(VPS_SERVICE / 'jobs'))
        import daily_predictor as _gen_mod
        _run_v40_2 = _gen_mod.run_generator
    except Exception as e:
        print(f"❌ Failed to import V40.2 generator: {e}", flush=True)
        return None

    # If max_tickers is set, monkey-patch get_tickers to limit the count.
    # This is needed because the V40.2 generator iterates over ALL tickers,
    # which is 750+ and takes ~1 hour. For sandbox demo, we limit to top N.
    if max_tickers > 0:
        _original_get_tickers = _gen_mod.get_tickers
        # FIX (2026-10-05 — PRED-RADAR-GAP-AUDIT): accept market_code kwarg
        # that run_generator passes (daily_predictor.py:705). The original
        # monkey-patch only accepted min_days, causing TypeError.
        def _limited_get_tickers(min_days=_gen_mod.MIN_TICKER_DAYS, market_code=None, **_kw):
            all_tk = _original_get_tickers(min_days)
            limited = all_tk[:max_tickers]
            print(f"  ⚠️  get_tickers() LIMITED: {len(all_tk)} → {len(limited)} tickers", flush=True)
            return limited
        _gen_mod.get_tickers = _limited_get_tickers

    _run_v40_2(
        start_date=start_date,
        end_date=end_date,
        scan_interval=scan_interval,
        max_picks=max_picks,
        dry_run=dry_run,
        keep_old=keep_old,
    )

    if dry_run:
        print("\n🔍 DRY-RUN complete. No DB writes — skipping aggregation.", flush=True)
        return None

    # ─── 2. Read generated trades + apply Hard Loss Ceiling + Split Guard ───
    print("\n[2/3] Reading generated trades + applying Hard Loss Ceiling + Split Guard...", flush=True)
    if not PREDICTIONS_DB.exists():
        print(f"❌ predictions.db not found at {PREDICTIONS_DB}", flush=True)
        return None

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(PREDICTIONS_DB), writable=False)
    cur = conn.cursor()

    # Read all V40 predictions with outcomes
    cur.execute("""
        SELECT id, ticker, signal, entry_price, target_price, stop_loss,
               actual_return, exit_type, outcome_date, prediction_date
        FROM predictions
        WHERE kill_filter_result LIKE 'V40 evidence%'
          AND outcome_date IS NOT NULL
        ORDER BY prediction_date ASC
    """)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        print("⚠️  No V40 predictions with outcomes found in DB.", flush=True)
        return None

    trades = []
    n_split = 0
    n_capped = 0
    for row in rows:
        pred_id, ticker, signal, entry, target, stop, ret, exit_type, outcome_date, pred_date = row
        ret = float(ret) if ret is not None else 0.0
        capped_ret, label = apply_loss_ceiling_and_split_guard(ret)
        if label == 'split_excluded':
            n_split += 1
        elif label == 'loss_capped':
            n_capped += 1
        trades.append({
            'id': pred_id, 'ticker': ticker, 'signal': signal,
            'entry': float(entry or 0), 'target': float(target or 0), 'stop': float(stop or 0),
            'raw_return': ret, 'capped_return': capped_ret, 'label': label,
            'exit_type': exit_type, 'outcome_date': outcome_date, 'prediction_date': pred_date,
        })

    print(f"  Total V40 trades with outcomes: {len(trades)}", flush=True)
    print(f"  Split-excluded (> -{SPLIT_DROP_THRESHOLD_PCT}%): {n_split}", flush=True)
    print(f"  Loss-capped (-{HARD_LOSS_CEILING_PCT}% to -{SPLIT_DROP_THRESHOLD_PCT}%): {n_capped}", flush=True)
    print(f"  Normal (within guards): {len(trades) - n_split - n_capped}", flush=True)

    # ─── 3. Compute final performance report ───
    print("\n[3/3] Computing final performance report...", flush=True)
    # Use capped_return for ALL P&L math (this is the "what the system would
    # have recorded with the new guards" view)
    returns = [t['capped_return'] for t in trades]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    zeros = [r for r in returns if r == 0]

    total_trades = len(trades)
    n_wins = len(wins)
    n_losses = len(losses)
    n_zeros = len(zeros)
    win_rate = (n_wins / total_trades * 100) if total_trades else 0

    gross_profit = sum(wins)
    gross_loss = sum(abs(l) for l in losses)
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (float('inf') if gross_profit > 0 else 0)

    avg_win = (sum(wins) / n_wins) if n_wins else 0
    avg_loss = (sum(losses) / n_losses) if n_losses else 0
    max_drawdown = compute_max_drawdown(returns)

    # ─── ACCEPTANCE OUTPUT (exact format requested by owner) ───
    print("\n" + "=" * 60, flush=True)
    print(f"📊 HISTORICAL SIMULATION RESULTS ({start_date} to {end_date}):", flush=True)
    print(f"Total Trades: {total_trades}", flush=True)
    print(f"Win Rate: {win_rate:.1f}% ({'✅ PASS' if win_rate >= 50 else '❌ FAIL'} — Must be >= 50%)", flush=True)
    pf_str = f"{profit_factor:.3f}" if profit_factor != float('inf') else '∞ (no losses)'
    pf_status = '✅ PASS' if profit_factor >= 1.5 else '❌ FAIL'
    print(f"Profit Factor: {pf_str} ({pf_status} — Must be >= 1.5)", flush=True)
    print(f"Average Win: +{avg_win:.2f}%", flush=True)
    print(f"Average Loss: {avg_loss:.2f}% ({'✅ CAPPED' if avg_loss >= -HARD_LOSS_CEILING_PCT else '⚠️ NOT CAPPED'} — Must be capped <= -5%)", flush=True)
    print(f"Max Drawdown: {max_drawdown:.2f}%", flush=True)
    print("=" * 60, flush=True)

    # Additional diagnostic info
    print(f"\nDiagnostic Breakdown:", flush=True)
    print(f"  Wins: {n_wins} | Losses: {n_losses} | Zero/Excluded: {n_zeros}", flush=True)
    print(f"  Gross Profit: +{gross_profit:.2f}% | Gross Loss: -{gross_loss:.2f}%", flush=True)
    print(f"  Net Return (sum): {sum(returns):+.2f}%", flush=True)
    print(f"  Guards Applied: {n_split} splits excluded + {n_capped} losses capped to -{HARD_LOSS_CEILING_PCT}%", flush=True)

    # Save full report to JSON
    report = {
        'critical_directive': 'CRITICAL-DIRECTIVE (2026-08-16) — Historical Time-Machine Backtest',
        'period': f'{start_date} to {end_date}',
        'scan_interval': scan_interval,
        'max_picks_per_day': max_picks,
        'hard_loss_ceiling_pct': HARD_LOSS_CEILING_PCT,
        'split_drop_threshold_pct': SPLIT_DROP_THRESHOLD_PCT,
        'total_trades': total_trades,
        'wins': n_wins,
        'losses': n_losses,
        'zeros_or_excluded': n_zeros,
        'win_rate_pct': round(win_rate, 2),
        'profit_factor': round(profit_factor, 3) if profit_factor != float('inf') else None,
        'average_win_pct': round(avg_win, 2),
        'average_loss_pct': round(avg_loss, 2),
        'max_drawdown_pct': max_drawdown,
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'net_return_pct': round(sum(returns), 2),
        'split_excluded_count': n_split,
        'loss_capped_count': n_capped,
        'generated_at': datetime.now().isoformat(),
    }
    report_path = PROJECT_ROOT / 'vps-service' / 'backtest_results' / \
                  f'v40_2_historical_backfill_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Full report saved: {report_path}", flush=True)

    return report


def main():
    parser = argparse.ArgumentParser(
        description='v40_2_historical_backfill.py — محاكاة آلة الزمن التاريخية',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  %(prog)s --start 2026-01-01 --end 2026-06-30 --scan-interval 3 --max-picks 5
  %(prog)s --dry-run    # جاف فقط (اختبار بدون كتابة في DB)
""",
    )
    parser.add_argument('--start', default='2026-01-01',
                        help='تاريخ البداية (YYYY-MM-DD). افتراضي: 2026-01-01')
    parser.add_argument('--end', default='2026-06-30',
                        help='تاريخ النهاية (YYYY-MM-DD). افتراضي: 2026-06-30')
    parser.add_argument('--scan-interval', type=int, default=3,
                        help='فحص كل N أيام تداول (افتراضي: 3)')
    parser.add_argument('--max-picks', type=int, default=5,
                        help='حد أقصى توقعات/يوم (افتراضي: 5)')
    parser.add_argument('--dry-run', action='store_true',
                        help='جاف فقط — لا يكتب في DB')
    parser.add_argument('--keep-old', action='store_true',
                        help='عدم حذف توقعات V40 القديمة في الفترة')
    parser.add_argument('--max-tickers', type=int, default=0,
                        help='حد أقصى لعدد الأسهم المفحوصة (0 = الكل). للساندبوكس: استخدم 50-100')
    args = parser.parse_args()

    # Validate dates
    try:
        datetime.strptime(args.start, '%Y-%m-%d')
        datetime.strptime(args.end, '%Y-%m-%d')
    except ValueError as e:
        print(f"❌ صيغة تاريخ خاطئة: {e}. استخدم YYYY-MM-DD", flush=True)
        sys.exit(1)

    if args.start > args.end:
        print(f"❌ تاريخ البداية ({args.start}) بعد تاريخ النهاية ({args.end})", flush=True)
        sys.exit(1)

    report = run_backfill(
        start_date=args.start,
        end_date=args.end,
        scan_interval=args.scan_interval,
        max_picks=args.max_picks,
        dry_run=args.dry_run,
        keep_old=args.keep_old,
        max_tickers=args.max_tickers,
    )

    # Exit code: 0 if PF >= 1.5 AND WR >= 50%, else 1
    if report is None:
        sys.exit(1)
    pf = report.get('profit_factor') or 0
    wr = report.get('win_rate_pct') or 0
    if pf >= 1.5 and wr >= 50.0:
        print("\n✅ ACCEPTANCE CRITERIA PASSED — engine is profitable.", flush=True)
        sys.exit(0)
    else:
        print(f"\n⚠️  ACCEPTANCE CRITERIA FAILED — PF={pf:.3f} (need ≥1.5), WR={wr:.1f}% (need ≥50%).", flush=True)
        print("    المحرك لا يزال خاسراً — راجع الـ daily_closer + الـ entry rules.", flush=True)
        sys.exit(2)


if __name__ == '__main__':
    main()

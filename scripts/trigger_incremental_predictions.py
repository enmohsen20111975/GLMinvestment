#!/usr/bin/env python3
"""
BRAVO-SCRAPER-WIRING-1
======================
الوصلة بين الـ scraper و الـ prediction engine (event-driven).

المنطق:
  1. شغّل EGKSCO scraper → sync بيانات الأسعار لـ egksco_stocks
  2. خد قائمة tickers اللي اتغير سعرها (scraper.get_changed_tickers())
  3. لو فيه changed tickers → trigger daily_predictor --incremental --tickers <changed>
  4. لو مفيش → log "no changes" واطع (مش هيفشخ السرفر)

القاعدة اللي محسن طلبها:
  "التوقعات تتحدث كل تحديث في البيانات"
  + incremental (مش full recompute)
  + مش هانفشخ السرفر (بس الـ changed tickers)

الاستخدام:
  python3 scripts/trigger_incremental_predictions.py                    # شغّل + trigger
  python3 scripts/trigger_incremental_predictions.py --dry-run           # شوف بس (ما تـ triggerش)
  python3 scripts/trigger_incremental_predictions.py --max-tickers 20    # limit (حماية)
  python3 scripts/trigger_incremental_predictions.py --skip-scrape       # skip الـ scraper (للـ testing)
"""
import sys
import os
import subprocess
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / "vps-service"


def log(msg):
    print(f"  {msg}", flush=True)


def run_scraper():
    """شغّل EGKSCO scraper وارجع قائمة tickers اللي اتغيرت."""
    log("[1/3] Running EGKSCO scraper sync...")
    try:
        sys.path.insert(0, str(VPS_SERVICE))
        from data.egksco_scraper import EGKSCOScraper
        scraper = EGKSCOScraper()
        result = scraper.sync_to_db()
        if not result.get('success'):
            log(f"  ❌ scraper failed: {result.get('error', 'unknown')}")
            return None, result
        changed = scraper.get_changed_tickers()
        log(f"  ✓ scraper synced {result.get('stocks_count', 0)} stocks | {len(changed)} tickers changed")
        return changed, result
    except Exception as e:
        import traceback
        log(f"  ❌ scraper error: {e}")
        traceback.print_exc()
        return None, {'success': False, 'error': str(e)}


def trigger_predictor(tickers, max_tickers=None, dry_run=False, market='EGX'):
    """شغّل daily_predictor --incremental --tickers <changed>."""
    if not tickers:
        log("[2/3] No changed tickers — skipping predictor trigger")
        return {'triggered': False, 'reason': 'no_changes'}

    # حماية: limit عدد الـ tickers (مش هانفشخ السرفر)
    if max_tickers and len(tickers) > max_tickers:
        log(f"  ⚠️  {len(tickers)} changed > max_tickers={max_tickers} — limiting to first {max_tickers}")
        tickers = tickers[:max_tickers]

    ticker_str = ','.join(tickers)
    log(f"[2/3] Triggering daily_predictor for {len(tickers)} tickers: {ticker_str[:100]}...")

    if dry_run:
        log("  (dry-run — would run: daily_predictor --incremental --today-only --tickers <changed>)")
        return {'triggered': False, 'reason': 'dry_run', 'tickers': tickers}

    cmd = [
        sys.executable,
        str(VPS_SERVICE / "jobs" / "daily_predictor.py"),
        "--incremental",
        "--today-only",
        "--tickers", ticker_str,
        "--market", market,
    ]
    log(f"  cmd: {' '.join(cmd[:6])}... --tickers <{len(tickers)} tickers>")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 min cap
            cwd=str(PROJECT_ROOT),
        )
        # Print last 20 lines of output
        if result.stdout:
            out_lines = result.stdout.strip().split('\n')
            for line in out_lines[-20:]:
                print(f"    {line}", flush=True)
        if result.returncode != 0:
            log(f"  ❌ predictor exited {result.returncode}")
            if result.stderr:
                for line in result.stderr.strip().split('\n')[-10:]:
                    print(f"    [stderr] {line}", flush=True)
            return {'triggered': True, 'success': False, 'tickers': tickers, 'exit_code': result.returncode}

        log(f"  ✓ predictor completed for {len(tickers)} tickers")
        return {'triggered': True, 'success': True, 'tickers': tickers}
    except subprocess.TimeoutExpired:
        log(f"  ❌ predictor timed out (10 min cap)")
        return {'triggered': True, 'success': False, 'tickers': tickers, 'error': 'timeout'}
    except Exception as e:
        log(f"  ❌ predictor error: {e}")
        return {'triggered': True, 'success': False, 'tickers': tickers, 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description="Wire scraper → predictor (event-driven predictions)")
    parser.add_argument("--dry-run", action="store_true", help="Show actions without executing predictor")
    parser.add_argument("--skip-scrape", action="store_true", help="Skip scraper (for testing — expects changed tickers via other means)")
    parser.add_argument("--max-tickers", type=int, default=50, help="Cap on tickers per trigger (safety)")
    parser.add_argument("--market", default='EGX', help="Market code")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("BRAVO-SCRAPER-WIRING — event-driven predictions", flush=True)
    print(f"mode: {'DRY-RUN' if args.dry_run else 'EXECUTE'} | max_tickers={args.max_tickers}", flush=True)
    print("=" * 60, flush=True)

    # Step 1: scraper
    if args.skip_scrape:
        log("[1/3] Skipping scraper (--skip-scrape)")
        changed = []
    else:
        changed, _ = run_scraper()
        if changed is None:
            print("\n❌ FAILED at scraper step — aborting")
            return 1

    # Step 2: trigger predictor
    pred_result = trigger_predictor(changed, max_tickers=args.max_tickers, dry_run=args.dry_run, market=args.market)

    # Step 3: summary
    log("[3/3] Summary")
    print(f"\n{'='*60}")
    print(f"  changed tickers: {len(changed)}")
    print(f"  predictor triggered: {pred_result.get('triggered', False)}")
    if pred_result.get('triggered'):
        print(f"  predictor success: {pred_result.get('success', False)}")
    print(f"{'='*60}")
    return 0 if (pred_result.get('success') or not pred_result.get('triggered')) else 2


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
multi_market_scraper.py — Unified Multi-Market Scraper
======================================================
Runs all market scrapers in sequence:
  1. EGX (tradingview_scraper.py + yahoo_scraper.py fallback)
  2. US (us_stock_scraper.py)
  3. Crypto (crypto_fetcher.py)
  4. Gold/Metals (metals_forex_fetcher.py)

Usage:
  python3 data_engine/scrapers/multi_market_scraper.py
  python3 data_engine/scrapers/multi_market_scraper.py --market US
  python3 data_engine/scrapers/multi_market_scraper.py --market EGX,US,CRYPTO
  python3 data_engine/scrapers/multi_market_scraper.py --dry-run
"""
from __future__ import annotations

import os
import sys
import json
import time
import subprocess
import logging
import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any

_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent
STATUS_DIR = _PROJECT_ROOT / 'data'
STATUS_FILE = STATUS_DIR / 'multi_market_scraper_status.json'

# ────────────────────────────────────────────────────────────────────────────
# Market → scraper mapping
# ────────────────────────────────────────────────────────────────────────────
# Each entry tells the orchestrator which scraper script(s) to invoke.
# 'primary' is run first; 'fallback' (optional) runs only if primary fails.
SCRAPERS: Dict[str, Dict[str, Any]] = {
    'EGX': {
        'name': 'EGX (Egypt)',
        'primary': 'tradingview_scraper.py',
        'fallback': 'yahoo_scraper.py',
        'timeout': 600,  # tradingview can be slow (Playwright)
    },
    'US': {
        'name': 'US Stocks (NYSE/NASDAQ)',
        'primary': 'us_stock_scraper.py',
        'fallback': None,
        'timeout': 300,
    },
    'CRYPTO': {
        'name': 'Crypto (top 50)',
        'primary': 'crypto_fetcher.py',
        'fallback': None,
        'timeout': 120,
    },
    'METALS': {
        'name': 'Gold / Forex / Arab currencies',
        'primary': 'metals_forex_fetcher.py',
        'fallback': None,
        'timeout': 120,
    },
}

ALL_MARKETS = list(SCRAPERS.keys())

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [Multi-Market] %(message)s',
        datefmt='%H:%M:%S',
    ))
    logger.addHandler(_h)


# ────────────────────────────────────────────────────────────────────────────
# Status helpers
# ────────────────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.utcnow().isoformat() + 'Z'


def update_status(status_update: Dict[str, Any]) -> None:
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            status = json.load(f)
    except Exception:
        status = {'running': False, 'logs': [], 'markets': {}}

    status.update(status_update)
    status['logs'] = status.get('logs', [])[-100:]

    try:
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2, ensure_ascii=False, default=str)
    except Exception as e:
        logger.warning(f"Failed to write multi-market status: {e}")


def log(msg: str, level: str = 'info') -> None:
    ts = datetime.utcnow().strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    getattr(logger, level.lower(), logger.info)(msg)
    try:
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            status = json.load(f)
        status['logs'] = status.get('logs', []) + [line]
        status['logs'] = status['logs'][-100:]
        with open(STATUS_FILE, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2, ensure_ascii=False, default=str)
    except Exception:
        pass


# ────────────────────────────────────────────────────────────────────────────
# Subprocess runner
# ────────────────────────────────────────────────────────────────────────────
def run_scraper(script_name: str, timeout: int = 300) -> Dict[str, Any]:
    """
    Run a scraper script via subprocess. Captures stdout/stderr.

    Returns: dict with success, returncode, runtime_sec, stdout_tail, stderr_tail.
    """
    script_path = _THIS_DIR / script_name
    if not script_path.exists():
        return {
            'success': False,
            'error': f'Script not found: {script_path}',
            'runtime_sec': 0,
        }

    python_bin = sys.executable or 'python3'
    started = time.time()
    try:
        result = subprocess.run(
            [python_bin, str(script_path)],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(_PROJECT_ROOT),
        )
        runtime = round(time.time() - started, 2)
        return {
            'success': result.returncode == 0,
            'returncode': result.returncode,
            'runtime_sec': runtime,
            'stdout_tail': (result.stdout or '')[-2000:],
            'stderr_tail': (result.stderr or '')[-2000:],
        }
    except subprocess.TimeoutExpired:
        runtime = round(time.time() - started, 2)
        return {
            'success': False,
            'error': f'Timeout after {timeout}s',
            'runtime_sec': runtime,
        }
    except Exception as e:
        runtime = round(time.time() - started, 2)
        return {
            'success': False,
            'error': f'Exception: {str(e)[:200]}',
            'runtime_sec': runtime,
        }


# ────────────────────────────────────────────────────────────────────────────
# Market dispatcher
# ────────────────────────────────────────────────────────────────────────────
def run_market(market: str, dry_run: bool = False) -> Dict[str, Any]:
    """Run scrapers for one market. Tries primary, then fallback if primary fails."""
    if market not in SCRAPERS:
        return {'success': False, 'error': f'Unknown market: {market}'}

    cfg = SCRAPERS[market]
    result: Dict[str, Any] = {
        'market': market,
        'name': cfg['name'],
        'primary': cfg['primary'],
        'fallback': cfg.get('fallback'),
        'primary_result': None,
        'fallback_result': None,
        'success': False,
        'started_at': _now_iso(),
    }
    log(f"▶️ [{market}] {cfg['name']} → running {cfg['primary']}")

    if dry_run:
        result['primary_result'] = {'success': True, 'note': 'DRY-RUN — skipped'}
        result['success'] = True
        result['finished_at'] = _now_iso()
        return result

    # Primary
    primary = run_scraper(cfg['primary'], timeout=cfg.get('timeout', 300))
    result['primary_result'] = primary

    if primary['success']:
        result['success'] = True
        log(f"✅ [{market}] primary succeeded ({primary.get('runtime_sec', 0)}s)")
    else:
        log(f"⚠️ [{market}] primary failed: {primary.get('error') or primary.get('stderr_tail', '')[:120]}", 'warning')
        # Fallback
        if cfg.get('fallback'):
            log(f"↪️ [{market}] falling back to {cfg['fallback']}", 'warning')
            fb = run_scraper(cfg['fallback'], timeout=cfg.get('timeout', 300))
            result['fallback_result'] = fb
            if fb['success']:
                result['success'] = True
                log(f"✅ [{market}] fallback succeeded ({fb.get('runtime_sec', 0)}s)")
            else:
                log(f"❌ [{market}] fallback also failed: {fb.get('error') or fb.get('stderr_tail', '')[:120]}", 'error')

    result['finished_at'] = _now_iso()
    return result


# ────────────────────────────────────────────────────────────────────────────
# Main orchestrator
# ────────────────────────────────────────────────────────────────────────────
def run_all_markets(
    markets: List[str],
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Run scrapers for each market sequentially.

    Args:
        markets: list of market keys (EGX, US, CRYPTO, METALS)
        dry_run: if True, just print what would be done

    Returns:
        Dict with: markets_results, total_runtime_sec, dry_run,
                   started_at, finished_at, summary
    """
    overall: Dict[str, Any] = {
        'markets': markets,
        'dry_run': dry_run,
        'started_at': _now_iso(),
        'markets_results': {},
    }
    update_status({
        'running': True,
        'last_run_started_at': overall['started_at'],
        'markets': markets,
    })

    log("=" * 60)
    log(f"🌐 Multi-Market Scraper — markets: {', '.join(markets)}")
    log(f"   dry_run={dry_run} | total scrapers={len(markets)}")
    log("=" * 60)

    started_ts = time.time()
    successes = 0
    failures = 0
    for market in markets:
        try:
            r = run_market(market, dry_run=dry_run)
            overall['markets_results'][market] = r
            if r.get('success'):
                successes += 1
            else:
                failures += 1
        except Exception as e:
            log(f"❌ [{market}] unhandled exception: {e}", 'error')
            overall['markets_results'][market] = {
                'market': market,
                'success': False,
                'error': f'Unhandled: {str(e)[:200]}',
            }
            failures += 1

    overall['total_runtime_sec'] = round(time.time() - started_ts, 2)
    overall['finished_at'] = _now_iso()
    overall['summary'] = {
        'total_markets': len(markets),
        'successes': successes,
        'failures': failures,
    }

    log(
        f"📊 DONE | {successes}/{len(markets)} markets succeeded | "
        f"runtime={overall['total_runtime_sec']}s"
    )

    update_status({
        'running': False,
        'last_run_finished_at': overall['finished_at'],
        'last_run_summary': overall['summary'],
        'markets_results': overall['markets_results'],
    })

    return overall


# ────────────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────────────
def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Multi-Market Scraper — runs all scrapers in sequence',
    )
    parser.add_argument(
        '--market',
        type=str,
        default='ALL',
        help='Comma-separated market list (EGX,US,CRYPTO,METALS) or ALL (default: ALL)',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print what would be done — no scraper subprocess calls',
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    # Resolve market list
    raw = (args.market or 'ALL').upper().strip()
    if raw == 'ALL':
        markets = ALL_MARKETS[:]
    else:
        markets = [m.strip().upper() for m in raw.split(',') if m.strip()]
        invalid = [m for m in markets if m not in SCRAPERS]
        if invalid:
            log(f"❌ Unknown market(s): {invalid}. Valid: {ALL_MARKETS}", 'error')
            return 2

    result = run_all_markets(markets, dry_run=args.dry_run)
    print()
    print("─" * 60)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))

    # Exit 0 if all markets succeeded (or dry-run), 1 if any failed
    if args.dry_run:
        return 0
    return 0 if result['summary']['failures'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

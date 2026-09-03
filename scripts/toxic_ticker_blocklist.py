#!/usr/bin/env python3
"""Toxic Ticker Blocklist Analyzer (Rule 28)

Identifies tickers with poor historical performance and adds them to a
blocklist file. The V40.2 generator reads this blocklist and skips
blocklisted tickers during generation.

Rule 28 criteria: A ticker is toxic if it has 3+ closed trades with
win-rate < 40%.

Usage:
    python3 scripts/toxic_ticker_blocklist.py          # analyze + update blocklist
    python3 scripts/toxic_ticker_blocklist.py --list   # just list current blocklist
"""
import sqlite3
import json
import os
from pathlib import Path
from collections import defaultdict

BLOCKLIST_FILE = Path(__file__).resolve().parents[1] / 'vps-service' / 'config' / 'toxic_ticker_blocklist.json'
PREDICTIONS_DB = Path(__file__).resolve().parents[1] / 'db' / 'predictions.db'

MIN_TRADES = 2        # Rule 28: need at least 2 trades (lowered from 3 for tighter filtering)
MAX_WIN_RATE = 0.40   # Rule 28: WR < 40% = toxic

def load_existing_blocklist():
    if not BLOCKLIST_FILE.exists():
        return {'toxic_tickers': [], 'last_updated': None, 'criteria': {}}
    with open(BLOCKLIST_FILE) as f:
        return json.load(f)

def save_blocklist(tickers, stats):
    data = {
        'toxic_tickers': sorted(tickers),
        'last_updated': __import__('datetime').datetime.now().isoformat(),
        'criteria': {
            'min_trades': MIN_TRADES,
            'max_win_rate': MAX_WIN_RATE,
            'description': 'Rule 28: Tickers with 3+ trades and WR < 40% are blocklisted'
        },
        'ticker_stats': stats
    }
    BLOCKLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BLOCKLIST_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return data

def analyze_toxic_tickers():
    """Analyze predictions.db and return toxic tickers + their stats."""
    if not PREDICTIONS_DB.exists():
        return [], {}

    conn = sqlite3.connect(str(PREDICTIONS_DB))
    rows = conn.execute(
        'SELECT ticker, actual_return, status FROM predictions WHERE actual_return IS NOT NULL'
    ).fetchall()
    conn.close()

    by_ticker = defaultdict(lambda: {'trades': 0, 'wins': 0, 'losses': 0, 'net': 0.0})
    for ticker, ret, status in rows:
        d = by_ticker[ticker]
        d['trades'] += 1
        d['net'] += ret
        if ret > 0:
            d['wins'] += 1
        else:
            d['losses'] += 1

    toxic = []
    stats = {}
    for ticker, d in by_ticker.items():
        wr = d['wins'] / d['trades'] if d['trades'] > 0 else 0
        if d['trades'] >= MIN_TRADES and wr < MAX_WIN_RATE:
            toxic.append(ticker)
            stats[ticker] = {
                'trades': d['trades'],
                'wins': d['wins'],
                'losses': d['losses'],
                'win_rate': round(wr * 100, 1),
                'net_return': round(d['net'], 2),
            }

    return toxic, stats

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Toxic Ticker Blocklist (Rule 28)')
    parser.add_argument('--list', action='store_true', help='Just list current blocklist')
    parser.add_argument('--dry-run', action='store_true', help='Analyze but do not save')
    args = parser.parse_args()

    if args.list:
        data = load_existing_blocklist()
        print(f"Toxic Ticker Blocklist (last updated: {data.get('last_updated', 'never')})")
        print(f"Criteria: {data.get('criteria', {})}")
        print(f"Toxic tickers ({len(data.get('toxic_tickers', []))}):")
        for t in data.get('toxic_tickers', []):
            s = data.get('ticker_stats', {}).get(t, {})
            print(f"  {t}: {s}")
        return

    toxic, stats = analyze_toxic_tickers()
    existing = load_existing_blocklist()
    existing_tickers = set(existing.get('toxic_tickers', []))
    new_tickers = set(toxic) - existing_tickers

    # MERGE: keep existing blocklisted tickers even if they no longer have trades
    # (they were blocklisted for a reason — don't un-blocklist them just because
    # they have no new trades)
    all_toxic = sorted(existing_tickers | set(toxic))

    print("=" * 60)
    print("  Toxic Ticker Blocklist Analyzer (Rule 28)")
    print("=" * 60)
    print(f"  Criteria: {MIN_TRADES}+ trades AND WR < {MAX_WIN_RATE*100:.0f}%")
    print(f"  Existing blocklist: {len(existing_tickers)} tickers")
    print(f"  Newly toxic: {len(new_tickers)} tickers: {sorted(new_tickers)}")
    print(f"  Total toxic (merged): {len(all_toxic)} tickers")
    print(f"  Toxic tickers: {all_toxic}")
    print()
    print("  Toxic ticker stats (current DB):")
    for t in sorted(toxic):
        s = stats[t]
        print(f"    {t}: {s['trades']}T {s['wins']}W {s['losses']}L WR={s['win_rate']}% net={s['net_return']:+.1f}%")
    if existing_tickers - set(toxic):
        print(f"  Preserved from previous runs (no current trades): {sorted(existing_tickers - set(toxic))}")
    print("=" * 60)

    if not args.dry_run:
        # Merge stats: keep old stats for preserved tickers
        old_stats = existing.get('ticker_stats', {})
        merged_stats = {**old_stats, **stats}
        data = save_blocklist(all_toxic, merged_stats)
        print(f"\n💾 Saved to: {BLOCKLIST_FILE}")
        print(f"   {len(all_toxic)} tickers blocklisted")
    else:
        print("\n--dry-run: not saving")

if __name__ == '__main__':
    main()

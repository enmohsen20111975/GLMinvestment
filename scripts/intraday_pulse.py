#!/usr/bin/env python3
"""
intraday_pulse.py — Intraday Pulse v1 (ALERT ONLY)
====================================================
طبقة إنذار لحظي جوه الجلسة، منفصلة عن maker_radar اليومي.
مش توصية شراء. مش تعديل في قواعد الدخول.

المصدر: db/stocks.db → جدول stocks (+ stock_daily_prices كـ fallback للسعر)
الخرج: JSON على stdout (--json-only) أو ملف في scripts/output/

Usage:
  python3 scripts/intraday_pulse.py --json-only
  python3 scripts/intraday_pulse.py --market EGX
"""
from __future__ import annotations
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ─── Config ─────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
RADAR_OUTPUT_DIR = PROJECT_ROOT / 'scripts' / 'output'

# Thresholds (initial — adjustable later)
SURGE_UP_PCT = 3.0        # change_from_open >= +3%
SURGE_DOWN_PCT = -3.0     # change_from_open <= -3%
VOLUME_SPIKE_RATIO = 2.0  # volume / avg_volume >= 2.0
BREAKING_HIGH_TOLERANCE = 0.998  # current >= high * 0.998
BREAKING_LOW_TOLERANCE = 1.002   # current <= low * 1.002
STALE_MINUTES = 5         # last_update older than 5 min → STALE


def get_staleness_minutes(last_update_str: str) -> int | None:
    """Calculate minutes since last_update. Returns None if can't parse."""
    if not last_update_str:
        return None
    try:
        # Parse ISO format: 2026-10-28T09:23:36.247221
        lu = datetime.fromisoformat(last_update_str)
        now = datetime.now()
        diff = (now - lu).total_seconds() / 60
        return int(abs(diff))
    except Exception:
        return None


def classify_stock(row: dict, daily_context: dict | None) -> dict:
    """Classify a single stock into intraday pulse flags.

    Args:
        row: dict with ticker, current_price, open_price, high_price, low_price,
             volume, avg_volume, last_update
        daily_context: dict from radar JSON (winner_path, under_microscope, classification)

    Returns:
        dict with flags, data_status, change_from_open_pct, vol_ratio, note_ar
    """
    ticker = row.get('ticker', '?')
    current_price = row.get('current_price') or 0
    open_price = row.get('open_price') or 0
    high_price = row.get('high_price') or 0
    low_price = row.get('low_price') or 0
    volume = row.get('volume') or 0
    avg_volume = row.get('avg_volume') or 0
    last_update = row.get('last_update') or ''

    # ─── Data status check ───
    staleness = get_staleness_minutes(last_update)
    if current_price <= 0:
        data_status = 'INVALID'
    elif staleness is not None and staleness > STALE_MINUTES:
        data_status = 'STALE'
    else:
        data_status = 'OK'

    # ─── Calculate metrics ───
    change_from_open_pct = None
    if open_price > 0 and current_price > 0:
        change_from_open_pct = round(
            (current_price - open_price) / open_price * 100, 2
        )

    vol_ratio = None
    if avg_volume > 0 and volume > 0:
        vol_ratio = round(volume / avg_volume, 2)

    # ─── Classify flags ───
    flags = []

    if data_status in ('STALE', 'INVALID'):
        flags.append('STALE')
    else:
        # A) Surge detection
        if change_from_open_pct is not None:
            if change_from_open_pct >= SURGE_UP_PCT:
                flags.append('SURGE_UP_LIVE')
            elif change_from_open_pct <= SURGE_DOWN_PCT:
                flags.append('SURGE_DOWN_LIVE')

        # B) Volume spike
        if vol_ratio is not None and vol_ratio >= VOLUME_SPIKE_RATIO:
            # Only flag if there's price movement (not flat)
            if change_from_open_pct is not None and abs(change_from_open_pct) > 0.1:
                flags.append('VOLUME_SPIKE_LIVE')

        # C) Breaking day high/low
        if high_price > 0 and current_price > 0:
            if current_price >= high_price * BREAKING_HIGH_TOLERANCE:
                if change_from_open_pct is not None and change_from_open_pct > 0:
                    flags.append('BREAKING_DAY_HIGH')

        if low_price > 0 and current_price > 0:
            if current_price <= low_price * BREAKING_LOW_TOLERANCE:
                if change_from_open_pct is not None and change_from_open_pct < 0:
                    flags.append('BREAKING_DAY_LOW')

    if not flags:
        flags.append('QUIET_LIVE')

    # ─── Daily context link ───
    ctx = None
    note_ar = 'نبض لحظي فقط'
    if daily_context:
        path = daily_context.get('path') or ''
        classification = daily_context.get('classification') or ''
        under_micro = daily_context.get('under_microscope', False)

        if under_micro and 'SURGE_UP_LIVE' in flags:
            ctx = 'under_microscope'
            note_ar = 'حركة لحظية على سهم تحت المراقبة اليومية'
        elif classification == 'rule80_downtrend' and 'SURGE_UP_LIVE' in flags:
            ctx = 'rule80_downtrend'
            note_ar = 'ارتداد لحظي داخل ترند هابط (تحذير)'
        elif classification == 'distribution' and ('SURGE_UP_LIVE' in flags or 'SURGE_DOWN_LIVE' in flags):
            ctx = 'distribution'
            note_ar = 'حركة مع سياق تصريف يومي (تحذير)'
        elif under_micro:
            ctx = 'under_microscope'
            note_ar = 'سهم تحت المراقبة اليومية'

    return {
        'symbol': ticker,
        'current_price': round(current_price, 2) if current_price else 0,
        'open_price': round(open_price, 2) if open_price else 0,
        'high_price': round(high_price, 2) if high_price else 0,
        'low_price': round(low_price, 2) if low_price else 0,
        'volume': int(volume) if volume else 0,
        'change_from_open_pct': change_from_open_pct,
        'vol_ratio': vol_ratio,
        'flags': flags,
        'data_status': data_status,
        'last_update': last_update,
        'staleness_minutes': staleness,
        'daily_context': ctx,
        'note_ar': note_ar,
    }


def load_daily_context() -> dict:
    """Load latest radar JSON for daily context (under_microscope, path, classification)."""
    context = {}
    try:
        # Find latest radar JSON
        json_files = sorted(RADAR_OUTPUT_DIR.glob('maker_radar_EGX_*.json'), reverse=True)
        if not json_files:
            return context
        with open(json_files[0], 'r', encoding='utf-8') as f:
            radar = json.load(f)
        for r in radar.get('results', []):
            ticker = r.get('ticker', '')
            if ticker:
                context[ticker] = {
                    'path': r.get('path'),
                    'classification': r.get('classification'),
                    'under_microscope': r.get('under_microscope', False),
                }
    except Exception:
        pass
    return context


def run_pulse(market: str = 'EGX') -> dict:
    """Run intraday pulse scan.

    Args:
        market: 'EGX' (only EGX supported in v1)

    Returns:
        dict with results + summary
    """
    if not os.path.exists(STOCKS_DB):
        return {'error': f'stocks.db not found at {STOCKS_DB}'}

    conn = sqlite3.connect(STOCKS_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Load daily context from latest radar
    daily_ctx = load_daily_context()

    # Query active EGX stocks
    # Use ticker (not symbol — symbol is NULL in current DB)
    # market column may be 'egypt' (lowercase) or 'EGX'
    # BRAVO-PULSE-FALLBACK: if current_price = 0 (scanner failed to write),
    # use stock_daily_prices.close (latest day) as fallback.
    # This is READ-ONLY — no writes to stocks.db.
    #
    # BRAVO-PULSE-FILTER (2026-10-28): filter out:
    # 1. EGS* ISIN codes (bonds/sukuk — not regular stocks)
    # 2. Tickers with suffixes like _R1, A, etc. (adjusted duplicates)
    # 3. Stocks with volume=0 AND open_price=0 (suspended/inactive)
    # 4. Stocks with current_price=0 AND no daily fallback (dead)
    cur.execute("""
        SELECT s.ticker,
               COALESCE(NULLIF(s.current_price, 0),
                        (SELECT close FROM stock_daily_prices sdp
                         WHERE sdp.ticker = s.ticker
                         ORDER BY price_date DESC LIMIT 1),
                        0) as current_price,
               s.open_price, s.high_price, s.low_price,
               s.volume, s.avg_volume, s.last_update
        FROM stocks s
        WHERE (s.market = 'egypt' OR s.market = 'EGX')
          AND s.ticker IS NOT NULL AND s.ticker != ''
          AND s.ticker NOT LIKE 'EGS%'        -- exclude ISIN codes (bonds/sukuk)
          AND s.ticker NOT LIKE '%_%' ESCAPE '\'        -- exclude adjusted tickers (LUTS_R1)
          AND length(s.ticker) <= 6           -- exclude long ISIN-like codes
          AND s.is_suspended IS NOT 1         -- exclude suspended stocks
        ORDER BY s.volume DESC
    """)

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    results = []
    for row in rows:
        # BRAVO-PULSE-FILTER: skip stocks with no real data
        cp = row.get('current_price') or 0
        op = row.get('open_price') or 0
        vol = row.get('volume') or 0

        # Skip if price = 0 (dead stock — no fallback worked)
        if cp <= 0:
            continue

        # Skip if volume = 0 AND open = 0 (suspended, never traded today)
        if vol == 0 and op == 0:
            continue

        # Skip if open_price = 0 but price > 0 (corrupted OHLC — can't calculate change)
        if op <= 0:
            continue

        result = classify_stock(row, daily_ctx.get(row.get('ticker', '')))

        # BRAVO-PULSE-SANITY: flag absurd change percentages as SUSPICIOUS
        chg = result.get('change_from_open_pct')
        if chg is not None and abs(chg) > 50:
            result['flags'] = ['SUSPICIOUS_DATA']
            result['data_status'] = 'INVALID'
            result['note_ar'] = f'بيانات مشبوهة (تغير {chg}%) — تجاهل'

        results.append(result)

    # Summary
    summary = {
        'generated_at': datetime.now().isoformat(),
        'market': market,
        'db_source': STOCKS_DB,
        'total_scanned': len(results),
        'surge_up_count': sum(1 for r in results if 'SURGE_UP_LIVE' in r['flags']),
        'surge_down_count': sum(1 for r in results if 'SURGE_DOWN_LIVE' in r['flags']),
        'volume_spike_count': sum(1 for r in results if 'VOLUME_SPIKE_LIVE' in r['flags']),
        'breaking_high_count': sum(1 for r in results if 'BREAKING_DAY_HIGH' in r['flags']),
        'breaking_low_count': sum(1 for r in results if 'BREAKING_DAY_LOW' in r['flags']),
        'suspicious_count': sum(1 for r in results if 'SUSPICIOUS_DATA' in r['flags']),
        'stale_count': sum(1 for r in results if r['data_status'] in ('STALE', 'INVALID')),
        'quiet_count': sum(1 for r in results if 'QUIET_LIVE' in r['flags']),
    }

    return {
        'summary': summary,
        'results': results,
    }


def main():
    parser = argparse.ArgumentParser(description='Intraday Pulse v1 — ALERT ONLY')
    parser.add_argument('--market', default='EGX', help='Market (default: EGX)')
    parser.add_argument('--json-only', action='store_true', help='Output JSON to stdout')
    parser.add_argument('--output', default='', help='Output file path (default: scripts/output/)')
    args = parser.parse_args()

    print(f'[intraday-pulse] scanning {args.market}...', file=sys.stderr)

    data = run_pulse(args.market)

    if 'error' in data:
        print(f'❌ {data["error"]}', file=sys.stderr)
        sys.exit(1)

    # Print summary to stderr
    s = data['summary']
    print(f'[intraday-pulse] total={s["total_scanned"]}, '
          f'SURGE_UP={s["surge_up_count"]}, SURGE_DOWN={s["surge_down_count"]}, '
          f'VOL_SPIKE={s["volume_spike_count"]}, STALE={s["stale_count"]}',
          file=sys.stderr)

    # Output JSON
    output_json = json.dumps(data, ensure_ascii=False, indent=2, default=str)

    if args.json_only:
        print(output_json)
    else:
        # Write to file
        if not args.output:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_path = RADAR_OUTPUT_DIR / f'intraday_pulse_EGX_{timestamp}.json'
        else:
            output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(output_json)
        print(f'[intraday-pulse] ✅ saved to {output_path}', file=sys.stderr)
        # Also print to stdout
        print(output_json)


if __name__ == '__main__':
    main()

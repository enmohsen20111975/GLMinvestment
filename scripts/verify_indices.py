#!/usr/bin/env python3
"""
verify_indices.py — قارن قيم المؤشرات المحسوبة بالقيم الحقيقية من EGX

Usage:
    python3 scripts/verify_indices.py

الـ script ده بـ:
1. يـ fetch القيم الحقيقية من beta.egx.com.eg (بـ requests)
2. يـ compute القيم بنفسنا (بـ canonical_indices.json weights + stock prices)
3. يقارن الـ computed بالـ real ويـ show الفرق
"""
import json
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CANONICAL = PROJECT_ROOT / 'vps-service' / 'data' / 'canonical_indices.json'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# EGX beta URLs (owner confirmed working 2026-10-22)
BETA_URLS = [
    'https://beta.egx.com.eg/ar/market',
    'https://beta.egx.com.eg/en/market',
    'https://beta.egx.com.eg/ar/market/investors',
]


def fetch_real_egx_values():
    """Fetch real index values from beta.egx.com.eg HTML."""
    try:
        import requests
    except ImportError:
        print("✗ requests not installed")
        return None

    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    for url in BETA_URLS:
        try:
            print(f"  trying {url}...")
            resp = requests.get(url, headers={'User-Agent': UA}, timeout=15)
            print(f"    HTTP {resp.status_code}, {len(resp.text)} chars")
            if resp.status_code == 200:
                html = resp.text
                # Search for EGX30 value — looks for patterns like "51,052.26" near "EGX30"
                import re
                # Find numbers near EGX30
                idx_egx30 = html.find('EGX30')
                if idx_egx30 == -1:
                    idx_egx30 = html.find('EGX 30')
                if idx_egx30 >= 0:
                    # Look in the next 2000 chars for a number like 51,052.26
                    window = html[idx_egx30:idx_egx30+2000]
                    nums = re.findall(r'(\d{1,3}(?:,\d{3})*(?:\.\d+)?)', window)
                    if nums:
                        print(f"    found numbers near EGX30: {nums[:5]}")
                        # The value is usually the first large number
                        for n in nums:
                            val = float(n.replace(',', ''))
                            if val > 1000:  # EGX30 is ~51000
                                return {'EGX30': val, 'url': url, 'raw': nums[:5]}
                print(f"    EGX30 keyword found but no value parsed")
            return {'html_len': len(html), 'url': url, 'egx30_found': 'EGX30' in html}
        except Exception as e:
            print(f"    failed: {e}")
    return None


def compute_egx30_with_real_weights():
    """Compute EGX30 using the corrected weights + stock prices from stocks.db."""
    if not CANONICAL.exists():
        return None, "canonical_indices.json not found"
    
    canonical = json.load(open(CANONICAL))
    egx30_data = canonical.get('EGX30', {})
    constituents = egx30_data.get('constituents', [])
    
    if not constituents:
        return None, "no EGX30 constituents"
    
    if not STOCKS_DB.exists():
        return None, "stocks.db not found"
    
    conn = sqlite3.connect(str(STOCKS_DB))
    
    # Get current prices + change_percent for each constituent
    total_weight = 0
    weighted_change = 0
    matched = 0
    details = []
    
    for c in constituents:
        ticker = c['code']
        weight = c.get('weight', 0)
        row = conn.execute(
            "SELECT current_price, previous_close, change_percent FROM stocks WHERE ticker = ?",
            (ticker,)
        ).fetchone()
        if not row:
            details.append(f"  ✗ {ticker} ({weight}%): not found in stocks.db")
            continue
        
        current, prev_close, change_pct = row
        if change_pct is None or prev_close is None or prev_close == 0:
            # compute change from prices
            if current and prev_close and prev_close > 0:
                change_pct = (current - prev_close) / prev_close * 100
            else:
                details.append(f"  ✗ {ticker} ({weight}%): no change data")
                continue
        
        total_weight += weight
        weighted_change += weight * float(change_pct)
        matched += 1
        details.append(f"  ✓ {ticker} ({weight}%): price={current}, change={change_pct:+.2f}%")
    
    conn.close()
    
    if total_weight == 0 or matched < 10:
        return None, f"insufficient data (matched={matched}, total_weight={total_weight})"
    
    avg_change = weighted_change / total_weight
    
    # Read the base (latest close from index_daily_prices, or use hardcoded as fallback)
    base = 52855  # approximate yesterday's close (open was 52854.95)
    try:
        conn2 = sqlite3.connect(str(STOCKS_DB))
        row = conn2.execute(
            "SELECT close FROM index_daily_prices WHERE symbol='EGX30' ORDER BY price_date DESC LIMIT 1"
        ).fetchone()
        conn2.close()
        if row and row[0]:
            base = float(row[0])
    except Exception:
        pass
    
    computed = base * (1 + avg_change / 100)
    
    return {
        'base': base,
        'avg_change': round(avg_change, 4),
        'computed_value': round(computed, 2),
        'matched': matched,
        'total_weight': round(total_weight, 2),
        'details': details
    }, "ok"


def main():
    print("=" * 70)
    print("  EGX Indices Verification — computed vs real")
    print("=" * 70)
    
    # 1. Fetch real values from EGX
    print("\n1. Fetching real EGX30 from beta.egx.com.eg...")
    real = fetch_real_egx_values()
    if real:
        print(f"  → Real EGX30: {real.get('EGX30', 'N/A')}")
    else:
        print("  → Could not fetch (network issue from this machine)")
    
    # 2. Compute with our weights
    print("\n2. Computing EGX30 with corrected weights (COMI=31.92% etc.)...")
    computed, msg = compute_egx30_with_real_weights()
    if computed:
        print(f"  → Computed EGX30: {computed['computed_value']}")
        print(f"    Base (prev close): {computed['base']}")
        print(f"    Weighted avg change: {computed['avg_change']}%")
        print(f"    Matched: {computed['matched']}/{computed['total_weight']}%")
        print(f"    Details (first 5):")
        for d in computed['details'][:5]:
            print(f"      {d}")
    else:
        print(f"  → Could not compute: {msg}")
    
    # 3. Compare
    print("\n3. Comparison:")
    if real and real.get('EGX30') and computed:
        real_val = real['EGX30']
        comp_val = computed['computed_value']
        diff = abs(comp_val - real_val)
        pct = (diff / real_val) * 100
        print(f"  Real:     {real_val:,.2f}")
        print(f"  Computed: {comp_val:,.2f}")
        print(f"  Diff:     {diff:,.2f} ({pct:.2f}%)")
        if pct < 1:
            print(f"  ✓ WITHIN 1% — computation is accurate!")
        elif pct < 5:
            print(f"  ⚠ within 5% — close but weights/prices may need adjustment")
        else:
            print(f"  ✗ OFF by {pct:.1f}% — check weights + base value")
    else:
        print("  (could not compare — missing real or computed value)")


if __name__ == "__main__":
    main()

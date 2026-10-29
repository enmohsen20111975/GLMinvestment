#!/usr/bin/env python3
"""
test_api_endpoints.py — Phase 4: اختبار كل API endpoints
==========================================================
بيفحص كل الـ routes المهمة ويتأكد إنها بترجع بيانات صح.

Usage:
    python3 scripts/test_api_endpoints.py
    python3 scripts/test_api_endpoints.py --base-url http://localhost:3000
"""
import sys
import json
import argparse
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3000"

def fetch(url, timeout=30):
    """جلب URL ورجاع الـ JSON."""
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return resp.status, data
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode('utf-8'))
        except:
            data = None
        return e.code, data
    except Exception as e:
        return 0, {'error': str(e)}


def test_endpoint(path, market=None, expected_key='success'):
    """اختبر endpoint واحد."""
    url = f"{BASE_URL}{path}"
    if market:
        url += f"{'&' if '?' in url else '?'}market={market}"
    
    status, data = fetch(url)
    
    if status == 200 and data and data.get(expected_key, True):
        return '✓', status, data
    elif status == 200:
        return '⚠', status, data
    else:
        return '✗', status, data


def main():
    global BASE_URL
    parser = argparse.ArgumentParser(description='Test all API endpoints')
    parser.add_argument('--base-url', default='http://localhost:3000')
    args = parser.parse_args()
    BASE_URL = args.base_url.rstrip('/')
    
    print(f"{'='*60}")
    print(f"  Phase 4 — API Endpoints Test")
    print(f"  Base URL: {BASE_URL}")
    print(f"{'='*60}\n")
    
    passed = 0
    warnings = 0
    failed = 0
    
    # 1. Health
    print("─── Health ───")
    icon, status, data = test_endpoint('/api/health')
    if icon == '✓':
        passed += 1
        s = data.get('summary', {}) if data else {}
        print(f"  {icon} /api/health ({status})")
        print(f"    DBs: {s.get('databases_ok',0)}/{s.get('databases_total',0)}")
        print(f"    Markets: {s.get('active_markets',0)} | Stocks: {s.get('active_stocks',0)}")
        print(f"    Predictions: {s.get('active_predictions',0)}")
    else:
        failed += 1
        print(f"  {icon} /api/health ({status}) — {str(data)[:100] if data else 'no response'}")
    
    # 2. Stocks per market
    print("\n─── Stocks ───")
    for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
        icon, status, data = test_endpoint('/api/stocks', market=market)
        if icon == '✓':
            count = len(data.get('stocks', [])) if data else 0
            if count > 0:
                passed += 1
                print(f"  {icon} {market}: {count} stocks")
            else:
                warnings += 1
                print(f"  ⚠ {market}: 0 stocks (empty)")
        else:
            failed += 1
            print(f"  {icon} {market}: {status} — {str(data)[:80] if data else 'error'}")
    
    # 3. Market indices
    print("\n─── Indices ───")
    for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
        icon, status, data = test_endpoint('/api/market/indices', market=market)
        if icon == '✓':
            count = len(data.get('indices', [])) if data else 0
            if count > 0:
                passed += 1
                print(f"  {icon} {market}: {count} indices")
            else:
                warnings += 1
                print(f"  ⚠ {market}: 0 indices")
        else:
            failed += 1
            print(f"  {icon} {market}: {status}")
    
    # 4. Market overview
    print("\n─── Market Overview ───")
    for market in ['EGX', 'TADAWUL']:
        icon, status, data = test_endpoint('/api/market/overview', market=market)
        if icon == '✓':
            passed += 1
            s = data.get('summary', {}) if data else {}
            print(f"  {icon} {market}: {s.get('total_stocks','?')} stocks | advancing={s.get('advancing','?')}")
        else:
            failed += 1
            print(f"  {icon} {market}: {status}")
    
    # 5. Predictions
    print("\n─── Predictions ───")
    icon, status, data = test_endpoint('/api/predictions/honest-tracking/list', market='EGX')
    if icon == '✓':
        passed += 1
        count = len(data.get('predictions', [])) if data else 0
        print(f"  {icon} predictions EGX: {count} predictions")
    else:
        warnings += 1
        print(f"  {icon} predictions EGX: {status} — {str(data)[:80] if data else 'error'}")
    
    # 6. Market regime
    print("\n─── Market Regime ───")
    for market in ['EGX', 'TADAWUL']:
        icon, status, data = test_endpoint('/api/market/regime', market=market)
        if icon == '✓':
            passed += 1
            regime = data.get('regime', data.get('current_regime', '?')) if data else '?'
            print(f"  {icon} {market}: regime={regime}")
        else:
            failed += 1
            print(f"  {icon} {market}: {status}")
    
    # 7. Top movers
    print("\n─── Top Movers ───")
    icon, status, data = test_endpoint('/api/market/top-movers', market='EGX')
    if icon == '✓':
        passed += 1
        gainers = len(data.get('gainers', [])) if data else 0
        losers = len(data.get('losers', [])) if data else 0
        print(f"  {icon} EGX: {gainers} gainers | {losers} losers")
    else:
        warnings += 1
        print(f"  {icon} EGX: {status}")
    
    # Summary
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")
    print(f"  ✓ Passed:    {passed}")
    print(f"  ⚠ Warnings:  {warnings}")
    print(f"  ✗ Failed:    {failed}")
    total = passed + warnings + failed
    print(f"  Total:       {total}")
    if failed == 0:
        print(f"\n  ✅ النظام جاهز — كل الـ APIs شغّالة!")
    else:
        print(f"\n  ⚠️  فيه {failed} endpoints مش شغّالة — محتاجين إصلاح")
    print(f"{'='*60}")
    
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

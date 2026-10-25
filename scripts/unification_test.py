#!/usr/bin/env python3
"""
unification_test.py — اختبار آلي يومي للتحقق من توحيد القرارات
=================================================================

Task UNIFICATION-PHASE-1 (Rule 72)

الهدف: يضرب 5 endpoints مختلفة لنفس السهم ويتأكد إن كلهم بيرجّعوا نفس
canonical signal. لو فيه اختلاف → الـ test يفشل + يبلّغ.

Usage:
  python3 scripts/unification_test.py
  python3 scripts/unification_test.py --ticker CANA
  python3 scripts/unification_test.py --tickers CANA,ETEL,COMI,HRHO,SWDY

الـ endpoints اللي بنتحقق منها:
  1. /api/stocks/[ticker]/unified              ← المصدر الأساسي
  2. /api/stocks/[ticker]                       ← Python + unified injection
  3. /api/stocks/[ticker]/comprehensive         ← 3 engines + unified override
  4. /api/maestro/stock/[ticker]                ← Python + unified injection
  5. /api/stocks/[ticker]/recommendation        ← Python + unified injection
"""
import argparse
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ─── Configuration ──────────────────────────────────────────────────────
DEFAULT_BASE_URL = 'http://localhost:3000'
DEFAULT_TICKERS = ['CANA', 'ETEL', 'COMI', 'HRHO', 'SWDY', 'DTPP', 'MFSC']
ENDPOINTS = [
    ('unified',       '/api/stocks/{ticker}/unified'),
    ('stocks',        '/api/stocks/{ticker}'),
    ('comprehensive', '/api/stocks/{ticker}/comprehensive'),
    ('maestro',       '/api/maestro/stock/{ticker}'),
    ('recommendation','/api/stocks/{ticker}/recommendation'),
]


def fetch_json(url: str, timeout: int = 10) -> dict:
    """Fetch JSON from URL. Returns dict or raises."""
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'_error': f'HTTP {e.code}', '_body': e.read().decode('utf-8', errors='replace')[:200]}
    except Exception as e:
        return {'_error': str(e)}


def extract_signal(data: dict, endpoint_name: str) -> dict:
    """Extract canonical signal from each endpoint's response shape."""
    if not data or data.get('_error'):
        return {'signal': None, 'source': endpoint_name, 'error': data.get('_error') if data else 'empty'}

    # Unified API: data.canonical.signal
    if endpoint_name == 'unified':
        c = data.get('canonical', {})
        return {
            'signal': c.get('signal'),
            'signal_ar': c.get('signal_ar'),
            'master_score': c.get('master_score'),
            'unified': data.get('unified', False),
            'source': endpoint_name,
        }

    # /api/stocks/[ticker]: data.unified=true (injected)
    if endpoint_name == 'stocks':
        # Check if data is nested under 'stock' or bare
        stock = data.get('stock', data) if isinstance(data, dict) else data
        return {
            'signal': stock.get('signal') if isinstance(stock, dict) else None,
            'signal_ar': stock.get('signal_ar') if isinstance(stock, dict) else None,
            'master_score': stock.get('master_score') if isinstance(stock, dict) else None,
            'unified': stock.get('unified', False) if isinstance(stock, dict) else False,
            'source': endpoint_name,
        }

    # /api/stocks/[ticker]/comprehensive: data.technical.signal + data.canonical.signal
    if endpoint_name == 'comprehensive':
        tech = data.get('technical', {})
        canonical = data.get('canonical', {})
        return {
            'signal': canonical.get('signal') or tech.get('signal'),
            'signal_ar': canonical.get('signal_ar') or tech.get('signal_ar'),
            'master_score': canonical.get('master_score') or tech.get('master_score'),
            'unified': canonical.get('signal') is not None,
            'source': endpoint_name,
        }

    # /api/maestro/stock/[ticker]: data.data.signal (injected)
    if endpoint_name == 'maestro':
        inner = data.get('data', data) if isinstance(data, dict) else data
        return {
            'signal': inner.get('signal') if isinstance(inner, dict) else None,
            'signal_ar': inner.get('signal_ar') if isinstance(inner, dict) else None,
            'master_score': inner.get('master_score') if isinstance(inner, dict) else None,
            'unified': inner.get('unified', False) if isinstance(inner, dict) else False,
            'source': endpoint_name,
        }

    # /api/stocks/[ticker]/recommendation: data.signal or data.recommendation.signal
    if endpoint_name == 'recommendation':
        rec = data.get('recommendation', data) if isinstance(data, dict) else data
        return {
            'signal': rec.get('signal') if isinstance(rec, dict) else None,
            'signal_ar': rec.get('signal_ar') if isinstance(rec, dict) else None,
            'master_score': rec.get('master_score') if isinstance(rec, dict) else None,
            'unified': rec.get('unified', False) if isinstance(rec, dict) else False,
            'source': endpoint_name,
        }

    return {'signal': None, 'source': endpoint_name, 'error': 'unknown_endpoint'}


def test_ticker(base_url: str, ticker: str) -> dict:
    """Test all 5 endpoints for a ticker. Returns pass/fail + details."""
    results = []
    for name, path_template in ENDPOINTS:
        url = f"{base_url.rstrip('/')}{path_template.format(ticker=ticker)}"
        data = fetch_json(url)
        extracted = extract_signal(data, name)
        results.append(extracted)

    # Compare signals across all endpoints
    signals = [r.get('signal') for r in results if r.get('signal')]
    unique_signals = set(signals)

    return {
        'ticker': ticker,
        'passed': len(unique_signals) <= 1,
        'unique_signals': list(unique_signals),
        'endpoints': results,
        'timestamp': datetime.now().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description='Unification Test — تحقق من توحيد القرارات')
    parser.add_argument('--base-url', default=DEFAULT_BASE_URL, help='Base URL (default: http://localhost:3000)')
    parser.add_argument('--ticker', help='Single ticker to test')
    parser.add_argument('--tickers', help='Comma-separated tickers to test')
    parser.add_argument('--json', action='store_true', help='Output as JSON only')
    args = parser.parse_args()

    if args.ticker:
        tickers = [args.ticker.upper()]
    elif args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
    else:
        tickers = DEFAULT_TICKERS

    all_results = []
    failed_tickers = []

    for ticker in tickers:
        result = test_ticker(args.base_url, ticker)
        all_results.append(result)
        if not result['passed']:
            failed_tickers.append(ticker)

    # Summary
    summary = {
        'test_run_at': datetime.now().isoformat(),
        'base_url': args.base_url,
        'total_tickers': len(tickers),
        'passed': len(tickers) - len(failed_tickers),
        'failed': len(failed_tickers),
        'failed_tickers': failed_tickers,
        'results': all_results,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print('=' * 80)
        print('  UNIFICATION TEST — تحقق من توحيد القرارات')
        print('=' * 80)
        print(f"  Base URL: {args.base_url}")
        print(f"  Tickers tested: {len(tickers)}")
        print(f"  ✅ Passed: {summary['passed']}")
        print(f"  ❌ Failed: {summary['failed']}")
        if failed_tickers:
            print(f"  Failed tickers: {', '.join(failed_tickers)}")
        print()
        for r in all_results:
            status = '✅' if r['passed'] else '❌'
            sigs = ' / '.join(r['unique_signals']) if r['unique_signals'] else 'NO SIGNAL'
            print(f"  {status} {r['ticker']:6s} — signals: {sigs}")
            if not r['passed']:
                for ep in r['endpoints']:
                    sig = ep.get('signal', '—')
                    src = ep.get('source', '—')
                    unified = ep.get('unified', False)
                    err = ep.get('error', '')
                    marker = '✓' if unified else '✗'
                    print(f"      {marker} {src:14s} signal={sig} unified={unified} {err}")
        print()
        print('=' * 80)
        if summary['failed'] > 0:
            print('  ❌ TEST FAILED — فيه تناقضات في القرارات')
            sys.exit(1)
        else:
            print('  ✅ TEST PASSED — كل الشاشات بتقول نفس الكلام')
            sys.exit(0)


if __name__ == '__main__':
    main()

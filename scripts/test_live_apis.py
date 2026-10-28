import urllib.request
import json

def test_url(name, url):
    print(f"\n==================== {name} ====================")
    print("URL:", url)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            print("Status: 200 OK")
            if isinstance(data, dict):
                print("Keys:", list(data.keys()))
                if 'resolvedTicker' in data:
                    print(f"Chart Ticker: {data.get('ticker')} | Source: {data.get('source')} | Count: {data.get('count')}")
                    if data.get('data'):
                        print(f"Last candle: {data.get('data')[-1]}")
                if 'predictions' in data:
                    preds = data['predictions']
                    print(f"Predictions count: {len(preds)}")
                    for p in preds[:5]:
                        print(f"  Ticker: {p.get('ticker')} | Entry: {p.get('entry_price')} | Current: {p.get('current_price')} | SL: {p.get('stop_loss')} | Target: {p.get('target_price')} | Logo: {bool(p.get('logo_url') or p.get('logoUrl'))}")
                if 'candidates' in data:
                    cands = data['candidates']
                    print(f"Incubator candidates count: {len(cands)}")
                    print(f"Timestamp: {data.get('timestamp')}")
                    print(f"Source: {data.get('source')} | is_fresh: {data.get('is_fresh')}")
                    for c in cands[:5]:
                        print(f"  Ticker: {c.get('ticker')} | Price: {c.get('current_price')} | Readiness: {c.get('readiness_pct')}% | Signals: {c.get('signals_passed')}/{c.get('total_signals')}")
                if 'data' in data and isinstance(data['data'], dict):
                    sparks = data['data']
                    print(f"Sparklines count: {len(sparks)}")
                    for t, s in sparks.items():
                        print(f"  Ticker: {t} | source: {s.get('source')} | days: {s.get('days')} | min: {s.get('min')} | max: {s.get('max')} | prices_count: {len(s.get('prices', []))}")
                elif 'data' in data and isinstance(data['data'], list):
                    items = data['data']
                    print(f"Stored analysis items count: {len(items)}")
                    for it in items[:5]:
                        print(f"  Ticker: {it.get('ticker')} | Name: {it.get('name_ar') or it.get('name')} | Price: {it.get('current_price')} | Logo: {bool(it.get('logo_url') or it.get('logoUrl'))} | logo_url: {it.get('logo_url')}")
            elif isinstance(data, list):
                print(f"Array count: {len(data)}")
                if data:
                    print("Sample:", data[0])
    except Exception as e:
        print("Error:", e)

test_url("1. UNIFIED PREDICTIONS", "http://127.0.0.1:3000/api/unified/predictions?market=EGX&limit=5")
test_url("2. INCUBATOR", "http://127.0.0.1:3000/api/radar/incubator?market=EGX")
test_url("3. SPARKLINES", "http://127.0.0.1:3000/api/stocks/sparkline?tickers=COMI,FIRE,EAST,EGX30")
test_url("4. CHART COMI", "http://127.0.0.1:3000/api/chart/COMI")
test_url("5. FUNDAMENTALS COMI", "http://127.0.0.1:3000/api/maker-radar/fundamentals?ticker=COMI")
test_url("6. TAB DATA HIGHEST CASH", "http://127.0.0.1:3000/api/tab-data?market=EGX&tab=highest_cash")

import sqlite3
c = sqlite3.connect('db/predictions.db')
print("\n=== predictions.db check ===")
rows = c.execute("SELECT id, ticker, entry_price, target_price, stop_loss, prediction_date, status FROM predictions ORDER BY id DESC LIMIT 5").fetchall()
print("Latest 5 predictions:", rows)
c.close()

#!/usr/bin/env python3
import json
import urllib.request

def fetch(url):
    try:
        with urllib.request.urlopen(url) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {"error": str(e)}

print("=== CHECKING PRICE SYNCHRONIZATION (COMI & AJWA) ===")
# 1. Unified
comi_u = fetch("http://localhost:3000/api/stocks/COMI/unified")
ajwa_u = fetch("http://localhost:3000/api/stocks/AJWA/unified")

print("Keys in Unified COMI:", list(comi_u.keys()))
if "data" in comi_u:
    print("Keys in comi_u['data']:", list(comi_u['data'].keys()))
    print("Price in data:", comi_u['data'].get('price'), comi_u['data'].get('close'), comi_u['data'].get('current_price'))
elif "stock" in comi_u:
    print("Keys in comi_u['stock']:", list(comi_u['stock'].keys()))
    print("Price in stock:", comi_u['stock'].get('price'), comi_u['stock'].get('close'), comi_u['stock'].get('current_price'))
else:
    print("Top-level price:", comi_u.get('price'), comi_u.get('close'), comi_u.get('current_price'))

# 2. Chart latest
comi_chart = fetch("http://localhost:3000/api/chart/COMI?interval=D&period=1d&asset=stock")
if comi_chart.get("data") and len(comi_chart["data"]) > 0:
    print(f"Chart COMI latest close: {comi_chart['data'][-1].get('close')} (source: {comi_chart.get('source', comi_chart['data'][-1].get('source'))})")
else:
    print("Chart COMI: no data")

# 3. Maker radar
radar = fetch("http://localhost:3000/api/maker-radar")
radar_stocks = radar.get("data", radar.get("stocks", []))
for s in radar_stocks:
    if s.get("ticker") in ["COMI", "AJWA"]:
        print(f"Radar {s.get('ticker')}: price = {s.get('current_price', s.get('price'))}")

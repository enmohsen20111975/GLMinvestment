#!/usr/bin/env python3
import urllib.request
import json

url = "http://localhost:3000/api/market-pulse?market=EGX"
with urllib.request.urlopen(url) as resp:
    data = json.loads(resp.read().decode('utf-8'))

data_obj = data.get("data", {})
top = data_obj.get("top_sector")
print("Top Sector:", top)
sectors = data_obj.get("sectors", [])
print(f"Total Sectors: {len(sectors)}")
for s in sectors[:5]:
    print(f"  Sector: '{s.get('sector')}' | Turnover Pct: {s.get('turnover_pct')}% | Avg Chg: {s.get('avg_change')}%")

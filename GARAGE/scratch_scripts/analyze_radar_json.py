#!/usr/bin/env python3
import json

with open('/home/meme/my_apps/GLMinvestment/scripts/output/maker_radar_EGX_20261013.json') as f:
    data = json.load(f)

print("Top level keys:", list(data.keys()))
if isinstance(data, list):
    print("Data is a list of length:", len(data))
    stocks = data
elif "results" in data:
    stocks = data["results"]
elif "items" in data:
    stocks = data["items"]
elif "radar" in data:
    stocks = data["radar"]
else:
    for k, v in data.items():
        if isinstance(v, list):
            print(f"Key '{k}' is a list of len {len(v)}")
        elif isinstance(v, dict):
            print(f"Key '{k}' is a dict of len {len(v)}")

status_counts = {}
for s in stocks:
    st = s.get("maker_status", s.get("status", "unknown"))
    status_counts[st] = status_counts.get(st, 0) + 1

print("Status distribution:", status_counts)

# Find top stocks
top_by_score = sorted(stocks, key=lambda x: x.get("maker_score", 0), reverse=True)[:5]
print("\nTop 5 by maker_score:")
for s in top_by_score:
    print(f"Ticker: {s.get('ticker')}, Score: {s.get('maker_score')}, Status: {s.get('maker_status')}, Price: {s.get('current_price')}")

# Check AJWA specifically
for s in stocks:
    if s.get("ticker") == "AJWA":
        print("\n=== AJWA details in Radar JSON ===")
        print("Price:", s.get("current_price"))
        print("Maker Status:", s.get("maker_status"))
        print("Maker Score:", s.get("maker_score"))
        print("Wyckoff:", s.get("wyckoff_phase"), s.get("wyckoff_event"))
        print("Notes:", s.get("notes"))
        print("MFI:", s.get("mfi"))

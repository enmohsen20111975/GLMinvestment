#!/usr/bin/env python3
import urllib.request
import json

endpoints = [
    "/api/stocks/AJWA",
    "/api/stocks/AJWA/unified",
    "/api/stocks/AJWA/comprehensive",
    "/api/stocks/AJWA/professional-analysis",
    "/api/stocks/AJWA/expert-analysis",
    "/api/stocks/AJWA/recommendation",
    "/api/stocks/AJWA/gate-analysis"
]

for ep in endpoints:
    url = f"http://localhost:3000{ep}"
    try:
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f"=== {ep} ===")
            # Look for price fields
            price = (data.get("price") or 
                     data.get("current_price") or 
                     data.get("stock", {}).get("current_price") or 
                     data.get("stock", {}).get("price") or
                     data.get("data", {}).get("current_price") or
                     data.get("data", {}).get("price"))
            change = (data.get("change_percent") or 
                      data.get("stock", {}).get("change_percent") or 
                      data.get("data", {}).get("change_percent"))
            print(f"Price: {price}, Change: {change}")
    except Exception as e:
        print(f"=== {ep} === Error: {e}")

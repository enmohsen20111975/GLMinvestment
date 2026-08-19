import urllib.request
import json

def fetch_stats():
    try:
        req = urllib.request.Request("http://127.0.0.1:8010/api/predictions/tracking/stats?market=EGX&days=30")
        with urllib.request.urlopen(req) as res:
            print(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")

fetch_stats()

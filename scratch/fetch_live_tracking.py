import urllib.request
import json
import urllib.parse

def fetch_live_tracking():
    try:
        url = "http://127.0.0.1:8010/api/stored-analysis/live-tracking?market=EGX&days=30&limit=500"
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req) as res:
            data = json.loads(res.read().decode('utf-8'))
            print("Total:", data.get('stats', {}).get('total'))
            print("WinRate:", data.get('stats', {}).get('winRate'))
            print("ProfitFactor:", data.get('stats', {}).get('profitFactor'))
    except Exception as e:
        print(f"Error: {e}")

fetch_live_tracking()

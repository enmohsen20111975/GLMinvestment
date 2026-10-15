import urllib.request
import json

try:
    with urllib.request.urlopen("http://localhost:3000/api/stocks/ORAS/unified") as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print("Canonical:", data.get('canonical'))
        print("Prediction:", data.get('prediction'))
        print("Technical:", data.get('technical'))
except Exception as e:
    print("Error:", e)

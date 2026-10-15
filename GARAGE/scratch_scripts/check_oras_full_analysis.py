import urllib.request
import json

try:
    with urllib.request.urlopen("http://localhost:3000/api/v2/chart/full-analysis?ticker=ORAS&limit=100") as resp:
        data = json.loads(resp.read().decode('utf-8'))
        dec = data.get('institutional_decision', {})
        print("Signal final:", dec.get('signal_final'))
        print("Risk profile:", dec.get('risk_profile'))
        print("Tech score:", dec.get('score'))
        print("Gates:", dec.get('gates_passed'))
except Exception as e:
    print("Error:", e)

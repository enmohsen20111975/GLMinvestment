import urllib.request
import json

markets = ['egx', 'tadawul', 'us', 'crypto', 'kuwait', 'qatar']
print("--- TESTING /api/subscription/plans ---")
for m in markets:
    try:
        url = f"http://localhost:3000/api/subscription/plans?market={m}"
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read().decode())
            plans = data.get("plans", [])
            print(f"Market [{m:7}]: HTTP 200 | success={data.get('success')} | plans_count={len(plans)}")
            for p in plans[:2]:
                print(f"   -> Tier: {p.get('tier')} | Price: {p.get('price_local')} {p.get('currency')} | Cycle: {p.get('billing_cycle')}")
    except Exception as e:
        print(f"Market [{m:7}]: ERROR: {e}")

print("\n--- TESTING /api/subscription/current (guest) ---")
try:
    with urllib.request.urlopen("http://localhost:3000/api/subscription/current", timeout=5) as r:
        data = json.loads(r.read().decode())
        print(f"Current subscription (guest): success={data.get('success')}, tier={data.get('tier')}, msg={data.get('message')}")
except Exception as e:
    print(f"Current subscription error: {e}")

print("\n--- TESTING /api/subscription/status (guest) ---")
try:
    with urllib.request.urlopen("http://localhost:3000/api/subscription/status", timeout=5) as r:
        data = json.loads(r.read().decode())
        print(f"Status subscription (guest): success={data.get('success')}, tier={data.get('tier')}, status={data.get('status')}")
except Exception as e:
    print(f"Status subscription error: {e}")

import urllib.request
import json

def test_api():
    url = "http://127.0.0.1:8010/api/unified/predictions?market=EGX&limit=10"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            preds = data.get('predictions', [])
            if preds:
                print("Item keys:", list(preds[0].keys()))
                for p in preds[:5]:
                    print(f"Ticker: {p.get('ticker')} | entry: {p.get('entry_price')} | curr: {p.get('current_price')} | high: {p.get('high_price')} | low: {p.get('low_price')} | max_h: {p.get('max_high_since_pred')} | min_l: {p.get('min_low_since_pred')}")
    except Exception as e:
        print("API Error:", e)

if __name__ == '__main__':
    test_api()

import json
import urllib.request
import sqlite3

def run():
    print("=== 1. PREDICTIONS IN DB ===")
    conn = sqlite3.connect('db/predictions.db')
    c = conn.cursor()
    c.execute("SELECT status, count(*) FROM predictions GROUP BY status")
    print("DB predictions by status:", c.fetchall())

    c.execute("SELECT ticker, signal, entry_price, target_price, stop_loss FROM predictions WHERE status IN ('active', 'PENDING', 'open') LIMIT 5")
    print("Sample active predictions in DB:", c.fetchall())
    conn.close()

    print("\n=== 2. API /api/unified/predictions ===")
    try:
        url = 'http://127.0.0.1:3000/api/unified/predictions?market=EGX&limit=1000'
        req = urllib.request.urlopen(url)
        data = json.loads(req.read().decode('utf-8'))
        preds = data.get('predictions') or []
        print("Total returned predictions:", len(preds))
        statuses = set(p.get('status') for p in preds)
        print("Statuses returned:", statuses)
        active_preds = [p for p in preds if str(p.get('status','')).lower() in ['active', 'pending', 'open', 'triggered']]
        print("Active/pending predictions count:", len(active_preds))
        if active_preds:
            p0 = active_preds[0]
            print("Sample active prediction ticker:", p0.get('ticker'), "entry_price:", p0.get('entry_price'), "target:", p0.get('target_price'), "stop:", p0.get('stop_loss'))
    except Exception as e:
        print("Error checking predictions API:", e)

    print("\n=== 3. RADAR CACHE FILE ===")
    try:
        with open('scripts/output/maker_radar_EGX_20261009.json') as f:
            radar = json.load(f)
        stocks = radar.get('under_microscope') or radar.get('all_results') or []
        print("Radar stocks count:", len(stocks))
        if stocks:
            sample = stocks[0]
            print("Radar stock ticker:", sample.get('ticker'))
            print("Radar stock has support:", 'support' in sample, sample.get('support'))
            print("Radar stock has resistance:", 'resistance' in sample, sample.get('resistance'))
            print("Radar stock has entry_price:", 'entry_price' in sample, sample.get('entry_price'))
            print("Radar stock has range_10d_pct:", sample.get('range_10d_pct'))
            print("Radar stock current_price:", sample.get('current_price'))
    except Exception as e:
        print("Error checking radar cache:", e)

    print("\n=== 4. SCREENER API ===")
    try:
        url = 'http://127.0.0.1:3000/api/screener/advanced?limit=5'
        req = urllib.request.urlopen(url)
        sdata = json.loads(req.read().decode('utf-8'))
        print("Screener summary:", sdata.get('summary'))
        sstocks = sdata.get('stocks') or []
        for s in sstocks[:3]:
            print("Screener stock:", s.get('ticker'), "price:", s.get('current_price'), "volume:", s.get('volume'), "turnover_egp:", s.get('turnover_egp'), "pe_ratio:", s.get('pe_ratio'))
    except Exception as e:
        print("Error checking screener API:", e)

if __name__ == '__main__':
    run()

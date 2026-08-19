import sqlite3
import json
import sys

def migrate_predictions():
    try:
        conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
        conn.row_factory = sqlite3.Row
        
        print("Fetching predictions...")
        rows = conn.execute("SELECT * FROM predictions WHERE status = 'active' OR status = 'STOPPED' OR status = 'TARGET_HIT'").fetchall()
        
        print(f"Found {len(rows)} predictions to migrate.")
        
        conn.execute("DELETE FROM hunter_pick_tracking")
        
        count = 0
        for row in rows:
            d = dict(row)
            
            # Map status
            status = 'pending'
            if d['status'] == 'STOPPED':
                status = 'stop_hit'
            elif d['status'] == 'TARGET_HIT':
                status = 'target_hit'
                
            narrative = json.dumps([d['notes']] if d.get('notes') else [])
            personas = json.dumps({"primary": d.get('persona', 'balanced')})
            
            conn.execute("""
                INSERT INTO hunter_pick_tracking (
                    ticker, market, entry_price, stop_loss, target_price,
                    risk_reward, pick_date, status, narrative, personas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                d['ticker'],
                d['market'] or 'EGX',
                d['entry_price'] or 0,
                d['stop_loss'] or 0,
                d['target_price'] or 0,
                d['risk_reward'] or 0,
                d['prediction_date'] or '',
                status,
                narrative,
                personas
            ))
            count += 1
            
        conn.commit()
        print(f"Migrated {count} rows to hunter_pick_tracking.")
        
    except Exception as e:
        print("Error:", e)
        sys.exit(1)

migrate_predictions()

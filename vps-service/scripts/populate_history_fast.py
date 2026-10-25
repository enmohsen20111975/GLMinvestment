import sqlite3
import datetime

def populate():
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    print("Populating predictions table from stored_analyses for fast UI display...")
    pred_db = 'db/predictions.db'
    prices_db = 'db/price_history.db'
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_p = db_manager.get_connection(pred_db, writable=False)
    conn_p.row_factory = sqlite3.Row
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_h = db_manager.get_connection(prices_db, writable=False)
    conn_h.row_factory = sqlite3.Row
    
    # 1. Fetch from stored_analyses
    analyses = conn_p.execute('''
        SELECT ticker, created_at, recommendation as signal, entry_price, target_price, stop_loss,
               maestro_score, confidence, risk_reward, is_gambler_opportunity, is_investor_opportunity
        FROM stored_analyses
        WHERE LOWER(recommendation) IN ('buy', 'strong_buy', 'accumulate')
          AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
    ''').fetchall()
    
    print(f"Found {len(analyses)} signals in stored_analyses.")
    if not analyses:
        print("No analyses found. Did you run the backfill or trigger analysis?")
        return
        
    records_to_insert = []
    
    for a in analyses:
        ticker = a['ticker']
        pred_date = a['created_at'].split(' ')[0]
        
        # Get prices AFTER the prediction date
        future_prices = conn_h.execute('''
            SELECT date, high_price, low_price, close_price 
            FROM price_history 
            WHERE ticker = ? AND date > ? 
            ORDER BY date ASC LIMIT 30
        ''', (ticker, pred_date)).fetchall()
        
        entry = a['entry_price']
        target = a['target_price']
        stop = a['stop_loss']
        
        outcome_date = None
        hit_target = 0
        hit_stop = 0
        actual_return = None
        holding_days = 0
        exit_price = None
        is_correct = None
        
        if future_prices:
            for i, fp in enumerate(future_prices):
                high = fp['high_price']
                low = fp['low_price']
                
                # Did it hit target first?
                if high >= target:
                    hit_target = 1
                    actual_return = ((target - entry) / entry) * 100
                    outcome_date = fp['date']
                    holding_days = i + 1
                    exit_price = target
                    is_correct = 1
                    break
                    
                # Did it hit stop loss first?
                if low <= stop:
                    hit_stop = 1
                    actual_return = ((stop - entry) / entry) * 100
                    outcome_date = fp['date']
                    holding_days = i + 1
                    exit_price = stop
                    is_correct = 0
                    break
                    
            if outcome_date is None:
                # Still pending
                last_close = future_prices[-1]['close_price']
                actual_return = ((last_close - entry) / entry) * 100
                holding_days = len(future_prices)
                
        # Determine persona
        persona = 'gambler' if a['is_gambler_opportunity'] else 'balanced'
                
        records_to_insert.append((
            ticker, persona, a['signal'], a['signal'], a['created_at'], entry, target, stop,
            a['maestro_score'], a['confidence'], a['risk_reward'], 
            hit_target, hit_stop, is_correct, holding_days,
            outcome_date, exit_price, actual_return,
            'clean', 'active'
        ))
        
    print(f"Prepared {len(records_to_insert)} records for predictions table.")
    
    # 2. Insert into predictions
    try:
        cur = conn_p.cursor()
        cur.executemany('''
            INSERT INTO predictions
            (ticker, persona, signal, signal_type, prediction_date, entry_price, target_price, stop_loss,
             master_score, confidence, risk_reward, 
             hit_target, hit_stop, is_correct, holding_days,
             outcome_date, exit_price, actual_return,
             data_quality, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', records_to_insert)
        conn_p.commit()
        print("Successfully populated predictions table!")
    except Exception as e:
        print(f"Error inserting: {e}")
        
    conn_p.close()
    conn_h.close()

if __name__ == '__main__':
    # Task FINALIZE-UNIFICATION: non-canonical writer disabled (Rule 35).
    # V40.2 (daily_predictor.py) is the ONLY writer to predictions.db.
    # To re-enable: remove this guard. Do NOT delete (Rule 16).
    import sys
    print('[FINALIZE-UNIFICATION] GUARD: populate_history_fast.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer.')
    sys.exit(0)
    populate()

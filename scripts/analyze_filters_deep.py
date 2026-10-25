import sqlite3
import json
import re
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

from utils.entry_gate import check_entry_gate

def parse_volume(vol_str):
    if vol_str is None:
        return 0.0
    if isinstance(vol_str, (int, float)):
        return float(vol_str)
    s = str(vol_str).strip().upper().replace(',', '')
    if not s or s == 'NAN':
        return 0.0
    mult = 1.0
    if s.endswith('K'):
        mult = 1_000
        s = s[:-1]
    elif s.endswith('M'):
        mult = 1_000_000
        s = s[:-1]
    elif s.endswith('B'):
        mult = 1_000_000_000
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return 0.0

def load_price_history(ticker, before_date, max_days=300):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    cur = conn.cursor()
    date_str = str(before_date)[:10]
    cur.execute("""
        SELECT price_date, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND price_date <= ?
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, date_str, max_days))
    rows = cur.fetchall()
    conn.close()
    rows = list(reversed(rows))
    closes = [float(r[1]) for r in rows if r[1] is not None]
    vols = [parse_volume(r[2]) for r in rows]
    return closes, vols

def extract_rsi(analysis_json):
    if not analysis_json:
        return None
    try:
        data = json.loads(analysis_json) if isinstance(analysis_json, str) else analysis_json
        rsi = data.get('rsi')
        if rsi is not None:
            return float(rsi)
        tech = str(data.get('technicals', ''))
        m = re.search(r'RSI[:\s]+(\d+(?:\.\d+)?)', tech)
        if m:
            return float(m.group(1))
    except Exception:
        pass
    return None

def evaluate_dataset(dataset, name=""):
    total = len(dataset)
    passed_trades = []
    rejected_trades = []
    
    for row in dataset:
        (ticker, signal, pred_date, entry, target, stop,
         ret, correct, analysis_json, market, score, signal_type) = row
        
        is_win = int(correct) == 1
        closes, volumes = load_price_history(ticker, pred_date, max_days=300)
        
        if len(closes) < 5:
            # Not enough data -> pass by default
            passed_trades.append((row, True, []))
            continue
            
        rsi = extract_rsi(analysis_json)
        
        gate_data = {
            'entry_price': float(entry),
            'target_price': float(target) if target else float(entry) * 1.15,
            'stop_price': float(stop) if stop else float(entry) * 0.92,
            'evidence_count': 4,
            'proofs': {'benchmark': '✅ أقوى'},
            'closes': closes,
            'volumes': volumes,
            'market_regime_trend': 'neutral',
            'stock_roc': 5.0,
            'benchmark_change': 0.0,
            'signal_type': signal_type or signal,
            'score': int(score) if score else 50,
            'high_52w': None,
            'low_52w': None,
            'rsi': rsi,
        }
        
        try:
            gate_res = check_entry_gate(gate_data)
            passed = gate_res.get('passed', True)
            reasons = gate_res.get('reasons_failed', [])
        except Exception:
            passed = True
            reasons = []
            
        if passed:
            passed_trades.append((row, True, reasons))
        else:
            rejected_trades.append((row, False, reasons))
            
    pass_cnt = len(passed_trades)
    pass_wins = sum(1 for t, _, _ in passed_trades if int(t[7]) == 1)
    pass_wr = (pass_wins / pass_cnt * 100) if pass_cnt else 0
    pass_ret = sum(float(t[6]) for t, _, _ in passed_trades) / pass_cnt if pass_cnt else 0
    pos_ret = sum(float(t[6]) for t, _, _ in passed_trades if float(t[6]) > 0)
    neg_ret = abs(sum(float(t[6]) for t, _, _ in passed_trades if float(t[6]) < 0))
    pass_pf = (pos_ret / neg_ret) if neg_ret > 0 else 999.0

    rej_cnt = len(rejected_trades)
    rej_wins = sum(1 for t, _, _ in rejected_trades if int(t[7]) == 1)
    rej_wr = (rej_wins / rej_cnt * 100) if rej_cnt else 0
    rej_ret = sum(float(t[6]) for t, _, _ in rejected_trades) / rej_cnt if rej_cnt else 0

    all_wins = sum(1 for r in dataset if int(r[7]) == 1)
    all_wr = (all_wins / total * 100) if total else 0
    all_ret = sum(float(r[6]) for r in dataset) / total if total else 0

    print(f"\n==================== {name} ====================")
    print(f"Total Base: {total} | Base WR: {all_wr:.2f}% | Base Avg Ret: {all_ret:+.2f}%")
    print(f"PASS: {pass_cnt} ({pass_cnt/total*100:.1f}%) | WR: {pass_wr:.2f}% (Δ {pass_wr-all_wr:+.2f}%) | Avg Ret: {pass_ret:+.2f}% | PF: {pass_pf:.2f}")
    print(f"REJECT: {rej_cnt} ({rej_cnt/total*100:.1f}%) | WR: {rej_wr:.2f}% | Avg Ret: {rej_ret:+.2f}%")

    return {
        'pass_wr': pass_wr,
        'pass_ret': pass_ret,
        'pass_pf': pass_pf,
        'pass_cnt': pass_cnt,
        'rej_cnt': rej_cnt,
        'rej_wr': rej_wr
    }

def main():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
    cur = conn.cursor()
    cur.execute("""
        SELECT ticker, signal, prediction_date, entry_price, target_price,
               stop_loss, actual_return, is_correct, analysis_json, market,
               master_score, signal_type
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND is_correct IS NOT NULL
          AND entry_price IS NOT NULL
          AND entry_price > 0
          AND market IN ('EGX', 'egx', NULL, '')
        ORDER BY prediction_date
    """)
    rows = cur.fetchall()
    conn.close()

    cutoff_4m = "2026-06-01"
    rows_4m = [r for r in rows if str(r[2])[:10] >= cutoff_4m]

    evaluate_dataset(rows, "CURRENT CODE: ALL HISTORY (12m+)")
    evaluate_dataset(rows_4m, "CURRENT CODE: LAST 4+ MONTHS")

if __name__ == '__main__':
    main()

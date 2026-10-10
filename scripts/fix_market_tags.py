import sqlite3
import re
from pathlib import Path

def detect_market(ticker: str) -> str:
    if not ticker:
        return 'EGX'
    
    t = str(ticker).strip().upper()
    
    # Saudi stocks: 4-digit numeric code (e.g., 2222, 1010, 7010, 4280) or .SR / .SA
    if re.match(r'^\d{4}$', t) or t.endswith('.SR') or t.endswith('.SA') or 'TADAWUL' in t:
        return 'TADAWUL'
    
    # Kuwait stocks: ends with .KW or .KSE or .BK
    if t.endswith('.KW') or t.endswith('.KSE') or t.endswith('.BK') or 'KSE' in t:
        return 'KSE'
        
    # Qatar stocks: ends with .QA or .QSE
    if t.endswith('.QA') or t.endswith('.QSE'):
        return 'QSE'
        
    # DFM / UAE stocks: ends with .DFM or .ADX
    if t.endswith('.DFM') or t.endswith('.ADX'):
        return 'DFM'
        
    # Crypto
    if 'USDT' in t or 'BTC' in t or 'ETH' in t or 'USD' in t:
        return 'CRYPTO'
        
    # Default to EGX for letters tickers like COMI, ETEL, ABUK, etc.
    return 'EGX'

def fix_db(db_path: Path):
    if not db_path.exists():
        print(f"File not found: {db_path}")
        return
        
    print(f"\n🛠️ Fixing market tags in: {db_path.name}")
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    
    if 'stored_analyses' in tables:
        rows = conn.execute("SELECT ticker, market FROM stored_analyses").fetchall()
        fixed_count = 0
        for r in rows:
            ticker = r['ticker']
            curr_m = r['market']
            correct_m = detect_market(ticker)
            if curr_m != correct_m:
                exists = conn.execute("SELECT 1 FROM stored_analyses WHERE ticker = ? AND market = ?", (ticker, correct_m)).fetchone()
                if exists:
                    conn.execute("DELETE FROM stored_analyses WHERE ticker = ? AND market = ?", (ticker, curr_m))
                else:
                    conn.execute("UPDATE stored_analyses SET market = ? WHERE ticker = ? AND market = ?", (correct_m, ticker, curr_m))
                fixed_count += 1
        print(f"  ✓ stored_analyses: cleaned/fixed {fixed_count} mis-tagged records")
        
    if 'aiPrediction' in tables:
        rows = conn.execute("SELECT id, stock_symbol, market FROM aiPrediction").fetchall()
        fixed_count = 0
        for r in rows:
            pid = r['id']
            ticker = r['stock_symbol']
            curr_m = r['market']
            correct_m = detect_market(ticker)
            if curr_m != correct_m:
                conn.execute("UPDATE aiPrediction SET market = ? WHERE id = ?", (correct_m, pid))
                fixed_count += 1
        print(f"  ✓ aiPrediction: cleaned/fixed {fixed_count} mis-tagged records")
        
    if 'stocks' in tables:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()]
        sym_col = 'ticker' if 'ticker' in cols else 'symbol'
        rows = conn.execute(f"SELECT {sym_col}, market FROM stocks").fetchall()
        fixed_count = 0
        for r in rows:
            symbol = r[sym_col]
            curr_m = r['market']
            correct_m = detect_market(symbol)
            if curr_m != correct_m:
                conn.execute(f"UPDATE stocks SET market = ? WHERE {sym_col} = ?", (correct_m, symbol))
                fixed_count += 1
        print(f"  ✓ stocks: cleaned/fixed {fixed_count} mis-tagged records")

    conn.commit()
    conn.close()

def main():
    root = Path(__file__).resolve().parent.parent
    db_dir = root / 'db'
    
    for db_name in ['predictions.db', 'stocks.db', 'data_engine.db']:
        db_path = db_dir / db_name
        fix_db(db_path)
        
    print("\n✅ Market tags fix completed successfully!")

if __name__ == '__main__':
    main()

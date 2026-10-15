import sqlite3, glob, os

def check_intraday():
    conn = sqlite3.connect('db/intraday.db')
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in c.fetchall() if not r[0].startswith('sqlite_')]
    print("=== intraday.db Tables ===")
    for t in tables:
        c.execute(f'SELECT COUNT(*) FROM "{t}"')
        cnt = c.fetchone()[0]
        print(f"  {t}: {cnt:,} rows")
    conn.close()

def check_stocks_duplicates():
    conn = sqlite3.connect('db/stocks.db')
    c = conn.cursor()
    print("\n=== stocks.db Duplicate Price Tables ===")
    for t in ['stock_daily_prices', 'stock_price_history', 'price_history']:
        try:
            c.execute(f'SELECT COUNT(*) FROM "{t}"')
            cnt = c.fetchone()[0]
            c.execute(f'SELECT MAX(date) FROM "{t}"')
            max_d = c.fetchone()[0]
            print(f"  {t}: {cnt:,} rows (latest date: {max_d})")
        except Exception as e:
            print(f"  {t}: error ({e})")
    conn.close()

def check_dbs_real_usage():
    print("\n=== Real DB Size & Active Status ===")
    for p in sorted(glob.glob('db/*.db')):
        name = os.path.basename(p)
        size_mb = os.path.getsize(p) / (1024*1024)
        print(f"  {name}: {size_mb:.2f} MB")

if __name__ == '__main__':
    check_intraday()
    check_stocks_duplicates()
    check_dbs_real_usage()

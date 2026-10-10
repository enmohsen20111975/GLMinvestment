import sqlite3

def run():
    db_path = '/home/meme/my_apps/GLMinvestment/db/data_engine.db'
    conn = sqlite3.connect(db_path, timeout=60.0)
    cursor = conn.cursor()
    
    print("Checking current count...")
    cursor.execute("SELECT COUNT(*) FROM stocks")
    b = cursor.fetchone()[0]
    print(f"Count before: {b}")
    
    print("Creating stocks_clean table...")
    cursor.execute("DROP TABLE IF EXISTS stocks_clean")
    cursor.execute("CREATE TABLE stocks_clean AS SELECT * FROM stocks GROUP BY symbol")
    
    cursor.execute("SELECT COUNT(*) FROM stocks_clean")
    c = cursor.fetchone()[0]
    print(f"stocks_clean count: {c}")
    
    cursor.execute("DROP TABLE stocks")
    cursor.execute("ALTER TABLE stocks_clean RENAME TO stocks")
    cursor.execute("CREATE UNIQUE INDEX idx_stocks_symbol ON stocks(symbol)")
    
    conn.commit()
    
    cursor.execute("SELECT COUNT(*) FROM stocks")
    a = cursor.fetchone()[0]
    print(f"Count after: {a}")
    conn.close()

if __name__ == '__main__':
    run()

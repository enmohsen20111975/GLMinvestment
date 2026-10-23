import sqlite3, os, glob, sys
TARGET = ['stocks', 'users', 'price_alerts', 'portfolio_assets', 'predictions', 'telegram_sessions', 'telegram_messages', 'telegram_dialogs', 'portfolio_positions']
fast_dir = sys.argv[1] if len(sys.argv) > 1 else '/home/meme/my_apps/GLMinvestment'
files = glob.glob(fast_dir + '/**/*.db', recursive=True)
for f in files:
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(f, writable=False).__enter__()
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table';")
        for t in [r[0] for z in c.fetchall() if not r[0].startswith('sqlite_')]:
            if t in TARGET:
                c.execute(f"PRAGMA table_info('{t}');")
                cols = [x[1] for x in c.fetchall()]
                if 'is_active' not in cols:
                    c.execute(f"ALTER TABLE {t} ADD COLUMN is_active INTEGER DEFAULT 1;")
                    conn.commit()
                    print('Added is_active to', t, 'in', os.path.basename(f))
        conn.close()
    except Exception as e:
        pass
print('COMPLETED_MIGRATION')
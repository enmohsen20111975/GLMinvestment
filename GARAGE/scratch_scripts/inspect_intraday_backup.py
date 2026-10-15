import glob
import os
import sqlite3
import tempfile
import zipfile

def inspect():
    parts = sorted(glob.glob('data/db_backup_2026-10-10T09-05-29_part3_split_*.zip.part'))
    print(f'Combining 2026-10-10 part3 splits: {len(parts)}')
    if not parts:
        print('No part3 files found')
        return

    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp_zip:
        for p in parts:
            with open(p, 'rb') as f:
                tmp_zip.write(f.read())
        tmp_zip_path = tmp_zip.name

    out_dir = '/tmp/check_intraday_backup_oct10'
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(tmp_zip_path) as z:
        z.extract('intraday.db', out_dir)

    os.unlink(tmp_zip_path)

    db_file = os.path.join(out_dir, 'intraday.db')
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print('Tables in backup intraday.db (Oct 10):', tables)
    for t in tables:
        try:
            cnt = cursor.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
            print(f'  {t}: {cnt:,} rows')
        except Exception as e:
            print(f'  {t}: error {e}')
    
    if 'stock_intraday' in tables:
        sample = cursor.execute("SELECT ticker, count(*), min(timestamp), max(timestamp) FROM stock_intraday GROUP BY ticker LIMIT 5").fetchall()
        print('Sample stock_intraday:', sample)
    conn.close()

if __name__ == '__main__':
    inspect()

import os
import glob
import subprocess
import sqlite3

def audit():
    db_files = sorted(glob.glob('db/*.db'))
    print("======================================================================")
    print("📊 COMPREHENSIVE DATABASE AUDIT & USAGE ANALYSIS")
    print("======================================================================")
    
    for db_path in db_files:
        db_name = os.path.basename(db_path)
        size_bytes = os.path.getsize(db_path)
        size_mb = size_bytes / (1024 * 1024)
        mtime = os.path.getmtime(db_path)
        import datetime
        dt = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
        
        # Check tables inside DB
        table_count = 0
        tables = []
        try:
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in c.fetchall()]
            table_count = len(tables)
            conn.close()
        except Exception as e:
            tables = [f"Error: {e}"]

        # Search for code references
        cmd = f'grep -rnl --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=db --exclude="*.log" "{db_name}" src vps-service python-backend scripts'
        res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, text=True)
        ref_files = [f for f in res.stdout.strip().split('\n') if f]
        
        print(f"\n📂 Database: {db_name}")
        print(f"   Size: {size_mb:.2f} MB | Last modified: {dt} | Tables: {table_count}")
        print(f"   Tables sample: {', '.join(tables[:6])}{'...' if len(tables) > 6 else ''}")
        print(f"   Code references ({len(ref_files)} files):")
        for f in ref_files[:4]:
            print(f"     - {f}")
        if len(ref_files) > 4:
            print(f"     ... and {len(ref_files) - 4} more files")

if __name__ == '__main__':
    audit()

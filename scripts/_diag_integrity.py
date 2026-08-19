import sqlite3, glob, os
for f in sorted(glob.glob('db/*.db')):
    if any(f.endswith(x) for x in ('-wal', '-shm')):
        continue
    wal = os.path.getsize(f + '-wal') if os.path.exists(f + '-wal') else 0
    try:
        conn = sqlite3.connect('file:' + f + '?mode=ro', uri=True, timeout=5)
        r = conn.execute('PRAGMA integrity_check(1)').fetchone()
        t = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        conn.close()
        status = 'OK' if r[0] == 'ok' else 'ERR:' + str(r)
        print('%s tables=%-3d wal=%-8d %s' % (status, t, wal, f))
    except Exception as e:
        print('%-14s wal=%-8d %s -> %s' % ('FAIL', wal, f, str(e)[:90]))

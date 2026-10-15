import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
c = conn.cursor()
c.execute("SELECT MIN(signal_date), MAX(signal_date), COUNT(*) FROM radar_signal_tracking")
print("Dates range:", c.fetchall())

c.execute("SELECT status, MIN(signal_date), MAX(signal_date), COUNT(*) FROM radar_signal_tracking GROUP BY status")
for row in c.fetchall():
    print("Status row:", row)

c.execute("SELECT date('now'), date('now', '-7 days'), date('now', '-45 days')")
print("SQLite now:", c.fetchall())

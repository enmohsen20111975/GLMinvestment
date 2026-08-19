import sqlite3
import datetime
db = '/home/meme/my_apps/GLMinvestment/db/predictions.db'
conn = sqlite3.connect(db, timeout=30.0)
today = datetime.datetime.now().strftime('%Y-%m-%d')
conn.execute('DELETE FROM predictions WHERE date(prediction_date) = ? AND persona=?', (today, 'gambler'))
conn.commit()
print('Cleaned old predictions.')
for row in conn.execute('SELECT persona, COUNT(*) FROM predictions WHERE date(prediction_date) = ? GROUP BY persona;', (today,)):
    print(row)

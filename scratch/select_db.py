import sqlite3
import datetime
db = '/home/meme/my_apps/GLMinvestment/db/predictions.db'
conn = sqlite3.connect(db, timeout=60.0)
today = datetime.datetime.now().strftime('%Y-%m-%d')
print('Prediction counts for today:')
for row in conn.execute('SELECT persona, COUNT(*) FROM predictions WHERE date(prediction_date) = ? GROUP BY persona;', (today,)):
    print(row)

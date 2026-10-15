import sqlite3
from datetime import datetime

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
cur = conn.cursor()

# 1. Fix EGX30
# current_value = 53776.69, previous_close = 54224.93
# change = 53776.69 - 54224.93 = -448.24
# change_percent = round((-448.24 / 54224.93) * 100, 4) = -0.8266%
cur.execute("""
UPDATE market_indices
SET change = -448.24,
    change_percent = -0.8266,
    last_update = datetime('now')
WHERE symbol = 'EGX30'
""")

# 2. Fix EGX70 consistency
# current_value = 19834.95, previous_close = 20222.74
# change = 19834.95 - 20222.74 = -387.79
# change_percent = round((-387.79 / 20222.74) * 100, 4) = -1.9176%
cur.execute("""
UPDATE market_indices
SET change = -387.79,
    change_percent = -1.9176,
    last_update = datetime('now')
WHERE symbol = 'EGX70'
""")

# 3. Fix EGX100 consistency
# current_value = 35108.73, previous_close = 35523.73
# change = 35108.73 - 35523.73 = -415.00
# change_percent = round((-415.00 / 35523.73) * 100, 4) = -1.1682%
cur.execute("""
UPDATE market_indices
SET change = -415.00,
    change_percent = -1.1682,
    last_update = datetime('now')
WHERE symbol = 'EGX100'
""")

conn.commit()

# Verify
rows = cur.execute("SELECT symbol, current_value, previous_close, change, change_percent FROM market_indices").fetchall()
print("Updated market_indices:")
for r in rows:
    expected_change = round(r[1] - r[2], 2)
    expected_cp = round(((r[1] - r[2]) / r[2]) * 100, 2)
    print(f"  {r[0]}: current={r[1]}, prev={r[2]}, change={r[3]} (calc:{expected_change}), cp={r[4]}% (calc:{expected_cp}%)")

conn.close()

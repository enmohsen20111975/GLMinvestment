import sys
sys.path.insert(0, '.')
from config import DATABASE_PATH, PRICE_HISTORY_DB_PATH, verify_database

print("=== Database Configuration ===")
print(f"Primary DB: {DATABASE_PATH}")
print(f"Price History DB: {PRICE_HISTORY_DB_PATH}")

print("\n=== Database Verification ===")
stats = verify_database()
for key, value in stats.items():
    print(f"  {key}: {value}")

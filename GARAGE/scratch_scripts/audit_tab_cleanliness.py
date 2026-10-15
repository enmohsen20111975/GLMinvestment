import sqlite3
from pathlib import Path

conn = sqlite3.connect("db/data_engine.db")
tables = [
    "tab_balance_sheet", "tab_cash_flow", "tab_income_statement",
    "tab_valuation", "tab_profitability", "tab_dividends",
    "tab_performance", "tab_technical_analysis"
]

print("=== AUDIT OF TAB_* FUNDAMENTALS TABLES ===")
for t in tables:
    total = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    egx_clean = conn.execute(f"SELECT count(*) FROM {t} WHERE market='مصر' AND length(symbol) <= 6 AND symbol NOT GLOB '*[0-9]*'").fetchone()[0]
    saudi_clean = conn.execute(f"SELECT count(*) FROM {t} WHERE market='السعودية' AND length(symbol) = 4 AND symbol GLOB '[0-9][0-9][0-9][0-9]'").fetchone()[0]
    leaked_market = conn.execute(f"SELECT count(*) FROM {t} WHERE symbol IN ('مصر', 'السعودية', 'الكويت', 'قطر')").fetchone()[0]
    null_symbol = conn.execute(f"SELECT count(*) FROM {t} WHERE symbol IS NULL OR trim(symbol) = ''").fetchone()[0]
    print(f"{t:<24} | Total: {total:>4} | EGX Clean: {egx_clean:>4} | Saudi Clean: {saudi_clean:>4} | Leaked Market Name: {leaked_market:>3} | Null: {null_symbol:>3}")

print("\nSample of Leaked Rows in tab_balance_sheet:")
for r in conn.execute("SELECT id, symbol, market, fiscal_period, fiscal_end, total_assets, total_liabilities, cash FROM tab_balance_sheet WHERE symbol IN ('مصر', 'السعودية') LIMIT 5").fetchall():
    print(" ", r)

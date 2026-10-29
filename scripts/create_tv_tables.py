#!/usr/bin/env python3
"""
BRAVO-DATA-LAYER (2026-10-29) — Create TV scanner tables in data_engine.db
=========================================================================
Owner directive:
  "البيانات الى بتيجى من محرك البيانات تروح على data_engine.db مش stocks.db"
  "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة"

Creates two new tables in data_engine.db:
  1. tv_snapshot    — rich TV scanner snapshot (60 cols), one row per stock
  2. tv_indicators  — TV indicators time-series (RSI/SMA/MACD/ATR), one row per stock per day

These replace the role of stocks.db.stocks + stocks.db.stock_indicators.
The scanner writes here; the data layer reads from here.
"""
import sqlite3
from pathlib import Path

DB = Path("/home/z/my-project/db/data_engine.db")

# ─── tv_snapshot: 60-column TV scanner data ─────────────────────────────────
# Mirrors the FIELD_MAP from tradingview_scanner_live.py
# One row per stock, upserted on symbol+ticker

TV_SNAPSHOT_COLUMNS = {
    # identity
    "symbol": "TEXT",
    "ticker": "TEXT",
    "name_ar": "TEXT",
    "market": "TEXT",  # DB slug: EGX/TADAWUL/KSE/QSE/US/crypto
    "sector": "TEXT",
    "industry": "TEXT",
    "currency": "TEXT",
    "exchange": "TEXT",
    "logoid": "TEXT",
    "logo_url": "TEXT",
    # session
    "current_price": "REAL",
    "change_percent": "REAL",
    "change_value": "REAL",
    "volume": "REAL",
    "value_traded": "REAL",
    "turnover_egp": "REAL",
    "relative_volume_10d": "REAL",
    "high_price": "REAL",
    "low_price": "REAL",
    "open_price": "REAL",
    # valuation
    "market_cap": "REAL",
    "enterprise_value": "REAL",
    "pe_ratio": "REAL",
    "ps_ratio": "REAL",
    "pb_ratio": "REAL",
    "ev_to_revenue": "REAL",
    "ev_to_ebitda": "REAL",
    # earnings
    "eps": "REAL",
    "eps_diluted": "REAL",
    "dividend_yield": "REAL",
    "dps_ttm": "REAL",
    "payout_ratio": "REAL",
    # profitability
    "gross_margin": "REAL",
    "operating_margin": "REAL",
    "profit_margin": "REAL",
    "roa": "REAL",
    "roe": "REAL",
    "roic": "REAL",
    # balance sheet
    "total_assets": "REAL",
    "total_current_assets": "REAL",
    "cash_and_equivalents": "REAL",
    "total_liabilities": "REAL",
    "total_debt": "REAL",
    "total_equity": "REAL",
    "shares_outstanding": "REAL",
    # income
    "total_revenue": "REAL",
    "gross_profit": "REAL",
    "operating_income": "REAL",
    "net_income": "REAL",
    # cash flow
    "cash_flow_operating": "REAL",
    "cash_flow_investing": "REAL",
    "cash_flow_financing": "REAL",
    "free_cash_flow": "REAL",
    # technicals (current snapshot)
    "recommend_all": "REAL",
    "recommend_ma": "REAL",
    "recommend_other": "REAL",
    "rsi": "REAL",
    "macd": "REAL",
    "macd_signal": "REAL",
    "atr": "REAL",
    "sma20": "REAL",
    "sma50": "REAL",
    "sma200": "REAL",
    # radar/pulse extras
    "avg_volume_30d": "REAL",
    "avg_volume_10d": "REAL",
    "avg_volume_90d": "REAL",
    "volatility_daily": "REAL",
    "volatility_weekly": "REAL",
    "high_52w": "REAL",
    "low_52w": "REAL",
    "beta_1y": "REAL",
    # meta
    "last_updated": "TEXT",
    "is_active": "INTEGER DEFAULT 1",
}

# ─── tv_indicators: time-series of TV technicals ────────────────────────────
# One row per stock per day. Engines read the latest row for current indicators,
# or historical rows for indicator history.

TV_INDICATORS_COLUMNS = {
    "market": "TEXT",  # DB slug
    "rsi": "REAL",
    "macd": "REAL",
    "macd_signal": "REAL",
    "sma20": "REAL",
    "sma50": "REAL",
    "sma200": "REAL",
    "atr": "REAL",
    "recommend_all": "REAL",
    "recommend_ma": "REAL",
    "recommend_other": "REAL",
    "volatility_daily": "REAL",
    "volatility_weekly": "REAL",
    "avg_volume_30d": "REAL",
    "avg_volume_10d": "REAL",
    "avg_volume_90d": "REAL",
    "relative_volume_10d": "REAL",
    "high_52w": "REAL",
    "low_52w": "REAL",
    "beta_1y": "REAL",
    "fetch_time": "TEXT",
    "source": "TEXT DEFAULT 'tradingview'",
}


def main():
    conn = sqlite3.connect(str(DB))
    cur = conn.cursor()

    # 1. tv_snapshot
    col_defs = [f'"{c}" {t}' for c, t in TV_SNAPSHOT_COLUMNS.items()]
    cur.execute(f'''
        CREATE TABLE IF NOT EXISTS tv_snapshot (
            {", ".join(col_defs)},
            "id" INTEGER PRIMARY KEY AUTOINCREMENT
        )
    ''')
    # Ensure all columns exist (ALTER for missing)
    existing = {r[1] for r in cur.execute("PRAGMA table_info(tv_snapshot)").fetchall()}
    added = 0
    for col, typ in TV_SNAPSHOT_COLUMNS.items():
        if col not in existing:
            cur.execute(f'ALTER TABLE tv_snapshot ADD COLUMN "{col}" {typ}')
            added += 1
    # UNIQUE index on ticker (for upsert)
    cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_snap_ticker ON tv_snapshot(ticker)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_tv_snap_market ON tv_snapshot(market)')
    print(f"tv_snapshot: ready ({added} columns added via ALTER)")

    # 2. tv_indicators
    col_defs2 = ['"ticker" TEXT NOT NULL', '"date" TEXT NOT NULL']
    for c, t in TV_INDICATORS_COLUMNS.items():
        col_defs2.append(f'"{c}" {t}')
    cur.execute(f'''
        CREATE TABLE IF NOT EXISTS tv_indicators (
            {", ".join(col_defs2)},
            PRIMARY KEY (ticker, date)
        )
    ''')
    existing2 = {r[1] for r in cur.execute("PRAGMA table_info(tv_indicators)").fetchall()}
    added2 = 0
    for col, typ in TV_INDICATORS_COLUMNS.items():
        if col not in existing2:
            cur.execute(f'ALTER TABLE tv_indicators ADD COLUMN "{col}" {typ}')
            added2 += 1
    cur.execute('CREATE INDEX IF NOT EXISTS idx_tv_ind_date ON tv_indicators(date)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_tv_ind_ticker ON tv_indicators(ticker)')
    print(f"tv_indicators: ready ({added2} columns added via ALTER)")

    conn.commit()

    # Verify
    print("\n===== verification =====")
    for t in ["tv_snapshot", "tv_indicators"]:
        cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        ncols = len(cur.execute(f"PRAGMA table_info({t})").fetchall())
        print(f"  {t}: {cnt} rows | {ncols} columns")

    conn.close()
    print("\nDone. data_engine.db now has TV scanner tables.")


if __name__ == "__main__":
    main()

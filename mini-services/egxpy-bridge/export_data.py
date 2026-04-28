#!/usr/bin/env python3
"""
Export data from egxpy-bridge database to JSON file.
This script exports all stocks, price history, and related data
that can be imported into the Next.js application.

Usage:
    python export_data.py [output_file.json]

The output file can be uploaded through the admin panel:
    https://invist.m2y.net/admin → إدارة البيانات → استيراد من JSON
"""

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Default database path
DB_PATH = Path(__file__).parent / "egx_data.db"
DEFAULT_OUTPUT = f"egx-export-{datetime.now().strftime('%Y-%m-%d')}.json"


def export_data(db_path: str, output_path: str):
    """Export all data from the database to a JSON file."""

    if not Path(db_path).exists():
        print(f"ERROR: Database not found at {db_path}")
        print("\nPossible solutions:")
        print("  1. Run the egxpy-bridge service first to create the database")
        print("  2. Specify a different database path:")
        print(f"     python {__file__} output.json /path/to/egx_data.db")
        return False

    print(f"Connecting to database: {db_path}")

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        export_data = {
            "metadata": {
                "export_version": "1.0.0",
                "platform_version": "3.4.29",
                "export_timestamp": datetime.now().isoformat(),
                "source": "egxpy-bridge-local",
                "source_db": str(db_path),
            },
            "stocks": [],
            "price_history": [],
            "dividends": [],
            "market_indices": [],
            "gold_prices": [],
            "currency_rates": [],
            "recommendations": [],
        }

        # Export stocks
        print("Exporting stocks...")
        try:
            rows = conn.execute("""
                SELECT id, ticker, name, name_ar, sector, industry,
                       current_price, previous_close, open_price, high_price, low_price,
                       volume, market_cap, pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
                       dividend_yield, eps, roe, roa, debt_to_equity, current_ratio,
                       book_value_per_share, shares_outstanding, support_level, resistance_level,
                       ma_50, ma_200, rsi, is_active, last_update
                FROM stocks
            """).fetchall()
            export_data["stocks"] = [dict(row) for row in rows]
            print(f"  Found {len(export_data['stocks'])} stocks")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export stocks: {e}")

        # Build stock ID to ticker mapping
        stock_id_map = {row["id"]: row["ticker"] for row in export_data["stocks"]}

        # Export price history (last 365 days)
        print("Exporting price history...")
        try:
            rows = conn.execute("""
                SELECT sph.stock_id, sph.date, sph.open, sph.high, sph.low, sph.close,
                       sph.volume, sph.adjusted_close
                FROM stock_price_history sph
                WHERE sph.date >= date('now', '-365 days')
                ORDER BY sph.date DESC
            """).fetchall()

            # Add ticker to each row
            for row in rows:
                row_dict = dict(row)
                row_dict["ticker"] = stock_id_map.get(row["stock_id"], "UNKNOWN")
                del row_dict["stock_id"]
                export_data["price_history"].append(row_dict)
            print(f"  Found {len(export_data['price_history'])} price history records")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export price history: {e}")

        # Export dividends
        print("Exporting dividends...")
        try:
            rows = conn.execute("""
                SELECT d.stock_id, d.ex_dividend_date, d.dividend_amount,
                       d.dividend_yield, d.payment_date, d.declaration_date
                FROM dividends d
                ORDER BY d.ex_dividend_date DESC
            """).fetchall()

            for row in rows:
                row_dict = dict(row)
                row_dict["ticker"] = stock_id_map.get(row["stock_id"], "UNKNOWN")
                del row_dict["stock_id"]
                export_data["dividends"].append(row_dict)
            print(f"  Found {len(export_data['dividends'])} dividend records")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export dividends: {e}")

        # Export market indices
        print("Exporting market indices...")
        try:
            rows = conn.execute("""
                SELECT symbol, name, name_ar, current_value, previous_close,
                       change, change_percent, last_update
                FROM market_indices
            """).fetchall()
            export_data["market_indices"] = [dict(row) for row in rows]
            print(f"  Found {len(export_data['market_indices'])} indices")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export market indices: {e}")

        # Export gold prices
        print("Exporting gold prices...")
        try:
            rows = conn.execute("""
                SELECT date, gold_24k, gold_22k, gold_21k, gold_18k, gold_ounce,
                       silver_ounce, silver_gram, currency
                FROM gold_prices
                ORDER BY date DESC
                LIMIT 30
            """).fetchall()
            export_data["gold_prices"] = [dict(row) for row in rows]
            print(f"  Found {len(export_data['gold_prices'])} gold price records")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export gold prices: {e}")

        # Export currency rates
        print("Exporting currency rates...")
        try:
            rows = conn.execute("""
                SELECT date, currency, buy_rate, sell_rate, mid_rate
                FROM currency_rates
                ORDER BY date DESC
                LIMIT 30
            """).fetchall()
            export_data["currency_rates"] = [dict(row) for row in rows]
            print(f"  Found {len(export_data['currency_rates'])} currency rate records")
        except sqlite3.OperationalError as e:
            print(f"  Warning: Could not export currency rates: {e}")

        # Update metadata with counts
        export_data["metadata"]["stocks_count"] = len(export_data["stocks"])
        export_data["metadata"]["price_history_count"] = len(export_data["price_history"])
        export_data["metadata"]["dividends_count"] = len(export_data["dividends"])

        conn.close()

        # Write to file
        print(f"\nWriting to {output_path}...")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)

        # Calculate file size
        file_size = Path(output_path).stat().st_size
        size_str = f"{file_size / 1024:.1f} KB" if file_size < 1024 * 1024 else f"{file_size / 1024 / 1024:.1f} MB"

        print("\n" + "=" * 50)
        print("EXPORT SUCCESSFUL!")
        print("=" * 50)
        print(f"File: {output_path}")
        print(f"Size: {size_str}")
        print(f"\nSummary:")
        print(f"  - Stocks: {export_data['metadata']['stocks_count']}")
        print(f"  - Price History: {export_data['metadata']['price_history_count']}")
        print(f"  - Dividends: {export_data['metadata']['dividends_count']}")
        print(f"\nNext steps:")
        print(f"  1. Go to: https://invist.m2y.net/admin")
        print(f"  2. Scroll to 'إدارة البيانات'")
        print(f"  3. Click 'استيراد من JSON' and select this file")
        print("=" * 50)

        return True

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    # Parse arguments
    output_file = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    db_file = sys.argv[2] if len(sys.argv) > 2 else str(DB_PATH)

    export_data(db_file, output_file)

#!/usr/bin/env python3
"""
data_engine/data_layer.py — BRAVO-DATA-LAYER (2026-10-29)
=========================================================
طبقة البيانات الموحدة — Single source of truth for all engines.

Owner directive (2026-10-29):
  "البيانات الى بتيجى من محرك البيانات تروح على data_engine.db مش stocks.db"
  "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة"
  "مافيش ملفات جديدة ولا جداول ولا قواعد بيانات جديدة"

Architecture (NO NEW TABLES — uses existing tables only):
  [scrapers] → data_engine.db (canonical source)
                   ↑
              [data_layer.py] ← single read/write API + market normalization
                   ↑
              [V3 + engines + frontend]

Tables used (ALL EXISTING — no new tables):
  - stocks              : snapshot (18→102 cols, enriched via ALTER, 1,240 rows)
  - historical_data     : daily OHLCV + indicators (206K rows, 2021-2026)
  - egksco_price_history: EGX daily + buy/sell pressure (60K rows)

Market slug normalization (built-in, transparent to callers):
  API:   egypt / ksa / kuwait / qatar / america / crypto
  Arabic: مصر / السعودية / الكويت / قطر
  DB:    EGX / TADAWUL / KSE / QSE / US / crypto
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─── Config ─────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "db" / "data_engine.db"

# ─── Market slug normalization ──────────────────────────────────────────────

_CANONICAL = {
    "EGX": "EGX",
    "TADAWUL": "TADAWUL",
    "KSE": "KSE",
    "QSE": "QSE",
    "US": "US",
    "CRYPTO": "crypto",
}

_ALIASES = {
    "egypt": "EGX", "egx": "EGX",
    "ksa": "TADAWUL", "saudi": "TADAWUL", "saudiarabia": "TADAWUL", "tadawul": "TADAWUL",
    "kuwait": "KSE", "kse": "KSE",
    "qatar": "QSE", "qse": "QSE",
    "america": "US", "us": "US", "usa": "US",
    "crypto": "crypto",
    "مصر": "EGX", "السعودية": "TADAWUL", "الكويت": "KSE", "قطر": "QSE",
    "أمريكا": "US", "كريبتو": "crypto",
}


def normalize_market(market: Optional[str]) -> Optional[str]:
    """Normalize any market alias to canonical DB slug."""
    if market is None:
        return None
    m = str(market).strip()
    if not m:
        return None
    if m in _CANONICAL:
        return m
    low = m.lower()
    if low in _ALIASES:
        return _ALIASES[low]
    if m in _ALIASES:
        return _ALIASES[m]
    return m.upper()


# ─── Connection management ──────────────────────────────────────────────────

_local = threading.local()


def _conn() -> sqlite3.Connection:
    """Thread-local connection to data_engine.db."""
    c = getattr(_local, "conn", None)
    if c is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(str(DB_PATH), timeout=30.0)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=30000")
        _local.conn = c
    return c


# ─── DataLayer ──────────────────────────────────────────────────────────────


class DataLayer:
    """Single read/write API for all engines. Reads from data_engine.db."""

    db_path = DB_PATH

    # ═══ READ: snapshot ═══════════════════════════════════════════════════════

    def get_snapshot(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Current snapshot for a stock: price, volume, OHLC, RSI, SMA, ATR, market_cap, etc.

        Reads from existing `stocks` table (enriched with 102 columns via ALTER).
        Returns dict with normalized keys, or None if not found.
        """
        cur = _conn().cursor()
        # stocks table uses 'symbol' as the ticker column
        row = cur.execute(
            "SELECT * FROM stocks WHERE symbol = ? LIMIT 1",
            (ticker,),
        ).fetchone()
        if row:
            d = dict(row)
            d["market"] = normalize_market(d.get("market"))
            # alias for compatibility: ticker = symbol, current_price = price
            d["ticker"] = d.get("symbol")
            d["current_price"] = d.get("price")
            return d
        return None

    def get_market_stocks(self, market: str) -> List[str]:
        """List of tickers for a market (normalized)."""
        mk = normalize_market(market)
        if not mk:
            return []
        cur = _conn().cursor()
        # stocks table uses 'symbol' as the ticker column
        # try both normalized and original market slugs
        rows = []
        for alias in (mk, market):
            rows = cur.execute(
                "SELECT DISTINCT symbol FROM stocks WHERE market = ? AND symbol IS NOT NULL",
                (alias,),
            ).fetchall()
            if rows:
                break
        return [r[0] for r in rows if r[0]]

    def get_market_snapshots(self, market: str) -> List[Dict[str, Any]]:
        """All snapshots for a market (batch read)."""
        mk = normalize_market(market)
        if not mk:
            return []
        cur = _conn().cursor()
        rows = []
        for alias in (mk, market):
            rows = cur.execute(
                "SELECT * FROM stocks WHERE market = ?", (alias,)
            ).fetchall()
            if rows:
                break
        out = []
        for r in rows:
            d = dict(r)
            d["market"] = normalize_market(d.get("market"))
            # alias: current_price = price (for compatibility with V3)
            if "price" in d and d.get("price") is not None:
                d["current_price"] = d["price"]
            # alias: ticker = symbol (for compatibility with V3)
            if "symbol" in d and d.get("symbol"):
                d["ticker"] = d["symbol"]
            out.append(d)
        return out

    # ═══ READ: price history ═══════════════════════════════════════════════════

    def get_history(
        self,
        ticker: str,
        days: int = 60,
        market: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Daily OHLCV history (oldest → newest).

        Reads from existing `historical_data` table + supplements with
        `egksco_price_history` (EGX only) + today's snapshot from `stocks`.

        Returns list of dicts: {date, open, high, low, close, volume, ...}
        Also includes indicator columns (rsi, macd, sma*, atr) if available.

        BRAVO-GRACEFUL: detects available columns dynamically so it works
        even before the migration script has run (missing rsi/sma/atr columns
        won't crash the query).
        """
        cur = _conn().cursor()

        # 1. historical_data (canonical daily OHLCV + indicators if available)
        # Detect available indicator columns dynamically (graceful degradation)
        hd_cols = {r[1] for r in cur.execute("PRAGMA table_info(historical_data)").fetchall()}
        base_cols = ["date", "open", "high", "low", "close", "volume", "ticker", "market", "change_percent"]
        ind_cols = ["rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
                    "recommend_all", "recommend_ma", "recommend_other"]
        available_ind = [c for c in ind_cols if c in hd_cols]
        select_cols = base_cols + available_ind
        select_list = ", ".join(f'"{c}"' for c in select_cols)

        rows = cur.execute(
            f"""SELECT {select_list}
               FROM historical_data
               WHERE (ticker = ? OR symbol = ?) AND close IS NOT NULL AND close > 0
               ORDER BY date DESC LIMIT ?""",
            (ticker, ticker, days),
        ).fetchall()

        history: List[Dict[str, Any]] = []
        seen_dates = set()
        for r in rows:
            d = {
                "date": r["date"],
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
                "change_percent": r["change_percent"],
            }
            # Add indicators if the column exists
            for c in available_ind:
                try:
                    d[c] = r[c]
                except (IndexError, KeyError):
                    d[c] = None
            d["source"] = "historical_data"
            history.append(d)
            seen_dates.add(r["date"])

        # 2. egksco_price_history (EGX with buy/sell pressure) — supplement
        mk = normalize_market(market)
        if mk == "EGX" or mk is None:
            eg_rows = cur.execute(
                """SELECT price_date, open_price, high_price, low_price, close_price,
                          volume, turnover, buy_volume, sell_volume, delta_volume,
                          delta_pct, pressure
                   FROM egksco_price_history
                   WHERE symbol = ? AND close_price IS NOT NULL AND close_price > 0
                   ORDER BY price_date DESC LIMIT ?""",
                (ticker, days),
            ).fetchall()
            for r in eg_rows:
                if r["price_date"] not in seen_dates:
                    history.append(
                        {
                            "date": r["price_date"],
                            "open": r["open_price"],
                            "high": r["high_price"],
                            "low": r["low_price"],
                            "close": r["close_price"],
                            "volume": r["volume"],
                            "turnover": r["turnover"],
                            "buy_volume": r["buy_volume"],
                            "sell_volume": r["sell_volume"],
                            "delta_volume": r["delta_volume"],
                            "delta_pct": r["delta_pct"],
                            "pressure": r["pressure"],
                            "source": "egksco",
                        }
                    )
                    seen_dates.add(r["price_date"])

        # 3. stocks table — today's fresh close (if not already in history)
        today = datetime.now().strftime("%Y-%m-%d")
        if today not in seen_dates:
            snap = self.get_snapshot(ticker)
            if snap and snap.get("price") and snap["price"] > 0:
                history.append(
                    {
                        "date": today,
                        "open": snap.get("open_price") or snap["price"],
                        "high": snap.get("high_price") or snap["price"],
                        "low": snap.get("low_price") or snap["price"],
                        "close": snap["price"],
                        "volume": snap.get("volume") or 0,
                        "change_percent": snap.get("change_percent") or 0,
                        "rsi": snap.get("rsi"),
                        "macd": snap.get("macd"),
                        "sma20": snap.get("sma20"),
                        "sma50": snap.get("sma50"),
                        "sma200": snap.get("sma200"),
                        "atr": snap.get("atr"),
                        "source": "stocks_snapshot",
                    }
                )

        # Sort oldest → newest
        history.sort(key=lambda x: x["date"])
        return history[-days:] if days else history

    def get_history_lists(
        self,
        ticker: str,
        days: int = 60,
        market: Optional[str] = None,
    ) -> Tuple[List[float], List[float], List[float], List[float], List[float]]:
        """Convenience: returns (closes, volumes, highs, lows, opens) as lists."""
        hist = self.get_history(ticker, days, market)
        closes = [float(h["close"] or 0) for h in hist]
        volumes = [float(h["volume"] or 0) for h in hist]
        highs = [float(h["high"] or h["close"] or 0) for h in hist]
        lows = [float(h["low"] or h["close"] or 0) for h in hist]
        opens = [float(h["open"] or h["close"] or 0) for h in hist]
        return closes, volumes, highs, lows, opens

    # ═══ READ: indicators ══════════════════════════════════════════════════════

    def get_indicators(self, ticker: str, date: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """TV technical indicators for a stock.

        Reads from existing `historical_data` (has indicator columns after ALTER)
        with fallback to `stocks` table (current snapshot).
        """
        cur = _conn().cursor()
        # BRAVO-GRACEFUL: detect available indicator columns dynamically
        hd_cols = {r[1] for r in cur.execute("PRAGMA table_info(historical_data)").fetchall()}
        all_ind_cols = ["rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
                        "recommend_all", "recommend_ma", "recommend_other",
                        "volatility_daily", "volatility_weekly",
                        "avg_volume_30d", "avg_volume_10d", "avg_volume_90d",
                        "relative_volume_10d", "high_52w", "low_52w", "beta_1y"]
        available_ind = [c for c in all_ind_cols if c in hd_cols]

        if available_ind:
            select_list = ", ".join(f'"{c}"' for c in available_ind)
            if date:
                row = cur.execute(
                    f"""SELECT {select_list}
                       FROM historical_data
                       WHERE ticker = ? AND date = ? LIMIT 1""",
                    (ticker, date),
                ).fetchone()
                if row:
                    return dict(row)
            else:
                # latest from historical_data where the first indicator is not null
                first_ind = available_ind[0]
                row = cur.execute(
                    f"""SELECT {select_list}
                       FROM historical_data
                       WHERE ticker = ? AND "{first_ind}" IS NOT NULL
                       ORDER BY date DESC LIMIT 1""",
                    (ticker,),
                ).fetchone()
                if row:
                    return dict(row)
        # Fallback: current snapshot from stocks table
        snap = self.get_snapshot(ticker)
        if snap:
            return {k: snap.get(k) for k in all_ind_cols if k in snap}
        return None

    # ═══ READ: market cap + fundamentals ═══════════════════════════════════════

    def get_market_cap(self, ticker: str) -> Optional[float]:
        """Current market cap for a stock."""
        snap = self.get_snapshot(ticker)
        if snap and snap.get("market_cap"):
            try:
                return float(snap["market_cap"])
            except (ValueError, TypeError):
                return None
        return None

    # ═══ WRITE: scanner upserts ════════════════════════════════════════════════

    def upsert_snapshot(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert TV scanner rows into existing `stocks` table.

        The scanner sets 'market' to the DB slug explicitly.
        Maps: ticker → symbol, current_price → price, last_updated → last_update
        """
        if not rows:
            return 0
        cur = _conn().cursor()
        db_cols = {r[1] for r in cur.execute("PRAGMA table_info(stocks)").fetchall()}

        # Build column mapping: scanner row keys → stocks table columns
        # scanner uses: ticker, current_price, last_updated → stocks uses: symbol, price, last_update
        key_map = {
            "ticker": "symbol",
            "current_price": "price",
            "last_updated": "last_update",
        }
        # Columns that should ALWAYS be overwritten (not COALESCE'd) — fresh data wins
        force_overwrite = {"price", "change_percent", "volume", "high_price", "low_price",
                          "open_price", "last_update", "value_traded", "turnover_egp",
                          "rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
                          "recommend_all", "recommend_ma", "recommend_other",
                          "volatility_daily", "volatility_weekly",
                          "avg_volume_30d", "avg_volume_10d", "avg_volume_90d",
                          "relative_volume_10d", "high_52w", "low_52w", "beta_1y",
                          "market_cap", "pe_ratio", "pb_ratio", "eps", "sector", "industry"}

        # Ensure unique index on symbol (idempotent)
        try:
            cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_de_stocks_symbol ON stocks(symbol)')
            _conn().commit()
        except Exception:
            pass

        saved = 0
        for row in rows:
            # Build the values dict with mapped keys
            vals = {}
            for k, v in row.items():
                dk = key_map.get(k, k)  # map key if needed, else keep
                if dk in db_cols:
                    vals[dk] = v
            if "symbol" not in vals or not vals["symbol"]:
                continue
            cols = list(vals.keys())
            placeholders = ", ".join(["?"] * len(cols))
            col_list = ", ".join(f'"{c}"' for c in cols)
            update_cols = [c for c in cols if c != "symbol" and c != "id"]
            # Force-overwrite critical columns; COALESCE for the rest
            update_parts = []
            for c in update_cols:
                if c in force_overwrite:
                    update_parts.append(f'"{c}" = excluded."{c}"')
                else:
                    update_parts.append(f'"{c}" = COALESCE(excluded."{c}", stocks."{c}")')
            update_set = ", ".join(update_parts)
            sql = f'''
                INSERT INTO stocks ({col_list})
                VALUES ({placeholders})
                ON CONFLICT(symbol) DO UPDATE SET {update_set}
            '''
            try:
                cur.execute(sql, tuple(vals[c] for c in cols))
                saved += 1
            except Exception as e:
                # Fallback: UPDATE then INSERT (if no unique index / ON CONFLICT unsupported)
                try:
                    update_set2 = ", ".join(f'"{c}" = ?' for c in update_cols)
                    cur.execute(
                        f'UPDATE stocks SET {update_set2} WHERE symbol = ?',
                        tuple(vals[c] for c in update_cols) + (vals["symbol"],),
                    )
                    if cur.rowcount == 0:
                        cur.execute(
                            f'INSERT OR IGNORE INTO stocks ({col_list}) VALUES ({placeholders})',
                            tuple(vals[c] for c in cols),
                        )
                    saved += 1
                except Exception as e2:
                    print(f"[data_layer] upsert_snapshot error {vals.get('symbol')}: {e2}")
        _conn().commit()
        return saved

    def append_daily_prices(self, rows: List[Dict[str, Any]]) -> int:
        """Append today's OHLCV from scanner to existing `historical_data` table.

        Also updates indicator columns (rsi, macd, sma*, atr) if present in the row.
        """
        if not rows:
            return 0
        cur = _conn().cursor()
        today = datetime.now().strftime("%Y-%m-%d")
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db_cols = {r[1] for r in cur.execute("PRAGMA table_info(historical_data)").fetchall()}

        # Ensure unique index for upsert
        try:
            cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_ticker_date ON historical_data(ticker, date)')
        except:
            pass

        saved = 0
        for row in rows:
            ticker = row.get("symbol") or row.get("ticker")
            if not ticker:
                continue
            close = row.get("current_price") or row.get("price")
            if not close or close <= 0:
                continue
            market = normalize_market(row.get("market"))
            open_p = row.get("open_price") or close
            high_p = row.get("high_price") or close
            low_p = row.get("low_price") or close
            volume = row.get("volume") or 0
            change_pct = row.get("change_percent") or 0
            name = row.get("name_ar") or ""

            # Build values dict — only use columns that exist in historical_data
            vals = {
                "ticker": ticker,
                "symbol": ticker,
                "name": name,
                "market": market,
                "date": today,
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "close": close,
                "volume": volume,
                "change_percent": change_pct,
                "last_fetch": now_str,
            }
            # Add indicator columns if they exist in historical_data
            for ind_col in ["rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
                            "recommend_all", "recommend_ma", "recommend_other",
                            "volatility_daily", "volatility_weekly",
                            "avg_volume_30d", "avg_volume_10d", "avg_volume_90d",
                            "relative_volume_10d", "high_52w", "low_52w", "beta_1y"]:
                if ind_col in db_cols and ind_col in row:
                    v = row.get(ind_col)
                    vals[ind_col] = float(v) if v is not None else None

            # Filter to only columns that exist in DB
            vals = {k: v for k, v in vals.items() if k in db_cols}
            cols = list(vals.keys())
            placeholders = ", ".join(["?"] * len(cols))
            col_list = ", ".join(f'"{c}"' for c in cols)
            update_cols = [c for c in cols if c not in ("ticker", "date")]
            # Force-overwrite OHLCV + indicators (fresh data wins)
            force_ow = {"open", "high", "low", "close", "volume", "change_percent",
                       "last_fetch", "rsi", "macd", "macd_signal", "sma20", "sma50",
                       "sma200", "atr", "recommend_all", "recommend_ma", "recommend_other",
                       "volatility_daily", "volatility_weekly", "avg_volume_30d",
                       "avg_volume_10d", "avg_volume_90d", "relative_volume_10d",
                       "high_52w", "low_52w", "beta_1y"}
            update_parts = []
            for c in update_cols:
                if c in force_ow:
                    update_parts.append(f'"{c}" = excluded."{c}"')
                else:
                    update_parts.append(f'"{c}" = COALESCE(excluded."{c}", historical_data."{c}")')
            update_set = ", ".join(update_parts)

            try:
                cur.execute(
                    f"""INSERT INTO historical_data ({col_list})
                        VALUES ({placeholders})
                        ON CONFLICT(ticker, date) DO UPDATE SET {update_set}""",
                    tuple(vals[c] for c in cols),
                )
                saved += 1
            except Exception as e:
                # Fallback: UPDATE then INSERT (if no unique index / ON CONFLICT unsupported)
                try:
                    set_clause = ", ".join(f'"{c}" = ?' for c in update_cols)
                    cur.execute(
                        f'UPDATE historical_data SET {set_clause} WHERE ticker = ? AND date = ?',
                        tuple(vals[c] for c in update_cols) + (ticker, today),
                    )
                    if cur.rowcount == 0:
                        cur.execute(
                            f'INSERT OR IGNORE INTO historical_data ({col_list}) VALUES ({placeholders})',
                            tuple(vals[c] for c in cols),
                        )
                    saved += 1
                except Exception as e2:
                    print(f"[data_layer] append_daily_prices error {ticker}: {e2}")
        _conn().commit()
        return saved

    def upsert_indicators(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert TV indicators into existing `historical_data` table.

        The scanner writes indicators as columns in historical_data (via ALTER).
        This is NOT a new table — it enriches the existing historical_data.
        """
        if not rows:
            return 0
        cur = _conn().cursor()
        today = datetime.now().strftime("%Y-%m-%d")
        db_cols = {r[1] for r in cur.execute("PRAGMA table_info(historical_data)").fetchall()}
        indicator_cols = [
            "rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
            "recommend_all", "recommend_ma", "recommend_other",
            "volatility_daily", "volatility_weekly",
            "avg_volume_30d", "avg_volume_10d", "avg_volume_90d",
            "relative_volume_10d", "high_52w", "low_52w", "beta_1y",
        ]
        indicator_cols = [c for c in indicator_cols if c in db_cols]

        # Ensure unique index
        try:
            cur.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_hd_ticker_date ON historical_data(ticker, date)')
        except:
            pass

        saved = 0
        for row in rows:
            ticker = row.get("symbol") or row.get("ticker")
            if not ticker:
                continue
            # Build SET clause for UPDATE
            set_parts = []
            set_vals = []
            for c in indicator_cols:
                if c in row:
                    v = row.get(c)
                    set_parts.append(f'"{c}" = ?')
                    set_vals.append(float(v) if v is not None else None)
            if not set_parts:
                continue
            set_clause = ", ".join(set_parts)
            try:
                cur.execute(
                    f"UPDATE historical_data SET {set_clause} WHERE ticker = ? AND date = ?",
                    set_vals + [ticker, today],
                )
                if cur.rowcount > 0:
                    saved += 1
                else:
                    # Row doesn't exist for today — insert a minimal row with indicators
                    # (the append_daily_prices will fill in OHLCV)
                    cols = ["ticker", "symbol", "date"] + indicator_cols
                    vals = [ticker, ticker, today] + set_vals
                    placeholders = ", ".join(["?"] * len(cols))
                    col_list = ", ".join(f'"{c}"' for c in cols)
                    try:
                        cur.execute(
                            f"INSERT OR IGNORE INTO historical_data ({col_list}) VALUES ({placeholders})",
                            vals,
                        )
                        saved += 1
                    except:
                        pass
            except Exception as e:
                print(f"[data_layer] upsert_indicators error {ticker}: {e}")
        _conn().commit()
        return saved

    # ═══ DIAGNOSTICS ═══════════════════════════════════════════════════════════

    def stats(self) -> Dict[str, Any]:
        """Quick stats for diagnostics."""
        cur = _conn().cursor()
        out = {}
        for t in ["stocks", "historical_data", "egksco_price_history"]:
            try:
                cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                out[t] = cnt
            except Exception:
                out[t] = "ERR"
        try:
            out["stocks_last_update"] = cur.execute(
                "SELECT MAX(last_update) FROM stocks"
            ).fetchone()[0]
        except Exception:
            pass
        try:
            out["historical_data_max_date"] = cur.execute(
                "SELECT MAX(date) FROM historical_data"
            ).fetchone()[0]
        except Exception:
            pass
        try:
            out["historical_data_min_date"] = cur.execute(
                "SELECT MIN(date) FROM historical_data"
            ).fetchone()[0]
        except Exception:
            pass
        try:
            out["stocks_markets"] = {
                r[0]: r[1]
                for r in cur.execute(
                    "SELECT market, COUNT(*) FROM stocks GROUP BY market"
                ).fetchall()
            }
        except Exception:
            pass
        try:
            out["stocks_columns"] = len(cur.execute("PRAGMA table_info(stocks)").fetchall())
        except Exception:
            pass
        try:
            out["historical_data_columns"] = len(cur.execute("PRAGMA table_info(historical_data)").fetchall())
        except Exception:
            pass
        return out


# ─── Singleton ──────────────────────────────────────────────────────────────

data = DataLayer()


if __name__ == "__main__":
    # Quick smoke test
    print("===== DataLayer smoke test (existing tables only) =====")
    s = data.stats()
    for k, v in s.items():
        print(f"  {k}: {v}")

    print("\n===== normalize_market test =====")
    for m in ["egypt", "مصر", "EGX", "ksa", "السعودية", "TADAWUL", None, ""]:
        print(f"  {m!r:15} → {normalize_market(m)!r}")

    print("\n===== get_snapshot('COMI') =====")
    snap = data.get_snapshot("COMI")
    if snap:
        for k in ["symbol", "price", "market", "rsi", "sma20", "sma50", "sma200", "atr", "market_cap"]:
            print(f"  {k}: {snap.get(k)}")

    print("\n===== get_history('COMI', 5) =====")
    hist = data.get_history("COMI", days=5)
    for h in hist:
        print(f"  {h['date']} C={h['close']} V={h['volume']} rsi={h.get('rsi')} src={h['source']}")

    print("\n===== get_indicators('COMI') =====")
    ind = data.get_indicators("COMI")
    if ind:
        for k in ["rsi", "macd", "sma20", "sma50", "sma200", "atr"]:
            print(f"  {k}: {ind.get(k)}")
    else:
        print("  (none)")

#!/usr/bin/env python3
"""
data_engine/data_layer.py — BRAVO-DATA-LAYER (2026-10-29)
=========================================================
طبقة البيانات الموحدة — Single source of truth for all engines.

Owner directive (2026-10-29):
  "البيانات الى بتيجى من محرك البيانات تروح على data_engine.db مش stocks.db"
  "لازم طبقة البيانات هى الى تكون شغالة مش كل ملف يقرأ ويكتب بمزاجة داخل البايثون"
  "لازم كل البيانات تكون حاضرة وجاهزة لاى ملف يطلبها"
  "انت لما تسحب انت الى عارف بتسحب من انهى سوق فلازم انت الى تحط اسم السوق"

Architecture:
  [scrapers] → data_engine.db (canonical source)
                   ↑
              [data_layer.py] ← single read/write API + market normalization
                   ↑
              [V3 + engines + frontend]

Tables in data_engine.db:
  - stocks              : legacy snapshot (fallback)
  - historical_data     : daily OHLCV (all markets, 197K rows, 2021-2026)
  - egksco_price_history: EGX daily OHLCV + buy/sell pressure (60K rows)
  - tv_snapshot         : rich TV scanner snapshot (60 cols) — NEW
  - tv_indicators       : TV indicators time-series — NEW
  - tab_*               : fundamentals (if clean)

Market slug normalization (built-in, transparent to callers):
  API:   egypt / ksa / kuwait / qatar / america / crypto
  Arabic: مصر / السعودية / الكويت / قطر
  DB:    EGX / TADAWUL / KSE / QSE / US / crypto
  All read/write functions accept ANY alias and normalize internally.

Usage (engines):
  from data_engine.data_layer import data
  hist = data.get_history('COMI', days=60)        # → list of OHLCV dicts
  snap = data.get_snapshot('COMI')                 # → current price/vol/RSI/etc
  inds = data.get_indicators('COMI')               # → RSI/SMA/MACD/ATR
  stocks = data.get_market_stocks('EGX')           # → list of tickers

Usage (scanner):
  from data_engine.data_layer import data
  data.upsert_snapshot(rows)        # TV scanner rows → tv_snapshot
  data.upsert_indicators(rows)      # TV indicators → tv_indicators
  data.append_daily_prices(rows)    # today's OHLCV → historical_data
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
# Owner: "انت الى تحط اسم السوق مش البيانات هاتيجى بأسم السوق بتاعها"
# The scanner knows which market it scraped → sets the DB slug explicitly.
# The data layer normalizes any alias on read (handles legacy data).

_CANONICAL = {
    "EGX": "EGX",
    "TADAWUL": "TADAWUL",
    "KSE": "KSE",
    "QSE": "QSE",
    "US": "US",
    "CRYPTO": "crypto",
}

_ALIASES = {
    # English API slugs (lowercase)
    "egypt": "EGX",
    "egx": "EGX",
    "ksa": "TADAWUL",
    "saudi": "TADAWUL",
    "saudiarabia": "TADAWUL",
    "tadawul": "TADAWUL",
    "kuwait": "KSE",
    "kse": "KSE",
    "qatar": "QSE",
    "qse": "QSE",
    "america": "US",
    "us": "US",
    "usa": "US",
    "crypto": "crypto",
    # Arabic
    "مصر": "EGX",
    "السعودية": "TADAWUL",
    "الكويت": "KSE",
    "قطر": "QSE",
    "أمريكا": "US",
    "كريبتو": "crypto",
}


def normalize_market(market: Optional[str]) -> Optional[str]:
    """Normalize any market alias to canonical DB slug.

    'egypt' → 'EGX', 'مصر' → 'EGX', 'EGX' → 'EGX', None → None
    Unknown → uppercase (fail-safe).
    """
    if market is None:
        return None
    m = str(market).strip()
    if not m:
        return None
    # direct canonical
    if m in _CANONICAL:
        return m
    # lowercase alias
    low = m.lower()
    if low in _ALIASES:
        return _ALIASES[low]
    # arabic alias
    if m in _ALIASES:
        return _ALIASES[m]
    # fail-safe: uppercase
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
        """Current snapshot for a stock: price, volume, OHLC, RSI, market_cap, etc.

        Reads from tv_snapshot (preferred) with fallback to legacy stocks table.
        Returns dict with normalized keys, or None if not found.
        """
        cur = _conn().cursor()
        # 1. Try tv_snapshot (rich TV data)
        row = cur.execute(
            "SELECT * FROM tv_snapshot WHERE ticker = ? OR symbol = ? LIMIT 1",
            (ticker, ticker),
        ).fetchone()
        if row:
            d = dict(row)
            d["market"] = normalize_market(d.get("market"))
            return d
        # 2. Fallback: legacy stocks table
        row = cur.execute(
            "SELECT * FROM stocks WHERE symbol = ? LIMIT 1", (ticker,)
        ).fetchone()
        if row:
            d = dict(row)
            d["market"] = normalize_market(d.get("market"))
            d["_source"] = "legacy_stocks"
            return d
        return None

    def get_market_stocks(self, market: str) -> List[str]:
        """List of tickers for a market (normalized)."""
        mk = normalize_market(market)
        if not mk:
            return []
        cur = _conn().cursor()
        # Try tv_snapshot first, then legacy stocks
        rows = cur.execute(
            "SELECT DISTINCT ticker FROM tv_snapshot WHERE market = ? AND ticker IS NOT NULL",
            (mk,),
        ).fetchall()
        if not rows:
            # legacy fallback — try both normalized + original aliases
            for alias in (mk, market):
                rows = cur.execute(
                    "SELECT DISTINCT symbol FROM stocks WHERE market = ? AND symbol IS NOT NULL",
                    (alias,),
                ).fetchall()
                if rows:
                    break
        return [r[0] for r in rows if r[0]]

    def get_market_snapshots(self, market: str) -> List[Dict[str, Any]]:
        """All snapshots for a market (batch read).

        Returns list of dicts (same shape as get_snapshot) for every stock in
        the market. Used by engines that need to filter/scan the whole market.
        """
        mk = normalize_market(market)
        if not mk:
            return []
        cur = _conn().cursor()
        rows = cur.execute(
            "SELECT * FROM tv_snapshot WHERE market = ?", (mk,)
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["market"] = normalize_market(d.get("market"))
            out.append(d)
        # Fallback: legacy stocks table if tv_snapshot empty
        if not out:
            for alias in (mk, market):
                rows = cur.execute(
                    "SELECT * FROM stocks WHERE market = ?", (alias,)
                ).fetchall()
                if rows:
                    for r in rows:
                        d = dict(r)
                        d["market"] = normalize_market(d.get("market"))
                        d["_source"] = "legacy_stocks"
                        out.append(d)
                    break
        return out

    # ═══ READ: price history ═══════════════════════════════════════════════════

    def get_history(
        self,
        ticker: str,
        days: int = 60,
        market: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Daily OHLCV history (oldest → newest).

        Merges:
          - historical_data (all markets, clean)
          - egksco_price_history (EGX only, has buy/sell pressure)
          - tv_snapshot (today's fresh close, if not already in historical_data)

        Returns list of dicts: {date, open, high, low, close, volume, ...}
        """
        cur = _conn().cursor()
        mk = normalize_market(market)

        # 1. historical_data (canonical daily OHLCV)
        rows = cur.execute(
            """SELECT date, open, high, low, close, volume, ticker, market,
                      change_percent
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
                "source": "historical_data",
            }
            history.append(d)
            seen_dates.add(r["date"])

        # 2. egksco_price_history (EGX with buy/sell pressure) — supplement
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

        # 3. tv_snapshot — today's fresh close (if not already in history)
        today = datetime.now().strftime("%Y-%m-%d")
        if today not in seen_dates:
            snap = self.get_snapshot(ticker)
            if snap and snap.get("current_price") and snap["current_price"] > 0:
                history.append(
                    {
                        "date": today,
                        "open": snap.get("open_price") or snap["current_price"],
                        "high": snap.get("high_price") or snap["current_price"],
                        "low": snap.get("low_price") or snap["current_price"],
                        "close": snap["current_price"],
                        "volume": snap.get("volume") or 0,
                        "change_percent": snap.get("change_percent") or 0,
                        "source": "tv_snapshot",
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

        Reads from tv_indicators (preferred). Falls back to tv_snapshot (current).
        Returns dict with rsi, macd, macd_signal, sma20, sma50, sma200, atr,
        recommend_all, etc.
        """
        cur = _conn().cursor()
        if date:
            row = cur.execute(
                "SELECT * FROM tv_indicators WHERE ticker = ? AND date = ? LIMIT 1",
                (ticker, date),
            ).fetchone()
        else:
            row = cur.execute(
                "SELECT * FROM tv_indicators WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (ticker,),
            ).fetchone()
        if row:
            return dict(row)
        # Fallback: current snapshot indicators
        snap = self.get_snapshot(ticker)
        if snap:
            ind_keys = [
                "rsi", "macd", "macd_signal", "sma20", "sma50", "sma200",
                "atr", "recommend_all", "recommend_ma", "recommend_other",
                "volatility_daily", "volatility_weekly", "avg_volume_30d",
                "avg_volume_10d", "avg_volume_90d", "relative_volume_10d",
                "high_52w", "low_52w", "beta_1y",
            ]
            return {k: snap.get(k) for k in ind_keys if k in snap}
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
        """Upsert TV scanner rows into tv_snapshot.

        The scanner sets 'market' to the DB slug (EGX/TADAWUL/etc.) explicitly —
        it knows which market it scraped. Owner: "انت الى تحط اسم السوق".
        """
        if not rows:
            return 0
        cur = _conn().cursor()
        # Get actual columns
        db_cols = {r[1] for r in cur.execute("PRAGMA table_info(tv_snapshot)").fetchall()}
        sample_keys = [k for k in rows[0].keys() if k in db_cols]
        placeholders = ", ".join(["?"] * len(sample_keys))
        col_list = ", ".join(f'"{k}"' for k in sample_keys)
        # Upsert on ticker; backfill symbol if NULL
        update_parts = []
        for k in sample_keys:
            if k in ("id", "ticker"):
                continue
            if k == "symbol":
                update_parts.append(f'"{k}" = COALESCE(tv_snapshot."{k}", excluded."{k}")')
            else:
                update_parts.append(f'"{k}" = excluded."{k}"')
        update_set = ", ".join(update_parts)
        sql = f'''
            INSERT INTO tv_snapshot ({col_list})
            VALUES ({placeholders})
            ON CONFLICT(ticker) DO UPDATE SET {update_set}
        '''
        saved = 0
        for row in rows:
            try:
                cur.execute(sql, tuple(row.get(k) for k in sample_keys))
                saved += 1
            except Exception as e:
                print(f"[data_layer] upsert_snapshot error {row.get('ticker')}: {e}")
        _conn().commit()
        return saved

    def upsert_indicators(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert TV indicators into tv_indicators (one row per stock per day)."""
        if not rows:
            return 0
        cur = _conn().cursor()
        today = datetime.now().strftime("%Y-%m-%d")
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db_cols = {r[1] for r in cur.execute("PRAGMA table_info(tv_indicators)").fetchall()}
        indicator_cols = [
            "rsi", "macd", "macd_signal", "sma20", "sma50", "sma200", "atr",
            "recommend_all", "recommend_ma", "recommend_other",
            "volatility_daily", "volatility_weekly",
            "avg_volume_30d", "avg_volume_10d", "avg_volume_90d",
            "relative_volume_10d", "high_52w", "low_52w", "beta_1y",
        ]
        saved = 0
        for row in rows:
            ticker = row.get("symbol") or row.get("ticker")
            if not ticker:
                continue
            market = normalize_market(row.get("market"))
            vals = {
                "ticker": ticker,
                "date": today,
                "market": market,
                "fetch_time": now_str,
                "source": "tradingview",
            }
            for c in indicator_cols:
                if c in row and c in db_cols:
                    v = row.get(c)
                    vals[c] = float(v) if v is not None else None
            if not any(vals.get(c) is not None for c in indicator_cols):
                continue
            cols = list(vals.keys())
            placeholders = ", ".join(["?"] * len(cols))
            col_list = ", ".join(f'"{c}"' for c in cols)
            update_set = ", ".join(
                f'"{c}" = COALESCE(excluded."{c}", tv_indicators."{c}")'
                for c in cols
                if c not in ("ticker", "date")
            )
            try:
                cur.execute(
                    f"INSERT INTO tv_indicators ({col_list}) VALUES ({placeholders}) "
                    f"ON CONFLICT(ticker, date) DO UPDATE SET {update_set}",
                    tuple(vals[c] for c in cols),
                )
                saved += 1
            except Exception as e:
                print(f"[data_layer] upsert_indicators error {ticker}: {e}")
        _conn().commit()
        return saved

    def append_daily_prices(self, rows: List[Dict[str, Any]]) -> int:
        """Append today's OHLCV from scanner to historical_data (keeps history fresh).

        This ensures historical_data stays current (otherwise it goes stale).
        """
        if not rows:
            return 0
        cur = _conn().cursor()
        today = datetime.now().strftime("%Y-%m-%d")
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        saved = 0
        for row in rows:
            ticker = row.get("symbol") or row.get("ticker")
            if not ticker:
                continue
            close = row.get("current_price")
            if not close or close <= 0:
                continue
            market = normalize_market(row.get("market"))
            open_p = row.get("open_price") or close
            high_p = row.get("high_price") or close
            low_p = row.get("low_price") or close
            volume = row.get("volume") or 0
            change_pct = row.get("change_percent") or 0
            name = row.get("name_ar") or ""
            try:
                cur.execute(
                    """INSERT INTO historical_data
                       (symbol, name, market, date, open, high, low, close, volume,
                        last_fetch, ticker, change_percent)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(ticker, date) DO UPDATE SET
                         close = excluded.close, volume = excluded.volume,
                         open = COALESCE(excluded.open, historical_data.open),
                         high = MAX(excluded.high, historical_data.high),
                         low = MIN(excluded.low, historical_data.low),
                         change_percent = excluded.change_percent,
                         last_fetch = excluded.last_fetch""",
                    (ticker, name, market, today, open_p, high_p, low_p, close, volume, now_str, ticker, change_pct),
                )
                saved += 1
            except Exception as e:
                # ON CONFLICT needs a unique index; if missing, try INSERT OR REPLACE
                try:
                    cur.execute(
                        """INSERT OR REPLACE INTO historical_data
                           (symbol, name, market, date, open, high, low, close, volume,
                            last_fetch, ticker, change_percent)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (ticker, name, market, today, open_p, high_p, low_p, close, volume, now_str, ticker, change_pct),
                    )
                    saved += 1
                except Exception as e2:
                    print(f"[data_layer] append_daily_prices error {ticker}: {e2}")
        _conn().commit()
        return saved

    # ═══ DIAGNOSTICS ═══════════════════════════════════════════════════════════

    def stats(self) -> Dict[str, Any]:
        """Quick stats for diagnostics."""
        cur = _conn().cursor()
        out = {}
        for t in ["tv_snapshot", "tv_indicators", "historical_data", "egksco_price_history", "stocks"]:
            try:
                cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                out[t] = cnt
            except Exception:
                out[t] = "ERR"
        # freshness
        try:
            out["tv_snapshot_last_updated"] = cur.execute(
                "SELECT MAX(last_updated) FROM tv_snapshot"
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
            out["tv_indicators_max_date"] = cur.execute(
                "SELECT MAX(date) FROM tv_indicators"
            ).fetchone()[0]
        except Exception:
            pass
        # market distribution
        try:
            out["tv_snapshot_markets"] = {
                r[0]: r[1]
                for r in cur.execute(
                    "SELECT market, COUNT(*) FROM tv_snapshot GROUP BY market"
                ).fetchall()
            }
        except Exception:
            pass
        return out


# ─── Singleton ──────────────────────────────────────────────────────────────

data = DataLayer()


if __name__ == "__main__":
    # Quick smoke test
    print("===== DataLayer smoke test =====")
    s = data.stats()
    for k, v in s.items():
        print(f"  {k}: {v}")

    print("\n===== normalize_market test =====")
    for m in ["egypt", "مصر", "EGX", "ksa", "السعودية", "TADAWUL", None, ""]:
        print(f"  {m!r:15} → {normalize_market(m)!r}")

    print("\n===== get_history('COMI', 5) =====")
    hist = data.get_history("COMI", days=5)
    for h in hist:
        print(f"  {h['date']} C={h['close']} V={h['volume']} src={h['source']}")

    print("\n===== get_indicators('COMI') =====")
    ind = data.get_indicators("COMI")
    if ind:
        for k in ["rsi", "macd", "sma20", "sma50", "sma200", "atr", "date"]:
            print(f"  {k}: {ind.get(k)}")
    else:
        print("  (none yet — run scanner first)")

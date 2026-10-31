"""
monitoring/live_monitor.py — Live Data Monitoring Service (Phase C).

Monitors data freshness, quality, and availability across all sources.
Does NOT trigger model retraining on data updates.
Distinguishes market-closed periods from ingestion failures.
"""
from __future__ import annotations
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import sqlite3

from ..adapters.readonly_data_adapter import ReadOnlyDataAdapter
from ..config.markets import MARKETS, get_market_meta, is_trading_day


class DataStatus(str, Enum):
    LIVE = "LIVE"
    STALE = "STALE"
    UNAVAILABLE = "UNAVAILABLE"
    MARKET_CLOSED = "MARKET_CLOSED"


@dataclass
class MarketFeedStatus:
    market: str
    status: DataStatus
    latest_update: Optional[str]
    symbol_count: int
    staleness_hours: float
    is_trading_day: bool
    issues: List[str] = field(default_factory=list)


class LiveMonitor:
    """Live data monitoring. Read-only. No retraining triggers."""

    def __init__(self, adapter: Optional[ReadOnlyDataAdapter] = None):
        self._adapter = adapter or ReadOnlyDataAdapter()

    def get_all_markets_status(self) -> List[MarketFeedStatus]:
        results = []
        now = datetime.utcnow()
        for market_code in MARKETS.keys():
            results.append(self._get_market_status(market_code, now))
        return results

    def _get_market_status(self, market: str, now: datetime) -> MarketFeedStatus:
        meta = get_market_meta(market)
        today_dow = now.weekday()
        trading_today = is_trading_day(today_dow, market)

        conn = self._adapter._get_connection("stocks.db")
        latest_update = None
        symbol_count = 0

        if conn:
            try:
                cur = conn.cursor()
                variants = [market]
                if market == "US": variants.append("america")
                elif market == "TADAWUL": variants.append("ksa")
                elif market == "KSE": variants.append("kuwait")

                placeholders = ",".join(["?"] * len(variants))
                cur.execute(
                    f"SELECT MAX(last_update) as latest, COUNT(*) as cnt FROM stocks WHERE market IN ({placeholders})",
                    variants
                )
                r = cur.fetchone()
                if r:
                    latest_update = r["latest"]
                    symbol_count = r["cnt"]
            except sqlite3.Error:
                pass

        staleness_hours = 999.0
        if latest_update:
            try:
                dt_str = str(latest_update)[:19].replace("T", " ")
                update_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
                staleness_hours = (now - update_dt).total_seconds() / 3600
            except (ValueError, TypeError):
                pass

        issues: List[str] = []
        if symbol_count == 0:
            status = DataStatus.UNAVAILABLE
            issues.append("No symbols found")
        elif not trading_today:
            status = DataStatus.MARKET_CLOSED
        elif staleness_hours < 24:
            status = DataStatus.LIVE
        elif staleness_hours < 72:
            status = DataStatus.STALE
            issues.append(f"Data is {staleness_hours:.0f}h old")
        else:
            status = DataStatus.STALE
            issues.append(f"Data is {staleness_hours:.0f}h old — possible ingestion failure")

        return MarketFeedStatus(
            market=market, status=status, latest_update=latest_update,
            symbol_count=symbol_count, staleness_hours=round(staleness_hours, 1),
            is_trading_day=trading_today, issues=issues,
        )

    def get_full_report(self) -> Dict:
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "markets": [m.__dict__ for m in self.get_all_markets_status()],
            "data_freshness": self._adapter.get_data_freshness(),
            "quality_summary": {m: self._adapter.get_quality_summary(m) for m in ["EGX", "TADAWUL", "KSE", "QSE", "US"]},
            "fundamental_coverage": self._adapter.get_fundamental_coverage(),
        }

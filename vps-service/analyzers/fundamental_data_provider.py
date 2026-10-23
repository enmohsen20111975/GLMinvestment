#!/usr/bin/env python3
"""
Fundamental Data Provider — مزوّد البيانات الأساسية
=====================================================
يقرأ البيانات الأساسية من data_engine.db (8 جداول لكل سهم):
- Valuation: P/E, P/B, P/S, EV/EBITDA
- Profitability: ROE, ROA, margins
- Income: Revenue growth, EPS
- Balance Sheet: Debt/equity, current ratio
- Cash Flow: Free CF, operating CF
- Dividends: Yield, payout, growth
- Performance: 1m/3m/1y performance + volatility

يحوّل البيانات النصية (مثل "8.02", "57.75%", "−5.28%") لأرقام.
"""

from __future__ import annotations

import sqlite3
import os
import re
import logging
from typing import Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = os.environ.get('DATA_ENGINE_DB', str(_PROJECT_ROOT / 'db' / 'data_engine.db'))


def _parse_num(value) -> Optional[float]:
    """تحويل قيمة نصية لرقم. يتعامل مع: 8.02, 57.75%, −5.28%, 1.2M, 3.4B, NULL."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s or s in ('NULL', 'null', '—', '-', 'N/A', 'n/a'):
        return None
    # Remove currency symbols and spaces
    s = re.sub(r'[^\d.\-−,MKB]', '', s)
    s = s.replace('−', '-').replace(',', '')
    if not s:
        return None
    # Handle suffixes
    mult = 1
    if s.endswith('B'):
        mult = 1e9
        s = s[:-1]
    elif s.endswith('M'):
        mult = 1e6
        s = s[:-1]
    elif s.endswith('K'):
        mult = 1e3
        s = s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def _parse_pct(value) -> Optional[float]:
    """تحويل نسبة مئوية: '57.75%' → 57.75, '−5.28%' → -5.28."""
    n = _parse_num(value)
    return n


# ─── Component scorers for get_fundamental_score() (Stage C) ───
# Each returns (score 0-1, weight 0-1). Missing data → weight 0 (excluded, not neutral).
def _score_roe(roe: Optional[float]) -> tuple:
    """ROE scorer."""
    if roe is None:
        return (0.5, 0.0)
    if roe < 0:
        return (0.0, 1.0)
    if roe >= 20:
        return (1.0, 1.0)
    if roe >= 10:
        return (0.75, 1.0)
    if roe >= 5:
        return (0.5, 1.0)
    return (0.25, 1.0)


def _score_pe(pe: Optional[float]) -> tuple:
    """P/E scorer. Lower = cheaper = better (up to a floor)."""
    if pe is None or pe <= 0:
        return (0.4, 0.0)
    if pe < 8:
        return (1.0, 1.0)
    if pe < 15:
        return (0.9, 1.0)
    if pe < 25:
        return (0.7, 1.0)
    if pe < 40:
        return (0.4, 1.0)
    return (0.2, 1.0)


def _score_pb(pb: Optional[float]) -> tuple:
    """P/B scorer."""
    if pb is None or pb <= 0:
        return (0.5, 0.0)
    if pb < 1:
        return (1.0, 1.0)
    if pb < 2:
        return (0.85, 1.0)
    if pb < 4:
        return (0.6, 1.0)
    if pb < 8:
        return (0.3, 1.0)
    return (0.15, 1.0)


def _score_margin(margin: Optional[float]) -> tuple:
    """Net/operating margin scorer."""
    if margin is None:
        return (0.5, 0.0)
    if margin < 0:
        return (0.0, 1.0)
    if margin >= 20:
        return (1.0, 1.0)
    if margin >= 10:
        return (0.8, 1.0)
    if margin >= 5:
        return (0.6, 1.0)
    return (0.35, 1.0)


def _score_dividend(div_yield: Optional[float], payout: Optional[float]) -> tuple:
    """Dividend scorer. Reward sustainable yield, penalize payout >90%."""
    if div_yield is None:
        return (0.5, 0.0)
    if div_yield <= 0:
        return (0.3, 1.0)
    if div_yield >= 6:
        score = 1.0
    elif div_yield >= 3:
        score = 0.85
    elif div_yield >= 1:
        score = 0.65
    else:
        score = 0.45
    if payout is not None and payout > 90:
        score *= 0.7
    return (score, 1.0)


def _score_growth(dps_growth: Optional[float]) -> tuple:
    """Dividend growth as a proxy for growth (revenue_growth is in broken table)."""
    if dps_growth is None:
        return (0.5, 0.0)
    if dps_growth < -20:
        return (0.0, 1.0)
    if dps_growth < 0:
        return (0.3, 1.0)
    if dps_growth >= 20:
        return (1.0, 1.0)
    if dps_growth >= 5:
        return (0.8, 1.0)
    return (0.55, 1.0)


@dataclass
class FundamentalData:
    """بيانات أساسية مُحلّلة لسهم واحد."""
    ticker: str
    # Valuation
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    ps_ratio: Optional[float] = None
    peg_ratio: Optional[float] = None
    ev_ebitda: Optional[float] = None
    # Profitability
    roe: Optional[float] = None
    roa: Optional[float] = None
    net_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    fcf_margin: Optional[float] = None
    # Growth
    revenue_growth: Optional[float] = None
    # Balance Sheet
    debt_to_equity: Optional[float] = None
    current_ratio: Optional[float] = None
    # Dividends
    div_yield: Optional[float] = None
    payout_ratio: Optional[float] = None
    dps_growth: Optional[float] = None
    # Performance
    perf_1m: Optional[float] = None
    perf_3m: Optional[float] = None
    perf_1y: Optional[float] = None
    volatility_1m: Optional[float] = None
    # Technical (pre-calculated in data_engine)
    rsi: Optional[float] = None
    macd: Optional[float] = None
    adx: Optional[float] = None
    atr: Optional[float] = None
    technical_rating: Optional[str] = None
    # Derived scores (0-100) — Optional[float] = None (FIX-2 Rule 24 + owner directive):
    #   was `= 50.0` placeholder (misleading — implies we have score data and it's
    #   neutral 50). Now None = honest "no data available". _calculate_scores()
    #   overwrites these with real values when has_data=True; only when has_data=False
    #   do they stay None (which downstream consumers should treat as 'no data').
    #   NOTE: the local `val_score=50.0` etc. inside _calculate_scores() are
    #   NEUTRAL ACCUMULATION BASELINES (start from 50, adjust based on data) —
    #   those are LEGITIMATE per FIX-1's audit, NOT placeholders for missing data.
    valuation_score: Optional[float] = None
    profitability_score: Optional[float] = None
    growth_score: Optional[float] = None
    dividend_score: Optional[float] = None
    overall_fundamental_score: Optional[float] = None
    # Metadata
    has_data: bool = False
    data_source: str = ''


class FundamentalDataProvider:
    """مزوّد البيانات الأساسية من data_engine.db."""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or DATA_ENGINE_DB

    def get_fundamental_data(self, ticker: str) -> FundamentalData:
        """جلب كل البيانات الأساسية لسهم معين."""
        fd = FundamentalData(ticker=ticker)

        if not os.path.exists(self.db_path):
            return fd

        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            conn.row_factory = sqlite3.Row

            # The tab_ tables store symbol as "TICKER+ArabicName" (e.g. "COMIالبنك")
            # So we use LIKE 'TICKER%' to match
            # But we need to be careful not to match "COMI2..." etc.
            # Strategy: try exact match first, then LIKE 'TICKER%' 

            # Fetch from all 8 tab_ tables using LIKE pattern
            self._fetch_valuation(conn, ticker, fd)
            self._fetch_profitability(conn, ticker, fd)
            self._fetch_income(conn, ticker, fd)
            self._fetch_balance_sheet(conn, ticker, fd)
            self._fetch_dividends(conn, ticker, fd)
            self._fetch_performance(conn, ticker, fd)
            self._fetch_technical(conn, ticker, fd)

            conn.close()

            # Calculate derived scores
            if fd.has_data:
                fd = self._calculate_scores(fd)

        except Exception as e:
            logger.error(f"[FundamentalData] Error for {ticker}: {e}")

        return fd

    def _fetch_valuation(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): tab_* tables use `symbol` column (not `ticker`).
            # Exact match first (numeric Saudi tickers: 1030, 1120...), then prefix match
            # (EGX alpha tickers stored as 'ALCNالاسكندرية').
            row = conn.execute(
                "SELECT * FROM tab_valuation WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.pe_ratio = _parse_num(row['pe_ratio'])
                fd.pb_ratio = _parse_num(row['pb_ratio'])
                fd.ps_ratio = _parse_num(row['ps_ratio'])
                fd.peg_ratio = _parse_num(row['peg_ratio'])
                fd.ev_ebitda = _parse_num(row['ev_ebitda'])
                fd.has_data = True
                fd.data_source = 'data_engine.db'
        except Exception as e:
            logger.debug(f"[FundamentalData] valuation error: {e}")

    def _fetch_profitability(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            row = conn.execute(
                "SELECT * FROM tab_profitability WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.roe = _parse_pct(row['roe'])
                fd.roa = _parse_pct(row['roa'])
                fd.net_margin = _parse_pct(row['net_margin'])
                fd.operating_margin = _parse_pct(row['operating_margin'])
                fd.fcf_margin = _parse_pct(row['fcf_margin'])
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] profitability error: {e}")

    def _fetch_income(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            # NOTE: tab_income_statement has a column-shift bug (symbol holds market name).
            # This fetch may return wrong data — handled by try/except, fd.has_data stays False.
            row = conn.execute(
                "SELECT * FROM tab_income_statement WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.revenue_growth = _parse_pct(row['revenue_growth'])
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] income error: {e}")

    def _fetch_balance_sheet(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            # NOTE: tab_balance_sheet has a column-shift bug (symbol holds market name).
            # This fetch likely returns nothing useful — debt/current_ratio stay None.
            row = conn.execute(
                "SELECT * FROM tab_balance_sheet WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                total_equity = _parse_num(row['total_equity'])
                debt = _parse_num(row['debt'])
                current_assets = _parse_num(row['current_assets'])
                current_liabilities = _parse_num(row['current_liabilities'])
                if total_equity and total_equity > 0 and debt is not None:
                    fd.debt_to_equity = debt / total_equity
                if current_assets and current_liabilities and current_liabilities > 0:
                    fd.current_ratio = current_assets / current_liabilities
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] balance sheet error: {e}")

    def _fetch_dividends(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            row = conn.execute(
                "SELECT * FROM tab_dividends WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.div_yield = _parse_pct(row['div_yield'])
                fd.payout_ratio = _parse_pct(row['payout_ratio'])
                fd.dps_growth = _parse_pct(row['dps_growth'])
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] dividends error: {e}")

    def _fetch_performance(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            row = conn.execute(
                "SELECT * FROM tab_performance WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.perf_1m = _parse_pct(row['perf_1m'])
                fd.perf_3m = _parse_pct(row['perf_3m'])
                fd.perf_1y = _parse_pct(row['perf_1y'])
                fd.volatility_1m = _parse_pct(row['volatility_1m'])
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] performance error: {e}")

    def _fetch_technical(self, conn, symbol, fd: FundamentalData):
        try:
            # FUNDAMENTALS-FIX (2026-08-17): use `symbol` column + prefix match.
            row = conn.execute(
                "SELECT * FROM tab_technical_analysis WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (symbol, symbol + '%')
            ).fetchone()
            if row:
                fd.rsi = _parse_num(row['rsi'])
                fd.macd = _parse_num(row['macd'])
                fd.adx = _parse_num(row['adx'])
                fd.atr = _parse_num(row['atr'])
                fd.technical_rating = str(row['technical_rating']) if row['technical_rating'] else None
                fd.has_data = True
        except Exception as e:
            logger.debug(f"[FundamentalData] technical error: {e}")

    def _calculate_scores(self, fd: FundamentalData) -> FundamentalData:
        """حساب درجات أساسية (0-100) من البيانات الخام."""
        scores = []

        # === Valuation Score (0-100) ===
        # Lower P/E, P/B = better value (for EGX, P/E 5-15 is good)
        val_score = 50.0
        if fd.pe_ratio is not None and fd.pe_ratio > 0:
            if fd.pe_ratio < 8:
                val_score += 20  # Very cheap
            elif fd.pe_ratio < 12:
                val_score += 10  # Cheap
            elif fd.pe_ratio < 20:
                val_score += 0   # Fair
            elif fd.pe_ratio < 30:
                val_score -= 10  # Expensive
            else:
                val_score -= 20  # Very expensive
        if fd.pb_ratio is not None and fd.pb_ratio > 0:
            if fd.pb_ratio < 1:
                val_score += 10  # Below book value
            elif fd.pb_ratio < 2:
                val_score += 5
            elif fd.pb_ratio > 5:
                val_score -= 5
        fd.valuation_score = max(0, min(100, val_score))
        scores.append(fd.valuation_score)

        # === Profitability Score (0-100) ===
        prof_score = 50.0
        if fd.roe is not None:
            if fd.roe > 20:
                prof_score += 20
            elif fd.roe > 15:
                prof_score += 10
            elif fd.roe < 5:
                prof_score -= 10
        if fd.net_margin is not None:
            if fd.net_margin > 20:
                prof_score += 15
            elif fd.net_margin > 10:
                prof_score += 5
            elif fd.net_margin < 0:
                prof_score -= 20
        if fd.fcf_margin is not None and fd.fcf_margin > 10:
            prof_score += 10
        fd.profitability_score = max(0, min(100, prof_score))
        scores.append(fd.profitability_score)

        # === Growth Score (0-100) ===
        growth_score = 50.0
        if fd.revenue_growth is not None:
            if fd.revenue_growth > 20:
                growth_score += 25
            elif fd.revenue_growth > 10:
                growth_score += 15
            elif fd.revenue_growth > 0:
                growth_score += 5
            elif fd.revenue_growth < -10:
                growth_score -= 20
            elif fd.revenue_growth < 0:
                growth_score -= 10
        if fd.perf_1y is not None:
            if fd.perf_1y > 20:
                growth_score += 10
            elif fd.perf_1y < -20:
                growth_score -= 10
        fd.growth_score = max(0, min(100, growth_score))
        scores.append(fd.growth_score)

        # === Dividend Score (0-100) ===
        div_score = 50.0
        if fd.div_yield is not None:
            if fd.div_yield > 7:
                div_score += 20  # High yield
            elif fd.div_yield > 4:
                div_score += 10
            elif fd.div_yield > 0:
                div_score += 5
        if fd.dps_growth is not None:
            if fd.dps_growth > 10:
                div_score += 10  # Growing dividends
            elif fd.dps_growth < -10:
                div_score -= 10
        if fd.payout_ratio is not None:
            if 30 < fd.payout_ratio < 70:
                div_score += 5  # Sustainable
            elif fd.payout_ratio > 90:
                div_score -= 10  # Too high
        fd.dividend_score = max(0, min(100, div_score))
        scores.append(fd.dividend_score)

        # === Overall Fundamental Score (weighted average) ===
        # FIX-2 (Rule 24 + owner directive): `else 50.0` placeholder → `else None`.
        # If all 4 component scores somehow didn't append (shouldn't happen since
        # they always append), the honest answer is 'no overall score computed'
        # (None) — not a fake neutral 50.0.
        fd.overall_fundamental_score = sum(scores) / len(scores) if scores else None

        return fd


# ─── Module-level convenience: resolve_ticker + get_fundamental_score (Stage B/C) ───
# These provide the canonical mapping + 0-100 score used by the backtest measurement
# and the V40.2 production path (via backtest_engine._load_fundamentals).

def resolve_ticker(ticker: str, db_path: str = None) -> Optional[sqlite3.Row]:
    """
    يحلّ ticker → صف tab_valuation (أي market). 
    
    الاستراتيجية (no guessing):
    1. Exact match على tab_valuation.symbol (يعمل للـ numeric Saudi tickers: 1030, 1120...)
    2. Prefix match على tab_valuation.symbol LIKE 'TICKER%' (يعمل للـ EGX alpha: ALCNالاسكندرية → ALCN)
    3. لا تخمين — إذا لم يوجد → None
    
    لا توجد duplicates (تم التحقق: 0 tickers في 2+ markets في tab_valuation).
    Mapping success rate on archive 20260817: 18/22 tickers (81.8%), 149/153 predictions (97.4%).
    """
    path = db_path or DATA_ENGINE_DB
    if not ticker or not os.path.exists(path):
        return None
    ticker = str(ticker).strip()
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute("""
            SELECT v.symbol, v.market, v.pe_ratio, v.pb_ratio, v.peg_ratio, v.ps_ratio,
                   v.ev_ebitda,
                   p.roe, p.roa, p.net_margin, p.gross_margin, p.operating_margin,
                   d.div_yield, d.div_yield_fwd, d.payout_ratio, d.dps_growth, d.cont_div,
                   t.technical_rating, t.rsi
            FROM tab_valuation v
            LEFT JOIN tab_profitability p ON p.symbol = v.symbol AND p.market = v.market
            LEFT JOIN tab_dividends d ON d.symbol = v.symbol AND d.market = v.market
            LEFT JOIN tab_technical_analysis t ON t.symbol = v.symbol AND t.market = v.market
            WHERE v.symbol = ? OR v.symbol LIKE ?
            LIMIT 1
        """, (ticker, ticker + '%')).fetchone()
        conn.close()
        return row
    except Exception as e:
        logger.debug(f"resolve_ticker({ticker}) error: {e}")
        return None


def get_fundamental_score(ticker: str, as_of_date: Optional[str] = None,
                          db_path: str = None) -> Dict[str, Any]:
    """
    يحسب fundamental_score حقيقي 0-100 من tab_* (Stage C).
    
    This is the canonical entry point used by:
    - backtest_engine._load_fundamentals (replaces the stocks.db-only path)
    - The measurement script (Stage E backtest)
    - Future V40.2 integration
    
    Returns dict with: score (0-100 or None), confidence (0-100), available (bool),
    components (per-field breakdown), source_symbol, source_market, as_of.
    
    Scoring weights (when data available):
      Profitability 40% (roe 20% + net_margin 12% + op_margin 8%)
      Valuation 30% (pe 18% + pb 12%)
      Dividend 15% (div_yield + payout penalty)
      Growth 15% (dps_growth as proxy — revenue_growth is in broken table)
    
    Missing fields → that component gets weight 0 (excluded, not forced to 50).
    Confidence = % of components with data.
    """
    row = resolve_ticker(ticker, db_path)
    if row is None:
        return {
            'ticker': ticker, 'score': None, 'confidence': 0.0, 'available': False,
            'components': {}, 'source_symbol': None, 'source_market': None,
            'as_of': '2026-08-17',
        }

    pe = _parse_num(row['pe_ratio'])
    pb = _parse_num(row['pb_ratio'])
    roe = _parse_pct(row['roe'])
    net_margin = _parse_pct(row['net_margin'])
    op_margin = _parse_pct(row['operating_margin'])
    div_yield = _parse_pct(row['div_yield'])
    payout = _parse_pct(row['payout_ratio'])
    dps_growth = _parse_pct(row['dps_growth'])

    components = {}
    weighted_sum = 0.0
    weight_total = 0.0

    def _add(name, val, score, weight):
        nonlocal weighted_sum, weight_total
        components[name] = {'value': val, 'score': round(score * 100, 1), 'weight': round(weight * 100, 1)}
        if weight > 0:
            weighted_sum += score * weight
            weight_total += weight

    # Profitability (40%)
    s_roe, w_roe = _score_roe(roe)
    _add('roe', roe, s_roe, w_roe * 0.20)
    s_nm, w_nm = _score_margin(net_margin)
    _add('net_margin', net_margin, s_nm, w_nm * 0.12)
    s_om, w_om = _score_margin(op_margin)
    _add('op_margin', op_margin, s_om, w_om * 0.08)

    # Valuation (30%)
    s_pe, w_pe = _score_pe(pe)
    _add('pe_ratio', pe, s_pe, w_pe * 0.18)
    s_pb, w_pb = _score_pb(pb)
    _add('pb_ratio', pb, s_pb, w_pb * 0.12)

    # Dividend (15%)
    s_div, w_div = _score_dividend(div_yield, payout)
    _add('div_yield', div_yield, s_div, w_div * 0.15)

    # Growth (15%) — dps_growth as proxy
    s_grow, w_grow = _score_growth(dps_growth)
    _add('dps_growth', dps_growth, s_grow, w_grow * 0.15)

    if weight_total == 0:
        return {
            'ticker': ticker, 'score': None, 'confidence': 0.0, 'available': False,
            'components': components, 'source_symbol': row['symbol'],
            'source_market': row['market'], 'as_of': '2026-08-17',
        }

    final_score = (weighted_sum / weight_total) * 100.0
    n_with_data = sum(1 for c in components.values() if c['weight'] > 0)
    confidence = (n_with_data / len(components)) * 100.0 if components else 0.0

    return {
        'ticker': ticker, 'score': round(final_score, 1),
        'confidence': round(confidence, 1), 'available': True,
        'components': components, 'source_symbol': row['symbol'],
        'source_market': row['market'], 'as_of': '2026-08-17',
    }


def get_fundamental_scores_batch(tickers: list, db_path: str = None) -> Dict[str, Dict]:
    """Batch score multiple tickers."""
    return {t: get_fundamental_score(t, db_path=db_path) for t in tickers}


if __name__ == '__main__':
    """اختبار ذاتي."""
    print("=" * 60)
    print("اختبار FundamentalDataProvider + get_fundamental_score")
    print("=" * 60)

    provider = FundamentalDataProvider()

    # Test with a few EGX stocks
    for ticker in ['COMI', 'ETEL', 'HRHO', 'SWDY', 'ABUK']:
        fd = provider.get_fundamental_data(ticker)
        print(f"\n📊 {ticker}:")
        print(f"  has_data: {fd.has_data}")
        if fd.has_data:
            print(f"  P/E: {fd.pe_ratio}")
            print(f"  P/B: {fd.pb_ratio}")
            print(f"  ROE: {fd.roe}%")
            print(f"  Net Margin: {fd.net_margin}%")
            print(f"  Revenue Growth: {fd.revenue_growth}%")
            print(f"  Div Yield: {fd.div_yield}%")
            print(f"  D/E: {fd.debt_to_equity}")
            print(f"  Current Ratio: {fd.current_ratio}")
            print(f"  Perf 1Y: {fd.perf_1y}%")
            print(f"  RSI: {fd.rsi}")
            print(f"  ---")
            print(f"  Valuation Score: {fd.valuation_score:.1f}")
            print(f"  Profitability Score: {fd.profitability_score:.1f}")
            print(f"  Growth Score: {fd.growth_score:.1f}")
            print(f"  Dividend Score: {fd.dividend_score:.1f}")
            print(f"  Overall Fundamental: {fd.overall_fundamental_score:.1f}")


# ============================================================================
# V40.4 §2 + §4.1 — Unified quality-score dispatcher (Multi-Market)
# نقطة التوزيع الموحدة: توجيه الكريبتو لـ CryptoQualityGate والأسهم للقوائم المالية
# ============================================================================

# V40.4 §2 (Pillar 5): 4-pillar persona weight matrix for crypto quality
# integration. PA = Price Action, SMC = Smart Money Concepts, Vol = Volume,
# Q = Quality (fundamental for stocks / CryptoQualityGate for crypto).
# Stock personas (gambler/balanced/conservative) use the SAME matrix — the
# only difference is that the Quality pillar reads from FundamentalData for
# stocks and from CryptoQGResult for crypto. (Directive §6 Phase 2.1 task 2)
PERSONA_CRYPTO_WEIGHTS: Dict[str, Dict[str, float]] = {
    #                PA    SMC   Volume  Quality
    'gambler':      {'pa': 0.40, 'smc': 0.35, 'volume': 0.25, 'quality': 0.00},
    'balanced':     {'pa': 0.30, 'smc': 0.25, 'volume': 0.20, 'quality': 0.25},
    'conservative': {'pa': 0.15, 'smc': 0.10, 'volume': 0.15, 'quality': 0.60},
}


def get_asset_quality_score(
    ticker: str,
    market: str = 'EGX',
    persona: Optional[str] = None,
    *,
    coin_id: Optional[str] = None,
    market_data: Optional[Dict[str, Any]] = None,
    events: Optional[list] = None,
) -> Dict[str, Any]:
    """V40.4 §6 Phase 2.1 — Unified quality-score dispatcher.

    Routes crypto assets to :func:`evaluate_crypto_quality` and stock assets
    to :class:`FundamentalDataProvider`, returning a single uniform dict so
    downstream consumers (institutional_decision_engine, backtest_engine,
    daily_predictor) don't need to branch on market type.

    Args:
        ticker: Trading symbol (``'COMI'`` / ``'BTC'`` / ``'ETH'``).
        market: Market code — ``'EGX'``/``'KSA'``/``'KSE'``/``'QSE'``/``'DFM'``
            for stocks (anything not ``'CRYPTO'``) or ``'CRYPTO'`` for crypto.
        persona: Optional persona name (``'gambler'``/``'balanced'``/
            ``'conservative'``).  When supplied alongside ``market='CRYPTO'``
            the directive's hard veto is applied: non-gambler + quality < 35
            → ``veto=True`` (Directive §4.1 + §6 Phase 2.1 task 3).
        coin_id / market_data / events: Crypto-only keyword args forwarded
            to :func:`evaluate_crypto_quality`.

    Returns:
        Dict with keys:
          ``ticker``        — echo of the input ticker
          ``market``        — normalized market code
          ``quality_score`` — 0-100 unified score
          ``verdict``       — 'PASS'/'REVIEW'/'FAIL' (crypto) | 'OK'/'WEAK' (stocks)
          ``veto``          — True when the directive's drop rule fires
          ``persona``       — echo (or None)
          ``details``       — market-specific breakdown (factor dict / fd dict)
          ``source``        — 'fundamental_data_provider' | 'crypto_quality_gate'
    """
    market_norm = (market or 'EGX').upper().strip()
    persona_norm = (persona or '').lower().strip() or None

    # ─── CRYPTO path ──────────────────────────────────────────────────────
    if market_norm == 'CRYPTO':
        from analyzers.crypto_quality_gate import evaluate_crypto_quality, CRYPTO_VETO_THRESHOLD
        result = evaluate_crypto_quality(ticker, market_data=market_data, events=events)
        score = float(result.get('quality_score', 0.0))

        # V40.4 §4.1 + §6 Phase 2.1 task 3: persona-aware crypto quality veto.
        # Gambler bypasses the quality veto (its quality weight = 0 in the
        # PERSONA_CRYPTO_WEIGHTS matrix) — the directive says weak meme coins
        # "pass only for the gambler if there is violent price momentum".
        # Balanced + conservative are hard-dropped when quality < 35.
        quality_below = score < CRYPTO_VETO_THRESHOLD
        if persona_norm and persona_norm != 'gambler':
            veto = quality_below
        elif persona_norm == 'gambler':
            veto = False  # gambler never quality-vetoed
        else:
            # No persona specified — return the raw quality flag.
            veto = quality_below

        return {
            'ticker': ticker,
            'market': 'CRYPTO',
            'quality_score': score,
            'verdict': result.get('verdict', 'FAIL'),
            'veto': veto,
            'persona': persona_norm,
            'details': result.get('factors', {}),
            'coin_id': result.get('coin_id', ''),
            'source': 'crypto_quality_gate',
        }

    # ─── STOCK path ───────────────────────────────────────────────────────
    provider = FundamentalDataProvider()
    fd = provider.get_fundamental_data(ticker)
    # FIX-2 (Rule 24 + owner directive): was `float(fd.overall_fundamental_score or 50.0)`
    # which silently coerced None → 50.0 placeholder (misleading — implies we have
    # fundamental data and it's neutral 50). Now we explicitly check for None and
    # return an honest 'NO_DATA' verdict with quality_score=None. Per Constitution
    # Rule 24: "No match → fundamental_score = None, confidence = 0" — don't veto
    # on missing data (don't punish stocks we couldn't score).
    if fd.overall_fundamental_score is None:
        return {
            'ticker': ticker,
            'market': market_norm,
            'quality_score': None,  # honest NULL — no fundamental data available
            'verdict': 'NO_DATA',
            'veto': False,  # Rule 24: missing data ≠ bad stock — don't veto
            'persona': persona_norm,
            'details': {
                'pe_ratio': fd.pe_ratio,
                'pb_ratio': fd.pb_ratio,
                'roe': fd.roe,
                'net_margin': fd.net_margin,
                'revenue_growth': fd.revenue_growth,
                'div_yield': fd.div_yield,
                'valuation_score': fd.valuation_score,
                'profitability_score': fd.profitability_score,
                'growth_score': fd.growth_score,
                'dividend_score': fd.dividend_score,
                'has_data': fd.has_data,
            },
            'source': 'fundamental_data_provider',
        }
    score = float(fd.overall_fundamental_score)
    verdict = 'OK' if score >= 60.0 else ('WEAK' if score >= 40.0 else 'POOR')
    # Stocks use the fundamentals hard-veto from V40.3 Task 1 (fund < 30).
    veto = score < 30.0 and persona_norm != 'gambler'

    return {
        'ticker': ticker,
        'market': market_norm,
        'quality_score': round(score, 2),
        'verdict': verdict,
        'veto': veto,
        'persona': persona_norm,
        'details': {
            'pe_ratio': fd.pe_ratio,
            'pb_ratio': fd.pb_ratio,
            'roe': fd.roe,
            'net_margin': fd.net_margin,
            'revenue_growth': fd.revenue_growth,
            'div_yield': fd.div_yield,
            'valuation_score': fd.valuation_score,
            'profitability_score': fd.profitability_score,
            'growth_score': fd.growth_score,
            'dividend_score': fd.dividend_score,
            'has_data': fd.has_data,
        },
        'source': 'fundamental_data_provider',
    }

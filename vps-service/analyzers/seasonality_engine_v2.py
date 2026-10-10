"""
Seasonality Engine V2 — REAL DATA-DRIVEN
========================================
محرك الموسمية الإصدار الثاني — مدفوع بالبيانات الحقيقية (مش hardcoded)

يحلّ محل seasonality_scorer.py (V1) الذي كان يعتمد على قيم ثابتة.

المهمة: تحليل الأنماط الموسمية الحقيقية من بيانات price_history +
stock_daily_prices، بدلاً من الافتراضات الثابتة.

الأنماط المكتشفة:
- تأثير الشهر (January Effect / March Effect)
- تأثير يوم الأسبوع (Thursday Effect / Monday Effect)
- تأثير رمضان (انخفاض السيولة والتركيز)
- مواسم الإعلانات المالية (Q1-Q4 windows)
- الانخفاضات المتكررة (recurring drops) لكل سهم على حدة
- موسمية القطاع (sector seasonality)

القاعدة الذهبية للخبير "زد":
  "الموسمية مساعدة مش كفّارة"
  → total_score = تعديل إضافي (additive) في النطاق [-20, +20]
    مش نتيجة 0-100 أساسية.

Author: دليل الاستثمار (Phase 8 — Seasonality V2)
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
import statistics
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple


# ============================================================================
# CONSTANTS
# ============================================================================

# Verified Ramadan start/end dates (Gregorian) for 2024-2027.
# Source: Dar al-Ifta al-Misriyyah & Umm al-Qura calendar approximations.
# Ramadan shifts ~10-11 days earlier each Gregorian year.
VERIFIED_RAMADAN_DATES: Dict[int, Tuple[date, date]] = {
    2024: (date(2024, 3, 11), date(2024, 4, 9)),
    2025: (date(2025, 3, 1),  date(2025, 3, 30)),
    2026: (date(2026, 2, 18), date(2026, 3, 19)),
    2027: (date(2027, 2, 8),  date(2027, 3, 9)),
}

# Egyptian fiscal-year earnings announcement windows (typical).
# Most EGX-listed companies follow a Jan-Dec fiscal year and announce:
#   Q1 (Jan-Mar)  → announced in May
#   Q2 (Apr-Jun)  → announced in August
#   Q3 (Jul-Sep)  → announced in November
#   Q4 / Annual   → announced in February/March
EARNINGS_WINDOWS: Dict[int, str] = {
    2:  'Q4/Annual earnings window (Feb-Mar)',
    3:  'Q4/Annual earnings window (Feb-Mar)',
    5:  'Q1 earnings window (May)',
    8:  'Q2 earnings window (August)',
    11: 'Q3 earnings window (November)',
}

# Max adjustment range (per expert guidance: -20 to +20)
MAX_ADJUSTMENT = 20.0
MIN_ADJUSTMENT = -20.0

# Sample-size thresholds — below these we return NEUTRAL with low confidence
MIN_SAMPLE_DAYS_PER_MONTH = 3   # need at least 3 days in a month-year cell
MIN_YEAR_SAMPLE_FOR_PATTERN = 2  # need 2+ years of data for a "pattern"


# ============================================================================
# HELPERS
# ============================================================================

def _open_stocks_db(db_path: str) -> Optional[sqlite3.Connection]:
    """Open stocks.db in readonly mode if possible."""
    try:
        if db_path.startswith('file:'):
            uri = db_path if 'mode=ro' in db_path else db_path + '?mode=ro'
            return sqlite3.connect(uri, uri=True)
        # Try readonly URI
        if os.path.exists(db_path):
            uri = f'file:{db_path}?mode=ro'
            return sqlite3.connect(uri, uri=True)
    except Exception:
        pass
    try:
        return sqlite3.connect(db_path)
    except Exception:
        return None


def _open_price_history_db(db_path: str) -> Optional[sqlite3.Connection]:
    """Open price_history.db (sibling of stocks.db) in readonly mode."""
    try:
        db_dir = os.path.dirname(os.path.abspath(db_path))
        ph_path = os.path.join(db_dir, 'price_history.db')
        if not os.path.exists(ph_path):
            return None
        return sqlite3.connect(f'file:{ph_path}?mode=ro', uri=True)
    except Exception:
        return None


def _parse_volume(raw) -> int:
    """Parse a volume value that may be a string like '20.72 K', '1.44M', '3.5 K' (with possible narrow no-break space U+202F)."""
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        try:
            return int(raw)
        except Exception:
            return 0
    try:
        s = str(raw).strip()
        if not s:
            return 0
        # Strip all whitespace incl. narrow no-break space U+202F and regular NBSP U+00A0
        s = s.replace('\u202f', '').replace('\u00a0', '').replace(' ', '').replace(',', '')
        if not s:
            return 0
        mult = 1
        suffix = s[-1].upper()
        if suffix == 'K':
            mult = 1_000
            s = s[:-1]
        elif suffix == 'M':
            mult = 1_000_000
            s = s[:-1]
        elif suffix == 'B':
            mult = 1_000_000_000
            s = s[:-1]
        try:
            return int(float(s) * mult)
        except Exception:
            return 0
    except Exception:
        return 0


def _safe_avg(values: List[float]) -> float:
    """Average of a list; returns 0.0 on empty."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _safe_median(values: List[float]) -> float:
    """Median of a list; returns 0.0 on empty."""
    if not values:
        return 0.0
    try:
        return float(statistics.median(values))
    except Exception:
        return 0.0


def _win_rate(returns: List[float]) -> float:
    """Fraction of positive returns (0-1)."""
    if not returns:
        return 0.0
    wins = sum(1 for r in returns if r > 0)
    return wins / len(returns)


def _classify_strength(avg_return_pct: float, win_rate: float, sample: int) -> str:
    """Classify a seasonal cell as STRONG / WEAK / NEUTRAL."""
    if sample < MIN_SAMPLE_DAYS_PER_MONTH:
        return 'NEUTRAL'
    if avg_return_pct >= 1.0 and win_rate >= 0.6:
        return 'STRONG'
    if avg_return_pct <= -1.0 and win_rate <= 0.4:
        return 'WEAK'
    return 'NEUTRAL'


# ============================================================================
# MAIN ENGINE
# ============================================================================

class SeasonalityEngineV2:
    """REAL DATA-DRIVEN seasonality engine.

    Replaces the hardcoded V1 (seasonality_scorer.py).
    Computes monthly return heatmaps, sector seasonality, recurring drops,
    Ramadan status, and earnings-window status from actual price data.

    Usage:
        engine = SeasonalityEngineV2('/path/to/stocks.db')
        result = engine.analyze('COMI', sector='القطاع المالي')
        # result['total_score'] is in [-20, +20]
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._price_history_db_path: Optional[str] = None
        # Resolve price_history.db path
        try:
            db_dir = os.path.dirname(os.path.abspath(db_path))
            ph_path = os.path.join(db_dir, 'price_history.db')
            if os.path.exists(ph_path):
                self._price_history_db_path = ph_path
        except Exception:
            pass

    # ----------------------------------------------------------------------
    # DATA ACCESS
    # ----------------------------------------------------------------------

    def _fetch_daily_prices(self, ticker: str, years: int = 5) -> List[Tuple[str, float, float, float, float, int]]:
        """Fetch daily OHLCV for `ticker` from both price_history.db and stocks.db.

        Merges and de-dupes by date. Returns rows sorted ASC by date.
        Row tuple: (date_str, open, high, low, close, volume)
        """
        cutoff_date = (date.today() - timedelta(days=years * 365 + 30)).isoformat()
        rows: Dict[str, Tuple[str, float, float, float, float, int]] = {}

        # 1) price_history.db (the historical archive — long history)
        if self._price_history_db_path:
            try:
                conn = sqlite3.connect(f'file:{self._price_history_db_path}?mode=ro', uri=True)
                cur = conn.cursor()
                cur.execute(
                    "SELECT date, open_price, high_price, low_price, close_price, volume "
                    "FROM price_history WHERE ticker = ? AND date >= ? "
                    "ORDER BY date ASC",
                    (ticker, cutoff_date),
                )
                for r in cur.fetchall():
                    d = r[0]
                    if d not in rows and r[4] and r[4] > 0:
                        rows[d] = (r[0], float(r[1] or 0), float(r[2] or 0),
                                   float(r[3] or 0), float(r[4]), _parse_volume(r[5]))
                conn.close()
            except Exception as e:
                print(f"[SeasonalityV2] price_history fetch failed for {ticker}: {e}")

        # 2) stocks.db.stock_daily_prices (more recent, more complete)
        try:
            conn = _open_stocks_db(self.db_path)
            if conn is not None:
                cur = conn.cursor()
                cur.execute(
                    "SELECT price_date, open, high, low, close, volume "
                    "FROM stock_daily_prices WHERE ticker = ? AND price_date >= ? "
                    "ORDER BY price_date ASC",
                    (ticker, cutoff_date),
                )
                for r in cur.fetchall():
                    d = r[0]
                    # stocks.db is fresher → prefer it on conflict
                    if r[4] and r[4] > 0:
                        rows[d] = (r[0], float(r[1] or 0), float(r[2] or 0),
                                   float(r[3] or 0), float(r[4]), _parse_volume(r[5]))
                conn.close()
        except Exception as e:
            print(f"[SeasonalityV2] stock_daily_prices fetch failed for {ticker}: {e}")

        return sorted(rows.values(), key=lambda x: x[0])

    def _compute_monthly_returns(self, prices: List[Tuple[str, float, float, float, float, int]]) -> List[Dict[str, Any]]:
        """Given daily rows, compute monthly returns.

        For each (year, month) cell:
          - last_close = close of last trading day in that month
          - first_close = close of FIRST trading day in that month
          - monthly_return_pct = (last_close / first_close - 1) * 100

        Returns list of dicts: {year, month, return_pct, sample_days, last_close}.
        """
        if not prices:
            return []

        # Group by (year, month)
        by_month: Dict[Tuple[int, int], List[Tuple[str, float]]] = {}
        for row in prices:
            d_str, _o, _h, _l, close, _v = row
            try:
                dt = datetime.strptime(d_str[:10], '%Y-%m-%d').date()
            except Exception:
                continue
            key = (dt.year, dt.month)
            by_month.setdefault(key, []).append((d_str, close))

        results: List[Dict[str, Any]] = []
        for (year, month), day_list in sorted(by_month.items()):
            if len(day_list) < MIN_SAMPLE_DAYS_PER_MONTH:
                continue
            # Sort by date asc
            day_list.sort(key=lambda x: x[0])
            first_close = day_list[0][1]
            last_close = day_list[-1][1]
            if first_close <= 0:
                continue
            ret_pct = (last_close / first_close - 1.0) * 100.0
            results.append({
                'year': year,
                'month': month,
                'return_pct': ret_pct,
                'sample_days': len(day_list),
                'last_close': last_close,
                'first_close': first_close,
            })
        return results

    # ----------------------------------------------------------------------
    # PUBLIC API — Heatmaps & Seasonality
    # ----------------------------------------------------------------------

    @lru_cache(maxsize=128)
    def compute_monthly_returns_heatmap(self, ticker: str, years: int = 5) -> Dict[int, Dict[int, Dict[str, Any]]]:
        """For a single ticker, return {year: {month: {avg_return_pct, sample_days, win_rate, median_return}}}.

        Cached via functools.lru_cache.
        """
        try:
            prices = self._fetch_daily_prices(ticker, years=years)
            monthly = self._compute_monthly_returns(prices)
            # Group by year then month
            result: Dict[int, Dict[int, Dict[str, Any]]] = {}
            for m in monthly:
                y = m['year']
                mo = m['month']
                result.setdefault(y, {})[mo] = {
                    'avg_return_pct': round(m['return_pct'], 3),
                    'sample_days': m['sample_days'],
                    'win_rate': 1.0 if m['return_pct'] > 0 else 0.0,
                    'median_return': round(m['return_pct'], 3),
                }
            return result
        except Exception as e:
            print(f"[SeasonalityV2] compute_monthly_returns_heatmap failed for {ticker}: {e}")
            return {}

    @lru_cache(maxsize=128)
    def compute_sector_seasonality(self, sector: str, years: int = 5) -> Dict[int, Dict[str, Any]]:
        """Aggregate monthly returns across all stocks in `sector`.

        Returns {month: {avg_return_pct, win_rate, sample_stocks, strength}}.
        """
        try:
            # Get all active tickers in this sector
            conn = _open_stocks_db(self.db_path)
            if conn is None:
                return {}
            cur = conn.cursor()
            cur.execute(
                "SELECT ticker FROM stocks WHERE sector = ? AND is_active = 1",
                (sector,),
            )
            tickers = [r[0] for r in cur.fetchall()]
            conn.close()

            if not tickers:
                return {}

            # Collect monthly returns per month across all stocks
            per_month: Dict[int, List[float]] = {}
            stocks_used_per_month: Dict[int, set] = {}
            for tk in tickers:
                prices = self._fetch_daily_prices(tk, years=years)
                monthly = self._compute_monthly_returns(prices)
                for m in monthly:
                    per_month.setdefault(m['month'], []).append(m['return_pct'])
                    stocks_used_per_month.setdefault(m['month'], set()).add(tk)

            result: Dict[int, Dict[str, Any]] = {}
            for month, returns in per_month.items():
                avg_ret = _safe_avg(returns)
                win_rate = _win_rate(returns)
                median_ret = _safe_median(returns)
                sample_stocks = len(stocks_used_per_month.get(month, set()))
                strength = _classify_strength(avg_ret, win_rate, sample_stocks)
                result[month] = {
                    'avg_return_pct': round(avg_ret, 3),
                    'win_rate': round(win_rate, 3),
                    'median_return': round(median_ret, 3),
                    'sample_stocks': sample_stocks,
                    'strength': strength,
                }
            return result
        except Exception as e:
            print(f"[SeasonalityV2] compute_sector_seasonality failed for {sector!r}: {e}")
            return {}

    def detect_recurring_drops(self, ticker: str, years: int = 5) -> List[Dict[str, Any]]:
        """Find recurring periods where the stock historically dropped > -3% on average.

        Scans both by MONTH and by WEEK-OF-YEAR.

        Returns list of {period_type, period_value, avg_drop, occurrences, last_seen}.
        """
        try:
            prices = self._fetch_daily_prices(ticker, years=years)
            monthly = self._compute_monthly_returns(prices)

            drops: List[Dict[str, Any]] = []

            # ---- By month ----
            by_month: Dict[int, List[Tuple[float, int]]] = {}  # month -> [(return, year)]
            for m in monthly:
                by_month.setdefault(m['month'], []).append((m['return_pct'], m['year']))

            for month, lst in by_month.items():
                if len(lst) < MIN_YEAR_SAMPLE_FOR_PATTERN:
                    continue
                avg_ret = _safe_avg([r for r, _y in lst])
                if avg_ret <= -3.0:
                    years_seen = sorted([y for _r, y in lst])
                    drops.append({
                        'period_type': 'month',
                        'period_value': month,
                        'avg_drop': round(avg_ret, 2),
                        'occurrences': len(lst),
                        'last_seen': years_seen[-1] if years_seen else None,
                    })

            # ---- By ISO week-of-year ----
            # Compute weekly returns
            weekly_by_week: Dict[int, List[Tuple[float, int]]] = {}
            # group rows by ISO week
            by_week: Dict[Tuple[int, int], List[Tuple[str, float]]] = {}
            for row in prices:
                d_str, _o, _h, _l, close, _v = row
                try:
                    dt = datetime.strptime(d_str[:10], '%Y-%m-%d').date()
                except Exception:
                    continue
                iso_year, iso_week, _ = dt.isocalendar()
                by_week.setdefault((iso_year, iso_week), []).append((d_str, close))

            for (iso_year, iso_week), day_list in by_week.items():
                if len(day_list) < 2:
                    continue
                day_list.sort(key=lambda x: x[0])
                first_close = day_list[0][1]
                last_close = day_list[-1][1]
                if first_close <= 0:
                    continue
                ret_pct = (last_close / first_close - 1.0) * 100.0
                weekly_by_week.setdefault(iso_week, []).append((ret_pct, iso_year))

            for iso_week, lst in weekly_by_week.items():
                if len(lst) < MIN_YEAR_SAMPLE_FOR_PATTERN:
                    continue
                avg_ret = _safe_avg([r for r, _y in lst])
                if avg_ret <= -3.0:
                    years_seen = sorted([y for _r, y in lst])
                    drops.append({
                        'period_type': 'week',
                        'period_value': iso_week,
                        'avg_drop': round(avg_ret, 2),
                        'occurrences': len(lst),
                        'last_seen': years_seen[-1] if years_seen else None,
                    })

            # Sort by avg_drop asc (worst first)
            drops.sort(key=lambda d: d['avg_drop'])
            return drops
        except Exception as e:
            print(f"[SeasonalityV2] detect_recurring_drops failed for {ticker}: {e}")
            return []

    # ----------------------------------------------------------------------
    # CALENDAR DETECTION
    # ----------------------------------------------------------------------

    def is_ramadan_now(self, analysis_date: Optional[date] = None) -> Tuple[bool, Dict[str, Any]]:
        """Detect whether `analysis_date` falls within Ramadan.

        Uses verified dates for 2024-2027 and extrapolates for other years
        (Ramadan shifts ~11 days earlier per Gregorian year).

        Returns: (is_ramadan: bool, info: {start, end, days_into_ramadan, days_remaining})
        """
        try:
            today = analysis_date or date.today()
            year = today.year

            # Try verified range first
            verified = VERIFIED_RAMADAN_DATES.get(year)
            if not verified:
                # Extrapolate from nearest known year (Ramadan shifts ~11 days earlier per year)
                nearest_year = min(VERIFIED_RAMADAN_DATES.keys(), key=lambda y: abs(y - year))
                base_start, base_end = VERIFIED_RAMADAN_DATES[nearest_year]
                delta_years = year - nearest_year
                # Shift ~11 days earlier per year (positive delta_years in future → earlier; past → later)
                shift_days = -11 * delta_years
                start = base_start + timedelta(days=shift_days)
                # Duration stays ~29-30 days
                duration = (base_end - base_start).days
                end = start + timedelta(days=duration)
            else:
                start, end = verified

            info = {
                'start': start.isoformat(),
                'end': end.isoformat(),
                'days_into_ramadan': 0,
                'days_remaining': 0,
            }

            if start <= today <= end:
                info['days_into_ramadan'] = (today - start).days + 1
                info['days_remaining'] = (end - today).days
                return True, info
            return False, info
        except Exception as e:
            print(f"[SeasonalityV2] is_ramadan_now failed: {e}")
            return False, {'start': None, 'end': None, 'days_into_ramadan': 0, 'days_remaining': 0}

    def is_earnings_window(self, ticker: Optional[str] = None, analysis_date: Optional[date] = None) -> Tuple[bool, str]:
        """Check whether `analysis_date` is within ±3 days of a typical earnings announcement month for the sector.

        Egyptian fiscal-year earnings windows:
          Q1 (Jan-Mar)  → May
          Q2 (Apr-Jun)  → August
          Q3 (Jul-Sep)  → November
          Q4/Annual     → February/March

        Returns: (is_window: bool, description: str)
        """
        try:
            today = analysis_date or date.today()
            month = today.month
            day = today.day

            # Earnings "window" = first 7 days or last 7 days of a typical announcement month
            # (companies announce either early or late in the month).
            if month in EARNINGS_WINDOWS:
                desc = EARNINGS_WINDOWS[month]
                # Consider the entire announcement month as a window (±3 days interpreted loosely)
                return True, desc

            # Also check ±3 days into adjacent months
            for delta in (-3, -2, -1, 1, 2, 3):
                adj = today + timedelta(days=delta)
                if adj.month in EARNINGS_WINDOWS and adj.month != month:
                    return True, f'Near {EARNINGS_WINDOWS[adj.month]} (±3 days)'

            return False, 'Outside earnings season'
        except Exception as e:
            print(f"[SeasonalityV2] is_earnings_window failed: {e}")
            return False, ''

    # ----------------------------------------------------------------------
    # MAIN ANALYZE
    # ----------------------------------------------------------------------

    def analyze(self, ticker: str, sector: Optional[str] = None, analysis_date: Optional[date] = None) -> Dict[str, Any]:
        """Main entry point. Returns a seasonality adjustment dict.

        The `total_score` is an ADDITIVE adjustment in [-20, +20] (per expert guidance:
        'seasonality is a helper, not a savior').
        """
        try:
            today = analysis_date or date.today()

            # Resolve sector if not provided
            if not sector:
                sector = self._lookup_sector(ticker)

            # 1) Monthly pattern for THIS ticker
            monthly_heatmap = self.compute_monthly_returns_heatmap(ticker, years=5)
            this_month_data = self._aggregate_month_across_years(monthly_heatmap, today.month)
            monthly_score = self._score_monthly_pattern(this_month_data)

            # 2) Weekday effect for this ticker (computed from prices directly)
            weekday_score = self._compute_weekday_score(ticker, today.weekday(), years=3)

            # 3) Ramadan adjustment
            is_ramadan, ramadan_info = self.is_ramadan_now(today)
            ramadan_adjustment = 0.0
            if is_ramadan:
                # Negative bias during Ramadan (low liquidity, reduced trading hours).
                # Scale: deeper into Ramadan → larger penalty (max -8).
                days_in = ramadan_info.get('days_into_ramadan', 0) or 0
                # ramp up over first 10 days then plateau
                ramp = min(days_in / 10.0, 1.0)
                ramadan_adjustment = -8.0 * ramp

            # 4) Sector seasonality
            sector_score = 0.0
            sector_data: Dict[str, Any] = {}
            if sector and sector != 'Unknown':
                sector_season = self.compute_sector_seasonality(sector, years=5)
                sector_cell = sector_season.get(today.month, {})
                sector_data = sector_cell
                sector_score = self._score_sector_pattern(sector_cell)

            # 5) Earnings window
            is_earnings, earnings_desc = self.is_earnings_window(ticker, today)
            earnings_adjustment = 0.0
            if is_earnings:
                # Mild positive bias (information flow) but also higher uncertainty.
                # Net effect: small positive for value stocks, but cap at +2 to avoid over-bias.
                earnings_adjustment = +2.0

            # 6) Recurring drops warning
            recurring_drops = self.detect_recurring_drops(ticker, years=5)
            recurring_drops_warning: List[str] = []
            recurring_drops_penalty = 0.0
            for drop in recurring_drops:
                if drop['period_type'] == 'month' and drop['period_value'] == today.month:
                    recurring_drops_warning.append(
                        f"⚠️ {ticker} تاريخياً بيوجّه انخفاض بمتوسط {drop['avg_drop']:.1f}% في شهر {today.month} "
                        f"({drop['occurrences']} مرات آخرها {drop['last_seen']})"
                    )
                    recurring_drops_penalty = min(recurring_drops_penalty - 5.0, -5.0)
                elif drop['period_type'] == 'week':
                    iso_year, iso_week, _ = today.isocalendar()
                    if drop['period_value'] in (iso_week, iso_week - 1, iso_week + 1):
                        recurring_drops_warning.append(
                            f"⚠️ {ticker} تاريخياً بيوجّه انخفاض في الأسبوع {drop['period_value']} "
                            f"(بمتوسط {drop['avg_drop']:.1f}%)"
                        )
                        recurring_drops_penalty = min(recurring_drops_penalty - 3.0, -3.0)

            # === Combine ===
            total_score = (
                monthly_score
                + weekday_score
                + ramadan_adjustment
                + sector_score
                + earnings_adjustment
                + recurring_drops_penalty
            )
            total_score = max(MIN_ADJUSTMENT, min(MAX_ADJUSTMENT, total_score))

            # Build human-readable reasons (Arabic)
            reasons: List[str] = []
            if monthly_score != 0:
                reasons.append(
                    f"النمط الشهري لهذا السهم في شهر {today.month}: "
                    f"متوسط {this_month_data.get('avg_return_pct', 0):.2f}% "
                    f"(نقاط: {monthly_score:+.1f})"
                )
            if weekday_score != 0:
                day_names = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
                day_name = day_names[today.weekday()] if 0 <= today.weekday() < 7 else '—'
                reasons.append(f"تأثير يوم {day_name}: {weekday_score:+.1f}")
            if is_ramadan:
                reasons.append(
                    f"🌙 رمضان ({ramadan_info.get('days_into_ramadan', 0)}/30): "
                    f"تعديل {ramadan_adjustment:+.1f}"
                )
            if sector_score != 0:
                reasons.append(
                    f"موسمية قطاع {sector or '—'} في شهر {today.month}: "
                    f"متوسط {sector_data.get('avg_return_pct', 0):.2f}% "
                    f"({sector_data.get('strength', 'NEUTRAL')}) → {sector_score:+.1f}"
                )
            if is_earnings:
                reasons.append(f"📊 موسم إعلانات مالية: {earnings_desc} ({earnings_adjustment:+.1f})")
            if recurring_drops_warning:
                reasons.extend(recurring_drops_warning)

            if not reasons:
                reasons.append('لا يوجد نمط موسمي واضح (محايد)')

            # Confidence: based on sample sizes
            confidence = 0.5
            if this_month_data.get('sample_days', 0) >= 5:
                confidence += 0.15
            if sector_data.get('sample_stocks', 0) >= 5:
                confidence += 0.15
            if is_ramadan:
                confidence += 0.1
            confidence = min(confidence, 0.9)

            return {
                'total_score': round(total_score, 2),
                'monthly_score': round(monthly_score, 2),
                'weekday_score': round(weekday_score, 2),
                'ramadan_adjustment': round(ramadan_adjustment, 2),
                'sector_score': round(sector_score, 2),
                'earnings_adjustment': round(earnings_adjustment, 2),
                'recurring_drops_warning': recurring_drops_warning,
                'recurring_drops_penalty': round(recurring_drops_penalty, 2),
                'confidence': round(confidence, 2),
                'reasons': reasons,
                # Auxiliary data for visibility
                'is_ramadan': is_ramadan,
                'ramadan_info': ramadan_info,
                'is_earnings_window': is_earnings,
                'earnings_description': earnings_desc,
                'this_month_data': this_month_data,
                'sector_data': sector_data,
                'recurring_drops': recurring_drops,
                'analysis_date': today.isoformat(),
            }
        except Exception as e:
            print(f"[SeasonalityV2] analyze failed for {ticker}: {e}")
            # Safe defaults
            return {
                'total_score': 0.0,
                'monthly_score': 0.0,
                'weekday_score': 0.0,
                'ramadan_adjustment': 0.0,
                'sector_score': 0.0,
                'earnings_adjustment': 0.0,
                'recurring_drops_warning': [],
                'confidence': 0.0,
                'reasons': [f'خطأ في تحليل الموسمية: {e}'],
                'is_ramadan': False,
                'is_earnings_window': False,
            }

    # ----------------------------------------------------------------------
    # PRIVATE SCORING HELPERS
    # ----------------------------------------------------------------------

    def _lookup_sector(self, ticker: str) -> str:
        """Look up the sector for a ticker from stocks.db."""
        try:
            conn = _open_stocks_db(self.db_path)
            if conn is None:
                return 'Unknown'
            cur = conn.cursor()
            cur.execute('SELECT sector FROM stocks WHERE ticker = ?', (ticker,))
            row = cur.fetchone()
            conn.close()
            return row[0] if row and row[0] else 'Unknown'
        except Exception:
            return 'Unknown'

    def _aggregate_month_across_years(self, heatmap: Dict[int, Dict[int, Dict]], target_month: int) -> Dict[str, Any]:
        """Aggregate a single month's returns across all years in the heatmap."""
        try:
            returns: List[float] = []
            total_days = 0
            for _year, months in heatmap.items():
                cell = months.get(target_month)
                if cell:
                    returns.append(cell.get('avg_return_pct', 0))
                    total_days += cell.get('sample_days', 0)
            if not returns:
                return {'avg_return_pct': 0.0, 'sample_days': 0, 'win_rate': 0.0, 'median_return': 0.0}
            return {
                'avg_return_pct': _safe_avg(returns),
                'sample_days': total_days,
                'win_rate': _win_rate(returns),
                'median_return': _safe_median(returns),
            }
        except Exception:
            return {'avg_return_pct': 0.0, 'sample_days': 0, 'win_rate': 0.0, 'median_return': 0.0}

    def _score_monthly_pattern(self, month_data: Dict[str, Any]) -> float:
        """Convert a month-data cell into an additive score in roughly [-8, +8].

        Scaling: avg return ±5% → score ±5; capped at ±8.
        Below MIN_SAMPLE_DAYS_PER_MONTH → 0 (no opinion).
        """
        try:
            sample = month_data.get('sample_days', 0)
            if sample < MIN_SAMPLE_DAYS_PER_MONTH:
                return 0.0
            avg_ret = month_data.get('avg_return_pct', 0.0)
            win_rate = month_data.get('win_rate', 0.0)
            # Linear scale: 1% return → 1 point, capped at ±8
            score = max(-8.0, min(8.0, avg_ret * 1.0))
            # Boost slightly if win_rate confirms direction
            if avg_ret > 0 and win_rate >= 0.6:
                score = min(8.0, score + 1.0)
            elif avg_ret < 0 and win_rate <= 0.4:
                score = max(-8.0, score - 1.0)
            return round(score, 2)
        except Exception:
            return 0.0

    def _score_sector_pattern(self, sector_cell: Dict[str, Any]) -> float:
        """Convert a sector seasonality cell into an additive score in [-5, +5]."""
        try:
            sample = sector_cell.get('sample_stocks', 0)
            if sample < 2:
                return 0.0
            avg_ret = sector_cell.get('avg_return_pct', 0.0)
            strength = sector_cell.get('strength', 'NEUTRAL')
            # Linear scale: 1% return → 0.7 points, capped at ±5
            score = max(-5.0, min(5.0, avg_ret * 0.7))
            if strength == 'STRONG':
                score = min(5.0, score + 1.0)
            elif strength == 'WEAK':
                score = max(-5.0, score - 1.0)
            return round(score, 2)
        except Exception:
            return 0.0

    def _compute_weekday_score(self, ticker: str, weekday: int, years: int = 3) -> float:
        """Compute the average daily return for `weekday` over `years` and score it.

        Returns an additive score in [-3, +3].

        EGX weekend guard: Friday(4) & Saturday(5) are non-trading days.
        Polluted weekend rows (zero-change carry-over) are filtered out BEFORE
        computing returns so that (a) weekend buckets are never built and
        (b) Sunday's return is computed from Thursday's close (the last real
        trading day), not from a carry-over Saturday close.
        """
        try:
            prices = self._fetch_daily_prices(ticker, years=years)
            if len(prices) < 30:
                return 0.0
            # Filter out EGX weekend rows (Friday=4, Saturday=5) so returns are
            # only computed between consecutive REAL trading days.
            EGX_WEEKEND = {4, 5}
            trading_prices = []
            for p in prices:
                try:
                    dt = datetime.strptime(p[0][:10], '%Y-%m-%d').date()
                    if dt.weekday() in EGX_WEEKEND:
                        continue
                    trading_prices.append(p)
                except Exception:
                    continue
            if len(trading_prices) < 30:
                return 0.0
            # Compute daily returns between consecutive trading days
            daily_returns_by_weekday: Dict[int, List[float]] = {}
            for i in range(1, len(trading_prices)):
                try:
                    d_str = trading_prices[i][0]
                    close_today = trading_prices[i][4]
                    close_yesterday = trading_prices[i - 1][4]
                    if close_yesterday <= 0:
                        continue
                    dt = datetime.strptime(d_str[:10], '%Y-%m-%d').date()
                    ret_pct = (close_today / close_yesterday - 1.0) * 100.0
                    daily_returns_by_weekday.setdefault(dt.weekday(), []).append(ret_pct)
                except Exception:
                    continue
            returns = daily_returns_by_weekday.get(weekday, [])
            if len(returns) < 5:
                return 0.0
            avg_ret = _safe_avg(returns)
            # Linear scale: 0.2% daily return → 1 point, capped at ±3
            score = max(-3.0, min(3.0, avg_ret * 5.0))
            return round(score, 2)
        except Exception:
            return 0.0


# ============================================================================
# SMOKE TEST
# ============================================================================

if __name__ == '__main__':
    # Resolve default DB path
    _project_root = Path(__file__).parent.parent.parent.resolve()
    default_db = str(_project_root / 'db' / 'stocks.db')

    print('=' * 80)
    print(f'Seasonality Engine V2 — Smoke Test (db: {default_db})')
    print('=' * 80)

    engine = SeasonalityEngineV2(default_db)

    for ticker in ('COMI', 'ABUK'):
        print()
        print(f'--- {ticker} ---')
        result = engine.analyze(ticker)
        print(f"  total_score:            {result['total_score']:+.2f}")
        print(f"  monthly_score:          {result['monthly_score']:+.2f}")
        print(f"  weekday_score:          {result['weekday_score']:+.2f}")
        print(f"  ramadan_adjustment:     {result['ramadan_adjustment']:+.2f}  (is_ramadan={result['is_ramadan']})")
        print(f"  sector_score:           {result['sector_score']:+.2f}")
        print(f"  earnings_adjustment:    {result['earnings_adjustment']:+.2f}  (is_earnings={result['is_earnings_window']})")
        print(f"  recurring_drops_penalty:{result.get('recurring_drops_penalty', 0):+.2f}")
        print(f"  confidence:             {result['confidence']:.2f}")
        print(f"  reasons:")
        for r in result['reasons']:
            print(f"    - {r}")

        # Show monthly heatmap sample
        print(f"  monthly heatmap (last 2 years, recent months):")
        heatmap = engine.compute_monthly_returns_heatmap(ticker, years=5)
        recent_years = sorted(heatmap.keys())[-2:]
        for y in recent_years:
            for m in sorted(heatmap[y].keys())[-4:]:
                cell = heatmap[y][m]
                print(f"    {y}-{m:02d}: avg={cell['avg_return_pct']:+.2f}% "
                      f"(n={cell['sample_days']}, win={cell['win_rate']:.2f})")

    print()
    print('=' * 80)
    print('Smoke test complete.')

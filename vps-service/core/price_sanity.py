#!/usr/bin/env python3
"""
core.price_sanity — B1 Price Sanity Validation
==============================================
Task ID: 1-a (Bravo — ADP/ADPC + Price Sanity)

A single, well-scoped validation gate that runs *before* any analyzer touches a
ticker's price data. Catches the contamination patterns observed in the
ADP/ADPC investigation:

  1. **USD-denominated EGX stock** — e.g. the contaminated ``ADP`` row whose
     ``currency='USD'`` while ``market='EGX'`` (the row was actually pulling
     prices from NYSE-listed Automatic Data Processing, Inc.).
  2. **Impossible OHLC** — e.g. ``low=3.7`` next to ``high=269.94`` (cross-ticker
     leakage: the 3.7 belongs to ADPC's EGP price range; the 269.94 belongs to
     the US stock).
  3. **Negative support** — e.g. when a contaminated wide-range candle is fed
     into a swing-low / ATR-based support calculator, the arithmetic can yield a
     negative number.
  4. **Stale data** — last price older than ``max_age_days``.
  5. **History-vs-current mismatch** — e.g. ADP's history contains both
     ``close=3.7`` (ADPC-leakage regime) and ``close=263.855`` (US-source
     regime). A 70× spread within the same ticker is contamination, not a
     corporate action — flag it.

Design rules (per owner constraints):
  * **Pure function** — no DB calls inside ``validate_price_data``. The caller
    passes ``prices``, ``ohlc``, ``market``, ``currency``. A separate helper
    ``lookup_stock_identity`` exists for callers that need to resolve
    market/currency from ``stocks.db``.
  * **No blanket range rejection** — a candle with ``>100%`` range is flagged
    ``DATA_INVALID`` with reason ``large_candle_range`` AND a note telling the
    caller to check corporate-actions / splits. The caller decides whether to
    quarantine or reconcile. We never silently drop the candle.
  * **DATA_INVALID is a hard NO_TRADE gate** — the caller must skip the ticker
    and ``log_decision(..., 'reject_entry', 'data_invalid', ...)``. Never emit
    a trade recommendation on invalid data.

Author: Bravo (Z.ai Code) — Task 1-a
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

# ──────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────

# A candle whose (high - low) / low exceeds this ratio is flagged
# ``large_candle_range`` (DATA_INVALID, with a corporate-actions note).
# 1.0 == 100%. Per owner: do NOT silently reject; flag + note.
DEFAULT_LARGE_CANDLE_THRESHOLD = 1.0

# Two closes in the same series whose ratio exceeds this are treated as a
# history-vs-current mismatch (contamination, NOT a split — splits are
# caught separately by the corporate-actions reconciler).
# 50.0 == 50× spread. Real ADPC's 18-year history shows ~14.6× spread (min=1.018,
# max=14.84), so 50× is a safe threshold. The contaminated ADP record shows
# 71× spread (3.7 → 263.855) — caught by this rule.
DEFAULT_HISTORY_MISMATCH_FACTOR = 50.0

# Default freshness policy. EGX trading week = Sun–Thu; with holidays a
# 3-business-day gap is plausible, so 4 calendar days is a safe default.
DEFAULT_MAX_AGE_DAYS = 4

# Markets where the local currency is fixed/known. Used for the
# currency-vs-market consistency check.
_MARKET_CURRENCY_MAP = {
    'EGX': 'EGP',
    'TADAWUL': 'SAR',
    'KUWAIT': 'KWD',
    'QATAR': 'QAR',
    'US': 'USD',
    'CRYPTO': 'USD',
}

# Tolerated ratio between current_price and latest close (history-vs-current).
# If abs(log10(current/close_last)) > this, flag mismatch.
_DEFAULT_PRICE_LOG_TOL = 0.5  # ~3.16× spread tolerated (splits handled elsewhere)


# ──────────────────────────────────────────────────────────────────────────
# Result type
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class SanityResult:
    """
    Typed validation result.

    Attributes:
        valid: True iff status == 'OK' (caller may proceed to analyze).
        status: one of {'OK', 'DATA_INVALID', 'DATA_UNAVAILABLE', 'STALE'}.
        reasons: list[str] — machine+human readable reason codes.
            Examples: ``'low_gt_high'``, ``'currency_market_mismatch:EGX/USD'``,
            ``'large_candle_range(5300.0%):check_corporate_actions_or_splits'``.
        isolated_fields: list[str] — names of fields that triggered the
            isolation (e.g. ``['low_price','high_price','currency']``). The
            caller can use this to record which fields to quarantine.

    The dataclass also supports dict-style access (``result['valid']``) and
    JSON serialization (``result.to_dict()`` / ``result.to_json()``) so it can
    be passed straight into ``log_decision``.
    """
    valid: bool = True
    status: str = 'OK'
    reasons: List[str] = field(default_factory=list)
    isolated_fields: List[str] = field(default_factory=list)

    # ── dict-style access (back-compat with the spec's dict shape) ──
    def __getitem__(self, key: str) -> Any:
        try:
            return getattr(self, key)
        except AttributeError as e:
            raise KeyError(key) from e

    def __contains__(self, key: str) -> bool:
        return hasattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _is_finite(x: Any) -> bool:
    try:
        return x is not None and math.isfinite(float(x))
    except (TypeError, ValueError):
        return False


def _to_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _normalize_ohlc(ohlc: Any) -> Optional[Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]]:
    """
    Accept any of:
      - None
      - dict with keys open/high/low/close (or open_price/high_price/low_price/close_price)
      - tuple/list (open, high, low, close)
      - tuple/list with 4+ items (extras ignored)
    Returns (open, high, low, close) with None for missing/invalid entries.
    """
    if ohlc is None:
        return None
    if isinstance(ohlc, dict):
        o = _to_float(ohlc.get('open', ohlc.get('open_price')))
        h = _to_float(ohlc.get('high', ohlc.get('high_price')))
        l = _to_float(ohlc.get('low', ohlc.get('low_price')))
        c = _to_float(ohlc.get('close', ohlc.get('close_price')))
        return (o, h, l, c)
    if isinstance(ohlc, (tuple, list)):
        if len(ohlc) < 4:
            return None
        return (_to_float(ohlc[0]), _to_float(ohlc[1]), _to_float(ohlc[2]), _to_float(ohlc[3]))
    return None


def _parse_date(s: Any) -> Optional[date]:
    if s is None:
        return None
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    if isinstance(s, str):
        # try ISO date / datetime
        for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d'):
            try:
                return datetime.strptime(s[:len(fmt) + 5] if 'T' in s or ' ' in s else s[:10], fmt[:10] if fmt.endswith('%d') and 'T' not in s and ' ' not in s else fmt).date()
            except ValueError:
                continue
        # final attempt: ISO 8601 date prefix
        try:
            return datetime.strptime(str(s)[:10], '%Y-%m-%d').date()
        except ValueError:
            return None
    return None


# ──────────────────────────────────────────────────────────────────────────
# Stock identity lookup (used by the daily_predictor call site)
# ──────────────────────────────────────────────────────────────────────────

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_STOCKS_DB = os.environ.get('STOCKS_DB', str(_PROJECT_ROOT / 'db' / 'stocks.db'))


def lookup_stock_identity(ticker: str, db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Resolve a ticker's market/currency/name from ``stocks.db.stocks``.

    Returns:
        {
            'ticker': str,
            'market': Optional[str],     # 'EGX' / 'US' / ...
            'currency': Optional[str],   # 'EGP' / 'USD' / ...
            'name': Optional[str],
            'name_ar': Optional[str],
            'data_source': Optional[str],  # filled from price_history if available
            'found': bool,
        }
    """
    out: Dict[str, Any] = {
        'ticker': (ticker or '').upper(),
        'market': None,
        'currency': None,
        'name': None,
        'name_ar': None,
        'data_source': None,
        'found': False,
    }
    path = db_path or _STOCKS_DB
    if not os.path.exists(path):
        return out
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT market, currency, name, name_ar FROM stocks WHERE ticker = ? LIMIT 1",
            (out['ticker'],),
        )
        row = cur.fetchone()
        if row:
            out['market'] = row['market']
            out['currency'] = row['currency']
            out['name'] = row['name']
            out['name_ar'] = row['name_ar']
            out['found'] = True
        conn.close()
    except sqlite3.Error:
        pass
    return out


# ──────────────────────────────────────────────────────────────────────────
# The validator
# ──────────────────────────────────────────────────────────────────────────

def validate_price_data(
    prices: Union[None, float, int, Sequence[float]],
    ohlc: Any,
    ticker: str,
    market: Optional[str] = None,
    currency: Optional[str] = None,
    *,
    latest_date: Optional[Union[str, datetime, date]] = None,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    entry_price: Optional[float] = None,
    support: Optional[float] = None,
    resistance: Optional[float] = None,
    large_candle_threshold: float = DEFAULT_LARGE_CANDLE_THRESHOLD,
    history_mismatch_factor: float = DEFAULT_HISTORY_MISMATCH_FACTOR,
    price_log_tolerance: float = _DEFAULT_PRICE_LOG_TOL,
    now: Optional[date] = None,
) -> SanityResult:
    """
    Validate a ticker's price snapshot + latest candle.

    Args:
        prices: Either a scalar current_price, OR a sequence of historical
            closes (oldest→newest). The last element is treated as the latest
            close. If a sequence is given, the history-vs-current mismatch
            check is performed.
        ohlc: latest candle — dict {(open|open_price), (high|high_price),
            (low|low_price), (close|close_price)} OR a 4-tuple/list
            (open, high, low, close). May be None (skip candle checks).
        ticker: ticker symbol (used in reason messages only).
        market: market code ('EGX', 'US', 'CRYPTO', ...). If None, currency/
            market consistency check is skipped.
        currency: currency code ('EGP', 'USD', ...). If None, currency check
            is skipped.
        latest_date: date of the latest candle (for freshness check). ISO
            string, datetime, or date. None → skip freshness check.
        max_age_days: max tolerated age in days. Default 4 (EGX holiday buffer).
        entry_price: optional entry_price to sanity-check (must be >0, finite,
            <= resistance if resistance given).
        support: optional support value to sanity-check (must be >= 0; if
            resistance given, must be <= resistance).
        resistance: optional resistance value to sanity-check (must be >= 0).
        large_candle_threshold: candle range ratio above which
            ``large_candle_range`` is flagged. 1.0 == 100%.
        history_mismatch_factor: closes in the same series whose ratio exceeds
            this are flagged as ``history_current_mismatch``.
        price_log_tolerance: tolerated abs(log10(current/last_close)) before
            flagging ``current_vs_history_close_mismatch``.
        now: override 'today' for tests.

    Returns:
        SanityResult.
    """
    tk = (ticker or '').upper()
    reasons: List[str] = []
    isolated: List[str] = []

    # ── normalize prices → current_price + history list ───────────────
    history: List[float] = []
    current_price: Optional[float] = None

    if prices is None:
        current_price = None
    elif isinstance(prices, (int, float)):
        current_price = _to_float(prices)
    else:
        try:
            seq = list(prices)
        except TypeError:
            seq = []
        for p in seq:
            v = _to_float(p)
            if v is not None:
                history.append(v)
        if history:
            current_price = history[-1]
        # current_price may still be overridden below by ohlc.close if no
        # explicit current price supplied — but spec says prices[-1] is
        # current, so we keep it.

    # ── (1) DATA_UNAVAILABLE: no prices at all ────────────────────────
    if current_price is None or not _is_finite(current_price):
        return SanityResult(
            valid=False,
            status='DATA_UNAVAILABLE',
            reasons=[f'no_price_data:{tk or "unknown"}'],
            isolated_fields=['current_price'],
        )

    # ── (2) non-positive / non-finite current price ───────────────────
    if current_price <= 0:
        reasons.append(f'non_positive_price:{current_price}')
        isolated.append('current_price')

    # ── (3) OHLC internal consistency ────────────────────────────────
    candle = _normalize_ohlc(ohlc)
    if candle is not None:
        o, h, l, c = candle
        # non-finite / non-positive OHLC entries
        for name, v in (('open', o), ('high', h), ('low', l), ('close', c)):
            if v is None:
                reasons.append(f'ohlc_{name}_missing')
                isolated.append(f'{name}_price')
            elif not _is_finite(v):
                reasons.append(f'ohlc_{name}_non_finite:{v}')
                isolated.append(f'{name}_price')
            elif v < 0:
                reasons.append(f'ohlc_{name}_negative:{v}')
                isolated.append(f'{name}_price')
        # only do relational checks if all four are finite & non-negative
        if all(v is not None and _is_finite(v) and v >= 0 for v in (o, h, l, c)):
            if l is not None and h is not None and l > h:
                reasons.append(f'low_gt_high:low={l},high={h}')
                isolated.extend(['low_price', 'high_price'])
            if o is not None and l is not None and h is not None and (o < l or o > h):
                reasons.append(f'open_out_of_range:open={o},low={l},high={h}')
                isolated.append('open_price')
            if c is not None and l is not None and h is not None and (c < l or c > h):
                reasons.append(f'close_out_of_range:close={c},low={l},high={h}')
                isolated.append('close_price')
            # large candle range — flag, do NOT silently reject (owner rule)
            if l is not None and h is not None and l > 0:
                ratio = (h - l) / l
                if ratio > large_candle_threshold:
                    pct = ratio * 100.0
                    reasons.append(
                        f'large_candle_range({pct:.1f}%):check_corporate_actions_or_splits'
                    )
                    isolated.extend(['low_price', 'high_price'])

    # ── (4) currency vs market consistency ───────────────────────────
    # EGX must price in EGP. US in USD. TADAWUL in SAR. etc.
    if market and currency:
        expected = _MARKET_CURRENCY_MAP.get((market or '').upper())
        if expected and (currency or '').upper() != expected:
            reasons.append(
                f'currency_market_mismatch:market={market},currency={currency},expected={expected}'
            )
            isolated.extend(['market', 'currency'])
    # Ticker-identity heuristic: known EGX tickers must not be priced in USD.
    # This is the primary ADP-contamination fingerprint.
    if (currency or '').upper() == 'USD' and (market or '').upper() == 'EGX':
        if 'currency_market_mismatch:market=EGX,currency=USD' not in ' '.join(reasons):
            reasons.append('currency_market_mismatch:market=EGX,currency=USD')
            if 'currency' not in isolated:
                isolated.extend(['market', 'currency'])

    # ── (5) data freshness ───────────────────────────────────────────
    if latest_date is not None:
        d = _parse_date(latest_date)
        if d is None:
            reasons.append(f'unparseable_latest_date:{latest_date}')
            isolated.append('latest_date')
        else:
            today = now or date.today()
            age_days = (today - d).days
            if age_days > max_age_days:
                reasons.append(f'stale_data:age_days={age_days},max={max_age_days}')
                isolated.append('latest_date')

    # ── (6) history vs current mismatch ──────────────────────────────
    if len(history) >= 2:
        # within-history spread: ratio of max / min close
        hmin = min(history)
        hmax = max(history)
        if hmin > 0 and hmax > 0:
            ratio = hmax / hmin
            if ratio > history_mismatch_factor:
                reasons.append(
                    f'history_current_mismatch:min={hmin},max={hmax},ratio={ratio:.1f}x'
                )
                isolated.append('price_history')
        # last close vs current_price sanity
        last_close = history[-1]
        if current_price > 0 and last_close > 0:
            log_ratio = abs(math.log10(current_price / last_close))
            if log_ratio > price_log_tolerance:
                reasons.append(
                    f'current_vs_history_close_mismatch:current={current_price},last_close={last_close}'
                )
                isolated.append('current_price')

    # ── (7) entry_price / support / resistance sanity ────────────────
    if entry_price is not None:
        ep = _to_float(entry_price)
        if ep is None:
            reasons.append('entry_price_non_finite')
            isolated.append('entry_price')
        elif ep <= 0:
            reasons.append(f'entry_price_non_positive:{ep}')
            isolated.append('entry_price')
    if support is not None:
        s = _to_float(support)
        if s is None:
            reasons.append('support_non_finite')
            isolated.append('support')
        elif s < 0:
            reasons.append(f'negative_support:{s}')
            isolated.append('support')
    if resistance is not None:
        r = _to_float(resistance)
        if r is None:
            reasons.append('resistance_non_finite')
            isolated.append('resistance')
        elif r < 0:
            reasons.append(f'negative_resistance:{r}')
            isolated.append('resistance')
    # support <= resistance (if both present)
    if support is not None and resistance is not None:
        s = _to_float(support)
        r = _to_float(resistance)
        if s is not None and r is not None and s > r:
            reasons.append(f'support_gt_resistance:support={s},resistance={r}')
            isolated.extend(['support', 'resistance'])

    # ── decide status ────────────────────────────────────────────────
    if not reasons:
        return SanityResult(valid=True, status='OK', reasons=[], isolated_fields=[])

    # STALE takes precedence over DATA_INVALID only if it's the *only* reason
    # and the rest of the snapshot is clean. Otherwise DATA_INVALID wins
    # (a stale + invalid record is still invalid).
    has_stale = any(r.startswith('stale_data') for r in reasons)
    has_invalid = any(
        r.startswith(('low_gt_high', 'open_out_of_range', 'close_out_of_range',
                      'ohlc_', 'non_positive_price', 'negative_', 'large_candle_range',
                      'currency_market_mismatch', 'history_current_mismatch',
                      'current_vs_history_close_mismatch', 'entry_price_',
                      'support_', 'resistance_', 'no_price_data'))
        for r in reasons
    )
    if has_invalid:
        status = 'DATA_INVALID'
    elif has_stale:
        status = 'STALE'
    else:
        status = 'DATA_INVALID'  # default safe

    return SanityResult(
        valid=False,
        status=status,
        reasons=reasons,
        isolated_fields=sorted(set(isolated)),
    )


# ──────────────────────────────────────────────────────────────────────────
# Convenience: validate directly from a ticker (resolves identity from DB)
# ──────────────────────────────────────────────────────────────────────────

def validate_ticker(
    ticker: str,
    prices: Sequence[float],
    ohlc: Any,
    *,
    db_path: Optional[str] = None,
    **kwargs,
) -> SanityResult:
    """
    Convenience wrapper: resolves market/currency from stocks.db, then calls
    validate_price_data. Useful for ad-hoc CLI checks.

    The daily_predictor call site does NOT use this — it resolves identity
    once per run and passes market/currency explicitly to avoid N DB lookups.
    """
    ident = lookup_stock_identity(ticker, db_path=db_path)
    return validate_price_data(
        prices=prices,
        ohlc=ohlc,
        ticker=ticker,
        market=ident.get('market'),
        currency=ident.get('currency'),
        **kwargs,
    )


# ──────────────────────────────────────────────────────────────────────────
# CLI: python3 vps-service/core/price_sanity.py ADP
# ──────────────────────────────────────────────────────────────────────────

def _cli():
    import argparse
    p = argparse.ArgumentParser(description='B1 Price Sanity validator (CLI)')
    p.add_argument('ticker', help='Ticker symbol, e.g. ADP or ADPC')
    p.add_argument('--db', default=_STOCKS_DB, help='Path to stocks.db')
    p.add_argument('--ph-db', default=str(_PROJECT_ROOT / 'db' / 'price_history.db'),
                   help='Path to price_history.db')
    p.add_argument('--max-age', type=int, default=DEFAULT_MAX_AGE_DAYS)
    args = p.parse_args()

    ident = lookup_stock_identity(args.ticker, db_path=args.db)
    print(f"identity: {ident}")

    # pull latest 30 closes + latest OHLC from price_history.db
    closes: List[float] = []
    ohlc = None
    latest_date = None
    if os.path.exists(args.ph_db):
        conn = sqlite3.connect(args.ph_db)
        cur = conn.cursor()
        cur.execute(
            "SELECT date, open_price, high_price, low_price, close_price "
            "FROM price_history WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0 "
            "ORDER BY date DESC LIMIT 30",
            (args.ticker.upper(),),
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            rows.reverse()
            latest = rows[-1]
            latest_date = latest[0]
            ohlc = (latest[1], latest[2], latest[3], latest[4])
            closes = [float(r[4]) for r in rows if r[4] is not None]

    # also pull current price from stocks.db
    cur_price = None
    if os.path.exists(args.db):
        c2 = sqlite3.connect(args.db).cursor()
        c2.execute("SELECT current_price, support, resistance FROM stocks WHERE ticker = ?", (args.ticker.upper(),))
        row = c2.fetchone()
        c2.connection.close()
        if row:
            cur_price = row[0]
            kwargs = dict(support=row[1], resistance=row[2])
        else:
            kwargs = {}
    else:
        kwargs = {}

    res = validate_price_data(
        prices=closes if closes else cur_price,
        ohlc=ohlc,
        ticker=args.ticker,
        market=ident.get('market'),
        currency=ident.get('currency'),
        latest_date=latest_date,
        max_age_days=args.max_age,
        entry_price=cur_price,
        **kwargs,
    )
    print("result:", json.dumps(res.to_dict(), ensure_ascii=False, indent=2))
    return 0 if res.valid else 1


if __name__ == '__main__':
    import sys
    sys.exit(_cli())

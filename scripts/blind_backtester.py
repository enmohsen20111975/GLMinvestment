#!/usr/bin/env python3
"""
🕰️ Blind Backtesting Engine — المختبر الزمني (P23-BACKTESTING-CRYPTO-LAB)
==============================================================================
يختبر هل "عقل" المنصة بيتوقع المستقبل ولا بيتبع الماضي (Lagging).

كيف يعمل:
1. يأخذ سهم وتاريخ في الماضي (cutoff_date).
2. يقص (truncate) بيانات الأسعار عند التاريخ ده — لا يرى المستقبل.
3. يبعت الداتا دي للـ MasterAnalyzer ويطلع التوقع (Signal, Entry, Target, Stop).
4. يجيب الأسعار الفعلية اللي حصلت بعد التاريخ ده.
5. يقارنها بالـ Target والـ Stop:
   - WIN  → وصل للـ Target قبل الـ Stop
   - LOSS → ضرب الـ Stop قبل الـ Target
   - NEUTRAL → مفيش حاجة حصلت (لا target ولا stop)
6. يطبع Report بالـ Win Rate الحقيقي للمحرك.

Usage:
    python3 scripts/blind_backtester.py --ticker COMI --cutoff 2026-07-15
    python3 scripts/blind_backtester.py --batch COMI,ETEL,SWDY,ABUK,HRHO --cutoff 2026-07-15
    python3 scripts/blind_backtester.py --all                  # كل أسهم EGX (MASS-SCALE)
    python3 scripts/blind_backtester.py --all --market EGX     # صريح
    python3 scripts/blind_backtester.py --batch COMI,ETEL,SWDY,ABUK,HRHO --forward-days 10
"""

import sys
import os
import json
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

# ── Paths ──
PROJECT_ROOT = Path(__file__).parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
sys.path.insert(0, str(VPS_SERVICE))

# ── Lazy-loaded analyzer (takes ~3s to init) ──
_master_analyzer = None

def get_analyzer():
    global _master_analyzer
    if _master_analyzer is None:
        from analyzers.master_analyzer import MasterAnalyzer
        _master_analyzer = MasterAnalyzer()
    return _master_analyzer


def get_all_active_tickers(market='EGX'):
    """يقرأ كل الأسهم النشطة من stocks.db للسوق المحدد (MASS-SCALE).

    Args:
        market: السوق (default 'EGX'). استخدم None لكل الأسواق.

    Returns:
        list of ticker strings, e.g. ['COMI', 'ETEL', 'SWDY', ...]
    """
    if not STOCKS_DB.exists():
        print(f"⚠️  stocks.db غير موجود: {STOCKS_DB}")
        return []
    try:
        conn = sqlite3.connect(str(STOCKS_DB), timeout=30)
        conn.execute('PRAGMA busy_timeout = 30000')
        cur = conn.cursor()
        # تحقق من الأعمدة المتاحة
        cols = [c[1] for c in cur.execute('PRAGMA table_info(stocks)').fetchall()]
        has_active = 'is_active' in cols
        has_market = 'market' in cols

        if has_active and has_market and market:
            rows = cur.execute(
                'SELECT ticker FROM stocks WHERE is_active = 1 AND market = ? ORDER BY ticker',
                (market,)
            ).fetchall()
        elif has_active and has_market:
            # market=None — كل الأسهم النشطة في كل الأسواق
            rows = cur.execute(
                'SELECT ticker FROM stocks WHERE is_active = 1 ORDER BY ticker'
            ).fetchall()
        elif has_market and market:
            rows = cur.execute(
                'SELECT ticker FROM stocks WHERE market = ? ORDER BY ticker',
                (market,)
            ).fetchall()
        else:
            rows = cur.execute('SELECT ticker FROM stocks ORDER BY ticker').fetchall()
        conn.close()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        print(f"⚠️  Error reading stocks.db: {e}")
        return []


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def parse_volume(vol):
    """Parse volume string ('1.2M', '3.4K', '12345', '') to float."""
    if not vol:
        return 0.0
    s = str(vol).strip().replace(',', '').replace('\u202f', '').replace(' ', '')
    if not s:
        return 0.0
    try:
        mult = 1.0
        if s[-1] in ('B', 'b'):
            mult, s = 1e9, s[:-1]
        elif s[-1] in ('M', 'm'):
            mult, s = 1e6, s[:-1]
        elif s[-1] in ('K', 'k'):
            mult, s = 1e3, s[:-1]
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


# ── Data loading via the Maestro's own merged history ──
# BACKTESTER-DATA-FIX: Previously this script queried `stock_daily_prices` in
# stocks.db directly. On production that table is often empty or stale because
# the Maestro actually reads merged history from price_history.db + intraday.db
# + stocks.db (live fallback) via `load_merged_history`. The old direct SQL
# therefore returned 0 candles → every stock was SKIPped → no real backtest
# ever ran. Now we use the exact same loader the engine uses, so the backtester
# sees the same data the Maestro sees.
_merged_history_loader = None

def _get_merged_history_loader():
    """Lazy-import load_merged_history from analyzers.master_analyzer."""
    global _merged_history_loader
    if _merged_history_loader is None:
        from analyzers.master_analyzer import load_merged_history
        _merged_history_loader = load_merged_history
    return _merged_history_loader


def load_split_history(ticker, cutoff_date, forward_days=30, limit=400):
    """Load merged price history ONCE and split at cutoff_date.

    Uses `load_merged_history` (the Maestro's own loader) so the backtester
    reads from the exact same data source as the production engine:
      1. price_history.db  (daily candles, with egksco/migration normalization)
      2. intraday.db       (intraday snapshots aggregated to daily)
      3. stocks.db         (live fallback for today's developing candle)

    The merged result is sorted ascending by date. We then split:
      - history : candles with date <= cutoff_date  (what the engine "sees")
      - forward : candles with date  > cutoff_date  (the "future" to evaluate)

    Returns: (history, forward) where forward is truncated to forward_days.

    Args:
        ticker:       Stock symbol (e.g., 'COMI')
        cutoff_date:  ISO date string 'YYYY-MM-DD' — the split point
        forward_days: Max number of forward candles to return
        limit:        Total merged history window (default 400 ≈ ~19 months)
    """
    loader = _get_merged_history_loader()
    # load_merged_history derives db_dir from db_path, so passing STOCKS_DB
    # makes it look for price_history.db / intraday.db / stocks.db in db/.
    merged = loader(ticker, str(STOCKS_DB), limit=limit)

    history = []
    forward = []
    cutoff_norm = (cutoff_date or '').strip()

    for candle in merged:
        cdate = str(candle.get('date', '')).strip()
        if not cdate:
            continue
        if cutoff_norm and cdate > cutoff_norm:
            forward.append(candle)
        else:
            history.append(candle)

    # Truncate forward to the requested window
    if len(forward) > forward_days:
        forward = forward[:forward_days]

    return history, forward


def find_smart_cutoff(ticker, requested_cutoff, min_history=50, min_forward=30,
                      forward_days=30, search_back_days=90, limit=400):
    """Smart Cutoff Selection — يدور على فترة كاملة للاختبار.

    الداتا القديمة فيها فجوات (EGX مقطوع، أيام ناقصة). لو قسّمنا عند تاريخ
    عشوائي ممكن نوقع في فترة فاضية. هذه الدالة بتلف لورا من الـ cutoff المطلوب
    لحد ما تلاقي فترة فيها على الأقل `min_history` شمعة قبل الـ cutoff و
    `min_forward` شمعة بعد الـ cutoff.

    Args:
        ticker:             السهم
        requested_cutoff:   التاريخ المطلوب (YYYY-MM-DD) — نقطة البداية للبحث
        min_history:        أقل عدد شمعات تاريخ مطلوبة قبل الـ cutoff (default 50)
        min_forward:        أقل عدد شمعات مستقبلية مطلوبة بعد الـ cutoff (default 30)
        forward_days:       حجم نافذة المستقبل (default 30)
        search_back_days:   لورا قد إيه ندور على فترة صالحة (default 90 يوم)
        limit:              حجم التاريخ الكامل اللي نحمله (default 400)

    Returns:
        dict: {
            'found': bool,
            'cutoff_date': str | None,    # التاريخ اللي لقيناه (لو found=True)
            'history': list,               # الشمعات قبل الـ cutoff
            'forward': list,               # الشمعات بعد الـ cutoff (محذوف لـ forward_days)
            'reason': str,                 # سبب القرار (للـ logging)
        }
    """
    loader = _get_merged_history_loader()
    merged = loader(ticker, str(STOCKS_DB), limit=limit)

    if len(merged) < (min_history + min_forward):
        return {
            'found': False,
            'cutoff_date': None,
            'history': [],
            'forward': [],
            'reason': (
                f'الداتا التاريخية لهذا السهم ({ticker}) غير كافية للاختبار '
                f'— وجدنا {len(merged)} شمعة فقط، والمطلوب على الأقل {min_history + min_forward} '
                f'({min_history} تاريخ + {min_forward} مستقبل).'
            ),
        }

    # كل التواريخ المتاحة مرتبة تصاعدياً
    dates = [str(c.get('date', '')).strip() for c in merged if c.get('date')]
    if not dates:
        return {
            'found': False, 'cutoff_date': None, 'history': [], 'forward': [],
            'reason': f'لا توجد تواريخ صالحة في الداتا لـ {ticker}.',
        }

    # نقطة البداية: التاريخ المطلوب، أو (آخر تاريخ - forward_days) لو مش محدد
    if requested_cutoff:
        start_date = requested_cutoff.strip()
    else:
        # نبدأ من آخر تاريخ متاح ناقص forward_days (عشان يكون فيه مستقبل كافي)
        last_date = dates[-1]
        try:
            from datetime import datetime as _dt, timedelta as _td
            start_dt = _dt.strptime(last_date[:10], '%Y-%m-%d') - _td(days=forward_days)
            start_date = start_dt.strftime('%Y-%m-%d')
        except Exception:
            start_date = last_date

    # نلف لورا من start_date لحد search_back_days
    from datetime import datetime as _dt, timedelta as _td
    try:
        start_dt = _dt.strptime(start_date[:10], '%Y-%m-%d')
    except Exception:
        start_dt = _dt.strptime(dates[-1][:10], '%Y-%m-%d')

    for day_offset in range(0, search_back_days + 1):
        candidate_dt = start_dt - _td(days=day_offset)
        candidate = candidate_dt.strftime('%Y-%m-%d')

        history = [c for c in merged if str(c.get('date', '')).strip() <= candidate]
        forward_full = [c for c in merged if str(c.get('date', '')).strip() > candidate]
        forward = forward_full[:forward_days]

        if len(history) >= min_history and len(forward) >= min_forward:
            return {
                'found': True,
                'cutoff_date': candidate,
                'history': history,
                'forward': forward,
                'reason': (
                    f'فترة صالحة وُجدت عند {candidate} '
                    f'(تاريخ: {len(history)} شمعة، مستقبل: {len(forward)} شمعة).'
                ),
            }

    # لو وصلنا هنا، مفيش فترة كاملة في الـ search_back_days
    best_history = 0
    best_forward = 0
    best_cutoff = None
    for day_offset in range(0, search_back_days + 1):
        candidate_dt = start_dt - _td(days=day_offset)
        candidate = candidate_dt.strftime('%Y-%m-%d')
        history = [c for c in merged if str(c.get('date', '')).strip() <= candidate]
        forward_full = [c for c in merged if str(c.get('date', '')).strip() > candidate]
        forward = forward_full[:forward_days]
        if len(history) > best_history or len(forward) > best_forward:
            best_history = max(best_history, len(history))
            best_forward = max(best_forward, len(forward))
            best_cutoff = candidate

    return {
        'found': False,
        'cutoff_date': None,
        'history': [],
        'forward': [],
        'reason': (
            f'الداتا التاريخية لهذا السهم ({ticker}) غير كافية للاختبار '
            f'— بحثنا لورا {search_back_days} يوم ولم نجد فترة كاملة '
            f'(أفضل نتيجة: {best_history} تاريخ + {best_forward} مستقبل عند {best_cutoff}، '
            f'المطلوب: {min_history}+{min_forward}).'
        ),
    }


def load_price_history(ticker, up_to_date=None):
    """Load blind price history (cutoff at up_to_date) via load_merged_history.

    Backward-compatible wrapper kept so older call sites still work.
    Returns list of dicts: {date, open, high, low, close, volume}
    The future (after up_to_date) is HIDDEN — this is the core of blind backtesting.
    """
    loader = _get_merged_history_loader()
    merged = loader(ticker, str(STOCKS_DB), limit=400)
    cutoff = (up_to_date or '').strip()
    history = []
    for candle in merged:
        cdate = str(candle.get('date', '')).strip()
        if not cdate:
            continue
        if cutoff and cdate > cutoff:
            continue
        history.append(candle)
    return history


def load_forward_prices(ticker, after_date, days=30):
    """Load actual prices AFTER the cutoff date (the 'future' the engine shouldn't see).

    Backward-compatible wrapper. Uses load_merged_history so it reads from the
    same merged source as the engine, not from a direct stock_daily_prices query.
    """
    loader = _get_merged_history_loader()
    merged = loader(ticker, str(STOCKS_DB), limit=400)
    cutoff = (after_date or '').strip()
    forward = []
    for candle in merged:
        cdate = str(candle.get('date', '')).strip()
        if not cdate or not cutoff:
            continue
        if cdate > cutoff:
            forward.append(candle)
    if len(forward) > days:
        forward = forward[:days]
    return forward


# ═══════════════════════════════════════════════════════════════════════════
# Core: Run one blind backtest
# ═══════════════════════════════════════════════════════════════════════════

def run_blind_backtest(ticker, cutoff_date, forward_days=30, use_smart_cutoff=True,
                       min_history=50, min_forward=30, search_back_days=90):
    """Run a single blind backtest for one ticker.

    Args:
        ticker: Stock symbol (e.g., 'COMI')
        cutoff_date: ISO date string (e.g., '2026-07-15') — the "present" for the engine
        forward_days: How many days into the future to evaluate
        use_smart_cutoff: If True (default), search backward for a window with
            at least `min_history` candles before cutoff and `min_forward` after.
            This handles EGX's gappy/incomplete data gracefully.
        min_history: Min candles needed before cutoff (default 50)
        min_forward: Min candles needed after cutoff (default 30)
        search_back_days: How far back to search for a valid window (default 90)

    Returns:
        dict with: ticker, cutoff, signal, entry, target, stop, outcome, forward_data
    """
    result = {
        'ticker': ticker,
        'cutoff_date': cutoff_date,
        'history_candles': 0,
        'forward_candles': 0,
        'signal': 'NO_DATA',
        'confidence': 0,
        'master_score': 0,
        'entry_price': None,
        'target_price': None,
        'stop_price': None,
        'risk_reward': None,
        'outcome': 'SKIP',
        'outcome_detail': '',
        'forward_data': [],
        'smart_cutoff_used': False,
        'actual_cutoff': cutoff_date,
    }

    # 1. Load history — either via Smart Cutoff search or the simple split.
    if use_smart_cutoff:
        # SMART-CUTOFF: الداتا القديمة فيها فجوات. ندور لورا على فترة كاملة.
        sc = find_smart_cutoff(
            ticker, cutoff_date,
            min_history=min_history,
            min_forward=min_forward,
            forward_days=forward_days,
            search_back_days=search_back_days,
            limit=400,
        )
        if not sc['found']:
            result['outcome'] = 'SKIP'
            result['outcome_detail'] = sc['reason']
            result['forward_candles'] = 0
            result['forward_data'] = []
            return result
        history = sc['history']
        forward = sc['forward']
        result['smart_cutoff_used'] = (sc['cutoff_date'] != cutoff_date)
        result['actual_cutoff'] = sc['cutoff_date']
        result['cutoff_date'] = sc['cutoff_date']  # update to the effective cutoff
        result['history_candles'] = len(history)
        result['smart_cutoff_reason'] = sc['reason']
    else:
        # Simple split at the exact requested cutoff (backward-compatible behavior)
        history, forward = load_split_history(ticker, cutoff_date, forward_days, limit=400)
        result['history_candles'] = len(history)

    if len(history) < 10:
        result['outcome'] = 'SKIP'
        result['outcome_detail'] = f'Insufficient history ({len(history)} < 10 candles)'
        result['forward_candles'] = len(forward)
        result['forward_data'] = forward
        return result

    # 2. Run MasterAnalyzer on the blind history
    try:
        ma = get_analyzer()
        analysis = ma.analyze(ticker, history=history)
    except Exception as e:
        result['outcome'] = 'ERROR'
        result['outcome_detail'] = f'Analysis error: {str(e)[:100]}'
        result['forward_candles'] = len(forward)
        result['forward_data'] = forward
        return result

    # 3. Extract prediction
    signal = getattr(analysis, 'signal', 'HOLD')
    confidence = getattr(analysis, 'confidence', 0)
    master_score = getattr(analysis, 'master_score', 0)

    result['signal'] = signal
    result['confidence'] = confidence
    result['master_score'] = master_score

    # Entry = last close in the blind history
    entry_price = history[-1]['close']
    result['entry_price'] = entry_price

    # Extract target & stop from risk_profile
    risk_profile = getattr(analysis, 'risk_profile', {}) or {}
    stop_pct = risk_profile.get('stop_pct', 10)  # default 10%
    rr_ratio = risk_profile.get('risk_reward_ratio', 1.5)  # default 1.5

    # Calculate target & stop based on signal direction
    if signal in ('STRONG_BUY', 'BUY'):
        stop_price = entry_price * (1 - stop_pct / 100)
        target_price = entry_price * (1 + (stop_pct * rr_ratio) / 100)
    elif signal in ('STRONG_SELL', 'SELL'):
        stop_price = entry_price * (1 + stop_pct / 100)
        target_price = entry_price * (1 - (stop_pct * rr_ratio) / 100)
    else:  # HOLD
        result['outcome'] = 'NEUTRAL'
        result['outcome_detail'] = 'Signal is HOLD — no trade taken'
        result['target_price'] = None
        result['stop_price'] = None
        result['risk_reward'] = rr_ratio
        # Forward already loaded by load_split_history — just attach it
        result['forward_candles'] = len(forward)
        result['forward_data'] = forward
        return result

    result['target_price'] = round(target_price, 4)
    result['stop_price'] = round(stop_price, 4)
    result['risk_reward'] = rr_ratio

    # 4. Attach forward prices (the "future") — already loaded by load_split_history
    result['forward_candles'] = len(forward)
    result['forward_data'] = forward

    if not forward:
        result['outcome'] = 'NO_FUTURE_DATA'
        result['outcome_detail'] = 'No price data after cutoff date'
        return result

    # 5. Evaluate: did price hit target or stop first?
    # For BUY: target = higher, stop = lower
    # For SELL: target = lower, stop = higher
    target_hit_day = None
    stop_hit_day = None

    for i, day in enumerate(forward):
        if signal in ('STRONG_BUY', 'BUY'):
            # Check stop first (conservative — assume worst case)
            if day['low'] <= stop_price:
                stop_hit_day = i + 1
                break
            if day['high'] >= target_price:
                target_hit_day = i + 1
                break
        else:  # SELL
            if day['high'] >= stop_price:
                stop_hit_day = i + 1
                break
            if day['low'] <= target_price:
                target_hit_day = i + 1
                break

    if target_hit_day:
        result['outcome'] = 'WIN'
        result['outcome_detail'] = f'Target hit on day {target_hit_day} ({forward[target_hit_day-1]["date"]})'
    elif stop_hit_day:
        result['outcome'] = 'LOSS'
        result['outcome_detail'] = f'Stop hit on day {stop_hit_day} ({forward[stop_hit_day-1]["date"]})'
    else:
        # Neither hit — check if price moved in the right direction
        last_close = forward[-1]['close']
        if signal in ('STRONG_BUY', 'BUY'):
            if last_close > entry_price:
                result['outcome'] = 'NEUTRAL_UP'
                result['outcome_detail'] = f'No hit. Price moved UP {((last_close/entry_price)-1)*100:.1f}% but didn\'t reach target'
            else:
                result['outcome'] = 'NEUTRAL_DOWN'
                result['outcome_detail'] = f'No hit. Price moved DOWN {((last_close/entry_price)-1)*100:.1f}% but didn\'t hit stop'
        else:  # SELL
            if last_close < entry_price:
                result['outcome'] = 'NEUTRAL_UP'
                result['outcome_detail'] = f'No hit. Price moved in favor {(1-(last_close/entry_price))*100:.1f}% but didn\'t reach target'
            else:
                result['outcome'] = 'NEUTRAL_DOWN'
                result['outcome_detail'] = f'No hit. Price moved against {((last_close/entry_price)-1)*100:.1f}% but didn\'t hit stop'

    return result


# ═══════════════════════════════════════════════════════════════════════════
# Report Generation
# ═══════════════════════════════════════════════════════════════════════════

def print_single_report(result):
    """Print a detailed report for one backtest."""
    print(f"\n{'='*70}")
    print(f"  📊 BLIND BACKTEST REPORT — {result['ticker']}")
    print(f"{'='*70}")
    print(f"  Cutoff Date    : {result['cutoff_date']} (engine sees data up to here)")
    print(f"  History Candles: {result['history_candles']}")
    print(f"  Forward Candles: {result['forward_candles']}")
    print(f"")
    print(f"  ── Engine Prediction ──")
    print(f"  Signal         : {result['signal']}")
    print(f"  Confidence     : {result['confidence']}/100")
    print(f"  Master Score   : {result['master_score']}")
    print(f"  Entry Price    : {result['entry_price']}")
    if result['target_price']:
        print(f"  Target Price   : {result['target_price']}")
        print(f"  Stop Price     : {result['stop_price']}")
        print(f"  Risk/Reward    : 1:{result['risk_reward']}")
    print(f"")
    print(f"  ── Actual Outcome ──")

    outcome_emoji = {
        'WIN': '✅',
        'LOSS': '❌',
        'NEUTRAL': '⚪',
        'NEUTRAL_UP': '📈',
        'NEUTRAL_DOWN': '📉',
        'SKIP': '⏭️',
        'NO_FUTURE_DATA': '❓',
        'ERROR': '💥',
        'NO_DATA': '🚫',
    }
    emoji = outcome_emoji.get(result['outcome'], '❓')
    print(f"  Outcome        : {emoji} {result['outcome']}")
    print(f"  Detail         : {result['outcome_detail']}")

    if result['forward_data']:
        fwd = result['forward_data']
        print(f"")
        print(f"  ── Forward Price Action ({len(fwd)} days) ──")
        entry = result['entry_price']
        for day in fwd[:10]:  # show first 10 days
            pct = ((day['close'] / entry) - 1) * 100 if entry > 0 else 0
            arrow = '📈' if pct > 0 else '📉' if pct < 0 else '➡️'
            print(f"    {day['date']} | O:{day['open']:.2f} H:{day['high']:.2f} L:{day['low']:.2f} C:{day['close']:.2f} | {arrow} {pct:+.1f}%")
        if len(fwd) > 10:
            print(f"    ... ({len(fwd) - 10} more days)")

    print(f"{'='*70}")


def print_batch_summary(results):
    """Print a summary report for multiple backtests."""
    print(f"\n{'#'*70}")
    print(f"  🏆 BLIND BACKTESTING SUMMARY — Win Rate Report")
    print(f"{'#'*70}")
    print(f"  Tested {len(results)} stocks")
    print()

    # Count outcomes
    wins = sum(1 for r in results if r['outcome'] == 'WIN')
    losses = sum(1 for r in results if r['outcome'] == 'LOSS')
    neutrals = sum(1 for r in results if r['outcome'].startswith('NEUTRAL'))
    skips = sum(1 for r in results if r['outcome'] in ('SKIP', 'NO_DATA', 'NO_FUTURE_DATA', 'ERROR'))

    trades_taken = wins + losses
    win_rate = (wins / trades_taken * 100) if trades_taken > 0 else 0

    print(f"  ┌─────────────────────────────────────────────┐")
    print(f"  │  ✅ WINS (target hit)     : {wins:>3}              │")
    print(f"  │  ❌ LOSSES (stop hit)     : {losses:>3}              │")
    print(f"  │  ⚪ NEUTRAL (no hit)      : {neutrals:>3}              │")
    print(f"  │  ⏭️  SKIPPED (no data)    : {skips:>3}              │")
    print(f"  ├─────────────────────────────────────────────┤")
    print(f"  │  📊 TRADES TAKEN          : {trades_taken:>3}              │")
    print(f"  │  🎯 WIN RATE              : {win_rate:>5.1f}%          │")
    print(f"  └─────────────────────────────────────────────┘")
    print()

    # Per-stock breakdown
    print(f"  Per-stock breakdown:")
    print(f"  {'Ticker':<8} {'Signal':<12} {'Conf':>5} {'Entry':>10} {'Target':>10} {'Stop':>10} {'Outcome':<15}")
    print(f"  {'─'*8} {'─'*12} {'─'*5} {'─'*10} {'─'*10} {'─'*10} {'─'*15}")
    for r in results:
        print(f"  {r['ticker']:<8} {r['signal']:<12} {r['confidence']:>5} "
              f"{r['entry_price'] or 0:>10.2f} {r['target_price'] or 0:>10.2f} "
              f"{r['stop_price'] or 0:>10.2f} {r['outcome']:<15}")

    print()

    # Lagging indicator check
    if trades_taken > 0:
        if win_rate >= 60:
            print(f"  🟢 VERDICT: Engine is PREDICTIVE (Win Rate ≥ 60%) — indicators are leading")
        elif win_rate >= 40:
            print(f"  🟡 VERDICT: Engine is MIXED (40-60% Win Rate) — some indicators may be lagging")
            print(f"     → Consider reducing MACD/SMA weights and increasing Volume Profile/Order Blocks")
        else:
            print(f"  🔴 VERDICT: Engine is LAGGING (Win Rate < 40%) — indicators are following, not leading")
            print(f"     → URGENT: Reduce trend-following indicators (MACD, SMA) in fusion_engine.py")
            print(f"     → Increase predictive indicators (Volume Profile, Order Blocks, RSI divergence)")
    else:
        print(f"  ⚪ No trades were taken (all signals were HOLD or data was insufficient)")
        print(f"     → This itself may indicate the engine is too conservative")

    print(f"{'#'*70}")


# ═══════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='🕰️ Blind Backtesting Engine — اختبر هل العقل بيتوقع صح',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  # MASS-SCALE: اختبر كل أسهم EGX النشطة (الافتراضي)
  python3 scripts/blind_backtester.py

  # صريح: كل الأسهم
  python3 scripts/blind_backtester.py --all --market EGX

  # اختبار سهم واحد
  python3 scripts/blind_backtester.py --ticker COMI --cutoff 2026-07-15

  # اختبار قائمة أسهم
  python3 scripts/blind_backtester.py --batch COMI,ETEL,SWDY,ABUK,HRHO --cutoff 2026-07-15

  # اختبار بنافذة مستقبلية مختلفة
  python3 scripts/blind_backtester.py --batch COMI,ETEL,SWDY,ABUK,HRHO --forward-days 10
        """
    )
    parser.add_argument('--ticker', type=str, help='سهم واحد للاختبار (e.g., COMI)')
    parser.add_argument('--batch', type=str, help='قائمة أسهم مفصولة بفواصل (e.g., COMI,ETEL,SWDY)')
    parser.add_argument('--all', action='store_true',
                        help='اختبر كل الأسهم النشطة في السوق (MASS-SCALE) — هذا الافتراضي '
                             'لما لا يتم تحديد --ticker أو --batch')
    parser.add_argument('--market', type=str, default='EGX',
                        help='السوق لـ --all (default: EGX). خيارات: EGX, TADAWUL, KSE, QSE')
    parser.add_argument('--cutoff', type=str, default=None,
                        help='تاريخ القص (YYYY-MM-DD). افتراضي: قبل 15 يوم من اليوم')
    parser.add_argument('--forward-days', type=int, default=30,
                        help='عدد أيام المستقبل للتقييم (default: 30)')
    parser.add_argument('--json', action='store_true', help='إخراج JSON بدلاً من نص')
    parser.add_argument('--no-smart-cutoff', action='store_true',
                        help='عطّل Smart Cutoff — استخدم التاريخ المحدد بالظبط '
                             '(افتراضي: Smart Cutoff شغّال)')
    parser.add_argument('--min-history', type=int, default=50,
                        help='أقل عدد شمعات تاريخ قبل الـ cutoff (default: 50)')
    parser.add_argument('--min-forward', type=int, default=30,
                        help='أقل عدد شمعات مستقبل بعد الـ cutoff (default: 30)')
    parser.add_argument('--search-back-days', type=int, default=90,
                        help='لورا قد إيه ندور على فترة صالحة (default: 90 يوم)')

    args = parser.parse_args()

    # Determine tickers (MASS-SCALE: default = كل الأسهم النشطة)
    if args.batch:
        tickers = [t.strip() for t in args.batch.split(',') if t.strip()]
        print(f"\n📊 Mode: BATCH ({len(tickers)} stocks)")
    elif args.ticker:
        tickers = [args.ticker.strip()]
        print(f"\n📊 Mode: SINGLE ({tickers[0]})")
    else:
        # MASS-SCALE: اقرأ كل الأسهم النشطة من stocks.db
        tickers = get_all_active_tickers(market=args.market)
        if not tickers:
            print(f"\n⚠️  مفيش أسهم نشطة في stocks.db للسوق '{args.market}'.")
            print(f"   تأكد إن stocks.db فيه أسهم و is_active = 1 AND market = '{args.market}'.")
            print(f"   أو استخدم --batch COMI,ETEL,SWDY لتحديد أسهم يدوياً.")
            return
        print(f"\n📊 Mode: MASS-SCALE — testing ALL {len(tickers)} active {args.market} stocks")
        if len(tickers) <= 20:
            print(f"   Stocks: {', '.join(tickers)}")
        else:
            print(f"   First 10: {', '.join(tickers[:10])} ... +{len(tickers) - 10} more")

    # Determine cutoff date
    if args.cutoff:
        cutoff_date = args.cutoff
    else:
        # Default: 30 days ago (so we have ~30 days of forward data)
        cutoff_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        print(f"ℹ️ No cutoff specified — using {cutoff_date} (30 days ago)")

    use_smart = not args.no_smart_cutoff
    print(f"\n🕰️ BLIND BACKTESTING ENGINE (P23 — MASS-SCALE)")
    print(f"   Tickers: {len(tickers)} stock(s)")
    print(f"   Cutoff: {cutoff_date} (engine sees data up to here)")
    print(f"   Forward: {args.forward_days} days (the 'future' to evaluate)")
    print(f"   Smart Cutoff: {'ON' if use_smart else 'OFF'}"
          + (f" (min_history={args.min_history}, min_forward={args.min_forward}, "
             f"search_back={args.search_back_days}d)" if use_smart else ""))

    # Run backtests
    results = []
    for ticker in tickers:
        print(f"\n🔄 Analyzing {ticker}...")
        result = run_blind_backtest(
            ticker, cutoff_date, args.forward_days,
            use_smart_cutoff=use_smart,
            min_history=args.min_history,
            min_forward=args.min_forward,
            search_back_days=args.search_back_days,
        )
        results.append(result)
        if not args.json:
            print_single_report(result)

    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        print_batch_summary(results)

    # Save results to file
    report_path = PROJECT_ROOT / 'db' / f'backtest_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'cutoff_date': cutoff_date,
            'forward_days': args.forward_days,
            'tickers': tickers,
            'results': results,
        }, f, indent=2, default=str)
    print(f"\n💾 Report saved to: {report_path}")


if __name__ == '__main__':
    main()

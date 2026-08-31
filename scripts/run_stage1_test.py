#!/usr/bin/env python3
"""
run_stage1_test.py — سكربت مستقل لاختبار V4-Daily v2 على السيرفر التجريبي
================================================================================

الهدف:
  يشغّل اختبار المرحلة 1 (V4-Daily v2 مع 3 فلاتر) على بيانات EGX الحقيقية،
  ويحفظ النتائج في data/stage1_results/ بدلاً من /tmp.

المميزات:
  - مستقل تماماً (مفيش imports خارجية غير sqlite3 + stdlib)
  - يكتشف الـ DBs تلقائياً (db/data_engine.db أو db/price_history.db)
  - يحفظ النتائج في ملفين: .txt (للقراءة) + .json (للتحليل)
  - يطبع timestamp واضح في اسم الملف

طريقة التشغيل:
  cd /path/to/my-project
  python3 scripts/run_stage1_test.py

  أو لو الـ DBs في مكان تاني:
  DB_DIR=/custom/db/path python3 scripts/run_stage1_test.py

المتطلبات:
  - Python 3.8+
  - sqlite3 (built-in)
  - DB فيه جدول أسعار يومية EGX (egksco_price_history أو price_history)

الـ 5 تكوينات المختبرة:
  A: v1 baseline (score≥35, no filters)
  B: v2 strict (score≥45, vol≥1.5x, multi-day)
  C: v2 strict (score≥55, vol≥1.5x, multi-day)
  D: v2 relaxed (score≥45, vol≥1.2x, multi-day)
  E: v2 no-multi-day (score≥45, vol≥1.2x, no multi-day)

معايير النجاح:
  - Precision ≥ 25%
  - Profit Factor ≥ 1.5
  - Recall ≥ 35%
  - Max DD ≤ baseline
"""
import sqlite3
import sys
import os
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ═══════════════════════════════════════════════════════════════════
# إعداد المسارات
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = Path(os.environ.get("DB_DIR", PROJECT_ROOT / "db"))
RESULTS_DIR = PROJECT_ROOT / "data" / "stage1_results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
TXT_OUTPUT = RESULTS_DIR / f"stage1_v4_daily_v2_{TIMESTAMP}.txt"
JSON_OUTPUT = RESULTS_DIR / f"stage1_v4_daily_v2_{TIMESTAMP}.json"


def find_daily_price_db():
    """يكتشف الـ DB اللي فيه جدول الأسعار اليومية.
    يجرّب بالترتيب:
      1. db/data_engine.db → egksco_price_history
      2. db/price_history.db → price_history
      3. db/market.db → egksco_price_history
    يرجع (db_path, table_name, columns_map) أو None لو مفيش.
    """
    candidates = [
        (DB_DIR / "data_engine.db", "egksco_price_history"),
        (DB_DIR / "price_history.db", "price_history"),
        (DB_DIR / "market.db", "egksco_price_history"),
        (DB_DIR / "stocks.db", "egksco_price_history"),
    ]

    for db_path, table_name in candidates:
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path))
            # هل الجدول موجود؟
            r = conn.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name=?
            """, (table_name,)).fetchone()
            if not r:
                # دور على أي جدول فيه price + history
                tables = conn.execute("""
                    SELECT name FROM sqlite_master WHERE type='table'
                """).fetchall()
                for t in tables:
                    tn = t[0].lower()
                    if ('price' in tn and 'history' in tn) or tn == 'stock_daily_prices':
                        table_name = t[0]
                        r = (t[0],)
                        break
            if r:
                cnt = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                if cnt > 0:
                    cols = [c[1] for c in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
                    conn.close()
                    return (str(db_path), table_name, cols)
            conn.close()
        except Exception as e:
            print(f"  ⚠️ خطأ في {db_path}: {e}")
    return None


# ═══════════════════════════════════════════════════════════════════
# مؤشرات مساعدة
# ═══════════════════════════════════════════════════════════════════

def sma(values, period):
    if len(values) < period: return 0
    return sum(values[-period:]) / period

def stddev(values, period):
    if len(values) < period: return 0
    sub = values[-period:]
    m = sum(sub) / period
    return (sum((v - m) ** 2 for v in sub) / period) ** 0.5

def rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    gains, losses = [], []
    for i in range(1, min(period + 1, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0: gains.append(change)
        else: losses.append(abs(change))
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def roc(values, period):
    if len(values) < period + 1: return 0
    if values[-period-1] == 0: return 0
    return (values[-1] - values[-period-1]) / values[-period-1] * 100


# ═══════════════════════════════════════════════════════════════════
# V4-Daily Detector (v1 - baseline)
# ═══════════════════════════════════════════════════════════════════

def detect_v4_daily(closes, highs, lows, volumes):
    """كاشف التجميع الهادئ اليومي (V4-Daily v1)."""
    if not closes or len(closes) < 30:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات غير كافية', 'details': {}}

    recent_vols = volumes[-20:]
    if sum(1 for v in recent_vols if v == 0) > 8:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات مكسورة (vol=0)', 'details': {}}

    last_close = closes[-1]
    if last_close <= 0:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'سعر صفر', 'details': {}}

    score = 0
    signals = []
    reasons = []
    details = {}

    # Signal 1: Price Compression (10-day range)
    if len(closes) >= 10:
        recent_high = max(highs[-10:])
        recent_low = min(lows[-10:])
        price_range_pct = (recent_high - recent_low) / last_close * 100 if last_close > 0 else 100
        details['price_range_pct'] = price_range_pct
        if price_range_pct <= 8:
            score += 22; signals.append('compression_strong')
            reasons.append(f'compression_strong range={price_range_pct:.1f}%')
        elif price_range_pct <= 15:
            score += 14; signals.append('compression_mild')
            reasons.append(f'compression_mild range={price_range_pct:.1f}%')
        elif price_range_pct <= 25:
            score += 8; signals.append('compression_weak')
            reasons.append(f'compression_weak range={price_range_pct:.1f}%')

    # Signal 2: Volume Build-up
    vol_ratio = 0
    if len(volumes) >= 20:
        recent_vol = sum(volumes[-5:]) / 5
        base_vol = sum(volumes[-20:]) / 20
        vol_ratio = recent_vol / (base_vol or 1)
        details['vol_ratio'] = vol_ratio
        if 1.2 <= vol_ratio <= 3.5:
            score += 18; signals.append('vol_buildup')
            reasons.append(f'vol_buildup ratio={vol_ratio:.2f}x')
        elif 1.05 <= vol_ratio < 1.2:
            score += 7; signals.append('vol_slight')
            reasons.append(f'vol_slight ratio={vol_ratio:.2f}x')

    # Signal 3: Tight Closes
    if len(closes) >= 15:
        sd = stddev(closes, 15)
        sd_pct = sd / last_close * 100 if last_close > 0 else 100
        details['close_stddev_pct'] = sd_pct
        if sd_pct <= 4:
            score += 18; signals.append('tight_closes')
            reasons.append(f'tight_closes sd={sd_pct:.1f}%')
        elif sd_pct <= 7:
            score += 9; signals.append('moderate_tight')
            reasons.append(f'moderate_tight sd={sd_pct:.1f}%')

    # Signal 4: VCP
    if len(closes) >= 20:
        recent_range = max(highs[-5:]) - min(lows[-5:])
        prior_range = max(highs[-10:-5]) - min(lows[-10:-5])
        if prior_range > 0:
            contraction = recent_range / prior_range
            details['vcp_contraction'] = contraction
            if contraction <= 0.5:
                score += 18; signals.append('vcp_strong')
                reasons.append(f'vcp_strong contraction={contraction:.2f}')
            elif contraction <= 0.8:
                score += 9; signals.append('vcp_mild')
                reasons.append(f'vcp_mild contraction={contraction:.2f}')

    # Signal 5: Base Formation (above SMA20 + SMA50)
    if len(closes) >= 20:
        sma20_val = sma(closes, 20)
        dist_from_sma20 = (last_close - sma20_val) / sma20_val * 100 if sma20_val > 0 else 0
        details['sma20'] = sma20_val
        details['dist_from_sma20'] = dist_from_sma20
        if -10 <= dist_from_sma20 <= 15:
            score += 10; signals.append('base_above_sma20')
            reasons.append(f'base_above_sma20 dist={dist_from_sma20:+.1f}%')
    if len(closes) >= 50:
        sma50_val = sma(closes, 50)
        dist_from_sma50 = (last_close - sma50_val) / sma50_val * 100 if sma50_val > 0 else 0
        details['sma50'] = sma50_val
        details['dist_from_sma50'] = dist_from_sma50
        if -15 <= dist_from_sma50 <= 25:
            score += 6; signals.append('base_above_sma50')
            reasons.append(f'base_above_sma50 dist={dist_from_sma50:+.1f}%')

    # Signal 6: Calm before storm
    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        details['roc5'] = roc5
        if abs(roc5) <= 4 and 'vol_buildup' in signals:
            score += 10; signals.append('calm_buildup')
            reasons.append(f'calm_buildup roc5={roc5:+.1f}%')

    # Signal 7: Multi-week base
    if len(closes) >= 20:
        range_20d = (max(highs[-20:]) - min(lows[-20:])) / last_close * 100 if last_close > 0 else 100
        details['range_20d'] = range_20d
        if range_20d <= 20:
            score += 10; signals.append('multi_week_base')
            reasons.append(f'multi_week_base range20={range_20d:.1f}%')

    # Signal 8: Near 20-day low
    if len(closes) >= 20:
        low_20d = min(lows[-20:])
        dist_from_low = (last_close - low_20d) / low_20d * 100 if low_20d > 0 else 0
        details['dist_from_20d_low'] = dist_from_low
        if 0 <= dist_from_low <= 8:
            score += 8; signals.append('near_support')
            reasons.append(f'near_support dist={dist_from_low:+.1f}%')

    # Signal 9: Volume dry-up then surge
    if len(volumes) >= 20 and len(volumes) >= 4:
        last_vol = volumes[-1]
        prior_3 = sum(volumes[-4:-1]) / 3
        base_vol = sum(volumes[-20:]) / 20
        if prior_3 < base_vol * 0.7 and last_vol > prior_3 * 1.5:
            score += 12; signals.append('vol_dryup_surge')
            reasons.append('vol_dryup_surge')

    # Anti-Signals
    if len(closes) >= 50:
        high_50d = max(highs[-50:])
        dist_from_high = (last_close - high_50d) / high_50d * 100 if high_50d > 0 else 0
        details['dist_from_50d_high'] = dist_from_high
        if dist_from_high > 40:
            score -= 12; reasons.append(f'extended dist_from_high={dist_from_high:+.1f}%')

    if len(closes) >= 6:
        roc5 = roc(closes, 5)
        if roc5 < -20:
            score -= 15; reasons.append(f'falling_knife roc5={roc5:+.1f}%')

    if vol_ratio > 5:
        score -= 20; reasons.append(f'already_exploded vol_ratio={vol_ratio:.1f}x')

    rsi_val = rsi(closes)
    details['rsi'] = rsi_val
    if rsi_val > 85:
        score -= 10; reasons.append(f'overbought rsi={rsi_val:.0f}')

    score = max(0, min(score, 100))

    has_compression = any(s in signals for s in ['compression_strong', 'compression_mild', 'compression_weak'])
    has_volume_signal = any(s in signals for s in ['vol_buildup', 'vol_slight', 'tight_closes', 'vol_dryup_surge'])
    last_vol_healthy = len(volumes) >= 1 and volumes[-1] > 10000
    is_hot = (score >= 35 and (has_compression or has_volume_signal) and last_vol_healthy)

    return {
        'is_hot': is_hot,
        'score': score,
        'signals': signals,
        'reason': ' | '.join(reasons),
        'details': details,
    }


# ═══════════════════════════════════════════════════════════════════
# V4-Daily v2 — مع 3 فلاتر (المرحلة 1)
# ═══════════════════════════════════════════════════════════════════

def detect_v4_daily_v2(closes, highs, lows, volumes, min_score=45,
                        vol_confirm_min=1.5, vol_confirm_max=5.0,
                        require_multi_day=True):
    """V4-Daily v2 — مع 3 فلاتر إضافية."""
    if not closes or len(closes) < 60:
        return {'is_hot': False, 'score': 0, 'signals': [], 'reason': 'بيانات غير كافية', 'filters': {}}

    base_result = detect_v4_daily(closes, highs, lows, volumes)
    if not base_result['is_hot']:
        return {
            'is_hot': False, 'score': base_result['score'],
            'signals': base_result['signals'], 'reason': 'base V4-Daily not hot',
            'filters': {'base_rejected': True},
        }

    score = base_result['score']
    if score < min_score:
        return {
            'is_hot': False, 'score': score,
            'signals': base_result['signals'], 'reason': f'score {score:.0f} < {min_score}',
            'filters': {'score_rejected': True},
        }

    filters = {}
    filter_reasons = []

    # Filter 1: Trend Confirmation
    sma20_val = sma(closes, 20) if len(closes) >= 20 else 0
    sma50_val = sma(closes, 50) if len(closes) >= 50 else 0
    last_close = closes[-1]
    trend_ok = False
    trend_reason = ''
    if sma20_val > 0 and sma50_val > 0:
        price_above_sma20 = last_close > sma20_val
        sma_ratio = (sma20_val - sma50_val) / sma50_val * 100
        sma20_above_or_near = sma_ratio >= -3.0
        if price_above_sma20 and sma20_above_or_near:
            trend_ok = True
            trend_reason = f'price>sma20 + sma20/sma50={sma_ratio:+.1f}%'
        else:
            trend_reason = f'price={"above" if price_above_sma20 else "below"} sma20, sma20/sma50={sma_ratio:+.1f}%'
    filters['trend_ok'] = trend_ok
    filters['trend_reason'] = trend_reason
    if not trend_ok:
        filter_reasons.append(f'trend_rejected: {trend_reason}')

    # Filter 2: Signal-day Volume
    vol_confirm_ok = False
    vol_reason = ''
    if len(volumes) >= 20:
        ma20_vol = sum(volumes[-20:]) / 20
        last_vol = volumes[-1]
        vol_ratio = last_vol / (ma20_vol or 1)
        if vol_ratio >= vol_confirm_min and vol_ratio <= vol_confirm_max:
            vol_confirm_ok = True
            vol_reason = f'vol={vol_ratio:.2f}x MA20'
        elif vol_ratio < vol_confirm_min:
            vol_reason = f'vol={vol_ratio:.2f}x MA20 (< {vol_confirm_min}x)'
        else:
            vol_reason = f'vol={vol_ratio:.2f}x MA20 (> {vol_confirm_max}x — exploded)'
        filters['vol_confirm_ok'] = vol_confirm_ok
        filters['vol_confirm_reason'] = vol_reason
        filters['vol_ratio'] = vol_ratio
        if not vol_confirm_ok:
            filter_reasons.append(f'vol_rejected: {vol_reason}')

    # Filter 3: Multi-day Confirmation
    multi_day_ok = False
    multi_day_reason = ''
    confirm_count = 1
    if len(closes) >= 62:
        for offset in [1, 2]:
            sub_closes = closes[:-offset] if offset > 0 else closes
            sub_highs = highs[:-offset] if offset > 0 else highs
            sub_lows = lows[:-offset] if offset > 0 else lows
            sub_vols = volumes[:-offset] if offset > 0 else volumes
            if len(sub_closes) < 60:
                continue
            sub_result = detect_v4_daily(sub_closes, sub_highs, sub_lows, sub_vols)
            if sub_result['is_hot'] and sub_result['score'] >= min_score:
                confirm_count += 1
        if confirm_count >= 2:
            multi_day_ok = True
            multi_day_reason = f'confirm_count={confirm_count}/3'
        else:
            multi_day_reason = f'confirm_count={confirm_count}/3 (need ≥2)'
        filters['multi_day_ok'] = multi_day_ok
        filters['multi_day_reason'] = multi_day_reason
        if not multi_day_ok:
            filter_reasons.append(f'multi_day_rejected: {multi_day_reason}')
    else:
        multi_day_ok = True
        multi_day_reason = 'insufficient data, allowed'
        filters['multi_day_ok'] = True
        filters['multi_day_reason'] = multi_day_reason

    if not require_multi_day:
        multi_day_ok = True

    is_hot_final = trend_ok and vol_confirm_ok and multi_day_ok
    final_reason = ' | '.join(filter_reasons) if filter_reasons else 'all filters passed'

    return {
        'is_hot': is_hot_final, 'score': score,
        'signals': base_result['signals'], 'reason': final_reason,
        'filters': filters, 'base_reason': base_result['reason'],
    }


# ═══════════════════════════════════════════════════════════════════
# تحميل البيانات
# ═══════════════════════════════════════════════════════════════════

def _get_column(cols, candidates):
    """ارجع أول column موجود من candidates."""
    for c in candidates:
        if c in cols:
            return c
    return None


def load_daily_history(conn, table_name, cols, ticker, end_date, days=62):
    """حمّل آخر `days` يوم من price_history قبل end_date.
    cols = list of column names.
    """
    sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
    date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
    open_col = _get_column(cols, ['open_price', 'open'])
    high_col = _get_column(cols, ['high_price', 'high'])
    low_col = _get_column(cols, ['low_price', 'low'])
    close_col = _get_column(cols, ['close_price', 'close'])
    vol_col = _get_column(cols, ['volume', 'volume_traded', 'vol'])

    if not all([sym_col, date_col, close_col]):
        return {'dates': [], 'closes': [], 'highs': [], 'lows': [], 'opens': [], 'volumes': []}

    # اذا كان date_col فيه وقت (timestamp)، ناخذ substr(1,10)
    query = f"""
        SELECT {date_col}, {open_col or 'NULL'}, {high_col or 'NULL'},
               {low_col or 'NULL'}, {close_col}, {vol_col or 'NULL'}
        FROM {table_name}
        WHERE {sym_col}=? AND substr({date_col}, 1, 10) <= ?
        ORDER BY {date_col} DESC LIMIT ?
    """
    rows = conn.execute(query, (ticker, end_date[:10], days)).fetchall()
    rows = list(reversed(rows))
    clean = [r for r in rows if r[4] and float(r[4]) > 0]
    return {
        'dates': [str(r[0])[:10] for r in clean],
        'opens': [float(r[1] or 0) for r in clean],
        'highs': [float(r[2] or 0) for r in clean],
        'lows': [float(r[3] or 0) for r in clean],
        'closes': [float(r[4] or 0) for r in clean],
        'volumes': [float(r[5] or 0) for r in clean],
    }


def get_all_tickers(conn, table_name, cols, min_avg_vol=100000, min_days=70):
    """كل الأسهم السائلة."""
    sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
    vol_col = _get_column(cols, ['volume', 'volume_traded', 'vol'])
    close_col = _get_column(cols, ['close_price', 'close'])
    if not all([sym_col, vol_col, close_col]):
        return []
    query = f"""
        SELECT {sym_col}, AVG({vol_col}) as avg_vol, COUNT(*) as days
        FROM {table_name}
        WHERE {vol_col} > 0 AND {close_col} > 0
        GROUP BY {sym_col}
        HAVING avg_vol >= ? AND days >= ?
        ORDER BY avg_vol DESC
    """
    rows = conn.execute(query, (min_avg_vol, min_days)).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def find_explosive_days(conn, table_name, cols, min_change=15.0, min_volume=100000):
    """يلقى كل (ticker, date) اللي طار ≥ min_change% في يوم."""
    sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
    date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
    open_col = _get_column(cols, ['open_price', 'open'])
    high_col = _get_column(cols, ['high_price', 'high'])
    low_col = _get_column(cols, ['low_price', 'low'])
    close_col = _get_column(cols, ['close_price', 'close'])
    vol_col = _get_column(cols, ['volume', 'volume_traded', 'vol'])

    if not all([sym_col, date_col, close_col]):
        return []

    query = f"""
        SELECT {sym_col}, substr({date_col},1,10), {open_col or 'NULL'},
               {close_col}, {high_col or 'NULL'}, {low_col or 'NULL'}, {vol_col or 'NULL'}
        FROM {table_name}
        WHERE {vol_col} >= ? AND {close_col} > 0
        ORDER BY {sym_col}, {date_col}
    """
    rows = conn.execute(query, (min_volume,)).fetchall()

    explosive = []
    prev_close = {}
    for r in rows:
        symbol = r[0]
        date = str(r[1])[:10]
        op = float(r[2] or 0)
        cl = float(r[3] or 0)
        hi = float(r[4] or 0)
        lo = float(r[5] or 0)
        vol = float(r[6] or 0)
        if symbol in prev_close and prev_close[symbol] > 0:
            change_pct = (cl - prev_close[symbol]) / prev_close[symbol] * 100
            if change_pct >= min_change:
                explosive.append({
                    'ticker': symbol, 'date': date,
                    'prev_close': prev_close[symbol],
                    'open': op, 'close': cl, 'high': hi, 'low': lo,
                    'volume': vol, 'change_pct': change_pct,
                })
        prev_close[symbol] = cl

    explosive.sort(key=lambda x: -x['change_pct'])
    return explosive


# ═══════════════════════════════════════════════════════════════════
# الاختبارات
# ═══════════════════════════════════════════════════════════════════

def test_recall(conn, table_name, cols, explosive_list, lookback=62):
    """اختبر V4-Daily v1 على الأسهم الانفجارية."""
    results = []
    for exp in explosive_list:
        hist = load_daily_history(conn, table_name, cols, exp['ticker'], exp['date'], lookback)
        if len(hist['closes']) < 30:
            results.append({'explosive': exp, 'tested': False, 'reason': 'بيانات غير كافية'})
            continue
        result = detect_v4_daily(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        results.append({
            'explosive': exp, 'tested': True,
            'is_hot': result['is_hot'], 'score': result['score'],
            'signals': result['signals'], 'reason': result['reason'],
            'prev_close': hist['closes'][-1] if hist['closes'] else 0,
        })
    return results


def test_recall_v2(conn, table_name, cols, explosive_list, lookback=62, min_score=45, **kwargs):
    """اختبر V4-Daily v2 على الأسهم الانفجارية."""
    results = []
    for exp in explosive_list:
        hist = load_daily_history(conn, table_name, cols, exp['ticker'], exp['date'], lookback)
        if len(hist['closes']) < 60:
            results.append({'explosive': exp, 'tested': False, 'reason': 'بيانات غير كافية'})
            continue
        result = detect_v4_daily_v2(hist['closes'], hist['highs'], hist['lows'],
                                     hist['volumes'], min_score=min_score, **kwargs)
        results.append({
            'explosive': exp, 'tested': True,
            'is_hot': result['is_hot'], 'score': result['score'],
            'signals': result['signals'], 'reason': result['reason'],
            'filters': result.get('filters', {}),
            'prev_close': hist['closes'][-1] if hist['closes'] else 0,
        })
    return results


def test_precision(conn, table_name, cols, scan_date, lookback=62,
                   future_days=5, min_future_return=10.0, min_score=35):
    """اختبر V4-Daily v1 على كل الأسهم السائلة."""
    tickers = get_all_tickers(conn, table_name, cols, min_avg_vol=100000, min_days=lookback + future_days + 5)
    results = {'total_signals': 0, 'true_signals': 0, 'false_signals': 0,
               'details': [], 'tested_count': 0}
    for ticker, _, _ in tickers:
        hist = load_daily_history(conn, table_name, cols, ticker, scan_date, lookback)
        if len(hist['closes']) < 30:
            continue
        results['tested_count'] += 1
        result = detect_v4_daily(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        if not result['is_hot'] or result['score'] < min_score:
            continue
        results['total_signals'] += 1
        # future
        sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
        date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
        close_col = _get_column(cols, ['close_price', 'close'])
        future_rows = conn.execute(f"""
            SELECT {date_col}, {close_col} FROM {table_name}
            WHERE {sym_col}=? AND substr({date_col},1,10) > ?
            ORDER BY {date_col} ASC LIMIT ?
        """, (ticker, scan_date[:10], future_days)).fetchall()
        if not future_rows or len(future_rows) < 2:
            results['false_signals'] += 1
            continue
        entry_price = float(hist['closes'][-1])
        max_future = max(float(r[1] or 0) for r in future_rows)
        future_return = (max_future - entry_price) / entry_price * 100 if entry_price > 0 else 0
        detail = {
            'ticker': ticker, 'date': scan_date[:10],
            'score': result['score'], 'signals': result['signals'],
            'entry': entry_price, 'max_future': max_future,
            'future_return': future_return,
            'is_true': future_return >= min_future_return,
        }
        results['details'].append(detail)
        if future_return >= min_future_return:
            results['true_signals'] += 1
        else:
            results['false_signals'] += 1
    return results


def test_precision_v2(conn, table_name, cols, scan_date, lookback=62,
                      future_days=5, min_future_return=10.0, min_score=45, **kwargs):
    """اختبر V4-Daily v2 على كل الأسهم السائلة."""
    tickers = get_all_tickers(conn, table_name, cols, min_avg_vol=100000, min_days=lookback + future_days + 5)
    results = {'total_signals': 0, 'true_signals': 0, 'false_signals': 0,
               'details': [], 'tested_count': 0,
               'filter_rejections': defaultdict(int)}
    for ticker, _, _ in tickers:
        hist = load_daily_history(conn, table_name, cols, ticker, scan_date, lookback)
        if len(hist['closes']) < 60:
            continue
        results['tested_count'] += 1
        result = detect_v4_daily_v2(hist['closes'], hist['highs'], hist['lows'],
                                     hist['volumes'], min_score=min_score, **kwargs)
        if not result['is_hot']:
            filters = result.get('filters', {})
            if filters.get('base_rejected'):
                results['filter_rejections']['base_not_hot'] += 1
            elif filters.get('score_rejected'):
                results['filter_rejections']['score_too_low'] += 1
            elif not filters.get('trend_ok', True):
                results['filter_rejections']['trend'] += 1
            elif not filters.get('vol_confirm_ok', True):
                results['filter_rejections']['vol_confirm'] += 1
            elif not filters.get('multi_day_ok', True):
                results['filter_rejections']['multi_day'] += 1
            else:
                results['filter_rejections']['unknown'] += 1
            continue
        results['total_signals'] += 1
        sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
        date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
        close_col = _get_column(cols, ['close_price', 'close'])
        future_rows = conn.execute(f"""
            SELECT {date_col}, {close_col} FROM {table_name}
            WHERE {sym_col}=? AND substr({date_col},1,10) > ?
            ORDER BY {date_col} ASC LIMIT ?
        """, (ticker, scan_date[:10], future_days)).fetchall()
        if not future_rows or len(future_rows) < 2:
            results['false_signals'] += 1
            continue
        entry_price = float(hist['closes'][-1])
        max_future = max(float(r[1] or 0) for r in future_rows)
        future_return = (max_future - entry_price) / entry_price * 100 if entry_price > 0 else 0
        detail = {
            'ticker': ticker, 'date': scan_date[:10],
            'score': result['score'], 'signals': result['signals'],
            'filters': result.get('filters', {}),
            'entry': entry_price, 'max_future': max_future,
            'future_return': future_return,
            'is_true': future_return >= min_future_return,
        }
        results['details'].append(detail)
        if future_return >= min_future_return:
            results['true_signals'] += 1
        else:
            results['false_signals'] += 1
    return results


def simulate_trade(conn, table_name, cols, ticker, entry_date, entry_price,
                   stop_pct=8, target_pct=15, max_hold=10):
    """محاكاة صفقة (وقف -8%، هدف +15%)."""
    sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
    date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
    high_col = _get_column(cols, ['high_price', 'high'])
    low_col = _get_column(cols, ['low_price', 'low'])
    close_col = _get_column(cols, ['close_price', 'close'])
    if not all([sym_col, date_col, close_col, high_col, low_col]):
        return None
    future = conn.execute(f"""
        SELECT substr({date_col},1,10), {high_col}, {low_col}, {close_col}
        FROM {table_name}
        WHERE {sym_col}=? AND substr({date_col},1,10) > ?
        ORDER BY {date_col} ASC LIMIT ?
    """, (ticker, entry_date[:10], max_hold)).fetchall()
    if not future:
        return None
    stop_price = entry_price * (1 - stop_pct / 100)
    target_price = entry_price * (1 + target_pct / 100)
    for i, r in enumerate(future):
        hi = float(r[1] or 0)
        lo = float(r[2] or 0)
        cl = float(r[3] or 0)
        if lo <= stop_price <= hi:
            return {'return_pct': -stop_pct, 'exit_type': 'stop_loss',
                    'exit_day': i + 1, 'exit_price': stop_price}
        if hi >= target_price:
            return {'return_pct': target_pct, 'exit_type': 'target_hit',
                    'exit_day': i + 1, 'exit_price': target_price}
    last_close = float(future[-1][3] or entry_price)
    ret = (last_close - entry_price) / entry_price * 100
    return {'return_pct': ret, 'exit_type': 'expired',
            'exit_day': len(future), 'exit_price': last_close}


def compute_max_dd(trades, capital=100000, risk_pct=1.2):
    equity = capital
    peak = equity
    max_dd = 0
    for t in trades:
        pnl = equity * (t['return_pct'] / 100) * (risk_pct / 100)
        equity += pnl
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd: max_dd = dd
    return max_dd


# ═══════════════════════════════════════════════════════════════════
# تشغيل تكوين واحد
# ═══════════════════════════════════════════════════════════════════

def run_config(conn, table_name, cols, label, kwargs, version, testable, scan_dates):
    if version == 'v1':
        recall_res = test_recall(conn, table_name, cols, testable, lookback=62)
        prec_data = {'total': 0, 'true': 0, 'false': 0, 'tested': 0, 'details': []}
        for sd in scan_dates:
            p = test_precision(conn, table_name, cols, sd, lookback=62,
                               future_days=5, min_future_return=10.0,
                               min_score=kwargs['min_score'])
            prec_data['total'] += p['total_signals']
            prec_data['true'] += p['true_signals']
            prec_data['false'] += p['false_signals']
            prec_data['tested'] += p['tested_count']
            prec_data['details'].extend(p['details'])
    else:
        recall_res = test_recall_v2(conn, table_name, cols, testable, lookback=62, **kwargs)
        prec_data = {'total': 0, 'true': 0, 'false': 0, 'tested': 0, 'details': []}
        for sd in scan_dates:
            p = test_precision_v2(conn, table_name, cols, sd, lookback=62,
                                   future_days=5, min_future_return=10.0, **kwargs)
            prec_data['total'] += p['total_signals']
            prec_data['true'] += p['true_signals']
            prec_data['false'] += p['false_signals']
            prec_data['tested'] += p['tested_count']
            prec_data['details'].extend(p['details'])

    caught = [r for r in recall_res if r.get('is_hot')]
    tested = [r for r in recall_res if r.get('tested')]
    recall_pct = len(caught) / max(len(tested), 1) * 100
    prec_pct = prec_data['true'] / max(prec_data['total'], 1) * 100

    trades = []
    for d in prec_data['details']:
        trade = simulate_trade(conn, table_name, cols, d['ticker'], d['date'], d['entry'],
                                stop_pct=8, target_pct=15, max_hold=10)
        if trade:
            trade['ticker'] = d['ticker']
            trade['date'] = d['date']
            trade['score'] = d['score']
            trades.append(trade)

    if trades:
        n = len(trades)
        wins = [t for t in trades if t['return_pct'] > 0]
        losses = [t for t in trades if t['return_pct'] < 0]
        gp = sum(t['return_pct'] for t in wins)
        gl = abs(sum(t['return_pct'] for t in losses))
        wr = len(wins) / n * 100
        pf = gp / gl if gl > 0 else 0
        avg_ret = sum(t['return_pct'] for t in trades) / n
        avg_hold = sum(t['exit_day'] for t in trades) / n
        max_dd = compute_max_dd(trades, capital=100000, risk_pct=1.2)
    else:
        wr = pf = avg_ret = avg_hold = max_dd = 0
        wins = []; losses = []

    return {
        'recall_pct': recall_pct, 'caught': len(caught),
        'prec_pct': prec_pct, 'total_signals': prec_data['total'],
        'true_signals': prec_data['true'], 'false_signals': prec_data['false'],
        'n_trades': len(trades), 'wr': wr, 'pf': pf,
        'avg_ret': avg_ret, 'avg_hold': avg_hold, 'max_dd': max_dd,
        'wins': len(wins), 'losses': len(losses),
        'trades': trades, 'caught_list': caught,
    }


# ═══════════════════════════════════════════════════════════════════
# الرئيسي
# ═══════════════════════════════════════════════════════════════════

def main():
    # افتح ملف الناتج للكتابة
    out_lines = []

    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    log("╔" + "═"*78 + "╗")
    log("║" + "    المرحلة 1 — V4-Daily v2 (5 تكوينات) — اختبار السيرفر    ".center(78) + "║")
    log("╚" + "═"*78 + "╝")
    log("")
    log(f"Timestamp: {TIMESTAMP}")
    log(f"Project root: {PROJECT_ROOT}")
    log(f"DB_DIR: {DB_DIR}")
    log(f"Results: {RESULTS_DIR}")
    log("")

    # اكتشف الـ DB
    log("─"*80)
    log("اكتشاف قاعدة البيانات:")
    log("─"*80)
    db_info = find_daily_price_db()
    if not db_info:
        log("❌ مفيش DB فيه جدول أسعار يومية!")
        log(f"   بحثت في: {DB_DIR}")
        log("   المتوقع: db/data_engine.db (egksco_price_history) أو db/price_history.db")
        log("")
        log("   لو الـ DBs في مكان تاني، عيّن DB_DIR:")
        log("     DB_DIR=/path/to/dbs python3 scripts/run_stage1_test.py")
        sys.exit(1)

    db_path, table_name, cols = db_info
    log(f"  ✅ DB: {db_path}")
    log(f"  ✅ Table: {table_name}")
    log(f"  ✅ Columns: {cols}")
    log("")

    conn = sqlite3.connect(db_path)

    log("─"*80)
    log("إعداد الاختبار:")
    log("─"*80)
    log("  • 5 تكوينات:")
    log("    A: v1 baseline (score≥35, no filters)")
    log("    B: v2 strict (score≥45, vol≥1.5x, multi-day)")
    log("    C: v2 strict (score≥55, vol≥1.5x, multi-day)")
    log("    D: v2 relaxed (score≥45, vol≥1.2x, multi-day)")
    log("    E: v2 no-multi-day (score≥45, vol≥1.2x, no multi-day)")
    log("  • معايير النجاح: Precision ≥ 25%, PF ≥ 1.5, Recall ≥ 35%, Max DD ≤ baseline")
    log("")

    # الأسهم الانفجارية
    log("─"*80)
    log("البحث عن الأسهم الانفجارية (≥ +15% في يوم)...")
    log("─"*80)
    explosive = find_explosive_days(conn, table_name, cols, min_change=15.0, min_volume=100000)
    testable = [e for e in explosive if e['date'] < '2026-08-28']
    # فلتر: نشيل التواريخ اللي بعدها أقل من 5 أيام (للـ precision test)
    log(f"  إجمالي الأيام الانفجارية: {len(explosive)}")
    log(f"  قابلة للاختبار: {len(testable)}")
    if len(testable) < 10:
        log("  ⚠️ عدد الأسهم الانفجارية قليل — تأكد إن البيانات فيها فترة كافية")
    log("")

    # نختار 4 تواريخ للاختبار precision (نترك 5 أيام مستقبلية)
    # نختار تواريخ من آخر 3 شهور
    all_dates = sorted(set(e['date'] for e in explosive))
    if len(all_dates) >= 4:
        # نختار تواريخ متفرقة
        idx_step = len(all_dates) // 4
        scan_dates = [all_dates[i * idx_step] for i in range(4)]
        # نتأكد إن كل تاريخ بعده 5 أيام على الأقل
        scan_dates = [d for d in scan_dates if d < all_dates[-1]]
        if len(scan_dates) > 4:
            scan_dates = scan_dates[:4]
    else:
        scan_dates = all_dates[:4]
    log(f"  تواريخ اختبار Precision: {scan_dates}")
    log("")

    # شغّل التكوينات
    configs = [
        ('A', 'v1 baseline (≥35)',         dict(min_score=35), 'v1'),
        ('B', 'v2 (≥45, vol≥1.5x, md)',    dict(min_score=45, vol_confirm_min=1.5, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('C', 'v2 (≥55, vol≥1.5x, md)',    dict(min_score=55, vol_confirm_min=1.5, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('D', 'v2 (≥45, vol≥1.2x, md)',    dict(min_score=45, vol_confirm_min=1.2, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('E', 'v2 (≥45, vol≥1.2x, no-md)', dict(min_score=45, vol_confirm_min=1.2, vol_confirm_max=5.0, require_multi_day=False), 'v2'),
    ]

    results = {}
    log("─"*80)
    log("تشغيل التكوينات:")
    log("─"*80)
    for short, label, kwargs, version in configs:
        log(f"\n  شغّل {short}: {label}...")
        r = run_config(conn, table_name, cols, label, kwargs, version, testable, scan_dates)
        results[short] = r
        log(f"    Recall={r['recall_pct']:.1f}%, Precision={r['prec_pct']:.1f}%, PF={r['pf']:.2f}, DD={r['max_dd']:.2f}%, trades={r['n_trades']}")
    log("")

    # الجدول الموحد
    log("═"*80)
    log("القسم 1: الجدول الموحد — مقارنة 5 تكوينات")
    log("═"*80)
    header = f"\n{'المقياس':<28}"
    for short, _, _, _ in configs:
        header += f" {short:>10}"
    log(header)
    log("─"*82)
    for metric, key in [
        ('Recall %', 'recall_pct'),
        ('الصواريخ المُصطادة', 'caught'),
        ('Precision %', 'prec_pct'),
        ('إجمالي الإشارات', 'total_signals'),
        ('إشارات صحيحة', 'true_signals'),
        ('إشارات كاذبة', 'false_signals'),
        ('عدد الصفقات', 'n_trades'),
        ('Win Rate %', 'wr'),
        ('Profit Factor', 'pf'),
        ('متوسط العائد %', 'avg_ret'),
        ('متوسط مدة الاحتفاظ', 'avg_hold'),
        ('Max Drawdown %', 'max_dd'),
    ]:
        line = f"{metric:<28}"
        for short, _, _, _ in configs:
            v = results[short][key]
            if isinstance(v, int):
                line += f" {v:>10}"
            else:
                line += f" {v:>10.2f}"
        log(line)
    log("")

    # معايير النجاح
    log("═"*80)
    log("القسم 2: معايير النجاح")
    log("═"*80)
    baseline_dd = results['A']['max_dd']
    log(f"\n{'التكوين':<8} {'Prec≥25':>8} {'PF≥1.5':>8} {'Recall≥35':>10} {'DD≤base':>9} {'النتيجة':>12}")
    log("─"*60)
    criteria_results = {}
    for short, _, _, _ in configs:
        r = results[short]
        c1 = r['prec_pct'] >= 25
        c2 = r['pf'] >= 1.5
        c3 = r['recall_pct'] >= 35
        c4 = r['max_dd'] <= baseline_dd + 0.5
        all_ok = c1 and c2 and c3 and c4
        status = '✓ نجاح' if all_ok else '✗ فشل'
        log(f"{short:<8} {'✓' if c1 else '✗':>8} {'✓' if c2 else '✗':>8} {'✓' if c3 else '✗':>10} {'✓' if c4 else '✗':>9} {status:>12}")
        criteria_results[short] = {'prec': c1, 'pf': c2, 'recall': c3, 'dd': c4, 'all': all_ok}
    log("")

    # الأفضل
    best_label = None
    best_score = -1
    for short, _, _, _ in configs:
        r = results[short]
        if r['recall_pct'] >= 20 and r['pf'] > best_score:
            best_score = r['pf']
            best_label = short

    if best_label:
        log("═"*80)
        log(f"القسم 3: أمثلة الصفقات في الأفضل ({best_label})")
        log("═"*80)
        trades = results[best_label]['trades']
        trades_sorted = sorted(trades, key=lambda x: -x['return_pct'])
        log(f"\n  {'date':<12} {'ticker':<8} {'score':>5} {'entry':>8} {'exit':>8} {'return%':>8} {'exit_type':<12} {'days':>5}")
        log("  " + "─"*75)
        for t in trades_sorted[:15]:
            log(f"  {t['date']:<12} {t['ticker']:<8} {t['score']:>5.0f} {t.get('entry', 0):>8.2f} {t['exit_price']:>8.2f} {t['return_pct']:>+7.1f}% {t['exit_type']:<12} {t['exit_day']:>5}")
        log("")

    # 5 أمثلة أسهم انفجارية
    if best_label and results[best_label]['caught_list']:
        log("═"*80)
        log(f"القسم 4: 5 أمثلة أسهم انفجارية مُصطادة في {best_label}")
        log("═"*80)
        caught = results[best_label]['caught_list']
        caught.sort(key=lambda x: -x['explosive']['change_pct'])
        for r in caught[:5]:
            e = r['explosive']
            log(f"\n── {e['ticker']} @ {e['date']} (تغير +{e['change_pct']:.1f}%) ──")
            log(f"  score={r['score']:.0f} is_hot={r['is_hot']}")
            filters = r.get('filters', {})
            if filters:
                log(f"  filters: trend={filters.get('trend_ok', '?')} | vol={filters.get('vol_confirm_ok', '?')} ({filters.get('vol_confirm_reason', '')}) | multi_day={filters.get('multi_day_ok', '?')}")
            log(f"  signals: {r['signals']}")
            hist = load_daily_history(conn, table_name, cols, e['ticker'], e['date'], 15)
            if len(hist['dates']) >= 5:
                log(f"  آخر 5 أيام قبل الانفجار:")
                prev = None
                for i in range(-5, 0):
                    d = hist['dates'][i]
                    cl = hist['closes'][i]
                    vol = hist['volumes'][i]
                    change = (cl - prev) / prev * 100 if prev else 0
                    log(f"    {d:<12} close={cl:>8.2f} vol={int(vol):>12,} {change:>+7.2f}%")
                    prev = cl
        log("")

    # القرار
    log("═"*80)
    log("القسم 5: القرار المقترح")
    log("═"*80)
    best_ok = None
    for short, _, _, _ in configs:
        if criteria_results[short]['all']:
            if best_ok is None or results[short]['pf'] > results[best_ok]['pf']:
                best_ok = short

    if best_ok:
        r = results[best_ok]
        verdict = f"✅ نعتمد — {best_ok} حقق كل المعايير (PF={r['pf']:.2f}, Prec={r['prec_pct']:.1f}%, Recall={r['recall_pct']:.1f}%)"
        next_step = "المرحلة 2: ربط V4-Daily كـ Discovery مع Maestro (بدون تجاوز الفلاتر الأساسية)"
    else:
        best_partial = None
        best_partial_score = -1
        for short, _, _, _ in configs:
            r = results[short]
            score = r['prec_pct'] + r['pf'] * 5 - max(0, 35 - r['recall_pct']) * 2
            if score > best_partial_score:
                best_partial_score = score
                best_partial = short
        if results[best_partial]['pf'] >= 1.5 and results[best_partial]['recall_pct'] >= 15:
            r = results[best_partial]
            verdict = f"⚠️ نعدل — {best_partial} فيه تحسن جزئي (PF={r['pf']:.2f}, Recall={r['recall_pct']:.1f}%) بس مش كامل"
            next_step = "نجرّب تكوينات إضافية: vol_min=1.0x أو نلغي multi-day لوحده"
        else:
            verdict = "❌ نرجع — مفيش تحسن حقيقي"
            next_step = "نقتل الفكرة مؤقتاً ونرجع للمختبر بفكرة جديدة"

    log(f"\n  القرار: {verdict}")
    log(f"  الخطوة التالية: {next_step}")
    log("")

    # احفظ الناتج
    conn.close()

    txt_content = "\n".join(out_lines)
    with open(TXT_OUTPUT, 'w', encoding='utf-8') as f:
        f.write(txt_content)

    # JSON للتحليل
    json_data = {
        'timestamp': TIMESTAMP,
        'db_path': db_path,
        'table_name': table_name,
        'columns': cols,
        'total_explosive': len(explosive),
        'testable_explosive': len(testable),
        'scan_dates': scan_dates,
        'configs': {},
        'criteria': criteria_results,
        'verdict': verdict,
        'next_step': next_step,
    }
    for short, label, kwargs, version in configs:
        r = results[short]
        # نختصر الـ trades (نشيل الحاجات الكبيرة)
        json_data['configs'][short] = {
            'label': label,
            'kwargs': {k: v for k, v in kwargs.items() if k != 'min_score'},
            'min_score': kwargs.get('min_score'),
            'recall_pct': r['recall_pct'],
            'caught': r['caught'],
            'prec_pct': r['prec_pct'],
            'total_signals': r['total_signals'],
            'true_signals': r['true_signals'],
            'false_signals': r['false_signals'],
            'n_trades': r['n_trades'],
            'wr': r['wr'],
            'pf': r['pf'],
            'avg_ret': r['avg_ret'],
            'avg_hold': r['avg_hold'],
            'max_dd': r['max_dd'],
            'wins': r['wins'],
            'losses': r['losses'],
        }

    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False, default=str)

    print("\n" + "═"*80)
    print("✅ تم حفظ النتائج:")
    print(f"  📄 Text:  {TXT_OUTPUT}")
    print(f"  📊 JSON:  {JSON_OUTPUT}")
    print("═"*80)

    return results


if __name__ == '__main__':
    main()

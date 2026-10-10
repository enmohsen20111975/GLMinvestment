#!/usr/bin/env python3
"""
run_strength_confirmation_test.py
=================================
المرحلة الجديدة — كاشف "تأكيد القوة" (Strength Confirmation)
============================================================
بعد فشل V4-Daily (اللي بيدور على تجميع هادئ قبل الانفجار)، نغير الفلسفة:

  ❌ V4-Daily: حاول نتنبأ بالتجميع قبل الانفجار (فشل — Recall 1-3% مع الفلاتر)
  ✅ Strength Confirmation: استنى الميكرز يبينوا نيتهم، وبعدين ادخل معاهم

منطق الكاشف:
  السهم بيكون "قوي" لو:
    1. طلع بقوة واضحة (ROC5 ≥ +5% أو ROC10 ≥ +8%)
    2. حجم مرتفع فعلاً (vol ≥ 1.5× MA20) — مش بس buildup تدريجي
    3. فوق SMA20 (أبترند قصير سليم)
    4. مش في ذروة شرائية متطرفة (RSI < 80)
    5. مش ممدود زيادة (distance from 50d high < 30%)
    6. R/R مقبول (target/stop ≥ 1.5)

  ده أقرب لفلسفة Momentum + Volume Surge، بشروط صارمة.
  بندخل مع الميكرز لما يبينوا نيتهم، مش بنحاول نخمن قبلهم.

الاختبار:
  - Recall: على الأسهم الانفجارية (≥ +15% في يوم)
  - Precision: على كل الأسهم السائلة (إشارة صحيحة = ≥ +10% خلال 5 أيام)
  - PF + Max DD: محاكاة (وقف -8%، هدف +15%، 10 أيام)

التشغيل:
  cd /path/to/GLMinvestment
  python3 scripts/run_strength_confirmation_test.py

  # لو الـ DBs في مكان تاني:
  DB_DIR=/custom/db/path python3 scripts/run_strength_confirmation_test.py

النتائج تتسجل في: data/strength_confirmation_results/
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
RESULTS_DIR = PROJECT_ROOT / "data" / "strength_confirmation_results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
TXT_OUTPUT = RESULTS_DIR / f"strength_confirmation_{TIMESTAMP}.txt"
JSON_OUTPUT = RESULTS_DIR / f"strength_confirmation_{TIMESTAMP}.json"


def find_daily_price_db():
    """يكتشف الـ DB اللي فيه جدول الأسعار اليومية."""
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
            r = conn.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name=?
            """, (table_name,)).fetchone()
            if not r:
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

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return 0
    trs = []
    for i in range(-period, 0):
        if i - 1 >= -len(closes):
            tr = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i-1]),
                     abs(lows[i] - closes[i-1]))
            trs.append(tr)
    return sum(trs) / len(trs) if trs else 0


# ═══════════════════════════════════════════════════════════════════
# Strength Confirmation Detector
# ═══════════════════════════════════════════════════════════════════

def detect_strength_confirmation(closes, highs, lows, volumes,
                                   min_roc5=5.0, min_roc10=8.0,
                                   min_vol_ratio=1.5,
                                   max_rsi=80.0,
                                   max_dist_from_high=30.0):
    """كاشف تأكيد القوة — بيدخل مع الميكرز لما يبينوا نيتهم.

    Args:
        closes, highs, lows, volumes: lists of daily values (oldest first)
        min_roc5: الحد الأدنى لـ ROC5 (5 أيام) — default +5%
        min_roc10: الحد الأدنى لـ ROC10 (10 أيام) — default +8%
        min_vol_ratio: الحد الأدنى لـ vol/MA20 — default 1.5×
        max_rsi: الحد الأقصى لـ RSI — default 80 (مش ذروة شرائية متطرفة)
        max_dist_from_high: الحد الأقصى للمسافة من قمة 50 يوم — default 30%

    Returns:
        {
            'is_strong': bool,
            'score': float (0-100),
            'signals': list[str],
            'reason': str,
            'details': dict,
        }
    """
    if not closes or len(closes) < 25:
        return {'is_strong': False, 'score': 0, 'signals': [], 'reason': 'بيانات غير كافية', 'details': {}}

    last_close = closes[-1]
    if last_close <= 0:
        return {'is_strong': False, 'score': 0, 'signals': [], 'reason': 'سعر صفر', 'details': {}}

    score = 0
    signals = []
    reasons = []
    details = {}

    # ─── 1. Price Strength (ROC) ───
    roc5 = roc(closes, 5)
    roc10 = roc(closes, 10)
    roc20 = roc(closes, 20)
    details['roc5'] = roc5
    details['roc10'] = roc10
    details['roc20'] = roc20

    # ROC5 ≥ +5% (حركة قوية آخر 5 أيام)
    if roc5 >= min_roc5:
        score += 18
        signals.append('roc5_strong')
        reasons.append(f'roc5={roc5:+.1f}%')
    elif roc5 >= 3:
        score += 8
        signals.append('roc5_mild')
        reasons.append(f'roc5_mild={roc5:+.1f}%')

    # ROC10 ≥ +8% (زخم 10 أيام واضح)
    if roc10 >= min_roc10:
        score += 15
        signals.append('roc10_strong')
        reasons.append(f'roc10={roc10:+.1f}%')
    elif roc10 >= 5:
        score += 6
        signals.append('roc10_mild')
        reasons.append(f'roc10_mild={roc10:+.1f}%')

    # ROC20 ≥ +10% (أبترند 20 يوم سليم)
    if roc20 >= 10:
        score += 10
        signals.append('roc20_strong')
        reasons.append(f'roc20={roc20:+.1f}%')

    # ─── 2. Volume Surge (حجم مرتفع فعلاً) ───
    vol_ratio = 0
    if len(volumes) >= 20:
        ma20_vol = sum(volumes[-20:]) / 20
        last_vol = volumes[-1]
        vol_ratio = last_vol / (ma20_vol or 1)
        details['vol_ratio'] = vol_ratio
        # حجم ≥ 1.5× MA20 = الميكرز شغال
        if vol_ratio >= min_vol_ratio:
            score += 20
            signals.append('vol_surge')
            reasons.append(f'vol_surge={vol_ratio:.2f}x')
        elif vol_ratio >= 1.2:
            score += 8
            signals.append('vol_above_avg')
            reasons.append(f'vol_above_avg={vol_ratio:.2f}x')

    # ─── 3. Above SMA20 (أبترند قصير سليم) ───
    sma20_val = sma(closes, 20) if len(closes) >= 20 else 0
    if sma20_val > 0:
        dist_from_sma20 = (last_close - sma20_val) / sma20_val * 100
        details['sma20'] = sma20_val
        details['dist_from_sma20'] = dist_from_sma20
        if last_close > sma20_val:
            score += 12
            signals.append('above_sma20')
            reasons.append(f'above_sma20 dist={dist_from_sma20:+.1f}%')

    # ─── 4. Above SMA50 (أبترند متوسط سليم) ───
    sma50_val = sma(closes, 50) if len(closes) >= 50 else 0
    if sma50_val > 0:
        dist_from_sma50 = (last_close - sma50_val) / sma50_val * 100
        details['sma50'] = sma50_val
        details['dist_from_sma50'] = dist_from_sma50
        if last_close > sma50_val:
            score += 8
            signals.append('above_sma50')
            reasons.append(f'above_sma50 dist={dist_from_sma50:+.1f}%')

    # ─── 5. SMA20 > SMA50 (trend alignment) ───
    if sma20_val > 0 and sma50_val > 0:
        if sma20_val > sma50_val:
            score += 6
            signals.append('sma_aligned')
            sma_ratio = (sma20_val - sma50_val) / sma50_val * 100
            reasons.append(f'sma_aligned {sma_ratio:+.1f}%')

    # ─── 6. Not Overbought (RSI < 80) ───
    rsi_val = rsi(closes)
    details['rsi'] = rsi_val
    if rsi_val < max_rsi:
        score += 8
        signals.append('not_overbought')
        reasons.append(f'rsi={rsi_val:.0f}')
    else:
        # عقاب لو overbought شديد
        if rsi_val > 85:
            score -= 10
            reasons.append(f'overbought rsi={rsi_val:.0f}')

    # ─── 7. Not Extended (distance from 50d high) ───
    if len(highs) >= 50:
        high_50d = max(highs[-50:])
        dist_from_high = (last_close - high_50d) / high_50d * 100
        details['dist_from_50d_high'] = dist_from_high
        # مش ممدود زيادة (لو بعيد عن القمة بـ +30% يكون ممدود)
        if dist_from_high <= max_dist_from_high:
            score += 5
            signals.append('not_extended')
            reasons.append(f'dist_from_high={dist_from_high:+.1f}%')
        else:
            score -= 8
            reasons.append(f'extended dist_from_high={dist_from_high:+.1f}%')

    # ─── 8. Today's candle strong (close near high) ───
    if len(closes) >= 1 and len(highs) >= 1 and len(lows) >= 1:
        today_range = highs[-1] - lows[-1]
        if today_range > 0:
            close_position = (last_close - lows[-1]) / today_range * 100
            details['close_position'] = close_position
            # close في أعلى 30% من شمعة اليوم = إغلاق قوي
            if close_position >= 70:
                score += 8
                signals.append('strong_close')
                reasons.append(f'strong_close={close_position:.0f}%')

    # ─── Anti-Signals ───
    # Falling knife: نزل أكتر من -10% في 5 أيام
    if roc5 < -10:
        score -= 15
        reasons.append(f'falling_knife roc5={roc5:+.1f}%')

    # Volume collapse: حجم أقل من 0.5× MA20 = مفيش اهتمام
    if vol_ratio > 0 and vol_ratio < 0.5:
        score -= 10
        reasons.append(f'vol_collapse={vol_ratio:.2f}x')

    score = max(0, min(score, 100))

    # ─── القرار ───
    # is_strong: لازم يكون فيه (ROC5 قوي OR ROC10 قوي) + volume surge + above SMA20 + not overbought
    has_momentum = ('roc5_strong' in signals) or ('roc10_strong' in signals)
    has_volume = 'vol_surge' in signals
    has_trend = 'above_sma20' in signals
    not_overbought = 'not_overbought' in signals
    is_strong = (has_momentum and has_volume and has_trend and not_overbought
                 and score >= 50)

    return {
        'is_strong': is_strong,
        'score': score,
        'signals': signals,
        'reason': ' | '.join(reasons),
        'details': details,
    }


# ═══════════════════════════════════════════════════════════════════
# تحميل البيانات
# ═══════════════════════════════════════════════════════════════════

def _get_column(cols, candidates):
    for c in candidates:
        if c in cols:
            return c
    return None


def load_daily_history(conn, table_name, cols, ticker, end_date, days=62):
    sym_col = _get_column(cols, ['symbol', 'ticker', 'stock_ticker'])
    date_col = _get_column(cols, ['price_date', 'date', 'trade_date', 'timestamp'])
    open_col = _get_column(cols, ['open_price', 'open'])
    high_col = _get_column(cols, ['high_price', 'high'])
    low_col = _get_column(cols, ['low_price', 'low'])
    close_col = _get_column(cols, ['close_price', 'close'])
    vol_col = _get_column(cols, ['volume', 'volume_traded', 'vol'])

    if not all([sym_col, date_col, close_col]):
        return {'dates': [], 'closes': [], 'highs': [], 'lows': [], 'opens': [], 'volumes': []}

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
    """اختبر Strength Confirmation على الأسهم الانفجارية.
    لكل سهم انفجاري، نشغل الكاشف على بيانات الـ 62 يوم السابقة (شامل يوم الانفجار).
    الهدف: هل الكاشف رجّع is_strong=True في يوم الانفجار؟
    """
    results = []
    for exp in explosive_list:
        ticker = exp['ticker']
        exp_date = exp['date']
        # حمّل بيانات لحد يوم الانفجار (شامله)
        hist = load_daily_history(conn, table_name, cols, ticker, exp_date, lookback)
        if len(hist['closes']) < 25:
            results.append({'explosive': exp, 'tested': False, 'reason': 'بيانات غير كافية'})
            continue
        result = detect_strength_confirmation(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        results.append({
            'explosive': exp, 'tested': True,
            'is_strong': result['is_strong'], 'score': result['score'],
            'signals': result['signals'], 'reason': result['reason'],
            'details': result.get('details', {}),
            'signal_date': hist['dates'][-1] if hist['dates'] else '',
            'prev_close': hist['closes'][-1] if hist['closes'] else 0,
        })
    return results


def test_precision(conn, table_name, cols, scan_date, lookback=62,
                   future_days=5, min_future_return=10.0):
    """اختبر Strength Confirmation على كل الأسهم السائلة في تاريخ معين.
    الإشارة 'صحيحة' = السهم طار ≥ +10% خلال 5 أيام بعدها.
    """
    tickers = get_all_tickers(conn, table_name, cols, min_avg_vol=100000, min_days=lookback + future_days + 5)
    results = {
        'total_signals': 0, 'true_signals': 0, 'false_signals': 0,
        'details': [], 'tested_count': 0,
        'filter_rejections': defaultdict(int),
    }
    for ticker, _, _ in tickers:
        hist = load_daily_history(conn, table_name, cols, ticker, scan_date, lookback)
        if len(hist['closes']) < 25:
            continue
        results['tested_count'] += 1
        result = detect_strength_confirmation(hist['closes'], hist['highs'], hist['lows'], hist['volumes'])
        if not result['is_strong']:
            # نسجل سبب الرفض
            if not result['signals']:
                results['filter_rejections']['no_signals'] += 1
            elif result['score'] < 50:
                results['filter_rejections']['score_too_low'] += 1
            else:
                # عندنا signals بس مفيش momentum أو volume أو trend
                if 'roc5_strong' not in result['signals'] and 'roc10_strong' not in result['signals']:
                    results['filter_rejections']['no_momentum'] += 1
                elif 'vol_surge' not in result['signals']:
                    results['filter_rejections']['no_vol_surge'] += 1
                elif 'above_sma20' not in result['signals']:
                    results['filter_rejections']['below_sma20'] += 1
                elif 'not_overbought' not in result['signals']:
                    results['filter_rejections']['overbought'] += 1
                else:
                    results['filter_rejections']['other'] += 1
            continue
        results['total_signals'] += 1
        # حمّل الـ future_days
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
            'details': result.get('details', {}),
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
# الرئيسي
# ═══════════════════════════════════════════════════════════════════

def main():
    out_lines = []

    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    log("╔" + "═"*78 + "╗")
    log("║" + "   تأكيد القوة (Strength Confirmation) — كاشف جديد بعد فشل V4   ".center(78) + "║")
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
    log("  • الفلسفة: بندخل مع الميكرز لما يبينوا نيتهم (مش بنحاول نتنبأ قبلهم)")
    log("  • الشروط: ROC5≥+5% OR ROC10≥+8% + vol≥1.5×MA20 + فوقSMA20 + RSI<80")
    log("  • معايير النجاح: Precision ≥ 25%, PF ≥ 1.5, Recall ≥ 35%, Max DD ≤ 15%")
    log("")

    # الأسهم الانفجارية
    log("─"*80)
    log("البحث عن الأسهم الانفجارية (≥ +15% في يوم)...")
    log("─"*80)
    explosive = find_explosive_days(conn, table_name, cols, min_change=15.0, min_volume=100000)
    testable = [e for e in explosive if e['date'] < '2026-08-28']
    log(f"  إجمالي الأيام الانفجارية: {len(explosive)}")
    log(f"  قابلة للاختبار: {len(testable)}")
    log("")

    # تواريخ اختبار Precision (نختار 4 تواريخ متفرقة)
    all_dates = sorted(set(e['date'] for e in explosive))
    if len(all_dates) >= 4:
        idx_step = len(all_dates) // 4
        scan_dates = [all_dates[i * idx_step] for i in range(4)]
        scan_dates = [d for d in scan_dates if d < all_dates[-1]]
        if len(scan_dates) > 4:
            scan_dates = scan_dates[:4]
    else:
        scan_dates = all_dates[:4]
    log(f"  تواريخ اختبار Precision: {scan_dates}")
    log("")

    # ─── القسم 1: Recall على الأسهم الانفجارية ───
    log("═"*80)
    log("القسم 1: Recall — الأسهم الانفجارية")
    log("═"*80)
    recall_results = test_recall(conn, table_name, cols, testable, lookback=62)
    caught = [r for r in recall_results if r.get('is_strong')]
    tested = [r for r in recall_results if r.get('tested')]
    not_tested = [r for r in recall_results if not r.get('tested')]
    recall_pct = len(caught) / max(len(tested), 1) * 100

    log(f"\n  تم اختبار: {len(tested)}")
    log(f"  مرفوض (بيانات غير كافية): {len(not_tested)}")
    log(f"  الكاشف اصطاد (is_strong=True): {len(caught)}")
    log(f"  Recall: {recall_pct:.1f}%")

    # أعلى 15 مُصطادة
    log(f"\n  ── أعلى 15 انفجارية مُصطادة ──")
    log(f"  {'ticker':<8} {'date':<12} {'change%':>8} {'score':>6} {'signals':<35}")
    log("  " + "─"*78)
    caught_sorted = sorted(caught, key=lambda x: -x['explosive']['change_pct'])
    for r in caught_sorted[:15]:
        e = r['explosive']
        sig = ','.join(r['signals'])[:34]
        log(f"  {e['ticker']:<8} {e['date']:<12} {e['change_pct']:>+7.1f}% {r['score']:>6.0f} {sig:<35}")

    # أعلى 10 فائتة
    missed = [r for r in recall_results if r.get('tested') and not r.get('is_strong')]
    log(f"\n  ── أعلى 10 انفجارية فائتة ──")
    log(f"  {'ticker':<8} {'date':<12} {'change%':>8} {'score':>6} {'reason':<50}")
    log("  " + "─"*90)
    missed_sorted = sorted(missed, key=lambda x: -x['explosive']['change_pct'])
    for r in missed_sorted[:10]:
        e = r['explosive']
        reason = r.get('reason', '')[:49]
        log(f"  {e['ticker']:<8} {e['date']:<12} {e['change_pct']:>+7.1f}% {r.get('score', 0):>6.0f} {reason:<50}")

    # ─── القسم 2: Precision ───
    log("\n" + "═"*80)
    log("القسم 2: Precision — فحص الإشارات الكاذبة")
    log("═"*80)
    log("  القاعدة: إشارة 'صحيحة' = السهم طار ≥ +10% خلال 5 أيام بعدها.\n")

    all_precision = {'total': 0, 'true': 0, 'false': 0, 'tested': 0, 'details': []}
    filter_rejections = defaultdict(int)
    for sd in scan_dates:
        p = test_precision(conn, table_name, cols, sd, lookback=62,
                           future_days=5, min_future_return=10.0)
        all_precision['total'] += p['total_signals']
        all_precision['true'] += p['true_signals']
        all_precision['false'] += p['false_signals']
        all_precision['tested'] += p['tested_count']
        all_precision['details'].extend(p['details'])
        for k, v in p['filter_rejections'].items():
            filter_rejections[k] += v
        prec_pct = p['true_signals'] / p['total_signals'] * 100 if p['total_signals'] > 0 else 0
        log(f"  {sd}: tested={p['tested_count']} signals={p['total_signals']} true={p['true_signals']} precision={prec_pct:.1f}%")

    prec_pct = all_precision['true'] / max(all_precision['total'], 1) * 100
    log(f"\n  ── الإجمالي ──")
    log(f"  الأسهم المختبرة: {all_precision['tested']}")
    log(f"  إجمالي الإشارات: {all_precision['total']}")
    log(f"  صحيحة: {all_precision['true']}")
    log(f"  كاذبة: {all_precision['false']}")
    log(f"  Precision: {prec_pct:.1f}%")

    # أسباب الرفض
    log(f"\n  ── أسباب رفض الإشارات ──")
    for k, v in sorted(filter_rejections.items(), key=lambda x: -x[1]):
        log(f"    {k}: {v}")

    # ─── القسم 3: محاكاة الصفقات ───
    log("\n" + "═"*80)
    log("القسم 3: محاكاة الصفقات (وقف -8%، هدف +15%، 10 أيام)")
    log("═"*80)
    trades = []
    for d in all_precision['details']:
        trade = simulate_trade(conn, table_name, cols, d['ticker'], d['date'], d['entry'],
                                stop_pct=8, target_pct=15, max_hold=10)
        if trade:
            trade['ticker'] = d['ticker']
            trade['date'] = d['date']
            trade['score'] = d['score']
            trade['signals'] = d['signals']
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

        log(f"\n  إجمالي الصفقات: {n}")
        log(f"  Win Rate: {wr:.1f}% ({len(wins)} رابحة / {len(losses)} خاسرة)")
        log(f"  Profit Factor: {pf:.2f}")
        log(f"  متوسط العائد: {avg_ret:+.2f}%")
        log(f"  متوسط مدة الاحتفاظ: {avg_hold:.1f} يوم")
        log(f"  Max Drawdown: {max_dd:.2f}%")

        # أمثلة الصفقات
        log(f"\n  ── أمثلة الصفقات (أعلى 15) ──")
        log(f"  {'date':<12} {'ticker':<8} {'score':>5} {'entry':>8} {'exit':>8} {'return%':>8} {'exit_type':<12} {'days':>5}")
        log("  " + "─"*75)
        for t in sorted(trades, key=lambda x: -x['return_pct'])[:15]:
            sig = ','.join(t.get('signals', []))[:15]
            log(f"  {t['date']:<12} {t['ticker']:<8} {t['score']:>5.0f} {t.get('entry', 0):>8.2f} {t['exit_price']:>8.2f} {t['return_pct']:>+7.1f}% {t['exit_type']:<12} {t['exit_day']:>5}")

    # ─── القسم 4: 5 أمثلة مفصّلة ───
    log("\n" + "═"*80)
    log("القسم 4: 5 أمثلة مفصّلة — الكاشف مع الصواريخ")
    log("═"*80)

    examples = caught_sorted[:5] if len(caught_sorted) >= 5 else (caught_sorted + missed_sorted[:5-len(caught_sorted)])
    for r in examples[:5]:
        e = r['explosive']
        log(f"\n── {e['ticker']} @ {e['date']} (تغير +{e['change_pct']:.1f}%) ──")
        if r.get('tested'):
            log(f"  is_strong={r['is_strong']} score={r['score']:.0f}")
            log(f"  signals: {r['signals']}")
            log(f"  reason: {r['reason']}")
            details = r.get('details', {})
            log(f"  details: roc5={details.get('roc5', 0):+.1f}% roc10={details.get('roc10', 0):+.1f}% vol={details.get('vol_ratio', 0):.2f}x rsi={details.get('rsi', 0):.0f}")
            # اعرض آخر 5 أيام
            hist = load_daily_history(conn, table_name, cols, e['ticker'], e['date'], 15)
            if len(hist['dates']) >= 5:
                log(f"  آخر 5 أيام (شامل يوم الانفجار):")
                log(f"    {'date':<12} {'close':>8} {'volume':>12} {'change%':>8}")
                prev = None
                for i in range(-5, 0):
                    d = hist['dates'][i]
                    cl = hist['closes'][i]
                    vol = hist['volumes'][i]
                    change = (cl - prev) / prev * 100 if prev else 0
                    log(f"    {d:<12} {cl:>8.2f} {int(vol):>12,} {change:>+7.2f}%")
                    prev = cl

    # ─── القسم 5: معايير النجاح + الحكم ───
    log("\n" + "═"*80)
    log("القسم 5: معايير النجاح + الحكم")
    log("═"*80)

    log(f"""
┌─────────────────────────────────────────────────────────────────────────┐
│                          معايير النجاح                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  المعيار            │  المطلوب   │  النتيجة   │  الحالة  │
├─────────────────────────────────────────────────────────────────────────┤
│  Recall %           │  ≥ 35%     │  {recall_pct:>6.1f}%   │  {'✓' if recall_pct >= 35 else '✗':>7}    │
│  Precision %        │  ≥ 25%     │  {prec_pct:>6.1f}%   │  {'✓' if prec_pct >= 25 else '✗':>7}    │
│  Profit Factor      │  ≥ 1.5     │  {pf:>6.2f}   │  {'✓' if pf >= 1.5 else '✗':>7}    │
│  Max DD %           │  ≤ 15%     │  {max_dd:>6.2f}%   │  {'✓' if max_dd <= 15 else '✗':>7}    │
└─────────────────────────────────────────────────────────────────────────┘
""")

    c1 = recall_pct >= 35
    c2 = prec_pct >= 25
    c3 = pf >= 1.5
    c4 = max_dd <= 15
    all_ok = c1 and c2 and c3 and c4

    if all_ok:
        verdict = f"✅ نعتمد — الكاشف حقق كل المعايير"
        next_step = "المرحلة التالية: ربط كـ Discovery مع Maestro (بدون تجاوز الفلاتر الأساسية)"
    elif (c1 or c2) and c3:
        verdict = f"⚠️ نعدل — فيه تحسن بس مش كامل"
        next_step = "نجرّب تعديلات: min_roc5=4 أو min_vol_ratio=1.3"
    elif c1 and not c2:
        verdict = f"⚠️ Recall كويس بس Precision ضعيف — يحتاج فلتر إضافي"
        next_step = "نضيف فلتر: score ≥ 55 أو RSI ≤ 75"
    elif c2 and not c1:
        verdict = f"⚠️ Precision كويس بس Recall ضعيف — يحتاج تخفيف"
        next_step = "نخفف: min_roc5=4 أو min_vol_ratio=1.3"
    else:
        verdict = f"❌ نرجع — مفيش تحسن حقيقي"
        next_step = "نقتل الفكرة ونرجع للمختبر بفكرة جديدة"

    log(f"  القرار: {verdict}")
    log(f"  الخطوة التالية: {next_step}")

    conn.close()

    # احفظ النتائج
    txt_content = "\n".join(out_lines)
    with open(TXT_OUTPUT, 'w', encoding='utf-8') as f:
        f.write(txt_content)

    # JSON
    json_data = {
        'timestamp': TIMESTAMP,
        'db_path': db_path,
        'table_name': table_name,
        'total_explosive': len(explosive),
        'testable_explosive': len(testable),
        'scan_dates': scan_dates,
        'metrics': {
            'recall_pct': recall_pct,
            'caught': len(caught),
            'missed': len(missed),
            'precision_pct': prec_pct,
            'total_signals': all_precision['total'],
            'true_signals': all_precision['true'],
            'false_signals': all_precision['false'],
            'n_trades': len(trades) if trades else 0,
            'wr': wr if trades else 0,
            'pf': pf if trades else 0,
            'avg_ret': avg_ret if trades else 0,
            'avg_hold': avg_hold if trades else 0,
            'max_dd': max_dd if trades else 0,
        },
        'criteria': {
            'recall_ok': c1, 'precision_ok': c2, 'pf_ok': c3, 'dd_ok': c4, 'all_ok': all_ok,
        },
        'verdict': verdict,
        'next_step': next_step,
        'filter_rejections': dict(filter_rejections),
        'top_caught': [
            {
                'ticker': r['explosive']['ticker'],
                'date': r['explosive']['date'],
                'change_pct': r['explosive']['change_pct'],
                'score': r['score'],
                'signals': r['signals'],
            } for r in caught_sorted[:10]
        ],
    }
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False, default=str)

    print("\n" + "═"*80)
    print("✅ تم حفظ النتائج:")
    print(f"  📄 Text:  {TXT_OUTPUT}")
    print(f"  📊 JSON:  {JSON_OUTPUT}")
    print("═"*80)

    return json_data


if __name__ == '__main__':
    main()

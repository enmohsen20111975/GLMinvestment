#!/usr/bin/env python3
"""
exit_radar.py — رادار الخروج (EXIT RADAR)
=========================================
يكشف إشارات التوزيع والخروج — عكس رادار الميكرز. يساعد المستخدم على
معرفة متى يبيع (تقليل المركز / خروج كامل).

5 مسارات خروج:
  X1_distribution_strong   → توزيع قوي (بيع مؤسسي)
  X2_volume_divergence     → تباعد حجمي (سعر يصعد بدون حجم = صعود وهمي)
  X3_resistance_rejection  → رفض عند مقاومة (upper shadow طويلة)
  X4_exhaustion_gap        → فجوة إرهاق بعد صعود طويل (gap up + close red)
  X5_kill_switch_triggered → Kill Switch (Limit Up Trap / توزيع قاتل)

الخوارزمية:
  1. افحص كل الأسهم في price_history (data_engine.db / stocks.db).
  2. لكل سهم، تحقق من المسارات الخمسة.
  3. لو أي مسار تحقق → أضفه لـ exit_list.
  4. اطبع JSON إلى scripts/output/exit_radar_<date>.json.

Multi-market support:
  - EGX (افتراضي): يفلتر بـ stocks.market IN ('EGX', 'مصر').
  - TADAWUL: market='السعودية' أو 'TADAWUL'.
  - KSE: market='الكويت' أو 'KSE'.
  - QSE: market='قطر' أو 'QSE'.
  - CRYPTO / GOLD: يستخدم نفس الـ fallback chain (data_engine.db.historical_data)
    لو الـ prices متوفرة. لو لا → يرجع قائمة فاضية.

CLI:
  python3 scripts/exit_radar.py
  python3 scripts/exit_radar.py --json-only
  python3 scripts/exit_radar.py --market TADAWUL
  python3 scripts/exit_radar.py --limit 50
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Optional import — falls back gracefully when vps-service isn't on sys.path.
# We use the same kill_switch logic as maker_radar.py for X5 path detection
# (Limit Up Trap + deadly distribution + phantom rotation).
try:
    sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
    from utils.shared_liquidity import (  # type: ignore
        check_kill_switch,
        check_limit_up_trap,
    )
    _HAS_SHARED_LIQUIDITY = True
except Exception:
    _HAS_SHARED_LIQUIDITY = False


# ============================================================================
# PORTABLE DB DETECTION — يشتغل في sandbox + laptop + production
# ============================================================================
# Same fallback chain as maker_radar.py — reuse the column-name discovery so
# the exit radar works against every DB variant the project ships with.
def _find_radar_db():
    """اكتشف الـ DB المتاح تلقائياً. يرجع (db_path, table, columns...).
    يتحقق إن الجدول مش فاضي عشان نتجنب egksco_price_history الفاضية.
    """
    candidates = [
        # 1. data_engine.db.egksco_price_history — source of truth في الإنتاج
        ('db/data_engine.db', 'egksco_price_history', 'symbol', 'close_price', 'volume', 'turnover', 'price_date', 'open_price', 'high_price', 'low_price'),
        # 2. stocks.db.stock_daily_prices — fallback
        ('db/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
        # 3. data_engine.db.historical_data — fallback للأسواق التانية
        ('db/data_engine.db', 'historical_data', 'symbol', 'close', 'volume', None, 'date', 'open', 'high', 'low'),
        # 4. sandbox fallbacks
        ('db/production_snapshot.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
        ('db/vps_real/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
    ]
    for db_rel, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col in candidates:
        db_path = PROJECT_ROOT / db_rel
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path))
            cur = conn.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            row = cur.fetchone()
            if not row:
                conn.close()
                continue
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.close()
            if n == 0:
                continue
            return db_path, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col
        except Exception:
            continue
    return None, None, None, None, None, None, None, None, None, None


PROD_DB, PROD_TABLE, TICKER_COL, PRICE_COL, VOL_COL, TURN_COL, DATE_COL, OPEN_COL, HIGH_COL, LOW_COL = _find_radar_db()
DB_SOURCE_ID = f"{PROD_DB.name}::{PROD_TABLE}" if PROD_DB else None


def log(msg):
    print(msg, flush=True)


def parse_volume(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m
            s = s[:-1]
            break
    try:
        return float(s) * mult
    except Exception:
        return 0.0


def fetch_ticker_series(conn, ticker, days=30):
    """جلب بيانات سهم — portable (يستخدم column names المكتشفة)."""
    cols = f"{DATE_COL}, {OPEN_COL} as open, {HIGH_COL} as high, {LOW_COL} as low, {PRICE_COL} as close, {VOL_COL} as volume"
    if TURN_COL:
        cols += f", {TURN_COL} as turnover"
    else:
        cols += ", NULL as turnover"
    query = f"""
        SELECT {cols}
        FROM {PROD_TABLE}
        WHERE {TICKER_COL} = ? AND {PRICE_COL} IS NOT NULL AND {PRICE_COL} > 0
        ORDER BY {DATE_COL} DESC
        LIMIT ?
    """
    rows = conn.execute(query, (ticker, days)).fetchall()
    normalized = []
    for r in rows:
        d = dict(r)
        d['price_date'] = d.get(DATE_COL) or d.get('date') or d.get('price_date')
        d['close'] = d.get('close') or d.get(PRICE_COL)
        d['volume'] = d.get('volume') or d.get(VOL_COL)
        d['turnover'] = d.get('turnover') if TURN_COL else None
        d['open'] = d.get('open') or d.get(OPEN_COL)
        d['high'] = d.get('high') or d.get(HIGH_COL)
        d['low'] = d.get('low') or d.get(LOW_COL)
        normalized.append(d)
    return list(reversed(normalized))


# ============================================================================
# EXIT PATH DETECTION
# ============================================================================

def detect_x1_distribution_strong(closes, volumes, highs, lows):
    """X1_distribution_strong — توزيع قوي (بيع مؤسسي).

    الشروط:
      1. حجم اليوم > 1.5× متوسط 20 يوم
      2. الإغلاق في النصف السفلي من مدى اليوم (close < (high+low)/2)
      3. 3+ أيام بيع في آخر 5 أيام (close < prev_close)
      4. Net flow سالب (أيام البيع > أيام الشراء في آخر 10 أيام)
    """
    if len(closes) < 20 or len(volumes) < 20 or len(highs) < 1 or len(lows) < 1:
        return False, 'insufficient data'

    last_close = closes[-1]
    last_high = highs[-1] if highs[-1] is not None else last_close
    last_low = lows[-1] if lows[-1] is not None else last_close
    last_vol = volumes[-1]
    avg_vol_20 = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else 0
    if avg_vol_20 <= 0:
        return False, 'avg_vol_20 = 0'

    # 1. حجم اليوم > 1.5× المتوسط
    vol_ratio = last_vol / avg_vol_20
    if vol_ratio < 1.5:
        return False, f'vol {vol_ratio:.2f}× < 1.5×'

    # 2. الإغلاق في النصف السفلي
    mid = (last_high + last_low) / 2
    if mid <= 0:
        return False, 'mid range = 0'
    if last_close >= mid:
        return False, f'close {last_close:.2f} ≥ mid {mid:.2f} (upper half)'

    # 3. 3+ أيام بيع في آخر 5 أيام
    sell_days_5 = sum(1 for i in range(-5, 0) if i > -len(closes) and closes[i] < closes[i - 1])
    if sell_days_5 < 3:
        return False, f'sell_days_5 = {sell_days_5} < 3'

    # 4. أيام البيع > أيام الشراء في آخر 10 أيام
    sell_days_10 = sum(1 for i in range(-10, 0) if i > -len(closes) and closes[i] < closes[i - 1])
    buy_days_10 = 10 - sell_days_10
    if sell_days_10 <= buy_days_10:
        return False, f'sell_days_10 ({sell_days_10}) ≤ buy_days_10 ({buy_days_10})'

    reason = (
        f"توزيع قوي: حجم اليوم {vol_ratio:.2f}× المتوسط، الإغلاق {last_close:.2f}"
        f" تحت منتصف اليوم ({mid:.2f})، {sell_days_5}/5 أيام بيع."
    )
    return True, reason


def detect_x2_volume_divergence(closes, volumes):
    """X2_volume_divergence — تباعد حجمي (صعود وهمي).

    الشروط:
      1. السعر صنع قمة 20 يوم جديدة (close = max(closes[-20:]))
      2. لكن حجم اليوم < 0.7× متوسط 20 يوم (المؤسسات مش بتشتري الاختراق)
    """
    if len(closes) < 21 or len(volumes) < 20:
        return False, 'insufficient data'

    last_close = closes[-1]
    prev_20_max = max(closes[-21:-1]) if len(closes) >= 21 else max(closes[:-1])

    # 1. قمة 20 يوم جديدة
    if last_close <= prev_20_max:
        return False, f'close {last_close:.2f} ≤ 20d max {prev_20_max:.2f}'

    # 2. حجم اليوم < 0.7× المتوسط
    avg_vol_20 = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else 0
    if avg_vol_20 <= 0:
        return False, 'avg_vol_20 = 0'
    last_vol = volumes[-1]
    vol_ratio = last_vol / avg_vol_20
    if vol_ratio >= 0.7:
        return False, f'vol {vol_ratio:.2f}× ≥ 0.7× (buyers present)'

    reason = (
        f"تباعد حجمي: السعر اخترق قمة 20 يوم ({prev_20_max:.2f} → {last_close:.2f})"
        f" لكن الحجم {vol_ratio:.2f}× المتوسط — صعود وهمي بلا دعم مؤسسي."
    )
    return True, reason


def detect_x3_resistance_rejection(closes, highs, lows):
    """X3_resistance_rejection — رفض عند مقاومة (upper shadow طويلة).

    الشروط:
      1. السهم اختبر مقاومة (high >= max 20d high)
      2. أغلق > 2% تحت القمة
      3. upper shadow طويلة: (high - close) > 1.5× body
    """
    if len(closes) < 21 or len(highs) < 21 or len(lows) < 1:
        return False, 'insufficient data'

    last_close = closes[-1]
    last_high = highs[-1] if highs[-1] is not None else last_close
    # proxy open = previous close
    last_open = closes[-2] if len(closes) >= 2 else last_close

    # 1. اختبر مقاومة 20 يوم
    prev_20_high = max(highs[-21:-1]) if len(highs) >= 21 else max(highs[:-1])
    if last_high < prev_20_high:
        return False, f'high {last_high:.2f} < 20d high {prev_20_high:.2f}'

    # 2. أغلق > 2% تحت القمة
    if prev_20_high <= 0:
        return False, 'prev_20_high = 0'
    drop_pct = (prev_20_high - last_close) / prev_20_high * 100
    if drop_pct < 2.0:
        return False, f'drop from peak {drop_pct:.2f}% < 2%'

    # 3. upper shadow طويلة: (high - close) > 1.5× body
    body = abs(last_close - last_open)
    upper_shadow = last_high - max(last_close, last_open)
    if body <= 0:
        # doji — لا body محسوبة، نعتبر upper_shadow طويلة لو > 1% من السعر
        if last_close <= 0 or upper_shadow / last_close < 0.01:
            return False, 'doji without meaningful upper shadow'
    elif upper_shadow < 1.5 * body:
        return False, f'upper_shadow {upper_shadow:.2f} < 1.5× body {body:.2f}'

    reason = (
        f"رفض مقاومة: اختبر {prev_20_high:.2f} وأغلق عند {last_close:.2f}"
        f" ({drop_pct:.1f}% تحت القمة) بـ upper shadow طويلة."
    )
    return True, reason


def detect_x4_exhaustion_gap(closes, volumes, opens=None):
    """X4_exhaustion_gap — فجوة إرهاق بعد صعود طويل.

    الشروط:
      1. السهم صعد > 15% في آخر 5 أيام
      2. اليوم ده فجوة صاعدة (open > prev close)
      3. لكن الإغلاق أحمر (close < open)
      4. الحجم متناقص آخر يومين (volumes[-1] < volumes[-2] < volumes[-3])

    opens: قائمة بأسعار الافتتاح. لو None → بنستخدم proxy = closes[-2]
    (نفس convention بتاع maker_radar).
    """
    if len(closes) < 7 or len(volumes) < 7:
        return False, 'insufficient data'

    # 1. صعود > 15% في آخر 5 أيام
    if closes[-6] <= 0:
        return False, 'closes[-6] = 0'
    rally_pct = (closes[-1] - closes[-6]) / closes[-6] * 100
    if rally_pct < 15.0:
        return False, f'rally_5d {rally_pct:.1f}% < 15%'

    # 2. فجوة صاعدة: open > prev close
    last_open = opens[-1] if opens and len(opens) > 0 and opens[-1] else closes[-2]
    last_close = closes[-1]
    prev_close = closes[-2] if len(closes) >= 2 else last_close
    if last_open <= prev_close:
        return False, f'no gap up (open {last_open:.2f} ≤ prev_close {prev_close:.2f})'

    # 3. الإغلاق أحمر: close < open
    if last_close >= last_open:
        return False, f'close {last_close:.2f} ≥ open {last_open:.2f} (not red)'

    # 4. الحجم متناقص آخر يومين
    if len(volumes) < 3:
        return False, 'insufficient volume history'
    if not (volumes[-1] < volumes[-2] and volumes[-2] < volumes[-3]):
        return False, 'volume not declining last 2 days'

    reason = (
        f"فجوة إرهاق: صعد {rally_pct:.1f}% في 5 أيام، فجوة صاعدة (open {last_open:.2f}"
        f" > prev close {prev_close:.2f}) ثم أغلق أحمر مع تناقص حجمي."
    )
    return True, reason


def detect_x5_kill_switch(closes, volumes, highs, lows):
    """X5_kill_switch_triggered — Kill Switch (Limit Up Trap / توزيع قاتل).

    يستخدم shared_liquidity.check_kill_switch لو متاح (نفس منطق maker_radar).
    Falls back to a local limit-up detector لو shared_liquidity مش موجود.
    """
    if not closes or len(closes) < 2:
        return False, 'insufficient data'

    if _HAS_SHARED_LIQUIDITY:
        try:
            triggered, reason = check_kill_switch(closes, volumes, highs, lows)
            if triggered:
                return True, reason or 'Kill Switch triggered'
            return False, 'kill switch not triggered'
        except Exception as e:
            # Fall through to local detector on any error.
            pass

    # Local fallback: limit up trap (close > prev_close * 1.095)
    last_close = closes[-1]
    prev_close = closes[-2]
    if prev_close <= 0:
        return False, 'prev_close = 0'
    daily_change = ((last_close - prev_close) / prev_close) * 100
    if daily_change > 9.5:
        return True, f'Limit Up Trap — صعد {daily_change:.1f}% في يوم'
    return False, f'daily_change {daily_change:.1f}% (no kill switch)'


def scan_ticker(rows, ticker):
    """يفحص سهم واحد على الـ 5 مسارات خروج. يرجع dict أو None."""
    if not rows or len(rows) < 20:
        return None

    closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
    volumes = [parse_volume(r['volume']) for r in rows]
    highs = [r['high'] or r['close'] for r in rows]
    lows = [r['low'] or r['close'] for r in rows]
    opens = [r['open'] or r['close'] for r in rows]  # X4 needs open prices

    if len(closes) < 20 or len(volumes) < 20:
        return None

    current_price = closes[-1]
    avg_vol_20 = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else 0
    last_vol = volumes[-1]
    vol_ratio = (last_vol / avg_vol_20) if avg_vol_20 > 0 else 0

    # 5-day rally for context (used in X4 reason)
    rally_5d_pct = (
        round((closes[-1] - closes[-6]) / closes[-6] * 100, 2)
        if len(closes) >= 6 and closes[-6] > 0 else None
    )

    paths = []
    # X1 — توزيع قوي
    triggered, reason = detect_x1_distribution_strong(closes, volumes, highs, lows)
    if triggered:
        paths.append({
            'path': 'X1_distribution_strong',
            'reason': reason,
        })

    # X2 — تباعد حجمي
    triggered, reason = detect_x2_volume_divergence(closes, volumes)
    if triggered:
        paths.append({
            'path': 'X2_volume_divergence',
            'reason': reason,
        })

    # X3 — رفض مقاومة
    triggered, reason = detect_x3_resistance_rejection(closes, highs, lows)
    if triggered:
        paths.append({
            'path': 'X3_resistance_rejection',
            'reason': reason,
        })

    # X4 — فجوة إرهاق (passes opens for accurate gap detection)
    triggered, reason = detect_x4_exhaustion_gap(closes, volumes, opens)
    if triggered:
        paths.append({
            'path': 'X4_exhaustion_gap',
            'reason': reason,
        })

    # X5 — Kill Switch
    triggered, reason = detect_x5_kill_switch(closes, volumes, highs, lows)
    if triggered:
        paths.append({
            'path': 'X5_kill_switch_triggered',
            'reason': reason,
        })

    if not paths:
        return None

    # Use highest-priority path as the headline (X5 > X1 > X4 > X3 > X2)
    priority = {
        'X5_kill_switch_triggered': 5,
        'X1_distribution_strong': 4,
        'X4_exhaustion_gap': 3,
        'X3_resistance_rejection': 2,
        'X2_volume_divergence': 1,
    }
    paths.sort(key=lambda p: -priority.get(p['path'], 0))
    headline = paths[0]

    return {
        'ticker': ticker,
        'current_price': round(current_price, 2),
        'avg_volume_20d': round(avg_vol_20, 0),
        'volume_ratio_today': round(vol_ratio, 2),
        'rally_5d_pct': rally_5d_pct,
        'path': headline['path'],  # highest-priority path (for downstream dedup)
        'reason': headline['reason'],
        'all_paths': [p['path'] for p in paths],
        'path_details': paths,
    }


def main():
    parser = argparse.ArgumentParser(description='رادار الخروج')
    parser.add_argument('--limit', type=int, default=0, help='0 = كل الأسهم')
    parser.add_argument('--market', type=str, default='EGX', help='سوق (EGX, TADAWUL, KSE, QSE, ALL, CRYPTO, GOLD)')
    parser.add_argument('--min-price', type=float, default=1.0, help='استبعاد الأسهم تحت ده السعر')
    parser.add_argument('--json-only', action='store_true', help='JSON فقط بدون تقرير نصي')
    args = parser.parse_args()

    log("═══ رادار الخروج (Exit Radar) ═══")
    log(f"  DB: {PROD_DB}")
    log(f"  Market filter: {args.market}")
    log(f"  Min price: {args.min_price}")
    log(f"  shared_liquidity available: {_HAS_SHARED_LIQUIDITY}")

    if not PROD_DB or not PROD_DB.exists():
        log("⚠️ مفيش DB متاح — حفظ JSON فاضي عشان الـ API ما يبقاش 503.")
        log("   - sandbox: شغّل scripts/fetch_production_data.py")
        log("   - production: تأكد إن db/stocks.db أو db/data_engine.db موجود")
        # Write an empty JSON file so the exit-radar API endpoint returns 200
        # (with empty exit_list) instead of 503 warming-up. This keeps the UI
        # functional on first deploy before the cron has run.
        today_str = datetime.now().strftime("%Y%m%d")
        json_path = OUTPUT_DIR / f"exit_radar_{today_str}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({
                'generated_at': datetime.now().isoformat(),
                'market': args.market,
                'min_price': args.min_price,
                'db_source': None,
                'db_file': None,
                'db_table': None,
                'total_scanned': 0,
                'exit_count': 0,
                'x1_distribution_strong_count': 0,
                'x2_volume_divergence_count': 0,
                'x3_resistance_rejection_count': 0,
                'x4_exhaustion_gap_count': 0,
                'x5_kill_switch_triggered_count': 0,
                'exit_list': [],
                'x1_distribution_strong': [],
                'x2_volume_divergence': [],
                'x3_resistance_rejection': [],
                'x4_exhaustion_gap': [],
                'x5_kill_switch_triggered': [],
                'warning': 'No DB available — exit radar produced no signals. Run on production VPS to populate.',
            }, f, ensure_ascii=False, indent=2)
        log(f"✅ Empty JSON saved: {json_path}")
        return 0

    log(f"  DB: {PROD_DB.name} (table: {PROD_TABLE})")
    log(f"  DB source id: {DB_SOURCE_ID}")

    conn = sqlite3.connect(str(PROD_DB))
    conn.row_factory = sqlite3.Row

    # فلتر السوق (نفس منطق maker_radar.py)
    has_stocks_table = bool(conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
    ).fetchone())

    # CRYPTO / GOLD fallback: لو السوق ده ومفيش stocks table entries ليه،
    # نجرب فلتر الـ ticker بـ prefix (مثلاً BTC, ETH, XAU, etc.).
    # ده يشتغل بس لو data_engine.db.historical_data موجود.
    market_variants = {
        'EGX': ['EGX', 'مصر'],
        'TADAWUL': ['TADAWUL', 'السعودية'],
        'KSE': ['KSE', 'الكويت'],
        'QSE': ['QSE', 'قطر'],
        # CRYPTO + GOLD ما عندهاش variants في الـ stocks table — بنعتمد على
        # الـ ticker prefix filtering في حقل symbol (مثلاً BTCUSDT, XAUUSD).
        'CRYPTO': ['CRYPTO'],
        'GOLD': ['GOLD'],
    }

    if args.market.upper() == 'ALL' or not has_stocks_table:
        tickers = [r[0] for r in conn.execute(f"""
            SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
        """).fetchall()]
    else:
        market_values = market_variants.get(args.market.upper(), [args.market.upper()])
        placeholders = ','.join(['?' for _ in market_values])
        try:
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT p.{TICKER_COL} FROM {PROD_TABLE} p
                JOIN stocks s ON p.{TICKER_COL} = s.symbol
                WHERE s.market IN ({placeholders})
            """, market_values).fetchall()]
        except Exception as e:
            log(f"  ⚠️ JOIN فشل ({e}) — fallback لكل الأسهم")
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
            """).fetchall()]

    if args.limit > 0:
        tickers = tickers[: args.limit]
    log(f"  فحص {len(tickers)} سهم (market={args.market})...")

    exit_list = []
    for i, ticker in enumerate(tickers, 1):
        rows = fetch_ticker_series(conn, ticker, days=30)
        result = scan_ticker(rows, ticker)
        if result and result['current_price'] >= args.min_price:
            exit_list.append(result)
        if i % 100 == 0:
            log(f"    {i}/{len(tickers)} — {len(exit_list)} إشارات خروج")

    conn.close()

    # ترتيب: X5 أول (أعلى أولوية) ثم X1 ثم X4 ثم X3 ثم X2 — ثم حسب volume_ratio
    priority = {
        'X5_kill_switch_triggered': 5,
        'X1_distribution_strong': 4,
        'X4_exhaustion_gap': 3,
        'X3_resistance_rejection': 2,
        'X2_volume_divergence': 1,
    }
    exit_list.sort(key=lambda r: (-priority.get(r['path'], 0), -r.get('volume_ratio_today', 0)))

    # فصل لـ 5 قوائم
    x1_list = [r for r in exit_list if r['path'] == 'X1_distribution_strong']
    x2_list = [r for r in exit_list if r['path'] == 'X2_volume_divergence']
    x3_list = [r for r in exit_list if r['path'] == 'X3_resistance_rejection']
    x4_list = [r for r in exit_list if r['path'] == 'X4_exhaustion_gap']
    x5_list = [r for r in exit_list if r['path'] == 'X5_kill_switch_triggered']

    log(f"\n═══ النتايج (market={args.market}, price≥{args.min_price}) ═══")
    log(f"  إجمالي المفحوصين: {len(tickers)}")
    log(f"  🚪 إشارات الخروج: {len(exit_list)}")
    log(f"    🔴 X1 توزيع قوي: {len(x1_list)}")
    log(f"    ⚠️ X2 تباعد حجمي: {len(x2_list)}")
    log(f"    🚫 X3 رفض مقاومة: {len(x3_list)}")
    log(f"    😮 X4 فجوة إرهاق: {len(x4_list)}")
    log(f"    🛑 X5 Kill Switch: {len(x5_list)}")

    # عرض قصير
    if exit_list:
        log(f"\n{'#':>3} {'Ticker':10s} {'Price':>8s} {'VolRatio':>8s} {'Path':>30s}")
        log("-" * 70)
        for i, r in enumerate(exit_list[:30], 1):
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} "
                f"{r['volume_ratio_today']:>7.2f}× {r['path']:>30s}")

    # حفظ JSON
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"exit_radar_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'market': args.market,
            'min_price': args.min_price,
            'db_source': DB_SOURCE_ID,
            'db_file': PROD_DB.name if PROD_DB else None,
            'db_table': PROD_TABLE,
            'total_scanned': len(tickers),
            'exit_count': len(exit_list),
            'x1_distribution_strong_count': len(x1_list),
            'x2_volume_divergence_count': len(x2_list),
            'x3_resistance_rejection_count': len(x3_list),
            'x4_exhaustion_gap_count': len(x4_list),
            'x5_kill_switch_triggered_count': len(x5_list),
            'exit_list': exit_list,
            'x1_distribution_strong': x1_list,
            'x2_volume_divergence': x2_list,
            'x3_resistance_rejection': x3_list,
            'x4_exhaustion_gap': x4_list,
            'x5_kill_switch_triggered': x5_list,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    if args.json_only:
        return 0

    # تقرير عربي مبسّط
    report_lines = [
        f"# 🚪 رادار الخروج — {datetime.now().strftime('%Y-%m-%d')}",
        "",
        f"**إجمالي الأسهم المفحوصة:** {len(tickers)}",
        f"**🚪 إشارات الخروج:** {len(exit_list)}",
        "",
        "| المسار | العدد | الإجراء المقترح |",
        "|-------|------|----------------|",
        f"| 🔴 X1 توزيع قوي | {len(x1_list)} | بيع كامل أو تقليص قوي |",
        f"| ⚠️ X2 تباعد حجمي | {len(x2_list)} | تقليص نصف المركز + وقف مضغوط |",
        f"| 🚫 X3 رفض مقاومة | {len(x3_list)} | وقف عند آخر قاع |",
        f"| 😮 X4 فجوة إرهاق | {len(x4_list)} | بيع كامل — الاندفاع استُنفد |",
        f"| 🛑 X5 Kill Switch | {len(x5_list)} | خروج فوري |",
        "",
    ]
    md_path = OUTPUT_DIR / f"exit_radar_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))
    log(f"✅ Report saved: {md_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

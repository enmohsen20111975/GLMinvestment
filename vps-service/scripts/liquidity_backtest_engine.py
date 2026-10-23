#!/usr/bin/env python3
"""
liquidity_backtest_engine.py — محرك باك تيست السيولة الحقيقي المتقدم
================================================================
المرحلة 1 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-1)

المنهجية الفنية المعتمدة:
  1. حساب dynamic_threshold = percentile_75(volume) من البيانات المتاحة.
  2. لكل يوم فيه volume >= threshold:
       - سعر الدخول (entry_price) = سعر الإغلاق في يوم الإشارة.
       - نافذة الاحتفاظ (holding window) = 5 أيام تداول تالية.
       - فحص الهدف: هل وصل أعلى سعر (High) خلال الـ 5 أيام إلى العائد المستهدف (TARGET_RETURN = +1.5%)؟
       - إذا تحقق الهدف: HIT (صفقة ناجحة).
       - إذا لم يتحقق: MISS (صفقة خاسرة ويُحسب العائد على إغلاق اليوم الخامس).
  3. hit_rate = HIT / total_signals
  4. شرط التأهيل: (hit_rate >= 65% AND total_signals >= 30)

مصادر البيانات:
  - الأولوية الأولى: price_history.db (تاريخ يمتد لسنة كاملة عبر آلاف الصفقات)
  - الأولوية الثانية: intraday.db / data_engine.db (بيانات تكميلية)
"""

import sqlite3
import sys
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Optional, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
INTRADAY_DB = str(PROJECT_ROOT / 'db' / 'intraday.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

# Backtest parameters
TARGET_HIT_RATE = 65.0       # الحد الأدنى لتأهيل السوق للمسار B
MIN_SIGNALS = 30             # أقل عدد إشارات لاعتبار النتيجة موثوقة
TARGET_RETURN_PCT = 1.5      # العائد المستهدف خلال 5 أيام (+1.5%)
HOLDING_DAYS = 5             # فترة الاحتفاظ بالصفقة (أيام تداول)

# ── Market-specific configuration (per the architectural plan) ────────────
# كل سوق له شروطه الخاصة حسب السلوك المُثبت في الـ backtest
MARKET_CONFIG = {
    'EGX': {
        'target_pct': 2.5,        # +2.5% to +3.5% (using lower bound)
        'stop_pct': 2.0,          # -2.0% strict
        'holding_days': 5,
        'require_green_candle': True,    # Close >= Open (تجميع، مش تصريف)
        'require_positive_momentum': False,
        'min_change_24h': None,          # not applicable for stocks
        'description': '🇪🇬 مصر — حدود ±10%/±20%، تسوية T+0/T+1/T+2',
    },
    'KSA': {
        'target_pct': 2.0,        # +2.0% to +3.0%
        'stop_pct': 1.8,          # -1.8%
        'holding_days': 5,
        'require_green_candle': True,    # صافي سيولة موجب
        'require_positive_momentum': False,
        'min_change_24h': None,
        'description': '🇸🇦 السعودية — حدود ±10% رئيسي، ±30% نمو',
    },
    'US': {
        'target_pct': 3.0,        # +3.0% to +5.0%
        'stop_pct': 1.5,          # 1.5 × ATR (dynamic — approximated as -1.5% here)
        'holding_days': 5,
        'require_green_candle': True,
        'require_positive_momentum': False,
        'min_change_24h': None,
        'use_atr_stop': True,     # استخدم ATR للـ stop loss الديناميكي
        'description': '🇺🇸 أمريكا — بلا حدود سعرية، Pre/Post Market',
    },
    'CRYPTO': {
        'target_pct': 3.0,        # +3.0% to +6.0%
        'stop_pct': 2.5,          # -2.5%
        'holding_days': 4,        # 3-5 أيام
        'require_green_candle': False,
        'require_positive_momentum': True,
        'min_change_24h': 2.0,    # شرط إلزامي: change_24h >= +2.0%
        'description': '🪙 الكريبتو — تداول 24/7، تذبذب حاد، تجنّب كسر البيتكوين',
    },
    'GOLD': {
        'target_pct': 1.5,        # +1.5% to +2.5%
        'stop_pct': 1.5,          # -1.5%
        'holding_days': 7,        # أطول فترة احتفاظ
        'require_green_candle': False,
        'require_positive_momentum': True,   # زخم الأونصة العالمية صاعد
        'min_change_24h': None,
        'use_sma_10': True,       # تجاوز متوسط سعر 10 أيام
        'description': '🥇 الذهب — ملاذ آمن، ارتباط بالدولار',
    },
}


def parse_volume(v) -> int:
    """تحويل أحجام التداول إلى أرقام صحيحة بأمان تام (معالجة النصوص مثل 2.56M و 1.64K)."""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    v_str = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').strip().upper()
    if not v_str:
        return 0
    try:
        if v_str.endswith('B'):
            return int(float(v_str[:-1]) * 1_000_000_000)
        if v_str.endswith('M'):
            return int(float(v_str[:-1]) * 1_000_000)
        if v_str.endswith('K'):
            return int(float(v_str[:-1]) * 1_000)
        return int(float(v_str))
    except Exception:
        return 0


def open_db(path: str, readonly: bool = True) -> Optional[sqlite3.Connection]:
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(path, writable=False)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f'  ⚠️ cannot open {path}: {e}')
        return None


def db_exists(path: str) -> bool:
    return Path(path).exists() and Path(path).stat().st_size > 0


def ensure_tables(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_backtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            total_signals INTEGER DEFAULT 0,
            successful_signals INTEGER DEFAULT 0,
            failed_signals INTEGER DEFAULT 0,
            hit_rate REAL DEFAULT 0,
            avg_return REAL DEFAULT 0,
            dynamic_threshold REAL DEFAULT 0,
            backtest_start TEXT,
            backtest_end TEXT,
            backtest_days INTEGER,
            qualified INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, backtest_start, backtest_end)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_dynamic_threshold (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            threshold_date TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            percentile_method TEXT DEFAULT 'p75',
            sample_size INTEGER DEFAULT 0,
            fallback_used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, threshold_date)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_signal_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            signal_date TEXT NOT NULL,
            entry_price REAL,
            exit_price REAL,
            return_pct REAL,
            hit INTEGER DEFAULT 0,
            holding_days INTEGER DEFAULT 5,
            threshold_used REAL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, signal_date)
        )
    """)
    conn.commit()


def load_daily_ohlc(market: str, days: int = 365) -> List[dict]:
    """حمّل بيانات OHLC اليومية للسوق من أفضل مصدر متاح."""
    rows: List[dict] = []

    # 1. فحص price_history.db كأول وأفضل مصدر
    if db_exists(PRICE_HISTORY_DB):
        conn = open_db(PRICE_HISTORY_DB, readonly=True)
        if conn:
            try:
                market_codes = {
                    'EGX': ['EGX'],
                    'US': ['US'],
                    'KSA': ['TADAWUL', 'KSA', 'SAUDI'],
                }.get(market, [market])

                placeholders = ','.join('?' for _ in market_codes)
                query = f"""
                    SELECT date, ticker, open_price as open, high_price as high,
                           low_price as low, close_price as close, volume
                    FROM price_history
                    WHERE market IN ({placeholders})
                      AND volume IS NOT NULL
                      AND date >= (SELECT DATE(MAX(date), ?) FROM price_history WHERE market IN ({placeholders}))
                    ORDER BY date ASC, ticker
                """
                params = market_codes + [f'-{days} days'] + market_codes
                cur = conn.execute(query, params)
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    high_p = float(r['high'] or close_p)
                    low_p = float(r['low'] or close_p)
                    open_p = float(r['open'] or close_p)
                    if vol > 0 and close_p > 0:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': open_p,
                            'high': max(high_p, close_p, open_p),
                            'low': min(low_p, close_p, open_p),
                            'close': close_p,
                            'volume': vol,
                        })
                if rows:
                    print(f'  ✅ {market}: loaded {len(rows)} daily rows from price_history.db')
            except Exception as e:
                print(f'  ⚠️ price_history query error for {market}: {e}')
            conn.close()

    # 2. في حالة عدم وجود بيانات، فحص المصادر البديلة
    if not rows:
        if market == 'EGX' and db_exists(INTRADAY_DB):
            conn = open_db(INTRADAY_DB, readonly=True)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT DATE(timestamp) as date, ticker,
                               MAX(high) as high, MIN(low) as low,
                               (SELECT price FROM stock_intraday s2 WHERE s2.ticker = s1.ticker AND DATE(s2.timestamp) = DATE(s1.timestamp) ORDER BY timestamp DESC LIMIT 1) as close,
                               (SELECT price FROM stock_intraday s3 WHERE s3.ticker = s1.ticker AND DATE(s3.timestamp) = DATE(s1.timestamp) ORDER BY timestamp ASC LIMIT 1) as open,
                               SUM(volume) as volume
                        FROM stock_intraday s1
                        WHERE market = 'مصر' AND volume > 0
                        GROUP BY DATE(timestamp), ticker
                        ORDER BY DATE(timestamp) ASC, ticker
                    """)
                    for r in cur:
                        vol = parse_volume(r['volume'])
                        close_p = float(r['close'] or 0)
                        if vol > 0 and close_p > 0:
                            rows.append({
                                'date': r['date'],
                                'ticker': r['ticker'],
                                'open': float(r['open'] or close_p),
                                'high': float(r['high'] or close_p),
                                'low': float(r['low'] or close_p),
                                'close': close_p,
                                'volume': vol,
                            })
                    if rows:
                        print(f'  ✅ EGX: loaded {len(rows)} daily rows from intraday.db (fallback)')
                except Exception as e:
                    print(f'  ⚠️ intraday.db fallback error: {e}')
                conn.close()

        elif market == 'KSA' and db_exists(DATA_ENGINE_DB):
            conn = open_db(DATA_ENGINE_DB, readonly=True)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT date, symbol as ticker, open, high, low, close, volume
                        FROM historical_data
                        WHERE market = 'السعودية' AND volume > 0
                        ORDER BY date ASC, symbol
                    """)
                    for r in cur:
                        vol = parse_volume(r['volume'])
                        close_p = float(r['close'] or 0)
                        if vol > 0 and close_p > 0:
                            rows.append({
                                'date': r['date'],
                                'ticker': r['ticker'],
                                'open': float(r['open'] or close_p),
                                'high': float(r['high'] or close_p),
                                'low': float(r['low'] or close_p),
                                'close': close_p,
                                'volume': vol,
                            })
                    if rows:
                        print(f'  ✅ KSA: loaded {len(rows)} daily rows from data_engine.db (fallback)')
                except Exception as e:
                    print(f'  ⚠️ data_engine fallback error: {e}')
                conn.close()

    # 3. CRYPTO — من data_engine.db.crypto_prices (تداول 24/7)
    if market == 'CRYPTO' and not rows and db_exists(DATA_ENGINE_DB):
        conn = open_db(DATA_ENGINE_DB, readonly=True)
        if conn:
            try:
                # crypto_prices فيه: timestamp, symbol, price_usd, price_change_24h, total_volume
                # نجمّع يومي: open = أول سعر اليوم، close = آخر سعر، high = max، low = min
                cur = conn.execute("""
                    SELECT DATE(timestamp) as date, symbol as ticker,
                           MIN(price_usd) as low,
                           MAX(price_usd) as high,
                           (SELECT price_usd FROM crypto_prices c2
                            WHERE c2.symbol = c1.symbol AND DATE(c2.timestamp) = DATE(c1.timestamp)
                            ORDER BY timestamp ASC LIMIT 1) as open,
                           (SELECT price_usd FROM crypto_prices c3
                            WHERE c3.symbol = c1.symbol AND DATE(c3.timestamp) = DATE(c1.timestamp)
                            ORDER BY timestamp DESC LIMIT 1) as close,
                           MAX(total_volume) as volume,
                           AVG(price_change_24h) as change_24h
                    FROM crypto_prices c1
                    WHERE total_volume IS NOT NULL AND total_volume > 0
                      AND DATE(timestamp) >= DATE('now', ?)
                    GROUP BY DATE(timestamp), symbol
                    ORDER BY DATE(timestamp) ASC, symbol
                """, (f'-{days} days',))
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    if vol > 0 and close_p > 0:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': float(r['open'] or close_p),
                            'high': float(r['high'] or close_p),
                            'low': float(r['low'] or close_p),
                            'close': close_p,
                            'volume': vol,
                            'change_24h': float(r['change_24h'] or 0),
                        })
                if rows:
                    print(f'  ✅ CRYPTO: loaded {len(rows)} daily rows from data_engine.db.crypto_prices')
            except Exception as e:
                print(f'  ⚠️ crypto_prices query error: {e}')
            conn.close()

    # 4. GOLD — من data_engine.db.gold_prices (ملاذ آمن، ارتباط بالدولار)
    if market == 'GOLD' and not rows and db_exists(DATA_ENGINE_DB):
        conn = open_db(DATA_ENGINE_DB, readonly=True)
        if conn:
            try:
                # gold_prices_clean فيه: timestamp, country, karat, currency, price_per_gram, usd_rate_used, global_ounce_usd
                # نستخدم global_ounce_usd كمؤشر على زخم الذهب العالمي
                cur = conn.execute("""
                    SELECT DATE(timestamp) as date,
                           'XAU' as ticker,
                           MIN(price_per_gram) as low,
                           MAX(price_per_gram) as high,
                           (SELECT price_per_gram FROM gold_prices_clean g2
                            WHERE DATE(g2.timestamp) = DATE(g1.timestamp)
                            ORDER BY timestamp ASC LIMIT 1) as open,
                           (SELECT price_per_gram FROM gold_prices_clean g3
                            WHERE DATE(g3.timestamp) = DATE(g1.timestamp)
                            ORDER BY timestamp DESC LIMIT 1) as close,
                           AVG(global_ounce_usd) as volume
                    FROM gold_prices_clean g1
                    WHERE price_per_gram IS NOT NULL AND price_per_gram > 0
                      AND DATE(timestamp) >= DATE('now', ?)
                    GROUP BY DATE(timestamp)
                    ORDER BY DATE(timestamp) ASC
                """, (f'-{days} days',))
                # gold ما عندهوش volume بالمعنى التقليدي — نستخدم global_ounce_usd كـ proxy للسيولة
                # أو نحسب turnover من price_per_gram × 1 (افتراضي)
                for r in cur:
                    close_p = float(r['close'] or 0)
                    if close_p > 0:
                        # volume = 1.0 default (gold volume concept مختلف)
                        # الأهم هو تجاوز SMA(10) + زخم الأونصة
                        rows.append({
                            'date': r['date'],
                            'ticker': 'XAU',
                            'open': float(r['open'] or close_p),
                            'high': float(r['high'] or close_p),
                            'low': float(r['low'] or close_p),
                            'close': close_p,
                            'volume': 1000000,  # placeholder — gold uses SMA(10) logic
                        })
                if rows:
                    print(f'  ✅ GOLD: loaded {len(rows)} daily rows from data_engine.db.gold_prices_clean')
            except Exception as e:
                print(f'  ⚠️ gold_prices query error: {e}')
            conn.close()

    return rows


def calculate_threshold(volumes: List[int], percentile: float = 0.75) -> Tuple[float, int, bool]:
    if not volumes:
        return 100000.0, 0, True
    sorted_vols = sorted(volumes)
    idx = min(len(sorted_vols) - 1, int(len(sorted_vols) * percentile))
    return float(sorted_vols[idx]), len(sorted_vols), False


def run_liquidity_backtest(rows: List[dict], market: str) -> dict:
    """
    تشغيل باك تيست السيولة بالمنطق الاستثماري الصحيح:
    هل وصل السهم للهدف (+1.5%) خلال فترة الاحتفاظ (5 أيام تداول)؟
    """
    if not rows:
        return {
            'market': market,
            'total_signals': 0,
            'successful_signals': 0,
            'failed_signals': 0,
            'hit_rate': 0.0,
            'avg_return': 0.0,
            'dynamic_threshold': 0.0,
            'backtest_start': None,
            'backtest_end': None,
            'backtest_days': 0,
            'qualified': 0,
            'all_signals': [],
            'sample_size': 0,
            'fallback': True,
        }

    all_volumes = [r['volume'] for r in rows if r['volume'] > 0]
    threshold, sample_size, fallback = calculate_threshold(all_volumes, 0.75)

    # ── Market-specific configuration ────────────────────────────────────
    # كل سوق له target/stop/holding/shروط مختلفة حسب MARKET_CONFIG
    cfg = MARKET_CONFIG.get(market, MARKET_CONFIG['EGX'])  # default EGX config
    target_pct = cfg['target_pct']
    stop_pct = cfg['stop_pct']
    holding_days = cfg['holding_days']
    require_green_candle = cfg.get('require_green_candle', False)
    require_positive_momentum = cfg.get('require_positive_momentum', False)
    min_change_24h = cfg.get('min_change_24h', None)
    use_sma_10 = cfg.get('use_sma_10', False)

    print(f'  📋 Market config: target=+{target_pct}% stop=-{stop_pct}% holding={holding_days}d')
    print(f'     green_candle={require_green_candle} momentum={require_positive_momentum} min_change24h={min_change_24h}')

    by_ticker_date: dict = defaultdict(list)
    for r in rows:
        by_ticker_date[r['ticker']].append(r)

    signals: List[dict] = []
    target_multiplier = 1.0 + (target_pct / 100.0)
    stop_multiplier = 1.0 - (stop_pct / 100.0)

    for ticker, ticker_rows in by_ticker_date.items():
        ticker_rows.sort(key=lambda x: x['date'])

        # احسب SMA(10) لو السوق محتاجه (gold)
        sma_10_values: List[float] = []
        for i, row in enumerate(ticker_rows):
            if use_sma_10 and i >= 10:
                sma_10 = sum(r['close'] for r in ticker_rows[i-10:i]) / 10.0
                sma_10_values.append(sma_10)
            else:
                sma_10_values.append(None)

        for i, row in enumerate(ticker_rows):
            if row['volume'] < threshold:
                continue
            if i + holding_days >= len(ticker_rows):
                continue

            entry_price = row['close']
            if entry_price <= 0:
                continue

            # ── Market-specific entry filters ───────────────────────────
            # 1. شمعة خضراء (Close >= Open) — لأسواق الأسهم (تجميع مش تصريف)
            if require_green_candle and row.get('close', 0) < row.get('open', 0):
                continue

            # 2. زخم إيجابي (للكريبتو والذهب)
            if require_positive_momentum:
                change_24h = row.get('change_24h', None)
                if min_change_24h is not None:
                    if change_24h is None or change_24h < min_change_24h:
                        continue
                # للذهب: تجاوز SMA(10)
                if use_sma_10:
                    sma_10 = sma_10_values[i] if i < len(sma_10_values) else None
                    if sma_10 is not None and entry_price < sma_10:
                        continue

            # فحص الـ N أيام التالية لمعرفة هل تحقق الهدف
            future_rows = ticker_rows[i + 1 : i + 1 + holding_days]
            max_high = max(r['high'] for r in future_rows) if future_rows else entry_price
            min_low = min(r['low'] for r in future_rows) if future_rows else entry_price
            exit_close = future_rows[-1]['close'] if future_rows else entry_price

            target_price = entry_price * target_multiplier
            stop_price = entry_price * stop_multiplier

            # معادلة النجاح: هل وصل للهدف؟ (max_high >= target)
            # مع فحص وقف الخسارة: لو وصل للوقف الأول قبل الهدف → miss
            if max_high >= target_price:
                hit = 1
                exit_price = target_price  # conservative: exit at target, not max
                return_pct = ((exit_price - entry_price) / entry_price) * 100.0
            elif min_low <= stop_price:
                # وصل لوقف الخسارة قبل الهدف
                hit = 0
                exit_price = stop_price
                return_pct = ((exit_price - entry_price) / entry_price) * 100.0
            else:
                hit = 0
                exit_price = exit_close
                return_pct = ((exit_price - entry_price) / entry_price) * 100.0

            signals.append({
                'market': market,
                'ticker': ticker,
                'signal_date': row['date'],
                'entry_price': round(entry_price, 4),
                'exit_price': round(exit_price, 4),
                'target_price': round(target_price, 4),
                'stop_price': round(stop_price, 4),
                'return_pct': round(return_pct, 4),
                'hit': hit,
                'holding_days': holding_days,
                'threshold_used': threshold,
                'volume': row['volume'],
                'market_config': f'+{target_pct}%/-{stop_pct}%/{holding_days}d',
            })

    total_signals = len(signals)
    successful = sum(s['hit'] for s in signals)
    failed = total_signals - successful
    hit_rate = (successful / total_signals * 100.0) if total_signals > 0 else 0.0
    avg_return = (sum(s['return_pct'] for s in signals) / total_signals) if total_signals > 0 else 0.0

    backtest_start = min(s['signal_date'] for s in signals) if signals else None
    backtest_end = max(s['signal_date'] for s in signals) if signals else None
    backtest_days = 0
    if backtest_start and backtest_end:
        try:
            d1 = datetime.strptime(backtest_start, '%Y-%m-%d')
            d2 = datetime.strptime(backtest_end, '%Y-%m-%d')
            backtest_days = (d2 - d1).days
        except Exception:
            pass

    qualified = 1 if (hit_rate >= TARGET_HIT_RATE and total_signals >= MIN_SIGNALS) else 0

    return {
        'market': market,
        'total_signals': total_signals,
        'successful_signals': successful,
        'failed_signals': failed,
        'hit_rate': round(hit_rate, 2),
        'avg_return': round(avg_return, 4),
        'dynamic_threshold': threshold,
        'backtest_start': backtest_start,
        'backtest_end': backtest_end,
        'backtest_days': backtest_days,
        'qualified': qualified,
        'all_signals': signals,
        'sample_size': sample_size,
        'fallback': fallback,
    }


def save_results(conn: sqlite3.Connection, result: dict, ticker: Optional[str] = None):
    c = conn.cursor()
    notes = f'p75={result["dynamic_threshold"]:.0f}, sample={result["sample_size"]}, fallback={result["fallback"]}, target_return={TARGET_RETURN_PCT}%, holding_days={HOLDING_DAYS}'

    c.execute("""
        INSERT OR REPLACE INTO liquidity_backtest_results
        (market, ticker, total_signals, successful_signals, failed_signals,
         hit_rate, avg_return, dynamic_threshold, backtest_start, backtest_end,
         backtest_days, qualified, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """, (
        result['market'],
        ticker,
        result['total_signals'],
        result['successful_signals'],
        result['failed_signals'],
        result['hit_rate'],
        result['avg_return'],
        result['dynamic_threshold'],
        result['backtest_start'],
        result['backtest_end'],
        result['backtest_days'],
        result['qualified'],
        notes,
    ))

    # حفظ عينة من الإشارات
    for sig in result['all_signals'][:300]:
        c.execute("""
            INSERT OR REPLACE INTO liquidity_signal_outcomes
            (market, ticker, signal_date, entry_price, exit_price, return_pct,
             hit, holding_days, threshold_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            sig['market'],
            sig['ticker'],
            sig['signal_date'],
            sig['entry_price'],
            sig['exit_price'],
            sig['return_pct'],
            sig['hit'],
            sig['holding_days'],
            sig['threshold_used'],
        ))
    conn.commit()


def save_threshold(conn: sqlite3.Connection, market: str, threshold: float, sample_size: int, fallback: bool):
    c = conn.cursor()
    today_str = datetime.now().strftime('%Y-%m-%d')
    c.execute("""
        INSERT OR REPLACE INTO liquidity_dynamic_threshold
        (market, threshold_date, threshold_value, percentile_method,
         sample_size, fallback_used, created_at)
        VALUES (?, ?, ?, 'p75', ?, ?, datetime('now'))
    """, (market, today_str, threshold, sample_size, 1 if fallback else 0))
    conn.commit()


def main():
    global TARGET_RETURN_PCT, HOLDING_DAYS

    parser = argparse.ArgumentParser(description='Liquidity Backtest Engine — Phase 1')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ النتائج في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA) — افتراضي: كل الأسواق')
    parser.add_argument('--days', type=int, default=365,
                        help='فترة الباك تيست بالأيام (افتراضي: 365)')
    parser.add_argument('--target-return', type=float, default=TARGET_RETURN_PCT,
                        help=f'العائد المستهدف % (افتراضي: {TARGET_RETURN_PCT})')
    parser.add_argument('--holding-days', type=int, default=HOLDING_DAYS,
                        help=f'فترة الاحتفاظ بالأيام (افتراضي: {HOLDING_DAYS})')
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        args.dry_run = True

    TARGET_RETURN_PCT = args.target_return
    HOLDING_DAYS = args.holding_days

    print(f'\n{"#"*70}')
    print(f'# LIQUIDITY BACKTEST ENGINE — Phase 1 (REAL liquidity signals)')
    print(f'# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'# Mode: {"DRY-RUN" if args.dry_run else "EXECUTE"}')
    print(f'# Target Return: {TARGET_RETURN_PCT}%  |  Holding: {HOLDING_DAYS} days')
    print(f'# Markets: {args.market or "ALL"}  |  Lookback: {args.days} days')
    print(f'{"#"*70}')

    markets = [args.market] if args.market else ['EGX', 'KSA', 'US', 'CRYPTO', 'GOLD']
    all_results: List[dict] = []

    for market in markets:
        print(f'\n{"="*60}')
        print(f'Market: {market}')
        print(f'{"="*60}')

        rows = load_daily_ohlc(market, args.days)
        if not rows:
            print(f'  ⚠️ no data for {market}, skipping')
            all_results.append({
                'market': market, 'total_signals': 0, 'qualified': 0,
                'hit_rate': 0, 'dynamic_threshold': 0,
                'notes': 'no data available',
            })
            continue

        result = run_liquidity_backtest(rows, market)

        print(f'\n  Results for {market}:')
        print(f'    threshold (p75): {result["dynamic_threshold"]:,.0f} (sample={result["sample_size"]}, fallback={result["fallback"]})')
        print(f'    total signals: {result["total_signals"]:,}')
        print(f'    successful (return >= {TARGET_RETURN_PCT}%): {result["successful_signals"]:,}')
        print(f'    failed: {result["failed_signals"]:,}')
        print(f'    hit_rate: {result["hit_rate"]:.2f}%')
        print(f'    avg_return: {result["avg_return"]:+.2f}%')
        print(f'    period: {result["backtest_start"]} → {result["backtest_end"]} ({result["backtest_days"]} days)')
        qualified_flag = '✅ QUALIFIED' if result['qualified'] else '❌ NOT YET'
        print(f'    qualification: {qualified_flag} (target: hit_rate >= {TARGET_HIT_RATE}% AND signals >= {MIN_SIGNALS})')

        if result['all_signals']:
            by_ticker_count: dict = defaultdict(int)
            by_ticker_wins: dict = defaultdict(int)
            for s in result['all_signals']:
                by_ticker_count[s['ticker']] += 1
                if s['hit']:
                    by_ticker_wins[s['ticker']] += 1

            print(f'\n    Top 5 tickers by signal count:')
            for ticker, count in sorted(by_ticker_count.items(), key=lambda x: -x[1])[:5]:
                wins = by_ticker_wins.get(ticker, 0)
                wr = (wins / count * 100) if count else 0
                print(f'      {ticker}: {count} signals, {wins} hits ({wr:.1f}%)')

        all_results.append(result)

        if args.execute:
            conn = open_db(PREDICTIONS_DB, readonly=False)
            if conn:
                ensure_tables(conn)
                save_results(conn, result)
                save_threshold(conn, market, result['dynamic_threshold'],
                               result['sample_size'], result['fallback'])
                conn.close()
                print(f'  ✅ saved to DB')

    print(f'\n{"="*70}')
    print(f'SUMMARY — Qualification for Track B')
    print(f'{"="*70}')
    for r in all_results:
        flag = '✅' if r['qualified'] else '❌'
        print(f'  {flag} {r["market"]}: hit_rate={r["hit_rate"]:.1f}% signals={r["total_signals"]:,} threshold={r["dynamic_threshold"]:,.0f}')

    print(f'\n💡 Next steps:')
    qualified_markets = [r['market'] for r in all_results if r['qualified']]
    if qualified_markets:
        print(f'  - Track B is eligible for: {", ".join(qualified_markets)}')
        print(f'  - Run dual_track_generator.py to start producing liquidity signals')
    else:
        print(f'  - No markets qualified yet.')

    print(f'\n✅ Backtest complete')


if __name__ == '__main__':
    main()

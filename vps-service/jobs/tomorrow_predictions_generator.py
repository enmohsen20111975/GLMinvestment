#!/usr/bin/env python3
"""
tomorrow_predictions_generator.py
=================================
سكربت توليد توقعات الغد — بيتشغل بعد إغلاق السوق (cron job).

المطلوب من المستخدم:
1. التوقعات بالأسهم اللي العميل يشتريها أو يبيعها
2. حالة الأسهم اللي كانت معانا وصلت لفين وإيه المتوقع ليها
3. التغيرات اللي حصلت — أسهم تحت المراقبة ممكن تعمل شغل حلو

السكربت بيعمل 3 حاجات:
1. يولد توقعات جديدة لكل أسهم EGX (MaestroOrchestrator.analyze)
2. يحدث حالة التوقعات النشطة (daily_closer)
3. يحدد أسهم تحت المراقبة (top movers + volume surge)

التشغيل:
  python vps-service/jobs/tomorrow_predictions_generator.py
  python vps-service/jobs/tomorrow_predictions_generator.py --dry-run
  python vps-service/jobs/tomorrow_predictions_generator.py --market CRYPTO

Cron job (بعد إغلاق السوق المصري):
  # كل يوم ساعة 3 عصراً (بعد إغلاق EGX بنصف ساعة)
  0 15 * * 1-5 cd /path/to/project && python vps-service/jobs/tomorrow_predictions_generator.py >> logs/tomorrow_predictions.log 2>&1
"""

import sys
import os
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

# إضافة المسارات
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

# ─── Configuration ───────────────────────────────────────────────────────────
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

TOMORROW_PREDICTIONS_TABLE = 'tomorrow_predictions'
WATCHLIST_TABLE = 'tomorrow_watchlist'
ACTIVE_STATUS_TABLE = 'tomorrow_active_status'

MAX_PREDICTIONS = 10  # حد أقصى توقعات لكل يوم
MAX_WATCHLIST = 15    # حد أقصى أسهم تحت المراقبة


def init_db():
    """إنشاء الجداول لو مش موجودة."""
    conn = sqlite3.connect(str(PREDICTIONS_DB))
    c = conn.cursor()

    # جدول توقعات الغد (الجزء 1: توقعات شراء/بيع)
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS {TOMORROW_PREDICTIONS_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            market TEXT DEFAULT 'EGX',
            signal TEXT NOT NULL,
            signal_type TEXT,
            entry_price REAL NOT NULL,
            target_price REAL,
            stop_loss REAL,
            master_score REAL,
            technical_score REAL,
            confidence REAL,
            r_multiple REAL,
            risk_reward_ratio REAL,
            prediction_date TEXT NOT NULL,
            target_date TEXT,
            session_date TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            reason TEXT,
            indicators_json TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, session_date)
        )
    ''')

    # جدول الأسهم تحت المراقبة (الجزء 3: التغيرات)
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS {WATCHLIST_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            market TEXT DEFAULT 'EGX',
            watch_type TEXT NOT NULL,
            watch_reason TEXT,
            current_price REAL,
            change_percent REAL,
            volume REAL,
            volume_surge REAL,
            rsi REAL,
            ma_50 REAL,
            distance_from_ma50 REAL,
            near_52w_high REAL,
            near_52w_low REAL,
            session_date TEXT NOT NULL,
            priority TEXT DEFAULT 'MEDIUM',
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, session_date, watch_type)
        )
    ''')

    # جدول حالة الأسهم النشطة (الجزء 2: حالة الأسهم اللي كانت معانا)
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS {ACTIVE_STATUS_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            market TEXT DEFAULT 'EGX',
            original_signal TEXT,
            original_entry_price REAL,
            original_target_price REAL,
            original_stop_loss REAL,
            original_prediction_date TEXT,
            current_price REAL,
            current_change_percent REAL,
            highest_price_reached REAL,
            lowest_price_reached REAL,
            progress_percent REAL,
            distance_to_target REAL,
            distance_to_stop REAL,
            status TEXT,
            expected_action TEXT,
            session_date TEXT NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, session_date)
        )
    ''')

    # indexes
    c.execute(f'CREATE INDEX IF NOT EXISTS idx_{TOMORROW_PREDICTIONS_TABLE}_date ON {TOMORROW_PREDICTIONS_TABLE}(session_date)')
    c.execute(f'CREATE INDEX IF NOT EXISTS idx_{WATCHLIST_TABLE}_date ON {WATCHLIST_TABLE}(session_date)')
    c.execute(f'CREATE INDEX IF NOT EXISTS idx_{ACTIVE_STATUS_TABLE}_date ON {ACTIVE_STATUS_TABLE}(session_date)')

    conn.commit()
    conn.close()
    print(f"[tomorrow] ✅ Tables initialized in {PREDICTIONS_DB}")


def get_tomorrow_date() -> str:
    """يجيب تاريخ الغد (أو تالي يوم تداول)."""
    tomorrow = datetime.now() + timedelta(days=1)
    # لو الغد جمعة أو سبت → اخد الاثنين
    while tomorrow.weekday() in [4, 5]:  # 4=Friday, 5=Saturday
        tomorrow += timedelta(days=1)
    return tomorrow.strftime('%Y-%m-%d')


def get_today_date() -> str:
    """يجيب تاريخ اليوم."""
    return datetime.now().strftime('%Y-%m-%d')


# ─── الجزء 1: توليد توقعات الغد (شراء/بيع) ─────────────────────────────────

def generate_tomorrow_predictions(market='EGX', dry_run=False):
    """الجزء 1: توليد توقعات شراء/بيع لكل أسهم EGX."""
    print("\n" + "=" * 70)
    print("  الجزء 1: توليد توقعات الغد (شراء/بيع)")
    print("=" * 70)

    tomorrow = get_tomorrow_date()
    today = get_today_date()
    print(f"[tomorrow] تاريخ الجلسة: {tomorrow}")

    if market == 'CRYPTO':
        return generate_crypto_predictions(tomorrow, dry_run)

    # جلب أسهم EGX
    try:
        from utils.egx_gate import filter_egx_tickers
    except Exception:
        filter_egx_tickers = None

    tickers = []
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        c = conn.cursor()
        c.execute("""
            SELECT ticker, name, name_ar, current_price, change_percent,
                   volume, market_cap, pe_ratio, sector, ma_50, ma_200,
                   rsi, high_52w, low_52w, avg_volume
            FROM stocks
            WHERE is_active = 1
              AND current_price > 0.50
              AND volume >= 1000
              AND market = 'EGX'
            ORDER BY turnover_egp DESC
            LIMIT 100
        """)
        rows = c.fetchall()
        conn.close()

        for r in rows:
            tickers.append({
                'ticker': r[0], 'name': r[1] or r[2] or r[0],
                'current_price': r[3], 'change_percent': r[4] or 0,
                'volume': r[5] or 0, 'market_cap': r[6] or 0,
                'pe_ratio': r[7], 'sector': r[8],
                'ma_50': r[9], 'ma_200': r[10], 'rsi': r[11],
                'high_52w': r[12], 'low_52w': r[13],
                'avg_volume': r[14] or 0,
            })
        print(f"[tomorrow] جبت {len(tickers)} سهم EGX نشط")
    except Exception as e:
        print(f"[tomorrow] ⚠️ خطأ في جلب الأسهم: {e}")
        return 0

    if not tickers:
        print("[tomorrow] ⚠️ مفيش أسهم متاحة")
        return 0

    # تحليل كل سهم بـ MaestroOrchestrator
    predictions = []
    try:
        from analyzers.maestro_orchestrator import MaestroOrchestrator
        orchestrator = MaestroOrchestrator()
    except Exception as e:
        print(f"[tomorrow] ⚠️ MaestroOrchestrator مش متاح: {e}")
        print("[tomorrow] هاستخدم تحليل مبسط بدلاً منه")
        orchestrator = None

    for stock in tickers[:80]:  # نحلل أول 80 سهم
        ticker = stock['ticker']
        try:
            if orchestrator:
                # جلب price history
                price_history = get_price_history(ticker)
                if not price_history or len(price_history) < 30:
                    continue

                result = orchestrator.analyze(ticker, stock, price_history)
                signal = getattr(result, 'signal', 'NEUTRAL')
                entry = getattr(result, 'entry_price', stock['current_price'])
                target = getattr(result, 'target_price', entry * 1.10)
                stop = getattr(result, 'stop_loss', entry * 0.95)
                confidence = getattr(result, 'confidence', 50)
                master_score = getattr(result, 'master_score', 50)
                reason = getattr(result, 'reason', '')
            else:
                # تحليل مبسط
                signal, entry, target, stop, confidence, master_score, reason = simple_analysis(stock)

            # نقبل بس BUY / STRONG_BUY / SELL
            if signal not in ('BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL'):
                continue

            # حساب R/R
            if signal in ('BUY', 'STRONG_BUY'):
                risk = abs(entry - stop)
                reward = abs(target - entry)
            else:
                risk = abs(stop - entry)
                reward = abs(entry - target)

            r_multiple = reward / risk if risk > 0 else 0
            if r_multiple < 1.5:  # حد أدنى R/R
                continue

            predictions.append({
                'ticker': ticker,
                'name': stock['name'],
                'market': 'EGX',
                'signal': signal,
                'signal_type': signal,
                'entry_price': entry,
                'target_price': target,
                'stop_loss': stop,
                'master_score': master_score,
                'technical_score': stock.get('rsi', 50),
                'confidence': confidence,
                'r_multiple': r_multiple,
                'risk_reward_ratio': r_multiple,
                'prediction_date': today,
                'target_date': tomorrow,
                'reason': reason,
                'indicators_json': json.dumps({
                    'rsi': stock.get('rsi'),
                    'ma_50': stock.get('ma_50'),
                    'ma_200': stock.get('ma_200'),
                    'change_percent': stock.get('change_percent'),
                }),
            })

            if len(predictions) >= MAX_PREDICTIONS:
                break

        except Exception as e:
            print(f"[tomorrow] ⚠️ خطأ في تحليل {ticker}: {e}")
            continue

    # ترتيب حسب confidence
    predictions.sort(key=lambda x: x['confidence'], reverse=True)
    predictions = predictions[:MAX_PREDICTIONS]

    # تخزين في DB
    if not dry_run:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        c = conn.cursor()
        # امسح توقعات الغد القديمة لو موجودة
        c.execute(f"DELETE FROM {TOMORROW_PREDICTIONS_TABLE} WHERE session_date = ?", (tomorrow,))
        for p in predictions:
            c.execute(f'''
                INSERT OR REPLACE INTO {TOMORROW_PREDICTIONS_TABLE}
                (ticker, name, market, signal, signal_type, entry_price, target_price,
                 stop_loss, master_score, technical_score, confidence, r_multiple,
                 risk_reward_ratio, prediction_date, target_date, session_date,
                 status, reason, indicators_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
            ''', (
                p['ticker'], p['name'], p['market'], p['signal'], p['signal_type'],
                p['entry_price'], p['target_price'], p['stop_loss'],
                p['master_score'], p['technical_score'], p['confidence'],
                p['r_multiple'], p['risk_reward_ratio'],
                p['prediction_date'], p['target_date'], tomorrow,
                p['reason'], p['indicators_json'],
            ))
        conn.commit()
        conn.close()

    print(f"[tomorrow] ✅ تم توليد {len(predictions)} توقع لجلسة {tomorrow}")
    for p in predictions[:5]:
        print(f"  {p['signal']:12} {p['ticker']:8} entry={p['entry_price']:.2f} target={p['target_price']:.2f} confidence={p['confidence']:.0f}%")

    return len(predictions)


def generate_crypto_predictions(tomorrow, dry_run=False):
    """توليد توقعات كريبتو للغد."""
    print("[tomorrow] توليد توقعات الكريبتو...")

    SYMBOL_TO_COIN_ID = {
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
        'SOL': 'solana', 'XRP': 'ripple', 'ADA': 'cardano',
        'DOGE': 'dogecoin', 'AVAX': 'avalanche-2', 'DOT': 'polkadot',
    }

    import requests
    predictions = []

    try:
        conn = sqlite3.connect(str(DATA_ENGINE_DB))
        c = conn.cursor()
        c.execute("""
            SELECT symbol, name, price_usd, price_change_24h, total_volume, market_cap
            FROM crypto_prices
            WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
            ORDER BY market_cap_rank ASC LIMIT 20
        """)
        coins = c.fetchall()
        conn.close()
    except Exception as e:
        print(f"[tomorrow] ⚠️ خطأ في جلب العملات: {e}")
        return 0

    for row in coins:
        symbol, name, price, change_24h, volume, market_cap = row
        coin_id = SYMBOL_TO_COIN_ID.get(symbol)
        if not coin_id or not price:
            continue

        try:
            # جلب OHLC من CoinGecko
            resp = requests.get(
                f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc",
                params={'vs_currency': 'usd', 'days': '30'},
                timeout=15
            )
            if not resp.ok:
                continue
            ohlc = resp.json()
            if len(ohlc) < 15:
                continue
            closes = [c[4] for c in ohlc]
            last_price = closes[-1]

            # حساب RSI
            rsi = 50.0
            if len(closes) >= 15:
                gains, losses = 0, 0
                for i in range(1, 15):
                    diff = closes[i] - closes[i-1]
                    if diff >= 0:
                        gains += diff
                    else:
                        losses -= diff
                avg_gain = gains / 14
                avg_loss = losses / 14
                if avg_loss == 0:
                    rsi = 100.0
                else:
                    rs = avg_gain / avg_loss
                    rsi = 100 - (100 / (1 + rs))

            ma50 = sum(closes) / len(closes) if closes else last_price

            # إشارة
            if rsi < 40 and last_price > ma50:
                signal = 'BUY'
                entry = last_price
                target = last_price * 1.15
                stop = last_price * 0.92
                confidence = 60 + (40 - rsi)
            elif rsi > 70:
                signal = 'SELL'
                entry = last_price
                target = last_price * 0.85
                stop = last_price * 1.08
                confidence = 60 + (rsi - 70)
            else:
                continue

            risk = abs(entry - stop)
            reward = abs(target - entry)
            r_multiple = reward / risk if risk > 0 else 0
            if r_multiple < 1.5:
                continue

            predictions.append({
                'ticker': symbol,
                'name': name,
                'market': 'CRYPTO',
                'signal': signal,
                'signal_type': signal,
                'entry_price': entry,
                'target_price': target,
                'stop_loss': stop,
                'master_score': confidence,
                'technical_score': rsi,
                'confidence': min(95, confidence),
                'r_multiple': r_multiple,
                'risk_reward_ratio': r_multiple,
                'prediction_date': get_today_date(),
                'target_date': tomorrow,
                'reason': f'RSI={rsi:.0f} + {"above" if last_price > ma50 else "below"} MA50',
                'indicators_json': json.dumps({'rsi': rsi, 'change_24h': change_24h}),
            })

            if len(predictions) >= MAX_PREDICTIONS:
                break

        except Exception as e:
            print(f"[tomorrow] ⚠️ خطأ في تحليل {symbol}: {e}")
            continue

    predictions.sort(key=lambda x: x['confidence'], reverse=True)
    predictions = predictions[:MAX_PREDICTIONS]

    if not dry_run:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        c = conn.cursor()
        c.execute(f"DELETE FROM {TOMORROW_PREDICTIONS_TABLE} WHERE session_date = ? AND market = 'CRYPTO'", (tomorrow,))
        for p in predictions:
            c.execute(f'''
                INSERT OR REPLACE INTO {TOMORROW_PREDICTIONS_TABLE}
                (ticker, name, market, signal, signal_type, entry_price, target_price,
                 stop_loss, master_score, technical_score, confidence, r_multiple,
                 risk_reward_ratio, prediction_date, target_date, session_date,
                 status, reason, indicators_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
            ''', (
                p['ticker'], p['name'], p['market'], p['signal'], p['signal_type'],
                p['entry_price'], p['target_price'], p['stop_loss'],
                p['master_score'], p['technical_score'], p['confidence'],
                p['r_multiple'], p['risk_reward_ratio'],
                p['prediction_date'], p['target_date'], tomorrow,
                p['reason'], p['indicators_json'],
            ))
        conn.commit()
        conn.close()

    print(f"[tomorrow] ✅ تم توليد {len(predictions)} توقع كريبتو")
    return len(predictions)


def get_price_history(ticker):
    """جلب price history لسهم."""
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        c = conn.cursor()
        c.execute("""
            SELECT price_date, open, high, low, close, volume
            FROM stock_daily_prices
            WHERE ticker = ?
            ORDER BY price_date DESC
            LIMIT 60
        """, (ticker,))
        rows = c.fetchall()
        conn.close()
        # نرجعها مرتبة تصاعدية
        return [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}
                for r in reversed(rows)]
    except Exception:
        return []


def simple_analysis(stock):
    """تحليل مبسط لو MaestroOrchestrator مش متاح."""
    rsi = stock.get('rsi') or 50
    price = stock.get('current_price', 0)
    ma_50 = stock.get('ma_50') or price
    change = stock.get('change_percent', 0)
    high_52w = stock.get('high_52w') or price
    low_52w = stock.get('low_52w') or price

    signal = 'NEUTRAL'
    entry = price
    target = price * 1.10
    stop = price * 0.95
    confidence = 50
    master_score = 50
    reason = ''

    if rsi < 40 and price > ma_50 and change > 0:
        signal = 'BUY'
        target = price * 1.15
        stop = price * 0.92
        confidence = 70
        master_score = 75
        reason = f'RSI={rsi:.0f} (تشبع بيعي) + فوق MA50 + صاعد اليوم'
    elif rsi > 70 and price >= high_52w * 0.95:
        signal = 'SELL'
        target = price * 0.85
        stop = price * 1.05
        confidence = 65
        master_score = 70
        reason = f'RSI={rsi:.0f} (تشبع شرائي) + قرب 52w high'
    elif 40 <= rsi <= 55 and price > ma_50 and change > 2:
        signal = 'BUY'
        target = price * 1.10
        stop = price * 0.95
        confidence = 55
        master_score = 60
        reason = f'RSI={rsi:.0f} (محايد) + فوق MA50 + صاعد قوي'

    return signal, entry, target, stop, confidence, master_score, reason


# ─── الجزء 2: حالة الأسهم النشطة (اللي كانت معانا) ─────────────────────────

def update_active_status(dry_run=False):
    """الجزء 2: تحديث حالة التوقعات النشطة (اللي كانت معانا وصلت لفين)."""
    print("\n" + "=" * 70)
    print("  الجزء 2: حالة الأسهم النشطة (وصلت لفين)")
    print("=" * 70)

    tomorrow = get_tomorrow_date()
    today = get_today_date()

    # جلب التوقعات النشطة (اللي لسه مقفولةش)
    try:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        c = conn.cursor()
        c.execute("""
            SELECT id, ticker, signal, entry_price, target_price, stop_loss,
                   prediction_date, market
            FROM predictions
            WHERE outcome_date IS NULL
              AND market = 'EGX'
            ORDER BY prediction_date DESC
            LIMIT 30
        """)
        active_predictions = c.fetchall()
        conn.close()
    except Exception as e:
        print(f"[tomorrow] ⚠️ خطأ في جلب التوقعات النشطة: {e}")
        return 0

    if not active_predictions:
        print("[tomorrow] مفيش توقعات نشطة")
        return 0

    print(f"[tomorrow] عندي {len(active_predictions)} توقع نشط")

    # جلب السعر الحالي لكل توقع
    statuses = []
    try:
        stocks_conn = sqlite3.connect(str(STOCKS_DB))
        stocks_c = stocks_conn.cursor()

        for pred in active_predictions:
            pred_id, ticker, signal, entry, target, stop, pred_date, market = pred
            stocks_c.execute("""
                SELECT current_price, change_percent, name, name_ar, high_52w, low_52w
                FROM stocks WHERE ticker = ? LIMIT 1
            """, (ticker,))
            stock_row = stocks_c.fetchone()
            if not stock_row:
                continue

            current_price, change_pct, name, name_ar, high_52w, low_52w = stock_row
            name = name or name_ar or ticker

            if not current_price or current_price <= 0:
                continue

            # حساب progress
            if signal in ('BUY', 'STRONG_BUY'):
                if target and target > entry:
                    progress = ((current_price - entry) / (target - entry)) * 100
                else:
                    progress = 0
                distance_to_target = ((target - current_price) / current_price) * 100 if target else 0
                distance_to_stop = ((current_price - stop) / current_price) * 100 if stop else 0
            else:  # SELL
                if target and target < entry:
                    progress = ((entry - current_price) / (entry - target)) * 100
                else:
                    progress = 0
                distance_to_target = ((current_price - target) / current_price) * 100 if target else 0
                distance_to_stop = ((stop - current_price) / current_price) * 100 if stop else 0

            # تحديد الحالة + الإجراء المتوقع
            if signal in ('BUY', 'STRONG_BUY'):
                if current_price >= target:
                    status = 'TARGET_HIT'
                    expected_action = '🎯 تحقق الهدف — بيع واقفل الصفقة'
                elif current_price <= stop:
                    status = 'STOP_HIT'
                    expected_action = '🛑 ضرب الوقف — خرجت من الصفقة'
                elif progress >= 70:
                    status = 'NEAR_TARGET'
                    expected_action = '📈 قرب من الهدف — اراقب وقفل جزء'
                elif progress >= 30:
                    status = 'PROGRESSING'
                    expected_action = '✅ بتتحرك صح — استمر'
                elif progress < 0 and progress > -20:
                    status = 'PULLBACK'
                    expected_action = '⚠️ ارتداد بسيط — اراقب الوقف'
                elif progress <= -20:
                    status = 'DANGER'
                    expected_action = '🔴 خطر — قرب من الوقف، فكر تطلع'
                else:
                    status = 'FLAT'
                    expected_action = '➡️ عادي — استمر'
            else:  # SELL
                if current_price <= target:
                    status = 'TARGET_HIT'
                    expected_action = '🎯 تحقق الهدف'
                elif current_price >= stop:
                    status = 'STOP_HIT'
                    expected_action = '🛑 ضرب الوقف'
                else:
                    status = 'PROGRESSING'
                    expected_action = '✅ بتتحرك صح'

            statuses.append({
                'ticker': ticker,
                'name': name,
                'market': market,
                'original_signal': signal,
                'original_entry_price': entry,
                'original_target_price': target,
                'original_stop_loss': stop,
                'original_prediction_date': pred_date,
                'current_price': current_price,
                'current_change_percent': change_pct or 0,
                'highest_price_reached': high_52w,
                'lowest_price_reached': low_52w,
                'progress_percent': round(progress, 1),
                'distance_to_target': round(distance_to_target, 1),
                'distance_to_stop': round(distance_to_stop, 1),
                'status': status,
                'expected_action': expected_action,
            })

        stocks_conn.close()
    except Exception as e:
        print(f"[tomorrow] ⚠️ خطأ في جلب الأسعار الحالية: {e}")
        return 0

    # تخزين
    if not dry_run:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        c = conn.cursor()
        c.execute(f"DELETE FROM {ACTIVE_STATUS_TABLE} WHERE session_date = ?", (tomorrow,))
        for s in statuses:
            c.execute(f'''
                INSERT OR REPLACE INTO {ACTIVE_STATUS_TABLE}
                (ticker, name, market, original_signal, original_entry_price,
                 original_target_price, original_stop_loss, original_prediction_date,
                 current_price, current_change_percent, highest_price_reached,
                 lowest_price_reached, progress_percent, distance_to_target,
                 distance_to_stop, status, expected_action, session_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                s['ticker'], s['name'], s['market'], s['original_signal'],
                s['original_entry_price'], s['original_target_price'],
                s['original_stop_loss'], s['original_prediction_date'],
                s['current_price'], s['current_change_percent'],
                s['highest_price_reached'], s['lowest_price_reached'],
                s['progress_percent'], s['distance_to_target'],
                s['distance_to_stop'], s['status'], s['expected_action'],
                tomorrow,
            ))
        conn.commit()
        conn.close()

    print(f"[tomorrow] ✅ تم تحديث {len(statuses)} حالة نشطة")
    for s in statuses[:5]:
        print(f"  {s['ticker']:8} {s['original_signal']:12} progress={s['progress_percent']:+.1f}% → {s['expected_action']}")

    return len(statuses)


# ─── الجزء 3: أسهم تحت المراقبة (التغيرات) ────────────────────────────────

def generate_watchlist(dry_run=False):
    """الجزء 3: أسهم تحت المراقبة ممكن تعمل شغل حلو."""
    print("\n" + "=" * 70)
    print("  الجزء 3: أسهم تحت المراقبة (التغيرات)")
    print("=" * 70)

    tomorrow = get_tomorrow_date()

    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        c = conn.cursor()
        c.execute("""
            SELECT ticker, name, name_ar, current_price, change_percent,
                   volume, avg_volume, ma_50, ma_200, rsi, high_52w, low_52w,
                   sector, turnover_egp
            FROM stocks
            WHERE is_active = 1
              AND current_price > 0.50
              AND volume >= 1000
              AND market = 'EGX'
            ORDER BY ABS(change_percent) DESC
            LIMIT 100
        """)
        rows = c.fetchall()
        conn.close()
    except Exception as e:
        print(f"[tomorrow] ⚠️ خطأ في جلب الأسهم: {e}")
        return 0

    watchlist = []
    for r in rows:
        ticker, name, name_ar, price, change, volume, avg_vol, ma_50, ma_200, rsi, high_52w, low_52w, sector, turnover = r
        if not price or price <= 0:
            continue

        name = name or name_ar or ticker
        volume_surge = (volume / avg_vol) if avg_vol and avg_vol > 0 else 1.0
        distance_from_ma50 = ((price - ma_50) / ma_50 * 100) if ma_50 and ma_50 > 0 else 0
        near_52w_high = ((price / high_52w) * 100) if high_52w and high_52w > 0 else 0
        near_52w_low = ((price / low_52w) * 100) if low_52w and low_52w > 0 else 100

        watch_type = None
        watch_reason = ''
        priority = 'MEDIUM'

        # 1) صاروخ حجم (volume surge + change > 5%)
        if volume_surge >= 2.0 and change and change > 5:
            watch_type = 'VOLUME_SURGE'
            watch_reason = f'حجم تداول {volume_surge:.1f}x المتوسط + صاعد {change:+.1f}% — انفجار سيولة'
            priority = 'HIGH'

        # 2) تشبع بيعي (RSI < 35)
        elif rsi and rsi < 35:
            watch_type = 'OVERSOLD'
            watch_reason = f'RSI={rsi:.0f} — تشبع بيعي شديد، ارتداد محتمل'
            priority = 'HIGH'

        # 3) تشبع شرائي (RSI > 70)
        elif rsi and rsi > 70:
            watch_type = 'OVERBOUGHT'
            watch_reason = f'RSI={rsi:.0f} — تشبع شرائي، تراجع محتمل'
            priority = 'MEDIUM'

        # 4) قرب من 52w high (breakout محتمل)
        elif near_52w_high >= 95:
            watch_type = 'NEAR_52W_HIGH'
            watch_reason = f'قرب من أعلى 52 أسبوع ({near_52w_high:.0f}%) — كسر محتمل'
            priority = 'MEDIUM'

        # 5) قرب من 52w low (ارتداد محتمل)
        elif near_52w_low <= 105 and low_52w and low_52w > 0:
            watch_type = 'NEAR_52W_LOW'
            watch_reason = f'قرب من أدنى 52 أسبوع ({near_52w_low:.0f}%) — ارتداد محتمل'
            priority = 'LOW'

        # 6) change > 8% (top mover)
        elif change and abs(change) > 8:
            watch_type = 'TOP_MOVER'
            direction = 'صاعد' if change > 0 else 'هابط'
            watch_reason = f'{direction} {change:+.1f}% — حركة قوية'
            priority = 'HIGH' if change > 0 else 'MEDIUM'

        # 7) قرب من MA50 من تحت (breakout محتمل)
        elif ma_50 and ma_50 > 0 and -2 < distance_from_ma50 < 0 and volume_surge > 1.2:
            watch_type = 'NEAR_BREAKOUT'
            watch_reason = f'قرب من MA50 ({distance_from_ma50:+.1f}%) — مرشح للكسر'
            priority = 'MEDIUM'

        if watch_type:
            watchlist.append({
                'ticker': ticker,
                'name': name,
                'market': 'EGX',
                'watch_type': watch_type,
                'watch_reason': watch_reason,
                'current_price': price,
                'change_percent': change or 0,
                'volume': volume or 0,
                'volume_surge': round(volume_surge, 2),
                'rsi': rsi,
                'ma_50': ma_50,
                'distance_from_ma50': round(distance_from_ma50, 1),
                'near_52w_high': round(near_52w_high, 1),
                'near_52w_low': round(near_52w_low, 1),
                'priority': priority,
            })

        if len(watchlist) >= MAX_WATCHLIST:
            break

    # ترتيب حسب priority
    priority_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
    watchlist.sort(key=lambda x: priority_order.get(x['priority'], 3))

    # تخزين
    if not dry_run:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        c = conn.cursor()
        c.execute(f"DELETE FROM {WATCHLIST_TABLE} WHERE session_date = ?", (tomorrow,))
        for w in watchlist:
            c.execute(f'''
                INSERT OR REPLACE INTO {WATCHLIST_TABLE}
                (ticker, name, market, watch_type, watch_reason, current_price,
                 change_percent, volume, volume_surge, rsi, ma_50,
                 distance_from_ma50, near_52w_high, near_52w_low, session_date,
                 priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                w['ticker'], w['name'], w['market'], w['watch_type'],
                w['watch_reason'], w['current_price'], w['change_percent'],
                w['volume'], w['volume_surge'], w['rsi'], w['ma_50'],
                w['distance_from_ma50'], w['near_52w_high'], w['near_52w_low'],
                tomorrow, w['priority'],
            ))
        conn.commit()
        conn.close()

    print(f"[tomorrow] ✅ تم تحديد {len(watchlist)} سهم تحت المراقبة")
    for w in watchlist[:5]:
        print(f"  [{w['priority']}] {w['watch_type']:15} {w['ticker']:8} — {w['watch_reason']}")

    return len(watchlist)


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description='توليد توقعات الغد')
    parser.add_argument('--dry-run', action='store_true', help='جاف فقط — لا يكتب في DB')
    parser.add_argument('--market', default='EGX', choices=['EGX', 'CRYPTO'], help='السوق')
    parser.add_argument('--skip-predictions', action='store_true', help='تخطي الجزء 1')
    parser.add_argument('--skip-status', action='store_true', help='تخطي الجزء 2')
    parser.add_argument('--skip-watchlist', action='store_true', help='تخطي الجزء 3')
    args = parser.parse_args()

    print("=" * 70)
    print("  Tomorrow Predictions Generator")
    print(f"  Market: {args.market} | Dry run: {args.dry_run}")
    print(f"  Date: {get_tomorrow_date()}")
    print("=" * 70)

    init_db()

    total = 0
    if not args.skip_predictions:
        total += generate_tomorrow_predictions(market=args.market, dry_run=args.dry_run)
    if not args.skip_status and args.market == 'EGX':
        total += update_active_status(dry_run=args.dry_run)
    if not args.skip_watchlist and args.market == 'EGX':
        total += generate_watchlist(dry_run=args.dry_run)

    print("\n" + "=" * 70)
    print(f"  ✅ Done. Total records: {total}")
    print("=" * 70)


if __name__ == '__main__':
    main()

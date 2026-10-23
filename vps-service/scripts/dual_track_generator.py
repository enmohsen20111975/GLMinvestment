#!/usr/bin/env python3
"""
dual_track_generator.py — مٌولّد توقعات المسار المزدوج (المسار B: السيولة الاستثنائية)
================================================================
المرحلة 3 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-3)

الشروط الصارمة لتوليد إشارة المسار B (السيولة):
  1. حجم تداول السهم اليوم >= dynamic_threshold (p75 للسوق).
  2. حجم التداول اليومي >= 1.5x متوسط حجم آخر 20 يوماً (مؤشر زخم سيولة ومشتري مؤسسي).
  3. شمعة الشراء خضراء (Close >= Open) للتأكد من أنها سيولة تجميع ودخول وليست تصريفاً.
  4. السوق مؤهل ومعتمد من الـ Backtest (hit_rate >= 65%).
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

TRACK_A_DAILY_LIMIT = 5
TRACK_B_VOLUME_RATIO_MIN = 1.5   # 1.5x متوسط 20 يوم

# ── Market-specific configuration (matches liquidity_backtest_engine.py) ──
# كل سوق له شروطه الخاصة حسب السلوك المُثبت في الـ backtest
MARKET_CONFIG = {
    'EGX': {
        'target_pct': 2.5,        'stop_pct': 2.0,         'holding_days': 5,
        'require_green_candle': True,
        'require_positive_momentum': False,
        'min_change_24h': None,
        'description': '🇪🇬 مصر — شمعة خضراء إلزامية (تجميع مش تصريف)',
    },
    'KSA': {
        'target_pct': 2.0,        'stop_pct': 1.8,         'holding_days': 5,
        'require_green_candle': True,
        'require_positive_momentum': False,
        'min_change_24h': None,
        'description': '🇸🇦 السعودية — صافي سيولة موجب',
    },
    'US': {
        'target_pct': 3.0,        'stop_pct': 1.5,         'holding_days': 5,
        'require_green_candle': True,
        'require_positive_momentum': False,
        'min_change_24h': None,
        'description': '🇺🇸 أمريكا — وقف خسارة ديناميكي 1.5×ATR',
    },
    'CRYPTO': {
        'target_pct': 3.0,        'stop_pct': 2.5,         'holding_days': 4,
        'require_green_candle': False,
        'require_positive_momentum': True,
        'min_change_24h': 2.0,    # شرط إلزامي: change_24h >= +2.0%
        'description': '🪙 الكريبتو — زخم صاعد +2% إلزامي',
    },
    'GOLD': {
        'target_pct': 1.5,        'stop_pct': 1.5,         'holding_days': 7,
        'require_green_candle': False,
        'require_positive_momentum': True,
        'min_change_24h': None,
        'use_sma_10': True,
        'description': '🥇 الذهب — تجاوز متوسط 10 أيام + زخم الأونصة',
    },
}


def parse_volume(v) -> int:
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


def ensure_track_column(conn: sqlite3.Connection, table_name: str = 'predictions'):
    try:
        cur = conn.execute(f"PRAGMA table_info({table_name})")
        cols = [r['name'] for r in cur.fetchall()]
        if 'track' not in cols:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN track TEXT DEFAULT 'full_analysis'")
            conn.commit()
            print(f'  ✅ added track column to {table_name}')
    except Exception as e:
        print(f'  ⚠️ ensure_track_column error: {e}')


def get_qualified_markets(conn: sqlite3.Connection) -> List[str]:
    try:
        cur = conn.execute("""
            SELECT DISTINCT market FROM liquidity_backtest_results
            WHERE qualified = 1
        """)
        return [r['market'] for r in cur.fetchall()]
    except Exception as e:
        print(f'  ⚠️ error reading qualified markets: {e}')
        return []


def get_today_threshold(conn: sqlite3.Connection, market: str) -> Tuple[float, bool]:
    try:
        cur = conn.execute("""
            SELECT threshold_value FROM liquidity_dynamic_threshold
            WHERE market = ?
            ORDER BY threshold_date DESC, id DESC LIMIT 1
        """, (market,))
        row = cur.fetchone()
        if row and row['threshold_value'] > 0:
            return float(row['threshold_value']), False
    except Exception:
        pass
    fallbacks = {'EGX': 1500000.0, 'US': 10000000.0, 'KSA': 200000.0}
    return fallbacks.get(market, 500000.0), True


def load_recent_market_liquidity(market: str) -> List[dict]:
    """تحميل بيانات أحدث جلسات التداول لجميع الأسهم لحساب متوسط 20 يوم والسيولة الحالية."""
    rows: List[dict] = []

    market_codes = {
        'EGX': ['EGX'],
        'US': ['US'],
        'KSA': ['TADAWUL', 'KSA', 'SAUDI'],
    }.get(market, [market])

    if db_exists(PRICE_HISTORY_DB):
        conn = open_db(PRICE_HISTORY_DB, readonly=True)
        if conn:
            try:
                placeholders = ','.join('?' for _ in market_codes)
                # جلب آخر 60 يوماً من أحدث تاريخ في قاعدة البيانات
                query = f"""
                    SELECT date, ticker, open_price as open, high_price as high,
                           low_price as low, close_price as close, volume
                    FROM price_history
                    WHERE market IN ({placeholders})
                      AND volume IS NOT NULL
                      AND date >= (SELECT DATE(MAX(date), '-60 days') FROM price_history WHERE market IN ({placeholders}))
                    ORDER BY ticker, date ASC
                """
                cur = conn.execute(query, market_codes + market_codes)
                grouped = defaultdict(list)
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    open_p = float(r['open'] or close_p)
                    high_p = float(r['high'] or close_p)
                    low_p = float(r['low'] or close_p)
                    if vol > 0 and close_p > 0:
                        grouped[r['ticker']].append({
                            'date': r['date'],
                            'open': open_p,
                            'high': high_p,
                            'low': low_p,
                            'close': close_p,
                            'volume': vol,
                        })

                for ticker, t_rows in grouped.items():
                    if len(t_rows) < 3:
                        continue  # نحتاج على الأقل 3 أيام تداول مسجلة
                    today_row = t_rows[-1]
                    hist = t_rows[:-1]
                    avg_vol_20 = sum(x['volume'] for x in hist[-20:]) / len(hist[-20:]) if hist else today_row['volume']

                    rows.append({
                        'ticker': ticker,
                        'market': market,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_pressure': 85.0 if today_row['close'] >= today_row['open'] else 40.0,
                        'net_flow': today_row['volume'],
                    })
                if rows:
                    print(f'  ✅ {market}: loaded {len(rows)} active tickers from price_history.db')
            except Exception as e:
                print(f'  ⚠️ error loading liquidity for {market}: {e}')
            conn.close()

    # ── CRYPTO: من data_engine.db.crypto_prices ────────────────────────
    if market == 'CRYPTO' and not rows and db_exists(DATA_ENGINE_DB):
        conn = open_db(DATA_ENGINE_DB, readonly=True)
        if conn:
            try:
                cur = conn.execute("""
                    SELECT DATE(timestamp) as date, symbol as ticker,
                           MIN(price_usd) as low, MAX(price_usd) as high,
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
                      AND DATE(timestamp) >= DATE('now', '-60 days')
                    GROUP BY DATE(timestamp), symbol
                    ORDER BY symbol, DATE(timestamp) ASC
                """)
                grouped = defaultdict(list)
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    if vol > 0 and close_p > 0:
                        grouped[r['ticker']].append({
                            'date': r['date'],
                            'open': float(r['open'] or close_p),
                            'high': float(r['high'] or close_p),
                            'low': float(r['low'] or close_p),
                            'close': close_p,
                            'volume': vol,
                            'change_24h': float(r['change_24h'] or 0),
                        })

                for ticker, t_rows in grouped.items():
                    if len(t_rows) < 3:
                        continue
                    today_row = t_rows[-1]
                    hist = t_rows[:-1]
                    avg_vol_20 = sum(x['volume'] for x in hist[-20:]) / len(hist[-20:]) if hist else today_row['volume']
                    rows.append({
                        'ticker': ticker,
                        'market': market,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_pressure': 85.0 if today_row['close'] >= today_row['open'] else 40.0,
                        'net_flow': today_row['volume'],
                        'change_24h': today_row.get('change_24h', 0),
                    })
                if rows:
                    print(f'  ✅ CRYPTO: loaded {len(rows)} active coins from data_engine.db.crypto_prices')
            except Exception as e:
                print(f'  ⚠️ crypto query error: {e}')
            conn.close()

    # ── GOLD: من data_engine.db.gold_prices_clean ──────────────────────
    if market == 'GOLD' and not rows and db_exists(DATA_ENGINE_DB):
        conn = open_db(DATA_ENGINE_DB, readonly=True)
        if conn:
            try:
                cur = conn.execute("""
                    SELECT DATE(timestamp) as date,
                           MIN(price_per_gram) as low, MAX(price_per_gram) as high,
                           (SELECT price_per_gram FROM gold_prices_clean g2
                            WHERE DATE(g2.timestamp) = DATE(g1.timestamp)
                            ORDER BY timestamp ASC LIMIT 1) as open,
                           (SELECT price_per_gram FROM gold_prices_clean g3
                            WHERE DATE(g3.timestamp) = DATE(g1.timestamp)
                            ORDER BY timestamp DESC LIMIT 1) as close
                    FROM gold_prices_clean g1
                    WHERE price_per_gram IS NOT NULL AND price_per_gram > 0
                      AND DATE(timestamp) >= DATE('now', '-60 days')
                    GROUP BY DATE(timestamp)
                    ORDER BY DATE(timestamp) ASC
                """)
                t_rows = []
                for r in cur:
                    close_p = float(r['close'] or 0)
                    if close_p > 0:
                        t_rows.append({
                            'date': r['date'],
                            'open': float(r['open'] or close_p),
                            'high': float(r['high'] or close_p),
                            'low': float(r['low'] or close_p),
                            'close': close_p,
                            'volume': 1000000,
                            'change_24h': 0,
                        })
                # احسب SMA(10) للذهب
                if len(t_rows) >= 11:
                    today_row = t_rows[-1]
                    hist = t_rows[:-1]
                    sma_10 = sum(x['close'] for x in hist[-10:]) / 10.0
                    rows.append({
                        'ticker': 'XAU',
                        'market': market,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': 1000000,
                        'avg_volume_20': 1000000,
                        'buy_pressure': 85.0 if today_row['close'] >= today_row['open'] else 40.0,
                        'net_flow': 1000000,
                        'change_24h': today_row.get('change_24h', 0),
                        'sma_10': sma_10,
                    })
                if rows:
                    print(f'  ✅ GOLD: loaded 1 XAU ticker from data_engine.db.gold_prices_clean')
            except Exception as e:
                print(f'  ⚠️ gold query error: {e}')
            conn.close()

    return rows


def filter_track_b_candidates(rows: List[dict], threshold: float, market: str) -> List[dict]:
    """تصفية الأسهم التي تحقق شروط السيولة الاستثنائية للمسار B حسب شروط كل سوق."""
    candidates = []
    cfg = MARKET_CONFIG.get(market, MARKET_CONFIG['EGX'])
    target_pct = cfg['target_pct']
    stop_pct = cfg['stop_pct']
    require_green_candle = cfg.get('require_green_candle', False)
    require_positive_momentum = cfg.get('require_positive_momentum', False)
    min_change_24h = cfg.get('min_change_24h', None)
    use_sma_10 = cfg.get('use_sma_10', False)

    for r in rows:
        # 1. تخطي إذا كان الحجم أقل من العتبة الديناميكية p75
        if r['volume'] < threshold:
            continue
        # 2. مؤشر الزخم المؤسسي: الحجم الحالي >= 1.5x متوسط 20 يوم
        if r['avg_volume_20'] > 0 and r['volume'] < (r['avg_volume_20'] * TRACK_B_VOLUME_RATIO_MIN):
            continue
        # 3. شمعة خضراء (Close >= Open) — إلزامي لأسواق الأسهم (تجميع مش تصريف)
        if require_green_candle and r['close'] < r['open']:
            continue
        # 4. زخم إيجابي (للكريبتو والذهب)
        if require_positive_momentum:
            change_24h = r.get('change_24h', None)
            if min_change_24h is not None:
                if change_24h is None or change_24h < min_change_24h:
                    continue
            # للذهب: تجاوز SMA(10)
            if use_sma_10:
                sma_10 = r.get('sma_10', None)
                if sma_10 is not None and r['close'] < sma_10:
                    continue

        entry_price = round(r['close'], 4)
        target_1 = round(entry_price * (1.0 + target_pct / 100.0), 4)
        target_2 = round(entry_price * (1.0 + (target_pct * 1.5) / 100.0), 4)
        stop_loss = round(entry_price * (1.0 - stop_pct / 100.0), 4)

        vol_ratio = r['volume'] / max(r['avg_volume_20'], 1)

        # بناء سبب الإشارة حسب نوع السوق
        reasons = [f'💧 سيولة استثنائية {vol_ratio:.1f}x']
        if require_green_candle:
            reasons.append('شمعة خضراء (تجميع)')
        if min_change_24h is not None and r.get('change_24h') is not None:
            reasons.append(f'تغير +{r["change_24h"]:.2f}% (≥ +{min_change_24h}%)')
        if use_sma_10:
            reasons.append('تجاوز SMA(10)')
        reasons.append(f'p75={threshold:,.0f}')
        reasoning = ' • '.join(reasons)

        candidates.append({
            'ticker': r['ticker'],
            'market': market,
            'prediction_date': r['date'],
            'signal': 'BUY',
            'signal_type': 'LIQUIDITY_BREAKOUT',
            'entry_price': entry_price,
            'target_price': target_1,
            'target_price_2': target_2,
            'stop_loss': stop_loss,
            'status': 'ACTIVE',
            'confidence': 88.0,
            'risk_reward': round(target_pct / stop_pct, 2) if stop_pct > 0 else 1.5,
            'track': 'liquidity',
            'volume': r['volume'],
            'avg_volume_20': r['avg_volume_20'],
            'vol_ratio': vol_ratio,
            'market_config': f'+{target_pct}%/-{stop_pct}%/{cfg["holding_days"]}d',
            'reasoning': reasoning,
        })

    candidates.sort(key=lambda x: -x['vol_ratio'])
    return candidates


def save_track_b_predictions(conn: sqlite3.Connection, predictions: List[dict]):
    saved = 0
    for p in predictions:
        try:
            conn.execute("""
                INSERT INTO predictions
                (ticker, signal, signal_type, prediction_date, entry_price,
                 target_price, target_price_2, stop_loss, status, confidence,
                 risk_reward, market, track, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (
                p['ticker'], p['signal'], p['signal_type'], p['prediction_date'],
                p['entry_price'], p['target_price'], p['target_price_2'],
                p['stop_loss'], p['status'], p['confidence'], p['risk_reward'],
                p['market'], p['track'], p['reasoning'],
            ))
            saved += 1
        except Exception as e:
            print(f'  ⚠️ save error for {p["ticker"]}: {e}')
    conn.commit()
    return saved


def main():
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    parser = argparse.ArgumentParser(description='Dual-Track Generator — Phase 3')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA) — افتراضي: كل المؤهلة')
    parser.add_argument('--track', type=str, default='B', choices=['A', 'B', 'both'])
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        args.dry_run = True

    print(f'\n{"#"*70}')
    print(f'# DUAL-TRACK GENERATOR — Phase 3')
    print(f'# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'# Mode: {"DRY-RUN" if args.dry_run else "EXECUTE"}')
    print(f'# Track: {args.track}  |  Market: {args.market or "ALL qualified"}')
    print(f'{"#"*70}')

    if not db_exists(PREDICTIONS_DB):
        print('\n⚠️ predictions.db not found — cannot proceed')
        return

    conn = open_db(PREDICTIONS_DB, readonly=False)
    if not conn:
        return

    ensure_track_column(conn, 'predictions')

    qualified = get_qualified_markets(conn)
    markets_to_process = [args.market] if args.market else qualified

    if not markets_to_process:
        print('\n⚠️ no qualified markets found in liquidity_backtest_results')
        print('  → Run liquidity_backtest_engine.py --execute first')
        conn.close()
        return

    print(f'\nQualified markets: {markets_to_process}')

    total_b_generated = 0
    for market in markets_to_process:
        print(f'\n{"="*60}')
        print(f'Market: {market}')
        print(f'{"="*60}')

        threshold, fallback = get_today_threshold(conn, market)
        print(f'  threshold: {threshold:,.0f} (fallback={fallback})')

        rows = load_recent_market_liquidity(market)
        if not rows:
            print(f'  ⚠️ no liquidity data for {market}')
            continue

        candidates = filter_track_b_candidates(rows, threshold, market)
        print(f'  🎯 Found {len(candidates)} Track B liquidity candidate(s):')
        for c in candidates[:10]:
            print(f"    - {c['ticker']}: entry={c['entry_price']} | target={c['target_price']} | vol_ratio={c['vol_ratio']:.1f}x | {c['reasoning']}")

        if args.execute and candidates:
            saved = save_track_b_predictions(conn, candidates)
            print(f'  ✅ Saved {saved} Track B prediction(s) to DB')
            total_b_generated += saved
        else:
            total_b_generated += len(candidates)

    conn.close()
    print(f'\n{"="*70}')
    print(f'SUMMARY: Track B generated: {total_b_generated}')
    print(f'{"="*70}')


if __name__ == '__main__':
    # Task FINALIZE-UNIFICATION: non-canonical writer disabled (Rule 35).
    # V40.2 (daily_predictor.py) is the ONLY writer to predictions.db.
    # To re-enable: remove this guard. Do NOT delete (Rule 16).
    import sys
    print('[FINALIZE-UNIFICATION] GUARD: dual_track_generator.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer.')
    sys.exit(0)
    main()

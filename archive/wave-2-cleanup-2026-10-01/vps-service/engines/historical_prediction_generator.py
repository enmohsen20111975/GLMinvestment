#!/usr/bin/env python3
"""
Historical Prediction Generator - Multi-Market
يولّد توقعات تاريخية لكل الأسواق المتاحة
2-7 تحليلات يومياً بحد أقصى لكل سوق
مدة المراقبة: شهر من تاريخ الشراء

الأسواق المدعومة:
  - السعودية (Tadawul)
  - مصر (EGX)
  - الكويت (KSE)
  - قطر (QSE)
  - العملات الرقمية (Crypto)
"""

import os
import sys
import json
import sqlite3
import random
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# Add parent for engine import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from master_backfill_adapter import get_engine, MasterBackfillAdapter, MARKET_MAP, NON_STOCK_MARKETS

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')

# Limits
MAX_PREDICTIONS_PER_DAY = 7
MIN_PREDICTIONS_PER_DAY = 2
MONITORING_PERIOD_DAYS = 30

# ============================================================================
# جميع الأسواق المتاحة
# ============================================================================
ALL_MARKETS = [
    'السعودية',          # Tadawul
    'مصر',                # EGX
    'الكويت',             # KSE
    'قطر',                # QSE
    'العملات الرقمية',    # Crypto
]

# لكل سوق، وزن نسبي يحدد عدد التوقعات اليومية (سوق أكبر → توقعات أكثر)
MARKET_WEIGHTS = {
    'السعودية': 1.5,
    'مصر': 1.2,
    'الكويت': 0.8,
    'قطر': 0.6,
    'العملات الرقمية': 0.5,
}


class HistoricalPredictionGenerator:
    """مولّد التوقعات التاريخية - يدعم كل الأسواق"""

    def __init__(self):
        self.engine = get_engine()
        self.stats = {
            'total_predictions': 0,
            'total_days': 0,
            'days_processed': 0,
            'buy_signals': 0,
            'sell_signals': 0,
            'hold_signals': 0,
            'errors': 0,
            'start_time': None,
            'by_market': {}
        }

    def _get_predictions_conn(self):
        c = sqlite3.connect(PREDICTIONS_DB, timeout=15.0)
        c.row_factory = sqlite3.Row
        return c

    def _create_platform_recommendations_table(self):
        """إنشاء جدول platform_recommendations إذا لم يكن موجوداً"""
        conn = self._get_predictions_conn()
        conn.execute('''CREATE TABLE IF NOT EXISTS platform_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT DEFAULT '',
            market TEXT NOT NULL,
            signal TEXT NOT NULL,
            confidence INTEGER DEFAULT 50,
            entry_price REAL DEFAULT 0,
            target_price REAL DEFAULT 0,
            stop_loss REAL DEFAULT 0,
            predicted_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            final_price REAL,
            profit_loss REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop INTEGER DEFAULT 0,
            technical_score INTEGER DEFAULT 50,
            fundamental_score INTEGER DEFAULT 50,
            volume_seasonal_score INTEGER DEFAULT 50,
            confluence_score INTEGER DEFAULT 50,
            rsi REAL DEFAULT 50,
            macd_signal TEXT DEFAULT 'NEUTRAL',
            pe_ratio REAL,
            roe REAL,
            technical_rating TEXT DEFAULT '',
            phase_scores TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_pr_date ON platform_recommendations(predicted_date)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_pr_symbol ON platform_recommendations(symbol)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_pr_status ON platform_recommendations(status)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_pr_market ON platform_recommendations(market)')
        conn.commit()
        conn.close()

    def _prediction_exists(self, symbol: str, date: str) -> bool:
        """التحقق من وجود توقع مسبقاً"""
        conn = self._get_predictions_conn()
        row = conn.execute(
            "SELECT id FROM platform_recommendations WHERE symbol=? AND predicted_date=?",
            (symbol, date)
        ).fetchone()
        conn.close()
        return row is not None

    def _save_prediction(self, pred: Dict):
        """حفظ توقع في قاعدة البيانات"""
        conn = self._get_predictions_conn()
        conn.execute('''INSERT INTO platform_recommendations
            (symbol, name, market, signal, confidence, entry_price, target_price, stop_loss,
             predicted_date, expiry_date, status, technical_score, fundamental_score,
             volume_seasonal_score, confluence_score, rsi, macd_signal, pe_ratio, roe,
             technical_rating, phase_scores)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
            pred['symbol'], pred['name'], pred['market'], pred['signal'],
            pred['confidence'], pred['entry_price'], pred['target_price'], pred['stop_loss'],
            pred['predicted_date'], pred['expiry_date'], 'ACTIVE',
            pred['technical_score'], pred['fundamental_score'],
            pred['volume_seasonal_score'], pred['confluence_score'],
            pred['rsi'], pred['macd_signal'],
            pred.get('pe_ratio'), pred.get('roe'),
            pred.get('technical_rating', ''),
            json.dumps(pred.get('phase_scores', {}))
        ))
        conn.commit()
        conn.close()

    def _evaluate_prediction(self, pred_id: int, symbol: str, market: str,
                             entry_price: float, target_price: float,
                             stop_loss: float, predicted_date: str,
                             expiry_date: str, signal: str):
        """تقييم توقع بعد انتهاء المراقبة"""
        try:
            prices = self.engine.get_historical_prices(symbol, market, expiry_date, 60)
            if not prices:
                return

            # Find price at expiry or closest date
            final_price = None
            for p in reversed(prices):
                if p.get('close') and float(p['close']) > 0:
                    final_price = float(p['close'])
                    break

            if not final_price:
                return

            # Check if target or stop was hit during monitoring
            hit_target = False
            hit_stop = False

            # Get prices during the monitoring period
            monitor_prices = self.engine.get_historical_prices(symbol, market, expiry_date, 35)
            for mp in monitor_prices:
                high = float(mp.get('high', 0) or 0)
                low = float(mp.get('low', 0) or 0)

                if signal in ['STRONG_BUY', 'STRONG BUY', 'BUY', 'ACCUMULATE']:
                    if high >= target_price:
                        hit_target = True
                    if low <= stop_loss:
                        hit_stop = True
                elif signal in ['SELL', 'STRONG_SELL', 'STRONG SELL', 'REDUCE']:
                    if low <= target_price:
                        hit_target = True
                    if high >= stop_loss:
                        hit_stop = True

            # Calculate profit/loss
            profit_loss = round(((final_price - entry_price) / entry_price) * 100, 2) if entry_price > 0 else 0

            # For sell signals, reverse the logic
            if signal in ['SELL', 'STRONG_SELL', 'STRONG SELL', 'REDUCE']:
                profit_loss = -profit_loss

            # ULTRA-FIX (2026-08-11): Cap loss at -20% (realistic stop-loss ceiling).
            # بدون ده، SELL signals على أسهم انفجرت (زي GGCC 0.41→1.25) بـ توصل -204%.
            if profit_loss < -20.0:
                profit_loss = -20.0

            # Determine status
            if hit_target:
                status = 'HIT_TARGET'
            elif hit_stop:
                status = 'HIT_STOP'
            elif final_price > entry_price * 1.02:
                status = 'WIN'
            elif final_price < entry_price * 0.98:
                status = 'LOSS'
            else:
                status = 'EXPIRED'

            # For sell signals — status override only (profit_loss already negated + capped above)
            if signal in ['SELL', 'STRONG_SELL', 'STRONG SELL', 'REDUCE']:
                if hit_target:
                    status = 'HIT_TARGET'
                if hit_stop:
                    status = 'HIT_STOP'

            conn = self._get_predictions_conn()
            conn.execute('''UPDATE platform_recommendations
                SET final_price=?, profit_loss=?, status=?,
                    hit_target=?, hit_stop=?, updated_at=datetime('now')
                WHERE id=?''', (
                final_price, profit_loss, status,
                1 if hit_target else 0, 1 if hit_stop else 0, pred_id
            ))
            conn.commit()
            conn.close()

        except Exception as e:
            print(f"[Evaluate] Error evaluating {symbol}: {e}")

    def generate_historical(self, start_date: str = '2026-01-01',
                            end_date: str = None,
                            markets: List[str] = None,
                            progress_callback=None) -> Dict:
        """
        توليد التوقعات التاريخية لكل الأسواق
        start_date: تاريخ البداية (2026-01-01)
        end_date: تاريخ النهاية (اليوم أو آخر تاريخ متاح)
        markets: الأسواق المطلوبة (افتراضياً ALL_MARKETS)
        """
        self._create_platform_recommendations_table()

        if not end_date:
            end_date = datetime.now().strftime('%Y-%m-%d')
        if not markets:
            markets = ALL_MARKETS

        self.stats['start_time'] = time.time()

        # Initialize per-market stats
        for m in markets:
            self.stats['by_market'][m] = {'predictions': 0, 'errors': 0}

        # Get available dates in data
        available_dates = []
        for market in markets:
            dates = self.engine.get_available_dates(market)
            available_dates.extend(dates)

        available_dates = sorted(set(available_dates))
        # Filter to our date range
        available_dates = [d for d in available_dates if start_date <= d <= end_date]

        # P43-TRADING-CALENDAR: فلتر أيام الإجازة (الجمعة/السبت) للأسواق المالية.
        # المشكلة: الـ Backfill بيلف على كل الـ dates من price_history من غير ما يتشيك
        # على TradingCalendar، فسجل توقعات في السبت (EGX مقفول). ولما الـ DailyCloser
        # جاء يقفلها، لقى سعر إغلاق (نفس سعر الجمعة) فقفلها في نفس اليوم.
        # الحل: نتجاهل أي يوم isn't a trading day لـ EGX (proxy للأسواق المالية).
        # الكريبتو 24/7 فمش هيتأثر (every day is trading day).
        has_financial_market = any(m != 'العملات الرقمية' for m in markets)
        if has_financial_market:
            try:
                from utils.trading_calendar import is_trading_day
                filtered_dates = []
                skipped_non_trading = 0
                for d in available_dates:
                    try:
                        dt = datetime.strptime(d, '%Y-%m-%d')
                        # نستخدم EGX كـ proxy (كل الأسواق المالية: Sunday-Thursday)
                        if is_trading_day(dt, 'EGX'):
                            filtered_dates.append(d)
                        else:
                            skipped_non_trading += 1
                    except Exception:
                        filtered_dates.append(d)  # لو التاريخ مش مفهوم، سيبه
                if skipped_non_trading > 0:
                    print(f"[Historical] 📅 Skipped {skipped_non_trading} non-trading days (Fri/Sat) — P43-TRADING-CALENDAR")
                available_dates = filtered_dates
            except ImportError:
                print("[Historical] ⚠️ utils.trading_calendar not available — skipping trading-day filter")

        if not available_dates:
            print("[Historical] No available dates in range!")
            return {'success': False, 'message': 'No data available'}

        total_days = len(available_dates)
        print(f"[Historical] Processing {total_days} days from {start_date} to {end_date} across {len(markets)} markets")
        self.stats['total_days'] = total_days

        # Process each day
        for day_idx, date in enumerate(available_dates):
            try:
                self._process_day(date, markets)

                self.stats['days_processed'] = day_idx + 1

                if progress_callback:
                    progress_callback({
                        'current': day_idx + 1,
                        'total': total_days,
                        'date': date,
                        'predictions': self.stats['total_predictions'],
                        'percent': round((day_idx + 1) / total_days * 100, 1)
                    })
                elif (day_idx + 1) % 10 == 0:
                    elapsed = time.time() - self.stats['start_time']
                    # Build per-market summary
                    market_summary = ' | '.join(
                        f"{m}: {self.stats['by_market'][m]['predictions']}"
                        for m in markets if self.stats['by_market'][m]['predictions'] > 0
                    )
                    print(f"[Historical] Day {day_idx + 1}/{total_days} ({date}) "
                          f"- {self.stats['total_predictions']} predictions "
                          f"- [{market_summary}] "
                          f"- {elapsed:.0f}s elapsed")

            except Exception as e:
                self.stats['errors'] += 1
                print(f"[Historical] Error on {date}: {e}")

        # Evaluate all predictions that have passed their expiry
        print("[Historical] Evaluating predictions...")
        self._evaluate_all_predictions()

        # Summary
        elapsed = time.time() - self.stats['start_time']
        self.stats['duration_seconds'] = round(elapsed, 2)

        # Get final stats
        final_stats = self._get_final_stats()

        result = {
            'success': True,
            'stats': {
                **self.stats,
                **final_stats
            }
        }

        print(f"\n[Historical] === COMPLETE ===")
        print(f"  Days processed: {self.stats['days_processed']}")
        print(f"  Total predictions: {self.stats['total_predictions']}")
        print(f"  Duration: {elapsed:.0f} seconds")
        if final_stats:
            print(f"  Win rate: {final_stats.get('win_rate', 'N/A')}")
        # Print per-market summary
        for m in markets:
            ms = self.stats['by_market'].get(m, {})
            if ms.get('predictions', 0) > 0:
                print(f"  {m}: {ms['predictions']} predictions, {ms.get('errors', 0)} errors")

        return result

    def _process_day(self, date: str, markets: List[str]):
        """معالجة يوم واحد - اختيار أسهم وتوليد توقعات لكل الأسواق"""
        # Get stocks available on this date
        all_symbols = []
        for market in markets:
            symbols = self.engine.get_stocks_at_date(date, market)
            all_symbols.extend([(s, market) for s in symbols])

        if not all_symbols:
            return

        # Determine how many to analyze today (weighted by number of markets with data)
        # Bug 12.12 fix: إزالة random.sample - الباكتست لازم يجري على كل الأسهم
        selected = all_symbols  # حلل كل الأسهم (260+) بدل عينة عشوائية

        for symbol, market in selected:
            try:
                # Skip if already predicted this day
                if self._prediction_exists(symbol, date):
                    continue

                # Analyze with market_hint for proper routing
                analysis = self.engine.analyze(symbol, date, market_hint=market)
                if not analysis:
                    continue

                # Only save predictions with clear signals (not HOLD)
                # Allow BUY, STRONG BUY, ACCUMULATE, SELL, REDUCE
                if analysis['signal'] in ['HOLD', '']:
                    # CRITICAL FIX (2026-08-28): كان random.random() > 0.3 (70% skip HOLD)
                    # ده معناه 30% من إشارات HOLD كانت بتدخل عشوائياً — مش reproducible!
                    # دلوقتي: نتجاهل كل إشارات HOLD (deterministic) — لو محتاجينها نضيفها بـ flag
                    continue  # skip all HOLD signals deterministically

                # Calculate expiry date (1 month from prediction)
                pred_date = datetime.strptime(date, '%Y-%m-%d')
                expiry = pred_date + timedelta(days=MONITORING_PERIOD_DAYS)
                expiry_str = expiry.strftime('%Y-%m-%d')

                prediction = {
                    **analysis,
                    'predicted_date': date,
                    'expiry_date': expiry_str
                }

                self._save_prediction(prediction)
                self.stats['total_predictions'] += 1

                # Track per-market
                if market in self.stats['by_market']:
                    self.stats['by_market'][market]['predictions'] += 1
                else:
                    self.stats['by_market'][market] = {'predictions': 1, 'errors': 0}

                # Track signal types
                if 'BUY' in analysis['signal'] or 'ACCUMULATE' in analysis['signal']:
                    self.stats['buy_signals'] += 1
                elif 'SELL' in analysis['signal'] or 'REDUCE' in analysis['signal']:
                    self.stats['sell_signals'] += 1
                else:
                    self.stats['hold_signals'] += 1

            except Exception as e:
                self.stats['errors'] += 1
                # Track per-market error
                if market in self.stats['by_market']:
                    self.stats['by_market'][market]['errors'] += 1
                else:
                    self.stats['by_market'][market] = {'predictions': 0, 'errors': 1}

    def _evaluate_all_predictions(self):
        """تقييم كل التوقعات التي انتهت مراقبتها"""
        conn = self._get_predictions_conn()
        rows = conn.execute('''SELECT id, symbol, market, entry_price, target_price,
                    stop_loss, predicted_date, expiry_date, signal
            FROM platform_recommendations
            WHERE status = 'ACTIVE' AND expiry_date <= date('now')
        ''').fetchall()
        conn.close()

        print(f"[Evaluate] Found {len(rows)} predictions to evaluate")

        for row in rows:
            self._evaluate_prediction(
                row['id'], row['symbol'], row['market'],
                row['entry_price'], row['target_price'], row['stop_loss'],
                row['predicted_date'], row['expiry_date'], row['signal']
            )

    def _get_final_stats(self) -> Dict:
        """احصائيات نهائية"""
        try:
            conn = self._get_predictions_conn()

            total = conn.execute("SELECT COUNT(*) as c FROM platform_recommendations").fetchone()['c']

            evaluated = conn.execute(
                "SELECT COUNT(*) as c FROM platform_recommendations WHERE status != 'ACTIVE'"
            ).fetchone()['c']

            wins = conn.execute(
                "SELECT COUNT(*) as c FROM platform_recommendations WHERE status IN ('HIT_TARGET', 'WIN')"
            ).fetchone()['c']

            losses = conn.execute(
                "SELECT COUNT(*) as c FROM platform_recommendations WHERE status IN ('HIT_STOP', 'LOSS')"
            ).fetchone()['c']

            win_rate = round(wins / evaluated * 100, 1) if evaluated > 0 else 0

            avg_return = conn.execute(
                "SELECT AVG(profit_loss) as avg FROM platform_recommendations WHERE status != 'ACTIVE' AND profit_loss IS NOT NULL"
            ).fetchone()['avg']

            # By market
            markets = conn.execute(
                "SELECT market, COUNT(*) as count, "
                "SUM(CASE WHEN status IN ('HIT_TARGET', 'WIN') THEN 1 ELSE 0 END) as wins "
                "FROM platform_recommendations GROUP BY market"
            ).fetchall()

            # By signal type
            signals = conn.execute(
                "SELECT signal, COUNT(*) as count, "
                "SUM(CASE WHEN status IN ('HIT_TARGET', 'WIN') THEN 1 ELSE 0 END) as wins "
                "FROM platform_recommendations GROUP BY signal"
            ).fetchall()

            conn.close()

            return {
                'total_stored': total,
                'evaluated': evaluated,
                'wins': wins,
                'losses': losses,
                'win_rate': f"{win_rate}%",
                'avg_return': f"{round(avg_return or 0, 2)}%",
                'by_market': {r['market']: {'count': r['count'], 'wins': r['wins']} for r in markets},
                'by_signal': {r['signal']: {'count': r['count'], 'wins': r['wins']} for r in signals}
            }
        except Exception as e:
            return {'error': str(e)}


def main():
    """تشغيل مولّد التوقعات التاريخية لكل الأسواق"""
    generator = HistoricalPredictionGenerator()

    def progress(info):
        print(f"  [{info['current']}/{info['total']}] {info['date']} - "
              f"{info['predictions']} predictions ({info['percent']}%)")

    result = generator.generate_historical(
        start_date='2026-01-01',
        end_date=datetime.now().strftime('%Y-%m-%d'),
        markets=ALL_MARKETS,
        progress_callback=progress
    )

    print("\n" + "=" * 60)
    print("RESULT:")
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
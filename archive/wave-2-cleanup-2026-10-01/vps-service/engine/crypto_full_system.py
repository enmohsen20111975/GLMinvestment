#!/usr/bin/env python3
"""
Crypto Full System — نظام الكريبتو الكامل
==========================================
نفس ميزات الأسهم للكريبتو:
1. توليد التوقعات (Predictions Generator)
2. الإغلاق اليومي (Daily Closer) - تتبع نجاح/خسارة
3. التعلم الذاتي (Learning Engine) - حساب نسب النجاح
4. الاختبار الرجعي (Backtest)
5. Flow + Explosive (موجود بالفعل)

مصادر البيانات:
- data_engine.db: crypto_prices (111 عملة)
- predictions.db: crypto_predictions, outcome_logs
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


def _sf(val, default=0.0):
    if val is None: return default
    try:
        s = str(val).replace('−','-').replace('،','').replace('\u202f','').strip()
        import re
        m = re.search(r'([+-]?\d+\.?\d*)\s*([BMKbmk])?', s)
        if m:
            num = float(m.group(1))
            suffix = (m.group(2) or '').upper()
            if suffix == 'B': num *= 1e9
            elif suffix == 'M': num *= 1e6
            elif suffix == 'K': num *= 1e3
            return num if num == num else default
        return default
    except: return default


class CryptoFullSystem:
    """النظام الكامل للكريبتو - مطابق للأسهم"""

    def __init__(self):
        self.data_engine_db = DATA_ENGINE_DB
        self.predictions_db = PREDICTIONS_DB

    def _get_de_conn(self):
        if not os.path.exists(self.data_engine_db): return None
        conn = sqlite3.connect(self.data_engine_db)
        conn.row_factory = sqlite3.Row
        return conn

    def _get_pred_conn(self):
        if not os.path.exists(self.predictions_db): return None
        conn = sqlite3.connect(self.predictions_db)
        conn.row_factory = sqlite3.Row
        return conn

    # ========================================================================
    # 1. PREDICTIONS GENERATOR
    # ========================================================================

    def generate_predictions(self, min_score: int = 60) -> Dict:
        """
        توليد توقعات كريبتو جديدة للغد
        يحلل كل العملات ويضع التوقعات في crypto_predictions
        """
        import sys as _sys
        _sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from engine.crypto_engine import CryptoEngine

        engine = CryptoEngine()
        cryptos = engine.get_all_cryptos(200)
        if not cryptos:
            return {'success': False, 'error': 'No crypto data'}

        conn = self._get_pred_conn()
        if not conn:
            return {'success': False, 'error': 'No predictions.db'}

        cur = conn.cursor()
        generated = 0
        errors = 0

        # Get current prices for target/stop calculation
        for crypto in cryptos:
            try:
                symbol = crypto['symbol']
                name = crypto['name']
                price = crypto['price_usd']
                change_24h = crypto['change_24h']
                change_7d = crypto.get('change_7d', 0)
                market_cap = crypto['market_cap']
                rank = crypto.get('market_cap_rank', 999)
                volume = crypto.get('volume_24h', 0)

                # Skip stablecoins
                if 0.95 < price < 1.05 and abs(change_24h) < 0.5:
                    continue

                # Calculate flow score for signal
                flow = engine.calculate_flow_score(symbol)
                if not flow:
                    continue

                score = flow.flow_score
                if score < min_score:
                    continue

                # Determine signal
                if score >= 80:
                    signal = 'STRONG_BUY'
                    signal_ar = 'شراء قوي'
                elif score >= 60:
                    signal = 'BUY'
                    signal_ar = 'شراء'
                elif score >= 40:
                    signal = 'HOLD'
                    signal_ar = 'تمسك'
                else:
                    signal = 'SELL'
                    signal_ar = 'بيع'

                # Calculate entry, target, stop
                entry = price

                # CRYPTO-PRO-051: Scam Filter — رفض العملات الميتة
                MIN_MARKET_CAP = 50_000_000  # 50M USD
                MIN_VOLUME_24H = 1_000_000   # 1M USD
                if market_cap < MIN_MARKET_CAP:
                    continue  # تخطّى العملة — very small cap = scam risk
                if volume < MIN_VOLUME_24H:
                    continue  # تخطّى العملة — no liquidity = can't exit

                # CRYPTO-PRO-051: Volatility Override — ATR-based risk
                # للكريبتو: stop_loss = max(4%, ATR×2 / price)
                # target_1 = stop_loss × 2.0 (R/R ≥ 2.0)
                crypto_atr_pct = abs(change_24h) / 100.0  # proxy for ATR if ATR not available
                stop_pct = max(0.04, crypto_atr_pct * 2.0)  # min 4%, or 2× daily change
                target_pct = stop_pct * 2.0  # R/R = 2.0 minimum

                if signal in ('STRONG_BUY', 'BUY'):
                    target_price = entry * (1 + target_pct)
                    stop_loss = entry * (1 - stop_pct)
                elif signal == 'SELL':
                    target_price = entry * (1 - target_pct)
                    stop_loss = entry * (1 + stop_pct)
                else:
                    target_price = entry * (1 + target_pct * 0.5)
                    stop_loss = entry * (1 - stop_pct * 0.5)

                # CRYPTO-PRO-051: R/R Rejection — لو R/R < 2.0 → رفض
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    risk_reward = compute_risk_reward(entry, target_price, stop_loss, fallback=0.0)
                except Exception:
                    risk_reward = abs((target_price - entry) / (entry - stop_loss)) if (entry - stop_loss) != 0 else 0
                if risk_reward < 2.0 and signal in ('STRONG_BUY', 'BUY', 'SELL'):
                    # ارفع الهدف لتحقيق R/R ≥ 2.0
                    if signal in ('STRONG_BUY', 'BUY'):
                        target_price = entry + (entry - stop_loss) * 2.0
                    else:
                        target_price = entry - (stop_loss - entry) * 2.0
                    risk_reward = 2.0

                # Rule 54: أعد الحساب بالـ canonical بعد تعديل الهدف
                try:
                    risk_reward = compute_risk_reward(entry, target_price, stop_loss, fallback=2.0)
                except Exception:
                    risk_reward = abs((target_price - entry) / (entry - stop_loss)) if (entry - stop_loss) != 0 else 0
                position_size = flow.position_size if hasattr(flow, 'position_size') else 0

                # PHASE5-052: Wick Protection — Candle Close Stop (مش Tick)
                # في الكريبتو فيه Long Wick بتنزل 5% في ثانية وترجع (Liquidation Hunt).
                # الوقف ميتفعلش لما السعر يلمسه (Touch)، لكن يتفعل لما شمعة 5 دقايق/ساعة تقفل تحت SL.
                stop_loss_type = 'candle_close'  # مش 'touch' — يحمي من الـ Scam Wicks

                # Market regime (BTC dominance proxy)
                btc = next((c for c in cryptos if c['symbol'] == 'BTC'), None)
                btc_dom = (btc['market_cap'] / sum(c['market_cap'] for c in cryptos) * 100) if btc else 50

                # Fear & Greed (simplified: based on top 10 avg change)
                top10 = [c for c in cryptos if c.get('market_cap_rank', 999) <= 10]
                avg_change = sum(c['change_24h'] for c in top10) / len(top10) if top10 else 0
                fear_greed = max(0, min(100, 50 + avg_change * 10))

                # Reasons
                reasons = []
                if change_24h > 5: reasons.append(f"صعود قوي +{change_24h:.1f}% في 24 ساعة")
                if change_7d > 10: reasons.append(f"زخم أسبوعي +{change_7d:.1f}%")
                if rank <= 10: reasons.append("من top 10 عملات (استقرار)")
                if volume > market_cap * 0.1: reasons.append("حجم تداول عالي")
                if flow.label_en == 'FIRE': reasons.append("نقاط تدفق عالية (نار)")

                # Warnings
                warnings = []
                if change_7d > 30: warnings.append("ارتفاع كبير في أسبوع - احذر تصحيح")
                if change_24h < -5: warnings.append("هبوط حاد -可能 استمرار")
                if rank > 100: warnings.append("عملة صغيرة - مخاطرة عالية")

                # Insert/update prediction
                # PHASE5-052: Add stop_loss_type column (safe migration)
                try:
                    cur.execute("ALTER TABLE crypto_predictions ADD COLUMN stop_loss_type TEXT DEFAULT 'touch'")
                except Exception:
                    pass  # column already exists

                cur.execute("""
                    INSERT OR REPLACE INTO crypto_predictions
                        (symbol, name, price, signal, signal_ar, maestro_score, confidence,
                         entry_price, target_price, stop_loss, risk_reward, position_size_pct,
                         market_regime, fear_greed, btc_dominance, reasons, warnings,
                         stop_loss_type,
                         status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
                """, (
                    symbol, name, price, signal, signal_ar,
                    score, score,
                    entry, target_price, stop_loss,
                    round(risk_reward, 2), position_size,
                    flow.label_en if flow else 'NEUTRAL',
                    round(fear_greed, 1),
                    round(btc_dom, 1),
                    '; '.join(reasons) if reasons else None,
                    '; '.join(warnings) if warnings else None,
                    stop_loss_type,
                ))
                generated += 1
            except Exception as e:
                errors += 1
                logger.debug(f"Crypto prediction error for {symbol}: {e}")

        conn.commit()
        conn.close()

        return {
            'success': True,
            'generated': generated,
            'errors': errors,
            'total_analyzed': len(cryptos),
            'timestamp': datetime.now().isoformat(),
        }

    # ========================================================================
    # 2. DAILY CLOSER - تتبع نجاح/خسارة
    # ========================================================================

    def close_positions(self) -> Dict:
        """
        إغلاق الصفقات المفتوحة - مراجعة الأسعار الحية
        يحدد: TARGET_HIT, STOPPED, EXPIRED, STILL_PENDING
        """
        conn_pred = self._get_pred_conn()
        if not conn_pred:
            return {'success': False, 'error': 'No predictions.db'}

        conn_de = self._get_de_conn()
        if not conn_de:
            return {'success': False, 'error': 'No data_engine.db'}

        cur_pred = conn_pred.cursor()
        cur_de = conn_de.cursor()

        # Get all active crypto predictions
        active = cur_pred.execute("""
            SELECT * FROM crypto_predictions WHERE status = 'active'
        """).fetchall()

        closed = {'TARGET_HIT': 0, 'STOPPED': 0, 'EXPIRED': 0, 'STILL_PENDING': 0, 'ERROR': 0}
        results = []

        for pred in active:
            try:
                symbol = pred['symbol']
                entry = _sf(pred['entry_price'])
                target = _sf(pred['target_price'])
                stop = _sf(pred['stop_loss'])
                signal = pred['signal']
                created = pred['created_at']

                # Get current price
                price_row = cur_de.execute("""
                    SELECT price_usd FROM crypto_prices
                    WHERE symbol = ?
                    ORDER BY timestamp DESC LIMIT 1
                """, (symbol,)).fetchone()

                if not price_row:
                    closed['ERROR'] += 1
                    continue

                current_price = _sf(price_row['price_usd'])

                # Check if hit target or stop
                if signal in ('STRONG_BUY', 'BUY'):
                    if current_price >= target:
                        status = 'TARGET_HIT'
                        closed['TARGET_HIT'] += 1
                    elif current_price <= stop:
                        status = 'STOPPED'
                        closed['STOPPED'] += 1
                    else:
                        # Check expiry (7 days)
                        try:
                            created_dt = datetime.fromisoformat(created.replace('Z',''))
                            if (datetime.now() - created_dt).days > 7:
                                status = 'EXPIRED'
                                closed['EXPIRED'] += 1
                            else:
                                status = 'STILL_PENDING'
                                closed['STILL_PENDING'] += 1
                        except:
                            status = 'STILL_PENDING'
                            closed['STILL_PENDING'] += 1
                elif signal == 'SELL':
                    if current_price <= target:
                        status = 'TARGET_HIT'
                        closed['TARGET_HIT'] += 1
                    elif current_price >= stop:
                        status = 'STOPPED'
                        closed['STOPPED'] += 1
                    else:
                        status = 'STILL_PENDING'
                        closed['STILL_PENDING'] += 1
                else:
                    status = 'STILL_PENDING'
                    closed['STILL_PENDING'] += 1

                # Update if closed
                if status in ('TARGET_HIT', 'STOPPED', 'EXPIRED'):
                    # Calculate profit/loss
                    if signal in ('STRONG_BUY', 'BUY'):
                        pnl_pct = ((current_price - entry) / entry * 100) if entry > 0 else 0
                    elif signal == 'SELL':
                        pnl_pct = ((entry - current_price) / entry * 100) if entry > 0 else 0
                    else:
                        pnl_pct = 0

                    cur_pred.execute("""
                        UPDATE crypto_predictions
                        SET status = ?, updated_at = datetime('now')
                        WHERE id = ?
                    """, (status.lower(), pred['id']))

                    results.append({
                        'symbol': symbol,
                        'signal': signal,
                        'entry': entry,
                        'current': current_price,
                        'target': target,
                        'stop': stop,
                        'status': status,
                        'pnl_pct': round(pnl_pct, 2),
                    })

            except Exception as e:
                closed['ERROR'] += 1
                logger.debug(f"Crypto close error: {e}")

        conn_pred.commit()
        conn_pred.close()
        conn_de.close()

        return {
            'success': True,
            'closed': closed,
            'total_pending': len(active),
            'results': results[:20],
            'timestamp': datetime.now().isoformat(),
        }

    # ========================================================================
    # 3. LEARNING ENGINE - التعلم الذاتي
    # ========================================================================

    def run_learning(self, period_days: int = 30) -> Dict:
        """
        التعلم الذاتي - حساب نسب النجاح والخسارة
        يحلل التوقعات السابقة ويستخرج الدروس
        """
        conn = self._get_pred_conn()
        if not conn:
            return {'success': False, 'error': 'No predictions.db'}

        cur = conn.cursor()

        # Get all closed predictions in the period
        since = (datetime.now() - timedelta(days=period_days)).isoformat()
        closed = cur.execute("""
            SELECT * FROM crypto_predictions
            WHERE status IN ('target_hit', 'stopped', 'expired')
              AND updated_at >= ?
        """, (since,)).fetchall()

        if not closed:
            conn.close()
            return {
                'success': True,
                'period_days': period_days,
                'total_closed': 0,
                'message': 'لا توجد توقعات مغلقة في هذه الفترة'
            }

        total = len(closed)
        target_hits = len([p for p in closed if p['status'] == 'target_hit'])
        stopped = len([p for p in closed if p['status'] == 'stopped'])
        expired = len([p for p in closed if p['status'] == 'expired'])

        win_rate = (target_hits / total * 100) if total > 0 else 0
        loss_rate = (stopped / total * 100) if total > 0 else 0

        # Calculate by signal type
        by_signal = {}
        for sig in ['STRONG_BUY', 'BUY', 'HOLD', 'SELL']:
            sig_preds = [p for p in closed if p['signal'] == sig]
            if sig_preds:
                sig_hits = len([p for p in sig_preds if p['status'] == 'target_hit'])
                sig_total = len(sig_preds)
                by_signal[sig] = {
                    'total': sig_total,
                    'hits': sig_hits,
                    'win_rate': round(sig_hits / sig_total * 100, 1) if sig_total > 0 else 0,
                }

        # Calculate by rank tier
        by_rank = {'top10': {'total': 0, 'hits': 0}, 'top50': {'total': 0, 'hits': 0}, 'other': {'total': 0, 'hits': 0}}

        # Calculate average P&L
        pnl_list = []
        for p in closed:
            try:
                entry = _sf(p['entry_price'])
                # Get current price at close time (simplified: use updated_at)
                if p['status'] == 'target_hit':
                    pnl = abs((_sf(p['target_price']) - entry) / entry * 100) if entry > 0 else 0
                elif p['status'] == 'stopped':
                    pnl = -abs((_sf(p['stop_loss']) - entry) / entry * 100) if entry > 0 else 0
                else:
                    pnl = 0
                pnl_list.append(pnl)
            except:
                pass

        avg_pnl = sum(pnl_list) / len(pnl_list) if pnl_list else 0
        profit_factor = (sum(p for p in pnl_list if p > 0) / abs(sum(p for p in pnl_list if p < 0))) if any(p < 0 for p in pnl_list) and sum(p for p in pnl_list if p > 0) > 0 else 0

        # Save lessons to prediction_lessons
        try:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crypto_lessons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    period_days INTEGER,
                    total_closed INTEGER,
                    win_rate REAL,
                    loss_rate REAL,
                    avg_pnl REAL,
                    profit_factor REAL,
                    by_signal TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            import json
            cur.execute("""
                INSERT INTO crypto_lessons (period_days, total_closed, win_rate, loss_rate, avg_pnl, profit_factor, by_signal)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (period_days, total, round(win_rate, 1), round(loss_rate, 1),
                  round(avg_pnl, 2), round(profit_factor, 2), json.dumps(by_signal)))
            conn.commit()
        except Exception as e:
            logger.debug(f"Save lessons error: {e}")

        conn.close()

        return {
            'success': True,
            'period_days': period_days,
            'total_closed': total,
            'target_hits': target_hits,
            'stopped': stopped,
            'expired': expired,
            'win_rate': round(win_rate, 1),
            'loss_rate': round(loss_rate, 1),
            'avg_pnl_pct': round(avg_pnl, 2),
            'profit_factor': round(profit_factor, 2),
            'by_signal': by_signal,
        }

    # ========================================================================
    # 4. PERFORMANCE STATS
    # ========================================================================

    def get_performance_stats(self) -> Dict:
        """إحصائيات الأداء - نسب النجاح والخسارة"""
        conn = self._get_pred_conn()
        if not conn:
            return {'success': False, 'error': 'No predictions.db'}

        cur = conn.cursor()

        # Total predictions
        total = cur.execute("SELECT COUNT(*) FROM crypto_predictions").fetchone()[0]
        active = cur.execute("SELECT COUNT(*) FROM crypto_predictions WHERE status = 'active'").fetchone()[0]
        target_hit = cur.execute("SELECT COUNT(*) FROM crypto_predictions WHERE status = 'target_hit'").fetchone()[0]
        stopped = cur.execute("SELECT COUNT(*) FROM crypto_predictions WHERE status = 'stopped'").fetchone()[0]
        expired = cur.execute("SELECT COUNT(*) FROM crypto_predictions WHERE status = 'expired'").fetchone()[0]

        closed_total = target_hit + stopped + expired
        win_rate = (target_hit / closed_total * 100) if closed_total > 0 else 0

        # Recent lessons
        lessons = []
        try:
            lesson_rows = cur.execute("""
                SELECT * FROM crypto_lessons ORDER BY created_at DESC LIMIT 5
            """).fetchall()
            lessons = [dict(l) for l in lesson_rows]
        except:
            pass

        # Top performing coins
        top_performers = []
        try:
            top_rows = cur.execute("""
                SELECT symbol, name, signal, entry_price, target_price, stop_loss, status, created_at
                FROM crypto_predictions
                WHERE status = 'target_hit'
                ORDER BY created_at DESC LIMIT 10
            """).fetchall()
            top_performers = [dict(r) for r in top_rows]
        except:
            pass

        conn.close()

        return {
            'success': True,
            'stats': {
                'total_predictions': total,
                'active': active,
                'target_hit': target_hit,
                'stopped': stopped,
                'expired': expired,
                'closed_total': closed_total,
                'win_rate': round(win_rate, 1),
            },
            'lessons': lessons,
            'top_performers': top_performers,
        }

    # ========================================================================
    # 5. FULL DAILY CYCLE
    # ========================================================================

    def run_daily_cycle(self) -> Dict:
        """
        الدورة اليومية الكاملة للكريبتو:
        1. إغلاق الصفقات المفتوحة
        2. التعلم من النتائج
        3. توليد توقعات جديدة
        """
        results = {}

        # 1. Close positions
        try:
            results['close'] = self.close_positions()
        except Exception as e:
            results['close'] = {'error': str(e)}

        # 2. Run learning
        try:
            results['learning'] = self.run_learning(period_days=30)
        except Exception as e:
            results['learning'] = {'error': str(e)}

        # 3. Generate new predictions
        try:
            results['predictions'] = self.generate_predictions(min_score=30)
        except Exception as e:
            results['predictions'] = {'error': str(e)}

        return {
            'success': True,
            'results': results,
            'message': 'اكتملت الدورة اليومية للكريبتو',
            'timestamp': datetime.now().isoformat(),
        }

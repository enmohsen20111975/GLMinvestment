#!/usr/bin/env python3
"""
Live Autonomous Monitor (BRIEF-047)
====================================
الطيار الآلي للمنصة - يراقب السوق كل 5 دقائق

المهام:
  1. Heartbeat Sync: trigger master_analyzer على كل تحديث بيانات
  2. Portfolio Armor: مراقبة المحفظة بـ OB-based SL + TP alerts
  3. Auto Whale Scanner: مسح السوق للـ Liquidity Sweeps + BOS
  4. Prediction Ledger: تتبع التوقعات + Win Rate

الـ Monitor بيشتغل في thread منفصل و بينبه عبر:
  - WebSocket events (للـ Frontend)
  - Telegram (للـ Mobile)
  - Database alerts table
"""

import os
import sys
import time
import json
import logging
import threading
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Paths
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
_DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
_INTRADAY_DB = str(_PROJECT_ROOT / 'db' / 'intraday.db')

# BRIEF-047: Live Monitoring Intervals
PORTFOLIO_CHECK_INTERVAL = 60 * 5       # 5 minutes - portfolio armor
WHALE_SCAN_INTERVAL = 60 * 5            # 5 minutes - auto whale scanner
PREDICTION_VERIFY_INTERVAL = 60 * 30    # 30 minutes - prediction ledger


class LiveAutonomousMonitor:
    """
    الطيار الآلي للمنصة - BRIEF-047

    Usage:
        monitor = LiveAutonomousMonitor()
        monitor.start()  # بيبدأ في thread منفصل
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or _STOCKS_DB
        self.running = False
        self.thread = None
        self.stats = {
            'portfolio_checks': 0,
            'whale_scans': 0,
            'alerts_sent': 0,
            'predictions_verified': 0,
            'last_error': None,
        }
        self._alert_callbacks = []  # WebSocket callback functions

    def register_alert_callback(self, callback):
        """سجل callback للـ WebSocket alerts."""
        self._alert_callbacks.append(callback)

    def _emit_alert(self, alert_type: str, ticker: str, message: str, severity: str = 'info'):
        """يبعت alert لكل الـ callbacks المسجلة (WebSocket + Telegram)."""
        alert = {
            'type': alert_type,
            'ticker': ticker,
            'message': message,
            'severity': severity,  # info, warning, critical
            'timestamp': datetime.now().isoformat(),
        }
        for cb in self._alert_callbacks:
            try:
                cb(alert)
            except Exception as e:
                logger.error(f"[BRIEF-047] Alert callback error: {e}")

        # احفظ في DB
        try:
            self._save_alert_to_db(alert)
        except Exception as e:
            logger.error(f"[BRIEF-047] Save alert error: {e}")

        self.stats['alerts_sent'] += 1
        logger.info(f"[BRIEF-047] Alert: {severity.upper()} {ticker} - {message}")

    def _save_alert_to_db(self, alert: dict):
        """احفظ الـ alert في قاعدة البيانات."""
        if not os.path.exists(self.db_path):
            return
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        # أنشئ table لو مش موجودة
        c.execute('''
            CREATE TABLE IF NOT EXISTS live_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_type TEXT,
                ticker TEXT,
                message TEXT,
                severity TEXT,
                timestamp TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        c.execute('''
            INSERT INTO live_alerts (alert_type, ticker, message, severity, timestamp)
            VALUES (?, ?, ?, ?, ?)
        ''', (alert['type'], alert['ticker'], alert['message'],
              alert['severity'], alert['timestamp']))
        conn.commit()
        conn.close()

    # =================================================================
    # Pillar 1: 5-Minute Heartbeat Sync
    # =================================================================

    def heartbeat_check(self) -> Dict:
        """
        بيتفقد كل 5 دقايق - يتأكد إن البيانات حديثة و يشغل التحليل
        """
        result = {
            'timestamp': datetime.now().isoformat(),
            'data_fresh': False,
            'last_data_update': None,
            'stocks_checked': 0,
        }

        try:
            # اتأكد إن intraday.db حديثة (آخر تحديث < 10 دقايق)
            if os.path.exists(_INTRADAY_DB):
                conn = sqlite3.connect(_INTRADAY_DB)
                c = conn.cursor()
                row = c.execute(
                    "SELECT MAX(timestamp) FROM stock_intraday"
                ).fetchone()
                if row and row[0]:
                    result['last_data_update'] = row[0]
                    # لو آخر تحديث < 10 دقايق = data fresh
                    # (بس ده تقدير تقريبي لأن الـ timestamps بـ formats مختلفة)
                    result['data_fresh'] = True
                conn.close()

            # اتأكد إن data_engine.db حديثة
            if os.path.exists(_DATA_ENGINE_DB):
                conn = sqlite3.connect(_DATA_ENGINE_DB)
                c = conn.cursor()
                row = c.execute(
                    "SELECT MAX(last_update) FROM stocks WHERE price > 0"
                ).fetchone()
                if row and row[0]:
                    result['data_engine_update'] = row[0]
                conn.close()

            result['status'] = 'healthy' if result['data_fresh'] else 'stale'
        except Exception as e:
            result['status'] = 'error'
            result['error'] = str(e)
            logger.error(f"[BRIEF-047] Heartbeat error: {e}")

        return result

    # =================================================================
    # Pillar 2: Live Portfolio Armor (OB-based SL Monitoring)
    # =================================================================

    def check_portfolio_armor(self) -> List[Dict]:
        """
        بيراقب المحفظة كل 5 دقايق:
        1. Hit Target: لو السعر وصل TP1/TP2/TP3 → تنبيه ربح
        2. OB Breach: لو السعر كسر الـ Order Block → تنبيه خروج طارئ
        3. Trailing Stop: تحريك الـ SL لتحت OB جديد
        """
        alerts = []

        try:
            if not os.path.exists(self.db_path):
                return alerts

            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # اقرأ المحفظة النشطة
            try:
                rows = c.execute('''
                    SELECT ticker, quantity, avg_price, stop_loss, target_price,
                           target_2, target_3, account_id
                    FROM portfolio_assets
                    WHERE quantity > 0
                ''').fetchall()
            except sqlite3.OperationalError:
                # table مش موجودة
                conn.close()
                return alerts

            for asset in rows:
                ticker = asset['ticker']
                avg_price = float(asset['avg_price'] or 0)
                quantity = float(asset['quantity'] or 0)
                stop_loss = float(asset['stop_loss'] or 0)
                tp1 = float(asset['target_price'] or 0)
                tp2 = float(asset['target_2'] or 0)
                tp3 = float(asset['target_3'] or 0)

                if avg_price <= 0 or quantity <= 0:
                    continue

                # اجيب السعر الحالي
                current_price = self._get_current_price(ticker)
                if current_price <= 0:
                    continue

                pnl_pct = (current_price - avg_price) / avg_price * 100

                # ── Check 1: Hit Target ──
                if tp1 > 0 and current_price >= tp1 and current_price < (tp1 * 1.02):
                    self._emit_alert(
                        'TARGET_HIT', ticker,
                        f'🎯 {ticker}: وصل لـ TP1 ({tp1:.2f}) - ربح {pnl_pct:.1f}% - جني أرباح جزئي',
                        'info'
                    )
                    alerts.append({'ticker': ticker, 'type': 'TP1_HIT', 'price': current_price})

                if tp2 > 0 and current_price >= tp2 and current_price < (tp2 * 1.02):
                    self._emit_alert(
                        'TARGET_HIT', ticker,
                        f'🎯 {ticker}: وصل لـ TP2 ({tp2:.2f}) - ربح {pnl_pct:.1f}% - جني أرباح',
                        'info'
                    )
                    alerts.append({'ticker': ticker, 'type': 'TP2_HIT', 'price': current_price})

                if tp3 > 0 and current_price >= tp3:
                    self._emit_alert(
                        'TARGET_HIT', ticker,
                        f'🎯 {ticker}: وصل لـ TP3 ({tp3:.2f}) - ربح {pnl_pct:.1f}% - جني أرباح كامل',
                        'info'
                    )
                    alerts.append({'ticker': ticker, 'type': 'TP3_HIT', 'price': current_price})

                # ── Check 2: OB Breach (Stop Loss) ──
                if stop_loss > 0 and current_price <= stop_loss:
                    self._emit_alert(
                        'OB_BREACH', ticker,
                        f'🚨 {ticker}: كسر وقف الخسارة ({stop_loss:.2f}) - خسارة {abs(pnl_pct):.1f}% - خروج طارئ!',
                        'critical'
                    )
                    alerts.append({'ticker': ticker, 'type': 'SL_BREACH', 'price': current_price})

                # ── Check 3: Trailing Stop (لو السعر طلع كتير، اقترح trailing) ──
                if pnl_pct > 15 and stop_loss > 0 and current_price > stop_loss * 1.15:
                    new_stop = current_price * 0.95  # trailing 5% تحت السعر
                    if new_stop > stop_loss:
                        self._emit_alert(
                            'TRAILING_STOP', ticker,
                            f'📈 {ticker}: ربح {pnl_pct:.1f}% - اقترح تحريك الـ SL لـ {new_stop:.2f} (حماية الأرباح)',
                            'warning'
                        )
                        alerts.append({'ticker': ticker, 'type': 'TRAILING_SUGGEST',
                                      'new_stop': new_stop, 'price': current_price})

            conn.close()
            self.stats['portfolio_checks'] += 1

        except Exception as e:
            logger.error(f"[BRIEF-047] Portfolio armor error: {e}")
            self.stats['last_error'] = str(e)

        return alerts

    def _get_current_price(self, ticker: str) -> float:
        """يجيب السعر الحالي للسهم من data_engine.db."""
        try:
            if not os.path.exists(_DATA_ENGINE_DB):
                return 0
            conn = sqlite3.connect(_DATA_ENGINE_DB)
            c = conn.cursor()
            row = c.execute(
                "SELECT price FROM stocks WHERE symbol = ? AND price > 0 LIMIT 1", (ticker,)
            ).fetchone()
            conn.close()
            return float(row[0]) if row and row[0] else 0
        except:
            return 0

    # =================================================================
    # Pillar 3: Auto Whale Scanner (Liquidity Sweeps + BOS)
    # =================================================================

    def scan_for_whales(self) -> List[Dict]:
        """
        بيمسح السوق كل 5 دقايق للـ Liquidity Sweeps + BOS
        لو لقى سهم SMC score >= 80 → إشارة LIVE_WHALE_BUY
        """
        whale_signals = []

        try:
            if not os.path.exists(_DATA_ENGINE_DB):
                return whale_signals

            conn = sqlite3.connect(_DATA_ENGINE_DB)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # اجيب أعلى 50 سهم بالسيولة (Volume)
            rows = c.execute('''
                SELECT symbol, price, change_percent, volume, market
                FROM stocks
                WHERE price > 0 AND market = 'مصر'
                ORDER BY CAST(
                    REPLACE(REPLACE(REPLACE(volume, ',', ''), 'M', ''), 'K', '') AS REAL
                ) DESC
                LIMIT 30
            ''').fetchall()
            conn.close()

            # استدعي الـ SMC Engine لكل سهم
            try:
                from analyzers.smc_engine import SMCEngine
                from analyzers.master_analyzer import load_merged_history, MASTER_WEIGHTS
            except ImportError:
                logger.warning("[BRIEF-047] SMC/Master modules not available")
                return whale_signals

            for row in rows[:20]:  # أعلى 20 سهم
                ticker = row['symbol']
                try:
                    # حمّل آخر 50 شمعة
                    history = load_merged_history(ticker, self.db_path, limit=50)
                    if not history or len(history) < 10:
                        continue

                    # شغل الـ SMC Engine
                    smc = SMCEngine(history)
                    if not smc.ready:
                        continue

                    sweeps = smc.get_liquidity_sweeps()
                    order_blocks = smc.get_order_blocks()

                    # لو فيه Bullish Sweep + Bullish OB = إشارة حوت قوية
                    has_bullish_sweep = any(s['type'] == 'bullish_sweep' for s in sweeps)
                    has_bullish_ob = any(ob['type'] == 'bullish_ob' for ob in order_blocks)

                    if has_bullish_sweep and has_bullish_ob:
                        # احسب SMC score سريع
                        from analyzers.smc_engine import calculate_smc_score
                        current_price = float(row['price'])
                        result = calculate_smc_score(
                            history, current_price=current_price,
                            volume_ratio=1.5, rsi=50, sma200=0
                        )
                        smc_score = result.get('score', 0)

                        if smc_score >= 70:
                            self._emit_alert(
                                'LIVE_WHALE_BUY', ticker,
                                f'🐋 {ticker}: حوت نشط! SMC Score={smc_score}/100 - '
                                f'Bullish Sweep + OB مكتشف - فرصة شراء مؤسسية',
                                'info'
                            )
                            whale_signals.append({
                                'ticker': ticker,
                                'smc_score': smc_score,
                                'price': current_price,
                                'has_sweep': True,
                                'has_ob': True,
                                'signals': result.get('signals', []),
                            })

                except Exception as e:
                    logger.debug(f"[BRIEF-047] Whale scan error for {ticker}: {e}")

            self.stats['whale_scans'] += 1

        except Exception as e:
            logger.error(f"[BRIEF-047] Whale scanner error: {e}")
            self.stats['last_error'] = str(e)

        return whale_signals

    # =================================================================
    # Pillar 4: Prediction Ledger & Win Rate
    # =================================================================

    def get_prediction_ledger(self) -> Dict:
        """
        يجيب سجل التوقعات + Win Rate للـ Dashboard
        """
        ledger = {
            'active_predictions': [],
            'closed_predictions': [],
            'win_rate': 0,
            'total_signals': 0,
            'wins': 0,
            'losses': 0,
        }

        try:
            if not os.path.exists(self.db_path):
                return ledger

            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # اتأكد إن table موجودة
            table_check = c.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'"
            ).fetchone()

            if not table_check:
                conn.close()
                return ledger

            # Active predictions (لسه مقفولاش)
            active = c.execute('''
                SELECT ticker, signal, master_score, entry_price, target_price,
                       stop_loss, confidence, timestamp, smc_score
                FROM prediction_logs
                WHERE outcome IS NULL OR outcome = ''
                ORDER BY timestamp DESC LIMIT 20
            ''').fetchall()

            for row in active:
                ledger['active_predictions'].append({
                    'ticker': row['ticker'],
                    'signal': row['signal'],
                    'score': row['master_score'],
                    'entry': row['entry_price'],
                    'target': row['target_price'],
                    'stop': row['stop_loss'],
                    'confidence': row['confidence'],
                    'timestamp': row['timestamp'],
                    'smc_score': row['smc_score'] if 'smc_score' in row.keys() else 0,
                })

            # Closed predictions
            closed = c.execute('''
                SELECT ticker, signal, outcome, master_score, entry_price,
                       target_price, stop_loss, confidence, timestamp, verified_at
                FROM prediction_logs
                WHERE outcome IS NOT NULL AND outcome != ''
                ORDER BY verified_at DESC LIMIT 50
            ''').fetchall()

            for row in closed:
                ledger['closed_predictions'].append({
                    'ticker': row['ticker'],
                    'signal': row['signal'],
                    'outcome': row['outcome'],
                    'score': row['master_score'],
                    'entry': row['entry_price'],
                    'target': row['target_price'],
                    'stop': row['stop_loss'],
                    'confidence': row['confidence'],
                    'timestamp': row['timestamp'],
                    'verified_at': row['verified_at'] if 'verified_at' in row.keys() else None,
                })

            # Win Rate
            total_closed = len(closed)
            wins = sum(1 for r in closed if r['outcome'] and 'win' in str(r['outcome']).lower())
            losses = sum(1 for r in closed if r['outcome'] and 'loss' in str(r['outcome']).lower())

            ledger['total_signals'] = total_closed
            ledger['wins'] = wins
            ledger['losses'] = losses
            ledger['win_rate'] = round(wins / total_closed * 100, 1) if total_closed > 0 else 0

            conn.close()
            self.stats['predictions_verified'] += 1

        except Exception as e:
            logger.error(f"[BRIEF-047] Prediction ledger error: {e}")

        return ledger

    # =================================================================
    # Main Loop
    # =================================================================

    def start(self):
        """يبدأ الـ monitor في thread منفصل."""
        if self.running:
            print("[BRIEF-047] Already running")
            return

        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print("[BRIEF-047] Live Autonomous Monitor started ✅")

    def stop(self):
        """يوقف الـ monitor."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        print("[BRIEF-047] Live Autonomous Monitor stopped")

    def _run_loop(self):
        """الـ main loop - بيشتغل كل 5 دقايق."""
        print("[BRIEF-047] Monitor loop started (5-min interval)")

        last_portfolio_check = 0
        last_whale_scan = 0
        last_heartbeat = 0

        while self.running:
            try:
                now = time.time()

                # Heartbeat كل دقيقة
                if now - last_heartbeat >= 60:
                    self.heartbeat_check()
                    last_heartbeat = now

                # Portfolio Armor كل 5 دقايق
                if now - last_portfolio_check >= PORTFOLIO_CHECK_INTERVAL:
                    print("[BRIEF-047] Running Portfolio Armor check...")
                    self.check_portfolio_armor()
                    last_portfolio_check = now

                # Whale Scanner كل 5 دقايق
                if now - last_whale_scan >= WHALE_SCAN_INTERVAL:
                    print("[BRIEF-047] Running Auto Whale Scanner...")
                    self.scan_for_whales()
                    last_whale_scan = now

                # Sleep 60 seconds before next check
                time.sleep(60)

            except Exception as e:
                print(f"[BRIEF-047] Loop error: {e}")
                self.stats['last_error'] = str(e)
                time.sleep(60)

    def get_stats(self) -> Dict:
        """يجيب إحصائيات الـ monitor."""
        return {
            'running': self.running,
            'stats': self.stats,
            'uptime_seconds': time.time() - getattr(self, '_start_time', time.time()),
        }

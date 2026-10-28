#!/usr/bin/env python3
"""
Market Scheduler — الجدول المركزي
===================================
جدول مركزي واحد بدل 3 متصارعين.
يحدد متى يشتغل كل محرك بناءً على توقيت القاهرة.

Author: دليل الاستثمار
"""

import os
import time
import logging
import threading
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Callable

# BATCH-B FIX (2026-10-28): removed global monkey-patching of sqlite3.connect.
# Replacement: explicit _safe_connect() helper — same WAL + busy_timeout + FK,
# but only for connections opened by market_scheduler (not globally).
import sqlite3

def _safe_connect(db_path: str, timeout: float = 30.0) -> sqlite3.Connection:
    """Open a DB connection with WAL + busy_timeout + FK (replaces monkey-patch)."""
    conn = sqlite3.connect(db_path, timeout=timeout)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
        conn.execute('PRAGMA foreign_keys=ON')
    except Exception as e:
        logger.warning(f"_safe_connect: PRAGMA setup failed for {db_path}: {e}")
    return conn


logger = logging.getLogger(__name__)

# Try to import pytz for Cairo timezone
# 🔥 P14 (أغسطس 2026): pytz ضروري لـ EGX — لو ناقص على السرفر، كل فحوصات
# ساعات السوق (10:00-14:30) هتخطئ بساعتين والـ cron هيمشي في أوقات غلط.
# بنسجل خطأ واضح بدل ما نسكت ونستخدم UTC بصمت.
try:
    import pytz
    CAIRO_TZ = pytz.timezone('Africa/Cairo')
    def cairo_now():
        return datetime.now(CAIRO_TZ)
except ImportError:
    import logging as _tz_log
    _tz_log.getLogger(__name__).error(
        "🚨 CRITICAL: pytz is NOT installed — cairo_now() falling back to system time. "
        "On a UTC VPS, ALL EGX market-hour checks (10:00-14:30 Cairo) will be WRONG by ~2 hours. "
        "FIX: pip install pytz  (then pm2 restart python-backend)"
    )
    # fallback: استخدم offset ثابت لـ Cairo (UTC+2 / +3 DST) — أفضل من UTC المجرد
    from datetime import timedelta as _td
    def cairo_now():
        # تقريب: Cairo = UTC+2 (شتاء) / UTC+3 (صيف). نستخدم UTC+2 كافتراضي آمن.
        return datetime.utcnow() + _td(hours=2)


class MarketScheduler:
    """الجدول المركزي للتحليل"""

    def __init__(self):
        self.running = False
        self.threads = []
        self.last_run = {
            'incremental': None,
            'full_analysis': None,
            'final_analysis': None,
            'daily_closer': None,
            'learning_engine': None,
            'telegram_post': None,
            'crypto_update': None,
            'regime_check': None,
            'egx_indices': None,
            'intraday_prices': None,
            'screener_presets': None,
            'crypto_lab': None,  # P23-CRYPTO-LAB-FUSION: 24/7 BTC+ETH Live Lab (15 min)
            'bag_holder_alerts': None,  # P31: proactive loss>=15% alerts (15 min)
            'trailing_stop_update': None,  # v3.63.0: Live Trailing Stop update (15 min)
            'price_history_safetynet': None,  # P0: daily Yahoo gap-fill (unconditional)
            'intraday_aggregator': None,  # 🔥 RL-FIX-2: intraday → daily bars aggregation
            'price_history_stale': None,  # P0: hourly stale monitor
        }
        self.market_open = False

        # نبض السوق — بيتحسب قبل كل دورة تحليل
        self.market_pulse = None

        # Market regime state
        self.current_regime = None  # RegimeResult from MarketRegimeEngine
        self.trading_paused = False  # True when EGX30 is in Stage 4

        self._import_engines()

        # Initialize regime on startup so system starts with current state
        self.run_morning_regime_check()

    def _import_engines(self):
        """Import all engine dependencies"""
        # Background Analyzer
        self.bg_analyzer = None
        try:
            from analyzers.background_analyzer import BackgroundAnalyzer
            self.bg_analyzer = BackgroundAnalyzer()
            logger.info("[MarketScheduler] BackgroundAnalyzer loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] BackgroundAnalyzer not available: {e}")

        # Daily Closer
        self.daily_closer = None
        try:
            from jobs.daily_closer import DailyCloser
            self.daily_closer = DailyCloser()
            logger.info("[MarketScheduler] DailyCloser loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] DailyCloser not available: {e}")

        # Learning Engine
        self.learning_engine = None
        try:
            from jobs.learning_engine import LearningEngine
            self.learning_engine = LearningEngine()
            logger.info("[MarketScheduler] LearningEngine loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] LearningEngine not available: {e}")

        # Sniper Engine
        self.sniper_engine = None
        try:
            from analyzers.sniper_engine import SniperEngine
            self.sniper_engine = SniperEngine()
            logger.info("[MarketScheduler] SniperEngine loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] SniperEngine not available: {e}")

        # Telegram Auto Poster
        self.telegram_poster = None
        try:
            from telegram.auto_poster import TelegramAutoPoster
            self.telegram_poster = TelegramAutoPoster()
            logger.info("[MarketScheduler] TelegramAutoPoster loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] TelegramAutoPoster not available: {e}")

        # Market Regime Engine
        self.regime_engine = None
        try:
            from engines.market_regime import MarketRegimeEngine
            self.regime_engine = MarketRegimeEngine()
            logger.info("[MarketScheduler] MarketRegimeEngine loaded")
        except Exception as e:
            logger.warning(f"[MarketScheduler] MarketRegimeEngine not available: {e}")

    def _is_egx_market_hours(self) -> bool:
        """Check if EGX market is currently open (10:00-14:30 Cairo time, Sun-Thu)"""
        now = cairo_now()
        # EGX: Sunday to Thursday, 10:00 - 14:30
        # Python weekday: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
        # EGX weekend = Friday (4) + Saturday (5) — Sunday (6) IS a trading day
        if now.weekday() in (4, 5):  # Friday or Saturday only
            return False
        market_open_time = now.replace(hour=10, minute=0, second=0, microsecond=0)
        market_close_time = now.replace(hour=14, minute=30, second=0, microsecond=0)
        return market_open_time <= now <= market_close_time

    def _is_post_market(self) -> bool:
        """Check if we're in post-market time (14:30-15:00 Cairo time)"""
        now = cairo_now()
        post_start = now.replace(hour=14, minute=30, second=0, microsecond=0)
        post_end = now.replace(hour=15, minute=0, second=0, microsecond=0)
        return post_start <= now <= post_end

    def _is_friday(self) -> bool:
        """Check if today is Friday (for weekly learning)"""
        return cairo_now().weekday() == 4  # Friday = 4

    def _is_weekend(self) -> bool:
        """Check if today is weekend (Friday or Saturday — EGX closed)."""
        return cairo_now().weekday() in (4, 5)

    # ─────────────────────────────────────────────────────────────────────────
    # HOLIDAY-FREE PREDICTIONS (FIX August 2026 — production-killer bug):
    # السيرفر الإنتاجي كان بيتوقف تماماً عن توليد التوقعات أيام الإجازة (الجمعة
    # والسبت) لأن كل الـ run_*_analysis functions كانت بتعمل return early لو
    # السوق مغلق. النتيجة: شاشة "لا توجد توصيات" أيام الإجازة، والمستخدم
    # المبتدئ بيدخل يشوف المنصة فاضية وبيمشي.
    #
    # الحل: شيلنا القيود — التوقعات بتتولد كل 15 دقيقة طول الأسبوع، حتى لو
    # السوق مغلق. الأسعار بتفضل ثابتة أيام الإجازة، بس التوقعات القديمة بتفضل
    # ظاهرة والتوليد بيكمل عشان لو في سهم جديد يستاهل توصية.
    # ─────────────────────────────────────────────────────────────────────────

    def _should_run(self, task_name: str, min_interval_minutes: int) -> bool:
        """Check if enough time has passed since last run of a task"""
        last = self.last_run.get(task_name)
        if last is None:
            return True
        elapsed = (cairo_now() - last).total_seconds() / 60
        return elapsed >= min_interval_minutes

    def _mark_run(self, task_name: str):
        """Mark a task as just run"""
        self.last_run[task_name] = cairo_now()

    def compute_market_pulse(self) -> dict:
        """
        يحسب نبض السوق قبل أي تحليل.
        يرجع: regime, strength, breadth, risk_level, sector_summary
        """
        # قيم افتراضية آمنة لو حصل أي خطأ
        _default = {
            'regime': 'range',
            'regime_5': 'range',
            'strength': 50.0,
            'breadth': 0.5,
            'risk_level': 'medium',
            'advancers': 0,
            'decliners': 0,
            'flat': 0,
            'sector_summary': {'top': [], 'bottom': []},
            'egx30_price': 0,
            'sma20': 0,
            'sma50': 0,
            'sma200': 0,
            'atr_pct': 0,
            'volatility_regime': 'medium',
            'trading_paused': False,
            'timestamp': cairo_now().isoformat(),
        }

        conn_stocks = None
        try:
            _root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            stocks_db = os.path.join(_root, 'db', 'stocks.db')
            price_history_db = os.path.join(_root, 'db', 'price_history.db')

            # Rule 54 / Phase 3: استخدم db_manager للـ WAL + busy_timeout
            try:
                from core.db_manager import db_manager
                conn_stocks = db_manager.get_connection('stocks', writable=False)
            except Exception:
                conn_stocks = _safe_connect(stocks_db, 30.0)

            # ─── 1. أخد أكتر 50 سهم سيولة ───
            try:
                rows = conn_stocks.execute('''
                    SELECT ticker, current_price, open_price, change_percent, sector, value_traded
                    FROM stocks
                    WHERE market = 'EGX' OR market IS NULL
                      AND is_active = 1
                      AND current_price > 0
                    ORDER BY value_traded DESC
                    LIMIT 50
                ''').fetchall()
            except Exception as e:
                # لو عمود change_percent مش موجود، نستخدم الطريقة البديلة
                logger.warning(f"[MarketPulse] خطأ في الاستعلام الأساسي: {e}")
                rows = conn_stocks.execute('''
                    SELECT ticker, current_price, open_price, 0 as change_percent, sector, value_traded
                    FROM stocks
                    WHERE is_active = 1
                      AND current_price > 0
                    ORDER BY value_traded DESC
                    LIMIT 50
                ''').fetchall()

            # ─── 2. حساب الصاعد/النازل/الثابت ───
            advancers = 0
            decliners = 0
            flat = 0
            sector_changes = {}  # sector → list of change_percent

            for row in rows:
                ticker, close, open_p, chg_pct, sector, turnover = row
                # نحاول نقارن close vs open، لو مفيش open نستخدم change_percent
                if open_p and open_p > 0 and close > 0:
                    if close > open_p:
                        advancers += 1
                    elif close < open_p:
                        decliners += 1
                    else:
                        flat += 1
                elif chg_pct is not None:
                    if chg_pct > 0:
                        advancers += 1
                    elif chg_pct < 0:
                        decliners += 1
                    else:
                        flat += 1
                else:
                    flat += 1

                # جمع تغيرات القطاعات
                if sector and chg_pct is not None:
                    if sector not in sector_changes:
                        sector_changes[sector] = []
                    sector_changes[sector].append(float(chg_pct))

            total = advancers + decliners + flat
            breadth = advancers / total if total > 0 else 0.5

            # ─── 3. حساب SMA20 و SMA50 و SMA200 و ATR للـ EGX30 من price_history.db ───
            egx30_price = 0
            sma20 = 0
            sma50 = 0
            sma200 = 0
            atr_pct = 0.0

            try:
                # بندور على سعر EGX30 الحالي في market_indices
                idx_row = conn_stocks.execute('''
                    SELECT current_value FROM market_indices WHERE symbol = 'EGX30'
                ''').fetchone()
                if idx_row and idx_row[0]:
                    egx30_price = float(idx_row[0])
            except Exception:
                pass

            conn_ph = None
            try:
                # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
                from data.prices import load_price_history
                # Original SQL: SELECT close_price, high_price, low_price FROM price_history
                #   WHERE ticker='EGX30' ORDER BY date DESC LIMIT 210
                # load_price_history returns oldest-first with keys {close, high, low}.
                # Reverse to DESC (callers use closes[0] = most recent, closes[:N] = last N).
                _ph_raw = load_price_history('EGX30', limit=210)
                _ph_desc = list(reversed(_ph_raw))
                closes = [r['close'] for r in _ph_desc if r.get('close') and r['close'] > 0]
                highs = [r['high'] for r in _ph_desc if r.get('high') and r['high'] > 0]
                lows = [r['low'] for r in _ph_desc if r.get('low') and r['low'] > 0]

                if len(closes) >= 20:
                    sma20 = sum(closes[:20]) / 20
                if len(closes) >= 50:
                    sma50 = sum(closes[:50]) / 50
                if len(closes) >= 200:
                    sma200 = sum(closes[:200]) / 200

                # حساب ATR (14 يوم) — نستخدم high/low/close
                atr_pct = 0.0
                if len(closes) >= 15 and len(highs) >= 15 and len(lows) >= 15:
                    tr_values = []
                    for i in range(14):
                        h = highs[i]
                        l = lows[i]
                        c_prev = closes[i + 1] if (i + 1) < len(closes) else closes[i]
                        tr = max(h - l, abs(h - c_prev), abs(l - c_prev))
                        tr_values.append(tr)
                    atr_14 = sum(tr_values) / len(tr_values)
                    atr_pct = (atr_14 / egx30_price) * 100 if egx30_price > 0 else 0.0

                # لو مفيش سعر من market_indices، نأخده من آخر يوم في price_history
                if egx30_price == 0 and closes:
                    egx30_price = closes[0]

            except Exception as e:
                logger.warning(f"[MarketPulse] خطأ في حساب SMA من price_history: {e}")
            finally:
                # P14-PHASE-B (MEM-02): ضمان إغلاق conn_ph حتى لو حصل Exception
                if conn_ph is not None:
                    try:
                        conn_ph.close()
                    except Exception:
                        pass

            # ─── 4. تحديد regime (5 أنظمة) ───
            above_sma20 = egx30_price > sma20 if (egx30_price > 0 and sma20 > 0) else False
            sma20_above_sma50 = sma20 > sma50 if (sma20 > 0 and sma50 > 0) else False
            above_sma200 = egx30_price > sma200 if (egx30_price > 0 and sma200 > 0) else False

            def _classify_regime_5(above_sma20: bool, sma20_above_sma50: bool,
                                    above_sma200: bool, breadth: float,
                                    atr_pct: float) -> str:
                """
                Classify market into 5 regimes based on 3 dimensions:
                1. Trend (SMA20/50/200 alignment)
                2. Breadth (% of stocks above SMA20)
                3. Volatility (ATR% of EGX30)

                Returns: 'strong_bull' | 'weak_bull' | 'range' | 'weak_bear' | 'strong_bear'
                """
                # Calculate trend strength
                trend_up = above_sma20 and sma20_above_sma50
                trend_down = (not above_sma20) and (not sma20_above_sma50)

                if trend_up and above_sma200 and breadth > 0.65 and atr_pct < 3.0:
                    return 'strong_bull'
                elif trend_up and above_sma200 and breadth > 0.45:
                    return 'weak_bull'
                elif trend_down and (not above_sma200) and breadth < 0.35 and atr_pct > 3.5:
                    return 'strong_bear'
                elif trend_down and (not above_sma200):
                    return 'weak_bear'
                else:
                    return 'range'

            regime_5 = _classify_regime_5(above_sma20, sma20_above_sma50,
                                          above_sma200, breadth, atr_pct)

            # Map 5-regime to legacy 3-regime for backward compatibility
            regime_legacy = {
                'strong_bull': 'bull',
                'weak_bull': 'bull',
                'range': 'range',
                'weak_bear': 'bear',
                'strong_bear': 'bear',
            }.get(regime_5, 'range')

            # Strength based on breadth
            if regime_legacy == 'bull':
                strength = breadth * 100
            elif regime_legacy == 'bear':
                strength = (1 - breadth) * 100
            else:
                strength = 50

            # ─── 5. تحديد risk_level من 5 أنظمة ───
            REGIME_RISK = {
                'strong_bull': 'low',
                'weak_bull': 'low',
                'range': 'medium',
                'weak_bear': 'high',
                'strong_bear': 'extreme',
            }
            risk_level = REGIME_RISK.get(regime_5, 'medium')

            # ─── 6. ملخص القطاعات — أعلى 3 وأقل 3 ───
            sector_avg = {}
            for sec, changes in sector_changes.items():
                if changes:
                    sector_avg[sec] = sum(changes) / len(changes)

            sorted_sectors = sorted(sector_avg.items(), key=lambda x: x[1], reverse=True)
            top_sectors = [{'sector': s, 'avg_change': round(c, 2)} for s, c in sorted_sectors[:3]]
            bottom_sectors = [{'sector': s, 'avg_change': round(c, 2)} for s, c in sorted_sectors[-3:]]

            # ─── 7. تجميع النتيجة ───
            pulse = {
                'regime': regime_legacy,        # backward compat (3-regime)
                'regime_5': regime_5,           # new 5-regime classification
                'strength': round(strength, 1),
                'breadth': round(breadth, 3),
                'risk_level': risk_level,
                'advancers': advancers,
                'decliners': decliners,
                'flat': flat,
                'sector_summary': {'top': top_sectors, 'bottom': bottom_sectors},
                'egx30_price': egx30_price,
                'sma20': round(sma20, 2),
                'sma50': round(sma50, 2),
                'sma200': round(sma200, 2),
                'atr_pct': round(atr_pct, 2),
                'volatility_regime': 'low' if atr_pct < 2 else 'medium' if atr_pct < 4 else 'high',
                'trading_paused': (regime_5 == 'strong_bear'),
                'pause_reason': 'سوق هابط قوي — التداول متوقف تلقائياً لحماية رأس المال' if regime_5 == 'strong_bear' else None,
                'timestamp': cairo_now().isoformat(),
            }

            # ─── 8. حفظ في المتغير و في الداتابيز ───
            self.market_pulse = pulse

            try:
                conn_stocks.execute('''
                    CREATE TABLE IF NOT EXISTS market_pulse_cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        regime TEXT,
                        regime_5 TEXT,
                        strength REAL,
                        breadth REAL,
                        risk_level TEXT,
                        advancers INTEGER,
                        decliners INTEGER,
                        flat_count INTEGER,
                        egx30_price REAL,
                        sma20 REAL,
                        sma50 REAL,
                        sma200 REAL,
                        atr_pct REAL,
                        volatility_regime TEXT,
                        trading_paused INTEGER DEFAULT 0,
                        pause_reason TEXT,
                        sector_top TEXT,
                        sector_bottom TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
                ''')
                import json
                conn_stocks.execute('''
                    INSERT INTO market_pulse_cache
                        (regime, regime_5, strength, breadth, risk_level, advancers, decliners, flat_count,
                         egx30_price, sma20, sma50, sma200, atr_pct, volatility_regime,
                         trading_paused, pause_reason, sector_top, sector_bottom)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pulse['regime'], pulse['regime_5'], pulse['strength'], pulse['breadth'], pulse['risk_level'],
                    pulse['advancers'], pulse['decliners'], pulse['flat'],
                    pulse['egx30_price'], pulse['sma20'], pulse['sma50'], pulse['sma200'],
                    pulse['atr_pct'], pulse['volatility_regime'],
                    1 if pulse['trading_paused'] else 0, pulse['pause_reason'],
                    json.dumps(top_sectors, ensure_ascii=False),
                    json.dumps(bottom_sectors, ensure_ascii=False),
                ))
                conn_stocks.commit()
            except Exception as e:
                logger.warning(f"[MarketPulse] خطأ في حفظ النبض في الداتابيز: {e}")

            logger.info(
                f"[MarketPulse] regime={pulse['regime']} regime_5={pulse['regime_5']} | "
                f"breadth={pulse['breadth']:.1%} | risk={pulse['risk_level']} | "
                f"adv/dec/flat={advancers}/{decliners}/{flat} | "
                f"EGX30={egx30_price:.0f} SMA20={sma20:.0f} SMA50={sma50:.0f} SMA200={sma200:.0f} | "
                f"ATR%={atr_pct:.2f} vol={pulse['volatility_regime']} paused={pulse['trading_paused']}"
            )

            return pulse

        except Exception as e:
            logger.error(f"[MarketPulse] خطأ عام في حساب نبض السوق: {e}")
            self.market_pulse = _default
            return _default
        finally:
            # P14-PHASE-B (MEM-02): ضمان إغلاق conn_stocks حتى لو حصل Exception
            if conn_stocks is not None:
                try:
                    conn_stocks.close()
                except Exception:
                    pass

    def _log_pulse_summary(self):
        """لوج ملخص نبض السوق في بداية يوم التداول."""
        pulse = self.market_pulse
        if not pulse:
            return

        # توصية بناءً على النبض
        if pulse['regime'] == 'bull' and pulse['risk_level'] == 'low':
            action = 'aggressive'  # هجومي — السوق صاعد وواسع
            action_ar = '⚡ هجومي — السوق صاعد وواسع، فرص كتير'
        elif pulse['risk_level'] == 'high':
            action = 'defensive'  # دفاعي — السوق خطير
            action_ar = '🛡️ دفاعي — السوق ضيق وخطير، احذر'
        else:
            action = 'neutral'  # محايد — حذر عادي
            action_ar = '⚖️ محايد — السوق متذبذب، اختر بعناية'

        logger.info("=" * 60)
        logger.info("[MarketPulse] 📊 ملخص نبض السوق اليومي")
        logger.info(f"  النظام: {pulse['regime']} | القوة: {pulse['strength']:.0f} | "
                     f"العرض: {pulse['breadth']:.1%} | المخاطرة: {pulse['risk_level']}")
        logger.info(f"  EGX30: {pulse['egx30_price']:.0f} | SMA20: {pulse['sma20']:.0f} | "
                     f"SMA50: {pulse['sma50']:.0f}")
        logger.info(f"  صاعد/نازل/ثابت: {pulse['advancers']}/{pulse['decliners']}/{pulse['flat']}")

        # قطاعات رائدة
        top = pulse.get('sector_summary', {}).get('top', [])
        bottom = pulse.get('sector_summary', {}).get('bottom', [])
        if top:
            top_str = ' | '.join([f"{s['sector']}: {s['avg_change']:+.1f}%" for s in top])
            logger.info(f"  🟢 قطاعات رائدة: {top_str}")
        if bottom:
            bot_str = ' | '.join([f"{s['sector']}: {s['avg_change']:+.1f}%" for s in bottom])
            logger.info(f"  🔴 قطاعات متأخرة: {bot_str}")

        logger.info(f"  التوصية: {action_ar}")
        logger.info("=" * 60)

    def run_morning_regime_check(self):
        """
        Morning EGX30 regime check — determines market stage (1-4).
        Called at 9:30 Cairo time (pre-market) and on startup.
        Sets self.current_regime and self.trading_paused accordingly.
        """
        if not self.regime_engine:
            logger.warning("[MarketScheduler] MarketRegimeEngine not loaded — skipping regime check")
            # Default to cautious: Stage 1, trading allowed at half position
            self.trading_paused = False
            return

        try:
            result = self.regime_engine.get_regime()
            self.current_regime = result

            # Stage 4 = Bear Market → pause all EGX trading
            if result.stage == 4:
                self.trading_paused = True
                logger.warning(
                    f"[MarketScheduler] 🚨 TRADING PAUSED: EGX30 in Stage 4 "
                    f"({result.stage_name}) | Price: {result.price:.0f} | "
                    f"SMA200: {result.sma200:.0f}"
                )
            else:
                self.trading_paused = False
                logger.info(
                    f"[MarketScheduler] EGX30 Stage {result.stage} ({result.stage_name}) | "
                    f"Price: {result.price:.0f} | SMA200: {result.sma200:.0f} | "
                    f"Confidence: {result.confidence:.0f}% | "
                    f"Position modifier: {result.position_modifier:.0%}"
                )

            self._mark_run('regime_check')

            # P4-INFLATION: جلب معدل التضخم المصري من World Bank API مرة واحدة يومياً
            # (في الـ morning check). الـ fetcher بيـ UPSERT في macro_indicators
            # تحت مفتاحين: 'inflation_rate' و 'egypt_inflation' عشان كل الـ routes
            # تلاقي نفس القيمة الطازجة.
            try:
                _today = cairo_now().strftime('%Y-%m-%d') if 'cairo_now' in dir() else __import__('datetime').datetime.now().strftime('%Y-%m-%d')
                if not hasattr(self, '_inflation_fetch_date') or self._inflation_fetch_date != _today:
                    self._inflation_fetch_date = _today
                    import threading as _th
                    def _fetch_inflation_bg():
                        try:
                            import sys as _sys
                            _jobs_dir = __import__('pathlib').Path(__file__).resolve().parent
                            if str(_jobs_dir) not in _sys.path:
                                _sys.path.insert(0, str(_jobs_dir))
                            from jobs.fetch_inflation_worldbank import main as _fetch_main
                            _fetch_main()
                        except Exception as _ie:
                            logger.warning(f"[MarketScheduler] Inflation fetch failed: {_ie}")
                    _th.Thread(target=_fetch_inflation_bg, daemon=True).start()
            except Exception as _e:
                logger.warning(f"[MarketScheduler] Inflation fetch trigger error: {_e}")
        except Exception as e:
            logger.error(f"[MarketScheduler] Regime check error: {e}")
            # On error, don't pause trading but log warning
            self.trading_paused = False

    def run_incremental_analysis(self):
        """Run incremental analysis for changed stocks.

        STRATEGY-041 (Live vs EOD): أثناء الجلسة (10:00-14:30) ممنوع تشغيل
        MasterAnalyzer البطيء — الـ LiveIndicatorEngine بس اللي يشتغل (50ms).
        الـ MasterAnalyzer بيتشغل بس بعد القفلة بساعة (post-market).

        PHASE-5.1 (Two-Tier Architecture): التحليل الخفيف (Lightweight) بيشتغل
        كل دقيقة دلوقتي (بدل 5 دقايق) — بحدث السعر و الـ RSI بس في الواجهة
        من غير ما يحسب Monte Carlo ولا SMC. ده بيخلي الواجهة سريعة جداً.
        """
        if not self._should_run('incremental', 1):
            return
        if not self._is_egx_market_hours():
            return

        # ─── نبض السوق قبل التحليل ───
        pulse = self.compute_market_pulse()
        if pulse.get('risk_level') == 'high':
            logger.warning("[MarketScheduler] ⚠️ نبض السوق خطير (high risk) — التحليل هيستمر بحذر")

        # STRATEGY-041: أثناء الجلسة → LiveEngine فقط (ممنوع MasterAnalyzer)
        logger.info("[MarketScheduler] Running Live Engine only (market session)...")
        try:
            # LiveEngine بيتحدّث cached_analysis تلقائياً كل 5 ثواني عبر WebSocket
            # مش محتاجين نشغل MasterAnalyzer البطيء (2-4 sec per stock)
            from analyzers.live_indicator_engine import get_live_engine
            live_engine = get_live_engine()
            # scan أعلى 20 سهم نشط فقط (مش كل السوق)
            try:
                live_engine.scan_live_opportunities(limit=20)
                logger.info("[MarketScheduler] ✅ Live Engine scan completed (20 stocks)")
            except Exception as _le:
                logger.debug(f"[MarketScheduler] Live scan skipped: {_le}")
            self._mark_run('incremental')
        except Exception as e:
            logger.error(f"[MarketScheduler] Live Engine error: {e}")

    def run_full_analysis(self):
        """Run full analysis — STRATEGY-041: بس بعد القفلة بساعة (post-market).

        أثناء الجلسة: ممنوع (الـ LiveEngine بيشتغل بدلاً منه).
        بعد القفلة بساعة: شغّل MasterAnalyzer الشامل + 8 Layers + احفظه في cached_analysis.

        FIX (August 2026 — production-killer): بنشتغل حتى أيام الإجازة (الجمعة
        والسبت) عشان التوقعات تفضل طازجة والشاشة متفضيش.
        """
        if not self._should_run('full_analysis', 15):
            return
        # STRATEGY-041: ممنوع أثناء الجلسة الحية فقط — بس post-market + weekend + holidays
        if self._is_egx_market_hours():
            logger.debug("[MarketScheduler] Full analysis skipped during market session (Live Engine active)")
            return
        # FIX: بنسمح بالتشغيل في post-market OR weekend OR any time outside market hours
        # (قبل كده كنا بنمنعه خارج post-market ونمنعه أيام الإجازة — ده كان بيقتل التوقعات)

        # ─── نبض السوق قبل التحليل ───
        pulse = self.compute_market_pulse()
        if pulse.get('risk_level') == 'high':
            logger.warning("[MarketScheduler] ⚠️ نبض السوق خطير (high risk) — التحليل هيستمر بحذر")

        logger.info("[MarketScheduler] Running full analysis (post-market)...")
        try:
            if self.bg_analyzer:
                # نحاول نوصل بيانات النبض للـ analyzer
                try:
                    self.bg_analyzer._run_full_analysis(market_pulse=pulse)
                except TypeError:
                    self.bg_analyzer._run_full_analysis()
                    logger.debug("[MarketScheduler] bg_analyzer._run_full_analysis مش بيقبل market_pulse — بنكمل عادي")
            self._mark_run('full_analysis')
        except Exception as e:
            logger.error(f"[MarketScheduler] Full analysis error: {e}")

    def run_final_analysis(self):
        """Run final analysis every 15 minutes during market session (real-time refresh).

        سابقاً كان يعمل مرة واحدة يومياً بعد إغلاق السوق (post-market).
        الآن يعمل طوال الجلسة كل 15 دقيقة عشان الأسهم بتتغير لحظياً
        والموبايل بيسحب البيانات باستمرار.

        FIX (August 2026 — production-killer): بنشتغل حتى أيام الإجازة (الجمعة
        والسبت) وخارج أوقات التداول عشان التوقعات تفضل طازجة. قبل كده كنا
        بنعمل return early لو السوق مغلق → الشاشة كانت تفضي أيام الإجازة.
        """
        if not self._should_run('final_analysis', 15):
            return
        # FIX: شيلنا قيد "السوق لازم يكون مفتوح أو post-market" — بنشتغل دايماً كل 15 دقيقة

        # ─── نبض السوق قبل التحليل ───
        pulse = self.compute_market_pulse()
        if pulse.get('risk_level') == 'high':
            logger.warning("[MarketScheduler] ⚠️ نبض السوق خطير (high risk) — التحليل هيستمر بحذر")

        logger.info("[MarketScheduler] Running final analysis (real-time refresh)...")
        try:
            if self.bg_analyzer:
                # نحاول نوصل بيانات النبض للـ analyzer
                try:
                    self.bg_analyzer._run_full_analysis(market_pulse=pulse)
                except TypeError:
                    self.bg_analyzer._run_full_analysis()
                    logger.debug("[MarketScheduler] bg_analyzer._run_full_analysis مش بيقبل market_pulse — بنكمل عادي")
            self._mark_run('final_analysis')
        except Exception as e:
            logger.error(f"[MarketScheduler] Final analysis error: {e}")

    def run_volume_spike_heavyweight(self):
        """PHASE-5.1 (Two-Tier Architecture): تحليل عميق فوري للأسهم اللي فيها Volume Spike.

        لو السهم حصل فيه Volume Spike (حجم تداول ضرب المتوسط 3 مرات) →
        شغّل الـ MasterAnalyzer الشامل (Monte Carlo + Order Blocks) فوراً
        بدون انتظار الـ 15 دقيقة الـ cycle. ده بيخلي الآلة تكتشف الحيتان
        اللي بتنقل دخلوا قبل أي محلل بشري.

        الحد: 5 أسهم كحد أقصى لكل تشغيل (عشان نحافظ على CPU).
        الفاصل: كل 3 دقايق.
        """
        if not self._should_run('vol_spike_heavy', 3):
            return
        if not self._is_egx_market_hours():
            return

        try:
            import sqlite3 as _vsq
            import os as _vos
            import sys as _vsys
            _vps = _vos.path.dirname(_vos.path.dirname(_vos.path.abspath(__file__)))
            _root = _vos.path.dirname(_vps)
            if _vps not in _vsys.path:
                _vsys.path.insert(0, _vps)
            _stocks_db = _vos.path.join(_root, 'db', 'stocks.db')
            _ph_db = _vos.path.join(_root, 'db', 'price_history.db')
            if not _vos.path.exists(_ph_db):
                return

            # ابحث عن أسهم فيها volume spike (اليوم >= 3x متوسط 20 يوم)
            _spike_tickers = []
            _conn = None
            try:
                _conn = _vsq.connect(_ph_db, timeout=10)
                _conn.row_factory = _vsq.Row
                _cur = _conn.cursor()
                # آخر يوم متاح + متوسط 20 يوم لكل سهم
                # PHASE-1-TODO: bulk aggregate — needs data.prices.bulk helpers (PHASE 5)
                _cur.execute(
                    "SELECT ph1.ticker, ph1.volume AS today_vol, "
                    "  (SELECT AVG(volume) FROM price_history ph2 "
                    "   WHERE ph2.ticker = ph1.ticker "
                    "   AND ph2.date >= date('now', '-25 days')) AS avg_vol_20d "
                    "FROM price_history ph1 "
                    "WHERE ph1.date = (SELECT MAX(date) FROM price_history) "
                    "  AND ph1.volume IS NOT NULL AND ph1.volume > 0 "
                    "ORDER BY ph1.volume DESC LIMIT 60"
                )
                for _row in _cur.fetchall():
                    _tk = _row['ticker']
                    _today_v = float(_row['today_vol'] or 0)
                    _avg_v = float(_row['avg_vol_20d'] or 0)
                    if _avg_v > 0 and _today_v >= 3.0 * _avg_v:
                        _spike_tickers.append((_tk, _today_v, _avg_v, _today_v / _avg_v))
                    if len(_spike_tickers) >= 5:
                        break
            except Exception as _spike_q_err:
                logger.debug(f"[MarketScheduler] Volume spike query error: {_spike_q_err}")
                return
            finally:
                # P14-PHASE-B (MEM-02): ضمان إغلاق _conn حتى لو حصل Exception
                if _conn is not None:
                    try:
                        _conn.close()
                    except Exception:
                        pass

            if not _spike_tickers:
                return

            logger.info(
                f"[MarketScheduler] 📈 Volume Spike detected — "
                f"{len(_spike_tickers)} stocks: "
                f"{[s[0] for s in _spike_tickers]}"
            )

            # شغّل التحليل العميق (Heavyweight) للأسهم اللي فيها spike
            try:
                from analyzers.master_analyzer import MasterAnalyzer
                _ma = MasterAnalyzer(db_path=_stocks_db)
                _pulse = self.compute_market_pulse()
                for _tk, _tv, _av, _ratio in _spike_tickers:
                    try:
                        _analysis = _ma.analyze(_tk, market_pulse=_pulse)
                        logger.info(
                            f"[MarketScheduler] 📈 Volume Spike Heavyweight — "
                            f"{_tk}: vol_ratio={_ratio:.1f}x → "
                            f"signal={_analysis.signal}, score={_analysis.master_score}"
                        )
                    except Exception as _a_err:
                        logger.debug(f"[MarketScheduler] Spike analyze error for {_tk}: {_a_err}")
            except Exception as _ma_err:
                logger.debug(f"[MarketScheduler] MasterAnalyzer import error: {_ma_err}")

            self._mark_run('vol_spike_heavy')
        except Exception as e:
            logger.error(f"[MarketScheduler] Volume spike heavyweight error: {e}")

    def run_close_predictions(self):
        """🔥 VERIFY-FIX-2 (EOD-only closing): يقفل التوقعات المفتوحة مرة واحدة
        يومياً **بعد إغلاق الجلسة** (14:45 القاهرة ± 30 دقيقة) بناءً على
        أسعار الإغلاق الحقيقية (daily OHLC bars من price_history)، مش على
        لمسات لحظية أثناء الجلسة.

        المشكلة (Audit Bug #1): قبل كده، الـ DailyCloser كان بـ يشتغل كل 15
        دقيقة طول الجلسة. ده معناه إن السهم ممكن يلمس الهدف الساعة 11:00
        الصبح والمنصة تقفله على إنه "ربح"، بس بعد كده السهم يرجع يقفل أحمر.
        النتيجة: إحصائيات "متابعة التوقعات" كلها مغلوطة.

        الحل: فصلنا الـ closing عن الـ rebuild. الـ closing بـ يشتغل مرة
        واحدة يومياً بعد 14:30 (وقت إغلاق EGX) عبر ``_run_daily_task`` بنافذة
        30 دقيقة. الـ rebuild فضل كل 15 دقيقة (انظر ``run_rebuild_predictions``).
        """
        def _close_fn():
            logger.info("[MarketScheduler] Running EOD close (post-market, daily OHLC bars)...")
            try:
                # 1. Close open positions (DailyCloser) — uses price_history daily bars
                if self.daily_closer:
                    result = self.daily_closer.run()
                    logger.info(f"[MarketScheduler] EOD closer result: {result}")

                # 1.5. Evaluate and close unified AI predictions
                try:
                    from api.ai_predictions_routes import evaluate_all_pending_predictions_internal
                    evaluate_all_pending_predictions_internal()
                except Exception as e_eval:
                    logger.error(f"[MarketScheduler] Error evaluating AI predictions in EOD closer: {e_eval}")
            except Exception as e:
                logger.error(f"[MarketScheduler] EOD closer error: {e}")

        # 14:45 Cairo ± 30 min window → 14:15–15:15. Runs once per calendar day.
        # الـ window الكبير عشان حتى لو fetch الأسعار اتأخر، الـ closer يفضل
        # يقدر يقفل في أول فرصة جوه النافذة.
        self._run_daily_task(
            hour=14, minute=45, task_key='eod_close_predictions',
            task_fn=_close_fn, window_minutes=30,
        )

    def run_rebuild_predictions(self):
        """🔥 VERIFY-FIX-2: إعادة بناء التوقعات كل 15 دقيقة (generation فقط،
        من غير closing). ده الجزء اللي بـ يـ generate توصيات جديدة بناءً على
        نبض السوق. آمن يشتغل طول الوقت لأنه ما بـ يقفلش صفقات — بـ يـ add بس.

        قبل كده كان مدموج مع الـ closing في ``run_daily_closer``. فصلناه عشان
        الـ closing ما يشتغلش كل 15 دقيقة (كان بـ يقفل على لمسات لحظية).
        """
        if not self._should_run('rebuild_predictions', 15):
            return

        try:
            # Rebuild predictions for TOMORROW (keep refreshing during session)
            # ─── تحديد min_score ديناميكياً بناءً على نبض السوق ───
            # P4-MIN-SCORE: نقرا الـ min_prediction_score من engine_settings كـ baseline
            try:
                from analyzers.engine_settings import get_setting
                _base_min_score = int(get_setting('min_prediction_score', default=60))
            except Exception:
                _base_min_score = 60

            _risk = self.market_pulse.get('risk_level', 'medium') if self.market_pulse else 'medium'
            if _risk == 'low':
                effective_min_score = max(48, _base_min_score - 12)   # سوق هادي — نقبل التوقعات العادية
            elif _risk == 'medium':
                effective_min_score = max(55, _base_min_score - 5)    # سوق متذبذب — عتبة أعلى شوية
            else:
                effective_min_score = _base_min_score                  # سوق خطير — فقط التوقعات القوية جداً

            logger.info(f"[MarketScheduler] 📊 نبض السوق: risk={_risk} → effective min_score={effective_min_score}")

            try:
                import sys as _pred_sys
                import os as _pred_os
                _vps = _pred_os.path.dirname(_pred_os.path.dirname(_pred_os.path.abspath(__file__)))
                if _vps not in _pred_sys.path:
                    _pred_sys.path.insert(0, _vps)
                from api.ai_predictions_routes import generate_predictions_internal
                success, preds = generate_predictions_internal(market='EGX', min_score=effective_min_score)
                if success:
                    logger.info(f"[MarketScheduler] ✓ Rebuilt {len(preds)} predictions (min_score={effective_min_score})")
                else:
                    logger.warning(f"[MarketScheduler] Predictions rebuild failed: {preds}")
            except Exception as e:
                logger.warning(f"[MarketScheduler] Predictions rebuild error: {e}")

            # Cleanup invalidated/expired predictions after each cycle
            try:
                from api.ai_predictions_routes import cleanup_invalidated_predictions
                cleanup_invalidated_predictions()
            except Exception as e_clean:
                logger.error(f"[MarketScheduler] Error cleaning up predictions: {e_clean}")

            self._mark_run('rebuild_predictions')
        except Exception as e:
            logger.error(f"[MarketScheduler] Rebuild predictions error: {e}")

    # ══════════════════════════════════════════════════════════════════
    # V40.2 LIVE GENERATION (2026-09-03)
    # Owner directive: "التوقعات ماتغيرتش خالص من يومين — المفروض فيه
    # تحديث أثناء الجلسة + تحليل عميق بعد الإغلاق لتحديد توقعات الغد"
    #
    # المشكلة: V40.2 daily generator كان بيعتمد على crontab بس (cron job
    # الساعة 3:00 فجراً). لو crontab مش متظبط على الـ VPS → مفيش توقعات
    # جديدة. كمان الـ MarketScheduler كان بيـ call generate_predictions_internal
    # (اللي بتكتب في aiPrediction table) بدل V40.2 (اللي بيكتب في predictions table).
    #
    # الحل: ربط V40.2 daily generator مباشرة في MarketScheduler.tick() بحيث:
    # 1. أثناء الجلسة (10:00-14:30): كل 15 دقيقة — تحديث سريع (intraday)
    # 2. بعد الإغلاق (14:45): مرة واحدة — تحليل عميق لتوقعات الغد
    # 3. قبل الجلسة (3:00 فجراً): مرة واحدة — توقعات اليوم (backup للـ cron)
    # ══════════════════════════════════════════════════════════════════

    def run_v40_2_generation(self, mode: str = 'intraday'):
        """
        تشغيل V40.2 daily generator كـ subprocess داخل MarketScheduler.

        CRITICAL FIX (2026-09-03): قبل ما V40.2 يشتغل، نتأكد إن price_history.db
        طازة (آخر تاريخ = اليوم). لو مش طازة → نشغل intraday_aggregator +
        price_history_safetynet الأول. ده يمنع تكرار مشكلة "التوقعات ماتغيرتش
        من يومين" اللي سببها تجمّد price_history.db.

        Args:
            mode: 'intraday' (تحديث سريع أثناء الجلسة) | 'daily' (تحليل عميق)
                  'morning' (توقعات اليوم قبل فتح السوق)
        """
        if not self._should_run(f'v40_2_generation_{mode}', 15 if mode == 'intraday' else 60):
            return

        import subprocess
        import sys as _sys
        import sqlite3 as _v40_sqlite

        try:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            venv_python = os.path.join(project_root, '.venv', 'bin', 'python3')
            if not os.path.exists(venv_python):
                venv_python = _sys.executable

            script_path = os.path.join(project_root, 'vps-service', 'jobs', 'daily_predictor.py')
            if not os.path.exists(script_path):
                logger.warning(f"[MarketScheduler] V40.2 script not found: {script_path}")
                return

            # ════════════════════════════════════════════════════════════════
            # CRITICAL (2026-09-03): تأكد إن price_history.db طازة قبل V40.2
            # Owner: "لية عملية تغذية price_history.db بالبيانات وقفت؟
            #         مكن عطل ممكن طيب لية حاجة واحدة ممكن تدمر سير مشروع كامل؟"
            # الحل: V40.2 نفسها بتـ check وتـ refresh لو price_history stale.
            # ════════════════════════════════════════════════════════════════
            try:
                _ph_db = os.path.join(project_root, 'db', 'price_history.db')
                if os.path.exists(_ph_db):
                    _ph_conn = _v40_sqlite.connect(_ph_db, timeout=5)
                    _row = _ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()
                    _ph_conn.close()
                    if _row and _row[0]:
                        from datetime import datetime as _dt, timedelta as _td
                        _last_date = str(_row[0])[:10]
                        _today = _dt.now().strftime('%Y-%m-%d')
                        _yesterday = (_dt.now() - _td(days=1)).strftime('%Y-%m-%d')
                        # لو آخر تاريخ قديم (أقل من أمس) → نشغل aggregator + safetynet
                        if _last_date < _yesterday:
                            logger.warning(
                                f"[MarketScheduler] ⚠️ price_history STALE! "
                                f"MAX(date)={_last_date} < yesterday={_yesterday} "
                                f"→ running aggregator + safetynet BEFORE V40.2"
                            )
                            # 1. شغل intraday_aggregator (intraday → daily bars)
                            try:
                                _agg_script = os.path.join(project_root, 'vps-service', 'jobs', 'intraday_aggregator.py')
                                if os.path.exists(_agg_script):
                                    _agg_result = subprocess.run(
                                        [venv_python, _agg_script],
                                        cwd=project_root, env=os.environ.copy(),
                                        capture_output=True, text=True, timeout=60,
                                    )
                                    logger.info(f"[MarketScheduler] ✓ intraday_aggregator: {_agg_result.stdout[-200:] if _agg_result.stdout else 'no output'}")
                            except Exception as _agg_e:
                                logger.error(f"[MarketScheduler] intraday_aggregator error: {_agg_e}")

                            # 2. شغل price_history_safetynet (Yahoo gap-fill)
                            try:
                                _sn_script = os.path.join(project_root, 'vps-service', 'jobs', 'price_history_safetynet.py')
                                if os.path.exists(_sn_script):
                                    _sn_result = subprocess.run(
                                        [venv_python, _sn_script],
                                        cwd=project_root, env=os.environ.copy(),
                                        capture_output=True, text=True, timeout=120,
                                    )
                                    logger.info(f"[MarketScheduler] ✓ price_history_safetynet: {_sn_result.stdout[-200:] if _sn_result.stdout else 'no output'}")
                            except Exception as _sn_e:
                                logger.error(f"[MarketScheduler] price_history_safetynet error: {_sn_e}")
                        else:
                            logger.debug(f"[MarketScheduler] price_history OK (MAX(date)={_last_date})")
            except Exception as _ph_e:
                logger.warning(f"[MarketScheduler] price_history check error: {_ph_e}")

            # Build args based on mode
            if mode == 'intraday':
                args = ['--today-only', '--max-picks', '5', '--keep-old']
                log_label = 'intraday (5 picks, keep-old)'
            elif mode == 'daily':
                args = ['--yesterday-only', '--max-picks', '7']
                log_label = 'daily deep (7 picks)'
            else:  # morning
                args = ['--today-only', '--max-picks', '7']
                log_label = 'morning (7 picks)'

            env = os.environ.copy()
            env['V40_2_NEWS_IMPACT'] = env.get('V40_2_NEWS_IMPACT', '1')
            env['V40_2_EXPERT_RECS'] = env.get('V40_2_EXPERT_RECS', '1')

            logger.info(f"[MarketScheduler] 🚀 V40.2 generation ({log_label})...")

            result = subprocess.run(
                [venv_python, script_path] + args,
                cwd=project_root,
                env=env,
                capture_output=True,
                text=True,
                timeout=180,  # 3 دقائق max (زودناه عشان الـ aggregator + safetynet)
            )

            if result.returncode == 0:
                for line in result.stdout.split('\n')[-15:]:
                    if any(k in line for k in ['Total predictions', 'Overall win rate',
                                               'Signals found', 'Processed', 'NEWS-',
                                               'EXPERT-', 'POSITION-SIZING', 'DEBUG',
                                               'price_history', 'STALE', 'aggregator']):
                        logger.info(f"[V40.2] {line.strip()}")
                logger.info(f"[MarketScheduler] ✓ V40.2 generation complete ({log_label})")
            else:
                logger.warning(f"[MarketScheduler] V40.2 exited with code {result.returncode}")
                if result.stderr:
                    logger.error(f"[V40.2 stderr] {result.stderr[-500:]}")

            self._mark_run(f'v40_2_generation_{mode}')

        except subprocess.TimeoutExpired:
            logger.warning(f"[MarketScheduler] V40.2 generation timed out (180s) — mode={mode}")
        except Exception as e:
            logger.error(f"[MarketScheduler] V40.2 generation error (mode={mode}): {e}")

    def run_daily_closer(self):
        """⚠ DEPRECATED — استخدم ``run_close_predictions`` + ``run_rebuild_predictions``.

        محفوظ عشان أي كود تاني بيـ callه (backwards compat). بـ delegate للـ
        الميثودين الجداد. مفيش behavior جديد هنا — بس عشان ما نكسرش حاجة.
        """
        self.run_close_predictions()
        self.run_rebuild_predictions()

    def run_learning_engine(self):
        """Run learning engine on Fridays at 14:40 Cairo time"""
        if not self._is_friday():
            return
        
        now = cairo_now()
        target_time = now.replace(hour=14, minute=40, second=0, microsecond=0)
        if abs((now - target_time).total_seconds()) > 600:
            return
        if not self._should_run('learning_engine', 10080):  # Once per week
            return
        
        logger.info("[MarketScheduler] Running learning engine (weekly)...")
        try:
            if self.learning_engine:
                report = self.learning_engine.run(period_days=7)
                logger.info(f"[MarketScheduler] Learning result: win_rate={report.win_rate}%, profit_factor={report.profit_factor}")
            self._mark_run('learning_engine')
        except Exception as e:
            logger.error(f"[MarketScheduler] Learning engine error: {e}")

    def run_crypto_update(self):
        """Update crypto data every 10 minutes"""
        if not self._should_run('crypto_update', 10):
            return

        try:
            if self.bg_analyzer:
                # FIX (July 2026): call correct method name
                self.bg_analyzer._run_incremental_analysis()  # Will handle crypto
            self._mark_run('crypto_update')
        except Exception as e:
            logger.error(f"[MarketScheduler] Crypto update error: {e}")

    def run_crypto_lab(self):
        """P23-CRYPTO-LAB-FUSION: Crypto 24/7 Live Lab — BTC + ETH analysis every 15 minutes.

        مختلف عن `run_crypto_update` (اللي بـ update بيانات الأسعار بس):
          - بيحلل BTC + ETH فعلياً (LiveIndicatorEngine pattern + FusionEngineV20 + SMC).
          - بيشتغل 24/7 (مش gated بجلسة EGX — الكريبتو بيتداول 24/7).
          - بيسجّل كل توقع في `crypto_predictions_log` (predictions.db).

        لو CryptoLabScheduler متسجّل في SchedulerManager المركزي، الـ method دي
        بتبقى no-op (الـ SchedulerManager بيدير الجدولة بنفسه). otherwise بتشتغل
        كـ fallback من الـ tick() كل 15 دقيقة.
        """
        if not self._should_run('crypto_lab', 15):  # كل 15 دقيقة
            return

        try:
            import sys as _cl_sys
            import os as _cl_os
            _vps = _cl_os.path.dirname(_cl_os.path.dirname(_cl_os.path.abspath(__file__)))
            if _vps not in _cl_sys.path:
                _cl_sys.path.insert(0, _vps)

            from jobs.crypto_lab_scheduler import get_crypto_lab_scheduler
            scheduler = get_crypto_lab_scheduler()
            result = scheduler.run_once()
            logger.info(
                f"[MarketScheduler] Crypto Lab: analyzed={result.get('analyzed', 0)}, "
                f"logged={result.get('logged', 0)}, failed={result.get('failed', 0)}"
            )
            self._mark_run('crypto_lab')
        except Exception as e:
            logger.error(f"[MarketScheduler] Crypto Lab error: {e}")

    def run_live_ai_scan(self):
        """Live AI Monitor — كل 15 دقيقة أثناء الجلسة.

        يكتشف الأسهم الساخنة (hot stocks) + breakouts + volume spikes،
        ويحللها بالـ AI (glm-fast) فوراً، ويخزن النتائج في live_ai_signals.

        ده بيمثّل عيون المشروع أثناء الجلسة — كان ناقص والمستخدم فاته 6 فرص
        رابحة (ELKA, ELSH, EGTS, GGCC, NARE, TYCN) لأن الـ AI بيشتغل 2 AM بس.
        """
        if not self._should_run('live_ai_scan', 15):  # كل 15 دقيقة
            return

        logger.info("[MarketScheduler] Running Live AI Monitor...")
        try:
            import sys as _ai_sys
            import os as _ai_os
            _vps = _ai_os.path.dirname(_ai_os.path.dirname(_ai_os.path.abspath(__file__)))
            if _vps not in _ai_sys.path:
                _ai_sys.path.insert(0, _vps)

            from ai.live_ai_monitor import LiveAIMonitor
            monitor = LiveAIMonitor()
            result = monitor.scan_and_analyze(market='EGX', max_stocks=10)

            analyzed = result.get('analyzed', 0)
            success = result.get('success', 0)
            failed = result.get('failed', 0)
            logger.info(
                f"[MarketScheduler] Live AI: analyzed={analyzed}, "
                f"success={success}, failed={failed}"
            )
            self._mark_run('live_ai_scan')
        except Exception as e:
            logger.error(f"[MarketScheduler] Live AI scan error: {e}")

    def run_daily_trade_learning(self):
        """Trade Learning — يومياً post-market.

        يحلّل صفقات المستخدم الفعلية ويتعلّم منها (win/loss patterns).
        ده بيمثّل الـ learning loop الحقيقي — كان ناقص.
        """
        now = cairo_now()
        # يومياً 15:30 (بعد إغلاق السوق)
        target_time = now.replace(hour=15, minute=30, second=0, microsecond=0)
        if abs((now - target_time).total_seconds()) > 600:
            return
        if not self._should_run('trade_learning', 1440):  # مرة يومياً
            return

        logger.info("[MarketScheduler] Running trade learning...")
        try:
            import sys as _tl_sys
            import os as _tl_os
            _vps = _tl_os.path.dirname(_tl_os.path.dirname(_tl_os.path.abspath(__file__)))
            if _vps not in _tl_sys.path:
                _tl_sys.path.insert(0, _vps)

            from ai.trade_recorder import TradeRecorder
            recorder = TradeRecorder()
            result = recorder.learn_from_trades(user_id=None)  # كل المستخدمين
            logger.info(
                f"[MarketScheduler] Trade learning: analyzed={result.get('analyzed_count', 0)}, "
                f"win_rate={result.get('win_rate', 0):.1f}%, "
                f"missed_opportunities={len(result.get('missed_opportunities', []))}"
            )
            self._mark_run('trade_learning')
        except Exception as e:
            logger.error(f"[MarketScheduler] Trade learning error: {e}")

    def run_weekly_historical_learning(self):
        """Historical Trade Generator — أسبوعياً (السبت post-market).

        يولّد آلاف الصفقات من البيانات التاريخية عشان الـ AI يتعلم منها.
        كل صفقة بتتحوّل لـ story في stock_stories table → الـ RAG AI يستخدمها.

        ده بيمثّل التعلّم من التجارب (مقترح المستخدم محسن):
        بدل ما نستنى صفقات المستخدم، نولّد صفقات تلقائياً من البيانات.
        كل سهم × كل يوم = صفقة محتملة. النتيجة: آلاف التجارب للـ AI.
        """
        now = cairo_now()
        # كل يوم سبت 16:00 (بعد إغلاق السوق)
        if now.weekday() != 5:  # 5 = Saturday
            return
        target_time = now.replace(hour=16, minute=0, second=0, microsecond=0)
        if abs((now - target_time).total_seconds()) > 600:
            return
        if not self._should_run('historical_learning', 10080):  # أسبوعياً
            return

        logger.info("[MarketScheduler] Running Historical Trade Generator...")
        try:
            import sys as _hl_sys
            import os as _hl_os
            _vps = _hl_os.path.dirname(_hl_os.path.dirname(_hl_os.path.abspath(__file__)))
            if _vps not in _hl_sys.path:
                _hl_sys.path.insert(0, _vps)

            from ai.historical_trade_generator import HistoricalTradeGenerator
            gen = HistoricalTradeGenerator()

            # ولّد صفقات لكل الأسهم (ticker_limit=0 = الكل)
            result = gen.generate_all_trades(
                days_back=180,
                max_trades_per_ticker=50,
                ticker_limit=0,  # كل الأسهم
            )
            logger.info(
                f"[MarketScheduler] Historical gen: {result.get('total_trades', 0)} trades "
                f"from {result.get('successful_tickers', 0)} tickers"
            )

            # غذّي الـ AI بالصفقات الجديدة
            feed = gen.feed_to_ai_learning(limit=10000)
            logger.info(
                f"[MarketScheduler] Fed {feed.get('fed', 0)} new stories to RAG AI"
            )
            self._mark_run('historical_learning')
        except Exception as e:
            logger.error(f"[MarketScheduler] Historical learning error: {e}")

    def run_egx_indices_update(self):
        """تحديث يومي لأسعار EGX + مؤشرات EGX30/EGX100 + تتبع الثروة بعد إغلاق السوق"""
        now = cairo_now()
        target_time = now.replace(hour=15, minute=5, second=0, microsecond=0)

        if abs((now - target_time).total_seconds()) > 600:
            return
        if not self._should_run('egx_indices', 1440):
            return

        logger.info("[MarketScheduler] Running daily update (prices + wealth)...")
        try:
            # 1. Update stock prices - PRIMARY: EODHD bulk (reliable, 281 stocks in 1 request)
            try:
                import sys as _sys4
                import os as _os4
                _vps_path = _os4.dirname(_os4.dirname(_os4.abspath(__file__)))
                if _vps_path not in _sys4.path:
                    _sys4.path.insert(0, _vps_path)
                from data.eodhd_fetcher import EODHDFetcher
                fetcher = EODHDFetcher()
                eodhd_result = fetcher.update_all_stocks_bulk()
                if eodhd_result.get('success'):
                    logger.info(f"[MarketScheduler] EODHD bulk: {eodhd_result['updated']} stocks updated (PRIMARY)")
                else:
                    logger.warning(f"[MarketScheduler] EODHD bulk failed, falling back to PriceUpdater")
                    raise Exception("EODHD failed")
            except Exception as e:
                logger.warning(f"[MarketScheduler] EODHD error: {e}, using PriceUpdater fallback")
                try:
                    from scripts.daily_price_updater import PriceUpdater
                    updater = PriceUpdater()
                    results = updater.update_all()
                    for market, result in results.items():
                        if result.get('success'):
                            logger.info(f"[MarketScheduler] {market} prices (fallback): {result}")
                except Exception as e2:
                    logger.error(f"[MarketScheduler] All price sources failed: {e2}")

            # 2. Record wealth snapshot for all users
            try:
                from scripts.wealth_tracker import WealthTracker
                tracker = WealthTracker()
                wealth_result = tracker.record_daily_snapshot()
                logger.info(f"[MarketScheduler] Wealth tracking: {wealth_result.get('recorded', 0)} users")
            except Exception as e:
                logger.warning(f"[MarketScheduler] Wealth tracking error: {e}")

            # 2b. Robust daily portfolio yield + wealth_tracking snapshot
            # (Task 4: Live Portfolio Overhaul). This ensures the wealth_tracking
            # table EXISTS and is populated even if the legacy WealthTracker fails.
            try:
                from jobs.daily_portfolio_yield import run as _run_yield
                _run_yield()
                logger.info("[MarketScheduler] Daily portfolio yield snapshot recorded")
            except Exception as e:
                logger.warning(f"[MarketScheduler] Daily portfolio yield error: {e}")

            # 3. Update EGX30/EGX100 indices
            try:
                from scripts.update_egx_indices import EGXIndicesUpdater
                idx_updater = EGXIndicesUpdater()
                idx_results = idx_updater.update_all()
                for ticker, result in idx_results.items():
                    if result.get('success'):
                        logger.info(f"[MarketScheduler] EGX {ticker}: {result}")
            except Exception as e:
                logger.warning(f"[MarketScheduler] Indices update error: {e}")

            # 4. Update portfolio with live prices
            self._update_portfolio_live_prices()

            self._mark_run('egx_indices')
        except Exception as e:
            logger.error(f"[MarketScheduler] Daily update error: {e}")

    def run_price_history_safetynet(self):
        """P0: شبكة أمان يومية لـ price_history.db من Yahoo.

        مش مقيّد بـ EODHD ولا بساعات السوق ولا بـ _should_run على الفشل.
        بيشتغل post-market. لو فيه فجوة → بـ يمليها من Yahoo.
        بـ يتسجلّ في last_run['price_history_safetynet'] بس لو كتب صفوف فعلية
        أو ما فشلش حاجة (عشان ما يبقاش retry-spam).

        🔥 RL-FIX-2: تحسينات الـ reliability:
          - retry interval اتـ reduce من 360min (6h) لـ 60min (1h) — علشان يـ fill
            الـ gap بسرعة لو فيه stale data.
          - force-run على الـ startup لو price_history stale (>2 days behind) —
            مش بـ respect الـ _should_run gate في الحالة دي.
          - log أوضح علشان نـ track الـ safetynet في pm2 logs.
        """
        # 🔥 RL-FIX-2: check لو price_history stale → force-run (تجاوز الـ gate)
        force_run = False
        stale_days = 0
        try:
            import sqlite3 as _sn_sqlite
            import os as _sn_os2
            _ph_db = _sn_os2.path.join(
                _sn_os2.path.dirname(_sn_os2.path.dirname(_sn_os2.path.dirname(_sn_os2.path.abspath(__file__)))),
                'db', 'price_history.db'
            )
            if _sn_os2.path.exists(_ph_db):
                _conn = _sn_sqlite.connect(_ph_db, timeout=5)
                _row = _conn.execute("SELECT MAX(date) FROM price_history").fetchone()
                _conn.close()
                if _row and _row[0]:
                    from datetime import datetime as _sn_dt, timedelta as _sn_td
                    _last = _sn_dt.strptime(str(_row[0])[:10], '%Y-%m-%d').date()
                    _today = _sn_dt.utcnow().date()
                    stale_days = (_today - _last).days
                    if stale_days > 2:
                        force_run = True
                        logger.warning(
                            f"[MarketScheduler] price_history STALE by {stale_days} days "
                            f"(MAX(date)={_row[0]}) → force-running safetynet (bypassing _should_run gate)"
                        )
        except Exception as _stale_e:
            logger.debug(f"[MarketScheduler] stale check error: {_stale_e}")

        # كل 1 ساعة (مش 6) — عشان لو فشل أول مرة ي retry بسرعة في نفس اليوم
        # 🔥 RL-FIX-2: reduced from 360min to 60min
        if not force_run and not self._should_run('price_history_safetynet', 60):
            return
        try:
            import sys as _sn_sys
            import os as _sn_os
            _sn_vps = _sn_os.path.dirname(_sn_os.path.dirname(_sn_os.path.abspath(__file__)))
            if _sn_vps not in _sn_sys.path:
                _sn_sys.path.insert(0, _sn_vps)
            from jobs.price_history_safetynet import fill_price_history_gap
            _run_mode = 'FORCED (stale)' if force_run else 'scheduled'
            logger.info(f"[MarketScheduler] Running price_history safetynet ({_run_mode}, Yahoo gap-fill)...")
            result = fill_price_history_gap(market='EGX', dry_run=False)
            rows = result.get('rows_inserted', 0)
            updated = result.get('tickers_updated', 0)
            failed = result.get('tickers_failed', 0)
            err = result.get('error')  # 🔥 early-return error (زي yfinance ناقص)
            logger.info(
                f"[MarketScheduler] price_history safetynet DONE: updated={updated} "
                f"rows={rows} failed={failed} | MAX(date) "
                f"{result.get('gap_days_before_max')} → {result.get('gap_days_after_max')} "
                f"| report={result.get('report_path', 'none')}"
            )
            # 🔥 علّم كـ "تمت" بس لو كتب صفوف أو ما فشلش حاجة AND مفيش error.
            # قبل كده، لو fill_price_history_gap رجع early بـ error (rows=0, updated=0,
            # failed=0) كان الشرط `failed == 0` بـ يـ mark كـ "تمت" → الـ retry ما
            # كانش بيحصل. دلوقتي بنـ check `err` كمان.
            if err:
                logger.error(
                    f"[MarketScheduler] price_history safetynet ERROR: {err} — will retry in 1h"
                )
            elif rows > 0 or updated > 0 or failed == 0:
                self._mark_run('price_history_safetynet')
            else:
                logger.warning(
                    f"[MarketScheduler] price_history safetynet wrote 0 rows (failed={failed}) — will retry in 1h"
                )
        except Exception as e:
            logger.error(f"[MarketScheduler] price_history safetynet error: {e}", exc_info=True)

    def run_intraday_aggregator(self):
        """P0: تجميع الشموع اللحظية → شموع يومية في price_history.db.

        🔥 RL-FIX-2: ده الـ PRIMARY fix لجمود price_history.
        محرك البيانات بـ جمع intraday data (167k rows، 978 tickers) بس مفيش
        حاجة بـ يـ aggregate لـ daily. الـ PriceUpdater القديم كان بـ يعتمد على
        EODHD (API key متلغي) أو EGXPilot (بـ يكتب اليوم الحالي بس).

        الـ aggregator ده بـ:
        - يـ read من intraday.db.stock_intraday
        - يـ group بـ (ticker, date) ويـ aggregate OHLCV
        - يـ write لـ price_history.db بـ source='intraday_aggregated'
        - يـ backfill كل الأيام الناقصة (مش بس اليوم)

        بـ يشتغل post-market + خلال الجلسة لو price_history stale.
        """
        # كل 30 دقيقة — الـ aggregator خفيف وسريع (بـ يستخدم داتا محلية)
        if not self._should_run('intraday_aggregator', 30):
            return
        try:
            import sys as _ia_sys
            import os as _ia_os
            _ia_vps = _ia_os.path.dirname(_ia_os.path.dirname(_ia_os.path.abspath(__file__)))
            if _ia_vps not in _ia_sys.path:
                _ia_sys.path.insert(0, _ia_vps)
            from jobs.intraday_aggregator import aggregate_intraday_to_daily
            logger.info("[MarketScheduler] Running intraday aggregator (intraday → daily bars)...")
            result = aggregate_intraday_to_daily()
            rows = result.get('rows_inserted', 0)
            updated = result.get('tickers_updated', 0)
            err = result.get('error')
            logger.info(
                f"[MarketScheduler] intraday aggregator DONE: updated={updated} "
                f"tickers, rows={rows} | MAX(date) "
                f"{result.get('gap_before_max')} → {result.get('gap_after_max')} "
                f"| dates={len(result.get('dates_covered', []))}"
            )
            if err:
                logger.error(f"[MarketScheduler] intraday aggregator ERROR: {err}")
            else:
                self._mark_run('intraday_aggregator')
        except Exception as e:
            logger.error(f"[MarketScheduler] intraday aggregator error: {e}", exc_info=True)

    def run_price_history_stale_monitor(self):
        """P0: مراقب جمود price_history.db كل ساعة.

        لو MAX(date) أقدم من آخر يوم تداول بأكثر من 1 يوم → WARNING.
        لو أكثر من 3 أيام → CRITICAL.
        الهدف: نكشف الجمود بدل ما نعتمد على pm2 status = online.
        """
        if not self._should_run('price_history_stale', 60):
            return
        try:
            import sys as _sm_sys
            import os as _sm_os
            _sm_vps = _sm_os.path.dirname(_sm_os.path.dirname(_sm_os.path.abspath(__file__)))
            if _sm_vps not in _sm_sys.path:
                _sm_sys.path.insert(0, _sm_vps)
            from jobs.price_history_stale_monitor import check_price_history_stale
            status = check_price_history_stale()
            self._mark_run('price_history_stale')
            return status
        except Exception as e:
            logger.error(f"[MarketScheduler] price_history stale monitor error: {e}")
            return None

    def run_telegram_publish(self):
        """Auto-publish sniper opportunities to Telegram after market close"""
        now = cairo_now()
        # Publish at 15:00 Cairo time (30 min after market close)
        target_time = now.replace(hour=15, minute=0, second=0, microsecond=0)
        
        # Allow 10 minute window
        if abs((now - target_time).total_seconds()) > 600:
            return
        if not self._should_run('telegram_post', 1440):  # Once per day
            return
        
        if not self.telegram_poster:
            logger.warning("[MarketScheduler] TelegramAutoPoster not available — skipping auto-publish")
            return
        
        logger.info("[MarketScheduler] Running Telegram auto-publish...")
        try:
            # Get today's sniper opportunities
            opportunities = []
            if self.sniper_engine:
                results = self.sniper_engine.scan_market(market='EGX', persona='balanced', min_gates=4)
                opportunities = results[:5]  # Top 5 opportunities
            
            if opportunities:
                # Build message
                from dataclasses import asdict
                msg_lines = ["🎯 فرص القناص اليوم", "=" * 30, ""]

                # Add EGX30 regime info to Telegram message
                if self.current_regime:
                    regime = self.current_regime
                    trading_status = "ALLOWED" if not self.trading_paused else "PAUSED"
                    msg_lines.append(
                        f"📊 EGX30 Stage: {regime.stage_name} | "
                        f"Trading: {trading_status} | "
                        f"Pos: {regime.position_modifier:.0%}"
                    )
                    msg_lines.append("")

                for i, opp in enumerate(opportunities, 1):
                    msg_lines.append(
                        f"{i}. {opp.ticker} | {opp.signal_ar} | "
                        f"دخول: {opp.entry_price:.2f} | هدف: {opp.target_price:.2f} | "
                        f"وقف: {opp.stop_loss:.2f} | R/R: {opp.risk_reward:.1f} | "
                        f"بوابات: {opp.gates_passed}/5"
                    )
                msg_lines.append("")
                msg_lines.append("⚡ تحليل آلي بواسطة القناص")
                msg_lines.append("⚠️ تنبيه: التحليل استرشادي وليس توصية شراء")
                msg_lines.append("")
                msg_lines.append("━━━━━━━━━━━━━━━━━━━")
                msg_lines.append("🌐 الموقع: https://invist.m2y.net")
                msg_lines.append("📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment")
                msg_lines.append("📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048")
                msg_lines.append("✈️ تليجرام: https://t.me/Arabian_investment_guide")
                msg_lines.append("━━━━━━━━━━━━━━━━━━━")
                msg_lines.append("📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈")
                
                message = "\n".join(msg_lines)
                
                # Try to publish
                try:
                    # Telethon-based posting.
                    # FIX (Task 14-B-FIX): auto_poster.send_message is
                    # `async def` (auto_poster.py:172) but run_telegram_publish
                    # is a SYNC function (called from a threading.Thread).
                    # Calling the coroutine without awaiting leaves it
                    # un-awaited → "coroutine was never awaited" warning +
                    # sniper opportunities silently never publish.
                    if hasattr(self.telegram_poster, 'send_message'):
                        asyncio.run(self.telegram_poster.send_message(message))
                        logger.info(f"[MarketScheduler] Published {len(opportunities)} sniper opportunities to Telegram")
                except Exception as e:
                    logger.error(f"[MarketScheduler] Telegram publish error: {e}")
            else:
                logger.info("[MarketScheduler] No sniper opportunities to publish today")
            
            self._mark_run('telegram_post')
        except Exception as e:
            logger.error(f"[MarketScheduler] Telegram auto-publish error: {e}")

    def run_intraday_price_update(self):
        """
        تحديث أسعار EGX الحية أثناء الجلسة كل 5 دقائق
        المصدر الأساسي: EGXPilot (أسعار لحظية حقيقية + توصيات)
        المصدر الاحتياطي 1: TradingView (إذا كان متاحاً)
        المصدر الاحتياطي 2: EODHD (بيانات نهاية اليوم)
        """
        if not self._should_run('intraday_prices', 5):
            return
        if not self._is_egx_market_hours():
            return

        logger.info("[MarketScheduler] Running intraday EGX price update (EGXPilot primary)...")
        try:
            import sqlite3
            import sys as _sys
            import os as _os
            import time as _time
            import requests as _requests
            _vps = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
            _root = _os.path.dirname(_vps)
            if _vps not in _sys.path:
                _sys.path.insert(0, _vps)
            db_path = _os.path.join(_root, 'db', 'stocks.db')

            # ===== EGXPilot: المصدر الأساسي للأسعار اللحظية =====
            try:
                resp = _requests.get('https://egxpilot.com/api/stocks/all', timeout=15)
                if resp.status_code == 200:
                    egx_stocks = resp.json().get('stocks', [])
                    # Build ticker → data map
                    price_map = {}
                    for s in egx_stocks:
                        symbol = s.get('Symbol', '').strip()
                        if not symbol or symbol.startswith('.'):
                            continue
                        price = s.get('LastPrice', 0)
                        change = s.get('DailyChange', 0)
                        if price and price > 0:
                            try:
                                price = float(price)
                                change = float(change) if change else 0
                                price_map[symbol] = {
                                    'price': price,
                                    'change': change,
                                    'recommendation': s.get('Recommendation', ''),
                                    'daily': s.get('Daily', ''),
                                    'weekly': s.get('Weekly', ''),
                                    'monthly': s.get('Monthly', ''),
                                }
                            except (ValueError, TypeError):
                                pass

                    if price_map:
                        conn = None
                        try:
                            # Phase 7.1: migrated to db_manager (writable=False)
                            from core.db_manager import db_manager
                            # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but EGXPilot path does UPDATE stocks + commit
                            conn = db_manager.get_connection(db_path, writable=True)
                            cur = conn.cursor()
                            updated = 0
                            for ticker, data in price_map.items():
                                try:
                                    cur.execute('''
                                        UPDATE stocks SET
                                            current_price = ?,
                                            change_percent = ?,
                                            last_update = ?,
                                            updated_at = datetime('now')
                                        WHERE ticker = ?
                                    ''', (
                                        data['price'],
                                        data['change'],
                                        _time.strftime('%Y-%m-%dT%H:%M:%S'),
                                        ticker
                                    ))
                                    if cur.rowcount > 0:
                                        updated += 1
                                except Exception as e:
                                    logger.warning(f"[MarketScheduler] Error updating live price for {ticker}: {e}")
                            conn.commit()
                        finally:
                            # P14-PHASE-B (MEM-02): ضمان إغلاق conn
                            if conn is not None:
                                try:
                                    conn.close()
                                except Exception:
                                    pass

                        logger.info(f"[MarketScheduler] EGXPilot: {updated} stocks updated with LIVE prices")

                        # Update portfolio
                        self._update_portfolio_live_prices()

                        # Recalculate all pending predictions with the new live prices
                        try:
                            from api.ai_predictions_routes import evaluate_all_pending_predictions_internal
                            evaluate_all_pending_predictions_internal()
                        except Exception as e_eval:
                            logger.error(f"[MarketScheduler] Error running live prediction evaluation: {e_eval}")

                        # Rebuild predictions with new live prices
                        try:
                            from api.ai_predictions_routes import generate_predictions_internal
                            generate_predictions_internal(market='EGX', min_score=60, clear_old=False)
                        except Exception as e_pred:
                            logger.error(f"[MarketScheduler] Error regenerating predictions after price update: {e_pred}")

                        # Cleanup invalidated predictions after price update cycle
                        try:
                            from api.ai_predictions_routes import cleanup_invalidated_predictions
                            cleanup_invalidated_predictions()
                        except Exception as e_clean:
                            logger.error(f"[MarketScheduler] Error cleaning up predictions: {e_clean}")

                        self._mark_run('intraday_prices')
                        return
                    else:
                        logger.warning("[MarketScheduler] EGXPilot returned no valid prices")
                else:
                    logger.warning(f"[MarketScheduler] EGXPilot HTTP {resp.status_code}")
            except Exception as e:
                logger.warning(f"[MarketScheduler] EGXPilot error: {e}")

            # ===== Fallback 1: TradingView =====
            try:
                from tradingview_ta import TA_Handler, Interval
                TV_AVAILABLE = True
            except ImportError:
                TV_AVAILABLE = False

            if TV_AVAILABLE:
                logger.info("[MarketScheduler] Falling back to TradingView...")
                # Get tickers
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.get_connection(db_path, writable=False)
                try:
                    cur = conn.cursor()
                    ticker_rows = cur.execute("""
                        SELECT ticker FROM stocks
                        WHERE ticker NOT NULL AND ticker != ''
                          AND ticker NOT LIKE '%D%'
                          AND (market = 'EGX' OR market IS NULL)
                        ORDER BY ticker
                    """).fetchall()
                    all_tickers = [r[0] for r in ticker_rows if len(r[0]) <= 6 and r[0].isalpha()]
                finally:
                    # P14-PHASE-B (MEM-02): ضمان إغلاق conn
                    try:
                        conn.close()
                    except Exception:
                        pass

                if not hasattr(self, 'last_intraday_index'):
                    self.last_intraday_index = 0
                BATCH_LIMIT = 15
                start_idx = self.last_intraday_index
                end_idx = start_idx + BATCH_LIMIT
                if start_idx >= len(all_tickers):
                    start_idx = 0
                    end_idx = BATCH_LIMIT
                tickers_to_process = all_tickers[start_idx:end_idx]
                self.last_intraday_index = end_idx if end_idx < len(all_tickers) else 0

                updated = 0
                errors = 0
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but TradingView fallback does UPDATE stocks + commit
                conn = db_manager.get_connection(db_path, writable=True)
                try:
                    cur = conn.cursor()

                    for ticker in tickers_to_process:
                        try:
                            handler = TA_Handler(symbol=ticker, screener="egypt", exchange="EGX", interval=Interval.INTERVAL_1_DAY)
                            analysis = handler.get_analysis()
                            if not analysis:
                                errors += 1
                                continue
                            ind = analysis.indicators
                            price = ind.get('close', 0)
                            if not price or price <= 0:
                                errors += 1
                                continue
                            prev_close = ind.get('previous_close') or price
                            change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
                            cur.execute('''
                                UPDATE stocks SET current_price=?, change_percent=?, last_update=?, updated_at=datetime('now')
                                WHERE ticker=?
                            ''', (round(price, 4), round(change_pct, 4), _time.strftime('%Y-%m-%dT%H:%M:%S'), ticker))
                            if cur.rowcount > 0:
                                updated += 1
                            _time.sleep(1.5)
                        except Exception:
                            errors += 1

                    conn.commit()
                finally:
                    # P14-PHASE-B (MEM-02): ضمان إغلاق conn
                    try:
                        conn.close()
                    except Exception:
                        pass
                logger.info(f"[MarketScheduler] TradingView: {updated} updated, {errors} errors")
                self._update_portfolio_live_prices()

                # Recalculate all pending predictions with the new live prices
                try:
                    from api.ai_predictions_routes import evaluate_all_pending_predictions_internal
                    evaluate_all_pending_predictions_internal()
                except Exception as e_eval:
                    logger.error(f"[MarketScheduler] Error running live prediction evaluation: {e_eval}")

                # Rebuild predictions with new live prices
                try:
                    from api.ai_predictions_routes import generate_predictions_internal
                    generate_predictions_internal(market='EGX', min_score=60, clear_old=False)
                except Exception as e_pred:
                    logger.error(f"[MarketScheduler] Error regenerating predictions after price update: {e_pred}")

                # Cleanup invalidated predictions after price update cycle
                try:
                    from api.ai_predictions_routes import cleanup_invalidated_predictions
                    cleanup_invalidated_predictions()
                except Exception as e_clean:
                    logger.error(f"[MarketScheduler] Error cleaning up predictions: {e_clean}")

                self._mark_run('intraday_prices')
                return

            # ===== Fallback 2: EODHD (end of day only) =====
            logger.info("[MarketScheduler] Falling back to EODHD (end-of-day data)...")
            try:
                from data.eodhd_fetcher import EODHDFetcher
                fetcher = EODHDFetcher()
                eodhd_result = fetcher.update_all_stocks_bulk()
                if eodhd_result.get('success'):
                    updated = eodhd_result['updated']
                    logger.info(f"[MarketScheduler] EODHD intraday: {updated} stocks updated")
                self._update_portfolio_live_prices()

                # Recalculate all pending predictions with the new live prices
                try:
                    from api.ai_predictions_routes import evaluate_all_pending_predictions_internal
                    evaluate_all_pending_predictions_internal()
                except Exception as e_eval:
                    logger.error(f"[MarketScheduler] Error running live prediction evaluation: {e_eval}")

                # Rebuild predictions with new live prices
                try:
                    from api.ai_predictions_routes import generate_predictions_internal
                    generate_predictions_internal(market='EGX', min_score=60, clear_old=False)
                except Exception as e_pred:
                    logger.error(f"[MarketScheduler] Error regenerating predictions after price update: {e_pred}")

                # Cleanup invalidated predictions after price update cycle
                try:
                    from api.ai_predictions_routes import cleanup_invalidated_predictions
                    cleanup_invalidated_predictions()
                except Exception as e_clean:
                    logger.error(f"[MarketScheduler] Error cleaning up predictions: {e_clean}")

                self._mark_run('intraday_prices')
            except Exception as e:
                logger.error(f"[MarketScheduler] All price sources failed: {e}")

        except Exception as e:
            logger.error(f"[MarketScheduler] Intraday price update error: {e}")



    def run_screener_presets(self):
        """Compute screener presets once daily post-market (after prices are updated).

        Computes:
        - turnover_egp, volume_week, volume_month
        - change_1d, change_1w, change_1m
        - fair_value + upside_percent (for undervalued/overvalued presets)

        Saves results to screener_presets table in stocks.db.
        """
        if not self._should_run('screener_presets', 1440):  # once per day
            return

        now = cairo_now()
        # Run post-market between 15:05 and 15:30 Cairo time
        target_start = now.replace(hour=15, minute=5, second=0, microsecond=0)
        target_end = now.replace(hour=15, minute=30, second=0, microsecond=0)
        if not (target_start <= now <= target_end):
            return

        logger.info("[MarketScheduler] Computing screener presets...")
        conn = None
        conn_ph = None
        try:
            import sqlite3
            import os as _os
            _root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
            stocks_db = _os.path.join(_root, 'db', 'stocks.db')
            price_history_db = _os.path.join(_root, 'db', 'price_history.db')

            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but does CREATE TABLE screener_presets + INSERT + commit
            conn = db_manager.get_connection(stocks_db, writable=True)
            conn.row_factory = sqlite3.Row

            # Ensure table exists
            conn.execute("""
                CREATE TABLE IF NOT EXISTS screener_presets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    preset TEXT NOT NULL,
                    ticker TEXT NOT NULL,
                    name TEXT,
                    name_ar TEXT,
                    market TEXT DEFAULT 'EGX',
                    sector TEXT,
                    current_price REAL,
                    previous_close REAL,
                    change_1d REAL,
                    change_1w REAL,
                    change_1m REAL,
                    volume INTEGER,
                    volume_week INTEGER,
                    volume_month INTEGER,
                    turnover_egp REAL,
                    fair_value REAL,
                    upside_percent REAL,
                    market_cap REAL,
                    pe_ratio REAL,
                    computed_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(ticker, market, preset)
                )
            """)
            conn.commit()

            # Get all active EGX stocks
            stocks = conn.execute("""
                SELECT ticker, name, name_ar, market, sector,
                       current_price, previous_close, volume, market_cap, pe_ratio
                FROM stocks
                WHERE is_active = 1 AND current_price > 0
                  AND (market = 'EGX' OR market IS NULL)
            """).fetchall()

            if not stocks:
                logger.warning("[ScreenerPresets] No active stocks found")
                return

            # Prepare price history connection for volume sums and change periods
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn_ph = db_manager.get_connection(price_history_db, writable=True)
            conn_ph.row_factory = sqlite3.Row

            # Batch insert/update
            inserted = 0
            updated = 0
            fair_value_count = 0

            # Try to import FairValueCalculator
            try:
                import sys as _fv_sys
                _vps = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
                if _vps not in _fv_sys.path:
                    _fv_sys.path.insert(0, _vps)
                from analyzers.fair_value_calculator import FairValueCalculator
                fv_calc = FairValueCalculator()
                fv_available = True
            except Exception as e:
                logger.warning(f"[ScreenerPresets] FairValueCalculator not available: {e}")
                fv_available = False

            presets = ['most_active', 'top_gainers', 'top_losers', 'undervalued', 'overvalued']

            for stock in stocks:
                ticker = stock['ticker']
                current_price = stock['current_price'] or 0
                previous_close = stock['previous_close'] or current_price
                volume = stock['volume'] or 0
                turnover_egp = current_price * volume if current_price > 0 else 0

                # Volume week/month from price_history.db
                # PHASE-1-TODO: bulk aggregate — needs data.prices.bulk helpers (PHASE 5)
                volume_week = 0
                volume_month = 0
                try:
                    week_rows = conn_ph.execute("""
                        SELECT SUM(volume) as vol FROM stock_daily_prices
                        WHERE ticker = ? AND price_date >= date('now', '-7 days')
                    """, (ticker,)).fetchone()
                    volume_week = week_rows['vol'] or 0

                    month_rows = conn_ph.execute("""
                        SELECT SUM(volume) as vol FROM stock_daily_prices
                        WHERE ticker = ? AND price_date >= date('now', '-30 days')
                    """, (ticker,)).fetchone()
                    volume_month = month_rows['vol'] or 0
                except Exception:
                    pass

                # Change periods
                change_1d = 0
                change_1w = 0
                change_1m = 0
                try:
                    if previous_close > 0:
                        change_1d = ((current_price - previous_close) / previous_close) * 100

                    # 1 week ago price
                    # PHASE-1-TODO: bulk aggregate — needs data.prices.bulk helpers (PHASE 5)
                    price_1w = conn_ph.execute("""
                        SELECT close FROM stock_daily_prices
                        WHERE ticker = ? AND price_date <= date('now', '-7 days')
                        ORDER BY price_date DESC LIMIT 1
                    """, (ticker,)).fetchone()
                    if price_1w and price_1w['close'] and price_1w['close'] > 0:
                        change_1w = ((current_price - price_1w['close']) / price_1w['close']) * 100

                    # 1 month ago price
                    # PHASE-1-TODO: bulk aggregate — needs data.prices.bulk helpers (PHASE 5)
                    price_1m = conn_ph.execute("""
                        SELECT close FROM stock_daily_prices
                        WHERE ticker = ? AND price_date <= date('now', '-30 days')
                        ORDER BY price_date DESC LIMIT 1
                    """, (ticker,)).fetchone()
                    if price_1m and price_1m['close'] and price_1m['close'] > 0:
                        change_1m = ((current_price - price_1m['close']) / price_1m['close']) * 100
                except Exception:
                    pass

                # Fair value (only for undervalued/overvalued presets, and only if calculator available)
                fair_value = None
                upside_percent = None
                if fv_available and ticker not in ('EGX30', 'EGX100'):
                    try:
                        fv_result = fv_calc.calculate(ticker, 'EGX')
                        if fv_result and fv_result.fair_value and fv_result.fair_value > 0:
                            fair_value = round(fv_result.fair_value, 2)
                            if current_price > 0:
                                upside_percent = round(((fair_value - current_price) / current_price) * 100, 2)
                            fair_value_count += 1
                    except Exception:
                        pass

                # Insert/update for each preset
                for preset in presets:
                    try:
                        conn.execute("""
                            INSERT OR REPLACE INTO screener_presets
                                (preset, ticker, name, name_ar, market, sector,
                                 current_price, previous_close,
                                 change_1d, change_1w, change_1m,
                                 volume, volume_week, volume_month,
                                 turnover_egp, fair_value, upside_percent,
                                 market_cap, pe_ratio, computed_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                        """, (
                            preset, ticker, stock['name'], stock['name_ar'],
                            stock['market'] or 'EGX', stock['sector'],
                            current_price, previous_close,
                            change_1d, change_1w, change_1m,
                            volume, volume_week, volume_month,
                            turnover_egp, fair_value, upside_percent,
                            stock['market_cap'], stock['pe_ratio']
                        ))
                        if conn.total_changes > 0:
                            inserted += 1
                        else:
                            updated += 1
                    except Exception as e:
                        logger.debug(f"[ScreenerPresets] Error inserting {ticker}/{preset}: {e}")

            conn.commit()

            logger.info(
                f"[ScreenerPresets] Computed {len(stocks)} stocks x {len(presets)} presets = "
                f"{inserted + updated} rows | fair_values={fair_value_count} | "
                f"inserted={inserted} updated={updated}"
            )
            self._mark_run('screener_presets')
        except Exception as e:
            logger.error(f"[MarketScheduler] Screener presets error: {e}")
        finally:
            # P14-PHASE-B (MEM-02): ضمان إغلاق conn و conn_ph حتى لو حصل Exception
            for _c in (conn, conn_ph):
                if _c is not None:
                    try:
                        _c.close()
                    except Exception:
                        pass

    def _update_portfolio_live_prices(self):
        """تحديث القيمة الحالية لأسهم المحفظة بالأسعار الحية"""
        try:
            import sqlite3
            import os as _os
            _root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
            db_path = _os.path.join(_root, 'db', 'stocks.db')
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but _update_portfolio_live_prices does UPDATE portfolio_assets + commit
            conn = db_manager.get_connection(db_path, writable=True)
            try:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()

                # Get all stock holdings with their tickers
                rows = cur.execute('''
                    SELECT id, stock_ticker, quantity, avg_buy_price, total_invested
                    FROM portfolio_assets
                    WHERE type = 'stock' AND stock_ticker IS NOT NULL AND quantity > 0
                ''').fetchall()

                updated = 0
                total_gain_loss = 0.0
                for r in rows:
                    ticker = r['stock_ticker']
                    # Get live price from stocks table (just updated by egx_fetcher)
                    price_row = cur.execute(
                        'SELECT current_price FROM stocks WHERE ticker = ? OR ticker = ?',
                        (ticker, ticker.upper())
                    ).fetchone()
                    if price_row and price_row['current_price'] and r['quantity']:
                        live_price = price_row['current_price']
                        current_value = live_price * r['quantity']
                        gain_loss = current_value - (r['total_invested'] or 0)
                        total_gain_loss += gain_loss
                        cur.execute('''
                            UPDATE portfolio_assets
                            SET current_value = ?, updated_at = datetime('now')
                            WHERE id = ?
                        ''', (current_value, r['id']))
                        updated += 1

                conn.commit()
            finally:
                # P14-PHASE-B (MEM-02): ضمان إغلاق conn
                try:
                    conn.close()
                except Exception:
                    pass
            if updated > 0:
                logger.info(f"[MarketScheduler] Portfolio: updated {updated} stock holdings live values (P&L: {total_gain_loss:+.2f})")
        except Exception as e:
            logger.error(f"[MarketScheduler] Portfolio live update error: {e}")

    def _run_bag_holder_alerts(self):
        """
        P31-PORTFOLIO-SMART-MATH-RESCUE (Task 4): Proactive bag-holder detection.
        Checks every user stock holding: if live_price <= purchase_price * 0.85
        (i.e. loss >= 15%), insert a notification row so the user is alerted
        automatically instead of having to discover the loss manually.
        Idempotent: one alert per (user_id, ticker, day).
        """
        import sqlite3 as _sq
        import os as _os
        from pathlib import Path as _P
        try:
            _root = _P(__file__).resolve().parent.parent.parent
            stocks_db = str(_root / 'db' / 'stocks.db')
            price_hist_db = str(_root / 'db' / 'price_history.db')
            conn = _sq.connect(stocks_db)
            conn.row_factory = _sq.Row
            cur = conn.cursor()

            # Ensure notifications table exists (idempotent)
            cur.execute('''
                CREATE TABLE IF NOT EXISTS user_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    ticker TEXT,
                    type TEXT DEFAULT 'bag_holder_alert',
                    loss_pct REAL,
                    message TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    read INTEGER DEFAULT 0
                )
            ''')

            rows = cur.execute('''
                SELECT id, user_id, stock_ticker, quantity, avg_buy_price, purchase_price, total_invested
                FROM portfolio_assets
                WHERE type = 'stock' AND stock_ticker IS NOT NULL
                  AND (avg_buy_price > 0 OR purchase_price > 0)
            ''').fetchall()

            alerted = 0
            for r in rows:
                ticker = (r['stock_ticker'] or '').upper().strip()
                if not ticker:
                    continue
                buy_price = float(r['avg_buy_price'] or r['purchase_price'] or 0)
                if buy_price <= 0:
                    continue

                # Live price: stocks.db first, then price_history.db (yahoo_clean)
                live_price = 0.0
                pr = cur.execute(
                    'SELECT current_price, previous_close FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1',
                    (ticker,)
                ).fetchone()
                if pr:
                    if pr['current_price'] and float(pr['current_price']) > 0:
                        live_price = float(pr['current_price'])
                    elif pr['previous_close'] and float(pr['previous_close']) > 0:
                        live_price = float(pr['previous_close'])

                if live_price <= 0:
                    # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
                    try:
                        from data.prices import load_price_history
                        _bag_hist = load_price_history(ticker, limit=1)
                        if _bag_hist and _bag_hist[-1].get('close'):
                            live_price = float(_bag_hist[-1]['close'])
                    except Exception:
                        pass

                if live_price <= 0:
                    continue

                loss_pct = ((live_price - buy_price) / buy_price) * 100
                if loss_pct <= -15:
                    # Idempotent: skip if an alert already exists for this user+ticker+today
                    from datetime import datetime as _dt
                    today = _dt.now().strftime('%Y-%m-%d')
                    exists = cur.execute(
                        "SELECT 1 FROM user_notifications WHERE user_id = ? AND ticker = ? AND type = 'bag_holder_alert' AND created_at LIKE ? LIMIT 1",
                        (r['user_id'] or 'default', ticker, f'{today}%')
                    ).fetchone()
                    if exists:
                        continue
                    cur.execute('''
                        INSERT INTO user_notifications (user_id, ticker, type, loss_pct, message)
                        VALUES (?, ?, 'bag_holder_alert', ?, ?)
                    ''', (
                        r['user_id'] or 'default',
                        ticker,
                        round(loss_pct, 2),
                        f"🚨 تنبيه: أنت مزنوق في سهم {ticker} بخسارة {abs(round(loss_pct, 1))}% — افتح المحفظة للحصول على خطة الإنقاذ."
                    ))
                    alerted += 1

            conn.commit()
            conn.close()
            if alerted > 0:
                logger.info(f"[MarketScheduler] Bag-holder alerts: inserted {alerted} new proactive alert(s)")
        except Exception as e:
            logger.error(f"[MarketScheduler] Bag-holder alerts error: {e}")

    def _run_daily_task(self, hour: int, minute: int, task_key: str, task_fn, window_minutes: int = 5):
        """🔥 P14 (أغسطس 2026): جدولة يومية موثوقة بدل النوافذ الزمنية الهشة.

        المشكلة القديمة: `abs((now - target).total_seconds()) < 60` — لو tick
        وقع خارج الـ 60 ثانية، المهمة بتتفوت ليوم كامل! ده السبب إن
        "الأعمال المجدولة بتأتي في أوقات خاطئة" على السرفر الإنتاجي.

        الحل: نستخدم نافذة أكتر (5 دقايق افتراضياً) + guard "هل اشتغلت النهارده؟"
        عبر تتبع تاريخ آخر تشغيل. لو اشتغلت النهارده → skip. كده حتى لو tick
        وقع متأخر شوية، المهمة هتشغل في أول فرصة جوه النافذة.
        """
        now = cairo_now()
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        # النافذة: من target - window حتى target + window (بالدقايق)
        _lower = target - timedelta(minutes=window_minutes)
        _upper = target + timedelta(minutes=window_minutes)
        if not (_lower <= now <= _upper):
            return False
        # guard: هل اشتغلت النهارده؟
        _today = now.strftime('%Y-%m-%d')
        _last_key = f'_daily_{task_key}_date'
        if getattr(self, _last_key, None) == _today:
            return False  # اشتغلت النهارده خلاص
        # شغّل
        try:
            task_fn()
        except Exception as e:
            logger.error(f"[MarketScheduler] Daily task '{task_key}' error: {e}")
        finally:
            setattr(self, _last_key, _today)
        return True

    def run_live_trailing_stop_update(self):
        """LIVE-TRAILING-STOP (v3.63.0 → V39.2): Update trailing_stop for active BUY recommendations every 15 min.

        لكل سهم فيه توصية BUY نشطة (updated within 30 days):
        1. اقرا price_history (آخر 30 يوم)
        2. احسب highest_close_since_entry + ATR(14)
        2b. V39.2: اقرا أعلى سعر لحظي (Intraday High) من intraday.db
            عشان لو السهم فجر في النص ويرجع، نكون أمنا الربح
        3. new_trailing = highest_close - ATR * trail_mult
           trail_mult ديناميكي حسب persona + momentum (v3.64.0):
             - gambler:      2.0 (أضيق — يطلع بسرعة)
             - balanced:     2.5 (وسطي)
             - conservative: 3.5 (أوسع — يتحمل التذبذب)
           ولو momentum_uncap=True (زخم انفجاري volume_ratio>=2.0 + change_1w>=8%):
             - gambler:      2.5 (+0.5 — ما نطردهش في الترند)
             - balanced:     3.0 (+0.5)
             - conservative: 4.0 (+0.5)
        4. لو new_trailing > current trailing_stop (الـ trailing بيتحرك لأعلى بس):
           UPDATE analysis_json.trailing_stop في stored_analyses

        آمن: لو مفيش data، skip؛ لو error، skip (مش يكسر الـ scheduler).
        مفيش schema change — الـ trailing_stop بيتحفظ في analysis_json JSON field.

        # SINGLE-WRITER (Task PHASE-3, Rule 73) — DISABLED. daily_predictor.py is the
        # canonical writer. This method now returns immediately without updating
        # analysis_json.trailing_stop in stored_analyses. Set
        # SKIP_STORED_ANALYSES_WRITE = False to re-enable trailing-stop updates.
        """
        # SINGLE-WRITER (Task PHASE-3, Rule 73)
        # Only daily_predictor.py is allowed to write to stored_analyses.
        # This writer is disabled to prevent conflicting decisions (last-writer-wins).
        SKIP_STORED_ANALYSES_WRITE = True
        if SKIP_STORED_ANALYSES_WRITE:
            try:
                logger.info('[SINGLE-WRITER] Skipping trailing_stop UPDATE in run_live_trailing_stop_update — use daily_predictor.py')
            except Exception:
                pass
            self._mark_run('trailing_stop_update')
            return
        if not self._should_run('trailing_stop_update', 15):
            return
        _ts_conn = None
        try:
            import sqlite3 as _ts_sql
            import json as _ts_json
            from data.prices import load_price_history

            _ts_conn = _ts_sql.connect(PREDICTIONS_DB, timeout=30.0)
            _ts_conn.row_factory = _ts_sql.Row
            # v3.64.0: محاولة جلب column persona (لو موجود في الـ schema).
            # الـ schema في background_analyzer.py مفيهاش persona column، بس
            # migrator.py بيعمله ALTER. فنعمل try SELECT مع persona، ولو فشل
            # (OperationalError: no such column) نرجع لـ SELECT من غير persona
            # ونعتمد على analysis_json لتحديد الـ persona.
            try:
                _ts_rows = _ts_conn.execute('''
                    SELECT id, ticker, entry_price, analysis_json, updated_at, persona
                    FROM stored_analyses
                    WHERE recommendation IN ('buy', 'strong_buy', 't1_buy', 'swing_buy')
                      AND updated_at > datetime('now', '-30 days')
                      AND entry_price > 0
                ''').fetchall()
                _ts_has_persona_col = True
            except Exception as _q_e:
                logger.debug(f"[LiveTrailingStop] persona column missing, falling back: {_q_e}")
                _ts_rows = _ts_conn.execute('''
                    SELECT id, ticker, entry_price, analysis_json, updated_at
                    FROM stored_analyses
                    WHERE recommendation IN ('buy', 'strong_buy', 't1_buy', 'swing_buy')
                      AND updated_at > datetime('now', '-30 days')
                      AND entry_price > 0
                ''').fetchall()
                _ts_has_persona_col = False

            # v3.64.0: trail_mult ديناميكي حسب persona + momentum.
            # persona → trail_mult الأساسي. momentum_uncap → +0.5 (نوسّع عشان
            # السهم في ترند انفجاري، ما نطردهش بدري).
            _TS_TRAIL_MULT = {
                'gambler':      2.0,
                'balanced':     2.5,
                'conservative': 3.5,
            }
            _TS_TRAIL_MULT_MOMENTUM = {
                'gambler':      2.5,
                'balanced':     3.0,
                'conservative': 4.0,
            }

            _updated = 0
            _skipped = 0
            for _ts_row in _ts_rows:
                try:
                    _ts_ticker = _ts_row['ticker']
                    _ts_entry = float(_ts_row['entry_price'] or 0)
                    _ts_analysis_json = _ts_row['analysis_json']

                    if _ts_entry <= 0:
                        _skipped += 1
                        continue

                    # parse analysis_json عشان نقرا persona + momentum_uncap
                    # (بنعمله هنا بدري عشان نعرف الـ trail_mult قبل ما نحسبه)
                    _ts_analysis = {}
                    if _ts_analysis_json:
                        try:
                            _ts_analysis = _ts_json.loads(_ts_analysis_json) if isinstance(_ts_analysis_json, str) else _ts_analysis_json
                        except Exception:
                            _ts_analysis = {}

                    # v3.64.0: تحديد persona من مصادر متعددة (defensive):
                    #   1. analysis_json['persona'] (لو متخزن كـ string)
                    #   2. column persona (لو موجود ومش فاضي)
                    #   3. fallback: 'balanced'
                    _ts_persona = 'balanced'
                    try:
                        _ts_p_str = _ts_analysis.get('persona')
                        if isinstance(_ts_p_str, str) and _ts_p_str.strip():
                            _ts_persona = _ts_p_str.strip().lower()
                        elif _ts_has_persona_col and _ts_row['persona']:
                            _ts_persona = str(_ts_row['persona']).strip().lower()
                    except Exception:
                        _ts_persona = 'balanced'
                    # تطبيع الأسماء البديلة (active_trader → gambler, investor → conservative)
                    if _ts_persona in ('active_trader', 't1_buy', 'swing_buy'):
                        _ts_persona = 'gambler' if _ts_persona == 'active_trader' else 'balanced'
                    elif _ts_persona == 'investor':
                        _ts_persona = 'conservative'
                    if _ts_persona not in _TS_TRAIL_MULT:
                        _ts_persona = 'balanced'

                    # v3.64.0: تحديد momentum_uncap من persona_rr[persona]['momentum_uncap']
                    # لو أي persona في persona_rr عندها momentum_uncap=True، نعتبر
                    # السهم في ترند انفجاري (لأن الـ persona_rr بيتبنا للـ 3 شخصيات).
                    _ts_is_momentum = False
                    try:
                        _ts_prr = _ts_analysis.get('persona_rr') or {}
                        if isinstance(_ts_prr, dict):
                            for _pk, _pv in _ts_prr.items():
                                if isinstance(_pv, dict) and _pv.get('momentum_uncap'):
                                    _ts_is_momentum = True
                                    break
                                if isinstance(_pv, dict) and _pv.get('method') == 'momentum_uncap':
                                    _ts_is_momentum = True
                                    break
                    except Exception:
                        _ts_is_momentum = False

                    # اختر الـ trail_mult table المناسب
                    _ts_mult_table = _TS_TRAIL_MULT_MOMENTUM if _ts_is_momentum else _TS_TRAIL_MULT
                    _ts_trail_mult = _ts_mult_table.get(_ts_persona, 2.5)

                    # اقرا price_history (آخر 30 يوم)
                    _ts_ph = load_price_history(_ts_ticker, limit=30)
                    if not _ts_ph or len(_ts_ph) < 5:
                        _skipped += 1
                        continue

                    # حساب closes + highs + lows
                    _ts_closes = [float(r.get('close', 0) or 0) for r in _ts_ph]
                    _ts_closes = [c for c in _ts_closes if c > 0]
                    if not _ts_closes:
                        _skipped += 1
                        continue
                    _ts_highest_close = max(_ts_closes)

                    # V39.2: اقرا أعلى سعر لحظي (Intraday High) من intraday.db
                    # عشان لو السهم فجر في النص ويرجع، نكون أمنا الربح.
                    # Fallback لـ highest_close لو intraday مش متاح.
                    try:
                        _ts_intraday_db = str(PROJECT_ROOT / 'db' / 'intraday.db')
                        if os.path.exists(_ts_intraday_db):
                            _ts_idb_conn = _ts_sql.connect(_ts_intraday_db, timeout=10.0)
                            _ts_idb_conn.row_factory = _ts_sql.Row
                            # Get the highest intraday high from the last 5 trading sessions
                            _ts_intraday_rows = _ts_idb_conn.execute('''
                                SELECT MAX(high) as max_high
                                FROM stock_intraday
                                WHERE ticker = ?
                                  AND timestamp >= datetime('now', '-5 days')
                            ''', (_ts_ticker,)).fetchone()
                            _ts_idb_conn.close()
                            if _ts_intraday_rows and _ts_intraday_rows['max_high']:
                                _ts_intraday_high = float(_ts_intraday_rows['max_high'])
                                if _ts_intraday_high > _ts_highest_close:
                                    _ts_highest_close = _ts_intraday_high
                    except Exception as _ts_idb_e:
                        logger.debug(f"[LiveTrailingStop] Intraday DB lookup skipped for {_ts_ticker}: {_ts_idb_e}")

                    # حساب ATR (14 يوم)
                    _ts_highs = [float(r.get('high', 0) or 0) for r in _ts_ph[-15:]]
                    _ts_lows = [float(r.get('low', 0) or 0) for r in _ts_ph[-15:]]
                    _ts_atr = 0.0
                    if len(_ts_closes) >= 5 and len(_ts_highs) >= 5:
                        _ts_trs = []
                        _ts_n = min(len(_ts_closes), len(_ts_highs), len(_ts_lows))
                        for _i in range(1, _ts_n):
                            _ts_pc = _ts_closes[_i - 1]
                            if _ts_pc <= 0 or _ts_highs[_i] <= 0 or _ts_lows[_i] <= 0:
                                continue
                            _ts_tr = max(
                                _ts_highs[_i] - _ts_lows[_i],
                                abs(_ts_highs[_i] - _ts_pc),
                                abs(_ts_lows[_i] - _ts_pc)
                            )
                            _ts_trs.append(_ts_tr)
                        if _ts_trs:
                            _ts_atr = sum(_ts_trs) / len(_ts_trs)

                    if _ts_atr <= 0:
                        _skipped += 1
                        continue

                    # new_trailing = highest_close - ATR * trail_mult (ديناميكي v3.64.0)
                    _ts_new_trailing = round(_ts_highest_close - _ts_atr * _ts_trail_mult, 4)

                    # الـ trailing لازم يكون تحت الـ highest_close وفوق الـ entry
                    if _ts_new_trailing >= _ts_highest_close:
                        _skipped += 1
                        continue
                    if _ts_new_trailing <= _ts_entry:
                        _skipped += 1
                        continue

                    # الـ trailing بيتحرك لأعلى بس (مابينزلش)
                    _ts_current_trailing = float(_ts_analysis.get('trailing_stop') or 0)
                    if _ts_current_trailing > 0 and _ts_new_trailing <= _ts_current_trailing:
                        _skipped += 1
                        continue

                    # UPDATE analysis_json.trailing_stop
                    _ts_analysis['trailing_stop'] = _ts_new_trailing
                    _ts_analysis['trailing_stop_updated_at'] = cairo_now().isoformat()
                    _ts_analysis['trailing_stop_logic'] = (
                        f'live_job: highest_close ({_ts_highest_close:.2f}) - ATR ({_ts_atr:.2f}) × {_ts_trail_mult} '
                        f'[persona={_ts_persona}, momentum={_ts_is_momentum}] = {_ts_new_trailing:.2f}'
                    )

                    _ts_conn.execute(
                        'UPDATE stored_analyses SET analysis_json = ? WHERE id = ?',
                        (_ts_json.dumps(_ts_analysis, ensure_ascii=False), _ts_row['id'])
                    )
                    _updated += 1
                except Exception as _ts_e:
                    logger.debug(f"[LiveTrailingStop] Error for row: {_ts_e}")
                    continue

            _ts_conn.commit()
            if _updated > 0:
                logger.info(f"[LiveTrailingStop] Updated {_updated} trailing stops (skipped {_skipped})")
            self._mark_run('trailing_stop_update')
        except Exception as _ts_outer_e:
            logger.error(f"[LiveTrailingStop] Job failed: {_ts_outer_e}")
            try:
                self._mark_run('trailing_stop_update')
            except Exception:
                pass
        finally:
            if _ts_conn:
                try:
                    _ts_conn.close()
                except Exception:
                    pass

    def tick(self):
        """Main tick — called every minute"""
        try:
            # ---- Morning regime check at 9:30 Cairo time (pre-market) ----
            # 🔥 P14: استخدم _run_daily_task بدل النافذة الهشة (60 ثانية)
            now = cairo_now()
            self._run_daily_task(
                hour=9, minute=30, task_key='morning_regime',
                task_fn=lambda: (
                    self.run_morning_regime_check(),
                    self.compute_market_pulse(),
                    self._log_pulse_summary(),
                    # ════════════════════════════════════════════════════════════
                    # V40.2 MORNING GENERATION (2026-09-03)
                    # Owner: "المفروض فيه تحليل لليوم على مدار الجلسة"
                    # → V40.2 daily generator قبل فتح السوق (9:30)
                    # → يـ generate توقعات اليوم بناءً على بيانات الأمس
                    # ════════════════════════════════════════════════════════════
                    self.run_v40_2_generation(mode='morning'),
                ),
                window_minutes=10,  # نافذة 10 دقايق — آمنة جداً
            )

            # ---- Regime gate: check if trading is paused ----
            if self.trading_paused:
                logger.info("[MarketScheduler] Trading paused: EGX30 in Stage 4 — skipping analysis")
                # Still run crypto (not EGX-dependent) and Telegram
                self.run_crypto_update()
                # P23-CRYPTO-LAB-FUSION: Crypto 24/7 Live Lab runs even when EGX is paused
                # (crypto trades 24/7 — independent of EGX regime).
                self.run_crypto_lab()
                # 🔥 RL-FIX-4: Data pipeline MUST run even when trading is paused.
                # The intraday_aggregator and price_history_safetynet are DATA tasks,
                # not trading tasks. Previously, the early `return` below skipped them
                # entirely when trading_paused=True (Stage 4 bear market), which caused
                # price_history.db to freeze for 10+ days (MAX date stuck at 2026-07-30)
                # even though intraday.db had fresh data. The aggregator transfers
                # intraday → daily bars; the safetynet gap-fills from Yahoo. Both are
                # essential for analysis quality regardless of whether we're trading.
                self.run_price_history_safetynet()
                self.run_intraday_aggregator()
                # Allow daily closer and learning to run even in Stage 4
                if not self._is_egx_market_hours():
                    self.run_close_predictions()   # 🔥 VERIFY-FIX-2: EOD-only (14:45±30m), daily OHLC bars
                    self.run_rebuild_predictions() # generation every 15 min
                    self.run_learning_engine()
                    self.run_telegram_publish()
                return

            # During market hours
            if self._is_egx_market_hours():
                self.run_intraday_price_update()
                self.run_incremental_analysis()
                self.run_volume_spike_heavyweight()  # PHASE-5.1: heavy analysis on volume spike (3x avg)
                self.run_full_analysis()
                self.run_final_analysis()        # refresh predictions every 15 min
                # 🔥 VERIFY-FIX-2: NO closing during market hours — predictions stay
                # open until the EOD closer runs at 14:45 Cairo (post-market) on real
                # closing prices. Only the generation/rebuild path runs intraday.
                self.run_rebuild_predictions()  # generation only, every 15 min
                # ════════════════════════════════════════════════════════════
                # V40.2 LIVE GENERATION (2026-09-03)
                # Owner: "المفروض فيه تحديث أثناء الجلسة"
                # → V40.2 daily generator كل 15 دقيقة أثناء الجلسة
                # → يـ generate توقعات في predictions table (مش aiPrediction)
                # ════════════════════════════════════════════════════════════
                self.run_v40_2_generation(mode='intraday')
                # Live AI Monitor — كل 15 دقيقة أثناء الجلسة (جديد يوليو 2026)
                self.run_live_ai_scan()
                # v3.63.0: Live Trailing Stop update — كل 15 دقيقة وقت الجلسة
                self.run_live_trailing_stop_update()
                # P31 TASK 4: Proactive bag-holder alerts (loss >= 15%) — كل 15 دقيقة
                if self._should_run('bag_holder_alerts', 15):
                    self._run_bag_holder_alerts()
                    self._mark_run('bag_holder_alerts')
                # P0: price_history stale monitor runs hourly (during session too)
                self.run_price_history_stale_monitor()
                # 🔥 RL-FIX-2: During market hours, also run safetynet if DB is VERY stale
                # (>3 days). This ensures recovery during trading sessions, not just post-market.
                # The safetynet itself has a force_run bypass for stale DBs.
                self.run_price_history_safetynet()
                # 🔥 RL-FIX-2: intraday aggregator — PRIMARY fix for price_history freeze.
                # Aggregates intraday.db → price_history.db daily bars. Runs every 30 min.
                self.run_intraday_aggregator()
            else:
                # Post-market
                self.run_final_analysis()
                # 🔥 VERIFY-FIX-2: EOD closer runs once at 14:45 Cairo (gated inside
                # run_close_predictions via _run_daily_task). Rebuild runs every 15 min.
                self.run_close_predictions()
                self.run_rebuild_predictions()
                # ════════════════════════════════════════════════════════════
                # V40.2 DEEP ANALYSIS (2026-09-03)
                # Owner: "فيه تحديث وتحليل عميق جداً بعد نهاية الجلسة
                #         لتحديد التوقعات اللي هاتكون لليوم التالي"
                # → V40.2 daily generator with --yesterday-only (تحليل عميق)
                # → بيـ generate توقعات الغد بناءً على بيانات اليوم الكاملة
                # ════════════════════════════════════════════════════════════
                self.run_v40_2_generation(mode='daily')
                # Trade Learning — يومياً post-market (جديد يوليو 2026)
                self.run_daily_trade_learning()
                # Historical Trade Generator — أسبوعياً (السبت) (جديد يوليو 2026)
                self.run_weekly_historical_learning()
                self.run_learning_engine()
                self.run_egx_indices_update()  # تحديث EGX30/EGX100 يومياً
                self.run_price_history_safetynet()  # P0: Yahoo gap-fill daily (unconditional)
                # 🔥 RL-FIX-2: intraday aggregator — PRIMARY fix for price_history freeze.
                # Runs post-market to capture the full day's intraday data into daily bars.
                self.run_intraday_aggregator()
                self.run_telegram_publish()  # Auto-publish to Telegram
                self.run_screener_presets()  # Compute screener presets cache

                # ---- AI Nightly Analysis at 2:00 AM Cairo ----
                # 🔥 P14: استخدم _run_daily_task بدل النافذة الهشة (120 ثانية)
                def _ai_nightly_fn():
                    try:
                        import sys as _ai_sys
                        import os as _ai_os
                        _vps = _ai_os.path.dirname(_ai_os.path.dirname(_ai_os.path.abspath(__file__)))
                        if _vps not in _ai_sys.path:
                            _ai_sys.path.insert(0, _vps)
                        from ai.nightly_analysis import run_nightly_analysis
                        logger.info("[MarketScheduler] Starting AI Nightly Analysis...")
                        run_nightly_analysis()
                        logger.info("[MarketScheduler] AI Nightly Analysis complete")
                    except Exception as e:
                        logger.error(f"[MarketScheduler] AI Nightly error: {e}")
                self._run_daily_task(hour=2, minute=0, task_key='ai_nightly',
                                     task_fn=_ai_nightly_fn, window_minutes=10)

                # ---- AGILE-PHASE2-035 (A): Nightly Quant Cache at 3:00 AM Cairo ----
                # إعادة بناء كاش SMFI + Monte Carlo لكل أسهم EGX مرة واحدة في
                # اليوم. طول الجلسة الجاية، الـ analyze() بياخد القيم من الكاش
                # فورًا بدل ما يعيد حساب المعادلات الثقيلة لكل سهم كل دقيقة.
                # ده backup path — الـ EgyptScheduler.add_daily_task بيشغّلها
                # كمان، بس هنا في MarketScheduler بنضمن إنها تشتغل حتى لو
                # EgyptScheduler ما قدرش يبدأ.
                # 🔥 P14: استخدم _run_daily_task بدل النافذة الهشة (120 ثانية)
                def _quant_nightly_fn():
                    try:
                        import sys as _q_sys
                        import os as _q_os
                        _q_vps = _q_os.path.dirname(_q_os.path.dirname(_q_os.path.abspath(__file__)))
                        if _q_vps not in _q_sys.path:
                            _q_sys.path.insert(0, _q_vps)
                        from analyzers.nightly_quant_job import run_nightly_quant_job
                        logger.info("[MarketScheduler] Starting Nightly Quant Cache rebuild...")
                        _q_result = run_nightly_quant_job()
                        logger.info(
                            f"[MarketScheduler] Nightly Quant Cache done — "
                            f"processed={_q_result.get('processed', 0)}, "
                            f"failed={_q_result.get('failed', 0)}, "
                            f"duration={_q_result.get('duration_sec', 0)}s"
                        )
                    except Exception as e:
                        logger.error(f"[MarketScheduler] Nightly Quant error: {e}")
                self._run_daily_task(hour=3, minute=0, task_key='quant_nightly',
                                     task_fn=_quant_nightly_fn, window_minutes=10)
            
            # Always run crypto
            self.run_crypto_update()
            # P23-CRYPTO-LAB-FUSION: Crypto 24/7 Live Lab — BTC + ETH analysis every 15 min.
            # 24/7 (مش gated بجلسة EGX — الكريبتو بيتداول 24/7).
            self.run_crypto_lab()

        except Exception as e:
            logger.error(f"[MarketScheduler] Tick error: {e}")

    def start(self, interval_seconds: int = 60):
        """Start the scheduler (blocking)"""
        self.running = True
        logger.info(f"[MarketScheduler] Starting with {interval_seconds}s interval")
        
        while self.running:
            try:
                self.tick()
            except Exception as e:
                logger.error(f"[MarketScheduler] Error in main loop: {e}")
            
            time.sleep(interval_seconds)

    def stop(self):
        """Stop the scheduler"""
        self.running = False
        logger.info("[MarketScheduler] Stopped")

    def get_status(self) -> Dict:
        """Get current scheduler status"""
        now = cairo_now()
        status = {
            'running': self.running,
            'cairo_time': now.strftime('%Y-%m-%d %H:%M:%S'),
            'market_open': self._is_egx_market_hours(),
            'post_market': self._is_post_market(),
            'is_friday': self._is_friday(),
            'trading_paused': self.trading_paused,
            'last_runs': {k: v.isoformat() if v else None for k, v in self.last_run.items()},
            'engines_loaded': {
                'bg_analyzer': self.bg_analyzer is not None,
                'daily_closer': self.daily_closer is not None,
                'learning_engine': self.learning_engine is not None,
                'sniper_engine': self.sniper_engine is not None,
                'telegram_poster': self.telegram_poster is not None,
                'regime_engine': self.regime_engine is not None,
            }
        }
        # Add regime details if available
        if self.current_regime:
            status['regime'] = {
                'stage': self.current_regime.stage,
                'stage_name': self.current_regime.stage_name,
                'price': self.current_regime.price,
                'sma200': self.current_regime.sma200,
                'confidence': self.current_regime.confidence,
                'trading_allowed': self.current_regime.trading_allowed,
                'position_modifier': self.current_regime.position_modifier,
                'date': self.current_regime.date,
            }
        else:
            status['regime'] = None
        return status


def main():
    """Run the scheduler standalone"""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    scheduler = MarketScheduler()
    
    print("🚀 Market Scheduler Starting...")
    print(f"  Cairo Time: {cairo_now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Market Open: {scheduler._is_egx_market_hours()}")
    
    status = scheduler.get_status()
    print(f"  Engines Loaded:")
    for name, loaded in status['engines_loaded'].items():
        print(f"    {name}: {'✅' if loaded else '❌'}")

    # Print regime info
    if scheduler.current_regime:
        r = scheduler.current_regime
        print(f"  EGX30 Regime: Stage {r.stage} ({r.stage_name}) | Trading: {'PAUSED' if scheduler.trading_paused else 'ALLOWED'}")
    else:
        print(f"  EGX30 Regime: Not available")
    
    try:
        scheduler.start(interval_seconds=60)
    except KeyboardInterrupt:
        scheduler.stop()
        print("\n⏹️ Market Scheduler Stopped")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
📊 Reports Engine
=================
محرك التقارير الرئيسي للمنصة - يولّد 4 أنواع من التقارير:

1. tomorrow_picks   — الساعة 8:30 ص قبل فتح EGX (أعلى 1-2 سهم)
2. daily_summary    — الساعة 4:30 م بعد قفل EGX (ملخص يومي)
3. weekly_summary   — الجمعة 9:00 ص (ملخص أسبوعي)
4. monthly_summary  — أول يوم في الشهر 10:00 ص (ملخص شهري)

القواعد (legal compliance):
- نستخدم "توقعات" وليس "توصيات" في كل النصوص.
- كل تقرير ينتهي بـ OFFICIAL_LINKS_BLOCK + إخلاء مسؤولية.

Author: GLMinvestment Platform
"""

import os
import sys
import json
import sqlite3
import asyncio
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal classification. Used to be a 3-level
# BUY/SELL/HOLD derived from technical_rating strings; now uses the canonical
# 7-level taxonomy (STRONG_BUY/BUY/ACCUMULATE/HOLD/REDUCE/SELL/STRONG_SELL).
_VPS_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _VPS_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _VPS_SERVICE_ROOT)
try:
    from utils.canonical_signal import classify_signal, signal_ar as canonical_signal_ar
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_signal(_score):  # type: ignore[no-redef]
        return 'HOLD'
    def canonical_signal_ar(_sig):  # type: ignore[no-redef]
        return 'انتظار'

# ─────────────────────────────────────────────────────────────────────────────
# Path setup — find market_hours.py and data_engine modules
# ─────────────────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))

# Path candidates for market_hours.py (data_engine/config/)
#   - vps-service/data_engine/config/market_hours.py  (mentioned in spec)
#   - <project_root>/data_engine/config/market_hours.py  (actually exists)
#   - vps-service/data-engine/market_config/market_hours.py  (also exists)
_PATH_CANDIDATES = [
    os.path.join(_HERE, '..', 'data_engine', 'config'),
    os.path.join(_HERE, '..', 'data_engine'),
    os.path.join(_HERE, '..', 'data-engine', 'market_config'),
    os.path.join(_HERE, '..', '..', 'data_engine', 'config'),
    os.path.join(_HERE, '..', '..', 'data_engine'),
]
for _p in _PATH_CANDIDATES:
    _abs = os.path.abspath(_p)
    if os.path.isdir(_abs) and _abs not in sys.path:
        sys.path.insert(0, _abs)

# ─────────────────────────────────────────────────────────────────────────────
# Imports from market_hours (with safe fallback)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from market_hours import MARKET_HOLIDAYS, MARKET_HOURS_LOCAL, get_egypt_time
    MARKET_HOURS_AVAILABLE = True
except Exception as _e:  # pragma: no cover
    print(f"[ReportsEngine] market_hours import failed: {_e}")
    MARKET_HOURS_AVAILABLE = False
    MARKET_HOLIDAYS = {
        'مصر': {
            str(datetime.now().year): [],
            str(datetime.now().year - 1): [],
        }
    }
    MARKET_HOURS_LOCAL = {
        'مصر': {
            'name': 'EGX - البورصة المصرية',
            'days': [6, 0, 1, 2, 3],
            'timezone': 'Africa/Cairo',
        }
    }

    def get_egypt_time() -> datetime:
        try:
            import pytz
            return datetime.now(pytz.timezone('Africa/Cairo'))
        except Exception:
            return datetime.now()

# Import SocialCardGenerator (same package)
try:
    from .social_card_generator import SocialCardGenerator
except Exception:
    # allow running as a script too
    sys.path.insert(0, _HERE)
    try:
        from social_card_generator import SocialCardGenerator
    except Exception as _e:
        print(f"[ReportsEngine] SocialCardGenerator import failed: {_e}")
        SocialCardGenerator = None


# ─────────────────────────────────────────────────────────────────────────────
# Official links block (must end every report)
# ─────────────────────────────────────────────────────────────────────────────
OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
}

OFFICIAL_LINKS_BLOCK = """
🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: {website}
📱 تطبيق أندرويد: {android}
📘 فيسبوك: {facebook}
✈️ تليجرام: {telegram}""".format(**OFFICIAL_LINKS)

DISCLAIMER = "⚠️ تحليل تلقائي — ليس توقعة استثمارية"

# ─────────────────────────────────────────────────────────────────────────────
# Database path resolution
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(_HERE).parent.parent  # resolved dynamically

_DB_CANDIDATES = {
    'stocks_db': [
        PROJECT_ROOT / 'db' / 'stocks.db',
        PROJECT_ROOT / 'db' / 'backup_20260607_120356' / 'stocks.db',
    ],
    'data_engine_db': [
        PROJECT_ROOT / 'db' / 'data_engine.db',
        PROJECT_ROOT / 'db' / 'data_engine.db.real',
    ],
    'predictions_db': [
        # The reports table lives here; aiPrediction table also exists
        PROJECT_ROOT / 'db' / 'predictions.db',
    ],
    'price_history_db': [
        PROJECT_ROOT / 'db' / 'price_history.db',
        PROJECT_ROOT / 'db' / 'backup_20260607_120356' / 'price_history.db',
    ],
}


def _resolve_db(key: str) -> str:
    """أول مسار موجود لقاعدة البيانات، أو أول مسار مرشح كافتراضي."""
    for p in _DB_CANDIDATES.get(key, []):
        if p.exists():
            return str(p)
    # Fallback to first candidate (so connection errors are clearer)
    cands = _DB_CANDIDATES.get(key, [])
    return str(cands[0]) if cands else ''


# ─────────────────────────────────────────────────────────────────────────────
# Helper: parse numbers from string columns like "+5.29%" or "1.37 B EGP"
# ─────────────────────────────────────────────────────────────────────────────

def _to_float(value, default: float = 0.0) -> float:
    """تحويل قيمة (string/None/int) إلى float بأمان"""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        # إزالة % + , ومسافات وأقواس سلبية خاصة
        s = str(value).strip()
        # إزالة الأحرف العربية الخاصة بـ minus (U+2212)
        s = s.replace('−', '-').replace('–', '-')
        s = s.replace('%', '').replace('+', '').replace(',', '').replace('،', '')
        s = s.replace(' EGP', '').replace(' EGP', '').strip()
        # إزالة اللواحق مثل "B" / "M" / "K" (تُترك للـ caller يفسرها)
        if s in ('', '—', '-', 'N/A', 'null'):
            return default
        return float(s)
    except (ValueError, TypeError):
        return default


def _rating_to_score(rating: Optional[str]) -> float:
    """تحويل technical_rating النصي إلى رقم 0-100"""
    if not rating:
        return 50.0
    r = str(rating).strip()
    mapping = {
        'شراء قوي': 92.0,
        'شراء': 75.0,
        'حيادية': 50.0,
        'بيع': 25.0,
        'بيع قوي': 8.0,
        'strong buy': 92.0,
        'buy': 75.0,
        'neutral': 50.0,
        'sell': 25.0,
        'strong sell': 8.0,
    }
    return mapping.get(r.lower(), 50.0)


def _rating_to_signal(rating: Optional[str]) -> str:
    """CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
    تحويل technical_rating إلى canonical signal (7-level taxonomy).
    Was: 3-level BUY/SELL/HOLD mapping (collapsed STRONG_BUY→BUY, STRONG_SELL→SELL).
    Now: classify_signal(_rating_to_score(rating)) which preserves the full
    7-level granularity (STRONG_BUY / BUY / ACCUMULATE / HOLD / REDUCE / SELL / STRONG_SELL).
    """
    if not rating:
        return 'HOLD'
    return classify_signal(_rating_to_score(rating))


# ─────────────────────────────────────────────────────────────────────────────
# ReportsEngine
# ─────────────────────────────────────────────────────────────────────────────

class ReportsEngine:
    """محرك التقارير الرئيسي"""

    EGX_MARKET_KEY = 'مصر'  # اسم السوق في data_engine.db

    def __init__(self):
        # Load holidays
        self.market_holidays = MARKET_HOLIDAYS
        self.market_hours_local = MARKET_HOURS_LOCAL

        # DB paths
        self.stocks_db_path = _resolve_db('stocks_db')
        self.data_engine_db_path = _resolve_db('data_engine_db')
        self.predictions_db_path = _resolve_db('predictions_db')
        self.price_history_db_path = _resolve_db('price_history_db')

        # Ensure reports table exists in predictions.db
        self._ensure_reports_table()

        # Social card generator (optional — None if Playwright unavailable)
        self.card_generator = SocialCardGenerator() if SocialCardGenerator else None

    # ─────────────────────────────────────────────────────────────────────────
    # Schema init
    # ─────────────────────────────────────────────────────────────────────────

    def _ensure_reports_table(self) -> None:
        """ينشئ جدول reports في predictions.db لو مش موجود"""
        try:
            conn = sqlite3.connect(self.predictions_db_path)
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    date TEXT NOT NULL,
                    title TEXT,
                    content TEXT,
                    image_path TEXT,
                    status TEXT DEFAULT 'pending',
                    telegram_message_id TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    published_at TEXT
                );
            """)
            # Indexes for fast lookup
            cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ReportsEngine] Error creating reports table: {e}")

    # ─────────────────────────────────────────────────────────────────────────
    # Holiday / working day helpers
    # ─────────────────────────────────────────────────────────────────────────

    def is_holiday(self, date: Optional[datetime] = None) -> bool:
        """يفحص MARKET_HOLIDAYS['مصر'] للسنة + أيام الجمعة/السبت"""
        if date is None:
            date = get_egypt_time()

        # الجمعة (4) أو السبت (5) → إجازة
        if date.weekday() in (4, 5):
            return True

        date_str = date.strftime('%Y-%m-%d')
        year = str(date.year)
        holidays = self.market_holidays.get('مصر', {}).get(year, [])
        return date_str in holidays

    def is_working_day(self, date: Optional[datetime] = None) -> bool:
        """الأحد–الخميس وغير إجازة"""
        if date is None:
            date = get_egypt_time()
        # working days = Sunday..Thursday → weekday in [6, 0, 1, 2, 3]
        if date.weekday() not in (6, 0, 1, 2, 3):
            return False
        return not self.is_holiday(date)

    # ─────────────────────────────────────────────────────────────────────────
    # DB helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _connect_data_engine(self) -> Optional[sqlite3.Connection]:
        try:
            return sqlite3.connect(self.data_engine_db_path)
        except Exception as e:
            print(f"[ReportsEngine] data_engine.db connect error: {e}")
            return None

    def _connect_stocks_db(self) -> Optional[sqlite3.Connection]:
        try:
            return sqlite3.connect(self.stocks_db_path)
        except Exception as e:
            print(f"[ReportsEngine] stocks.db connect error: {e}")
            return None

    def _connect_predictions(self) -> Optional[sqlite3.Connection]:
        try:
            return sqlite3.connect(self.predictions_db_path)
        except Exception as e:
            print(f"[ReportsEngine] predictions.db connect error: {e}")
            return None

    def _connect_price_history(self) -> Optional[sqlite3.Connection]:
        try:
            return sqlite3.connect(self.price_history_db_path)
        except Exception as e:
            print(f"[ReportsEngine] price_history.db connect error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────────────────
    # Report 1: Tomorrow Picks (الساعة 8:30 ص قبل فتح EGX)
    # ─────────────────────────────────────────────────────────────────────────

    def generate_tomorrow_picks(self, force: bool = False) -> Dict:
        """
        اختيار أعلى 1-2 سهم بناءً على Maestro Score + signal=BUY.
        التوقيت: 8:30 ص قبل فتح EGX.
        """
        if self.is_holiday() and not force:
            return {"skipped": True, "reason": "إجازة رسمية"}

        picks = self._get_top_buy_picks(limit=2)
        if not picks:
            return {
                "success": False,
                "reason": "لا توجد فرص شراء واضحة اليوم",
                "type": "tomorrow_picks",
            }

        # Build text content
        date_str = datetime.now().strftime('%Y-%m-%d')
        lines = [f"🌅 توقعات الغد — {date_str}\n"]
        for i, p in enumerate(picks, 1):
            upside = p.get('upside_pct', 0)
            lines.append(
                f"{i}. {p['name']} ({p['symbol']})\n"
                f"   💰 السعر: {p['price']:.2f}\n"
                f"   🎯 الهدف: {p['target']:.2f} (+{upside:.1f}%)\n"
                f"   🛑 وقف الخسارة: {p['stop_loss']:.2f}\n"
                f"   📌 السبب: {p.get('reason', '—')}\n"
            )
        content = '\n'.join(lines)
        content += '\n' + OFFICIAL_LINKS_BLOCK + '\n\n' + DISCLAIMER

        # Generate social card
        image_path = None
        if self.card_generator:
            image_path = self.card_generator.generate_card('tomorrow_picks', {
                'date': date_str,
                'picks': picks,
            })

        # Save report
        title = f"توقعات الغد — {date_str}"
        report_id = self._save_report(
            report_type='tomorrow_picks',
            date=date_str,
            title=title,
            content=content,
            image_path=image_path,
        )

        return {
            "success": True,
            "report_id": report_id,
            "type": "tomorrow_picks",
            "title": title,
            "content": content,
            "image_path": image_path,
            "picks": picks,
        }

    def _get_top_buy_picks(self, limit: int = 2) -> List[Dict]:
        """يجيب أعلى الأسهم بناءً على Maestro Score + signal=BUY من data_engine.db"""
        conn = self._connect_data_engine()
        if not conn:
            return []

        try:
            cur = conn.cursor()
            # Join stocks + tab_technical_analysis (symbol contains stock symbol)
            # tab_technical_analysis.symbol looks like 'AALRالعامة' (symbol + name prefix)
            # so we use LIKE on the stocks.symbol
            cur.execute(f"""
                SELECT s.symbol, s.name, s.price, s.sector,
                       t.technical_rating, t.ma_rating, t.rsi, t.macd,
                       p.perf_1w, p.perf_1m, p.perf_3m
                FROM stocks s
                LEFT JOIN tab_technical_analysis t
                  ON t.symbol LIKE s.symbol || '%'
                 AND t.market = ?
                LEFT JOIN tab_performance p
                  ON p.symbol LIKE s.symbol || '%'
                 AND p.market = ?
                WHERE s.market = ?
                  AND s.price IS NOT NULL
                  AND s.price != '0'
                  AND t.technical_rating IS NOT NULL
                ORDER BY
                  CASE t.technical_rating
                    WHEN 'شراء قوي' THEN 95
                    WHEN 'شراء'     THEN 75
                    WHEN 'حيادية'   THEN 50
                    WHEN 'بيع'      THEN 25
                    WHEN 'بيع قوي'  THEN 5
                    ELSE 50
                  END DESC,
                  CAST(REPLACE(REPLACE(REPLACE(p.perf_1m, '%', ''), '+', ''), '−', '-') AS REAL) DESC
                LIMIT ?
            """, (self.EGX_MARKET_KEY, self.EGX_MARKET_KEY, self.EGX_MARKET_KEY, limit * 5))

            rows = cur.fetchall()
            picks = []
            # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
            # Buy-side canonical signals — was just `signal == 'BUY'` (3-level).
            # Now includes STRONG_BUY / BUY / ACCUMULATE so we don't drop the
            # strong_buy picks (was 'BUY' before, now canonical STRONG_BUY).
            _BUY_SIDE_SIGNALS = {'STRONG_BUY', 'BUY', 'ACCUMULATE'}
            for r in rows:
                symbol, name, price, sector, rating, ma_rating, rsi, macd, perf_1w, perf_1m, perf_3m = r
                # Only include canonical buy-side signals
                signal = _rating_to_signal(rating)
                if signal not in _BUY_SIDE_SIGNALS:
                    continue

                price_f = _to_float(price)
                if price_f <= 0:
                    continue

                # Compute target & stop loss (8% upside, 4% stop — heuristic)
                maestro_score = _rating_to_score(rating)
                # Add small bonus from RSI (avoid overbought >70)
                rsi_f = _to_float(rsi, 50.0)
                if 40 <= rsi_f <= 65:
                    maestro_score += 5

                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
                # Reclassify signal from the bonus-adjusted maestro_score so the
                # canonical label reflects the RSI bonus (e.g. 'BUY' → 'STRONG_BUY'
                # when RSI bumps the score above 78). Single source of truth.
                signal = classify_signal(maestro_score)

                upside_pct = 8.0 if rating == 'شراء قوي' else 6.0
                target = round(price_f * (1 + upside_pct / 100), 2)
                stop_loss = round(price_f * (1 - 4.0 / 100), 2)

                perf_1m_f = _to_float(perf_1m)
                reason_parts = []
                if rating == 'شراء قوي':
                    reason_parts.append("إشارة شراء قوية")
                elif rating == 'شراء':
                    reason_parts.append("إشارة شراء")
                if rsi_f and 40 <= rsi_f <= 65:
                    reason_parts.append(f"RSI معتدل ({rsi_f:.0f})")
                if perf_1m_f > 5:
                    reason_parts.append(f"صعود شهري {perf_1m_f:.1f}%")
                reason = " + ".join(reason_parts) if reason_parts else "تحليل فني إيجابي"

                picks.append({
                    'symbol': symbol,
                    'name': name or symbol,
                    'price': price_f,
                    'target': target,
                    'stop_loss': stop_loss,
                    'upside_pct': upside_pct,
                    'reason': reason,
                    'maestro_score': round(maestro_score, 1),
                    'signal': signal,
                    'sector': sector or '—',
                })

                if len(picks) >= limit:
                    break

            return picks
        except Exception as e:
            print(f"[ReportsEngine] _get_top_buy_picks error: {e}")
            return []
        finally:
            conn.close()

    # ─────────────────────────────────────────────────────────────────────────
    # Report 2: Daily Summary (الساعة 4:30 م بعد قفل EGX)
    # ─────────────────────────────────────────────────────────────────────────

    def generate_daily_summary(self, force: bool = False) -> Dict:
        """ملخص يومي للسوق بعد قفل EGX"""
        if self.is_holiday() and not force:
            return {"skipped": True, "reason": "إجازة رسمية"}

        summary = self._get_market_summary()
        gainers = self._get_top_gainers(limit=3)
        losers = self._get_top_losers(limit=3)
        gold = self._get_latest_gold()
        usd_rate = self._get_latest_usd_rate()
        sectors = self._get_sector_performance()

        date_str = datetime.now().strftime('%Y-%m-%d')

        # Build text content
        lines = [
            f"📈 ملخص السوق المصري — {date_str}\n",
            f"📊 إجمالي الأسهم: {summary['total_stocks']}",
            f"🟢 الصاعدات: {summary['gainers']}",
            f"🔴 الهابطات: {summary['losers']}",
            f"⚪ ثابتة: {summary['unchanged']}",
            f"📈 اتساع السوق: {summary['market_breadth']}%\n",
        ]

        if gainers:
            lines.append("🟢 أعلى الصاعدات:")
            for i, g in enumerate(gainers, 1):
                lines.append(f"  {i}. {g['symbol']} ({g['name']}): +{g['change_percent']:.1f}%")
        if losers:
            lines.append("\n🔴 أعلى الهابطات:")
            for i, l in enumerate(losers, 1):
                lines.append(f"  {i}. {l['symbol']} ({l['name']}): {l['change_percent']:.1f}%")
        if sectors:
            lines.append("\n🏭 أفضل القطاعات:")
            for i, s in enumerate(sectors[:3], 1):
                lines.append(
                    f"  {i}. {s['name']}: {s['avg_change_percent']:+.2f}% "
                    f"({s['count']} سهم)"
                )

        if gold:
            lines.append(f"\n🥇 ذهب عيار 21: {gold.get('price_21', '—')} ج.م")
        if usd_rate:
            lines.append(f"💵 دولار أمريكي: {usd_rate:.2f} ج.م")

        content = '\n'.join(lines)
        content += '\n\n' + OFFICIAL_LINKS_BLOCK + '\n\n' + DISCLAIMER

        # Generate social card
        image_path = None
        if self.card_generator:
            image_path = self.card_generator.generate_card('daily_summary', {
                'date': date_str,
                'summary': summary,
                'top_gainers': gainers,
                'top_losers': losers,
                'gold': gold,
                'usd_rate': usd_rate,
                'sectors': sectors,
            })

        title = f"ملخص السوق اليومي — {date_str}"
        report_id = self._save_report(
            report_type='daily_summary',
            date=date_str,
            title=title,
            content=content,
            image_path=image_path,
        )

        return {
            "success": True,
            "report_id": report_id,
            "type": "daily_summary",
            "title": title,
            "content": content,
            "image_path": image_path,
            "summary": summary,
            "top_gainers": gainers,
            "top_losers": losers,
            "sectors": sectors,
            "gold": gold,
            "usd_rate": usd_rate,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Report 3: Weekly Summary (الجمعة 9:00 ص)
    # ─────────────────────────────────────────────────────────────────────────

    def generate_weekly_summary(self, force: bool = False) -> Dict:
        """ملخص أسبوعي للسوق"""
        date_str = datetime.now().strftime('%Y-%m-%d')
        end_date = datetime.now()
        start_date = end_date - timedelta(days=7)

        weekly_perf = self._get_egx30_performance(start_date, end_date)
        best_stock, worst_stock = self._get_best_worst_stock_weekly(start_date, end_date)
        gold_perf = self._get_gold_performance(start_date, end_date)
        usd_perf = self._get_usd_performance(start_date, end_date)
        lessons = self._generate_weekly_lessons(weekly_perf, gold_perf, usd_perf)
        watchlist = self._get_weekly_watchlist()

        # Sparkline + bar chart data (financial visualizations)
        sparkline_egx = self._get_egx30_sparkline_data(days=7)
        sparkline_gold = self._get_gold_sparkline_data(days=7)
        sparkline_usd = self._get_usd_sparkline_data(days=7)
        top_performers = self._get_top_performers_weekly(start_date, end_date, limit=5)

        # Build text
        lines = [
            f"📅 التقرير الأسبوعي — {start_date.strftime('%Y-%m-%d')} إلى {end_date.strftime('%Y-%m-%d')}\n",
            f"📊 أداء EGX30 الأسبوعي: {weekly_perf:+.2f}%",
            f"🥇 الذهب: {gold_perf:+.2f}%",
            f"💵 الدولار: {usd_perf:+.2f}%\n",
        ]

        if best_stock:
            lines.append(f"🏆 أفضل سهم: {best_stock['symbol']} ({best_stock['name']}) — {best_stock['change_percent']:+.1f}%")
        if worst_stock:
            lines.append(f"⚠️ أسوأ سهم: {worst_stock['symbol']} ({worst_stock['name']}) — {worst_stock['change_percent']:+.1f}%")

        if lessons:
            lines.append("\n💡 دروس للأسبوع القادم:")
            for i, l in enumerate(lessons, 1):
                lines.append(f"  {i}. {l}")

        if watchlist:
            lines.append("\n👀 أسهم للمتابعة: " + ", ".join(watchlist))

        content = '\n'.join(lines)
        content += '\n\n' + OFFICIAL_LINKS_BLOCK + '\n\n' + DISCLAIMER

        image_path = None
        if self.card_generator:
            image_path = self.card_generator.generate_card('weekly_summary', {
                'date': date_str,
                'egx30_perf': round(weekly_perf, 2),
                'best_stock': best_stock,
                'worst_stock': worst_stock,
                'gold_perf': round(gold_perf, 2),
                'usd_perf': round(usd_perf, 2),
                'lessons': lessons,
                'watchlist': watchlist,
                'sparkline_egx': [d['value'] for d in sparkline_egx],
                'sparkline_gold': [d['value'] for d in sparkline_gold],
                'sparkline_usd': [d['value'] for d in sparkline_usd],
                'top_performers': top_performers,
            })

        title = f"التقرير الأسبوعي — {date_str}"
        report_id = self._save_report(
            report_type='weekly_summary',
            date=date_str,
            title=title,
            content=content,
            image_path=image_path,
        )

        return {
            "success": True,
            "report_id": report_id,
            "type": "weekly_summary",
            "title": title,
            "content": content,
            "image_path": image_path,
            "egx30_perf": weekly_perf,
            "best_stock": best_stock,
            "worst_stock": worst_stock,
            "gold_perf": gold_perf,
            "usd_perf": usd_perf,
            "lessons": lessons,
            "watchlist": watchlist,
            "sparkline_egx": [d['value'] for d in sparkline_egx],
            "sparkline_gold": [d['value'] for d in sparkline_gold],
            "sparkline_usd": [d['value'] for d in sparkline_usd],
            "top_performers": top_performers,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Report 4: Monthly Summary (أول يوم في الشهر 10:00 ص)
    # ─────────────────────────────────────────────────────────────────────────

    def generate_monthly_summary(self, force: bool = False) -> Dict:
        """ملخص شهري للسوق"""
        now = datetime.now()
        # Last month range
        if now.month == 1:
            month_start = now.replace(year=now.year - 1, month=12, day=1)
            month_end = now.replace(day=1) - timedelta(days=1)
        else:
            month_start = now.replace(month=now.month - 1, day=1)
            month_end = now.replace(day=1) - timedelta(days=1)

        month_name = self._get_month_name_ar(month_start.month)
        date_str = now.strftime('%Y-%m-%d')

        monthly_perf = self._get_egx30_performance(month_start, month_end)
        best5, worst5 = self._get_best_worst_stocks_monthly(month_start, month_end)
        pred_stats = self._get_predictions_stats(month_start, month_end)
        sectors = self._get_top_sectors()
        gold_perf = self._get_gold_performance(month_start, month_end)
        usd_perf = self._get_usd_performance(month_start, month_end)
        cert_rate = 27  # شهادات الادخار البنكية (~27% سنوي → ربع شهري)

        # Sparkline + bar chart data (financial visualizations — 30 يوم)
        sparkline_egx = self._get_egx30_sparkline_data(days=30)
        sparkline_gold = self._get_gold_sparkline_data(days=30)
        sparkline_usd = self._get_usd_sparkline_data(days=30)
        # best5 هي بالفعل أفضل 5 أسهم شهرياً → نستخدمها للـ bar chart
        top_performers = [
            {'ticker': s.get('symbol', ''), 'name': s.get('name', ''),
             'change_percent': s.get('change_percent', 0)}
            for s in best5
        ]

        # Build text
        lines = [
            f"🗓️ التقرير الشهري — {month_name} {month_start.year}\n",
            f"📊 أداء EGX30 الشهري: {monthly_perf:+.2f}%",
            f"🥇 الذهب: {gold_perf:+.2f}%",
            f"🏦 شهادات الادخار: {cert_rate}% (سنوي)\n",
        ]

        if best5:
            lines.append("🟢 أفضل 5 أسهم:")
            for i, s in enumerate(best5, 1):
                lines.append(f"  {i}. {s['symbol']} ({s['name']}): +{s['change_percent']:.1f}%")
        if worst5:
            lines.append("\n🔴 أسوأ 5 أسهم:")
            for i, s in enumerate(worst5, 1):
                lines.append(f"  {i}. {s['symbol']} ({s['name']}): {s['change_percent']:.1f}%")

        if pred_stats:
            lines.append(f"\n🎯 إحصائيات التوقعات:")
            lines.append(f"  • إجمالي التوقعات: {pred_stats.get('total', 0)}")
            lines.append(f"  • نسبة النجاح: {pred_stats.get('success_rate', 0)}%")

        if sectors:
            lines.append("\n🔍 قطاعات للمتابعة:")
            lines.append("  • " + " | ".join(sectors))

        content = '\n'.join(lines)
        content += '\n\n' + OFFICIAL_LINKS_BLOCK + '\n\n' + DISCLAIMER

        image_path = None
        if self.card_generator:
            image_path = self.card_generator.generate_card('monthly_summary', {
                'date': date_str,
                'month_name': month_name,
                'egx30_perf': round(monthly_perf, 2),
                'best_5': best5,
                'worst_5': worst5,
                'predictions_stats': pred_stats,
                'sectors': sectors,
                'gold_perf': round(gold_perf, 2),
                'usd_perf': round(usd_perf, 2),
                'cert_rate': cert_rate,
                'sparkline_egx': [d['value'] for d in sparkline_egx],
                'sparkline_gold': [d['value'] for d in sparkline_gold],
                'sparkline_usd': [d['value'] for d in sparkline_usd],
                'top_performers': top_performers,
            })

        title = f"التقرير الشهري — {month_name} {month_start.year}"
        report_id = self._save_report(
            report_type='monthly_summary',
            date=date_str,
            title=title,
            content=content,
            image_path=image_path,
        )

        return {
            "success": True,
            "report_id": report_id,
            "type": "monthly_summary",
            "title": title,
            "content": content,
            "image_path": image_path,
            "month_name": month_name,
            "egx30_perf": monthly_perf,
            "best_5": best5,
            "worst_5": worst5,
            "predictions_stats": pred_stats,
            "sectors": sectors,
            "gold_perf": gold_perf,
            "usd_perf": usd_perf,
            "cert_rate": cert_rate,
            "sparkline_egx": [d['value'] for d in sparkline_egx],
            "sparkline_gold": [d['value'] for d in sparkline_gold],
            "sparkline_usd": [d['value'] for d in sparkline_usd],
            "top_performers": top_performers,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # DB query helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _get_market_summary(self) -> Dict:
        """ملخص السوق من data_engine.db (جدول stocks)"""
        conn = self._connect_data_engine()
        if not conn:
            return {'total_stocks': 0, 'gainers': 0, 'losers': 0, 'unchanged': 0, 'market_breadth': 0.0}
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*),
                       SUM(CASE WHEN CAST(REPLACE(REPLACE(change_percent, '%', ''), '+', '') AS REAL) > 0 THEN 1 ELSE 0 END),
                       SUM(CASE WHEN CAST(REPLACE(REPLACE(change_percent, '%', ''), '+', '') AS REAL) < 0 THEN 1 ELSE 0 END)
                FROM stocks
                WHERE market = ? AND change_percent IS NOT NULL AND change_percent != ''
            """, (self.EGX_MARKET_KEY,))
            row = cur.fetchone()
            total = row[0] or 0
            gainers = row[1] or 0
            losers = row[2] or 0
            unchanged = total - gainers - losers
            breadth = round((gainers / total * 100) if total > 0 else 0, 1)
            return {
                'total_stocks': total,
                'gainers': gainers,
                'losers': losers,
                'unchanged': max(unchanged, 0),
                'market_breadth': breadth,
            }
        except Exception as e:
            print(f"[ReportsEngine] _get_market_summary error: {e}")
            return {'total_stocks': 0, 'gainers': 0, 'losers': 0, 'unchanged': 0, 'market_breadth': 0.0}
        finally:
            conn.close()

    def _get_top_gainers(self, limit: int = 3) -> List[Dict]:
        conn = self._connect_data_engine()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT symbol, name,
                       CAST(REPLACE(REPLACE(change_percent, '%', ''), '+', '') AS REAL) AS chg
                FROM stocks
                WHERE market = ? AND change_percent IS NOT NULL AND change_percent != ''
                ORDER BY chg DESC
                LIMIT ?
            """, (self.EGX_MARKET_KEY, limit))
            return [{'symbol': r[0], 'name': r[1] or r[0], 'change_percent': r[2] or 0}
                    for r in cur.fetchall()]
        except Exception as e:
            print(f"[ReportsEngine] _get_top_gainers error: {e}")
            return []
        finally:
            conn.close()

    def _get_top_losers(self, limit: int = 3) -> List[Dict]:
        conn = self._connect_data_engine()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT symbol, name,
                       CAST(REPLACE(REPLACE(change_percent, '%', ''), '+', '') AS REAL) AS chg
                FROM stocks
                WHERE market = ? AND change_percent IS NOT NULL AND change_percent != ''
                ORDER BY chg ASC
                LIMIT ?
            """, (self.EGX_MARKET_KEY, limit))
            return [{'symbol': r[0], 'name': r[1] or r[0], 'change_percent': r[2] or 0}
                    for r in cur.fetchall()]
        except Exception as e:
            print(f"[ReportsEngine] _get_top_losers error: {e}")
            return []
        finally:
            conn.close()

    def _get_latest_gold(self) -> Dict:
        """أحدث سعر ذهب في مصر (عيار 21 و 24 و 18)"""
        conn = self._connect_data_engine()
        if not conn:
            return {}
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT karat, price_per_gram, timestamp
                FROM gold_prices
                WHERE country = 'مصر'
                ORDER BY id DESC
                LIMIT 20
            """)
            result = {}
            for r in cur.fetchall():
                karat, price, ts = r
                # Map karat → field name
                if '21' in (karat or ''):
                    result['price_21'] = round(_to_float(price), 2)
                elif '24' in (karat or '') or 'عيار 24' == (karat or ''):
                    result['price_24'] = round(_to_float(price), 2)
                elif '18' in (karat or ''):
                    result['price_18'] = round(_to_float(price), 2)
                result['timestamp'] = ts
            return result
        except Exception as e:
            print(f"[ReportsEngine] _get_latest_gold error: {e}")
            return {}
        finally:
            conn.close()

    def _get_latest_usd_rate(self) -> Optional[float]:
        """أحدث سعر صرف USD→EGP"""
        conn = self._connect_data_engine()
        if not conn:
            return None
        try:
            cur = conn.cursor()
            # exchange_rates stores rate_to_usd (1 USD = ? EGP)
            cur.execute("""
                SELECT rate_to_usd FROM exchange_rates
                WHERE currency = 'EGP'
                ORDER BY id DESC LIMIT 1
            """)
            row = cur.fetchone()
            return _to_float(row[0]) if row else None
        except Exception as e:
            print(f"[ReportsEngine] _get_latest_usd_rate error: {e}")
            return None
        finally:
            conn.close()

    def _latest_price_window(self, cur, days: int = 7) -> Tuple[Optional[str], Optional[str]]:
        """آخر نافذة تداول متاحة فعلياً في price_history.db.

        price_history ممكن يكون متأخر (آخر تحديث أقدم من تاريخ التقرير).
        بدل ما التقرير يطلع أصفار، بنرجع لآخر نافذة فيها بيانات فعلاً.
        """
        try:
            cur.execute("""
                SELECT MIN(d), MAX(d) FROM (
                    SELECT DISTINCT date AS d FROM price_history
                    WHERE close_price IS NOT NULL AND close_price > 0
                    ORDER BY date DESC LIMIT ?
                )
            """, (days,))
            row = cur.fetchone()
            if row and row[0] and row[1]:
                return row[0], row[1]
        except Exception as e:
            print(f"[ReportsEngine] _latest_price_window error: {e}")
        return None, None

    def _get_egx30_performance(self, start_date: datetime, end_date: datetime) -> float:
        """أداء EGX30 خلال فترة (نستخدم price_history.db — متوسط الأسهم EGX)"""
        conn = self._connect_price_history()
        if not conn:
            return 0.0
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            # متوسط أداء كل الأسهم خلال الفترة (proxy for EGX30)
            cur.execute("""
                SELECT AVG(
                  ((end_p - start_p) / NULLIF(start_p, 0)) * 100
                )
                FROM (
                  SELECT ticker,
                    (SELECT close_price FROM price_history p2
                     WHERE p2.ticker = p1.ticker AND p2.date <= ?
                     ORDER BY p2.date DESC LIMIT 1) AS end_p,
                    (SELECT close_price FROM price_history p3
                     WHERE p3.ticker = p1.ticker AND p3.date >= ?
                     ORDER BY p3.date ASC LIMIT 1) AS start_p
                  FROM price_history p1
                  WHERE date BETWEEN ? AND ?
                  GROUP BY ticker
                  HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                )
            """, (end_str, start_str, start_str, end_str))
            row = cur.fetchone()
            if row and row[0] is not None:
                return round(_to_float(row[0]), 2)
            # price_history متأخر عن نافذة التقرير → آخر نافذة متاحة
            fb_start, fb_end = self._latest_price_window(cur, days=7)
            if fb_start and fb_end:
                cur.execute("""
                    SELECT AVG(
                      ((end_p - start_p) / NULLIF(start_p, 0)) * 100
                    )
                    FROM (
                      SELECT ticker,
                        (SELECT close_price FROM price_history p2
                         WHERE p2.ticker = p1.ticker AND p2.date <= ?
                         ORDER BY p2.date DESC LIMIT 1) AS end_p,
                        (SELECT close_price FROM price_history p3
                         WHERE p3.ticker = p1.ticker AND p3.date >= ?
                         ORDER BY p3.date ASC LIMIT 1) AS start_p
                      FROM price_history p1
                      WHERE date BETWEEN ? AND ?
                      GROUP BY ticker
                      HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                    )
                """, (fb_end, fb_start, fb_start, fb_end))
                row = cur.fetchone()
                return round(_to_float(row[0]), 2) if row and row[0] is not None else 0.0
            return 0.0
        except Exception as e:
            print(f"[ReportsEngine] _get_egx30_performance error: {e}")
            return 0.0
        finally:
            conn.close()

    def _get_best_worst_stock_weekly(self, start_date: datetime, end_date: datetime) -> Tuple[Dict, Dict]:
        """أفضل/أسوأ سهم خلال الأسبوع (من price_history.db)"""
        conn = self._connect_price_history()
        if not conn:
            return {}, {}
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT ticker,
                  (SELECT close_price FROM price_history p2
                   WHERE p2.ticker = p1.ticker AND p2.date <= ?
                   ORDER BY p2.date DESC LIMIT 1) AS end_p,
                  (SELECT close_price FROM price_history p3
                   WHERE p3.ticker = p1.ticker AND p3.date >= ?
                   ORDER BY p3.date ASC LIMIT 1) AS start_p
                FROM price_history p1
                WHERE date BETWEEN ? AND ?
                GROUP BY ticker
                HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                ORDER BY ((end_p - start_p) / start_p * 100) DESC
            """, (end_str, start_str, start_str, end_str))
            rows = cur.fetchall()
            if not rows:
                # price_history متأخر عن نافذة التقرير → آخر نافذة متاحة
                fb_start, fb_end = self._latest_price_window(cur, days=7)
                if fb_start and fb_end:
                    cur.execute("""
                        SELECT ticker,
                          (SELECT close_price FROM price_history p2
                           WHERE p2.ticker = p1.ticker AND p2.date <= ?
                           ORDER BY p2.date DESC LIMIT 1) AS end_p,
                          (SELECT close_price FROM price_history p3
                           WHERE p3.ticker = p1.ticker AND p3.date >= ?
                           ORDER BY p3.date ASC LIMIT 1) AS start_p
                        FROM price_history p1
                        WHERE date BETWEEN ? AND ?
                        GROUP BY ticker
                        HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                        ORDER BY ((end_p - start_p) / start_p * 100) DESC
                    """, (fb_end, fb_start, fb_start, fb_end))
                    rows = cur.fetchall()
            if not rows:
                return {}, {}

            # شذوذ بيانات: |change| > 100% (سعر قارب الصفر / تقسيم أسهم) —
            # نفس الفلترة المستخدمة في _get_top_performers_weekly
            sane = [
                r for r in rows
                if r[1] and r[2] and r[2] > 0
                and abs(((float(r[1]) - float(r[2])) / float(r[2])) * 100) <= 100
            ]
            if sane:
                rows = sane

            best_ticker = rows[0][0]
            best_change = ((rows[0][1] - rows[0][2]) / rows[0][2]) * 100
            worst_ticker = rows[-1][0]
            worst_change = ((rows[-1][1] - rows[-1][2]) / rows[-1][2]) * 100

            # Enrich with name from data_engine.db
            best_name = self._lookup_stock_name(best_ticker)
            worst_name = self._lookup_stock_name(worst_ticker)

            best = {'symbol': best_ticker, 'name': best_name,
                    'change_percent': round(best_change, 2)}
            worst = {'symbol': worst_ticker, 'name': worst_name,
                     'change_percent': round(worst_change, 2)}
            return best, worst
        except Exception as e:
            print(f"[ReportsEngine] _get_best_worst_stock_weekly error: {e}")
            return {}, {}
        finally:
            conn.close()

    def _get_best_worst_stocks_monthly(self, start_date: datetime, end_date: datetime) -> Tuple[List[Dict], List[Dict]]:
        """أفضل/أسوأ 5 أسهم خلال الشهر"""
        conn = self._connect_price_history()
        if not conn:
            return [], []
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT ticker,
                  (SELECT close_price FROM price_history p2
                   WHERE p2.ticker = p1.ticker AND p2.date <= ?
                   ORDER BY p2.date DESC LIMIT 1) AS end_p,
                  (SELECT close_price FROM price_history p3
                   WHERE p3.ticker = p1.ticker AND p3.date >= ?
                   ORDER BY p3.date ASC LIMIT 1) AS start_p
                FROM price_history p1
                WHERE date BETWEEN ? AND ?
                GROUP BY ticker
                HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                ORDER BY ((end_p - start_p) / start_p * 100) DESC
                LIMIT 5
            """, (end_str, start_str, start_str, end_str))
            best = [{'symbol': r[0], 'name': self._lookup_stock_name(r[0]),
                     'change_percent': round(((r[1] - r[2]) / r[2]) * 100, 2)}
                    for r in cur.fetchall()]

            cur.execute("""
                SELECT ticker,
                  (SELECT close_price FROM price_history p2
                   WHERE p2.ticker = p1.ticker AND p2.date <= ?
                   ORDER BY p2.date DESC LIMIT 1) AS end_p,
                  (SELECT close_price FROM price_history p3
                   WHERE p3.ticker = p1.ticker AND p3.date >= ?
                   ORDER BY p3.date ASC LIMIT 1) AS start_p
                FROM price_history p1
                WHERE date BETWEEN ? AND ?
                GROUP BY ticker
                HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                ORDER BY ((end_p - start_p) / start_p * 100) ASC
                LIMIT 5
            """, (end_str, start_str, start_str, end_str))
            worst = [{'symbol': r[0], 'name': self._lookup_stock_name(r[0]),
                      'change_percent': round(((r[1] - r[2]) / r[2]) * 100, 2)}
                     for r in cur.fetchall()]
            return best, worst
        except Exception as e:
            print(f"[ReportsEngine] _get_best_worst_stocks_monthly error: {e}")
            return [], []
        finally:
            conn.close()

    def _lookup_stock_name(self, symbol: str) -> str:
        """يجيب اسم السهم من data_engine.db"""
        conn = self._connect_data_engine()
        if not conn:
            return symbol
        try:
            cur = conn.cursor()
            cur.execute("SELECT name FROM stocks WHERE symbol = ? AND market = ? LIMIT 1",
                        (symbol, self.EGX_MARKET_KEY))
            row = cur.fetchone()
            return row[0] if row else symbol
        except Exception:
            return symbol
        finally:
            conn.close()

    def _get_gold_performance(self, start_date: datetime, end_date: datetime) -> float:
        """تغيّر سعر الذهب (عيار 21) خلال فترة"""
        conn = self._connect_data_engine_robust(required_table='gold_prices')
        if not conn:
            return 0.0
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT price_per_gram, timestamp FROM gold_prices
                WHERE country = 'مصر' AND karat = 'عيار 21'
                  AND timestamp >= ? AND timestamp <= ?
                ORDER BY id ASC
            """, (start_str + ' 00:00:00', end_str + ' 23:59:59'))
            rows = cur.fetchall()
            if len(rows) < 2:
                # Fallback: take first and last
                cur.execute("""
                    SELECT price_per_gram FROM gold_prices
                    WHERE country = 'مصر' AND karat = 'عيار 21'
                    ORDER BY id ASC LIMIT 1
                """)
                first = cur.fetchone()
                cur.execute("""
                    SELECT price_per_gram FROM gold_prices
                    WHERE country = 'مصر' AND karat = 'عيار 21'
                    ORDER BY id DESC LIMIT 1
                """)
                last = cur.fetchone()
                if first and last:
                    p1 = _to_float(first[0])
                    p2 = _to_float(last[0])
                    if p1 > 0:
                        return round(((p2 - p1) / p1) * 100, 2)
                return 0.0
            first_p = _to_float(rows[0][0])
            last_p = _to_float(rows[-1][0])
            if first_p > 0:
                return round(((last_p - first_p) / first_p) * 100, 2)
            return 0.0
        except Exception as e:
            print(f"[ReportsEngine] _get_gold_performance error: {e}")
            return 0.0
        finally:
            conn.close()

    def _get_usd_performance(self, start_date: datetime, end_date: datetime) -> float:
        """تغيّر سعر الدولار خلال فترة"""
        conn = self._connect_data_engine_robust(required_table='exchange_rates')
        if not conn:
            return 0.0
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT rate_to_usd, timestamp FROM exchange_rates
                WHERE currency = 'EGP'
                  AND timestamp >= ? AND timestamp <= ?
                ORDER BY id ASC
            """, (start_str + ' 00:00:00', end_str + ' 23:59:59'))
            rows = cur.fetchall()
            if len(rows) < 2:
                cur.execute("SELECT rate_to_usd FROM exchange_rates WHERE currency='EGP' ORDER BY id ASC LIMIT 1")
                first = cur.fetchone()
                cur.execute("SELECT rate_to_usd FROM exchange_rates WHERE currency='EGP' ORDER BY id DESC LIMIT 1")
                last = cur.fetchone()
                if first and last:
                    p1 = _to_float(first[0])
                    p2 = _to_float(last[0])
                    if p1 > 0:
                        return round(((p2 - p1) / p1) * 100, 2)
                return 0.0
            first_p = _to_float(rows[0][0])
            last_p = _to_float(rows[-1][0])
            if first_p > 0:
                return round(((last_p - first_p) / first_p) * 100, 2)
            return 0.0
        except Exception as e:
            print(f"[ReportsEngine] _get_usd_performance error: {e}")
            return 0.0
        finally:
            conn.close()

    # ─────────────────────────────────────────────────────────────────────────
    # Sparkline / chart data (financial visualizations)
    # ─────────────────────────────────────────────────────────────────────────

    def _connect_data_engine_robust(self, required_table: Optional[str] = None) -> Optional[sqlite3.Connection]:
        """يتصل بـ data_engine.db مع fallback لمسارات بديلة لو الـ primary فاضية
        أو ناقصة الجدول المطلوب. يستخدم فقط للـ sparkline methods الجديدة
        عشان ما يكسرش السلوك الحالي للـ methods القديمة."""
        candidates: List[str] = [self.data_engine_db_path]
        for fb in [
            PROJECT_ROOT / 'db' / 'data_engine.db',
            PROJECT_ROOT / 'db' / 'data_engine.db.real',
        ]:
            s = str(fb)
            if s not in candidates and fb.exists():
                candidates.append(s)
        for path in candidates:
            try:
                conn = sqlite3.connect(path)
                if required_table:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                        (required_table,)
                    )
                    if not cur.fetchone():
                        conn.close()
                        continue
                return conn
            except Exception:
                continue
        return None

    def _get_egx30_sparkline_data(self, days: int = 7) -> List[Dict]:
        """سلسلة أداء EGX30 لآخر N يوم (cumulative % change من أول يوم في الفترة).
        يرجع [{date, value}, ...] — value = ((avg_close_d - avg_close_first)/avg_close_first)*100
        المصدر: price_history.db (متوسط close_price لكل الأسهم في كل يوم).
        لو النافذة الزمنية مفيهاش بيانات كافية → fallback لآخر N أيام تداول متاحة."""
        conn = self._connect_price_history()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT date, AVG(close_price) AS avg_close
                FROM price_history
                WHERE date BETWEEN ? AND ?
                  AND close_price IS NOT NULL AND close_price > 0
                GROUP BY date
                ORDER BY date ASC
            """, (start_str, end_str))
            rows = cur.fetchall()
            # Fallback: لو النافذة مفيهاش بيانات كافية (بيانات قديمة)، خد آخر N أيام تداول متاحة
            if len(rows) < 2:
                cur.execute("""
                    SELECT date, AVG(close_price) AS avg_close
                    FROM price_history
                    WHERE close_price IS NOT NULL AND close_price > 0
                    GROUP BY date
                    ORDER BY date DESC
                    LIMIT ?
                """, (days,))
                rows = list(reversed(cur.fetchall()))
            if not rows:
                return []
            base = float(rows[0][1]) or 0.0
            if base <= 0:
                return []
            return [
                {'date': r[0], 'value': round(((float(r[1]) - base) / base) * 100, 3)}
                for r in rows
            ]
        except Exception as e:
            print(f"[ReportsEngine] _get_egx30_sparkline_data error: {e}")
            return []
        finally:
            conn.close()

    def _get_gold_sparkline_data(self, days: int = 7) -> List[Dict]:
        """سلسلة أسعار الذهب (عيار 21) لآخر N يوم من data_engine.db gold_prices.
        يرجع [{date, value}, ...] — value = متوسط price_per_gram في اليوم.
        لو النافذة الزمنية مفيهاش بيانات كافية → fallback لآخر N أيام متاحة."""
        conn = self._connect_data_engine_robust(required_table='gold_prices')
        if not conn:
            return []
        try:
            cur = conn.cursor()
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT date(timestamp) AS d, AVG(price_per_gram) AS avg_price
                FROM gold_prices
                WHERE country = 'مصر' AND karat = 'عيار 21'
                  AND date(timestamp) BETWEEN ? AND ?
                GROUP BY d
                ORDER BY d ASC
            """, (start_str, end_str))
            rows = cur.fetchall()
            if len(rows) < 2:
                cur.execute("""
                    SELECT date(timestamp) AS d, AVG(price_per_gram) AS avg_price
                    FROM gold_prices
                    WHERE country = 'مصر' AND karat = 'عيار 21'
                    GROUP BY d
                    ORDER BY d DESC
                    LIMIT ?
                """, (days,))
                rows = list(reversed(cur.fetchall()))
            return [{'date': r[0], 'value': round(float(r[1]), 2)}
                    for r in rows if r[0] and r[1] is not None]
        except Exception as e:
            print(f"[ReportsEngine] _get_gold_sparkline_data error: {e}")
            return []
        finally:
            conn.close()

    def _get_usd_sparkline_data(self, days: int = 7) -> List[Dict]:
        """سلسلة أسعار الدولار (USD→EGP) لآخر N يوم من data_engine.db exchange_rates.
        يرجع [{date, value}, ...] — value = متوسط rate_to_usd في اليوم.
        لو النافذة الزمنية مفيهاش بيانات كافية → fallback لآخر N أيام متاحة."""
        conn = self._connect_data_engine_robust(required_table='exchange_rates')
        if not conn:
            return []
        try:
            cur = conn.cursor()
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            cur.execute("""
                SELECT date(timestamp) AS d, AVG(rate_to_usd) AS avg_rate
                FROM exchange_rates
                WHERE currency = 'EGP'
                  AND date(timestamp) BETWEEN ? AND ?
                GROUP BY d
                ORDER BY d ASC
            """, (start_str, end_str))
            rows = cur.fetchall()
            if len(rows) < 2:
                cur.execute("""
                    SELECT date(timestamp) AS d, AVG(rate_to_usd) AS avg_rate
                    FROM exchange_rates
                    WHERE currency = 'EGP'
                    GROUP BY d
                    ORDER BY d DESC
                    LIMIT ?
                """, (days,))
                rows = list(reversed(cur.fetchall()))
            return [{'date': r[0], 'value': round(float(r[1]), 4)}
                    for r in rows if r[0] and r[1] is not None]
        except Exception as e:
            print(f"[ReportsEngine] _get_usd_sparkline_data error: {e}")
            return []
        finally:
            conn.close()

    def _get_top_performers_weekly(self, start_date: datetime, end_date: datetime,
                                   limit: int = 5) -> List[Dict]:
        """أفضل N سهم خلال فترة (مرتبين تنازلياً حسب % change).
        يرجع [{ticker, name, change_percent}, ...].
        لو الفترة المحددة مفيهاش بيانات → fallback لآخر فترة متاحة في price_history.
        يتم فلترة القيم المتطرفة (|change| > 100%) كأنها شذوذ بيانات/تقسيم أسهم."""
        conn = self._connect_price_history()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')
            # SQL مع فلترة الشذوذ (|change| <= 100%)
            sql_filtered = """
                SELECT ticker,
                  (SELECT close_price FROM price_history p2
                   WHERE p2.ticker = p1.ticker AND p2.date <= ?
                   ORDER BY p2.date DESC LIMIT 1) AS end_p,
                  (SELECT close_price FROM price_history p3
                   WHERE p3.ticker = p1.ticker AND p3.date >= ?
                   ORDER BY p3.date ASC LIMIT 1) AS start_p
                FROM price_history p1
                WHERE date BETWEEN ? AND ?
                GROUP BY ticker
                HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                  AND ABS((end_p - start_p) / start_p * 100) <= 100
                ORDER BY ((end_p - start_p) / start_p * 100) DESC
                LIMIT ?
            """
            # SQL بدون فلترة (fallback لو كل النتائج شذوذ)
            sql_raw = """
                SELECT ticker,
                  (SELECT close_price FROM price_history p2
                   WHERE p2.ticker = p1.ticker AND p2.date <= ?
                   ORDER BY p2.date DESC LIMIT 1) AS end_p,
                  (SELECT close_price FROM price_history p3
                   WHERE p3.ticker = p1.ticker AND p3.date >= ?
                   ORDER BY p3.date ASC LIMIT 1) AS start_p
                FROM price_history p1
                WHERE date BETWEEN ? AND ?
                GROUP BY ticker
                HAVING end_p IS NOT NULL AND start_p IS NOT NULL AND start_p > 0
                ORDER BY ((end_p - start_p) / start_p * 100) DESC
                LIMIT ?
            """
            fetch_n = max(limit * 4, 20)
            cur.execute(sql_filtered, (end_str, start_str, start_str, end_str, fetch_n))
            rows = cur.fetchall()
            sql_used = 'filtered'
            # Fallback 1: لو مفيش بيانات في الفترة، استخدم آخر فترة تداول متاحة
            if not rows:
                cur.execute("""
                    SELECT MIN(date), MAX(date) FROM (
                        SELECT DISTINCT date FROM price_history
                        WHERE close_price IS NOT NULL AND close_price > 0
                        ORDER BY date DESC LIMIT 7
                    )
                """)
                rng = cur.fetchone()
                if rng and rng[0] and rng[1]:
                    start_str, end_str = rng[0], rng[1]
                    cur.execute(sql_filtered, (end_str, start_str, start_str, end_str, fetch_n))
                    rows = cur.fetchall()
            # Fallback 2: لو كل النتائج شذوذ (الفلترة فضّت القائمة)، استخدم SQL بدون فلترة
            if not rows:
                cur.execute(sql_raw, (end_str, start_str, start_str, end_str, fetch_n))
                rows = cur.fetchall()
                sql_used = 'raw'
            return [
                {
                    'ticker': r[0],
                    'symbol': r[0],
                    'name': self._lookup_stock_name(r[0]),
                    'change_percent': round(
                        ((float(r[1]) - float(r[2])) / float(r[2])) * 100, 2
                    ),
                }
                for r in rows[:limit]
            ]
        except Exception as e:
            print(f"[ReportsEngine] _get_top_performers_weekly error: {e}")
            return []
        finally:
            conn.close()

    def _generate_weekly_lessons(self, egx_perf: float, gold_perf: float, usd_perf: float) -> List[str]:
        """3 دروس أسبوعية بناءً على الأداء"""
        lessons = []
        if egx_perf > 2:
            lessons.append("السوق في صعود قوي — تأكد من جني الأرباح تدريجياً")
        elif egx_perf < -2:
            lessons.append("السوق في تصحيح — تجنّب الشراء المتهور وانتظر استقرار الأسعار")
        else:
            lessons.append("السوق متذبذب — ركّز على الأسهم ذات السيولة العالية")

        if gold_perf > usd_perf:
            lessons.append("الذهب يتفوّق على الدولار — يفضّل تنويع المحفظة بالذهب كملاذ آمن")
        else:
            lessons.append("الدولار يتفوّق على الذهب — راقب تأثير سعر الصرف على الأسهم المصدّرة")

        lessons.append("الالتزام بوقف الخسارة هو مفتاح حماية رأس المال على المدى الطويل")
        return lessons[:3]

    def _get_weekly_watchlist(self) -> List[str]:
        """3 أسهم للمتابعة (أعلى Maestro Score + signal=BUY)"""
        picks = self._get_top_buy_picks(limit=3)
        return [p['symbol'] for p in picks][:3]

    def _get_predictions_stats(self, start_date: datetime, end_date: datetime) -> Dict:
        """إحصائيات التوقعات من predictions.db (جدول v4_patterns)"""
        conn = self._connect_predictions()
        if not conn:
            return {'total': 0, 'successful': 0, 'failed': 0, 'success_rate': 0}
        try:
            cur = conn.cursor()
            start_str = start_date.strftime('%Y-%m-%d')
            end_str = end_date.strftime('%Y-%m-%d')

            # محاولة جلب الإحصائيات من v4_patterns
            try:
                # v4_patterns columns: id, ticker, ticker_name, pattern_type, ... , outcome, pnl_pct
                cur.execute("""
                    SELECT COUNT(*),
                           SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END),
                           SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END)
                    FROM v4_patterns
                    WHERE entry_price IS NOT NULL
                """)
                row = cur.fetchone()
                total = row[0] or 0
                wins = row[1] or 0
                losses = row[2] or 0
                success_rate = round((wins / total * 100) if total > 0 else 0, 1)
                return {
                    'total': total,
                    'successful': wins,
                    'failed': losses,
                    'success_rate': success_rate,
                }
            except Exception:
                # Try aiPrediction table (in db/predictions.db)
                pass

            return {'total': 0, 'successful': 0, 'failed': 0, 'success_rate': 0}
        except Exception as e:
            print(f"[ReportsEngine] _get_predictions_stats error: {e}")
            return {'total': 0, 'successful': 0, 'failed': 0, 'success_rate': 0}
        finally:
            conn.close()

    def _get_top_sectors(self) -> List[str]:
        """أعلى 3 قطاعات في مصر"""
        conn = self._connect_data_engine()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT sector, AVG(CAST(REPLACE(REPLACE(change_percent, '%', ''), '+', '') AS REAL)) AS avg_chg
                FROM stocks
                WHERE market = ? AND sector IS NOT NULL AND sector != '' AND sector != '—'
                  AND change_percent IS NOT NULL AND change_percent != ''
                GROUP BY sector
                ORDER BY avg_chg DESC
                LIMIT 3
            """, (self.EGX_MARKET_KEY,))
            return [r[0] for r in cur.fetchall() if r[0]]
        except Exception as e:
            print(f"[ReportsEngine] _get_top_sectors error: {e}")
            return []
        finally:
            conn.close()

    def _get_sector_performance(self, limit: int = 12) -> List[Dict]:
        """أداء كل قطاع في السوق المصري (data_engine.db → stocks).

        يرجع [{name, avg_change_percent, count, gainers, losers}, ...]
        مرتب من الأفضل للأقل أداءً. ده المصدر الوحيد لتاب "تقرير القطاعات" ده المصدر الوحيد لتاب "تقرير القطاعات"
        في الواجهة — Node.js بيعرض بس (Rule 20)/python brain).
        """
        conn = self._connect_data_engine()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT TRIM(sector) AS sector,
                       COUNT(*) AS cnt,
                       AVG(change_percent) AS avg_chg,
                       SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) AS gainers,
                       SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) AS losers
                FROM stocks
                WHERE market = ?
                  AND sector IS NOT NULL AND TRIM(sector) != '' AND TRIM(sector) != '—'
                  AND change_percent IS NOT NULL
                GROUP BY TRIM(sector)
                ORDER BY avg_chg DESC
                LIMIT ?
            """, (self.EGX_MARKET_KEY, limit))
            rows = cur.fetchall()
            return [
                {
                    'name': r[0],
                    'avg_change_percent': round(_to_float(r[2]), 2),
                    'count': int(r[1] or 0),
                    'gainers': int(r[3] or 0),
                    'losers': int(r[4] or 0),
                }
                for r in rows
                if r[0] and int(r[1] or 0) > 0
            ]
        except Exception as e:
            print(f"[ReportsEngine] _get_sector_performance error: {e}")
            return []
        finally:
            conn.close()

    def _get_month_name_ar(self, month_num: int) -> str:
        months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
        return months[month_num - 1] if 1 <= month_num <= 12 else ''

    # ─────────────────────────────────────────────────────────────────────────
    # Report persistence
    # ─────────────────────────────────────────────────────────────────────────

    def _save_report(self, report_type: str, date: str, title: str,
                     content: str, image_path: Optional[str] = None) -> str:
        """يحفظ التقرير في predictions.db.reports ويرجع الـ ID"""
        report_id = f"rpt_{report_type}_{date}_{uuid.uuid4().hex[:8]}"
        try:
            conn = self._connect_predictions()
            if not conn:
                return report_id
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO reports (id, type, date, title, content, image_path, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            """, (report_id, report_type, date, title, content, image_path))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ReportsEngine] _save_report error: {e}")
        return report_id

    def get_reports_list(self, limit: int = 50, report_type: Optional[str] = None) -> List[Dict]:
        """قائمة التقارير من DB"""
        conn = self._connect_predictions()
        if not conn:
            return []
        try:
            cur = conn.cursor()
            if report_type:
                cur.execute("""
                    SELECT id, type, date, title, image_path, status, created_at, published_at
                    FROM reports
                    WHERE type = ?
                    ORDER BY datetime(created_at) DESC
                    LIMIT ?
                """, (report_type, limit))
            else:
                cur.execute("""
                    SELECT id, type, date, title, image_path, status, created_at, published_at
                    FROM reports
                    ORDER BY datetime(created_at) DESC
                    LIMIT ?
                """, (limit,))
            rows = cur.fetchall()
            return [{
                'id': r[0], 'type': r[1], 'date': r[2], 'title': r[3],
                'image_path': r[4], 'status': r[5], 'created_at': r[6],
                'published_at': r[7],
            } for r in rows]
        except Exception as e:
            print(f"[ReportsEngine] get_reports_list error: {e}")
            return []
        finally:
            conn.close()

    def get_report(self, report_id: str) -> Dict:
        """يجيب تقرير محدد بالنص والصورة"""
        conn = self._connect_predictions()
        if not conn:
            return {}
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, type, date, title, content, image_path, status,
                       telegram_message_id, created_at, published_at
                FROM reports
                WHERE id = ?
            """, (report_id,))
            r = cur.fetchone()
            if not r:
                return {}
            return {
                'id': r[0], 'type': r[1], 'date': r[2], 'title': r[3],
                'content': r[4], 'image_path': r[5], 'status': r[6],
                'telegram_message_id': r[7], 'created_at': r[8],
                'published_at': r[9],
            }
        except Exception as e:
            print(f"[ReportsEngine] get_report error: {e}")
            return {}
        finally:
            conn.close()

    # ─────────────────────────────────────────────────────────────────────────
    # Telegram publishing
    # ─────────────────────────────────────────────────────────────────────────

    def publish_to_telegram(self, report_id: str) -> Dict:
        """ينشر التقرير على تيليجرام (صورة + caption) ويحدّث status='published'.

        V2.3 (طلب الخبير محسن): النشر يتطلب status='approved' (موافقة الأدمن).
        لو status='pending' → نرفض ونطلب الموافقة الأول.
        لو status='rejected' → نرفض.
        لو status='published' → نرجع already_published.
        """
        report = self.get_report(report_id)
        if not report:
            return {"success": False, "error": "Report not found"}

        current_status = report.get('status', 'pending')
        if current_status == 'published':
            return {
                "success": True,
                "already_published": True,
                "telegram_message_id": report.get('telegram_message_id'),
            }
        # V2.3: موافقة الأدمن مطلوبة قبل النشر
        if current_status == 'pending':
            return {
                "success": False,
                "error": "التقرير بحاجة إلى موافقة الأدمن قبل النشر",
                "error_ar": "التقرير بحاجة إلى موافقة الأدمن قبل النشر. استخدم /approve أولاً.",
                "status": current_status,
                "needs_approval": True,
            }
        if current_status == 'rejected':
            return {
                "success": False,
                "error": "التقرير مرفوض ولا يمكن نشره",
                "error_ar": "التقرير مرفوض ولا يمكن نشره",
                "status": current_status,
            }
        # status='approved' → نكمل النشر

    def approve_report(self, report_id: str) -> Dict:
        """V2.3: موافقة الأدمن على التقرير قبل النشر (status: pending -> approved)."""
        report = self.get_report(report_id)
        if not report:
            return {"success": False, "error": "Report not found"}
        current_status = report.get('status', 'pending')
        if current_status == 'published':
            return {
                "success": True,
                "already_published": True,
                "telegram_message_id": report.get('telegram_message_id'),
            }
        if current_status == 'rejected':
            return {"success": False, "error": "التقرير مرفوض — لا يمكن الموافقة عليه"}
        conn = self._connect_predictions()
        if not conn:
            return {"success": False, "error": "DB unavailable"}
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE reports SET status = 'approved' "
                "WHERE id = ? AND status IN ('pending', 'approved')",
                (report_id,)
            )
            conn.commit()
            rows = cur.rowcount
        finally:
            conn.close()
        if rows == 0:
            return {"success": False, "error": "لم يتم تحديث التقرير (ربما ليس بحالة pending)"}
        return {"success": True, "report_id": report_id, "status": "approved"}

    def reject_report(self, report_id: str, reason: str = "") -> Dict:
        """V2.3: رفض الأدمن للتقرير (status: pending -> rejected)."""
        report = self.get_report(report_id)
        if not report:
            return {"success": False, "error": "Report not found"}
        current_status = report.get('status', 'pending')
        if current_status == 'published':
            return {"success": False, "error": "التقرير منشور بالفعل — لا يمكن رفضه"}
        conn = self._connect_predictions()
        if not conn:
            return {"success": False, "error": "DB unavailable"}
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE reports SET status = 'rejected' "
                "WHERE id = ? AND status IN ('pending', 'approved')",
                (report_id,)
            )
            conn.commit()
            rows = cur.rowcount
        finally:
            conn.close()
        if rows == 0:
            return {"success": False, "error": "لم يتم تحديث التقرير"}
        return {"success": True, "report_id": report_id, "status": "rejected", "reason": reason}

        # Try to import TelegramAutoPoster
        try:
            sys.path.insert(0, os.path.join(_HERE, '..', 'telegram'))
            from auto_poster import TelegramAutoPoster
        except Exception as e:
            return {"success": False, "error": f"TelegramAutoPoster unavailable: {e}"}

        try:
            poster = TelegramAutoPoster()
            image_path = report.get('image_path')
            content = report.get('content') or ''
            title = report.get('title') or ''

            # Caption (truncate to Telegram caption limit ~1024 chars)
            caption = f"📊 {title}\n\n{content}"
            caption += "\n\n━━━━━━━━━━━━━━━━━━━\n"
            caption += "🌐 الموقع: https://invist.m2y.net\n"
            caption += "📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment\n"
            caption += "📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048\n"
            caption += "✈️ تليجرام: https://t.me/Arabian_investment_guide\n"
            caption += "━━━━━━━━━━━━━━━━━━━\n"
            caption += "📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈"
            
            if len(caption) > 1000:
                caption = caption[:997] + '...'

            tg_msg_id = None
            # Send photo if available, otherwise send text only
            if image_path and os.path.exists(image_path):
                result = asyncio.run(poster.send_photo(image_path, caption=caption))
                if result.get('success'):
                    tg_msg_id = str(result.get('message_id'))
                else:
                    # Fallback: try sending as text
                    text_result = asyncio.run(poster.send_message(caption))
                    if text_result.get('success'):
                        tg_msg_id = str(text_result.get('message_id'))
                    else:
                        return {
                            "success": False,
                            "error": f"photo: {result.get('error')}; text: {text_result.get('error')}"
                        }
            else:
                result = asyncio.run(poster.send_message(caption))
                if result.get('success'):
                    tg_msg_id = str(result.get('message_id'))
                else:
                    return {"success": False, "error": result.get('error')}

            # Update report
            conn = self._connect_predictions()
            if conn:
                try:
                    cur = conn.cursor()
                    cur.execute("""
                        UPDATE reports
                        SET status = 'published',
                            published_at = datetime('now'),
                            telegram_message_id = ?
                        WHERE id = ?
                    """, (tg_msg_id, report_id))
                    conn.commit()
                finally:
                    conn.close()

            return {
                "success": True,
                "report_id": report_id,
                "telegram_message_id": tg_msg_id,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# CLI entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    engine = ReportsEngine()
    print(f"✓ ReportsEngine initialized")
    print(f"  - stocks_db:        {engine.stocks_db_path}")
    print(f"  - data_engine_db:   {engine.data_engine_db_path}")
    print(f"  - predictions_db:   {engine.predictions_db_path}")
    print(f"  - price_history_db: {engine.price_history_db_path}")
    print(f"  - is_holiday: {engine.is_holiday()}")
    print(f"  - is_working_day: {engine.is_working_day()}")
    print(f"  - card_generator: {engine.card_generator}")

    print("\n--- Tomorrow Picks ---")
    res = engine.generate_tomorrow_picks()
    print(json.dumps({k: v for k, v in res.items() if k != 'picks'}, ensure_ascii=False, indent=2))
    if res.get('picks'):
        for p in res['picks']:
            print(f"  • {p['symbol']} ({p['name']}) — price={p['price']} target={p['target']}")

    print("\n--- Daily Summary ---")
    res = engine.generate_daily_summary()
    print(f"  success: {res.get('success')}")
    print(f"  image_path: {res.get('image_path')}")

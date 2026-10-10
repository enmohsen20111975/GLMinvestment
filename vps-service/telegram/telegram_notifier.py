"""
telegram_notifier.py — إشعارات التليجرام للتوقعات (2026-08-30)
=================================================================
إرسال إشعارات للتليجرام لما:
1. توقع يجيب الهدف الأول أو الثاني
2. توقع يقرب يكسر دعم
3. تقرير يومي احترافي
4. تقرير أسبوعي احترافي

CANONICAL ROLE (UNIFY-RISK-TELEGRAM, Rule 54):
- This file is the canonical OUTBOUND notifier (HTTP Bot API, bot account).
- Exposes `TelegramNotifier` class.
- Lightweight, synchronous, no Telethon session required.
- Used for SEND-ONLY notifications: target-hit alerts, daily/weekly reports,
  intraday alerts, closing scorecards.
- Imported by:
  * vps-service/api/telegram_routes.py   (REST endpoints: daily/weekly report, target-hit)
  * vps-service/scripts/telegram_live_monitor.py  (live monitor CLI script)
  * vps-service/jobs/daily_closer.py      (closing scorecard notifier)

NOT TO BE CONFUSED WITH:
- telegram/telegram_client.py  → Telethon, user account, BI-DIRECTIONAL (receive + send).
                                  Heavyweight async session, used for receiving channel
                                  messages and processing them via AI.

Rule 54 (PICK ONE) — Clarification:
- Both this file (HTTP Bot API) and telegram_client.py (Telethon) ARE used in production
  because they serve genuinely different purposes (send-only vs receive+send).
- For new OUTBOUND-only notification code, PREFER this file (lighter, no Telethon dependency).
- For RECEIVING messages from channels or acting as a Telegram user, use telegram_client.py.

الاستخدام:
  from telegram.telegram_notifier import TelegramNotifier

  notifier = TelegramNotifier()
  notifier.notify_target_hit(ticker, entry, target, return_pct)
  notifier.notify_daily_report(predictions)
"""
from __future__ import annotations
import os, sys, asyncio, sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_DB_DIR = _PROJECT_ROOT / 'db'


class TelegramNotifier:
    """إشعارات التليجرام للتوقعات + التقارير."""

    def __init__(self):
        self.bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
        # TELEGRAM_CHAT_ID أو TELEGRAM_CHANNEL_ID (المالك بعت TELEGRAM_CHANNEL_ID=@Arabian_investment_guide)
        self.chat_id = os.environ.get('TELEGRAM_CHAT_ID', '') or os.environ.get('TELEGRAM_CHANNEL_ID', '')
        self.enabled = bool(self.bot_token and self.chat_id)
        # DISCLAIMER-FIX (2026-10-09, Team 5): إضافة disclaimer لكل رسالة
        self.LEGAL_DISCLAIMER = "\n\n━━━━━━━━━━━━━━━━━━━\n⚠️ <i>تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.</i>"

    def _send(self, message: str, reply_markup: Optional[Dict[str, Any]] = None, ticker: Optional[str] = None) -> bool:
        """إرسال رسالة للتليجرام مع الأزرار الرسمية (الموقع + البوت + الخدمات + التواصل)."""
        if not self.enabled:
            return False
        # DISCLAIMER-FIX: ضيف disclaimer لكل رسالة (لو مش موجود بالفعل)
        if 'ليس نصيحة استثمارية' not in message:
            message = message + self.LEGAL_DISCLAIMER
        try:
            import urllib.request
            import urllib.parse
            import json

            if reply_markup is None:
                try:
                    from telegram_branding import get_official_reply_markup
                    reply_markup = get_official_reply_markup(ticker=ticker)
                except Exception:
                    try:
                        from telegram.telegram_branding import get_official_reply_markup
                        reply_markup = get_official_reply_markup(ticker=ticker)
                    except Exception:
                        reply_markup = None

            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                'chat_id': self.chat_id,
                'text': message,
                'parse_mode': 'HTML',
                'disable_web_page_preview': 'false',
            }
            if reply_markup and reply_markup is not False:
                payload['reply_markup'] = json.dumps(reply_markup, ensure_ascii=False)

            data = urllib.parse.urlencode(payload)
            req = urllib.request.Request(url, data=data.encode('utf-8'), method='POST')
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except Exception as e:
            print(f"[TelegramNotifier] send failed: {e}", flush=True)
            return False

    def notify_target_hit(self, ticker: str, entry: float, target: float,
                          return_pct: float, target_num: int = 1,
                          name_ar: str = '') -> bool:
        """إشعار: توقع جاب الهدف! (رسالة احتفال كاملة)."""
        # اختيار الإيموجي حسب حجم الربح
        if return_pct >= 20:
            celebration = "🎉🎊🏆"
            title_emoji = "🚀"
            title = "إنجاز! هدف مكسور بفارق كبير"
        elif return_pct >= 10:
            celebration = "🎉🏆"
            title_emoji = "🎯"
            title = "هدف محقق بنتيجة ممتازة"
        elif return_pct >= 5:
            celebration = "🎉"
            title_emoji = "🎯"
            title = "هدف محقق بنجاح"
        else:
            celebration = "✅"
            title_emoji = "🎯"
            title = "هدف محقق"

        msg = f"""{celebration}
{title_emoji} <b>{title}</b>

📊 السهم: <b>{ticker}</b>{f' — {name_ar}' if name_ar else ''}
💰 سعر الدخول: <b>{entry:.2f}</b> EGP
🎯 الهدف {target_num}: <b>{target:.2f}</b> EGP
📈 العائد المحقق: <b>+{return_pct:.2f}%</b>
⏰ وقت التحقق: {datetime.now().strftime('%Y-%m-%d %H:%M')}

👏 احسنتم — التوصية نجحت. متابعتكم السليمة حافظت على رأس المال وحسّنت العائد."""
        return self._send(msg)

    def notify_approaching_target(self, ticker: str, entry: float, target: float,
                                    current: float, name_ar: str = '',
                                    distance_pct: float = 0.0) -> bool:
        """إشعار: توقع قرب يجيب الهدف! (لما السهم يدخل 3% من الهدف)."""
        # احسب المسافة للهدف + نسبة الإنجاز الحالية
        progress_pct = ((current - entry) / (target - entry) * 100) if (target - entry) != 0 else 0
        remaining_pct = ((target - current) / current * 100) if current > 0 else 0
        current_gain = ((current - entry) / entry * 100) if entry > 0 else 0

        msg = f"""🔥 <b>قرب من الهدف — خد بالك</b>

📊 السهم: <b>{ticker}</b>{f' — {name_ar}' if name_ar else ''}
💰 سعر الدخول: {entry:.2f} EGP
🎯 الهدف: <b>{target:.2f}</b> EGP
📍 السعر الحالي: <b>{current:.2f}</b> EGP
📏 المسافة للهدف: <b>{distance_pct:.2f}%</b>
📊 نسبة الإنجاز: {progress_pct:.0f}%
📈 الربح الحالي: <b>+{current_gain:.2f}%</b>

💡 <b>خد بالك من الدعم عند:</b> {entry + (current - entry) * 0.5:.2f} EGP
   (مستوى نصف المكسب — لو رجع ليه ابقى حذر)
⏰ {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_stop_warning(self, ticker: str, entry: float, stop: float,
                            current: float, name_ar: str = '') -> bool:
        """إشعار: توقع قرب يكسر دعم!"""
        distance_pct = ((current - stop) / stop * 100) if stop > 0 else 0
        loss_pct = ((current - entry) / entry * 100) if entry > 0 else 0

        # مستوى الحذر حسب القرب من الستوب
        if distance_pct <= 2:
            urgency = "🚨 <b>حرج جداً</b> — السعر على بعد خطوة من الستوب"
        elif distance_pct <= 4:
            urgency = "⚠️ <b>تحذير قوي</b> — قرب الستوب"
        else:
            urgency = "👁️ <b>مراقبة</b> — السهم تحت ضغط"

        msg = f"""{urgency}

📊 السهم: <b>{ticker}</b>{f' — {name_ar}' if name_ar else ''}
💰 سعر الدخول: {entry:.2f} EGP
🛡️ الوقف: <b>{stop:.2f}</b> EGP
📉 السعر الحالي: <b>{current:.2f}</b> EGP
📏 المسافة للوقف: <b>{distance_pct:.2f}%</b>
📉 الخسارة الحالية: <b>{loss_pct:.2f}%</b>

💡 <b>توصية:</b> راقب السهم عن قرب. لو كسر {stop:.2f} بكمية → تأكد من تنفيذ الستوب.
⏰ {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_trailing_profit(self, ticker: str, entry: float,
                                  exit_price: float, return_pct: float,
                                  highest: float, name_ar: str = '') -> bool:
        """إشعار: توقع خرج بربح قبل الهدف (trailing stop)."""
        msg = f"""💰 <b>خرج بربح قبل الهدف</b>

📊 السهم: <b>{ticker}</b>{f' — {name_ar}' if name_ar else ''}
💰 سعر الدخول: {entry:.2f} EGP
🚪 سعر الخروج: <b>{exit_price:.2f}</b> EGP
📈 العائد: <b>+{return_pct:.2f}%</b>
🔝 أعلى سعر وصل له: {highest:.2f} EGP

💡 الـ trailing stop شغّال وحافظ على ربحك. السهم ما قدرش يكمل للهدف بس خرجنا سعداء.
⏰ {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_stop_loss(self, ticker: str, entry: float, stop: float,
                          return_pct: float, name_ar: str = '') -> bool:
        """إشعار: توقع ضرب الستوب (خسارة)."""
        msg = f"""🛑 <b>ضرب الستوب — خسارة محسوبة</b>

📊 السهم: <b>{ticker}</b>{f' — {name_ar}' if name_ar else ''}
💰 سعر الدخول: {entry:.2f} EGP
🛑 الستوب: <b>{stop:.2f}</b> EGP
📉 العائد: <b>{return_pct:.2f}%</b>

💪 الستوب شغّال زي ما لازم. الخسارة محسوبة ومحدودة — ده دور الـ risk management.
⏰ {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_daily_report(self, predictions: List[Dict] = None, market: str = 'EGX') -> bool:
        """تقرير يومي احترافي. market='EGX' or 'CRYPTO'."""
        if predictions is None:
            predictions = self._get_today_predictions(market=market)

        if not predictions:
            return False

        market_label = 'العملات الرقمية' if market == 'CRYPTO' else 'البورصة المصرية'

        # إحصائيات
        total = len(predictions)
        wins = sum(1 for p in predictions if p.get('actual_return') and float(p['actual_return']) > 0)
        losses = sum(1 for p in predictions if p.get('actual_return') and float(p['actual_return']) <= 0)
        pending = total - wins - losses
        wr = (wins / total * 100) if total > 0 else 0

        # أفضل/أسوأ توقع
        closed = [p for p in predictions if p.get('actual_return') is not None]
        best = max(closed, key=lambda x: float(x['actual_return'])) if closed else None
        worst = min(closed, key=lambda x: float(x['actual_return'])) if closed else None

        msg = f"""📊 <b>التقرير اليومي — {market_label} — {datetime.now().strftime('%Y-%m-%d')}</b>

📈 <b>إحصائيات اليوم:</b>
• إجمالي التوقعات: {total}
• صفقات رابحة: {wins}
• صفقات خاسرة: {losses}
• معلقة: {pending}
• نسبة النجاح: {wr:.1f}%
"""
        if best:
            msg += f"\n🏆 <b>أفضل توقع:</b> {best['ticker']} (+{float(best['actual_return']):.2f}%)"
        if worst:
            msg += f"\n📉 <b>أسوأ توقع:</b> {worst['ticker']} ({float(worst['actual_return']):.2f}%)"

        # قائمة التوقعات النشطة
        active = [p for p in predictions if p.get('status', '').lower() == 'active']
        if active:
            msg += f"\n\n⏳ <b>توقعات نشطة ({len(active)}):</b>"
            for p in active[:5]:
                entry = float(p.get('entry_price', 0) or 0)
                target = float(p.get('target_price', 0) or 0)
                current = float(p.get('current_price', 0) or entry)
                gain = ((current - entry) / entry * 100) if entry > 0 else 0
                msg += f"\n• {p['ticker']} — دخول: {entry:.2f} | هدف: {target:.2f} | الحالي: {gain:+.1f}%"

        return self._send(msg)

    def notify_weekly_report(self) -> bool:
        """تقرير أسبوعي احترافي."""
        predictions = self._get_week_predictions()
        if not predictions:
            return False

        total = len(predictions)
        wins = sum(1 for p in predictions if p.get('actual_return') and float(p['actual_return']) > 0)
        losses = sum(1 for p in predictions if p.get('actual_return') and float(p['actual_return']) <= 0)
        closed = [p for p in predictions if p.get('actual_return') is not None]
        total_return = sum(float(p['actual_return']) for p in closed if abs(float(p['actual_return'])) <= 50)
        wr = (wins / len(closed) * 100) if closed else 0

        # أفضل 3 صفقات
        sorted_closed = sorted(closed, key=lambda x: float(x['actual_return']), reverse=True)
        top3 = sorted_closed[:3]

        msg = f"""📅 <b>التقرير الأسبوعي — {datetime.now().strftime('%Y-%m-%d')}</b>

📊 <b>إحصائيات الأسبوع:</b>
• إجمالي التوقعات: {total}
• صفقات مغلقة: {len(closed)}
• رابحة: {wins}
• خاسرة: {losses}
• نسبة النجاح: {wr:.1f}%
• العائد الإجمالي: {total_return:+.2f}%
"""
        if top3:
            msg += "\n🏆 <b>أفضل 3 صفقات:</b>"
            for p in top3:
                msg += f"\n• {p['ticker']} — +{float(p['actual_return']):.2f}%"

        return self._send(msg)

    def _get_today_predictions(self, market: str = 'EGX') -> List[Dict]:
        """جيب توقعات اليوم. market='EGX' or 'CRYPTO'."""
        db_path = str(_DB_DIR / 'predictions.db')
        if not os.path.exists(db_path):
            return []
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        today = datetime.now().strftime('%Y-%m-%d')
        if market == 'CRYPTO':
            rows = conn.execute(
                "SELECT * FROM predictions WHERE date(prediction_date) = ? AND persona LIKE '%crypto%' ORDER BY id DESC",
                (today,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE date(prediction_date) = ? AND (persona NOT LIKE '%crypto%' OR persona IS NULL) ORDER BY id DESC",
                (today,)
            ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def _get_week_predictions(self) -> List[Dict]:
        """جيب توقعات آخر 7 أيام."""
        db_path = str(_DB_DIR / 'predictions.db')
        if not os.path.exists(db_path):
            return []
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        rows = conn.execute(
            "SELECT * FROM predictions WHERE date(prediction_date) >= ? ORDER BY prediction_date DESC",
            (week_ago,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    # ═══════════════════════════════════════════════════════════════════════
    # LIVE MONITOR — بيفحص التوقعات النشطة + يبعت approaching notifications
    # ═══════════════════════════════════════════════════════════════════════
    # المالك (2026-09-02): "التليجرام هو الذراع الإعلاني للمشروع وأهميته = أهمية الـ Frontend"
    # ده بـ يبعت:
    #   - notify_approaching_target لما السهم يدخل 3% من الهدف
    #   - notify_stop_warning لما السهم يقرب من الستوب بنسبة 5%
    #   - notify_trailing_profit لما توقع يخرج بـ trailing
    #   - notify_stop_loss لما توقع يضرب الستوب
    #
    # التشغيل: من خلال cron كل 15 دقيقة أثناء الجلسة.

    APPROACHING_TARGET_THRESHOLD_PCT = 3.0   # داخل 3% من الهدف
    APPROACHING_STOP_THRESHOLD_PCT = 5.0     # قريب 5% من الستوب

    def check_active_predictions_for_notifications(self, current_prices: Dict[str, float] = None) -> int:
        """فحص كل التوقعات النشطة (PENDING/ACTIVE) + إرسال notifications حسب الحالة.

        Args:
            current_prices: dict {ticker: current_price}. لو None بـ يجيب من live_price.

        Returns:
            عدد الإشعارات المرسلة.
        """
        if not self.enabled:
            return 0

        # جيب التوقعات النشطة
        active_preds = self._get_active_predictions()
        if not active_preds:
            return 0

        # جيب الأسعار الحالية لو مش متاحة
        if current_prices is None:
            current_prices = self._fetch_current_prices([p['ticker'] for p in active_preds])

        sent_count = 0
        for p in active_preds:
            ticker = p['ticker']
            entry = float(p['entry_price'] or 0)
            target = float(p['target_price'] or 0)
            stop = float(p['stop_loss'] or 0)
            current = float(current_prices.get(ticker, 0))

            if current <= 0 or entry <= 0:
                continue

            # (1) قرب الهدف؟
            if target > 0:
                distance_to_target = abs(target - current) / target * 100
                if distance_to_target <= self.APPROACHING_TARGET_THRESHOLD_PCT and current < target:
                    if self.notify_approaching_target(
                        ticker=ticker, entry=entry, target=target, current=current,
                        distance_pct=distance_to_target, name_ar=p.get('name_ar', '')
                    ):
                        sent_count += 1
                    continue  # ما نبعتش تنبيهين في نفس المرة

            # (2) قرب الستوب؟
            if stop > 0:
                distance_to_stop = abs(current - stop) / stop * 100
                if distance_to_stop <= self.APPROACHING_STOP_THRESHOLD_PCT:
                    if self.notify_stop_warning(
                        ticker=ticker, entry=entry, stop=stop, current=current,
                        name_ar=p.get('name_ar', '')
                    ):
                        sent_count += 1

        return sent_count

    def _get_active_predictions(self) -> List[Dict]:
        """جيب كل التوقعات النشطة (PENDING أو ACTIVE)."""
        db_path = str(_DB_DIR / 'predictions.db')
        if not os.path.exists(db_path):
            return []
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT * FROM predictions
                   WHERE status IN ('PENDING', 'ACTIVE')
                   OR (outcome_date IS NULL AND actual_return IS NULL)
                   ORDER BY prediction_date DESC LIMIT 50"""
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception:
            return []

    def _fetch_current_prices(self, tickers: List[str]) -> Dict[str, float]:
        """جيب الأسعار الحالية من live_price."""
        prices = {}
        try:
            from utils.live_price import get_live_price
            for tk in tickers[:50]:  # cap على 50 عشان السرعة
                try:
                    p = get_live_price(tk)
                    if p and p > 0:
                        prices[tk] = float(p)
                except Exception:
                    continue
        except ImportError:
            pass
        return prices

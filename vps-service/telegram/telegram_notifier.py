"""
telegram_notifier.py — إشعارات التليجرام للتوقعات (2026-08-30)
=================================================================
إرسال إشعارات للتليجرام لما:
1. توقع يجيب الهدف الأول أو الثاني
2. توقع يقرب يكسر دعم
3. تقرير يومي احترافي
4. تقرير أسبوعي احترافي

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
        self.chat_id = os.environ.get('TELEGRAM_CHAT_ID', '')
        self.enabled = bool(self.bot_token and self.chat_id)

    def _send(self, message: str) -> bool:
        """إرسال رسالة للتليجرام (بسيط — عبر HTTP API)."""
        if not self.enabled:
            return False
        try:
            import urllib.request
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            data = f"chat_id={self.chat_id}&text={message}&parse_mode=HTML"
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
        """إشعار: توقع جاب الهدف!"""
        emoji = "🎯" if target_num == 1 else "🚀"
        msg = f"""{emoji} <b>توقع حقق الهدف {target_num}!</b>

📊 السهم: <b>{ticker}</b>{f' ({name_ar})' if name_ar else ''}
💰 سعر الدخول: {entry:.2f}
🎯 الهدف {target_num}: {target:.2f}
📈 العائد: <b>+{return_pct:.2f}%</b>
⏰ الوقت: {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_stop_warning(self, ticker: str, entry: float, stop: float,
                            current: float, name_ar: str = '') -> bool:
        """إشعار: توقع قرب يكسر دعم!"""
        distance_pct = ((current - stop) / stop * 100) if stop > 0 else 0
        msg = f"""⚠️ <b>تنبيه: قرب كسر الدعم</b>

📊 السهم: <b>{ticker}</b>{f' ({name_ar})' if name_ar else ''}
💰 سعر الدخول: {entry:.2f}
🛡️ الوقف: {stop:.2f}
📉 السعر الحالي: {current:.2f}
📏 المسافة للوقف: {distance_pct:.1f}%
⏰ الوقت: {datetime.now().strftime('%Y-%m-%d %H:%M')}"""
        return self._send(msg)

    def notify_daily_report(self, predictions: List[Dict] = None) -> bool:
        """تقرير يومي احترافي."""
        if predictions is None:
            predictions = self._get_today_predictions()

        if not predictions:
            return False

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

        msg = f"""📊 <b>التقرير اليومي — {datetime.now().strftime('%Y-%m-%d')}</b>

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

    def _get_today_predictions(self) -> List[Dict]:
        """جيب توقعات اليوم."""
        db_path = str(_DB_DIR / 'predictions.db')
        if not os.path.exists(db_path):
            return []
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        today = datetime.now().strftime('%Y-%m-%d')
        rows = conn.execute(
            "SELECT * FROM predictions WHERE date(prediction_date) = ? ORDER BY id DESC",
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

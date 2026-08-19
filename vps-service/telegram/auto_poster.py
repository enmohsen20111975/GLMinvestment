#!/usr/bin/env python3
from __future__ import annotations

"""
Telegram Auto Poster
====================
نشر تلقائي على قناة التليجرام

المميزات:
- نشر توقعات يومية
- نشر تحليلات الأسهم
- نشر ملخص السوق
- جدولة النشر التلقائي
"""

import os
import sys
import json
import asyncio
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from telethon import TelegramClient
    from telethon.tl.types import InputPeerChannel
    from telethon.tl.functions.channels import GetFullChannelRequest
    TELETHON_AVAILABLE = True
except ImportError:
    print("Warning: Telethon not installed. Auto-posting disabled.")
    TELETHON_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(SERVICE_DIR, 'credentials.json')
SESSION_PATH = os.path.join(SERVICE_DIR, 'telegram_session')

COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈'

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
}

# Database paths
PROJECT_ROOT = Path(__file__).parent.parent.parent
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')


# ─────────────────────────────────────────────────────────────────────────────
# Auto Poster Class
# ─────────────────────────────────────────────────────────────────────────────

class TelegramAutoPoster:
    """خدمة النشر التلقائي على تليجرام"""
    
    def __init__(self):
        self.client: Optional[TelegramClient] = None
        self.is_connected = False
        self.channel_entity = None
        self._load_credentials()
    
    def _load_credentials(self) -> Dict:
        """تحميل بيانات الاعتماد (من ملف credentials.json أو environ)"""
        creds = {}
        # 1. Try loading from credentials.json
        try:
            with open(CREDENTIALS_PATH, 'r') as f:
                creds = json.load(f)
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[AutoPoster] Error loading credentials.json: {e}")

        # 2. Fall back to environment variables for any missing fields
        env_map = {
            'api_id': ('TELEGRAM_API_ID', lambda v: int(v) if v else None),
            'api_hash': ('TELEGRAM_API_HASH', None),
            'bot_token': ('TELEGRAM_BOT_TOKEN', None),
            'channel_id': ('TELEGRAM_CHANNEL_ID', None),
            'phone': ('TELEGRAM_PHONE', None),
        }
        for key, (env_var, transform) in env_map.items():
            if not creds.get(key):
                val = os.environ.get(env_var)
                if val:
                    try:
                        creds[key] = transform(val) if transform else val
                    except Exception:
                        creds[key] = val

        self.credentials = creds
        return creds
    
    @property
    def channel_id(self) -> Optional[str]:
        return self.credentials.get('channel_id')
    
    @property
    def bot_token(self) -> Optional[str]:
        return self.credentials.get('bot_token')
    
    @property
    def api_id(self) -> Optional[int]:
        return self.credentials.get('api_id')
    
    @property
    def api_hash(self) -> Optional[str]:
        return self.credentials.get('api_hash')
    
    async def connect(self) -> Dict:
        """الاتصال بـ Telegram"""
        if not TELETHON_AVAILABLE:
            return {"success": False, "error": "Telethon not installed"}
        
        if self.client and self.is_connected:
            return {"success": True, "message": "Already connected"}
        
        if not self.api_id or not self.api_hash:
            return {"success": False, "error": "API credentials not configured"}
        
        try:
            # استخدام Bot Token للنشر
            if self.bot_token:
                self.client = TelegramClient(
                    SESSION_PATH + '_poster',
                    self.api_id,
                    self.api_hash
                )
                await self.client.connect()
                await self.client.sign_in(bot_token=self.bot_token)
                
                # الحصول على كيان القناة
                if self.channel_id:
                    try:
                        self.channel_entity = await self.client.get_entity(self.channel_id)
                    except Exception as e:
                        print(f"[AutoPoster] Could not get channel entity: {e}")
                
                self.is_connected = True
                return {
                    "success": True,
                    "message": "Connected as Bot",
                    "channel": self.channel_id,
                    "channel_name": getattr(self.channel_entity, 'title', None)
                }
            
            return {"success": False, "error": "Bot token not configured"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def disconnect(self):
        """قطع الاتصال"""
        if self.client:
            await self.client.disconnect()
            self.is_connected = False
            self.channel_entity = None
    
    async def send_message(self, text: str, parse_mode: str = 'md') -> Dict:
        """
        إرسال رسالة للقناة
        
        Args:
            text: نص الرسالة
            parse_mode: وضع التنسيق (md/html)
        
        Returns:
            {"success": bool, "message_id": int, "error": str}
        """
        if not self.is_connected:
            result = await self.connect()
            if not result.get('success'):
                return result
        
        if not self.channel_entity:
            return {"success": False, "error": "Channel not configured"}
        
        try:
            msg = await self.client.send_message(
                self.channel_entity,
                text,
                parse_mode=parse_mode,
                link_preview=False
            )
            return {
                "success": True,
                "message_id": msg.id,
                "date": msg.date.isoformat() if msg.date else None
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def send_photo(self, photo_path: str, caption: str = None, parse_mode: str = 'md') -> Dict:
        """
        إرسال صورة للقناة
        
        Args:
            photo_path: مسار الصورة
            caption: التعليق
            parse_mode: وضع التنسيق
        """
        if not self.is_connected:
            result = await self.connect()
            if not result.get('success'):
                return result
        
        if not self.channel_entity:
            return {"success": False, "error": "Channel not configured"}
        
        try:
            msg = await self.client.send_message(
                self.channel_entity,
                file=photo_path,
                caption=caption,
                parse_mode=parse_mode
            )
            return {
                "success": True,
                "message_id": msg.id,
                "date": msg.date.isoformat() if msg.date else None
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ═══════════════════════════════════════════════════════════════════════════
    # قوالب النشر
    # ═══════════════════════════════════════════════════════════════════════════
    
    def format_recommendation_post(self, rec: Dict) -> str:
        """
        تنسيق توقعة للنشر
        
        Args:
            rec: {
                "ticker": "COMI",
                "name_ar": "البنك التجاري الدولي",
                "signal": "BUY",
                "price": 136.59,
                "target_price": 150.00,
                "stop_loss": 128.00,
                "confidence": 85,
                "reasoning": "...",
                "sector": "Banks"
            }
        """
        ticker = rec.get('ticker', '')
        name_ar = rec.get('name_ar', rec.get('name', ''))
        signal = rec.get('signal', 'HOLD')
        signal_ar = {'BUY': 'شراء', 'SELL': 'بيع', 'HOLD': 'متابعة'}.get(signal, signal)
        signal_emoji = {'BUY': '🟢', 'SELL': '🔴', 'HOLD': '🟡'}.get(signal, '⚪')
        
        price = rec.get('current_price') or rec.get('price', 0)
        target = rec.get('target_price')
        stop = rec.get('stop_loss')
        confidence = rec.get('confidence', 0)
        sector = rec.get('sector', '')
        
        text = f"""📊 **تحليل سهم {ticker}**
🏦 {name_ar}

{signal_emoji} **التوقعة: {signal_ar}**
💰 **السعر الحالي:** {price:.2f} ج.م
"""
        
        if target:
            upside = ((target - price) / price * 100) if price > 0 else 0
            text += f"🎯 **الهدف:** {target:.2f} ج.م ({upside:+.1f}%)\n"
        
        if stop:
            text += f"🛑 **وقف الخسارة:** {stop:.2f} ج.م\n"
        
        text += f"\n📈 **مستوى الثقة:** {confidence:.0f}%\n"
        
        if sector:
            text += f"🏢 **القطاع:** {sector}\n"
        
        # حساب نسبة المخاطرة للعائد
        if target and stop and price > 0:
            risk = price - stop
            reward = target - price
            rr = round(reward / risk, 2) if risk > 0 else 0
            # Phase 8.1: R/R < 1.0 = إشارة فاسدة - تجاهلها
            if rr < 1.0:
                return None
            text += f"⚖️ **نسبة العائد/المخاطرة:** {rr:.2f}:1\n"

        # Phase 8.1: EGX Recommendations
        _recs = rec.get('recommendations', {})
        _buyer = _recs.get('buyer', '')
        _holder = _recs.get('holder', '')
        if _buyer:
            text += f"\n📝 للمشتري: {_buyer}\n"
        if _holder:
            text += f"💼 للمالك: {_holder}\n"
        
        text += f"""
━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر"""

        return text
    
    def format_daily_summary_post(self, summary: Dict) -> str:
        """
        تنسيق ملخص يومي للنشر
        
        Args:
            summary: {
                "date": "2026-01-15",
                "total_stocks": 120,
                "gainers": 45,
                "losers": 38,
                "top_gainers": [...],
                "top_losers": [...],
                "recommendations": [...]
            }
        """
        date = summary.get('date', datetime.now().strftime('%Y-%m-%d'))
        date_ar = datetime.now().strftime('%d/%m/%Y')
        
        text = f"""🌅 **تقرير صباحي - {date_ar}**

📊 **ملخص السوق:**
"""
        
        gainers = summary.get('gainers', 0)
        losers = summary.get('losers', 0)
        total = summary.get('total_stocks', 0)
        unchanged = total - gainers - losers
        
        text += f"""• 📈 الأسهم الصاعدة: {gainers}
• 📉 الأسهم الهابطة: {losers}
• ➡️ بدون تغيير: {unchanged}
"""
        
        # أعلى الصاعدات
        top_gainers = summary.get('top_gainers', [])[:5]
        if top_gainers:
            text += "\n🔥 **أعلى الصاعدات:**\n"
            for i, stock in enumerate(top_gainers, 1):
                ticker = stock.get('ticker', '')
                change = stock.get('change_percent', 0)
                text += f"{i}. {ticker} ({change:+.2f}%)\n"
        
        # أعلى الهابطات
        top_losers = summary.get('top_losers', [])[:3]
        if top_losers:
            text += "\n❄️ **أعلى الهابطات:**\n"
            for i, stock in enumerate(top_losers, 1):
                ticker = stock.get('ticker', '')
                change = stock.get('change_percent', 0)
                text += f"{i}. {ticker} ({change:+.2f}%)\n"
        
        # التوقعات القوية
        recommendations = summary.get('recommendations', [])[:3]
        if recommendations:
            text += "\n💡 **توقعات اليوم:**\n"
            for rec in recommendations:
                ticker = rec.get('ticker', '')
                signal = rec.get('signal', '')
                signal_emoji = {'BUY': '🟢', 'SELL': '🔴'}.get(signal, '🟡')
                text += f"• {signal_emoji} {ticker} - {rec.get('name_ar', '')}\n"
        
        text += f"""
━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر #الاقتصاد_المصري"""
        
        return text
    
    def format_stock_alert(self, alert: Dict) -> str:
        """
        تنسيق تنبيه سهمي
        
        Args:
            alert: {
                "ticker": "COMI",
                "name_ar": "البنك التجاري الدولي",
                "alert_type": "breakout" | "support" | "resistance" | "signal",
                "price": 136.59,
                "message": "اختراق مقاومة"
            }
        """
        ticker = alert.get('ticker', '')
        name_ar = alert.get('name_ar', '')
        alert_type = alert.get('alert_type', '')
        price = alert.get('price', 0)
        message = alert.get('message', '')
        
        emoji_map = {
            'breakout': '🚀',
            'support': '🛡️',
            'resistance': '⚔️',
            'signal': '📊',
            'buy': '🟢',
            'sell': '🔴'
        }
        emoji = emoji_map.get(alert_type, '📢')
        
        text = f"""{emoji} **تنبيه سهمي - {ticker}**

🏦 {name_ar}
💰 السعر الحالي: {price:.2f} ج.م

📝 {message}

━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر"""
        
        return text
    
    def format_market_open(self) -> str:
        """رسالة افتتاح السوق"""
        now = datetime.now()
        date_ar = now.strftime('%A، %d %B %Y')
        
        text = f"""🔔 **السوق فتح!**

📅 {date_ar}
⏰ جلسة التداول بدأت

💡 تابعونا للحصول على:
• تحليلات السوق المباشرة
• توقعات اليوم
• تنبيهات الأسهم المهمة

━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #EGX #تداول #مصر #الاقتصاد_المصري"""
        
        return text
    
    def format_market_close(self, summary: Dict = None) -> str:
        """رسالة إغلاق السوق"""
        now = datetime.now()
        date_ar = now.strftime('%A، %d %B %Y')
        
        text = f"""🔔 **السوق أغلق!**

📅 {date_ar}
⏰ انتهت جلسة التداول

"""
        
        if summary:
            gainers = summary.get('gainers', 0)
            losers = summary.get('losers', 0)
            text += f"""📊 **ملخص الجلسة:**
• 📈 الصاعدات: {gainers}
• 📉 الهابطات: {losers}

"""
        
        text += f"""🌅 نتمنى لكم يوماً موفقاً
نراكم غداً إن شاء الله

━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #EGX #تداول #مصر #الاقتصاد_المصري"""
        
        return text


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def get_db_connection(db_path: str):
    """إنشاء اتصال بقاعدة البيانات"""
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def get_top_recommendations(limit: int = 5, min_score: int = 70) -> List[Dict]:
    """جلب أفضل التوقعات باستخدام الحقول الصحيحة للـ DB وبـ JOIN مع stocks.db"""
    try:
        # الاتصال بـ predictions.db
        conn_pred = get_db_connection(PREDICTIONS_DB)
        cur_pred = conn_pred.cursor()
        
        # استعلام جلب التوصيات BUY مع سحب التفاصيل
        cur_pred.execute("""
            SELECT ticker, recommendation, maestro_score, entry_price, target_price, 
                   stop_loss, confidence, ai_reason, created_at
            FROM stored_analyses
            WHERE (recommendation = 'buy' OR recommendation = 'strong_buy') 
              AND confidence >= ?
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?
        """, (min_score, limit))
        
        rows = cur_pred.fetchall()
        conn_pred.close()
        
        # الاتصال بـ stocks.db لجلب أسماء الأسهم والقطاع بالعربية
        from pathlib import Path
        project_root = Path(__file__).resolve().parents[2]
        stocks_db_path = str(project_root / "db" / "stocks.db")
        
        conn_stocks = sqlite3.connect(stocks_db_path)
        cur_stocks = conn_stocks.cursor()
        
        recommendations = []
        for row in rows:
            ticker = row[0]
            rec_type = row[1]
            score = row[2]
            entry = row[3]
            target = row[4]
            stop = row[5]
            confidence = row[6]
            reason = row[7] or "تحليل RAG إيجابي يدعم الاتجاه"
            created_at = row[8]
            
            # جلب الاسم والقطاع
            cur_stocks.execute("SELECT name_ar, sector FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
            stock_info = cur_stocks.fetchone()
            name_ar = stock_info[0] if stock_info else ticker
            sector = stock_info[1] if stock_info else "عام"
            
            recommendations.append({
                'ticker': ticker,
                'name_ar': name_ar,
                'signal': 'BUY', # متوافق مع الفورمات للتلجرام
                'current_price': entry,
                'target_price': target,
                'stop_loss': stop,
                'confidence': confidence,
                'sector': sector,
                'reasoning': reason,
                'created_at': created_at
            })
            
        conn_stocks.close()
        return recommendations
    except Exception as e:
        print(f"[AutoPoster] Error getting recommendations: {e}")
        import traceback
        traceback.print_exc()
        return []



def get_market_summary() -> Dict:
    """جلب ملخص السوق"""
    try:
        conn = get_db_connection(STOCKS_DB)
        cur = conn.cursor()
        
        # إحصائيات عامة
        cur.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as gainers,
                SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as losers
            FROM stocks
            WHERE market = 'EGX'
        """)
        stats = cur.fetchone()
        
        # أعلى الصاعدات
        cur.execute("""
            SELECT ticker, name_ar, change_percent, current_price
            FROM stocks
            WHERE market = 'EGX' AND change_percent > 0
            ORDER BY change_percent DESC
            LIMIT 5
        """)
        top_gainers = [dict(row) for row in cur.fetchall()]
        
        # أعلى الهابطات
        cur.execute("""
            SELECT ticker, name_ar, change_percent, current_price
            FROM stocks
            WHERE market = 'EGX' AND change_percent < 0
            ORDER BY change_percent ASC
            LIMIT 5
        """)
        top_losers = [dict(row) for row in cur.fetchall()]
        
        conn.close()
        
        return {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total_stocks': stats[0] if stats else 0,
            'gainers': stats[1] if stats else 0,
            'losers': stats[2] if stats else 0,
            'top_gainers': top_gainers,
            'top_losers': top_losers,
            'recommendations': get_top_recommendations(5)
        }
    except Exception as e:
        print(f"[AutoPoster] Error getting market summary: {e}")
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Singleton Instance
# ─────────────────────────────────────────────────────────────────────────────

auto_poster = TelegramAutoPoster()


# ─────────────────────────────────────────────────────────────────────────────
# Async Helper
# ─────────────────────────────────────────────────────────────────────────────

def run_async(coro):
    """تشغيل coroutine"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

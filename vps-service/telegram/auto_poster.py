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

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal/accumulation/money_flow classification.
try:
    from utils.canonical_signal import classify_signal, signal_ar as canonical_signal_ar
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_signal(_score):  # type: ignore[no-redef]
        return 'HOLD'
    def canonical_signal_ar(_sig):  # type: ignore[no-redef]
        return 'انتظار'

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

try:
    from telegram_branding import (
        OFFICIAL_LINKS,
        get_official_inline_buttons,
        get_telethon_buttons,
        normalize_telethon_buttons,
    )
except ImportError:
    try:
        from telegram.telegram_branding import (
            OFFICIAL_LINKS,
            get_official_inline_buttons,
            get_telethon_buttons,
            normalize_telethon_buttons,
        )
    except ImportError:
        OFFICIAL_LINKS = {
            'website': 'https://invist.m2y.net',
            'stocks_url': 'https://invist.m2y.net/#stocks',
            'radar_url': 'https://invist.m2y.net/#recommendations',
            'chart_url': 'https://invist.m2y.net/#trading-chart',
            'filters_url': 'https://invist.m2y.net/#stock-filters',
            'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
            'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
            'telegram': 'https://t.me/Arabian_investment_guide',
            'channel': 'https://t.me/Arabian_investment_guide',
            'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
            'bot': 'https://t.me/investusernamebot',
        }
        def get_official_inline_buttons(ticker=None, **kw): return []
        def get_telethon_buttons(ticker=None, **kw): return None
        def normalize_telethon_buttons(b, ticker=None): return None

# AUDIT-PUBLISH-QUALITY (Task 2026-10-08):
# COMMUNITY_PROMPT was used in 5 format methods below but NEVER defined →
# every call to format_recommendation_post / format_daily_summary_post /
# format_stock_alert / format_market_open / format_market_close raised
# NameError. Now defined as a module-level constant (mirrors official-links.ts).
COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈'

# AUDIT-PUBLISH-QUALITY: mandatory legal disclaimer for every published message
# (constitution requirement — لا نشر بدون إخلاء مسؤولية).
LEGAL_DISCLAIMER = '⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.'


def _fmt_price(value, digits: int = 2) -> str:
    """AUDIT-PUBLISH-QUALITY (Rule 27 — NO-FAKE-DATA):
    Format a price for display. Returns '—' when value is None / NaN / non-finite
    instead of fabricating '0.00' (which misled subscribers into thinking the
    entry price was literally zero).
    """
    if value is None:
        return '—'
    try:
        f = float(value)
    except (TypeError, ValueError):
        return '—'
    if f != f:  # NaN check
        return '—'
    if not (-1e12 < f < 1e12):  # guard against absurd overflow values
        return '—'
    return f"{f:.{digits}f}"

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
    
    async def send_message(self, text: str, parse_mode: str = 'md', buttons: Any = None, ticker: Optional[str] = None) -> Dict:
        """
        إرسال رسالة للقناة مع إرفاق أزرار الروابط الرسمية تلقائياً
        
        Args:
            text: نص الرسالة
            parse_mode: وضع التنسيق (md/html)
            buttons: الأزرار (لو None يتم وضع الأزرار الرسمية الشاملة تلقائياً، لو False يتم الإرسال بدون أزرار)
            ticker: رمز السهم لتخصيص الشارت والرادار إن توفر
        
        Returns:
            {"success": bool, "message_id": int, "error": str}
        """
        if not self.is_connected:
            result = await self.connect()
            if not result.get('success'):
                return result
        
        if not self.channel_entity:
            return {"success": False, "error": "Channel not configured"}
        
        # تجهيز أزرار الهوية الموحدة (الموقع + البوت + الخدمات + التواصل)
        final_buttons = normalize_telethon_buttons(buttons, ticker=ticker)

        try:
            try:
                msg = await self.client.send_message(
                    self.channel_entity,
                    text,
                    parse_mode=parse_mode,
                    link_preview=False,
                    buttons=final_buttons
                )
            except Exception as btn_err:
                # لو فشل الإرسال بالأزرار بسبب صلاحية الحساب → إعادة المحاولة بدون أزرار
                if final_buttons:
                    print(f"[AutoPoster] Retrying send_message without buttons due to: {btn_err}")
                    msg = await self.client.send_message(
                        self.channel_entity,
                        text,
                        parse_mode=parse_mode,
                        link_preview=False
                    )
                else:
                    raise btn_err

            return {
                "success": True,
                "message_id": msg.id,
                "date": msg.date.isoformat() if msg.date else None
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def send_photo(self, photo_path: str, caption: str = None, parse_mode: str = 'md', buttons: Any = None, ticker: Optional[str] = None) -> Dict:
        """
        إرسال صورة للقناة مع إرفاق أزرار الروابط الرسمية تلقائياً
        
        Args:
            photo_path: مسار الصورة
            caption: التعليق
            parse_mode: وضع التنسيق
            buttons: الأزرار (لو None يتم وضع الأزرار الرسمية الشاملة تلقائياً، لو False يتم الإرسال بدون أزرار)
            ticker: رمز السهم لتخصيص الشارت والرادار إن توفر
        """
        if not self.is_connected:
            result = await self.connect()
            if not result.get('success'):
                return result
        
        if not self.channel_entity:
            return {"success": False, "error": "Channel not configured"}
        
        # تجهيز أزرار الهوية الموحدة (الموقع + البوت + الخدمات + التواصل)
        final_buttons = normalize_telethon_buttons(buttons, ticker=ticker)

        try:
            try:
                msg = await self.client.send_message(
                    self.channel_entity,
                    file=photo_path,
                    caption=caption,
                    parse_mode=parse_mode,
                    buttons=final_buttons
                )
            except Exception as btn_err:
                # لو فشل الإرسال بالأزرار → إعادة المحاولة بدون أزرار
                if final_buttons:
                    print(f"[AutoPoster] Retrying send_photo without buttons due to: {btn_err}")
                    msg = await self.client.send_message(
                        self.channel_entity,
                        file=photo_path,
                        caption=caption,
                        parse_mode=parse_mode
                    )
                else:
                    raise btn_err

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
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
        # Use canonical signal_ar() — supports 7-level taxonomy.
        signal_ar_label = canonical_signal_ar(signal)
        signal_emoji = {
            'STRONG_BUY': '🟢', 'BUY': '🟢', 'ACCUMULATE': '🟢',
            'HOLD': '🟡', 'REDUCE': '🟠',
            'SELL': '🔴', 'STRONG_SELL': '🔴',
        }.get(signal, '⚪')
        
        # AUDIT-PUBLISH-QUALITY (Rule 27 — NO-FAKE-DATA):
        # Previously: `price = rec.get('current_price') or rec.get('price', 0)`
        # → defaulted to 0 → leaked "0.00 ج.م" in the published message when the
        # source row had no price. Now we keep `None` and render "—" instead of
        # fabricating 0.00.
        _raw_price = rec.get('current_price')
        if _raw_price is None:
            _raw_price = rec.get('price')
        try:
            price = float(_raw_price) if _raw_price is not None else None
        except (TypeError, ValueError):
            price = None
        try:
            target = float(rec.get('target_price')) if rec.get('target_price') is not None else None
        except (TypeError, ValueError):
            target = None
        try:
            stop = float(rec.get('stop_loss')) if rec.get('stop_loss') is not None else None
        except (TypeError, ValueError):
            stop = None
        try:
            confidence = float(rec.get('confidence')) if rec.get('confidence') is not None else None
        except (TypeError, ValueError):
            confidence = None
        sector = rec.get('sector', '')
        
        text = f"""📊 **تحليل سهم {ticker}**
🏦 {name_ar}

{signal_emoji} **التوقعة: {signal_ar_label}**
💰 **السعر الحالي:** {_fmt_price(price)} ج.م
"""
        
        if target is not None and price and price > 0:
            upside = ((target - price) / price * 100)
            text += f"🎯 **الهدف:** {_fmt_price(target)} ج.م ({upside:+.1f}%)\n"
        elif target is not None:
            text += f"🎯 **الهدف:** {_fmt_price(target)} ج.م\n"
        
        if stop is not None:
            text += f"🛑 **وقف الخسارة:** {_fmt_price(stop)} ج.م\n"
        
        if confidence is not None:
            text += f"\n📈 **مستوى الثقة:** {confidence:.0f}%\n"
        else:
            text += "\n📈 **مستوى الثقة:** —\n"
        
        if sector:
            text += f"🏢 **القطاع:** {sector}\n"
        
        # حساب نسبة المخاطرة للعائد
        rr: Optional[float] = None
        if target is not None and stop is not None and price and price > 0:
            risk = price - stop
            reward = target - price
            rr = round(reward / risk, 2) if risk > 0 else 0
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                rr = compute_risk_reward(price, target, stop, fallback=rr)
            except Exception:
                pass  # keep inline rr computed above
            # Phase 8.1: R/R < 1.0 = إشارة فاسدة - تجاهلها
            if rr is not None and rr < 1.0:
                return None
        if rr is not None:
            text += f"⚖️ **نسبة العائد/المخاطرة:** {rr:.2f}:1\n"

        # Phase 8.1: EGX Recommendations
        _recs = rec.get('recommendations', {})
        _buyer = _recs.get('buyer', '')
        _holder = _recs.get('holder', '')
        if _buyer:
            text += f"\n📝 للمشتري: {_buyer}\n"
        if _holder:
            text += f"💼 للمالك: {_holder}\n"
        
        # ────────────────────────────────────────────────────────────────────
        # TASK-A (2026-10-04): Technical Explanation Section
        # لو التوقعة فيها شرح فني شامل (Candlestick + SMC + Volume + Patterns)
        # اعرضه قبل الفوتر — للمستخدم يفهم سبب التوصية بشكل احترافي.
        # ────────────────────────────────────────────────────────────────────
        try:
            _tech_expl = rec.get('technical_explanation')
            # fallback: لو فيه ai_narrative بس (نص كامل بدون dict منظم)
            if not isinstance(_tech_expl, dict):
                _ai_narrative = rec.get('ai_narrative') or rec.get('technical_summary')
                if _ai_narrative:
                    _tech_expl = {
                        'compact_text': _ai_narrative,
                        'summary': rec.get('ai_reason') or rec.get('reasoning', ''),
                    }
                else:
                    _tech_expl = None

            if _tech_expl and isinstance(_tech_expl, dict):
                _compact = _tech_expl.get('compact_text') or ''
                if _compact:
                    # استخدم النص المختصر الجاهز (4 أسطر بحد أقصى)
                    _compact_lines = str(_compact).split('\n')
                    _compact_lines = [ln for ln in _compact_lines if ln.strip()][:4]
                    if _compact_lines:
                        text += "\n" + "\n".join(_compact_lines) + "\n"
                else:
                    # fallback: ابنِ الأقسام من الحقول المنفصلة
                    _summary = _tech_expl.get('summary', '') or ''
                    _candle = _tech_expl.get('candlestick', '') or ''
                    _smc = _tech_expl.get('smc', '') or ''
                    _volume = _tech_expl.get('volume', '') or ''
                    if _summary or _candle or _smc or _volume:
                        text += "\n"
                        if _summary:
                            text += f"📝 السبب: {_summary}\n"
                        if _candle:
                            text += f"🕯️ الشموع: {_candle}\n"
                        if _smc:
                            text += f"🐋 SMC: {_smc}\n"
                        if _volume:
                            text += f"📊 الحجم: {_volume}\n"
        except Exception:
            # safe-by-design: لو في خطأ في عرض الشرح الفني → نكمّل بدون القسم ده
            pass

        # ────────────────────────────────────────────────────────────────────
        # EXPERT-ANALYSIS-ENGINE (2026-10-09):
        # بنجيب التحليل الاحترافي الشامل من /api/stocks/[ticker]/expert-analysis
        # ونضيفه كقسم "تحليل خبير" في الرسالة — لو الـ API متاح.
        # ────────────────────────────────────────────────────────────────────
        try:
            expert_text = self._fetch_expert_analysis(ticker, price)
            if expert_text:
                text += f"\n━━━ 🎓 تحليل خبير ━━━\n{expert_text}\n"
        except Exception:
            pass  # safe-by-design

        text += f"""
━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📊 **رادار السيولة والتوصيات:** {OFFICIAL_LINKS['radar_url']}
📈 **شارت التحليل الفني:** {OFFICIAL_LINKS['chart_url']}
🤖 **بوت التحليل الذكي:** {OFFICIAL_LINKS['bot']}
💬 **تواصل معنا واتساب:** {OFFICIAL_LINKS['whatsapp']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
✈️ **قناة تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
{LEGAL_DISCLAIMER}
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر"""

        return text

    # ═══════════════════════════════════════════════════════════════════════════
    # EXPERT-ANALYSIS-ENGINE (2026-10-09):
    # بنجيب التحليل الاحترافي من الـ Node API ونرجّع ملخص مختصر للتليجرام.
    # ═══════════════════════════════════════════════════════════════════════════
    def _fetch_expert_analysis(self, ticker: str, price: Optional[float] = None) -> Optional[str]:
        """
        جلب تحليل خبير من /api/stocks/[ticker]/expert-analysis
        ورجاع ملخص مختصر للنشر في تليجرام.
        """
        if not ticker:
            return None
        try:
            import requests
            # Node API على localhost:3000
            url = f"http://localhost:3000/api/stocks/{ticker.upper()}/expert-analysis"
            resp = requests.get(url, timeout=5)
            if not resp.ok:
                return None
            data = resp.json()
            if not data.get('success') or not data.get('analysis'):
                return None
            a = data['analysis']
            tech = a.get('technical', {})
            fund = a.get('fundamental', {})
            risk = a.get('risk', {})

            parts = []
            # ملخص فني
            rsi = tech.get('rsi', {})
            ma = tech.get('movingAverages', {})
            if rsi.get('value') is not None:
                parts.append(f"📈 RSI: {rsi['value']:.1f} ({rsi.get('signal_ar', '—')})")
            if ma.get('trend_ar'):
                parts.append(f"📊 الترند: {ma['trend_ar']}")

            # ملخص أساسي
            roe = fund.get('roe', {})
            pe = fund.get('peRatio', {})
            div = fund.get('dividend', {})
            if roe.get('value') is not None:
                parts.append(f"🏦 ROE: {roe['value']:.1f}% ({roe.get('rating_ar', '—')})")
            if pe.get('value') is not None:
                parts.append(f"💰 P/E: {pe['value']:.1f}x ({pe.get('rating_ar', '—')})")
            if div.get('value') is not None:
                parts.append(f"💸 توزيعات: {div['value']:.2f}% ({div.get('rating_ar', '—')})")

            # مخاطر
            if risk.get('level_ar'):
                parts.append(f"⚠️ المخاطرة: {risk['level_ar']}")
            if risk.get('positionSize_ar'):
                parts.append(f"📏 المركز: {risk['positionSize_ar']}")

            if not parts:
                return None
            return '\n'.join(parts)
        except Exception:
            return None

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
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — 7-level emoji map
                signal_emoji = {
                    'STRONG_BUY': '🟢', 'BUY': '🟢', 'ACCUMULATE': '🟢',
                    'HOLD': '🟡', 'REDUCE': '🟠',
                    'SELL': '🔴', 'STRONG_SELL': '🔴',
                }.get(signal, '🟡')
                text += f"• {signal_emoji} {ticker} - {rec.get('name_ar', '')}\n"
        
        text += f"""
━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
{LEGAL_DISCLAIMER}
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
        # AUDIT-PUBLISH-QUALITY (Rule 27): don't fabricate 0.00 when price missing.
        price = alert.get('price')
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
💰 السعر الحالي: {_fmt_price(price)} ج.م

📝 {message}

━━━━━━━━━━━━━━━━━━━
🌐 **الموقع:** {OFFICIAL_LINKS['website']}
📱 **تطبيق أندرويد:** {OFFICIAL_LINKS['android']}
📘 **فيسبوك:** {OFFICIAL_LINKS['facebook']}
✈️ **تليجرام:** {OFFICIAL_LINKS['telegram']}
━━━━━━━━━━━━━━━━━━━
{LEGAL_DISCLAIMER}
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
{LEGAL_DISCLAIMER}
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
{LEGAL_DISCLAIMER}
📢 **{COMMUNITY_PROMPT}**

#البورصة_المصرية #EGX #تداول #مصر #الاقتصاد_المصري"""
        
        return text


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def get_db_connection(db_path: str):
    """إنشاء اتصال بقاعدة البيانات"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_top_recommendations(limit: int = 5, min_score: int = 70) -> List[Dict]:
    """جلب أفضل التوقعات باستخدام الحقول الصحيحة للـ DB وبـ JOIN مع stocks.db"""
    try:
        # الاتصال بـ predictions.db
        conn_pred = get_db_connection(PREDICTIONS_DB)
        cur_pred = conn_pred.cursor()
        
        # ── TASK-A (2026-10-04): تأكّد إن أعمدة AI موجودة ──
        # الأعمدة ai_reason موجودة بالفعل في الـ SELECT الأصلي، بس ai_narrative
        # ممكن تكون مش موجودة لو الـ daily_predictor ماشتغلش قبل كده.
        # ALTER TABLE آمن (idempotent — هيقع في except لو العمود موجود).
        try:
            cur_pred.execute("ALTER TABLE stored_analyses ADD COLUMN ai_narrative TEXT")
            conn_pred.commit()
        except Exception:
            pass
        
        # استعلام جلب التوصيات BUY مع سحب التفاصيل + الشرح الفني
        # PURGE-FIX (2026-10-22): filter out deactivated/corrupted tickers
        # الـ auto_poster كان بيـ publish توصيات لأسهم مشوهة (UBEEU, TWSATA, إلخ)
        # لأن stored_analyses مش بتربط بـ stocks.is_active.
        # الحل: نـ fetch كل التوصيات + نـ filter في Python بـ active tickers من stocks.db.
        cur_pred.execute("""
            SELECT ticker, recommendation, maestro_score, entry_price, target_price,
                   stop_loss, confidence, ai_reason, ai_narrative, analysis_json, created_at
            FROM stored_analyses
            WHERE (recommendation = 'buy' OR recommendation = 'strong_buy')
              AND confidence >= ?
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?
        """, (min_score, limit))

        rows = cur_pred.fetchall()
        conn_pred.close()

        # PURGE-FIX: load active tickers from stocks.db + filter rows
        try:
            from pathlib import Path as _P
            _stocks_db = str(_P(__file__).resolve().parents[2] / 'db' / 'stocks.db')
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            _conn_s = db_manager.get_connection(_stocks_db, writable=False)
            _cur_s = _conn_s.cursor()
            _cur_s.execute("SELECT ticker FROM stocks WHERE is_active = 1 OR is_active IS NULL")
            _active_tickers = {r[0] for r in _cur_s.fetchall()}
            _conn_s.close()
        except Exception:
            _active_tickers = None  # لو فشل، ما نفلترش (backward compat)

        if _active_tickers is not None:
            _before = len(rows)
            rows = [r for r in rows if r[0] in _active_tickers]
            _skipped = _before - len(rows)
            if _skipped > 0:
                print(f"[auto_poster] PURGE-FIX: skipped {_skipped} deactivated ticker(s)", flush=True)
        # الاتصال بـ stocks.db لجلب أسماء الأسهم والقطاع بالعربية
        from pathlib import Path
        project_root = Path(__file__).resolve().parents[2]
        stocks_db_path = str(project_root / "db" / "stocks.db")
        
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn_stocks = db_manager.get_connection(stocks_db_path, writable=False)
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
            # ── TASK-A (2026-10-04): استخراج الشرح الفني من ai_narrative + analysis_json ──
            ai_narrative = row[8] if len(row) > 8 else None
            analysis_json_str = row[9] if len(row) > 9 else None
            created_at = row[10] if len(row) > 10 else (row[8] if len(row) > 8 else None)
            
            # parse analysis_json لاستخراج technical_explanation (الـ dict المنظم)
            technical_explanation = None
            if analysis_json_str:
                try:
                    import json as _aj_json
                    _aj = _aj_json.loads(analysis_json_str)
                    _tech_in_json = _aj.get('technical_explanation') if isinstance(_aj, dict) else None
                    if isinstance(_tech_in_json, dict):
                        technical_explanation = _tech_in_json
                except Exception:
                    pass
            
            # جلب الاسم والقطاع
            cur_stocks.execute("SELECT name_ar, sector FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
            stock_info = cur_stocks.fetchone()
            name_ar = stock_info[0] if stock_info else ticker
            sector = stock_info[1] if stock_info else "عام"
            
            recommendations.append({
                'ticker': ticker,
                'name_ar': name_ar,
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67 + Rule 27 NO-FAKE-DATA)
                # Was hardcoded 'BUY' — now computed from master_score via canonical classifier.
                'signal': classify_signal(score) if score is not None else 'HOLD',
                'current_price': entry,
                'target_price': target,
                'stop_loss': stop,
                'confidence': confidence,
                'sector': sector,
                'reasoning': reason,
                # ── TASK-A: الشرح الفني الكامل (compact + full_text) للـ Telegram ──
                'technical_explanation': technical_explanation,
                'ai_narrative': ai_narrative,
                'ai_reason': reason,
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

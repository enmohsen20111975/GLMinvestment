#!/usr/bin/env python3
from __future__ import annotations
"""
Telegram Client Module (CANONICAL — Telethon, user account, bi-directional)
============================================================================
التعامل مع Telegram API باستخدام Telethon

CANONICAL ROLE (UNIFY-RISK-TELEGRAM, Rule 54):
- This file is the canonical Telegram CLIENT (Telethon, user-account session).
- Exposes `TelegramService` class + module-level singleton `telegram_service`.
- Used for BI-DIRECTIONAL communication: receiving messages from channels,
  processing/extracting symbols via AI, optionally replying/forwarding.
- Imported by:
  * vps-service/api/telegram_routes.py        (read client state, fetch dialogs)
  * vps-service/ai/telegram_signal_importer.py (TelegramClientManager re-export)
  * vps-service/telegram/__init__.py          (re-exported as telegram.telegram_service)

NOT TO BE CONFUSED WITH:
- telegram/telegram_notifier.py  → HTTP Bot API, OUTBOUND notifications only
                                    (target-hit alerts, daily/weekly reports).
                                    See Rule 54 below.

Rule 54 (PICK ONE) — Clarification:
- Both this file (Telethon) and telegram_notifier.py (HTTP Bot API) ARE used in
  production. They serve genuinely different protocols/purposes:
    * telegram_client.py    = user account (Telethon)   → RECEIVE + SEND (heavyweight, async)
    * telegram_notifier.py  = bot account  (HTTP API)    → SEND ONLY       (lightweight, sync)
- Do NOT consolidate. When adding new OUTBOUND-only notification code,
  use `telegram_notifier.py` (lighter). When you need to RECEIVE messages
  from channels or act as a user, use this file.
"""

import os
import sys
import json
import asyncio
import time
from collections import deque
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from pathlib import Path

try:
    from telethon import TelegramClient, events
    from telethon.errors import SessionPasswordNeededError, FloodWaitError
    from telethon.tl.types import (
        Channel, Chat, User,
        MessageMediaPhoto, MessageMediaWebPage, MessageMediaDocument,
        MessageMediaContact, MessageMediaGeo,
        DocumentAttributeVideo, DocumentAttributeAudio,
        ChannelParticipantAdmin, ChannelParticipantCreator, ChannelParticipantBanned,
        InputUser, InputChannel, InputPeerChannel, InputPeerUser,
        ChatBannedRights,
    )
    from telethon.tl.functions.messages import (
        GetDialogsRequest, GetMessagesRequest, AddChatUserRequest,
    )
    from telethon.tl.functions.channels import InviteToChannelRequest, EditBannedRequest
    TELETHON_AVAILABLE = True
except ImportError:
    print("Warning: Telethon not installed. Telegram features disabled.")
    TELETHON_AVAILABLE = False

from .ai_processor import ai_processor
from .database import db_manager

# Configuration
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(SERVICE_DIR, 'credentials.json')

# Use unique session per machine (based on hostname)
# This prevents "session used under two different IP" errors
import socket
MACHINE_ID = socket.gethostname().replace('.', '_').replace('-', '_')
SESSION_PATH = os.path.join(SERVICE_DIR, f'telegram_session_{MACHINE_ID}')

# Fallback to old session if machine-specific doesn't exist
if not os.path.exists(SESSION_PATH + '.session'):
    old_session = os.path.join(SERVICE_DIR, 'telegram_session_user')
    if os.path.exists(old_session + '.session'):
        SESSION_PATH = old_session
IMAGES_DIR = os.path.join(SERVICE_DIR, 'downloaded_images')


class TelegramService:
    """خدمة Telegram"""

    def __init__(self):
        self.client: Optional[TelegramClient] = None
        self.is_connected = False
        self.bot_client = None  # للـ Bot API
        self._ensure_images_dir()
        # Real-time event queue (in-memory, last 500 events)
        self._event_queue = deque(maxlen=500)
        self._event_listener_started = False

    def _ensure_images_dir(self):
        """إنشاء مجلد الصور"""
        Path(IMAGES_DIR).mkdir(parents=True, exist_ok=True)

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
            print(f"Error loading credentials.json: {e}")

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

        return creds

    async def connect(self) -> Dict:
        """الاتصال بـ Telegram - يدعم Bot Token أو User Auth"""
        if self.client and self.is_connected:
            # Even if already connected, make sure event listeners are running
            try:
                asyncio.ensure_future(self._start_event_listeners())
            except Exception:
                pass
            return {"success": True, "message": "Already connected"}

        creds = self._load_credentials()
        if not creds.get('api_id') or not creds.get('api_hash'):
            return {"error": "Credentials not configured"}

        try:
            # محاولة الاتصال بـ Bot Token أولاً
            bot_token = creds.get('bot_token')
            if bot_token:
                self.client = TelegramClient(
                    SESSION_PATH + '_bot',
                    creds['api_id'],
                    creds['api_hash']
                )
                await self.client.connect()
                # الاتصال كـ Bot
                await self.client.sign_in(bot_token=bot_token)
                self.is_connected = True
                # Start real-time event listeners (fire-and-forget)
                try:
                    asyncio.ensure_future(self._start_event_listeners())
                except Exception as e:
                    print(f"Event listener start error: {e}")
                return {"success": True, "message": "Connected as Bot", "mode": "bot"}
            
            # الاتصال كمستخدم عادي
            self.client = TelegramClient(
                SESSION_PATH,
                creds['api_id'],
                creds['api_hash']
            )
            await self.client.connect()
            self.is_connected = True
            # Start real-time event listeners (fire-and-forget)
            try:
                asyncio.ensure_future(self._start_event_listeners())
            except Exception as e:
                print(f"Event listener start error: {e}")
            return {"success": True, "message": "Connected successfully", "mode": "user"}
        except Exception as e:
            return {"error": str(e)}

    async def disconnect(self):
        """قطع الاتصال"""
        if self.client:
            await self.client.disconnect()
            self.is_connected = False

    async def connect_as_user(self, phone: str = None) -> Dict:
        """الاتصال كمستخدم (وليس Bot) - يتيح قراءة الرسائل"""
        creds = self._load_credentials()
        
        if not creds.get('api_id') or not creds.get('api_hash'):
            return {"error": "Credentials not configured"}
        
        phone = phone or creds.get('phone')
        if not phone:
            return {"error": "Phone number required for user authentication", "needs_phone": True}
        
        try:
            # إنشاء اتصال جديد كمستخدم
            # Use machine-specific session to avoid conflicts
            self.client = TelegramClient(
                SESSION_PATH,
                creds['api_id'],
                creds['api_hash']
            )
            await self.client.connect()
            
            if await self.client.is_user_authorized():
                self.is_connected = True
                # Start real-time event listeners (fire-and-forget)
                try:
                    asyncio.ensure_future(self._start_event_listeners())
                except Exception as e:
                    print(f"Event listener start error: {e}")
                return {"success": True, "message": "Connected as User", "mode": "user", "authorized": True}
            else:
                # إرسال رمز التحقق
                await self.client.send_code_request(phone)
                self.is_connected = True
                # Start listeners even during pending auth — handlers will fire once authorized
                try:
                    asyncio.ensure_future(self._start_event_listeners())
                except Exception as e:
                    print(f"Event listener start error: {e}")
                return {"success": True, "message": "Code sent to phone", "mode": "user", "authorized": False, "needs_code": True}
                
        except Exception as e:
            return {"error": str(e)}

    async def is_authorized(self) -> bool:
        """التحقق من التفويض"""
        if not self.client:
            return False
        return await self.client.is_user_authorized()

    async def send_code(self, phone: str) -> Dict:
        """إرسال رمز التحقق"""
        try:
            result = await self.connect()
            if result.get('error'):
                return result

            if await self.is_authorized():
                return {"success": True, "already_authorized": True}

            await self.client.send_code_request(phone)
            return {"success": True, "message": "Code sent"}
        except Exception as e:
            return {"error": str(e)}

    async def verify_code(self, phone: str, code: str) -> Dict:
        """التحقق من الرمز"""
        try:
            await self.client.sign_in(phone, code)
            return {"success": True}
        except SessionPasswordNeededError:
            return {"success": True, "needs_password": True}
        except Exception as e:
            return {"error": str(e)}

    async def verify_password(self, password: str) -> Dict:
        """التحقق من كلمة المرور 2FA"""
        try:
            await self.client.sign_in(password=password)
            return {"success": True}
        except Exception as e:
            return {"error": str(e)}

    async def get_channels(self, filter_market: str = None) -> List[Dict]:
        """
        الحصول على القنوات
        filter_market: egypt, saudi, kuwait, qatar, crypto, or None for all
        
        ملاحظة: الـ Bots لا يمكنها استخدام iter_dialogs()
        سنستخدم القنوات المُعدة مسبقاً من credentials.json
        """
        if not self.client or not self.is_connected:
            await self.connect()

        channels = []
        
        # قراءة القنوات المُعدة من credentials
        creds = self._load_credentials()
        
        # القنوات المُعدة
        configured_channels = []
        if creds.get('channel_id'):
            configured_channels.append({
                'id': creds['channel_id'],
                'name': 'Arabian Investment Guide',
                'type': 'channel'
            })
        if creds.get('group'):
            configured_channels.append({
                'id': creds['group'],
                'name': creds['group'],
                'type': 'group'
            })

        # إضافة قنوات افتراضية للأسواق
        default_channels = [
            {'id': '@Arabian_investment_guide', 'name': 'Arabian Investment Guide', 'market': 'general'},
        ]

        try:
            for ch in default_channels:
                try:
                    entity = await self.client.get_entity(ch['id'])
                    channels.append({
                        'channel_id': str(entity.id),
                        'channel_name': getattr(entity, 'title', ch['name']),
                        'username': getattr(entity, 'username', None),
                        'type': 'channel',
                        'market': ch.get('market', 'unknown'),
                        'content_type': 'general',
                        'members': getattr(entity, 'participants_count', 0)
                    })
                except Exception as e:
                    print(f"Could not access channel {ch['id']}: {e}")
                    
        except Exception as e:
            print(f"Error getting channels: {e}")

        return channels

    async def get_my_channels(self) -> List[Dict]:
        """
        الحصول على كل القنوات والمجموعات التي أنت مشترك فيها
        يتطلب اتصال كمستخدم (ليس Bot)
        """
        if not self.client or not self.is_connected:
            await self.connect()

        if not await self.is_authorized():
            return []

        channels = []
        try:
            # استخدام iter_dialogs لجلب كل المحادثات
            async for dialog in self.client.iter_dialogs():
                entity = dialog.entity
                
                # فقط القنوات والمجموعات الكبيرة (Supergroups)
                if isinstance(entity, Channel):
                    # تخطي القنوات الخاصة المحمية
                    if getattr(entity, 'restricted', False):
                        continue
                        
                    channel_info = {
                        'channel_id': str(entity.id),
                        'channel_name': getattr(entity, 'title', 'Unknown'),
                        'username': getattr(entity, 'username', None),
                        'type': 'supergroup' if entity.megagroup else 'channel',
                        'members': getattr(entity, 'participants_count', 0),
                        'market': self._detect_market(getattr(entity, 'title', '')),
                        'content_type': self._detect_content_type(getattr(entity, 'title', '')),
                    }
                    channels.append(channel_info)
                    
                elif isinstance(entity, Chat):
                    # المجموعات العادية (الصغيرة)
                    channel_info = {
                        'channel_id': str(entity.id),
                        'channel_name': getattr(entity, 'title', 'Unknown'),
                        'username': None,
                        'type': 'group',
                        'members': getattr(entity, 'participants_count', 0),
                        'market': 'general',
                        'content_type': 'general',
                    }
                    channels.append(channel_info)

            # ترتيب حسب عدد الأعضاء
            channels.sort(key=lambda x: x.get('members', 0), reverse=True)
            
        except Exception as e:
            print(f"Error getting my channels: {e}")
            
        return channels

    async def get_configured_channels(self) -> List[Dict]:
        """الحصول على القنوات المُعدة من ملف credentials"""
        creds = self._load_credentials()
        channels = []
        
        if creds.get('channel_id'):
            channels.append({
                'channel_id': creds['channel_id'],
                'channel_name': 'Arabian Investment Guide',
                'market': 'general',
                'content_type': 'recommendations'
            })
            
        return channels

    def _detect_market(self, title: str) -> str:
        """تحديد السوق من العنوان"""
        title_lower = title.lower()

        # العملات الرقمية أولاً
        if any(x in title_lower for x in ['كريبتو', 'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'عملة رقمية', 'عملات رقمية']):
            return 'crypto'

        # الأسواق العربية
        if any(x in title_lower for x in ['سعودي', 'السعودية', 'tadawul', 'saudi', 'تداول السعودية']):
            return 'saudi'
        if any(x in title_lower for x in ['مصر', 'مصري', 'egx', 'egyp', 'البورصة المصرية', 'egycap']):
            return 'egypt'
        if any(x in title_lower for x in ['كويت', 'الكويت', 'kse', 'kuwait', 'بورصة الكويت']):
            return 'kuwait'
        if any(x in title_lower for x in ['قطر', 'قطري', 'qse', 'qatar', 'بورصة قطر']):
            return 'qatar'

        return 'unknown'

    def _detect_content_type(self, title: str) -> str:
        """تحديد نوع المحتوى"""
        title_lower = title.lower()

        if any(x in title_lower for x in ['توقعة', 'توقعات', 'recommendation', 'signals', 'إشارات']):
            return 'recommendations'
        if any(x in title_lower for x in ['أخبار', 'news', 'اقتصاد', 'economic']):
            return 'news'
        if any(x in title_lower for x in ['تحليل', 'analysis', 'تعليم', 'education']):
            return 'analysis'
        if any(x in title_lower for x in ['نقاش', 'discussion', 'أسئلة', 'questions']):
            return 'discussion'

        return 'general'

    async def scrape_channel(self, channel_id: str, days: int = 7, limit: int = 100) -> Dict:
        """
        سحب الرسائل من قناة
        """
        if not self.client or not self.is_connected:
            await self.connect()

        if not await self.is_authorized():
            return {"error": "Not authorized"}

        stats = {
            'messages': 0,
            'recommendations': 0,
            'news': 0,
            'images': 0,
            'errors': []
        }

        try:
            # تحديث حالة السحب
            db_manager.update_scraping_status(channel_id, 'running')

            # الحصول على الكيان - try multiple methods
            entity = None
            channel_name = str(channel_id)

            # Method 1: Try as integer (channel ID)
            try:
                entity = await self.client.get_entity(int(channel_id))
                channel_name = getattr(entity, 'title', str(channel_id))
            except Exception:
                pass

            # Method 2: Try as InputPeerChannel (if int and negative or starts with -100)
            if entity is None:
                try:
                    # Try with -100 prefix (Telegram channel ID format)
                    if not channel_id.startswith('-'):
                        ch_id = int(channel_id)
                        # Try as channel with -100 prefix
                        try:
                            entity = await self.client.get_entity(f'-100{ch_id}')
                            channel_name = getattr(entity, 'title', str(channel_id))
                        except:
                            pass
                except:
                    pass

            # Method 3: Try as username/link
            if entity is None:
                try:
                    # Remove @ if present
                    clean_id = channel_id.lstrip('@')
                    entity = await self.client.get_entity(clean_id)
                    channel_name = getattr(entity, 'title', clean_id)
                except:
                    pass

            # Method 4: Try get_input_entity
            if entity is None:
                try:
                    from telethon.tl.types import InputPeerChannel, InputPeerUser
                    ch_id = int(channel_id)
                    # Try as channel peer
                    try:
                        entity = InputPeerChannel(channel_id=ch_id, access_hash=0)
                        # This might not work without access_hash, but try
                        entity = await self.client.get_input_entity(f'-100{ch_id}')
                        channel_name = str(channel_id)
                    except:
                        pass
                except:
                    pass

            if entity is None:
                return {
                    "success": False,
                    "error": f"Could not find entity for channel_id: {channel_id}. Make sure you're subscribed to this channel.",
                    "messages": []
                }

            # تحديد التاريخ
            date_limit = datetime.now() - timedelta(days=days)

            # سحب الرسائل
            messages = await self.client.get_messages(
                entity,
                limit=limit,
                offset_date=date_limit
            )

            for msg in messages:
                if not msg.text and not msg.media:
                    continue

                # تحضير بيانات الرسالة
                msg_data = {
                    'message_id': msg.id,
                    'channel_id': channel_id,
                    'channel_name': channel_name,
                    'text': msg.text or '',
                    'date': msg.date.isoformat() if msg.date else None,
                    'views': msg.views or 0,
                    'forwards': msg.forwards or 0,
                    'has_images': 0,
                    'image_paths': [],
                    'image_urls': [],
                    'is_reply': False,
                    'reply_to_message_id': None,
                    'reply_to_text': None,
                }

                # معالجة رسائل الـ reply (الرد على بوست قديم)
                reply_to_id = getattr(msg, 'reply_to_msg_id', None) or getattr(msg.reply_to, 'reply_to_msg_id', None) if msg.reply_to else None
                if reply_to_id:
                    msg_data['is_reply'] = True
                    msg_data['reply_to_message_id'] = reply_to_id
                    # محاولة جلب نص البوست الأصلي
                    try:
                        reply_msg = await self.client.get_messages(entity, ids=reply_to_id)
                        if reply_msg and len(reply_msg) > 0:
                            reply_text = reply_msg[0].text or ''
                            if reply_text:
                                # نضيف البوست الأصلي كـ context
                                msg_data['reply_to_text'] = reply_text[:500]  # أول 500 حرف
                                # نضيفه لنص الرسالة لو النص الأصلي قصير
                                if not msg_data['text'] or len(msg_data['text']) < 50:
                                    msg_data['text'] = f"[رد على بوست]: {reply_text[:200]}\n\n---\n{msg_data['text']}"
                    except Exception as e:
                        stats['errors'].append(f"Reply fetch error: {str(e)}")

                # معالجة الـ forwarded messages
                if msg.fwd_from:
                    try:
                        fwd_info = ''
                        from_id = msg.fwd_from.from_id
                        if from_id:
                            if hasattr(from_id, 'channel_id') and from_id.channel_id:
                                fwd_info = f"[منبوست محوّل من قناة {from_id.channel_id}]"
                            elif hasattr(from_id, 'user_id') and from_id.user_id:
                                fwd_info = f"[منبوست محوّل من مستخدم {from_id.user_id}]"
                        if fwd_info and not msg_data['text'].startswith('[منبوست'):
                            msg_data['text'] = f"{fwd_info}\n\n{msg_data['text']}"
                    except Exception:
                        pass

                # تحميل الصور إن وجدت (MessageMediaPhoto)
                if msg.media and isinstance(msg.media, MessageMediaPhoto):
                    try:
                        image_path = await self._download_image(msg, channel_id)
                        if image_path:
                            msg_data['has_images'] = 1
                            msg_data['image_paths'] = [image_path]
                            # تحويل المسار لـ URL قابل للوصول من Frontend
                            msg_data['image_urls'] = [self._path_to_url(image_path)]
                            stats['images'] += 1
                    except Exception as e:
                        stats['errors'].append(f"Image download error: {str(e)}")

                # معالجة الـ MessageMediaWebPage (لينكات فيها صور)
                elif msg.media and isinstance(msg.media, MessageMediaWebPage):
                    try:
                        webpage = msg.media.webpage
                        if hasattr(webpage, 'photo') and webpage.photo:
                            # نحاول نحمّل صورة الـ webpage
                            image_path = await self._download_webpage_image(webpage, channel_id, msg.id)
                            if image_path:
                                msg_data['has_images'] = 1
                                msg_data['image_paths'] = [image_path]
                                msg_data['image_urls'] = [self._path_to_url(image_path)]
                                stats['images'] += 1
                    except Exception as e:
                        stats['errors'].append(f"Webpage image error: {str(e)}")

                # معالجة الرسالة بالـ AI - مع حماية من None
                try:
                    processed = ai_processor.process_message(msg_data)
                    if processed is None:
                        processed = {'type': 'general', 'confidence': 0, 'recommendation': None}
                    
                    msg_data['message_type'] = processed.get('type', 'general')
                    msg_data['confidence'] = processed.get('confidence', 0)
                    
                    rec = processed.get('recommendation')
                    if rec and isinstance(rec, dict):
                        msg_data['processed_text'] = rec.get('reasoning', '')
                    else:
                        msg_data['processed_text'] = ''
                except Exception as e:
                    msg_data['message_type'] = 'general'
                    msg_data['confidence'] = 0
                    msg_data['processed_text'] = ''
                    stats['errors'].append(f"AI processing error: {str(e)}")

                # حفظ الرسالة
                db_manager.save_message(msg_data)
                stats['messages'] += 1

                # حفظ التوقعات
                if msg_data['message_type'] == 'recommendation' and processed.get('recommendation'):
                    rec = processed['recommendation']
                    rec['message_id'] = msg.id
                    rec['channel_id'] = channel_id
                    rec['channel_name'] = channel_name
                    rec['market'] = processed['symbols'][0]['market'] if processed['symbols'] else 'unknown'
                    db_manager.save_recommendation(rec)
                    stats['recommendations'] += 1

                # حفظ الأخبار
                elif processed['type'] == 'news' and processed.get('news'):
                    news = processed['news']
                    news['message_id'] = msg.id
                    news['channel_id'] = channel_id
                    news['channel_name'] = channel_name
                    news['market'] = processed['symbols'][0]['market'] if processed['symbols'] else 'general'
                    db_manager.save_news(news)
                    stats['news'] += 1

            # تحديث حالة السحب
            db_manager.update_scraping_status(channel_id, 'completed', stats)

            # Build messages list for the frontend from what we collected
            result_messages = []
            try:
                # Try to get messages from database
                with db_manager.get_connection() as conn:
                    cursor = conn.cursor()
                    # محاولة جلب كل البيانات بما فيها الصور والردود
                    try:
                        cursor.execute('''
                            SELECT message_id, text, date, views, forwards, channel_name,
                                   has_images, image_paths, image_urls, is_reply, reply_to_message_id, reply_to_text
                            FROM telegram_messages
                            WHERE channel_id = ?
                            ORDER BY date DESC
                            LIMIT ?
                        ''', (channel_id, limit))
                        for row in cursor.fetchall():
                            msg_dict = {
                                'message_id': row[0],
                                'text': row[1] or '',
                                'date': row[2] or '',
                                'views': row[3] or 0,
                                'channel_name': row[5] or channel_name,
                                'has_images': row[6] if len(row) > 6 else 0,
                                'image_paths': row[7] if len(row) > 7 and row[7] else [],
                                'image_urls': row[8] if len(row) > 8 and row[8] else [],
                                'is_reply': row[9] if len(row) > 9 else False,
                                'reply_to_message_id': row[10] if len(row) > 10 else None,
                                'reply_to_text': row[11] if len(row) > 11 else None,
                            }
                            # تحويل image_paths و image_urls من JSON string لو محتاج
                            for field in ['image_paths', 'image_urls']:
                                if isinstance(msg_dict[field], str):
                                    try:
                                        msg_dict[field] = json.loads(msg_dict[field])
                                    except:
                                        msg_dict[field] = []
                            result_messages.append(msg_dict)
                    except Exception:
                        # fallback لو الأعمدة الجديدة مش موجودة
                        cursor.execute('''
                            SELECT message_id, text, date, views, forwards, channel_name
                            FROM telegram_messages
                            WHERE channel_id = ?
                            ORDER BY date DESC
                            LIMIT ?
                        ''', (channel_id, limit))
                        for row in cursor.fetchall():
                            result_messages.append({
                                'message_id': row[0],
                                'text': row[1] or '',
                                'date': row[2] or '',
                                'views': row[3] or 0,
                                'channel_name': row[5] or channel_name,
                                'has_images': 0,
                                'image_urls': [],
                                'is_reply': False,
                            })
            except Exception:
                pass

            return {
                "success": True,
                "channel_id": channel_id,
                "channel_name": channel_name,
                "messages": result_messages,
                "stats": stats
            }

        except Exception as e:
            db_manager.update_scraping_status(channel_id, 'error', {'error': str(e)})
            return {"error": str(e)}

    async def _download_image(self, message, channel_id: str) -> Optional[str]:
        """تحميل صورة من الرسالة"""
        try:
            filename = f"{channel_id}_{message.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            filepath = os.path.join(IMAGES_DIR, filename)
            await self.client.download_media(message, filepath)
            return filepath
        except Exception as e:
            print(f"Error downloading image: {e}")
            return None

    async def _download_webpage_image(self, webpage, channel_id: str, msg_id: int) -> Optional[str]:
        """تحميل صورة من MessageMediaWebPage (لينكات فيها صور)"""
        try:
            filename = f"webpage_{channel_id}_{msg_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            filepath = os.path.join(IMAGES_DIR, filename)
            # نحاول نحمّل الصورة من الـ webpage.photo
            await self.client.download_media(webpage.photo, filepath)
            return filepath
        except Exception as e:
            print(f"Error downloading webpage image: {e}")
            return None

    def _path_to_url(self, filepath: str) -> str:
        """
        تحويل مسار الملف المحلي لـ URL قابل للوصول من Frontend.
        الصور محفوظة في: vps-service/telegram/downloaded_images/
        يتم تقديمها عبر: /api/telegram/images/<filename>?XTransformPort=8010
        """
        try:
            filename = os.path.basename(filepath)
            return f"/api/telegram/images/{filename}"
        except Exception:
            return ''

    async def scrape_all_tracked(self, days: int = 7, limit: int = 100) -> Dict:
        """سحب من كل القنوات المتابعة"""
        channels = db_manager.get_tracked_channels(active_only=True)

        if not channels:
            return {"error": "No channels tracked"}

        results = []
        for channel in channels:
            result = await self.scrape_channel(channel['channel_id'], days, limit)
            results.append(result)

        return {
            "success": True,
            "total_channels": len(channels),
            "results": results
        }

    # ==================== Entity Resolution Helpers ====================

    async def _resolve_input_entity(self, peer_id: int):
        """
        Resolve an int ID to a Telethon InputPeer/InputUser/InputChannel.
        Tries multiple strategies: direct get_input_entity, -100 prefix for channels.
        Raises RuntimeError if all strategies fail.
        """
        if not self.client:
            raise RuntimeError("Telegram client not initialized")

        # Strategy 1: direct resolution (works if entity is in session cache)
        try:
            return await self.client.get_input_entity(peer_id)
        except Exception:
            pass

        # Strategy 2: for positive channel IDs, try with -100 prefix
        if peer_id > 0:
            try:
                return await self.client.get_input_entity(int(f"-100{peer_id}"))
            except Exception:
                pass

        # Strategy 3: try full entity fetch and let Telethon convert
        try:
            entity = await self.client.get_entity(peer_id)
            return await self.client.get_input_entity(entity)
        except Exception:
            pass

        raise RuntimeError(
            f"Could not resolve entity for ID {peer_id}. "
            "It may not be in your session cache — interact with the chat first (e.g. open it in Telegram), then retry."
        )

    # ==================== Real-time Events (in-memory queue) ====================

    def _push_event(self, event_type: str, data: dict):
        """Push an event to the in-memory queue."""
        try:
            self._event_queue.append({
                'type': event_type,
                'data': data,
                'timestamp': int(time.time()),
            })
        except Exception as e:
            print(f"_push_event error: {e}")

    def poll_events(self, since: int = 0) -> list:
        """Return all events since the given unix timestamp."""
        try:
            return [e for e in list(self._event_queue) if e.get('timestamp', 0) > since]
        except Exception:
            return []

    async def _start_event_listeners(self):
        """Register Telethon event handlers for new messages, edits, deletes.
        Idempotent — safe to call multiple times."""
        if not TELETHON_AVAILABLE:
            return
        if self._event_listener_started or not self.client:
            return
        self._event_listener_started = True

        try:
            @self.client.on(events.NewMessage())
            async def on_new_message(event):
                try:
                    self._push_event('new_message', {
                        'chat_id': event.chat_id,
                        'message_id': event.message.id,
                        'text': event.message.text or '',
                        'from_id': event.message.sender_id,
                        'is_outgoing': event.message.out,
                    })
                except Exception as e:
                    print(f"Event listener (new_message) error: {e}")

            @self.client.on(events.MessageEdited())
            async def on_message_edited(event):
                try:
                    self._push_event('message_edited', {
                        'chat_id': event.chat_id,
                        'message_id': event.message.id,
                        'text': event.message.text or '',
                    })
                except Exception as e:
                    print(f"Edit event error: {e}")

            @self.client.on(events.MessageDeleted())
            async def on_message_deleted(event):
                try:
                    self._push_event('message_deleted', {
                        'chat_id': event.chat_id,
                        'deleted_ids': list(event.deleted_ids or []),
                    })
                except Exception as e:
                    print(f"Delete event error: {e}")

            print("[Telegram] Real-time event listeners registered (new_message, message_edited, message_deleted)")
        except Exception as e:
            print(f"Failed to register event listeners: {e}")
            self._event_listener_started = False

    # ==================== Dialogs & Chat History ====================

    async def get_dialogs(self, limit: int = 100) -> List[Dict]:
        """Get all dialogs (chats/groups/channels) with unread count + last message."""
        if not self.client or not self.is_connected:
            raise RuntimeError("Not authenticated. Please login first.")

        dialogs: List[Dict] = []
        try:
            async for dialog in self.client.iter_dialogs(limit=limit):
                entity = dialog.entity
                # Determine type
                if isinstance(entity, User):
                    d_type = 'user'
                elif isinstance(entity, Channel):
                    d_type = 'group' if getattr(entity, 'megagroup', False) else 'channel'
                elif isinstance(entity, Chat):
                    d_type = 'group'
                else:
                    d_type = 'unknown'

                # Last message info
                last_msg = dialog.message
                last_msg_text = ''
                last_msg_id = None
                last_msg_at = None
                if last_msg is not None:
                    last_msg_text = (last_msg.text or '')[:200]
                    last_msg_id = last_msg.id
                    last_msg_at = last_msg.date.isoformat() if last_msg.date else None

                # Photo presence flag (don't download — too expensive for a list call)
                has_photo = False
                try:
                    if getattr(entity, 'photo', None) is not None:
                        has_photo = True
                except Exception:
                    pass

                dialogs.append({
                    'id': dialog.id,
                    'title': dialog.title or dialog.name or 'Unknown',
                    'type': d_type,
                    'unread_count': dialog.unread_count or 0,
                    'last_message_id': last_msg_id,
                    'last_message_text': last_msg_text,
                    'last_message_at': last_msg_at,
                    'username': getattr(entity, 'username', None),
                    'photo': has_photo,
                })
        except FloodWaitError as e:
            raise RuntimeError(f"FloodWait: must wait {e.seconds} seconds before retrying.") from e
        except Exception as e:
            raise RuntimeError(f"Failed to fetch dialogs: {e}") from e

        return dialogs

    async def get_chat_history(self, chat_id: int, limit: int = 50, offset_id: int = 0) -> List[Dict]:
        """Get paginated message history for a chat."""
        if not self.client or not self.is_connected:
            raise RuntimeError("Not authenticated. Please login first.")

        try:
            entity = await self._resolve_input_entity(chat_id)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Could not resolve chat {chat_id}: {e}") from e

        messages: List[Dict] = []
        try:
            async for msg in self.client.iter_messages(entity, limit=limit, offset_id=offset_id):
                # Determine media type
                media_type = None
                if msg.media is not None:
                    if isinstance(msg.media, MessageMediaPhoto):
                        media_type = 'photo'
                    elif isinstance(msg.media, MessageMediaDocument):
                        doc = msg.media.document
                        if doc is not None:
                            attrs = doc.attributes or []
                            if any(isinstance(a, DocumentAttributeVideo) for a in attrs):
                                media_type = 'video'
                            elif any(isinstance(a, DocumentAttributeAudio) for a in attrs):
                                media_type = 'audio'
                            else:
                                media_type = 'document'
                        else:
                            media_type = 'document'
                    elif isinstance(msg.media, MessageMediaWebPage):
                        media_type = 'webpage'
                    elif isinstance(msg.media, MessageMediaContact):
                        media_type = 'contact'
                    elif isinstance(msg.media, MessageMediaGeo):
                        media_type = 'geo'
                    else:
                        media_type = 'other'

                # from_id
                from_id = msg.sender_id

                # reply_to_msg_id
                reply_to_msg_id = None
                try:
                    reply_to_msg_id = msg.reply_to_msg_id
                except Exception:
                    pass

                messages.append({
                    'id': msg.id,
                    'text': msg.text or '',
                    'date': msg.date.isoformat() if msg.date else None,
                    'from_id': from_id,
                    'is_outgoing': bool(msg.out),
                    'media_type': media_type,
                    'reply_to_msg_id': reply_to_msg_id,
                })
        except FloodWaitError as e:
            raise RuntimeError(f"FloodWait: must wait {e.seconds} seconds before retrying.") from e
        except Exception as e:
            raise RuntimeError(f"Failed to fetch chat history: {e}") from e

        return messages

    # ==================== Messaging ====================

    async def send_message(self, peer_id: int, message: str,
                           reply_to: int = None, schedule_date: int = None) -> Dict:
        """Send a text message. Returns { success, message_id }."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        try:
            entity = await self._resolve_input_entity(peer_id)
            kwargs: Dict[str, Any] = {}
            if reply_to:
                kwargs['reply_to'] = reply_to
            if schedule_date:
                kwargs['schedule'] = datetime.fromtimestamp(int(schedule_date))

            result = await self.client.send_message(entity=entity, message=message, **kwargs)
            return {"success": True, "message_id": result.id if result else None}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def edit_message(self, peer_id: int, message_id: int, new_text: str) -> Dict:
        """Edit a message. Returns { success }."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        try:
            entity = await self._resolve_input_entity(peer_id)
            await self.client.edit_message(entity, message_id, new_text)
            return {"success": True}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def delete_messages(self, peer_id: int, message_ids: List[int],
                              revoke: bool = True) -> Dict:
        """Delete messages. revoke=True = delete for everyone."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        try:
            entity = await self._resolve_input_entity(peer_id)
            await self.client.delete_messages(entity, message_ids, revoke=revoke)
            return {"success": True, "deleted_count": len(message_ids)}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_media(self, peer_id: int, file_path: str,
                         caption: str = None) -> Dict:
        """Send a file/photo/video. Returns { success, message_id }."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        if not file_path or not os.path.exists(file_path):
            return {"success": False, "error": f"File not found: {file_path}"}
        try:
            entity = await self._resolve_input_entity(peer_id)
            result = await self.client.send_file(
                entity=entity, file=file_path, caption=caption
            )
            return {"success": True, "message_id": result.id if result else None}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================== Groups & Members ====================

    async def get_members(self, group_id: int, limit: int = 100,
                          offset: int = 0, search: str = '') -> List[Dict]:
        """Get group/channel members.
        Returns list of: { id, first_name, last_name, username, is_admin, is_banned }"""
        if not self.client or not self.is_connected:
            raise RuntimeError("Not authenticated. Please login first.")

        try:
            entity = await self._resolve_input_entity(group_id)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Could not resolve group {group_id}: {e}") from e

        members: List[Dict] = []
        try:
            async for p in self.client.iter_participants(
                entity, limit=limit, offset=offset, search=search or None
            ):
                # The `.participant` attribute (if present) holds the ChannelParticipant* object
                participant = getattr(p, 'participant', None)
                is_admin = isinstance(participant, (ChannelParticipantAdmin, ChannelParticipantCreator)) if participant else False
                is_banned = isinstance(participant, ChannelParticipantBanned) if participant else False

                members.append({
                    'id': p.id,
                    'first_name': getattr(p, 'first_name', None) or '',
                    'last_name': getattr(p, 'last_name', None) or '',
                    'username': getattr(p, 'username', None),
                    'is_admin': is_admin,
                    'is_banned': is_banned,
                })
        except FloodWaitError as e:
            raise RuntimeError(f"FloodWait: must wait {e.seconds} seconds before retrying.") from e
        except Exception as e:
            raise RuntimeError(f"Failed to fetch members: {e}") from e

        return members

    async def add_member(self, group_id: int, user_id: int,
                         user_access_hash: int = None) -> Dict:
        """Add a member to a group. Returns { success }."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        try:
            # Resolve group input entity
            try:
                group_input = await self._resolve_input_entity(group_id)
            except Exception as e:
                return {"success": False,
                        "error": f"Could not resolve group {group_id}: {e}"}

            # Resolve user input entity (try cache first, then fall back to access_hash)
            user_input = None
            try:
                user_input = await self._resolve_input_entity(user_id)
            except Exception:
                pass
            if user_input is None:
                if user_access_hash:
                    user_input = InputUser(user_id=user_id, access_hash=user_access_hash)
                else:
                    return {"success": False,
                            "error": f"Could not resolve user {user_id}. Provide user_access_hash."}

            # Determine if it's a Channel (supergroup) or basic Chat
            if isinstance(group_input, InputChannel):
                await self.client(InviteToChannelRequest(
                    channel=group_input,
                    users=[user_input]
                ))
            else:
                # Legacy basic chat
                await self.client(AddChatUserRequest(
                    chat_id=group_id,
                    user_id=user_input,
                    fwd_limit=0
                ))
            return {"success": True}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def remove_member(self, group_id: int, user_id: int) -> Dict:
        """Remove/kick a member. Returns { success }."""
        if not self.client or not self.is_connected:
            return {"success": False, "error": "Not authenticated. Please login first."}
        try:
            try:
                group_input = await self._resolve_input_entity(group_id)
            except Exception as e:
                return {"success": False,
                        "error": f"Could not resolve group {group_id}: {e}"}

            try:
                user_input = await self._resolve_input_entity(user_id)
            except Exception as e:
                return {"success": False,
                        "error": f"Could not resolve user {user_id}: {e}"}

            # Kick = ban with a very short until_date (1 second) — user can re-join afterwards.
            # For a permanent ban, set until_date=0.
            until_date = int(time.time()) + 1
            await self.client(EditBannedRequest(
                channel=group_input,
                participant=user_input,
                banned_rights=ChatBannedRights(
                    until_date=until_date,
                    view_messages=True,
                    send_messages=True,
                    send_media=True,
                    send_stickers=True,
                    send_gifs=True,
                    send_games=True,
                    send_inline=True,
                    embed_links=True,
                ),
            ))
            return {"success": True}
        except FloodWaitError as e:
            return {"success": False, "error": f"FloodWait: must wait {e.seconds} seconds",
                    "wait_seconds": e.seconds}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ==================== Global Search ====================

    async def search_messages(self, query: str, limit: int = 50) -> List[Dict]:
        """Global message search.
        Returns list of: { id, chat_id, text, date, from_id }"""
        if not self.client or not self.is_connected:
            raise RuntimeError("Not authenticated. Please login first.")
        if not query:
            return []

        results: List[Dict] = []
        try:
            # When entity=None, Telethon uses messages.Search with InputPeerEmpty (global search)
            async for msg in self.client.iter_messages(None, search=query, limit=limit):
                # chat_id convenience property handles channel/chat/user peer variants
                chat_id = None
                try:
                    chat_id = msg.chat_id
                except Exception:
                    pass

                results.append({
                    'id': msg.id,
                    'chat_id': chat_id,
                    'text': msg.text or '',
                    'date': msg.date.isoformat() if msg.date else None,
                    'from_id': msg.sender_id,
                })
        except FloodWaitError as e:
            raise RuntimeError(f"FloodWait: must wait {e.seconds} seconds before retrying.") from e
        except Exception as e:
            raise RuntimeError(f"Failed to search messages: {e}") from e

        return results


# Singleton
telegram_service = TelegramService()


def run_async(coro):
    """تشغيل coroutine"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

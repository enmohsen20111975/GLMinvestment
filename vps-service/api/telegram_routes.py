#!/usr/bin/env python3
"""
Telegram API Routes
===================
API endpoints للتحكم في خدمة Telegram

Includes:
- Status & Health
- Channel Management
- Recommendations & News
- AI Processing
- Auto-Posting (NEW)
- Authentication (connect-user, send-code, verify-code, verify-password)
"""

import os
import sys
import json
import asyncio
import threading
from datetime import datetime
from flask import Blueprint, request, jsonify

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram.database import db_manager
from telegram.ai_processor import ai_processor, MessageClassifier, SymbolExtractor

# Create blueprint
telegram_bp = Blueprint('telegram', __name__, url_prefix='/api/telegram')

# Lazy load telegram service to avoid import errors
_telegram_service = None

def get_telegram_service():
    global _telegram_service
    if _telegram_service is None:
        try:
            from telegram.telegram_client import telegram_service as ts
            _telegram_service = ts
        except ImportError as e:
            print(f"Telegram service not available: {e}")
    return _telegram_service


# ==================== Persistent Event Loop ====================
# Use a persistent background event loop to keep Telegram client connected

_bg_loop = None
_bg_thread = None

def get_bg_loop():
    """الحصول على الـ event loop الدائم"""
    global _bg_loop, _bg_thread
    if _bg_loop is None or _bg_loop.is_closed():
        _bg_loop = asyncio.new_event_loop()
        
        def run_loop():
            asyncio.set_event_loop(_bg_loop)
            _bg_loop.run_forever()
        
        _bg_thread = threading.Thread(target=run_loop, daemon=True)
        _bg_thread.start()
    return _bg_loop

def run_async(coro, timeout=60):
    """تشغيل coroutine في الـ event loop الدائم"""
    loop = get_bg_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


def _check_auth():
    """Returns a (jsonify, status) tuple if not authenticated, or None if OK.
    Used by messaging/dialog/group routes that require an active Telegram session."""
    ts = get_telegram_service()
    if not ts or not ts.is_connected or not ts.client:
        return jsonify({
            "success": False,
            "error": "Not authenticated. Please login first."
        }), 401
    return None


# ==================== Status ====================

@telegram_bp.route('/status', methods=['GET'])
def get_status():
    """حالة الخدمة"""
    stats = db_manager.get_stats()
    
    connected = False
    authorized = False
    ts = get_telegram_service()
    if ts:
        connected = ts.is_connected
        if ts.client:
            try:
                authorized = run_async(ts.is_authorized(), timeout=5)
                if authorized:
                    connected = True
            except:
                pass
                
    return jsonify({
        "success": True,
        "stats": stats,
        "telegram_available": ts is not None,
        "connected": connected,
        "authorized": authorized
    })


@telegram_bp.route('/health', methods=['GET'])
def health_check():
    """فحص صحة الخدمة"""
    return jsonify({
        "status": "healthy",
        "service": "telegram-module",
        "timestamp": datetime.now().isoformat()
    })


# ==================== P18 Morning Bell (جرس الصباح) ====================

@telegram_bp.route('/morning-bell/preview', methods=['GET'])
def morning_bell_preview():
    """🔔 معاينة جرس الصباح — بيرجّع البيانات + الرسالة من غير إرسال لتيليجرام.

    P18: dry-run للتحقق من شكل الرسالة قبل الإرسال الفعلي. بيستخدم نفس
    `_get_morning_bell_data()` اللي بيستخدمها الـ endpoint + الـ scheduler
    (Python = THE BRAIN — مفيش تكرار).
    """
    try:
        from api.stored_analysis_routes import _get_morning_bell_data
        from telegram.auto_post_scheduler import _format_morning_bell_post

        limit = max(1, min(int(request.args.get('limit', 3)), 10))
        data = _get_morning_bell_data(limit=limit)
        preview_text = _format_morning_bell_post(data) if data.get('stocks') else None

        return jsonify({
            "success": True,
            "market_status": data.get('market_status'),
            "label_ar": data.get('label_ar'),
            "stocks": data.get('stocks', []),
            "note_ar": data.get('note_ar'),
            "telegram_preview": preview_text,
            "would_send": bool(data.get('stocks')),
            "dry_run": True
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/morning-bell/test', methods=['POST'])
def morning_bell_test():
    """🔔 اختبار جرس الصباح — إرسال فوري لرسالة جرس الصباح للتيليجرام.

    P18: endpoint للتحقق من الإنتاج بدون انتظار 9:45 ص. بينادي على
    `post_morning_bell()` اللي بيستخدم نفس منطق الـ scheduler. لو مفيش فرص →
    بيرجع skipped (مبيبعتش حاجة — مش بنسبّم العميل).
    """
    try:
        # lazy import عشان نتجنب circular dependency مع الـ scheduler
        from telegram.auto_post_scheduler import post_morning_bell
        result = run_async(post_morning_bell('EGX'), timeout=90)
        return jsonify({
            "success": result.get('success', False),
            "skipped": result.get('skipped', False),
            "reason": result.get('reason'),
            "message_id": result.get('message_id'),
            "error": result.get('error'),
            "note": "جرس الصباح — أعلى 3 فرص EGX. لو skipped = مفيش فرص متاحة."
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Authentication ====================

@telegram_bp.route('/auth/connect-user', methods=['POST'])
def auth_connect_user():
    """الاتصال كمستخدم (لقراءة الرسائل)"""
    data = request.get_json() or {}
    phone = data.get('phone')
    
    ts = get_telegram_service()
    if not ts:
        return jsonify({
            "success": False,
            "error": "Telegram service not available. Install telethon: pip install telethon"
        })
    
    try:
        result = run_async(ts.connect_as_user(phone), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)})


@telegram_bp.route('/auth/send-code', methods=['POST'])
def auth_send_code():
    """إرسال رمز التحقق"""
    data = request.get_json() or {}
    phone = data.get('phone')
    
    if not phone:
        return jsonify({"error": "Phone number required"}), 400
    
    ts = get_telegram_service()
    if not ts:
        return jsonify({"error": "Telegram service not available"})
    
    try:
        result = run_async(ts.send_code(phone), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)})


@telegram_bp.route('/auth/verify-code', methods=['POST'])
def auth_verify_code():
    """التحقق من الرمز"""
    data = request.get_json() or {}
    phone = data.get('phone')
    code = data.get('code')
    
    if not phone or not code:
        return jsonify({"error": "Phone and code required"}), 400
    
    ts = get_telegram_service()
    if not ts:
        return jsonify({"error": "Telegram service not available"})
    
    try:
        result = run_async(ts.verify_code(phone, code), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)})


@telegram_bp.route('/auth/verify-password', methods=['POST'])
def auth_verify_password():
    """التحقق من كلمة المرور 2FA"""
    data = request.get_json() or {}
    password = data.get('password')
    
    if not password:
        return jsonify({"error": "Password required"}), 400
    
    ts = get_telegram_service()
    if not ts:
        return jsonify({"error": "Telegram service not available"})
    
    try:
        result = run_async(ts.verify_password(password), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)})


@telegram_bp.route('/auth/status', methods=['GET'])
def auth_status():
    """حالة المصادقة"""
    ts = get_telegram_service()
    if not ts:
        return jsonify({
            "authorized": False,
            "connected": False,
            "error": "Telegram service not available"
        })
    
    try:
        is_authorized = False
        is_connected = ts.is_connected
        
        # If client exists, check authorization
        if ts.client:
            try:
                is_authorized = run_async(ts.is_authorized(), timeout=10)
                if is_authorized:
                    is_connected = True
            except:
                pass
        
        # If not authorized via client, check if session file exists
        if not is_authorized:
            import os
            import socket
            machine_id = socket.gethostname().replace('.', '_').replace('-', '_')
            service_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            session_dir = os.path.join(service_dir, 'telegram')
            
            # Check machine-specific session
            session_path = os.path.join(session_dir, f'telegram_session_{machine_id}')
            if not os.path.exists(session_path + '.session'):
                # Check old session
                session_path = os.path.join(session_dir, 'telegram_session_user')
            
            if os.path.exists(session_path + '.session'):
                # Session file exists - try to reconnect and check
                try:
                    from telegram.telegram_client import telegram_service as ts_new
                    if not ts_new.client or not ts_new.is_connected:
                        result = run_async(ts_new.connect_as_user(), timeout=15)
                        if result.get('authorized'):
                            is_authorized = True
                            is_connected = True
                except:
                    pass
        
        return jsonify({
            "authorized": is_authorized,
            "connected": is_connected
        })
    except Exception as e:
        return jsonify({
            "authorized": False,
            "connected": False,
            "error": str(e)
        })


# ==================== Channels ====================

@telegram_bp.route('/channels/tracked', methods=['GET'])
def get_tracked_channels():
    """الحصول على القنوات المتابعة"""
    active_only = request.args.get('active_only', 'true').lower() == 'true'
    channels = db_manager.get_tracked_channels(active_only)
    return jsonify({
        "success": True,
        "count": len(channels),
        "channels": channels
    })


@telegram_bp.route('/channels/my', methods=['GET'])
def get_my_channels():
    """الحصول على قنواتي من Telegram (يتطلب مصادقة مستخدم)"""
    ts = get_telegram_service()
    if not ts:
        return jsonify({
            "success": False,
            "error": "Telegram service not available. Install telethon: pip install telethon"
        })
    
    try:
        # تشغيل الـ async function
        channels = run_async(ts.get_my_channels())
        
        return jsonify({
            "success": True,
            "count": len(channels),
            "channels": channels
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "hint": "Make sure you are authenticated as a user (not bot)"
        })


@telegram_bp.route('/channels/track', methods=['POST'])
def track_channel():
    """إضافة قناة للمتابعة"""
    data = request.get_json()
    success = db_manager.add_channel(data)
    if success:
        return jsonify({"success": True, "message": "Channel added to tracking"})
    return jsonify({"error": "Failed to add channel"}), 400


@telegram_bp.route('/channels/untrack/<channel_id>', methods=['POST'])
def untrack_channel(channel_id):
    """إزالة قناة من المتابعة"""
    success = db_manager.remove_channel(channel_id)
    if success:
        return jsonify({"success": True, "message": "Channel removed from tracking"})
    return jsonify({"error": "Channel not found"}), 404


# ==================== Recommendations ====================

@telegram_bp.route('/recommendations', methods=['GET'])
def get_recommendations():
    """الحصول على التوقعات"""
    market = request.args.get('market')
    limit = int(request.args.get('limit', 50))
    recommendations = db_manager.get_recommendations(market, limit)
    return jsonify({
        "success": True,
        "count": len(recommendations),
        "recommendations": recommendations
    })


# ==================== News ====================

@telegram_bp.route('/news', methods=['GET'])
def get_news():
    """الحصول على الأخبار"""
    market = request.args.get('market')
    limit = int(request.args.get('limit', 50))
    news = db_manager.get_news(market, limit)
    return jsonify({
        "success": True,
        "count": len(news),
        "news": news
    })


# ==================== AI Processing ====================

@telegram_bp.route('/ai/classify', methods=['POST'])
def classify_message():
    """تصنيف رسالة"""
    data = request.get_json()
    text = data.get('text', '')
    msg_type, confidence = MessageClassifier.classify(text)
    return jsonify({
        "success": True,
        "type": msg_type,
        "confidence": confidence
    })


@telegram_bp.route('/ai/extract-symbols', methods=['POST'])
def extract_symbols():
    """استخراج الرموز من نص"""
    data = request.get_json()
    text = data.get('text', '')
    symbols = SymbolExtractor.extract_symbols(text)
    return jsonify({
        "success": True,
        "symbols": symbols
    })


@telegram_bp.route('/ai/process', methods=['POST'])
def process_message():
    """معالجة رسالة كاملة"""
    data = request.get_json()
    result = ai_processor.process_message(data)
    return jsonify({
        "success": True,
        "result": result
    })


# ==================== Channel Messages ====================

@telegram_bp.route('/messages', methods=['POST'])
def get_channel_messages():
    """سحب رسائل من قناة معينة"""
    data = request.get_json() or {}
    channel_id = data.get('channel_id')
    limit = int(data.get('limit', 20))
    days = int(data.get('days', 7))

    if not channel_id:
        return jsonify({"success": False, "error": "channel_id is required"}), 400

    ts = get_telegram_service()
    if not ts:
        return jsonify({"success": False, "error": "Telegram service not available"})

    try:
        result = run_async(ts.scrape_channel(channel_id, days, limit), timeout=60)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/scrape/all', methods=['POST'])
def scrape_all_tracked_channels():
    """سحب رسائل من كل القنوات المتابعة"""
    data = request.get_json() or {}
    limit = int(data.get('limit', 100))
    days = int(data.get('days', 7))

    ts = get_telegram_service()
    if not ts:
        return jsonify({"success": False, "error": "Telegram service not available"})

    try:
        result = run_async(ts.scrape_all_tracked(days, limit), timeout=300)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ==================== AI Processing (Local Ollama/LM Studio) ====================

import requests as http_requests

def _get_ollama_model(ollama_url, preferred_model):
    """
    اكتشاف الموديل المتاح في Ollama.
    1. لو الموديل المُحدد موجود → استخدمه
    2. لو مش موجود → استخدم أول موديل متاح
    3. لو مفيش موديلات → رجع None
    """
    try:
        resp = http_requests.get(f"{ollama_url}/api/tags", timeout=5)
        if not resp.ok:
            return None
        data = resp.json()
        models = [m.get('name', '') for m in data.get('models', [])]
        if not models:
            return None
        # لو الموديل المُحدد موجود، استخدمه
        if preferred_model in models:
            return preferred_model
        # sonst: استخدم أول موديل متاح
        return models[0]
    except Exception:
        return None


def _get_lm_studio_model(lm_studio_url):
    """اكتشاف الموديل المتاح في LM Studio."""
    try:
        resp = http_requests.get(f"{lm_studio_url}/v1/models", timeout=5)
        if not resp.ok:
            return None
        data = resp.json()
        models = [m.get('id', '') for m in data.get('data', [])]
        return models[0] if models else None
    except Exception:
        return None


def call_local_ai(text, task='clean'):
    """
    استدعاء AI المحلي (Ollama أو LM Studio) مع fallback ذكي.
    
    الترتيب:
    1. Ollama (port 11434) - يكتشف الموديل المتاح تلقائياً
    2. LM Studio (port 1234) - يكتشف الموديل المتاح تلقائياً
    3. Smart fallback (قواعد بسيطة لتنظيف النص)
    
    Args:
        text: النص المراد معالجته
        task: 'clean' للتنظيف، 'classify' للتصنيف
    
    Returns:
        dict: {success, text, engine, error?}
    """
    # Try Ollama first (port 11434)
    ollama_url = os.environ.get('OLLAMA_BASE_URL') or os.environ.get('OLLAMA_URL', 'http://localhost:11434')
    # Try LM Studio (port 1234)
    lm_studio_url = os.environ.get('LM_STUDIO_URL', 'http://localhost:1234')

    # GLM-FAST-UNIFY: أولوية OLLAMA_MODEL (الموحّد) → LOCAL_AI_MODEL (legacy) → glm-fast:latest.
    preferred_model = os.environ.get('OLLAMA_MODEL') or os.environ.get('LOCAL_AI_MODEL') or 'glm-fast:latest'
    
    if task == 'clean':
        prompt = f"""أنت مساعد متخصص في تحليل التوقعات المالية.
قم بتنظيف وإعادة صياغة النص التالي بأسلوب العامية المصرية.
حافظ على الأرقام والأسعار كما هي.
اجعل النص واضح ومباشر.

النص الأصلي:
{text}

النص بعد التنظيف:"""
    else:
        prompt = f"""صنف النص التالي إلى: توقعة (buy/sell/hold) أو خبر.
أرجع JSON: {{"type": "recommendation|news", "action": "buy|sell|hold|null"}}

النص:
{text}"""

    # Try Ollama - اكتشاف الموديل المتاح
    ollama_model = _get_ollama_model(ollama_url, preferred_model)
    if ollama_model:
        try:
            response = http_requests.post(
                f"{ollama_url}/api/generate",
                json={
                    "model": ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "num_predict": 300,  # حد الـ tokens
                        "temperature": 0.3,
                    }
                },
                timeout=20  # 20 ثانية بدل 60 (عشان نتجنب 504)
            )
            if response.ok:
                data = response.json()
                return {"success": True, "text": data.get('response', '').strip(), "engine": "ollama", "model": ollama_model}
        except Exception:
            pass

    # Try LM Studio - اكتشاف الموديل المتاح
    lm_model = _get_lm_studio_model(lm_studio_url)
    if lm_model:
        try:
            response = http_requests.post(
                f"{lm_studio_url}/v1/chat/completions",
                json={
                    "model": lm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 300
                },
                timeout=20  # 20 ثانية بدل 60
            )
            if response.ok:
                data = response.json()
                content = data.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
                return {"success": True, "text": content, "engine": "lm_studio", "model": lm_model}
        except Exception:
            pass

    # Smart Fallback - تنظيف النص باستخدام قواعد بسيطة
    if task == 'clean':
        cleaned = _smart_clean_text(text)
        return {
            "success": True,
            "text": cleaned,
            "engine": "smart_fallback",
            "note": "AI المحلي غير متاح - تم استخدام التنظيف التلقائي"
        }
    elif task == 'classify':
        result = _smart_classify(text)
        return {
            "success": True,
            "text": json.dumps(result, ensure_ascii=False),
            "engine": "smart_fallback",
            "note": "AI المحلي غير متاح - تم استخدام التصنيف التلقائي"
        }
    
    # Fallback: return original text
    return {"success": False, "text": text, "engine": "none", "error": "No AI engine available"}


def _smart_clean_text(text: str) -> str:
    """
    تنظيف ذكي للنص باستخدام قواعد بسيطة (fallback لما الـ AI المحلي مش متاح).
    
    القواعد:
    - إزالة الروابط الزائدة
    - إزالة التشكيل الزائد
    - توحيد المسافات
    - إزالة الـ emojis الزائدة (نشيل التكرار)
    - تنظيف الـ mentions والـ hashtags الزائدة
    - الحفاظ على الأرقام والأسعار
    """
    import re
    
    if not text:
        return text
    
    cleaned = text
    
    # 1. إزالة الروابط الزائدة (نحتفظ بأول رابط بس)
    urls = re.findall(r'https?://[^\s]+', cleaned)
    if len(urls) > 1:
        for url in urls[1:]:
            cleaned = cleaned.replace(url, '')
    
    # 2. إزالة التشكيل الزائد (نحتفظ بالشدّة فقط لو محتاجة)
    # arabic_diacritics = re.compile(r'[\u064B-\u065F\u0670]')
    # cleaned = arabic_diacritics.sub('', cleaned)
    
    # 3. توحيد المسافات
    cleaned = re.sub(r'[ \t]+', ' ', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    
    # 4. إزالة الـ emojis الزائدة (نحتفظ بواحد بس من كل نوع)
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags
        "]+",
        flags=re.UNICODE
    )
    # نشيل الـ emojis المتكررة
    cleaned = re.sub(r'([\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF])\1+', r'\1', cleaned)
    
    # 5. إزالة الـ mentions الزائدة (نحتفظ بأول 2)
    mentions = re.findall(r'@\w+', cleaned)
    if len(mentions) > 2:
        for mention in mentions[2:]:
            cleaned = cleaned.replace(mention, '')
    
    # 6. إزالة الـ hashtags الزائدة (نحتفظ بأول 3)
    hashtags = re.findall(r'#\w+', cleaned)
    if len(hashtags) > 3:
        for hashtag in hashtags[3:]:
            cleaned = cleaned.replace(hashtag, '')
    
    # 7. إزالة الأسطر الفاضية في الأول والأخير
    cleaned = cleaned.strip()
    
    # 8. إزالة العبارات التسويقية الزائدة
    spam_phrases = [
        'اضغط هنا', 'رابط التسجيل', 'للتسجيل اضغط', 'تابعنا على',
        'اشترك في القناة', 'لايك وشير', 'شارك البوست'
    ]
    for phrase in spam_phrases:
        cleaned = cleaned.replace(phrase, '')
    
    # 9. تنظيف نهائي
    cleaned = re.sub(r'[ \t]+', ' ', cleaned).strip()
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    
    return cleaned if cleaned else text


def _smart_classify(text: str) -> dict:
    """
    تصنيف ذكي للنص (recommendation vs news) باستخدام قواعد بسيطة.
    """
    if not text:
        return {"type": "general", "action": None}
    
    text_lower = text.lower()
    
    # كلمات التوقعة (buy/sell/hold)
    buy_keywords = [
        'شراء', 'اشتري', 'BUY', 'buy', 'تراكم', 'استحوذ', 'ادخل',
        'فرصة شراء', 'الهدف', 'وقف خسارة', 'الخروج عند', 'سعر الدخول',
        'مضاربة', 'سوينج', 'استثمار', 'اقتناص', 'target', 'stop loss',
        'وقف', 'هدف', 'دخول'
    ]
    
    sell_keywords = [
        'بيع', 'بِيع', 'SELL', 'sell', 'اخرج', 'تصريف', 'تخلص',
        'خروج', 'بيع جزئي', 'بيع كلي', 'وقف الخسارة'
    ]
    
    hold_keywords = [
        'احتفاظ', 'هولد', 'HOLD', 'hold', 'امسك', 'استمر',
        'ترقب', 'انتظر', 'مراقبة'
    ]
    
    # كلمات الأخبار
    news_keywords = [
        'خبر', 'اعلان', 'إعلان', 'قرار', 'تقرير', 'نتيجة',
        'أرباح', 'خسائر', 'اجتماع', 'توزيعات', 'توزيع أرباح',
        'تجزئة', 'دمج', 'اكتتاب', 'طرح', 'news', 'announcement',
        'البنك المركزي', 'البورصة المصرية', 'قرار حكومي'
    ]
    
    # حساب النقاط
    buy_score = sum(1 for kw in buy_keywords if kw in text_lower)
    sell_score = sum(1 for kw in sell_keywords if kw in text_lower)
    hold_score = sum(1 for kw in hold_keywords if kw in text_lower)
    news_score = sum(1 for kw in news_keywords if kw in text_lower)
    
    # تحديد النوع
    if buy_score > 0 and buy_score >= max(sell_score, hold_score, news_score):
        return {"type": "recommendation", "action": "buy"}
    elif sell_score > 0 and sell_score >= max(buy_score, hold_score, news_score):
        return {"type": "recommendation", "action": "sell"}
    elif hold_score > 0 and hold_score >= max(buy_score, sell_score, news_score):
        return {"type": "recommendation", "action": "hold"}
    elif news_score > 0:
        return {"type": "news", "action": None}
    
    # لو مفيش كلمات مميزة
    return {"type": "general", "action": None}


@telegram_bp.route('/ai/clean', methods=['POST'])
def clean_message():
    """تنظيف وإعادة صياغة بوست بالـ AI المحلي"""
    data = request.get_json() or {}
    text = data.get('text', '')

    if not text:
        return jsonify({"success": False, "error": "text is required"}), 400

    result = call_local_ai(text, task='clean')
    return jsonify(result)


# ==================== Save to Database ====================

@telegram_bp.route('/save', methods=['POST'])
def save_message():
    """حفظ بوست كتوقعة أو خبر"""
    data = request.get_json() or {}
    msg_type = data.get('type')  # 'recommendation' or 'news'

    if msg_type == 'recommendation':
        # Save to expertRecommendation table
        import sqlite3
        from pathlib import Path
        import uuid

        # محاولة في predictions.db أولاً
        _project_root = Path(__file__).resolve().parent.parent.parent
        db_paths = [
            str(_project_root / 'db' / 'predictions.db'),
        ]

        conn = None
        db_used = None
        for db_path in db_paths:
            try:
                Path(db_path).parent.mkdir(parents=True, exist_ok=True)
                conn = sqlite3.connect(db_path)
                conn.execute("SELECT 1")
                db_used = db_path
                break
            except Exception:
                if conn:
                    conn.close()
                conn = None
                continue

        if conn is None:
            return jsonify({
                "success": False,
                "error": "Cannot access predictions database. Tried: " + ", ".join(db_paths)
            }), 500

        try:
            c = conn.cursor()

            # فحص الـ schema الفعلي للجدول (عشان نعرف الأعمدة الموجودة)
            c.execute("PRAGMA table_info(expertRecommendation)")
            existing_cols = {row[1] for row in c.fetchall()}

            # لو الجدول مش موجود، أنشئه بـ schema بسيطة
            if not existing_cols:
                c.execute('''
                    CREATE TABLE IF NOT EXISTS expertRecommendation (
                        id TEXT PRIMARY KEY,
                        stock_symbol TEXT,
                        stock_name_ar TEXT,
                        expert_name TEXT,
                        action TEXT,
                        entry_price REAL,
                        target_price REAL,
                        stop_loss REAL,
                        confidence REAL DEFAULT 0.5,
                        reasoning TEXT,
                        original_text TEXT,
                        channel_name TEXT,
                        source TEXT DEFAULT 'telegram',
                        market TEXT DEFAULT 'EGX',
                        session_date TEXT,
                        status TEXT DEFAULT 'active',
                        created_at TEXT DEFAULT (datetime('now'))
                    )
                ''')
                existing_cols = {
                    'id', 'stock_symbol', 'stock_name_ar', 'expert_name', 'action',
                    'entry_price', 'target_price', 'stop_loss', 'confidence',
                    'reasoning', 'original_text', 'channel_name', 'source', 'market',
                    'session_date', 'status', 'created_at'
                }

            # بناء INSERT ديناميكي بناءً على الأعمدة الموجودة
            rec_id = str(uuid.uuid4())

            # خريطة بين الـ fields المطلوبة والـ columns الفعلية
            field_mappings = {
                'id': rec_id,
                'stock_symbol': data.get('symbol', ''),
                'stock_name_ar': data.get('name', ''),
                'expert_name': data.get('expert_name', data.get('channel_name', 'Telegram')),
                'expert_source': 'telegram',  # لو موجود
                'action': (data.get('action', 'buy') or 'buy').upper(),
                'entry_price': float(data.get('entry_price', 0) or 0),
                'target_price': float(data.get('target_price', 0) or 0),
                'stop_loss': float(data.get('stop_loss', 0) or 0),
                'target_price_2': float(data.get('target_price_2', 0) or 0),
                'recommendation_reason': data.get('reasoning', ''),
                'technical_analysis': data.get('reasoning', ''),
                'recommendation_type': 'detailed',
                'session_date': data.get('session_date', datetime.now().strftime('%Y-%m-%d')),
                'session_type': 'intraday',
                'expected_duration': 'short',
                'status': 'PENDING',
                'notes': data.get('original_text', ''),
            }

            # فلترة الـ fields الموجودة فعلاً في الـ schema
            valid_fields = {k: v for k, v in field_mappings.items() if k in existing_cols}

            if not valid_fields:
                return jsonify({
                    "success": False,
                    "error": "No valid columns found in expertRecommendation table",
                    "existing_cols": list(existing_cols)
                }), 500

            # بناء INSERT ديناميكي
            columns = ', '.join(valid_fields.keys())
            placeholders = ', '.join(['?' for _ in valid_fields])
            values = list(valid_fields.values())

            c.execute(f'''
                INSERT INTO expertRecommendation
                ({columns})
                VALUES ({placeholders})
            ''', values)

            conn.commit()
            conn.close()

            return jsonify({
                "success": True,
                "id": rec_id,
                "type": "recommendation",
                "db": db_used,
                "saved_fields": list(valid_fields.keys())
            })
        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass
            return jsonify({"success": False, "error": str(e), "db": db_used}), 500
    
    elif msg_type == 'news':
        # Save to news table in stocks.db
        try:
            import sqlite3
            from pathlib import Path
            db_path = str(Path(__file__).parent.parent.parent / 'db' / 'stocks.db')
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            
            # Ensure table exists
            c.execute('''
                CREATE TABLE IF NOT EXISTS telegram_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT,
                    summary TEXT,
                    sentiment TEXT DEFAULT 'neutral',
                    symbols TEXT,
                    raw_text TEXT,
                    channel_name TEXT,
                    market TEXT DEFAULT 'EGX',
                    date TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            ''')
            
            c.execute('''
                INSERT INTO telegram_news 
                (title, summary, sentiment, symbols, raw_text, channel_name, market, date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('title', ''),
                data.get('summary', ''),
                data.get('sentiment', 'neutral'),
                data.get('symbols', ''),
                data.get('original_text', ''),
                data.get('channel_name', ''),
                data.get('market', 'EGX'),
                datetime.now().strftime('%Y-%m-%d')
            ))
            conn.commit()
            conn.close()
            
            return jsonify({"success": True, "type": "news"})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    
    return jsonify({"success": False, "error": "Invalid type. Use 'recommendation' or 'news'"}), 400


# ==================== Markets ====================

@telegram_bp.route('/markets/overview', methods=['GET'])
def markets_overview():
    """نظرة عامة على الأسواق"""
    stats = db_manager.get_stats()

    return jsonify({
        "success": True,
        "overview": {
            "egypt": {
                "name": "البورصة المصرية",
                "name_en": "EGX",
                "recommendations": stats.get('by_market', {}).get('egypt', 0)
            },
            "saudi": {
                "name": "السوق السعودية",
                "name_en": "TADAWUL",
                "recommendations": stats.get('by_market', {}).get('saudi', 0)
            },
            "kuwait": {
                "name": "بورصة الكويت",
                "name_en": "KSE",
                "recommendations": stats.get('by_market', {}).get('kuwait', 0)
            },
            "qatar": {
                "name": "بورصة قطر",
                "name_en": "QSE",
                "recommendations": stats.get('by_market', {}).get('qatar', 0)
            },
            "crypto": {
                "name": "العملات الرقمية",
                "name_en": "Crypto",
                "recommendations": stats.get('by_market', {}).get('crypto', 0)
            }
        },
        "stats": stats
    })


# ==================== Scraping Status ====================

@telegram_bp.route('/scraping/status', methods=['GET'])
def scraping_status():
    """حالة السحب"""
    status = db_manager.get_scraping_status()
    return jsonify({
        "success": True,
        "status": status
    })


# ==================== Auto-Posting ====================

# Lazy load auto poster
_auto_poster = None

def get_auto_poster():
    global _auto_poster
    if _auto_poster is None:
        try:
            from telegram.auto_poster import auto_poster as ap
            _auto_poster = ap
        except ImportError as e:
            print(f"Auto poster not available: {e}")
    return _auto_poster


@telegram_bp.route('/post/connect', methods=['POST'])
def post_connect():
    """الاتصال بالقناة للنشر"""
    poster = get_auto_poster()
    if not poster:
        return jsonify({
            "success": False,
            "error": "Auto poster not available. Install telethon: pip install telethon"
        })
    
    try:
        result = run_async(poster.connect())
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/message', methods=['POST'])
def post_message():
    """
    نشر رسالة على القناة
    
    Body:
    {
        "text": "نص الرسالة",
        "parse_mode": "md"  // md أو html
    }
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    data = request.get_json()
    text = data.get('text', '')
    parse_mode = data.get('parse_mode', 'md')
    
    if not text:
        return jsonify({"success": False, "error": "Text is required"})
    
    try:
        result = run_async(poster.send_message(text, parse_mode))
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/recommendation', methods=['POST'])
def post_recommendation():
    """
    نشر توقعة منسقة
    
    Body:
    {
        "ticker": "COMI",
        "name_ar": "البنك التجاري الدولي",
        "signal": "BUY",
        "current_price": 136.59,
        "target_price": 150.00,
        "stop_loss": 128.00,
        "confidence": 85,
        "sector": "Banks"
    }
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    data = request.get_json()
    
    if not data.get('ticker'):
        return jsonify({"success": False, "error": "Ticker is required"})
    
    try:
        # تنسيق التوقعة
        text = poster.format_recommendation_post(data)
        
        # نشرها
        result = run_async(poster.send_message(text, 'md'))
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/daily-summary', methods=['POST'])
def post_daily_summary():
    """
    نشر ملخص يومي
    
    يحضر البيانات تلقائياً من قاعدة البيانات
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    try:
        # جلب ملخص السوق
        from telegram.auto_poster import get_market_summary
        summary = get_market_summary()
        
        if not summary:
            return jsonify({"success": False, "error": "Could not get market summary"})
        
        # تنسيق الملخص
        text = poster.format_daily_summary_post(summary)
        
        # نشره
        result = run_async(poster.send_message(text, 'md'))
        
        return jsonify({
            "success": result.get('success', False),
            "message_id": result.get('message_id'),
            "summary": {
                "gainers": summary.get('gainers', 0),
                "losers": summary.get('losers', 0),
                "total": summary.get('total_stocks', 0)
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/top-recommendations', methods=['POST'])
def post_top_recommendations():
    """
    نشر أفضل التوقعات
    
    Query params:
    - limit: عدد التوقعات (default: 5)
    - min_score: أدنى درجة ثقة (default: 70)
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    limit = int(request.args.get('limit', 5))
    min_score = int(request.args.get('min_score', 70))
    
    try:
        # جلب التوقعات
        from telegram.auto_poster import get_top_recommendations
        recommendations = get_top_recommendations(limit, min_score)
        
        if not recommendations:
            return jsonify({
                "success": False,
                "error": "No recommendations found",
                "hint": "Make sure there are stored analyses with BUY signal"
            })
        
        # نشر كل توقعة
        results = []
        
        for rec in recommendations:
            text = poster.format_recommendation_post(rec)
            result = run_async(poster.send_message(text, 'md'))
            results.append({
                "ticker": rec.get('ticker'),
                "success": result.get('success', False),
                "message_id": result.get('message_id')
            })
        
        return jsonify({
            "success": True,
            "posted": len([r for r in results if r.get('success')]),
            "failed": len([r for r in results if not r.get('success')]),
            "results": results
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/alert', methods=['POST'])
def post_alert():
    """
    نشر تنبيه سهمي
    
    Body:
    {
        "ticker": "COMI",
        "name_ar": "البنك التجاري الدولي",
        "alert_type": "breakout",  // breakout, support, resistance, signal
        "price": 136.59,
        "message": "اختراق مقاومة 135"
    }
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    data = request.get_json()
    
    if not data.get('ticker') or not data.get('message'):
        return jsonify({"success": False, "error": "Ticker and message are required"})
    
    try:
        text = poster.format_stock_alert(data)
        
        result = run_async(poster.send_message(text, 'md'))
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/market-open', methods=['POST'])
def post_market_open():
    """نشر رسالة افتتاح السوق"""
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    try:
        text = poster.format_market_open()
        
        result = run_async(poster.send_message(text, 'md'))
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/market-close', methods=['POST'])
def post_market_close():
    """نشر رسالة إغلاق السوق"""
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    data = request.get_json() or {}
    
    try:
        # جلب ملخص الجلسة (اختياري)
        summary = None
        if data.get('include_summary'):
            from telegram.auto_poster import get_market_summary
            summary = get_market_summary()
        
        text = poster.format_market_close(summary)
        
        result = run_async(poster.send_message(text, 'md'))
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@telegram_bp.route('/post/custom', methods=['POST'])
def post_custom():
    """
    نشر رسالة مخصصة مع قالب
    
    Body:
    {
        "template": "recommendation",  // recommendation, alert, summary
        "data": {...}
    }
    """
    poster = get_auto_poster()
    if not poster:
        return jsonify({"success": False, "error": "Auto poster not available"})
    
    data = request.get_json()
    template = data.get('template', 'recommendation')
    template_data = data.get('data', {})
    
    try:
        if template == 'recommendation':
            text = poster.format_recommendation_post(template_data)
        elif template == 'alert':
            text = poster.format_stock_alert(template_data)
        elif template == 'summary':
            text = poster.format_daily_summary_post(template_data)
        else:
            return jsonify({"success": False, "error": f"Unknown template: {template}"})

        result = run_async(poster.send_message(text, 'md'))

        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ==================== Dialogs & Chat History (NEW) ====================

@telegram_bp.route('/dialogs', methods=['GET'])
def get_dialogs():
    """جلب قائمة المحادثات والقنوات والمجموعات"""
    err = _check_auth()
    if err:
        return err
    try:
        limit = int(request.args.get('limit', 100))
        result = run_async(get_telegram_service().get_dialogs(limit=limit), timeout=30)
        return jsonify({"success": True, "dialogs": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/dialogs/<int:chat_id>/history', methods=['GET'])
def get_chat_history(chat_id):
    """جلب تاريخ رسائل محادثة معينة"""
    err = _check_auth()
    if err:
        return err
    try:
        limit = int(request.args.get('limit', 50))
        offset_id = int(request.args.get('offset_id', 0))
        result = run_async(
            get_telegram_service().get_chat_history(chat_id, limit=limit, offset_id=offset_id),
            timeout=30,
        )
        return jsonify({"success": True, "messages": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Messaging (NEW) ====================

@telegram_bp.route('/messages/send', methods=['POST'])
def send_message():
    """إرسال رسالة نصية"""
    err = _check_auth()
    if err:
        return err
    try:
        data = request.get_json() or {}
        if not data.get('peer_id') or not data.get('message'):
            return jsonify({"success": False, "error": "peer_id and message are required"}), 400
        result = run_async(get_telegram_service().send_message(
            peer_id=int(data['peer_id']),
            message=data['message'],
            reply_to=int(data.get('reply_to', 0)) or None,
            schedule_date=int(data.get('schedule_date', 0)) or None,
        ), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/messages/edit', methods=['POST'])
def edit_message():
    """تعديل رسالة"""
    err = _check_auth()
    if err:
        return err
    try:
        data = request.get_json() or {}
        if not data.get('peer_id') or not data.get('message_id') or not data.get('new_text'):
            return jsonify({"success": False, "error": "peer_id, message_id, new_text are required"}), 400
        result = run_async(get_telegram_service().edit_message(
            peer_id=int(data['peer_id']),
            message_id=int(data['message_id']),
            new_text=data['new_text'],
        ), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/messages/delete', methods=['POST'])
def delete_messages():
    """حذف رسائل (revoke=True = حذف للجميع)"""
    err = _check_auth()
    if err:
        return err
    try:
        data = request.get_json() or {}
        if not data.get('peer_id') or not data.get('message_ids'):
            return jsonify({"success": False, "error": "peer_id and message_ids are required"}), 400
        result = run_async(get_telegram_service().delete_messages(
            peer_id=int(data['peer_id']),
            message_ids=[int(x) for x in data['message_ids']],
            revoke=bool(data.get('revoke', True)),
        ), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/media/upload', methods=['POST'])
def upload_media():
    """رفع وإرسال ملف وسائط (file + peer_id + optional caption)"""
    err = _check_auth()
    if err:
        return err
    try:
        peer_id = int(request.form.get('peer_id', 0))
        caption = request.form.get('caption', '')
        file = request.files.get('file')
        if not file or not peer_id:
            return jsonify({"success": False, "error": "peer_id and file required"}), 400
        # Save temp file with original extension
        import tempfile
        import os
        suffix = os.path.splitext(file.filename)[1] if file.filename else ''
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            file.save(tmp.name)
            tmp.close()
            result = run_async(
                get_telegram_service().send_media(peer_id, tmp.name, caption or None),
                timeout=60,
            )
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Groups & Members (NEW) ====================

@telegram_bp.route('/groups/<int:group_id>/members', methods=['GET'])
def get_members(group_id):
    """جلب أعضاء مجموعة/قناة"""
    err = _check_auth()
    if err:
        return err
    try:
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        search = request.args.get('search', '')
        result = run_async(get_telegram_service().get_members(
            group_id, limit=limit, offset=offset, search=search
        ), timeout=30)
        return jsonify({"success": True, "members": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/groups/<int:group_id>/add', methods=['POST'])
def add_member(group_id):
    """إضافة عضو لمجموعة"""
    err = _check_auth()
    if err:
        return err
    try:
        data = request.get_json() or {}
        if not data.get('user_id'):
            return jsonify({"success": False, "error": "user_id is required"}), 400
        result = run_async(get_telegram_service().add_member(
            group_id=group_id,
            user_id=int(data['user_id']),
            user_access_hash=int(data.get('user_access_hash', 0)) or None,
        ), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@telegram_bp.route('/groups/<int:group_id>/remove', methods=['POST'])
def remove_member(group_id):
    """إزالة/طرد عضو من مجموعة"""
    err = _check_auth()
    if err:
        return err
    try:
        data = request.get_json() or {}
        if not data.get('user_id'):
            return jsonify({"success": False, "error": "user_id is required"}), 400
        result = run_async(get_telegram_service().remove_member(
            group_id, int(data['user_id'])
        ), timeout=30)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Search (NEW) ====================

@telegram_bp.route('/search', methods=['GET'])
def search_messages():
    """بحث عام في الرسائل (global search عبر كل المحادثات)"""
    err = _check_auth()
    if err:
        return err
    try:
        q = request.args.get('q', '')
        limit = int(request.args.get('limit', 50))
        if not q:
            return jsonify({"success": True, "results": []})
        result = run_async(get_telegram_service().search_messages(q, limit=limit), timeout=30)
        return jsonify({"success": True, "results": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Events Polling (NEW - for WebSocket mini-service) ====================

@telegram_bp.route('/events/poll', methods=['GET'])
def poll_events():
    """Poll for real-time events since a unix timestamp.
    Used by the WebSocket mini-service to relay new_message / message_edited / message_deleted
    events to frontend clients over a socket.io connection."""
    try:
        since = int(request.args.get('since', 0))
        ts = get_telegram_service()
        if not ts:
            return jsonify({"success": True, "events": []})
        # If not authenticated, just return empty events (no 401 — the WS poller should keep polling)
        if not ts.is_connected or not ts.client:
            return jsonify({"success": True, "events": [], "authenticated": False})
        events = ts.poll_events(since=since)
        return jsonify({"success": True, "events": events, "authenticated": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== Image Serving ====================

@telegram_bp.route('/images/<filename>', methods=['GET'])
def serve_telegram_image(filename):
    """تقديم صور Telegram المحفوظة محلياً للـ Frontend"""
    import os
    from flask import send_from_directory, abort

    # مسار مجلد الصور
    images_dir = os.path.join(os.path.dirname(__file__), '..', 'telegram', 'downloaded_images')
    images_dir = os.path.abspath(images_dir)

    # التحقق من اسم الملف (منع path traversal)
    if '/' in filename or '\\' in filename or '..' in filename:
        abort(404)

    file_path = os.path.join(images_dir, filename)
    if not os.path.exists(file_path):
        abort(404)

    return send_from_directory(images_dir, filename)


@telegram_bp.route('/ai/status', methods=['GET'])
def ai_status():
    """فحص حالة الـ AI المحلي (Ollama / LM Studio)"""
    ollama_url = os.environ.get('OLLAMA_BASE_URL') or os.environ.get('OLLAMA_URL', 'http://localhost:11434')
    lm_studio_url = os.environ.get('LM_STUDIO_URL', 'http://localhost:1234')

    status = {
        'ollama': {'available': False, 'url': ollama_url, 'models': []},
        'lm_studio': {'available': False, 'url': lm_studio_url, 'models': []},
        'active_engine': 'smart_fallback',
        'fallback_available': True,
        'recommended_model': os.environ.get('OLLAMA_MODEL') or os.environ.get('LOCAL_AI_MODEL') or 'glm-fast:latest',
    }

    # فحص Ollama
    try:
        resp = http_requests.get(f"{ollama_url}/api/tags", timeout=5)
        if resp.ok:
            data = resp.json()
            status['ollama']['available'] = True
            status['ollama']['models'] = [m.get('name', '') for m in data.get('models', [])]
            if status['ollama']['models']:
                status['active_engine'] = 'ollama'
    except Exception:
        pass

    # فحص LM Studio
    try:
        resp = http_requests.get(f"{lm_studio_url}/v1/models", timeout=5)
        if resp.ok:
            data = resp.json()
            status['lm_studio']['available'] = True
            status['lm_studio']['models'] = [m.get('id', '') for m in data.get('data', [])]
            if status['lm_studio']['models'] and status['active_engine'] == 'smart_fallback':
                status['active_engine'] = 'lm_studio'
    except Exception:
        pass

    status['success'] = True
    return jsonify(status)

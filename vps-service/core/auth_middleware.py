"""
Admin Authentication Middleware
================================
Middleware لحماية endpoints الأدمن فقط

الاستخدام:
    from core.auth_middleware import require_admin
    
    @app.route('/api/admin/sensitive')
    @require_admin
    def admin_only_endpoint():
        return jsonify({"data": "secret"})
"""

import os
import hashlib
import functools
from flask import request, jsonify, g
from datetime import datetime
from typing import Callable, Any


# ============================================================================
# CONFIGURATION
# ============================================================================

# Token للأدمن — يُقرأ من environment variable فقط.
# SEC-04 HOTFIX (Phase A): لا hardcoded fallback. لو env var ناقص → fail closed.
ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', '')

# Optional shared secret that the Next.js proxy sends as X-API-Key.
# Allows the proxy to authenticate to the backend WITHOUT granting admin
# rights to every localhost caller. Empty by default (fail closed).
PROXY_API_KEY = os.environ.get('PROXY_API_KEY', '')

# IP whitelist (اختياري) - IPs مسموح لها بالوصول للأدمن
ADMIN_IP_WHITELIST = os.environ.get('ADMIN_IP_WHITELIST', '').split(',')

# تفعيل/تعطيل الحماية (للتطوير)
AUTH_ENABLED = os.environ.get('ADMIN_AUTH_ENABLED', 'true').lower() == 'true'


# ============================================================================
# DECORATOR
# ============================================================================

def require_admin(f: Callable) -> Callable:
    """
    Decorator لحماية endpoints الأدمن.
    
    يتطلب:
        - X-Admin-Token header صحيح
        - أو IP في قائمة المسموحين (إذا كانت مفعّلة)
    
    مثال:
        @app.route('/api/admin/sync', methods=['POST'])
        @require_admin
        def sync_data():
            return jsonify({"success": True})
    """
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        # إذا كانت الحماية معطلة، اسمح بالمرور (dev only — must be explicit)
        if not AUTH_ENABLED:
            g.is_admin = True
            return f(*args, **kwargs)

        # SEC-04 HOTFIX (Phase A): localhost / loopback is NO LONGER auto-authorized.
        # Previously any request whose `remote_addr` was 127.0.0.1 was treated as
        # admin. Because the Next.js proxy forwards public requests to localhost:8010,
        # this granted full admin to anyone on the internet via /api/proxy/admin/*.
        #
        # Authorization now requires ONE of:
        #   (a) A valid X-Admin-Token header matching ADMIN_TOKEN, OR
        #   (b) A valid X-API-Key header matching PROXY_API_KEY (sent by the
        #       Next.js proxy), AND the request must arrive from localhost.
        #       The localhost requirement here is a transport restriction on the
        #       PROXY_API_KEY path only — it does NOT grant admin by itself.
        #   (c) IP in ADMIN_IP_WHITELIST (explicit ops allowlist).
        provided_token = request.headers.get('X-Admin-Token')
        provided_api_key = request.headers.get('X-API-Key')
        client_ip = get_client_ip()
        is_loopback = client_ip in ('127.0.0.1', '::1', 'localhost')

        is_authorized = False

        # (a) Valid admin token — works from anywhere (it IS the secret).
        if provided_token and verify_token(provided_token):
            is_authorized = True

        # (b) Proxy shared secret — only when arriving from loopback AND the
        # configured PROXY_API_KEY matches. The Next.js proxy runs on the
        # same host, so loopback + key = trusted relay. A bare loopback
        # request without the key is NOT authorized.
        elif (
            PROXY_API_KEY
            and provided_api_key
            and is_loopback
            and _constant_time_eq(provided_api_key, PROXY_API_KEY)
        ):
            is_authorized = True

        # (c) Explicit IP allowlist (ops-controlled).
        elif ADMIN_IP_WHITELIST and ADMIN_IP_WHITELIST[0]:
            if client_ip in ADMIN_IP_WHITELIST:
                is_authorized = True

        if not is_authorized:
            log_unauthorized_access(client_ip, request.path)
            return jsonify({
                "success": False,
                "error": "Unauthorized",
                "message": "Admin access required. Provide valid X-Admin-Token header.",
                "code": "ADMIN_AUTH_REQUIRED"
            }), 401

        # وضع علامة أن المستخدم أدمن
        g.is_admin = True
        g.admin_ip = client_ip

        return f(*args, **kwargs)

    return decorated_function


def require_admin_or_public(f: Callable) -> Callable:
    """
    Decorator يسمح بالوصول العام لكن مع ميزات إضافية للأدمن.
    
    مثال: endpoint يعرض بيانات مختصرة للعامة وكاملة للأدمن
    """
    @functools.wraps(f)
    def decorated_function(*args, **kwargs):
        provided_token = request.headers.get('X-Admin-Token')
        g.is_admin = bool(provided_token and verify_token(provided_token))
        return f(*args, **kwargs)
    
    return decorated_function


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def verify_token(token: str) -> bool:
    """تحقق من صحة token باستخدام مقارنة آمنة ضد timing attacks.

    SEC-04 HOTFIX: لو ADMIN_TOKEN فاضي (env var مش متضبوط)، بيرجّع False
    دايماً (fail closed) — ما فيش admin access من غير token صحيح.
    """
    if not token or not ADMIN_TOKEN:
        return False

    return _constant_time_eq(token, ADMIN_TOKEN)


def _constant_time_eq(a: str, b: str) -> bool:
    """مقارنة ثابتة الزمن بين سلسلتين لتجنب timing attacks."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0


def get_client_ip() -> str:
    """الحصول على IP العميل الحقيقي (مع مراعاة Proxies)."""
    # تحقق من headers الوكيل
    forwarded_for = request.headers.get('X-Forwarded-For')
    if forwarded_for:
        # أول IP في القائمة هو العميل الأصلي
        return forwarded_for.split(',')[0].strip()
    
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip
    
    # وإلا استخدم remote_addr
    return request.remote_addr or 'unknown'


def hash_ip(ip: str) -> str:
    """Hash IP للخصوصية عند التخزين."""
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def log_unauthorized_access(ip: str, path: str):
    """سجل محاولة الوصول غير المصرح بها."""
    timestamp = datetime.now().isoformat()
    print(f"[ADMIN_AUTH] Unauthorized access attempt - IP: {ip}, Path: {path}, Time: {timestamp}")


# ============================================================================
# ADMIN SESSION TRACKING
# ============================================================================

class AdminSessionTracker:
    """تتبع جلسات الأدمن للأناليتكس."""
    
    def __init__(self):
        self.active_sessions = {}
    
    def start_session(self, admin_id: str, ip: str) -> str:
        """بدء جلسة أدمن جديدة."""
        session_id = hashlib.sha256(f"{admin_id}{datetime.now().isoformat()}".encode()).hexdigest()[:16]
        
        self.active_sessions[session_id] = {
            'admin_id': admin_id,
            'ip': ip,
            'started_at': datetime.now(),
            'actions': []
        }
        
        return session_id
    
    def log_action(self, session_id: str, action: str, details: dict = None):
        """تسجيل إجراء أدمن."""
        if session_id in self.active_sessions:
            self.active_sessions[session_id]['actions'].append({
                'action': action,
                'details': details or {},
                'timestamp': datetime.now().isoformat()
            })
    
    def end_session(self, session_id: str) -> dict:
        """إنهاء جلسة وإرجاع الملخص."""
        if session_id in self.active_sessions:
            session = self.active_sessions.pop(session_id)
            session['ended_at'] = datetime.now()
            return session
        return {}


# إنشاء instance عام
admin_session_tracker = AdminSessionTracker()


# ============================================================================
# EXPORT
# ============================================================================

__all__ = [
    'require_admin',
    'require_admin_or_public',
    'verify_token',
    '_constant_time_eq',
    'get_client_ip',
    'hash_ip',
    'ADMIN_TOKEN',
    'PROXY_API_KEY',
    'AUTH_ENABLED',
    'AdminSessionTracker',
    'admin_session_tracker'
]

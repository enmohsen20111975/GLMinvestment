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
# BRAVO RESTRUCT-B-P1 — Subscription/Tier-based access control (Rule 20)
# ============================================================================
# Trusted-proxy model: Next.js (port 3000) proxies to Python (port 8010).
# Python is NOT exposed directly to the internet (Caddy → Next.js → Python).
# Next.js sends PROXY_API_KEY + X-User-Id + X-User-Tier headers after auth.
#
# Tier hierarchy (auth.db.User.subscription_tier):
#   guest < free < normal < premium < pro < admin
#
# Guest = no X-User-Id header (anonymous visitor). Read-only limited endpoints.
# Free = trial active (trial_ends_at > NOW) or expired trial. Soft paywall.
# Normal/Premium/Pro = paid. Full access.
# Admin = everything (handled by @require_admin).
# ============================================================================

# Tier order — lower index = lower privilege.
TIER_ORDER = ['guest', 'free', 'normal', 'premium', 'pro', 'admin', 'developer', 'enterprise',
              'b2b_starter', 'b2b_pro', 'b2b_enterprise']

# Trial days — canonical = 14 (per Owner spec "Trial 14 days").
# BRAVO RESTRUCT-B-P2 will unify all sources to this value.
TRIAL_DAYS_CANONICAL = 14


def _tier_index(tier: str) -> int:
    """Return tier index. Unknown tiers default to 'free' (safe default)."""
    if not tier:
        return 0  # guest
    tier_lower = tier.lower().strip()
    if tier_lower in TIER_ORDER:
        return TIER_ORDER.index(tier_lower)
    # Unknown tier → treat as free (safer than admin)
    return 1


def _get_request_tier() -> tuple:
    """Extract (tier, user_id) from request headers.

    Trusted-proxy model: Next.js sends these AFTER authenticating the user.
    If PROXY_API_KEY is missing/invalid → treat as guest (fail-safe for direct calls).
    """
    # If PROXY_API_KEY is configured, require it (trusted proxy check).
    # If not configured (dev mode), allow without it.
    if PROXY_API_KEY:
        provided_key = request.headers.get('X-API-Key', '')
        if provided_key != PROXY_API_KEY:
            # Not from trusted proxy → guest only
            return 'guest', None

    tier = request.headers.get('X-User-Tier', '').lower().strip() or 'guest'
    user_id = request.headers.get('X-User-Id') or None
    return tier, user_id


def _check_trial_active(user_id, fail_closed=False):
    """Check if user's trial is active (trial_ends_at > NOW).

    Args:
        user_id: user ID from X-User-Id header.
        fail_closed: if True (for paid gates), DB errors → deny access (safe).
                     if False (for guest/public reads), DB errors → allow (fail-safe).

    Returns (is_active, reason).
    If user_id is None or trial_ends_at is NULL → (False, 'no_trial').
    """
    if not user_id:
        return False, 'no_user'

    try:
        import sqlite3
        from pathlib import Path
        # Rule 17: relative path to auth.db
        _here = Path(__file__).resolve()
        # vps-service/core/auth_middleware.py → project root = parents[2]
        _project_root = _here.parents[2]
        _auth_db = _project_root / 'db' / 'auth.db'

        if not _auth_db.exists():
            return False, 'auth_db_missing'

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(_auth_db), writable=False).__enter__()
        try:
            row = conn.execute(
                "SELECT subscription_tier, trial_ends_at FROM User WHERE id = ?",
                (user_id,)
            ).fetchone()
            if not row:
                return False, 'user_not_found'

            tier = row[0] or 'free'
            trial_ends_at = row[1]

            # Paid tiers → full access, no trial check
            if tier in ('normal', 'premium', 'pro', 'admin', 'developer', 'enterprise',
                        'b2b_starter', 'b2b_pro', 'b2b_enterprise'):
                return True, 'paid_tier'

            # Free tier → check trial
            if not trial_ends_at:
                return False, 'trial_not_set'  # B-P2 will fix this

            # Parse trial_ends_at (ISO datetime)
            from datetime import datetime
            try:
                ends_at = datetime.fromisoformat(trial_ends_at.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                return False, 'trial_invalid_format'

            is_active = datetime.now(ends_at.tzinfo) < ends_at if ends_at.tzinfo else datetime.now() < ends_at
            return is_active, 'trial_active' if is_active else 'trial_expired'
        finally:
            conn.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"trial check failed for user={user_id}: {e}")
        if fail_closed:
            # BRAVO B-P2 (John directive): fail-CLOSED for paid gates (deny on DB error)
            return False, f'db_error_closed: {e}'
        # fail-SAFE for guest/public reads (allow on DB error)
        return False, f'db_error_safe: {e}'


def require_role(min_tier='guest', require_trial=False):
    """Decorator: enforce minimum subscription tier + optional trial check.

    Args:
        min_tier: minimum tier required ('guest', 'free', 'normal', 'premium', 'pro').
        require_trial: if True, user must have active trial OR paid tier.

    Usage:
        @app.route('/api/market-pulse')  # guest OK (no decorator needed, default)
        @require_role('free')            # registered users only
        @require_role('normal')          # paid users only
        @require_role('normal', require_trial=True)  # paid OR active trial

    Returns 403 if insufficient tier. Returns 402 (Payment Required) if trial expired.
    """
    def decorator(f):
        @functools.wraps(f)
        def wrapped(*args, **kwargs):
            if not AUTH_ENABLED:
                return f(*args, **kwargs)  # dev mode bypass

            tier, user_id = _get_request_tier()

            # Check minimum tier
            if _tier_index(tier) < _tier_index(min_tier):
                return jsonify({
                    'success': False,
                    'error': 'insufficient_tier',
                    'required_tier': min_tier,
                    'current_tier': tier,
                    'error_ar': f'هذه الميزة تتطلب اشتراك {min_tier} أو أعلى'
                }), 403

            # Check trial if required
            if require_trial and tier == 'free':
                is_active, reason = _check_trial_active(user_id)
                if not is_active:
                    return jsonify({
                        'success': False,
                        'error': 'trial_expired',
                        'reason': reason,
                        'error_ar': 'انتهت فترة التجربة. اشترك الآن للوصول الكامل.',
                        'upgrade_required': True
                    }), 402  # Payment Required

            # Store user info in flask g for downstream use
            g.user_tier = tier
            g.user_id = user_id

            return f(*args, **kwargs)
        return wrapped
    return decorator


# Convenience: trial-locked endpoint (free + active trial OR paid)
def require_trial_or_paid(f):
    """Decorator: free tier requires active trial, paid tiers bypass."""
    return require_role('free', require_trial=True)(f)


# ============================================================================
# EXPORT
# ============================================================================

__all__ = [
    'require_admin',
    'require_admin_or_public',
    'require_role',
    'require_trial_or_paid',
    'verify_token',
    '_constant_time_eq',
    'get_client_ip',
    'hash_ip',
    'ADMIN_TOKEN',
    'PROXY_API_KEY',
    'AUTH_ENABLED',
    'TIER_ORDER',
    'TRIAL_DAYS_CANONICAL',
    'AdminSessionTracker',
    'admin_session_tracker'
]

"""
test_phase_a_hotfix.py — اختبارات الـ Phase A Critical Hotfix (SEC-04 + DATA-01)
=============================================================================

الـ tests دي بتتحقق من الإصلاحات الحرجة اللي اتعملت في الـ Hotfix:

SEC-04 — Admin Auth Bypass عبر الـ proxy + ثقة localhost:
  - localhost / loopback ما بقتش auto-authorize (المفروض ترفض من غير token).
  - ADMIN_TOKEN fallback الـ hardcoded 'REDACTED_ADMIN_TOKEN' اتشال (fail closed).
  - الـ PROXY_API_KEY path بيشتغل بس بـ loopback + key صح.
  - verify_token بيرجّع False لو ADMIN_TOKEN فاضي.

DATA-01 — Risk Profile معكوس الاتجاه لإشارات SHORT:
  - TechnicalTargetEngine.calculate(direction='SHORT') بيرجّع target تحت entry
    و stop فوق entry (مش معكوس).
  - R:R للـ SHORT بيتحسب بـ (entry - target) / (stop - entry).

التشغيل:
    cd vps-service && python3 -m pytest tests/test_phase_a_hotfix.py -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Ensure vps-service/ is importable
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))


# ---------------------------------------------------------------------------
# SEC-04: auth_middleware — localhost no longer auto-authorizes
# ---------------------------------------------------------------------------

class TestSEC04AuthMiddleware:
    """اختبارات إغلاق ثغرة الـ Admin Bypass عبر localhost."""

    def test_admin_token_has_no_hardcoded_fallback(self):
        """ADMIN_TOKEN ما يجبش fallback 'REDACTED_ADMIN_TOKEN' — لازم فاضي لو env ناقص."""
        # Re-import fresh to read the current module state
        import importlib
        import core.auth_middleware as am
        importlib.reload(am)
        # When ADMIN_TOKEN env is unset, the module-level constant must be empty.
        # (We can't unset the running process's env, so we check the source-level
        # invariant: the default is '' not 'REDACTED_ADMIN_TOKEN'.)
        import inspect
        src = inspect.getsource(am)
        assert "'REDACTED_ADMIN_TOKEN'" not in src, (
            "SEC-04: hardcoded 'REDACTED_ADMIN_TOKEN' fallback must be removed from auth_middleware.py source"
        )
        assert "os.environ.get('ADMIN_TOKEN', '')" in src, (
            "SEC-04: ADMIN_TOKEN must default to '' (fail closed), not a literal"
        )

    def test_verify_token_returns_false_when_admin_token_empty(self, monkeypatch):
        """verify_token لازم يرجّع False لو ADMIN_TOKEN فاضي (fail closed)."""
        monkeypatch.setattr('core.auth_middleware.ADMIN_TOKEN', '')
        from core.auth_middleware import verify_token
        # Even a non-empty supplied token must fail when ADMIN_TOKEN is unset.
        assert verify_token('anything') is False
        assert verify_token('REDACTED_ADMIN_TOKEN') is False
        assert verify_token('') is False

    def test_verify_token_rejects_old_literal(self, monkeypatch):
        """الـ literal القديم 'REDACTED_ADMIN_TOKEN' ما عادش يقبل كـ admin token."""
        monkeypatch.setattr('core.auth_middleware.ADMIN_TOKEN', 'a-real-secret-token')
        from core.auth_middleware import verify_token
        # The old backdoor literal must NOT authenticate anymore.
        assert verify_token('REDACTED_ADMIN_TOKEN') is False
        # A correct token still works.
        assert verify_token('a-real-secret-token') is True

    def test_require_admin_rejects_loopback_without_token(self, monkeypatch):
        """localhost / 127.0.0.1 ما بقتش auto-authorize — لازم token أو key صحيح."""
        from core.auth_middleware import require_admin
        from flask import Flask

        app = Flask(__name__)
        captured = {}

        @app.route('/api/admin/secret')
        @require_admin
        def secret_endpoint():
            captured['called'] = True
            from flask import jsonify
            return jsonify({"secret": "data"})

        # No ADMIN_TOKEN, no PROXY_API_KEY, request from localhost WITHOUT any auth header
        monkeypatch.setattr('core.auth_middleware.ADMIN_TOKEN', '')
        monkeypatch.setattr('core.auth_middleware.PROXY_API_KEY', '')
        monkeypatch.setattr('core.auth_middleware.AUTH_ENABLED', True)

        with app.test_client() as client:
            # Simulate a request arriving from localhost (the Next.js proxy scenario)
            client.environ_base['REMOTE_ADDR'] = '127.0.0.1'
            resp = client.get('/api/admin/secret')
            assert resp.status_code == 401, (
                f"SEC-04: localhost request without token must be 401, got {resp.status_code}"
            )
            assert captured.get('called') is not True, (
                "SEC-04: the protected endpoint must NOT be reached without auth"
            )

    def test_require_admin_accepts_valid_token_from_any_ip(self, monkeypatch):
        """token صحيح بيقبل من أي IP (الـ token هو السر)."""
        from core.auth_middleware import require_admin
        from flask import Flask

        app = Flask(__name__)
        monkeypatch.setattr('core.auth_middleware.ADMIN_TOKEN', 'ops-secret-token')
        monkeypatch.setattr('core.auth_middleware.PROXY_API_KEY', '')
        monkeypatch.setattr('core.auth_middleware.AUTH_ENABLED', True)

        @app.route('/api/admin/secret')
        @require_admin
        def secret_endpoint():
            from flask import jsonify
            return jsonify({"secret": "data"})

        with app.test_client() as client:
            client.environ_base['REMOTE_ADDR'] = '8.8.8.8'  # non-localhost
            resp = client.get('/api/admin/secret', headers={'X-Admin-Token': 'ops-secret-token'})
            assert resp.status_code == 200, (
                f"valid token from any IP must be 200, got {resp.status_code}"
            )

    def test_require_admin_accepts_proxy_key_only_from_loopback(self, monkeypatch):
        """PROXY_API_KEY يشتغل بس من loopback + key صح (مش من IP خارجي)."""
        from core.auth_middleware import require_admin
        from flask import Flask

        app = Flask(__name__)
        monkeypatch.setattr('core.auth_middleware.ADMIN_TOKEN', '')
        monkeypatch.setattr('core.auth_middleware.PROXY_API_KEY', 'proxy-shared-key')
        monkeypatch.setattr('core.auth_middleware.AUTH_ENABLED', True)

        @app.route('/api/admin/secret')
        @require_admin
        def secret_endpoint():
            from flask import jsonify
            return jsonify({"secret": "data"})

        with app.test_client() as client:
            # loopback + correct key → 200
            client.environ_base['REMOTE_ADDR'] = '127.0.0.1'
            resp = client.get('/api/admin/secret', headers={'X-API-Key': 'proxy-shared-key'})
            assert resp.status_code == 200, (
                f"loopback + valid PROXY_API_KEY must be 200, got {resp.status_code}"
            )

            # non-loopback + correct key → 401 (key only works from loopback)
            client.environ_base['REMOTE_ADDR'] = '8.8.8.8'
            resp2 = client.get('/api/admin/secret', headers={'X-API-Key': 'proxy-shared-key'})
            assert resp2.status_code == 401, (
                f"PROXY_API_KEY from non-loopback must be 401, got {resp2.status_code}"
            )

            # loopback + WRONG key → 401
            client.environ_base['REMOTE_ADDR'] = '127.0.0.1'
            resp3 = client.get('/api/admin/secret', headers={'X-API-Key': 'wrong-key'})
            assert resp3.status_code == 401, (
                f"loopback + wrong key must be 401, got {resp3.status_code}"
            )


# ---------------------------------------------------------------------------
# DATA-01: TechnicalTargetEngine — direction-aware SHORT output
# ---------------------------------------------------------------------------

class TestDATA01DirectionAwareTargetEngine:
    """اختبارات إصلاح عكس إشارات البيع (SHORT direction-aware)."""

    @pytest.fixture
    def engine(self):
        from analyzers.technical_target_engine import TechnicalTargetEngine
        return TechnicalTargetEngine()

    def test_long_direction_target_above_stop_below(self, engine):
        """LONG (default): target فوق entry، stop تحت entry — السلوك الأصلي."""
        result = engine.calculate(
            ticker='TEST',
            entry_price=100.0,
            support=95.0,
            resistance=110.0,
            atr=3.0,
            high_30d=108.0,
            low_30d=94.0,
            volatility=3.0,
            direction='LONG',
        )
        assert result.target_price > 100.0, (
            f"LONG target must be ABOVE entry (100), got {result.target_price}"
        )
        assert result.stop_price < 100.0, (
            f"LONG stop must be BELOW entry (100), got {result.stop_price}"
        )
        assert result.risk_reward > 0

    def test_short_direction_target_below_stop_above(self, engine):
        """SHORT: target تحت entry، stop فوق entry (المشكلة الأساسية اللي اتصلحت)."""
        result = engine.calculate(
            ticker='TEST',
            entry_price=100.0,
            support=95.0,
            resistance=110.0,
            atr=3.0,
            high_30d=108.0,
            low_30d=94.0,
            volatility=3.0,
            direction='SHORT',
        )
        # THE CRITICAL FIX: for SHORT, target must be UNDER entry, stop must be OVER entry
        assert result.target_price < 100.0, (
            f"DATA-01: SHORT target must be BELOW entry (100), got {result.target_price} — "
            f"this was the bug that killed all SELL signals"
        )
        assert result.stop_price > 100.0, (
            f"DATA-01: SHORT stop must be ABOVE entry (100), got {result.stop_price} — "
            f"this was the bug that killed all SELL signals"
        )
        assert result.risk_reward > 0, "SHORT R:R must be positive"

    def test_short_rr_formula_uses_short_geometry(self, engine):
        """R:R للـ SHORT بيستخدم (entry - target) / (stop - entry) — مش الـ LONG formula."""
        result = engine.calculate(
            ticker='TEST',
            entry_price=100.0,
            support=94.0,
            resistance=110.0,
            atr=3.0,
            high_30d=108.0,
            low_30d=93.0,
            volatility=3.0,
            direction='SHORT',
        )
        # Manually compute the expected SHORT R:R from the final values
        expected_risk = result.stop_price - 100.0    # stop above entry
        expected_reward = 100.0 - result.target_price  # entry above target
        if expected_risk > 0:
            expected_rr = round(expected_reward / expected_risk, 2)
            assert abs(result.risk_reward - expected_rr) < 0.1, (
                f"SHORT R:R must use (entry-target)/(stop-entry) = {expected_rr}, "
                f"got {result.risk_reward}"
            )

    def test_short_method_trace_marks_swap(self, engine):
        """الـ method trace بيوثّق إن الـ swap حصل (SHORT suffix)."""
        result = engine.calculate(
            ticker='TEST',
            entry_price=100.0,
            support=95.0,
            resistance=110.0,
            atr=3.0,
            volatility=3.0,
            direction='SHORT',
        )
        # The SHORT suffix documents that the swap was applied
        assert 'SHORT' in (result.stop_method or '') or 'SHORT' in (result.target_method or ''), (
            f"SHORT method trace must mark the swap, got stop_method={result.stop_method!r}, "
            f"target_method={result.target_method!r}"
        )

    def test_sell_signals_recognized_as_short(self):
        """إشارات الـ SELL family كلها لازم تتعامل كـ SHORT direction."""
        from analyzers.risk_adaptive import SELL_SIGNALS
        # Sanity: the SELL family is non-empty and includes the key signals
        assert 'SELL' in SELL_SIGNALS
        assert 'STRONG_SELL' in SELL_SIGNALS
        assert 'REDUCE' in SELL_SIGNALS
        assert 'SHORT' in SELL_SIGNALS

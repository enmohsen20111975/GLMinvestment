"""
conftest.py — إعدادات pytest المشتركة (Phase 5 — Testing & QA)
================================================================

الـ fixture ده بيوّفر:
  1. إضافة `vps-service/` لـ sys.path عشان الـ imports زي `from core.x import y`
     تشتغل من أي مكان بتنفذ فيه pytest.
  2. قمع الـ logging noise أثناء الاختبارات (CAPLOG).
  3. توفير cwd = vps-service/ (مطلوب عشان مسارات الـ DB النسبية تظبط).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# ── 1) أضف vps-service/ لـ sys.path ──
# pytest بيتشغّل عادة من جوا vps-service/ أو من الـ project root.
# لو اشتغل من الـ root، الـ imports زي `from core.data_source_circuit_breaker import ...` هتفشل
# عشان الـ package مش في الـ path. هنا بنضيف الـ vps-service dir.
_VPS_DIR = Path(__file__).resolve().parent  # vps-service/tests/
_VPS_ROOT = _VPS_DIR.parent                # vps-service/
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

# ── 2) cwd = vps-service/ (عشان مسارات الـ DB النسبية) ──
# الـ DBManager بيقرأ مسارات زي `db/stocks.db` من utils/db_paths.py. المسارات دي
# relative لـ vps-service/. لو pytest اشتغل من مكان تاني، الـ reads هتفشل.
# بنغيّر الـ cwd بس لو احنا لسه في الـ project root.
os.chdir(_VPS_ROOT)

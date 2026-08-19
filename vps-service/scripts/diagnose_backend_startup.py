#!/usr/bin/env python3
"""
Backend Startup Diagnostic
==========================
يساعد في تشخيص لماذا الـ Python Backend (port 8010) مش عايز يشتغل.

بيجرّب استيراد كل dependency و module واحد واحد، وبيطبع PASS/FAIL لكل واحد.
لو فيه فشل، بيوضّح بالظبط أي module ناقص أو فيه خطأ.

الاستخدام:
    cd vps-service
    python3 scripts/diagnose_backend_startup.py

أو من جذر المشروع:
    python3 vps-service/scripts/diagnose_backend_startup.py
"""

import sys
import os
import importlib
import traceback
from pathlib import Path

# Ensure vps-service is on the path
SCRIPT_DIR = Path(__file__).resolve().parent
VPS_SERVICE = SCRIPT_DIR.parent
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(VPS_SERVICE / "ai"))

os.chdir(VPS_SERVICE)

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

results = {"pass": 0, "fail": 0, "warn": 0}


def check(label, fn, fatal=False):
    try:
        fn()
        print(f"  {GREEN}✓ PASS{RESET}  {label}")
        results["pass"] += 1
        return True
    except Exception as e:
        tb = traceback.format_exc().splitlines()
        # Find the most relevant line
        relevant = [l for l in tb if "File \"" in l or "Error" in l or "error" in l]
        print(f"  {RED}✗ FAIL{RESET}  {label}")
        print(f"          {type(e).__name__}: {e}")
        for l in relevant[-3:]:
            print(f"          {l.strip()}")
        results["fail"] += 1
        if fatal:
            print(f"\n{RED}*** FATAL: لا يمكن المتابعة بدون {label} ***{RESET}")
            return False
        return False


def check_warn(label, fn):
    try:
        fn()
        print(f"  {YELLOW}~ WARN{RESET}  {label} (non-fatal)")
        results["warn"] += 1
    except Exception as e:
        print(f"  {RED}✗ FAIL{RESET}  {label}: {type(e).__name__}: {e}")
        results["fail"] += 1


print("=" * 70)
print(" BACKEND STARTUP DIAGNOSTIC")
print("=" * 70)
print(f" Python:    {sys.executable} ({sys.version.split()[0]})")
print(f" vps-service: {VPS_SERVICE}")
print(f" CWD:       {os.getcwd()}")
print()

# ── 1. Core dependencies (FATAL if missing) ──
print("── [1] Core Dependencies ──────────────────────────────────────────")

check("flask", lambda: __import__("flask"), fatal=True)
check("flask_cors", lambda: __import__("flask_cors"), fatal=True)
check("fastapi", lambda: __import__("fastapi"), fatal=True)
check("uvicorn", lambda: __import__("uvicorn"), fatal=True)

# ── 2. Optional dependencies (WARN if missing) ──
print()
print("── [2] Optional Dependencies (non-fatal) ────────────────────────")

check_warn("pytz", lambda: __import__("pytz"))
check_warn("apscheduler", lambda: __import__("apscheduler"))
check_warn("requests", lambda: __import__("requests"))
check_warn("sqlite3", lambda: __import__("sqlite3"))
check_warn("numpy", lambda: __import__("numpy"))
check_warn("pandas", lambda: __import__("pandas"))

# ── 3. core/ modules ──
print()
print("── [3] core/ Modules ────────────────────────────────────────────")

check("core.logging_config", lambda: __import__("core.logging_config", fromlist=["setup_logging"]))
check("core.migrator", lambda: __import__("core.migrator", fromlist=["run_migrations"]))
check("core.scheduler_manager", lambda: __import__("core.scheduler_manager", fromlist=["scheduler_manager"]))

# ── 4. main.py app construction ──
print()
print("── [4] main.py App Construction ─────────────────────────────────")

def build_app():
    from main import app as fastapi_app
    return fastapi_app

check("main:app (FastAPI)", build_app)

# ── 5. lightweight_server (Flask app) ──
print()
print("── [5] lightweight_server (Flask WSGI) ───────────────────────────")

def import_flask_app():
    from lightweight_server import app as flask_app
    return flask_app

check("lightweight_server:app (Flask)", import_flask_app)

# ── 6. Blueprint imports (each one) ──
print()
print("── [6] Blueprint Module Imports ─────────────────────────────────")

BLUEPRINTS = [
    ('api.chart_routes', 'chart_bp'),
    ('api.stock_analysis_routes', 'stock_analysis_bp'),
    ('api.public_routes', 'public_bp'),
    ('api.stored_analysis_routes', 'stored_analysis_bp'),
    ('api.v2_routes', 'v2_bp'),
    ('api.unified_v2_routes', 'unified_v2_bp'),
    ('api.confluence_routes', 'confluence_bp'),
    ('api.screener_routes', 'screener_bp'),
    ('api.ai_predictions_routes', 'ai_predictions_bp'),
    ('api.prediction_tracking_routes', 'prediction_tracking_bp'),
    ('api.maestro_routes', 'maestro_bp'),
    ('api.sniper_routes', 'sniper_bp'),
    ('api.reports_routes', 'reports_bp'),
    ('api.risk_routes', 'risk_bp'),
    ('api.learning_routes', 'learning_bp'),
    ('api.unified_learning_routes', 'learning_bp'),
    ('api.optimizer_params_routes', 'optimizer_params_bp'),
    ('api.news_routes', 'news_bp'),
    ('api.telegram_routes', 'telegram_bp'),
    ('api.portfolio_routes', 'portfolio_bp'),
    ('api.misc_routes', 'misc_bp'),
    ('api.admin_routes', 'admin_bp'),
    ('api.analytics', 'analytics_bp'),
    ('api.professional_analysis_routes', 'prof_analysis_bp'),
    ('api.stocks', 'stocks_bp'),
    ('api.regime_routes', 'regime_bp'),
    ('api.scanner_routes', 'scanner_bp'),
    ('api.persona_routes', 'persona_bp'),
    ('api.ai_routes', 'ai_bp'),
    ('api.expert_memory_v4_routes', 'v4_bp'),
    ('api.admin_engine_settings_routes', 'admin_engine_settings_bp'),
    ('api.historical_predictions_v2_routes', 'historical_preds_v2_bp'),
    ('api.picks_management_routes', 'picks_mgmt_bp'),
    ('api.v38_backtest_routes', 'v38_backtest_bp'),
]

for mod_name, bp_name in BLUEPRINTS:
    def _imp(mod_name=mod_name, bp_name=bp_name):
        mod = importlib.import_module(mod_name)
        getattr(mod, bp_name)
    check(f"{mod_name}:{bp_name}", _imp)

# ── 7. Database files ──
print()
print("── [7] Database Files ───────────────────────────────────────────")

DB_DIR = VPS_SERVICE.parent / "db"
for db_file in ["predictions.db", "stocks.db", "price_history.db"]:
    p = DB_DIR / db_file
    if p.exists():
        size = p.stat().st_size
        print(f"  {GREEN}✓ EXISTS{RESET}  {db_file} ({size/1024:.0f} KB)")
        results["pass"] += 1
    else:
        print(f"  {YELLOW}~ MISSING{RESET}  {db_file} (سيُنشأ عند الحاجة)")
        results["warn"] += 1

# ── 8. Port 8010 check ──
print()
print("── [8] Port 8010 Status ─────────────────────────────────────────")

import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(1)
try:
    result = sock.connect_ex(("127.0.0.1", 8010))
    if result == 0:
        print(f"  {YELLOW}~ IN USE{RESET}  Port 8010 مشغول بالفعل — لو الـ backend مش شغال،")
        print(f"           فيه zombie process. اقفله بـ: pm2 stop python-backend && pm2 delete python-backend")
        print(f"           أو: fuser -k 8010/tcp")
        results["warn"] += 1
    else:
        print(f"  {GREEN}✓ FREE{RESET}   Port 8010 متاح — الـ backend يقدر يشتغل عليه")
        results["pass"] += 1
finally:
    sock.close()

# ── Summary ──
print()
print("=" * 70)
total = results["pass"] + results["fail"] + results["warn"]
print(f" ملخص: {GREEN}{results['pass']} PASS{RESET} | {RED}{results['fail']} FAIL{RESET} | {YELLOW}{results['warn']} WARN{RESET} / {total}")
print("=" * 70)

if results["fail"] > 0:
    print(f"\n{RED}❌ فيه {results['fail']} مشكلة لازم تتحل قبل ما الـ backend يشتغل.{RESET}")
    print(f"{YELLOW}الحلول الشائعة:{RESET}")
    print(f"  - لو flask/flask_cors ناقص: pip install flask flask-cors")
    print(f"  - لو الـ venv مش موجود: python3 -m venv vps-service/.venv")
    print(f"  - لو module معين فشل: شوف الخطأ فوق وصلحه في الكود")
    print(f"  - لو port 8010 مشغول: pm2 stop python-backend && pm2 delete python-backend")
    sys.exit(1)
else:
    print(f"\n{GREEN}✅ كل الـ imports سليمة! الـ backend لازم يشتغل.{RESET}")
    print(f"{YELLOW}لو مع ذلك مش شغال، شوف اللوج:{RESET}")
    print(f"  pm2 logs python-backend --lines 50")
    print(f"  أو: cat logs/python-backend-error.log | tail -50")
    sys.exit(0)

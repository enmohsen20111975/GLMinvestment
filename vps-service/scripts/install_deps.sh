#!/bin/bash
# ============================================================
# تثبيت اعتماديات Python Backend
# ============================================================
# يشغل هذا السكريبت مرة واحدة على السيربر لتثبيت كل الحزم المطلوبة
# ============================================================
# ملاحظة PEP 668: على Debian/Ubuntu 12+ بيظهر خطأ
#   "externally-managed-environment" يمنع تثبيت pip على مستوى النظام.
# نتعامل معه تلقائياً بإضافة --break-system-packages عند الحاجة.
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT/vps-service"

echo "============================================================"
echo "  تثبيت اعتماديات Python Backend"
echo "============================================================"
echo "  Project: $PROJECT_ROOT"
echo "  Python:  $(python3 --version 2>&1)"
echo "============================================================"
echo ""

# ============================================================
# اكتشاف PEP 668 (externally-managed-environment)
# ============================================================
# لو ملف EXTERNALLY-MANAGED موجود → نضيف --break-system-packages
PIP_FLAGS=""
if [ -f "$(python3 -c 'import sysconfig; print(sysconfig.get_path("stdlib"))' 2>/dev/null)/EXTERNALLY-MANAGED" ]; then
    echo "[i] اكتُشف PEP 668 (externally-managed) — استخدام --break-system-packages"
    PIP_FLAGS="--break-system-packages"
fi

# تحديث pip
echo "[1/5] تحديث pip..."
python3 -m pip install --upgrade pip --quiet $PIP_FLAGS

# تثبيت الحزم الأساسية
echo "[2/5] تثبيت Flask و CORS..."
python3 -m pip install flask flask-cors --quiet $PIP_FLAGS

echo "[3/5] تثبيت tenacity (HTTP retry)..."
python3 -m pip install tenacity --quiet $PIP_FLAGS

echo "[4/5] تثبيت tradingview_ta (الأسعار اللحظية)..."
python3 -m pip install tradingview_ta --quiet $PIP_FLAGS

echo "[5/5] تثبيت باقي الحزم من requirements.txt..."
python3 -m pip install -r requirements.txt --quiet $PIP_FLAGS

echo ""
echo "============================================================"
echo "  ✅ تم تثبيت كل الاعتماديات بنجاح"
echo "============================================================"
echo ""

# التحقق من التثبيت
echo "التحقق من التثبيت:"
python3 -c "
import flask; print(f'  ✓ flask {flask.__version__}')
import flask_cors; print('  ✓ flask-cors')
import tenacity; print(f'  ✓ tenacity {tenacity.__version__}')
try:
    import tradingview_ta; print('  ✓ tradingview_ta')
except ImportError:
    print('  ⚠ tradingview_ta غير مثبت (EODHD سيعمل كـ fallback)')
try:
    import telethon; print(f'  ✓ telethon {telethon.__version__}')
except ImportError:
    print('  ⚠ telethon غير مثبت (Telegram auto-post معطل)')
try:
    import httpx; print(f'  ✓ httpx {httpx.__version__}')
except ImportError:
    print('  ✗ httpx غير مثبت — طبقة AI معطّلة! شغّل: pip install --break-system-packages httpx')
"

echo ""

# ============================================================
# إعداد Ollama + النماذج (AI / RAG) — آمن إعادة تشغيله
# ============================================================
echo "============================================================"
echo "  إعداد Ollama + glm-fast (AI engine)"
echo "============================================================"
if [ -f "$PROJECT_ROOT/vps-service/scripts/setup_ollama.sh" ]; then
    bash "$PROJECT_ROOT/vps-service/scripts/setup_ollama.sh" || {
        echo "  ⚠ تعذّر إعداد Ollama تلقائياً — الكود سيعمل بـ smart fallback."
        echo "    شغّل يدوياً لاحقاً: bash vps-service/scripts/setup_ollama.sh"
    }
else
    echo "  ⚠ setup_ollama.sh غير موجود — تخطّي إعداد AI."
fi

echo ""
echo "الخطوة التالية:"
echo "  pm2 restart python-backend"
echo ""

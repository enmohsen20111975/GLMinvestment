#!/bin/bash
# ============================================================================
# setup_ollama.sh — تثبيت وتشغيل Ollama + تحميل النماذج تلقائياً
# ============================================================================
# هذا السكربت "idempotent" — آمن إعادة تشغيله أي عدد من المرات.
# يعمل التالي بالترتيب:
#   1. يتحقق من تثبيت Ollama — يثبّته لو مش موجود
#   2. يتأكد إن خدمة Ollama شغّالة (systemd أو nohup fallback)
#   3. يعمل pull لـ qwen2.5:1.5b لو مش محمّل
#   4. يبني النموذج المخصّص glm-fast من Modelfile.qwen لو مش موجود
#   5. يعمل smoke test للنموذج
#
# الاستخدام:
#   bash vps-service/scripts/setup_ollama.sh
#   # أو مع sudo لو محتاج تثبيت systemd service:
#   sudo bash vps-service/scripts/setup_ollama.sh
# ============================================================================

set -euo pipefail

# ---------- ألوان ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

# ---------- متغيرات ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODELFILE="$PROJECT_ROOT/models/Modelfile.qwen"
LOG_DIR="$PROJECT_ROOT/logs"

BASE_MODEL="qwen2.5:1.5b"
CUSTOM_MODEL="glm-fast"
OLLAMA_URL="http://127.0.0.1:11434"

mkdir -p "$LOG_DIR"

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  setup_ollama.sh — Ollama + glm-fast Auto-Setup${NC}"
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  Project root : $PROJECT_ROOT${NC}"
echo -e "${CYAN}  Modelfile    : $MODELFILE${NC}"
echo -e "${CYAN}  Ollama URL   : $OLLAMA_URL${NC}"
echo -e "${CYAN}  Base model   : $BASE_MODEL${NC}"
echo -e "${CYAN}  Custom model : $CUSTOM_MODEL${NC}"
echo -e "${CYAN}------------------------------------------------------------${NC}"
echo ""

# ============================================================
# 1) التحقق من تثبيت Ollama
# ============================================================
info "الخطوة 1/5: التحقق من تثبيت Ollama..."
if command -v ollama &>/dev/null; then
  OLLAMA_VER="$(ollama --version 2>&1 | head -1)"
  log "Ollama مثبّت بالفعل: $OLLAMA_VER"
else
  warn "Ollama غير مثبّت — جارٍ التثبيت من الموقع الرسمي..."
  if command -v curl &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
  elif command -v wget &>/dev/null; then
    wget -qO- https://ollama.com/install.sh | sh
  else
    err "لا يوجد curl أو wget — لا يمكن تثبيت Ollama تلقائياً."
    err "ثبّت يدوياً: curl -fsSL https://ollama.com/install.sh | sh"
    exit 1
  fi

  # التحقق من نجاح التثبيت
  if ! command -v ollama &>/dev/null; then
    err "فشل التثبيت — ollama غير موجود في PATH بعد التثبيت."
    err "جرّب: sudo bash $0"
    exit 1
  fi
  OLLAMA_VER="$(ollama --version 2>&1 | head -1)"
  log "تم تثبيت Ollama بنجاح: $OLLAMA_VER"
fi

# ============================================================
# 2) التأكد من تشغيل خدمة Ollama
# ============================================================
info "الخطوة 2/5: التأكد من تشغيل خدمة Ollama..."

ollama_is_up() {
  curl -sf "$OLLAMA_URL/api/tags" &>/dev/null
}

if ollama_is_up; then
  log "Ollama يستجيب على $OLLAMA_URL"
else
  warn "Ollama لا يستجيب — محاولة التشغيل..."

  # الأول: جرّب systemd (الأنسب على VPS)
  if command -v systemctl &>/dev/null && systemctl list-unit-files 2>/dev/null | grep -q "^ollama.service"; then
    info "تم اكتشاف systemd unit — تشغيل عبر systemctl..."
    sudo systemctl start ollama 2>/dev/null || systemctl start ollama 2>/dev/null || true
    sudo systemctl enable ollama 2>/dev/null || true
  fi

  # لو لسه مش شغّال، شغّل nohup fallback
  if ! ollama_is_up; then
    warn "systemd غير متاح أو فشل — تشغيل 'ollama serve' في الخلفية..."
    nohup ollama serve > "$LOG_DIR/ollama.log" 2>&1 &
    echo $! > "$LOG_DIR/ollama.pid"
    info "PID: $(cat "$LOG_DIR/ollama.pid") — السجل: $LOG_DIR/ollama.log"
  fi

  # انتظار حتى الاستجابة (حد أقصى 40 ثانية)
  info "انتظار جاهزية Ollama..."
  for i in $(seq 1 40); do
    if ollama_is_up; then
      log "Ollama أصبح جاهزاً بعد ${i}s"
      break
    fi
    sleep 1
    if [ "$i" -eq 40 ]; then
      err "Ollama لم يستجب خلال 40 ثانية. افحص السجل:"
      err "  tail -50 $LOG_DIR/ollama.log"
      exit 1
    fi
  done
fi

# ============================================================
# 3) تحميل النموذج الأساسي qwen2.5:1.5b
# ============================================================
info "الخطوة 3/5: التحقق من تحميل النموذج الأساسي '$BASE_MODEL'..."

# قائمة النماذج المحمّلة (العمود الأول فقط، مع تجاهل سطر العنوان)
list_models() {
  ollama list 2>/dev/null | awk 'NR>1 {print $1}'
}

if list_models | grep -qxF "$BASE_MODEL"; then
  log "النموذج '$BASE_MODEL' محمّل بالفعل"
else
  warn "النموذج '$BASE_MODEL' غير محمّل — جارٍ التحميل (~1GB، قد يستغرق عدة دقائق)..."
  if ollama pull "$BASE_MODEL"; then
    log "تم تحميل '$BASE_MODEL' بنجاح"
  else
    err "فشل تحميل '$BASE_MODEL'. تحقق من الاتصال بالإنترنت وحاول مجدداً."
    exit 1
  fi
fi

# ============================================================
# 4) بناء النموذج المخصّص glm-fast من Modelfile
# ============================================================
info "الخطوة 4/5: التحقق من وجود النموذج المخصّص '$CUSTOM_MODEL'..."

if list_models | grep -qxF "$CUSTOM_MODEL"; then
  log "النموذج '$CUSTOM_MODEL' مُسجّل بالفعل"
else
  if [ ! -f "$MODELFILE" ]; then
    err "الـ Modelfile غير موجود في: $MODELFILE"
    err "لا يمكن بناء النموذج المخصّص بدون Modelfile."
    exit 1
  fi
  warn "النموذج '$CUSTOM_MODEL' غير موجود — بناؤه من Modelfile..."
  if ollama create "$CUSTOM_MODEL" -f "$MODELFILE"; then
    log "تم بناء '$CUSTOM_MODEL' بنجاح"
  else
    err "فشل بناء '$CUSTOM_MODEL'. افحص Modelfile وحاول مجدداً."
    err "  Modelfile: $MODELFILE"
    exit 1
  fi
fi

# ============================================================
# 5) Smoke test + ملخّص نهائي
# ============================================================
info "الخطوة 5/5: اختبار سريع للنموذج '$CUSTOM_MODEL'..."

TEST_PROMPT="مرحباً، اكتب سطر واحد تأكيد أنك جاهز لتحليل الأسواق المالية."
TEST_OUTPUT="$(echo "$TEST_PROMPT" | ollama run "$CUSTOM_MODEL" 2>&1 | head -5 || true)"

if [ -n "$TEST_OUTPUT" ]; then
  log "النموذج يستجيب. عيّنة من المخرجات:"
  echo -e "${CYAN}  > ${TEST_OUTPUT}${NC}"
else
  err "النموذج لم يُرجع أي مخرجات — قد تكون مشكلة في الذاكرة أو في النموذج."
  err "افحص: ollama run $CUSTOM_MODEL"
fi

# ---------- ملخّص نهائي ----------
echo ""
echo -e "${CYAN}------------------------------------------------------------${NC}"
echo -e "${CYAN}  النماذج المتاحة حالياً:${NC}"
ollama list
echo -e "${CYAN}------------------------------------------------------------${NC}"
echo ""
log "✅ اكتمل إعداد Ollama بنجاح."
info "رابط الخدمة: $OLLAMA_URL"
info "السجل (لو fallback): $LOG_DIR/ollama.log"
info ""
info "لجعل Ollama يبدأ تلقائياً مع إقلاع الخادم:"
info "  sudo systemctl enable ollama   # (لو systemd متاح)"
info ""
info "لإعادة التشغيل اليدوي لاحقاً:"
info "  bash $0"

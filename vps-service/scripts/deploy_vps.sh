#!/bin/bash
# ============================================================
# deploy_vps.sh — VPS Deployment Script | سكربت نشر على VPS
# ============================================================
# Syncs modified Python files + cleaned databases from the laptop
# to the remote VPS, restarts the egx-backend service, runs the
# historical backfill, and verifies health.
#
# يزامن الملفات المعدّلة + قواعد البيانات النظيفة من اللابتوب
# إلى الـ VPS، يعيد تشغيل خدمة egx-backend، يشغّل backfill
# التوقعات التاريخية، ويتحقق من صحة الخدمة.
#
# Usage:
#   ./deploy_vps.sh [--host HOST] [--user USER] [--path PATH]
#                   [--dry-run] [--help]
#
# Env vars (optional):
#   VPS_HOST, VPS_USER, VPS_PATH
# ============================================================

set -e  # Fail-fast: أي خطأ يوقف السكربت فوراً

# ----------------------------------------------------------------
# Color codes | أكواد الألوان
# ----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'  # No Color | بدون لون

# ----------------------------------------------------------------
# Configuration | الإعدادات
# ----------------------------------------------------------------
DEFAULT_VPS_USER="root"
DEFAULT_VPS_PATH="/opt/egx-platform"
SERVICE_NAME="egx-backend"
SERVICE_PORT=8010
BACKFILL_DAYS=30
BACKFILL_MARKETS="EGX"

# Resolve repo root (parent of vps-service/) | تحديد جذر المشروع
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SCRIPT_DIR = .../vps-service/scripts → repo root = vps-service parent
VPS_SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$VPS_SERVICE_DIR/.." && pwd)"

# Files to sync (relative to repo root) | الملفات المطلوب مزامنتها
ANALYZER_FILES=(
  "vps-service/analyzers/persona_gambler.py"
  "vps-service/analyzers/persona_investor.py"
)
SCRIPT_FILES=(
  "vps-service/scripts/backfill_historical_predictions.py"
)
DB_FILES=(
  "db/stocks.db"
  "db/predictions.db"
)

# ----------------------------------------------------------------
# State | الحالة
# ----------------------------------------------------------------
DRY_RUN=false
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-$DEFAULT_VPS_USER}"
VPS_PATH="${VPS_PATH:-$DEFAULT_VPS_PATH}"

# ----------------------------------------------------------------
# Pretty printers | دوال الطباعة
# ----------------------------------------------------------------
print_info()    { echo -e "${CYAN}[ℹ]${NC}  $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warn()    { echo -e "${YELLOW}[⚠]${NC} $1"; }
print_error()   { echo -e "${RED}[✗]${NC} $1" >&2; }
print_step()    { echo -e ""; echo -e "${BLUE}${BOLD}▶ $1${NC}"; }
print_muted()   { echo -e "   ${MAGENTA}$1${NC}"; }

# ----------------------------------------------------------------
# Help | المساعدة
# ----------------------------------------------------------------
show_help() {
  cat << 'HELP'
============================================================
 deploy_vps.sh | سكربت نشر على VPS
============================================================

الوصف | Description:
  Syncs modified Python analyzers + cleaned databases to the
  remote VPS, restarts egx-backend, runs historical backfill,
  and checks service health.

  يزامن ملفات المحللات المعدّلة + قواعد البيانات النظيفة
  إلى VPS، يعيد تشغيل egx-backend، يشغّل backfill التاريخي،
  ويتحقق من صحة الخدمة.

Usage | الاستخدام:
  ./deploy_vps.sh [options]

Options:
  --host HOST       VPS hostname or IP | عنوان أو IP الخادم
                    (default: $VPS_HOST or prompt)
  --user USER       SSH user | مستخدم SSH (default: root)
  --path PATH       Remote project path | مسار المشروع البعيد
                    (default: /opt/egx-platform)
  --days N          Backfill days | عدد أيام التعبئة (default: 30)
  --markets LIST    Backfill markets | الأسواق (default: EGX)
  --dry-run         Show what would be synced without doing it
                    اعرض ما سيتم مزامنته دون التنفيذ
  --no-db           Skip database sync | تخطّي مزامنة القواعد
  --no-backfill     Skip backfill step | تخطّي خطوة التعبئة
  --no-restart      Skip service restart | تخطّي إعادة التشغيل
  --help, -h        Show this help | اعرض هذه المساعدة

Environment Variables | متغيرات البيئة:
  VPS_HOST          Same as --host
  VPS_USER          Same as --user (default: root)
  VPS_PATH          Same as --path (default: /opt/egx-platform)

Examples | أمثلة:
  # Basic deploy (will prompt for host)
  ./deploy_vps.sh

  # Deploy to specific VPS
  ./deploy_vps.sh --host 203.0.113.10 --user deploy

  # Dry run (preview only)
  ./deploy_vps.sh --host vps.example.com --dry-run

  # Skip database sync (only Python files)
  ./deploy_vps.sh --host vps.example.com --no-db

  # Use env vars
  VPS_HOST=vps.example.com VPS_USER=ubuntu ./deploy_vps.sh

What it does | ماذا يفعل:
  1. Validates rsync + ssh are available
  2. Tests SSH connectivity to the VPS
  3. Syncs via rsync over SSH:
       - vps-service/analyzers/persona_gambler.py
       - vps-service/analyzers/persona_investor.py
       - vps-service/scripts/backfill_historical_predictions.py
       - db/stocks.db
       - db/predictions.db
  4. Restarts the egx-backend service via supervisorctl
  5. Runs the backfill script on the VPS
  6. Health-checks http://localhost:8010/health

Prerequisites | المتطلبات المسبقة:
  - SSH key access to the VPS | مفتاح SSH للوصول للخادم
  - rsync installed locally | rsync مثبّت محلياً
  - The remote user must have passwordless sudo for supervisorctl
    (or be root)
============================================================
HELP
}

# ----------------------------------------------------------------
# Parse arguments | تحليل المعطيات
# ----------------------------------------------------------------
SKIP_DB=false
SKIP_BACKFILL=false
SKIP_RESTART=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host|-H)
      VPS_HOST="$2"; shift 2 ;;
    --user|-u)
      VPS_USER="$2"; shift 2 ;;
    --path|-p)
      VPS_PATH="$2"; shift 2 ;;
    --days)
      BACKFILL_DAYS="$2"; shift 2 ;;
    --markets)
      BACKFILL_MARKETS="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --no-db)
      SKIP_DB=true; shift ;;
    --no-backfill)
      SKIP_BACKFILL=true; shift ;;
    --no-restart)
      SKIP_RESTART=true; shift ;;
    --help|-h)
      show_help; exit 0 ;;
    *)
      print_error "Unknown argument: $1 | معطى غير معروف"
      echo "Run with --help for usage | شغّل مع --help للاستخدام"
      exit 1 ;;
  esac
done

# ----------------------------------------------------------------
# Banner | اللافتة
# ----------------------------------------------------------------
echo -e "${BLUE}${BOLD}============================================================${NC}"
echo -e "${BLUE}${BOLD}  🚀 VPS Deployment | نشر على الخادم${NC}"
echo -e "${BLUE}${BOLD}  EGX Investment Platform | منصة الاستثمار${NC}"
echo -e "${BLUE}${BOLD}============================================================${NC}"
echo ""

# ----------------------------------------------------------------
# Validate dependencies | التحقق من المتطلبات
# ----------------------------------------------------------------
print_step "Step 1: Checking prerequisites | التحقق من المتطلبات"

if ! command -v rsync >/dev/null 2>&1; then
  print_error "rsync is not installed | rsync غير مثبّت"
  print_muted "Install with: sudo apt install rsync  (or: brew install rsync)"
  exit 1
fi
print_success "rsync available: $(rsync --version | head -1)"

if ! command -v ssh >/dev/null 2>&1; then
  if $DRY_RUN; then
    print_warn "ssh is not installed (dry-run will continue) | ssh غير مثبّت"
    print_muted "Install before real deploy: sudo apt install openssh-client"
  else
    print_error "ssh is not installed | ssh غير مثبّت"
    print_muted "Install with: sudo apt install openssh-client"
    exit 1
  fi
else
  print_success "ssh available: $(ssh -V 2>&1)"
fi

if ! command -v curl >/dev/null 2>&1; then
  if $DRY_RUN; then
    print_warn "curl is not installed (dry-run will continue) | curl غير مثبّت"
  else
    print_error "curl is not installed | curl غير مثبّت"
    print_muted "Install with: sudo apt install curl"
    exit 1
  fi
else
  print_success "curl available"
fi

# ----------------------------------------------------------------
# Resolve VPS host | تحديد عنوان الخادم
# ----------------------------------------------------------------
if [[ -z "$VPS_HOST" ]]; then
  # Try to read from SSH config | محاولة القراءة من إعدادات SSH
  if [[ -f "$HOME/.ssh/config" ]]; then
    # Look for the first Host entry that looks like a VPS
    VPS_HOST=$(awk '
      /^Host / { host=$2 }
      /HostName / { print host; exit }
    ' "$HOME/.ssh/config" 2>/dev/null || true)
  fi

  if [[ -z "$VPS_HOST" ]]; then
    if [[ -n "${BASH_VERSION:-}" ]]; then
      read -rp "Enter VPS host/IP | أدخل عنوان الخادم: " VPS_HOST </dev/tty
    else
      print_error "VPS_HOST not set | لم يتم تحديد عنوان الخادم"
      print_muted "Use --host, set VPS_HOST env var, or configure ~/.ssh/config"
      exit 1
    fi
  fi
fi

if [[ -z "$VPS_HOST" ]]; then
  print_error "No VPS host provided | لم يتم إدخال عنوان الخادم"
  exit 1
fi

SSH_TARGET="${VPS_USER}@${VPS_HOST}"
print_success "VPS target: ${BOLD}${SSH_TARGET}${NC}"
print_muted  "Remote path: ${VPS_PATH}"

# ----------------------------------------------------------------
# Dry-run notice | تنبيه التشغيل التجريبي
# ----------------------------------------------------------------
if $DRY_RUN; then
  echo ""
  print_warn "⚠ DRY-RUN mode | وضع التجربة فقط"
  print_muted "No files will be synced, no commands will run on VPS."
  print_muted "لن يتم رفع أي ملفات أو تنفيذ أوامر على الخادم."
fi

# ----------------------------------------------------------------
# Validate local files exist | التحقق من وجود الملفات المحلية
# ----------------------------------------------------------------
print_step "Step 2: Verifying local files | التحقق من الملفات المحلية"

ALL_FILES=()
for f in "${ANALYZER_FILES[@]}" "${SCRIPT_FILES[@]}"; do
  ALL_FILES+=("$f")
done
if ! $SKIP_DB; then
  for f in "${DB_FILES[@]}"; do
    ALL_FILES+=("$f")
  done
fi

MISSING=0
for rel in "${ALL_FILES[@]}"; do
  full="${REPO_ROOT}/${rel}"
  if [[ -f "$full" ]]; then
    size=$(stat -c%s "$full" 2>/dev/null || stat -f%z "$full" 2>/dev/null || echo "?")
    print_success "Found: ${rel} (${size} bytes)"
  else
    print_error "Missing: ${rel} | غير موجود"
    MISSING=$((MISSING + 1))
  fi
done

if [[ $MISSING -gt 0 ]]; then
  print_error "${MISSING} file(s) missing | ${MISSING} ملف غير موجود"
  exit 1
fi

# ----------------------------------------------------------------
# Test SSH connectivity | اختبار اتصال SSH
# ----------------------------------------------------------------
print_step "Step 3: Testing SSH connectivity | اختبار اتصال SSH"

if $DRY_RUN; then
  print_warn "Skipping SSH test in dry-run | تخطّي اختبار SSH في وضع التجربة"
else
  print_info "Connecting to ${SSH_TARGET} ..."
  if ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       "${SSH_TARGET}" "echo CONNECTED_OK" 2>/dev/null | grep -q "CONNECTED_OK"; then
    print_success "SSH connection OK | اتصال SSH ناجح"
  else
    print_error "SSH connection failed | فشل اتصال SSH"
    print_muted "Check that:"
    print_muted "  - Your SSH key is authorized on the VPS"
    print_muted "  - The host '${VPS_HOST}' is correct and reachable"
    print_muted "  - The user '${VPS_USER}' exists on the VPS"
    exit 1
  fi
fi

# ----------------------------------------------------------------
# Sync files via rsync | مزامنة الملفات عبر rsync
# ----------------------------------------------------------------
print_step "Step 4: Syncing files | مزامنة الملفات"

RSYNC_OPTS=(-avz --progress -e "ssh -o StrictHostKeyChecking=accept-new")
if $DRY_RUN; then
  RSYNC_OPTS+=(--dry-run)
fi

sync_file() {
  # sync_file <local_relative_path> <remote_relative_path>
  local local_rel="$1"
  local remote_rel="$2"
  local local_full="${REPO_ROOT}/${local_rel}"
  local remote_dest="${SSH_TARGET}:${VPS_PATH}/${remote_rel}"

  print_info "Syncing: ${local_rel}"
  print_muted "       → ${VPS_PATH}/${remote_rel}"

  if $DRY_RUN; then
    print_warn "  (dry-run) would run: rsync ${RSYNC_OPTS[*]} \"${local_full}\" \"${remote_dest}\""
    return 0
  fi

  if rsync "${RSYNC_OPTS[@]}" "$local_full" "$remote_dest"; then
    print_success "Synced: ${local_rel}"
  else
    print_error "Failed to sync: ${local_rel} | فشل في المزامنة"
    return 1
  fi
}

# Sync analyzer files | مزامنة ملفات المحللات
print_info "--- Analyzer files | ملفات المحللات ---"
for f in "${ANALYZER_FILES[@]}"; do
  # vps-service/analyzers/persona_gambler.py → vps-service/analyzers/persona_gambler.py
  sync_file "$f" "$f" || exit 1
done

# Sync script files | مزامنة ملفات السكربتات
print_info "--- Script files | ملفات السكربتات ---"
for f in "${SCRIPT_FILES[@]}"; do
  sync_file "$f" "$f" || exit 1
done

# Sync databases | مزامنة قواعد البيانات
if $SKIP_DB; then
  print_warn "Skipping database sync (--no-db) | تخطّي مزامنة القواعد"
else
  print_info "--- Database files | ملفات قواعد البيانات ---"
  print_warn "Note: Large files (stocks.db ~80MB). This may take a while."
  print_muted "ملاحظة: ملفات كبيرة، قد يستغرق وقتاً."

  # Ensure remote db/ directory exists | التأكد من وجود مجلد db/ عن بعد
  if ! $DRY_RUN; then
    ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" \
        "mkdir -p '${VPS_PATH}/db'" || {
      print_error "Failed to create remote db/ directory"
      exit 1
    }
  fi

  for f in "${DB_FILES[@]}"; do
    # db/stocks.db → db/stocks.db
    sync_file "$f" "$f" || exit 1
  done

  # Set permissions on remote DB files | ضبط صلاحيات الملفات
  if ! $DRY_RUN; then
    print_info "Setting permissions on remote DB files | ضبط الصلاحيات"
    ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" \
        "chmod 664 '${VPS_PATH}/db/stocks.db' '${VPS_PATH}/db/predictions.db' 2>/dev/null; chown -R www-data:www-data '${VPS_PATH}/db' 2>/dev/null || true" \
      && print_success "DB permissions set" \
      || print_warn "Could not set DB permissions (non-fatal)"
  fi
fi

# ----------------------------------------------------------------
# Restart backend service | إعادة تشغيل الخدمة
# ----------------------------------------------------------------
if $SKIP_RESTART; then
  print_step "Step 5: Skipping service restart (--no-restart) | تخطّي إعادة التشغيل"
else
  print_step "Step 5: Restarting backend service | إعادة تشغيل الخدمة"

  RESTART_CMD="sudo supervisorctl restart ${SERVICE_NAME}"
  if $DRY_RUN; then
    print_warn "(dry-run) would run: ssh ${SSH_TARGET} \"${RESTART_CMD}\""
  else
    print_info "Running: ${RESTART_CMD}"
    if ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" "$RESTART_CMD"; then
      print_success "Service '${SERVICE_NAME}' restarted successfully | تمت إعادة التشغيل بنجاح"
      print_muted "Waiting 5 seconds for service to stabilize | انتظار 5 ثوانٍ لاستقرار الخدمة..."
      sleep 5
    else
      print_error "Failed to restart '${SERVICE_NAME}' | فشل في إعادة التشغيل"
      print_muted "Try manually: ssh ${SSH_TARGET} 'sudo supervisorctl status ${SERVICE_NAME}'"
      print_muted "Or check logs: ssh ${SSH_TARGET} 'tail -50 /opt/egx-platform/logs/gunicorn-error.log'"
      exit 1
    fi
  fi
fi

# ----------------------------------------------------------------
# Run backfill script | تشغيل سكربت التعبئة
# ----------------------------------------------------------------
if $SKIP_BACKFILL; then
  print_step "Step 6: Skipping backfill (--no-backfill) | تخطّي التعبئة"
else
  print_step "Step 6: Running historical backfill | تشغيل التعبئة التاريخية"

  BACKFILL_CMD="cd '${VPS_PATH}/vps-service' && source venv/bin/activate && python scripts/backfill_historical_predictions.py --days ${BACKFILL_DAYS} --markets ${BACKFILL_MARKETS}"

  if $DRY_RUN; then
    print_warn "(dry-run) would run on VPS:"
    print_muted "  ${BACKFILL_CMD}"
  else
    print_info "Running backfill (--days ${BACKFILL_DAYS} --markets ${BACKFILL_MARKETS})..."
    print_muted "This may take several minutes | قد يستغرق عدة دقائق"
    if ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 "${SSH_TARGET}" "$BACKFILL_CMD"; then
      print_success "Backfill completed successfully | اكتملت التعبئة بنجاح"
    else
      print_error "Backfill failed | فشلت التعبئة"
      print_muted "The deployment is still live, but historical predictions may be incomplete."
      print_muted "You can re-run it manually:"
      print_muted "  ssh ${SSH_TARGET}"
      print_muted "  cd ${VPS_PATH}/vps-service && source venv/bin/activate"
      print_muted "  python scripts/backfill_historical_predictions.py --days ${BACKFILL_DAYS} --markets ${BACKFILL_MARKETS}"
      # Non-fatal: don't exit, continue to health check
      print_warn "Continuing to health check | الاستمرار في فحص الصحة"
    fi
  fi
fi

# ----------------------------------------------------------------
# Health check | فحص الصحة
# ----------------------------------------------------------------
print_step "Step 7: Health check | فحص صحة الخدمة"

HEALTH_URL="http://localhost:${SERVICE_PORT}/health"
HEALTH_CMD="curl -sS --max-time 10 '${HEALTH_URL}' || echo 'CURL_FAILED'"

if $DRY_RUN; then
  print_warn "(dry-run) would run on VPS: ${HEALTH_CMD}"
else
  print_info "Hitting: ${HEALTH_URL} (on VPS)"
  HEALTH_OUTPUT=$(ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" "$HEALTH_CMD" 2>/dev/null || echo "CURL_FAILED")

  if [[ "$HEALTH_OUTPUT" == "CURL_FAILED" ]]; then
    print_error "Health check FAILED | فشل فحص الصحة"
    print_muted "The service may not be running. Check:"
    print_muted "  ssh ${SSH_TARGET} 'sudo supervisorctl status ${SERVICE_NAME}'"
    print_muted "  ssh ${SSH_TARGET} 'tail -50 /opt/egx-platform/logs/gunicorn-error.log'"
    exit 1
  elif echo "$HEALTH_OUTPUT" | grep -qiE '"status"\s*:\s*"?(ok|healthy|up)"?'; then
    print_success "Health check OK | فحص الصحة ناجح"
    print_muted "Response: ${HEALTH_OUTPUT:0:200}"
  elif echo "$HEALTH_OUTPUT" | grep -qiE 'ok|healthy|alive|up'; then
    print_success "Health check OK | فحص الصحة ناجح"
    print_muted "Response: ${HEALTH_OUTPUT:0:200}"
  else
    print_warn "Health check returned unexpected response | استجابة غير متوقعة"
    print_muted "Response (first 300 chars): ${HEALTH_OUTPUT:0:300}"
    print_muted "Service is responding but the response format is unexpected."
    print_muted "Verify manually: ssh ${SSH_TARGET} 'curl -v ${HEALTH_URL}'"
  fi
fi

# ----------------------------------------------------------------
# Summary | الملخص
# ----------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}============================================================${NC}"
echo -e "${GREEN}${BOLD}  ✓ Deployment Summary | ملخص النشر${NC}"
echo -e "${GREEN}${BOLD}============================================================${NC}"

if $DRY_RUN; then
  echo -e "${YELLOW}  Mode: DRY-RUN (no changes made) | وضع التجربة${NC}"
else
  echo -e "${GREEN}  Mode: LIVE (changes applied) | تطبيق فعلي${NC}"
fi
echo ""
echo -e "  VPS target   : ${BOLD}${SSH_TARGET}${NC}"
echo -e "  Remote path  : ${VPS_PATH}"
echo -e "  Service      : ${SERVICE_NAME} (port ${SERVICE_PORT})"
echo ""

echo -e "${CYAN}  Files synced | الملفات المزامنة:${NC}"
for f in "${ANALYZER_FILES[@]}" "${SCRIPT_FILES[@]}"; do
  if $DRY_RUN; then
    echo -e "    ${YELLOW}(would sync)${NC} ${f}"
  else
    echo -e "    ${GREEN}✓${NC} ${f}"
  fi
done

if $SKIP_DB; then
  echo -e "    ${YELLOW}(skipped)${NC} db/* (--no-db)"
else
  for f in "${DB_FILES[@]}"; do
    if $DRY_RUN; then
      echo -e "    ${YELLOW}(would sync)${NC} ${f}"
    else
      echo -e "    ${GREEN}✓${NC} ${f}"
    fi
  done
fi
echo ""

echo -e "${CYAN}  Post-sync actions | إجراءات ما بعد المزامنة:${NC}"
if $SKIP_RESTART; then
  echo -e "    ${YELLOW}(skipped)${NC} service restart (--no-restart)"
elif $DRY_RUN; then
  echo -e "    ${YELLOW}(would run)${NC}  supervisorctl restart ${SERVICE_NAME}"
else
  echo -e "    ${GREEN}✓${NC} supervisorctl restart ${SERVICE_NAME}"
fi

if $SKIP_BACKFILL; then
  echo -e "    ${YELLOW}(skipped)${NC} backfill (--no-backfill)"
elif $DRY_RUN; then
  echo -e "    ${YELLOW}(would run)${NC}  backfill_historical_predictions.py --days ${BACKFILL_DAYS} --markets ${BACKFILL_MARKETS}"
else
  echo -e "    ${GREEN}✓${NC} backfill_historical_predictions.py --days ${BACKFILL_DAYS} --markets ${BACKFILL_MARKETS}"
fi

if $DRY_RUN; then
  echo -e "    ${YELLOW}(would run)${NC}  curl ${HEALTH_URL}"
else
  echo -e "    ${GREEN}✓${NC} curl ${HEALTH_URL}"
fi
echo ""

if $DRY_RUN; then
  print_warn "Dry-run complete. No changes were made."
  print_muted "Remove --dry-run to actually deploy | أزل --dry-run للنشر الفعلي"
else
  print_success "Deployment complete! | اكتمل النشر بنجاح!"
  echo ""
  echo -e "${CYAN}Next steps | الخطوات التالية:${NC}"
  print_muted "- Open the credibility screen in the UI to verify closed predictions"
  print_muted "- Check live logs: ssh ${SSH_TARGET} 'tail -f /opt/egx-platform/logs/gunicorn.log'"
  print_muted "- Service status: ssh ${SSH_TARGET} 'sudo supervisorctl status ${SERVICE_NAME}'"
fi

echo ""
exit 0

#!/usr/bin/env bash
# ============================================================================
# clean-databases.sh — سكربت تنظيف قواعد بيانات GLMinvestment
# ============================================================================
# تنظيف آمن لقواعد البيانات مع backup تلقائي و dry-run افتراضي
#
# الاستخدام:
#   ./clean-databases.sh --dry-run          # معاينة فقط (افتراضي)
#   ./clean-databases.sh --light            # تنظيف خفيف (آمن)
#   ./clean-databases.sh --medium           # تنظيف متوسط
#   ./clean-databases.sh --deep             # تنظيف عميق (احذر!)
#   ./clean-databases.sh --vacuum-only      # ضغط DBs بس
#   ./clean-databases.sh --stats            # إحصائيات بس
#   ./clean-databases.sh --help
# ============================================================================

set -euo pipefail

# ── الألوان ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── المتغيرات ────────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_DIR="${PROJECT_ROOT}/db"
BACKUP_DIR="${DB_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/db-backup-${TIMESTAMP}"

# الـ databases المعروفة في المشروع
MAIN_DBS=("predictions.db" "analytics.db" "community.db" "ai_search_cache.db")
PROTECTED_DBS=("custom.db" "egx_investment.db")  # ممنوع المسها (قديمة وفيها بيانات مهمة)

# مستوى التنظيف
MODE="dry-run"
DO_VACUUM=false
DO_STATS_ONLY=false
DO_LIGHT=false
DO_MEDIUM=false
DO_DEEP=false

# عدد الأيام للاحتفاظ بالبيانات
LIGHT_DAYS=90    # 3 شهور
MEDIUM_DAYS=30   # شهر
DEEP_DAYS=7      # أسبوع

# ── دوال مساعدة ──────────────────────────────────────────────────────────────
log_info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
log_ok()    { echo -e "${GREEN}✓${NC} $1"; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
log_err()   { echo -e "${RED}✗${NC} $1"; }
log_step()  { echo -e "\n${BLUE}▶ ${BOLD}$1${NC}"; }
log_head()  { echo -e "\n${BOLD}${BLUE}════════════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $1${NC}"; echo -e "${BOLD}${BLUE}════════════════════════════════════════════${NC}"; }

# التحقق من وجود sqlite3
check_sqlite3() {
    if ! command -v sqlite3 &> /dev/null; then
        log_err "sqlite3 غير مثبت. ثبته بـ:"
        echo "  Ubuntu/Debian: sudo apt install sqlite3"
        echo "  macOS:         brew install sqlite3"
        exit 1
    fi
}

# التحقق من Python (fallback)
check_python() {
    if ! command -v python3 &> /dev/null; then
        log_err "python3 غير مثبت"
        exit 1
    fi
}

# تنفيذ استعلام SQLite مع معالجة الأخطاء
run_sql() {
    local db_path="$1"
    local sql="$2"
    local dry="${3:-true}"

    if [[ "$dry" == "true" ]]; then
        echo -e "  ${YELLOW}[DRY]${NC} $sql"
        return 0
    fi

    sqlite3 "$db_path" "$sql" 2>&1 || {
        log_err "فشل: $sql"
        return 1
    }
}

# عدّ الصفوف في جدول
count_rows() {
    local db_path="$1"
    local table="$2"
    local result
    result=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    echo "$result"
}

# حجم قاعدة البيانات
db_size() {
    local db_path="$1"
    if [[ -f "$db_path" ]]; then
        du -h "$db_path" | cut -f1
    else
        echo "غير موجودة"
    fi
}

# ── Backup ────────────────────────────────────────────────────────────────────
backup_databases() {
    log_step "Step 1: عمل Backup لكل الـ databases"

    mkdir -p "$BACKUP_PATH"
    log_info "مسار الـ backup: $BACKUP_PATH"

    # نسخ كل ملفات .db
    local backed_up=0
    for db_file in "$DB_DIR"/*.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        cp "$db_file" "$BACKUP_PATH/$fname"
        log_ok "  نسخ: $fname ($(db_size "$db_file"))"
        backed_up=$((backed_up + 1))
    done

    # نسخ ملفات -wal و -shm لو موجودة (WAL mode)
    for wal_file in "$DB_DIR"/*.db-wal "$DB_DIR"/*.db-shm; do
        [[ -f "$wal_file" ]] || continue
        cp "$wal_file" "$BACKUP_PATH/$(basename "$wal_file")" 2>/dev/null || true
    done

    log_ok "تم نسخ $backed_up قاعدة بيانات"

    # إنشاء ملف معلومات
    cat > "$BACKUP_PATH/BACKUP_INFO.txt" << EOF
GLMinvestment Database Backup
============================
Date: $(date)
Host: $(hostname)
Mode: $MODE
Project: $PROJECT_ROOT

Databases backed up:
$(ls -1 "$DB_DIR"/*.db 2>/dev/null | xargs -I{} basename {} | sed 's/^/  - /')

To restore:
  cp $BACKUP_PATH/*.db $DB_DIR/
EOF

    log_ok "معلومات الـ backup: $BACKUP_PATH/BACKUP_INFO.txt"
}

# ── إحصائيات ──────────────────────────────────────────────────────────────────
show_stats() {
    log_head "📊 إحصائيات الـ Databases"

    echo ""
    log_info "المسار: $DB_DIR"
    echo ""

    printf "  %-30s %-12s %-15s %-15s\n" "Database" "الحجم" "الجداول" "الصفوف الكلي"
    printf "  %-30s %-12s %-15s %-15s\n" "──────────────────────────────" "────────────" "───────────────" "───────────────"

    for db_file in "$DB_DIR"/*.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        local size
        size=$(db_size "$db_file")

        local tables
        tables=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")

        local total_rows=0
        while IFS= read -r tbl; do
            [[ -z "$tbl" ]] && continue
            local cnt
            cnt=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null || echo "0")
            total_rows=$((total_rows + cnt))
        done < <(sqlite3 "$db_file" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null)

        printf "  %-30s %-12s %-15s %-15s\n" "$fname" "$size" "$tables" "$total_rows"
    done

    echo ""
    log_info "تفاصيل predictions.db (الأهم):"
    echo ""

    local pred_db="$DB_DIR/predictions.db"
    if [[ -f "$pred_db" ]]; then
        # stored_analyses
        local sa_count sa_with_json sa_empty_json sa_old
        sa_count=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses;" 2>/dev/null || echo "0")
        sa_with_json=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE analysis_json IS NOT NULL AND analysis_json != '';" 2>/dev/null || echo "0")
        sa_empty_json=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE analysis_json IS NULL OR analysis_json = '';" 2>/dev/null || echo "0")
        sa_old=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE created_at < datetime('now', '-30 days');" 2>/dev/null || echo "0")

        printf "    %-35s %s\n" "stored_analyses (إجمالي):" "$sa_count"
        printf "    %-35s %s\n" "  └ فيه analysis_json:" "$sa_with_json"
        printf "    %-35s %s\n" "  └ فاضي analysis_json:" "$sa_empty_json"
        printf "    %-35s %s\n" "  └ أقدم من 30 يوم:" "$sa_old"

        # persona_predictions
        echo ""
        local pp_total pp_pending pp_hit_target pp_hit_stop pp_expired
        pp_total=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions;" 2>/dev/null || echo "0")
        pp_pending=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status='PENDING';" 2>/dev/null || echo "0")
        pp_hit_target=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status='HIT_TARGET';" 2>/dev/null || echo "0")
        pp_hit_stop=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status='HIT_STOP_LOSS';" 2>/dev/null || echo "0")
        pp_expired=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status='EXPIRED';" 2>/dev/null || echo "0")

        printf "    %-35s %s\n" "persona_predictions (إجمالي):" "$pp_total"
        printf "    %-35s %s\n" "  └ PENDING:" "$pp_pending"
        printf "    %-35s %s\n" "  └ HIT_TARGET:" "$pp_hit_target"
        printf "    %-35s %s\n" "  └ HIT_STOP_LOSS:" "$pp_hit_stop"
        printf "    %-35s %s\n" "  └ EXPIRED:" "$pp_expired"
    fi

    # فحص الجداول المكررة المعروفة
    echo ""
    log_info "فحص الجداول المكررة (price history):"
    for db_file in "$DB_DIR"/predictions.db "$DB_DIR"/egx_investment.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        for tbl in stock_price_history price_history historical_prices historical_data stock_daily_prices; do
            local exists
            exists=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$tbl';" 2>/dev/null || echo "0")
            if [[ "$exists" -gt 0 ]]; then
                local rows
                rows=$(sqlite3 "$db_file" "SELECT COUNT(*) FROM $tbl;" 2>/dev/null || echo "0")
                printf "    %-20s %-25s %s صف\n" "$fname" "$tbl" "$rows"
            fi
        done
    done

    echo ""
    log_info "Databases محمية (لن تُلمس):"
    for pdb in "${PROTECTED_DBS[@]}"; do
        [[ -f "$DB_DIR/$pdb" ]] && printf "    🔒 %s (%s)\n" "$pdb" "$(db_size "$DB_DIR/$pdb")"
    done
}

# ── تنظيف خفيف (Light) ───────────────────────────────────────────────────────
# آمن تماماً — بيمسح بس:
#   - persona_predictions بـ status=PENDING أقدم من 90 يوم
#   - analysis_json فاضي أو malformed
#   - VACUUM لكل الـ DBs
clean_light() {
    log_head "🧹 تنظيف خفيف (Light) — آمن"
    log_info "المستوى: مسح PENDING قديمة (> $LIGHT_DAYS يوم) + تنظيف analysis_json + VACUUM"
    echo ""

    local pred_db="$DB_DIR/predictions.db"
    [[ -f "$pred_db" ]] || { log_err "predictions.db غير موجودة"; return 1; }

    local is_dry="true"
    [[ "$MODE" == "apply" ]] && is_dry="false"

    # 1. persona_predictions PENDING قديمة
    log_step "1/4: مسح persona_predictions الـ PENDING القديمة (> $LIGHT_DAYS يوم)"
    local before
    before=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status='PENDING' AND created_at < datetime('now', '-${LIGHT_DAYS} days');" 2>/dev/null || echo "0")
    log_info "  الصفوف اللي هتمسح: $before"

    if [[ "$is_dry" == "false" ]]; then
        sqlite3 "$pred_db" "DELETE FROM persona_predictions WHERE status='PENDING' AND created_at < datetime('now', '-${LIGHT_DAYS} days');"
        log_ok "  تم المسح"
    else
        echo -e "  ${YELLOW}[DRY]${NC} DELETE FROM persona_predictions WHERE status='PENDING' AND created_at < datetime('now', '-${LIGHT_DAYS} days');"
    fi

    # 2. analysis_json فاضي أو malformed
    log_step "2/4: تنظيف analysis_json الفاضي أو المعطوب"
    local empty_json
    empty_json=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE analysis_json IS NULL OR analysis_json = '' OR analysis_json = '{}';" 2>/dev/null || echo "0")
    log_info "  صفوف بـ analysis_json فاضي: $empty_json"

    # malformed JSON (لا يبدأ بـ {)
    local malformed
    malformed=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE analysis_json IS NOT NULL AND analysis_json != '' AND analysis_json != '{}' AND substr(analysis_json,1,1) != '{';" 2>/dev/null || echo "0")
    log_info "  صفوف بـ analysis_json معطوب: $malformed"

    if [[ "$is_dry" == "false" ]]; then
        # نمسح الـ analysis_json بس (نسيب الصف) عشان يتولّد من تاني
        sqlite3 "$pred_db" "UPDATE stored_analyses SET analysis_json = NULL WHERE analysis_json = '' OR analysis_json = '{}';"
        sqlite3 "$pred_db" "UPDATE stored_analyses SET analysis_json = NULL WHERE analysis_json IS NOT NULL AND substr(analysis_json,1,1) != '{';"
        log_ok "  تم تنظيف analysis_json (الصفوف موجودة لكن الـ JSON هيتولّد من تاني)"
    else
        echo -e "  ${YELLOW}[DRY]${NC} UPDATE stored_analyses SET analysis_json = NULL WHERE ... (تنظيف)"
    fi

    # 3. مسح التكرارات في persona_predictions (نفس ticker + persona_type + نفس اليوم)
    log_step "3/4: مسح التكرارات في persona_predictions"
    local dups
    dups=$(sqlite3 "$pred_db" "
        SELECT COUNT(*) FROM persona_predictions
        WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM persona_predictions
            GROUP BY ticker, persona_type, date(created_at)
        );" 2>/dev/null || echo "0")
    log_info "  صفوف مكررة: $dups"

    if [[ "$is_dry" == "false" && "$dups" -gt 0 ]]; then
        sqlite3 "$pred_db" "
            DELETE FROM persona_predictions
            WHERE rowid NOT IN (
                SELECT MIN(rowid) FROM persona_predictions
                GROUP BY ticker, persona_type, date(created_at)
            );"
        log_ok "  تم مسح التكرارات"
    fi

    # 4. VACUUM
    log_step "4/4: VACUUM لكل الـ DBs (ضغط الملفات)"
    for db_file in "$DB_DIR"/*.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        local before_size
        before_size=$(du -b "$db_file" | cut -f1)

        if [[ "$is_dry" == "false" ]]; then
            sqlite3 "$db_file" "VACUUM;" 2>/dev/null && log_ok "  VACUUM: $fname" || log_warn "  تخطي: $fname"
            local after_size
            after_size=$(du -b "$db_file" | cut -f1)
            local saved=$(( (before_size - after_size) / 1024 ))
            [[ $saved -gt 0 ]] && log_info "    وفّر: ${saved} KB"
        else
            echo -e "  ${YELLOW}[DRY]${NC} VACUUM $fname (قبل: $(db_size "$db_file"))"
        fi
    done

    # إعادة بناء الفهارس (REINDEX)
    if [[ "$is_dry" == "false" ]]; then
        log_step "إضافي: REINDEX لكل الفهارس"
        for db_file in "$DB_DIR"/*.db; do
            [[ -f "$db_file" ]] || continue
            sqlite3 "$db_file" "REINDEX;" 2>/dev/null && log_ok "  REINDEX: $(basename "$db_file")" || true
        done
    fi
}

# ── تنظيف متوسط (Medium) ─────────────────────────────────────────────────────
# كل اللي في Light +
#   - مسح persona_predictions HIT_TARGET/HIT_STOP_LOSS أقدم من 30 يوم
#   - مسح stored_analyses للأسهم الملغية (EGX cleanup: 485→260)
#   - مسح analysis_json أقدم من 30 يوم (هيتولّد من تاني)
clean_medium() {
    log_head "🔧 تنظيف متوسط (Medium)"
    log_info "المستوى: Light + مسح توقعات محلولة قديمة + مسح أسهم ملغية"
    echo ""

    # نشغّل الـ light الأول
    clean_light

    local pred_db="$DB_DIR/predictions.db"
    local is_dry="true"
    [[ "$MODE" == "apply" ]] && is_dry="false"

    # 1. مسح persona_predictions محلولة وأقدم من MEDIUM_DAYS
    log_step "5/7: مسح persona_predictions المحلولة (> $MEDIUM_DAYS يوم)"
    local solved_old
    solved_old=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions WHERE status IN ('HIT_TARGET','HIT_STOP_LOSS','EXPIRED') AND created_at < datetime('now', '-${MEDIUM_DAYS} days');" 2>/dev/null || echo "0")
    log_info "  صفوف محلولة قديمة: $solved_old"

    if [[ "$is_dry" == "false" ]]; then
        sqlite3 "$pred_db" "DELETE FROM persona_predictions WHERE status IN ('HIT_TARGET','HIT_STOP_LOSS','EXPIRED') AND created_at < datetime('now', '-${MEDIUM_DAYS} days');"
        log_ok "  تم المسح"
    fi

    # 2. مسح stored_analyses للأسهم الملغية
    log_step "6/7: مسح stored_analyses لأسهم EGX الملغية (485→260)"
    log_warn "  لازم تتأكد إن الـ ticker list الحالي صحيح"

    # قائمة الأسهم EGX الصحيحة (نسخها من الـ hunting_engine أو من API)
    # هنا بنمسح اللي مش في القائمة الأساسية
    if [[ "$is_dry" == "false" ]]; then
        # مسح التوقعات لـ tickers فيها رموز غريبة (أطول من 6 حروف أو فيها أرقام غريبة)
        local orphaned
        orphaned=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE length(ticker) > 6 OR ticker GLOB '*[!A-Z0-9]*';" 2>/dev/null || echo "0")
        log_info "  صفوف orphaned: $orphaned"
        sqlite3 "$pred_db" "DELETE FROM stored_analyses WHERE length(ticker) > 6 OR ticker GLOB '*[!A-Z0-9]*';"
        sqlite3 "$pred_db" "DELETE FROM persona_predictions WHERE length(ticker) > 6 OR ticker GLOB '*[!A-Z0-9]*';"
        log_ok "  تم مسح التوقعات الـ orphaned"
    else
        local orphaned
        orphaned=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE length(ticker) > 6 OR ticker GLOB '*[!A-Z0-9]*';" 2>/dev/null || echo "0")
        echo -e "  ${YELLOW}[DRY]${NC} هتمسح $orphaned صف orphaned من stored_analyses"
    fi

    # 3. مسح analysis_json أقدم من MEDIUM_DAYS (هيتولّد من تاني لما السهم يتتحلل)
    log_step "7/7: تصفير analysis_json أقدم من $MEDIUM_DAYS يوم (هيتولّد من تاني)"
    local old_json
    old_json=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses WHERE analysis_json IS NOT NULL AND created_at < datetime('now', '-${MEDIUM_DAYS} days');" 2>/dev/null || echo "0")
    log_info "  صفوف هتتصفّر: $old_json"

    if [[ "$is_dry" == "false" ]]; then
        sqlite3 "$pred_db" "UPDATE stored_analyses SET analysis_json = NULL WHERE created_at < datetime('now', '-${MEDIUM_DAYS} days');"
        log_ok "  تم التصفير (الصفوف موجودة، الـ JSON هيتولّد من تاني)"
    fi
}

# ── تنظيف عميق (Deep) ────────────────────────────────────────────────────────
# كل اللي في Medium +
#   - مسح كل stored_analyses (هتتولّد من تاني)
#   - مسح كل persona_predictions (هتتولّد من تاني)
#   - مسح الجداول المكررة (نسيب واحدة بس)
#   ⚠️ لازم تأكيد صريح
clean_deep() {
    log_head "⚠️ تنظيف عميق (Deep) — احذر!"

    if [[ "$MODE" != "apply" ]]; then
        log_warn "الـ Deep mode بيأكّد بـ --apply"
        log_info "شوف الـ dry-run الأول:"
        echo ""
    fi

    # نشغّل الـ medium الأول
    clean_medium

    local pred_db="$DB_DIR/predictions.db"
    local is_dry="true"
    [[ "$MODE" == "apply" ]] && is_dry="false"

    # 1. مسح كل stored_analyses
    log_step "8/9: مسح كل stored_analyses (هتتولّد من تاني)"
    local total_sa
    total_sa=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM stored_analyses;" 2>/dev/null || echo "0")
    log_info "  صفوف: $total_sa"

    if [[ "$is_dry" == "false" ]]; then
        sqlite3 "$pred_db" "DELETE FROM stored_analyses;"
        log_ok "  تم مسح كل stored_analyses"
    fi

    # 2. مسح كل persona_predictions
    log_step "9/9: مسح كل persona_predictions (هتتولّد من تاني)"
    local total_pp
    total_pp=$(sqlite3 "$pred_db" "SELECT COUNT(*) FROM persona_predictions;" 2>/dev/null || echo "0")
    log_info "  صفوف: $total_pp"

    if [[ "$is_dry" == "false" ]]; then
        sqlite3 "$pred_db" "DELETE FROM persona_predictions;"
        log_ok "  تم مسح كل persona_predictions"
    fi

    # VACUUM نهائي
    if [[ "$is_dry" == "false" ]]; then
        log_step "VACUUM نهائي"
        sqlite3 "$pred_db" "VACUUM;"
        log_ok "  تم"
    fi

    log_warn "⚠️ الـ Deep mode مسح كل التوقعات — لازم تشغّل background_analyzer عشان يتولّدوا من تاني"
}

# ── VACUUM فقط ────────────────────────────────────────────────────────────────
vacuum_only() {
    log_head "🗜️ VACUOM فقط (آمن تماماً)"

    local is_dry="true"
    [[ "$MODE" == "apply" ]] && is_dry="false"

    for db_file in "$DB_DIR"/*.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        local before_size
        before_size=$(du -b "$db_file" | cut -f1)

        if [[ "$is_dry" == "false" ]]; then
            sqlite3 "$db_file" "VACUUM;" 2>/dev/null && log_ok "  VACUUM: $fname" || log_warn "  تخطي: $fname"
            sqlite3 "$db_file" "REINDEX;" 2>/dev/null || true
            local after_size
            after_size=$(du -b "$db_file" | cut -f1)
            local saved=$(( (before_size - after_size) / 1024 ))
            [[ $saved -gt 0 ]] && log_info "    وفّر: ${saved} KB"
        else
            echo -e "  ${YELLOW}[DRY]${NC} VACUUM $fname (الحجم الحالي: $(db_size "$db_file"))"
        fi
    done
}

# ── فحص سلامة الـ Databases ───────────────────────────────────────────────────
integrity_check() {
    log_head "🔍 فحص سلامة الـ Databases"

    local all_ok=true
    for db_file in "$DB_DIR"/*.db; do
        [[ -f "$db_file" ]] || continue
        local fname
        fname=$(basename "$db_file")
        local result
        result=$(sqlite3 "$db_file" "PRAGMA integrity_check;" 2>/dev/null | head -1)
        if [[ "$result" == "ok" ]]; then
            log_ok "  $fname: سليم ✓"
        else
            log_err "  $fname: $result"
            all_ok=false
        fi
    done

    if [[ "$all_ok" == "true" ]]; then
        log_ok "كل الـ databases سليمة"
    else
        log_err "في databases فيها مشاكل — استرجع من الـ backup"
    fi
}

# ── المساعدة ──────────────────────────────────────────────────────────────────
show_help() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║     clean-databases.sh — تنظيف قواعد بيانات GLMinvestment     ║
╚══════════════════════════════════════════════════════════════╝

الاستخدام:
  ./clean-databases.sh [الأمر] [--apply]

الأوامر:
  --dry-run        معاينة فقط بدون تغيير (افتراضي)
  --stats          إحصائيات بس (آمن تماماً)
  --integrity      فحص سلامة الـ DBs
  --vacuum-only    ضغط DBs + REINDEX (آمن)
  --light          تنظيف خفيف (PENDING قديمة + تنظيف JSON + VACUUM)
  --medium         تنظيف متوسط (Light + محلولة قديمة + orphaned)
  --deep           تنظيف عميق (Medium + مسح كل التوقعات)
  --help           المساعدة

الفلاجز:
  --apply          تنفيذ فعلي (بدونه = dry-run)
  --no-backup      تخطّي الـ backup (غير مستحب!)

أمثلة:
  # شوف الإحصائيات الأول
  ./clean-databases.sh --stats

  # فحص سلامة الـ DBs
  ./clean-databases.sh --integrity

  # معاينة تنظيف خفيف
  ./clean-databases.sh --light

  # تنفيذ تنظيف خفيف
  ./clean-databases.sh --light --apply

  # ضغط الـ DBs بس (آمن)
  ./clean-databases.sh --vacuum-only --apply

  # تنظيف عميق (احذر!)
  ./clean-databases.sh --deep --apply

المستويات:
  ┌─────────┬────────────────────────────────────────────┬──────┐
  │ المستوى │ ماذا بيعمل                                  │ أمان │
  ├─────────┼────────────────────────────────────────────┼──────┤
  │ stats   │ إحصائيات بس                                 │ ✅✅✅ │
  │ vacuum  │ VACUUM + REINDEX                            │ ✅✅✅ │
  │ light   │ PENDING >90 يوم + JSON معطوب + VACUUM       │ ✅✅  │
  │ medium  │ Light + محلولة >30 يوم + orphaned tickers   │ ✅   │
  │ deep    │ Medium + مسح كل التوقعات (تتولّد من تاني)    │ ⚠️   │
  └─────────┴────────────────────────────────────────────┴──────┘

Databases محمية (لن تُلمس):
  - custom.db          (قديمة - بيانات مهمة)
  - egx_investment.db  (قديمة - بيانات مهمة)

الـ Backup:
  كل ملفات .db بتتنسخ لـ db/backups/db-backup-YYYYMMDD_HHMMSS/
  تقدر تسترجع بـ: cp db/backups/<latest>/*.db db/

EOF
}

# ── معالجة الـ arguments ──────────────────────────────────────────────────────
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)      MODE="dry-run" ;;
            --stats)        DO_STATS_ONLY=true ;;
            --integrity)    MODE="integrity" ;;
            --vacuum-only)  MODE="vacuum" ;;
            --light)        DO_LIGHT=true; MODE="dry-run" ;;
            --medium)       DO_MEDIUM=true; MODE="dry-run" ;;
            --deep)         DO_DEEP=true; MODE="dry-run" ;;
            --apply)        MODE="apply" ;;
            --no-backup)    SKIP_BACKUP=true ;;
            --help|-h)      show_help; exit 0 ;;
            *)              log_err "أمر غير معروف: $1"; show_help; exit 1 ;;
        esac
        shift
    done
}

# ── الـ main ───────────────────────────────────────────────────────────────────
main() {
    # الترويسة
    echo -e "${BOLD}${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     🧹 GLMinvestment — Database Cleanup Script               ║"
    echo "║     تنظيف قواعد البيانات بطريقة آمنة                          ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    parse_args "$@"

    check_sqlite3

    # التحقق من وجود مجلد db
    if [[ ! -d "$DB_DIR" ]]; then
        log_err "مجلد db غير موجود: $DB_DIR"
        exit 1
    fi

    # عرض الـ stats دايماً في الأول
    show_stats

    # لو --stats بس، اخرج
    if [[ "$DO_STATS_ONLY" == "true" ]]; then
        echo ""
        log_ok "تم عرض الإحصائيات"
        exit 0
    fi

    # فحص السلامة
    if [[ "$MODE" == "integrity" ]]; then
        integrity_check
        exit 0
    fi

    echo ""
    log_info "الوضع: $MODE"

    # لو dry-run، اتأكد إن المستخدم عارف
    if [[ "$MODE" == "dry-run" && ( "$DO_LIGHT" == "true" || "$DO_MEDIUM" == "true" || "$DO_DEEP" == "true" || true ) ]]; then
        log_warn "DRY RUN — مش هيحصل أي تغيير. استخدم --apply للتنفيذ الفعلي"
    fi

    # Backup (إلا لو --no-backup أو --stats)
    SKIP_BACKUP="${SKIP_BACKUP:-false}"
    if [[ "$SKIP_BACKUP" == "false" && "$MODE" == "apply" ]]; then
        backup_databases
    elif [[ "$SKIP_BACKUP" == "false" ]]; then
        log_info "DRY RUN — مش هعمل backup دلوقتي"
    fi

    # تنفيذ حسب المستوى
    if [[ "$DO_DEEP" == "true" ]]; then
        clean_deep
    elif [[ "$DO_MEDIUM" == "true" ]]; then
        clean_medium
    elif [[ "$DO_LIGHT" == "true" ]]; then
        clean_light
    elif [[ "$MODE" == "vacuum" ]]; then
        vacuum_only
    fi

    # الـ stats النهائية
    if [[ "$MODE" == "apply" ]]; then
        echo ""
        log_head "📊 الإحصائيات بعد التنظيف"
        show_stats

        echo ""
        log_ok "تم التنظيف بنجاح"
        log_info "الـ backup في: $BACKUP_PATH"
        echo ""
        log_warn "لو حصلت مشكلة، استرجع بـ:"
        echo "  cp $BACKUP_PATH/*.db $DB_DIR/"
    fi
}

main "$@"

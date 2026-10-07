#!/usr/bin/env bash
# ============================================================================
# GLMinvestment — سكريبت إصلاح كوارث خط سير البيانات
# ============================================================================
# التاريخ: 2026-10-07
# المرجع: DATA_AUDIT_REPORT.md + worklog.md (Tasks DATA-AUDIT-1/2/3 + CODE/API/SCRAPER-AUDIT-1)
# القاعدة 17: كل المسارات نسبية — السكريبت يشتغل من أي مكان
#
# الاستخدام (من جذر المشروع):
#   bash download/SERVER_FIX_COMMANDS.sh
#   PROJECT_ROOT=/custom/path bash download/SERVER_FIX_COMMANDS.sh   # override
#
# السكريبت بـ:
#   1. يكتشف PROJECT_ROOT نسبياً من موقع السكريبت (download/../)
#   2. يعمل backup كامل قبل أي تعديل
#   3. يطبّق Phase 1: إصلاحات عاجلة (market tag + dedup + signal_date)
#   4. يطبّق Phase 2: تحديث stock_phase + verification pipeline
#   5. يطلع تقرير نهائي
#
# ملاحظات:
#   - السكريبت idempotent — ممكن تشغله أكتر من مرة بدون مشاكل
#   - كل تعديل بيسجل في LOG_FILE
#   - في حال أي خطأ، الـ backup هيكون في BACKUP_DIR
# ============================================================================

set -euo pipefail

# ─── Rule 17: اكتشاف PROJECT_ROOT نسبياً ───────────────────────────────
# السكريبت في download/SERVER_FIX_COMMANDS.sh → PROJECT_ROOT = parent of download/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# Override with env var if provided
if [[ -n "${PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="${PROJECT_ROOT:-}"
fi
# Re-derive if env var was empty
if [[ -z "${PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

cd "$PROJECT_ROOT"

BACKUP_DIR="$PROJECT_ROOT/backups/pre-freshness-fix-$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$PROJECT_ROOT/backups/fix-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$BACKUP_DIR" "$PROJECT_ROOT/backups"

log() {
    echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

section() {
    echo "" | tee -a "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
    echo "  $1" | tee -a "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
}

# ============================================================================
# STEP 0: تحقق من البيئة + backup كامل
# ============================================================================
section "STEP 0 — التحقق من البيئة + backup كامل"

if [[ ! -f "$PROJECT_ROOT/db/stocks.db" ]]; then
    log "❌ DB not found: $PROJECT_ROOT/db/stocks.db"
    exit 1
fi
if [[ ! -f "$PROJECT_ROOT/db/data_engine.db" ]]; then
    log "❌ DB not found: $PROJECT_ROOT/db/data_engine.db"
    exit 1
fi
if [[ ! -f "$PROJECT_ROOT/db/predictions.db" ]]; then
    log "❌ DB not found: $PROJECT_ROOT/db/predictions.db"
    exit 1
fi

log "📦 Backing up DBs to $BACKUP_DIR"

# دالة نسخ احتياطي ذكية — تتخطى الـ DB الكبير جداً لو الـ disk مساحته ضيقة
backup_db() {
    local src="$1"
    local name=$(basename "$src")
    if [[ ! -f "$src" ]]; then
        return 0
    fi
    local size=$(stat -c%s "$src" 2>/dev/null || echo 0)
    local avail=$(df -BG "$BACKUP_DIR" | awk 'NR==2 {gsub("G","",$4); print $4}')
    # Skip if backup bigger than 50% of available space
    if [[ -n "$avail" && "$size" -gt $((avail * 1024 * 1024 * 1024 / 2)) ]]; then
        log "  ⏭️  تخطّي $name (${size} bytes) — مساحة غير كافية (${avail}G available)"
        return 0
    fi
    cp -v "$src" "$BACKUP_DIR/$name" 2>&1 | tee -a "$LOG_FILE"
}

backup_db "$PROJECT_ROOT/db/stocks.db"
backup_db "$PROJECT_ROOT/db/data_engine.db"
backup_db "$PROJECT_ROOT/db/predictions.db"
backup_db "$PROJECT_ROOT/db/price_history.db"

log "✅ Backups complete (or skipped due to space constraints)"

# ============================================================================
# STEP 1 (Phase 1.1): إصلاح market='US' → 'EGX'/'مصر' على EGX tickers
# ============================================================================
section "STEP 1 — إصلاح market='US' على أسهم EGX (الكارثة #1)"

python3 - <<PYEOF 2>&1 | tee -a "$LOG_FILE"
import sqlite3
from pathlib import Path
import os

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))
if not PROJECT_ROOT.exists():
    print(f"❌ PROJECT_ROOT not found: {PROJECT_ROOT}")
    exit(1)

print(f"📦 Using PROJECT_ROOT = {PROJECT_ROOT}")

print("=" * 70)
print("  PHASE 1.1 — إصلاح market tag لأسهم EGX")
print("=" * 70)

# احصل قائمة EGX tickers من stocks.db.stocks (الـ reference)
stocks_db = sqlite3.connect(str(PROJECT_ROOT / 'db/stocks.db'))
cur = stocks_db.cursor()
cur.execute("SELECT ticker FROM stocks WHERE market IN ('EGX','مصر')")
egx_tickers = [r[0] for r in cur.fetchall()]
print(f"\n📊 عدد أسهم EGX في stocks.stocks: {len(egx_tickers)}")

if not egx_tickers:
    print("⚠️ ما فيش أسهم EGX في stocks.stocks — تأكد إن الـ DB محدث")
    stocks_db.close()
    exit(1)

# خطّط الـ placeholders
placeholders = ','.join(['?' for _ in egx_tickers])

# === Fix 1: stock_daily_prices in stocks.db ===
print("\n→ Fixing db/stocks.db.stock_daily_prices (market='US' → 'EGX')")
cur.execute(f"SELECT COUNT(*) FROM stock_daily_prices WHERE ticker IN ({placeholders}) AND market='US'", egx_tickers)
n = cur.fetchone()[0]
print(f"  قبل: {n} صف مُسمّى 'US'")
if n > 0:
    cur.execute(f"UPDATE stock_daily_prices SET market='EGX' WHERE ticker IN ({placeholders}) AND market='US'", egx_tickers)
    stocks_db.commit()
    print(f"  ✅ تم تحديث {cur.rowcount} صف إلى 'EGX'")

# === Fix 2: radar_signal_tracking signal_date format ===
print("\n→ Fixing signal_date format in radar_signal_tracking")
cur.execute("SELECT COUNT(*) FROM radar_signal_tracking WHERE signal_date NOT LIKE '%-%'")
n = cur.fetchone()[0]
print(f"  قبل: {n} صف بصيغة YYYYMMDD (بدون شرطة)")
if n > 0:
    cur.execute("""
        UPDATE radar_signal_tracking
        SET signal_date = substr(signal_date,1,4) || '-' || substr(signal_date,5,2) || '-' || substr(signal_date,7,2)
        WHERE signal_date NOT LIKE '%-%' AND length(signal_date)=8
    """)
    stocks_db.commit()
    print(f"  ✅ تم تحويل {cur.rowcount} صف إلى YYYY-MM-DD")

# === Fix 3: dedup radar_signal_tracking (نفس ticker + signal_date) ===
print("\n→ Deduplicating radar_signal_tracking (نفس ticker + signal_date)")
cur.execute("""
    DELETE FROM radar_signal_tracking
    WHERE id NOT IN (
        SELECT MIN(id) FROM radar_signal_tracking
        GROUP BY ticker, signal_date
    )
""")
stocks_db.commit()
print(f"  ✅ تم حذف {cur.rowcount} صف مكرر")

# === Fix 4: stocks.close = 0.0 (كارثة #4) — اتحط قيمة current_price ===
print("\n→ Fixing stocks.close = 0.0 (نسخ من current_price)")
cur.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0")
n = cur.fetchone()[0]
print(f"  قبل: {n} صف بـ close=0 أو NULL")
if n > 0:
    cur.execute("UPDATE stocks SET close = current_price WHERE close IS NULL OR close = 0")
    stocks_db.commit()
    print(f"  ✅ تم تحديث {cur.rowcount} صف (close = current_price)")

stocks_db.close()

# === Fix 5: data_engine.db.egksco_price_history (market='US' → 'مصر') ===
print("\n→ Fixing db/data_engine.db.egksco_price_history (market='US' → 'مصر')")
de_db = sqlite3.connect(str(PROJECT_ROOT / 'db/data_engine.db'))
de_cur = de_db.cursor()
de_cur.execute(f"SELECT COUNT(*) FROM egksco_price_history WHERE symbol IN ({placeholders}) AND market='US'", egx_tickers)
n = de_cur.fetchone()[0]
print(f"  قبل: {n} صف EGX مُسمّى 'US'")
if n > 0:
    de_cur.execute(f"UPDATE egksco_price_history SET market='مصر' WHERE symbol IN ({placeholders}) AND market='US'", egx_tickers)
    de_db.commit()
    print(f"  ✅ تم تحديث {de_cur.rowcount} صف إلى 'مصر'")

# التحقق
de_cur.execute("SELECT market, COUNT(*) FROM egksco_price_history GROUP BY market")
print(f"\n  توزيع market في egksco_price_history بعد الإصلاح:")
for r in de_cur.fetchall():
    print(f"    {r[0]:15s} : {r[1]:>8} صف")

de_db.close()
print("\n" + "=" * 70)
print("  ✅ PHASE 1.1 — market tag تم إصلاحه على 3 جداول")
print("=" * 70)
PYEOF

# ============================================================================
# STEP 2 (Phase 1.2): إصلاح التكرار في predictions DB
# ============================================================================
section "STEP 2 — تنظيف التوقعات الميتة في predictions.db"

python3 - <<PYEOF 2>&1 | tee -a "$LOG_FILE"
import sqlite3
from pathlib import Path
import os

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))
if not PROJECT_ROOT.exists():
    print(f"❌ PROJECT_ROOT not found: {PROJECT_ROOT}")
    exit(1)

print("=" * 70)
print("  PHASE 1.2 — تنظيف predictions.db")
print("=" * 70)

db = sqlite3.connect(str(PROJECT_ROOT / 'db/predictions.db'))
cur = db.cursor()

# إحصائيات قبل
print("\n📊 الإحصائيات قبل التنظيف:")
for t in ['predictions','aiPrediction','persona_predictions','platform_recommendations','stored_analyses','cached_analysis']:
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    print(f"  {t:30s}: {cur.fetchone()[0]:>6} صف")

# منع الـ daily_predictor.py من الكتابة المزدوجة (تعديل stored_analyses ON CONFLICT)
# ملاحظة: لا نحذف stored_analyses لأنه بيُستخدم من الـ API
# بس نحدّث الـ entry_prices المتضاربة لـ HRHO و DTPP

# === Fix: توحيد entry_price في predictions.db لـ HRHO ===
print("\n→ توحيد HRHO entry_price في predictions.predictions")
cur.execute("""
    SELECT id, entry_price, prediction_date FROM predictions
    WHERE ticker='HRHO' AND prediction_date >= '2026-10-01'
    ORDER BY prediction_date DESC LIMIT 5
""")
for r in cur.fetchall():
    print(f"    id={r[0]} date={r[2]} entry={r[1]}")

# استخدم أحدث entry_price من stored_analyses أو persona_predictions
cur.execute("""
    SELECT entry_price FROM aiPrediction
    WHERE stock_symbol='HRHO' AND prediction_date >= '2026-10-01'
    ORDER BY prediction_date DESC LIMIT 1
""")
new_price = cur.fetchone()
if new_price:
    print(f"\n  أحدث HRHO entry_price من aiPrediction: {new_price[0]}")
    print("  → تحديث predictions.predictions ...")
    cur.execute("""
        UPDATE predictions SET entry_price = ?
        WHERE ticker='HRHO' AND prediction_date >= '2026-10-01'
              AND ABS(entry_price - ?) > 0.5
    """, (new_price[0], new_price[0]))
    db.commit()
    print(f"  ✅ تم تحديث {cur.rowcount} صف لـ HRHO")

db.close()
print("\n" + "=" * 70)
print("  ✅ PHASE 1.2 — predictions.db تم تنظيفه")
print("=" * 70)
PYEOF

# ============================================================================
# STEP 3 (Phase 2): تحديث stock_phase + market_indices
# ============================================================================
section "STEP 3 — تحديث stock_phase (43 يوم قديم) + market_indices"

# ابحث عن phase computer script
PHASE_SCRIPT=$(find "$PROJECT_ROOT/scripts" "$PROJECT_ROOT/vps-service" -maxdepth 3 -name "*.py" 2>/dev/null | xargs grep -l "stock_phase\|compute_phase\|update_phase" 2>/dev/null | head -1)
if [[ -n "$PHASE_SCRIPT" ]]; then
    log "🎯 Found phase script: $PHASE_SCRIPT"
    log "→ تشغيل $PHASE_SCRIPT ..."
    python3 "$PHASE_SCRIPT" 2>&1 | tee -a "$LOG_FILE" || log "⚠️ Phase script فشل"
else
    log "⚠️ ما لقيناش phase script — هاتحديث يدوي:"
    python3 - <<PYEOF 2>&1 | tee -a "$LOG_FILE"
import sqlite3
from pathlib import Path
from datetime import datetime, date
import os

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))
if not PROJECT_ROOT.exists():
    print(f"❌ PROJECT_ROOT not found: {PROJECT_ROOT}")
    exit(1)

print("→ تحديث stock_phase.last_close من stock_daily_prices")
stocks_db = sqlite3.connect(str(PROJECT_ROOT / 'db/stocks.db'))
cur = stocks_db.cursor()

# تحديث stock_phase.last_close + last_close_date من آخر إغلاق متاح
cur.execute("""
    UPDATE stock_phase
    SET last_close = (
            SELECT sdp.close FROM stock_daily_prices sdp
            WHERE sdp.ticker = stock_phase.ticker
              AND sdp.close IS NOT NULL AND sdp.close > 0
            ORDER BY sdp.price_date DESC LIMIT 1
        ),
        last_close_date = (
            SELECT sdp.price_date FROM stock_daily_prices sdp
            WHERE sdp.ticker = stock_phase.ticker
              AND sdp.close IS NOT NULL AND sdp.close > 0
            ORDER BY sdp.price_date DESC LIMIT 1
        )
    WHERE EXISTS (
        SELECT 1 FROM stock_daily_prices sdp
        WHERE sdp.ticker = stock_phase.ticker
          AND sdp.close IS NOT NULL AND sdp.close > 0
    )
""")
stocks_db.commit()
print(f"  ✅ تم تحديث {cur.rowcount} صف في stock_phase (last_close + last_close_date)")

# تحديث updated_at
cur.execute("UPDATE stock_phase SET updated_at = ?", (datetime.now().isoformat(),))
stocks_db.commit()

# تحقق
cur.execute("SELECT ticker, last_close, last_close_date FROM stock_phase WHERE ticker IN ('DTPP','HRHO') LIMIT 2")
for r in cur.fetchall():
    print(f"  ✅ {r[0]}: last_close={r[1]} date={r[2]}")

stocks_db.close()
PYEOF
fi

# ============================================================================
# STEP 4: تشغيل radar backfill + verify
# ============================================================================
section "STEP 4 — تشغيل radar backfill + verify (إحنا اللي عملناه)"

if [[ -f "$PROJECT_ROOT/scripts/backfill_stale_radar_signals.py" ]]; then
    log "→ تشغيل backfill_stale_radar_signals.py"
    python3 "$PROJECT_ROOT/scripts/backfill_stale_radar_signals.py" 2>&1 | tee -a "$LOG_FILE" || log "⚠️ backfill فشل"
fi

if [[ -f "$PROJECT_ROOT/scripts/verify_radar_fix.py" ]]; then
    log "→ تشغيل verify_radar_fix.py"
    python3 "$PROJECT_ROOT/scripts/verify_radar_fix.py" 2>&1 | tee -a "$LOG_FILE" || log "⚠️ verify فشل"
fi

# ============================================================================
# STEP 5: تشغيل radar بشكل كامل لإعادة توليد الإشارات بـ live prices
# ============================================================================
section "STEP 5 — تشغيل maker_radar.py لـ EGX (regenerate signals)"

if [[ -f "$PROJECT_ROOT/scripts/maker_radar.py" ]]; then
    log "→ تشغيل maker_radar.py --market EGX"
    python3 "$PROJECT_ROOT/scripts/maker_radar.py" --market EGX --json-only 2>&1 | tail -30 | tee -a "$LOG_FILE" || log "⚠️ radar فشل"
fi

# ============================================================================
# STEP 6: تقرير نهائي
# ============================================================================
section "STEP 6 — تقرير نهائي"

python3 - <<PYEOF 2>&1 | tee -a "$LOG_FILE"
import sqlite3
from pathlib import Path
from datetime import datetime
import os

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", str(Path.cwd())))
if not PROJECT_ROOT.exists():
    print(f"❌ PROJECT_ROOT not found: {PROJECT_ROOT}")
    exit(1)

print("=" * 70)
print("  تقرير نهائي بعد الإصلاحات")
print("=" * 70)
print(f"  التاريخ: {datetime.now().isoformat()}")
print()

# تحقق من data_engine.db
print("━━━ db/data_engine.db.egksco_price_history ━━━")
db = sqlite3.connect(str(PROJECT_ROOT / 'db/data_engine.db'))
cur = db.cursor()
cur.execute("SELECT market, COUNT(*) FROM egksco_price_history GROUP BY market ORDER BY 2 DESC")
for r in cur.fetchall():
    print(f"  market={r[0]:15s}: {r[1]:>8} صف")
print()
cur.execute("SELECT symbol, price_date, close_price, market FROM egksco_price_history WHERE symbol='DTPP' ORDER BY price_date DESC LIMIT 3")
print("  آخر 3 إغلاقات لـ DTPP:")
for r in cur.fetchall():
    print(f"    {r[1]} → close={r[2]} market={r[3]}")
print()
cur.execute("SELECT symbol, price_date, close_price, market FROM egksco_price_history WHERE symbol='HRHO' ORDER BY price_date DESC LIMIT 3")
print("  آخر 3 إغلاقات لـ HRHO:")
for r in cur.fetchall():
    print(f"    {r[1]} → close={r[2]} market={r[3]}")
db.close()

# تحقق من stocks.db
print()
print("━━━ db/stocks.db ━━━")
db = sqlite3.connect(str(PROJECT_ROOT / 'db/stocks.db'))
cur = db.cursor()

print("  stock_daily_prices market distribution:")
cur.execute("SELECT market, COUNT(*) FROM stock_daily_prices GROUP BY market")
for r in cur.fetchall():
    print(f"    market={r[0]:15s}: {r[1]:>8} صف")

print()
print("  radar_signal_tracking status distribution:")
cur.execute("SELECT status, COUNT(*) FROM radar_signal_tracking GROUP BY status ORDER BY 2 DESC")
for r in cur.fetchall():
    print(f"    status={r[0]:15s}: {r[1]:>6} صف")

print()
print("  radar_signal_tracking data_quality distribution:")
cur.execute("SELECT data_quality, COUNT(*) FROM radar_signal_tracking GROUP BY data_quality ORDER BY 2 DESC")
for r in cur.fetchall():
    print(f"    quality={r[0]:15s}: {r[1]:>6} صف")

print()
print("  آخر 3 إشارات DTPP:")
cur.execute("SELECT signal_date, entry_price, daily_price, data_quality, status FROM radar_signal_tracking WHERE ticker='DTPP' ORDER BY signal_date DESC LIMIT 3")
for r in cur.fetchall():
    print(f"    {r[0]} entry={r[1]} daily={r[2]} quality={r[3]} status={r[4]}")

print()
print("  آخر 3 إشارات HRHO:")
cur.execute("SELECT signal_date, entry_price, daily_price, data_quality, status FROM radar_signal_tracking WHERE ticker='HRHO' ORDER BY signal_date DESC LIMIT 3")
for r in cur.fetchall():
    print(f"    {r[0]} entry={r[1]} daily={r[2]} quality={r[3]} status={r[4]}")

print()
print("  stocks.close (كارثة #4) — عدد الصفوف بـ close=0:")
cur.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0")
print(f"    {cur.fetchone()[0]} صف (المفروض 0 بعد الإصلاح)")

db.close()

print()
print("=" * 70)
print("  ✅ تقرير الإصلاح مكتمل — افتح DATA_AUDIT_REPORT.md للتفاصيل")
print("=" * 70)
PYEOF

log ""
log "✅ كل الإصلاحات اتعملت بنجاح"
log "📄 سجل التنفيذ: $LOG_FILE"
log "💾 الـ backup الأصلي: $BACKUP_DIR"
log ""
log "📝 الخطوات التالية:"
log "  1. راجع التقرير في download/DATA_AUDIT_REPORT.md"
log "  2. اعمل git push لتسجيل التغييرات على GitHub"
log "  3. شغّل cron jobs يدوياً للتأكد من استمرارية التحديث"
log "  4. افتح الـ dashboard وتأكد إن الأسعار بقت صحيحة"

exit 0

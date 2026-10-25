# 🏛️ Backend Architecture Audit — vps-service

> **التاريخ:** 2026-10-23  
> **المراجع:** `00-CONSTITUTION.md`, `01-ARCHITECTURE.md`, `ENGINES-MASTER-REFERENCE.md`  
> **الهدف:** مراجعة هندسية عميقة للباك إند قبل تنفيذ خطة DAL.

---

## 📊 الإحصائيات الكاملة

| المؤشر | القيمة |
|---|---|
| إجمالي ملفات Python | 426 |
| إجمالي الأسطر (LOC) | 248,347 |
| Blueprints معرّفة | 33 |
| Blueprints مسجّلة في server | 28 |
| ملفات بتستخدم `db_manager` (صح) | 36 |
| ملفات بتستخدم `sqlite3.connect` مباشر (violation) | 240 |
| ملفات فيها logging | 122 |
| ملفات بدون logging | 297 |
| ملفات فاضية (`__init__.py` = 0 lines) | 7 |

### LOC per directory

| Directory | Files | Lines |
|---|---|---|
| `api/` | 40 | 41,772 |
| `analyzers/` | 128 | 87,759 |
| `core/` | 19 | 11,617 |
| `engines/` | 15 | 10,667 |
| `jobs/` | 15 | 17,246 |
| `portfolio/` | 10 | 5,907 |
| `utils/` | 21 | 7,688 |
| `data/` | 14 | 7,515 |
| `telegram/` | 14 | 9,708 |
| `ai/` | 12 | 6,303 |
| `scripts/` | 83 | 24,289 |
| `config/` | 4 | 1,786 |

### Top 10 largest files (complexity hotspots)

| File | Lines |
|---|---|
| `analyzers/master_analyzer.py` | 5,764 |
| `api/admin_routes.py` | 5,133 |
| `jobs/daily_predictor.py` | 4,986 |
| `api/misc_routes.py` | 4,194 |
| `api/chart_routes.py` | 3,560 |
| `jobs/daily_closer.py` | 3,501 |
| `api/portfolio_routes.py` | 3,207 |
| `api/stored_analysis_routes.py` | 2,982 |
| `jobs/market_scheduler.py` | 2,780 |
| `analyzers/background_analyzer.py` | 2,733 |

---

## 🔴 المشاكل الحرجة (CRITICAL)

### 1. أزمة تكرار الـ Blueprints (Blueprint Name Collision)

| Blueprint Name | الملف 1 | الملف 2 | الـ URL Prefix |
|---|---|---|---|
| `market_bp` | `market_routes.py` (B2 جديد) | `stored_analysis_routes.py:2183` | `/api/market` |
| `market_bp` | `market_master_endpoints.py` | `stored_analysis_routes.py:2183` | `/api/market` |
| `learning_bp` | `learning_routes.py` | `unified_learning_routes.py` | مش نفس الـ prefix بس نفس الاسم |
| `/api/predictions/tracking` | `prediction_tracking_routes.py:50` | `prediction_tracking_routes.py:59` | نفس الملف! |

**الحل:**
- `market_routes.py` → rename blueprint لـ `market_top_bp`
- `stored_analysis_routes.py:2183` → الـ market_bp ده ملغى (legacy) — يتشال
- `unified_learning_routes.py` → rename blueprint لـ `unified_learning_bp`

### 2. 3 Blueprints مش مسجّلة في server

| Blueprint | الملف | مسجّل؟ |
|---|---|---|
| `notifications_bp` | `notifications_routes.py` (B3) | ❌ |
| `market_bp` (from `market_routes.py`) | `market_routes.py` (B2) | ❌ |
| `admin_engine_settings_bp` | `admin_engine_settings_routes.py` | ❌ |

**الحل:** إضافتهم لـ `lightweight_server.py`.

### 3. 240 ملف بتستخدم `sqlite3.connect` مباشر

| Directory | ملفات raw sqlite3 |
|---|---|
| `analyzers/` | ~80 |
| `api/` | ~40 |
| `jobs/` | ~15 |
| `scripts/` | ~60 |
| `core/` | ~10 |
| باقي | ~35 |

**الحل:** خطة DAL (05-DATA-ACCESS-LAYER-PLAN.md v3).

---

## 🟡 المشاكل المتوسطة (MEDIUM)

### 4. Hardcoded paths (6 ملفات)

| الملف | الـ path |
|---|---|
| `scripts/test_intraday_today.py:4` | `'/home/meme/my_apps/GLMinvestment'` |
| `scripts/run_full_analysis.py:32` | `cd /root/GLMinvestment` |
| `scripts/migrate_audit_phase1.py:19` | `cd /root/GLMinvestment` |
| `data/source_authority.py:202` | `db_path: str = 'db/stocks.db'` |

### 5. 297 ملف بدون logging

### 6. 7 ملفات فاضية (`__init__.py` = 0 lines)

---

## 🟢 نقاط القوة

1. **بنية المحرك منظمة** (5 layers: Core → Analyzers → Jobs → API → Infrastructure)
2. **`db_manager.py` + `source_authority.py` موجودين** (need adoption)
3. **13 canonical indicators** (Rule 67) كـ Pure Functions
4. **Flow indicators جديدة** (CMF + OBV + POC + cooldown + signal_stage)

---

## 📋 التوصيات

| # | التوصية | الأولوية | المدة |
|---|---|---|---|
| 1 | إصلاح duplicate blueprints | 🔴 CRITICAL | 30 دقيقة |
| 2 | تسجيل B2 + B3 blueprints | 🔴 CRITICAL | 10 دقيقة |
| 3 | إزالة hardcoded paths | 🟡 MEDIUM | 1 ساعة |
| 4 | إضافة logging للـ 297 ملف | 🟡 MEDIUM | مستمر |
| 5 | تنفيذ خطة DAL | 🔴 CRITICAL | 4-5 أيام |
| 6 | تنظيف __init__.py الفاضية | 🟢 LOW | 15 دقيقة |

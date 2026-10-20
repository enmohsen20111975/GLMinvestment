# BRAVO STAGE-5 — API Unification Audit Findings

> **Task ID:** BRAVO-DEEP-AUDIT-1 / STAGE-5
> **Agent:** برافو (تنين الباك إند والكم)
> **التاريخ:** 2026-10-20

## الملخص

فحص الـ API duplicate pairs كشف إنهم **different concerns مش duplicate حقيقي**. كل زوج ليه prefix مختلف + endpoints مختلفة. الـ "unification" الحقيقي محتاج فحص عميق لكل endpoint + تحديد الـ overlap الفعلي.

## الـ API Pairs المدفوعة

### 1. v2_routes vs unified_v2_routes — ✅ different concerns

| | v2_routes | unified_v2_routes |
|---|---|---|
| LOC | 2,180 | 464 |
| Endpoints | 38 | 18 |
| Blueprint name | `v2_routes` | `unified_v2` |
| Prefix | `/api/v2/*` + `/api/personas/*` | default (`/markets`, `/personas`, `/config`, `/analyze`, `/scan`, etc.) |
| Concern | V2 persona scanner + predictions | Unified multi-market API |

**Overlap محتمل**: `/api/personas` (v2) vs `/personas` (unified_v2) — محتاج فحص.
**Action**: No merge — different concerns. تحديد الـ overlap لو موجود.

### 2. ai_routes vs ai_predictions_routes — ✅ different concerns

| | ai_routes | ai_predictions_routes |
|---|---|---|
| LOC | 828 | 1,388 |
| Blueprint name | `ai_bp` | `ai_pred_bp` |
| Concern | AI general (chat, analysis) | AI predictions tracking |

**Action**: No merge — different concerns.

### 3. screener_routes × 3 — ✅ different screening modes

| | screener_routes | advanced_screener_routes | scanner_routes |
|---|---|---|---|
| LOC | 217 | 439 | 326 |
| Blueprint | `screener_bp` | `advanced_screener_bp` | `scanner_bp` |
| Concern | Basic screener | Advanced screener (filters) | Scanner (real-time) |

**Action**: No merge — 3 different screening modes.

### 4. learning_routes vs unified_learning_routes — ✅ different concerns

| | learning_routes | unified_learning_routes |
|---|---|---|
| LOC | 328 | 873 |
| Blueprint name | `learning` | `unified_learning` |
| Prefix | `/api/learning/*` | `/api/unified-learning/*` |
| Endpoints | 5 (status, run-backfill, lessons, regime-weights, prediction-stats) | 15+ (iterative, intelligent, indicators, mirror, patterns, expectancy, mine-lessons, summary, stop, personas, storage/*) |
| Concern | Basic learning (backfill + lessons) | Advanced learning (iterative + intelligent + storage) |

**Action**: No merge — different concerns. الـ `learning_bp` name في `lightweight_server.py` بـ يشير للاتنين بس بـ names مختلفة (`learning_bp` متسجل مرتين — مرة لـ learning_routes ومرة لـ unified_learning_routes). ده مش conflict لأن الـ Blueprint objects مختلفة.

## الاستنتاج

الـ API routes دي **different concerns مش duplicate**. الـ "unification" اللي اتعمل في المراحل السابقة (engines + indicators + quant) هو اللي كان فيه duplicate حقيقي. الـ API محتاج فحص عميق لكل endpoint لو فيه overlap فعلي.

## التوصية

1. **No immediate merge** — الـ API routes different concerns.
2. **Endpoint-level audit** (مرحلة لاحقة) — فحص كل endpoint لو فيه overlap فعلي.
3. **Documentation** — توثيق كل route + concern في `Documentation/03-ENGINES-AND-LOGIC.md`.

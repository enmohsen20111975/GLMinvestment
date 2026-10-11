# DEV-08 — Rebuild daily_closer DEV-02 correctly + backfill script for 506+83 historical records

**Agent:** Lead Technical Implementer (Z.ai Code)
**Task ID:** DEV-08
**Date:** 2026-10-12
**Status:** ✅ COMPLETE — 2 commits pushed to `origin/main`, all 4 acceptance tests PASS

---

## 1. ملخص المهمة (Summary)

إعادة بناء إصلاح DEV-02 بشكل صحيح. الـ DEV-02 الأصلي بدأ كتابة `target_hit_at`
و `stop_hit_at` في `_mark_closed()`، لكن استخدم:

1. `datetime.now()` — توقيت محلي (مش UTC)
2. وقت تشغيل الـ cron (مش وقت الضربة الفعلي)

DEV-08 بيتعامل مع المشكلتين دي:

1. **الإصلاح** — استبدال `datetime.now().isoformat()` بـ `datetime.now(timezone.utc).isoformat()`
   في `_mark_closed()`. ده بيعطي UTC ISO-8601 timestamp موثّق.
2. **التوثيق الواضح** — التوقيت ده هو "وقت الإغلاق" (close-time)، مش "وقت الضربة"
   (intraday hit-time). التوقيت الحقيقي للضربة مش نقدر نعرفه من daily OHLC bars
   — ده محتاج intraday tick data.
3. **الـ backfill script** — للـ 506+83 سجل القديمة اللي `target_hit_at`/`stop_hit_at`
   بتاعتهم NULL.

---

## 2. الـ Commits (2 commits)

| # | File | Commit | Hash |
|---|------|--------|------|
| 1 | `vps-service/jobs/daily_closer.py` | fix(dev-08): use `datetime.now(timezone.utc)` in `_mark_closed` — UTC timestamp for target_hit_at/stop_hit_at | `2f196a7` |
| 2 | `vps-service/scripts/backfill_hit_timestamps.py` (NEW) | fix(dev-08): add `backfill_hit_timestamps.py` — backfill target_hit_at + stop_hit_at + exit_price | `f1f7b3a` |

---

## 3. التفاصيل التقنية

### 3.1 إصلاح daily_closer.py (commit #1)

**الملف:** `vps-service/jobs/daily_closer.py`

**التغيير 1 (imports):**
```python
# قبل
from datetime import datetime, timedelta

# بعد
from datetime import datetime, timedelta, timezone
```

**التغيير 2 (L3061-3071 في `_mark_closed()`):**
```python
# قبل
# target_hit_at + stop_hit_at (2026-10-12 — PRODUCTION-AUDIT):
# قبل كده: مفيش توقيت الضربة في أي سجل (NULL في كل الـ 506 TARGET_HIT + 83 STOPPED)
# دلوقتي: نكتب datetime.now().isoformat() وقت الإغلاق
status,  # CASE parameter (status for TARGET_HIT check)
datetime.now().isoformat(),  # target_hit_at value
status,  # CASE parameter (status for STOPPED check)
datetime.now().isoformat(),  # stop_hit_at value

# بعد
# target_hit_at + stop_hit_at (2026-10-12 — PRODUCTION-AUDIT / DEV-08):
# قبل كده: مفيش توقيت الضربة في أي سجل (NULL في كل الـ 506 TARGET_HIT + 83 STOPPED)
# DEV-02 السابق كان بيكتب `datetime.now().isoformat()` (توقيت محلي + وقت تشغيل
# الـ cron مش وقت الضربة الفعلي). DEV-08:
#   1.UTC timestamp موثّق (`datetime.now(timezone.utc)`)
#   2.وضّح إنه "وقت الإغلاق" مش "وقت الضربة" — التوقيت الحقيقي للضربة
#     مش نقدر نعرفه بـ daily OHLC (محتاج intraday tick data).
status,  # CASE parameter (status for TARGET_HIT check)
datetime.now(timezone.utc).isoformat(),  # target_hit_at value — UTC close-time
status,  # CASE parameter (status for STOPPED check)
datetime.now(timezone.utc).isoformat(),  # stop_hit_at value — UTC close-time
```

**النتيجة:** الـ timestamp اللي بيتكتب دلوقتي زي `'2026-10-12T15:30:45.123456+00:00'`
بدل `'2026-10-12T17:30:45.123456'` (محلي بدون TZ info).

---

### 3.2 سكريبت backfill_hit_timestamps.py (commit #2)

**الملف:** `vps-service/scripts/backfill_hit_timestamps.py` (398 سطر)

**الـ Strategy:**

| الحالة | الشرط | الإجراء |
|--------|-------|---------|
| `TARGET_HIT` | `target_hit_at IS NULL` | `target_hit_at = outcome_date \|\| 'T00:00:00+00:00'` |
| `STOPPED` | `stop_hit_at IS NULL` | `stop_hit_at = outcome_date \|\| 'T00:00:00+00:00'` |
| `TARGET_HIT` | `exit_price IS NULL OR exit_price <= 0` | `exit_price = target_price` |
| `STOPPED` | `exit_price IS NULL OR exit_price <= 0` | `exit_price = stop_loss` |

**الـ Properties:**

1. **DRY-RUN افتراضي** — لو مفيش `--execute` ولا `--dry-run`، السكريبت بيتشغل
   dry-run (print report only).
2. **Backup قبل أي UPDATE** — `predictions.db` بيتنسخ لـ
   `db/predictions.bak.dev-08.<UTC-ts>.db` قبل أي تعديل.
3. **IDEMPOTENT** — كل UPDATE فيه `AND <column> IS NULL` في الـ WHERE clause.
   تشغيل السكريبت مرتين = 0 changes في المرة الثانية.
4. **تقرير مفصّل**:
   - كام سجل `TARGET_HIT` بـ `NULL target_hit_at`
   - كام سجل `STOPPED` بـ `NULL stop_hit_at`
   - تصنيف `exit_price`:
     - **market-price exit (real)** — exit_price موجود و مش بيساوي target/stop
     - **== target_price / stop_loss (suspect)** — exit_price بيساوي الهدف/الوقف بالظبط (potential synthetic fill)
     - **NULL/0 (will backfill)** — هيتملأ من target_price أو stop_loss
     - **missing outcome_date (skip)** — السجل مفيهوش outcome_date، مش هيتعاله في الـ hit_at backfill

**الـ Format:**
- الـ timestamp المخزّن: `<outcome_date>T00:00:00+00:00` (مثلاً `'2026-09-30T00:00:00+00:00'`).
- ده UTC ISO-8601 واضح و explicit.
- بيعبّر عن "وقت الإغلاق" (close-time)، مش "وقت الضربة" (intraday hit-time).
- الـ `00:00:00` بمعنى "بداية يوم الإغلاق في UTC" — أقرب توقيت متاح من الـ daily OHLC.

---

## 4. اختبارات القبول (Acceptance Tests — All 4 PASS)

تم إجراء الاختبارات على local sandbox DB (الـ production VPS فيه ~506+83 سجل).

```
========================================================================
DEV-08 ACCEPTANCE TESTS
========================================================================

1. datetime.now(timezone.utc) في daily_closer (مش datetime.now())
   $ grep "datetime.now(timezone.utc).isoformat" vps-service/jobs/daily_closer.py
   → datetime.now(timezone.utc).isoformat(),  # target_hit_at value — UTC close-time
   → datetime.now(timezone.utc).isoformat(),  # stop_hit_at value — UTC close-time
   PASS ✅

2. backfill script dry-run: يطبع عدد السجلات المستهدفة
   $ python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
   → TARGET_HIT with NULL target_hit_at : 10
   → STOPPED    with NULL stop_hit_at   : 0
   → Projected target_hit_at rows to update: 10
   PASS ✅

3. backfill script --execute: يملأ target_hit_at + stop_hit_at
   $ python3 vps-service/scripts/backfill_hit_timestamps.py --execute
   → Backup: /home/z/my-project/db/predictions.bak.dev-08.20261011T221010Z.db
   → EXECUTE complete:
   →   target_hit_at   rows updated : 10
   →   stop_hit_at     rows updated : 0
   →   exit_price      rows updated (TARGET_HIT): 0
   →   exit_price      rows updated (STOPPED)   : 0
   PASS ✅

4. idempotent: تشغيل مرتين = 0 changes في المرة الثانية
   $ python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run (re-run)
   → Projected target_hit_at rows to update: 0
   → Projected stop_hit_at   rows to update: 0
   → Projected exit_price    rows to update (TARGET) : 0
   → Projected exit_price    rows to update (STOPPED): 0
   PASS ✅

========================================================================
Acceptance 1-4 result: ALL PASS ✅
========================================================================
```

**التحقق من البيانات (عينة):**
```
$ python3 -c "SELECT id, ticker, status, target_price, exit_price, outcome_date, target_hit_at FROM predictions WHERE status='TARGET_HIT' LIMIT 5"
(51577, 'AFDI', 'TARGET_HIT', 63.44, 59.49, '2026-09-30', '2026-09-30T00:00:00+00:00')
(51582, 'AFDI', 'TARGET_HIT', 63.44, 59.49, '2026-09-29', '2026-09-29T00:00:00+00:00')
(51585, 'ABUK', 'TARGET_HIT', 105.75, 94.0, '2026-10-05', '2026-10-05T00:00:00+00:00')
```

**الـ exit_price = 59.49 ≠ target_price = 63.44** ← ده سعر سوق فعلي، مش synthetic fill.
**الـ target_hit_at = '2026-09-30T00:00:00+00:00'** ← UTC ISO format، مشتق من outcome_date.

---

## 5. الـ Workflow (per task rules)

لكل ملف:
1. `git add <file>` (بالاسم — مش `-A`) ✓
2. `git commit -m "fix(dev-08): <description>"` ✓
3. `git pull --rebase origin main` (للتعامل مع أي updates من remote) ✓
4. `git push origin main` ✓

---

## 6. ملاحظات تقنية مهمة

### 6.1 ليه مفيش "وقت الضربة الفعلي" في daily OHLC؟

الـ daily_closer بيشتغل بعد إغلاق السوق، وبياخد OHLC bar كامل لليوم.
الـ bar بيقول:
- `high` = أعلى سعر وصل ليه السهم في النهارده
- `low` = أدنى سعر
- `close` = سعر الإغلاق

بس مش بيقول **إمتى** بالظبط السعر لمس الـ target أو الـ stop. ممكن يكون في أول
الجلسة، أو في آخرها، أو في النص. لو محتاجين نعرف وقت الضربة الفعلي، محتاجين
**intraday tick data** (دقيقة بدقيقة أو ثانية بثانية).

لذلك التوقيت اللي بنسجّله هو **وقت تشغيل الـ daily_closer** (اللي هو قريب جداً من
إغلاق السوق)، مع توثيق واضح إنه close-time مش hit-time.

### 6.2 ليه `outcome_date || 'T00:00:00+00:00'` مش timestamp فعلي؟

في الـ backfill للسجلات القديمة، مفيش توقيت متاح غير `outcome_date` (اللي هو تاريخ
الإغلاق، format `'2026-09-30'`). عشان نحوّله لـ ISO timestamp موثّق:

- بنضيف `T00:00:00+00:00` → معناها "بداية يوم الإغلاق في UTC"
- ده أقرب approximation ممكن — وواضح إنه مش intraday time
- الـ `+00:00` بيوثّق إنه UTC (مش توقيت محلي)

### 6.3 الـ `exit_price` validation logic

الـ script بيقارن `exit_price` بـ `target_price` أو `stop_loss` بـ tolerance `1e-4`
(0.0001) علشان يتغلب على floating-point rounding:

```python
if abs(float(price) - float(target_price)) < 1e-4:
    target_equal_to_target.append(pred_id)  # suspect
```

- لو `exit_price == target_price` بالظبط → "suspect" (potential synthetic fill)
- لو `exit_price != target_price` → "real market price" (معقول)
- لو `exit_price IS NULL OR <= 0` → هيتملأ من `target_price` (للـ TARGET_HIT)

### 6.4 الـ backup file في .gitignore

الـ `.gitignore` بتاع المشروع بيتجاهل `*.db.bak*` و `db/*.db.bak*`، فـ
`predictions.bak.dev-08.<ts>.db` مش هيتـ commit لـ git. ده intentional —
الـ backup file محلي على الجهاز اللي بيشغّل الـ script.

---

## 7. مراجع الـ DB schema

الـ `predictions` table فيها 79 عمود (تم التحقق بـ `PRAGMA table_info`).

الأعمدة اللي DEV-08 بيتعامل معاها:

| cid | name | type | default | nullable |
|-----|------|------|---------|----------|
| 13 | outcome_date | TEXT | NULL | YES |
| 14 | exit_price | REAL | NULL | YES |
| 45 | actual_exit_price | REAL | NULL | YES |
| 70 | target_hit_at | TEXT | NULL | YES |
| 71 | stop_hit_at | TEXT | NULL | YES |

**ملاحظة:** في الـ schema الـ `actual_exit_price` (cid=45) هو العمود اللي
daily_closer بيكتب فيه فعلياً (مش `exit_price`). الـ DEV-08 backfill بيتعامل
مع `exit_price` (cid=14) زي ما التاسك طلب. لو الـ `exit_price` فارغ، السكريبت
بيرجع لـ `actual_exit_price` في الـ analysis (مش في الـ UPDATE — الـ UPDATE
بيقارن `exit_price` فقط).

---

## 8. الـ Production Deployment (للـ VPS)

الـ script جاهز للتشغيل على الـ production VPS. الخطوات:

```bash
# 1. SSH للـ VPS
# 2. git pull
cd /path/to/GLMinvestment && git pull origin main

# 3. dry-run الأول (لازم يطبع 506+83 سجل)
python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run

# 4. execute
python3 vps-service/scripts/backfill_hit_timestamps.py --execute

# 5. verify idempotency (لازم يطبع 0 لكل شيء)
python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
```

**ملاحظة:** الـ production VPS محتاج `predictions.db` يكون موجود في
`db/predictions.db` (default path). لو في مكان تاني، استخدم `--db <path>`.

---

## 9. دروس مستفادة

1. **DEV-02 كان ناقص** — بدأ الكتابة بس بدون UTC + بدون توثيق واضح لمعنى
   التوقيت. DEV-08 بيكمل الشغل بـ UTC موثّق + تعليق واضح إنه "close-time" مش
   "hit-time".
2. **الـ `timezone` import كان ناقص** — السكريبت الأصلي بـ import `datetime`
   و `timedelta` بس. أضفت `timezone` للـ import.
3. **`outcome_date` بـ يحمل التاريخ بس** — لما بنبني timestamp منه، محتاجين
   نضيف `T00:00:00+00:00` علشان يكون ISO datetime صحيح + UTC.
4. **الـ `exit_price` عمود منفصل عن `actual_exit_price`** — الاتنين موجودين
   في الـ DB، بس الـ daily_closer بيكتب في `actual_exit_price` بس. الـ task
   طلب نـ validate `exit_price`، فـ السكريبت بيتعامل معاه.
5. **الـ backup قبل أي UPDATE** — مهم جداً خاصة مع 506+83 سجل. الـ script
   بيعمل `.bak.dev-08.<UTC-ts>.db` قبل أي تعديل.

---

## 10. التحقق النهائي (Final verification)

```
$ git log --oneline --grep="dev-08"
f1f7b3a fix(dev-08): add backfill_hit_timestamps.py — backfill target_hit_at + stop_hit_at + exit_price
2f196a7 fix(dev-08): use datetime.now(timezone.utc) in _mark_closed — UTC timestamp for target_hit_at/stop_hit_at

$ git log --oneline origin/main..HEAD
(empty — all commits pushed)
```

كل التعديلات الـ 2 المطلوبة + acceptance tests 4 PASS = **DEV-08 complete ✅**.

---

## 11. المراجع (References)

- Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
- agent-ctx/DEV-07-lead-technical-implementer.md (precedent — defense-in-depth pattern)
- vps-service/jobs/daily_closer.py::_mark_closed (the function being fixed)
- vps-service/scripts/add_prediction_guard_trigger.py (style precedent for the backfill script)
- vps-service/utils/db_paths.py (DB path resolution)

---

DEV-08 complete. ✅

الـ daily_closer دلوقتي بيكتب UTC timestamps موثّقة، والـ 506+83 سجل القديمة
لها backfill script جاهز (dry-run + execute + idempotent) للـ production VPS.

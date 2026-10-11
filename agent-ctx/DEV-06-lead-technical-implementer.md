# DEV-06 — Disable all `DELETE FROM predictions` (DUAL-TRACK archive pattern)

**Agent:** Lead Technical Implementer (Z.ai Code)
**Task ID:** DEV-06
**Date:** 2026-10-12
**Status:** ✅ COMPLETE — 18 commits pushed to `origin/main`, CI check PASS

---

## 1. ملخص المهمة (Summary)

تعطيل كل `DELETE FROM predictions` النشطة في المستودع واستبدالها
بـ `UPDATE status='ARCHIVED'` (archive pattern) + إنشاء سكريبت CI
لمنع رجوعها مستقبلاً.

- **المسارات النشطة المطلوبة (11):** كلها اتعملت ✓
- **المسارات المعطلة بالفعل (3):** اتأكدت + أضفت markers ✓
- **مسارات إضافية اكتشفتها الـ CI (3):** اتعملت ✓
- **سكريبت CI:** اتعمل + PASS ✓

---

## 2. الـ Commits (18 commits — كل واحد في ملف منفصل)

### المسارات النشطة (11) — استبدال DELETE → UPDATE:

| # | File | Commit | Hash |
|---|------|--------|------|
| 1 | `vps-service/api/admin_routes.py:1226` | wipe-all DELETE → UPDATE | `1d32f7b` |
| 2 | `vps-service/api/ai_predictions_routes.py:597` | DELETE WHERE prediction_date<? → UPDATE (in REAPPLY-CRITICAL-FIXES preserved block) | `f70f93e` |
| 3 | `vps-service/api/historical_predictions_v2_routes.py:537,542` | 2× DELETE WHERE ticker IN(...) → UPDATE | `45721f2` |
| 4 | `vps-service/api/misc_routes.py:1904` | DELETE WHERE 1=1 → UPDATE | `7bf863f` |
| 5 | `vps-service/scripts/cleanup_catastrophic.py:182` | DELETE WHERE id IN(...) → UPDATE (in else-branch) | `23e84d5` |
| 6 | `vps-service/scripts/rebuild_predictions.py:79` | DELETE WHERE 1=1 → UPDATE | `195e70f` |
| 7 | `scripts/v402_live_simulation.py:171` | DELETE (temp DB) → UPDATE | `20ed765` |
| 8 | `scripts/v402_position_sizing_comparison.py:48` | DELETE (temp DB) → UPDATE | `a3e2048` |
| 9 | `scripts/v402_regime_comparison.py:49` | DELETE (temp DB) → UPDATE | `46e9eaf` |
| 10 | `scripts/v402_tightening_comparison.py:48` | DELETE (temp DB) → UPDATE | `7f3062d` |
| 11 | `scripts/v402_final_regime_test.py:115` | DELETE (temp DB) → UPDATE | `668706f` |

### المسارات المعطلة بالفعل (3) — verified-disabled markers:

| # | File | Existing Guard | Commit | Hash |
|---|------|-----------------|--------|------|
| 12 | `vps-service/jobs/daily_predictor.py:565,570` | early-return at L548 (RULE35-DISABLED) | `2ca2ee9` |
| 13 | `vps-service/scripts/optimization_loop.py:35,66` | sys.exit(0) at L38 (RULE35-DISABLED) | `40cd494` |
| 14 | `scripts/sync-real-data.py:45` | early-return at L21 (RULE35-DISABLED) | `5cba979` |

### مسارات إضافية (3) — اكتشفتها الـ CI script لا كانت في التاسك الأصلي:

| # | File | DELETE pattern | Commit | Hash |
|---|------|----------------|--------|------|
| 15 | `vps-service/scripts/migrate_cleanup_archive.py:120` | DELETE WHERE prediction_date < date('now','-6 months') | `6d8b484` |
| 16 | `vps-service/scripts/generate_persona_predictions.py:141` | DELETE WHERE ticker=? AND outcome_date IS NULL AND date(prediction_date)=date(?) | `3d3946e` |
| 17 | `scripts/_fix_dup_predictions.cjs:28` | DELETE WHERE id IN (...) (JavaScript) | `43e9217` |

### سكريبت CI (1):

| # | File | Purpose | Commit | Hash |
|---|------|---------|--------|------|
| 18 | `scripts/check_no_hard_delete.py` | CI gate — fails build if any active `DELETE FROM predictions` found | `e5190b5` |

---

## 3. طريقة التعطيل (Disabling pattern)

لكل مسار نشط، استخدمت نفس الـ pattern (موصى بيه في التاسك):

```python
# DEV-06 (2026-10-12 — DUAL-TRACK): Hard DELETE disabled per Rule 21/35.
# Replace with UPDATE status='ARCHIVED' + archive reason in notes.
cur.execute(
    "UPDATE predictions SET status='ARCHIVED', "
    "notes=COALESCE(notes,'') || ' | DEV-06-ARCHIVED' WHERE <same_conditions>"
)
```

الشرط `WHERE` ات-preserve زي ما هو في كل ملف.

---

## 4. التحقق من المسارات المعطلة (Already-disabled verification)

### `daily_predictor.py:565,570`
- ✅ الـ function `delete_old_v40_predictions()` معطلة بـ early-return عند L548
- ✅ الـ print message بيقول `RULE35-DISABLED`
- ✅ الـ DELETEs تحت الـ return = dead code
- أضفت inline comment `# DEV-06 verified-disabled (dead code — early-return at L548)` على L565 + L570

### `optimization_loop.py:35,66`
- ✅ الـ script معطل بـ `sys.exit(0)` عند L38
- ✅ الـ print message بيقول `[RULE35-DISABLED]`
- ✅ كل الـ code تحت sys.exit = dead code
- أضفت inline `[DEV-06 verified-disabled]` للـ print string + `# DEV-06 verified-disabled (dead code — sys.exit(0) at L38)` للـ DELETE

### `sync-real-data.py:45`
- ✅ الـ script's `main()` معطلة بـ early-return عند L21
- ✅ الـ print message بيقول `[RULE35-DISABLED]`
- ✅ الـ DELETE تحت الـ return = dead code
- أضفت inline `# DEV-06 verified-disabled (dead code — return at L21)`

---

## 5. ملاحظات على الـ AI routes (REAPPLY-CRITICAL-FIXES)

- `ai_predictions_routes.py:597` — الـ function `generate_predictions_internal()`
  معطلة بـ early-return عند L548 (REAPPLY-CRITICAL-FIXES). الـ DELETE under L558
  محفوظ في string literal (preserved block) كـ rollback reference.
  → استبدلت الـ DELETE string بـ UPDATE string + SQL comment marker.

- `historical_predictions_v2_routes.py:537,542` — الـ function `_clear_existing_for_tickers()`
  **مش** معطلة (في REAPPLY-CRITICAL-FIXES guard على `_insert_prediction()` بس مش على دي).
  → مسار نشط فعلاً، استبدلت الـ DELETEs بـ UPDATE.

---

## 6. سكريبت CI — `scripts/check_no_hard_delete.py`

```python
result = subprocess.run(
    ['grep', '-r', 'DELETE FROM predictions', 'vps-service/', 'scripts/'],
    capture_output=True, text=True
)
active = [l for l in result.stdout.split('\n')
          if l and 'archive/' not in l and '__pycache__' not in l
          and '# ' not in l.split('DELETE')[0] and 'DISABLE' not in l
          and 'RULE35' not in l and 'DEV-06' not in l
          and 'check_no_hard_delete' not in l]  # self-exclusion
```

### Filters:
- `archive/` paths (dead-code archives)
- `__pycache__` bytecode
- comment lines (starting with `# ` before DELETE)
- `DISABLE` guards
- `RULE35` markers
- `DEV-06` markers (verified-disabled + replacement comments)
- `check_no_hard_delete` self-reference (the script's own docstring/grep pattern)

### Result:
```
$ python3 scripts/check_no_hard_delete.py
✅ PASS: 0 active DELETE FROM predictions
```
Exit code: **0**

---

## 7. الـ Workflow (per task rules)

لكل ملف:
1. `git add <file>` (بالاسم — مش `-A`) ✓
2. `git commit -m "fix(dev-06): disable DELETE FROM predictions in <file>"` ✓
3. `git stash push -m "DEV-06 unstaged others"` (علشان أقدر أعمل pull --rebase مع unstaged changes في ملفات تانية) ✓
4. `git pull --rebase origin main` ✓
5. `git stash pop` ✓
6. `git push origin main` ✓

---

## 8. دروس مستفادة

1. **`git pull --rebase` بيرفض لما فيه unstaged changes** — الـ workaround هو `git stash push` قبل الـ pull وبعده `git stash pop`. (مفيد لما عندك commits كتير على ملفات مختلفة).
2. **الـ CI check بيكتشف نفسه** — لازم تضيف `'check_no_hard_delete' not in l` filter علشان الـ script's docstring/grep pattern بيـ match الـ pattern بتاعها.
3. **الـ grep search بيلاقي paths إضافية مش في الـ task list** — اكتشفت 3 مسارات إضافية (`migrate_cleanup_archive.py`, `generate_persona_predictions.py`, `_fix_dup_predictions.cjs`) الـ CI اكتشفها. اتعملت بنفس الـ pattern.
4. **`_fix_dup_predictions.cjs` ملاحظة خاصة** — الـ script ده one-off deduplication helper. استبدال DELETE بـ UPDATE معناه إن الـ UNIQUE index creation ممكن يفشل لو فيه duplicates لسه موجودة. أضفت NOTE في الـ comment.
5. **ai_predictions_routes.py:597 كان في string literal (preserved block)** — استبدلت الـ DELETE string بـ UPDATE string + SQL comment markers. ده تغيير cosmetic بس (الـ function معطلة أصلاً بـ early-return).

---

## 9. التحقق النهائي (Final verification)

```
$ python3 scripts/check_no_hard_delete.py
✅ PASS: 0 active DELETE FROM predictions

$ git log --oneline --grep="dev-06" | wc -l
18

$ git log --oneline origin/main..HEAD
(empty — all commits pushed)
```

كل المسارات الـ 11 المطلوبة + 3 معطلة + 3 إضافية + 1 سكريبت CI = **18 commits** كلها على `origin/main`.

---

DEV-06 complete. ✅

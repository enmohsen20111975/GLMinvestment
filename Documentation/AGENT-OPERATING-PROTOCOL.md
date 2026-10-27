# Agent Operating Protocol — GLMinvestment
> **Mandatory for every AI agent or human programmer working on this project.**
> **Read before touching any file. Violations are project-blocking.

---

## Pre-task checklist (MUST complete before starting)

1. **Read the constitution:** `Documentation/00-CONSTITUTION.md` (76 rules, non-negotiable).
2. **Read architecture:** `Documentation/01-ARCHITECTURE.md` (3-layer, Rule 20: Python=Brain).
3. **Read ownership registry:** `Documentation/DATABASE-OWNERSHIP-REGISTRY.md` (who owns what).
4. **Read worklog:** last ~150 lines of `worklog.md` to avoid repeating investigations.
5. **Stabilize git state:** `git rev-parse HEAD` + `git status` — do NOT assume a previous report's HEAD is current.
6. **Identify the owner of the table/component you will modify** — if it's not in the registry, ask before writing.

---

## During task: separation of environments

- **Sandbox** (`/home/z/my-project/`): test code + logic on sample data. Sample sizes ≠ production sizes.
- **GitHub** (`origin/main`): code review + commits. Sandbox auto-commit may push local commits; check `git log origin/main..HEAD` to see what's local-only.
- **Production VPS** (`/root/GLMinvestment/`): live data, live users. NO direct access from sandbox. Any claim about production state requires evidence from the VPS itself.

**Never** generalize a sandbox result to production. **Never** claim production is fixed without VPS evidence.

---

## Prohibited actions (without explicit owner approval)

1. ❌ Creating a new engine/module that duplicates an existing function.
2. ❌ Creating a new database or table for a domain that already has one.
3. ❌ Writing to a table owned by another component (see registry).
4. ❌ Modifying `maestro_orchestrator.py`, `prisma/schema.prisma`, `next.config.*`.
5. ❌ Running `bun run build` in sandbox.
6. ❌ Running migrations, schema changes, or `DELETE`/`UPDATE` on production data.
7. ❌ Activating Shadow Mode or any new code path on production.
8. ❌ Running `git reset --hard`, `git clean`, or destructive git operations.
9. ❌ Changing `.gitignore` rules to track database files.
10. ❌ Deleting files, databases, or records without an approved rollback plan.
11. ❌ Claiming a module affects predictions because its tests pass.
12. ❌ Claiming sandbox results prove production state.
13. ❌ Reopening an investigation already concluded in `worklog.md` without new evidence.

---

## Required actions

1. ✅ Search for existing components before creating new ones (Grep/Glob).
2. ✅ Use the authorized interface for writes (e.g., `PredictionTracker.record_prediction()`, not direct SQL).
3. ✅ Use `db_manager.get_connection(DBPaths.X)` instead of direct `sqlite3.connect()`.
4. ✅ Scope `DELETE` to the component's owned rows (never `WHERE date = ?` without ownership qualifier).
5. ✅ Add `UNIQUE` constraint awareness: `INSERT OR REPLACE` only works with a UNIQUE/PK on the natural key.
6. ✅ Run tests after changes: `python3 -m py_compile` + relevant `scripts/test_*.py`.
7. ✅ Update `worklog.md` with what was actually done (not what was claimed).
8. ✅ Distinguish in every report: verified-in-code / tested-in-sandbox / verified-in-production / unproven-hypothesis.

---

## When stuck

- If a step requires owner approval: **defer that step only**, continue with independent work.
- If a test fails: diagnose, fix within scope, re-run. Do NOT change expected values to force a pass.
- If data is insufficient: state "inconclusive" — do NOT fabricate a result.
- If you discover a new violation: add it to the registry, do NOT silently fix it.

---

## Post-task: worklog entry format

```
---
Task ID: <DESCRIPTIVE-ID>
Agent: <name>
Task: <one-line description>

Work Log:
- <step 1, with evidence>
- <step 2, with evidence>

Stage Summary:
- <what was actually done>
- <what was tested + result>
- <what was NOT done + why>
- <what needs owner decision>
```

**Every "✅" must have evidence (file:line, test name, command output).** An unsubstantiated "✅" is a Rule 68 violation.

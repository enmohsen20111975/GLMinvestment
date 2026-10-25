# P0 Remediation Plan — Radar Signal Ownership, Verification Preservation, and Intraday History

> **Owner:** Mohsen / GLMinvestment  
> **Implementer:** Bravo  
> **Status:** Approved to implement in an isolated branch/sandbox; production changes are not authorized  
> **Date:** 2026-10-25  
> **Primary analysis:** [P0-DELETE-OWNERSHIP-ANALYSIS.md](P0-DELETE-OWNERSHIP-ANALYSIS.md)  
> **Related evidence reported by Bravo:** commit `69f8ff3`; production audit and `P0-DELETE-IMPACT-ANALYSIS.md`  
> **Purpose:** Complete the ownership fix and protect verification results and intraday signal evolution, with reproducible tests and an evidence-based handoff.

---

## 0. Mission and non-negotiable boundaries

Complete the `radar_signal_tracking` remediation end-to-end in an isolated development branch/sandbox. Do not stop for routine design approval questions that this plan resolves. If repository evidence contradicts an assumption below, stop only the affected operation, document the contradiction and propose the smallest safe adjustment.

### Explicitly authorized
- Inspect code, schema definitions, existing tests, audit reports, and all readers/writers relevant to `radar_signal_tracking`.
- Modify scoped source files, migration code, tests, and related documentation in the isolated branch.
- Run tests against temporary test databases or an isolated disposable copy whose provenance is recorded.
- Commit/push the isolated work branch and deliver reports/files on GitHub for review.

### Explicitly prohibited
- No production deployment, production migration, production database write, production cron/service change, or live data cleanup.
- No deletion of production or repository files/databases.
- No destructive Git commands or rewriting shared branch history.
- Do not modify `maestro_orchestrator.py`.
- Do not print, copy into reports, or commit secrets, environment values, tokens, credentials, or raw sensitive audit output.
- Do not claim a test passed unless it was actually executed; include command, result, and environment.
- Do not merge the implementation branch into the production/default branch. Submit it for review only.

---

## 1. Starting facts to re-verify before coding

The analysis report currently states:
- `scripts/maker_radar.py` deletes rows with `DELETE FROM radar_signal_tracking WHERE signal_date = ?`.
- Three INSERT writers were identified: `scripts/maker_radar.py`, `vps-service/camp/state_history_tracker.py`, and `src/modules/radar/lib/radar-signal-tracker.ts`.
- Four UPDATE paths were identified: the maker-radar verification route, stale-signal backfill, accuracy report, and `scripts/verify_radar_signals.py`.
- Some legacy `signal_type` names overlap between frontend and maker_radar, so a static `signal_type IN (...)` delete list cannot safely represent ownership.
- The report describes 111 extra rows/pairs associated with legacy name transitions. These rows must not be deleted or merged as part of this task.
- `canonical_state` is not present in the reported production schema and no cron was found for `state_history_tracker.py`. This task does not activate or deploy canonical_state.

Before implementation, independently re-check these facts against the current branch, the source code, and the existing analysis files. Record changed line numbers and any discrepancies. Do not rely on old line numbers after edits.

---

## 2. Final decisions (no further routine owner questions)

1. **Ownership:** use an explicit `source` ownership field; do not use a hard-coded list of signal types as the deletion boundary.
2. **Verification:** verification fields must survive repeated radar scans. A routine scan must not erase `outcome_7d`, `outcome_14d`, `outcome_30d`, `max_price_after`, `min_price_after`, `verified_at`, or any other verification fields actually present in the schema.
3. **Intraday history:** preserve meaningful intraday evolution, but do not let a five-minute job create unbounded growth without a retention policy. Preserve the first observation, each meaningful state/signal transition, and the latest observation for the day; store scan-level history separately from the current/verification record if that is the least disruptive design supported by the repository.
4. **Legacy rows:** do not delete, merge, rename, or rewrite the 111 reported legacy rows. Add a separate classification report based on stable row IDs and evidence.
5. **Production:** implementation and migration remain sandbox-only. A later production release requires a separate explicit approval after review of this deliverable.

---

## 3. Required implementation design

### 3.1 Ownership field and migration

- Add `source` to `radar_signal_tracking` through a versioned, repeatable migration compatible with the actual SQLite version and existing migration conventions.
- Every new write must set `source` explicitly. At minimum use stable values for `maker_radar`, `frontend`, and `state_history_tracker`; document any additional writer/maintenance ownership values only if needed.
- Do not rely on an implicit default that silently assigns future records to `maker_radar`. If a schema default is required for compatibility, use a safe unknown/legacy value and explicitly set ownership in each writer.
- Backfill existing rows only after the isolated audit confirms provenance. If the evidence supports that all pre-migration rows are maker_radar-owned, record the exact query and counts proving that assumption before assigning `source='maker_radar'`. If ownership cannot be established, retain `legacy_unknown` and ensure the radar DELETE never touches it.
- Migration must be additive where possible, safe to rerun, transactional where supported, and must not rebuild/drop the existing table or lose IDs/indexes/triggers/data.
- Check all SQL queries, row mappers, types, admin API paths, reporting code, and any serialization that may assume the old column list. Readers should remain compatible if they do not need the new field.

### 3.2 Safe scan refresh without verification loss

- Remove the date-only broad DELETE as the radar refresh mechanism.
- Do not replace it with another broad DELETE scoped only by a static list of `signal_type` values.
- Use stable row identity/UPSERT/update logic for current radar observations, scoped to `source='maker_radar'` and the appropriate ticker/date/signal identity.
- Separate observation fields (e.g. current signal classification, observed price, reason, data-quality/freshness fields) from verification fields. Update only fields owned by the scan when a row is refreshed; do not overwrite verification values with NULL/defaults during a refresh.
- Define and test how signals no longer present in the latest scan are represented (e.g. inactive/not-seen state or current-snapshot reconciliation) without deleting their verification or history. Do not overload an existing `status` meaning without documenting and testing compatibility.
- If schema identity constraints are insufficient, propose the smallest safe uniqueness strategy after checking existing duplicate data and all consumers. Do not add a UNIQUE index until duplicates and legacy semantics have been inspected and the migration has a deterministic safe path.
- All verification/update jobs must remain row-ID scoped unless code evidence justifies a different key. Verify their interaction with the refresh path.

### 3.3 Intraday evolution history

- Keep the table and API contract used by existing consumers stable unless a change is required and documented.
- Prefer a separate history table or existing supported history mechanism for scan snapshots/transitions, rather than deleting the previous observation or appending every unchanged snapshot forever.
- A history record should identify at least the source, ticker, trading date, scan/run time, signal type/state, and the relevant observation/data-quality fields. Use existing naming/types where possible; do not invent fields without checking the actual schema.
- Record a new history event when a meaningful signal/state transition occurs, plus the first and latest observation for the day. Repeated identical scans should not create unbounded duplicate history rows.
- Add a documented retention policy configurable in code/configuration where the project conventions allow it. The default must be bounded and justified; retention cleanup must affect only the history table and only records beyond the configured retention boundary.
- Do not change how `outcome_*` verification results are stored in the current tracking record merely to represent intraday history.

### 3.4 Legacy duplicate classification

- Produce a report of the 111 reported extra rows using stable primary keys, ticker, signal_date, signal_type, source/provenance if available, created_at, and relevant signal payload comparison.
- Classify rows as: clearly distinct signals, likely rename artifacts, exact duplicate payloads, or inconclusive.
- Include evidence and counts for each category. Do not delete or merge any row in this task.
- If the original count of 111 cannot be reproduced on the available evidence, report the discrepancy rather than forcing the expected count.

---

## 4. Staged execution plan and gates

### Stage 0 — Repository and evidence recovery
1. Confirm branch, HEAD, worktree state, and the exact commit containing the ownership analysis.
2. Read the current ownership analysis, P0 impact analysis, database ownership registry, relevant architecture/constitution rules, and current tests.
3. Inventory every INSERT/UPDATE/DELETE/REPLACE and every read/query of `radar_signal_tracking`; search both Python and TypeScript/SQL call sites.
4. Capture schema, indexes, constraints, triggers, row counts, null counts, and duplicate profiles from a disposable/test database or existing audit artifacts. Never expose secrets.
5. Record the baseline and test commands before any edits.

**Gate 0:** no code changes until the inventory is complete and contradictions with the analysis are documented.

### Stage 1 — Design and migration safety
1. Write the migration plan and rollback/recovery notes.
2. Implement migration on a temporary SQLite database created from a schema fixture or a sanitized disposable copy.
3. Test migration on an empty DB, an old-schema DB with representative legacy rows, and a DB where the migration has already run.
4. Verify row counts, IDs, existing values, indexes, constraints, triggers, and data types before/after.
5. Prove that ambiguous legacy ownership is not silently attributed to a writer that cannot be proven.

**Gate 1:** migration tests pass and schema/data comparison shows no unintended loss or mutation.

### Stage 2 — Ownership-aware writers
1. Update all identified INSERT writers to set explicit source values.
2. Scope the maker_radar refresh path by source and stable identity; remove date-only broad deletion.
3. Preserve verification fields during refresh.
4. Define missing/not-seen signal behavior and ensure existing API/report readers continue to interpret rows correctly.
5. Update any schema models/types and documentation affected by the new field.

**Gate 2:** unit/integration tests prove writer isolation and verification preservation before history work is accepted.

### Stage 3 — Intraday history and retention
1. Implement the least disruptive bounded history mechanism consistent with existing project architecture.
2. Record first observation, meaningful transitions, and latest observation; deduplicate identical repeated scans.
3. Add bounded retention and tests proving retention cannot touch current tracking rows or verification data.
4. Confirm that the history feature does not alter signal classification, recommendation ranking, entry/exit decisions, or other trading logic except where explicitly intended and separately tested.

**Gate 3:** history is useful and bounded; repeated identical scans do not inflate records indefinitely.

### Stage 4 — Legacy duplicate classification
1. Recompute the duplicate/rename report using stable row IDs and the best available payload comparison.
2. Explain the difference between duplicate ticker/date pairs and duplicate ticker/date/signal_type triples.
3. Produce a report only; do not modify source rows.
4. Add regression tests for any ambiguity discovered that affects new writes.

**Gate 4:** report is reproducible and no legacy row was removed or merged.

### Stage 5 — Full verification
Run all relevant existing tests and the new tests listed below. Also run the narrow project lint/type-check/test commands available and relevant to the changed files. Do not launch expensive builds or unrelated suites without justification; document anything not run.

**Gate 5:** all required tests pass, or each failure is explicitly documented with reproduction and impact. A failing required test means the fix is not complete.

### Stage 6 — Review package and GitHub handoff
1. Inspect the full diff for unrelated changes, accidental data files, secrets, and destructive operations.
2. Update the relevant analysis, ownership registry, test evidence, phased remediation plan, and worklog/changelog according to repository conventions.
3. Commit and push to an isolated implementation branch; do not merge.
4. Publish a concise final report and supporting files to GitHub.
5. Report exact branch and commit SHA, changed-file list, commands run, pass/fail totals, and remaining risks.
6. Clearly state: **not deployed; production migration not run**.

---

## 5. Mandatory test matrix and acceptance criteria

Use isolated temporary databases and deterministic fixtures. Tests must exercise actual implementation functions/SQL paths, not merely assert that source code contains a string.

### Ownership and deletion
- **T01 — Source isolation:** same ticker/date with maker_radar, frontend, state_history_tracker, and legacy_unknown rows. A maker_radar refresh changes only maker_radar-owned current records.
- **T02 — Overlapping names:** frontend and maker_radar records with the same legacy `signal_type` survive/refresh according to their own source; neither can delete or overwrite the other.
- **T03 — Unknown source safety:** records with null/unknown/legacy_unknown source are not deleted by maker_radar.
- **T04 — Future signal type:** a new signal_type does not require a static ownership list and is correctly isolated by source.
- **T05 — Multiple dates:** refreshing one trading date cannot affect another date.

### Verification preservation
- **T06 — Verification survives repeated scan:** set all actual verification fields, rerun the radar refresh repeatedly, and assert values remain unchanged.
- **T07 — Verification after refresh:** run the actual verification update path, refresh the same signal, then read it through the normal consumer and assert verification remains.
- **T08 — No false verification reset:** a newly observed signal may have empty verification fields, but refreshing an existing verified row must not reset them.
- **T09 — Stale/missing signal reconciliation:** a signal absent from the latest scan is handled according to the documented not-seen policy without losing historical verification or source ownership.
- **T10 — ID stability:** refreshing an existing logical signal preserves stable identity where required by readers; if IDs intentionally differ, document and test all dependent readers.

### Intraday history and retention
- **T11 — First/latest observation:** first and latest observations are retained for the trading day.
- **T12 — Meaningful transition:** a change in signal/state produces a history event with timestamp and source.
- **T13 — Identical scan deduplication:** repeated unchanged scans do not create unlimited duplicate history events.
- **T14 — Retention boundary:** cleanup removes only expired history rows and never current tracking or verification records.
- **T15 — Repeated scan soak:** simulate at least 72 five-minute scans in a test day; record current-row count, history-row count, duplicate count, and verify bounded growth under the policy.

### Migration and compatibility
- **T16 — Empty DB migration:** migration succeeds on an empty old-schema database.
- **T17 — Existing data migration:** IDs and existing values are preserved; source backfill follows evidence-based rules.
- **T18 — Idempotency:** rerunning migration does not fail or mutate data a second time.
- **T19 — Schema integrity:** verify indexes, triggers, constraints, and table definitions after migration.
- **T20 — Reader compatibility:** affected API routes, reporting jobs, and row mappers can read both migrated records and legacy/unknown source records.
- **T21 — Rollback/recovery rehearsal:** demonstrate recovery using a disposable DB backup/copy and document exact steps; never rehearse on production.
- **T22 — Legacy duplicate report:** classification output is reproducible and no source row is deleted or merged.

### Regression and quality
- **T23 — Existing relevant tests:** run the existing radar ownership/delete impact tests and any related verification tests.
- **T24 — SQL parameterization:** new queries use bound parameters for data values.
- **T25 — No trading-logic drift:** representative before/after fixtures show this ownership/storage fix does not silently alter signal selection, ranking, entry/exit logic, or recommendation output.
- **T26 — Secret hygiene:** final diff, logs, and reports contain no secret values or sensitive environment dumps.

**Acceptance:** all 26 tests pass, or any test that cannot be executed is explicitly listed with reason, consequence, and required follow-up. T01–T10, T14, T16–T20, T23–T26 are mandatory blockers for declaring the remediation ready for review. Do not call the implementation production-ready based on this sandbox test suite.

---

## 6. Required deliverables

Create/update these files in the repository using the existing directory/name conventions where they already exist; do not create duplicate competing registries if an existing file should be updated.

1. `Documentation/P0-DELETE-OWNERSHIP-IMPLEMENTATION-REPORT.md` — implementation summary, decisions, changed paths, known limitations.
2. `Documentation/P0-DELETE-OWNERSHIP-TEST-EVIDENCE.md` — test IDs, exact commands, environment, pass/fail output summary, test DB provenance.
3. `Documentation/P0-DELETE-OWNERSHIP-MIGRATION-AND-RECOVERY.md` — migration order, preconditions, idempotency, backup/restore rehearsal, rollback limits.
4. `Documentation/P0-LEGACY-DUPLICATE-CLASSIFICATION.md` — stable row IDs and evidence-based classification; no raw secrets.
5. Update the existing database ownership registry, phased remediation plan, relevant architecture notes, and worklog/changelog where appropriate.
6. Code migration and test files in the appropriate existing directories, after confirming conventions.

Do not commit raw production DBs, production extracts containing personal/sensitive data, or audit files that include secrets. Reports must use counts and redacted evidence where possible.

---

## 7. Final report format

The final handoff must answer all of the following:

- What was the exact starting branch and commit?
- What changed, file by file, and why?
- What migration was added, and how was it tested?
- What happened to source ownership for existing rows?
- How are verification fields protected?
- How is intraday history represented and bounded?
- What is the duplicate classification result, and what remains inconclusive?
- Which of T01–T26 ran, with exact pass/fail/blocked status?
- Which existing test/lint/type-check commands ran, and which did not?
- What are the remaining risks and known limitations?
- Confirm explicitly that no production database, production service, cron, or deployment was changed.
- Provide the isolated branch name, commit SHA, GitHub links to reports, and the complete diff.

### Completion rule

Do not report “done” merely because files exist or a commit was pushed. The task is complete only when implementation, test evidence, documentation, and the final review package are all present. Production release remains a separate decision and is not included in this authorization.

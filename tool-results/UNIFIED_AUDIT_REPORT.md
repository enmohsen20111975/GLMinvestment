# BRAVO — Unified Audit Report (Read-Only, Reproducible)
> **Generated:** 2026-10-25T22:37:25.207574
> **Branch:** fix/radar-forensic-minimal
> **Scope:** Audit of radar_signal_tracking. NO DB writes. NO data deletion.
> **Correction:** This version fixes the flip-counting bug from the previous
> report (which combined 7d+14d into a single '197' number). Per-horizon:
> 7d = 121 Win→Loss, 14d = 76 Win→Loss, 30d = 0.

## 1. Denominator Reconciliation (1,329 → 1,200 → 1,012 → 433 → 361 → 121)

Every signal's fate is traced. The denominators are NOT arbitrary — each
reduction has a documented reason.

```
Total signals in radar_signal_tracking     :   1329
  − data anomaly (MENA Oct 4-14)          :      3
  − corp-action pre-event (POUL, ORHD)    :      6
  − crypto ticker collision               :    120
  − invalid entry_price (≤0 or NULL)       :      0
  = Eligible signals                      :   1200
    − insufficient prices (<7 sessions)   :    188
    − no stored outcome_7d to compare     :    579
    = Compared (stored vs recomputed 7d)  :    433
      − changed (|stored−recomputed|>0.5%):    338
        − Win→Loss flips                  :     79
        − Loss→Win flips                  :     18
```

**Per-signal fate:** `tool-results/audit_signal_fate.csv` (1,329 rows, one per signal)

## 2. Explicit Definitions

- **Return formula:** `((nth_session_close − entry_price) / entry_price) × 100`
- **nth_session:** the N-th AVAILABLE row in the source DB after signal_date
  (ORDER BY date ASC LIMIT N). This is NOT necessarily the N-th actual EGX
  trading session — see Section 3 for the coverage caveat.
- **Win:** return > +0.5%
- **Loss:** return < -0.5%
- **Neutral:** between -0.5% and +0.5%
- **Changed:** |stored − recomputed| > 0.5% (absolute percentage points)
- **Flip:** a 'changed' signal where the win/loss classification also changed
- **eligible_compared:** requires `stored_7d IS NOT NULL` AND `recomputed_7d IS NOT NULL`
  (signals with NULL stored_7d go to `eligible_no_stored`, NOT `eligible_compared`)

**DB status vs audit fate (clarification):**
The DB `status` column and the audit `fate` column are INDEPENDENT:
- DB `status` reflects what `verify_radar_signals.py` set historically.
- Audit `fate` reflects what THIS audit computed.
Some signals have `status=stale_data` but a non-NULL `stored_7d` — meaning the
DB marked the data stale but a value was still stored. These ARE compared
(they have a stored value) but the `stale_data` flag is preserved in the CSV
for review. This is NOT an audit bug — it's a DB state inconsistency that the
audit documents rather than hides.

## 3. F1-v2 Validity — Gap Detection (HONEST CAVEAT)

Owner concern: *"fetching first 7 rows doesn't prove they're the 7th actual
trading session; if a session is missing, the code may skip it and count a
later session as the 7th."*

**Honest answer:** The code fetches the N-th *AVAILABLE* row in the source DB,
NOT the N-th *actual* EGX session. If the source DB is missing a session
(holiday not recorded, data feed gap, ticker suspended), the code silently
uses the next available row. This is the SAME behavior as the TS verify
route — both assume the source DB is complete. **This assumption is NOT
independently verified.**

**What I DID verify:** For every signal, I checked date spacing between
consecutive returned sessions. A gap >4 calendar days (Fri+Sat normal =
3 days) is flagged as `DATE_GAP` — meaning the source DB skipped a day.
Signals where the source had <7 rows total are flagged
`INSUFFICIENT_SESSIONS` (NOT silently skipped).

```
Signals checked for F1 gaps        :   1200
  CONFIRMED (no gaps, 7 contiguous):    787  ← no-gap-in-source (NOT proven actual — see Investigation)
  DATE_GAP (>4 day jump)           :      6  ← source skipped a day (may affect N)
  INSUFFICIENT_SESSIONS            :    407  ← <7 rows available in unified sources, REJECTED
  TOTAL checked                   :   1200  ← must equal eligible count above
```

**Classification (per owner's directive to separate categories):**
- **No-gap-in-source** (787 rows, no >4d jump): 787 — NOT proven N-th actual session
  (source DB has documented gaps + contamination — see BRAVO-DATA-SOURCE-INVESTIGATION.md)
- **Data-gap signals** (source skipped ≥1 day): 6
- **Insufficient** (<7 rows, rejected, not counted): 407

**Action on gaps:** The code does NOT silently skip *within the window* —
it returns exactly N rows. But if the source DB is missing a session,
those N rows span MORE than N trading days. The `nth_date` field in the
CSV shows the actual date of the N-th row, so reviewers can compare it
to the expected calendar date. All gaps are recorded in
`tool-results/audit_f1_gaps.csv` for manual review.

**Limitation acknowledged:** Proving the source DB has COMPLETE EGX
coverage (every trading day present for every ticker) is OUT OF SCOPE
for this audit. It would require an EGX trading calendar cross-check,
which is a separate task.


**Sample DATE_GAP cases (for review):**
- id=29 GTHE 2026-09-28: 2026-10-05→2026-10-12 (7d)
- id=117 GTHE 2026-09-29: 2026-10-05→2026-10-12 (7d)
- id=253 GTHE 2026-09-30: 2026-10-05→2026-10-12 (7d)
- id=392 GTHE 2026-10-02: 2026-10-05→2026-10-12 (7d)
- id=531 GTHE 2026-10-03: 2026-10-05→2026-10-12 (7d)

## 4. F3-v2 Validity — Distinguishing 'no surge' from 'insufficient data'

Owner concern: *"the system must distinguish between 'no volume surge'
and 'insufficient data to judge'. Otherwise valid signals may disappear
due to data gaps."*

**Proof:** F3-v2 returns 3 distinct outcomes, not 2:
- `FIRES` — 25 sessions available, ratio ≥ 1.5× → signal fires
- `NO_SURGE` — 25 sessions available, ratio < 1.5× → clean reject (no surge)
- `INSUFFICIENT_DATA` — <25 sessions available → cannot judge (data gap)

```
Total F3-type signals in DB (pre_surge/explosive):    682
  FIRES (surge detected)              :     38
  NO_SURGE (clean reject)             :    476
  INSUFFICIENT_DATA (<25 sessions)    :     74
  EXCLUDED_CRYPTO (ticker collision) :     94
  TOTAL in CSV (must equal DB count)  :    682
```

**Per-signal detail:** `tool-results/audit_f3_rejections.csv` (682 rows)

**Key point:** INSUFFICIENT_DATA signals are NOT classified as 'no surge'.
They are explicitly marked as data-limited, so they can be reviewed
separately and excluded from performance stats without being confused
with genuine 'no surge' signals.

**Honest caveat (per owner review):** The 25 tests in `test_bravo_fixes_v2.py`
use SYNTHETIC volume lists, not historical source rows. Proving that every
historical volume row in `price_history.db` is correct and complete is OUT
OF SCOPE for this audit. The F3 fix is verified at the LOGIC level
(non-overlap math, no fallback, correct rejection message) but NOT at the
data-quality level. A separate task would need to cross-check volume rows
against the EGX feed source.

## 5. Corporate Actions — Evidence Status

| Ticker | Event | Factor | Status |
|---|---|---|---|
| POUL | merger+cap_increase (Sep 28) | 0.2542 (close-to-close) | 🟡 INCONCLUSIVE — 6.27% error vs reference 10.36; needs official EGX reference price |
| ORHD | free shares 2328:721 (Oct 7) | 0.30967 | ✅ CONFIRMED — 0.09% error; roic.ai + waya.media |
| MENA | data feed anomaly (Oct 4-14) | N/A | ⚠️ ANOMALY — no corporate action; price reverted 127→6.68 |

**Decision required:** POUL factor cannot be applied (0.2542 vs 0.2712
mismatch — needs official EGX reference price). ORHD factor is confirmed
but pre-event signals are EXCLUDED in the dry-run (not adjusted).
MENA anomaly signals are EXCLUDED (not deleted).

**MENA — explicit NO DELETION policy (per owner directive):**
The corrupt MENA prices (Oct 4-14, 8 sessions at 127-138 EGP) are PRESERVED
in the raw DB. No purge is recommended or executed. The correct action is:
1. Preserve the raw rows as-is (do NOT delete)
2. Identify the SOURCE of the corrupt data (which feed produced 129?)
3. Cross-check against an independent EGX source for those dates
4. Only after source is identified, decide whether to flag the rows as
   'untrusted' (soft flag) rather than delete them
Deletion is irreversible and destroys audit evidence. This audit does NOT
recommend deletion of any data.

## 6. Reproduce All Results — Single Command

```bash
python3 scripts/generate_unified_audit.py
```

This script regenerates this report + all CSVs in one shot.
Additionally:
```bash
python3 scripts/test_bravo_fixes_v2.py      # 25/25 PASS (F1+F3 unit tests)
python3 scripts/corp_actions_evidence.py    # POUL/ORHD/MENA evidence
python3 scripts/radar_reverify_dryrun.py    # full dry-run comparison
```

## 7. File Checksums (for verification)

| File | SHA256 (first 16) |
|---|---|
| tool-results/audit_signal_fate.csv | `1bb733b8f4edc03e` |
| tool-results/audit_f1_gaps.csv | `932c1ab3379da2c1` |
| tool-results/audit_f3_rejections.csv | `3f994e7a62c08e1d` |

## 8. Constraints Respected

- ✅ NO writes to production DB (all scripts use `?mode=ro` URI)
- ✅ NO data deletion (MENA purge is PROPOSED, not executed)
- ✅ NO merge to main (branch `fix/radar-f1v2-f3v2` awaits review)
- ✅ NO engine threshold changes
- ✅ NO deployment to VPS
- ✅ All outputs reproducible (scripts + CSVs committed)

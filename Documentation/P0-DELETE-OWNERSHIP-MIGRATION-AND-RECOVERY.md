# P0 DELETE Ownership — Migration & Recovery Plan
> **Status:** DESIGN ONLY — no migration executed on production.
> **Requires owner approval before execution.**

## 1. Migration steps (in order)

### Step 1: Backup production DB
```bash
cd /home/meme/my_apps/GLMinvestment
sqlite3 db/stocks.db ".backup '/home/meme/my_apps/GLMinvestment/db/backups/stocks.db.bak-p0-fix-$(date +%Y%m%d%H%M%S)'"
```
**Verify backup:**
```bash
ls -lh db/backups/stocks.db.bak-p0-fix-*
sqlite3 db/backups/stocks.db.bak-p0-fix-* "SELECT COUNT(*) FROM radar_signal_tracking"
# Must match: 1287 (current production row count)
```

### Step 2: Deploy code changes
```bash
git pull origin main  # or merge fix/p0-delete-ownership-complete branch
# Verify files are updated:
grep -n "source = 'maker_radar'" scripts/maker_radar.py
grep -n "radar_signal_history" scripts/maker_radar.py
```

### Step 3: Schema migration (automatic)
The schema migration is **automatic** — `maker_radar.py` will create the `source` column + `radar_signal_history` table on its first run via:
- `ALTER TABLE radar_signal_tracking ADD COLUMN source TEXT DEFAULT 'maker_radar'` (idempotent).
- `CREATE TABLE IF NOT EXISTS radar_signal_history (...)` (idempotent).

**No manual migration needed.** The next cron run (`*/5 8-14 * * 0-4`) will apply it.

**However**, for controlled deployment, you can run it manually first:
```bash
cd /home/meme/my_apps/GLMinvestment
python3 -c "
import sqlite3
conn = sqlite3.connect('db/stocks.db')
# Add source column
cols = [r[1] for r in conn.execute('PRAGMA table_info(radar_signal_tracking)').fetchall()]
if 'source' not in cols:
    conn.execute(\"ALTER TABLE radar_signal_tracking ADD COLUMN source TEXT DEFAULT 'maker_radar'\")
    print('Added source column')
# Create history table
conn.execute('''CREATE TABLE IF NOT EXISTS radar_signal_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    signal_date TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    entry_price REAL,
    path TEXT,
    reason TEXT,
    status TEXT,
    run_timestamp TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'maker_radar'
)''')
conn.execute('CREATE INDEX IF NOT EXISTS idx_radar_hist_ticker_date ON radar_signal_history(ticker, signal_date)')
conn.commit()
conn.close()
print('Schema migration complete')
"
```

### Step 4: Backfill source column for legacy rows
**DO NOT blindly set all rows to `source='maker_radar'`.** See `P0-LEGACY-DUPLICATE-CLASSIFICATION.md` for classification.

**IMPORTANT:** The ambiguous rows (signal_type `pre_surge`, `quiet_accumulation_strong`, `explosive_surge`) cannot be definitively classified using `path` alone. The `path` heuristic is **investigative only** — it must NOT be used for automatic backfill on production without manual verification.

```sql
-- Step 1: Confident maker_radar rows (new prefix names + disqualified_illiquid).
-- These signal_types are ONLY written by maker_radar (frontend does not use them).
UPDATE radar_signal_tracking
SET source = 'maker_radar'
WHERE signal_type IN (
    'A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak',
    'D_explosive_surge', 'E_early_break', 'disqualified_illiquid'
);

-- Step 2: Ambiguous rows — DO NOT auto-classify.
-- The signal_types below are shared between maker_radar (legacy) and frontend.
-- The `path` column heuristic (NOT NULL → maker_radar, NULL → frontend) is
-- PROBABILISTIC, not definitive. A frontend caller could have passed a non-null path.
--
-- RECOMMENDED: leave these rows with their DEFAULT source='maker_radar' and
-- manually verify on production before any backfill:
--
--   SELECT ticker, signal_date, signal_type, path, reason, created_at
--   FROM radar_signal_tracking
--   WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
--   ORDER BY created_at DESC;
--
-- Only after manual review should you classify them. The SQL below is
-- INVESTIGATIVE ONLY — do not run it on production without verification.

-- INVESTIGATIVE ONLY (not for production execution without manual review):
-- UPDATE radar_signal_tracking SET source = 'maker_radar'
-- WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
--   AND path IS NOT NULL;
--
-- UPDATE radar_signal_tracking SET source = 'frontend'
-- WHERE signal_type IN ('pre_surge', 'quiet_accumulation_strong', 'explosive_surge')
--   AND path IS NULL;

-- Verify:
SELECT source, COUNT(*) FROM radar_signal_tracking GROUP BY source;
```

### Step 5: Verify migration
```bash
# Check schema
sqlite3 db/stocks.db "PRAGMA table_info(radar_signal_tracking)" | grep source
sqlite3 db/stocks.db ".tables" | grep radar_signal_history

# Check row counts
sqlite3 db/stocks.db "SELECT source, COUNT(*) FROM radar_signal_tracking GROUP BY source"
sqlite3 db/stocks.db "SELECT COUNT(*) FROM radar_signal_history"  # should be 0 initially

# Check no data lost
sqlite3 db/stocks.db "SELECT COUNT(*) FROM radar_signal_tracking"  # should still be 1287
```

## 2. Recovery plan

### If migration fails or causes issues:

```bash
# Step 1: Stop maker_radar cron
crontab -l | sed 's|^\*/5 8-14.*maker_radar|# &|' | crontab -

# Step 2: Restore from backup
cp db/backups/stocks.db.bak-p0-fix-* db/stocks.db

# Step 3: Revert code
git revert HEAD  # or git checkout <previous-commit> -- scripts/maker_radar.py vps-service/camp/state_history_tracker.py src/modules/radar/lib/radar-signal-tracker.ts

# Step 4: Restart cron
crontab -l | sed 's|^# \*/5 8-14.*maker_radar|*/5 8-14|' | crontab -
```

### If `radar_signal_history` table causes issues:
The table is **independent** — it can be dropped without affecting `radar_signal_tracking`:
```sql
DROP TABLE IF EXISTS radar_signal_history;
```

### If `source` column causes issues:
The column is **additive** with a DEFAULT — it can be left in place (it won't affect old code that doesn't reference it). Removing it requires SQLite 3.35+:
```sql
ALTER TABLE radar_signal_tracking DROP COLUMN source;
```

## 3. Rollback verification

After rollback, verify:
1. `radar_signal_tracking` row count matches backup.
2. `maker_radar.py` runs without errors (old code doesn't reference `source` column).
3. No `radar_signal_history` table exists (if dropped).

## 4. Pre-deployment checklist

- [ ] Backup created and verified.
- [ ] Code deployed and syntax-checked.
- [ ] Schema migration tested on copy of production DB.
- [ ] Legacy data classified (see `P0-LEGACY-DUPLICATE-CLASSIFICATION.md`).
- [ ] Backfill SQL reviewed by owner.
- [ ] Monitoring in place for first 24 hours.
- [ ] Rollback plan tested.

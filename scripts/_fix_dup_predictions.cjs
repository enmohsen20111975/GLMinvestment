// Find and clean duplicate predictions (P0 #18 fix)
const Database = require('better-sqlite3');
const db = new Database('/home/z/my-project/db/predictions.db');

console.log('=== Find duplicate (ticker, prediction_date, persona) groups ===');
const dups = db.prepare(`
  SELECT ticker, prediction_date, persona, COUNT(*) as c, GROUP_CONCAT(id) as ids, GROUP_CONCAT(status) as statuses
  FROM predictions
  GROUP BY ticker, prediction_date, persona
  HAVING c > 1
  ORDER BY c DESC, prediction_date DESC
  LIMIT 50
`).all();

console.log('Duplicate groups:', dups.length);
dups.forEach(d => console.log(JSON.stringify(d)));

console.log('\n=== Cleanup strategy ===');
let totalDeleted = 0;
for (const dup of dups) {
  const ids = dup.ids.split(',').map(s => parseInt(s));
  const rows = db.prepare('SELECT id, status FROM predictions WHERE id IN (' + ids.join(',') + ') ORDER BY id DESC').all();
  const keepId = rows[0].id;
  const deleteIds = rows.slice(1).map(r => r.id);
  console.log(`\n${dup.ticker} @ ${dup.prediction_date} (${dup.persona}): keep id=${keepId} (${rows[0].status}), delete ids=${deleteIds.join(',')}`);
  if (deleteIds.length > 0) {
    const placeholders = deleteIds.map(() => '?').join(',');
    // DEV-06 (2026-10-12 — DUAL-TRACK): Hard DELETE disabled per Rule 21/35.
    // Replace with UPDATE status='ARCHIVED' + archive reason in notes.
    // (NOTE: this script is a one-off deduplication helper. Archiving the
    // duplicate rows instead of deleting them means the UNIQUE index below
    // may fail to create if duplicates still exist. Run manually with care.)
    const result = db.prepare(`UPDATE predictions SET status='ARCHIVED', notes=COALESCE(notes,'') || ' | DEV-06-ARCHIVED' WHERE id IN (${placeholders})`).run(...deleteIds);
    totalDeleted += result.changes;
    console.log(`  → archived ${result.changes} rows (DEV-06)`);
  }
}

console.log(`\n=== Total deleted: ${totalDeleted} duplicate rows ===`);

console.log('\n=== Add UNIQUE constraint ===');
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_unique_ticker_date_persona ON predictions(ticker, prediction_date, persona)`);
  console.log('✅ Created unique index: idx_predictions_unique_ticker_date_persona');
} catch (e) {
  console.log('⚠️ Could not create unique index:', e.message);
}

const finalDups = db.prepare(`
  SELECT ticker, prediction_date, persona, COUNT(*) as c
  FROM predictions
  GROUP BY ticker, prediction_date, persona
  HAVING c > 1
`).all();
console.log('\n=== Remaining duplicates after cleanup:', finalDups.length, '===');

const totalNow = db.prepare('SELECT COUNT(*) as c FROM predictions').get().c;
console.log(`\nTotal predictions now: ${totalNow}`);

db.close();

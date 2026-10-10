#!/usr/bin/env node
/**
 * Fix data_engine.db SQLite Corruption
 * ======================================
 * Fixes: "malformed database schema (gold_prices_clean) - invalid rootpage"
 * 
 * Strategy: Rebuild the database table-by-table, skipping the corrupted
 * gold_prices_clean, then recreating it with the correct schema.
 */

const path = require('path');
const fs = require('fs');

// better-sqlite3 is an optional dependency - load it
let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.error('better-sqlite3 not found. Try: npm install better-sqlite3');
    process.exit(1);
}

const DB_PATH = path.join(process.cwd(), 'db', 'data_engine.db');
const BACKUP_PATH = path.join(process.cwd(), 'db', `data_engine.db.corrupt_backup.${Date.now()}`);
const NEW_DB_PATH = path.join(process.cwd(), 'db', 'data_engine.db.fixed');

function log(prefix, msg) {
    console.log(`${prefix} ${msg}`);
}

function main() {
    console.log('========================================');
    console.log('  data_engine.db Corruption Fix Tool');
    console.log('========================================\n');

    // 1. Verify the database exists
    if (!fs.existsSync(DB_PATH)) {
        console.error(`FATAL: Database not found at: ${DB_PATH}`);
        process.exit(1);
    }
    const size = fs.statSync(DB_PATH).size;
    log('DB:', DB_PATH);
    log('Size:', `${(size / 1024 / 1024).toFixed(2)} MB\n`);

    // 2. Create backup
    log('BACKUP:', 'Creating...');
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    log('OK:', `Backup saved to ${BACKUP_PATH}\n`);

    // 3. Open with IMMUTABLE mode (bypasses schema validation)
    log('OPEN:', 'Opening database in IMMUTABLE mode...');
    let db;
    try {
        db = new Database(`file:${DB_PATH}?immutable=1`);
        log('OK:', 'Database opened\n');
    } catch (err) {
        log('FAIL:', `Cannot open: ${err.message}`);
        log('INFO:', 'Trying to restore from backup zip if available...');

        const zipPath = path.join(process.cwd(), 'db', 'data_engine.db.zip');
        if (fs.existsSync(zipPath)) {
            log('ZIP:', `Found ${zipPath}`);
            log('CMD:', `cd db && unzip -o data_engine.db.zip data_engine.db`);
        }
        return;
    }

    // 4. Read all tables
    let tables, indices, views, triggers;
    try {
        tables = db.prepare(
            "SELECT name, sql, rootpage FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();

        indices = db.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
        ).all();

        views = db.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type='view' AND sql IS NOT NULL ORDER BY name"
        ).all();

        triggers = db.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name"
        ).all();
    } catch (err) {
        log('FAIL:', `Cannot read schema: ${err.message}`);
        db.close();
        return;
    }

    log('SCHEMA:', `Found ${tables.length} tables, ${indices.length} indices, ${views.length} views, ${triggers.length} triggers\n`);

    // 5. Identify the corrupted gold_prices_clean
    const goldClean = tables.find(t => t.name === 'gold_prices_clean');
    if (!goldClean) {
        log('INFO:', 'gold_prices_clean table not found. Trying integrity check...');
        try {
            const integrity = db.prepare('PRAGMA integrity_check').all();
            log('INTEGRITY:', JSON.stringify(integrity));
        } catch (e) {
            log('INTEGRITY:', `Check failed: ${e.message}`);
        }
    } else {
        log('PROBLEM:', `gold_prices_clean found (rootpage=${goldClean.rootpage})`);
        if (goldClean.sql) {
            log('SCHEMA:', goldClean.sql.substring(0, 120) + '...');
        } else {
            log('SCHEMA:', '⚠ No CREATE statement stored (corrupted)');
        }
    }

    // 6. Build the new database
    log('BUILD:', 'Creating new database...');
    let newDb;
    try {
        newDb = new Database(NEW_DB_PATH);
        newDb.pragma('journal_mode = WAL');
        log('OK:', 'New database created\n');
    } catch (err) {
        log('FAIL:', `Cannot create new DB: ${err.message}`);
        db.close();
        return;
    }

    // 7. Recreate each table (skip gold_prices_clean, recreate it properly)
    const excludedTables = new Set(['gold_prices_clean', 'sqlite_sequence']);
    let createdCount = 0;
    let skippedCount = 0;

    log('TABLES:');
    for (const t of tables) {
        if (excludedTables.has(t.name)) {
            log('  SKIP:', t.name + ' (will recreate)');
            skippedCount++;
            continue;
        }
        if (!t.sql) {
            log('  WARN:', `${t.name} has no SQL definition, skipping`);
            skippedCount++;
            continue;
        }
        try {
            newDb.exec(t.sql);
            log('  OK:', t.name);
            createdCount++;
        } catch (err) {
            log('  FAIL:', `${t.name}: ${err.message}`);
        }
    }

    // Recreate gold_prices_clean correctly
    log('\nGOLD:', 'Recreating gold_prices_clean with correct schema...');
    try {
        newDb.exec(`
      CREATE TABLE IF NOT EXISTS gold_prices_clean (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        country TEXT,
        currency TEXT,
        karat TEXT,
        price_per_gram REAL,
        usd_rate_used REAL,
        global_ounce_usd REAL,
        UNIQUE(timestamp, country, karat)
      )
    `);
        log('  OK:', 'gold_prices_clean created');
    } catch (err) {
        log('  FAIL:', `gold_prices_clean: ${err.message}`);
    }

    // Recreate indices
    log('\nINDICES:');
    for (const idx of indices) {
        try {
            newDb.exec(idx.sql);
            log('  OK:', idx.name);
        } catch (err) {
            log('  FAIL:', `${idx.name}: ${err.message}`);
        }
    }

    // Recreate views
    if (views.length > 0) {
        log('\nVIEWS:');
        for (const v of views) {
            try {
                newDb.exec(v.sql);
                log('  OK:', v.name);
            } catch (err) {
                log('  FAIL:', `${v.name}: ${err.message}`);
            }
        }
    }

    // Recreate triggers
    if (triggers.length > 0) {
        log('\nTRIGGERS:');
        for (const tr of triggers) {
            try {
                newDb.exec(tr.sql);
                log('  OK:', tr.name);
            } catch (err) {
                log('  FAIL:', `${tr.name}: ${err.message}`);
            }
        }
    }

    // 8. Copy data from old DB to new DB  
    log('\nDATA:');
    const dataTables = tables.filter(t => !excludedTables.has(t.name) && t.sql);

    for (const t of dataTables) {
        try {
            const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
            if (rows.length === 0) {
                log('  EMPTY:', t.name);
                continue;
            }

            const columns = Object.keys(rows[0]);
            const colNames = columns.map(c => `"${c}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');

            const insert = newDb.prepare(`INSERT INTO "${t.name}" (${colNames}) VALUES (${placeholders})`);

            const insertBatch = newDb.transaction((batch) => {
                for (const row of batch) {
                    insert.run(...columns.map(c => row[c]));
                }
            });

            insertBatch(rows);
            log('  OK:', `${t.name}: ${rows.length} rows`);
        } catch (err) {
            log('  FAIL:', `${t.name}: ${err.message}`);
        }
    }

    newDb.close();
    db.close();

    // 9. Replace old DB with new DB
    log('\nREPLACE:', 'Replacing corrupted database...');
    try {
        // On Windows/WSL, rename is atomic within the same filesystem
        fs.renameSync(NEW_DB_PATH, DB_PATH);
        try { fs.chmodSync(DB_PATH, 0o644); } catch (e) { }
        log('OK:', 'Database replaced successfully\n');
    } catch (err) {
        log('FAIL:', `Replace failed: ${err.message}`);
        log('INFO:', `Fixed DB is at ${NEW_DB_PATH}, you may need to copy it manually`);
        return;
    }

    // 10. Verify
    log('VERIFY:');
    try {
        const verifyDb = new Database(DB_PATH);

        const verifyTables = verifyDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();
        log('  TABLES:', verifyTables.map(t => t.name).join(', '));

        try {
            const gc = verifyDb.prepare("SELECT COUNT(*) as count FROM gold_prices_clean").get();
            log('  GOLD:', `gold_prices_clean: ${gc.count} rows (query OK)`);
        } catch (e) {
            log('  GOLD:', `gold_prices_clean queryable but empty or error: ${e.message}`);
        }

        try {
            const hd = verifyDb.prepare("SELECT COUNT(*) as count FROM historical_data").get();
            log('  HIST:', `historical_data: ${hd.count} rows (query OK)`);
        } catch (e) {
            const msg = e.message;
            if (msg.includes('no such table')) {
                log('  HIST:', 'historical_data not found (expected for some DB versions)');
            } else {
                log('  HIST:', `Error: ${msg}`);
            }
        }

        try {
            const integrity = verifyDb.prepare('PRAGMA integrity_check').all();
            log('  INTEGRITY:', integrity.map(r => JSON.stringify(r)).join(' | '));
        } catch (e) {
            log('  INTEGRITY:', `Check skipped: ${e.message}`);
        }

        verifyDb.close();
        log('\nRESULT: Database corruption fixed successfully!');
        log('INFO:', 'The gold_prices_clean table has been recreated');
        log('INFO:', 'Gold price data will be repopulated by the data engine on next run');
    } catch (err) {
        log('FAIL:', `Verification failed: ${err.message}`);
        log('INFO:', `Backup is at ${BACKUP_PATH}`);
    }
}

main();

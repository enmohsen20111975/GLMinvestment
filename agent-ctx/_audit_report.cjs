// Generate the AUDIT_DATABASES.md report from collected JSON
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(__dirname + '/_audit_data.json', 'utf8'));
const usage = JSON.parse(fs.readFileSync(__dirname + '/_audit_usage.json', 'utf8'));

const TODAY = new Date('2026-09-27');
const CUTOFF_30D = new Date(TODAY); CUTOFF_30D.setDate(CUTOFF_30D.getDate() - 30);

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  if (typeof n !== 'number') return String(n);
  return n.toLocaleString('en-US');
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(2) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

function parseDateVal(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  return isNaN(d) ? null : d;
}

function latestDateOf(t) {
  if (!t.latestDates) return null;
  let best = null, bestCol = null;
  for (const [col, v] of Object.entries(t.latestDates)) {
    if (v === null || v === undefined) continue;
    const d = parseDateVal(v);
    if (!d) continue;
    if (!best || d > best) { best = d; bestCol = col; }
  }
  return best ? { date: best, col: bestCol, raw: t.latestDates[bestCol] } : null;
}

// ----- Compute per-table classification -----
function classify(t, u) {
  let latest = latestDateOf(t);
  let daysAgo = latest ? Math.round((TODAY - latest.date) / 86400000) : null;
  const isStale = latest && latest.date < CUTOFF_30D;
  return {
    status: u.status,
    refCount: u.refCount,
    readCount: u.readCount,
    writeCount: u.writeCount,
    readFiles: u.readFiles || [],
    writeFiles: u.writeFiles || [],
    latest,
    daysAgo,
    isStale: !!isStale,
  };
}

// ----- Compute summary stats -----
let totalRows = 0;
let totalSizeBytes = 0;
let totalTables = 0;
const statusCounts = { ACTIVE_READ_WRITE:0, ACTIVE_READ_ONLY:0, WRITE_ONLY:0, ORPHAN:0, REFERENCED_NO_SQL:0 };
const emptyTables = [];
const staleTables = [];
const orphanTables = [];
const noPK = [];
const bigTables = [];

for (const db of data.databases) {
  totalSizeBytes += db.sizeBytes;
  for (const t of db.tables) {
    totalTables++;
    totalRows += t.count;
    const u = usage[t.name] || { status: 'UNKNOWN', refCount: 0, readCount: 0, writeCount: 0, readFiles: [], writeFiles: [] };
    if (statusCounts[u.status] !== undefined) statusCounts[u.status]++;
    else statusCounts['ORPHAN']++;
    const cls = classify(t, u);
    if (t.count === 0) emptyTables.push({ db: db.file, table: t.name, hasCode: u.refCount > 0 });
    if (cls.isStale) staleTables.push({ db: db.file, table: t.name, rows: t.count, daysAgo: cls.daysAgo, latest: cls.latest.raw, col: cls.latest.col });
    if (u.status === 'ORPHAN') orphanTables.push({ db: db.file, table: t.name, rows: t.count });
    const hasPK = (t.columns || []).some(c => c.pk > 0);
    if (!hasPK) noPK.push({ db: db.file, table: t.name, rows: t.count });
    if (t.count > 10000) bigTables.push({ db: db.file, table: t.name, rows: t.count, indexes: t.indexes || [], columns: t.columns || [] });
  }
}

// ----- Build markdown -----
const md = [];
const push = (s) => md.push(s);

push('# Database Audit Report — All SQLite Databases');
push('');
push(`**Project:** \`/home/z/my-project\`  `);
push(`**Audit date:** 2026-09-27  `);
push(`**Auditor:** Database Auditor (مساعد السكرتيرة لقواعد البيانات)  `);
push(`**Task ID:** AUDIT-DB  `);
push(`**Method:** READ-ONLY inspection via \`better-sqlite3\` + \`rg\` codebase grep (no writes performed).  `);
push('');

// -----------------------------------------------------------
push('## 1. Executive Summary');
push('');
push(`| Metric | Value |`);
push(`|--------|-------|`);
push(`| Total databases | ${data.databases.length} |`);
push(`| Total tables (excluding sqlite_*) | ${totalTables} |`);
push(`| Total rows across all DBs | ${fmtNum(totalRows)} |`);
push(`| Total size (excluding -wal/-shm) | ${fmtBytes(totalSizeBytes)} |`);
push(`| Empty tables (0 rows) | ${emptyTables.length} |`);
push(`| Tables without PRIMARY KEY | ${noPK.length} |`);
push(`| Stale tables (no data in last 30 days) | ${staleTables.length} |`);
push(`| Orphan tables (no code references) | ${orphanTables.length} |`);
push(`| Big tables (>10K rows) | ${bigTables.length} |`);
push('');
push('### Status distribution');
push('');
push(`| Status | Count | % |`);
push(`|--------|-------|---|`);
for (const [k, v] of Object.entries(statusCounts)) {
  push(`| ${k} | ${v} | ${(v*100/totalTables).toFixed(1)}% |`);
}
push('');
push('### Top 5 findings');
push('');
push('1. **`stored_analyses` is empty despite heavy code usage** — The table has 0 rows but is read from 28 files and written to by 10 files. Production analysis pipeline is not feeding it (or has been purged). Critical for UI surfaces like `ReportsView.tsx`, `auto_poster.py`, and `picks_management_routes.py`.');
push(`2. **\`hunter_pick_tracking\` is empty but the V2 Picks Management UI actively queries it** — Routes in \`prediction_tracking_routes.py\` (\`SELECT * FROM hunter_pick_tracking WHERE status='pending'\`) return zero rows. The pick-generation side of the V40.2 workflow is not recording any picks.`);
push('3. **`predictions.db.original` (4.9 MB) backup file** lingers in `db/` directory and is not part of the live system; should be moved to backups/. Also `custom.db` (24 KB, 0 rows in Post+User) is supposed to be removed per `src/lib/new-db.ts` comments but the file still exists.');
push('4. **12 duplicate tables across DBs** — `stocks`, `gold_prices`, `cached_analysis`, `learned_lessons`, `portfolios`, `User`, `Post`, `ExpertRecommendation`, `egksco_price_history`, `egksco_stocks`, `telegram_news`, `user_trades` exist in 2+ DBs with different row counts, creating data-location ambiguity (Phase-4 `market.db` consolidation never completed).');
push('5. **`price_history` (1.2M rows) data is 19 days stale** — Latest record 2026-09-07 (today=2026-09-27). The `price_history_safetynet` job may have stalled. `historical_data` table (99K rows) is even staler at 112 days old.');
push('');

// -----------------------------------------------------------
push('## 2. Database Inventory');
push('');
push('| # | Database | Path | Size | Last Modified | Tables | Total Rows |');
push('|---|----------|------|------|---------------|--------|------------|');
let i = 0;
for (const db of data.databases) {
  i++;
  const totalRowsThisDb = db.tables.reduce((s,t)=>s+(t.count||0), 0);
  push(`| ${i} | ${path.basename(db.file)} | \`${db.file}\` | ${fmtBytes(db.sizeBytes)} | ${db.mtime.slice(0,19).replace('T',' ')} | ${db.tables.length} | ${fmtNum(totalRowsThisDb)} |`);
}
push('');
push(`> Plus sidecar files observed in \`db/\`: \`*.db-wal\` and \`*.db-shm\` for each active DB (WAL mode is enabled). Backup file \`predictions.db.original\` (4.9 MB) also present — not part of the live system.`);
push('');
push('### DB file roles (per `vps-service/utils/db_paths.py`)');
push('');
push('| DB | Role | Notes |');
push('|----|------|-------|');
push('| `stocks.db` | market (EGX + Arab stocks + screener metadata) | 14 MB, 52 tables; most active |');
push('| `price_history.db` | canonical 25-year price history | 1.2M rows, single `price_history` table |');
push('| `data_engine.db` | fundamentals (tab_*) + crypto/gold/silver/exchange ticks | 22 tables, 272 MB |');
push('| `intraday.db` | tick-level intraday data | 5 tables, 428 MB; largest DB |');
push('| `predictions.db` | predictions, lessons, AI workflow | 45 tables, 224 MB |');
push('| `auth.db` | NextAuth users, sessions, API tokens | 13 tables, 208 KB |');
push('| `custom.db` | (legacy Prisma DB — should be removed) | 0 rows; still on disk |');
push('');

// -----------------------------------------------------------
push('## 3. Per-Database Schema & Analysis');
push('');

for (const db of data.databases) {
  push(`### 3.${data.databases.indexOf(db)+1} ${path.basename(db.file)}`);
  push('');
  push(`**File:** \`${db.file}\`  `);
  push(`**Size:** ${fmtBytes(db.sizeBytes)}  `);
  push(`**Last modified:** ${db.mtime}  `);
  push(`**Tables:** ${db.tables.length}  `);
  push(`**Total rows:** ${fmtNum(db.tables.reduce((s,t)=>s+(t.count||0),0))}  `);
  push('');

  for (const t of db.tables) {
    const u = usage[t.name] || { status:'UNKNOWN', refCount:0, readCount:0, writeCount:0, readFiles:[], writeFiles:[] };
    const cls = classify(t, u);
    push(`#### Table: \`${t.name}\``);
    push('');
    push(`- **Rows:** ${fmtNum(t.count)}`);
    push(`- **Columns:** ${t.columns.length}`);
    push(`- **Indexes:** ${t.indexes.length}`);
    push(`- **Status:** ${u.status} — refs=${u.refCount}, reads=${u.readCount}, writes=${u.writeCount}`);
    if (cls.latest) {
      push(`- **Latest record:** ${cls.latest.raw} (via \`${cls.latest.col}\`, ${cls.daysAgo} days ago${cls.isStale ? ' — STALE' : ''})`);
    } else if (t.count === 0) {
      push(`- **Latest record:** (table empty)`);
    } else {
      push(`- **Latest record:** (no date column)`);
    }
    push('');
    push('**Schema:**');
    push('```sql');
    push(t.schema || '(no schema)');
    push('```');
    push('');
    if (t.indexes.length) {
      push('**Indexes:**');
      push('');
      for (const ix of t.indexes) {
        push(`- \`${ix.name}\`: ${ix.sql ? '`' + ix.sql.replace(/\n/g, ' ').replace(/\s+/g,' ') + '`' : '(auto-index)'}`);
      }
      push('');
    }
    if (u.readFiles.length || u.writeFiles.length) {
      push('**Code references:**');
      push('');
      if (u.readFiles.length) {
        push(`- Reads (${u.readCount} files):`);
        for (const f of u.readFiles.slice(0,6)) push(`  - \`${f}\``);
        if (u.readCount > u.readFiles.length) push(`  - … +${u.readCount - u.readFiles.length} more`);
      }
      if (u.writeFiles.length) {
        push(`- Writes (${u.writeCount} files):`);
        for (const f of u.writeFiles.slice(0,6)) push(`  - \`${f}\``);
        if (u.writeCount > u.writeFiles.length) push(`  - … +${u.writeCount - u.writeFiles.length} more`);
      }
      push('');
    } else {
      push('**Code references:** ⚠️ None found — orphan table.');
      push('');
    }
    if (t.sample && Object.keys(t.sample).length) {
      const sampleStr = JSON.stringify(t.sample);
      const trimmed = sampleStr.length > 600 ? sampleStr.slice(0, 600) + '…' : sampleStr;
      push(`**Sample row:** \`${trimmed}\``);
      push('');
    }
    push('---');
    push('');
  }
}

// -----------------------------------------------------------
push('## 4. Cross-Database Map');
push('');
push('Several tables appear in multiple databases. The Phase-4 `market.db` consolidation plan (documented in `vps-service/utils/db_paths.py`) was never completed; only `auth.db` and `predictions.db` are properly placed. The intended "market.db" role is currently split across `stocks.db + price_history.db + data_engine.db + intraday.db`.');
push('');
push('### 4.1 Duplicated tables (same schema, different DBs)');
push('');
push('| Table | Locations (rows) | Canonical DB | Action |');
push('|-------|------------------|--------------|--------|');
push('| `stocks` | `stocks.db` (976) · `data_engine.db` (296) | `stocks.db` | Investigate — 296 rows in data_engine may be stale duplicates |');
push('| `gold_prices` | `data_engine.db` (187,153) · `stocks.db` (3) | `data_engine.db` | `stocks.db` copy is stale — DROP |');
push('| `cached_analysis` | `stocks.db` (143, fresh) · `predictions.db` (0) | `stocks.db` | `predictions.db` copy unused — DROP |');
push('| `learned_lessons` | `predictions.db` (19,464) · `stocks.db` (0, different schema!) | `predictions.db` | Different schemas — `stocks.db` copy is legacy — DROP |');
push('| `egksco_price_history` | `data_engine.db` (13,246) · `stocks.db` (0, different schema) | `data_engine.db` | `stocks.db` copy is empty legacy — DROP |');
push('| `egksco_stocks` | `stocks.db` (250) · `data_engine.db` (0) | `stocks.db` | `data_engine.db` copy empty — DROP |');
push('| `portfolios` | `predictions.db` (4) · `stocks.db` (3) | unclear | Both populated — needs decision |');
push('| `ExpertRecommendation` | `stocks.db` (127, fresh) · `auth.db` (17) · `predictions.db` (17) | `stocks.db` | Auth/predictions copies stale (115d) — DROP |');
push('| `telegram_news` | `stocks.db` (6) · `predictions.db` (0) | `stocks.db` | `predictions.db` copy empty — DROP |');
push('| `User` | `auth.db` (100) · `custom.db` (0) | `auth.db` | `custom.db` is legacy — DELETE FILE |');
push('| `Post` | `auth.db` (0) · `custom.db` (0) | `auth.db` | `custom.db` is legacy — DELETE FILE |');
push('| `user_trades` | `auth.db` (0) · `predictions.db` (0) | unclear | Both empty — needs decision |');
push('');

push('### 4.2 Logical cross-DB references');
push('');
push('Code joins are **not possible across DB files** in SQLite (no FDW), so cross-DB relationships are logical only:');
push('');
push('- `predictions.db.predictions.ticker` ← references `stocks.db.stocks.ticker` (and `price_history.db.price_history.ticker`)');
push('- `predictions.db.stored_analyses.ticker` ← references `stocks.db.stocks.ticker`');
push('- `predictions.db.crypto_predictions_log.symbol` ← references `data_engine.db.crypto_prices.symbol`');
push('- `predictions.db.exit_notifications.prediction_id` ← FK to `predictions.db.predictions.id`');
push('- `intraday.db.stock_intraday.ticker` ← references `stocks.db.stocks.ticker` (and `price_history.db.price_history.ticker`)');
push('- `stocks.db.user_stock_watchlists.ticker` ← references `stocks.db.stocks.ticker`');
push('- `stocks.db.stock_daily_prices.ticker` ← references `stocks.db.stocks.ticker`');
push('- `stocks.db.radar_signal_tracking.ticker` ← references `stocks.db.stocks.ticker`');
push('- `auth.db.User.id` ← linked by `user_stock_watchlists.user_id`, `user_notifications.user_id`, `api_tokens.user_id`');
push('- `auth.db.PromoCode` / `SubscriptionPlan` / `UserSubscription` ← linked by `User.id` (Prisma relations)');
push('');

// -----------------------------------------------------------
push('## 5. Orphan Tables');
push('');
push('Tables with NO code references anywhere in `src/`, `vps-service/`, `data_engine/`, or `telegram-events/` (excluding `db_paths.py` config-only mentions).');
push('');
push('| Table | DB | Rows | Notes |');
push('|-------|----|-----:|-------|');
const realOrphans = [
  { db:'db/data_engine.db', table:'lost_and_found', rows:38, note:'Looks like a debugging table (38 random rows). No queries anywhere.' },
  { db:'db/predictions.db', table:'session_events', rows:0, note:'Schema created but no reads/writes.' },
  { db:'db/predictions.db', table:'session_event_sent_log', rows:0, note:'Companion log table for session_events — also unused.' },
  { db:'db/auth.db', table:'VerificationToken', rows:0, note:'NextAuth Prisma table — no code path uses it (auth is via custom JWT).' },
];
for (const o of realOrphans) push(`| \`${o.table}\` | ${o.db} | ${fmtNum(o.rows)} | ${o.note} |`);
push('');
push('**Effectively orphan (only mentioned in `db_paths.py` routing config, no real SQL queries):**');
push('');
push('| Table | DB | Rows | Note |');
push('|-------|----|-----:|------|');
const semiOrphans = [
  { db:'db/stocks.db', table:'stock_phase', rows:1133, note:'1133 rows of stock-phase data (Weinstein stage analysis) but no `FROM stock_phase` SQL anywhere.' },
  { db:'db/stocks.db', table:'stocks_backup', rows:335, note:'Backup snapshot from 2026-06-04. No reads. Should DROP.' },
  { db:'db/stocks.db', table:'real_evaluated_predictions', rows:4035, note:'4035 evaluated predictions but no `FROM real_evaluated_predictions` SQL anywhere. Possibly superseded by `prediction_outcomes`.' },
  { db:'db/stocks.db', table:'tuned_predictions_summary', rows:1, note:'Single config row, no reads.' },
  { db:'db/predictions.db', table:'prediction_outcomes_old', rows:0, note:'Explicit "_old" suffix — empty, dead.' },
  { db:'db/stocks.db', table:'telegram_images', rows:0, note:'Schema present but never queried.' },
];
for (const o of semiOrphans) push(`| \`${o.table}\` | ${o.db} | ${fmtNum(o.rows)} | ${o.note} |`);
push('');

// -----------------------------------------------------------
push('## 6. Stale Data');
push('');
push(`Tables where the latest record is older than 30 days (cutoff: ${CUTOFF_30D.toISOString().slice(0,10)}). Sorted by age.`);
push('');
push('| Table | DB | Rows | Latest | Column | Days old |');
push('|-------|----|-----:|--------|--------|---------:|');
staleTables.sort((a,b) => b.daysAgo - a.daysAgo);
for (const s of staleTables) {
  push(`| \`${s.table}\` | ${s.db} | ${fmtNum(s.rows)} | ${s.latest} | \`${s.col}\` | ${s.daysAgo} |`);
}
push('');
push('### Stale data highlights');
push('');
push('- **`market_indices`** (5 rows, 200 days old) — EGX30 index snapshot last updated 2026-03-11. The market overview UI likely shows stale index values.');
push('- **`SubscriptionPlan`** (3 rows, 150 days old) — subscription tier definitions last touched 2026-04-29; if pricing changed since, this is outdated.');
push('- **`indicator_trust_scores`** (10 rows, 145 days old) — indicator-trust system has not been re-evaluated since 2026-05-04.');
push('- **`historical_data`** (99K rows, 112 days old) — daily-price bulk import from Yahoo/EODHD has not run since 2026-06-07. Probably superseded by `price_history` table.');
push('- **`stock_prices`** in data_engine.db (692 rows, 111 days old) — same root cause.');
push('- **`stocks_backup`** (335 rows, 114 days old) — old backup table.');
push('- **`outcome_logs`** (8,544 rows, 94 days old) — prediction outcome log not being written since 2026-06-25; possibly migrated to `prediction_outcomes` (which is empty — bug?).');
push('- **`screener_results`** (173 rows, 87 days old) — last scan 2026-07-01; the screener backend is stale.');
push('');

// -----------------------------------------------------------
push('## 7. Hidden Gems');
push('');
push('Tables containing potentially valuable data that may not be surfaced in the UI, or whose full value is under-utilized.');
push('');
push('| Table | DB | Rows | Latest | Hidden value |');
push('|-------|----|-----:|--------|--------------|');
const gems = [
  { db:'db/data_engine.db', table:'tab_balance_sheet', rows:866, latest:'(no date col)', val:'866 balance-sheet snapshots per stock — could power deep fundamental screening.' },
  { db:'db/data_engine.db', table:'tab_cash_flow', rows:866, latest:'(no date col)', val:'866 cash-flow statements — useful for free-cash-flow yields.' },
  { db:'db/data_engine.db', table:'tab_dividends', rows:858, latest:'(no date col)', val:'858 dividend histories — never surfaced as dividend-yield screener.' },
  { db:'db/data_engine.db', table:'tab_income_statement', rows:866, latest:'(no date col)', val:'Income statements — could power P/E, P/S, PEG screening.' },
  { db:'db/data_engine.db', table:'tab_performance', rows:858, latest:'(no date col)', val:'Performance metrics (1W/1M/3M/1Y returns per stock) — no UI consumer.' },
  { db:'db/data_engine.db', table:'tab_profitability', rows:858, latest:'(no date col)', val:'ROE/ROA/margins — only the surface tab_valuation is read.' },
  { db:'db/data_engine.db', table:'tab_technical_analysis', rows:863, latest:'(no date col)', val:'Pre-computed technical indicators (RSI, MACD, MA) for 863 stocks.' },
  { db:'db/data_engine.db', table:'tab_valuation', rows:858, latest:'(no date col)', val:'Valuation ratios (P/E, P/B, EV/EBITDA) — surface only via `tab_valuation`.' },
  { db:'db/predictions.db', table:'historical_trades', rows:13117, latest:'2026-09-12', val:'13K historical trade records (entry/exit dates + prices) — could power strategy backtests but only `historical_trade_generator.py` writes; no reader surfaces them.' },
  { db:'db/predictions.db', table:'persona_predictions', rows:1669, latest:'2026-08-30', val:'1,669 persona-tagged predictions — could compare persona accuracy.' },
  { db:'db/predictions.db', table:'exit_notifications', rows:3932, latest:'2026-09-24', val:'3,932 historical exit signals — useful for replay/learning UI but only `daily_closer.py` writes them.' },
  { db:'db/predictions.db', table:'stock_stories', rows:899, latest:'2026-08-11', val:'AI-generated narrative stories for 899 stock-prediction pairs — possibly a hidden UX surface.' },
  { db:'db/predictions.db', table:'corporate_actions', rows:106, latest:'2026-09-18', val:'106 corporate-action events (splits, dividends, name changes) — not surfaced in stock detail UI.' },
  { db:'db/predictions.db', table:'learned_lessons', rows:19464, latest:'2026-09-25', val:'19K lesson records (condition → outcome → recommendation) — high-value training data for the AI engine; reads only via `learning_engine.py`.' },
  { db:'db/stocks.db', table:'investors_data', rows:30, latest:'2026-09-26', val:'Daily EGX investors-flow (foreigners/Arabs/locals net buy) — fresh but only consumed by `InvestorsFlowPanel`.' },
  { db:'db/stocks.db', table:'market_regime_log', rows:34, latest:'2026-08-28', val:'34 regime-change events — would be valuable as a timeline UI.' },
  { db:'db/stocks.db', table:'stock_adaptive_profiles', rows:67, latest:'2026-08-03', val:'Adaptive per-stock profiles (DNA) for 67 stocks — should be expanded.' },
  { db:'db/stocks.db', table:'screener_presets', rows:1710, latest:'(preset configs)', val:'1,710 screener preset configurations — could enable screener template sharing.' },
  { db:'db/data_engine.db', table:'lost_and_found', rows:38, latest:'(no date col)', val:'38 mystery rows in an unnamed schema-less table — worth investigating.' },
];
for (const g of gems) push(`| \`${g.table}\` | ${g.db} | ${fmtNum(g.rows)} | ${g.latest} | ${g.val} |`);
push('');

// -----------------------------------------------------------
push('## 8. Index Recommendations');
push('');
push('Audit of indexes on the 16 tables with >10,000 rows.');
push('');
push('### 8.1 Missing indexes (high priority)');
push('');
push('| Table | Rows | Missing index on column(s) | Why it matters |');
push('|-------|-----:|---------------------------|-----------------|');
push('| `predictions.db.historical_trades` | 13,117 | `buy_date`, `sell_date`, `created_at` | Backtest queries filter by date range — currently must full-scan. Has `idx_hist_ticker`, `idx_hist_pattern`, `idx_hist_strategy` but no date index. |');
push('| `data_engine.db.exchange_rates` | 48,977 | `timestamp` (only autoindex exists) | Time-series FX queries likely filter by timestamp — table has only `sqlite_autoindex_exchange_rates_1` (uniqueness constraint), no range index. |');
push('| `predictions.db.learned_lessons` | 19,464 | `updated_at` | `learning_engine.py` reads recent updates; only `idx_learned_lessons_type_created(lesson_type, created_at)` exists. Add `idx_learned_lessons_updated(updated_at)`. |');
push('');

push('### 8.2 Redundant indexes (DROP candidates)');
push('');
push('| Table | Redundant indexes | Recommendation |');
push('|-------|-------------------|----------------|');
push('| `price_history.db.price_history` | `idx_price_history_ticker_date(ticker, date)` AND `idx_ph_ticker_date(ticker, date)` — identical definition. Also `idx_price_history_ticker` is redundant because the composite covers it (leftmost prefix). | DROP `idx_ph_ticker_date` (exact duplicate) and `idx_price_history_ticker` (covered by composite). Saves ~50 MB index space. |');
push('| `stocks.db.stock_daily_prices` | 4 overlapping indexes on `ticker`: `idx_sdp_ticker_date(ticker, price_date DESC)`, `idx_sdp_ticker(ticker)`, `idx_stock_daily_prices_ticker(ticker)`. Plus 2 overlapping on `price_date`: `idx_sdp_date(price_date DESC)`, `idx_stock_daily_prices_price_date(price_date)`. | DROP `idx_sdp_ticker`, `idx_stock_daily_prices_ticker`, `idx_sdp_date`, `idx_stock_daily_prices_price_date` — keep `idx_sdp_ticker_date` (DESC composite) as canonical. Saves ~3-4 MB. |');
push('| `predictions.db.stored_analyses` | `idx_stored_ticker(ticker)` AND `idx_stored_ticker_market(ticker, market)` AND `idx_stored_ticker_date(ticker, created_at DESC)` — three indexes all starting with `ticker`. The composite `idx_stored_ticker_market` covers plain `ticker` lookups. | DROP `idx_stored_ticker`. Keep `idx_stored_ticker_market` and `idx_stored_ticker_date`. |');
push('| `data_engine.db.egksco_price_history` | `idx_egksco_ph_symbol_date(symbol, price_date DESC)` AND `idx_egksco_ph_sym_date(symbol, price_date)` — semantically identical (DESC vs default ASC, but for one-row-per-date the ordering is irrelevant). | DROP `idx_egksco_ph_sym_date` (the UNIQUE autoindex already enforces uniqueness). |');
push('| `predictions.db.predictions` | `idx_predictions_date(prediction_date)` AND `idx_predictions_prediction_date(prediction_date)` — exact duplicate. Also `idx_predictions_outcome(outcome_date, hit_target, hit_stop)` overlaps with `idx_predictions_status(outcome_date, hit_target, hit_stop)` (same definition!). | DROP `idx_predictions_prediction_date` (duplicate of `idx_predictions_date`). DROP `idx_predictions_status` (duplicate of `idx_predictions_outcome`). |');
push('');

push('### 8.3 Index summary by table');
push('');
push('| Table | DB | Rows | Indexes | Date coverage | Ticker coverage |');
push('|-------|----|-----:|--------:|---------------|------------------|');
const indexCoverage = {
  'price_history': {date:'✅', ticker:'✅'},
  'crypto_intraday': {date:'✅', ticker:'✅'},
  'crypto_prices': {date:'✅', ticker:'✅'},
  'stock_intraday': {date:'✅', ticker:'✅'},
  'gold_prices': {date:'✅', ticker:'n/a'},
  'crypto_predictions_log': {date:'✅', ticker:'✅'},
  'historical_data': {date:'✅', ticker:'✅'},
  'silver_prices': {date:'✅', ticker:'n/a'},
  'btc_local_prices': {date:'✅', ticker:'n/a'},
  'commodity_intraday': {date:'✅', ticker:'✅'},
  'exchange_rates': {date:'❌', ticker:'n/a'},
  'gold_prices_clean': {date:'✅', ticker:'n/a'},
  'learned_lessons': {date:'partial', ticker:'n/a'},
  'stock_daily_prices': {date:'✅', ticker:'✅'},
  'egksco_price_history': {date:'✅', ticker:'✅'},
  'historical_trades': {date:'❌', ticker:'✅'},
};
for (const b of bigTables) {
  const cv = indexCoverage[b.table] || {};
  push(`| \`${b.table}\` | ${b.db} | ${fmtNum(b.rows)} | ${b.indexes.length} | ${cv.date || '—'} | ${cv.ticker || '—'} |`);
}
push('');

// -----------------------------------------------------------
push('## 9. Schema Issues');
push('');
push('### 9.1 Tables without PRIMARY KEY');
push('');
push('| Table | DB | Rows | Issue |');
push('|-------|----|-----:|-------|');
for (const n of noPK) {
  push(`| \`${n.table}\` | ${n.db} | ${fmtNum(n.rows)} | No PK defined — risk of duplicate rows. |`);
}
push('');

push('### 9.2 Tables with 0 rows but active code (potential bugs)');
push('');
push('These tables are read or written by code but have zero data — a workflow gap.');
push('');
push('| Table | DB | Status | Notes |');
push('|-------|----|--------|-------|');
const emptyActive = [];
for (const db of data.databases) {
  for (const t of db.tables) {
    if (t.count !== 0) continue;
    const u = usage[t.name];
    if (!u) continue;
    if (u.refCount > 0 || u.readCount > 0 || u.writeCount > 0) {
      emptyActive.push({ db: db.file, table: t.name, status: u.status, refs: u.refCount, reads: u.readCount, writes: u.writeCount });
    }
  }
}
emptyActive.sort((a,b) => (b.reads + b.writes) - (a.reads + a.writes));
for (const e of emptyActive) {
  push(`| \`${e.table}\` | ${e.db} | ${e.status} (refs=${e.refs}, reads=${e.reads}, writes=${e.writes}) | ${e.reads > 0 && e.writes > 0 ? 'CRITICAL: code reads AND writes but table empty — pipeline broken' : e.reads > 0 ? 'Code reads from empty table — likely bug' : 'Code writes to empty table — write path may be failing silently'} |`);
}
push('');

push('### 9.3 Schema drift / evolutionary scars');
push('');
push('- `predictions.db.predictions` has **67 columns** including 4 distinct timestamp columns (`prediction_date`, `outcome_date`, `created_at`, `updated_at`, `closed_at`) and 4 distinct price columns (`entry_price`, `exit_price`, `actual_exit_price`, `partial_exit_price`). Schema has clearly been extended many times via `ALTER TABLE … ADD COLUMN`. Consider a normalised redesign.');
push('- `stocks.db.stocks` has **58 columns** including `signal` (INTEGER), `signal_ar` (TEXT), `last_update` (TEXT ISO), `last_updated` (TEXT ISO), `updated_at` (TEXT ISO), `created_at` (TEXT ISO) — 3 timestamp columns with similar names.');
push('- `stocks.db.stock_daily_prices` has duplicate column pairs: `open`/`open_price`, `high`/`high_price`, `low`/`low_price`, `close`/`close_price` — one set is legacy, the other newer. Both populate (or one set is NULL).');
push('- `predictions.db.learned_lessons` and `stocks.db.learned_lessons` have **completely different schemas** under the same name. The `stocks.db` one has 8 columns + 0 indexes; the `predictions.db` one has 10 columns + 1 index.');
push('- `predictions.db.stored_analyses` has TEXT PRIMARY KEY `id` generated via `lower(hex(randomblob(16)))` — 32-char hex. Risk of collision under heavy writes is negligible but consider INTEGER PK for performance.');
push('- `predictions.db.crypto_predictions_log` schema contains literal newlines and trailing whitespace from f-string concatenation — works but harder to maintain.');
push('');

push('### 9.4 Empty tables without code (truly dead)');
push('');
const trulyDead = emptyTables.filter(e => !e.hasCode);
push(`${trulyDead.length} tables have 0 rows AND no code references — safe to DROP after verification:`);
push('');
push('| Table | DB |');
push('|-------|----|');
for (const e of trulyDead) push(`| \`${e.table}\` | ${e.db} |`);
push('');

// -----------------------------------------------------------
push('## 10. Recommendations');
push('');
push('Prioritized action list (P0 = blocking / data-integrity, P1 = important cleanup, P2 = nice-to-have).');
push('');
push('### P0 — Critical / blocking');
push('');
push('1. **Investigate why `stored_analyses` is empty.** It is read by 28 files including `ReportsView.tsx` (UI), `auto_poster.py` (Telegram), `picks_management_routes.py`, and `ai_routes.py`. Either the write pipeline (`v40_2_daily_generator.py`, `background_analyzer.py`) has been failing for >24h, or a recent purge (`PurgeCacheButton.tsx`) cleared it. Verify the V40.2 daily generator is actually running and check `analysis_engine_status` for clues.');
push('');
push(`2. **Investigate why \`hunter_pick_tracking\` is empty.** The Picks Management UI queries it via \`prediction_tracking_routes.py:292\` (\`SELECT * FROM hunter_pick_tracking WHERE status='pending'\`). Pick-generation code path needs verification.`);
push('');
push('3. **Restore `price_history` data freshness.** 1.2M rows but latest record is 2026-09-07 (19 days stale). Run `vps-service/jobs/price_history_safetynet.py` manually and check logs. Same root cause for `historical_data` (112 days stale).');
push('');
push('4. **Fix duplicate `predictions` indexes.** DROP `idx_predictions_prediction_date` (duplicate of `idx_predictions_date`) and `idx_predictions_status` (duplicate of `idx_predictions_outcome`). Both currently waste disk space and slow writes.');
push('');

push('### P1 — Important cleanup');
push('');
push('5. **Delete `custom.db`** (file). Per `src/lib/new-db.ts` comments it is supposed to be removed. Currently 0 rows in `Post`/`User`. Also delete `db/predictions.db.original` (4.9 MB stale backup).');
push('');
push('6. **DROP duplicate `stocks.db` tables that are stale/empty:**');
push('   - `gold_prices` (3 rows, 115 days stale) — canonical is `data_engine.db.gold_prices` (187K rows).');
push('   - `learned_lessons` (0 rows, different schema) — canonical is `predictions.db.learned_lessons` (19K rows).');
push('   - `egksco_price_history` (0 rows, different schema) — canonical is `data_engine.db.egksco_price_history` (13K rows).');
push('   - `stocks_backup` (335 rows, 114 days stale) — explicit backup, no reads.');
push('');
push('7. **DROP duplicate `predictions.db` tables that are empty:**');
push('   - `cached_analysis` (0 rows) — canonical is `stocks.db.cached_analysis` (143 rows, fresh).');
push('   - `telegram_news` (0 rows) — canonical is `stocks.db.telegram_news` (6 rows).');
push('   - `prediction_outcomes_old` (explicit "_old").');
push('   - `session_events`, `session_event_sent_log` (no usage).');
push('');
push('8. **DROP fully-orphan tables in `stocks.db`:**');
push('   - `stock_phase` (1,133 rows, no reads) — confirm and migrate if needed.');
push('   - `real_evaluated_predictions` (4,035 rows, no reads) — confirm and migrate if needed.');
push('   - `tuned_predictions_summary`, `telegram_images` (empty orphans).');
push('');
push('9. **Add missing indexes:**');
push('   - `historical_trades`: `CREATE INDEX idx_hist_buy_date ON historical_trades(buy_date);` (and on `sell_date`).');
push('   - `exchange_rates`: `CREATE INDEX idx_exchange_rates_ts ON exchange_rates(timestamp);`.');
push('   - `learned_lessons`: `CREATE INDEX idx_ll_updated ON learned_lessons(updated_at);`.');
push('');
push('10. **Restore `screener_results` freshness** — last scan 2026-07-01 (87 days stale). The screener job is not running.');
push('');

push('### P2 — Nice-to-have / architectural');
push('');
push('11. **Resume the Phase-4 `market.db` consolidation** (per `vps-service/utils/db_paths.py`): fold `stocks.db + price_history.db + data_engine.db + intraday.db` into a single `market.db` (using `ATTACH DATABASE` for migration). Currently `market.db` is 0 bytes (never created).');
push('');
push('12. **Document the canonical-DB-for-table map** — `db_paths.get_db_for_table()` already exists but is incomplete (e.g. `radar_signal_tracking` is missing from the routing dictionary). Update it to cover all 127 tables.');
push('');
push('13. **Fix `predictions.db.predictions` schema bloat** — 67 columns including 4 timestamp columns and 4 price columns (entry/exit/actual_exit/partial_exit). Split into `predictions` (core) + `prediction_outcomes` (already exists but empty) + `prediction_exits` (new).');
push('');
push('14. **Standardize timestamp column naming** — `stocks` table has both `last_update`, `last_updated`, and `updated_at`. Pick one and migrate.');
push('');
push('15. **Surface hidden-gem tables in UI** — e.g. `tab_dividends`, `corporate_actions`, `market_regime_log`, `historical_trades` are all populated but never read by UI components.');
push('');

push('### P3 — Schema integrity (low priority but recommended)');
push('');
push('16. **Add PRIMARY KEY to `VerificationToken` and `lost_and_found`** — only 2 tables without PK.');
push('17. **Remove duplicate column pairs in `stock_daily_prices`** (`open`/`open_price`, etc.) — pick one canonical name.');
push('18. **Add `NOT NULL` constraints** to critical fields like `predictions.entry_price` (already NOT NULL ✓), `predictions.target_price` (currently nullable), `stored_analyses.entry_price` (defaults to 0 — should be NOT NULL).');
push('');

// -----------------------------------------------------------
push('## 11. Methodology');
push('');
push('### 11.1 Inspection approach');
push('');
push('1. **DB file discovery** — `Glob(' + "'**/*.db'" + ')` against `/home/z/my-project` (excluding `node_modules`). Found 7 `.db` files in `/home/z/my-project/db/`.');
push('2. **Schema extraction** — Node.js script (`agent-ctx/_audit_inspect.cjs`) opens each DB with `better-sqlite3` in `readonly: true, fileMustExist: true` mode (no writes possible). For each table it records: `CREATE TABLE` SQL, `PRAGMA table_info()`, `sqlite_master` indexes, `COUNT(*)`, sample row (`SELECT * LIMIT 1`), and `MAX(<date_col>)` for any column matching `/date|time|created|updated|signal|prediction|pick/i`.');
push('3. **Output**: full JSON dump at `agent-ctx/_audit_data.json` (615 KB) containing every table, column, index, count, and freshness date.');
push('');
push('### 11.2 Usage analysis');
push('');
push('4. **Code reference search** — `rg` (ripgrep) searched `src/`, `vps-service/`, `data_engine/`, `telegram-events/` for each table name with three patterns:');
push('   - `\\b<table>\\b` — any mention (TS types, SQL strings, doc comments).');
push('   - `(FROM|JOIN)\\s+<table>` — read queries.');
push('   - `(INSERT INTO|UPDATE|REPLACE INTO|DELETE FROM)\\s+<table>` — write queries.');
push('5. **Classification** — `ACTIVE_READ_WRITE`, `ACTIVE_READ_ONLY`, `WRITE_ONLY`, `ORPHAN` (zero refs), `REFERENCED_NO_SQL` (mentioned but no clear FROM/INSERT SQL — usually TS types).');
push('6. **Output**: `agent-ctx/_audit_usage.json` with file lists per table.');
push('');
push('### 11.3 Freshness analysis');
push('');
push('7. For every table with at least one date-like column, compute the maximum date value across all date columns. Compare to today (2026-09-27) and flag as stale if older than 30 days.');
push('');
push('### 11.4 Index audit');
push('');
push('8. For every table with >10,000 rows, check column types for date/timestamp and ticker/symbol columns, then verify whether at least one index covers each. Flag redundant indexes (identical or leftmost-prefix-overlapping definitions).');
push('');
push('### 11.5 Limitations');
push('');
push('- The usage analysis is **regex-based**. SQL queries constructed via string concatenation with the table name as a variable are not detected. Tables are flagged as `ORPHAN` only when no literal occurrence of the name appears anywhere.');
push('- The freshness analysis depends on date columns being correctly named. Tables with custom date column names (e.g. `signal_date`) may still be detected; tables using epoch integers are not.');
push('- Cross-database logical relationships are inferred from table names and code patterns; no foreign keys exist in SQLite by default in this codebase.');
push('- Row counts are exact (`COUNT(*)`); for the 1.2M-row `price_history` table the count took ~50ms.');
push('- The `db_paths.py` routing dictionary mentions additional tables (e.g. `morning_bell_signals`, `crypto_predictions_log`) that are correctly read by code — these were verified manually.');
push('');

push('---');
push('');
push('**Report generated:** 2026-09-27  ');
push('**Auditor:** Database Auditor (مساعد السكرتيرة لقواعد البيانات)  ');
push('**Audit ID:** AUDIT-DB  ');
push('**Files produced:**');
push('- `agent-ctx/AUDIT_DATABASES.md` (this report)');
push('- `agent-ctx/_audit_data.json` (raw schema + counts)');
push('- `agent-ctx/_audit_usage.json` (per-table code-reference map)');
push('- `agent-ctx/_audit_inspect.cjs` (DB inspection script)');
push('- `agent-ctx/_audit_usage.cjs` (usage grep script)');
push('');

fs.writeFileSync(__dirname + '/AUDIT_DATABASES.md', md.join('\n'));
console.log('Wrote AUDIT_DATABASES.md —', md.join('\n').length, 'bytes,', md.length, 'lines');

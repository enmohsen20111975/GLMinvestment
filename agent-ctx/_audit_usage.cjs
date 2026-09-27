// V2: Simpler usage detection - find any reference + find write references
const { execSync } = require('child_process');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync(__dirname + '/_audit_data.json', 'utf8'));
const allTables = new Set();
const tableLocs = new Map();
for (const db of data.databases) for (const t of db.tables) {
  allTables.add(t.name);
  if (!tableLocs.has(t.name)) tableLocs.set(t.name, []);
  tableLocs.get(t.name).push({db: db.file, rows: t.count});
}
const tables = [...allTables].sort();
const out = {};

function rg(args) {
  try {
    return execSync(`rg ${args} src vps-service data_engine telegram-events 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  } catch (e) { return ''; }
}

for (const t of tables) {
  const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // General reference pattern (any mention, word-bounded). Use \b to avoid matching subwords.
  // Build a regex that matches the table as a SQL identifier (with optional quoting).
  const identPat = `["\`\\[]?\\b${safe}\\b["\`\\]]?`;
  // Write patterns: INSERT INTO <t>, UPDATE <t>, REPLACE INTO <t>, DELETE FROM <t>
  const writePat = `(INSERT\\s+INTO|UPDATE\\s+|REPLACE\\s+INTO|DELETE\\s+FROM)\\s+["\`\\[]*${safe}["\`\\]]*`;
  // Read patterns: FROM <t>, JOIN <t>
  const readPat = `(\\bFROM\\s+|\\bJOIN\\s+)["\`\\[]*${safe}["\`\\]]*`;

  const refList = rg(`-l -i --no-heading -g '*.ts' -g '*.tsx' -g '*.py' -g '*.js' -g '*.cjs' -g '*.mjs' -g '!node_modules' -g '!backups/**' -g '!*.test.*' -e '${identPat}'`);
  const refFiles = refList.split('\n').map(s => s.trim()).filter(Boolean);

  const readList = rg(`-l -i --no-heading -g '*.ts' -g '*.tsx' -g '*.py' -g '*.js' -g '*.cjs' -g '*.mjs' -g '!node_modules' -g '!backups/**' -g '!*.test.*' -e '${readPat}'`);
  const readFiles = readList.split('\n').map(s => s.trim()).filter(Boolean);

  const writeList = rg(`-l -i --no-heading -g '*.ts' -g '*.tsx' -g '*.py' -g '*.js' -g '*.cjs' -g '*.mjs' -g '!node_modules' -g '!backups/**' -g '!*.test.*' -e '${writePat}'`);
  const writeFiles = writeList.split('\n').map(s => s.trim()).filter(Boolean);

  let status;
  if (refFiles.length === 0) status = 'ORPHAN';
  else if (readFiles.length > 0 && writeFiles.length > 0) status = 'ACTIVE_READ_WRITE';
  else if (readFiles.length > 0) status = 'ACTIVE_READ_ONLY';
  else if (writeFiles.length > 0) status = 'WRITE_ONLY';
  else status = 'REFERENCED_NO_SQL'; // mentioned but not via FROM/JOIN/INSERT

  out[t] = {
    status,
    refCount: refFiles.length,
    readCount: readFiles.length,
    writeCount: writeFiles.length,
    readFiles: readFiles.slice(0, 10),
    writeFiles: writeFiles.slice(0, 10),
    refFiles: refFiles.slice(0, 5),
    locations: tableLocs.get(t),
  };
}

fs.writeFileSync(__dirname + '/_audit_usage.json', JSON.stringify(out, null, 2));
const buckets = {};
for (const t of Object.keys(out)) buckets[out[t].status] = (buckets[out[t].status] || 0) + 1;
console.log('Tables:', tables.length);
console.log('Buckets:', buckets);

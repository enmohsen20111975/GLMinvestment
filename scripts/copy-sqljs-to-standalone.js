/**
 * postbuild: Copy sql.js dist and db files to .next/standalone/
 *
 * This script runs automatically after `next build` to ensure sql.js WASM
 * runtime files are available in the standalone output directory.
 *
 * Without this, sql.js marked as serverExternalPackages won't be included
 * in the standalone trace, causing "sql.js is not yet initialized" errors
 * on Hostinger auto-deploy.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  [copy] Source not found: ${src}`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function main() {
  console.log('[postbuild] Copying sql.js and db files to standalone output...');

  if (!fs.existsSync(STANDALONE)) {
    console.error('[postbuild] ERROR: .next/standalone/ not found. Did the build succeed?');
    process.exit(1);
  }

  // 1. Copy sql.js dist (sql-wasm.js + sql-wasm.wasm + worker files)
  const sqljsDist = path.join(ROOT, 'node_modules', 'sql.js', 'dist');
  const sqljsDest = path.join(STANDALONE, 'node_modules', 'sql.js', 'dist');
  if (fs.existsSync(sqljsDist)) {
    const count = copyDirSync(sqljsDist, sqljsDest);
    console.log(`  sql.js/dist: ${count} files copied`);
  } else {
    console.warn('  sql.js/dist not found — attempting CDN download...');
    const destDir = path.join(STANDALONE, 'node_modules', 'sql.js', 'dist');
    fs.mkdirSync(destDir, { recursive: true });
    try {
      const https = require('https');
      const url = 'https://sql.js.org/dist/sql-wasm.wasm';
      const dest = path.join(destDir, 'sql-wasm.wasm');
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('  sql-wasm.wasm downloaded from CDN');
          });
        } else {
          fs.unlink(dest, () => {});
          console.error(`  CDN download failed: ${response.statusCode}`);
        }
      });
    } catch (e) {
      console.error('  CDN download error:', e.message);
    }
  }

  // 2. Copy sql.js package.json (needed for require('sql.js') resolution)
  const sqljsPkg = path.join(ROOT, 'node_modules', 'sql.js', 'package.json');
  const sqljsPkgDest = path.join(STANDALONE, 'node_modules', 'sql.js', 'package.json');
  if (fs.existsSync(sqljsPkg)) {
    fs.mkdirSync(path.join(STANDALONE, 'node_modules', 'sql.js'), { recursive: true });
    fs.copyFileSync(sqljsPkg, sqljsPkgDest);
    console.log('  sql.js/package.json copied');
  }

  // 3. Copy db directory — BUT preserve existing databases on server
  //    On Hostinger auto-deploy, the live db files must NOT be overwritten.
  //    Only copy db files if the destination doesn't already exist (first deploy).
  const dbDir = path.join(ROOT, 'db');
  const dbDest = path.join(STANDALONE, 'db');
  if (!fs.existsSync(dbDest)) {
    // First deploy: no db directory yet — copy everything
    if (fs.existsSync(dbDir)) {
      const count = copyDirSync(dbDir, dbDest);
      console.log(`  db/: ${count} files copied (first deploy)`);
    } else {
      fs.mkdirSync(dbDest, { recursive: true });
      console.log('  db/ created (empty, first deploy)');
    }
  } else {
    // Existing deploy: db/ already exists on server — preserve live data
    // Only copy files that don't exist yet (e.g. new db files added later)
    if (fs.existsSync(dbDir)) {
      const entries = fs.readdirSync(dbDir);
      let skipped = 0;
      let copied = 0;
      for (const entry of entries) {
        const srcPath = path.join(dbDir, entry);
        const destPath = path.join(dbDest, entry);
        if (fs.existsSync(destPath)) {
          skipped++;
        } else {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        }
      }
      console.log(`  db/: ${skipped} existing files preserved, ${copied} new files copied`);
    } else {
      console.log('  db/: existing directory preserved (live data safe)');
    }
  }

  // 4. Copy public directory
  const publicDir = path.join(ROOT, 'public');
  const publicDest = path.join(STANDALONE, 'public');
  if (fs.existsSync(publicDir)) {
    const count = copyDirSync(publicDir, publicDest);
    console.log(`  public/: ${count} files copied`);
  }

  // 5. Copy .next/static
  const staticDir = path.join(ROOT, '.next', 'static');
  const staticDest = path.join(STANDALONE, '.next', 'static');
  if (fs.existsSync(staticDir)) {
    const count = copyDirSync(staticDir, staticDest);
    console.log(`  .next/static/: ${count} files copied`);
  }

  // Verify critical file
  const wasmCheck = path.join(sqljsDest, 'sql-wasm.wasm');
  if (fs.existsSync(wasmCheck)) {
    const size = fs.statSync(wasmCheck).size;
    console.log(`  sql-wasm.wasm verified: ${(size / 1024).toFixed(0)}KB`);
  } else {
    console.error('  WARNING: sql-wasm.wasm NOT found in standalone output!');
    console.error('  Database operations will fail. CDN fallback will be used at runtime.');
  }

  console.log('[postbuild] Complete.');
}

main();

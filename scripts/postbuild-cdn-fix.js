/**
 * Post-build script: Patch standalone server to fix CDN caching.
 *
 * Problem: Next.js sets Cache-Control: s-maxage=31536000 (1 year) on HTML pages.
 * Hostinger's hcdn CDN caches this stale HTML. After deploying a new build,
 * the CDN still serves old HTML referencing deleted _next/static chunk hashes → 404 errors.
 *
 * Root causes in next/dist/:
 *   - lib/constants.js: CACHE_ONE_YEAR_SECONDS = 31536000
 *   - server/config-shared.js: expireTime defaults to 31536000
 *   - server/lib/cache-control.js: getCacheControlHeader() uses CACHE_ONE_YEAR_SECONDS
 *
 * Fix: Patch all occurrences to 0 so HTML pages never get cached by CDN.
 */
const fs = require('fs');
const path = require('path');

function patchFile(filePath, desc) {
  if (!fs.existsSync(filePath)) {
    console.log(`[postbuild-cdn-fix] SKIP ${desc}: file not found`);
    return false;
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // Replace 31536000 with 0 (s-maxage=0 = no CDN caching)
  content = content.replace(/31536000/g, '0');

  if (content === original) {
    console.log(`[postbuild-cdn-fix] SKIP ${desc}: no changes needed`);
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`[postbuild-cdn-fix] PATCHED ${desc}`);
  return true;
}

const standaloneDir = path.join(__dirname, '..', '.next', 'standalone');
let patched = 0;

// Patch the main Next.js source files
patched += patchFile(
  path.join(standaloneDir, 'node_modules/next/dist/lib/constants.js'),
  'CACHE_ONE_YEAR_SECONDS'
) ? 1 : 0;

patched += patchFile(
  path.join(standaloneDir, 'node_modules/next/dist/server/config-shared.js'),
  'config-shared.js expireTime'
) ? 1 : 0;

patched += patchFile(
  path.join(standaloneDir, 'node_modules/next/dist/server/lib/cache-control.js'),
  'cache-control.js'
) ? 1 : 0;

patched += patchFile(
  path.join(standaloneDir, 'node_modules/next/dist/server/render.js'),
  'render.js revalidate'
) ? 1 : 0;

patched += patchFile(
  path.join(standaloneDir, 'server.js'),
  'standalone server.js config'
) ? 1 : 0;

if (patched > 0) {
  console.log(`[postbuild-cdn-fix] Successfully patched ${patched} files`);
} else {
  console.log('[postbuild-cdn-fix] No files needed patching');
}

const path = require('path');
const fs = require('fs');

// Check which node we're running on
console.log('Node version:', process.version);
console.log('Node arch:', process.arch);
console.log('Node platform:', process.platform);
console.log('Current dir:', process.cwd());
console.log('Module search path:', module.paths.slice(0, 3));

// Check the native file
const nativeFile = path.join(process.cwd(), 'node_modules/better-sqlite3/build/Release/better_sqlite3.node');
console.log('Native file exists:', fs.existsSync(nativeFile));
console.log('Native file size:', fs.existsSync(nativeFile) ? fs.statSync(nativeFile).size : 'N/A');

// Check package.json of better-sqlite3
const pkgPath = path.join(process.cwd(), 'node_modules/better-sqlite3/package.json');
if (fs.existsSync(pkgPath)) {
    const pkg = require(pkgPath);
    console.log('better-sqlite3 version:', pkg.version);
    if (pkg.binary) {
        console.log('Binary config:', JSON.stringify(pkg.binary, null, 2));
    }
}

// Try with the package directly
try {
    const Database = require('better-sqlite3');
    console.log('better-sqlite3 load: SUCCESS');
    const testDb = new Database(':memory:');
    testDb.prepare('SELECT 1 as val').get();
    console.log('better-sqlite3 query: SUCCESS');
    testDb.close();
} catch (e) {
    console.log('better-sqlite3 load: FAILURE');
    console.log('Error message:', e.message);
    console.log('Error code:', e.code);
}
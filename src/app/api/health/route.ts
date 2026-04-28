import { NextResponse } from 'next/server';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Health check endpoint — tests sql.js initialization path without depending on it.
 * Returns diagnostic info about file paths and sql.js availability.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const cwd = process.cwd();
  const sqlJsDist = join(cwd, 'node_modules', 'sql.js', 'dist');
  const sqlJsEntryJs = join(sqlJsDist, 'sql-wasm.js');
  const sqlJsWasm = join(sqlJsDist, 'sql-wasm.wasm');
  const sqlJsPkgJson = join(cwd, 'node_modules', 'sql.js', 'package.json');
  const customDb = join(cwd, 'db', 'custom.db');
  const egxDb = join(cwd, 'db', 'egx_investment.db');

  const diagnostics: Record<string, unknown> = {
    cwd,
    timestamp: new Date().toISOString(),
    node_version: process.version,
    env_node_env: process.env.NODE_ENV || 'not set',
    files: {
      'sql.js/package.json': _fileInfo(sqlJsPkgJson),
      'sql.js/dist/sql-wasm.js': _fileInfo(sqlJsEntryJs),
      'sql.js/dist/sql-wasm.wasm': _fileInfo(sqlJsWasm),
      'db/custom.db': _fileInfo(customDb),
      'db/egx_investment.db': _fileInfo(egxDb),
    },
  };

  // List contents of sql.js/dist if it exists
  if (existsSync(sqlJsDist)) {
    try {
      diagnostics['sql.js/dist_contents'] = readdirSync(sqlJsDist);
    } catch (e) {
      diagnostics['sql.js/dist_contents'] = `Error: ${String(e)}`;
    }
  }

  // Test sql.js initialization
  let sqlJsStatus = 'not tested';
  try {
    const initSqlJs = require('sql.js');
    sqlJsStatus = 'require(sql.js) succeeded (module loaded)';
  } catch (e1) {
    try {
      const entryPath = join(sqlJsDist, 'sql-wasm.js');
      const initSqlJs = (eval('require') as (id: string) => unknown)(entryPath);
      sqlJsStatus = 'eval require(absolute) succeeded';
    } catch (e2) {
      sqlJsStatus = `FAILED: ${String(e1)} | ${String(e2)}`;
    }
  }
  diagnostics['sql.js_load_status'] = sqlJsStatus;

  const allFilesOk =
    existsSync(sqlJsEntryJs) && existsSync(sqlJsWasm) && existsSync(customDb);
  const status = allFilesOk ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, diagnostics },
    {
      status: allFilesOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    }
  );
}

function _fileInfo(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return { exists: false };
  }
  try {
    const stat = statSync(path);
    return {
      exists: true,
      size_bytes: stat.size,
      size_human: stat.size > 1048576
        ? `${(stat.size / 1048576).toFixed(1)} MB`
        : stat.size > 1024
          ? `${(stat.size / 1024).toFixed(1)} KB`
          : `${stat.size} B`,
    };
  } catch {
    return { exists: true, size: 'unknown' };
  }
}

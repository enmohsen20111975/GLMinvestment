import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { cached } from '@/lib/api-cache';

/**
 * Health check endpoint — CACHED 10s (was checking files every request)
 */
export async function GET() {
  const data = await cached('health', async () => {
    const cwd = process.cwd();
    const importantPaths = {
      stocksDb: join(cwd, 'db', 'stocks.db'),
      predictionsDb: join(cwd, 'db', 'predictions.db'),
      dataEngineDb: join(cwd, 'db', 'data_engine.db'),
    };

    const diagnostics: Record<string, unknown> = {
      cwd,
      timestamp: new Date().toISOString(),
      node_version: process.version,
      env_node_env: process.env.NODE_ENV || 'not set',
      databases: {
        'db/stocks.db': _fileInfo(importantPaths.stocksDb),
        'db/predictions.db': _fileInfo(importantPaths.predictionsDb),
        'db/data_engine.db': _fileInfo(importantPaths.dataEngineDb),
      },
    };

    const stocksExists = existsSync(importantPaths.stocksDb);
    const predictionsExists = existsSync(importantPaths.predictionsDb);
    const status = stocksExists && predictionsExists ? 'ok' : 'degraded';

    return { status, diagnostics, httpStatus: stocksExists ? 200 : 503 };
  }, 10000); // Cache for 10 seconds

  return NextResponse.json(
    { status: data.status, diagnostics: data.diagnostics },
    {
      status: data.httpStatus,
      headers: { 'Cache-Control': 'public, s-maxage=10' },
    }
  );
}

function _fileInfo(path: string): Record<string, unknown> {
  if (!existsSync(path)) return { exists: false };
  try {
    const stat = statSync(path);
    return {
      exists: true,
      size_bytes: stat.size,
      size_human: stat.size > 1048576 ? `${(stat.size / 1048576).toFixed(1)} MB` : `${(stat.size / 1024).toFixed(1)} KB`,
    };
  } catch {
    return { exists: true, size: 'unknown' };
  }
}

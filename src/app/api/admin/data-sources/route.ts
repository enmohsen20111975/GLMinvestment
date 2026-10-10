import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getVpsServiceUrl } from '@/lib/vps-adapter';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-guard';
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.existsSync/fs.statSync with
// async fs/promises equivalents so the data-sources GET handler never blocks
// the event loop on DB file checks.
import { access, stat } from 'fs/promises';
import path from 'path';

// ---------------------------------------------------------------------------
// Server-side cache for VPS health status (reduces repeated health checks)
// ---------------------------------------------------------------------------
let _cachedVpsHealth: { available: boolean; timestamp: number } | null = null;
const VPS_HEALTH_CACHE_TTL_MS = 30000; // Cache VPS health for 30 seconds

function getCachedVpsHealth(): { available: boolean } | null {
  if (!_cachedVpsHealth) return null;
  if (Date.now() - _cachedVpsHealth.timestamp > VPS_HEALTH_CACHE_TTL_MS) {
    _cachedVpsHealth = null;
    return null;
  }
  return { available: _cachedVpsHealth.available };
}

function setCachedVpsHealth(available: boolean): void {
  _cachedVpsHealth = { available, timestamp: Date.now() };
}

/**
 * GET /api/admin/data-sources
 * 
 * Returns comprehensive information about all available data sources:
 * - VPS API (egxpy-bridge Python service)
 * - Local Python (egxpy-bridge)
 * - Web Scraping (mubasher.info)
 * - Database stats
 * 
 * Requires admin authentication via X-Admin-Token header.
 */

export async function GET(request: NextRequest) {
  try {
    // Rule 55 §г fix (Task 7-B Batch 7): replaced legacy verifyAdminRequest
    // (Method 1 only: token/cookie) with requireAdminAsync (Method 1 + Method 2
    // NextAuth session + Method 3 ALLOW_ADMIN_BYPASS) for defense-in-depth.
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const dataSources: {
      vps: {
        configured: boolean;
        url: string;
        available: boolean;
        last_check: string;
        description: string;
      };
      local_python: {
        available: boolean;
        path: string;
        description: string;
        note: string;
      };
      web_scraping: {
        available: boolean;
        sources: Array<{
          name: string;
          url: string;
          type: string;
          rate_limit: string;
        }>;
      };
      database: {
        stocks_db: {
          path: string;
          exists: boolean;
          size_bytes: number;
          size_human: string;
          stocks_count: number;
          last_update: string | null;
        };
        predictions_db: {
          path: string;
          exists: boolean;
          size_bytes: number;
          size_human: string;
        };
        auth_db: {
          path: string;
          exists: boolean;
          size_bytes: number;
          size_human: string;
        };
      };
      version: string;
    } = {
      vps: {
        configured: false,
        url: '',
        available: false,
        last_check: new Date().toISOString(),
        description: 'Python FastAPI on VPS using egxpy + tvDatafeed (TradingView)',
      },
      local_python: {
        available: false,
        path: 'vps-service/',
        description: 'Python FastAPI service using egxpy + tvDatafeed (TradingView)',
        note: 'Not available on Hostinger (no Python). Works locally only.',
      },
      web_scraping: {
        available: true,
        sources: [
          {
            name: 'Mubasher.info',
            url: 'https://www.mubasher.info/eg',
            type: 'Web Scraping (page_reader)',
            rate_limit: '60 requests/hour, 3-8s delay between requests',
          },
        ],
      },
      database: {
        stocks_db: {
          path: 'db/stocks.db',
          exists: false,
          size_bytes: 0,
          size_human: '0 KB',
          stocks_count: 0,
          last_update: null,
        },
        predictions_db: {
          path: 'db/predictions.db',
          exists: false,
          size_bytes: 0,
          size_human: '0 KB',
        },
        auth_db: {
          path: 'db/auth.db',
          exists: false,
          size_bytes: 0,
          size_human: '0 KB',
        },
      },
      version: '3.4.26',
    };

    // Check VPS configuration
    const vpsUrl = getVpsServiceUrl();
    dataSources.vps.configured = !!vpsUrl;
    dataSources.vps.url = vpsUrl ? vpsUrl.replace(/\/api.*$/, '') : '';

    // Check VPS availability (with caching to reduce requests)
    if (vpsUrl) {
      // Check cache first
      const cached = getCachedVpsHealth();
      if (cached) {
        dataSources.vps.available = cached.available;
      } else {
        // Only fetch if not cached - with increased timeout
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(`${vpsUrl}/health`, { 
            signal: controller.signal,
            cache: 'no-store'
          });
          clearTimeout(timeoutId);
          dataSources.vps.available = response.ok;
          setCachedVpsHealth(response.ok);
        } catch { // silent fallback (safe-by-design)
          dataSources.vps.available = false;
          setCachedVpsHealth(false);
        }
      }
    }

    // Check local Python availability
    const dbPath = process.cwd();
    const egxpyBridgePath = path.join(dbPath, 'vps-service', 'main.py');
    // P0-14-ASYNC fix (2026-09-27): existsSync → access.
    let egxpyBridgeExists = false;
    try { await access(egxpyBridgePath); egxpyBridgeExists = true; } catch { /* safe-by-design */ egxpyBridgeExists = false; }
    dataSources.local_python.available = egxpyBridgeExists;

    // Stocks DB (formerly light_db/custom.db)
    const stocksDbPath = path.join(dbPath, 'db', 'stocks.db');
    try {
      await access(stocksDbPath);
      const stats = await stat(stocksDbPath);
      dataSources.database.stocks_db.exists = true;
      dataSources.database.stocks_db.size_bytes = stats.size;
      dataSources.database.stocks_db.size_human = formatBytes(stats.size);

      // Get stocks count
      try {
        await ensureInitialized();
        const db = getLightDb();
        const countRow = db.prepare('SELECT COUNT(*) as count FROM stocks WHERE is_active = 1').get() as { count: number };
        const lastUpdateRow = db.prepare('SELECT MAX(last_update) as last_update FROM stocks').get() as { last_update: string | null };
        dataSources.database.stocks_db.stocks_count = countRow?.count || 0;
        dataSources.database.stocks_db.last_update = lastUpdateRow?.last_update || null;
      } catch { // silent fallback (safe-by-design)
        // Ignore DB errors
      }
    } catch { // silent fallback (safe-by-design)
      // stocks.db not present — leave defaults
    }

    // Predictions DB
    const predictionsDbPath = path.join(dbPath, 'db', 'predictions.db');
    try {
      await access(predictionsDbPath);
      const stats = await stat(predictionsDbPath);
      dataSources.database.predictions_db.exists = true;
      dataSources.database.predictions_db.size_bytes = stats.size;
      dataSources.database.predictions_db.size_human = formatBytes(stats.size);
    } catch { // silent fallback (safe-by-design)
      // predictions.db not present — leave defaults
    }

    // Auth DB
    const authDbPath = path.join(dbPath, 'db', 'auth.db');
    try {
      await access(authDbPath);
      const stats = await stat(authDbPath);
      dataSources.database.auth_db.exists = true;
      dataSources.database.auth_db.size_bytes = stats.size;
      dataSources.database.auth_db.size_human = formatBytes(stats.size);
    } catch { // silent fallback (safe-by-design)
      // auth.db not present — leave defaults
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      data_sources: dataSources,
    });
  } catch (error) {
    console.error('[GET /api/admin/data-sources] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get data sources info', detail: String(error) },
      { status: 500 }
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

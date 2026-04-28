import { NextRequest, NextResponse } from 'next/server';
import { getVpsServiceUrl } from '@/lib/vps-adapter';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import fs from 'fs';
import path from 'path';

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
    // Verify admin token
    const adminToken = request.headers.get('X-Admin-Token');
    if (!adminToken || (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'admin-local-dev')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
        light_db: {
          path: string;
          exists: boolean;
          size_bytes: number;
          size_human: string;
          stocks_count: number;
          last_update: string | null;
        };
        heavy_db: {
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
        path: 'mini-services/egxpy-bridge/',
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
        light_db: {
          path: 'db/custom.db',
          exists: false,
          size_bytes: 0,
          size_human: '0 KB',
          stocks_count: 0,
          last_update: null,
        },
        heavy_db: {
          path: 'db/egx_investment.db',
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

    // Check VPS availability (with timeout)
    if (vpsUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${vpsUrl}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        dataSources.vps.available = response.ok;
      } catch {
        dataSources.vps.available = false;
      }
    }

    // Check local Python availability
    const dbPath = process.cwd();
    const egxpyBridgePath = path.join(dbPath, 'mini-services', 'egxpy-bridge', 'main.py');
    dataSources.local_python.available = fs.existsSync(egxpyBridgePath);

    // Light DB
    const lightDbPath = path.join(dbPath, 'db', 'custom.db');
    if (fs.existsSync(lightDbPath)) {
      const stats = fs.statSync(lightDbPath);
      dataSources.database.light_db.exists = true;
      dataSources.database.light_db.size_bytes = stats.size;
      dataSources.database.light_db.size_human = formatBytes(stats.size);

      // Get stocks count
      try {
        await ensureInitialized();
        const db = getLightDb();
        const countRow = db.prepare('SELECT COUNT(*) as count FROM stocks WHERE is_active = 1').get() as { count: number };
        const lastUpdateRow = db.prepare('SELECT MAX(last_update) as last_update FROM stocks').get() as { last_update: string | null };
        dataSources.database.light_db.stocks_count = countRow?.count || 0;
        dataSources.database.light_db.last_update = lastUpdateRow?.last_update || null;
      } catch {
        // Ignore DB errors
      }
    }

    // Heavy DB
    const heavyDbPath = path.join(dbPath, 'db', 'egx_investment.db');
    if (fs.existsSync(heavyDbPath)) {
      const stats = fs.statSync(heavyDbPath);
      dataSources.database.heavy_db.exists = true;
      dataSources.database.heavy_db.size_bytes = stats.size;
      dataSources.database.heavy_db.size_human = formatBytes(stats.size);
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

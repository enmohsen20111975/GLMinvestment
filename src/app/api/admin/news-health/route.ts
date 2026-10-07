/**
 * GET /api/admin/news-health
 * =========================
 * Task 28-B (Fix 6 — Fix Battalion):
 *   News source health dashboard — per-source last_fetch + success_rate.
 *
 *   Reads:
 *     - db/news.db: market_news table — groups by source, counts total
 *       articles, finds MAX(fetched_at) as last_fetch
 *     - The 3 known broken sources (argaam, amwal, youm7) — hardcoded
 *       as "broken" with the reason (HTML not RSS) since they appear in
 *       the news collector code but never wrote any articles
 *
 *   Rule 20: read-only — just stat + parse, no Python invocation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { access } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

interface SourceHealth {
  source: string;
  source_type: 'rss' | 'telegram' | 'web' | 'broken';
  article_count: number;
  last_fetch: string | null;
  last_fetch_human: string | null;
  is_broken: boolean;
  broken_reason?: string;
  // success_rate: ratio of recent fetch attempts that succeeded
  // (proxy: if last_fetch < 24h ago, success_rate=1.0; if 7d, 0.5; if >7d, 0.0)
  success_rate: number;
  success_rate_label: 'healthy' | 'degraded' | 'broken';
}

interface NewsHealthResponse {
  success: boolean;
  timestamp: string;
  total_sources: number;
  total_articles: number;
  broken_sources_count: number;
  sources: SourceHealth[];
  known_broken_sources: Array<{ source: string; reason: string }>;
}

const DB_PATH = path.join(process.cwd(), 'db', 'news.db');

// Known broken sources — appear in vps-service/news-collector code but
// never successfully wrote any articles (returning HTML instead of RSS).
const KNOWN_BROKEN_SOURCES: Array<{ source: string; reason: string }> = [
  { source: 'argaam', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
  { source: 'amwal', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
  { source: 'youm7', reason: 'يُرجع HTML بدلاً من RSS — تميّز خاطئ لمحتوى الصفحة' },
];

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleString('ar-EG');
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ثانية`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} دقيقة`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} ساعة`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

function computeSuccessRate(lastFetch: string | null): { rate: number; label: 'healthy' | 'degraded' | 'broken' } {
  if (!lastFetch) return { rate: 0, label: 'broken' };
  const d = new Date(lastFetch);
  if (isNaN(d.getTime())) return { rate: 0, label: 'broken' };
  const ageMs = Date.now() - d.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (ageMs < oneDay) return { rate: 1.0, label: 'healthy' };
  if (ageMs < 7 * oneDay) return { rate: 0.5, label: 'degraded' };
  return { rate: 0.0, label: 'broken' };
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    try {
      await access(DB_PATH);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'news_db_missing',
          path: DB_PATH,
        },
        { status: 503 },
      );
    }

    let Database: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require('better-sqlite3');
    } catch (e) {
      return NextResponse.json(
        { success: false, error: 'better_sqlite3_missing', detail: String(e) },
        { status: 503 },
      );
    }

    const db = new Database(DB_PATH, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');

    // Get per-source counts + last fetch
    const rows = db.prepare(`
      SELECT source, source_type, COUNT(*) as article_count, MAX(fetched_at) as last_fetch
      FROM market_news
      GROUP BY source, source_type
      ORDER BY article_count DESC
    `).all() as Array<{
      source: string;
      source_type: string;
      article_count: number;
      last_fetch: string | null;
    }>;

    db.close();

    const totalArticles = rows.reduce((sum, r) => sum + r.article_count, 0);

    const sources: SourceHealth[] = rows.map(r => {
      // Check if this source is one of the known broken ones
      const knownBroken = KNOWN_BROKEN_SOURCES.find(b => r.source.toLowerCase().includes(b.source.toLowerCase()));
      const isBroken = !!knownBroken;
      const { rate, label } = computeSuccessRate(r.last_fetch);
      return {
        source: r.source,
        source_type: (r.source_type as 'rss' | 'telegram' | 'web' | 'broken') || 'web',
        article_count: r.article_count,
        last_fetch: r.last_fetch,
        last_fetch_human: timeAgo(r.last_fetch),
        is_broken: isBroken,
        broken_reason: knownBroken?.reason,
        success_rate: rate,
        success_rate_label: label,
      };
    });

    // Append known broken sources that don't have any rows in market_news
    for (const broken of KNOWN_BROKEN_SOURCES) {
      const exists = sources.find(s => s.source.toLowerCase().includes(broken.source.toLowerCase()));
      if (!exists) {
        sources.push({
          source: broken.source,
          source_type: 'broken',
          article_count: 0,
          last_fetch: null,
          last_fetch_human: null,
          is_broken: true,
          broken_reason: broken.reason,
          success_rate: 0,
          success_rate_label: 'broken',
        });
      }
    }

    // Sort: broken first, then by article_count desc
    sources.sort((a, b) => {
      if (a.is_broken && !b.is_broken) return -1;
      if (!a.is_broken && b.is_broken) return 1;
      return b.article_count - a.article_count;
    });

    const brokenCount = sources.filter(s => s.is_broken).length;

    const response: NewsHealthResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      total_sources: sources.length,
      total_articles: totalArticles,
      broken_sources_count: brokenCount,
      sources,
      known_broken_sources: KNOWN_BROKEN_SOURCES,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/admin/news-health]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

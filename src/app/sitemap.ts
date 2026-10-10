import { MetadataRoute } from 'next';
import path from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://invist.m2y.net';

const MARKET_SEO_CONFIG: Record<string, { priority: number; changefreq: MetadataRoute.Sitemap[number]['changeFrequency'] }> = {
  EGX: { priority: 0.9, changefreq: 'daily' },
  TADAWUL: { priority: 0.7, changefreq: 'daily' },
  KSE: { priority: 0.6, changefreq: 'weekly' },
  QSE: { priority: 0.6, changefreq: 'weekly' },
  US: { priority: 0.5, changefreq: 'weekly' },
  CRYPTO: { priority: 0.8, changefreq: 'hourly' },
  GOLD: { priority: 0.8, changefreq: 'hourly' },
};

const DEFAULT_SEO = { priority: 0.5, changefreq: 'weekly' as const };

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  const now = new Date();
  const staticRoutes: Array<{ path: string; priority: number; changefreq: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '/', priority: 1.0, changefreq: 'daily' },
    { path: '/?view=dashboard', priority: 0.9, changefreq: 'daily' },
    { path: '/?view=radar', priority: 0.9, changefreq: 'hourly' },
    { path: '/?view=predictions', priority: 0.8, changefreq: 'daily' },
    { path: '/?view=portfolio', priority: 0.7, changefreq: 'daily' },
    { path: '/?view=watchlist', priority: 0.7, changefreq: 'daily' },
    { path: '/?view=news', priority: 0.8, changefreq: 'hourly' },
    { path: '/?view=education', priority: 0.6, changefreq: 'weekly' },
    { path: '/?view=multi-market', priority: 0.7, changefreq: 'daily' },
    { path: '/?view=crypto', priority: 0.7, changefreq: 'hourly' },
    { path: '/?view=gold', priority: 0.7, changefreq: 'hourly' },
    { path: '/admin', priority: 0.3, changefreq: 'monthly' },
    { path: '/legal/terms', priority: 0.3, changefreq: 'yearly' },
    { path: '/legal/privacy', priority: 0.3, changefreq: 'yearly' },
    { path: '/legal/disclaimer', priority: 0.4, changefreq: 'yearly' },
  ];

  for (const route of staticRoutes) {
    entries.push({
      url: `${SITE_URL}${route.path}`,
      lastModified: now,
      changeFrequency: route.changefreq,
      priority: route.priority,
    });
  }

  // Skip native DB load during static generation build phase to avoid worker segfaults
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return entries;
  }

  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (existsSync(stocksDbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(stocksDbPath, { readonly: true });
      const stocks = db.prepare(
        'SELECT ticker, market, name_ar FROM stocks WHERE is_active = 1 ORDER BY market, ticker'
      ).all() as Array<{ ticker: string; market: string; name_ar: string | null }>;
      db.close();

      for (const stock of stocks) {
        const seo = MARKET_SEO_CONFIG[stock.market] ?? DEFAULT_SEO;
        entries.push({
          url: `${SITE_URL}/?ticker=${encodeURIComponent(stock.ticker)}`,
          lastModified: now,
          changeFrequency: seo.changefreq,
          priority: seo.priority,
        });
      }
    } catch (err) {
      console.error('[sitemap] failed to read stocks.db:', err);
    }
  }

  return entries;
}

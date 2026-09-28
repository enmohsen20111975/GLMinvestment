import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'auth_required' }, { status: 401 });

    // Build simple profile from portfolio + watchlist
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    let preferredSectors: any[] = [];
    let preferredMarkets: any[] = [{ market: 'EGX', count: 1 }];

    try {
      const db = new Database(stocksDbPath, { readonly: true });
      const holdings = db.prepare("SELECT s.sector FROM portfolio_assets pa JOIN stocks s ON pa.ticker = s.ticker WHERE pa.user_id = ?").all(userId) as any[];
      if (holdings.length > 0) {
        const sectorCount: Record<string, number> = {};
        holdings.forEach(h => { if (h.sector) sectorCount[h.sector] = (sectorCount[h.sector] || 0) + 1; });
        preferredSectors = Object.entries(sectorCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([sector, count]) => ({ sector, count }));
      }
      db.close();
    } catch {}

    // Read radar cache for picks
    const radarFile = path.join(process.cwd(), 'scripts', 'output');
    let personalizedPicks: any[] = [];
    try {
      if (existsSync(radarFile)) {
        const { readdirSync } = require('fs');
        const files = readdirSync(radarFile).filter((f: string) => f.startsWith('maker_radar_') && f.endsWith('.json')).sort().reverse();
        if (files.length > 0) {
          const cache = JSON.parse(readFileSync(path.join(radarFile, files[0]), 'utf-8'));
          const allPicks = [...(cache.quiet_list || []), ...(cache.pre_surge_list || []), ...(cache.explosive_list || [])];
          personalizedPicks = allPicks.slice(0, 5).map((p: any) => ({
            ticker: p.ticker,
            path: p.path,
            current_price: p.current_price,
            personalization_reason: preferredSectors.length > 0 ? 'يطابق قطاعاتك المفضلة' : 'فرصة من الرادار',
          }));
        }
      }
    } catch {}

    return NextResponse.json({
      success: true,
      profile: {
        userId,
        preferredSectors,
        preferredMarkets,
        riskProfile: 'balanced',
        averageHoldingDays: 0,
        totalTrades: 0,
        winRate: 0,
      },
      personalized_picks: personalizedPicks,
      excluded: [],
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

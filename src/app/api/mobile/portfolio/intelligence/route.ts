/**
 * GET /api/mobile/portfolio/intelligence
 * ========================================
 * Portfolio intelligence summary for the Flutter Android app.
 *
 * Mirrors the shape consumed by PortfolioIntelligencePanel.tsx (at
 * src/modules/portfolio/components/PortfolioIntelligencePanel.tsx). Returns:
 *   - diversification_score (0-100): based on sector spread + count
 *   - risk_score (0-100): based on PnL variance + loss concentration
 *   - suggestions: [{ priority, title, reason }]
 *   - summary: total_value, total_cost, total_pnl, total_pnl_pct
 *   - holdings breakdown (top 10 by value)
 *
 * Reads the user's portfolio from `db/auth.db` ? PortfolioItem (via Prisma)
 * and enriches with current_price from stocks.db.
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';
import { getUserIdsWithLegacy, buildUserIdClause } from '@/lib/auth-helper';
import type { Prisma } from '@prisma/client';

interface EnrichedHolding {
  ticker: string;
  name: string;
  asset_type: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  total_value: number;
  total_cost: number;
  pnl: number;
  pnl_pct: number;
  sector: string;
  currency: string;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function openRo(p: string): import('better-sqlite3').Database | null {
  try {
    if (!fs.existsSync(p)) return null;
    const Database = require('better-sqlite3');
    return new Database(p, { readonly: true });
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function fetchStockMeta(
  sdb: import('better-sqlite3').Database | null,
  ticker: string
): { current_price: number; sector: string; name_ar: string } {
  if (!sdb) return { current_price: 0, sector: '', name_ar: '' };
  try {
    const row = sdb
      .prepare(
        'SELECT current_price, previous_close, sector, name_ar, name FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
      )
      .get(ticker) as
      | { current_price: number; previous_close: number; sector: string; name_ar: string; name: string }
      | undefined;
    if (!row) return { current_price: 0, sector: '', name_ar: '' };
    return {
      current_price:
        num(row.current_price, 0) > 0
          ? num(row.current_price, 0)
          : num(row.previous_close, 0),
      sector: row.sector || '',
      name_ar: row.name_ar || row.name || '',
    };
  } catch { // silent fallback (safe-by-design)
    return { current_price: 0, sector: '', name_ar: '' };
  }
}

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: '????? ????? ??????',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { userIds } = await getUserIdsWithLegacy();
    if (userIds.length === 0) return unauthorized();

    // 1. Pull portfolio items from auth.db (Prisma).
    // FIX (FLUTTER-PROD-4): wrap Prisma call in try/catch to give a clearer
    // error message if the DB schema is out of sync (e.g. updated_at missing).
    let items: Awaited<ReturnType<typeof db.portfolioItem.findMany>>;
    try {
      items = await db.portfolioItem.findMany({
        where: { user_id: { in: userIds } },
        orderBy: { created_at: 'desc' },
      });
    } catch (dbErr) {
      console.error('[mobile/portfolio/intelligence] Prisma error:', dbErr);
      return NextResponse.json(
        {
          success: false,
          error: '???? ?????? ?????? ?????? ???????. ???? ???????? ??? ????.',
          error_en: 'Portfolio database unavailable',
          details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        },
        { status: 503 }
      );
    }

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        source: 'auth.db',
        generated_at: new Date().toISOString(),
        diversification_score: 0,
        risk_score: 0,
        suggestions: [
          {
            priority: 'high',
            title: '???? ?????? ??? ??? ???????',
            reason:
              '?????? ????? ??????. ???? ?????? ??? ?? ??? ?? ????? ?????.',
          },
        ],
        summary: {
          total_value: 0,
          total_cost: 0,
          total_pnl: 0,
          total_pnl_pct: 0,
          items_count: 0,
        },
        holdings: [],
      });
    }

    // 2. Enrich with current_price + sector from stocks.db.
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const sdb = openRo(stocksDbPath);

    const holdings: EnrichedHolding[] = items.map((it: Prisma.PortfolioItemGetPayload<{ include: never }>) => {
      const ticker = (it.symbol || '').toUpperCase();
      const meta = it.asset_type === 'stock' && ticker
        ? fetchStockMeta(sdb, ticker)
        : { current_price: num(it.current_price, 0), sector: '', name_ar: '' };
      const currentPrice =
        meta.current_price > 0 ? meta.current_price : num(it.purchase_price, 0);
      const qty = num(it.shares, 0);
      const avgBuy = num(it.purchase_price, 0);
      const totalValue = currentPrice * qty;
      const totalCost = avgBuy * qty;
      const pnl = totalValue - totalCost;
      const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
      return {
        ticker: ticker || it.name || 'CUSTOM',
        name: it.name || meta.name_ar || ticker || 'CUSTOM',
        asset_type: it.asset_type,
        quantity: qty,
        avg_buy_price: round2(avgBuy),
        current_price: round2(currentPrice),
        total_value: round2(totalValue),
        total_cost: round2(totalCost),
        pnl: round2(pnl),
        pnl_pct: round2(pnlPct),
        sector: meta.sector || (it.asset_type === 'gold' ? 'METALS' : 'CUSTOM'),
        currency: it.currency || 'EGP',
      };
    });

    try {
      sdb?.close();
    } catch { // silent fallback (safe-by-design)
      /* ignore */
    }

    // 3. Compute diversification score (sector spread + asset spread).
    const sectors = new Set<string>();
    const assetTypes = new Set<string>();
    for (const h of holdings) {
      sectors.add(h.sector || 'OTHER');
      assetTypes.add(h.asset_type);
    }
    const sectorScore = Math.min(100, sectors.size * 15); // 7+ sectors ? 100
    const assetScore = Math.min(40, assetTypes.size * 12); // 4+ types ? 48 capped
    const holdingCountScore = Math.min(30, holdings.length * 5); // 6+ ? 30
    const diversificationScore = Math.min(
      100,
      Math.round(sectorScore * 0.5 + assetScore * 0.3 + holdingCountScore * 0.2)
    );

    // 4. Compute risk score (loss concentration + pnl variance).
    const losers = holdings.filter((h) => h.pnl_pct < 0);
    const lossConcentration =
      holdings.length > 0 ? losers.length / holdings.length : 0; // 0..1
    const avgLoss =
      losers.length > 0
        ? losers.reduce((s, h) => s + Math.abs(h.pnl_pct), 0) / losers.length
        : 0;
    const maxLoss = losers.reduce(
      (m, h) => Math.max(m, Math.abs(h.pnl_pct)),
      0
    );
    // Risk: 0 (safe) ? 100 (very risky).
    const riskScore = Math.min(
      100,
      Math.round(lossConcentration * 40 + Math.min(40, avgLoss) + Math.min(20, maxLoss / 2))
    );

    // 5. Total PnL summary.
    const totalValue = holdings.reduce((s, h) => s + h.total_value, 0);
    const totalCost = holdings.reduce((s, h) => s + h.total_cost, 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // 6. Generate suggestions.
    const suggestions: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      reason: string;
    }> = [];

    if (diversificationScore < 40) {
      suggestions.push({
        priority: 'high',
        title: '???? ??????',
        reason: `?????? ???? (${diversificationScore}/100). ????? ?? ${sectors.size} ????/?????? ??? ???? ??? 3-5 ?????? ??????.`,
      });
    } else if (diversificationScore < 70) {
      suggestions.push({
        priority: 'medium',
        title: '???? ???????',
        reason: `?????? ????? (${diversificationScore}/100). ???? ?? ????? ???? ?? ???? ????.`,
      });
    }

    if (riskScore > 60) {
      suggestions.push({
        priority: 'high',
        title: '???? ????? ????????',
        reason: `???? ???????? ????? (${riskScore}/100). ${losers.length} ?? ${holdings.length} ???? ????? ?????? ??????? ${avgLoss.toFixed(1)}%. ???? ?? ????? ????? ??? ?????.`,
      });
    } else if (riskScore > 40) {
      suggestions.push({
        priority: 'medium',
        title: '???? ??????? ???????',
        reason: `???? ???????? ?????? (${riskScore}/100). ???? ${losers.length} ???? ???? — ???? ??? ???????.`,
      });
    }

    if (totalPnlPct < -10) {
      suggestions.push({
        priority: 'high',
        title: '???? ?????????? ??????',
        reason: `?????? ?????? ${Math.abs(totalPnlPct).toFixed(1)}% ??????. ???? ?????????? ?????? ???? ??????? ??? ?? ???? ?????.`,
      });
    } else if (totalPnlPct > 20) {
      suggestions.push({
        priority: 'low',
        title: '???? ?? ????? ??? ?? ???????',
        reason: `?????? ????? ${totalPnlPct.toFixed(1)}% — partial take-profit ??? ??????? ??????? ?? 50%+ ????? ????????.`,
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        priority: 'low',
        title: '?????? ???????',
        reason: `??????? ${diversificationScore}/100 ????????? ${riskScore}/100 — ??? ???. ???? ???????? ???????.`,
      });
    }

    // Top 10 holdings by value.
    const topHoldings = [...holdings]
      .sort((a, b) => b.total_value - a.total_value)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      source: 'auth.db+stocks.db',
      generated_at: new Date().toISOString(),
      diversification_score: diversificationScore,
      risk_score: riskScore,
      suggestions,
      summary: {
        total_value: round2(totalValue),
        total_cost: round2(totalCost),
        total_pnl: round2(totalPnl),
        total_pnl_pct: round2(totalPnlPct),
        items_count: holdings.length,
        sectors_count: sectors.size,
        asset_types_count: assetTypes.size,
        losers_count: losers.length,
        winners_count: holdings.filter((h) => h.pnl_pct > 0).length,
      },
      holdings: topHoldings,
    });
  } catch (err) {
    console.error('[mobile/portfolio/intelligence] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

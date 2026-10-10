/**
 * GET /api/portfolio/risk-summary
 * =================================
 * MONEY-TIER2.3: REAL sector exposure + portfolio heat.
 *
 * BEFORE: proxied to Python + hardcoded mock sectors (42/25/18/15%).
 *
 * AFTER:  reads REAL portfolio_assets, groups by sector (joined with
 *         stocks.sector), computes concentration %, produces risk verdict.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { /* safe-by-design */ return false; }
}

async function tryPythonRiskSummary(userId: string | undefined): Promise<any | null> {
  const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
  try {
    const url = userId
      ? `${PY}/api/portfolio/risk-summary?user_id=${encodeURIComponent(userId)}`
      : `${PY}/api/portfolio/risk-summary`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data.sector_exposure && Array.isArray(data.sector_exposure) && data.sector_exposure.length > 0) {
        return data;
      }
    }
    return null;
  } catch { /* safe-by-design */ return null; }
}

const SECTOR_LABELS_AR: Record<string, string> = {
  banking: 'بنوك وخدمات مالية',
  real_estate: 'عقارات ومقاولات',
  steel: 'حديد وصلب',
  energy: 'طاقة',
  pharma: 'أدوية',
  chemicals: 'كيماويات',
  telecom: 'اتصالات وتكنولوجيا',
  financial: 'خدمات مالية',
  industrial: 'صناعة',
  consumer: 'استهلاكي',
  agriculture: 'زراعة',
  tourism: 'سياحة وترفيه',
  gold: 'ذهب',
  crypto: 'كريبتو',
  bank: 'بنوك وودائع',
  certificate: 'شهادات إدخار',
  cash: 'سيولة نقدية',
  other: 'أخرى',
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    let userId = url.searchParams.get('user_id');
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore - safe-by-design */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 1) Try Python first (optional)
    const py = await tryPythonRiskSummary(userId);
    if (py) return NextResponse.json(py);

    // 2) REAL FALLBACK — read from portfolio_assets
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!dbExists(stocksDbPath)) {
      return NextResponse.json({
        success: true,
        portfolio_heat: 0,
        heat_level: 'safe',
        sector_exposure: [],
        warning: null,
        source: 'sqlite_fallback',
        error: 'stocks.db not found',
      });
    }

    const db = await getFinanceDb();

    const assets = db.prepare(
      "SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY id DESC"
    ).all(userId) as any[];

    if (assets.length === 0) {
      return NextResponse.json({
        success: true,
        portfolio_heat: 0,
        heat_level: 'safe',
        sector_exposure: [],
        warning: null,
        message: 'لا توجد أصول في المحفظة بعد.',
        source: 'sqlite_fallback',
      });
    }

    let goldPrices: { '24k': number; '21k': number; '18k': number } = { '24k': 4200, '21k': 3675, '18k': 3150 };
    try {
      const live = getLiveEgyptGoldPrices();
      if (live) {
        goldPrices = {
          '24k': live['24k'] || goldPrices['24k'],
          '21k': live['21k'] || goldPrices['21k'],
          '18k': live['18k'] || goldPrices['18k'],
        };
      }
    } catch { /* ignore - safe-by-design */ }

    const sectorTotals: Record<string, { total: number; invested: number; assets: number }> = {};
    let grandTotal = 0;

    for (const asset of assets) {
      const type = String(asset.type || 'other').toLowerCase();
      let current = Number(asset.current_value || 0);
      const invested = Number(asset.total_invested || 0);
      let sector = asset.sector || '';

      if (type === 'stock' && asset.stock_ticker) {
        try {
          const stockRow = db.prepare(
            "SELECT sector, current_price, previous_close, name, name_ar FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1"
          ).get(asset.stock_ticker) as any;
          if (stockRow) {
            sector = stockRow.sector || 'other';
            let livePrice = 0;
            if (Number(stockRow.current_price) > 0) livePrice = Number(stockRow.current_price);
            else if (Number(stockRow.previous_close) > 0) livePrice = Number(stockRow.previous_close);
            if (livePrice <= 0) {
              try {
                const { getLastCleanClose } = await import('@/lib/data-engine-db-sqljs');
                const clean = await getLastCleanClose(asset.stock_ticker);
                if (clean.price > 0) livePrice = clean.price;
              } catch { /* ignore - safe-by-design */ }
            }
            const qty = Number(asset.quantity || 0);
            if (livePrice > 0 && qty > 0) current = livePrice * qty;
          }
        } catch { /* ignore - safe-by-design */ }
        if (!sector) sector = 'stocks_other';
      } else if (type === 'gold' || type === 'silver') {
        const weightGrams = Number(asset.weight_grams || 0);
        const karat = Number(asset.karat || 24);
        const pricePerGram = karat === 24 ? goldPrices['24k'] : karat === 21 ? goldPrices['21k'] : karat === 18 ? goldPrices['18k'] : goldPrices['24k'];
        if (weightGrams > 0 && pricePerGram > 0) current = pricePerGram * weightGrams;
        sector = 'gold';
      } else if (type === 'crypto') {
        sector = 'crypto';
      } else if (['bank', 'certificate', 'fund', 'deposit', 'bond', 'savings_account'].includes(type)) {
        sector = 'bank';
        if (current <= 0 || Math.abs(current - invested) < 0.01) current = invested;
      } else {
        sector = sector || 'other';
        if (current <= 0 && invested > 0) current = invested;
      }

      if (current <= 0 && invested > 0) current = invested;

      if (!sectorTotals[sector]) {
        sectorTotals[sector] = { total: 0, invested: 0, assets: 0 };
      }
      sectorTotals[sector].total += current;
      sectorTotals[sector].invested += invested;
      sectorTotals[sector].assets += 1;
      grandTotal += current;
    }

    const sectorExposure = Object.entries(sectorTotals)
      .map(([sector, data]) => ({
        sector,
        sector_ar: SECTOR_LABELS_AR[sector] || sector,
        total_value: Math.round(data.total * 100) / 100,
        invested_amount: Math.round(data.invested * 100) / 100,
        percentage: grandTotal > 0 ? Math.round((data.total / grandTotal) * 1000) / 10 : 0,
        assets_count: data.assets,
      }))
      .sort((a, b) => b.total_value - a.total_value);

    let maxConcentration = 0;
    let maxConcentrationSector = '';
    for (const s of sectorExposure) {
      if (s.percentage > maxConcentration) {
        maxConcentration = s.percentage;
        maxConcentrationSector = s.sector_ar || s.sector;
      }
    }

    const totalInvested = sectorExposure.reduce((sum, s) => sum + s.invested_amount, 0);
    const totalCurrent = sectorExposure.reduce((sum, s) => sum + s.total_value, 0);
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    const drawdownRisk = Math.min(100, Math.abs(Math.min(0, totalPnlPct)) * 2);
    const concentrationRisk = Math.min(100, Math.max(0, maxConcentration - 25) * 2);
    const portfolioHeat = Math.round(Math.min(100, (drawdownRisk + concentrationRisk) / 2) * 10) / 10;

    let heatLevel = 'safe';
    if (portfolioHeat >= 70) heatLevel = 'critical';
    else if (portfolioHeat >= 50) heatLevel = 'high';
    else if (portfolioHeat >= 30) heatLevel = 'moderate';

    let warning: string | null = null;
    if (maxConcentration >= 40) {
      warning = `⚠️ تركيز عالي في قطاع ${maxConcentrationSector} (${maxConcentration.toFixed(1)}%) — فكّر في تنويع المحفظة لتقليل المخاطرة.`;
    } else if (totalPnlPct <= -10) {
      warning = `🚨 المحفظة خسرانة ${Math.abs(totalPnlPct).toFixed(1)}% — راجع الأسهم الفردية وحدّد الخاسر الأكبر.`;
    } else if (portfolioHeat >= 50) {
      warning = `⚠️ حرارة المحفظة مرتفعة (${portfolioHeat}/100) — راجع توزيع المخاطر.`;
    }

    return NextResponse.json({
      success: true,
      portfolio_heat: portfolioHeat,
      heat_level: heatLevel,
      sector_exposure: sectorExposure,
      total_invested: Math.round(totalInvested * 100) / 100,
      total_current_value: Math.round(totalCurrent * 100) / 100,
      total_pnl: Math.round(totalPnl * 100) / 100,
      total_pnl_pct: Math.round(totalPnlPct * 100) / 100,
      max_concentration: {
        sector: maxConcentrationSector,
        percentage: maxConcentration,
      },
      assets_count: assets.length,
      warning,
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/portfolio/risk-summary] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        portfolio_heat: 0,
        heat_level: 'safe',
        sector_exposure: [],
      },
      { status: 500 }
    );
  }
}

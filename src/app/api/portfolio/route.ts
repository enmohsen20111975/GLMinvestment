import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Portfolio API
 *
 * GET  /api/portfolio - Get all positions for user
 * POST /api/portfolio - Add new position
 */

const ADMIN_EMAILS = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];

/**
 * Get the user ID from the session.
 * Returns null if not authenticated.
 */
async function getSessionUserId(): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin = ADMIN_EMAILS.includes(session.user.email);
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    return { userId, isAdmin };
  } catch {
    return { userId: null, isAdmin: false };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();

    // Unauthenticated users get empty portfolio
    if (!userId) {
      return NextResponse.json({ success: true, items: [], summary: null });
    }

    // Ensure DB is initialized
    await ensureInitialized();

    // Get positions from Prisma
    const positions = await prisma.portfolioPosition.findMany({
      where: {
        user_id: userId,
        is_active: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Get current prices from light DB
    const db = getLightDb();
    const symbols = positions.map(p => p.stock_symbol);

    let stocksData: Record<string, { current_price: number; name: string; sector: string }> = {};

    if (symbols.length > 0) {
      const placeholders = symbols.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT ticker, current_price, name, sector
        FROM stocks
        WHERE ticker IN (${placeholders})
      `).all(...symbols) as { ticker: string; current_price: number; name: string; sector: string }[];

      for (const row of rows) {
        stocksData[row.ticker] = {
          current_price: row.current_price || 0,
          name: row.name || row.ticker,
          sector: row.sector || 'غير محدد',
        };
      }
    }

    // Enrich positions with current data
    const enrichedPositions = positions.map(position => {
      const stockData = stocksData[position.stock_symbol] || {};
      const currentPrice = position.current_price || stockData.current_price || 0;
      const shares = position.shares;
      const avgCost = position.avg_cost;
      const costBasis = shares * avgCost;
      const marketValue = shares * currentPrice;
      const unrealizedPnl = marketValue - costBasis;
      const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

      return {
        ...position,
        current_price: currentPrice,
        stock_name: stockData.name || position.stock_symbol,
        sector: stockData.sector || 'غير محدد',
        market_value: marketValue,
        cost_basis: costBasis,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_percent: unrealizedPnlPercent,
        // Determine status
        status: getStatus(unrealizedPnlPercent),
        status_ar: getStatusAr(unrealizedPnlPercent),
      };
    });

    // Calculate portfolio summary
    const totalCostBasis = enrichedPositions.reduce((sum, p) => sum + (p.cost_basis || 0), 0);
    const totalMarketValue = enrichedPositions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const totalUnrealizedPnl = totalMarketValue - totalCostBasis;
    const totalUnrealizedPnlPercent = totalCostBasis > 0 ? (totalUnrealizedPnl / totalCostBasis) * 100 : 0;

    return NextResponse.json({
      success: true,
      positions: enrichedPositions,
      summary: {
        total_positions: enrichedPositions.length,
        total_cost_basis: totalCostBasis,
        total_market_value: totalMarketValue,
        total_unrealized_pnl: totalUnrealizedPnl,
        total_unrealized_pnl_percent: totalUnrealizedPnlPercent,
        winning_positions: enrichedPositions.filter(p => (p.unrealized_pnl || 0) > 0).length,
        losing_positions: enrichedPositions.filter(p => (p.unrealized_pnl || 0) < 0).length,
      },
    });
  } catch (error) {
    console.error('[GET /api/portfolio] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();

    // Must be authenticated to add positions
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لإضافة أسهم إلى المحفظة' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      stock_symbol,
      shares,
      avg_cost,
      entry_date,
      notes,
    } = body;

    if (!stock_symbol || !shares || !avg_cost) {
      return NextResponse.json(
        { error: 'Missing required fields: stock_symbol, shares, avg_cost' },
        { status: 400 }
      );
    }

    // Ensure stock exists
    await ensureInitialized();
    const db = getLightDb();
    const stock = db.prepare('SELECT ticker FROM stocks WHERE ticker = ?').get(stock_symbol.toUpperCase());

    if (!stock) {
      return NextResponse.json(
        { error: `Stock ${stock_symbol} not found in database` },
        { status: 404 }
      );
    }

    // Create or update position
    const existingPosition = await prisma.portfolioPosition.findUnique({
      where: {
        user_id_stock_symbol: {
          user_id: userId,
          stock_symbol: stock_symbol.toUpperCase(),
        },
      },
    });

    let position;

    if (existingPosition) {
      // Update existing position (average up/down)
      const totalShares = existingPosition.shares + shares;
      const totalCost = (existingPosition.shares * existingPosition.avg_cost) + (shares * avg_cost);
      const newAvgCost = totalCost / totalShares;

      position = await prisma.portfolioPosition.update({
        where: { id: existingPosition.id },
        data: {
          shares: totalShares,
          avg_cost: newAvgCost,
          total_invested: (existingPosition.total_invested || 0) + (shares * avg_cost),
          avg_down_count: avg_cost < existingPosition.avg_cost ? existingPosition.avg_down_count + 1 : existingPosition.avg_down_count,
          notes: notes || existingPosition.notes,
          updated_at: new Date(),
        },
      });
    } else {
      // Create new position
      position = await prisma.portfolioPosition.create({
        data: {
          user_id: userId,
          stock_symbol: stock_symbol.toUpperCase(),
          shares: shares,
          avg_cost: avg_cost,
          entry_date: entry_date ? new Date(entry_date) : new Date(),
          total_invested: shares * avg_cost,
          notes: notes,
        },
      });
    }

    return NextResponse.json({
      success: true,
      position,
      is_new: !existingPosition,
    });
  } catch (error) {
    console.error('[POST /api/portfolio] Error:', error);
    return NextResponse.json(
      { error: 'Failed to add position', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();

    // Must be authenticated to delete positions
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لحذف الأسهم من المحفظة' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const positionId = searchParams.get('id');

    if (!positionId) {
      return NextResponse.json(
        { error: 'Position ID required' },
        { status: 400 }
      );
    }

    await prisma.portfolioPosition.update({
      where: {
        id: positionId,
        user_id: userId,
      },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/portfolio] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete position', detail: String(error) },
      { status: 500 }
    );
  }
}

// Helper functions
function getStatus(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'heavy_loss';
  if (pnlPercent <= -5) return 'moderate_loss';
  if (pnlPercent < 0) return 'slight_loss';
  if (pnlPercent < 10) return 'slight_gain';
  if (pnlPercent < 25) return 'moderate_gain';
  return 'heavy_gain';
}

function getStatusAr(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'خسارة كبيرة';
  if (pnlPercent <= -5) return 'خسارة متوسطة';
  if (pnlPercent < 0) return 'تحت التكلفة';
  if (pnlPercent < 10) return 'ربح بسيط';
  if (pnlPercent < 25) return 'ربح جيد';
  return 'ربح كبير';
}

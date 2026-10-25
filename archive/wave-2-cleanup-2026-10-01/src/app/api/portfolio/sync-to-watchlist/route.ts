import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { authDb } from '@/lib/db-auth';
import path from 'path';
import { readFile, writeFile, access, mkdir } from 'fs/promises';

/**
 * POST /api/portfolio/sync-to-watchlist
 *
 * بياخد كل أسهم المحفظة + يضيفها تلقائياً لـ:
 *   1. قائمة المراقبة (watchlist في auth.db)
 *   2. تتبع الرادار (maker_radar_tracking.json)
 *
 * الفايدة: لما المستخدم يضيف سهم للمحفظة، تلقائياً يبقى تحت المتابعة في الرادار.
 */

export const dynamic = 'force-dynamic';

const TRACKING_FILE = path.join(process.cwd(), 'db', 'maker_radar_tracking.json');

async function loadTracking(): Promise<Record<string, any>> {
  try {
    await access(TRACKING_FILE);
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveTracking(tracking: Record<string, any>): Promise<void> {
  const dir = path.dirname(TRACKING_FILE);
  try { await access(dir); } catch { await mkdir(dir, { recursive: true }); }
  await writeFile(TRACKING_FILE, JSON.stringify(tracking, null, 2));
}

export async function POST(req: NextRequest) {
  const { userId } = await getSessionUserId(req as any);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'auth_required' }, { status: 401 });
  }

  try {
    // 1. جلب كل أسهم المحفظة
    const portfolioItems = await authDb.portfolioItem.findMany({
      where: { user_id: userId },
      select: { symbol: true, purchase_price: true },
    });

    if (portfolioItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'مفيش أسهم في المحفظة',
        synced: 0,
      });
    }

    // 2. جلب الـ watchlist الحالي
    const existingWatchlist = await authDb.watchlist.findMany({
      where: { user_id: userId },
      select: { ticker: true },
    });
    const existingTickers = new Set(existingWatchlist.map((w) => w.ticker.toUpperCase()));

    // 3. جلب الـ radar tracking الحالي
    const tracking = await loadTracking();

    let addedToWatchlist = 0;
    let addedToRadar = 0;

    // 4. لكل سهم في المحفظة:
    for (const item of portfolioItems) {
      if (!item.symbol) continue;
      const ticker = item.symbol.toUpperCase();

      // 4a. أضف للـ watchlist لو مش موجود
      if (!existingTickers.has(ticker)) {
        await authDb.watchlist.create({
          data: {
            user_id: userId,
            ticker,
            market: 'EGX',
            current_price: item.purchase_price || null,
          },
        });
        existingTickers.add(ticker);
        addedToWatchlist++;
      }

      // 4b. أضف للـ radar tracking لو مش موجود
      if (!tracking[ticker]) {
        tracking[ticker] = {
          ticker,
          entryDate: new Date().toISOString().slice(0, 10),
          entryPrice: item.purchase_price || 0,
          addedAt: new Date().toISOString(),
          notes: 'auto-synced from portfolio',
        };
        addedToRadar++;
      }
    }

    // 5. احفظ الـ tracking
    if (addedToRadar > 0) {
      await saveTracking(tracking);
    }

    return NextResponse.json({
      success: true,
      message: `تمت مزامنة ${portfolioItems.length} سهم من المحفظة`,
      synced: {
        portfolioTotal: portfolioItems.length,
        addedToWatchlist,
        addedToRadar,
        alreadyWatched: portfolioItems.length - addedToWatchlist,
        alreadyTracked: portfolioItems.length - addedToRadar,
      },
    });
  } catch (err: any) {
    console.error('[portfolio/sync-to-watchlist] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل المزامنة' },
      { status: 500 },
    );
  }
}

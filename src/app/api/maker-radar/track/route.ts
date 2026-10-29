import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync readFileSync/writeFileSync/
// existsSync/mkdirSync with async fs/promises equivalents so POST/GET/DELETE
// handlers never block the event loop on the tracking JSON file.
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

// P0-14-ASYNC fix (2026-09-27): loadTracking is now async.
async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch {
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[maker-radar/track] load error:', e);
  }
  return {};
}

// P0-14-ASYNC fix (2026-09-27): saveTracking is now async.
async function saveTracking(tracking: Record<string, TrackedStock>): Promise<void> {
  const dir = path.dirname(TRACKING_FILE);
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(TRACKING_FILE, JSON.stringify(tracking, null, 2));
}

// POST /api/maker-radar/track
// body: { ticker, entryPrice, entryDate?, action: 'add' | 'remove' }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker, entryPrice, entryDate, action, notes } = body;

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }

    const tracking = await loadTracking();
    const upperTicker = ticker.toUpperCase();

    if (action === 'remove') {
      delete tracking[upperTicker];
      await saveTracking(tracking);
      return NextResponse.json({
        success: true,
        action: 'removed',
        ticker: upperTicker,
        tracked_count: Object.keys(tracking).length,
      });
    }

    // action === 'add'
    // entryPrice === 0 is a valid "no known entry price" marker: auto-tracking
    // from the portfolio/watchlist has no trade entry to record, and a stock
    // can legitimately have neither entry_price nor a live current_price.
    // The radar route already reports changeSinceTracking as 0 in that case.
    if (typeof entryPrice !== 'number' || !Number.isFinite(entryPrice) || entryPrice < 0) {
      return NextResponse.json(
        { success: false, error: 'entryPrice (number >= 0) is required for add' },
        { status: 400 }
      );
    }

    const today = entryDate || new Date().toISOString().slice(0, 10);
    tracking[upperTicker] = {
      ticker: upperTicker,
      entryDate: today,
      entryPrice,
      addedAt: new Date().toISOString(),
      notes,
    };
    await saveTracking(tracking);

    return NextResponse.json({
      success: true,
      action: 'added',
      ticker: upperTicker,
      entry: tracking[upperTicker],
      tracked_count: Object.keys(tracking).length,
    });
  } catch (error: any) {
    console.error('[maker-radar/track] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' || 'Internal error' },
      { status: 500 }
    );
  }
}

// GET /api/maker-radar/track — رجّع كل الأسهم المتابَعة
export async function GET() {
  try {
    const tracking = await loadTracking();
    return NextResponse.json({
      success: true,
      tracked: Object.values(tracking),
      tracked_count: Object.keys(tracking).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

// DELETE /api/maker-radar/track — احذف سهم
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker query param is required' },
        { status: 400 }
      );
    }

    const tracking = await loadTracking();
    const upperTicker = ticker.toUpperCase();
    delete tracking[upperTicker];
    await saveTracking(tracking);

    return NextResponse.json({
      success: true,
      action: 'removed',
      ticker: upperTicker,
      tracked_count: Object.keys(tracking).length,
    });
  } catch (error: any) {
    console.error('[maker-radar:track]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

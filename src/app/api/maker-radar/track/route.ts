import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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

function loadTracking(): Record<string, TrackedStock> {
  try {
    if (existsSync(TRACKING_FILE)) {
      const data = readFileSync(TRACKING_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[maker-radar/track] load error:', e);
  }
  return {};
}

function saveTracking(tracking: Record<string, TrackedStock>) {
  const dir = path.dirname(TRACKING_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(TRACKING_FILE, JSON.stringify(tracking, null, 2));
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

    const tracking = loadTracking();
    const upperTicker = ticker.toUpperCase();

    if (action === 'remove') {
      delete tracking[upperTicker];
      saveTracking(tracking);
      return NextResponse.json({
        success: true,
        action: 'removed',
        ticker: upperTicker,
        tracked_count: Object.keys(tracking).length,
      });
    }

    // action === 'add'
    if (typeof entryPrice !== 'number' || entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'entryPrice (number > 0) is required for add' },
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
    saveTracking(tracking);

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
      { success: false, error: error.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// GET /api/maker-radar/track — رجّع كل الأسهم المتابَعة
export async function GET() {
  try {
    const tracking = loadTracking();
    return NextResponse.json({
      success: true,
      tracked: Object.values(tracking),
      tracked_count: Object.keys(tracking).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
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

    const tracking = loadTracking();
    const upperTicker = ticker.toUpperCase();
    delete tracking[upperTicker];
    saveTracking(tracking);

    return NextResponse.json({
      success: true,
      action: 'removed',
      ticker: upperTicker,
      tracked_count: Object.keys(tracking).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

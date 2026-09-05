import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execAsync = promisify(exec);
const PROJECT_ROOT = process.cwd();

// Cache لـ 60 ثانية عشان ما نضربش الإنتاج كل request
// Per-market cache (عشان EGX و TADAWUL ما يخليشوش بعض)
const cachedRadarMap = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

// Tracking file: بيخزن الأسهم اللي العميل ضافها للمتابعة + سعر الدخول
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
    console.error('[maker-radar] loadTracking error:', e);
  }
  return {};
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';
  const minQuietSignals = parseInt(url.searchParams.get('minQuietSignals') || '5', 10);
  const minPrice = parseFloat(url.searchParams.get('minPrice') || '1.0');
  const forceRefresh = url.searchParams.get('refresh') === '1';

  // تحقق من الـ cache (per-market)
  const cacheKey = `${market}_${minQuietSignals}_${minPrice}`;
  const now = Date.now();
  const cached = cachedRadarMap.get(cacheKey);
  if (!forceRefresh && cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
      cache_age_seconds: Math.round((now - cached.timestamp) / 1000),
    });
  }

  try {
    // شغّل الـ Python script
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'maker_radar.py');
    const outputDir = path.join(PROJECT_ROOT, 'scripts', 'output');
    const args = [
      `--market ${market}`,
      `--min-quiet-signals ${minQuietSignals}`,
      `--min-price ${minPrice}`,
      `--json-only`,
    ].join(' ');

    const { stdout } = await execAsync(`python3 ${scriptPath} ${args}`, {
      cwd: PROJECT_ROOT,
      timeout: 30_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    // الـ script بيحفظ JSON في scripts/output/maker_radar_<date>.json
    // نقرا أحدث ملف مباشرة (بدون الاعتماد على stdout parsing)
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
      (today.getMonth() + 1).toString().padStart(2, '0') +
      today.getDate().toString().padStart(2, '0');
    const jsonPath = path.join(outputDir, `maker_radar_${dateStr}.json`);

    let radarData: any;
    if (existsSync(jsonPath)) {
      radarData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    } else {
      // fallback: حاول نقرا أي ملف maker_radar_*.json
      const fs = require('fs');
      const files = fs.readdirSync(outputDir)
        .filter((f: string) => f.startsWith('maker_radar_') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) {
        throw new Error('No maker_radar JSON found in scripts/output/');
      }
      radarData = JSON.parse(readFileSync(path.join(outputDir, files[0]), 'utf-8'));
    }

    // حمّل الـ tracking data
    const tracking = loadTracking();

    // دمج الـ tracking مع الـ radar data
    // لكل سهم تحت الميكروسكوب: ضيف entryPrice + changeSinceTracking
    const enrichStock = (stock: any) => {
      const tracked = tracking[stock.ticker];
      if (tracked) {
        const currentPrice = stock.current_price || 0;
        const changeSinceTracking = tracked.entryPrice > 0
          ? ((currentPrice - tracked.entryPrice) / tracked.entryPrice) * 100
          : 0;
        return {
          ...stock,
          isTracked: true,
          trackingEntryDate: tracked.entryDate,
          trackingEntryPrice: tracked.entryPrice,
          changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
        };
      }
      return { ...stock, isTracked: false };
    };

    const enriched = {
      ...radarData,
      quiet_list: (radarData.quiet_list || []).map(enrichStock),
      explosive_list: (radarData.explosive_list || []).map(enrichStock),
      early_break_list: (radarData.early_break_list || []).map(enrichStock),
      tracked_count: Object.keys(tracking).length,
      tracked_tickers: Object.keys(tracking),
      generated_at: new Date().toISOString(),
    };

    // احفظ في الـ cache (per-market)
    cachedRadarMap.set(cacheKey, { data: enriched, timestamp: now });

    return NextResponse.json({
      success: true,
      ...enriched,
      cached: false,
    });
  } catch (error: any) {
    console.error('[maker-radar] error:', error);
    const cachedFallback = cachedRadarMap.get(cacheKey);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to run maker radar',
        cached: !!cachedFallback,
        ...(cachedFallback ? { ...cachedFallback.data, cached: true } : {}),
      },
      { status: 500 }
    );
  }
}

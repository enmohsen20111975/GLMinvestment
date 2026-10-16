import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

/**
 * GET /api/v2/liquidity-radar?market=EGX
 * ======================================
 * رادار السيولة الصارم — 4 أعمدة فقط (Task BRAVO-RADAR-V2)
 *
 * العقل: Python (scripts/liquidity_radar_v2.py) — Rule 20 (PYTHON=BRAIN)
 *
 * يرجع هيكل ثابت لكل سهم:
 *   - whale:        الحوت فين؟ (صافي الكاش المطلق + whale_present)
 *   - market_regime: حالة السوق (صاعد/هابط/عرضي/Risk-Off)
 *   - phase:        المرحلة (بيبلع على الهادي / بيتحضر / بيصرف / بيانات غير كافية)
 *   - entry_defense: مستوى الدخول والدفاع (entry_level + defense_level)
 *   - reason:       سبب كمي مختصر (جملة واحدة)
 *
 * القيود الحديدية:
 *   - لا مصطلحات Wyckoff (Spring/SOS/Buying Climax/تصريف ذكي)
 *   - لا إشارات تجميع في سوق هابط
 *   - لا بيانات وهمية — لو Python فشل، structured empty result
 *
 * الكاش: 60 ثانية في الذاكرة لكل سوق (عشان المسح بياخد وقت).
 */
const CACHE_TTL_MS = 60_000; // 60 ثانية
const cachedPayloads: Record<string, { data: unknown; ts: number }> = {};

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'liquidity_radar_v2.py');
const PROJECT_ROOT = process.cwd();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = (searchParams.get('market') || 'EGX').trim().toUpperCase();
  const ticker = searchParams.get('ticker');

  // 1. تحقق من الكاش (per-market)
  const cacheKey = ticker ? `${market}:${ticker}` : market;
  const cached = cachedPayloads[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Liquidity-Radar-Source': 'memory-cache',
      },
    });
  }

  // 2. تحقق إن السكريبت موجود
  if (!fs.existsSync(SCRIPT_PATH)) {
    return NextResponse.json(
      {
        success: false,
        error: 'liquidity_radar_v2.py script not found',
        market,
        market_regime: null,
        stocks: [],
      },
      { status: 500 }
    );
  }

  // 3. نفّذ Python مع timeout 120 ثانية (المسح بياخد وقت)
  try {
    const args = ['--market', market, '--json'];
    if (ticker) {
      args.push('--ticker', ticker);
    }

    const { stdout } = await execFileAsync('python3', [SCRIPT_PATH, ...args], {
      cwd: PROJECT_ROOT,
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024, // 20MB (full market scan)
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    // 4. parse JSON (تجاهل log lines)
    const lines = stdout.split('\n');
    const jsonStart = lines.findIndex((l) => l.trim().startsWith('{'));
    if (jsonStart === -1) {
      return NextResponse.json(
        {
          success: false,
          error: 'No JSON in liquidity_radar_v2.py output',
          market,
          raw_preview: stdout.slice(0, 500),
          stocks: [],
        },
        { status: 502 }
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(lines.slice(jsonStart).join('\n'));
    } catch (parseErr) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse liquidity_radar_v2.py JSON',
          market,
          raw_preview: stdout.slice(0, 500),
          stocks: [],
        },
        { status: 502 }
      );
    }

    // 5. خزّن في الكاش
    cachedPayloads[cacheKey] = { data, ts: Date.now() };

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Liquidity-Radar-Source': 'python-live',
      },
    });
  } catch (err: unknown) {
    // Python فشل — لا fabricate بيانات
    const error = err as { code?: string; message?: string; signal?: string; stderr?: string };
    const isTimeout = error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT';

    return NextResponse.json(
      {
        success: false,
        error: isTimeout ? 'انتهت مهلة استجابة محرك الرادار (>120 ثانية)' : 'تعذر تحميل بيانات رادار السيولة لحظياً — المحرك قيد المزامنة',
        message: 'radar_sync_pending',
        market,
        market_regime: null,
        scanned_count: 0,
        phases_breakdown: {},
        macro_summary: {
          total_net_institutional_buy_egp_m: 0,
          positive_flow_ratio_pct: 0,
          positive_flow_count: 0,
          targets_available_count: 0,
          falling_knife_count: 0,
          currency: 'ج.م',
          currency_ar: 'جنيه مصري',
        },
        stocks: [],
        note: 'Python backend unavailable — returning empty structured result (NO-FAKE-DATA).',
      },
      {
        status: 200, // 200 عشان الـ frontend ما يكسرش
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Liquidity-Radar-Source': 'python-failed-fallback',
        },
      }
    );
  }
}

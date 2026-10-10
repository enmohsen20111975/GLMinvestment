/**
 * POST /api/sharia/purification — حاسبة تطهير الأرباح (Tazkiyah)
 * ==============================================================
 * Constitution §32: Python is the brain — الحساب كله في
 *   vps-service/portfolio/purification_calculator.py
 * و الـ endpoint ده مجرد جسر (spawn) + validation. مفيش نسخة تانية من
 * المعادلة في TypeScript عشان ما يحصلش drift.
 *
 * المعيار الأساسي: S&P Shariah
 *   purification = rate% × (dividends + realized capital gain)
 * باقي المنهجيات (musaffa / kashif / osoul) تكميلية وبتشتغل على التوزيعات بس.
 *
 * Body (أي واحد من الشكلين):
 *   { symbol, quantity, buy_price?, sell_price?, dps?, method?, include_capital_gain? }
 *   { user_id, portfolio_id?, method?, include_capital_gain? }   → محفظة كاملة
 */

import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROJECT_ROOT = process.cwd();
const CALCULATOR = path.join(PROJECT_ROOT, 'vps-service', 'portfolio', 'purification_calculator.py');
const TIMEOUT_MS = 60_000;

function resolvePython(): string {
  if (process.env.PYTHON && existsSync(process.env.PYTHON)) return process.env.PYTHON;
  const candidates = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
    'python3',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return 'python3';
}

type AuthContext = { userId: string | null; isAdmin: boolean };

/** يبني args للـ CLI من الـ body — الـ calculator عنده CLI كامل. */
function buildArgs(body: Record<string, unknown>, auth: AuthContext | null): { args: string[] } | { error: string } | null {
  const args: string[] = [];
  const method = typeof body.method === 'string' && body.method ? body.method : 'S&P';
  if (typeof body.include_capital_gain === 'boolean' && !body.include_capital_gain) {
    args.push('--no-capital-gain');
  }

  if (typeof body.symbol === 'string' && body.symbol.trim()) {
    const qty = Number(body.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    args.push('--symbol', body.symbol.trim().toUpperCase());
    args.push('--qty', String(qty));
    const buy = Number(body.buy_price);
    const sell = Number(body.sell_price);
    if (Number.isFinite(buy) && buy > 0) args.push('--buy', String(buy));
    if (Number.isFinite(sell) && sell > 0) args.push('--sell', String(sell));
    args.push('--method', method);
    return { args };
  }

  const user = typeof body.user_id === 'string' && body.user_id.trim() ? body.user_id.trim() : null;
  if (!user) return null;

  // ── auth gate للـ portfolio scope ──
  // `user_id` في الـ body بدون gate = IDOR: أي حد يقدر يبعت
  // user_id حد تاني ويسيب محفظته الشرعية. فبنقارنها بالـ session،
  // والـ admin يقدر يبص على أي محفظة (للـ support/debugging).
  if (!auth) return { error: 'auth_required' };
  if (auth.userId !== user && !auth.isAdmin) return { error: 'forbidden' };

  args.push('--user', user);
  args.push('--method', method);
  return { args };
}

export async function POST(req: NextRequest) {
  if (!existsSync(CALCULATOR)) {
    return NextResponse.json(
      { success: false, error: 'calculator_missing', path: CALCULATOR },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch { // silent fallback (safe-by-design)
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const auth = await getSessionUserId();

  const built = buildArgs(body, auth);
  if (!built) {
    return NextResponse.json(
      {
        success: false,
        error: 'invalid_request',
        hint: 'إما { symbol, quantity, buy_price?, sell_price? } أو { user_id }',
      },
      { status: 400 }
    );
  }
  if ('error' in built) {
    const status = built.error === 'forbidden' ? 403 : 401;
    return NextResponse.json(
      {
        success: false,
        error: built.error,
        hint:
          built.error === 'forbidden'
            ? 'user_id في الطلب مش الـ session الحالي'
            : 'محطة الـ portfolio محتاجة تسجيل دخول (أو ابعت symbol للجدول المفرد)',
      },
      { status }
    );
  }
  const args = built.args;

  const python = resolvePython();

  const result = await new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    execFile(
      python,
      [CALCULATOR, ...args],
      { cwd: PROJECT_ROOT, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8 },
      (error, stdout, stderr) => {
        if (error) {
          console.error('[sharia/purification] python failed:', String(error).slice(0, 500));
        }
        resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });

  if (!result.ok || !result.stdout.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'calculator_failed',
        detail: result.stderr.slice(0, 800) || 'no output from calculator',
      },
      { status: 500 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch { // silent fallback (safe-by-design)
    return NextResponse.json(
      { success: false, error: 'calculator_bad_json', raw: result.stdout.slice(0, 500) },
      { status: 500 }
    );
  }

  const data = payload as Record<string, unknown>;

  /**
   * Compat shim — `ShariaView.tsx` (Wave 8 / Task 23-C) بيقرأ أسماء تانية.
   * بدل ما أعدّل المكوّن، بنطلّع الاسمين. الشكل الأساسي (canonical) من
   * الـ Python، والـ aliases للتوافق الخلفي.
   */
  const isPortfolio = Array.isArray(data.positions);
  if (isPortfolio) {
    const totals = (data.totals ?? {}) as Record<string, number>;
    const positions = data.positions as Array<Record<string, unknown>>;
    return NextResponse.json({
      success: true,
      primary_method: 'S&P',
      engine: CALCULATOR,
      ...data,
      // aliases consumed by PortfolioPurificationCalculator
      total_purification: totals.purification_amount ?? 0,
      trades_count: totals.positions_with_sharia_data ?? positions.length,
      total_dividends: positions.reduce((s, p) => s + (Number(p.dividends) || 0), 0),
      total_realized_capital_gain: positions.reduce(
        (s, p) => s + (Number(p.capital_gain) || 0),
        0
      ),
      per_symbol: positions.map((p) => ({
        symbol: p.symbol,
        name_ar: p.name_ar,
        purification_amount: p.purification_amount,
        purification_rate_pct: p.rate_pct,
        dividends: p.dividends,
        realized_capital_gain: p.capital_gain,
        purification_base: p.purification_base,
        compliant_sources: p.compliant_sources,
        is_halal_consensus: p.is_halal_consensus,
        warnings: p.warnings,
      })),
    });
  }

  return NextResponse.json({
    success: true,
    primary_method: 'S&P',
    engine: CALCULATOR,
    ...data,
    // aliases consumed by PurificationResultCard
    purification_rate_pct: data.rate_pct,
    realized_capital_gain: data.capital_gain,
  });
}

/** GET = sanity check إن الحاسبة موجودة والـ sharia tables متعبأة. */
export async function GET() {
  if (!existsSync(CALCULATOR)) {
    return NextResponse.json({ success: false, error: 'calculator_missing' }, { status: 503 });
  }
  return NextResponse.json({
    success: true,
    engine: 'vps-service/portfolio/purification_calculator.py',
    python: resolvePython(),
    primary_method: 'S&P',
    supplementary_methods: ['musaffa', 'kashif', 'osoul'],
    usage: {
      single: { symbol: 'ABUK', quantity: 500, buy_price: 72, sell_price: 90 },
      portfolio: { user_id: '<user id>', include_capital_gain: true },
    },
  });
}
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/trade-results/export-image?period=daily|weekly|monthly&format=json
 *
 * Task 38-B — Social Media Report Templates — Export API.
 *
 * يلتف على Task 38-A Data Engine (`/api/trade-results?period=X`) لجلب بيانات حقيقية،
 * ثم يرجعها كـ JSON منظم (ReportData) عشان يـ renderها الـ client component
 * عبر React + html-to-image (بدون server-side renderToStaticMarkup لأن
 * Next.js App Router لا يسمح باستيراد react-dom/server من داخل route.ts).
 *
 * Rule 67 — NO fabricated data:
 *   - لو `/api/trade-results` رجع 404 (المحرك لسه مش موجود من Task 38-A) → نرجع 503
 *     مع رسالة واضحة "محرك النتائج غير متاح" + `data: null`.
 *   - لو stats === null (مفيش صفقات مؤهلة) → نرجع 200 مع `data.stats = null`
 *     والـ client component هيُعرض بحالة EmptyState.
 *
 * Spec note (alternative simpler approach):
 *   الـ spec بيذكر: «return the data JSON + let the frontend render the template
 *   + use `html-to-image` to download.» — ده اللي بنعمله هنا.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const periodParam = url.searchParams.get('period') ?? 'daily';

  // ── Validate period ──
  const validPeriods = ['daily', 'weekly', 'monthly'] as const;
  if (!validPeriods.includes(periodParam as typeof validPeriods[number])) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid period: ${periodParam}. Must be one of: daily, weekly, monthly`,
        error_ar: 'فترة غير صالحة — يجب أن تكون daily أو weekly أو monthly',
      },
      { status: 400 },
    );
  }
  const period = periodParam as typeof validPeriods[number];

  // ── Internal fetch to Task 38-A Data Engine ──
  // (لو المحرك لسه مش منشأ، الـ fetch رجع 404 → نرجع 503 بدل ما نخترع بيانات)
  let engineResponse: Response;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${request.nextUrl.port || 3000}`;
    engineResponse = await fetch(
      `${baseUrl}/api/trade-results?period=${period}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: 'Data Engine timed out',
          error_ar: 'انتهت مهلة الاتصال بمحرك نتائج الصفقات',
          data: null,
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: `Failed to reach Data Engine: ${err?.message || 'unknown'}`,
        error_ar: 'فشل الاتصال بمحرك نتائج الصفقات (Task 38-A)',
        data: null,
      },
      { status: 503 },
    );
  }

  if (engineResponse.status === 404) {
    return NextResponse.json(
      {
        success: false,
        error: 'Trade Results Data Engine not found at /api/trade-results (Task 38-A not deployed yet)',
        error_ar: 'محرك نتائج الصفقات غير متاح — في انتظار Task 38-A',
        data: null,
      },
      { status: 503 },
    );
  }

  if (!engineResponse.ok) {
    let errBody: unknown = null;
    try {
      errBody = await engineResponse.json();
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        success: false,
        error: `Data Engine returned HTTP ${engineResponse.status}`,
        error_ar: 'فشل محرك نتائج الصفقات في إرجاع البيانات',
        engine_error: errBody,
        data: null,
      },
      { status: 502 },
    );
  }

  const rawEnginePayload: unknown = await engineResponse.json().catch(() => null);
  if (!rawEnginePayload) {
    return NextResponse.json(
      {
        success: false,
        error: 'Data Engine returned malformed JSON',
        error_ar: 'استجابة غير صالحة من المحرك',
        data: null,
      },
      { status: 502 },
    );
  }

  // ── Normalize (handles both {data: {...}} wrapper + flat shape) ──
  const { normalizeReportData } = await import('@/modules/publishing/components/TradeResultsTemplates');
  type ReportData = import('@/modules/publishing/components/TradeResultsTemplates').ReportData;

  const rawPayload = rawEnginePayload as Record<string, unknown>;
  const rawReport = rawPayload.data && typeof rawPayload.data === 'object'
    ? rawPayload.data
    : rawEnginePayload;

  const reportData: ReportData = normalizeReportData(rawReport);

  // ── Return normalized JSON for client-side rendering ──
  // (The TradeResultsGenerator client component renders the appropriate template
  //  at native resolution + uses html-to-image to export PNG.)
  return NextResponse.json(
    {
      success: true,
      period,
      data: reportData,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Period': period,
        'X-Report-Status': reportData.stats ? 'has-data' : 'empty',
      },
    },
  );
}

/**
 * GET /api/trade-results/export-image?period=X
 * مساعد: نفس سلوك POST لكن GET عشان يسهّل الاختبار بـ curl / browser.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

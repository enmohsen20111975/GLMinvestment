import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { PrismaClient } from '@prisma/auth-client';

const prisma = new PrismaClient();

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
const DEFAULT_USER_ID = '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    const effectiveUserId = userId || DEFAULT_USER_ID;
    const url = new URL(req.url);
    url.searchParams.set('user_id', effectiveUserId);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/portfolio/holdings${qs ? `?${qs}` : ''}`;

    const options: RequestInit = {
      method: 'GET',
      signal: AbortSignal.timeout(30000),
    };

    const res = await fetch(targetUrl, options);
    const data = await res.json();

    // Fetch historical wealth data from DB
    // PORTFOLIO-PRICE-FIX-005: wrap in try/catch so Prisma failures (e.g.,
    // missing portfolio_history table) don't break the whole endpoint —
    // the live portfolio data from Python is the critical path.
    let historyData: Array<{ date: Date | string; total_value: number }> = [];
    try {
      historyData = await prisma.portfolioHistory.findMany({
        where: { user_id: effectiveUserId },
        orderBy: { date: 'asc' },
        take: 30
      });
    } catch (prismaErr) {
      // جدول portfolio_history قد لا يكون موجوداً بعد أو به خلل — نتجاهله
      // ونُكمل بالبيانات الحية من Python، مع توليد mock history أنيقة.
      console.warn('[portfolio/assets] prisma.portfolioHistory failed, using mock history:', prismaErr instanceof Error ? prismaErr.message : prismaErr);
    }

    if (data.success) {
      if (historyData.length > 0) {
        data.history = historyData.map(h => ({
          date: new Date(h.date).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }),
          value: h.total_value
        }));
      } else {
        // CRITICAL FIX (2026-08-28): Previously generated Math.random() mock history!
        // This is a financial platform — fake portfolio history = legal liability.
        // Now returns empty array with message instead of fake data.
        data.history = [];
        data.history_message = 'لا يوجد سجل محفظة تاريخي بعد. سيظهر السجل عند تشغيل cron الـ portfolio tracker.';
      }
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}

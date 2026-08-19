import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PYTHON_BACKEND_URL = process.env.VPS_API_URL || process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// Default admin token for Python backend (must match ADMIN_TOKEN in Python env)
const DEFAULT_ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/**
 * POST /api/admin/historical-backfill/run
 *
 * تشغيل التعلم من البيانات التاريخية
 * يتصل بـ Python Backend على VPS
 *
 * ملاحظة: يتم تمرير token المصادقة تلقائياً
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const url = `${PYTHON_BACKEND_URL}/api/admin/historical-backfill/run`;

    // Use provided token or default
    const providedToken = request.headers.get('X-Admin-Token');
    const token = providedToken || DEFAULT_ADMIN_TOKEN;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
    };

    const body = await request.json().catch(() => ({}));

    console.log('[Historical Backfill] Starting with token...');

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000), // 10 minutes timeout
    });

    const data = await response.json();

    console.log('[Historical Backfill] Completed:', data.success ? 'success' : 'failed', data.error || '');

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Historical Backfill] Run error:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في الاتصال بالخادم', details: String(error) },
      { status: 500 }
    );
  }
}

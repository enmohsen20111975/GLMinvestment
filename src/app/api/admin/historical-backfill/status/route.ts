import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const PYTHON_BACKEND_URL = process.env.VPS_API_URL || process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// Default admin token for Python backend
const DEFAULT_ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/**
 * GET /api/admin/historical-backfill/status
 *
 * الحصول على حالة التعلم التاريخي
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const url = `${PYTHON_BACKEND_URL}/api/admin/historical-backfill/status`;

    // Use provided token or default
    const providedToken = request.headers.get('X-Admin-Token');
    const token = providedToken || DEFAULT_ADMIN_TOKEN;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
    };

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[Historical Backfill] Status error:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في الاتصال بالخادم', details: String(error) },
      { status: 500 }
    );
  }
}

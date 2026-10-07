/**
 * Admin Engine Settings — Reset to defaults (proxy to Python backend)
 * ====================================================================
 * DYNAMIC-ADMIN-UI: استعادة كل إعدادات المحرك للقيم الافتراضية.
 *
 * POST /api/admin/engine-settings/reset
 *  → proxies to Python backend `${PYTHON_BACKEND_URL}/api/admin/engine-settings/reset`
 *  → returns { success, timestamp }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

const PROXY_TIMEOUT_MS = 8000;

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    let result: { ok: boolean; status: number; data: unknown } = {
      ok: false,
      status: 0,
      data: null,
    };

    try {
      const res = await fetch(
        `${PYTHON_BACKEND_URL}/api/admin/engine-settings/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        },
      );
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        /* ignore JSON parse errors */
      }
      result = { ok: res.ok, status: res.status, data };
    } catch {
      result = { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!result.ok || !result.data || typeof result.data !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: 'Python backend unreachable — تعذّر استعادة الإعدادات',
        },
        { status: 502 },
      );
    }

    const payload = result.data as {
      success?: boolean;
      message?: string;
      timestamp?: string;
    };

    return NextResponse.json({
      success: Boolean(payload.success),
      message: payload.message,
      timestamp: payload.timestamp || new Date().toISOString(),
      source: 'python-backend',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[engine-settings reset] error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

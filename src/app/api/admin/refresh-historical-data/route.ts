/**
 * POST /api/admin/refresh-historical-data
 *
 * Admin endpoint to trigger a refresh of 5-year historical data.
 * This replaces old Canadian stock data (.CA suffix) with correct Egyptian data (.EG suffix)
 * by calling the data-engine's /trigger/historical-5years endpoint.
 *
 * The data-engine runs on port 5000 (Flask service).
 * The VPS Python backend runs on port 8010.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, verifyAdminRequest } from '@/lib/admin-auth-server';

// Data engine runs on port 5000
const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:5000';

function checkAdminAuth(request: NextRequest): NextResponse | null {
  // First try verifyAdminRequest (checks cookie + header)
  if (verifyAdminRequest(request)) return null;

  // Fallback: check raw token
  const authHeader = request.headers.get('authorization');
  const adminToken = request.headers.get('x-admin-token');
  const token = authHeader?.replace(/^Bearer\s+/i, '') || adminToken;

  if (token && verifyAdminToken(token)) return null;

  return NextResponse.json(
    { success: false, error: 'Unauthorized - Admin access required' },
    { status: 401 }
  );
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authorization
    const authError = checkAdminAuth(request);
    if (authError) return authError;

    console.log('[admin/refresh-historical] Starting 5-year historical data refresh...');

    // Call the data-engine's /trigger/historical-5years endpoint
    const dataEngineUrl = `${DATA_ENGINE_URL}/trigger/historical-5years`;

    const response = await fetch(dataEngineUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), // 30 second timeout for the trigger (actual work runs in background)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[admin/refresh-historical] Data engine error:', response.status, errorData);

      // If 409, it's already running
      if (response.status === 409) {
        return NextResponse.json({
          success: false,
          error: 'التحديث قيد التشغيل بالفعل - يرجى الانتظار',
          already_running: true,
        });
      }

      return NextResponse.json({
        success: false,
        error: `Data engine returned ${response.status}: ${errorData.error || 'Unknown error'}`,
      }, { status: 502 });
    }

    const data = await response.json();
    console.log('[admin/refresh-historical] Data engine accepted:', data.message);

    return NextResponse.json({
      success: true,
      message: 'تم بدء تحديث البيانات التاريخية - سيتم استبدال البيانات الكندية بالبيانات المصرية الصحيحة',
      details: {
        note: data.note || 'Egypt stocks: .CA → .EG fix applied',
        data_engine_message: data.message,
        estimated_time: '30-120 دقيقة حسب عدد الأسهم',
      },
    });

  } catch (error) {
    console.error('[admin/refresh-historical] Error:', error);

    // Check if it's a connection error
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json({
        success: false,
        error: 'لا يمكن الاتصال بمحرك البيانات - تأكد من تشغيله على المنفذ 5000',
        hint: 'The data-engine service may not be running',
      }, { status: 503 });
    }

    return NextResponse.json({
      success: false,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

// GET endpoint to check the status of the historical refresh
export async function GET(request: NextRequest) {
  try {
    // Verify admin authorization
    const authError = checkAdminAuth(request);
    if (authError) return authError;

    // Check the data engine status
    const dataEngineUrl = `${DATA_ENGINE_URL}/status`;
    const response = await fetch(dataEngineUrl, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: 'Data engine not reachable',
      }, { status: 503 });
    }

    const data = await response.json();
    const activeJobs = data?.engine?.active_jobs || [];
    const isRunning = activeJobs.includes('historical-5years');

    // Also check the historical status file
    let historicalStatus = null;
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const statusPath = path.join(process.cwd(), 'db', 'historical_status.json');
      const statusContent = await fs.readFile(statusPath, 'utf-8');
      historicalStatus = JSON.parse(statusContent);
    } catch {
      // Status file might not exist
    }

    return NextResponse.json({
      success: true,
      is_running: isRunning,
      active_jobs: activeJobs,
      engine_status: {
        last_stocks_update: data?.engine?.last_stocks_update,
        last_sync: data?.engine?.last_sync,
      },
      historical_status: historicalStatus ? {
        running: historicalStatus.running,
        progress: historicalStatus.progress,
        summary: historicalStatus.summary,
        last_update: historicalStatus.lastUpdate,
      } : null,
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

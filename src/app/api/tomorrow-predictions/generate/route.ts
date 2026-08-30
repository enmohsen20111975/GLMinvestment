import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 دقايق

/**
 * POST /api/tomorrow-predictions/generate
 *
 * يشغل سكربت Python `tomorrow_predictions_generator.py` لتوليد توقعات الغد.
 * ده بيستخدم في:
 * 1. الأدمن بنل — زر "توليد يدوي"
 * 2. cron job بعد إغلاق السوق
 *
 * Body:
 *  - market: 'EGX' | 'CRYPTO' (default: EGX)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const market = body.market === 'CRYPTO' ? 'CRYPTO' : 'EGX';

    const scriptPath = path.join(
      process.cwd(),
      'vps-service',
      'jobs',
      'tomorrow_predictions_generator.py'
    );

    // نشغل السكربت Python
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>(
      (resolve) => {
        const pythonProcess = spawn('python3', [scriptPath, '--market', market], {
          cwd: process.cwd(),
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        // timeout 4 دقايق
        const timeout = setTimeout(() => {
          pythonProcess.kill('SIGTERM');
          resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', code: 124 });
        }, 240000);

        pythonProcess.on('close', (code) => {
          clearTimeout(timeout);
          resolve({ stdout, stderr, code: code || 0 });
        });

        pythonProcess.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ stdout, stderr: err.message, code: -1 });
        });
      }
    );

    if (result.code !== 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Python script failed (code ${result.code})`,
          details: result.stderr.slice(-500),
          stdout: result.stdout.slice(-500),
        },
        { status: 500 }
      );
    }

    // نحلل الـ output عشان نحسب النتائج
    const predictionsMatch = result.stdout.match(/تم توليد (\d+) توقع/);
    const watchlistMatch = result.stdout.match(/تم تحديد (\d+) سهم تحت المراقبة/);
    const statusMatch = result.stdout.match(/تم تحديث (\d+) حالة نشطة/);

    return NextResponse.json({
      success: true,
      market,
      predictions_count: predictionsMatch ? parseInt(predictionsMatch[1], 10) : 0,
      watchlist_count: watchlistMatch ? parseInt(watchlistMatch[1], 10) : 0,
      active_status_count: statusMatch ? parseInt(statusMatch[1], 10) : 0,
      output: result.stdout.slice(-1000),
    });
  } catch (e) {
    console.error('[api/tomorrow-predictions/generate] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'intraday'; // 'intraday' | 'daily' | 'all'
    const projectRoot = process.cwd();

    // اختيار مفسر بايثون
    const venvPython = path.join(projectRoot, '.venv', 'bin', 'python3');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';

    const jobsDir = path.join(projectRoot, 'vps-service', 'jobs');
    let scriptPath = '';
    let scriptArgs: string[] = [];

    if (type === 'daily') {
      scriptPath = path.join(jobsDir, 'v40_2_daily_generator.py');
      scriptArgs = ['--today-only', '--max-picks', '5'];
    } else {
      // Intraday 5-min Realtime Scanner (افتراضي وسريع)
      scriptPath = path.join(jobsDir, 'v40_2_intraday_scanner.py');
      scriptArgs = ['--limit', '5'];
    }

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({
        success: false,
        error: `الاسكريبت غير موجود: ${scriptPath}`
      }, { status: 404 });
    }

    // تشغيل الاسكريبت في بيئة النظام
    const env = {
      ...process.env,
      BYPASS_PRED_CAP: '1',
      V76_SECTOR_INTRADAY: '1',
      V40_EXPLOSIVE_UNCAP: '1',
    };

    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(pythonBin, [scriptPath, ...scriptArgs], {
        cwd: projectRoot,
        env,
        timeout: 45000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });

    // قراءة التوقعات التي تم توليدها وحفظها في predictions.db
    const predDbPath = path.join(projectRoot, 'db', 'predictions.db');
    let latestPredictions: any[] = [];

    if (fs.existsSync(predDbPath)) {
      try {
        const db = new Database(predDbPath, { readonly: true });
        latestPredictions = db.prepare(`
          SELECT id, ticker, signal, entry_price, target_price, stop_loss, kill_filter_result, created_at
          FROM predictions
          ORDER BY id DESC
          LIMIT 10
        `).all();
        db.close();
      } catch (dbErr) {
        console.warn('Could not query predictions.db:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      type,
      message: type === 'daily'
        ? 'تم توليد التوقعات اليومية بنجاح عبر محرك V40.2 الموحد'
        : 'تم فحص السوق اللحظي (5 دقائق) وتوليد التوصيات بنجاح',
      output: output.split('\n').slice(-12).join('\n'),
      predictions_count: latestPredictions.length,
      predictions: latestPredictions
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || 'حدث خطأ أثناء توليد التوقعات'
    }, { status: 500 });
  }
}

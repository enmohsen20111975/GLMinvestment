/**
 * GET/POST /api/admin/ai-gatekeeper
 * =================================
 * Admin control and monitoring API for LightGBM AI Signal Gatekeeper.
 * Adheres strictly to Rule 20 (Python = Brain) and Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { openSync, closeSync } from 'fs';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = join(process.cwd(), 'config', 'ai_gatekeeper_settings.json');
const METRICS_PATH = join(process.cwd(), 'models', 'lgbm_metrics.json');
const MODEL_PATH = join(process.cwd(), 'models', 'lgbm_signal_gatekeeper.joblib');

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    let settings = {
      min_confidence_threshold: 0.65,
      gatekeeper_enforced: true,
      high_conviction_threshold: 0.70,
      last_updated: new Date().toISOString(),
      model_version: 'LightGBM-Gatekeeper-v1.0',
    };
    try {
      const settingsRaw = await readFile(CONFIG_PATH, 'utf-8');
      settings = JSON.parse(settingsRaw);
    } catch {}

    let metrics = null;
    try {
      const metricsRaw = await readFile(METRICS_PATH, 'utf-8');
      metrics = JSON.parse(metricsRaw);
    } catch {}

    let modelStats = { exists: false, sizeBytes: 0, lastModified: '' };
    try {
      const s = await stat(MODEL_PATH);
      modelStats = {
        exists: true,
        sizeBytes: s.size,
        lastModified: s.mtime.toISOString(),
      };
    } catch {}

    return NextResponse.json({
      success: true,
      data: {
        settings,
        metrics,
        modelStats,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = await req.json();

    // Action: Train model
    if (body.action === 'train') {
      const jobId = randomUUID().slice(0, 12);
      const logPath = `/tmp/lgbm_train_${jobId}.log`;
      const scriptPath = join(process.cwd(), 'scripts', 'train_signal_classifier_lgbm.py');
      const venvPython = join(process.cwd(), '.venv', 'bin', 'python');

      const logFd = openSync(logPath, 'a');
      const child = spawn(venvPython, ['-u', scriptPath], {
        cwd: process.cwd(),
        env: { ...process.env, PROJECT_ROOT: process.cwd() },
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });

      child.on('close', () => {
        try { closeSync(logFd); } catch {}
      });
      child.unref();

      return NextResponse.json({
        success: true,
        jobId,
        message: 'تم إطلاق تدريب نموذج الذكاء الاصطناعي (LightGBM) في الخلفية بنجاح.',
        logFile: logPath,
      });
    }

    // Action: Update configuration settings
    const currentRaw = await readFile(CONFIG_PATH, 'utf-8').catch(() => '{}');
    const current = JSON.parse(currentRaw || '{}');

    const updated = {
      ...current,
      min_confidence_threshold: typeof body.min_confidence_threshold === 'number'
        ? Math.min(Math.max(body.min_confidence_threshold, 0.4), 0.95)
        : (current.min_confidence_threshold ?? 0.65),
      gatekeeper_enforced: typeof body.gatekeeper_enforced === 'boolean'
        ? body.gatekeeper_enforced
        : (current.gatekeeper_enforced ?? true),
      high_conviction_threshold: typeof body.high_conviction_threshold === 'number'
        ? body.high_conviction_threshold
        : (current.high_conviction_threshold ?? 0.70),
      last_updated: new Date().toISOString(),
    };

    await writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات حارس الذكاء الاصطناعي بنجاح.',
      settings: updated,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/engine-control/trigger
 * ======================================
 * Manually trigger an engine right now.
 *
 * - Marks the engine as triggered (`lastTriggeredAt = now`).
 * - Appends a success log entry.
 * - Bumps the throughput counter by 1.
 * - Optionally calls the real engine's trigger endpoint:
 *     - 'data'    → POST http://localhost:5000/api/trigger
 *     - 'smc' | 'quant' | 'risk' | 'egx'
 *               → POST http://localhost:8010/api/analyzer/trigger/{engine}
 *   Wrapped in try/catch with a 2s timeout. Failure does NOT fail the
 *   request — it just sets `triggerResult: 'failed'`.
 *
 * Body: `{ engineId: string }`
 * Returns: `{ success: true, engineId, triggeredAt, triggerResult }`
 * where triggerResult ∈ 'ok' | 'failed' | 'skipped'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import {
  appendEngineLog,
  bumpThroughput,
  isKnownEngine,
  markTriggered,
} from '@/lib/engine-control-store';

export const dynamic = 'force-dynamic';

const DATA_ENGINE_URL =
  process.env.DATA_ENGINE_URL || 'http://localhost:5000';
const VPS_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

const ANALYSIS_ENGINES = new Set(['smc', 'quant', 'risk', 'egx']);

type TriggerResult = 'ok' | 'failed' | 'skipped';

interface TriggerBody {
  engineId?: unknown;
}

/** POST to a trigger URL with a hard 2s timeout. Resolves to
 * `'ok'` on HTTP success, `'failed'` otherwise. */
async function callExternalTrigger(url: string): Promise<TriggerResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeoutId);
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const body = (await request.json().catch(() => null)) as TriggerBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    const { engineId } = body;
    if (typeof engineId !== 'string' || !isKnownEngine(engineId)) {
      return NextResponse.json(
        { error: 'unknown engine' },
        { status: 400 },
      );
    }

    markTriggered(engineId);
    appendEngineLog(engineId, 'تشغيل يدوي فوري للمحرك', 'success');
    bumpThroughput(1);

    let triggerResult: TriggerResult = 'skipped';
    if (engineId === 'data') {
      triggerResult = await callExternalTrigger(
        `${DATA_ENGINE_URL}/api/trigger`,
      );
    } else if (ANALYSIS_ENGINES.has(engineId)) {
      triggerResult = await callExternalTrigger(
        `${VPS_URL}/api/analyzer/trigger/${engineId}`,
      );
    }

    return NextResponse.json({
      success: true,
      engineId,
      triggeredAt: new Date().toISOString(),
      triggerResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/engine-control/weights
 * ======================================
 * Update an engine's tunable weight parameters. Only the supplied
 * fields are written; the rest are left untouched.
 *
 * Body: `{ engineId: string, weight?: number, sensitivity?: number, threshold?: number }`
 * Validation: weight 0..100, sensitivity 0..1, threshold 0..100.
 * Returns: `{ success: true, engineId, updates: {...} }`
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import {
  appendEngineLog,
  isKnownEngine,
  setEngineWeights,
} from '@/lib/engine-control-store';

export const dynamic = 'force-dynamic';

interface WeightsBody {
  engineId?: unknown;
  weight?: unknown;
  sensitivity?: unknown;
  threshold?: unknown;
}

interface WeightUpdates {
  weight?: number;
  sensitivity?: number;
  threshold?: number;
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const body = (await request.json().catch(() => null)) as WeightsBody | null;
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

    const updates: WeightUpdates = {};

    if (body.weight !== undefined) {
      const w = Number(body.weight);
      if (!Number.isFinite(w) || w < 0 || w > 100) {
        return NextResponse.json(
          { error: 'weight must be between 0 and 100' },
          { status: 400 },
        );
      }
      updates.weight = w;
    }

    if (body.sensitivity !== undefined) {
      const s = Number(body.sensitivity);
      if (!Number.isFinite(s) || s < 0 || s > 1) {
        return NextResponse.json(
          { error: 'sensitivity must be between 0 and 1' },
          { status: 400 },
        );
      }
      updates.sensitivity = s;
    }

    if (body.threshold !== undefined) {
      const t = Number(body.threshold);
      if (!Number.isFinite(t) || t < 0 || t > 100) {
        return NextResponse.json(
          { error: 'threshold must be between 0 and 100' },
          { status: 400 },
        );
      }
      updates.threshold = t;
    }

    setEngineWeights(engineId, updates);
    appendEngineLog(
      engineId,
      `تم تحديث الأوزان: weight=${updates.weight ?? '-'}, sensitivity=${updates.sensitivity ?? '-'}, threshold=${updates.threshold ?? '-'}`,
      'info',
    );

    return NextResponse.json({ success: true, engineId, updates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

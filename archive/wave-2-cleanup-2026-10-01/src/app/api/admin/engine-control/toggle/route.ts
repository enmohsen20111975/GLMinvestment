/**
 * POST /api/admin/engine-control/toggle
 * =====================================
 * Toggle an engine's `active` flag and log the action.
 *
 * Body: `{ engineId: string, active: boolean }`
 * Returns: `{ success: true, engineId, active }`
 * 400 on unknown engine, 401 on bad token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import {
  appendEngineLog,
  isKnownEngine,
  setEngineActive,
} from '@/lib/engine-control-store';

export const dynamic = 'force-dynamic';

interface ToggleBody {
  engineId?: unknown;
  active?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const body = (await request.json().catch(() => null)) as ToggleBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    const { engineId, active } = body;
    if (typeof engineId !== 'string' || typeof active !== 'boolean') {
      return NextResponse.json(
        { error: 'engineId (string) and active (boolean) are required' },
        { status: 400 },
      );
    }

    if (!isKnownEngine(engineId)) {
      return NextResponse.json({ error: 'unknown engine' }, { status: 400 });
    }

    setEngineActive(engineId, active);
    appendEngineLog(
      engineId,
      `تم ${active ? 'تفعيل' : 'إيقاف'} المحرك`,
      'info',
    );

    return NextResponse.json({ success: true, engineId, active });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

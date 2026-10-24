/**
 * GET /api/admin/engine-control/status
 * ====================================
 * Returns the full `EngineControlState` augmented with a live
 * `runtimeStatus` per engine ('running' | 'paused' | 'idle').
 *
 * Auth: `requireAdminAsync` — accepts `x-admin-token` header (base64
 * `username:password`), `admin_session` cookie, NextAuth Google session,
 * or localhost bypass in dev.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import {
  readEngineControl,
  runtimeStatusOf,
  type EngineState,
} from '@/lib/engine-control-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const state = readEngineControl();

    // Attach a live `runtimeStatus` to every engine.
    const engines: Record<string, EngineState & { runtimeStatus: ReturnType<typeof runtimeStatusOf> }> = {};
    for (const id of Object.keys(state.engines)) {
      const engine = state.engines[id];
      engines[id] = { ...engine, runtimeStatus: runtimeStatusOf(engine) };
    }

    return NextResponse.json({
      engines,
      autoRegime: state.autoRegime,
      throughput: state.throughput,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

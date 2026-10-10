import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getAlerts, type AlertSeverity } from '@/lib/metrics-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/system-resources/anomalies
 *
 * Returns recent alerts + a 0-100 health score derived from the active
 * alerts (warning = -5, critical = -15, floor 0).
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam) || 50)) : 50;

    const alerts = getAlerts(limit);

    // Active alerts = those within the last 15 min that are warning or critical
    const cutoff = Date.now() - 15 * 60 * 1000;
    let penalty = 0;
    for (const a of alerts) {
      const tsMs = Date.parse(a.ts);
      if (Number.isNaN(tsMs)) continue;
      if (tsMs < cutoff) continue;
      if (a.type === 'recovered') continue;
      if (a.severity === 'critical') penalty += 15;
      else if (a.severity === 'warning') penalty += 5;
      else if (a.severity === 'info') penalty += 0;
    }
    const health_score = Math.max(0, 100 - penalty) as number;
    const sev: AlertSeverity = health_score >= 80 ? 'info' : health_score >= 50 ? 'warning' : 'critical';

    return NextResponse.json({
      alerts,
      health_score,
      health_severity: sev,
      count: alerts.length,
    });
  } catch (e) {
    console.error('[admin:system-resources:anomalies]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

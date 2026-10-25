import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getJob, listJobs } from '@/lib/db-backup-jobs';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/db-backup/status?job=ID
// GET /api/admin/db-backup/status  (without job → list all jobs)
// ---------------------------------------------------------------------------
// يرجّع الحالة الحالية للـ job: running, phase, pct, errors, warnings, archives
// الـ Frontend بيعمل poll كل 2s لعرض التقدّم في الـ Live Console.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const jobId = req.nextUrl.searchParams.get('job');

  if (jobId) {
    const state = getJob(jobId);
    if (!state) {
      return NextResponse.json({
        success: false,
        error: 'job not found (may have expired or server restarted)',
        running: false,
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      running: state.running,
      phase: state.phase,
      pct: state.pct,
      started_at: state.started_at,
      finished_at: state.finished_at,
      exit_code: state.exit_code,
      archives_created: state.archives_created,
      archives_pushed: state.archives_pushed,
      errors: state.errors,
      warnings: state.warnings,
      pids: state.pids,
      final_result: state.final_result,
    });
  }

  // No job specified — list all jobs (history)
  const allJobs = listJobs().slice(0, 20).map(j => ({
    id: j.id,
    started_at: j.started_at,
    finished_at: j.finished_at,
    running: j.running,
    phase: j.phase,
    pct: j.pct,
    exit_code: j.exit_code,
    archives_count: j.archives_created.length,
    errors_count: j.errors.length,
    warnings_count: j.warnings.length,
  }));

  return NextResponse.json({
    success: true,
    jobs: allJobs,
    count: allJobs.length,
  });
}

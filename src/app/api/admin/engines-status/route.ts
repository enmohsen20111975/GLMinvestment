/**
 * Engines Status API (Directive P1)
 * ==================================
 * يحتوي على حالة المحركات الثلاثة:
 * - Data Engine (سحب الأسعار) - port 5000
 * - Analysis Engine (التحليلات) - port 8010 /api/analyzer/status
 * - Prediction Engine (التوقعات) - port 8010 /api/ai-predictions
 *
 * Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. Previously this route opened `db/data_engine.db`, `db/stocks.db`,
 * and `db/predictions.db` directly via `safeDbQuery`/`safeDbQueryAll` to read
 * counts (stocksCount, cryptoCount, goldCount, predictionCount, todayCount,
 * signalDistribution, analysisCount) and freshness columns (egksco_price_history
 * MAX(price_date), stocks MAX(updated_at), predictions MAX(created_at)).
 *
 * All those SQL reads have been removed — Python owns the DBs and reports
 * engine status from its own `/api/admin/engines-status` endpoint
 * (Rule 4: Python = brain). The Next.js route now:
 *   1. requireAdminAsync — admin-only (preserved).
 *   2. Proxies GET to Python `/api/admin/engines-status`.
 *   3. If Python is unreachable → honest empty engines (Rule 27) with the
 *      same shape consumers (EnginesStatusTab.tsx, EngineControlRoomTab.tsx)
 *      expect.
 *
 * Response shape preserved:
 *   {
 *     success: true,
 *     timestamp: ISO,
 *     summary: { all_running, any_running, total_errors, engines_count, running_count },
 *     engines: {
 *       data:       { name, name_ar, port, running, connection, latency_ms, ... },
 *       analysis:   { name, name_ar, port, running, connection, latency_ms, ... },
 *       prediction:  { name, name_ar, port, running, connection, latency_ms, ... },
 *     }
 *   }
 *
 * Rule 4  (Python = brain — Python probes Flask + VPS + DBs).
 * Rule 27 (NO-FAKE-DATA — honest empty engines when Python is unreachable).
 * Rule 50 (admin-only — preserved via requireAdminAsync).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

function emptyEngine(name: string, nameAr: string, port: number, url: string) {
  return {
    name,
    name_ar: nameAr,
    port,
    url,
    running: false,
    connection: 'unknown' as const,
    latency_ms: 0,
    last_update: null,
    minutes_ago: null,
    staleness: 'unknown' as const,
    errors_count: 0,
    recent_logs: [] as string[],
    description: '',
    update_interval: '',
  };
}

function honestEmpty() {
  const dataEngine = emptyEngine('Data Engine', 'محرك البيانات', 5000, 'http://localhost:5000');
  const analysisEngine = emptyEngine(
    'Analysis Engine',
    'محرك التحليلات',
    8010,
    PYTHON_BACKEND_URL,
  );
  const predictionEngine = emptyEngine(
    'Prediction Engine',
    'محرك التوقعات',
    8010,
    PYTHON_BACKEND_URL,
  );

  // Data Engine has a few extra fields (scrapers + price_history_last_date) —
  // include them so the consumer can render the same shape without null checks.
  (dataEngine as Record<string, unknown>).scheduler_active = false;
  (dataEngine as Record<string, unknown>).scrapers = {
    stocks: { running: false, count: 0 },
    crypto: { running: false, count: 0 },
    metals: { running: false, count: 0 },
  };
  (dataEngine as Record<string, unknown>).price_history_last_date = null;

  // Analysis Engine has a few extra fields too.
  (analysisEngine as Record<string, unknown>).last_analysis = null;
  (analysisEngine as Record<string, unknown>).analysis_count = 0;
  (analysisEngine as Record<string, unknown>).background_analyzer = false;

  // Prediction Engine has totals + signal_distribution.
  (predictionEngine as Record<string, unknown>).total_predictions = 0;
  (predictionEngine as Record<string, unknown>).today_predictions = 0;
  (predictionEngine as Record<string, unknown>).signal_distribution = [];

  return {
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      all_running: false,
      any_running: false,
      total_errors: 0,
      engines_count: 3,
      running_count: 0,
    },
    engines: {
      data: dataEngine,
      analysis: analysisEngine,
      prediction: predictionEngine,
    },
  };
}

// ============== Main Handler ==============

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  // ── Python canonical endpoints (primary + direct fallback) ────────────
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/admin/engines-status`,
    'http://127.0.0.1:8010/api/admin/engines-status',
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          return NextResponse.json(data);
        }
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }

  // Rule 27: honest empty — Python unreachable. No fabricated counts or
  // freshness. Admin sees "all 3 engines down" which is the truth.
  return NextResponse.json(honestEmpty());
}

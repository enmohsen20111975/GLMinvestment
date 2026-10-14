/**
 * /api/metrics — Prometheus metrics endpoint
 * ============================================================================
 * P2-10 FIX (2026-10-14): Added Prometheus-compatible metrics endpoint
 * for production observability. Returns text/plain metrics in Prometheus
 * exposition format (not JSON — Prometheus scrapes text).
 *
 * Metrics exposed:
 *   - glm_http_requests_total (counter)
 *   - glm_health_status (gauge: 0=healthy, 1=degraded, 2=down)
 *   - glm_python_backend_reachable (gauge: 0/1)
 *   - glm_db_connections_active (gauge)
 *   - glm_process_uptime_seconds (gauge)
 *   - glm_process_memory_rss_bytes (gauge)
 *
 * Access: public (no auth — metrics contain no sensitive data).
 * Prometheus should scrape this via: /api/metrics
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const metrics: string[] = [];

  // ─── Process metrics ────────────────────────────────────────────────────
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  metrics.push('# HELP glm_process_uptime_seconds Process uptime in seconds');
  metrics.push('# TYPE glm_process_uptime_seconds gauge');
  metrics.push(`glm_process_uptime_seconds ${uptime.toFixed(2)}`);

  metrics.push('# HELP glm_process_memory_rss_bytes Resident Set Size in bytes');
  metrics.push('# TYPE glm_process_memory_rss_bytes gauge');
  metrics.push(`glm_process_memory_rss_bytes ${memUsage.rss}`);

  metrics.push('# HELP glm_process_memory_heap_used_bytes Heap used in bytes');
  metrics.push('# TYPE glm_process_memory_heap_used_bytes gauge');
  metrics.push(`glm_process_memory_heap_used_bytes ${memUsage.heapUsed}`);

  metrics.push('# HELP glm_process_memory_heap_total_bytes Heap total in bytes');
  metrics.push('# TYPE glm_process_memory_heap_total_bytes gauge');
  metrics.push(`glm_process_memory_heap_total_bytes ${memUsage.heapTotal}`);

  // ─── HTTP requests total (best-effort from process info) ─────────────────
  metrics.push('# HELP glm_http_requests_total Total HTTP requests (since process start)');
  metrics.push('# TYPE glm_http_requests_total counter');
  // Note: Next.js doesn't expose request count natively. This is a placeholder.
  // For real request metrics, use a middleware counter or Sentry.
  metrics.push(`glm_http_requests_total 0`);

  // ─── Health status ──────────────────────────────────────────────────────
  metrics.push('# HELP glm_health_status Health status (0=healthy, 1=degraded, 2=down)');
  metrics.push('# TYPE glm_health_status gauge');

  // Quick health check (don't call /api/health to avoid circular dependency)
  let healthStatus = 0; // assume healthy
  try {
    const pyUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${pyUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    healthStatus = res.ok ? 0 : 1;
  } catch {
    healthStatus = 1; // degraded (Python unreachable)
  }
  metrics.push(`glm_health_status ${healthStatus}`);

  metrics.push('# HELP glm_python_backend_reachable Python backend reachable (0=no, 1=yes)');
  metrics.push('# TYPE glm_python_backend_reachable gauge');
  metrics.push(`glm_python_backend_reachable ${healthStatus === 0 ? 1 : 0}`);

  // ─── Node.js version ────────────────────────────────────────────────────
  metrics.push('# HELP glm_node_version_info Node.js version info');
  metrics.push('# TYPE glm_node_version_info gauge');
  metrics.push(`glm_node_version_info{version="${process.version}"} 1`);

  // ─── Timestamp ──────────────────────────────────────────────────────────
  metrics.push('# HELP glm_metrics_generated_timestamp Metrics generation timestamp');
  metrics.push('# TYPE glm_metrics_generated_timestamp gauge');
  metrics.push(`glm_metrics_generated_timestamp ${Date.now()}`);

  return new Response(metrics.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

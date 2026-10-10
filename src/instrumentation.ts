/**
 * instrumentation.ts — Next.js server instrumentation hook.
 *
 * Features:
 * - Initializes sql.js WASM lazily on first API request
 * - Background sync DISABLED by default to prevent server overload
 * - Use external cron service or manual API calls instead
 * - Resource Monitoring collector (TASK-B): every 15s collects system metrics
 *   and persists to db/metrics.db with tiered retention + anomaly detection
 *
 * @see https://nextjs.org/docs/app/building-your-application/configuring/instrumentation
 */

export async function register() {
  // sql.js initialization is handled lazily by egx-db.ts ensureInitialized()
  // on first API request. We cannot do it here because Edge Runtime
  // does not support Node.js 'fs' and 'path' modules used by sqlite-wrapper.
  console.log('[instrumentation] Server started - DB init deferred to first API request');
  console.log('[instrumentation] Background sync DISABLED - use external cron or manual API calls');

  // Background sync disabled to prevent server overload on shared hosting
  // To enable, set ENABLE_BACKGROUND_SYNC=true in environment variables
  // Then call /api/cron/auto-sync manually or via external cron service

  // --- Resource Monitoring Collector (TASK-B) ---
  // Polls system metrics every 15s, persists to db/metrics.db, runs tiered
  // retention every ~15 min, and runs anomaly detection every ~1 min.
  // Runs in the Node.js runtime only.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { collectSnapshot } = await import('./lib/metrics-collector');
      const { insertSnapshot, runRetention, detectAnomalies } = await import('./lib/metrics-db');

      // Initial collection on boot — don't await (fire and forget).
      void (async () => {
        try {
          const { snapshot, pm2Processes } = await collectSnapshot();
          insertSnapshot(snapshot, pm2Processes);
        } catch (e) {
          console.error('[metrics-collector] initial collect failed:', e);
        }
      })();

      let collectCount = 1; // already collected once above
      const collectInterval = setInterval(async () => {
        try {
          const { snapshot, pm2Processes } = await collectSnapshot();
          insertSnapshot(snapshot, pm2Processes);

          // Run retention every 60 collections (~15 min)
          if (collectCount % 60 === 0) {
            try {
              runRetention();
            } catch (e) {
              console.error('[metrics-collector] retention error:', e);
            }
          }

          // Detect anomalies every 4 collections (~1 min)
          if (collectCount % 4 === 0) {
            try {
              detectAnomalies();
            } catch (e) {
              console.error('[metrics-collector] anomaly error:', e);
            }
          }

          collectCount++;
        } catch (e) {
          console.error('[metrics-collector] error:', e);
        }
      }, 15_000);

      // Don't keep the process alive just for this.
      collectInterval.unref?.();

      console.log('[instrumentation] metrics collector started (every 15s)');
    } catch (e) {
      console.error('[instrumentation] failed to start metrics collector:', e);
    }
  }
}

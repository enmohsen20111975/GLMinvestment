/**
 * Health Check Endpoint — Smoke Test (P0-15)
 * ===========================================
 *
 * Verifies the contract documented in src/app/api/health/route.ts:
 *
 *   - GET /api/health returns 200 OR 503 (503 means "down", which is still
 *     a legitimate API response — the endpoint itself is working).
 *   - The response body contains the documented shape:
 *       { status, timestamp, components: { databases, ... } }
 *   - The response includes `Cache-Control: no-store` (so CDNs don't cache it).
 *
 * If localhost:3001 is not running, the suite is skipped.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:3001';
const PATH = '/api/health';

// Check server availability at MODULE LOAD time — `describe.skipIf` is
// evaluated before `beforeAll` runs, so a top-level await is required.
// NOTE: vitest's jsdom `fetch` rejects Node's `AbortSignal.timeout()` —
// implement the timeout with Promise.race instead.
async function probe(url: string, ms = 3000): Promise<boolean> {
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms)
    );
    const res = await Promise.race([fetch(url), timeout]);
    return (res as Response).ok || (res as Response).status === 503;
  } catch {
    return false;
  }
}

let serverUp = false;
serverUp = await probe(`${BASE}${PATH}`);

// eslint-disable-next-line vitest/valid-describe-callback
describe.skipIf(!serverUp)('Health Check Endpoint (GET /api/health)', () => {
  // Helper: fetch with a manual timeout (vitest's jsdom fetch rejects
  // Node's AbortSignal.timeout as "not an instance of AbortSignal").
  async function fetchWithTimeout(url: string, ms = 5000): Promise<Response> {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms)
    );
    return Promise.race([fetch(url), timeout]) as Promise<Response>;
  }

  it('returns 200 or 503 (never 500, never timeout)', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}`);
    expect([200, 503]).toContain(res.status);
  });

  it('response body has status + components + databases', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}`);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty('status');
    expect(['ok', 'degraded', 'down']).toContain(data.status);
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('components');
    const components = data.components as Record<string, unknown>;
    expect(components).toHaveProperty('databases');
    expect(components).toHaveProperty('nextjs');
    expect(components).toHaveProperty('disk');
  });

  it('databases component lists each critical DB', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}`);
    const data = (await res.json()) as {
      components: { databases: Record<string, { status: string }> };
    };
    const dbs = data.components.databases;
    expect(dbs).toHaveProperty('stocks.db');
    expect(dbs).toHaveProperty('predictions.db');
    expect(dbs).toHaveProperty('price_history.db');
    expect(dbs).toHaveProperty('data_engine.db');
  });

  it('response includes Cache-Control: no-store header', async () => {
    const res = await fetchWithTimeout(`${BASE}${PATH}`);
    const cc = res.headers.get('cache-control');
    expect(cc).toMatch(/no-store/i);
  });

  it('responds within 5 seconds (no slow DB lock)', async () => {
    const t0 = Date.now();
    const res = await fetchWithTimeout(`${BASE}${PATH}`);
    const elapsed = Date.now() - t0;
    expect(res.status).toBeTruthy(); // any non-zero is fine
    expect(elapsed, `health check took ${elapsed}ms`).toBeLessThan(5000);
  });
});

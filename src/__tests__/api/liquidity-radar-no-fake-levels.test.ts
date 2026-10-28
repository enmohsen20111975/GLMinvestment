/**
 * ISSUE-3: Liquidity Radar API — no fabricated entry/stop/target levels
 * =========================================================================
 *
 * Issue: https://github.com/enmohsen20111975/GLMinvestment/issues/3
 *
 * Verifies the route handler NO LONGER manufactures plausible-looking
 * trading levels via fixed-percentage fallbacks. Specifically:
 *
 *   BEFORE (forbidden, removed by ISSUE-3):
 *     defense_level  = stop_loss ?? srMap.support ?? (entry * 0.97)         ← 3% guess
 *     resistance_lvl = target_price ?? srMap.resistance ?? (entry + 1.5*r)  ← R/R guess
 *     entry_level    = entry_price ?? current_price ?? null                  ← entry fabrication
 *
 *   AFTER (honest — what these tests lock in):
 *     entry_level    = entry_price (from API cache) or null
 *     defense_level  = stop_loss (from API cache) OR stocks.db.support or null
 *     resistance_lvl = target_price (from API cache) OR stocks.db.resistance or null
 *     null → UI renders "—" via fmtPrice(null)
 *
 * Scenarios covered (acceptance from Issue #3):
 *   1. Fully valid calculated levels from API → preserved unchanged.
 *   2. Missing entry_price (current_price present) → entry_level=null. NO fabrication.
 *   3. Missing stop_loss (no srMap) → defense_level=null. NO `entry * 0.97`.
 *   4. Missing target_price (no srMap) → resistance_level=null. NO `entry + 1.5 * risk`.
 *   5. All-missing scenario → all three null (honest "—" row in UI).
 *   6. srMap provides support/resistance → those surface as defense/resistance.
 *   7. Zero / negative / NaN values in API → null (not the bogus value).
 *   8. No `current_price` leak into entry_level (anti-fabrication guard).
 *   9. Empty cache → 200 + empty stocks list (missing-data ≠ empty radar).
 *
 * Run:
 *   bunx vitest run src/__tests__/api/liquidity-radar-no-fake-levels.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock radar-cache BEFORE importing the route ────────────────────────
// We control exactly what the cache returns so the test is deterministic.
const readRadarCacheMock = vi.fn();
vi.mock('@/modules/radar/lib/radar-cache', () => ({
  readRadarCache: (...args: unknown[]) => readRadarCacheMock(...args),
}));

// ─── Mock @/lib/egx-db so buildSupportResistanceMap is controllable ────
// Default: stocks.db unavailable (empty map). Per-test override.
const getStocksDbMock = vi.fn();
vi.mock('@/lib/egx-db', () => ({
  getStocksDb: (...args: unknown[]) => getStocksDbMock(...args),
}));

// ─── Mock @/lib/server-url (defensive — some imports pull it transitively)
vi.mock('@/lib/server-url', () => ({
  getServerUrl: () => 'http://localhost:3000',
  API_BASE: '/api',
}));

// Import AFTER mocks above are registered.
import { GET } from '@/app/api/v2/liquidity-radar/route';
import type { NextRequest } from 'next/server';

// ─── Helpers ────────────────────────────────────────────────────────────
function makeReq(market = 'EGX'): NextRequest {
  // The route handler only reads `req.url`. A plain Request suffices
  // because NextRequest extends Request and we don't use Next-specific APIs.
  return new Request(
    `http://localhost/api/v2/liquidity-radar?market=${market}`
  ) as unknown as NextRequest;
}

/** Build a radar cache payload mimicking scripts/maker_radar.py output. */
function makeCache(stocks: Array<Record<string, unknown>>) {
  return {
    data: {
      generated_at: new Date().toISOString(),
      market_regime: { regime: 'NORMAL', index_daily_change_pct: 0.3 },
      quiet_list: stocks,
      pre_surge_list: [],
      explosive_list: [],
      early_break_list: [],
      distribution_list: [],
      under_microscope: [],
      stocks: [],
      total_scanned: stocks.length,
      phases_breakdown: {},
    },
    filePath: '/dev/null/maker_radar_EGX_20261025.json',
  };
}

/** Build a fake stocks.db handle with the `prepare(...).all()` chain used by the route. */
function makeStocksDb(rows: Array<{ ticker: string; support: number | null; resistance: number | null }>) {
  return {
    prepare: () => ({
      all: () => rows,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe('ISSUE-3: /api/v2/liquidity-radar — no fabricated entry/stop/target', () => {
  beforeEach(() => {
    readRadarCacheMock.mockReset();
    getStocksDbMock.mockReset();
    // Default: no stocks.db → empty srMap → defense/resistance must come from API only
    getStocksDbMock.mockImplementation(() => {
      throw new Error('stocks.db unavailable in test');
    });
  });

  // ── 1) Fully valid calculated levels from API → preserved unchanged ──
  it('preserves real entry_price/stop_loss/target_price from API', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          entry_price: 25.40,
          stop_loss: 23.10,
          target_price: 30.50,
          current_price: 25.42,
          path: 'A_pre_surge',
          net_flow_egp: 1_500_000,
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.stocks).toHaveLength(1);

    const ed = json.stocks[0].entry_defense;
    expect(ed.entry_level).toBe(25.40);
    expect(ed.defense_level).toBe(23.10);
    expect(ed.resistance_level).toBe(30.50);
  });

  // ── 2) Missing entry_price (current_price present) → entry_level=null ──
  // Anti-fabrication: current_price is the live market price, NOT an entry level.
  it('returns entry_level=null when entry_price is missing even if current_price exists', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          // entry_price intentionally absent
          current_price: 25.42,
          stop_loss: 23.10,
          target_price: 30.50,
          path: 'B_quiet_accumulation_strong',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBeNull(); // ← honest "—" in UI
    // stop/target are documented → preserved
    expect(ed.defense_level).toBe(23.10);
    expect(ed.resistance_level).toBe(30.50);
  });

  // ── 3) Missing stop_loss + no srMap → defense_level=null (NO entry*0.97) ──
  it('returns defense_level=null when stop_loss missing and stocks.db unavailable', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          entry_price: 25.40,
          // stop_loss intentionally absent
          target_price: 30.50,
          current_price: 25.42,
          path: 'A_pre_surge',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBe(25.40); // preserved
    expect(ed.defense_level).toBeNull(); // ← NOT 25.40 * 0.97 = 24.638
    expect(ed.defense_level).not.toBeCloseTo(24.638, 2); // explicit anti-fabrication guard
    expect(ed.resistance_level).toBe(30.50); // preserved
  });

  // ── 4) Missing target_price + no srMap → resistance_level=null (NO entry+1.5*risk) ──
  it('returns resistance_level=null when target_price missing and stocks.db unavailable', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          entry_price: 25.40,
          stop_loss: 23.10,
          // target_price intentionally absent
          current_price: 25.42,
          path: 'A_pre_surge',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBe(25.40); // preserved
    expect(ed.defense_level).toBe(23.10); // preserved
    expect(ed.resistance_level).toBeNull(); // ← NOT 25.40 + 1.5*(25.40-23.10) = 28.85
    expect(ed.resistance_level).not.toBeCloseTo(28.85, 2); // explicit anti-fabrication guard
  });

  // ── 5) All-missing scenario → all three null (honest "—" row in UI) ──
  it('returns all three levels null when API provides none and stocks.db is unavailable', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          // entry_price / stop_loss / target_price all absent
          current_price: 25.42,
          path: 'C_quiet_accumulation_weak',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBeNull();
    expect(ed.defense_level).toBeNull();
    expect(ed.resistance_level).toBeNull();
  });

  // ── 6) srMap provides support/resistance → surface as defense/resistance ──
  it('surfaces stocks.db support/resistance as defense/resistance when API levels missing', async () => {
    getStocksDbMock.mockReturnValue(
      makeStocksDb([
        { ticker: 'COMI', support: 22.80, resistance: 29.50 },
      ])
    );
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          entry_price: 25.40,
          // stop_loss + target_price absent → fall back to documented S/R columns
          current_price: 25.42,
          path: 'A_pre_surge',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBe(25.40); // preserved
    expect(ed.defense_level).toBe(22.80); // ← from stocks.db.support (legitimate)
    expect(ed.resistance_level).toBe(29.50); // ← from stocks.db.resistance (legitimate)
  });

  // ── 7) Zero / negative / NaN values → null (not the bogus value) ───────
  it('rejects zero / negative / NaN API values and returns null instead', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'BAD0',
          entry_price: 0, // zero → not a valid entry
          stop_loss: -5, // negative → invalid
          target_price: NaN, // NaN → invalid
          current_price: 10,
          path: 'A_pre_surge',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    expect(ed.entry_level).toBeNull();
    expect(ed.defense_level).toBeNull();
    expect(ed.resistance_level).toBeNull();
  });

  // ── 8) current_price leak guard: never appears in entry_level ─────────
  it('never lets current_price leak into entry_level', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'COMI',
          // entry_price absent, current_price present — old code would fabricate entry=current_price
          current_price: 25.42,
          stop_loss: 23.10,
          target_price: 30.50,
          path: 'A_pre_surge',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    const ed = json.stocks[0].entry_defense;

    // entry_level must NOT be the current_price (25.42)
    expect(ed.entry_level).not.toBe(25.42);
    expect(ed.entry_level).not.toBeCloseTo(25.42, 2);
    expect(ed.entry_level).toBeNull();
  });

  // ── 9) Empty cache → 200 + empty stocks list (missing-data ≠ empty radar) ──
  it('returns 200 + empty stocks list when no cache exists (missing-data path)', async () => {
    readRadarCacheMock.mockReturnValue(null);

    const res = await GET(makeReq('EGX'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.stocks).toEqual([]);
    expect(json.message).toContain('لا توجد بيانات رادار'); // distinct from "valid empty radar"
  });

  // ── 10) Multiple stocks: mixed presence/absence stays per-stock honest ──
  it('handles mixed stocks without cross-contamination of fabricated values', async () => {
    readRadarCacheMock.mockReturnValue(
      makeCache([
        {
          ticker: 'FULL',
          entry_price: 100,
          stop_loss: 90,
          target_price: 120,
          current_price: 100,
          path: 'A_pre_surge',
        },
        {
          ticker: 'EMPTY',
          current_price: 50,
          path: 'C_quiet_accumulation_weak',
        },
        {
          ticker: 'PARTIAL',
          entry_price: 200,
          current_price: 201,
          path: 'B_quiet_accumulation_strong',
        },
      ])
    );

    const res = await GET(makeReq('EGX'));
    const json = await res.json();
    expect(json.stocks).toHaveLength(3);

    const full = json.stocks[0].entry_defense;
    const empty = json.stocks[1].entry_defense;
    const partial = json.stocks[2].entry_defense;

    // FULL: all preserved
    expect(full.entry_level).toBe(100);
    expect(full.defense_level).toBe(90);
    expect(full.resistance_level).toBe(120);

    // EMPTY: all null — no fabrication, no leak from FULL
    expect(empty.entry_level).toBeNull();
    expect(empty.defense_level).toBeNull();
    expect(empty.resistance_level).toBeNull();
    // explicit anti-contamination guards
    expect(empty.entry_level).not.toBe(100);
    expect(empty.defense_level).not.toBe(90);
    expect(empty.resistance_level).not.toBe(120);

    // PARTIAL: entry preserved, stop/target null (no fabrication from entry)
    expect(partial.entry_level).toBe(200);
    expect(partial.defense_level).toBeNull(); // NOT 200 * 0.97 = 194
    expect(partial.defense_level).not.toBeCloseTo(194, 0);
    expect(partial.resistance_level).toBeNull(); // NOT 200 + 1.5*(200-194) = 209
    expect(partial.resistance_level).not.toBeCloseTo(209, 0);
  });

  // ── 11) Forbidden pattern guard: source code no longer contains the fabrication ──
  it('source code has removed the entry*0.97 and entry+1.5*risk fabrication', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routeSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/v2/liquidity-radar/route.ts'),
      'utf-8'
    );

    // The forbidden fixed-percentage fallbacks must NOT appear as live code.
    // (Comments explicitly mentioning them as REMOVED are allowed — they document the fix.)
    // Strip comments + strings before asserting, so only live code is checked.
    const liveCode = routeSrc
      .replace(/\/\/.*$/gm, '') // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/'[^']*'/g, "''") // single-quoted strings
      .replace(/"[^"]*"/g, '""'); // double-quoted strings

    expect(liveCode).not.toMatch(/_entry\s*\*\s*0\.97/);
    expect(liveCode).not.toMatch(/entry\s*\*\s*0\.97/);
    expect(liveCode).not.toMatch(/1\.5\s*\*\s*_?risk/);
    expect(liveCode).not.toMatch(/_entry\s*\+\s*1\.5/);
    // entry_level fallback to current_price (forbidden):
    expect(liveCode).not.toMatch(/entry_level\s*:\s*s\.entry_price\s*\?\?\s*s\.current_price/);
  });
});

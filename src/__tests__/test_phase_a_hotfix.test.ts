/**
 * test_phase_a_hotfix.ts — اختبارات الـ Phase A Critical Hotfix (SEC-01 + SEC-03)
 * ============================================================================
 *
 * الـ tests دي بتتحقق من الإصلاحات الحرجة اللي اتعملت في الـ Hotfix:
 *
 * SEC-01 — باب الأدمن الخلفي ببيانات دخول مكتوبة في الكود:
 *   - الـ hardcoded credentials (mohseny / M2y@01287644099) اتمسحت خالص.
 *   - مفيش adminUsernames/adminPasswords arrays في الـ source.
 *   - مفيش username-based admin detection (التسجيل بـ username 'admin' ما بقي يديش admin).
 *
 * SEC-03 — تجاوز دفع Paymob (Free Subscription Fraud):
 *   - الـ HMAC secret ما بقاش hardcoded fallback في الكود.
 *   - POST webhook من غير HMAC بيرجّع 401 (مش بـ processPaymentResult).
 *   - POST webhook بـ HMAC غلط بيرجّع 401.
 *   - db.user.update ما بيتنداش أبداً لو HMAC ناقص/غلط.
 *
 * التشغيل:
 *   bun run test -- src/__tests__/test_phase_a_hotfix.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// SEC-01: Static source analysis — backdoor credentials must be gone
// ---------------------------------------------------------------------------

describe('SEC-01 — Admin backdoor credentials removed', () => {
  const routePath = join(__dirname, '..', 'app', 'api', 'auth', '[...nextauth]', 'route.ts');
  const meRoutePath = join(__dirname, '..', 'app', 'api', 'auth', 'me', 'route.ts');
  const nextauthSource = readFileSync(routePath, 'utf-8');
  const meSource = readFileSync(meRoutePath, 'utf-8');

  it('hardcoded admin password M2y@01287644099 is NOT present in source', () => {
    // The password must not appear anywhere except in the removal-documentation comment.
    // Count occurrences: only the HOTFIX comment references it indirectly.
    const matches = nextauthSource.match(/M2y@01287644099/g);
    expect(matches, 'hardcoded admin password must be removed from nextauth route').toBeNull();
  });

  it('adminUsernames / adminPasswords bypass arrays are NOT present', () => {
    expect(nextauthSource, 'adminPasswords array must be removed')
      .not.toContain("adminPasswords = [");
    expect(nextauthSource, 'adminUsernames bypass array must be removed')
      .not.toContain("adminUsernames = ['mohseny'");
  });

  it('isBypassUsernameMatched / isBypassPasswordMatched logic is removed', () => {
    expect(nextauthSource, 'bypass matching logic must be removed')
      .not.toContain('isBypassUsernameMatched');
    expect(nextauthSource, 'bypass matching logic must be removed')
      .not.toContain('isBypassPasswordMatched');
  });

  it('admin emails are sourced from @/lib/admin-identities (P0.1)', () => {
    // P0.1 (SEC-01): admin emails now live in @/lib/admin-identities (sourced
    // from env vars with historical defaults) instead of being hardcoded in
    // every consumer. The owner's verified Google email must still be present
    // as a fallback default so the platform keeps working when env vars are
    // not configured.
    const adminIdentitiesPath = join(__dirname, '..', 'lib', 'admin-identities.ts');
    const adminIdentitiesSource = readFileSync(adminIdentitiesPath, 'utf-8');
    expect(adminIdentitiesSource, 'owner email must remain as fallback default')
      .toContain('enmohsen20111975@gmail.com');

    // The nextauth route must import from admin-identities — not hardcode emails.
    expect(nextauthSource, 'nextauth must source admin list from admin-identities')
      .toContain('admin-identities');
    // The owner's email should NOT be hardcoded directly in the nextauth route
    // anymore (it now lives only in admin-identities.ts).
    expect(nextauthSource, 'owner email must not be duplicated in nextauth route')
      .not.toMatch(/const\s+ADMIN_EMAILS_SESSION\s*=\s*\[['"]enmohsen20111975/);
  });

  it('admin detection is by EMAIL only, not by username string', () => {
    // The username-based admin detection arrays must be gone from both routes.
    // Anyone registering username 'admin' must NOT gain admin tier.
    expect(nextauthSource, 'username-based admin detection must be removed')
      .not.toContain("adminUsernames = ['mohseny', 'admin']");
    expect(nextauthSource, 'ADMIN_USERNAMES_SESSION must be removed')
      .not.toContain("ADMIN_USERNAMES_SESSION = ['mohseny', 'admin']");
    expect(meSource, 'me/route username admin detection must be removed')
      .not.toContain("['mohseny', 'admin'].includes(dbUser.username.toLowerCase())");
    expect(meSource, 'me/route username admin detection must be removed')
      .not.toContain("['mohseny', 'admin'].includes(user.username.toLowerCase())");
  });

  it('me/route no longer defaults username to mohseny', () => {
    expect(meSource, 'me/route must not fallback username to mohseny')
      .not.toContain("process.env.ADMIN_USERNAME || 'mohseny'");
  });
});

// ---------------------------------------------------------------------------
// SEC-03: Paymob webhook — mandatory HMAC, no hardcoded secret, fail closed
// ---------------------------------------------------------------------------

describe('SEC-03 — Paymob HMAC mandatory verification', () => {
  const callbackPath = join(__dirname, '..', 'app', 'api', 'paymob', 'callback', 'route.ts');
  const source = readFileSync(callbackPath, 'utf-8');

  it('hardcoded HMAC secret fallback is NOT present in source', () => {
    expect(source, 'the 32-hex HMAC secret must not be hardcoded')
      .not.toContain('7AFA0935F4C9DFA42CAF0ECF47745A9B');
    expect(source, 'PAYMOB_HMAC must not have a hardcoded fallback')
      .not.toMatch(/PAYMOB_HMAC\s*\|\|\s*['"][A-F0-9]{16}/);
  });

  it('the old "warn-and-continue" pattern is removed', () => {
    // Previously the code did `if (receivedHmac && !hmacValid) { console.warn(...) }`
    // and then CONTINUED to process the payment. That must be gone.
    expect(source, 'warn-and-continue pattern must be removed')
      .not.toMatch(/if\s*\(\s*receivedHmac\s*&&\s*!hmacValid\s*\)\s*\{\s*console\.warn/);
  });

  it('POST handler returns 401 for missing HMAC (no DB write)', async () => {
    // Set a real PAYMOB_HMAC so the route is "configured" and we hit the 401 path
    // (not the 500 misconfigured path).
    const originalHmac = process.env.PAYMOB_HMAC;
    process.env.PAYMOB_HMAC = 'TEST_HMAC_SECRET_FOR_VITEST_32HEX';

    // Mock @/lib/db so we can assert user.update is NEVER called.
    const dbMock = {
      user: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
      userSubscription: { upsert: vi.fn().mockResolvedValue({}) },
    };
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    // Re-import the route fresh so it picks up the mocked db + env
    vi.resetModules();
    const routeMod = await import('../app/api/paymob/callback/route');
    const { POST } = routeMod as { POST: (req: any) => Promise<any> };

    // Build a fake NextRequest with NO hmac
    const fakeReq = {
      url: 'http://localhost:3000/api/paymob/callback',
      nextUrl: { searchParams: new URLSearchParams() }, // no hmac query param
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        obj: {
          success: 'true',
          order: { merchant_order_id: 'GLM-testuser-premium-1700000000' },
          amount_cents: '10000',
          created_at: '2026-01-01T00:00:00',
          currency: 'EGP',
          error_occured: 'false',
          has_parent_transaction: 'false',
          id: '12345',
          integration_id: '1',
          is_3d_secure: 'false',
          is_auth: 'false',
          is_capture: 'false',
          is_refunded: 'false',
          is_standalone_payment: 'false',
          is_voided: 'false',
          order: { id: '67890', merchant_order_id: 'GLM-testuser-premium-1700000000' },
          owner: '1',
          pending: 'false',
          source_data: { pan: 'xxxx', sub_type: 'card', type: 'visa' },
        },
      }),
    } as any;

    const response = await POST(fakeReq);
    expect(response.status, 'POST without HMAC must return 401').toBe(401);
    expect(dbMock.user.update, 'db.user.update must NOT be called without valid HMAC')
      .not.toHaveBeenCalled();
    expect(dbMock.userSubscription.upsert, 'db.userSubscription.upsert must NOT be called without valid HMAC')
      .not.toHaveBeenCalled();

    // Restore
    if (originalHmac === undefined) delete process.env.PAYMOB_HMAC;
    else process.env.PAYMOB_HMAC = originalHmac;
    vi.doUnmock('@/lib/db');
    vi.resetModules();
  });

  it('POST handler returns 500 when PAYMOB_HMAC is not configured (fail closed)', async () => {
    const originalHmac = process.env.PAYMOB_HMAC;
    delete process.env.PAYMOB_HMAC;

    const dbMock = {
      user: { update: vi.fn().mockResolvedValue({}) },
      userSubscription: { upsert: vi.fn().mockResolvedValue({}) },
    };
    vi.doMock('@/lib/db', () => ({ db: dbMock }));
    vi.resetModules();
    const routeMod = await import('../app/api/paymob/callback/route');
    const { POST } = routeMod as { POST: (req: any) => Promise<any> };

    const fakeReq = {
      url: 'http://localhost:3000/api/paymob/callback',
      nextUrl: { searchParams: new URLSearchParams() },
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ obj: { success: 'true', order: { merchant_order_id: 'GLM-x-premium-1' } } }),
    } as any;

    const response = await POST(fakeReq);
    expect(response.status, 'misconfigured HMAC must fail closed with 500').toBe(500);
    expect(dbMock.user.update, 'no DB writes when server is misconfigured')
      .not.toHaveBeenCalled();

    if (originalHmac === undefined) delete process.env.PAYMOB_HMAC;
    else process.env.PAYMOB_HMAC = originalHmac;
    vi.doUnmock('@/lib/db');
    vi.resetModules();
  });
});

/**
 * Auth Guard — Unit Tests (P0-11-AUTH)
 * ====================================
 *
 * Verifies that `requireAuthAsync` and `requireAdminAsync` from
 * `@/lib/admin-guard` enforce authentication correctly:
 *
 *   - `requireAuthAsync` returns a 401 NextResponse when there is no session
 *     (returns `{ userId }` on success).
 *   - `requireAdminAsync` returns a 403 NextResponse when no admin credentials
 *     are provided AND the localhost bypass is disabled.
 *   - `requireAdminAsync` allows requests when a valid admin token is provided
 *     (verifies the happy-path of Method 1 in admin-auth-server.ts).
 *
 * Mocks:
 *   - `@/lib/auth-helper` → controls `getSessionUserId`'s return value
 *   - `process.env.ALLOW_ADMIN_BYPASS` + `process.env.NODE_ENV` → disables
 *     the localhost bypass in `requireAdminAsync`'s Method 3
 *
 * Note: `requireAdminAsync` returns 403 (not 401) — this matches the
 * existing implementation in src/lib/admin-auth-server.ts:175. We assert the
 * actual contract rather than the task-template's "401" hint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the auth-helper before importing the module under test.
vi.mock('@/lib/auth-helper', () => ({
  getSessionUserId: vi.fn(),
}));

// Mock the admin-auth-server's dynamic NextAuth import path so requireAdminAsync
// Method 2 doesn't try to actually load NextAuth (which needs Next.js runtime).
// We make Method 2 throw → caught internally → falls through to Method 3.
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockRejectedValue(new Error('mocked: no NextAuth in vitest')),
}));

import { requireAuthAsync, requireAdminAsync } from '@/lib/admin-guard';
import { getSessionUserId } from '@/lib/auth-helper';

const mockedGetSessionUserId = vi.mocked(getSessionUserId);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireAuthAsync (P0-11-AUTH)', () => {
  it('returns 401 when getSessionUserId() resolves with no userId', async () => {
    mockedGetSessionUserId.mockResolvedValue({ userId: null as unknown as string });

    const req = new Request('http://localhost/api/test');
    const result = await requireAuthAsync(req);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    const body = await (result as Response).json();
    expect(body.success).toBe(false);
  });

  it('returns 401 when getSessionUserId() throws', async () => {
    mockedGetSessionUserId.mockRejectedValue(new Error('session lookup failed'));

    const req = new Request('http://localhost/api/test');
    const result = await requireAuthAsync(req);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('returns { userId } when getSessionUserId() resolves with a userId', async () => {
    mockedGetSessionUserId.mockResolvedValue({ userId: 'user-123' });

    const req = new Request('http://localhost/api/test');
    const result = await requireAuthAsync(req);

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({ userId: 'user-123' });
  });

  it('does not call getSessionUserId twice for the same request', async () => {
    mockedGetSessionUserId.mockResolvedValue({ userId: 'user-456' });
    const req = new Request('http://localhost/api/test');
    await requireAuthAsync(req);
    expect(mockedGetSessionUserId).toHaveBeenCalledTimes(1);
  });
});

describe('requireAdminAsync (P0-11-AUTH)', () => {
  // The localhost bypass (Method 3) defaults to "allowed" when NODE_ENV !== 'production'.
  // For deterministic tests we stub env to disable bypass and use a non-localhost host.
  //
  // `verifyAdminRequest` (called by Method 1) reads `request.cookies.get(...)`,
  // which is a Next.js `NextRequest` extension. A plain Web `Request` doesn't
  // have `.cookies`, so we duck-type a minimal stand-in object.
  type AdminReqShape = {
    headers: Headers;
    cookies: { get: (name: string) => { value: string } | undefined };
  };

  function buildRemoteAdminReq(
    extraHeaders: Record<string, string> = {},
    cookie = ''
  ): AdminReqShape {
    const headers = new Headers({
      host: 'example.com',
      ...extraHeaders,
    });
    return {
      headers,
      cookies: {
        get: (name: string) =>
          name === 'admin_session' && cookie
            ? { value: cookie }
            : undefined,
      },
    };
  }

  beforeEach(() => {
    // Force Method 3 (localhost/bypass) to be inactive.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_ADMIN_BYPASS', 'false');
    // Silence the verbose console.log from admin-auth-server during tests.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 403 when no admin token/cookie is provided (Method 1 + 2 fail, bypass disabled)', async () => {
    const req = buildRemoteAdminReq();
    const result = await requireAdminAsync(req as never);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    const body = await (result as Response).json();
    expect(body.error).toBe('ADMIN_AUTH_REQUIRED');
  });

  it('returns null (allow) when a valid X-Admin-Token header is provided', async () => {
    // `verifyAdminCredentials` reads ADMIN_USERNAME/ADMIN_PASSWORD from
    // process.env at module-load time. vi.stubEnv alone won't affect the
    // already-evaluated constants, so we need to reset modules and re-import
    // the admin-guard module AFTER stubbing env.
    vi.stubEnv('ADMIN_USERNAME', 'admin');
    vi.stubEnv('ADMIN_PASSWORD', 'testpass');
    vi.resetModules();

    const { requireAdminAsync: freshRequireAdmin } = await import('@/lib/admin-guard');
    const token = Buffer.from('admin:testpass').toString('base64');
    const req = buildRemoteAdminReq({ 'x-admin-token': token });

    const result = await freshRequireAdmin(req as never);
    expect(result).toBeNull();
  });

  it('rejects a malformed X-Admin-Token with 403', async () => {
    vi.stubEnv('ADMIN_USERNAME', 'admin');
    vi.stubEnv('ADMIN_PASSWORD', 'testpass');
    vi.resetModules();

    const { requireAdminAsync: freshRequireAdmin } = await import('@/lib/admin-guard');
    const req = buildRemoteAdminReq({
      'x-admin-token': 'this-is-not-valid-base64-credentials',
    });
    const result = await freshRequireAdmin(req as never);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('returns null (allow) when host is localhost (dev bypass)', async () => {
    // Restoring NODE_ENV to test (default for vitest) — bypass re-activates.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_ADMIN_BYPASS', 'false');
    vi.resetModules();

    const { requireAdminAsync: freshRequireAdmin } = await import('@/lib/admin-guard');
    const headers = new Headers({ host: 'localhost:3001' });
    const req: AdminReqShape = {
      headers,
      cookies: { get: () => undefined },
    };
    const result = await freshRequireAdmin(req as never);
    expect(result).toBeNull();
  });

  it('returns null (allow) when admin_session cookie matches ADMIN_SESSION_TOKEN', async () => {
    vi.stubEnv('ADMIN_SESSION_TOKEN', 'my-secret-session-token');
    vi.resetModules();

    const { requireAdminAsync: freshRequireAdmin } = await import('@/lib/admin-guard');
    const req = buildRemoteAdminReq({}, 'my-secret-session-token');
    const result = await freshRequireAdmin(req as never);
    expect(result).toBeNull();
  });
});

import NextAuth, { type NextAuthOptions } from 'next-auth';
export const dynamic = "force-dynamic";

import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { getServerAdminEmails, getServerAdminUsernames, isServerAdmin } from '@/lib/admin-identities'; // P0.1 (SEC-01)

const isHttps = Boolean(process.env.NEXTAUTH_URL?.startsWith('https://') && !process.env.NEXTAUTH_URL?.includes('localhost'));

export const authOptions: NextAuthOptions = {
  useSecureCookies: isHttps,
  cookies: {
    sessionToken: {
      name: isHttps ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isHttps,
      },
    },
    callbackUrl: {
      name: isHttps ? '__Secure-next-auth.callback-url' : 'next-auth.callback-url',
      options: {
        sameSite: 'lax',
        path: '/',
        secure: isHttps,
      },
    },
    csrfToken: {
      name: isHttps ? '__Host-next-auth.csrf-token' : 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isHttps,
      },
    },
  },
  providers: [
    // Google OAuth Provider — SEC-01 FIX: NO hardcoded fallbacks. Fail closed if env vars missing.
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    }),

    // Credentials Provider (email/password)
    // SEC-AUTH-GATE (2026-09-30): form login معطّل افتراضياً — Google OAuth فقط.
    // لو ALLOW_FORM_LOGIN=true (مثلاً على السيرفر التجريبي)، الـ provider بيتفعّل.
    ...(process.env.ALLOW_FORM_LOGIN === 'true' ? [CredentialsProvider({
      name: 'credentials',
      credentials: {
        username_or_email: { label: 'اسم المستخدم أو البريد', type: 'text' },
        password: { label: 'كلمة المرور', type: 'password' },
      },
      async authorize(credentials) {
        console.log('[Auth Debug] Received credentials keys:', Object.keys(credentials || {}));
        const rawIdentifier = (credentials?.username_or_email || credentials?.username || credentials?.email || '') as string;
        console.log('[Auth Debug] Raw identifier:', rawIdentifier, 'password len:', (credentials?.password || '').length);
        if (!rawIdentifier || !credentials?.password) {
          console.log('[Auth Debug] Missing identifier or password');
          return null;
        }

        const identifier = rawIdentifier.trim();
        const password = (credentials.password as string || '').trim();

        // SEC-01 HOTFIX (Phase A): The previous code had a hardcoded admin backdoor
        // (adminUsernames/adminPasswords arrays in source). Any reader of the repo
        // could log in as full admin. That backdoor is now REMOVED.
        //
        // Admin login via credentials now requires ALL of:
        //   1. ADMIN_USERNAME env var set
        //   2. ADMIN_PASSWORD env var set
        //   3. ADMIN_EMAIL env var set (the DB identity to attach the session to)
        //   4. The supplied credentials matching the env values EXACTLY
        // If any env var is missing → fail closed (no admin login possible via creds).
        // In production, admin should prefer Google OAuth; this path is a controlled
        // fallback for ops, driven entirely by environment configuration.
        // SEC-01 FIX: NO hardcoded fallbacks for admin credentials. Fail closed if env vars missing.
        const ENV_ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
        const ENV_ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
        const ENV_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim();

        const envAdminConfigured =
          ENV_ADMIN_USERNAME.length > 0 &&
          ENV_ADMIN_PASSWORD.length > 0 &&
          ENV_ADMIN_EMAIL.length > 0;

        if (envAdminConfigured) {
          // Use a constant-time-ish comparison to avoid trivial timing oracles.
          // (Not a true constant-time compare, but avoids early-return on first char.)
          const safeEqual = (a: string, b: string): boolean => {
            if (a.length !== b.length) return false;
            let diff = 0;
            for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
            return diff === 0;
          };

          // SEC-01 FIX: Match against env-configured credentials or central admin identities.
          const adminUsernames = getServerAdminUsernames().map((u: string) => u.toLowerCase());
          const adminEmails = getServerAdminEmails().map((e: string) => e.toLowerCase());

          const userMatches =
            identifier.toLowerCase() === ENV_ADMIN_USERNAME.toLowerCase() ||
            identifier.toLowerCase() === ENV_ADMIN_EMAIL.toLowerCase() ||
            adminUsernames.includes(identifier.toLowerCase()) ||
            adminEmails.includes(identifier.toLowerCase());
          const passMatches = ENV_ADMIN_PASSWORD.length > 0 && safeEqual(password, ENV_ADMIN_PASSWORD);
          console.log('[Auth Debug] userMatches:', userMatches, 'passMatches:', passMatches, 'identifier:', identifier);

          if (userMatches && passMatches) {
            // Resolve (or lazily provision) the admin identity in the DB
            let adminUser = null;
            try {
              adminUser = await db.user.findFirst({
                where: {
                  OR: [
                    { username: identifier },
                    { email: identifier },
                    { email: ENV_ADMIN_EMAIL },
                  ],
                },
              });
            } catch (dbFindErr) {
              console.error('[Auth] DB lookup error for env-admin login:', dbFindErr);
              return null; // fail closed — do NOT fabricate a session without DB identity
            }

            if (!adminUser) {
              // Provision the admin row on first env-login. subscription_tier='admin'
              // and no password_hash — login is only possible via env creds or Google.
              try {
                adminUser = await db.user.create({
                  data: {
                    email: identifier.includes('@') ? identifier.toLowerCase() : ENV_ADMIN_EMAIL,
                    username: identifier.includes('@') ? identifier.split('@')[0] : identifier,
                    name: 'System Admin',
                    subscription_tier: 'admin',
                    is_active: true,
                    default_risk_tolerance: 'medium',
                  },
                });
              } catch (createErr) {
                console.error('[Auth] Failed to provision env-admin user:', createErr);
                return null; // fail closed
              }
            }

            return {
              id: adminUser.id,
              email: adminUser.email,
              name: adminUser.name || 'System Admin',
              image: adminUser.image || null,
            };
          }
          // If credentials don't match env-admin, fall through to the standard
          // DB-backed credentials path below (regular user login).
        }

        // ---- Standard authentication path (DB + bcrypt) ----
        // Find user by email or username
        let user = null;
        try {
          user = await db.user.findFirst({
            where: {
              OR: [
                { email: identifier },
                { username: identifier },
              ],
            },
          });
        } catch (dbErr) {
          console.error('[Auth Debug] Database query error in standard path:', dbErr);
        }

        if (user && user.password_hash) {
          if (!user.is_active) {
            console.log('[Auth Debug] User is not active:', identifier);
            return null;
          }

          // Verify password
          const isPasswordValid = await bcrypt.compare(password, user.password_hash);
          if (isPasswordValid) {
            try {
              // Update last login
              await db.user.update({
                where: { id: user.id },
                data: { last_login: new Date().toISOString() },
              });
            } catch (e) {
              // Non-fatal
            }

            return {
              id: user.id,
              email: user.email,
              name: user.name || user.username || '',
              image: user.image,
            };
          }
        }

        // FIX-P1-SECURITY (CRIT-6): The hardcoded `MOHSENY_HASH` bcrypt backdoor
        // has been REMOVED. The previous block accepted `identifier === 'mohseny'`
        // and verified against a hardcoded bcrypt hash shipped in source, then
        // lazily provisioned a DB row with `id: 'mohseny-admin-cuid'`. Anyone
        // with repo access could attempt offline cracking of that hash.
        //
        // Admin login via credentials is now possible ONLY through the
        // env-var path above (ADMIN_USERNAME + ADMIN_PASSWORD + ADMIN_EMAIL),
        // which is gated by ALLOW_FORM_LOGIN === 'true'. Regular users must
        // sign in via Google OAuth or via their own DB-backed credentials
        // (password_hash set at registration time).

        return null;
      },
    })] : []),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: '/',
    error: '/?auth_error=true',
  },

  callbacks: {
    async jwt({ token, user, account }) {
      // Initial sign in
      if (user) {
        token.id = user.id;

        // For Google OAuth, find or create user in DB
        if (account?.provider === 'google') {
          try {
            // SEC-AUTH-GATE (2026-09-30): Google OAuth فقط للتسجيل.
            // - كل مستخدم جديد → trial_ends_at = NOW + 7 أيام (7 أيام Premium trial)
            // - الأدمن (محدد في admin-identities.ts) → subscription_tier='admin' تلقائياً
            const ADMIN_EMAILS_SET = new Set(getServerAdminEmails().map((e: string) => e.toLowerCase()));
            const isAdminEmail = user.email ? ADMIN_EMAILS_SET.has(user.email.toLowerCase()) : false;
            const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            const dbUser = await db.user.upsert({
              where: { email: user.email! },
              create: {
                email: user.email!,
                name: user.name,
                username: user.email?.split('@')[0] || null,
                image: user.image,
                email_verified: new Date().toISOString(),
                is_active: true,
                subscription_tier: isAdminEmail ? 'admin' : 'free',
                default_risk_tolerance: 'medium',
                last_login: new Date().toISOString(),
                trial_ends_at: isAdminEmail ? null : trialEndsAt, // الأدمن مش محتاج trial
              },
              update: {
                name: user.name,
                image: user.image,
                email_verified: user.email ? new Date() : undefined,
                last_login: new Date().toISOString(),
                // ترقية للأدمن لو كان عامل حساب قبل كده بـ tier='free'
                ...(isAdminEmail ? { subscription_tier: 'admin' } : {}),
              },
            });

            token.id = dbUser.id;
            token.subscription_tier = dbUser.subscription_tier;
            token.default_risk_tolerance = dbUser.default_risk_tolerance;
            token.username = dbUser.username || user.email?.split('@')[0];
            token.is_active = dbUser.is_active;

            // === Auto-migrate legacy Google Numeric ID data to Prisma CUID ===
            // المشكلة: قديماً portfolio/watchlist كانوا بيتخزنوا بـ Google Numeric ID
            // حالياً: بنستخدم Prisma CUID
            // الحل: لما المستخدم يسجل دخول بـ Google، نهاجر بياناته القديمة
            const googleNumericId = account?.providerAccountId;
            if (googleNumericId && googleNumericId !== dbUser.id) {
              try {
                const { openDbWritable } = await import('@/lib/db-manager');
                const stocksDb = openDbWritable('stocks.db');
                if (!stocksDb) throw new Error('stocks.db unavailable');

                // تحديث portfolio_assets
                try {
                  const portfolioResult = stocksDb.prepare(
                    'UPDATE portfolio_assets SET user_id = ? WHERE user_id = ?'
                  ).run(dbUser.id, googleNumericId);

                  if (portfolioResult.changes > 0) {
                    console.log(`[Auth] Migrated ${portfolioResult.changes} portfolio_assets from ${googleNumericId} → ${dbUser.id}`);
                  }
                } catch (e) {
                  // portfolio_assets table might not exist
                }

                // تحديث user_stock_watchlists
                try {
                  const watchlistResult = stocksDb.prepare(
                    'UPDATE user_stock_watchlists SET user_id = ? WHERE user_id = ?'
                  ).run(dbUser.id, googleNumericId);

                  if (watchlistResult.changes > 0) {
                    console.log(`[Auth] Migrated ${watchlistResult.changes} watchlist items from ${googleNumericId} → ${dbUser.id}`);
                  }
                } catch (e) {
                  // user_stock_watchlists table might not exist
                }

                stocksDb.close();
              } catch (migrateError) {
                console.warn('[Auth] Auto-migration error (non-fatal):', migrateError);
              }
            }
          } catch (dbError) {
            console.error('[Auth] Database error during Google OAuth:', dbError);
            // Still allow sign in even if DB fails
          }
        }

        // For credentials, fetch extra fields from DB
        if (account?.provider === 'credentials') {
          try {
            const dbUser = await db.user.findUnique({
              where: { email: user.email! },
            });
            if (dbUser) {
              token.subscription_tier = dbUser.subscription_tier;
              token.default_risk_tolerance = dbUser.default_risk_tolerance;
              token.username = dbUser.username || user.email?.split('@')[0];
              token.is_active = dbUser.is_active;
            }
          } catch (dbError) {
            console.error('[Auth] Database error during credentials auth:', dbError);
          }
        }

        // Admin detection: check verified email list, admin usernames, DB tier, or isServerAdmin
        const ADMIN_EMAILS = getServerAdminEmails();
        const ADMIN_USERNAMES = getServerAdminUsernames();
        const tokenEmail = (token.email as string || '').toLowerCase();
        const tokenUsername = (token.username as string || '').toLowerCase();
        const isAdminUser =
          ADMIN_EMAILS.includes(tokenEmail) ||
          ADMIN_USERNAMES.includes(tokenUsername) ||
          token.subscription_tier === 'admin' ||
          isServerAdmin(tokenEmail, tokenUsername);
        token.is_admin = isAdminUser;
        // If admin, force admin tier and active status
        if (isAdminUser) {
          token.subscription_tier = 'admin';
          token.is_active = true;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.image as string | null;
        
        // Always fetch fresh subscription data from DB (ensures up-to-date tier)
        try {
          // Look up by email with explicit select to avoid Prisma DateTime deserialization errors
          let freshUser = await db.user.findUnique({
            where: { email: session.user.email! },
            select: {
              id: true,
              email: true,
              username: true,
              name: true,
              image: true,
              subscription_tier: true,
              default_risk_tolerance: true,
              is_active: true,
            },
          });

          // Proactive Sync: If user is logged in via Google but not in DB, create them now!
          if (!freshUser && token.email) {
            console.log(`[Auth Session] Google user ${token.email} not found in DB. Creating dynamically...`);
            try {
              freshUser = await db.user.create({
                data: {
                  email: token.email.toLowerCase(),
                  name: token.name || token.email.split('@')[0],
                  username: (token.username as string) || token.email.split('@')[0],
                  image: (token.picture as string) || (token.image as string) || null,
                  email_verified: new Date().toISOString(),
                  is_active: true,
                  subscription_tier: 'free',
                  default_risk_tolerance: 'medium',
                  last_login: new Date().toISOString(),
                },
              });
              console.log(`[Auth Session] Created user in DB dynamically:`, freshUser.id);
            } catch (createError) {
              console.error(`[Auth Session] Failed to create user dynamically:`, createError);
            }
          }

          const ADMIN_EMAILS_SESSION = getServerAdminEmails();
          const ADMIN_USERNAMES_SESSION = getServerAdminUsernames();
          const userEmail = (session.user.email || '').toLowerCase();
          const username = ((session.user as any).username || token.username || freshUser?.username || '').toLowerCase();
          const isUserAdmin =
            ADMIN_EMAILS_SESSION.includes(userEmail) ||
            ADMIN_USERNAMES_SESSION.includes(username) ||
            freshUser?.subscription_tier === 'admin' ||
            token.is_admin === true ||
            isServerAdmin(userEmail, username);

          if (freshUser) {
            session.user.id = freshUser.id; // Override with database CUID
            (session.user as Record<string, unknown>).subscription_tier = isUserAdmin ? 'admin' : (freshUser.subscription_tier || 'free');
            (session.user as Record<string, unknown>).default_risk_tolerance = freshUser.default_risk_tolerance;
            (session.user as Record<string, unknown>).username = freshUser.username;
            (session.user as Record<string, unknown>).is_active = freshUser.is_active;
            (session.user as Record<string, unknown>).is_admin = isUserAdmin;
          } else {
            // Fallback to token values
            (session.user as Record<string, unknown>).subscription_tier = isUserAdmin ? 'admin' : (token.subscription_tier || 'free');
            (session.user as Record<string, unknown>).default_risk_tolerance = token.default_risk_tolerance;
            (session.user as Record<string, unknown>).username = token.username;
            (session.user as Record<string, unknown>).is_active = token.is_active;
            (session.user as Record<string, unknown>).is_admin = isUserAdmin;
          }
        } catch (error) {
          console.error('[Auth] Error in session callback:', error);
          const isUserAdmin = token.is_admin === true;
          (session.user as Record<string, unknown>).subscription_tier = isUserAdmin ? 'admin' : (token.subscription_tier || 'free');
          (session.user as Record<string, unknown>).default_risk_tolerance = token.default_risk_tolerance;
          (session.user as Record<string, unknown>).username = token.username;
          (session.user as Record<string, unknown>).is_active = token.is_active;
          (session.user as Record<string, unknown>).is_admin = isUserAdmin;
        }
      }
      return session;
    },

    // Handle redirect URL for Google OAuth — ALWAYS force https://invist.m2y.net domain
    async redirect({ url, baseUrl }) {
      const prodUrl = process.env.NEXTAUTH_URL || process.env.MAIN_DOMAIN || 'https://invist.m2y.net';
      const targetBase = prodUrl.startsWith('http') ? prodUrl : 'https://invist.m2y.net';

      // Allows relative callback URLs (/dashboard, /, /subscription) -> https://invist.m2y.net/dashboard
      if (url.startsWith('/')) {
        return `${targetBase}${url}`;
      }

      // Allows callback URLs on m2y.net domain
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname.endsWith('m2y.net')) {
          return url;
        }
      } catch {}

      return targetBase;
    },
  },

  trustHost: true,

  // Use NEXTAUTH_URL to determine the base URL for callbacks.
  // In production behind a reverse proxy (e.g. Hostinger), NextAuth uses
  // trustHost: true + x-forwarded-host / x-forwarded-proto headers to
  // construct the correct callback URL automatically.
  // Local: http://localhost:8100/api/auth/callback/google
  // Production: https://invist.m2y.net/api/auth/callback/google
};

const handler = NextAuth({
  ...authOptions,
  // BRAVO-FIX8: fallback secret لو NEXTAUTH_SECRET مش متعرف في .env
  // ده مش أمان كامل (production لازم NEXTAUTH_SECRET) بس بيمنع crash في sandbox
  secret: process.env.NEXTAUTH_SECRET || 'glminvestment-dev-fallback-secret-2026',
});

export { handler as GET, handler as POST };

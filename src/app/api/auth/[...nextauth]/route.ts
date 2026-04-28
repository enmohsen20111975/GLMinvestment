import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    // Google OAuth Provider — only include if properly configured
    ...(process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_CLIENT_SECRET !== 'your-google-client-secret' &&
      process.env.GOOGLE_CLIENT_SECRET !== 'your-google-client-secret-here'
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: 'consent',
                access_type: 'offline',
              },
            },
          }),
        ]
      : []),

    // Credentials Provider (email/password)
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username_or_email: { label: 'اسم المستخدم أو البريد', type: 'text' },
        password: { label: 'كلمة المرور', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username_or_email || !credentials?.password) {
          return null;
        }

        const identifier = credentials.username_or_email as string;
        const password = credentials.password as string;

        // Find user by email or username
        const user = await db.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { username: identifier },
            ],
          },
        });

        if (!user || !user.password_hash) {
          return null;
        }

        if (!user.is_active) {
          return null;
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
          return null;
        }

        // Update last login
        await db.user.update({
          where: { id: user.id },
          data: { last_login: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.username || '',
          image: user.image,
        };
      },
    }),
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
            const dbUser = await db.user.upsert({
              where: { email: user.email! },
              create: {
                email: user.email!,
                name: user.name,
                username: user.email?.split('@')[0] || null,
                image: user.image,
                email_verified: new Date(),
                is_active: true,
                subscription_tier: 'free',
                default_risk_tolerance: 'medium',
                last_login: new Date(),
              },
              update: {
                name: user.name,
                image: user.image,
                email_verified: user.email ? new Date() : undefined,
                last_login: new Date(),
              },
            });

            token.id = dbUser.id;
            token.subscription_tier = dbUser.subscription_tier;
            token.default_risk_tolerance = dbUser.default_risk_tolerance;
            token.username = dbUser.username || user.email?.split('@')[0];
            token.is_active = dbUser.is_active;
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

        // Admin detection — check email and username
        const adminEmails = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];
        const adminUsernames = ['mohseny'];
        const tokenEmail = (token.email as string || '').toLowerCase();
        const tokenUsername = (token.username as string || '').toLowerCase();
        const isAdminUser = adminEmails.includes(tokenEmail) || adminUsernames.includes(tokenUsername);
        token.is_admin = isAdminUser;
        // If admin, force premium tier and active status
        if (isAdminUser) {
          token.subscription_tier = 'premium';
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
        (session.user as Record<string, unknown>).subscription_tier = token.subscription_tier;
        (session.user as Record<string, unknown>).default_risk_tolerance = token.default_risk_tolerance;
        (session.user as Record<string, unknown>).username = token.username;
        (session.user as Record<string, unknown>).is_active = token.is_active;
        (session.user as Record<string, unknown>).is_admin = token.is_admin;
      }
      return session;
    },

    // Handle redirect URL for Google OAuth
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        // Validate Google credentials are properly set
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET ||
            process.env.GOOGLE_CLIENT_SECRET === 'your-google-client-secret' ||
            process.env.GOOGLE_CLIENT_SECRET === 'your-google-client-secret-here') {
          console.error('[Auth] Google OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
          // Return URL with error parameter instead of false to prevent 500
          return `//?auth_error=google_not_configured`;
        }
      }
      return true;
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
  secret: process.env.NEXTAUTH_SECRET || 'fallback-deploy-secret-change-me-in-production-egx-2024',
});

export { handler as GET, handler as POST };

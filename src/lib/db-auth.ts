/**
 * Auth Database Client
 * =====================
 * Database: db/auth.db
 * Purpose: User authentication, sessions, subscriptions
 */

import { PrismaClient } from '@prisma/auth-client'
import path from 'path'

const globalForAuth = globalThis as unknown as {
  authDb: PrismaClient | undefined
}

const dbPath = path.join(process.cwd(), 'db', 'auth.db')

export const authDb =
  globalForAuth.authDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    datasourceUrl: `file:${dbPath}`
  })

if (process.env.NODE_ENV !== 'production') globalForAuth.authDb = authDb

// Re-export types
export type { User, Account, Session, SubscriptionPlan, UserSubscription, ApiToken, MarketPricing, Referral, UsageDaily, B2bApiKey } from '@prisma/auth-client'

<<<<<<< HEAD
/**
 * Main Database Client
 * ====================
 * Default: auth.db (for backward compatibility)
 *
 * For predictions, import from '@/lib/db-predictions'
 * For auth, import from '@/lib/db-auth'
 */

export { authDb as db, authDb } from './db-auth'
export type { User, Account, Session, SubscriptionPlan, UserSubscription, ApiToken } from './db-auth'
=======
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)

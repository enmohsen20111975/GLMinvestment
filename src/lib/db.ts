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

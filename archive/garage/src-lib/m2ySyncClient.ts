/**
 * دليل الاستثمار — m2y.net Subscription Sync Client
 *
 * Called from API routes to push subscription state changes
 * to the central m2y.net gateway after local DB operations succeed.
 */

const M2Y_API_URL = process.env.M2Y_API_URL || process.env.MAIN_DOMAIN || 'https://m2y.net';
const M2Y_SYNC_SECRET = process.env.M2Y_SYNC_SECRET || process.env.SHARED_SECRET || '';

export interface GLMSyncPayload {
  action: 'subscribe' | 'upgrade' | 'downgrade' | 'cancel';
  user_id: string;
  plan_id: string;
  status: 'active' | 'cancelled' | 'expired';
  expires_at?: string;
  auto_renew?: boolean;
  payment_method?: string;
  transaction_id?: string;
}

/**
 * Push a subscription event to m2y.net.
 * Returns true on success, false on failure (never throws).
 */
export async function syncSubscriptionToM2Y(payload: GLMSyncPayload): Promise<boolean> {
  if (!M2Y_SYNC_SECRET) {
    console.warn('[GLM-Sync] M2Y_SYNC_SECRET not set — skipping sync');
    return false;
  }

  if (!M2Y_API_URL || M2Y_API_URL.includes('localhost')) {
    console.info('[GLM-Sync] m2y.net not set as a real URL — sync skipped in dev');
    return false;
  }

  try {
    const res = await fetch(`${M2Y_API_URL}/api/sync/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-M2Y-Source':  'glminvestment',
        'X-M2Y-Sync-Secret': M2Y_SYNC_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[GLM-Sync] m2y.net returned ${res.status}`);
      return false;
    }

    const data = await res.json().catch(() => ({}));
    console.info(
      `[GLM-Sync] OK action=${payload.action} plan=${payload.plan_id} user=${payload.user_id}`
    );
    return (data as any).success === true;
  } catch (err) {
    console.warn('[GLM-Sync] Failed:', (err as Error).message);
    return false;
  }
}

/**
 * Fetch the current subscription of a local user from m2y.net
 * Used for cross-domain verification (e.g. EngiSuite checking GLM status)
 */
export async function getGLMSubscriptionFromM2Y(userId: string): Promise<any> {
  if (!M2Y_SYNC_SECRET || !M2Y_API_URL || M2Y_API_URL.includes('localhost')) {
    return null;
  }
  try {
    const res = await fetch(
      `${M2Y_API_URL}/api/verify-subscription?source=glminvestment&external_user_id=${encodeURIComponent(userId)}`,
      { headers: { 'X-M2Y-Sync-Secret': M2Y_SYNC_SECRET }, signal: AbortSignal.timeout(8000) }
    );
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

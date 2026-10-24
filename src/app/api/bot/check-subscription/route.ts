/**
 * GET /api/bot/check-subscription?chat_id=123456789
 *
 * BOT-SUBSCRIPTION-GATE (2026-10-01): called by the Telegram bot on EVERY
 * command (except /start and /help). It tells the bot whether the chat is:
 *   - linked to a registered website user, AND
 *   - whether that user is on a paid tier (or in active trial).
 *
 * The bot uses the response to decide whether to:
 *   - run the command (linked + paid/active-trial),
 *   - show the "💎 اشترك Premium" prompt (linked + free), or
 *   - show the "🔗 ربط حسابك في الموقع" button (not linked).
 *
 * Security (Rule 55 — P0-WAVE-SECURITY):
 *   - No user session required — this is a bot-only endpoint.
 *   - We verify a shared secret in the `X-Bot-Secret` header against
 *     process.env.BOT_API_SECRET. Without it, the route returns 401.
 *   - The response leaks NO PII for un-linked chats: it just says
 *     { linked: false }.
 *   - chat_id is validated as a positive integer (Rule 56 — no SQLi).
 *
 * Response shapes:
 *   { linked: true, user_id, subscription_tier, is_paid, is_trial_active,
 *     trial_ends_at, display_name }
 *   { linked: false }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getActiveTelegramLink } from '@/lib/bot-link-db';
import { PAID_TIERS } from '@/lib/subscription-gate';

import { getSessionUserId } from '@/lib/auth-helper';
export const dynamic = 'force-dynamic';

// PAID_TIERS is imported from @/lib/subscription-gate (canonical source —
// see P0-5 Fix Battalion: Unify PAID_TIERS). Previously this route had a
// local copy of the Set that could drift from the canonical list.

const TRIAL_DAYS = 7;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.BOT_API_SECRET;
  if (!secret) return false; // fail-closed
  const header = req.headers.get('x-bot-secret') || '';
  if (!header || header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(req: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 },
      );
    }

    // 1. Parse + validate chat_id (Rule 56 — parameterized, no interpolation).
    const chatParam = req.nextUrl.searchParams.get('chat_id') || '';
    const chat_id_num = Number(chatParam);
    if (!Number.isFinite(chat_id_num) || chat_id_num <= 0) {
      return NextResponse.json(
        { success: false, error: 'invalid_chat_id' },
        { status: 400 },
      );
    }
    const chat_id_str = String(Math.trunc(chat_id_num));

    // 2. Look up the link row.
    //    Raw SQL (not Prisma) on purpose: auth.db is never migrated in
    //    production, so a Prisma model for a table that does not exist yet
   //    would 500 on every call. getActiveTelegramLink creates the table
    //    idempotently before reading it.
    const link = getActiveTelegramLink(chat_id_str);

    if (!link) {
      return NextResponse.json({ linked: false });
    }

    // 3. Fetch the user's subscription state.
    const user = await authDb.user.findUnique({
      where: { id: link.user_id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        subscription_tier: true,
        created_at: true,
        trial_ends_at: true,
        is_active: true,
      },
    });

    if (!user || !user.is_active) {
      // User was deleted or deactivated — treat as not-linked so the bot
      // re-prompts for linking.
      return NextResponse.json({ linked: false });
    }

    const tier = (user.subscription_tier || 'free').toLowerCase();
    const is_paid = PAID_TIERS.has(tier);

    // Free-tier trial window — same logic as getTrialStatus() in
    // src/lib/subscription-gate.ts, inlined so this route stays leaf-shaped.
    let is_trial_active = false;
    let trial_ends_at: string | null = null;
    if (!is_paid) {
      const createdAt = user.created_at ? new Date(user.created_at) : new Date();
      const validCreated = isNaN(createdAt.getTime()) ? new Date() : createdAt;
      const trialEnds =
        user.trial_ends_at
          ? new Date(user.trial_ends_at)
          : new Date(validCreated.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      if (!isNaN(trialEnds.getTime())) {
        trial_ends_at = trialEnds.toISOString();
        is_trial_active = trialEnds > new Date();
      }
    }

    let days_left = 0;
    if (is_trial_active && trial_ends_at) {
      const msLeft = new Date(trial_ends_at).getTime() - Date.now();
      days_left = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    }

    // display_name — prefer name, fall back to username, lastly email local-part.
    let display_name = user.name || user.username || '';
    if (!display_name && user.email) {
      display_name = user.email.split('@')[0];
    }

    return NextResponse.json({
      success: true,
      linked: true,
      user_id: user.id,
      subscription_tier: tier,
      is_paid,
      is_trial_active,
      trial_ends_at,
      days_left: is_paid ? 999 : days_left,
      display_name: display_name || undefined,
      telegram_username: link.telegram_username ?? undefined,
    });
  } catch (err) {
    console.error(
      '[api/bot/check-subscription] error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

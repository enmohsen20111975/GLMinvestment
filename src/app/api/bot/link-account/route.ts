/**
 * POST /api/bot/link-account
 *
 * BOT-SUBSCRIPTION-GATE (2026-10-01): called by the website (browser) when a
 * user who arrived via `?bot_link=TOKEN` clicks "تأكيد الربط" in the
 * confirmation dialog. We verify the token is fresh + unused, then write a
 * permanent `user_telegram_links` row linking the user's Prisma User.id to
 * the bot's chat_id.
 *
 * Auth flow:
 *   1. User must be authenticated on the website (getSessionUserId).
 *   2. The bot issued a single-use token via POST /api/bot/link-token (bot-only).
 *   3. We verify the token is unused + not expired.
 *   4. We create the UserTelegramLink row (unique on user_id + on chat_id).
 *   5. We mark the token as used.
 *
 * Security (Rule 55 — P0-WAVE-SECURITY):
 *   - Requires user session (no anonymous linking).
 *   - No X-Bot-Secret on this route — it's user-facing from the browser.
 *   - All SQL is parameterized (Rule 56).
 *
 * Request body: { token: string }
 * Response:     { success: true, chat_id: number, message: string }
 *                { success: false, error: '...' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import {
  getBotLinkToken,
  linkTelegramChat,
  markBotLinkTokenUsed,
} from '@/lib/bot-link-db';

export const dynamic = 'force-dynamic';

const OK_MSG = 'تم ربط البوت بحسابك بنجاح';

export async function POST(req: NextRequest) {
  try {
    // 1. Require authenticated user
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 },
      );
    }

    // 2. Parse + validate body
    let body: { token?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid_json' },
        { status: 400 },
      );
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 200) {
      return NextResponse.json(
        { success: false, error: 'invalid_token' },
        { status: 400 },
      );
    }

    // 3. Look up the token row
    const row = getBotLinkToken(token);
    if (!row) {
      return NextResponse.json(
        { success: false, error: 'token_not_found' },
        { status: 404 },
      );
    }

    // 4. Check expiry + single-use
    if (row.used === 1) {
      return NextResponse.json(
        { success: false, error: 'token_already_used' },
        { status: 410 },
      );
    }
    const expiresAt = new Date(row.expires_at);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return NextResponse.json(
        { success: false, error: 'token_expired' },
        { status: 410 },
      );
    }

    const chat_id = row.chat_id;
    const telegram_username = row.username;

    // 5. Link the chat to this user (last-link wins).
    //    Raw SQL in one transaction instead of a Prisma transaction: auth.db
    //    has no migration step in production, and the UNIQUE constraints on
    //    user_id / telegram_chat_id must be resolved by deleting the stale
    //    rows — a Prisma updateMany(is_active:false) leaves the chat_id value
    //    taken and the subsequent upsert aborts on the constraint.
    const linked = linkTelegramChat({
      userId,
      chatId: String(chat_id),
      username: telegram_username,
    });

    // 6. Mark the token as used (single-use).
    markBotLinkTokenUsed(token);

    return NextResponse.json({
      success: true,
      chat_id,
      telegram_username: linked.telegram_username ?? undefined,
      message: OK_MSG,
    });
  } catch (err) {
    console.error(
      '[api/bot/link-account] error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

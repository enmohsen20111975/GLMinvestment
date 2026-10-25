/**
 * POST /api/bot/link-token
 *
 * BOT-SUBSCRIPTION-GATE (2026-10-01): the Telegram bot calls this when an
 * un-linked user hits /start. We mint a single-use, short-lived token that
 * the bot embeds in a "🔗 ربط حسابك في الموقع" button. When the user opens
 * the link (`https://invist.m2y.net/?bot_link=TOKEN`) and confirms, the
 * website POSTs the token to `/api/bot/link-account`, which writes the
 * permanent `user_telegram_links` row.
 *
 * Security (Rule 55 — P0-WAVE-SECURITY):
 *   - This route is called by the bot only. We verify a shared secret in the
 *     `X-Bot-Secret` header against process.env.BOT_API_SECRET. Without the
 *     secret any anonymous attacker could mint link-tokens and spam the
 *     website (low harm, but still abuse).
 *   - Token expires after 10 minutes.
 *   - All SQL is parameterized (Rule 56).
 *
 * Request body: { chat_id: number, username?: string }
 * Response:     { token: string, link_url: string, expires_at: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  insertBotLinkToken,
  purgeExpiredBotLinkTokens,
} from '@/lib/bot-link-db';

export const dynamic = 'force-dynamic';

const LINK_URL_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://invist.m2y.net';
const TOKEN_TTL_MINUTES = 10;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.BOT_API_SECRET;
  if (!secret) return false; // fail-closed if mis-configured
  const header = req.headers.get('x-bot-secret') || '';
  if (!header) return false;
  // constant-time-ish compare (lengths differ → reject early)
  if (header.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify shared secret
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 },
      );
    }

    // 2. Parse + validate body
    let body: { chat_id?: unknown; username?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid_json' },
        { status: 400 },
      );
    }

    const chat_id_raw = body.chat_id;
    const username_raw = body.username;

    if (typeof chat_id_raw !== 'number' || !Number.isFinite(chat_id_raw) || chat_id_raw <= 0) {
      return NextResponse.json(
        { success: false, error: 'invalid_chat_id' },
        { status: 400 },
      );
    }
    const chat_id = Math.trunc(chat_id_raw);

    const username =
      typeof username_raw === 'string' && username_raw.trim().length > 0
        ? username_raw.trim().slice(0, 64)
        : null;

    // 3. Mint the token
    const token = randomUUID();
    const expires_at = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

    insertBotLinkToken(token, chat_id, username, expires_at);

    // 4. Best-effort GC of stale tokens (fire and forget — non-fatal).
    try {
      purgeExpiredBotLinkTokens();
    } catch {
      /* ignore — GC failure should not break the happy path */
    }

    // 5. Return the link URL the bot will show as an inline button.
    const link_url = `${LINK_URL_BASE}/?bot_link=${token}`;

    return NextResponse.json({
      success: true,
      token,
      link_url,
      expires_at,
      ttl_minutes: TOKEN_TTL_MINUTES,
    });
  } catch (err) {
    console.error(
      '[api/bot/link-token] error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

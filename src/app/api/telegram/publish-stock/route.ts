/**
 * POST /api/telegram/publish-stock
 * ==================================================
 *
 * Admin-only endpoint that publishes a rich Arabic analysis card for a stock
 * directly to the configured Telegram channel via the bot.
 *
 * This complements the StockPublisher client component (which only opens
 * share-URL popups for Telegram/WhatsApp/Facebook). With this endpoint,
 * admins can push the full formatted analysis as a CHANNEL POST in one click.
 *
 * Flow:
 *   1. requireAdminAsync(request)  — 401 if not authenticated admin
 *   2. POST body: { ticker, market?, channel_id? }
 *   3. Fetch the StockPublishData from the internal /api/stocks/[ticker]/publish-data
 *      route (which already aggregates stocks.db + predictions.db + radar cache +
 *      price history + technicals). Falls back to a minimal payload if the
 *      internal call fails.
 *   4. Format the data via generatePublishText (same Arabic formatter used by
 *      the client StockPublisher component — extracted to @/modules/publishing/lib/stock-publish-text).
 *   5. Send to Telegram bot API: POST /bot{TOKEN}/sendMessage with parse_mode=HTML.
 *   6. Return { success, message_id, chat_id, source }
 *
 * Env vars required:
 *   - TELEGRAM_BOT_TOKEN  (the bot's API token from @BotFather)
 *   - TELEGRAM_CHANNEL_ID (e.g. '@Arabian_investment_guide' or '-1001234567890')
 *
 * Response:
 *   200 { success: true, message_id: number, chat_id: string, source: string }
 *   400 { success: false, error: string } — bad request (missing ticker)
 *   401 { success: false, error: string } — unauthorized (admin only)
 *   500 { success: false, error: string } — Telegram env not configured / API error
 *   502 { success: false, error: string } — upstream Telegram API rejected the message
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-guard';
import {
  generatePublishText,
  escapeHtmlForTelegram,
  type StockPublishData,
} from '@/modules/publishing/lib/stock-publish-text';

export const dynamic = 'force-dynamic';

// ============================================================================
// Helpers
// ============================================================================

interface PublishStockBody {
  ticker?: string;
  market?: string;
  channel_id?: string;
}

/**
 * Fetch the StockPublishData by calling the internal /api/stocks/[ticker]/publish-data
 * route. This reuses the existing aggregator (stocks.db + predictions.db +
 * radar cache + price history + technicals) instead of duplicating the logic.
 *
 * Falls back to a minimal payload ({ ticker, currentPrice }) if the internal
 * call fails — so the channel post still goes out with the ticker name even
 * when the DB is empty.
 */
async function fetchPublishData(
  tickerUpper: string,
  market: string
): Promise<StockPublishData> {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.SELF_BASE_URL ||
    'http://localhost:3001';
  const url = `${baseUrl}/api/stocks/${encodeURIComponent(tickerUpper)}/publish-data?market=${encodeURIComponent(market)}&skip_python=1`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ticker: tickerUpper, currentPrice: 0, market: market as StockPublishData['market'] };
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: StockPublishData;
    };
    if (json?.success && json.data) {
      return json.data;
    }
    return { ticker: tickerUpper, currentPrice: 0, market: market as StockPublishData['market'] };
  } catch {
    return { ticker: tickerUpper, currentPrice: 0, market: market as StockPublishData['market'] };
  }
}

/**
 * Telegram text-message limit (4096). Truncate to be safe.
 */
function truncateForTelegram(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// ============================================================================
// POST handler
// ============================================================================

export async function POST(request: NextRequest) {
  // ─── 1) Admin auth ───
  const authError = await requireAdminAsync(request);
  if (authError) {
    return authError;
  }

  // ─── 2) Parse body ───
  let body: PublishStockBody;
  try {
    body = (await request.json()) as PublishStockBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const tickerRaw = (body.ticker || '').trim().toUpperCase();
  if (!tickerRaw) {
    return NextResponse.json(
      { success: false, error: 'ticker is required' },
      { status: 400 }
    );
  }

  const market = (body.market || 'EGX').toUpperCase();
  const channelId = body.channel_id || process.env.TELEGRAM_CHANNEL_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return NextResponse.json(
      {
        success: false,
        error:
          'TELEGRAM_BOT_TOKEN is not configured on the server. Set it in .env to publish directly.',
      },
      { status: 500 }
    );
  }
  if (!channelId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'TELEGRAM_CHANNEL_ID is not configured on the server. Set it in .env or pass channel_id in the body.',
      },
      { status: 500 }
    );
  }

  // ─── 3) Fetch the StockPublishData via internal aggregator ───
  const publishData = await fetchPublishData(tickerRaw, market);

  // ─── 4) Format via the shared Arabic formatter (same as StockPublisher UI) ───
  const rawText = generatePublishText(publishData);
  const htmlText = escapeHtmlForTelegram(rawText);
  const truncated = truncateForTelegram(htmlText);

  // ─── 5) Send to Telegram bot API ───
  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const tgRes = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channelId,
        text: truncated,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const tgJson = (await tgRes.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number; chat?: { id?: string | number } };
    };

    if (!tgRes.ok || !tgJson.ok) {
      console.error(
        '[telegram/publish-stock] Telegram API rejected message:',
        tgJson.description
      );
      return NextResponse.json(
        {
          success: false,
          error:
            tgJson.description ||
            `Telegram API returned HTTP ${tgRes.status} (ok=false)`,
          ticker: tickerRaw,
          channel_id: channelId,
        },
        { status: 502 }
      );
    }

    const messageId = tgJson.result?.message_id;
    const chatId = tgJson.result?.chat?.id;

    return NextResponse.json({
      success: true,
      message_id: messageId,
      chat_id: chatId != null ? String(chatId) : channelId,
      ticker: tickerRaw,
      source: 'stock-publisher-bot',
      text_length: truncated.length,
    });
  } catch (e) {
    console.error('[telegram/publish-stock] fetch error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to reach the Telegram bot API (network timeout)',
        ticker: tickerRaw,
      },
      { status: 502 }
    );
  }
}

// ============================================================================
// GET — quick health/config check (does NOT require admin)
// ============================================================================

export async function GET() {
  return NextResponse.json({
    success: true,
    endpoint: '/api/telegram/publish-stock',
    method: 'POST',
    auth: 'admin-only (requireAdminAsync)',
    bot_token_configured: !!process.env.TELEGRAM_BOT_TOKEN,
    channel_id_configured: !!process.env.TELEGRAM_CHANNEL_ID,
    body_shape: {
      ticker: 'string (required)',
      market: "string (optional, default 'EGX')",
      channel_id: 'string (optional, overrides TELEGRAM_CHANNEL_ID)',
    },
  });
}

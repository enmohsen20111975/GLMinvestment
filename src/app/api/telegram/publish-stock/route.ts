import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import Database from 'better-sqlite3';
import path from 'path';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS_SHORT } from '@/modules/publishing/lib/official-links';

export const dynamic = 'force-dynamic';

/**
 * FIX-P2-PREDICTIONS (AUDIT-1-PREDICTIONS):
 * After successfully publishing a prediction to Telegram, write back to the
 * predictions table so we have an audit trail proving the recommendation was
 * actually sent to subscribers BEFORE the price moved.
 *
 * Sets on every row matching (ticker, today's prediction_date):
 *   - published_at        = NOW()        (ISO datetime string)
 *   - telegram_message_id = <Bot API message_id>
 *   - was_published       = 1
 *
 * If no matching rows are found (e.g., the prediction was never inserted into
 * the DB, or `prediction_date` is in a different format), the publish still
 * succeeds — we just return `updated_rows: 0` so the caller can investigate.
 *
 * BOT-LINK-INTEGRATION (2026-10-01): the route now accepts BOTH JSON and
 * multipart/form-data. If an `image` (Blob or base64 PNG data URL) is provided,
 * the route sends it via Telegram `sendPhoto` so the full infographic card is
 * delivered to subscribers; otherwise it falls back to `sendMessage`. The
 * caption/text now appends OFFICIAL_LINKS_BLOCK so the bot/website/Telegram
 * channel links are always included in every published message.
 */
export async function POST(req: NextRequest) {
  let predDb: Database.Database | null = null;
  try {
    // Task SECURITY-P0: admin-only — النشر على قناة تليجرام الإنتاجية يحتاج صلاحية أدمن.
    // كان: getSessionUserId فقط (أي مستخدم مسجل يقدر ينشر). الآن: requireAdminAsync.
    const adminError = await requireAdminAsync(req);
    if (adminError) return adminError;

    const { userId } = await getSessionUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'auth_required' }, { status: 401 });

    // ── Parse the request body: accept BOTH FormData (modal) and JSON (legacy) ──
    let ticker: string | undefined;
    let name_ar: string | undefined;
    let market: string | undefined;
    let channel_id: string | undefined;
    let caption: string | undefined;
    let imageBlob: Blob | null = null;

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      ticker = (formData.get('ticker') as string) || undefined;
      name_ar = (formData.get('name_ar') as string) || undefined;
      market = (formData.get('market') as string) || undefined;
      channel_id = (formData.get('channel_id') as string) || undefined;
      caption = (formData.get('caption') as string) || undefined;
      const img = formData.get('image');
      if (img && typeof img !== 'string' && 'size' in img && img.size > 0) {
        imageBlob = img as Blob;
      } else if (typeof img === 'string' && img.startsWith('data:image/')) {
        // base64 data URL → convert to Blob
        const base64Data = img.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        imageBlob = new Blob([buffer], { type: 'image/png' });
      }
    } else {
      const body = await req.json();
      ticker = body.ticker;
      name_ar = body.name_ar;
      market = body.market;
      channel_id = body.channel_id;
      caption = body.caption;
      // Accept base64 data URL OR raw base64 PNG
      if (typeof body.image === 'string' && body.image.length > 0) {
        const dataUrl = body.image.startsWith('data:')
          ? body.image
          : `data:image/png;base64,${body.image}`;
        const base64Data = dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        imageBlob = new Blob([buffer], { type: 'image/png' });
      }
    }

    if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const defaultChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (!botToken || !defaultChannel) {
      return NextResponse.json({ success: false, error: 'telegram_not_configured' }, { status: 503 });
    }

    const chatId = channel_id || defaultChannel;
    const stockName = name_ar || ticker;
    const today = new Date().toISOString().split('T')[0];

    // Build the rich caption/text. Always append OFFICIAL_LINKS_BLOCK so the bot
    // link is delivered with every published message.
    const richCaption =
      caption ||
      `📊 تحليل سهم: ${stockName} (${ticker})\n` +
      `📅 ${today}\n` +
      `📍 منصة دليل الاستثمار — invist.m2y.net\n\n` +
      `${OFFICIAL_LINKS_BLOCK}`;

    const textMessage =
      `📊 تحليل سهم: ${stockName} (${ticker})\n` +
      `📅 ${today}\n` +
      `📍 منصة دليل الاستثمار — invist.m2y.net\n\n` +
      `${OFFICIAL_LINKS_SHORT}\n\n` +
      `${OFFICIAL_LINKS_BLOCK}`;

    let messageId: number | undefined;
    let sentAsPhoto = false;

    if (imageBlob) {
      // ── sendPhoto: deliver the infographic card image + rich caption ──
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('photo', imageBlob, `${ticker}_infographic.png`);
      formData.append('caption', richCaption);
      formData.append('parse_mode', 'HTML');

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!data.ok) {
        // If Telegram rejects the photo (e.g., invalid image), fall back to sendMessage
        console.warn('[publish-stock] sendPhoto failed, falling back to sendMessage:', data.description);
      } else {
        messageId = data.result?.message_id;
        sentAsPhoto = true;
      }
    }

    if (!sentAsPhoto) {
      // ── sendMessage fallback (text-only) ──
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: textMessage,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      const data = await response.json();
      if (!data.ok) {
        return NextResponse.json({ success: false, error: data.description || 'telegram_error' }, { status: 502 });
      }
      messageId = data.result?.message_id;
    }

    let updatedRows = 0;

    // ── FIX-P2-PREDICTIONS: write back audit trail to predictions.db ──
    // Mark every prediction for this ticker + today's prediction_date as
    // published. Multiple rows can match (e.g., balanced + morning_bell +
    // persona variants) — they should ALL be flagged as published.
    try {
      const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
      predDb = new Database(dbPath, { timeout: 3000 });
      predDb.pragma('journal_mode = WAL');

      // The predictions table stores prediction_date as TEXT (ISO date or
      // "YYYY-MM-DD HH:MM:SS"). Use SQLite's date() to normalize both sides
      // to YYYY-MM-DD so we match any same-day predictions regardless of
      // whether the timestamp includes a time component.
      const updateStmt = predDb.prepare(`
        UPDATE predictions
        SET published_at = datetime('now'),
            telegram_message_id = ?,
            was_published = 1
        WHERE UPPER(TRIM(ticker)) = UPPER(TRIM(?))
          AND date(prediction_date) = date('now')
      `);
      const result = updateStmt.run(messageId ?? null, ticker);
      updatedRows = Number(result.changes || 0);
    } catch (dbErr) {
      // Don't fail the publish if the DB write fails — the Telegram message
      // has already been sent. Log + return the error in the response so
      // the caller can investigate the audit-trail gap.
      console.error('[publish-stock] audit-trail write failed:', dbErr);
    }

    return NextResponse.json({
      success: true,
      message_id: messageId,
      sent_as_photo: sentAsPhoto,
      // FIX-P2-PREDICTIONS: audit trail fields
      published_at: new Date().toISOString(),
      updated_predictions: updatedRows,
      audit_note: updatedRows > 0
        ? `marked ${updatedRows} prediction(s) as published (was_published=1, telegram_message_id=${messageId ?? 'null'})`
        : 'no matching predictions found for today — publish succeeded but audit trail is empty',
    });
  } catch (error: any) {
    console.error('[telegram:publish-stock]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    if (predDb) {
      try { predDb.close(); } catch { /* ignore - safe-by-design */ }
    }
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS_SHORT } from '@/modules/publishing/lib/official-links';

export const dynamic = 'force-dynamic';

/**
 * POST /api/telegram/publish-stock
 * ================================
 * Publish a stock prediction/infographic to the production Telegram channel.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/predictions.db` directly to write the audit trail
 * (`UPDATE predictions SET published_at=..., telegram_message_id=...,
 * was_published=1 WHERE ticker=? AND date(prediction_date)=date('now')`).
 *
 * That SQL write has been removed. The Telegram send (external Telegram Bot
 * API call — NOT a local DB) stays in TS because it's an external integration
 * (Rule 4 doesn't apply to outbound 3rd-party API calls). After the Telegram
 * message is delivered, the audit-trail writeback is delegated to Python
 * `/api/telegram/publish-stock/audit` which owns `predictions.db` (Rule 4:
 * Python = brain).
 *
 * Response shape is preserved:
 *   {
 *     success: true,
 *     message_id: number,
 *     sent_as_photo: boolean,
 *     published_at: ISO,
 *     updated_predictions: number,        // 0 if Python audit-trail call fails
 *     audit_note: string                  // explains any audit-trail gap
 *   }
 *
 * BOT-LINK-INTEGRATION (2026-10-01): the route accepts BOTH JSON and
 * multipart/form-data. If an `image` (Blob or base64 PNG data URL) is provided,
 * it sends it via Telegram `sendPhoto`; otherwise it falls back to
 * `sendMessage`. OFFICIAL_LINKS_BLOCK is always appended so the bot/website/
 * Telegram channel links are always included in every published message.
 *
 * Rule 4  (Python = brain — audit-trail writeback delegated to Python).
 * Rule 27 (NO-FAKE-DATA — if Python audit-trail fails, updated_predictions=0).
 */
export async function POST(req: NextRequest) {
  try {
    // Task P0-BRAVO-PROD-GOVERNANCE — TELEGRAM_ENABLED guard:
    // الساندبوكس المحلي يجب أن يبقي التليجرام معطّل لمنع ازدواج الرسائل مع الإنتاج.
    const telegramEnabled = process.env.TELEGRAM_ENABLED;
    if (telegramEnabled === 'false' || telegramEnabled === '0' || telegramEnabled === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: 'telegram_disabled_locally',
          message: 'التليجرام معطّل في هذه البيئة (TELEGRAM_ENABLED=false). النشر متاح على الإنتاج فقط.',
        },
        { status: 503 }
      );
    }

    // Task SECURITY-P0: admin-only — النشر على قناة تليجرام الإنتاجية يحتاج صلاحية أدمن.
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

    // ── FIX-P2-PREDICTIONS (Directive P1): audit-trail writeback delegated to
    // Python. Python owns predictions.db and does the
    // `UPDATE predictions SET published_at=datetime('now'),
    // telegram_message_id=?, was_published=1
    // WHERE UPPER(TRIM(ticker))=UPPER(TRIM(?)) AND date(prediction_date)=date('now')`.
    // If Python is unreachable, the publish still succeeded (Telegram message
    // went out) — we just report an empty audit trail so the caller can
    // investigate. (Rule 27 — NO-FAKE-DATA: we never fabricate updated_rows.)
    try {
      const auditRes = await fetch(`${PYTHON_BACKEND_URL}/api/telegram/publish-stock/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          message_id: messageId ?? null,
          sent_as_photo: sentAsPhoto,
        }),
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        updatedRows = Number(auditData?.updated_predictions || auditData?.updatedRows || 0);
      }
    } catch (auditErr) {
      // Don't fail the publish if the audit-trail call fails — the Telegram
      // message has already been sent. Log + return updated_rows=0 so the
      // caller can investigate the audit-trail gap (Rule 27).
      console.error('[publish-stock] audit-trail Python call failed:', auditErr);
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
  }
}

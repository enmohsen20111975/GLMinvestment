import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'auth_required' }, { status: 401 });

    const body = await req.json();
    const { ticker, market, channel_id } = body;
    if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const defaultChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (!botToken || !defaultChannel) {
      return NextResponse.json({ success: false, error: 'telegram_not_configured' }, { status: 503 });
    }

    // Build message
    const message = `📊 تحليل سهم: ${ticker}\n📍 منصة دليل الاستثمار — invist.m2y.net`;

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: channel_id || defaultChannel,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      return NextResponse.json({ success: true, message_id: data.result?.message_id });
    } else {
      return NextResponse.json({ success: false, error: data.description || 'telegram_error' }, { status: 502 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

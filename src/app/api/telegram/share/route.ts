import { NextRequest, NextResponse } from 'next/server';
import {
  generateSuccessRateChart,
  generateSignalDistributionChart,
  generateAnalysisCard,
  type PieChartData,
  generatePieChartSVG
} from '@/lib/chart-generator';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';

/**
 * Telegram Share API
 * Sends analysis messages with pie charts and data visualizations to Telegram channel
 *
 * Setup:
 * 1. Create a bot via @BotFather and get the token
 * 2. Add the bot to your channel as admin with "Post Messages" permission
 * 3. Get the channel chat_id (can be @channel_username or -100XXXXXXXXXX)
 * 4. Set TELEGRAM_BOT_TOKEN in your environment variables
 */

interface ShareRequest {
  message: string;
  chatId?: string; // Optional: defaults to the configured channel
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  // Chart options
  chartType?: 'success_rate' | 'signal_distribution' | 'analysis_card' | 'custom_pie' | 'none';
  chartData?: {
    // For success_rate chart
    success?: number;
    failed?: number;
    pending?: number;
    // For signal_distribution chart
    buy?: number;
    hold?: number;
    sell?: number;
    accumulate?: number;
    // For analysis_card
    title?: string;
    subtitle?: string;
    stats?: Array<{ label: string; value: string | number; color?: string }>;
    topStocks?: Array<{ ticker: string; signal: string; price: number }>;
    // For custom pie
    customData?: PieChartData[];
    pieTitle?: string;
  };
  // Links to include in footer
  includeLinks?: boolean;
  websiteUrl?: string;
  androidUrl?: string;
  iosUrl?: string;
}

// Platform links
const PLATFORM_LINKS = {
  website: 'https://invist.m2y.net',
  android: 'https://play.google.com/store/apps/details?id=com.egx.investment',
  ios: '' // Empty until iOS app is released
};

// Convert SVG to PNG using sharp
async function svgToPngBuffer(svg: string): Promise<Buffer | null> {
  try {
    const sharp = await import('sharp');
    const pngBuffer = await sharp.default(Buffer.from(svg))
      .png()
      .toBuffer();
    return pngBuffer;
  } catch (error) {
    console.error('SVG to PNG conversion failed:', error);
    return null;
  }
}

// Generate chart based on type
function generateChartImage(chartType: string, chartData: ShareRequest['chartData']): string | null {
  switch (chartType) {
    case 'success_rate':
      if (chartData?.success !== undefined && chartData?.failed !== undefined) {
        return generateSuccessRateChart({
          success: chartData.success,
          failed: chartData.failed,
          pending: chartData.pending || 0,
          title: chartData.title || 'معدل نجاح التوقعات'
        });
      }
      return null;

    case 'signal_distribution':
      if (chartData?.buy !== undefined || chartData?.hold !== undefined || chartData?.sell !== undefined) {
        return generateSignalDistributionChart({
          buy: chartData.buy || 0,
          hold: chartData.hold || 0,
          sell: chartData.sell || 0,
          accumulate: chartData.accumulate || 0
        });
      }
      return null;

    case 'analysis_card':
      if (chartData?.title && chartData?.stats) {
        return generateAnalysisCard({
          title: chartData.title,
          subtitle: chartData.subtitle,
          stats: chartData.stats,
          topStocks: chartData.topStocks || [],
          platformName: 'دليل الاستثمار',
          links: PLATFORM_LINKS
        });
      }
      return null;

    case 'custom_pie':
      if (chartData?.customData && chartData.customData.length > 0) {
        return generatePieChartSVG(chartData.customData, {
          title: chartData.pieTitle,
          size: 300,
          showLegend: true
        });
      }
      return null;

    case 'none':
    default:
      return null;
  }
}

// Escape HTML special characters for Telegram
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Truncate message to fit Telegram limits
// Text messages: 4096 chars, Photo captions: 1024 chars
function truncateMessage(text: string, maxLength: number = 4000): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Add links to message
function addLinksToMessage(message: string = '', includeLinks: boolean = true): string {
  if (!includeLinks) return message || '';

  return (message || '') + OFFICIAL_LINKS_BLOCK;
}

export async function POST(request: NextRequest) {
  try {
    const body: ShareRequest = await request.json();
    const {
      message,
      parseMode = 'HTML',
      chartType = 'none',
      chartData = {},
      includeLinks = true
    } = body;

    // Get bot token from environment
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const defaultChatId = process.env.TELEGRAM_CHANNEL_ID;

    if (!botToken) {
      return NextResponse.json(
        { success: false, error: 'Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN in environment.' },
        { status: 500 }
      );
    }

    const chatId = body.chatId || defaultChatId;
    if (!chatId) {
      return NextResponse.json(
        { success: false, error: 'No chat ID provided. Set TELEGRAM_CHANNEL_ID or provide chatId.' },
        { status: 400 }
      );
    }

    // Add links to message, escape HTML, and truncate if needed
    // Note: Photo captions have 1024 char limit, text messages have 4096 char limit
    const rawMsg = message || body.customMessage || '';
    const fullMessage = addLinksToMessage(rawMsg, includeLinks);
    const escapedMessage = escapeHtml(fullMessage);

    // Generate chart if requested
    let imageBuffer: Buffer | null = null;

    if (chartType !== 'none') {
      const svgChart = generateChartImage(chartType, chartData);
      if (svgChart) {
        imageBuffer = await svgToPngBuffer(svgChart);
      }
    }

    // If we have an image, send it with the message as caption (limit: 1024 chars)
    if (imageBuffer) {
      // Caption limit is 1024 chars for photos
      const caption = truncateMessage(escapedMessage, 1000);
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'chart.png');
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;

      const response = await fetch(telegramUrl, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Telegram API error:', data);
        // Fallback: send text only
        return await sendTextOnly(botToken, chatId, escapedMessage);
      }

      return NextResponse.json({
        success: true,
        messageId: data.result?.message_id,
        chatId: data.result?.chat?.id,
        hasImage: true,
        chartType: chartType
      });
    } else {
      // No image, send text only (limit: 4096 chars)
      return await sendTextOnly(botToken, chatId, escapedMessage);
    }
  } catch (error) {
    console.error('Telegram share error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to send text only
async function sendTextOnly(
  botToken: string,
  chatId: string,
  message: string
): Promise<NextResponse> {
  // Text message limit is 4096 chars
  const truncatedMessage = truncateMessage(message, 4000);

  const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncatedMessage,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Telegram API error:', data);
    return NextResponse.json(
      { success: false, error: data.description || 'Failed to send message to Telegram' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    messageId: data.result?.message_id,
    chatId: data.result?.chat?.id,
    hasImage: false,
  });
}

// Check if Telegram is configured
export async function GET() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  return NextResponse.json({
    configured: !!botToken && !!channelId,
    hasBotToken: !!botToken,
    hasChannelId: !!channelId,
    supportedCharts: ['success_rate', 'signal_distribution', 'analysis_card', 'custom_pie', 'none'],
    platformLinks: PLATFORM_LINKS
  });
}

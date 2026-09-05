/**
 * AI Chat API - Hybrid Strategy with Memory
 * 
 * Strategy:
 * 1. Quick questions → DeepSeek V3 (fast, cheap)
 * 2. Complex analysis → DeepSeek R1 (thinks)
 * 3. News search → Z.ai Web Search
 * 4. Memory → Context from past conversations
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { callDeepSeek, quickChat, deepAnalysis } from '@/lib/ai/deepseek-client';
import { webSearch, getMarketNews, getMarketSentiment } from '@/lib/ai/tools';
import { memory } from '@/lib/ai/memory';
import { getSessionUserId } from '@/lib/auth-helper';

// Detect question type
function detectQuestionType(message: string): {
  type: 'quick' | 'analysis' | 'news' | 'sentiment';
  needsWebSearch: boolean;
  symbols: string[];
} {
  const lower = message.toLowerCase();
  
  // Extract potential stock/crypto symbols
  const symbolPatterns = [
    /\b[A-Z]{3,4}\b/g, // Stock symbols like COMI, EMGR
    /\b(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|DOT|MATIC)\b/gi // Crypto symbols
  ];
  
  const symbols: string[] = [];
  symbolPatterns.forEach(pattern => {
    const matches = message.match(pattern);
    if (matches) symbols.push(...matches.map(s => s.toUpperCase()));
  });

  // Check for analysis keywords
  const analysisKeywords = ['لماذا', 'ليه', 'تحليل', 'لخّص', 'قارن', 'اكتب تقرير', 'ما رأيك', 'هل يشتري'];
  const newsKeywords = ['أخبار', 'news', 'آخر', 'جديد', 'اليوم'];
  const sentimentKeywords = ['الاتجاه', 'المزاج', 'sentiment', 'هل صاعد', 'هل هابط'];

  let type: 'quick' | 'analysis' | 'news' | 'sentiment' = 'quick';
  let needsWebSearch = false;

  if (sentimentKeywords.some(k => lower.includes(k))) {
    type = 'sentiment';
    needsWebSearch = true;
  } else if (newsKeywords.some(k => lower.includes(k))) {
    type = 'news';
    needsWebSearch = true;
  } else if (analysisKeywords.some(k => lower.includes(k))) {
    type = 'analysis';
  }

  return { type, needsWebSearch, symbols };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Task 13: AI chat is a gated feature - require authentication.
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized',
        error_ar: 'يجب تسجيل الدخول لاستخدام المساعد الذكي',
      }, { status: 401 });
    }

    const body = await request.json();
    const { message, context } = body;

    if (!message) {
      return NextResponse.json({
        success: false,
        error: 'الرسالة مطلوبة'
      }, { status: 400 });
    }

    // Detect question type
    const { type, needsWebSearch, symbols } = detectQuestionType(message);
    
    let webData: string[] = [];
    let toolUsed: string | undefined;
    let memoryContext = '';

    // 1. Get memory context (NEW!)
    try {
      memoryContext = await memory.getContextForQuery(message);
    } catch (e) {
      console.log('Memory not available yet');
    }

    // 2. Fetch web data if needed
    if (needsWebSearch && symbols.length > 0) {
      const market = symbols[0].length <= 4 ? 'egx' : 'crypto';
      
      if (type === 'news') {
        toolUsed = 'web_search';
        const news = await getMarketNews(symbols[0], market);
        webData = news.map(n => `• ${n.title}: ${n.summary}`);
      } else if (type === 'sentiment') {
        toolUsed = 'sentiment_analysis';
        const sentiment = await getMarketSentiment(market);
        webData = [
          `الاتجاه العام: ${sentiment.sentiment === 'bullish' ? 'صاعد 📈' : sentiment.sentiment === 'bearish' ? 'هابط 📉' : 'محايد ➡️'}`,
          `النتيجة: ${sentiment.score}`,
          ...sentiment.reasons
        ];
      }
    }

    // 3. Build enhanced message with context
    let fullContext = '';
    
    if (memoryContext) {
      fullContext += `\n[ذاكرة سابقة]:\n${memoryContext}\n`;
    }
    
    if (webData.length > 0) {
      fullContext += `\n[بيانات حقيقية]:\n${webData.join('\n')}\n`;
    }
    
    if (context?.page) {
      fullContext += `\n[الصفحة الحالية]: ${context.page}`;
    }

    const enhancedMessage = fullContext 
      ? `${message}\n\n---\nالسياق المتاح:${fullContext}`
      : message;

    // 4. Choose model based on question type
    let response;
    if (type === 'analysis' || type === 'sentiment') {
      response = await callDeepSeek(
        [{ role: 'user', content: enhancedMessage }],
        'deepseek-reasoner',
        { temperature: 0.2, maxTokens: 1500 }
      );
      toolUsed = toolUsed || 'deepseek-r1';
    } else {
      response = await quickChat(enhancedMessage);
      toolUsed = toolUsed || 'deepseek-v3';
    }

    const responseTime = Date.now() - startTime;

    // 5. Log conversation to memory (NEW!)
    try {
      await memory.logConversation({
        question: message,
        answer: response.reply,
        page_context: context?.page,
        market: symbols.length > 0 ? (symbols[0].length <= 4 ? 'egx' : 'crypto') : undefined,
        model_used: response.model
      });
    } catch (e) {
      console.log('Could not log to memory');
    }

    return NextResponse.json({
      success: response.success,
      reply: response.reply,
      model: response.model,
      tool_used: toolUsed,
      confidence: response.success ? 'high' : 'low',
      reasoning: response.reasoning,
      memory_used: !!memoryContext,
      response_time_ms: responseTime,
      error: response.error
    });

  } catch (error: any) {
    console.error('AI Chat error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ غير متوقع'
    }, { status: 500 });
  }
}

// Status endpoint
export async function GET() {
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasZai = !!process.env.ZAI_API_KEY;

  // Get memory stats
  let memoryStats = { conversations: 0, decisions: 0, metrics: 0, accuracy: 0 };
  try {
    memoryStats = await memory.getSummary();
  } catch (e) {
    // Memory not initialized yet
  }

  return NextResponse.json({
    success: true,
    model: 'deepseek-v3 + deepseek-r1',
    ollama_running: hasDeepSeek,
    tools_available: [
      hasDeepSeek ? 'deepseek-chat' : null,
      hasDeepSeek ? 'deepseek-reasoner' : null,
      hasZai ? 'web_search' : null,
      hasZai ? 'market_sentiment' : null,
      'memory' // Always available
    ].filter(Boolean),
    memory: memoryStats
  });
}

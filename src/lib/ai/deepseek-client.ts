/**
 * DeepSeek AI Client - Hybrid Strategy
 * 
 * Models:
 * - deepseek-chat (V3): Fast, cheap, for daily tasks
 * - deepseek-reasoner (R1): Thinks before answering, for complex analysis
 */
// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.error
import { logger } from '@/lib/logger';

export type DeepSeekModel = 'deepseek-chat' | 'deepseek-reasoner';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekResponse {
  success: boolean;
  reply: string;
  model: string;
  reasoning?: string; // For R1 model
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: string;
}

// Investment-focused system prompts
const SYSTEM_PROMPTS = {
  chat: `أنت مساعد استثمار ذكي متخصص في:
- تحليل أسهم البورصة المصرية (EGX)
- تحليل العملات الرقمية (Crypto)
- تقديم نصائح استثمارية مبنية على التحليل الفني والأساسي

قواعد مهمة:
1. أجب بالعربية دائماً
2. كن مختصراً وواضحاً
3. قدم تحليلات مبنية على منطق واضح
4. حذر من المخاطر دائماً
5. لا تعطي توقعات نهائية للشراء/البيع`,

  reasoner: `أنت محلل مالي خبير متخصص في:
- التحليل العميق للأسواق المالية
- فهم الأسباب وراء تحركات الأسعار
- تقييم المخاطر والفرص بشكل شامل

عند التحليل:
1. ابدأ بفهم السياق الكامل
2. حلل الأسباب المحتملة
3. قدم سيناريوهات مختلفة
4. احسب نسبة الثقة في كل تحليل
5. حذر من المخاطر دائماً

أجب بالعربية بتنسيق واضح.`
};

/**
 * Call DeepSeek API
 */
export async function callDeepSeek(
  messages: ChatMessage[],
  model: DeepSeekModel = 'deepseek-chat',
  options: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  } = {}
): Promise<DeepSeekResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      reply: 'API Key غير موجود',
      model: model,
      error: 'NO_API_KEY'
    };
  }

  const systemPrompt = options.systemPrompt || 
    (model === 'deepseek-reasoner' ? SYSTEM_PROMPTS.reasoner : SYSTEM_PROMPTS.chat);

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: fullMessages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 1500
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn('deepseek api error', { status: response.status });
      return {
        success: false,
        reply: 'خطأ في الاتصال بـ DeepSeek',
        model: model,
        error: JSON.stringify(errorData)
      };
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    
    return {
      success: true,
      reply: choice?.message?.content || 'لم أتمكن من توليد رد',
      model: model,
      reasoning: choice?.reasoning_content, // For R1
      usage: data.usage
    };

  } catch (error: any) {
    logger.warn('deepseek call error', { err: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      reply: 'خطأ في الاتصال بالشبكة',
      model: model,
      error: 'internal_error'
    };
  }
}

/**
 * Quick chat - uses V3 (fast, cheap)
 */
export async function quickChat(message: string, context?: string): Promise<DeepSeekResponse> {
  const userMessage = context 
    ? `[السياق: ${context}]\n\n${message}`
    : message;

  return callDeepSeek(
    [{ role: 'user', content: userMessage }],
    'deepseek-chat',
    { temperature: 0.5, maxTokens: 1000 }
  );
}

/**
 * Deep analysis - uses R1 (thinks before answering)
 */
export async function deepAnalysis(
  question: string, 
  data?: string
): Promise<DeepSeekResponse> {
  const userMessage = data 
    ? `السؤال: ${question}\n\nالبيانات المتاحة:\n${data}`
    : question;

  return callDeepSeek(
    [{ role: 'user', content: userMessage }],
    'deepseek-reasoner',
    { temperature: 0.2, maxTokens: 2000 }
  );
}

/**
 * Summarize news - uses V3
 */
export async function summarizeNews(newsItems: string[]): Promise<DeepSeekResponse> {
  const newsText = newsItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
  
  return callDeepSeek(
    [{ 
      role: 'user', 
      content: `لخّص الأخبار التالية في 3-5 نقاط رئيسية بالعربية:\n\n${newsText}` 
    }],
    'deepseek-chat',
    { temperature: 0.3, maxTokens: 500 }
  );
}

/**
 * Analyze stock - hybrid approach
 */
export async function analyzeStock(
  symbol: string,
  stockData: {
    price?: number;
    change?: number;
    volume?: number;
    rsi?: number;
    macd?: string;
    news?: string[];
  }
): Promise<DeepSeekResponse> {
  // Use R1 for complex stock analysis
  const dataContext = `
السهم: ${symbol}
السعر: ${stockData.price || 'غير متوفر'}
التغير: ${stockData.change || 'غير متوفر'}%
الحجم: ${stockData.volume || 'غير متوفر'}
RSI: ${stockData.rsi || 'غير متوفر'}
MACD: ${stockData.macd || 'غير متوفر'}
${stockData.news?.length ? `\nآخر الأخبار:\n${stockData.news.join('\n')}` : ''}
  `.trim();

  return callDeepSeek(
    [{ 
      role: 'user', 
      content: `حلل السهم التالي وقدم رؤية شاملة مع تحديد مستويات الدعم والمقاومة والمخاطر:\n\n${dataContext}` 
    }],
    'deepseek-reasoner',
    { temperature: 0.2, maxTokens: 1500 }
  );
}

export default {
  callDeepSeek,
  quickChat,
  deepAnalysis,
  summarizeNews,
  analyzeStock
};

/**
 * محرك تحليل مشاعر الأخبار - News Sentiment Analysis Engine
 * 
 * نظام متكامل لتحليل مشاعر الأخبار المالية باللغتين العربية والإنجليزية
 * خاص بسوق الأوراق المالية المصرية (EGX)
 * 
 * الميزات:
 * - كشف الكلمات المفتاحية الإيجابية والسلبية
 * - تحليل أخبار البنك المركزي المصري (CBE)
 * - تحليل قرارات الشركات (توزيعات، انقسام، استحواذ)
 * - حساب درجة المشاعر (-1 إلى +1)
 * - حساب درجة التأثير (0 إلى 1)
 * 
 * @version 2.0.0
 * @authorM2yDevelopers Team
 */

import { db } from '@/lib/db';

// ==================== TYPES & INTERFACES ====================

/**
 * نتيجة تحليل مشاعر الخبر
 */
export interface NewsSentiment {
  ticker?: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number; // -1 to 1
  impactScore: number; // 0 to 1
  keywords: {
    positive: string[];
    negative: string[];
    cbe: string[];
    corporate: string[];
  };
  category: 'earnings' | 'cbe' | 'corporate' | 'sector' | 'macro';
  signals: string[];
}

/**
 * ملخص مشاعر الأخبار لسهم معين
 */
export interface TickerSentimentSummary {
  ticker: string;
  recentNewsCount: number;
  avgSentimentScore: number;
  avgImpactScore: number;
  dominantSentiment: 'positive' | 'negative' | 'neutral';
  riskLevel: 'low' | 'medium' | 'high';
  signals: string[];
}

/**
 * الكلمات المفتاحية المستخرجة
 */
export interface ExtractedKeywords {
  positive: string[];
  negative: string[];
  cbe: string[];
  corporate: string[];
  all: string[];
}

/**
 * وزن الكلمة المفتاحية
 */
interface KeywordWeight {
  keyword: string;
  weight: number;
  category: 'positive' | 'negative' | 'cbe' | 'corporate';
}

// ==================== KEYWORD DEFINITIONS ====================

/**
 * الكلمات المفتاحية الإيجابية - Positive Keywords
 * كلمات تدل على أخبار جيدة للسهم أو السوق
 */
const POSITIVE_KEYWORDS: Record<string, KeywordWeight[]> = {
  ar: [
    { keyword: 'أرباح', weight: 1.5, category: 'positive' },
    { keyword: 'نمو', weight: 1.2, category: 'positive' },
    { keyword: 'ارتفاع', weight: 1.0, category: 'positive' },
    { keyword: 'تعاقد', weight: 1.3, category: 'positive' },
    { keyword: 'اتفاقية', weight: 1.2, category: 'positive' },
    { keyword: 'توزيعات', weight: 1.4, category: 'corporate' },
    { keyword: 'توسع', weight: 1.1, category: 'positive' },
    { keyword: 'استحواذ', weight: 1.5, category: 'corporate' },
    { keyword: 'نجاح', weight: 1.0, category: 'positive' },
    { keyword: 'زيادة', weight: 1.1, category: 'positive' },
    { keyword: 'أرباح قياسية', weight: 2.0, category: 'positive' },
    { keyword: 'توزيع أرباح', weight: 1.6, category: 'corporate' },
    { keyword: 'تجميع أسهم', weight: 1.3, category: 'corporate' },
    { keyword: 'صعود', weight: 1.0, category: 'positive' },
    { keyword: 'اختراق', weight: 1.2, category: 'positive' },
    { keyword: 'عائد', weight: 1.1, category: 'positive' },
    { keyword: 'توفير', weight: 0.8, category: 'positive' },
    { keyword: 'تمويل', weight: 1.0, category: 'positive' },
    { keyword: 'استثمار', weight: 1.0, category: 'positive' },
    { keyword: 'تطوير', weight: 1.0, category: 'positive' },
  ],
  en: [
    { keyword: 'profit', weight: 1.5, category: 'positive' },
    { keyword: 'growth', weight: 1.2, category: 'positive' },
    { keyword: 'rise', weight: 1.0, category: 'positive' },
    { keyword: 'contract', weight: 1.3, category: 'positive' },
    { keyword: 'agreement', weight: 1.2, category: 'positive' },
    { keyword: 'dividend', weight: 1.4, category: 'corporate' },
    { keyword: 'expansion', weight: 1.1, category: 'positive' },
    { keyword: 'acquisition', weight: 1.5, category: 'corporate' },
    { keyword: 'success', weight: 1.0, category: 'positive' },
    { keyword: 'increase', weight: 1.1, category: 'positive' },
    { keyword: 'record profit', weight: 2.0, category: 'positive' },
    { keyword: 'stock split', weight: 1.2, category: 'corporate' },
    { keyword: 'buyback', weight: 1.3, category: 'corporate' },
    { keyword: 'surge', weight: 1.3, category: 'positive' },
    { keyword: 'breakout', weight: 1.2, category: 'positive' },
    { keyword: 'return', weight: 1.1, category: 'positive' },
    { keyword: 'funding', weight: 1.0, category: 'positive' },
    { keyword: 'investment', weight: 1.0, category: 'positive' },
    { keyword: 'development', weight: 1.0, category: 'positive' },
  ]
};

/**
 * الكلمات المفتاحية السلبية - Negative Keywords
 * كلمات تدل على أخبار سيئة للسهم أو السوق
 */
const NEGATIVE_KEYWORDS: Record<string, KeywordWeight[]> = {
  ar: [
    { keyword: 'خسائر', weight: 1.5, category: 'negative' },
    { keyword: 'انخفاض', weight: 1.2, category: 'negative' },
    { keyword: 'إضراب', weight: 1.4, category: 'negative' },
    { keyword: 'تحقيق', weight: 1.1, category: 'negative' },
    { keyword: 'مخالفات', weight: 1.6, category: 'negative' },
    { keyword: 'تأخر', weight: 0.9, category: 'negative' },
    { keyword: 'إلغاء', weight: 1.3, category: 'negative' },
    { keyword: 'تراجع', weight: 1.1, category: 'negative' },
    { keyword: 'ديون', weight: 1.2, category: 'negative' },
    { keyword: 'مشكلات', weight: 1.0, category: 'negative' },
    { keyword: 'تعليق', weight: 1.3, category: 'negative' },
    { keyword: 'غرامة', weight: 1.4, category: 'negative' },
    { keyword: 'شكوى', weight: 1.1, category: 'negative' },
    { keyword: 'حظر', weight: 1.5, category: 'negative' },
    { keyword: 'إنذار', weight: 1.2, category: 'negative' },
    { keyword: 'هبوط', weight: 1.1, category: 'negative' },
    { keyword: 'انهيار', weight: 1.8, category: 'negative' },
    { keyword: 'أزمة', weight: 1.4, category: 'negative' },
    { keyword: 'إفلاس', weight: 2.0, category: 'negative' },
    { keyword: 'تخفيض', weight: 1.0, category: 'negative' },
    { keyword: 'بيع', weight: 0.8, category: 'negative' },
    { keyword: 'تصفية', weight: 1.6, category: 'negative' },
  ],
  en: [
    { keyword: 'loss', weight: 1.5, category: 'negative' },
    { keyword: 'decline', weight: 1.2, category: 'negative' },
    { keyword: 'strike', weight: 1.4, category: 'negative' },
    { keyword: 'investigation', weight: 1.1, category: 'negative' },
    { keyword: 'violations', weight: 1.6, category: 'negative' },
    { keyword: 'delay', weight: 0.9, category: 'negative' },
    { keyword: 'cancel', weight: 1.3, category: 'negative' },
    { keyword: 'retreat', weight: 1.1, category: 'negative' },
    { keyword: 'debt', weight: 1.2, category: 'negative' },
    { keyword: 'problems', weight: 1.0, category: 'negative' },
    { keyword: 'suspend', weight: 1.3, category: 'negative' },
    { keyword: 'fine', weight: 1.4, category: 'negative' },
    { keyword: 'complaint', weight: 1.1, category: 'negative' },
    { keyword: 'ban', weight: 1.5, category: 'negative' },
    { keyword: 'warning', weight: 1.2, category: 'negative' },
    { keyword: 'fall', weight: 1.1, category: 'negative' },
    { keyword: 'collapse', weight: 1.8, category: 'negative' },
    { keyword: 'crisis', weight: 1.4, category: 'negative' },
    { keyword: 'bankruptcy', weight: 2.0, category: 'negative' },
    { keyword: 'downgrade', weight: 1.0, category: 'negative' },
    { keyword: 'sell', weight: 0.8, category: 'negative' },
    { keyword: 'liquidation', weight: 1.6, category: 'negative' },
  ]
};

/**
 * كلمات البنك المركزي المصري - CBE Keywords
 * قرارات وتصريحات البنك المركزي ذات التأثير العالي
 */
const CBE_KEYWORDS: Record<string, KeywordWeight[]> = {
  ar: [
    { keyword: 'البنك المركزي', weight: 1.5, category: 'cbe' },
    { keyword: 'قرار البنك المركزي', weight: 1.8, category: 'cbe' },
    { keyword: 'سعر الفائدة', weight: 2.0, category: 'cbe' },
    { keyword: 'الاحتياطي', weight: 1.4, category: 'cbe' },
    { keyword: 'السياسة النقدية', weight: 1.5, category: 'cbe' },
    { keyword: 'الجنيه', weight: 1.3, category: 'cbe' },
    { keyword: 'الدولار', weight: 1.2, category: 'cbe' },
    { keyword: 'تخفيض العملة', weight: 2.0, category: 'cbe' },
    { keyword: 'تعويم', weight: 2.0, category: 'cbe' },
    { keyword: 'رفع الفائدة', weight: 1.8, category: 'cbe' },
    { keyword: 'خفض الفائدة', weight: 1.8, category: 'cbe' },
    { keyword: 'صرف العملة', weight: 1.4, category: 'cbe' },
    { keyword: 'النقد الأجنبي', weight: 1.3, category: 'cbe' },
    { keyword: 'معدل التضخم', weight: 1.5, category: 'cbe' },
    { keyword: 'أسعار الصرف', weight: 1.6, category: 'cbe' },
  ],
  en: [
    { keyword: 'central bank', weight: 1.5, category: 'cbe' },
    { keyword: 'cbe decision', weight: 1.8, category: 'cbe' },
    { keyword: 'interest rate', weight: 2.0, category: 'cbe' },
    { keyword: 'reserve', weight: 1.4, category: 'cbe' },
    { keyword: 'monetary policy', weight: 1.5, category: 'cbe' },
    { keyword: 'pound', weight: 1.3, category: 'cbe' },
    { keyword: 'dollar', weight: 1.2, category: 'cbe' },
    { keyword: 'devaluation', weight: 2.0, category: 'cbe' },
    { keyword: 'float', weight: 2.0, category: 'cbe' },
    { keyword: 'rate hike', weight: 1.8, category: 'cbe' },
    { keyword: 'rate cut', weight: 1.8, category: 'cbe' },
    { keyword: 'currency exchange', weight: 1.4, category: 'cbe' },
    { keyword: 'foreign currency', weight: 1.3, category: 'cbe' },
    { keyword: 'inflation rate', weight: 1.5, category: 'cbe' },
    { keyword: 'exchange rate', weight: 1.6, category: 'cbe' },
  ]
};

/**
 * كلمات قرارات الشركات - Corporate Action Keywords
 * قرارات الشركات المدرجة (توزيعات، انقسام، تجميع)
 */
const CORPORATE_KEYWORDS: Record<string, KeywordWeight[]> = {
  ar: [
    { keyword: 'توزيع أرباح', weight: 1.6, category: 'corporate' },
    { keyword: 'تجميع أسهم', weight: 1.3, category: 'corporate' },
    { keyword: 'انقسام الأسهم', weight: 1.2, category: 'corporate' },
    { keyword: 'استحواذ', weight: 1.5, category: 'corporate' },
    { keyword: 'اندماج', weight: 1.4, category: 'corporate' },
    { keyword: 'اكتتاب', weight: 1.3, category: 'corporate' },
    { keyword: 'زيادة رأس المال', weight: 1.2, category: 'corporate' },
    { keyword: 'تخفيض رأس المال', weight: 1.5, category: 'corporate' },
    { keyword: 'تغيير مجلس الإدارة', weight: 1.0, category: 'corporate' },
    { keyword: 'الجمعية العمومية', weight: 1.1, category: 'corporate' },
    { keyword: 'كوبون', weight: 1.4, category: 'corporate' },
    { keyword: 'حقوق أولوية', weight: 1.2, category: 'corporate' },
    { keyword: 'أسهم مجانية', weight: 1.4, category: 'corporate' },
    { keyword: 'بيع أصول', weight: 1.1, category: 'corporate' },
    { keyword: 'شراكة استراتيجية', weight: 1.3, category: 'corporate' },
  ],
  en: [
    { keyword: 'dividend distribution', weight: 1.6, category: 'corporate' },
    { keyword: 'stock consolidation', weight: 1.3, category: 'corporate' },
    { keyword: 'stock split', weight: 1.2, category: 'corporate' },
    { keyword: 'acquisition', weight: 1.5, category: 'corporate' },
    { keyword: 'merger', weight: 1.4, category: 'corporate' },
    { keyword: 'subscription', weight: 1.3, category: 'corporate' },
    { keyword: 'capital increase', weight: 1.2, category: 'corporate' },
    { keyword: 'capital reduction', weight: 1.5, category: 'corporate' },
    { keyword: 'board change', weight: 1.0, category: 'corporate' },
    { keyword: 'general assembly', weight: 1.1, category: 'corporate' },
    { keyword: 'coupon', weight: 1.4, category: 'corporate' },
    { keyword: 'priority rights', weight: 1.2, category: 'corporate' },
    { keyword: 'bonus shares', weight: 1.4, category: 'corporate' },
    { keyword: 'asset sale', weight: 1.1, category: 'corporate' },
    { keyword: 'strategic partnership', weight: 1.3, category: 'corporate' },
  ]
};

// ==================== HELPER FUNCTIONS ====================

/**
 * تنظيف النص من الرموز الخاصة والأحرف الزائدة
 * @param text النص المراد تنظيفه
 * @returns النص المنظف
 */
function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ') // إبقاء الأحرف والأرقام والعربية فقط
    .replace(/\s+/g, ' ') // إزالة المسافات الزائدة
    .trim()
    .toLowerCase();
}

/**
 * حساب التشابه بين كلمتين (للكلمات المركبة)
 * @param word1 الكلمة الأولى
 * @param word2 الكلمة الثانية
 * @returns نسبة التشابه (0-1)
 */
function calculateSimilarity(word1: string, word2: string): number {
  const w1 = word1.toLowerCase();
  const w2 = word2.toLowerCase();
  
  if (w1 === w2) return 1;
  if (w1.includes(w2) || w2.includes(w1)) return 0.8;
  
  // Levenshtein distance for short words
  if (w1.length <= 5 && w2.length <= 5) {
    const matrix: number[][] = [];
    for (let i = 0; i <= w1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= w2.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= w1.length; i++) {
      for (let j = 1; j <= w2.length; j++) {
        const cost = w1[i - 1] === w2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    const distance = matrix[w1.length][w2.length];
    return 1 - distance / Math.max(w1.length, w2.length);
  }
  
  return 0;
}

/**
 * تحديد فئة الخبر بناءً على المحتوى
 * @param title عنوان الخبر
 * @param content محتوى الخبر
 * @param keywords الكلمات المفتاحية المستخرجة
 * @returns فئة الخبر
 */
function determineCategory(
  title: string,
  content: string,
  keywords: ExtractedKeywords
): 'earnings' | 'cbe' | 'corporate' | 'sector' | 'macro' {
  const fullText = `${title} ${content}`.toLowerCase();
  
  // CBE news - أعلى أولوية
  if (keywords.cbe.length > 0) {
    return 'cbe';
  }
  
  // Corporate actions
  if (keywords.corporate.length > 0) {
    // التحقق إذا كان الخبر عن أرباح
    const earningsKeywords = ['أرباح', 'profit', 'earnings', 'نتائج', 'results'];
    if (earningsKeywords.some(k => fullText.includes(k))) {
      return 'earnings';
    }
    return 'corporate';
  }
  
  // Earnings news
  const earningsPatterns = [
    /أرباح.*ربع/,
    /quarterly.*profit/i,
    /نتائج.*مالية/,
    /financial.*results/i,
    /بيانات.*ربعية/,
    /quarterly.*results/i,
  ];
  
  if (earningsPatterns.some(p => p.test(fullText))) {
    return 'earnings';
  }
  
  // Sector news
  const sectorPatterns = [
    /قطاع/,
    /sector/i,
    /صناعة/,
    /industry/i,
    /مجال/,
  ];
  
  if (sectorPatterns.some(p => p.test(fullText))) {
    return 'sector';
  }
  
  // Default to macro
  return 'macro';
}

/**
 * توليد إشارات تحليلية بناءً على المشاعر والتأثير
 * @param sentiment نتيجة المشاعر
 * @param impactScore درجة التأثير
 * @param keywords الكلمات المفتاحية
 * @returns قائمة الإشارات
 */
function generateSignals(
  sentiment: 'positive' | 'negative' | 'neutral',
  impactScore: number,
  keywords: ExtractedKeywords
): string[] {
  const signals: string[] = [];
  
  // إشارات المشاعر
  if (sentiment === 'positive') {
    if (impactScore >= 0.7) {
      signals.push('إشارة إيجابية قوية - فرصة شراء محتملة');
      signals.push('Strong positive signal - potential buying opportunity');
    } else if (impactScore >= 0.4) {
      signals.push('إشارة إيجابية متوسطة - راقب السهم');
      signals.push('Moderate positive signal - monitor the stock');
    }
  } else if (sentiment === 'negative') {
    if (impactScore >= 0.7) {
      signals.push('تحذير: إشارة سلبية قوية - توخي الحذر');
      signals.push('WARNING: Strong negative signal - exercise caution');
    } else if (impactScore >= 0.4) {
      signals.push('إشارة سلبية متوسطة - راقب عن كثب');
      signals.push('Moderate negative signal - monitor closely');
    }
  } else {
    signals.push('مشاعر محايدة - لا إشارة واضحة');
    signals.push('Neutral sentiment - no clear signal');
  }
  
  // إشارات CBE
  if (keywords.cbe.length > 0) {
    signals.push('قرار بنكي مركزي - تأثير عالي على السوق');
    signals.push('CBE decision - high market impact expected');
  }
  
  // إشارات Corporate
  if (keywords.corporate.length > 0) {
    const hasDividend = keywords.corporate.some(k => 
      k.includes('توزيع') || k.includes('dividend') || k.includes('كوبون')
    );
    if (hasDividend) {
      signals.push('توزيع أرباح - تحقق من تاريخ الاستحقاق');
      signals.push('Dividend distribution - check ex-dividend date');
    }
  }
  
  return signals;
}

// ==================== MAIN FUNCTIONS ====================

/**
 * استخراج الكلمات المفتاحية من النص
 * Extract keywords from Arabic/English text
 * 
 * @param text النص المراد تحليله
 * @returns الكلمات المفتاحية المستخرجة
 */
export function extractKeywords(text: string): ExtractedKeywords {
  if (!text || typeof text !== 'string') {
    return {
      positive: [],
      negative: [],
      cbe: [],
      corporate: [],
      all: []
    };
  }
  
  const cleanedText = cleanText(text);
  const words = cleanedText.split(' ');
  
  const result: ExtractedKeywords = {
    positive: [],
    negative: [],
    cbe: [],
    corporate: [],
    all: []
  };
  
  // البحث في الكلمات العربية والإنجليزية
  const allKeywordLists = [
    { list: POSITIVE_KEYWORDS.ar, target: 'positive' },
    { list: POSITIVE_KEYWORDS.en, target: 'positive' },
    { list: NEGATIVE_KEYWORDS.ar, target: 'negative' },
    { list: NEGATIVE_KEYWORDS.en, target: 'negative' },
    { list: CBE_KEYWORDS.ar, target: 'cbe' },
    { list: CBE_KEYWORDS.en, target: 'cbe' },
    { list: CORPORATE_KEYWORDS.ar, target: 'corporate' },
    { list: CORPORATE_KEYWORDS.en, target: 'corporate' },
  ];
  
  for (const { list, target } of allKeywordLists) {
    for (const keywordWeight of list) {
      const keyword = keywordWeight.keyword.toLowerCase();
      
      // البحث عن الكلمة في النص
      if (cleanedText.includes(keyword)) {
        if (target === 'positive' && !result.positive.includes(keywordWeight.keyword)) {
          result.positive.push(keywordWeight.keyword);
        } else if (target === 'negative' && !result.negative.includes(keywordWeight.keyword)) {
          result.negative.push(keywordWeight.keyword);
        } else if (target === 'cbe' && !result.cbe.includes(keywordWeight.keyword)) {
          result.cbe.push(keywordWeight.keyword);
        } else if (target === 'corporate' && !result.corporate.includes(keywordWeight.keyword)) {
          result.corporate.push(keywordWeight.keyword);
        }
        
        if (!result.all.includes(keywordWeight.keyword)) {
          result.all.push(keywordWeight.keyword);
        }
      }
      
      // البحث عن الكلمات المركبة (كلمتين أو أكثر)
      if (keyword.includes(' ')) {
        const keywordParts = keyword.split(' ');
        const found = keywordParts.every(part => 
          cleanedText.includes(part)
        );
        if (found) {
          if (target === 'positive' && !result.positive.includes(keywordWeight.keyword)) {
            result.positive.push(keywordWeight.keyword);
          } else if (target === 'negative' && !result.negative.includes(keywordWeight.keyword)) {
            result.negative.push(keywordWeight.keyword);
          } else if (target === 'cbe' && !result.cbe.includes(keywordWeight.keyword)) {
            result.cbe.push(keywordWeight.keyword);
          } else if (target === 'corporate' && !result.corporate.includes(keywordWeight.keyword)) {
            result.corporate.push(keywordWeight.keyword);
          }
          
          if (!result.all.includes(keywordWeight.keyword)) {
            result.all.push(keywordWeight.keyword);
          }
        }
      }
    }
  }
  
  return result;
}

/**
 * حساب درجة المشاعر
 * Calculate sentiment score from keywords
 * 
 * @param keywords الكلمات المفتاحية المستخرجة
 * @returns درجة المشاعر (-1 إلى +1)
 */
export function calculateSentimentScore(keywords: ExtractedKeywords): number {
  let totalScore = 0;
  let totalWeight = 0;
  
  // حساب درجة الكلمات الإيجابية
  const allPositive = [...POSITIVE_KEYWORDS.ar, ...POSITIVE_KEYWORDS.en];
  for (const keyword of keywords.positive) {
    const found = allPositive.find(k => 
      k.keyword.toLowerCase() === keyword.toLowerCase()
    );
    if (found) {
      totalScore += found.weight;
      totalWeight += found.weight;
    } else {
      // وزن افتراضي للكلمات غير المدرجة
      totalScore += 1.0;
      totalWeight += 1.0;
    }
  }
  
  // حساب درجة الكلمات السلبية
  const allNegative = [...NEGATIVE_KEYWORDS.ar, ...NEGATIVE_KEYWORDS.en];
  for (const keyword of keywords.negative) {
    const found = allNegative.find(k => 
      k.keyword.toLowerCase() === keyword.toLowerCase()
    );
    if (found) {
      totalScore -= found.weight;
      totalWeight += found.weight;
    } else {
      // وزن افتراضي للكلمات غير المدرجة
      totalScore -= 1.0;
      totalWeight += 1.0;
    }
  }
  
  // إذا لم يتم العثور على كلمات، المشاعر محايدة
  if (totalWeight === 0) {
    return 0;
  }
  
  // تطبيع النتيجة بين -1 و +1
  const normalizedScore = totalScore / totalWeight;
  
  // التأكد من أن النتيجة في النطاق الصحيح
  return Math.max(-1, Math.min(1, normalizedScore));
}

/**
 * حساب درجة التأثير
 * Calculate impact score based on news category and content
 * 
 * @param news بيانات الخبر
 * @param ticker رمز السهم (اختياري)
 * @returns درجة التأثير (0 إلى 1)
 */
export function calculateImpactScore(
  news: { title: string; content?: string; category?: string },
  ticker?: string
): number {
  const { title, content = '', category } = news;
  const fullText = `${title} ${content}`.toLowerCase();
  const keywords = extractKeywords(fullText);
  
  let baseImpact = 0.3; // درجة أساسية
  
  // التأثير حسب الفئة
  const categoryImpacts: Record<string, number> = {
    'cbe': 0.9,       // قرارات البنك المركزي = تأثير عالي جداً
    'earnings': 0.7,  // نتائج الأرباح = تأثير عالي
    'corporate': 0.6, // قرارات الشركات = تأوسط متوسط-عالي
    'sector': 0.5,    // أخبار القطاع = تأثير متوسط
    'macro': 0.3,     // أخبار اقتصادية عامة = تأثير منخفض
  };
  
  // تحديد الفئة وتطبيق التأثير
  const determinedCategory = category || determineCategory(title, content, keywords);
  baseImpact = categoryImpacts[determinedCategory] || 0.3;
  
  // تعديلات إضافية
  
  // إذا كان الخبر مرتبط بسهم محدد
  if (ticker && fullText.includes(ticker.toLowerCase())) {
    baseImpact += 0.15;
  }
  
  // زيادة التأثير لوجود كلمات CBE
  if (keywords.cbe.length > 0) {
    baseImpact = Math.min(1.0, baseImpact + 0.1 * keywords.cbe.length);
  }
  
  // زيادة التأثير لوجود كلمات corporate متعددة
  if (keywords.corporate.length >= 2) {
    baseImpact = Math.min(1.0, baseImpact + 0.1);
  }
  
  // التحقق من وجود كلمات قوية (وزن > 1.5)
  const strongPositive = keywords.positive.some(k => {
    const found = [...POSITIVE_KEYWORDS.ar, ...POSITIVE_KEYWORDS.en].find(
      kw => kw.keyword.toLowerCase() === k.toLowerCase()
    );
    return found && found.weight >= 1.5;
  });
  
  const strongNegative = keywords.negative.some(k => {
    const found = [...NEGATIVE_KEYWORDS.ar, ...NEGATIVE_KEYWORDS.en].find(
      kw => kw.keyword.toLowerCase() === k.toLowerCase()
    );
    return found && found.weight >= 1.5;
  });
  
  if (strongPositive || strongNegative) {
    baseImpact = Math.min(1.0, baseImpact + 0.15);
  }
  
  // التأكد من أن النتيجة في النطاق الصحيح
  return Math.max(0, Math.min(1, baseImpact));
}

/**
 * تحليل مشاعر الخبر الرئيسي
 * Main function to analyze news sentiment
 * 
 * @param title عنوان الخبر
 * @param content محتوى الخبر (اختياري)
 * @param ticker رمز السهم (اختياري)
 * @returns نتيجة تحليل المشاعر
 */
export function analyzeNewsSentiment(
  title: string,
  content?: string,
  ticker?: string
): NewsSentiment {
  // التحقق من صحة المدخلات
  if (!title || typeof title !== 'string') {
    return {
      ticker,
      title: '',
      sentiment: 'neutral',
      sentimentScore: 0,
      impactScore: 0,
      keywords: {
        positive: [],
        negative: [],
        cbe: [],
        corporate: []
      },
      category: 'macro',
      signals: ['لا يوجد نص للتحليل', 'No text to analyze']
    };
  }
  
  // استخراج الكلمات المفتاحية
  const fullText = content ? `${title} ${content}` : title;
  const keywords = extractKeywords(fullText);
  
  // حساب درجة المشاعر
  const sentimentScore = calculateSentimentScore(keywords);
  
  // حساب درجة التأثير
  const impactScore = calculateImpactScore({ title, content }, ticker);
  
  // تحديد المشاعر
  let sentiment: 'positive' | 'negative' | 'neutral';
  if (sentimentScore >= 0.15) {
    sentiment = 'positive';
  } else if (sentimentScore <= -0.15) {
    sentiment = 'negative';
  } else {
    sentiment = 'neutral';
  }
  
  // تحديد فئة الخبر
  const category = determineCategory(title, content || '', keywords);
  
  // توليد الإشارات
  const signals = generateSignals(sentiment, impactScore, keywords);
  
  return {
    ticker,
    title,
    sentiment,
    sentimentScore: Math.round(sentimentScore * 100) / 100,
    impactScore: Math.round(impactScore * 100) / 100,
    keywords: {
      positive: keywords.positive,
      negative: keywords.negative,
      cbe: keywords.cbe,
      corporate: keywords.corporate
    },
    category,
    signals
  };
}

/**
 * الحصول على ملخص مشاعر الأخبار لسهم معين
 * Get aggregated sentiment for a ticker
 * 
 * @param ticker رمز السهم
 * @param daysBack عدد الأيام للرجوع (افتراضي 7)
 * @returns ملخص مشاعر الأخبار
 */
export async function getTickerNewsSentiment(
  ticker: string,
  daysBack: number = 7
): Promise<TickerSentimentSummary> {
  try {
    // حساب تاريخ البداية
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // جلب الأخبار من قاعدة البيانات
    const newsItems = await db.news_items.findMany({
      where: {
        ticker: ticker.toUpperCase(),
        published_at: {
          gte: startDateStr
        }
      },
      orderBy: {
        published_at: 'desc'
      }
    });
    
    // إذا لم تكن هناك أخبار
    if (newsItems.length === 0) {
      return {
        ticker: ticker.toUpperCase(),
        recentNewsCount: 0,
        avgSentimentScore: 0,
        avgImpactScore: 0,
        dominantSentiment: 'neutral',
        riskLevel: 'low',
        signals: ['لا توجد أخبار حديثة لهذا السهم', 'No recent news for this ticker']
      };
    }
    
    // حساب المتوسطات
    const sentimentScores = newsItems.map(n => n.sentiment_score);
    const impactScores = newsItems.map(n => n.impact_score);
    
    const avgSentimentScore = sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length;
    const avgImpactScore = impactScores.reduce((a, b) => a + b, 0) / impactScores.length;
    
    // تحديد المشاعر السائدة
    const positiveCount = newsItems.filter(n => n.sentiment === 'positive').length;
    const negativeCount = newsItems.filter(n => n.sentiment === 'negative').length;
    const neutralCount = newsItems.filter(n => n.sentiment === 'neutral').length;
    
    let dominantSentiment: 'positive' | 'negative' | 'neutral';
    if (positiveCount > negativeCount && positiveCount > neutralCount) {
      dominantSentiment = 'positive';
    } else if (negativeCount > positiveCount && negativeCount > neutralCount) {
      dominantSentiment = 'negative';
    } else {
      dominantSentiment = 'neutral';
    }
    
    // تحديد مستوى المخاطرة
    let riskLevel: 'low' | 'medium' | 'high';
    if (avgSentimentScore <= -0.5 || (dominantSentiment === 'negative' && avgImpactScore >= 0.6)) {
      riskLevel = 'high';
    } else if (avgSentimentScore <= -0.2 || dominantSentiment === 'negative') {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }
    
    // توليد الإشارات
    const signals: string[] = [];
    
    if (dominantSentiment === 'positive') {
      signals.push(`اتجاه إيجابي في الأخبار (${positiveCount} خبر إيجابي من ${newsItems.length})`);
      signals.push(`Positive news trend (${positiveCount} positive out of ${newsItems.length})`);
    } else if (dominantSentiment === 'negative') {
      signals.push(`اتجاه سلبي في الأخبار (${negativeCount} خبر سلبي من ${newsItems.length})`);
      signals.push(`Negative news trend (${negativeCount} negative out of ${newsItems.length})`);
    } else {
      signals.push(`أخبار متوازنة (${neutralCount} خبر محايد)`);
      signals.push(`Balanced news (${neutralCount} neutral)`);
    }
    
    if (riskLevel === 'high') {
      signals.push('⚠️ تحذير: مخاطرة عالية بسبب الأخبار السلبية');
      signals.push('⚠️ Warning: High risk due to negative news');
    }
    
    return {
      ticker: ticker.toUpperCase(),
      recentNewsCount: newsItems.length,
      avgSentimentScore: Math.round(avgSentimentScore * 100) / 100,
      avgImpactScore: Math.round(avgImpactScore * 100) / 100,
      dominantSentiment,
      riskLevel,
      signals
    };
  } catch (error) {
    console.error('[NewsSentimentEngine] Error getting ticker sentiment:', error);
    
    return {
      ticker: ticker.toUpperCase(),
      recentNewsCount: 0,
      avgSentimentScore: 0,
      avgImpactScore: 0,
      dominantSentiment: 'neutral',
      riskLevel: 'low',
      signals: ['خطأ في جلب الأخبار', 'Error fetching news']
    };
  }
}

/**
 * حفظ الخبر المحلل في قاعدة البيانات
 * Save analyzed news to database
 * 
 * @param news بيانات الخبر
 * @returns معرف الخبر المحفوظ
 */
export async function saveNewsAnalysis(news: {
  ticker?: string;
  title: string;
  title_ar?: string;
  content?: string;
  source?: string;
  url?: string;
  published_at: string;
}): Promise<number> {
  try {
    // تحليل الخبر
    const analysis = analyzeNewsSentiment(news.title, news.content, news.ticker);
    
    // حفظ في قاعدة البيانات
    const saved = await db.news_items.create({
      data: {
        ticker: news.ticker?.toUpperCase() || null,
        title: news.title,
        title_ar: news.title_ar || null,
        content: news.content || null,
        source: news.source || 'unknown',
        url: news.url || null,
        published_at: news.published_at,
        sentiment: analysis.sentiment,
        sentiment_score: analysis.sentimentScore,
        impact_score: analysis.impactScore,
        keywords: JSON.stringify(analysis.keywords),
        category: analysis.category,
        processed: 1
      }
    });
    
    return saved.id;
  } catch (error) {
    console.error('[NewsSentimentEngine] Error saving news analysis:', error);
    throw error;
  }
}

/**
 * تحليل دفعة من الأخبار
 * Batch analyze multiple news items
 * 
 * @param newsList قائمة الأخبار
 * @returns قائمة نتائج التحليل
 */
export function batchAnalyzeNews(newsList: Array<{
  title: string;
  content?: string;
  ticker?: string;
}>): NewsSentiment[] {
  return newsList.map(news => 
    analyzeNewsSentiment(news.title, news.content, news.ticker)
  );
}

/**
 * الحصول على أخبار السوق العامة
 * Get general market news sentiment
 * 
 * @param daysBack عدد الأيام للرجوع
 * @returns تحليل مشاعر السوق
 */
export async function getMarketSentiment(daysBack: number = 3): Promise<{
  totalNews: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  avgSentiment: number;
  avgImpact: number;
  cbeNewsCount: number;
  topKeywords: string[];
}> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const newsItems = await db.news_items.findMany({
      where: {
        published_at: {
          gte: startDateStr
        }
      }
    });
    
    const positiveCount = newsItems.filter(n => n.sentiment === 'positive').length;
    const negativeCount = newsItems.filter(n => n.sentiment === 'negative').length;
    const neutralCount = newsItems.filter(n => n.sentiment === 'neutral').length;
    const cbeNewsCount = newsItems.filter(n => n.category === 'cbe').length;
    
    const avgSentiment = newsItems.length > 0
      ? newsItems.reduce((sum, n) => sum + n.sentiment_score, 0) / newsItems.length
      : 0;
    
    const avgImpact = newsItems.length > 0
      ? newsItems.reduce((sum, n) => sum + n.impact_score, 0) / newsItems.length
      : 0;
    
    // استخراج أهم الكلمات المفتاحية
    const keywordCounts: Record<string, number> = {};
    for (const item of newsItems) {
      if (item.keywords) {
        try {
          const keywords = JSON.parse(item.keywords) as ExtractedKeywords;
          for (const kw of keywords.all || []) {
            keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
    
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword]) => keyword);
    
    return {
      totalNews: newsItems.length,
      positiveCount,
      negativeCount,
      neutralCount,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      avgImpact: Math.round(avgImpact * 100) / 100,
      cbeNewsCount,
      topKeywords
    };
  } catch (error) {
    console.error('[NewsSentimentEngine] Error getting market sentiment:', error);
    
    return {
      totalNews: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      avgSentiment: 0,
      avgImpact: 0,
      cbeNewsCount: 0,
      topKeywords: []
    };
  }
}

/**
 * تصدير الكلمات المفتاحية للاستخدام الخارجي
 */
export const KEYWORDS = {
  POSITIVE: POSITIVE_KEYWORDS,
  NEGATIVE: NEGATIVE_KEYWORDS,
  CBE: CBE_KEYWORDS,
  CORPORATE: CORPORATE_KEYWORDS
};

// ==================== SIMPLIFIED STOP FILTER ====================
// كيمي اقترحت تبسيط الـ News لـ Stop Filter فقط
// ده أوثق من الـ sentiment المعقد اللي ممكن يدي false positives

/**
 * نتيجة فحص الأخبار للـ Stop Filter
 */
export interface NewsStopFilterResult {
  hasNews: boolean;           // فيه خبر على السهم؟
  hasCBENews: boolean;        // فيه خبر CBE؟
  newsCount: number;          // عدد الأخبار
  shouldHold: boolean;        // لازم نحول التوقعة لـ HOLD؟
  reason: string;             // السبب
  reasonAr: string;           // السبب بالعربي
  riskLevel: 'low' | 'medium' | 'high';
  latestNewsDate?: string;    // تاريخ آخر خبر
}

/**
 * فحص الأخبار - Stop Filter بسيط
 * 
 * القواعد (كما اقترح كيمي):
 * 1. لو فيه خبر على السهم في آخر 24 ساعة → HOLD (خوف من التقلب)
 * 2. لو فيه خبر CBE في آخر 24 ساعة → كل التحليلات HOLD
 * 3. لو مفيش أخبار → عادي نكمل التحليل
 * 
 * ده أبسط وأوثق من الـ sentiment analysis المعقد
 * اللي ممكن يدي false positives بسبب تعقيد اللغة العربية
 * 
 * @param ticker رمز السهم
 * @param daysBack عدد الأيام للرجوع (افتراضي 1 يوم)
 * @returns نتيجة الفلتر
 */
export async function checkNewsStopFilter(
  ticker: string,
  daysBack: number = 1
): Promise<NewsStopFilterResult> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // جلب أخبار السهم
    const stockNews = await db.news_items.findMany({
      where: {
        ticker: ticker.toUpperCase(),
        published_at: { gte: startDateStr }
      },
      orderBy: { published_at: 'desc' },
      take: 5
    });
    
    // جلب أخبار CBE (market-wide)
    const cbeNews = await db.news_items.findMany({
      where: {
        category: 'cbe',
        published_at: { gte: startDateStr }
      },
      orderBy: { published_at: 'desc' },
      take: 3
    });
    
    const hasNews = stockNews.length > 0;
    const hasCBENews = cbeNews.length > 0;
    const newsCount = stockNews.length;
    
    // تحديد القرار
    if (hasCBENews) {
      return {
        hasNews,
        hasCBENews: true,
        newsCount,
        shouldHold: true,
        reason: 'CBE decision within 24h - market uncertainty high',
        reasonAr: 'قرار بنك مركزي في آخر 24 ساعة - مخاطرة عالية',
        riskLevel: 'high',
        latestNewsDate: cbeNews[0]?.published_at || undefined
      };
    }
    
    if (hasNews) {
      return {
        hasNews: true,
        hasCBENews: false,
        newsCount,
        shouldHold: true,
        reason: `${newsCount} news item(s) in last 24h - volatility expected`,
        reasonAr: `${newsCount} خبر في آخر 24 ساعة - توقع تقلب`,
        riskLevel: 'medium',
        latestNewsDate: stockNews[0]?.published_at || undefined
      };
    }
    
    // مفيش أخبار - عادي
    return {
      hasNews: false,
      hasCBENews: false,
      newsCount: 0,
      shouldHold: false,
      reason: 'No recent news - proceed with analysis',
      reasonAr: 'لا توجد أخبار حديثة - استمر في التحليل',
      riskLevel: 'low'
    };
    
  } catch (error) {
    console.error('[NewsStopFilter] Error:', error);
    
    // في حالة الخطأ، نرجع low risk عشان نوصلش النظام
    return {
      hasNews: false,
      hasCBENews: false,
      newsCount: 0,
      shouldHold: false,
      reason: 'Error checking news - proceeding with caution',
      reasonAr: 'خطأ في فحص الأخبار - استمرار بحذر',
      riskLevel: 'low'
    };
  }
}

/**
 * فحص سريع لوجود أخبار CBE (للـ Circuit Breaker)
 */
export async function hasRecentCBENews(daysBack: number = 1): Promise<boolean> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const count = await db.news_items.count({
      where: {
        category: 'cbe',
        published_at: { gte: startDateStr }
      }
    });
    
    return count > 0;
  } catch {
    return false;
  }
}

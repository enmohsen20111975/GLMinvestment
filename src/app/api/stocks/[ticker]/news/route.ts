import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStockByTicker } from '@/lib/egx-db';
import ZAI from 'z-ai-web-dev-sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SentimentLabel = 'positive' | 'negative' | 'neutral';

interface NewsItem {
  title: string;
  title_ar: string;
  source: string;
  url: string;
  published_at: string;
  summary: string;
  summary_ar: string;
  sentiment: SentimentLabel;
  sentiment_score: number;
  relevance_score: number;
  categories: string[];
}

interface OverallSentiment {
  score: number;
  label: SentimentLabel;
  label_ar: string;
  confidence: number;
}

interface NewsResponse {
  success: boolean;
  ticker: string;
  stock_name_ar: string;
  news: NewsItem[];
  overall_sentiment: OverallSentiment;
  total_news: number;
  fetched_at: string;
}

interface SearchItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}

// ---------------------------------------------------------------------------
// Cache — 30-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: NewsResponse;
  expiresAt: number;
}

const newsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Sentiment word lists (Arabic)
// ---------------------------------------------------------------------------

const POSITIVE_AR = [
  'ارتفاع', 'نمو', 'أرباح', 'صعود', 'نجاح', 'قوي', 'استثمار',
  'توزيعات', 'محفظة', 'تحسن', 'انتعاش', 'قفزة', 'مكاسب', 'توسع',
  'زيادة', 'إيجابي', 'ممتاز', 'جيد', 'متفائل', 'صعودي', 'استقرار',
  'أداء', 'ناجح', 'مربح', 'ربح', 'عوائد', 'مناسب', 'فرصة', 'مستقبل',
  ' promising', 'profit', 'growth', 'gain', 'surge', 'rally', 'bullish',
  'upgrade', 'outperform', 'strong', 'beat', 'exceeded', 'record',
  'high', 'improve', 'increase', 'positive', 'success', 'dividend',
];

const NEGATIVE_AR = [
  'هبوط', 'خسارة', 'انخفاض', 'ضعف', 'مخاطر', 'ديون', 'خسائر',
  'تراجع', 'انخفاض', 'سالب', 'خطر', 'أزمة', 'خسائر', 'هبوط حاد',
  'تدهور', 'ضعيف', 'سلبي', 'متشائم', 'هابط', 'خسارة فادحة',
  ' انخفاض حاد', 'ضغوط', 'تخفيض', 'خروج', 'فشل', 'شكوى',
  'loss', 'drop', 'fall', 'decline', 'risk', 'debt', 'crash',
  'bearish', 'downgrade', 'weak', 'miss', 'disappoint', 'negative',
  'decrease', 'cut', 'sell', 'warning', 'fraud', 'investigation',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function analyzeSentimentBasic(text: string): { score: number; label: SentimentLabel } {
  const normalized = text.toLowerCase();
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of POSITIVE_AR) {
    if (normalized.includes(word.toLowerCase())) positiveCount++;
  }

  for (const word of NEGATIVE_AR) {
    if (normalized.includes(word.toLowerCase())) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return { score: 0, label: 'neutral' };

  const score = (positiveCount - negativeCount) / total;

  let label: SentimentLabel = 'neutral';
  if (score > 0.2) label = 'positive';
  else if (score < -0.2) label = 'negative';

  return { score: Math.round(score * 100) / 100, label };
}

function extractSourceFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return 'unknown';
  }
}

function computeRelevanceScore(
  title: string,
  snippet: string,
  ticker: string,
  stockName: string,
  stockNameAr: string,
  sector: string | null
): number {
  const combined = `${title} ${snippet}`.toLowerCase();
  const t = ticker.toLowerCase();
  const n = stockName.toLowerCase();
  const na = stockNameAr.toLowerCase();
  let score = 0.3; // base relevance

  if (combined.includes(t)) score += 0.3;
  if (combined.includes(n)) score += 0.2;
  if (combined.includes(na)) score += 0.2;
  if (sector && combined.includes(sector.toLowerCase())) score += 0.1;

  // Bonus for news-specific keywords
  const newsKeywords = ['news', 'أخبار', 'report', 'تقرير', 'analysis', 'تحليل', 'earnings', 'أرباح', 'EGX', 'بورصة'];
  for (const kw of newsKeywords) {
    if (combined.includes(kw)) { score += 0.05; break; }
  }

  return Math.min(1, Math.round(score * 100) / 100);
}

function categorizeNews(title: string, snippet: string): string[] {
  const combined = `${title} ${snippet}`.toLowerCase();
  const categories: string[] = [];

  const categoryMap: Record<string, string[]> = {
    'earnings': ['earnings', 'أرباح', 'revenue', 'إيرادات', 'profit', 'ربح', 'q1', 'q2', 'q3', 'q4', 'quarterly'],
    'technical': ['technical', 'تقني', 'resistance', 'مقاومة', 'support', 'دعم', 'chart', 'رسم', 'macd', 'rsi', 'moving average'],
    'sector': ['sector', 'قطاع', 'industry', 'صناعة', 'market', 'سوق', 'banking', 'بنوك', 'real estate', 'عقارات', 'telecom', 'اتصالات'],
    'regulatory': ['regulation', 'تنظيم', 'central bank', 'البنك المركزي', 'cma', 'الهيئة', 'law', 'قانون', 'tax', 'ضرائب'],
    'dividend': ['dividend', 'توزيع', 'distribution', 'cash', 'نقدي', 'yield', 'عائد'],
    'ipo': ['ipo', 'طرح', 'listing', 'إدراج', 'subscription', 'اكتتاب'],
    'indices': ['index', 'مؤشر', 'egx30', 'egx70', 'egx100'],
    'economy': ['inflation', 'تضخم', 'interest rate', 'سعر فائدة', 'gdp', 'نمو اقتصادي', 'dollar', 'دولار', 'exchange', 'صرف'],
    'partnership': ['partnership', 'شراكة', 'acquisition', 'استحواذ', 'merger', 'دمج', 'deal', 'صفقة'],
  };

  for (const [cat, keywords] of Object.entries(categoryMap)) {
    for (const kw of keywords) {
      if (combined.includes(kw)) {
        categories.push(cat);
        break;
      }
    }
  }

  return categories.length > 0 ? categories : ['general'];
}

// ---------------------------------------------------------------------------
// Strip HTML tags
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Extract a meaningful summary from text (first ~200 chars, end at sentence)
// ---------------------------------------------------------------------------

function extractSummary(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  const truncated = text.substring(0, maxLen);
  const lastPeriod = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('؟'), truncated.lastIndexOf('!'));
  if (lastPeriod > maxLen * 0.5) {
    return truncated.substring(0, lastPeriod + 1);
  }
  return truncated + '...';
}

// ---------------------------------------------------------------------------
// Main GET handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    await ensureInitialized();
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    // --- Check cache ---
    const cacheKey = `${ticker.toUpperCase()}:${limit}`;
    const cached = newsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    // --- Get stock from DB ---
    const stock = getStockByTicker(ticker);
    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    const stockNameAr = (stock.name_ar as string) || stock.name as string || '';
    const stockName = (stock.name as string) || '';
    const stockTicker = (stock.ticker as string) || ticker;
    const stockSector = (stock.sector as string) || null;

    // --- Initialize SDK ---
    const zai = await ZAI.create();

    // --- Build search queries ---
    const queries: string[] = [
      `"${stockNameAr}" سهم البورصة المصرية`,
      `"${stockTicker}" EGX Egypt stock news`,
    ];

    if (stockSector) {
      queries.push(`"${stockSector}" قطاع البورصة المصرية أخبار`);
    }

    // --- Execute searches ---
    const allSearchResults: SearchItem[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      try {
        const results = await zai.functions.invoke('web_search', {
          query,
          num: limit,
        }) as SearchItem[];

        for (const item of results) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            allSearchResults.push(item);
          }
        }
      } catch (err) {
        console.error(`[News] Search failed for query "${query}":`, err);
      }
    }

    // --- Read top articles for deeper content ---
    const articlesToRead = allSearchResults.slice(0, Math.min(limit, allSearchResults.length));

    const newsItems: NewsItem[] = await Promise.all(
      articlesToRead.map(async (item, index) => {
        let fullContent = item.snippet || '';
        let fullTitle = item.name || '';
        let publishedTime = item.date || '';

        // Try reading full page content for the first few articles
        if (index < 5) {
          try {
            const pageData = await zai.functions.invoke('page_reader', {
              url: item.url,
            });
            const rawHtml = (pageData as any)?.data?.html || '';
            const cleanText = stripHtml(rawHtml);
            if (cleanText.length > item.snippet?.length || 0) {
              fullContent = cleanText;
            }
            if ((pageData as any)?.data?.title) {
              fullTitle = (pageData as any).data.title;
            }
            if ((pageData as any)?.data?.publishedTime) {
              publishedTime = (pageData as any).data.publishedTime;
            }
          } catch (err) {
            console.error(`[News] Failed to read page: ${item.url}`, err);
          }
        }

        // Sentiment analysis
        const { score: sentimentScore, label: sentiment } = analyzeSentimentBasic(
          `${fullTitle} ${fullContent}`
        );

        // Relevance score
        const relevanceScore = computeRelevanceScore(
          fullTitle, item.snippet || '', stockTicker, stockName, stockNameAr, stockSector
        );

        // Categories
        const categories = categorizeNews(fullTitle, item.snippet || '');

        // Summary
        const summary = extractSummary(fullContent, 200);
        const summaryAr = summary; // Will be same text since we search Arabic sources

        return {
          title: fullTitle,
          title_ar: fullTitle, // Arabic titles come from Arabic searches
          source: extractSourceFromUrl(item.url),
          url: item.url,
          published_at: publishedTime || new Date().toISOString(),
          summary,
          summary_ar: summaryAr,
          sentiment,
          sentiment_score: sentimentScore,
          relevance_score: relevanceScore,
          categories,
        } satisfies NewsItem;
      })
    );

    // --- Sort by relevance score descending ---
    newsItems.sort((a, b) => b.relevance_score - a.relevance_score);

    // --- Compute overall sentiment ---
    const validItems = newsItems.filter(n => n.sentiment !== 'neutral');
    let overallScore = 0;
    let confidence = 0;

    if (validItems.length > 0) {
      overallScore = validItems.reduce((sum, n) => sum + n.sentiment_score, 0) / validItems.length;
      overallScore = Math.round(overallScore * 100) / 100;
      confidence = Math.round((validItems.length / newsItems.length) * 100) / 100;
    } else if (newsItems.length > 0) {
      overallScore = 0;
      confidence = 0.5;
    }

    let overallLabel: SentimentLabel = 'neutral';
    let overallLabelAr = 'محايد';
    if (overallScore > 0.15) { overallLabel = 'positive'; overallLabelAr = 'إيجابي'; }
    else if (overallScore < -0.15) { overallLabel = 'negative'; overallLabelAr = 'سلبي'; }

    // --- Build response ---
    const response: NewsResponse = {
      success: true,
      ticker: stockTicker,
      stock_name_ar: stockNameAr,
      news: newsItems,
      overall_sentiment: {
        score: overallScore,
        label: overallLabel,
        label_ar: overallLabelAr,
        confidence,
      },
      total_news: newsItems.length,
      fetched_at: new Date().toISOString(),
    };

    // --- Cache ---
    newsCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error(`[GET /api/stocks/:ticker/news] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch stock news', detail: String(error) },
      { status: 500 }
    );
  }
}

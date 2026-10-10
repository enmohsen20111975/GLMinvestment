/**
 * Mobile News API - Unified News Feed
 * آخر الأخبار
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// Cache
const CACHE_DURATION = 300; // 5 minutes
let newsCache: { timestamp: number; data: any } | null = null;

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  timestamp: string;
  category: 'egx' | 'crypto' | 'sentiment' | 'market';
  importance: 'high' | 'medium' | 'low';
  url?: string;
  tickers?: string[];
}

async function getEGXPilotNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch('https://egxpilot.com/api/news/', {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) return [];

    const data = await res.json();
    const news = data.data || data.news || [];

    return news.slice(0, 10).map((item: any) => {
      let importance: 'high' | 'medium' | 'low' = 'medium';
      const title = (item.title || '').toLowerCase();
      if (title.includes('موافقة') || title.includes('قيد') || title.includes('زيادة رأس المال')) {
        importance = 'high';
      }

      return {
        id: `egx-${item.id || Date.now()}`,
        title: item.title || 'خبر من البورصة المصرية',
        summary: item.summary || item.content?.slice(0, 150) || '',
        source: item.source || 'EGXPilot',
        timestamp: item.timestamp || item.published_at || new Date().toISOString(),
        category: 'egx' as const,
        importance,
        url: item.url,
        tickers: item.tickers || []
      };
    });
  } catch (error) {
    console.error('[Mobile News] EGXPilot error:', error);
    return [];
  }
}

async function getFearGreedIndex(): Promise<NewsItem | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    const fng = data.data?.[0];

    if (!fng) return null;

    const value = parseInt(fng.value);
    // Translate alternative.me English classification to Arabic for client-friendly UI (Rule 30)
    const classificationMap: Record<string, string> = {
      'Extreme Fear': 'خوف مفرط',
      'Fear': 'خوف',
      'Neutral': 'محايد',
      'Greed': 'طمع',
      'Extreme Greed': 'طمع مفرط',
    };
    const rawClassification = fng.value_classification || '';
    const classification = classificationMap[rawClassification] || rawClassification;

    let importance: 'high' | 'medium' | 'low' = 'medium';
    if (value <= 25 || value >= 75) importance = 'high';

    let summary = '';
    if (value <= 25) {
      summary = 'الخوف الشديد في السوق - قد تكون فرصة شراء';
    } else if (value <= 45) {
      summary = 'الخوف في السوق - حذر من الشراء العاطفي';
    } else if (value <= 55) {
      summary = 'السوق محايد';
    } else if (value <= 75) {
      summary = 'الطمع في السوق - حذر من البيع العاطفي';
    } else {
      summary = 'الطمع الشديد - قد يكون وقت جني الأرباح';
    }

    return {
      id: 'fear-greed-index',
      title: `مؤشر الخوف والطمع: ${value} (${classification})`,
      summary,
      source: 'Alternative.me',
      timestamp: new Date().toISOString(),
      category: 'sentiment',
      importance
    };
  } catch {
    return null;
  }
}

async function getCryptoPrices(): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();

    const items: NewsItem[] = [];

    if (data.bitcoin) {
      const change = data.bitcoin.usd_24h_change || 0;
      const price = data.bitcoin.usd;
      items.push({
        id: 'btc-price',
        title: `Bitcoin: $${price.toLocaleString()} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)`,
        summary: change >= 0 ? 'البيتكوين صاعد' : 'البيتكوين هابط',
        source: 'CoinGecko',
        timestamp: new Date().toISOString(),
        category: 'crypto',
        importance: Math.abs(change) > 5 ? 'high' : 'low'
      });
    }

    if (data.ethereum) {
      const change = data.ethereum.usd_24h_change || 0;
      const price = data.ethereum.usd;
      items.push({
        id: 'eth-price',
        title: `Ethereum: $${price.toLocaleString()} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)`,
        summary: change >= 0 ? 'الإيثريوم صاعد' : 'الإيثريوم هابط',
        source: 'CoinGecko',
        timestamp: new Date().toISOString(),
        category: 'crypto',
        importance: Math.abs(change) > 5 ? 'medium' : 'low'
      });
    }

    return items;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check cache
    const now = Date.now();
    if (newsCache && (now - newsCache.timestamp) < CACHE_DURATION * 1000) {
      return NextResponse.json({
        success: true,
        cached: true,
        timestamp: new Date(newsCache.timestamp).toISOString(),
        news: newsCache.data,
      });
    }

    // Fetch all sources in parallel
    const [egxNews, fearGreed, cryptoPrices] = await Promise.all([
      getEGXPilotNews(),
      getFearGreedIndex(),
      getCryptoPrices()
    ]);

    // Combine news
    const news: NewsItem[] = [];

    // Add EGX news first
    news.push(...egxNews);

    // Add sentiment
    if (fearGreed) news.push(fearGreed);

    // Add crypto prices
    news.push(...cryptoPrices);

    // Sort by importance
    const importanceOrder = { high: 0, medium: 1, low: 2 };
    news.sort((a, b) => {
      if (a.category === 'egx' && b.category !== 'egx') return -1;
      if (b.category === 'egx' && a.category !== 'egx') return 1;
      return importanceOrder[a.importance] - importanceOrder[b.importance];
    });

    // Update cache
    newsCache = { timestamp: now, data: news };

    return NextResponse.json({
      success: true,
      cached: false,
      timestamp: new Date().toISOString(),
      news,
      summary: {
        total: news.length,
        egx: egxNews.length,
        crypto: cryptoPrices.length,
        sentiment: fearGreed ? 1 : 0
      },
    });
  } catch (error: any) {
    console.error('[Mobile News API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب الأخبار',
      news: []
    }, { status: 500 });
  }
}

// Force refresh
export async function POST(request: NextRequest) {
  newsCache = null;
  return GET(request);
}

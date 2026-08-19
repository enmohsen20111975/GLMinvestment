/**
 * News Feed API - Unified Multi-Source
 * ======================================
 * يجمع الأخبار من مصادر متعددة:
 * - EGXPilot (أخبار البورصة المصرية) ← أساسي
 * - CoinGecko (أخبار الكريبتو)
 * - Alternative.me (مؤشر الخوف والطمع)
 */

import { NextRequest, NextResponse } from 'next/server';

// Cache
const CACHE_DURATION = 300; // 5 minutes
let newsCache: { timestamp: number; data: NewsItem[] } | null = null;

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

// ============================================================================
// EGXPilot News (EGX - Primary)
// ============================================================================

async function getEGXPilotNews(): Promise<NewsItem[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('https://egxpilot.com/api/news/', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    const news = data.data || data.news || [];

    return news.slice(0, 10).map((item: any) => {
      // Determine importance based on content
      let importance: 'high' | 'medium' | 'low' = 'medium';
      const title = (item.title || '').toLowerCase();
      if (title.includes('موافقة') || title.includes('قيد') || title.includes('زيادة رأس المال')) {
        importance = 'high';
      } else if (title.includes('تراجع') || title.includes('ارتفاع')) {
        importance = 'medium';
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
    console.error('[News] EGXPilot error:', error);
    return [];
  }
}

// ============================================================================
// Fear & Greed Index (Sentiment)
// ============================================================================

async function getFearGreedIndex(): Promise<NewsItem | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    const fng = data.data?.[0];
    
    if (!fng) return null;

    const value = parseInt(fng.value);
    const classification = fng.value_classification;
    
    let importance: 'high' | 'medium' | 'low' = 'medium';
    if (value <= 25 || value >= 75) importance = 'high';
    
    let summary = '';
    if (value <= 25) {
      summary = 'الخوف الشديد في السوق - قد تكون فرصة شراء للمدى الطويل';
    } else if (value <= 45) {
      summary = 'الخوف في السوق - حذر من الشراء العاطفي';
    } else if (value <= 55) {
      summary = 'السوق محايد - لا يوجد اتجاه واضح';
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

// ============================================================================
// Crypto Prices (CoinGecko)
// ============================================================================

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
        summary: change >= 0 
          ? 'البيتكوين صاعد في آخر 24 ساعة' 
          : 'البيتكوين هابط في آخر 24 ساعة',
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
        summary: change >= 0 
          ? 'الإيثريوم صاعد في آخر 24 ساعة' 
          : 'الإيثريوم هابط في آخر 24 ساعة',
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

// ============================================================================
// Global Market Data
// ============================================================================

async function getGlobalMarketData(): Promise<NewsItem | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    
    if (!data.data) return null;

    const marketCap = data.data.total_market_cap?.usd;
    const change = data.data.market_cap_change_percentage_24h_usd;

    return {
      id: 'global-market',
      title: `إجمالي سوق الكريبتو: $${(marketCap / 1e12).toFixed(2)}T (${change >= 0 ? '+' : ''}${change?.toFixed(1) || 0}%)`,
      summary: change >= 0 
        ? 'السوق الإجمالي في حالة نمو' 
        : 'السوق الإجمالي في حالة تراجع',
      source: 'CoinGecko',
      timestamp: new Date().toISOString(),
      category: 'market',
      importance: Math.abs(change || 0) > 3 ? 'high' : 'low'
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Main Handler
// ============================================================================

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
        cache_duration: CACHE_DURATION
      });
    }

    // Fetch all sources in parallel
    const [egxNews, fearGreed, cryptoPrices, globalMarket] = await Promise.all([
      getEGXPilotNews(),
      getFearGreedIndex(),
      getCryptoPrices(),
      getGlobalMarketData()
    ]);

    // Combine news
    const news: NewsItem[] = [];

    // Add EGX news first (priority)
    news.push(...egxNews);

    // Add sentiment
    if (fearGreed) news.push(fearGreed);

    // Add crypto prices
    news.push(...cryptoPrices);

    // Add global market
    if (globalMarket) news.push(globalMarket);

    // Sort by importance and category
    const importanceOrder = { high: 0, medium: 1, low: 2 };
    const categoryOrder = { egx: 0, sentiment: 1, market: 2, crypto: 3 };
    
    news.sort((a, b) => {
      // EGX news always first
      if (a.category === 'egx' && b.category !== 'egx') return -1;
      if (b.category === 'egx' && a.category !== 'egx') return 1;
      
      // Then by importance
      if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
        return importanceOrder[a.importance] - importanceOrder[b.importance];
      }
      
      return categoryOrder[a.category] - categoryOrder[b.category];
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
      cache_duration: CACHE_DURATION
    });

  } catch (error: any) {
    console.error('[News] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في جلب الأخبار',
      news: []
    }, { status: 500 });
  }
}

// Force refresh
export async function POST(request: NextRequest) {
  newsCache = null;
  return GET(request);
}

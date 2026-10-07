/**
 * AI Tools - Web Search & Market Data
 * Uses Z.ai API for real-time data
 */
// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.error
import { logger } from '@/lib/logger';

const ZAI_API_KEY = process.env.ZAI_API_KEY;

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

export interface MarketNews {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url?: string;
}

/**
 * Web Search using Z.ai
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
  if (!ZAI_API_KEY) {
    logger.warn('ZAI_API_KEY not configured');
    return [];
  }

  try {
    const response = await fetch('https://api.z.ai/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`
      },
      body: JSON.stringify({
        query: query,
        limit: 5
      })
    });

    if (!response.ok) {
      logger.warn('z.ai search error', { status: response.status });
      return [];
    }

    const data = await response.json();
    return data.results || [];

  } catch (error) {
    logger.warn('web search error', { err: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Get market news for a symbol
 */
export async function getMarketNews(
  symbol: string,
  market: 'egx' | 'crypto' = 'egx'
): Promise<MarketNews[]> {
  const query = market === 'egx' 
    ? `${symbol} EGX stock news today`
    : `${symbol} cryptocurrency news today`;

  const results = await webSearch(query);
  
  return results.map(r => ({
    title: r.title,
    summary: r.snippet,
    source: r.source,
    publishedAt: new Date().toISOString(),
    url: r.url
  }));
}

/**
 * Get market sentiment
 */
export async function getMarketSentiment(market: 'egx' | 'crypto'): Promise<{
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
  reasons: string[];
}> {
  const query = market === 'egx'
    ? 'Egyptian stock market EGX30 sentiment analysis today'
    : 'Bitcoin crypto market sentiment fear greed index today';

  const results = await webSearch(query);
  
  // Simple sentiment analysis based on keywords
  const text = results.map(r => r.snippet).join(' ').toLowerCase();
  
  const bullishWords = ['gain', 'rise', 'bullish', 'positive', 'growth', 'up', 'buy'];
  const bearishWords = ['fall', 'drop', 'bearish', 'negative', 'down', 'sell', 'crash'];
  
  let bullishScore = 0;
  let bearishScore = 0;
  
  bullishWords.forEach(w => {
    const matches = text.match(new RegExp(w, 'g'));
    if (matches) bullishScore += matches.length;
  });
  
  bearishWords.forEach(w => {
    const matches = text.match(new RegExp(w, 'g'));
    if (matches) bearishScore += matches.length;
  });

  const total = bullishScore + bearishScore;
  const score = total > 0 ? (bullishScore - bearishScore) / total : 0;

  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (score > 0.2) sentiment = 'bullish';
  else if (score < -0.2) sentiment = 'bearish';

  return {
    sentiment,
    score: Math.round(score * 100) / 100,
    reasons: results.slice(0, 3).map(r => r.snippet)
  };
}

export default {
  webSearch,
  getMarketNews,
  getMarketSentiment
};

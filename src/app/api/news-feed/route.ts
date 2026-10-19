/**
 * News Feed API - Unified Multi-Source + news_agent
 * ======================================
 * يجمع الأخبار من مصادر متعددة:
 * - news_agent (news_signals في predictions.db) ← أساسي
 * - EGXPilot (أخبار البورصة المصرية)
 * - CoinGecko (أخبار الكريبتو)
 * - Alternative.me (مؤشر الخوف والطمع)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const CACHE_DURATION = 300;
let newsCache: { timestamp: number; data: any[] } | null = null;
let cryptoCache: Record<string, { timestamp: number; data: any[] }> = {};

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source: string;
  timestamp: string;
  category: 'egx' | 'crypto' | 'sentiment' | 'market' | 'news_agent';
  importance: 'high' | 'medium' | 'low';
  url?: string;
  tickers?: string[];
  sentiment?: string;
  recommended_action?: string;
  reasoning?: string;
  image_paths?: string[];
  published_at?: string;
}

function getPredictionsDbPath() {
  return path.join(process.cwd(), 'db', 'predictions.db');
}

// news.db is the SINGLE SOURCE OF TRUTH for news (CONSTITUTION Rule: NEWS-DB-SOT).
function getDataEngineDbPath() {
  return path.join(process.cwd(), 'db', 'news.db');
}

function safeParseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  if (typeof val !== 'string') return val as T;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function cleanNewsTitle(title: string): string {
  if (!title) return 'خبر اقتصادي';
  return title
    .replace(/📰/g, '')
    .replace(/🚨\s*إشعار استثماري عاجل\s*\|\s*محفز صعودي قوي\s*🚀/gi, '')
    .replace(/🚨\s*إشعار استثماري عاجل/gi, '')
    .replace(/محفز صعودي قوي\s*🚀?/gi, '')
    .replace(/📊\s*نبض البورصة والأخبار المالية\s*\|\s*Investment Guide/gi, '')
    .replace(/^[\s\-_—:|•]+|[\s\-_—:|•]+$/g, '')
    .trim() || 'خبر اقتصادي';
}

function fetchNewsSignals(limit = 50): NewsItem[] {
  const items: NewsItem[] = [];

  // 1. Fetch from news.db -> market_news (single source of truth — News Agent posts here)
  try {
    const dePath = getDataEngineDbPath();
    if (fs.existsSync(dePath)) {
      const db = new Database(dePath, { readonly: true, timeout: 3000 });
      const rows = db.prepare(`
        SELECT id, title, content, summary_ar, summary_en, source, url,
               tickers, importance, sentiment, impact_type, image_paths, ocr_text,
               raw_analysis, published_at, fetched_at
        FROM market_news
        ORDER BY id DESC
        LIMIT ?
      `).all(limit) as any[];
      db.close();

      for (const row of rows) {
        // حظر أي خبر مصدره القناة نفسها لمنع تكرار النصوص
        if (row.url && (row.url.includes('Arabian_investment_guide') || row.url.includes('invist.m2y.net'))) {
          continue;
        }

        const rawAnalysis = safeParseJson(row.raw_analysis, {});
        const hasValidReasoning = Boolean(
          rawAnalysis.reasoning &&
          typeof rawAnalysis.reasoning === 'string' &&
          rawAnalysis.reasoning.trim().length > 10
        );

        const importanceVal = Number(row.importance || 0);
        items.push({
          id: `mn-${row.id}`,
          title: cleanNewsTitle(row.title),
          summary: row.summary_ar || (row.content ? row.content.substring(0, 220) : ''),
          body: row.content || row.summary_ar || undefined,
          source: row.source || 'news_agent',
          timestamp: row.published_at || row.fetched_at || new Date().toISOString(),
          category: 'news_agent',
          importance: importanceVal >= 70 ? 'high' : importanceVal >= 40 ? 'medium' : 'low',
          url: row.url || undefined,
          tickers: safeParseJson<string[]>(row.tickers, []),
          sentiment: row.sentiment || 'neutral',
          recommended_action: rawAnalysis.recommended_action || 'monitor',
          reasoning: hasValidReasoning ? rawAnalysis.reasoning.trim() : `تم تحليل الخبر محليًا بدرجة أهمية ${importanceVal}/100.`,
          image_paths: safeParseJson<string[]>(row.image_paths, []),
          published_at: row.published_at || undefined,
        });
      }
    }
  } catch (e) {
    console.warn('[news-feed] news.db market_news fetch failed:', e);
  }

  // 2. Fetch from predictions.db -> news_signals (local agent signal table)
  try {
    const predPath = getPredictionsDbPath();
    if (fs.existsSync(predPath)) {
      const db = new Database(predPath, { readonly: true, timeout: 3000 });
      // RESTRUCT-TEST-FIX-1: guard against missing news_signals table (schema varies).
      const hasNewsSignals = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='news_signals'").get() as
          | { name: string }
          | undefined
      )?.name === 'news_signals';
      if (hasNewsSignals) {
        const rows = db.prepare(`
        SELECT id, title, body, source, url, published_at, tickers,
               importance, sentiment, impact_type, summary_ar, reasoning, received_at
        FROM news_signals
        ORDER BY COALESCE(importance, 0) DESC, received_at DESC
        LIMIT ?
      `).all(limit) as any[];

      for (const row of rows) {
        const hasValidReasoning = Boolean(
          row.reasoning &&
          typeof row.reasoning === 'string' &&
          row.reasoning.trim().length > 10 &&
          !row.reasoning.includes('سبب الدرجة') &&
          !row.reasoning.includes('سبب التوجيه')
        );

        const importanceVal = Number(row.importance || 0);
        items.push({
          id: `sig-${row.id}`,
          title: row.title || 'خبر بدون عنوان',
          summary: row.summary_ar || row.body?.substring(0, 220) || '',
          body: row.body || undefined,
          source: row.source || 'news_agent',
          timestamp: row.received_at || row.published_at || new Date().toISOString(),
          category: 'news_agent',
          importance: importanceVal >= 70 ? 'high' : importanceVal >= 40 ? 'medium' : 'low',
          url: row.url || undefined,
          tickers: safeParseJson<string[]>(row.tickers, []),
          sentiment: hasValidReasoning ? (row.sentiment || 'neutral') : undefined,
          recommended_action: hasValidReasoning ? (row.impact_type || 'monitor') : undefined,
          reasoning: hasValidReasoning ? row.reasoning.trim() : undefined,
          image_paths: [],
          published_at: row.published_at || undefined,
        });
      }
      } // else: news_signals table absent — skip silently (not a crash).
      db.close();
    }
  } catch (e) {
    console.warn('[news-feed] predictions.db news_signals fetch failed:', e);
  }

  // Deduplicate by title
  const seenTitles = new Set<string>();
  const uniqueItems: NewsItem[] = [];
  for (const item of items) {
    const key = (item.title || '').trim().toLowerCase();
    if (key && !seenTitles.has(key)) {
      seenTitles.add(key);
      uniqueItems.push(item);
    }
  }

  return uniqueItems.slice(0, limit);
}

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
      let importance: 'high' | 'medium' | 'low' = 'medium';
      const title = (item.title || '').toLowerCase();
      if (title.includes('موافقة') || title.includes('قيد') || title.includes('زيادة رأس المال')) importance = 'high';
      else if (title.includes('تراجع') || title.includes('ارتفاع')) importance = 'medium';
      return {
        id: `egx-${item.id || Date.now()}`,
        title: item.title || 'خبر من البورصة المصرية',
        summary: item.summary || item.content?.slice(0, 150) || '',
        source: item.source || 'EGXPilot',
        timestamp: item.timestamp || item.published_at || new Date().toISOString(),
        category: 'egx' as const,
        importance,
        url: item.url,
        tickers: item.tickers || [],
      };
    });
  } catch {
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
    if (value <= 25) summary = 'الخوف الشديد في السوق - قد تكون فرصة شراء للمدى الطويل';
    else if (value <= 45) summary = 'الخوف في السوق - حذر من الشراء العاطفي';
    else if (value <= 55) summary = 'السوق محايد - لا يوجد اتجاه واضح';
    else if (value <= 75) summary = 'الطمع في السوق - حذر من البيع العاطفي';
    else summary = 'الطمع الشديد - قد يكون وقت جني الأرباح';
    return {
      id: 'fear-greed-index',
      title: `مؤشر الخوف والطمع: ${value} (${classification})`,
      summary,
      source: 'Alternative.me',
      timestamp: new Date().toISOString(),
      category: 'sentiment',
      importance,
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
        summary: change >= 0 ? 'البيتكوين صاعد في آخر 24 ساعة' : 'البيتكوين هابط في آخر 24 ساعة',
        source: 'CoinGecko',
        timestamp: new Date().toISOString(),
        category: 'crypto',
        importance: Math.abs(change) > 5 ? 'high' : 'low',
      });
    }
    if (data.ethereum) {
      const change = data.ethereum.usd_24h_change || 0;
      const price = data.ethereum.usd;
      items.push({
        id: 'eth-price',
        title: `Ethereum: $${price.toLocaleString()} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)`,
        summary: change >= 0 ? 'الإيثريوم صاعد في آخر 24 ساعة' : 'الإيثريوم هابط في آخر 24 ساعة',
        source: 'CoinGecko',
        timestamp: new Date().toISOString(),
        category: 'crypto',
        importance: Math.abs(change) > 5 ? 'medium' : 'low',
      });
    }
    return items;
  } catch {
    return [];
  }
}

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
      summary: change >= 0 ? 'السوق الإجمالي في حالة نمو' : 'السوق الإجمالي في حالة تراجع',
      source: 'CoinGecko',
      timestamp: new Date().toISOString(),
      category: 'market',
      importance: Math.abs(change || 0) > 3 ? 'high' : 'low',
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketFilter = (searchParams.get('market') || 'all').toLowerCase();
    const isCryptoMode = marketFilter === 'crypto';
    const now = Date.now();
    const cacheKey = isCryptoMode ? 'crypto' : 'all';
    const cached = cryptoCache[cacheKey];
    if (cached && (now - cached.timestamp) < CACHE_DURATION * 1000) {
      return NextResponse.json({
        success: true,
        cached: true,
        timestamp: new Date(cached.timestamp).toISOString(),
        news: cached.data,
        cache_duration: CACHE_DURATION,
        market_filter: marketFilter,
      });
    }

    const [egxNews, fearGreed, cryptoPrices, globalMarket, agentNews] = await Promise.all([
      getEGXPilotNews(),
      getFearGreedIndex(),
      getCryptoPrices(),
      getGlobalMarketData(),
      Promise.resolve(fetchNewsSignals(50)),
    ]);

    const news: NewsItem[] = [];

    if (isCryptoMode) {
      if (fearGreed) news.push(fearGreed);
      news.push(...cryptoPrices);
      if (globalMarket) news.push(globalMarket);
    } else {
      news.push(...agentNews);
      news.push(...egxNews);
      if (fearGreed) news.push(fearGreed);
      news.push(...cryptoPrices);
      if (globalMarket) news.push(globalMarket);
    }

    const importanceOrder = { high: 0, medium: 1, low: 2 };
    const categoryOrder = isCryptoMode
      ? { sentiment: 0, crypto: 1, market: 2, egx: 3, news_agent: 4 }
      : { news_agent: 0, egx: 1, sentiment: 2, market: 3, crypto: 4 };

    news.sort((a, b) => {
      if (!isCryptoMode) {
        if (a.category === 'news_agent' && b.category !== 'news_agent') return -1;
        if (b.category === 'news_agent' && a.category !== 'news_agent') return 1;
        if (a.category === 'egx' && b.category !== 'egx') return -1;
        if (b.category === 'egx' && a.category !== 'egx') return 1;
      } else {
        if (a.category === 'sentiment' && b.category !== 'sentiment') return -1;
        if (b.category === 'sentiment' && a.category !== 'sentiment') return 1;
      }
      if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
        return importanceOrder[a.importance] - importanceOrder[b.importance];
      }
      return categoryOrder[a.category] - categoryOrder[b.category];
    });

    cryptoCache[cacheKey] = { timestamp: now, data: news };

    return NextResponse.json({
      success: true,
      cached: false,
      timestamp: new Date().toISOString(),
      news,
      summary: {
        total: news.length,
        agent: agentNews.length,
        egx: isCryptoMode ? 0 : egxNews.length,
        crypto: cryptoPrices.length,
        sentiment: fearGreed ? 1 : 0,
        market_filter: marketFilter,
      },
      cache_duration: CACHE_DURATION,
    });
  } catch (error: any) {
    console.error('[News] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error' || 'خطأ في جلب الأخبار',
      news: []
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  cryptoCache = {};
  return GET(request);
}

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * Crypto Sync API - Python Backend = THE BRAIN
 * 
 * يقوم بمزامنة بيانات العملات الرقمية
 * Python Backend يحسب كل التحليلات الفنية
 * Node.js = DISPLAY ONLY
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// قائمة العملات الرقمية الرئيسية
const TOP_CRYPTOS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'tether', symbol: 'USDT', name: 'Tether' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'tron', symbol: 'TRX', name: 'TRON' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
  { id: 'polygon', symbol: 'MATIC', name: 'Polygon' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash' },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap' },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar' },
  { id: 'okb', symbol: 'OKB', name: 'OKB' },
];

// تخزين مؤقت للبيانات
const cryptoCache = {
  data: null as any[] | null,
  lastSync: 0,
  historyData: new Map<string, { ohlcv: any[], timestamp: number }>(),
};

// مدة الكاش
const CACHE_DURATION = 60 * 1000; // دقيقة واحدة
const HISTORY_CACHE_DURATION = 5 * 60 * 1000; // 5 دقائق

/**
 * جلب البيانات الحية من CoinGecko
 */
async function fetchLiveCryptoData() {
  try {
    const ids = TOP_CRYPTOS.map(c => c.id).join(',');
    
    const response = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d`,
      {
        headers: { 'Accept': 'application/json' },
        }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API failed: ${response.status}`);
    }

    const rawData = await response.json();

    const formattedData = rawData.map((coin: any) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      image: coin.image,
      current_price: coin.current_price,
      market_cap: coin.market_cap,
      market_cap_rank: coin.market_cap_rank,
      total_volume: coin.total_volume,
      high_24h: coin.high_24h,
      low_24h: coin.low_24h,
      price_change_24h: coin.price_change_24h,
      price_change_percentage_24h: coin.price_change_percentage_24h,
      price_change_percentage_1h_in_currency: coin.price_change_percentage_1h_in_currency,
      price_change_percentage_7d_in_currency: coin.price_change_percentage_7d_in_currency,
      sparkline_in_7d: coin.sparkline_in_7d?.price || [],
      ath: coin.ath,
      ath_change_percentage: coin.ath_change_percentage,
      ath_date: coin.ath_date,
      atl: coin.atl,
      atl_change_percentage: coin.atl_change_percentage,
      atl_date: coin.atl_date,
      last_updated: coin.last_updated,
    }));

    // تحديث الكاش
    cryptoCache.data = formattedData;
    cryptoCache.lastSync = Date.now();

    return {
      success: true,
      data: formattedData,
      count: formattedData.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Crypto Sync] Error:', error);
    return {
      success: false,
      error: 'internal_error',
    };
  }
}

/**
 * جلب البيانات التاريخية (OHLC)
 */
async function fetchOHLCData(coinId: string, days: number = 30) {
  const cacheKey = `${coinId}-${days}`;
  const cached = cryptoCache.historyData.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < HISTORY_CACHE_DURATION) {
    return { success: true, data: cached.ohlcv, cached: true };
  }

  try {
    const response = await fetch(
      `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
      {
        headers: { 'Accept': 'application/json' },
        }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko OHLC API failed: ${response.status}`);
    }

    const rawData = await response.json();

    const ohlcvData = rawData.map((o: any) => ({
      timestamp: o[0],
      open: o[1],
      high: o[2],
      low: o[3],
      close: o[4],
      time: Math.floor(o[0] / 1000), // للتوافق مع lightweight-charts
    }));

    // تحديث الكاش
    cryptoCache.historyData.set(cacheKey, {
      ohlcv: ohlcvData,
      timestamp: Date.now()
    });

    return {
      success: true,
      data: ohlcvData,
      cached: false,
    };
  } catch (error) {
    console.error(`[Crypto Sync] OHLC Error for ${coinId}:`, error);
    return {
      success: false,
      error: 'internal_error',
    };
  }
}

/**
 * GET: الحصول على حالة المزامنة أو البيانات المخزنة
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action') || 'status';
  const coinId = searchParams.get('coin_id');
  const days = parseInt(searchParams.get('days') || '30');

  switch (action) {
    case 'status':
      return NextResponse.json({
        success: true,
        status: {
          lastSync: cryptoCache.lastSync ? new Date(cryptoCache.lastSync).toISOString() : null,
          cachedCoins: cryptoCache.data?.length || 0,
          historyCacheSize: cryptoCache.historyData.size,
          cacheValid: cryptoCache.lastSync && Date.now() - cryptoCache.lastSync < CACHE_DURATION,
        }
      });

    case 'get':
      // إرجاع البيانات المخزنة
      if (cryptoCache.data && Date.now() - cryptoCache.lastSync < CACHE_DURATION) {
        return NextResponse.json({
          success: true,
          data: cryptoCache.data,
          cached: true,
          timestamp: new Date(cryptoCache.lastSync).toISOString(),
        });
      }
      // إذا الكاش منتهي، جلب بيانات جديدة
      return NextResponse.json(await fetchLiveCryptoData());

    case 'ohlc':
      if (!coinId) {
        return NextResponse.json({ success: false, error: 'coin_id required' }, { status: 400 });
      }
      return NextResponse.json(await fetchOHLCData(coinId, days));

    default:
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  }
}

/**
 * POST: تنفيذ المزامنة - Python Backend = THE BRAIN
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || 'sync';

  switch (action) {
    case 'sync':
      // Try Python backend first - THE BRAIN
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${PYTHON_API_URL}/api/crypto/sync`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            return NextResponse.json({
              success: true,
              source: 'python_backend',
              updated: data.updated || 50,
              timestamp: data.timestamp || new Date().toISOString()
            });
          }
        }
      } catch (pythonError) {
        console.log('[Crypto Sync] Python backend not available, falling back to CoinGecko');
      }

      // Fallback: مزامنة جميع البيانات من CoinGecko
      const result = await fetchLiveCryptoData();
      return NextResponse.json({
        ...result,
        source: 'coingecko_fallback'
      });

    case 'sync_history':
      // مزامنة البيانات التاريخية للعملات الرئيسية
      const historyResults: Record<string, any> = {};
      
      for (const crypto of TOP_CRYPTOS.slice(0, 10)) { // أول 10 عملات فقط
        const ohlcv = await fetchOHLCData(crypto.id, 30);
        historyResults[crypto.id] = {
          success: ohlcv.success,
          count: ohlcv.data?.length || 0,
        };
        // تأخير قصير لتجنب rate limiting
        await new Promise(r => setTimeout(r, 200));
      }

      return NextResponse.json({
        success: true,
        message: 'Historical data synced',
        results: historyResults,
      });

    default:
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  }
}

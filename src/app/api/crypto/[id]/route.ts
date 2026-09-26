import { NextRequest, NextResponse } from 'next/server';
import { getCryptoBySymbolFallback } from '@/lib/flutter-sqlite-fallback';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
export const dynamic = 'force-dynamic';

// CoinGecko coin-id cache (per process)
const coinCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 1000;

// GET /api/crypto/[id]
// --------------------
// Primary: CoinGecko /coins/<id> (rich market data).
// Fallback 1 (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — match by
//   symbol when the Flutter app passes a SYMBOL (e.g., "BTC") instead of a
//   CoinGecko coin-id (e.g., "bitcoin"). Previously returned 404 because
//   CoinGecko rejected "BTC" as an unknown id and there was no fallback.
// Fallback 2: SQLite lookup by symbol for any case where CoinGecko is
//   unreachable (offline dev / rate-limited).

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  XRP: 'ripple',
  USDC: 'usd-coin',
  SOL: 'solana',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  SHIB: 'shiba-inu',
  DOT: 'polkadot',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  APT: 'aptos',
  NEAR: 'near',
  ARB: 'arbitrum',
  OP: 'optimism',
  INJ: 'injective-protocol',
  SUI: 'sui',
  SEI: 'sei-network',
  TIA: 'celestia',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: coinId } = await params;

  const cached = coinCache.get(coinId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ success: true, data: cached.data, cached: true });
  }

  // Resolve CoinGecko coin-id (if Flutter passed a symbol like "BTC")
  const resolvedId = SYMBOL_TO_ID[coinId.toUpperCase()] || coinId;

  // 1. Try CoinGecko
  try {
    const response = await fetch(
      `${COINGECKO_API}/coins/${resolvedId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (response.ok) {
      const rawData = await response.json();
      const formattedData = {
        id: rawData.id,
        symbol: (rawData.symbol || coinId).toUpperCase(),
        name: rawData.name,
        image: rawData.image,
        description: rawData.description?.en?.slice(0, 500) || '',
        market_data: {
          current_price: rawData.market_data?.current_price?.usd,
          ath: rawData.market_data?.ath?.usd,
          ath_change_percentage: rawData.market_data?.ath_change_percentage?.usd,
          ath_date: rawData.market_data?.ath_date?.usd,
          atl: rawData.market_data?.atl?.usd,
          atl_change_percentage: rawData.market_data?.atl_change_percentage?.usd,
          atl_date: rawData.market_data?.atl_date?.usd,
          market_cap: rawData.market_data?.market_cap?.usd,
          market_cap_rank: rawData.market_cap_rank,
          total_volume: rawData.market_data?.total_volume?.usd,
          high_24h: rawData.market_data?.high_24h?.usd,
          low_24h: rawData.market_data?.low_24h?.usd,
          price_change_24h: rawData.market_data?.price_change_24h,
          price_change_percentage_24h:
            rawData.market_data?.price_change_percentage_24h,
          price_change_percentage_7d:
            rawData.market_data?.price_change_percentage_7d?.usd,
          price_change_percentage_14d:
            rawData.market_data?.price_change_percentage_14d?.usd,
          price_change_percentage_30d:
            rawData.market_data?.price_change_percentage_30d?.usd,
          price_change_percentage_60d:
            rawData.market_data?.price_change_percentage_60d?.usd,
          price_change_percentage_200d:
            rawData.market_data?.price_change_percentage_200d?.usd,
          price_change_percentage_1y:
            rawData.market_data?.price_change_percentage_1y?.usd,
          circulating_supply: rawData.market_data?.circulating_supply,
          total_supply: rawData.market_data?.total_supply,
          max_supply: rawData.market_data?.max_supply,
        },
        sparkline_in_7d: rawData.market_data?.sparkline_7d?.price || [],
        links: {
          homepage: rawData.links?.homepage?.[0],
          blockchain_site: rawData.links?.blockchain_site?.slice(0, 3),
          official_forum_url: rawData.links?.official_forum_url?.[0],
          chat_url: rawData.links?.chat_url?.slice(0, 3),
          twitter_screen_name: rawData.links?.twitter_screen_name,
          telegram_channel_identifier:
            rawData.links?.telegram_channel_identifier,
        },
        categories: rawData.categories?.slice(0, 5),
        last_updated: rawData.last_updated,
      };

      coinCache.set(coinId, { data: formattedData, timestamp: Date.now() });
      return NextResponse.json({
        success: true,
        data: formattedData,
        cached: false,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (_err) {
    // fall through
  }

  // 2. SQLite fallback — data_engine.db crypto_prices
  const sym = SYMBOL_TO_ID[coinId.toUpperCase()] ? coinId.toUpperCase() : coinId.toUpperCase();
  const fb = getCryptoBySymbolFallback(sym);
  if (fb) {
    const fallbackData = {
      id: coinId,
      symbol: fb.symbol,
      name: fb.name,
      image: { large: '', small: '', thumb: '' },
      description: { en: `${fb.name} — بيانات من crypto_prices (SQLite fallback)` },
      market_data: {
        current_price: { usd: Number(fb.price_usd || 0) },
        market_cap: { usd: fb.market_cap },
        total_volume: { usd: fb.total_volume },
        price_change_percentage_24h: fb.price_change_24h,
        price_change_percentage_7d_in_currency: { usd: fb.price_change_7d },
      },
      market_cap_rank: fb.market_cap_rank,
      sparkline_in_7d: [],
      last_updated: fb.timestamp,
      fallback: 'sqlite',
    };
    return NextResponse.json({
      success: true,
      data: fallbackData,
      cached: false,
      fallback: true,
      source: 'sqlite_fallback',
    });
  }

  // 3. Nothing found
  return NextResponse.json(
    {
      success: false,
      error: `Coin '${coinId}' not found in CoinGecko or local crypto_prices`,
      source: 'sqlite_fallback_empty',
    },
    { status: 200 }
  );
}

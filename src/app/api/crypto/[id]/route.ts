import { NextRequest, NextResponse } from 'next/server';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Cache للبيانات
const coinCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 1000; // دقيقة واحدة

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: coinId } = await params;

    // تحقق من الكاش
    const cached = coinCache.get(coinId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        success: true,
        data: cached.data,
        cached: true
      });
    }

    // جلب بيانات العملة من CoinGecko
    const response = await fetch(
      `${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`,
      {
        headers: {
          'Accept': 'application/json',
        },
        next: { revalidate: 60 }
      }
    );

    if (!response.ok) {
      // fallback لـ crypto_prices DB لو CoinGecko rate-limited
      try {
        const { getCryptoBySymbol } = await import('@/lib/data-engine-db');
        const symbol = coinId.toUpperCase();
        const coin = getCryptoBySymbol(symbol);
        if (coin && coin.price_usd) {
          const fallbackData = {
            id: coinId,
            symbol: coin.symbol,
            name: coin.name,
            image: { large: '', small: '', thumb: '' },
            description: { en: `${coin.name} — بيانات من crypto_prices (fallback)` },
            market_data: {
              current_price: { usd: coin.price_usd },
              market_cap: { usd: coin.market_cap },
              total_volume: { usd: coin.total_volume },
              price_change_percentage_24h: coin.price_change_24h,
              price_change_percentage_7d_in_currency: { usd: coin.price_change_7d },
            },
            market_cap_rank: coin.market_cap_rank,
            fallback: 'crypto_prices_db',
          };
          return NextResponse.json({
            success: true,
            data: fallbackData,
            cached: false,
            fallback: true,
          });
        }
      } catch (e) {
        console.error('[crypto/[id]] fallback error:', e);
      }
      return NextResponse.json({
        success: false,
        error: `Coin '${coinId}' not found`
      }, { status: 404 });
    }

    const rawData = await response.json();

    // تنسيق البيانات
    const formattedData = {
      id: rawData.id,
      symbol: rawData.symbol.toUpperCase(),
      name: rawData.name,
      image: rawData.image,
      description: rawData.description?.en?.slice(0, 500) || '',

      // بيانات السوق
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
        price_change_percentage_24h: rawData.market_data?.price_change_percentage_24h,
        price_change_percentage_7d: rawData.market_data?.price_change_percentage_7d?.usd,
        price_change_percentage_14d: rawData.market_data?.price_change_percentage_14d?.usd,
        price_change_percentage_30d: rawData.market_data?.price_change_percentage_30d?.usd,
        price_change_percentage_60d: rawData.market_data?.price_change_percentage_60d?.usd,
        price_change_percentage_200d: rawData.market_data?.price_change_percentage_200d?.usd,
        price_change_percentage_1y: rawData.market_data?.price_change_percentage_1y?.usd,
        circulating_supply: rawData.market_data?.circulating_supply,
        total_supply: rawData.market_data?.total_supply,
        max_supply: rawData.market_data?.max_supply,
      },

      // بيانات السوق التاريخية (7 أيام)
      sparkline_in_7d: rawData.market_data?.sparkline_7d?.price || [],

      // روابط
      links: {
        homepage: rawData.links?.homepage?.[0],
        blockchain_site: rawData.links?.blockchain_site?.slice(0, 3),
        official_forum_url: rawData.links?.official_forum_url?.[0],
        chat_url: rawData.links?.chat_url?.slice(0, 3),
        twitter_screen_name: rawData.links?.twitter_screen_name,
        telegram_channel_identifier: rawData.links?.telegram_channel_identifier,
      },

      // تصنيفات
      categories: rawData.categories?.slice(0, 5),

      // تاريخ آخر تحديث
      last_updated: rawData.last_updated,
    };

    // تحديث الكاش
    coinCache.set(coinId, {
      data: formattedData,
      timestamp: Date.now()
    });

    return NextResponse.json({
      success: true,
      data: formattedData,
      cached: false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Crypto] Error fetching coin:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

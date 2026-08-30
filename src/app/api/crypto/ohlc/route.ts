import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// mapping من symbol شائعة لـ CoinGecko coin IDs
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

/**
 * GET /api/crypto/ohlc?symbol=BTC&days=30
 * OHLC candles من CoinGecko للعملات الرقمية
 *
 * Response: array of [timestamp, open, high, low, close]
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') || 'BTC').toUpperCase();
    const days = searchParams.get('days') || '30';

    const coinId = SYMBOL_TO_ID[symbol];
    if (!coinId) {
      return NextResponse.json(
        {
          success: false,
          error: `Symbol not supported: ${symbol}. Add it to SYMBOL_TO_ID map.`,
        },
        { status: 400 }
      );
    }

    const targetUrl = `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `CoinGecko error: ${res.status} ${res.statusText}`,
        },
        { status: 502 }
      );
    }

    const raw = (await res.json()) as number[][];
    // حول لأشكل أكثر وضوحاً
    const candles = raw.map((c) => ({
      timestamp: c[0],
      time: new Date(c[0]).toISOString(),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    }));

    return NextResponse.json({
      success: true,
      symbol,
      coin_id: coinId,
      days,
      count: candles.length,
      candles,
    });
  } catch (e) {
    console.error('[api/crypto/ohlc] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        candles: [],
      },
      { status: 500 }
    );
  }
}

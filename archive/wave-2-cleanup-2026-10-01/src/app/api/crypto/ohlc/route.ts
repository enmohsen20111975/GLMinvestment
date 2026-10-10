import { NextRequest, NextResponse } from 'next/server';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
export const dynamic = 'force-dynamic';

// GET /api/crypto/ohlc?symbol=BTC&days=30
// ---------------------------------------
// Primary: CoinGecko /coins/<id>/ohlc.
// Fallback (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices (latest snapshot
//   → single-candle approximation). Previously returned 502 when CoinGecko
//   rate-limited, causing the Flutter crypto chart to show "no data". Now
//   always returns at least one synthetic candle from SQLite.

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', BNB: 'binancecoin',
  XRP: 'ripple', USDC: 'usd-coin', SOL: 'solana', ADA: 'cardano',
  DOGE: 'dogecoin', TRX: 'tron', AVAX: 'avalanche-2', SHIB: 'shiba-inu',
  DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network',
  LTC: 'litecoin', BCH: 'bitcoin-cash', UNI: 'uniswap', ATOM: 'cosmos',
  XLM: 'stellar', ETC: 'ethereum-classic', FIL: 'filecoin', APT: 'aptos',
  NEAR: 'near', ARB: 'arbitrum', OP: 'optimism', INJ: 'injective-protocol',
  SUI: 'sui', SEI: 'sei-network', TIA: 'celestia',
};

export async function GET(req: NextRequest) {
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

  // 1. Try CoinGecko
  try {
    const res = await fetch(
      `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      }
    );

    if (res.ok) {
      const raw = (await res.json()) as number[][];
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
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — single-candle approximation from latest snapshot
  const fb = getCryptoListFallback(500).find(
    (c) => String(c.symbol).toUpperCase() === symbol
  );
  if (fb) {
    const price = Number(fb.price_usd || 0);
    const now = Date.now();
    const candles = [
      {
        timestamp: now,
        time: new Date(now).toISOString(),
        open: price,
        high: price,
        low: price,
        close: price,
      },
    ];
    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      symbol,
      coin_id: coinId,
      days,
      count: candles.length,
      candles,
      warning: 'OHLC history unavailable — showing latest price as a single candle',
    });
  }

  // 3. No data
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    symbol,
    coin_id: coinId,
    days,
    count: 0,
    candles: [],
    warning: 'No OHLC data available for this symbol',
  });
}

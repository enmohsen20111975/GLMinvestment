import { NextResponse } from 'next/server';

/**
 * /api/crypto/coins?limit=250
 *
 * Unified crypto coin-list endpoint (UI-mirror protocol).
 *
 * Fetches the top USDT pairs from Binance's public ticker API (no API key
 * required, generous rate limits) and returns them in the shape that
 * `loadCryptoList()` in the store expects:
 *   `{ success, all_cryptos: [{ symbol, name, price_usd, change_24h,
 *      change_7d, market_cap, market_cap_rank, volume_24h }] }`
 *
 * The coins are adapted to the same field names the stocks list uses so
 * the unified StocksView can render crypto exactly like EGX stocks.
 */

export const dynamic = 'force-dynamic';

// 60-second in-memory cache
const cache: { data: unknown; ts: number } | null = { data: null, ts: 0 };
const CACHE_MS = 60_000;

// Human-readable names for the most common symbols (Binance only returns
// the trading pair, not the coin name). Unknown symbols fall back to the
// symbol itself.
const SYMBOL_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'XRP',
  ADA: 'Cardano', DOGE: 'Dogecoin', DOT: 'Polkadot', LTC: 'Litecoin',
  AVAX: 'Avalanche', LINK: 'Chainlink', MATIC: 'Polygon', UNI: 'Uniswap',
  XLM: 'Stellar', ATOM: 'Cosmos', TRX: 'TRON', ETC: 'Ethereum Classic',
  XMR: 'Monero', ALGO: 'Algorand', NEAR: 'NEAR', APT: 'Aptos', FIL: 'Filecoin',
  ICP: 'Internet Computer', VET: 'VeChain', FTM: 'Fantom', GRT: 'The Graph',
  SAND: 'The Sandbox', MANA: 'Decentraland', AXS: 'Axie Infinity',
  SHIB: 'Shiba Inu', PEPE: 'Pepe', ARB: 'Arbitrum', OP: 'Optimism',
  INJ: 'Injective', SUI: 'Sui', SEI: 'Sei', TIA: 'Celestia', RUNE: 'THORChain',
  FET: 'Fetch.ai', RNDR: 'Render', IMX: 'Immutable', GALA: 'Gala',
  AAVE: 'Aave', MKR: 'Maker', COMP: 'Compound', SNX: 'Synthetix',
  CRV: 'Curve DAO', LDO: 'Lido DAO', SUSHI: 'SushiSwap', DYDX: 'dYdX',
  ZEC: 'Zcash', DASH: 'Dash', ENJ: 'Enjin', CHZ: 'Chiliz', ANKR: 'Ankr',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '250', 10) || 250, 400);

  if (cache.data && Date.now() - cache.ts < CACHE_MS) {
    return NextResponse.json({ success: true, all_cryptos: cache.data, cached: true });
  }

  try {
    // Binance 24hr ticker — returns ALL pairs in one call (no pagination)
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      headers: { Accept: 'application/json' },
      // NOTE: no `next: { revalidate }` — the Binance 24hr ticker response is
      // ~2.5MB which exceeds Next.js's 2MB data-cache limit. We rely on the
      // 60-second in-memory cache above instead.
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Binance error: ${res.status}` },
        { status: 502 }
      );
    }

    const raw = (await res.json()) as Array<Record<string, string>>;

    const all_cryptos = raw
      // Keep only USDT quote pairs (the liquid majors)
      .filter((t) => t.symbol && String(t.symbol).endsWith('USDT'))
      .map((t, idx) => {
        const pair = String(t.symbol);
        const sym = pair.slice(0, -4); // strip "USDT"
        return {
          symbol: sym,
          name: SYMBOL_NAMES[sym] || sym,
          price_usd: Number(t.lastPrice) || 0,
          change_24h: Number(t.priceChangePercent) || 0,
          change_7d: 0, // Binance 24hr ticker doesn't include 7d change
          market_cap: 0, // Binance doesn't provide market cap
          market_cap_rank: idx + 1,
          volume_24h: Number(t.quoteVolume) || 0,
        };
      })
      // Filter out stablecoins (price pegged to $1, not interesting for analysis)
      .filter((c) => !['USDT', 'BUSD', 'USDC', 'TUSD', 'FDUSD', 'DAI', 'USDP', 'EUR'].includes(c.symbol))
      // Sort by volume descending (most liquid first)
      .sort((a, b) => b.volume_24h - a.volume_24h)
      .slice(0, limit);

    cache.data = all_cryptos;
    cache.ts = Date.now();

    return NextResponse.json({ success: true, all_cryptos, cached: false });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `فشل تحميل قائمة العملات: ${msg}` },
      { status: 500 }
    );
  }
}

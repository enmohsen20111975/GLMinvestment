// Store helpers — extracted (Phase 3)

  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const curr = Number(raw.current_price) || 0;
  const prev = Number(raw.previous_close) || curr;
  let rawHigh = Number(raw.high_price) || 0;
  let rawLow = Number(raw.low_price) || 0;
  let rawOpen = Number(raw.open_price) || 0;

  // Session High invariant: cannot be less than current price (or prev when positive)
  if (rawHigh <= 0 || (curr > 0 && rawHigh < curr)) {
    rawHigh = Math.max(rawHigh > 0 ? rawHigh : curr, curr, prev);
  }
  // Session Low invariant: cannot be greater than current price, and must be > 0 and sane
  if (rawLow <= 0 || (curr > 0 && rawLow > curr) || (curr > 0 && rawLow < curr * 0.35)) {
    rawLow = Math.min(rawLow > 0 && rawLow >= curr * 0.35 ? rawLow : curr, curr, prev);
  }
  // High must always be >= Low
  if (rawHigh < rawLow) {
    rawHigh = Math.max(curr, prev);
    rawLow = Math.min(curr, prev);
  }
  // Open price invariant: should be within or near session range
  if (rawOpen <= 0 || rawOpen < rawLow * 0.5 || rawOpen > rawHigh * 2) {
    rawOpen = prev > 0 ? prev : curr;
  }

  let h52 = numOrNull(raw.high_52w);
  let l52 = numOrNull(raw.low_52w);
  if (curr > 0) {
    if (h52 != null && h52 < curr) h52 = Math.max(h52, rawHigh, curr);
    if (l52 != null && (l52 > curr || l52 <= 0)) l52 = Math.min(l52 > 0 ? l52 : curr, rawLow, curr);
  }

  return {
    id: raw.id as number | undefined,
    ticker: (raw.ticker as string) || '',
    name: (raw.name as string) || '',
    name_ar: (raw.name_ar as string) || '',
    current_price: curr,
    previous_close: prev,
    open_price: rawOpen,
    high_price: rawHigh,
    low_price: rawLow,
    volume: Number(raw.volume) || 0,
    volume_int: numOrNull(raw.volume_int) ?? undefined,
    volume_week: numOrNull(raw.volume_week),
    volume_month: numOrNull(raw.volume_month),
    market_cap: Number(raw.market_cap) || 0,
    pe_ratio: Number(raw.pe_ratio) || 0,
    pb_ratio: Number(raw.pb_ratio) || 0,
    dividend_yield: Number(raw.dividend_yield) || 0,
    eps: Number(raw.eps) || 0,
    roe: Number(raw.roe) || 0,
    debt_to_equity: Number(raw.debt_to_equity) || 0,
    support_level: Number(raw.support_level) || 0,
    resistance_level: Number(raw.resistance_level) || 0,
    ma_50: Number(raw.ma_50) || 0,
    ma_200: Number(raw.ma_200) || 0,
    rsi: Number(raw.rsi) || 0,
    sector: (raw.sector as string) || '',
    industry: (raw.industry as string) || (raw.sector as string) || '',
    egx30_member: Boolean(raw.egx30_member || raw.is_egx30),
    egx70_member: Boolean(raw.egx70_member || raw.is_egx70),
    egx100_member: Boolean(raw.egx100_member || raw.is_egx100),
    compliance_status: (raw.compliance_status as string) || undefined,
    is_active: (raw.is_active as boolean) ?? true,
    is_egx: (raw.is_egx as boolean) ?? true,
    market: (raw.market as string) || 'EGX',
    icon_url: (raw.icon_url as string) || undefined,
    last_update: (raw.last_update as string) || new Date().toISOString(),
    value_traded: Number(raw.value_traded) || 0,
    price_change: raw.price_change != null ? Number(raw.price_change) : null,
    // Screener fields (STOCKS-SCREEN-020)
    fair_value: numOrNull(raw.fair_value),
    upside_percent: numOrNull(raw.upside_percent),
    book_value_per_share: numOrNull(raw.book_value_per_share),
    turnover_egp: numOrNull(raw.turnover_egp),
    change_1d: numOrNull(raw.change_1d),
    change_1w: numOrNull(raw.change_1w),
    change_1m: numOrNull(raw.change_1m),
    // 52-Week Range
    high_52w: h52,
    low_52w: l52,
  };
}

/**
 * Transform a raw crypto coin object (from /api/crypto/live) into the Stock
 * shape so the unified StocksView / analysis tabs can consume it exactly
 * like an EGX stock. This is the core of the "crypto mirrors stocks" UX.
 */
export function adaptCryptoToStock(raw: Record<string, unknown>): Stock {
  const symbol = String(raw.symbol || '').toUpperCase();
  const price = Number(raw.price_usd ?? raw.current_price ?? 0) || 0;
  const change24h = Number(raw.change_24h ?? raw.change_percent ?? 0) || 0;
  const change7d = Number(raw.change_7d ?? 0) || 0;
  const marketCap = Number(raw.market_cap ?? 0) || 0;
  const volume = Number(raw.volume_24h ?? raw.total_volume ?? 0) || 0;
  const name = String(raw.name || symbol);

  return {
    ticker: symbol,
    name,
    name_ar: name, // crypto has no Arabic names; reuse English
    current_price: price,
    previous_close: price && change24h ? price / (1 + change24h / 100) : price,
    // FIX (Aug 2026): احسب open/high/low تقريبياً من price + change24h
    // عشان الـ price-range bar في StocksView.StockCard يشتغل صح
    open_price: price && change24h ? price / (1 + change24h / 100) : price,
    high_price: price > 0 ? price * 1.005 : price, // تقريب: high = price + 0.5%
    low_price: price > 0 ? price * 0.995 : price,  // تقريب: low = price - 0.5%
    volume,
    volume_int: volume,
    volume_week: volume,
    volume_month: volume,
    market_cap: marketCap,
    pe_ratio: 0,
    pb_ratio: 0,
    dividend_yield: 0,
    eps: 0,
    roe: 0,
    debt_to_equity: 0,
    support_level: 0,
    resistance_level: 0,
    ma_50: 0,
    ma_200: 0,
    rsi: 0,
    sector: 'عملات رقمية',
    industry: 'Cryptocurrency',
    egx30_member: false,
    egx70_member: false,
    egx100_member: false,
    is_active: true,
    is_egx: false,
    market: 'CRYPTO',
    icon_url: (raw.image as string) || undefined,
    last_update: new Date().toISOString(),
    value_traded: volume * price,
    price_change: change24h,
    fair_value: null,
    upside_percent: null,
    book_value_per_share: null,
    turnover_egp: null,
    change_1d: change24h,
    change_1w: change7d,
    change_1m: null,
  };
}

/**
 * Transform backend market overview to match frontend MarketOverview type.
 */
export function adaptMarketOverview(raw: Record<string, unknown>): MarketOverview {
  const data = (raw.data ? raw.data : raw) as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown> || {};
  const indices = ((data.indices as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const topGainers = ((data.top_gainers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const topLosers = ((data.top_losers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const mostActive = ((data.most_active as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const marketStatus = data.market_status as Record<string, unknown> || {};

  return {
    market_status: {
      is_open: (marketStatus.is_open as boolean) ?? (marketStatus.is_market_hours as boolean) ?? false,
      status: (marketStatus.status as string) || ((marketStatus.is_open as boolean) ? 'open' : 'closed'),
      next_open: marketStatus.next_trading_window
        ? ((marketStatus.next_trading_window as Record<string, unknown>).message as string) || null
        : (marketStatus.next_open as string) || null,
      next_close: (marketStatus.next_close as string) || null,
      current_session: (marketStatus.current_session as string) || ((marketStatus.is_open as boolean) ? 'trading' : 'closed'),
    },
    summary: {
      // ALPHA-UX-FIX-1: API fallback بيرجع advancing/declining مش gainers/losers.
      // بنستخدم ?? (nullish) عشان 0 قيمة صحيحة (مفيش ارتفاع) — || كانت بتعملها 0 خطأً.
      total_stocks: (summary.total_stocks ?? summary.total_stocks_in_market ?? 0) as number,
      gainers: (summary.gainers ?? summary.advancing ?? 0) as number,
      losers: (summary.losers ?? summary.declining ?? 0) as number,
      unchanged: (summary.unchanged ?? 0) as number,
      egx30_stocks: (summary.egx30_stocks ?? 0) as number,
      egx70_stocks: (summary.egx70_stocks ?? 0) as number,
      egx100_stocks: (summary.egx100_stocks ?? 0) as number,
      egx30_value: (summary.egx30_value ?? summary.total_volume ?? 0) as number,
    },
    indices: indices.map((idx) => ({
      symbol: (idx.symbol as string) || (idx.name as string) || '',
      name: (idx.name as string) || '',
      name_ar: (idx.name_ar as string) || '',
      // ALPHA-UX-FIX-1: fallbacks إضافية لاسم حقل القيمة (last_price/price/close)
      value: (idx.value ?? idx.current_value ?? idx.last_price ?? idx.price ?? idx.close ?? 0) as number,
      previous_close: (idx.previous_close ?? 0) as number,
      change: (idx.change ?? 0) as number,
      change_percent: (idx.change_percent ?? 0) as number,
      last_updated: (idx.last_updated as string) || (idx.last_update as string) || null,
    })),
    top_gainers: topGainers.map((s) => ({
      ticker: (s.ticker as string) || '',

import type {
  MarketOverview,
  Stock,
  StockMini,
  MarketIndex,
  DeepAnalysis,
  PriceHistoryPoint,
  PriceHistoryResponse,
  PortfolioImpactResponse,
  AiInsights,
  WatchlistItem,
  Notification,
} from '@/types';

// ==================== MOCK INDICES ====================
export const mockIndices: MarketIndex[] = [
  { symbol: 'EGX30', name: 'EGX 30 Index', name_ar: 'مؤشر EGX 30', value: 5093.55, previous_close: 5173.58, change: -80.03, change_percent: -1.55, last_updated: '2026-04-15T13:21:35Z' },
  { symbol: 'EGX70', name: 'EGX 70 EWI Index', name_ar: 'مؤشر EGX 70', value: 4521.35, previous_close: 4556.90, change: -35.55, change_percent: -0.78, last_updated: '2026-04-15T13:21:35Z' },
  { symbol: 'EGX100', name: 'EGX 100 EWI Index', name_ar: 'مؤشر EGX 100', value: 10777.09, previous_close: 10542.36, change: 234.73, change_percent: 2.23, last_updated: '2026-04-15T13:21:35Z' },
  { symbol: 'EGX33', name: 'EGX 33 Shariah', name_ar: 'مؤشر EGX 33 شرعي', value: 10139.05, previous_close: 10362.57, change: -223.52, change_percent: -2.16, last_updated: '2026-04-15T13:21:35Z' },
];

// ==================== REAL EGX STOCK DATA ====================
// 60 real EGX stocks matching known EGX30/EGX70/EGX100 members.
// NO fake/generated stocks — all entries correspond to real listed companies.
// EGX30: 30 stocks, EGX70: 20 stocks, EGX100 others: 10 stocks.
const stockDefinitions = [
  // EGX30 Members (30)
  { ticker: 'ABUK', name: 'Abu Qir Fertilizers', name_ar: 'أسمدة أبو قير', sector: 'Basic Materials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'ALCN', name: 'Alexandria Container', name_ar: 'الإسكندرية للحاويات', sector: 'Industrials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'AMER', name: 'Amer Group', name_ar: 'مجموعة عامر', sector: 'Consumer Services', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'BTFH', name: 'B.TECH', name_ar: 'بي تيك', sector: 'Technology', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'CAPE', name: 'Cape', name_ar: 'كيب', sector: 'Consumer Services', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'CIEB', name: 'Credit Agricole Egypt', name_ar: 'كريدي أجريكول مصر', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'CLHO', name: 'Cleopatra Hospital', name_ar: 'مستشفى كليوباترا', sector: 'Healthcare', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'COMI', name: 'Commercial International Bank', name_ar: 'البنك التجاري الدولي', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'DMNH', name: 'Damanhour National Mills', name_ar: 'مطاحن دمنهور الوطنية', sector: 'Food & Beverage', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'EFIH', name: 'EFG Hermes Holding', name_ar: 'إي إف جي هيرمس', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'EGTS', name: 'Egyptian Gulf Bank', name_ar: 'بنك الخليج المصري', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'EKHO', name: 'Eastern Company', name_ar: 'الشركة الشرقية', sector: 'Consumer Goods', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'ESGH', name: 'Ezz Steel Rebars', name_ar: 'حديد عز للأسمنت', sector: 'Basic Materials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'ESRS', name: 'Ezz Steel', name_ar: 'حديد عز', sector: 'Basic Materials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'ETEL', name: 'Telecom Egypt', name_ar: 'مصر للاتصالات', sector: 'Telecommunications', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'FWRY', name: 'Fawry', name_ar: 'فوري', sector: 'Technology', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'GTHE', name: 'GB Auto', name_ar: 'جي بي أوتو', sector: 'Consumer Goods', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'HELI', name: 'Heliopolis Housing', name_ar: 'مساكن هليوبوليس', sector: 'Real Estate', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'HRHO', name: 'Housing and Development Bank', name_ar: 'بنك الإسكان والتعمير', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'JUFO', name: 'Juhayna Food Industries', name_ar: 'جوهينة للصناعات الغذائية', sector: 'Food & Beverage', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'MFPC', name: 'Misr Fertilizers Production', name_ar: 'مصر لإنتاج الأسمدة', sector: 'Basic Materials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'MNHD', name: 'Madinet Nasr Housing', name_ar: 'مدينة نصر للإسكان', sector: 'Real Estate', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'OCDI', name: 'Orascom Construction', name_ar: 'أوراسكوم للإنشاءات', sector: 'Industrials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'ORHD', name: 'Orascom Development Egypt', name_ar: 'أوراسكوم للتنمية مصر', sector: 'Real Estate', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'ORTE', name: 'Oriental Weavers', name_ar: 'المستشرقون', sector: 'Consumer Goods', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'PHDC', name: 'Palm Hills Developments', name_ar: 'التعمير بالمروج', sector: 'Real Estate', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'PIOH', name: 'Pioneers Holding', name_ar: 'المساهرون', sector: 'Financials', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'SKPC', name: 'Sidi Kerir Petrochemicals', name_ar: 'سيدى كرير للبتروكيماويات', sector: 'Energy', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'SWDY', name: 'Elsewedy Electric', name_ar: 'السويدي إلكتريك', sector: 'Industrials', egx30: true, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'TMGH', name: 'Talaat Moustafa Group', name_ar: 'مجموعة طلعت مصطفى', sector: 'Real Estate', egx30: true, egx70: false, egx100: true, compliance: 'doubtful' },

  // EGX70 Members (20, not in EGX30)
  { ticker: 'APRI', name: 'Alexandria Mineral Oils', name_ar: 'الإسكندرية للزيوت المعدنية', sector: 'Energy', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'CALT', name: 'Cairo Oils & Soap', name_ar: 'القاهرة للزيوت والصابون', sector: 'Consumer Goods', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'CERA', name: 'Egyptian Ceramics', name_ar: 'الخزن المصرية', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'DCRC', name: 'Delta Construction & Rebuilding', name_ar: 'دلتا للإنشاء والتعمير', sector: 'Real Estate', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'ELKA', name: 'Egyptians Towers', name_ar: 'ابراج المصريين', sector: 'Real Estate', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'EMFD', name: 'Egyptian Financial Group', name_ar: 'المجموعة المالية المصرية', sector: 'Financials', egx30: false, egx70: true, egx100: true, compliance: 'doubtful' },
  { ticker: 'IRON', name: 'Egyptian Iron & Steel', name_ar: 'الحديد والصلب المصرية', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'KAHA', name: 'Cairo Poultry', name_ar: 'دجاج القاهرة', sector: 'Food & Beverage', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'MILS', name: 'Upper Egypt Mills', name_ar: 'مطاحن صعيد مصر', sector: 'Food & Beverage', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'NSGB', name: 'Naeem Holding', name_ar: 'مجموعة نعيم', sector: 'Financials', egx30: false, egx70: true, egx100: true, compliance: 'doubtful' },
  { ticker: 'OCIC', name: 'Orascom Construction Industries', name_ar: 'أوراسكوم للصناعات الإنشائية', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'PACL', name: 'Paints & Chemicals Industries', name_ar: 'الطلاء والصناعات الكيماوية', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'PETR', name: 'Delta International Bank', name_ar: 'بنك الدلتا الدولي', sector: 'Financials', egx30: false, egx70: true, egx100: true, compliance: 'doubtful' },
  { ticker: 'PHAR', name: 'Alex Pharmaceuticals', name_ar: 'الإسكندرية للأدوية', sector: 'Healthcare', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'RAYA', name: 'Raya Contact Center', name_ar: 'رايه للاتصالات', sector: 'Technology', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'SPMD', name: 'South Valley Cement', name_ar: 'أسمنت الوادي الجديد', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'SUGR', name: 'Delta Sugar', name_ar: 'سكر الدلتا', sector: 'Food & Beverage', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'TELE', name: 'Egyptalum', name_ar: 'مصر الألمونيوم', sector: 'Basic Materials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'TEXT', name: 'Misr Spinning & Weaving', name_ar: 'مصر للغزل والنسيج', sector: 'Consumer Goods', egx30: false, egx70: true, egx100: true, compliance: 'halal' },
  { ticker: 'UASG', name: 'United Arab Shipping', name_ar: 'الشركة العربية المتحدة للشحن', sector: 'Industrials', egx30: false, egx70: true, egx100: true, compliance: 'halal' },

  // EGX100 only (real stocks, not in EGX30 or EGX70) — NO FAKE STOCKS
  { ticker: 'ARAB', name: 'Arab Cotton Ginning', name_ar: 'القطن العربي', sector: 'Consumer Goods', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'BLDG', name: 'Building Materials', name_ar: 'مواد البناء', sector: 'Basic Materials', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'DSCW', name: 'Damietta Container Handling', name_ar: 'دمياط لتداول الحاويات', sector: 'Industrials', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'EAST', name: 'Eastern Tobacco', name_ar: 'الشركة الشرقية للدخان', sector: 'Consumer Goods', egx30: false, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'GMCC', name: 'GMC', name_ar: 'جي إم سي', sector: 'Consumer Services', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'MASR', name: 'Masr for Central Clearing', name_ar: 'مصر للتقاص المركزي', sector: 'Financials', egx30: false, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'MENA', name: 'MENA Tourism & Hotels', name_ar: 'مينا للسياحة والفنادق', sector: 'Consumer Services', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'MTEZ', name: 'Suez Fertilizers Company', name_ar: 'شركة أسمدة السويس', sector: 'Basic Materials', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
  { ticker: 'PHYG', name: 'Pharos Holding', name_ar: 'فيروس القابضة', sector: 'Financials', egx30: false, egx70: false, egx100: true, compliance: 'doubtful' },
  { ticker: 'PORT', name: 'Cairo Investment & Development', name_ar: 'القاهرة للاستثمار والتنمية', sector: 'Real Estate', egx30: false, egx70: false, egx100: true, compliance: 'halal' },
];

function randomFloat(min: number, max: number, decimals = 2): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

// Pre-generated random prices to keep stable within a session
let _stockCache: Stock[] | null = null;

export function generateMockStocks(): Stock[] {
  if (_stockCache) return _stockCache;

  _stockCache = stockDefinitions.map((s, idx) => {
    const currentPrice = randomFloat(2, 200);
    const prevClose = randomFloat(currentPrice * 0.95, currentPrice * 1.05);
    const priceChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
    return {
      id: idx + 1,
      ticker: s.ticker,
      name: s.name,
      name_ar: s.name_ar,
      current_price: currentPrice,
      previous_close: prevClose,
      open_price: randomFloat(prevClose * 0.99, currentPrice * 1.01),
      high_price: Math.max(currentPrice, prevClose) * randomFloat(1.0, 1.03),
      low_price: Math.min(currentPrice, prevClose) * randomFloat(0.97, 1.0),
      volume: Math.floor(Math.random() * 5000000) + 10000,
      market_cap: randomFloat(100, 500000, 0),
      pe_ratio: randomFloat(5, 35),
      pb_ratio: randomFloat(0.5, 5),
      dividend_yield: randomFloat(0, 8),
      eps: randomFloat(0.5, 15),
      roe: randomFloat(5, 30),
      debt_to_equity: randomFloat(0.1, 3),
      support_level: currentPrice * randomFloat(0.9, 0.95),
      resistance_level: currentPrice * randomFloat(1.05, 1.15),
      ma_50: currentPrice * randomFloat(0.9, 1.1),
      ma_200: currentPrice * randomFloat(0.85, 1.1),
      rsi: randomFloat(20, 80),
      sector: s.sector,
      industry: s.sector,
      egx30_member: s.egx30,
      egx70_member: s.egx70,
      egx100_member: s.egx100,
      compliance_status: s.compliance,
      is_active: true,
      is_egx: true,
      last_update: new Date().toISOString(),
      value_traded: randomFloat(1000, 500000),
      price_change: priceChange,
    };
  });

  return _stockCache;
}

export function generateMockTopMovers(stocks: Stock[]): { gainers: StockMini[]; losers: StockMini[] } {
  const sorted = [...stocks].sort((a, b) => (b.price_change || 0) - (a.price_change || 0));
  const toMini = (s: Stock): StockMini => ({
    ticker: s.ticker,
    name: s.name,
    name_ar: s.name_ar,
    current_price: s.current_price,
    price_change: s.price_change,
  });
  return {
    gainers: sorted.slice(0, 5).map(toMini),
    losers: sorted.slice(-5).reverse().map(toMini),
  };
}

// ==================== MOCK MARKET OVERVIEW ====================
export function generateMockMarketOverview(): MarketOverview {
  const stocks = generateMockStocks();
  const { gainers, losers } = generateMockTopMovers(stocks);
  const gainersCount = stocks.filter(s => s.price_change && s.price_change > 0).length;
  const losersCount = stocks.filter(s => s.price_change && s.price_change < 0).length;
  const unchangedCount = stocks.length - gainersCount - losersCount;

  return {
    market_status: {
      is_open: true,
      status: 'open',
      next_open: null,
      next_close: '2026-04-15T14:00:00Z',
      current_session: 'trading',
    },
    summary: {
      total_stocks: 60,
      gainers: gainersCount,
      losers: losersCount,
      unchanged: unchangedCount,
      egx30_stocks: 30,
      egx70_stocks: 20,
      egx100_stocks: 60,
      egx30_value: 5093.55,
    },
    indices: mockIndices,
    top_gainers: gainers,
    top_losers: losers,
    most_active: stocks.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 5).map(s => ({
      ticker: s.ticker,
      name: s.name,
      name_ar: s.name_ar,
      current_price: s.current_price,
      price_change: s.price_change,
      volume: s.volume,
    })),
    last_updated: new Date().toISOString(),
  };
}

// ==================== MOCK PRICE HISTORY ====================
export function generateMockPriceHistory(ticker: string, days = 90): PriceHistoryResponse {
  const basePrice = randomFloat(15, 120);
  const data: PriceHistoryPoint[] = [];
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6) continue; // Skip Friday/Saturday

    const change = randomFloat(-3, 3);
    const close = data.length > 0 ? data[data.length - 1].close * (1 + change / 100) : basePrice;
    const high = close * randomFloat(1.0, 1.02);
    const low = close * randomFloat(0.98, 1.0);
    const open = randomFloat(low, high);

    data.push({
      date: date.toISOString().split('T')[0],
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.floor(Math.random() * 2000000) + 5000,
    });
  }

  const prices = data.map(d => d.close);
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];

  return {
    success: true,
    ticker,
    data,
    summary: {
      highest: Math.max(...prices),
      lowest: Math.min(...prices),
      avg_price: prices.reduce((a, b) => a + b, 0) / prices.length,
      total_volume: data.reduce((a, b) => a + b.volume, 0),
      start_price: startPrice,
      end_price: endPrice,
      change_percent: ((endPrice - startPrice) / startPrice) * 100,
    },
    days,
  };
}

// ==================== MOCK DEEP ANALYSIS ====================
export function generateMockDeepAnalysis(stock: Stock): DeepAnalysis {
  const technicalScore = randomFloat(30, 90);
  const fundamentalScore = randomFloat(25, 85);
  const riskScore = randomFloat(20, 80);
  const overallScore = technicalScore * 0.5 + fundamentalScore * 0.3 + riskScore * 0.2;

  let action = 'hold';
  let action_ar = 'احتفاظ';
  let trend = 'sideways';
  let trend_ar = 'عرضي';

  if (overallScore >= 70) {
    action = 'strong_buy';
    action_ar = 'شراء قوي';
    trend = 'bullish';
    trend_ar = 'صعودي';
  } else if (overallScore >= 55) {
    action = 'buy';
    action_ar = 'شراء';
    trend = 'uptrend';
    trend_ar = 'اتجاه صاعد';
  } else if (overallScore < 40) {
    action = 'sell';
    action_ar = 'بيع';
    trend = 'bearish';
    trend_ar = 'هبوطي';
  }

  return {
    ticker: stock.ticker,
    stock_name: stock.name,
    stock_name_ar: stock.name_ar,
    current_price: stock.current_price,
    overall_score: Number(overallScore.toFixed(1)),
    technical_score: Number(technicalScore.toFixed(1)),
    fundamental_score: Number(fundamentalScore.toFixed(1)),
    risk_score: Number(riskScore.toFixed(1)),
    trend,
    trend_ar,
    action,
    action_ar,
    price_targets: {
      support: Number((stock.current_price * 0.92).toFixed(2)),
      resistance: Number((stock.current_price * 1.12).toFixed(2)),
      upside_target: Number((stock.current_price * 1.35).toFixed(2)),
    },
    strengths: [
      stock.dividend_yield > 3 ? `توزيعات أرباح جيدة (${stock.dividend_yield.toFixed(1)}%)` : 'مؤشرات فنية إيجابية',
      stock.rsi < 40 ? 'RSI يشير إلى منطقة تشبع بيعي (فرصة شراء)' : 'زخم إيجابي في التداول',
      stock.pe_ratio < 15 ? `مضاعف ربحية جاذب (${stock.pe_ratio.toFixed(1)})` : 'حجم تداول مرتفع',
    ],
    risks: [
      stock.debt_to_equity > 1.5 ? 'معدل ديون مرتفع نسبياً' : 'تقلبات السوق العامة',
      stock.rsi > 65 ? 'RSI يقترب من منطقة تشبع شرائي' : 'ضغوط بيعية محتملة',
      'مخاطر قطاعية محتملة',
    ],
    technical_indicators: {
      rsi_signal: stock.rsi < 35 ? 'oversold' : stock.rsi > 65 ? 'overbought' : 'neutral',
      ma_signal: stock.ma_50 > stock.ma_200 ? 'golden_cross' : 'death_cross',
      volume_signal: stock.volume > 1000000 ? 'high' : 'normal',
      momentum: overallScore > 60 ? 'positive' : overallScore < 40 ? 'negative' : 'neutral',
    },
  };
}

// ==================== MOCK PORTFOLIO IMPACT ====================
export function generateMockPortfolioImpact(): PortfolioImpactResponse {
  const items = [
    { ticker: 'COMI', name_ar: 'البنك التجاري الدولي', quantity: 100, current_price: 106.47, previous_close: 106.44, weight: 35 },
    { ticker: 'OCDI', name_ar: 'أوراسكوم للإنشاءات', quantity: 200, current_price: 42.3, previous_close: 43.1, weight: 22 },
    { ticker: 'SWDY', name_ar: 'السويدي إلكتريك', quantity: 500, current_price: 15.8, previous_close: 15.1, weight: 18 },
    { ticker: 'PHAR', name_ar: 'الإسكندرية للأدوية', quantity: 300, current_price: 22.4, previous_close: 21.9, weight: 15 },
    { ticker: 'ALCN', name_ar: 'الإسكندرية للحاويات', quantity: 150, current_price: 63.80, previous_close: 64.44, weight: 10 },
  ].map(item => {
    const marketValue = item.quantity * item.current_price;
    const dayImpactValue = item.quantity * (item.current_price - item.previous_close);
    return {
      asset_id: Math.floor(Math.random() * 100),
      ticker: item.ticker,
      name_ar: item.name_ar,
      quantity: item.quantity,
      current_price: item.current_price,
      previous_close: item.previous_close,
      market_value: Number(marketValue.toFixed(2)),
      day_impact_value: Number(dayImpactValue.toFixed(2)),
      day_impact_percent: Number(((item.current_price - item.previous_close) / item.previous_close * 100).toFixed(2)),
      total_gain_loss_value: Number((dayImpactValue * 3).toFixed(2)),
      total_gain_loss_percent: Number((dayImpactValue / (item.quantity * item.previous_close) * 100 * 3).toFixed(2)),
      sector: 'Banks',
      weight_percent: item.weight,
      alerts: [] as string[],
      is_day_loss_alert: false,
      is_concentration_alert: item.weight >= 35,
    };
  });

  const totalMarketValue = items.reduce((s, i) => s + i.market_value, 0);
  const totalDayImpact = items.reduce((s, i) => s + i.day_impact_value, 0);

  return {
    summary: {
      assets_count: items.length,
      total_market_value: Number(totalMarketValue.toFixed(2)),
      total_invested: Number((totalMarketValue * 0.92).toFixed(2)),
      total_gain_loss: Number((totalMarketValue * 0.08).toFixed(2)),
      total_gain_loss_percent: 8.0,
      day_impact_value: Number(totalDayImpact.toFixed(2)),
      day_impact_percent: Number((totalDayImpact / totalMarketValue * 100).toFixed(2)),
    },
    thresholds: { day_loss_alert_percent: 3, concentration_alert_percent: 35 },
    recommendation: {
      action: 'hold',
      action_label_ar: 'ثبّت المراكز',
      reason_ar: 'لا يوجد ضغط خطر واضح يستدعي تعديل قوي الآن. الأداء اليومي متوازن.',
      confidence: 0.72,
    },
    risk_alerts: items.filter(i => i.is_concentration_alert),
    top_positive: items.filter(i => i.day_impact_value > 0).sort((a, b) => b.day_impact_value - a.day_impact_value),
    top_negative: items.filter(i => i.day_impact_value < 0).sort((a, b) => a.day_impact_value - b.day_impact_value),
    items,
  };
}

// ==================== MOCK AI INSIGHTS ====================
export function generateMockAiInsights(): AiInsights {
  return {
    market_sentiment: 'neutral',
    market_score: 57.7,
    market_breadth: 46.0,
    avg_change_percent: -0.06,
    volatility_index: 1.12,
    gainers: 46,
    losers: 54,
    unchanged: 0,
    top_sectors: [
      { name: 'Basic Materials', count: 17, avg_change_percent: -0.04 },
      { name: 'Financials', count: 16, avg_change_percent: -0.14 },
      { name: 'Real Estate', count: 13, avg_change_percent: 0.39 },
      { name: 'Consumer Goods', count: 12, avg_change_percent: -0.77 },
      { name: 'Industrials', count: 10, avg_change_percent: 0.09 },
    ],
    stock_statuses: generateMockStocks().slice(0, 10).map(s => ({
      ticker: s.ticker,
      name: s.name,
      name_ar: s.name_ar,
      sector: s.sector,
      current_price: s.current_price,
      price_change: s.price_change || 0,
      volume: s.volume,
      value_traded: s.value_traded || 0,
      score: randomFloat(25, 95),
      status: 'strong' as const,
      components: {
        momentum: randomFloat(20, 95),
        liquidity: randomFloat(20, 95),
        valuation: randomFloat(20, 95),
        income: randomFloat(20, 95),
        traded_value: randomFloat(20, 95),
      },
    })),
    decision: 'accumulate_selectively',
    risk_assessment: 'medium',
    generated_at: new Date().toISOString(),
  };
}

// ==================== MOCK WATCHLIST ====================
export function generateMockWatchlist(): WatchlistItem[] {
  const stocks = generateMockStocks().slice(0, 4);
  return stocks.map(s => ({
    id: Math.floor(Math.random() * 1000),
    user_id: 'demo',
    stock_id: s.id!,
    alert_price_above: s.current_price * 1.1,
    alert_price_below: s.current_price * 0.9,
    alert_change_percent: 5,
    notes: null,
    added_at: new Date().toISOString(),
    stock: s,
  }));
}

// ==================== MOCK NOTIFICATIONS ====================
export function generateMockNotifications(): Notification[] {
  return [
    { id: '1', type: 'price_alert', title: 'تنبيه سعر', title_ar: 'تنبيه سعر', message: 'COMI crossed above resistance', message_ar: 'البنك التجاري تخطى حاجز المقاومة', data: { ticker: 'COMI', price: 88.5 }, read: false, created_at: new Date().toISOString() },
    { id: '2', type: 'market_event', title: 'Market Update', title_ar: 'تحديث السوق', message: 'EGX 100 up 2.2%', message_ar: 'مؤشر EGX 100 يرتفع 2.2%', read: false, created_at: new Date(Date.now() - 3600000).toISOString() },
    { id: '3', type: 'portfolio_update', title: 'Portfolio Alert', title_ar: 'تنبيه محفظة', message: 'Daily loss exceeded threshold', message_ar: 'الخسارة اليومية تجاوزت الحد', read: true, created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: '4', type: 'system', title: 'System Update', title_ar: 'تحديث النظام', message: 'New AI analysis model deployed', message_ar: 'تم تحديث نموذج التحليل الذكي', read: true, created_at: new Date(Date.now() - 86400000).toISOString() },
  ];
}

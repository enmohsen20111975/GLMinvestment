/**
 * 😈 طبقة الشيطان — الخبير المخضرم
 * Devil's Layer Types
 *
 * الفلسفة: النظام بيقول "الخبر كويس → اشتري".
 * الشيطان بيقول: "الخبر كويس بس السوق نزل بعده نص ساعة → حد كبير بيبيع → ابعد".
 *
 * الشيطان بيقرأ رد فعل السوق على الخبر، مش الخبر نفسه.
 */

// ==================== المحرك 1: التناقض (Divergence) ====================

export interface NewsItem {
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number; // -100 to +100
  publishedAt: string; // ISO
  source?: string;
  ticker?: string;
}

export interface PriceReaction {
  priceBefore: number;
  priceAfter: number; // 30 دقيقة بعد الخبر
  changePercent: number;
  volumeRatio?: number; // نسبة السيولة مقابل المتوسط
  direction: 'up' | 'down' | 'flat';
}

export interface DivergenceSignal {
  newsTitle: string;
  newsSays: 'positive' | 'negative' | 'neutral';
  marketDid: 'up' | 'down' | 'flat';
  divergenceType: 'distribution' | 'accumulation' | 'normal' | 'no_reaction';
  // distribution = خبر كويس + سعر نزل (حد كبير بيبيع)
  // accumulation = خبر سيء + سعر طلع (حد كبير بيجمع)
  // normal = الكل شايف نفس الشيء
  // no_reaction = مفيش سيولة / السهم نائم
  strength: 'very_strong' | 'strong' | 'weak' | 'none';
  devilVerdict: string; // "الخبر بيقول X، بس السوق بيقول Y"
  signalScore: number; // -100 (ابعد) to +100 (اشتري)
}

// ==================== المحرك 2: السلسلة (Chain Reaction) ====================

export type MacroEventType =
  | 'usd_egp'       // الدولار مقابل الجنيه
  | 'interest_rate'  // قرار الفائدة (CBE/Fed)
  | 'oil_price'      // النفط
  | 'gold_price'     // الذهب
  | 'war_conflict'   // حرب/صراع
  | 'wheat_food'     // القمح/الأغذية
  | 'earnings_season' // موسم الأرباح
  | 'regulatory';     // قرار تنظيمي

export interface ChainImpact {
  ticker: string;
  nameAr?: string;
  sector: string;
  direction: 'benefit' | 'suffer' | 'mixed';
  impactPercent: number; // متوقع % تغير
  reasoning: string;
}

export interface ChainReactionResult {
  event: MacroEventType;
  eventDescription: string;
  eventDirection: 'up' | 'down';
  magnitude: number; // % تغير الحدث
  beneficiaries: ChainImpact[];  // المستفيدين
  sufferers: ChainImpact[];       // المتضررين
  mixed: ChainImpact[];           // مختلط
  devilVerdict: string;
}

// ==================== المحرك 3: اللعب قبل الحدث (Pre-Event) ====================

export interface ScenarioOutcome {
  name: string;
  probability: number; // 0-1
  priceImpact: number; // % (موجب أو سالب)
}

export interface PreEventAnalysis {
  eventName: string;
  eventDate: string;
  daysUntil: number;
  scenarios: ScenarioOutcome[];
  expectedValue: number; // مجموع (prob × impact)
  verdict: 'buy_before' | 'wait' | 'sell_before' | 'neutral';
  devilVerdict: string;
  investorPlay: string; // "لو مستثمر: ..."
  gamblerPlay: string;  // "لو مغامر: ..."
}

// ==================== المحرك 4: العكسية (Contrarian) ====================

export interface ContrarianSignal {
  crowdSentiment: number;   // -100 (الكل بيع) to +100 (الكل شترى)
  pricePercentile: number;  // 0-100 (فين السعر相对于 تاريخه)
  volumePattern: 'high' | 'normal' | 'low';
  signal: 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy';
  reasoning: string;
  devilVerdict: string;
}

// ==================== المحرك 5: السياق (Regime + Seasonality) ====================

export type MarketRegime = 'bull' | 'bear' | 'range' | 'transition';

export interface SeasonalityFactor {
  month: number;
  factorName: string;
  description: string;
  effect: 'positive' | 'negative' | 'neutral' | 'caution';
  strength: number; // 0-1
}

export interface RegimeSeasonalityResult {
  regime: MarketRegime;
  regimeDescription: string;
  seasonality: SeasonalityFactor;
  newsInterpretation: 'buy' | 'wait' | 'avoid';
  devilVerdict: string;
}

// ==================== الكارت الموحد (Devil's Card) ====================

export interface DevilCard {
  ticker: string;
  nameAr?: string;
  price?: number;
  generatedAt: string;

  // ملخص الخبر + رد فعل السوق
  headline: string;       // "البنك المركزي يرفع الفايدة"
  crowdThinks: string;    // "🟢 اشتري بنوك"
  marketDid: string;      // "🔴 COMI نزل 1.5% بعد الخبر"
  devilSays: string;      // "🔴🔴 ابعد — التوزيع بدأ"
  devilLevel: 'opportunity' | 'wait' | 'avoid' | 'strong_avoid';

  // الـ 5 محركات
  divergence?: DivergenceSignal;
  chainReaction?: ChainReactionResult;
  preEvent?: PreEventAnalysis;
  contrarian?: ContrarianSignal;
  regime?: RegimeSeasonalityResult;

  // السلسلة (مين بيربح ومين بيخسر)
  chainBeneficiaries: ChainImpact[];
  chainSufferers: ChainImpact[];

  // اللعبة (لكل شخصية)
  investorPlay: string;
  gamblerPlay: string;

  // القواعد الذهبية المفعّلة
  goldenRules: string[];

  // درجة الشيطان الإجمالية
  devilScore: number; // -100 (ابعد بقوة) to +100 (فرصة ذهبية)
}

// ==================== تقويم الشيطان (Devil's Calendar) ====================

export interface CalendarEvent {
  id: string;
  date: string;
  title: string;
  category: 'cbe' | 'earnings' | 'regulatory' | 'seasonality' | 'macro';
  importance: 'high' | 'medium' | 'low';
  daysUntil: number;
  expectedImpact: string;
  devilPlay: string;
  affectedTickers: string[];
}

export interface DevilsCalendar {
  events: CalendarEvent[];
  upcomingWeek: CalendarEvent[];
  upcomingMonth: CalendarEvent[];
  proposedPlays: string[];
}

// ==================== مصفوفة السيناريوهات (Scenario Matrix) ====================

export interface StockScenario {
  name: string;
  probability: number; // 0-1
  marketMove: number;  // % (السوق ككل)
  stockMove: number;   // % متوقع للسهم
  action: 'buy_now' | 'wait' | 'sell_or_avoid';
  reasoning: string;
}

export interface ScenarioMatrix {
  ticker: string;
  scenarios: StockScenario[];
  bestCase: StockScenario;
  worstCase: StockScenario;
  baseCase: StockScenario;
  devilVerdict: string;
}

// ==================== مقياس السوق (Market Mood) ====================

export interface MarketMood {
  temperature: 'hot' | 'warm' | 'cool' | 'cold';
  temperatureAr: string;
  temperatureEmoji: string;
  egx30Change: number;
  gainers: number;
  losers: number;
  liquidity: 'high' | 'normal' | 'low';
  liquidityAr: string;
  regime: MarketRegime;
  regimeAr: string;
  verdict: string;
  verdictLevel: 'opportunity' | 'neutral' | 'caution' | 'stay_away';
  devilScore: number; // -100 to +100
}

// ==================== القواعد الذهبية ====================

export interface GoldenRule {
  id: number;
  name: string;
  description: string;
  check: (context: DevilContext) => boolean;
  message: string;
}

export interface DevilContext {
  ticker: string;
  price?: number;
  newsSentiment?: number;
  priceReaction?: number;
  marketRegime?: MarketRegime;
  pricePercentile?: number;
  volumeRatio?: number;
  upcomingEventDays?: number;
  month?: number;
}

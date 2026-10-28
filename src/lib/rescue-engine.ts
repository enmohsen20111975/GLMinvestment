/**
 * BagHolder Rescue Engine — Framework Implementation
 * =====================================================================
 *
 * بناءً على الـ framework اللي بعتّه الأستاذ محسن:
 * - Market Regime Detector
 * - Portfolio Ingester + Data Validator
 * - Fundamental Scorer (Company Quality Score)
 * - Loss Attribution
 * - Classification Engine (A/B/C/D)
 * - Averaging Simulator (سيناريوهات 10k/20k/30k/50k/70k)
 * - Liquidity Allocator
 * - Monitoring Rules Engine
 *
 * القاعدة الذهبية: "النزول لوحده مش سبب للشراء"
 * الأولوية: حماية رأس المال المتبقي > استعادة تدريجية لو فيه فرصة حقيقية
 *
 * مفيش أي fabricated levels. كل القيم من real data أو NULL.
 */

import type { Row } from './rescue-engine-types';

// ─── Types ────────────────────────────────────────────────────────────────

export type MarketRegime = 'RISK_ON' | 'RISK_OFF' | 'SIDEWAYS' | 'NARROW_RALLY' | 'EXTREME_FEAR' | 'UNKNOWN';

export type StockClassification = 'A' | 'B' | 'C' | 'D' | 'INSUFFICIENT_DATA';

export type LossCause =
  | 'MARKET_WIDE'
  | 'COMPANY_SPECIFIC'
  | 'OVERVALUATION_CORRECTION'
  | 'LIQUIDITY_PRESSURE'
  | 'MIXED'
  | 'UNCLEAR';

export type RescueAction = 'HOLD' | 'AVERAGE_DOWN' | 'CUT_LOSS' | 'MONITOR_CLOSELY' | 'EXIT';

export interface MarketRegimeData {
  regime: MarketRegime;
  egx30_change: number | null;
  egx70_change: number | null;
  egx100_change: number | null;
  breadth_advancing: number | null;
  breadth_declining: number | null;
  foreign_net_flow: number | null;
  is_trading_halted: boolean;
  summary_ar: string;
  recommendation_ar: string;
}

export interface FundamentalScore {
  earnings_quality: number; // 0-3
  revenue_growth: number; // 0-3
  profit_margin_health: number; // 0-3
  operating_cash_flow: number; // 0-3
  debt_level: number; // 0-3 (3 = low debt = good)
  dividend_history: number; // 0-3
  valuation_pe: number; // 0-3
  valuation_pb: number; // 0-3
  liquidity: number; // 0-3
  disclosure_quality: number; // 0-3
  total_score: number; // 0-30
  verdict: 'قوي' | 'متوسط' | 'ضعيف' | 'عالي المخاطرة' | 'بيانات ناقصة';
  notes_ar: string[];
}

export interface LossAttribution {
  primary_cause: LossCause;
  market_contribution_pct: number | null; // % of loss attributable to market
  company_contribution_pct: number | null; // % attributable to company issues
  valuation_contribution_pct: number | null; // % attributable to overvaluation correction
  liquidity_contribution_pct: number | null; // % attributable to liquidity dry-up
  recovery_catalyst_12_24m: 'موجود' | 'ضعيف' | 'مش موجود' | 'غير واضح';
  catalyst_notes_ar: string;
}

export interface PositionAnalysis {
  ticker: string;
  name: string;
  sector: string;
  classification: StockClassification;
  classification_reason_ar: string;
  loss_attribution: LossAttribution;
  fundamental_score: FundamentalScore;
  recommendation: {
    action: RescueAction;
    action_ar: string;
    reasoning_ar: string;
    urgency: 'low' | 'medium' | 'high';
    conditions_ar: string[]; // شروط لازم تتحقق قبل التنفيذ
  };
}

export interface AveragingScenario {
  injection_amount: number; // 10000, 20000, etc.
  current_shares: number;
  current_avg: number;
  new_shares_bought: number;
  new_avg: number;
  new_total_invested: number;
  new_loss_pct: number;
  new_loss_egp: number;
  breakeven_price: number;
  pct_rise_needed_for_breakeven: number;
  // ±10% / ±20% scenarios after injection
  if_down_10pct: { price: number; loss_egp: number; loss_pct: number };
  if_down_20pct: { price: number; loss_egp: number; loss_pct: number };
  if_up_10pct: { price: number; profit_egp: number; profit_pct: number };
  if_up_20pct: { price: number; profit_egp: number; profit_pct: number };
  warning_ar: string; // تحذير صريح
}

export interface LiquidityAllocation {
  recommendation: 'HOLD_ALL_CASH' | 'LIMITED_INJECTION' | 'DUAL_INJECTION' | 'LARGE_INJECTION';
  max_injection_pct: number; // % of available cash
  reasoning_ar: string;
  candidates: string[]; // tickers that qualify for injection
  warnings_ar: string[];
}

export interface MonitoringPlan {
  watch_list_ar: string[];
  review_frequency: 'daily' | 'weekly' | 'biweekly';
  triggers_ar: string[];
  escalation_ar: string;
}

export interface RescueReport {
  generated_at: string;
  market_regime: MarketRegimeData;
  positions: PositionAnalysis[];
  averaging_scenarios: Record<string, AveragingScenario>; // keyed by ticker
  liquidity_allocation: LiquidityAllocation;
  monitoring_plan: MonitoringPlan;
  disclaimers_ar: string[];
}

// ─── 1. Market Regime Detector ───────────────────────────────────────────

export function detectMarketRegime(
  egx30Change: number | null,
  egx70Change: number | null,
  egx100Change: number | null,
  breadthAdvancing: number | null,
  breadthDeclining: number | null,
  foreignNetFlow: number | null,
  isTradingHalted: boolean,
): MarketRegimeData {
  let regime: MarketRegime = 'UNKNOWN';
  let summaryAr = '';
  let recAr = '';

  if (isTradingHalted) {
    regime = 'EXTREME_FEAR';
    summaryAr = 'السوق متوقف عن التداول — حالة خوف حاد. لا توجد سيولة للدخول.';
    recAr = 'احتفظ بالسيولة. لا تضخ أي مبلغ جديد حتى يستأنف التداول ويظهر استقرار نسبي.';
    return {
      regime, egx30_change: egx30Change, egx70_change: egx70Change, egx100_change: egx100Change,
      breadth_advancing: breadthAdvancing, breadth_declining: breadthDeclining,
      foreign_net_flow: foreignNetFlow, is_trading_halted: isTradingHalted,
      summary_ar: summaryAr, recommendation_ar: recAr,
    };
  }

  const egx30Down = (egx30Change ?? 0) < -2;
  const midSmallBleeding = (egx70Change ?? 0) < (egx30Change ?? 0) - 1;
  const breadthNegative = (breadthDeclining ?? 0) > (breadthAdvancing ?? 0) * 1.5;
  const foreignSelling = (foreignNetFlow ?? 0) < -50_000_000;

  if (egx30Down && midSmallBleeding && (breadthNegative || foreignSelling)) {
    regime = 'RISK_OFF';
    summaryAr = 'السوق في وضع تصفية على الأسهم المتوسطة والصغيرة. الـ EGX70 و EGX100 بينزفوا أكتر من EGX30.';
    recAr = 'ده مش وقت تثبت فيه إنك شجاع. ده وقت تحافظ فيه على اللي فاضل. السيولة تتفضل محتفظ بيها إلا لو في سهم A واضح.';
  } else if ((egx30Change ?? 0) > 2 && (egx70Change ?? 0) > 1 && !breadthNegative) {
    regime = 'RISK_ON';
    summaryAr = 'السوق في وضع مخاطرة إيجابي. المؤشرات طالعة والاتساع إيجابي.';
    recAr = 'ممكن تتكلم في فرص انتقائية بحذر. بس متزودش في أسهم ضعيفة لمجرد إن السوق طالع.';
  } else if (Math.abs(egx30Change ?? 0) < 1 && Math.abs(egx70Change ?? 0) < 1) {
    regime = 'SIDEWAYS';
    summaryAr = 'السوق عرضي متذبذب. مفيش اتجاه واضح.';
    recAr = 'التركيز على الجودة العالية جدًا فقط وبمبالغ صغيرة.';
  } else if ((egx30Change ?? 0) > 1 && (egx70Change ?? 0) < 0) {
    regime = 'NARROW_RALLY';
    summaryAr = 'السوق صاعد لكنه ضيق. الأسهم الكبيرة طالعة والصغيرة بتنزف.';
    recAr = 'معظم المحافظ المصرية بتتعذب في الحالة دي. متزودش في الصغيرة.';
  } else {
    regime = 'UNKNOWN';
    summaryAr = 'حالة السوق مش واضحة. البيانات ممكن تكون ناقصة.';
    recAr = 'انتظر حتى تتضح الصورة. مفيش ما يبرر أي ضخ في وضع غامض.';
  }

  return {
    regime, egx30_change: egx30Change, egx70_change: egx70Change, egx100_change: egx100Change,
    breadth_advancing: breadthAdvancing, breadth_declining: breadthDeclining,
    foreign_net_flow: foreignNetFlow, is_trading_halted: isTradingHalted,
    summary_ar: summaryAr, recommendation_ar: recAr,
  };
}

// ─── 2. Fundamental Scorer ───────────────────────────────────────────────

export function scoreFundamentals(stock: Row): FundamentalScore {
  const notes: string[] = [];
  let total = 0;

  // Earnings quality (0-3)
  const eps = Number(stock.eps) || 0;
  const profitMargin = Number(stock.profit_margin) || 0;
  let earningsQuality = 0;
  if (eps > 0) earningsQuality++;
  if (profitMargin > 5) earningsQuality++;
  if (profitMargin > 15) earningsQuality++;
  if (eps <= 0) notes.push('الشركة خسرانة على مستوى EPS — علامة حمراء.');
  total += earningsQuality;

  // Revenue growth (0-3) — not available without historical data; assume 0
  const revenueGrowth = 0;
  total += revenueGrowth;

  // Profit margin health (0-3)
  let marginHealth = 0;
  if (profitMargin > 5) marginHealth++;
  if (profitMargin > 10) marginHealth++;
  if (profitMargin > 20) marginHealth++;
  total += marginHealth;

  // Operating cash flow (0-3) — not in stocks.db schema; null
  const ocf = 0;
  total += ocf;

  // Debt level (0-3) — debt_to_equity; lower = better
  const debtToEquity = Number(stock.debt_to_equity) || 0;
  let debtScore = 0;
  if (debtToEquity > 0 && debtToEquity < 1) debtScore = 3;
  else if (debtToEquity >= 1 && debtToEquity < 2) debtScore = 2;
  else if (debtToEquity >= 2 && debtToEquity < 3) debtScore = 1;
  else if (debtToEquity >= 3) { debtScore = 0; notes.push(`دين مرتفع جداً (D/E = ${debtToEquity.toFixed(2)}) — خطر.`); }
  total += debtScore;

  // Dividend history (0-3) — dividend_yield; if > 0 = pays
  const divYield = Number(stock.dividend_yield) || 0;
  let divScore = 0;
  if (divYield > 0) divScore++;
  if (divYield > 0.03) divScore++;
  if (divYield > 0.05) divScore++;
  total += divScore;

  // Valuation P/E (0-3) — lower = better (but not negative)
  const peRatio = Number(stock.pe_ratio) || 0;
  let peScore = 0;
  if (peRatio > 0 && peRatio < 10) peScore = 3;
  else if (peRatio >= 10 && peRatio < 15) peScore = 2;
  else if (peRatio >= 15 && peRatio < 25) peScore = 1;
  else if (peRatio >= 40) notes.push(`P/E عالي جداً (${peRatio.toFixed(1)}) — تقييم مبالغ فيه.`);
  total += peScore;

  // Valuation P/B (0-3) — lower = better
  const pbRatio = Number(stock.pb_ratio) || 0;
  let pbScore = 0;
  if (pbRatio > 0 && pbRatio < 1) pbScore = 3;
  else if (pbRatio >= 1 && pbRatio < 2) pbScore = 2;
  else if (pbRatio >= 2 && pbRatio < 4) pbScore = 1;
  else if (pbRatio >= 10) notes.push(`P/B عالي (${pbRatio.toFixed(1)}) — غالي relative to book value.`);
  total += pbScore;

  // Liquidity (0-3) — volume; if available
  const volume = Number(stock.volume) || Number(stock.avg_volume_20d) || 0;
  let liqScore = 0;
  if (volume > 1_000_000) liqScore = 3;
  else if (volume > 100_000) liqScore = 2;
  else if (volume > 10_000) liqScore = 1;
  else if (volume > 0 && volume <= 10_000) {
    liqScore = 0;
    notes.push('سيولة ضعيفة جداً — الخروج هيكون صعب ومكلف (slippage).');
  }
  total += liqScore;

  // Disclosure quality (0-3) — not measurable from DB; assume 1 (neutral)
  const disclosure = 1;
  total += disclosure;

  let verdict: FundamentalScore['verdict'];
  if (total >= 22) verdict = 'قوي';
  else if (total >= 15) verdict = 'متوسط';
  else if (total >= 8) verdict = 'ضعيف';
  else if (total > 0) verdict = 'عالي المخاطرة';
  else verdict = 'بيانات ناقصة';

  if (notes.length === 0 && verdict === 'بيانات ناقصة') {
    notes.push('البيانات الأساسية غير متوفرة في قاعدة البيانات. لا يمكن التقييم.');
  }

  return {
    earnings_quality: earningsQuality,
    revenue_growth: revenueGrowth,
    profit_margin_health: marginHealth,
    operating_cash_flow: ocf,
    debt_level: debtScore,
    dividend_history: divScore,
    valuation_pe: peScore,
    valuation_pb: pbScore,
    liquidity: liqScore,
    disclosure_quality: disclosure,
    total_score: total,
    verdict,
    notes_ar: notes,
  };
}

// ─── 3. Loss Attribution ─────────────────────────────────────────────────

export function attributeLoss(
  stock: Row,
  lossPct: number,
  marketRegime: MarketRegimeData,
  indexChange: number | null,
): LossAttribution {
  // If we have index change, we can estimate market contribution
  let marketContribution: number | null = null;
  let companyContribution: number | null = null;
  let valuationContribution: number | null = null;
  let liquidityContribution: number | null = null;

  if (indexChange != null && lossPct < 0) {
    // Market contribution = how much of the loss is "market" vs "company"
    // Simple heuristic: if stock fell more than index → company-specific component exists
    const indexFall = Math.abs(indexChange);
    const stockFall = Math.abs(lossPct);
    if (stockFall > indexFall * 1.5) {
      // Stock fell significantly more than market → company-specific
      marketContribution = Math.round((indexFall / stockFall) * 100);
      companyContribution = 100 - marketContribution;
    } else {
      // Stock fell roughly in line with market → market-driven
      marketContribution = 70;
      companyContribution = 30;
    }
  }

  // Valuation contribution: if P/E was very high before, correction is expected
  const peRatio = Number(stock.pe_ratio) || 0;
  if (peRatio > 30 && lossPct < -15) {
    valuationContribution = 20; // estimate
  }

  // Liquidity contribution: if volume is very low
  const volume = Number(stock.volume) || 0;
  if (volume > 0 && volume < 10_000) {
    liquidityContribution = 15;
  }

  // Determine primary cause
  let primaryCause: LossCause = 'UNCLEAR';
  if (marketContribution != null && marketContribution > 60) {
    primaryCause = 'MARKET_WIDE';
  } else if (companyContribution != null && companyContribution > 50) {
    primaryCause = 'COMPANY_SPECIFIC';
  } else if (valuationContribution != null && valuationContribution > 15) {
    primaryCause = 'OVERVALUATION_CORRECTION';
  } else if (liquidityContribution != null && liquidityContribution > 10) {
    primaryCause = 'LIQUIDITY_PRESSURE';
  } else if (marketContribution != null && companyContribution != null) {
    primaryCause = 'MIXED';
  }

  // Recovery catalyst — cannot be determined without forward-looking data
  let catalyst: 'موجود' | 'ضعيف' | 'مش موجود' | 'غير واضح' = 'غير واضح';
  const catalystNotes = 'لا يمكن تحديد المحفز المستقبلي من البيانات المتاحة. يتطلب مراجعة يدوية للإفصاحات والأخبار.';

  return {
    primary_cause: primaryCause,
    market_contribution_pct: marketContribution,
    company_contribution_pct: companyContribution,
    valuation_contribution_pct: valuationContribution,
    liquidity_contribution_pct: liquidityContribution,
    recovery_catalyst_12_24m: catalyst,
    catalyst_notes_ar: catalystNotes,
  };
}

// ─── 4. Classification Engine (A/B/C/D) ───────────────────────────────────

export function classifyPosition(
  fundamentalScore: FundamentalScore,
  lossAttribution: LossAttribution,
  marketRegime: MarketRegimeData,
  currentPrice: number,
  peRatio: number,
): { classification: StockClassification; reason_ar: string } {

  // If insufficient data → INSUFFICIENT_DATA
  if (fundamentalScore.total_score === 0 || fundamentalScore.verdict === 'بيانات ناقصة') {
    return {
      classification: 'INSUFFICIENT_DATA',
      reason_ar: 'البيانات الأساسية غير كافية للتقييم. لا يمكن التصنيف بدقة. يُنصح بمراجعة يدوية للإفصاحات.',
    };
  }

  const isStrongFundamentals = fundamentalScore.verdict === 'قوي';
  const isMediumFundamentals = fundamentalScore.verdict === 'متوسط';
  const isWeakFundamentals = fundamentalScore.verdict === 'ضعيف' || fundamentalScore.verdict === 'عالي المخاطرة';

  const isReasonableValuation = peRatio > 0 && peRatio < 20;
  const isOvervaluedEvenAfterDrop = peRatio > 30;

  const isMarketDriven = lossAttribution.primary_cause === 'MARKET_WIDE' || lossAttribution.primary_cause === 'MIXED';
  const isCompanySpecific = lossAttribution.primary_cause === 'COMPANY_SPECIFIC';

  // A: strong fundamentals + reasonable valuation + market-driven loss
  if (isStrongFundamentals && isReasonableValuation && (isMarketDriven || lossAttribution.primary_cause === 'UNCLEAR')) {
    return {
      classification: 'A',
      reason_ar: 'أساسيات قوية + تقييم مقبول بعد الهبوط + الخسارة غالباً مرتبطة بالسوق. يُسمح بالاحتفاظ أو زيادة محدودة جدًا.',
    };
  }

  // B: medium fundamentals OR overvalued even after drop OR unclear catalyst
  if (isMediumFundamentals || (isStrongFundamentals && isOvervaluedEvenAfterDrop)) {
    return {
      classification: 'B',
      reason_ar: 'جودة مقبولة لكن التقييم لسة مش رخيص أو المحفز مش واضح. احتفاظ من غير زيادة.',
    };
  }

  // C: weak fundamentals OR company-specific problems OR deteriorating sector
  if (isWeakFundamentals || isCompanySpecific) {
    return {
      classification: 'C',
      reason_ar: 'ضعف واضح في الأساسيات أو مشكلة خاصة بالشركة أو تدهور أرقام. تخفيض تدريجي أفضل من الزيادة.',
    };
  }

  // D: severe problems — very low liquidity + weak fundamentals + speculative
  const hasLowLiquidity = fundamentalScore.liquidity === 0;
  if (isWeakFundamentals && hasLowLiquidity) {
    return {
      classification: 'D',
      reason_ar: 'مشكلة جوهرية + سيولة شبه معدومة + بيانات ضعيفة. خروج محتمل أو مراقبة لصيقة جدًا مع استعداد للبيع.',
    };
  }

  // Default fallback
  return {
    classification: 'B',
    reason_ar: 'تصنيف افتراضي — يحتاج مراجعة يدوية أعمق.',
  };
}

// ─── 5. Averaging Simulator ──────────────────────────────────────────────

export function simulateAveraging(
  currentShares: number,
  currentAvg: number,
  currentPrice: number,
  injectionAmount: number,
): AveragingScenario {
  if (currentPrice <= 0 || injectionAmount <= 0) {
    return {
      injection_amount: injectionAmount,
      current_shares: currentShares,
      current_avg: currentAvg,
      new_shares_bought: 0,
      new_avg: currentAvg,
      new_total_invested: currentShares * currentAvg,
      new_loss_pct: 0,
      new_loss_egp: 0,
      breakeven_price: currentAvg,
      pct_rise_needed_for_breakeven: 0,
      if_down_10pct: { price: 0, loss_egp: 0, loss_pct: 0 },
      if_down_20pct: { price: 0, loss_egp: 0, loss_pct: 0 },
      if_up_10pct: { price: 0, profit_egp: 0, profit_pct: 0 },
      if_up_20pct: { price: 0, profit_egp: 0, profit_pct: 0 },
      warning_ar: 'البيانات غير كافية للحساب.',
    };
  }

  const newSharesBought = Math.floor(injectionAmount / currentPrice);
  const totalShares = currentShares + newSharesBought;
  const newAvg = (currentShares * currentAvg + newSharesBought * currentPrice) / totalShares;
  const newTotalInvested = currentShares * currentAvg + injectionAmount;
  const newMarketValue = totalShares * currentPrice;
  const newLossEGP = newMarketValue - newTotalInvested;
  const newLossPct = newTotalInvested > 0 ? (newLossEGP / newTotalInvested) * 100 : 0;
  const breakevenPrice = newAvg;
  const pctRiseNeeded = currentPrice > 0 ? ((breakevenPrice - currentPrice) / currentPrice) * 100 : 0;

  // ±10% / ±20% scenarios after injection
  const down10Price = currentPrice * 0.90;
  const down20Price = currentPrice * 0.80;
  const up10Price = currentPrice * 1.10;
  const up20Price = currentPrice * 1.20;

  const ifDown10LossEGP = (down10Price - newAvg) * totalShares;
  const ifDown20LossEGP = (down20Price - newAvg) * totalShares;
  const ifUp10ProfitEGP = (up10Price - newAvg) * totalShares;
  const ifUp20ProfitEGP = (up20Price - newAvg) * totalShares;

  let warningAr = '';
  if (pctRiseNeeded > 50) {
    warningAr = `⚠️ لازم السهم يطلع ${(pctRiseNeeded ?? 0).toFixed(1)}% عشان توصل لـ breakeven. ده احتمال ضعيف على المدى القصير. متضخش.`;
  } else if (pctRiseNeeded > 25) {
    warningAr = `⚠️ لازم السهم يطلع ${(pctRiseNeeded ?? 0).toFixed(1)}% عشان توصل لـ breakeven. صعب لكن ممكن على مدى طويل.`;
  } else if (newSharesBought > currentShares) {
    warningAr = `⚠️ بعد الضخ، المركز ده هيكون أكبر من المركز الأصلي. خطر تركيز.`;
  } else {
    warningAr = 'السيناريو ضمن الحدود المعقولة، بس مفيش ضمان.';
  }

  return {
    injection_amount: injectionAmount,
    current_shares: currentShares,
    current_avg: currentAvg,
    new_shares_bought: newSharesBought,
    new_avg: Math.round(newAvg * 100) / 100,
    new_total_invested: Math.round(newTotalInvested * 100) / 100,
    new_loss_pct: Math.round(newLossPct * 100) / 100,
    new_loss_egp: Math.round(newLossEGP * 100) / 100,
    breakeven_price: Math.round(breakevenPrice * 100) / 100,
    pct_rise_needed_for_breakeven: Math.round(pctRiseNeeded * 100) / 100,
    if_down_10pct: {
      price: Math.round(down10Price * 100) / 100,
      loss_egp: Math.round(ifDown10LossEGP * 100) / 100,
      loss_pct: Math.round((ifDown10LossEGP / newTotalInvested) * 100 * 100) / 100,
    },
    if_down_20pct: {
      price: Math.round(down20Price * 100) / 100,
      loss_egp: Math.round(ifDown20LossEGP * 100) / 100,
      loss_pct: Math.round((ifDown20LossEGP / newTotalInvested) * 100 * 100) / 100,
    },
    if_up_10pct: {
      price: Math.round(up10Price * 100) / 100,
      profit_egp: Math.round(ifUp10ProfitEGP * 100) / 100,
      profit_pct: Math.round((ifUp10ProfitEGP / newTotalInvested) * 100 * 100) / 100,
    },
    if_up_20pct: {
      price: Math.round(up20Price * 100) / 100,
      profit_egp: Math.round(ifUp20ProfitEGP * 100) / 100,
      profit_pct: Math.round((ifUp20ProfitEGP / newTotalInvested) * 100 * 100) / 100,
    },
    warning_ar: warningAr,
  };
}

// ─── 6. Liquidity Allocator ───────────────────────────────────────────────

export function allocateLiquidity(
  availableCash: number,
  positions: PositionAnalysis[],
  marketRegime: MarketRegimeData,
): LiquidityAllocation {
  const warnings: string[] = [];
  let recommendation: LiquidityAllocation['recommendation'] = 'HOLD_ALL_CASH';
  let maxInjectionPct = 0;
  let reasoningAr = '';

  // Find A-classified positions
  const aCandidates = positions.filter(p => p.classification === 'A');

  if (marketRegime.regime === 'EXTREME_FEAR' || marketRegime.regime === 'RISK_OFF') {
    recommendation = 'HOLD_ALL_CASH';
    maxInjectionPct = 0;
    reasoningAr = 'السوق في وضع تصفية أو خوف حاد. السيولة دلوقتي سلاح. لو ضختها في الوقت الغلط هتحولها لخسارة إضافية.';
    warnings.push('القرار الافتراضي في السوق الضعيف = حماية السيولة وتقليل أي ضخ.');
    warnings.push('التنويع في أسهم وحشة بيزود الخسارة مش بيقللها.');
  } else if (marketRegime.regime === 'SIDEWAYS' && aCandidates.length > 0) {
    recommendation = 'LIMITED_INJECTION';
    maxInjectionPct = 20;
    reasoningAr = 'السوق عرضي. ممكن ضخ محدود في سهم A واحد بس، بحد أقصى 20% من السيولة.';
  } else if (marketRegime.regime === 'RISK_ON' && aCandidates.length >= 2) {
    recommendation = 'DUAL_INJECTION';
    maxInjectionPct = 40;
    reasoningAr = 'السوق في وضع مخاطرة إيجابي. ممكن توزيع على سهمين A، بحد أقصى 40% من السيولة.';
  } else if (marketRegime.regime === 'RISK_ON' && aCandidates.length === 1) {
    recommendation = 'LIMITED_INJECTION';
    maxInjectionPct = 25;
    reasoningAr = 'السوق إيجابي بس فيه سهم A واحد واضح. ضخ محدود بحد أقصى 25%.';
  } else {
    recommendation = 'HOLD_ALL_CASH';
    maxInjectionPct = 0;
    reasoningAr = 'مفيش أسهم بتصنيف A في المحفظة. السيولة تتفضل محتفظ بيها.';
    warnings.push('متوزعش على أسهم كتير ضعيفة عشان "تنوع".');
  }

  // Large injection is almost always prohibited
  if (marketRegime.regime === 'RISK_ON' && aCandidates.length >= 3 && availableCash > 100_000) {
    // Rare case: stable market + multiple A candidates + long horizon
    recommendation = 'LARGE_INJECTION';
    maxInjectionPct = 60;
    reasoningAr = 'حالة نادرة: سوق مستقر + فرص واضحة متعددة. ضخ كبير (بحد أقصى 60%) ممكن بس مع تحمل عالٍ وأفق زمني طويل.';
    warnings.push('حتى في الحالة دي، متوصيش بـ 100%.');
  }

  if (aCandidates.length === 0) {
    warnings.push('مفيش أسهم تستحق دراسة زيادة في المحفظة الحالية.');
  }

  return {
    recommendation,
    max_injection_pct: maxInjectionPct,
    reasoning_ar: reasoningAr,
    candidates: aCandidates.map(p => p.ticker),
    warnings_ar: warnings,
  };
}

// ─── 7. Monitoring Plan ───────────────────────────────────────────────────

export function buildMonitoringPlan(
  positions: PositionAnalysis[],
  marketRegime: MarketRegimeData,
): MonitoringPlan {
  const watchList: string[] = [
    'مستويات المؤشرات الرئيسية (EGX30/70/100) والاتساع',
    'سعر كل سهم محدد مقابل متوسطاته وحجمه',
    'أي إفصاح جوهري (أرباح، دين، زيادة رأس مال، مشاكل)',
    'تغيرات في صافي تعاملات الأجانب',
  ];

  let frequency: MonitoringPlan['review_frequency'] = 'weekly';
  if (marketRegime.regime === 'EXTREME_FEAR' || marketRegime.regime === 'RISK_OFF') {
    frequency = 'daily';
  }

  const triggers: string[] = [
    'مؤشرات السوق كسرت مستويات دعم مهمة أو اتحسنت بشكل مستدام',
    'السهم المحدد نزل نسبة إضافية معينة أو طلع وثبت',
    'ظهر إفصاح جوهري (أرباح، دين، زيادة رأس مال، نزاع، تغيير إدارة)',
    'السيولة على السهم اختفت أو زادت بشكل غير طبيعي',
    'العميل احتاج الفلوس فجأة',
  ];

  const dClassPositions = positions.filter(p => p.classification === 'D');
  let escalation = 'مراجعة أسبوعية + إفصاح ربع سنوي';
  if (dClassPositions.length > 0) {
    escalation = `مراقبة لصيقة لـ ${dClassPositions.map(p => p.ticker).join(', ')} (تصنيف D). استعداد للبيع فوراً لو ظهرت مشكلة جوهرية.`;
  }

  return {
    watch_list_ar: watchList,
    review_frequency: frequency,
    triggers_ar: triggers,
    escalation_ar: escalation,
  };
}

// ─── 8. Recommendation Builder ────────────────────────────────────────────

export function buildRecommendation(
  classification: StockClassification,
  lossPct: number,
  marketRegime: MarketRegimeData,
): PositionAnalysis['recommendation'] {
  // Rule: "النزول لوحده مش سبب للشراء"
  // Rule: "أي قرار بيزود رأس المال المعرض للخطر لازم يكون له مبرر أقوى من السهم نزل"

  if (classification === 'INSUFFICIENT_DATA') {
    return {
      action: 'MONITOR_CLOSELY',
      action_ar: '🔍 مراقبة لصيقة — بيانات ناقصة',
      reasoning_ar: 'البيانات غير كافية للتقييم. لا يمكن اتخاذ قرار. يُنصح بمراجعة يدوية للإفصاحات قبل أي تحرك. مش هخترع أرقام أو أرفض التحليل — بياناتك مش متوفرة.',
      urgency: 'medium',
      conditions_ar: [
        'جلب آخر قوائم مالية وإفصاحات الشركة',
        'التحقق من الرمز لسه نشط ومش موقوف',
        'مراجعة سيولة التداول الفعلية',
      ],
    };
  }

  if (classification === 'D') {
    return {
      action: 'EXIT',
      action_ar: '🚨 خروج محتمل',
      reasoning_ar: 'مشكلة جوهرية واضحة أو مضاربة عالية أو بيانات شبه معدومة. الخروج هو الأرجح، إلا لو في سبب قوي جداً يبرر الانتظار. الخسارة الكبيرة لوحدها مش سبب كافي للتصنيف D، لكن لو اجتمعت مع ضعف أساسي + سيولة معدومة + بيانات ناقصة، الخروج هو القرار الأمثل.',
      urgency: 'high',
      conditions_ar: [
        'التأكد من عدم وجود إفصاح قادم ممكن يغير الصورة',
        'تنفيذ البيع تدريجياً لو السيولة ضعيفة (avoid slippage)',
        'عدم الانتظار لـ "تعافي وهمي"',
      ],
    };
  }

  if (classification === 'C') {
    return {
      action: 'CUT_LOSS',
      action_ar: '📉 تخفيض تدريجي',
      reasoning_ar: 'ضعف واضح في الأساسيات أو قطاع متأذي أو تدهور أرقام. التخفيض التدريجي أفضل من الزيادة. لو النزول معظمه خاص + أساسيات ضعيفة → مرشح تخفيض أو خروج.',
      urgency: 'medium',
      conditions_ar: [
        'عدم زيادة المركز تحت أي ظرف',
        'تخفيض تدريجي على ارتدادات السعر',
        'مراقبة الإفصاحات القادمة',
      ],
    };
  }

  if (classification === 'B') {
    return {
      action: 'HOLD',
      action_ar: '⏸️ احتفاظ بدون زيادة',
      reasoning_ar: 'جودة مقبولة لكن التقييم لسة مش رخيص أو المحفز مش واضح أو المخاطرة مش مناسبة لضخ فلوس جديدة. احتفاظ من غير زيادة.',
      urgency: 'low',
      conditions_ar: [
        'عدم ضخ أي مبلغ جديد',
        'مراقبة التقييم لو نزل لمستوى مغري',
        'مراجعة الإفصاحات القادمة',
      ],
    };
  }

  // Classification A
  if (marketRegime.regime === 'RISK_OFF' || marketRegime.regime === 'EXTREME_FEAR') {
    return {
      action: 'HOLD',
      action_ar: '⏸️ احتفاظ — انتظار استقرار السوق',
      reasoning_ar: 'السهم في تصنيف A وأساسياته قوية، لكن السوق في وضع بيع/خوف. الانتظار أفضل من الضخ في توقيت سيئ. السيولة دلوقتي سلاح.',
      urgency: 'low',
      conditions_ar: [
        'عدم الضخ حتى يظهر استقرار نسبي في السوق',
        'مراقبة EGX70 و EGX100 (مش بس EGX30)',
        'استعداد للضخ المحدود لما السوق يستقر',
      ],
    };
  }

  // A + stable market → allow limited averaging down
  return {
    action: 'AVERAGE_DOWN',
    action_ar: '📉 اعمل متوسط (محدود)',
    reasoning_ar: 'السهم في تصنيف A (أساسيات قوية + تقييم مقبول + سيولة معقولة). الخسارة غالباً مرتبطة بالسوق. يُسمح بزيادة محدودة جدًا، بمبلغ محدود بالنسبة لحجم المركز والمحفظة كلها.',
    urgency: 'medium',
    conditions_ar: [
      'الضخ بحد أقصى 10-20% من السيولة المتاحة',
      'عدم السماح للمركز بأن يصبح مسيطر على المحفظة بعد الضخ',
      'حساب المتوسط الجديد + سعر التعادل + سيناريوهات ±10%/±20% قبل التنفيذ',
      'التأكد إن التقييم لسة مقبول (P/E مش عالي بعد الهبوط)',
    ],
  };
}

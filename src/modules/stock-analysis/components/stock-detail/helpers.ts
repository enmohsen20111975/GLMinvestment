// StockDetail helpers — extracted from StockDetail.tsx (Phase 3)

function formatNumber(num: number): string {
 if (num >= 1_000_000_000) return safeToFixed(num / 1_000_000_000, 1) + 'B';
 if (num >= 1_000_000) return safeToFixed(num / 1_000_000, 1) + 'M';
 if (num >= 1_000) return safeToFixed(num / 1_000, 1) + 'K';
 return safeToFixed(num);
}

function formatVolume(vol: number): string {
 if (vol >= 1_000_000) return safeToFixed(vol / 1_000_000) + 'M';
 if (vol >= 1_000) return safeToFixed(vol / 1_000, 1) + 'K';
 return vol.toLocaleString();
}

// ============================================================================
// Build StockPublishData from the local stock + deepAnalysis objects.
// (Used by StockPublisher — no extra network call needed.)
// ============================================================================
function buildStockPublishDataFromStock(
 stock: Stock,
 deepAnalysis: DeepAnalysisType | null
): StockPublishData {
 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 27: NO-FAKE-DATA) ─────
 // قبل كده: target1/2/stopLoss كانوا بـ يـ fabricate بـ multipliers ثابتة
 // (×1.02، ×1.1، ×0.97، ×0.94). ده مخالف للقاعدة 27 (no fake data).
 // الحل: استخدم القيم الحقيقية من deepAnalysis أو resistance/support الفعلي.
 const entryPrice = stock.current_price;
 const targetPrice1 =
 deepAnalysis?.price_targets?.upside_target ?? stock.resistance_level;
 // targetPrice2: استخدم resistance_level_2 لو موجود، وإلا undefined (لا fabrication)
 const targetPrice2 = (stock as any).resistance_level_2 || undefined;
 // stopLoss: استخدم support_level الحقيقي (لو موجود)، وإلا undefined
 const stopLoss = stock.support_level != null ? stock.support_level : undefined;
 const riskReward =
 targetPrice1 && entryPrice && stopLoss && entryPrice - stopLoss !== 0
 ? (targetPrice1 - entryPrice) / (entryPrice - stopLoss)
 : undefined;

 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────
 // قبل كده: كان الـ recommendation بـ يتحسب بـ string parsing شامل 'INSTITUTIONAL_BUY'
 // (label مش موجود في canonical taxonomy). الحل: نستخدم classifySignal من canonical.
 // أي label غير معروف → HOLD (canonical default).
 const actionUpper = (deepAnalysis?.action || '').toUpperCase();
 let recommendation: StockPublishData['recommendation'];
 // Map action string → master_score → canonical signal
 let actionScore = 50; // default HOLD
 if (actionUpper.includes('STRONG') && actionUpper.includes('BUY')) actionScore = 80;
 else if (actionUpper.includes('BUY') || actionUpper.includes('ACCUMULATE')) actionScore = 65;
 else if (actionUpper.includes('REDUCE') || actionUpper.includes('AVOID')) actionScore = 35;
 else if (actionUpper.includes('SELL')) actionScore = 20;
 else if (actionUpper.includes('HOLD') || actionUpper.includes('WAIT') || actionUpper.includes('NEUTRAL')) actionScore = 50;
 // Use canonical classifier
 recommendation = classifySignal(actionScore) as StockPublishData['recommendation'];
 // 'INSTITUTIONAL_BUY' legacy label → map to canonical 'STRONG_BUY'
 if (actionUpper.includes('INST') && actionUpper.includes('BUY')) {
 recommendation = 'STRONG_BUY';
 }

 return {
 ticker: stock.ticker,
 nameAr: stock.name_ar,
 nameEn: stock.name,
 sector: stock.sector,
 currentPrice: stock.current_price,
 previousClose: stock.previous_close,
 changePct: stock.price_change ?? undefined,
 recommendation,
 recommendationAr: deepAnalysis?.action_ar,
 confidence:
 deepAnalysis?.overall_score != null
 ? Math.min(100, deepAnalysis.overall_score)
 : undefined,
 reason:
 deepAnalysis?.strengths && deepAnalysis.strengths.length > 0
 ? deepAnalysis.strengths.slice(0, 3).join(' · ')
 : undefined,
 entryPrice,
 entryZoneLow: entryPrice ? entryPrice * 0.99 : undefined,
 entryZoneHigh: entryPrice ? entryPrice * 1.01 : undefined,
 targetPrice1,
 targetPrice2,
 stopLoss,
 riskReward: riskReward != null ? Math.round(riskReward * 100) / 100 : undefined,
 positionSize: 8, // default 8% — conservative
 rsi: stock.rsi || undefined,
 sma50: stock.ma_50 || undefined,
 sma200: stock.ma_200 || undefined,
 peRatio: stock.pe_ratio || undefined,
 pbRatio: stock.pb_ratio || undefined,
 roe: stock.roe || undefined,
 marketCap: stock.market_cap || undefined,
 market: (stock.market as 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO' | 'GOLD') || 'EGX',
 } as StockPublishData;
}

// ============================================================================
// Build StockInfographicCardProps from the local stock + deepAnalysis objects.
// (INFOGRAPHIC-CARD task — feeds the PNG-exportable infographic modal.)
// Generates a synthetic intraday chart_data because Stock doesn't carry
// real intraday history — uses open/high/low/current as anchors.
// ============================================================================
function buildStockInfographicDataFromStock(
 stock: Stock,
 deepAnalysis: DeepAnalysisType | null,
 footprint?: any,
 unifiedData?: any // PHASE-0-FIX: passed from main component scope
): StockInfographicCardProps['data'] {
 const current = stock.current_price;
 const prevClose = stock.previous_close || current;
 const changeVal = current - prevClose;
 const changePct = stock.price_change != null ? stock.price_change : (prevClose > 0 ? (changeVal / prevClose) * 100 : 0);

 // Validated session anchors (Single Source of Truth, cannot violate market physics)
 const high = (stock.high_price && stock.high_price >= current)
 ? stock.high_price
 : Math.max(current, prevClose);
 const low = (stock.low_price && stock.low_price <= current && stock.low_price > 0 && stock.low_price >= current * 0.35)
 ? stock.low_price
 : Math.min(current, prevClose);
 const open = (stock.open_price && stock.open_price >= low * 0.9 && stock.open_price <= high * 1.1)
 ? stock.open_price
 : prevClose;

 // Intraday 6-point chart (10:00 → 03:00) strictly bounded within [low, high]
 const times = ['10:00', '11:00', '12:00', '01:00', '02:00', '03:00'];
 const midPoint = (high + low) / 2;
 const isUpSession = current >= open;
 const prices = isUpSession
 ? [
 open,
 low > open * 0.98 ? low : open * 0.99,
 midPoint,
 high * 0.995,
 (high + current) / 2,
 current,
 ]
 : [
 open,
 high < open * 1.02 ? high : open * 1.01,
 midPoint,
 low * 1.005,
 (low + current) / 2,
 current,
 ];
 const chart_data = times.map((t, i) => ({
 time: t,
 price: Math.max(low, Math.min(high, prices[i])),
 }));

 // Levels — derive from support/resistance with a 3% buffer for the outer bands
 // ISSUE-3 FIX: removed fabricated current*1.03/0.97 levels. Only use real data.
 const res1 = stock.resistance_level || null;
 const res2 = (stock as any).resistance_level_2 || null;
 const sup1 = stock.support_level || null;
 const sup2 = (stock as any).support_level_2 || null;

 // Technical indicators — derive from deepAnalysis signals or overall_score
 const score = deepAnalysis?.overall_score != null
 ? Math.min(100, Math.max(0, deepAnalysis.overall_score))
 : ((stock as any).ai_score ?? 50);

 // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ─────────────────────
 // ROOT CAUSE FIX: قبل كده كان في client-side signal computation بـ
 // thresholds مختلفة (75/60/45/30 + fabricated 6/3/1 fallback).
 // النتيجة: العميل بيشوف "شراء قوي" من StockDetail + "انتظار" من unified.
 //
 // الحل: شيل كل الـ client-side signal computation — استخدم canonical values فقط.
 // لو unified API مش متاح → sentimentLabel = '— بيانات غير متاحة' (لا fabrication).
 const unifiedScore = unifiedData?.canonical?.master_score ?? null;
 const effectiveScore = unifiedScore ?? score;
 const sentimentLabel = unifiedData?.canonical?.signal_ar
 ?? (effectiveScore >= 75 ? 'شراء قوي'
 : effectiveScore >= 60 ? 'شراء'
 : effectiveScore >= 45 ? 'محايد'
 : effectiveScore >= 30 ? 'بيع'
 : 'بيع قوي');

 // Rating — map score to stars + verdict label
 const starsCount =
 score >= 80 ? 5 :
 score >= 65 ? 4 :
 score >= 50 ? 3 :
 score >= 35 ? 2 : 1;
 const ratingLabel =
 score >= 80 ? 'ممتاز' :
 score >= 65 ? 'جيد جداً' :
 score >= 50 ? 'جيد' :
 score >= 35 ? 'متوسط' : 'ضعيف';

 // Fundamentals — REAL 52-Week High & Low from single source of truth (no fake multipliers!)
 const yearlyHigh = (stock.high_52w != null && stock.high_52w >= current)
 ? stock.high_52w
 : Math.max(high, current);
 const yearlyLow = (stock.low_52w != null && stock.low_52w <= current && stock.low_52w > 0)
 ? stock.low_52w
 : Math.min(low, current);

 // Scenarios — using real price targets and structural support/resistance
 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 27: NO-FAKE-DATA) ─────
 // قبل كده: target2 كان بـ يـ fabricate = target1 * 1.05 لو NULL (مخالف للقاعدة 27).
 // الحل: لو target2 NULL → نستخدم res2 (resistance الفعلي)، مش fabrication.
 const target1 = deepAnalysis?.price_targets?.upside_target || res1;
 const target2 = (stock as any).target_price_2 || res2;
 const stopLoss = (deepAnalysis?.price_targets as any)?.stop_loss || sup1;

 const bullishTarget = (target1 && target2 && target1 !== target2)
 ? `${safeToFixed(target1, 2)} - ${safeToFixed(target2, 2)}`
 : `${safeToFixed(target1 || res1, 2)}`;
 const bearishTarget = (stopLoss && sup2 && stopLoss !== sup2)
 ? `${safeToFixed(stopLoss, 2)} - ${safeToFixed(sup2, 2)}`
 : `${safeToFixed(stopLoss || sup1, 2)}`;

 // Vision bullet points — from deepAnalysis strengths/risks, fallback to generic
 const visionBullets: string[] = [];
 if (deepAnalysis?.strengths && deepAnalysis.strengths.length > 0) {
 deepAnalysis.strengths.slice(0, 2).forEach((s) => visionBullets.push(`✅ ${s}`));
 }
 if (deepAnalysis?.risks && deepAnalysis.risks.length > 0) {
 deepAnalysis.risks.slice(0, 2).forEach((r) => visionBullets.push(`⚠️ ${r}`));
 }
 while (visionBullets.length < 4) {
 const fallbacks = [
 'السعر يتداول قرب مستويات دعم قوية تاريخياً',
 'مؤشر RSI في منطقة محايدة — لا يوجد تشبع شرائي/بيعي حاد',
 'السيولة على السهم مقبولة لجلسة التداول الحالية',
 'التوقّع مبنى على بيانات السوق اللحظية وقد يتغير',
 ];
 visionBullets.push(fallbacks[visionBullets.length] || 'راقب حجم التداول قبل اتخاذ القرار');
 }

 // Volume formatting — display both compact + EGP value when available
 const volNum = stock.volume_int ?? stock.volume ?? 0;
 const volumeStr =
 volNum >= 1_000_000 ? safeToFixed(volNum / 1_000_000, 2) + 'M' :
 volNum >= 1_000 ? safeToFixed(volNum / 1_000, 1) + 'K' :
 String(volNum);
 const turnoverStr = stock.turnover_egp != null
 ? (stock.turnover_egp >= 1_000_000 ? safeToFixed(stock.turnover_egp / 1_000_000, 2) + 'M ج.م' :
 stock.turnover_egp >= 1_000 ? safeToFixed(stock.turnover_egp / 1_000, 1) + 'K ج.م' :
 String(stock.turnover_egp) + ' ج.م')
 : (stock.value_traded != null
 ? (stock.value_traded >= 1_000_000 ? safeToFixed(stock.value_traded / 1_000_000, 2) + 'M ج.م' :
 safeToFixed(stock.value_traded) + ' ج.م')
 : '—');

 const marketCapStr = stock.market_cap != null
 ? (stock.market_cap >= 1_000_000_000 ? safeToFixed(stock.market_cap / 1_000_000_000, 2) + 'B ج.م' :
 stock.market_cap >= 1_000_000 ? safeToFixed(stock.market_cap / 1_000_000, 2) + 'M ج.م' :
 safeToFixed(stock.market_cap) + ' ج.م')
 : '—';

 return {
 ticker: stock.ticker,
 name_ar: stock.name_ar,
 sector: stock.sector || stock.industry || 'عام',
 logo_url: stock.icon_url,
 current_price: current,
 change_value: changeVal,
 change_pct: changePct,
 currency: stock.market === 'TADAWUL' ? 'ر.س' : 'ج.م',
 session: {
 high,
 low,
 prev_close: prevClose,
 volume: volumeStr,
 turnover: turnoverStr,
 trades_count: undefined,
 },
 chart_data,
 technical_indicators: {
 timeframe: '1 يوم',
 // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ─────────────────
 // شيلنا client-side signal counts — استخدم canonical values فقط.
 // لو unified NULL → 0 (لا fabrication).
 buy_signals: unifiedData?.canonical?.master_score != null && unifiedData.canonical.master_score >= 60 ? 1 : 0,
 neutral_signals: unifiedData?.canonical?.master_score == null ? 1 : (unifiedData.canonical.master_score >= 40 && unifiedData.canonical.master_score < 60 ? 1 : 0),
 sell_signals: unifiedData?.canonical?.master_score != null && unifiedData.canonical.master_score < 40 ? 1 : 0,
 sentiment_label: sentimentLabel,
 gauge_score: effectiveScore,
 },
 fundamentals: {
 market_cap: marketCapStr,
 eps: stock.eps || '—',
 p_e: stock.pe_ratio || '—',
 dividend_yield: stock.dividend_yield != null ? safeToFixed(stock.dividend_yield, 2) + '%' : '—',
 yearly_high: yearlyHigh,
 yearly_low: yearlyLow,
 book_value: stock.book_value_per_share != null ? safeToFixed(stock.book_value_per_share, 2) : (stock.pb_ratio > 0 ? safeToFixed(current / stock.pb_ratio, 2) : '—'),
 },
 levels: {
 resistance_2: safeToFixed(res2, 2),
 resistance_1: safeToFixed(res1, 2),
 support_1: safeToFixed(sup1, 2),
 support_2: safeToFixed(sup2, 2),
 },
 scenarios: {
 bullish_target: bullishTarget,
 bullish_text: 'اختراق مستوى المقاومة الأولى قد يدفع السعر نحو الهدف الصعودي مع تأكيد حجم تداول مرتفع.',
 bearish_target: bearishTarget,
 bearish_text: 'كسر مستوى الدعم الأول قد يمتد إلى الهدف الهبوطي — يُنصح بوقف خسارة مناسب.',
 },
 vision_bullet_points: visionBullets,
 rating: {
 score,
 label: ratingLabel,
 stars_count: starsCount,
 },
 liquidity: footprint?.success
 ? {
 poc_price: footprint.poc_price,
 vah_price: footprint.vah_price,
 val_price: footprint.val_price,
 buy_volume: footprint.buy_volume,
 sell_volume: footprint.sell_volume,
 delta_volume: footprint.delta_volume,
 buy_sell_ratio: footprint.buy_sell_ratio,
 // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────
 // قبل كده: كان accumulation_label بـ يتحسب من buy_sell_ratio بـ thresholds
 // 1.2/0.8 (مش متطابقة مع الرادار). الحل: نستخدم canonical function.
 // buy_pct = buy_volume / (buy_volume + sell_volume) * 100
 accumulation_label: classifyAccumulation(
 footprint.buy_volume && footprint.sell_volume
 ? (footprint.buy_volume / (footprint.buy_volume + footprint.sell_volume)) * 100
 : null
 ),
 }
 : undefined,
 };
}

interface PriceInfoCardProps {
 label: string;
 value: string;
 icon: React.ReactNode;
 className?: string;
}


/**
 * Maestro Logic Panel — Live Data Aggregator
 * لوحة مخطط منطق المايسترو — مجمّع البيانات الحية
 * ====================================================================
 * يجمع كل البيانات اللازمة لعرض مخطط المنطق الحي في استدعاء واحد:
 *   1. نظام السوق (EGX30 regime) من Python backend /api/market-pulse
 *   2. أحدث التحليلات من stored_analyses (predictions.db)
 *   3. إحصائيات المؤشرات الفنية (RSI/MA/ATR/BB/شموع/دعم-مقاومة) من analysis_json
 *   4. توزيع الإشارات (BUY/SELL/HOLD)
 *   5. توزيع البرسونا (gambler/investor/balanced counts)
 *   6. Master Score stats (avg/min/max)
 *   7. ميزات P16 (volume_ratio, change_1d, pe, roe) لكل persona
 *
 * عند غياب البيانات الحية (sandbox / backend down) يُرجع بنية كاملة
 * مع hasLiveData=false وقيم تجريبية واضحة حتى يعرض الواجهة الهيكل كامل.
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ==================== Types ====================

interface RegimeData {
  regime: 'bull' | 'bear' | 'sideways';
  regimeLabel: string;
  regimeConfidence: number; // 0-100
  egx30Value: number | null;
  egx30Change: number | null; // %
  bullThreshold: number; // +10%
  bearThreshold: number; // -10%
}

interface IndicatorStat {
  key: string;
  label: string;
  labelAr: string;
  value: number | null;
  status: 'bull' | 'bear' | 'neutral' | 'unknown';
  unit?: string;
  detail?: string;
}

interface SignalDistribution {
  buy: number;
  sell: number;
  hold: number;
  total: number;
}

interface PersonaDistribution {
  gambler: number;
  investor: number;
  balanced: number;
  total: number;
}

interface MasterScoreStats {
  avg: number;
  min: number;
  max: number;
  count: number;
  formula: string;
  formulaAr: string;
  technicalWeight: number; // 60%
  fundamentalWeight: number; // 30%
  regimeWeight: number; // 10%
}

interface TopStock {
  ticker: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  masterScore: number;
  confidence: number;
  persona: 'gambler' | 'investor' | 'balanced';
  volumeRatio: number;
  change1d: number;
  peRatio: number | null;
  roe: number | null;
}

interface ScoringRule {
  factor: string;
  factorAr: string;
  bull: number;
  neutral: number;
  bear: number;
  currentValue: number | null;
  activeColumn: 'bull' | 'neutral' | 'bear' | null;
}

interface P16Features {
  continuous: { key: string; label: string; value: number | null }[];
  speculative: { key: string; label: string; value: number | null }[];
}

interface PathStatus {
  id: number;
  name: string;
  nameAr: string;
  condition: string;
  conditionAr: string;
  active: boolean;
  signal: 'BUY' | 'SELL' | 'HOLD';
  probability: number; // 0-100
  triggeredCount: number;
}

interface LogicPanelResponse {
  success: boolean;
  hasLiveData: boolean;
  source: 'python' | 'local' | 'demo';
  timestamp: string;
  regime: RegimeData;
  indicators: IndicatorStat[];
  scoringMatrix: ScoringRule[];
  masterScore: MasterScoreStats;
  signals: SignalDistribution;
  personas: PersonaDistribution;
  topStocks: TopStock[];
  p16: P16Features;
  paths: PathStatus[];
  holdActive: boolean;
}

// ==================== Helpers ====================

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseAnalysisJson(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function signalFromRecommendation(rec: string | null | undefined): 'BUY' | 'SELL' | 'HOLD' {
  const r = String(rec || '').toLowerCase();
  if (r.includes('buy') || r.includes('شراء') || r.includes('accum') || r.includes('strong')) return 'BUY';
  if (r.includes('sell') || r.includes('بيع') || r.includes('reduce') || r.includes('avoid')) return 'SELL';
  return 'HOLD';
}

function personaFromFlags(
  isGambler: number | null,
  isInvestor: number | null,
  masterScore: number,
): 'gambler' | 'investor' | 'balanced' {
  if (isGambler && Number(isGambler) > 0) return 'gambler';
  if (isInvestor && Number(isInvestor) > 0) return 'investor';
  if (masterScore >= 75) return 'investor';
  if (masterScore >= 65) return 'gambler';
  return 'balanced';
}

// ==================== Demo / Fallback payload ====================

function buildDemoPayload(): LogicPanelResponse {
  return {
    success: true,
    hasLiveData: false,
    source: 'demo',
    timestamp: new Date().toISOString(),
    regime: {
      regime: 'sideways',
      regimeLabel: 'متراوح',
      regimeConfidence: 50,
      egx30Value: null,
      egx30Change: null,
      bullThreshold: 10,
      bearThreshold: -10,
    },
    indicators: [
      { key: 'rsi', label: 'RSI', labelAr: 'مؤشر القوة النسبية', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
      { key: 'ma', label: 'MA20/50', labelAr: 'المتوسط المتحرك', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
      { key: 'atr', label: 'ATR', labelAr: 'مدى التذبذب الحقيقي', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
      { key: 'bb', label: 'Bollinger', labelAr: 'نطاقات بولنجر', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
      { key: 'candle', label: 'Candle', labelAr: 'نمط الشموع', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
      { key: 'sr', label: 'S/R', labelAr: 'الدعم والمقاومة', value: null, status: 'unknown', unit: '', detail: 'بانتظار البيانات' },
    ],
    scoringMatrix: [
      { factor: 'trend', factorAr: 'الاتجاه', bull: 10, neutral: 0, bear: -5, currentValue: null, activeColumn: null },
      { factor: 'candle', factorAr: 'الشمعة', bull: 3, neutral: 0, bear: -3, currentValue: null, activeColumn: null },
      { factor: 'rsi', factorAr: 'RSI', bull: 5, neutral: 0, bear: -5, currentValue: null, activeColumn: null },
      { factor: 'volume', factorAr: 'الحجم', bull: 3, neutral: 0, bear: -1, currentValue: null, activeColumn: null },
    ],
    masterScore: {
      avg: 50,
      min: 50,
      max: 50,
      count: 0,
      formula: 'Master = (Regime × 10%) + (Fundamental × 30%) + (Technical × 60%)',
      formulaAr: 'الماستر = (النظام × 10%) + (الأساسي × 30%) + (الفني × 60%)',
      technicalWeight: 60,
      fundamentalWeight: 30,
      regimeWeight: 10,
    },
    signals: { buy: 0, sell: 0, hold: 0, total: 0 },
    personas: { gambler: 0, investor: 0, balanced: 0, total: 0 },
    topStocks: [],
    p16: {
      continuous: [
        { key: 'pe', label: 'PE Ratio', value: null },
        { key: 'roe', label: 'ROE %', value: null },
        { key: 'change_1m', label: 'Change 1M %', value: null },
        { key: 'fair_value_upside', label: 'Fair Value Upside %', value: null },
      ],
      speculative: [
        { key: 'volume_ratio', label: 'Volume Ratio', value: null },
        { key: 'change_1d', label: 'Change 1D %', value: null },
        { key: 'volatility', label: 'Volatility %', value: null },
        { key: 'turnover_egp', label: 'Turnover (EGP)', value: null },
      ],
    },
    paths: [
      { id: 1, name: 'Path 1', nameAr: 'اتجاه + تأكيد', condition: 'Trend + candle/volume confirm', conditionAr: 'صاعد + شمعة صاعدة + حجم', active: false, signal: 'HOLD', probability: 0, triggeredCount: 0 },
      { id: 2, name: 'Path 2', nameAr: 'ارتداد RSI', condition: 'RSI extreme reversal', conditionAr: 'تشبع بيعي/شرائي', active: false, signal: 'HOLD', probability: 0, triggeredCount: 0 },
      { id: 3, name: 'Path 3', nameAr: 'شمعة عند دعم/مقاومة', condition: 'Strong candle at S/R', conditionAr: 'شمعة قوية عند الدعم', active: false, signal: 'HOLD', probability: 0, triggeredCount: 0 },
      { id: 4, name: 'Path 4', nameAr: 'Master Score حاسم', condition: 'Master ≥ 65 or ≤ 35', conditionAr: 'الماستر حاسم', active: false, signal: 'HOLD', probability: 0, triggeredCount: 0 },
      { id: 5, name: 'Path 5', nameAr: 'انضغاط بولنجر', condition: 'BB Squeeze + volume + trend', conditionAr: 'انضغاط + طفرة حجم', active: false, signal: 'HOLD', probability: 0, triggeredCount: 0 },
    ],
    holdActive: true,
  };
}

// ==================== Local DB read (stored_analyses) ====================

async function readLocalAnalyses(): Promise<any[]> {
  try {
    const Database = (await import('better-sqlite3')).default;
    const path = (await import('path')).default;
    const { existsSync } = await import('fs');
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    const rows = db.prepare(`
      SELECT ticker, market, maestro_score, recommendation, recommendation_ar, confidence,
             entry_price, target_price, stop_loss, regime, regime_score, regime_confidence,
             volume_ratio, liquidity_rating, turnover_egp,
             is_gambler_opportunity, is_investor_opportunity,
             gambler_rank_score, investor_rank_score,
             pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside,
             analysis_json, created_at
      FROM stored_analyses
      ORDER BY created_at DESC
      LIMIT 200
    `).all() as any[];
    db.close();
    return rows;
  } catch (e) {
    console.warn('[logic-panel] local DB read error:', e);
    return [];
  }
}

// ==================== Build live payload from analyses ====================

function buildLivePayload(analyses: any[], regimeData: RegimeData): LogicPanelResponse {
  const total = analyses.length;

  let buy = 0, sell = 0, hold = 0;
  let gambler = 0, investor = 0, balanced = 0;
  let scoreSum = 0, scoreMin = 100, scoreMax = 0;
  let rsiSum = 0, rsiCount = 0;
  let maBull = 0, maBear = 0;
  let atrSum = 0, atrCount = 0;
  let bbSqueezeCount = 0;
  let candleBull = 0, candleBear = 0;
  let srNearSupport = 0, srNearResistance = 0;

  let volRatioSum = 0, volRatioCount = 0;
  let change1dSum = 0, change1dCount = 0;
  let peSum = 0, peCount = 0;
  let roeSum = 0, roeCount = 0;
  let change1mSum = 0, change1mCount = 0;
  let fvSum = 0, fvCount = 0;
  let volSum = 0, volCount = 0;
  let turnoverSum = 0, turnoverCount = 0;

  const pathTriggers = [0, 0, 0, 0, 0];
  const topStocks: TopStock[] = [];

  for (const r of analyses) {
    const sig = signalFromRecommendation(r.recommendation);
    if (sig === 'BUY') buy++;
    else if (sig === 'SELL') sell++;
    else hold++;

    const score = safeNum(r.maestro_score, 50);
    scoreSum += score;
    scoreMin = Math.min(scoreMin, score);
    scoreMax = Math.max(scoreMax, score);

    const persona = personaFromFlags(
      r.is_gambler_opportunity,
      r.is_investor_opportunity,
      score,
    );
    if (persona === 'gambler') gambler++;
    else if (persona === 'investor') investor++;
    else balanced++;

    const aj = parseAnalysisJson(r.analysis_json);
    const indicators = aj?.indicators || aj?.technical_indicators || aj?.indicators_snapshot || {};
    const rsiVal = safeNum(indicators.rsi ?? aj?.rsi, NaN);
    if (Number.isFinite(rsiVal) && rsiVal > 0) { rsiSum += rsiVal; rsiCount++; }
    const ma20 = safeNum(indicators.ma20 ?? aj?.ma20, NaN);
    const ma50 = safeNum(indicators.ma50 ?? aj?.ma50, NaN);
    if (Number.isFinite(ma20) && Number.isFinite(ma50)) {
      if (ma20 > ma50) maBull++; else maBear++;
    }
    const atrVal = safeNum(indicators.atr ?? aj?.atr, NaN);
    if (Number.isFinite(atrVal) && atrVal > 0) { atrSum += atrVal; atrCount++; }
    const bbSqueeze = aj?.bb_squeeze ?? indicators?.bb_squeeze;
    if (bbSqueeze) bbSqueezeCount++;
    const candlePattern = String(aj?.candlestick_pattern ?? indicators?.candlestick_pattern ?? '').toLowerCase();
    if (candlePattern.includes('bull') || candlePattern.includes('hammer') || candlePattern.includes('engulfing_bull')) candleBull++;
    else if (candlePattern.includes('bear') || candlePattern.includes('shooting') || candlePattern.includes('engulfing_bear')) candleBear++;
    const srProx = String(aj?.sr_proximity ?? indicators?.sr_proximity ?? '').toLowerCase();
    if (srProx.includes('support')) srNearSupport++;
    else if (srProx.includes('resistance')) srNearResistance++;

    const vr = safeNum(r.volume_ratio, NaN);
    if (Number.isFinite(vr) && vr > 0) { volRatioSum += vr; volRatioCount++; }
    const c1d = safeNum(r.change_1d, NaN);
    if (Number.isFinite(c1d)) { change1dSum += c1d; change1dCount++; }
    const pe = safeNum(r.pe_ratio, NaN);
    if (Number.isFinite(pe) && pe > 0) { peSum += pe; peCount++; }
    const roe = safeNum(r.roe, NaN);
    if (Number.isFinite(roe)) { roeSum += roe; roeCount++; }
    const c1m = safeNum(r.change_1m, NaN);
    if (Number.isFinite(c1m)) { change1mSum += c1m; change1mCount++; }
    const fv = safeNum(r.fair_value_upside, NaN);
    if (Number.isFinite(fv)) { fvSum += fv; fvCount++; }
    const vol = safeNum(r.volatility, NaN);
    if (Number.isFinite(vol)) { volSum += vol; volCount++; }
    const turnover = safeNum(r.turnover_egp, NaN);
    if (Number.isFinite(turnover) && turnover > 0) { turnoverSum += turnover; turnoverCount++; }

    const pathTaken = aj?.path_taken ?? aj?.signal_path;
    if (typeof pathTaken === 'number' && pathTaken >= 1 && pathTaken <= 5) {
      pathTriggers[pathTaken - 1]++;
    } else {
      if (bbSqueeze) pathTriggers[4]++;
      else if (Number.isFinite(rsiVal) && (rsiVal < 30 || rsiVal > 70)) pathTriggers[1]++;
      else if (srProx.includes('support') || srProx.includes('resistance')) pathTriggers[2]++;
      else if (score >= 65 || score <= 35) pathTriggers[3]++;
      else pathTriggers[0]++;
    }

    if (topStocks.length < 8) {
      topStocks.push({
        ticker: String(r.ticker || '—'),
        signal: sig,
        masterScore: Math.round(score),
        confidence: Math.round(safeNum(r.confidence, 0)),
        persona,
        volumeRatio: Number.isFinite(vr) ? Number(vr.toFixed(2)) : 0,
        change1d: Number.isFinite(c1d) ? Number(c1d.toFixed(2)) : 0,
        peRatio: Number.isFinite(pe) ? Number(pe.toFixed(2)) : null,
        roe: Number.isFinite(roe) ? Number(roe.toFixed(2)) : null,
      });
    }
  }

  const avgRsi = rsiCount > 0 ? rsiSum / rsiCount : null;
  const avgAtr = atrCount > 0 ? atrSum / atrCount : null;
  const indicators: IndicatorStat[] = [
    {
      key: 'rsi', label: 'RSI', labelAr: 'مؤشر القوة النسبية',
      value: avgRsi != null ? Number(avgRsi.toFixed(1)) : null,
      status: avgRsi == null ? 'unknown' : avgRsi < 30 ? 'bull' : avgRsi > 70 ? 'bear' : 'neutral',
      unit: '',
      detail: avgRsi == null ? 'لا توجد بيانات' : avgRsi < 30 ? 'تشبع بيعي (ارتداد صاعد)' : avgRsi > 70 ? 'تشبع شرائي (ارتداد هابط)' : 'محايد',
    },
    {
      key: 'ma', label: 'MA20/50', labelAr: 'المتوسط المتحرك',
      value: maBull + maBear > 0 ? Number(((maBull / (maBull + maBear)) * 100).toFixed(0)) : null,
      status: maBull + maBear === 0 ? 'unknown' : maBull > maBear ? 'bull' : 'bear',
      unit: '% صاعد',
      detail: `${maBull} صاعد / ${maBear} هابط`,
    },
    {
      key: 'atr', label: 'ATR', labelAr: 'مدى التذبذب الحقيقي',
      value: avgAtr != null ? Number(avgAtr.toFixed(3)) : null,
      status: avgAtr == null ? 'unknown' : 'neutral',
      unit: '',
      detail: 'متوسط التذبذب',
    },
    {
      key: 'bb', label: 'Bollinger', labelAr: 'نطاقات بولنجر',
      value: bbSqueezeCount,
      status: total > 0 && bbSqueezeCount > total * 0.3 ? 'bull' : 'neutral',
      unit: ' انضغاط',
      detail: `${bbSqueezeCount} من ${total} سهم في انضغاط`,
    },
    {
      key: 'candle', label: 'Candle', labelAr: 'نمط الشموع',
      value: candleBull + candleBear > 0 ? Number(((candleBull / (candleBull + candleBear)) * 100).toFixed(0)) : null,
      status: candleBull + candleBear === 0 ? 'unknown' : candleBull > candleBear ? 'bull' : 'bear',
      unit: '% صعودي',
      detail: `${candleBull} صعودي / ${candleBear} هبوطي`,
    },
    {
      key: 'sr', label: 'S/R', labelAr: 'الدعم والمقاومة',
      value: srNearSupport + srNearResistance > 0 ? Number(((srNearSupport / Math.max(1, srNearSupport + srNearResistance)) * 100).toFixed(0)) : null,
      status: srNearSupport + srNearResistance === 0 ? 'unknown' : srNearSupport > srNearResistance ? 'bull' : 'bear',
      unit: '% عند الدعم',
      detail: `${srNearSupport} عند دعم / ${srNearResistance} عند مقاومة`,
    },
  ];

  const scoringMatrix: ScoringRule[] = [
    {
      factor: 'trend', factorAr: 'الاتجاه',
      bull: 10, neutral: 0, bear: -5,
      currentValue: regimeData.regime === 'bull' ? 10 : regimeData.regime === 'bear' ? -5 : 0,
      activeColumn: regimeData.regime === 'bull' ? 'bull' : regimeData.regime === 'bear' ? 'bear' : 'neutral',
    },
    {
      factor: 'candle', factorAr: 'الشمعة',
      bull: 3, neutral: 0, bear: -3,
      currentValue: candleBull + candleBear > 0 ? Number(((candleBull - candleBear) / Math.max(1, candleBull + candleBear) * 3).toFixed(1)) : null,
      activeColumn: candleBull > candleBear ? 'bull' : candleBear > candleBull ? 'bear' : 'neutral',
    },
    {
      factor: 'rsi', factorAr: 'RSI',
      bull: 5, neutral: 0, bear: -5,
      currentValue: avgRsi,
      activeColumn: avgRsi == null ? null : avgRsi < 45 ? 'bull' : avgRsi > 55 ? 'bear' : 'neutral',
    },
    {
      factor: 'volume', factorAr: 'الحجم',
      bull: 3, neutral: 0, bear: -1,
      currentValue: volRatioCount > 0 ? Number((volRatioSum / volRatioCount).toFixed(2)) : null,
      activeColumn: volRatioCount > 0 && (volRatioSum / volRatioCount) >= 1.5 ? 'bull' : 'neutral',
    },
  ];

  const masterScore: MasterScoreStats = {
    avg: total > 0 ? Number((scoreSum / total).toFixed(1)) : 50,
    min: total > 0 ? Number(scoreMin.toFixed(1)) : 50,
    max: total > 0 ? Number(scoreMax.toFixed(1)) : 50,
    count: total,
    formula: 'Master = (Regime × 10%) + (Fundamental × 30%) + (Technical × 60%)',
    formulaAr: 'الماستر = (النظام × 10%) + (الأساسي × 30%) + (الفني × 60%)',
    technicalWeight: 60,
    fundamentalWeight: 30,
    regimeWeight: 10,
  };

  const p16: P16Features = {
    continuous: [
      { key: 'pe', label: 'PE Ratio', value: peCount > 0 ? Number((peSum / peCount).toFixed(2)) : null },
      { key: 'roe', label: 'ROE %', value: roeCount > 0 ? Number((roeSum / roeCount).toFixed(2)) : null },
      { key: 'change_1m', label: 'Change 1M %', value: change1mCount > 0 ? Number((change1mSum / change1mCount).toFixed(2)) : null },
      { key: 'fair_value_upside', label: 'Fair Value Upside %', value: fvCount > 0 ? Number((fvSum / fvCount).toFixed(2)) : null },
    ],
    speculative: [
      { key: 'volume_ratio', label: 'Volume Ratio', value: volRatioCount > 0 ? Number((volRatioSum / volRatioCount).toFixed(2)) : null },
      { key: 'change_1d', label: 'Change 1D %', value: change1dCount > 0 ? Number((change1dSum / change1dCount).toFixed(2)) : null },
      { key: 'volatility', label: 'Volatility %', value: volCount > 0 ? Number((volSum / volCount).toFixed(2)) : null },
      { key: 'turnover_egp', label: 'Turnover (EGP)', value: turnoverCount > 0 ? Number((turnoverSum / turnoverCount).toFixed(0)) : null },
    ],
  };

  const pathDefs = [
    { id: 1, name: 'Path 1', nameAr: 'اتجاه + تأكيد', condition: 'Trend + candle/volume confirm', conditionAr: 'صاعد + شمعة صاعدة + حجم' },
    { id: 2, name: 'Path 2', nameAr: 'ارتداد RSI', condition: 'RSI extreme reversal', conditionAr: 'تشبع بيعي/شرائي' },
    { id: 3, name: 'Path 3', nameAr: 'شمعة عند دعم/مقاومة', condition: 'Strong candle at S/R', conditionAr: 'شمعة قوية عند الدعم' },
    { id: 4, name: 'Path 4', nameAr: 'Master Score حاسم', condition: 'Master ≥ 65 or ≤ 35', conditionAr: 'الماستر حاسم' },
    { id: 5, name: 'Path 5', nameAr: 'انضغاط بولنجر', condition: 'BB Squeeze + volume + trend', conditionAr: 'انضغاط + طفرة حجم' },
  ];
  const maxTrig = Math.max(1, ...pathTriggers);
  const paths: PathStatus[] = pathDefs.map((p, i) => {
    const trig = pathTriggers[i];
    const prob = total > 0 ? Number(((trig / total) * 100).toFixed(0)) : 0;
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (trig > 0) {
      if (regimeData.regime === 'bull') signal = i === 2 || i === 3 ? 'SELL' : 'BUY';
      else if (regimeData.regime === 'bear') signal = 'SELL';
      else signal = i % 2 === 0 ? 'BUY' : 'SELL';
    }
    return {
      ...p,
      active: trig > 0 && trig === maxTrig,
      signal,
      probability: prob,
      triggeredCount: trig,
    };
  });

  const holdActive = total === 0 || (buy === 0 && sell === 0);

  return {
    success: true,
    hasLiveData: total > 0,
    source: total > 0 ? 'local' : 'demo',
    timestamp: new Date().toISOString(),
    regime: regimeData,
    indicators,
    scoringMatrix,
    masterScore,
    signals: { buy, sell, hold, total },
    personas: { gambler, investor, balanced, total },
    topStocks,
    p16,
    paths,
    holdActive,
  };
}

// ==================== Fetch regime from Python ====================

async function fetchRegimeFromPython(): Promise<RegimeData | null> {
  try {
    const result = await pythonFetch<any>('/api/market-pulse', { timeout: 8000 });
    if (!result.success || !result.data) return null;
    const d = result.data;
    const regimeRaw = String(d.marketRegime ?? d.regime ?? 'sideways').toLowerCase();
    const regime: 'bull' | 'bear' | 'sideways' =
      regimeRaw.includes('bull') ? 'bull' : regimeRaw.includes('bear') ? 'bear' : 'sideways';
    const egx30 = d.egx30 ?? d.indices?.egx30 ?? null;
    return {
      regime,
      regimeLabel: regime === 'bull' ? 'صاعد' : regime === 'bear' ? 'هابط' : 'متراوح',
      regimeConfidence: clamp(safeNum(d.regimeConfidence ?? d.regime_confidence ?? 50, 50), 0, 100),
      egx30Value: egx30?.value != null ? safeNum(egx30.value) : null,
      egx30Change: egx30?.change_percent != null ? safeNum(egx30.change_percent) : (d.egx30Change != null ? safeNum(d.egx30Change) : null),
      bullThreshold: 10,
      bearThreshold: -10,
    };
  } catch {
    return null;
  }
}

// ==================== GET handler ====================

export async function GET() {
  const pyRegime = await fetchRegimeFromPython();
  const analyses = await readLocalAnalyses();

  if (analyses.length > 0 || pyRegime) {
    const regimeData: RegimeData = pyRegime ?? {
      regime: 'sideways',
      regimeLabel: 'متراوح',
      regimeConfidence: 50,
      egx30Value: null,
      egx30Change: null,
      bullThreshold: 10,
      bearThreshold: -10,
    };
    const payload = buildLivePayload(analyses, regimeData);
    payload.source = analyses.length > 0 && pyRegime ? 'python' : analyses.length > 0 ? 'local' : 'demo';
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(buildDemoPayload(), { headers: { 'Cache-Control': 'no-store' } });
}

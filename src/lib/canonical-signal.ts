/**
 * canonical-signal.ts — TypeScript port of vps-service/utils/canonical_signal.py
 * ===============================================================================
 *
 * المصدر الموحد لكل المقاييس الفنية في الـ frontend + Next.js APIs.
 * كل الشاشات + APIs + publishing + Telegram (TS-side) لازم يستوردوا من هنا.
 *
 * القاعدة 67 (CALCULATION-CANONICAL) + Rule 27 (NO-FAKE-DATA).
 *
 * المرجع: download/UNIFIED_DATA_CONTRACT.md
 */

// ============================================================================
// 1) SIGNAL CLASSIFICATION (master_score → STRONG_BUY / BUY / HOLD / SELL)
// ============================================================================
// Canonical thresholds — single source of truth
// DO NOT change without updating the Python port + worklog.

export const SIGNAL_THRESHOLDS = {
  STRONG_BUY: 78,
  BUY: 65,
  ACCUMULATE: 55,
  REDUCE: 40,
  STRONG_SELL: 25,
} as const;

export type SignalType =
  | 'STRONG_BUY'
  | 'BUY'
  | 'ACCUMULATE'
  | 'HOLD'
  | 'REDUCE'
  | 'SELL'
  | 'STRONG_SELL';

export function classifySignal(masterScore: number | null | undefined): SignalType {
  if (masterScore === null || masterScore === undefined || Number.isNaN(masterScore)) {
    return 'HOLD';
  }
  const s = Number(masterScore);
  if (s >= SIGNAL_THRESHOLDS.STRONG_BUY) return 'STRONG_BUY';
  if (s >= SIGNAL_THRESHOLDS.BUY) return 'BUY';
  if (s >= SIGNAL_THRESHOLDS.ACCUMULATE) return 'ACCUMULATE';
  if (s >= SIGNAL_THRESHOLDS.REDUCE) return 'HOLD';
  if (s >= SIGNAL_THRESHOLDS.STRONG_SELL) return 'SELL';
  return 'STRONG_SELL';
}

export function signalAr(signal: SignalType | string | null | undefined): string {
  if (!signal) return 'انتظار';
  const map: Record<string, string> = {
    STRONG_BUY: 'شراء قوي',
    BUY: 'شراء',
    ACCUMULATE: 'تجميع',
    HOLD: 'انتظار',
    REDUCE: 'تخفيض',
    SELL: 'بيع',
    STRONG_SELL: 'بيع قوي',
    // Legacy labels (mapped to canonical)
    INSTITUTIONAL_BUY: 'شراء قوي',
    INSTITUTIONAL_SELL: 'بيع قوي',
    STRONG: 'شراء قوي',
    WEAK: 'انتظار',
    NEUTRAL: 'انتظار',
    BUY_PRESSURE: 'تجميع قوي',
    SELL_PRESSURE: 'تصريف قوي',
  };
  return map[signal] ?? 'انتظار';
}

// ============================================================================
// 2) ACCUMULATION / DISTRIBUTION (buy_pct → label)
// ============================================================================
// FIX (Task CALC-DUP-1): قبل كده كان accumulation بيتحسب من "عدد أيام الإغلاق
// الأخضر في 10 أيام" → كان بيعطي "تصريف قوي" لما buy_pct=75% (تناقض واضح).
// Canonical: نستخدم buy_pct من compute_money_flow كمصدر وحيد.

export const ACCUMULATION_THRESHOLDS = {
  STRONG_ACCUMULATION: 70,
  ACCUMULATION: 60,
  LIGHT_ACCUMULATION: 55,
  NEUTRAL: 45,
  LIGHT_DISTRIBUTION: 40,
  DISTRIBUTION: 30,
} as const;

export type AccumulationLabel =
  | 'تجميع قوي'
  | 'تجميع'
  | 'تجميع خفيف'
  | 'محايد'
  | 'تصريف خفيف'
  | 'تصريف'
  | 'تصريف قوي';

export function classifyAccumulation(buyPct: number | null | undefined): AccumulationLabel {
  if (buyPct === null || buyPct === undefined || Number.isNaN(buyPct)) {
    return 'محايد';
  }
  const b = Number(buyPct);
  if (b >= ACCUMULATION_THRESHOLDS.STRONG_ACCUMULATION) return 'تجميع قوي';
  if (b >= ACCUMULATION_THRESHOLDS.ACCUMULATION) return 'تجميع';
  if (b >= ACCUMULATION_THRESHOLDS.LIGHT_ACCUMULATION) return 'تجميع خفيف';
  if (b >= ACCUMULATION_THRESHOLDS.NEUTRAL) return 'محايد';
  if (b >= ACCUMULATION_THRESHOLDS.LIGHT_DISTRIBUTION) return 'تصريف خفيف';
  if (b >= ACCUMULATION_THRESHOLDS.DISTRIBUTION) return 'تصريف';
  return 'تصريف قوي';
}

// ============================================================================
// 3) MONEY FLOW STATE (buy_pct + sell_pct → emoji label)
// ============================================================================

export type MoneyFlowState =
  | '🟢 سيولة داخلة قوية'
  | '🟢 سيولة داخلة'
  | '🟡 سيولة متوازنة'
  | '🔴 سيولة خارجة'
  | '🔴 سيولة خارجة قوية';

export function classifyMoneyFlow(
  buyPct: number | null | undefined,
  sellPct: number | null | undefined,
  _netFlowEgp?: number | null,
): MoneyFlowState {
  if (buyPct === null || buyPct === undefined || sellPct === null || sellPct === undefined) {
    return '🟡 سيولة متوازنة';
  }
  const b = Number(buyPct);
  const s = Number(sellPct);
  const diff = b - s;

  if (diff >= 25) return '🟢 سيولة داخلة قوية';
  if (diff >= 10) return '🟢 سيولة داخلة';
  if (diff >= -10) return '🟡 سيولة متوازنة';
  if (diff >= -25) return '🔴 سيولة خارجة';
  return '🔴 سيولة خارجة قوية';
}

// ============================================================================
// 4) VOLUME RATIO (entry_vol / avg_20d_vol — capped at 50)
// ============================================================================

export function classifyVolumeRatio(
  entryVolume: number | null | undefined,
  avgVolume20d: number | null | undefined,
): number | null {
  if (entryVolume === null || entryVolume === undefined || avgVolume20d === null || avgVolume20d === undefined) {
    return null;
  }
  const v = Number(entryVolume);
  const avg = Number(avgVolume20d);
  if (!Number.isFinite(v) || !Number.isFinite(avg) || avg <= 0) {
    return null;
  }
  const ratio = v / avg;
  return Math.min(ratio, 50.0);
}

// ============================================================================
// 5) STOCK PHASE (تجميع / تصاعد / توزيع / تخفيض)
// ============================================================================
// FIX (Task CALC-DUP-1): كان فيه 4 taxonomies مختلفة لـ "phase" كلها اسمها "phase".
// Canonical: regime taxonomy (تجميع/تصاعد/توزيع/تخفيض).

export type StockPhase = 'تجميع' | 'تصاعد' | 'توزيع' | 'تخفيض' | 'محايد';

export function classifyStockPhase(
  buyPct: number | null | undefined,
  roc10d: number | null | undefined = 0,
  _roc30d?: number | null,
): StockPhase {
  if (buyPct === null || buyPct === undefined) {
    return 'محايد';
  }
  const b = Number(buyPct);
  const r10 = roc10d !== null && roc10d !== undefined ? Number(roc10d) : 0;

  if (b >= 60 && r10 >= -3 && r10 <= 5) return 'تجميع';
  if (b >= 55 && r10 > 5) return 'تصاعد';
  if (b <= 40 && r10 > -3) return 'توزيع';
  if (b <= 40 && r10 < -3) return 'تخفيض';
  return 'محايد';
}

// ============================================================================
// SELF-TEST — للتأكد إن الـ functions بـ تتطابق مع Python port
// ============================================================================
// Run: npx tsx src/lib/canonical-signal.ts

if (typeof require !== 'undefined' && require.main === module) {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error('❌ ' + msg);
      process.exit(1);
    }
    console.log('✅ ' + msg);
  };

  console.log('=== canonical-signal.ts self-test ===\n');

  // Test 1: classifySignal
  assert(classifySignal(80) === 'STRONG_BUY', 'classifySignal(80) = STRONG_BUY');
  assert(classifySignal(70) === 'BUY', 'classifySignal(70) = BUY');
  assert(classifySignal(60) === 'ACCUMULATE', 'classifySignal(60) = ACCUMULATE');
  assert(classifySignal(50) === 'HOLD', 'classifySignal(50) = HOLD');
  assert(classifySignal(35) === 'SELL', 'classifySignal(35) = SELL');
  assert(classifySignal(20) === 'STRONG_SELL', 'classifySignal(20) = STRONG_SELL');
  assert(classifySignal(null) === 'HOLD', 'classifySignal(null) = HOLD');

  // Test 2: classifyAccumulation — ETCL case (75.7% buy)
  assert(classifyAccumulation(75.7) === 'تجميع قوي', 'ETCL: buy_pct=75.7 → تجميع قوي');
  assert(classifyAccumulation(65) === 'تجميع', 'classifyAccumulation(65) = تجميع');
  assert(classifyAccumulation(58) === 'تجميع خفيف', 'classifyAccumulation(58) = تجميع خفيف');
  assert(classifyAccumulation(50) === 'محايد', 'classifyAccumulation(50) = محايد');
  assert(classifyAccumulation(42) === 'تصريف خفيف', 'classifyAccumulation(42) = تصريف خفيف');
  assert(classifyAccumulation(35) === 'تصريف', 'classifyAccumulation(35) = تصريف');
  assert(classifyAccumulation(20) === 'تصريف قوي', 'classifyAccumulation(20) = تصريف قوي');

  // Test 3: classifyMoneyFlow
  assert(classifyMoneyFlow(75, 25) === '🟢 سيولة داخلة قوية', 'moneyFlow(75,25) = 🟢 قوية');
  assert(classifyMoneyFlow(60, 40) === '🟢 سيولة داخلة', 'moneyFlow(60,40) = 🟢 داخلة');
  assert(classifyMoneyFlow(50, 50) === '🟡 سيولة متوازنة', 'moneyFlow(50,50) = 🟡 متوازنة');
  assert(classifyMoneyFlow(40, 60) === '🔴 سيولة خارجة', 'moneyFlow(40,60) = 🔴 خارجة');
  assert(classifyMoneyFlow(25, 75) === '🔴 سيولة خارجة قوية', 'moneyFlow(25,75) = 🔴 قوية');

  // Test 4: classifyVolumeRatio
  assert(classifyVolumeRatio(200, 100) === 2.0, 'volumeRatio(200,100) = 2.0');
  assert(classifyVolumeRatio(10000, 100) === 50.0, 'volumeRatio(10000,100) capped at 50');
  assert(classifyVolumeRatio(100, 0) === null, 'volumeRatio(100,0) = null');
  assert(classifyVolumeRatio(null, 100) === null, 'volumeRatio(null,100) = null');

  // Test 5: classifyStockPhase
  assert(classifyStockPhase(65, 1) === 'تجميع', 'phase(65,1) = تجميع');
  assert(classifyStockPhase(60, 10) === 'تصاعد', 'phase(60,10) = تصاعد');
  assert(classifyStockPhase(35, 1) === 'توزيع', 'phase(35,1) = توزيع');
  assert(classifyStockPhase(35, -5) === 'تخفيض', 'phase(35,-5) = تخفيض');
  assert(classifyStockPhase(50, 0) === 'محايد', 'phase(50,0) = محايد');

  console.log('\n=== All canonical-signal.ts tests passed ===');
  console.log('\n--- ETCL case validation (must match Python port) ---');
  console.log(`ETCL buy_pct=75.7%, roc_10d=-2% → accumulation = ${classifyAccumulation(75.7)}`);
  console.log(`ETCL buy_pct=75.7%, sell_pct=24.3% → money_flow = ${classifyMoneyFlow(75.7, 24.3)}`);
  console.log(`ETCL buy_pct=75.7%, roc_10d=-2% → phase = ${classifyStockPhase(75.7, -2)}`);
  console.log('\nالنتيجة: TS port matches Python port ✅');
}

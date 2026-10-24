// TradingViewChart indicators — extracted from TradingViewChart.tsx (Phase 3)
// Pure functions for technical analysis calculations

function formatVolume(vol: number | null | undefined): string {
 if (vol === null || vol === undefined || isNaN(vol)) return '0';
 if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
 if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
 if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
 return vol.toString();
}

function calcSMA(data: number[], period: number): (number | null)[] {
 const result: (number | null)[] = [];
 for (let i = 0; i < data.length; i++) {
 if (i < period - 1) {
 result.push(null);
 } else {
 let sum = 0;
 for (let j = 0; j < period; j++) sum += data[i - j];
 result.push(sum / period);
 }
 }
 return result;
}

function calcEMA(data: number[], period: number): (number | null)[] {
 const result: (number | null)[] = [];
 const k = 2 / (period + 1);
 let ema: number | null = null;

 for (let i = 0; i < data.length; i++) {
 if (i < period - 1) {
 result.push(null);
 } else if (i === period - 1) {
 // First EMA = SMA
 let sum = 0;
 for (let j = 0; j < period; j++) sum += data[i - j];
 ema = sum / period;
 result.push(ema);
 } else {
 ema = data[i] * k + (ema || 0) * (1 - k);
 result.push(ema);
 }
 }
 return result;
}

function calcBollingerBands(
 data: number[],
 period: number = 20,
 stdDev: number = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
 const middle = calcSMA(data, period);
 const upper: (number | null)[] = [];
 const lower: (number | null)[] = [];

 for (let i = 0; i < data.length; i++) {
 if (middle[i] === null) {
 upper.push(null);
 lower.push(null);
 } else {
 let sumSq = 0;
 for (let j = 0; j < period; j++) {
 sumSq += Math.pow(data[i - j] - (middle[i] as number), 2);
 }
 const sd = Math.sqrt(sumSq / period);
 upper.push((middle[i] as number) + stdDev * sd);
 lower.push((middle[i] as number) - stdDev * sd);
 }
 }

 return { upper, middle, lower };
}

// ─── CANONICAL-CALCULATIONS (Task PHASE-2-RSI-UNIFICATION, Rule 67: CALCULATION-CANONICAL) ─
// Task PHASE5-SCREENS-P1 (2026-10-08): calcRSI now imported from @/lib/canonical-rsi
// (was a local duplicate). The local function below was REMOVED — canonical is the SSOT.
// calcATR remains local for now (P2: will be moved to @/lib/canonical-atr when created).
// قيمة RSI الواحدة لازم تيجي من computeRSI في unified-stock-data.ts.
// Task PHASE5-SCREENS-P1: local calcRSI REMOVED — now imported from @/lib/canonical-rsi (computeRSISeries).
// The local function body was deleted (was a 44-line duplicate of canonical-rsi.ts::computeRSISeries).

function calcMACD(
 data: number[],
 fastPeriod: number = 12,
 slowPeriod: number = 26,
 signalPeriod: number = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
 const fastEMA = calcEMA(data, fastPeriod);
 const slowEMA = calcEMA(data, slowPeriod);
 const macd: (number | null)[] = [];
 
 for (let i = 0; i < data.length; i++) {
 if (fastEMA[i] === null || slowEMA[i] === null) {
 macd.push(null);
 } else {
 macd.push((fastEMA[i] as number) - (slowEMA[i] as number));
 }
 }
 
 const nonNullMacd = macd.filter((v): v is number => v !== null);
 const signalRaw = calcEMA(nonNullMacd, signalPeriod);
 
 const signal: (number | null)[] = new Array(data.length).fill(null);
 const histogram: (number | null)[] = new Array(data.length).fill(null);
 let signalIdx = 0;
 
 for (let i = 0; i < macd.length; i++) {
 if (macd[i] !== null && signalIdx < signalRaw.length) {
 signal[i] = signalRaw[signalIdx];
 histogram[i] = (macd[i] as number) - (signalRaw[signalIdx] ?? 0);
 signalIdx++;
 }
 }
 
 return { macd, signal, histogram };
}

function calcStochastic(

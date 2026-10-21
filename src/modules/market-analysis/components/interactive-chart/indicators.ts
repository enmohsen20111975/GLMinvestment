import type { ChartData } from './types';

function calcEMA(data: number[], period: number): (number | null)[] {
 const result: (number | null)[] = new Array(data.length).fill(null);
 if (data.length < period) return result;

 const k = 2 / (period + 1);
 // Seed with SMA
 let sum = 0;
 for (let i = 0; i < period; i++) {
 sum += data[i];
 }
 result[period - 1] = sum / period;

 for (let i = period; i < data.length; i++) {
 const prev = result[i - 1]!;
 result[i] = data[i] * k + prev * (1 - k);
 }

 return result;
}

function calcMACD(closes: number[]): {
 macdLine: (number | null)[];
 signalLine: (number | null)[];
 histogram: (number | null)[];
} {
 const macdLine: (number | null)[] = new Array(closes.length).fill(null);
 const signalLine: (number | null)[] = new Array(closes.length).fill(null);
 const histogram: (number | null)[] = new Array(closes.length).fill(null);

 const ema12 = calcEMA(closes, 12);
 const ema26 = calcEMA(closes, 26);

 // MACD line = EMA12 - EMA26
 const macdRaw: number[] = [];
 for (let i = 0; i < closes.length; i++) {
 if (ema12[i] !== null && ema26[i] !== null) {
 const val = ema12[i]! - ema26[i]!;
 macdLine[i] = val;
 macdRaw.push(val);
 }
 }

 // Signal line = 9-period EMA of MACD
 const macdStartIdx = macdLine.findIndex((v) => v !== null);
 if (macdStartIdx === -1) return { macdLine, signalLine, histogram };

 const signalRaw = calcEMA(macdRaw, 9);
 let signalIdx = 0;
 for (let i = macdStartIdx; i < closes.length; i++) {
 if (signalRaw[signalIdx] !== null) {
 signalLine[i] = signalRaw[signalIdx];
 }
 signalIdx++;
 }

 // Histogram = MACD - Signal
 for (let i = 0; i < closes.length; i++) {
 if (macdLine[i] !== null && signalLine[i] !== null) {
 histogram[i] = macdLine[i]! - signalLine[i]!;
 }
 }

 return { macdLine, signalLine, histogram };
}

function calcOBV(ohlcv: ChartData[]): number[] {
 const obv: number[] = [0];
 for (let i = 1; i < ohlcv.length; i++) {
 if (ohlcv[i].close > ohlcv[i - 1].close) {
 obv.push(obv[i - 1] + ohlcv[i].volume);
 } else if (ohlcv[i].close < ohlcv[i - 1].close) {
 obv.push(obv[i - 1] - ohlcv[i].volume);
 } else {
 obv.push(obv[i - 1]);
 }
 }
 return obv;
}

function calcFibLevels(
 high: number,
 low: number
): { level: number; price: number; label: string; style: LineStyle }[] {
 const diff = high - low;
 return [
 { level: 0, price: high, label: 'Fib 0.0%', style: LineStyle.Solid },
 { level: 0.236, price: high - diff * 0.236, label: 'Fib 23.6%', style: LineStyle.Dotted },
 { level: 0.382, price: high - diff * 0.382, label: 'Fib 38.2%', style: LineStyle.Dashed },
 { level: 0.5, price: high - diff * 0.5, label: 'Fib 50.0%', style: LineStyle.Dashed },
 { level: 0.618, price: high - diff * 0.618, label: 'Fib 61.8%', style: LineStyle.Dashed },
 { level: 0.786, price: high - diff * 0.786, label: 'Fib 78.6%', style: LineStyle.Dotted },
 { level: 1, price: low, label: 'Fib 100%', style: LineStyle.Solid },
 ];
}

// ─── Component ────────────────────────────────────────────────────────────────


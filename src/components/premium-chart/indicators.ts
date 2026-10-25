/**
 * Premium Chart — Indicators (client-side calculations)
 * =====================================================================
 *
 * حسابات المؤشرات الفنية على الـ client (للحالات اللي بيجي فيها ohlcv بس).
 * المحرك الأساسي (Python) بيبعت المؤشرات جاهزة عبر /api/v2/chart/full-analysis.
 * بس ممكن نحتاج نحسبها محلياً للـ backtesting السريع أو الـ custom periods.
 */

import type { ChartData, IndicatorData } from './types';
import { LineStyle } from 'lightweight-charts';

/** Simple Moving Average */
export function calcSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    result[i] = sum / period;
  }
  return result;
}

/** Exponential Moving Average */
export function calcEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1]!;
    result[i] = values[i] * k + prev * (1 - k);
  }
  return result;
}

/** MACD: line, signal, histogram */
export function calcMACD(closes: number[]): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const macdLine: (number | null)[] = new Array(closes.length).fill(null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  const macdRaw: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      const val = ema12[i]! - ema26[i]!;
      macdLine[i] = val;
      macdRaw.push(val);
    }
  }

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

  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i]! - signalLine[i]!;
    }
  }

  return { macdLine, signalLine, histogram };
}

/** On Balance Volume */
export function calcOBV(ohlcv: ChartData[]): number[] {
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

/** Relative Strength Index (Wilder) */
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/** Average True Range (Wilder) */
export function calcATR(ohlcv: ChartData[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(ohlcv.length).fill(null);
  if (ohlcv.length < period + 1) return result;

  const trs: number[] = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const high = ohlcv[i].high;
    const low = ohlcv[i].low;
    const prevClose = ohlcv[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  let atr = sum / period;
  result[period] = atr;

  for (let i = period + 1; i < ohlcv.length; i++) {
    atr = (atr * (period - 1) + trs[i - 1]) / period;
    result[i] = atr;
  }
  return result;
}

/** Bollinger Bands */
export function calcBollinger(
  closes: number[],
  period = 20,
  mult = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const sma = calcSMA(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const middle: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    if (sma[i] === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - sma[i]!) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper[i] = sma[i]! + mult * std;
    middle[i] = sma[i];
    lower[i] = sma[i]! - mult * std;
  }
  return { upper, middle, lower };
}

/** Fibonacci levels from high/low */
export function calcFibLevels(
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

/** Convert array of values to IndicatorData aligned with ohlcv times */
export function toIndicatorData(
  ohlcv: ChartData[],
  values: (number | null)[]
): IndicatorData[] {
  return ohlcv.map((c, i) => ({
    time: c.time,
    value: values[i] ?? null,
  }));
}

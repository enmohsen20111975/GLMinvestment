import type { Candle, ChartHelpers } from './types';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Synthetic candle generator + chart layout constants/scales.
 * ============================================================ */

/* ───────────────────────── Synthetic Candles Generator ───── */

const N = 26;

const clamp = (c: Candle): Candle => ({
  o: +(c.o ?? 0).toFixed(2),
  h: +(c.h ?? 0).toFixed(2),
  l: +(c.l ?? 0).toFixed(2),
  c: +(c.c ?? 0).toFixed(2),
});

export function generateSyntheticCandles(pattern: string): Candle[] {
  const out: Candle[] = [];

  switch (pattern) {
    /* ── FVG: 3-candle gap up at indices 5-7 ── */
    case 'fvg': {
      let p = 95;
      for (let i = 0; i < N; i++) {
        if (i === 5) {
          out.push(clamp({ o: p, c: p + 1.2, h: p + 1.6, l: p - 0.4 }));
        } else if (i === 6) {
          // Impulse candle that opens with a gap up
          out.push(clamp({ o: p + 5, c: p + 9, h: p + 9.5, l: p + 4.5 }));
          p = p + 9;
        } else if (i === 7) {
          // Candle after gap opens above previous high → gap remains
          out.push(clamp({ o: p + 1, c: p + 2.5, h: p + 3.2, l: p + 0.6 }));
          p = p + 2.5;
        } else if (i === 11 || i === 12) {
          // Price returns to fill the gap
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else if (i === 13) {
          // Bounce from gap zone
          out.push(clamp({ o: p, c: p + 3, h: p + 3.5, l: p - 0.5 }));
          p = p + 3;
        } else {
          const drift = Math.sin(i * 0.5) * 0.6;
          const isBull = i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 0.8 + drift : p - 0.7 + drift;
          const h = Math.max(o, c) + 0.5;
          const l = Math.min(o, c) - 0.5;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Order Block: red candle at index 4 followed by strong rally ── */
    case 'orderBlock': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 4) {
          // Last red candle before rally = the Order Block
          out.push(clamp({ o: p, c: p - 2, h: p + 0.3, l: p - 2.5 }));
          p = p - 2;
        } else if (i === 5 || i === 6 || i === 7) {
          // Strong rally
          const gain = 3 + i * 0.5;
          out.push(clamp({ o: p, c: p + gain, h: p + gain + 0.4, l: p - 0.2 }));
          p = p + gain;
        } else if (i === 14 || i === 15) {
          // Return to test OB
          out.push(clamp({ o: p, c: p - 3.5, h: p + 0.2, l: p - 4 }));
          p = p - 3.5;
        } else if (i === 16) {
          // Bounce from OB
          out.push(clamp({ o: p, c: p + 4, h: p + 4.5, l: p - 0.3 }));
          p = p + 4;
        } else {
          const drift = Math.cos(i * 0.4) * 0.5;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.5 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Liquidity Sweep: rising peaks, then sweep + bounce ── */
    case 'liquiditySweep': {
      let p = 100;
      const peaks = [3, 9, 15]; // indices of consecutive peaks
      const peakVals: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 3) {
          out.push(clamp({ o: p, c: p + 2, h: p + 3, l: p - 0.3 }));
          p = p + 2;
          peakVals.push(p + 1);
        } else if (i === 9) {
          out.push(clamp({ o: p, c: p + 1.5, h: p + 3, l: p - 0.3 }));
          p = p + 1.5;
          peakVals.push(p + 1.5);
        } else if (i === 15) {
          // Sweep: breaks above previous peak then closes below
          const prevPeak = peakVals[peakVals.length - 1];
          out.push(clamp({
            o: p,
            c: prevPeak - 0.5,
            h: prevPeak + 1.5, // sweep above
            l: p - 0.5,
          }));
          p = prevPeak - 0.5;
        } else if (i === 16 || i === 17 || i === 18) {
          // Bounce down
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = !peaks.includes(i) && i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.5 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── MSS: ascending structure then break of last low ── */
    case 'mss': {
      let p = 100;
      const lows = [4, 11, 18];
      const lowVals: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 4) {
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 1 }));
          p = p + 1;
          lowVals.push(p - 1);
        } else if (i === 11) {
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 0.8 }));
          p = p + 1;
          lowVals.push(p - 0.8);
        } else if (i === 18) {
          // Last higher low
          out.push(clamp({ o: p, c: p + 1, h: p + 1.5, l: p - 0.6 }));
          p = p + 1;
          lowVals.push(p - 0.6);
        } else if (i === 22) {
          // MSS: break below last low
          const lastLow = lowVals[lowVals.length - 1];
          out.push(clamp({ o: p, c: lastLow - 1.5, h: p + 0.3, l: lastLow - 2 }));
          p = lastLow - 1.5;
        } else if (i === 23 || i === 24 || i === 25) {
          // Continuation down
          out.push(clamp({ o: p, c: p - 1.5, h: p + 0.3, l: p - 2 }));
          p = p - 1.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 3 !== 1;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.4 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Head and Shoulders: LS (5), Head (13), RS (21), neckline ── */
    case 'headShoulders': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 5) {
          // Left shoulder
          out.push(clamp({ o: p, c: p + 4, h: p + 5, l: p - 0.3 }));
          p = p + 4;
        } else if (i === 6 || i === 7) {
          // Pullback to neckline
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else if (i === 13) {
          // Head
          out.push(clamp({ o: p, c: p + 7, h: p + 8, l: p - 0.3 }));
          p = p + 7;
        } else if (i === 14 || i === 15) {
          // Pullback to neckline
          out.push(clamp({ o: p, c: p - 4, h: p + 0.3, l: p - 4.5 }));
          p = p - 4;
        } else if (i === 21) {
          // Right shoulder
          out.push(clamp({ o: p, c: p + 4, h: p + 5, l: p - 0.3 }));
          p = p + 4;
        } else if (i === 22 || i === 23) {
          // Pullback and neckline break
          out.push(clamp({ o: p, c: p - 3, h: p + 0.3, l: p - 3.5 }));
          p = p - 3;
        } else if (i === 24 || i === 25) {
          // Continuation down
          out.push(clamp({ o: p, c: p - 2.5, h: p + 0.3, l: p - 3 }));
          p = p - 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.4 + drift : p - 0.3 + drift;
          const h = Math.max(o, c) + 0.4;
          const l = Math.min(o, c) - 0.4;
          out.push(clamp({ o, h, l, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Bollinger Squeeze: narrow then expand ── */
    case 'bollinger': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i < 14) {
          // Tight squeeze: tiny candles
          const drift = Math.sin(i * 0.6) * 0.2;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.3 + drift : p - 0.2 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.15, l: Math.min(o, c) - 0.15, c }));
          p = c;
        } else if (i === 14) {
          // Breakout candle
          out.push(clamp({ o: p, c: p + 4, h: p + 4.5, l: p - 0.2 }));
          p = p + 4;
        } else {
          // Expansion
          const drift = Math.sin(i * 0.5) * 0.8;
          const isBull = i % 3 !== 0;
          const o = p;
          const c = isBull ? p + 1.5 + drift : p - 1.2 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.6, l: Math.min(o, c) - 0.6, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── RSI Divergence: price higher high + RSI lower high ── */
    case 'rsiDiv': {
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 6) {
          // First peak
          out.push(clamp({ o: p, c: p + 5, h: p + 6, l: p - 0.3 }));
          p = p + 5;
        } else if (i === 7 || i === 8) {
          out.push(clamp({ o: p, c: p - 3, h: p + 0.3, l: p - 3.5 }));
          p = p - 3;
        } else if (i === 18) {
          // Higher high in price
          out.push(clamp({ o: p, c: p + 7, h: p + 8, l: p - 0.3 }));
          p = p + 7;
        } else if (i === 19 || i === 20) {
          // Pullback — start of downtrend
          out.push(clamp({ o: p, c: p - 4, h: p + 0.3, l: p - 4.5 }));
          p = p - 4;
        } else if (i > 20) {
          // Downtrend
          out.push(clamp({ o: p, c: p - 2, h: p + 0.3, l: p - 2.5 }));
          p = p - 2;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.6 + drift : p - 0.4 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
          p = c;
        }
      }
      return out;
    }

    /* ── Triangle (used for the 3 sub-types) ── */
    case 'triangle': {
      // Ascending triangle pattern by default
      let p = 100;
      for (let i = 0; i < N; i++) {
        if (i === 4 || i === 12 || i === 19) {
          // Test horizontal resistance
          out.push(clamp({ o: p, c: p + 3, h: 110, l: p - 0.3 }));
          p = p + 3;
        } else if (i === 8) {
          out.push(clamp({ o: p, c: p - 1, h: p + 0.3, l: p - 1.5 }));
          p = p - 1;
        } else if (i === 16) {
          out.push(clamp({ o: p, c: p - 0.5, h: p + 0.3, l: p - 1 }));
          p = p - 0.5;
        } else if (i === 22 || i === 23 || i === 24 || i === 25) {
          // Breakout up
          out.push(clamp({ o: p, c: p + 2.5, h: p + 3, l: p - 0.2 }));
          p = p + 2.5;
        } else {
          const drift = Math.sin(i * 0.4) * 0.4;
          const isBull = i % 2 === 0;
          const o = p;
          const c = isBull ? p + 0.5 + drift : p - 0.3 + drift;
          out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
          p = c;
        }
      }
      return out;
    }

    default:
      // Generic rising candles
      for (let i = 0; i < N; i++) {
        const drift = Math.sin(i * 0.5) * 0.4;
        const o = 100 + i * 0.5;
        const c = o + 0.5 + drift;
        out.push(clamp({ o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c }));
      }
      return out;
  }
}

/* ───────────────────────── Chart Layout Helpers ──────────── */

export const CHART_W = 600;
export const CHART_H = 300;
export const PAD = { left: 44, right: 14, top: 18, bottom: 28 };
export const PLOT_W = CHART_W - PAD.left - PAD.right;
export const PLOT_H = CHART_H - PAD.top - PAD.bottom;

export function makeScales(candles: Candle[]): ChartHelpers {
  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  const minP = Math.min(...lows) - 1;
  const maxP = Math.max(...highs) + 1;
  const slot = PLOT_W / candles.length;
  const xOf = (i: number) => PAD.left + i * slot + slot / 2;
  const yOf = (p: number) => PAD.top + PLOT_H - ((p - minP) / (maxP - minP)) * PLOT_H;
  const bodyW = Math.max(4, slot * 0.6);
  return { minP, maxP, slot, xOf, yOf, bodyW };
}

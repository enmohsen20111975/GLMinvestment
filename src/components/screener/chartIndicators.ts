/**
 * أدوات حساب المؤشرات الفنية للشاشة (Screener Indicators)
 *
 * كل الدوال pure — ما لهاش side effects.
 * بتشتغل على arrays من الأرقام وبترجع arrays بنفس الطول (مع null في البداية لو لازم).
 */

// ─── أنواع البيانات ───────────────────────────────────────────────────────

export interface OhlcvPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── المتوسطات المتحركة ──────────────────────────────────────────────────

/**
 * حساب Simple Moving Average
 * @param data مصفوفة القيم (عادة أرقام الإغلاق)
 * @param period طول فترة المتوسط
 * @returns مصفوفة بنفس طول الإدخال؛ العناصر قبل `period - 1` تكون null
 */
export function calcSMA(data: number[], period: number): (number | null)[] {
  if (period <= 0 || data.length === 0) return data.map(() => null);
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }
  return result;
}

/**
 * حساب Exponential Moving Average
 */
export function calcEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// ─── RSI ──────────────────────────────────────────────────────────────────

/**
 * حساب Relative Strength Index (RSI)
 * @param closes مصفوفة أرقام الإغلاق
 * @param period عدد الأيام (افتراضي 14)
 */
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length < period + 1) {
    return closes.map(() => null);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  result.push(...Array(period).fill(null));
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ─── Support / Resistance ─────────────────────────────────────────────────

/**
 * اكتشاف خطوط الدعم والمقاومة تلقائيًا باستخدام pivot points.
 *
 * الفكرة: نبحث عن القمم والقيعان المحلية (pivot highs/lows) ونحتسب أكثر المستويات تكرارًا.
 *
 * @param history بيانات OHLCV
 * @param lookback عدد النقاط قبل وبعد Pivot (افتراضي 3)
 * @param maxLevels أقصى عدد مستويات نرجعه لكل نوع
 */
export interface SupportResistanceLevels {
  supports: number[];
  resistances: number[];
}

export function detectSupportResistance(
  history: OhlcvPoint[],
  lookback = 3,
  maxLevels = 3
): SupportResistanceLevels {
  if (history.length < lookback * 2 + 1) {
    return { supports: [], resistances: [] };
  }
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = lookback; i < history.length - lookback; i++) {
    const h = history[i].high;
    const l = history[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (history[j].high > h) isHigh = false;
      if (history[j].low < l) isLow = false;
    }
    if (isHigh) pivotHighs.push(h);
    if (isLow) pivotLows.push(l);
  }
  // نقرب الأرقام ونجمّعها بالقرب من بعض
  const clusterLevels = (values: number[]): number[] => {
    if (values.length === 0) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const clusters: { sum: number; count: number }[] = [];
    const tol = (sorted[sorted.length - 1] - sorted[0]) * 0.01 || 0.001;
    for (const v of sorted) {
      const found = clusters.find(c => Math.abs(c.sum / c.count - v) < tol);
      if (found) {
        found.sum += v;
        found.count += 1;
      } else {
        clusters.push({ sum: v, count: 1 });
      }
    }
    // نرجّع أكثر المستويات تكرارًا (strength)
    return clusters
      .sort((a, b) => b.count - a.count)
      .slice(0, maxLevels)
      .map(c => c.sum / c.count);
  };
  return {
    supports: clusterLevels(pivotLows),
    resistances: clusterLevels(pivotHighs),
  };
}

// ─── Sparkline Data ───────────────────────────────────────────────────────

/**
 * استخراج بيانات مختصرة للـ sparkline من history
 * @param history بيانات OHLCV كاملة
 * @param maxPoints أقصى عدد نقاط
 */
export function extractSparklineData(
  history: OhlcvPoint[],
  maxPoints = 30
): { x: number; y: number }[] {
  if (history.length === 0) return [];
  if (history.length <= maxPoints) {
    return history.map((p, i) => ({ x: i, y: p.close }));
  }
  const step = Math.floor(history.length / maxPoints);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < history.length; i += step) {
    points.push({ x: i, y: history[i].close });
    if (points.length >= maxPoints) break;
  }
  // ضمان إن آخر نقطة موجودة دايمًا
  const last = history[history.length - 1];
  if (points.length === 0 || points[points.length - 1].y !== last.close) {
    points.push({ x: history.length - 1, y: last.close });
  }
  return points;
}

// ─── تنسيق الأرقام ────────────────────────────────────────────────────────

/** تنسيق رقم السعر حسب حجمه */
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

/** تنسيق حجم التداول بشكل مختصر (K / M / B) */
export function formatVolume(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

/** تنسيق القيمة السوقية */
export function formatMarketCap(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + ' K';
  return n.toString();
}

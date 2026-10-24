/**
 * Japanese Candlestick Pattern Analysis (REAL — no fabrication)
 * =============================================================
 * كشف الأنماط اليابانية (الشموع اليابانية) من بيانات OHLC الحقيقية.
 *
 * الأنماط المكتشفة:
 *   - Doji (الحياد / التردد)
 *   - Hammer (المطرقة — انعكاس صاعد)
 *   - Inverted Hammer (المطرقة المقلوبة)
 *   - Hanging Man (الرجل المعلق — انعكاس هابط)
 *   - Bullish Engulfing (الابتلاع الصاعد)
 *   - Bearish Engulfing (الابتلاع الهابط)
 *   - Morning Star (نجمة الصباح — انعكاس صاعد قوي)
 *   - Evening Star (نجمة المساء — انعكاس هابط قوي)
 *   - Piercing Line (الخط المخترق)
 *   - Dark Cloud Cover (غطاء السحابة الداكنة)
 *   - Three White Soldiers (الجنود البيض الثلاثة)
 *   - Three Black Crows (الغربان السود الثلاثة)
 *
 * كل نمط بيرجع:
 *   - name (الاسم)
 *   - type: 'bullish' | 'bearish' | 'neutral'
 *   - strength: 1-5 (قوة النموذج)
 *   - description (وصف بالعربي)
 */

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlePattern {
  name: string;
  name_ar: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 1-5
  description: string;
  date: string;
}

// ============== Helpers ==============

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function bodyPct(c: Candle): number {
  if (c.open === 0) return 0;
  return Math.abs(c.close - c.open) / c.open;
}

function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function totalRange(c: Candle): number {
  return c.high - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

// ============== Single-Candle Patterns ==============

function detectDoji(c: Candle): CandlePattern | null {
  // Doji: body is very small relative to total range
  const range = totalRange(c);
  if (range === 0) return null;
  const bodyRatio = body(c) / range;
  if (bodyRatio < 0.1) {
    return {
      name: 'Doji',
      name_ar: 'دوجي',
      type: 'neutral',
      strength: 2,
      description: 'تردد بين المشترين والبائعين — السعر فتح وأغلق عند نفس المستوى تقريباً. قد يشير لانعكاس محتمل.',
      date: c.date,
    };
  }
  return null;
}

function detectHammer(c: Candle): CandlePattern | null {
  // Hammer: small body at top, long lower shadow (≥ 2× body), in downtrend
  const range = totalRange(c);
  if (range === 0 || body(c) === 0) return null;
  const lowerShadowRatio = lowerShadow(c) / body(c);
  const upperShadowRatio = upperShadow(c) / body(c);
  if (lowerShadowRatio >= 2 && upperShadowRatio < 0.5 && bodyPct(c) < 0.03) {
    return {
      name: 'Hammer',
      name_ar: 'المطرقة',
      type: 'bullish',
      strength: 3,
      description: 'انعكاس صاعد محتمل — السعر رفض مستويات أقل وأغلق بالقرب من الأعلى. الظل السفلي الطويل يدل على ضغط شرائي.',
      date: c.date,
    };
  }
  return null;
}

function detectInvertedHammer(c: Candle): CandlePattern | null {
  // Inverted Hammer: small body at bottom, long upper shadow
  const range = totalRange(c);
  if (range === 0 || body(c) === 0) return null;
  const upperShadowRatio = upperShadow(c) / body(c);
  const lowerShadowRatio = lowerShadow(c) / body(c);
  if (upperShadowRatio >= 2 && lowerShadowRatio < 0.5 && bodyPct(c) < 0.03) {
    return {
      name: 'Inverted Hammer',
      name_ar: 'المطرقة المقلوبة',
      type: 'bullish',
      strength: 2,
      description: 'محاولة صعود فشلت لكنها قد تشير لانعكاس صاعد محتمل في الاتجاه الهابط.',
      date: c.date,
    };
  }
  return null;
}

function detectHangingMan(c: Candle): CandlePattern | null {
  // Hanging Man: same shape as Hammer but in uptrend → bearish
  const range = totalRange(c);
  if (range === 0 || body(c) === 0) return null;
  const lowerShadowRatio = lowerShadow(c) / body(c);
  const upperShadowRatio = upperShadow(c) / body(c);
  if (lowerShadowRatio >= 2 && upperShadowRatio < 0.5 && bodyPct(c) < 0.03) {
    return {
      name: 'Hanging Man',
      name_ar: 'الرجل المعلق',
      type: 'bearish',
      strength: 3,
      description: 'تحذير هابط بعد اتجاه صاعد — الضغط البيعي ظهر في الظل السفلي الطويل.',
      date: c.date,
    };
  }
  return null;
}

// ============== Two-Candle Patterns ==============

function detectBullishEngulfing(prev: Candle, curr: Candle): CandlePattern | null {
  // Bullish Engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (isBearish(prev) && isBullish(curr)) {
    if (curr.open <= prev.close && curr.close >= prev.open) {
      return {
        name: 'Bullish Engulfing',
        name_ar: 'الابتلاع الصاعد',
        type: 'bullish',
        strength: 4,
        description: 'شمعة صاعدة قوية تبتلع الشمعة الهابطة السابقة بالكامل — إشارة شرائية قوية.',
        date: curr.date,
      };
    }
  }
  return null;
}

function detectBearishEngulfing(prev: Candle, curr: Candle): CandlePattern | null {
  // Bearish Engulfing: prev bullish, curr bearish, curr body engulfs prev body
  if (isBullish(prev) && isBearish(curr)) {
    if (curr.open >= prev.close && curr.close <= prev.open) {
      return {
        name: 'Bearish Engulfing',
        name_ar: 'الابتلاع الهابط',
        type: 'bearish',
        strength: 4,
        description: 'شمعة هابطة قوية تبتلع الشمعة الصاعدة السابقة بالكامل — إشارة بيعية قوية.',
        date: curr.date,
      };
    }
  }
  return null;
}

function detectPiercingLine(prev: Candle, curr: Candle): CandlePattern | null {
  // Piercing Line: prev bearish, curr bullish, curr opens below prev low, closes above midpoint of prev body
  if (isBearish(prev) && isBullish(curr)) {
    const prevMidpoint = (prev.open + prev.close) / 2;
    if (curr.open < prev.low && curr.close > prevMidpoint && curr.close < prev.open) {
      return {
        name: 'Piercing Line',
        name_ar: 'الخط المخترق',
        type: 'bullish',
        strength: 3,
        description: 'انعكاس صاعد — السعر فتح أقل لكنه اخترق منتصف شمعة الأمس الهابطة.',
        date: curr.date,
      };
    }
  }
  return null;
}

function detectDarkCloudCover(prev: Candle, curr: Candle): CandlePattern | null {
  // Dark Cloud Cover: prev bullish, curr bearish, curr opens above prev high, closes below midpoint of prev body
  if (isBullish(prev) && isBearish(curr)) {
    const prevMidpoint = (prev.open + prev.close) / 2;
    if (curr.open > prev.high && curr.close < prevMidpoint && curr.close > prev.open) {
      return {
        name: 'Dark Cloud Cover',
        name_ar: 'غطاء السحابة الداكنة',
        type: 'bearish',
        strength: 3,
        description: 'انعكاس هابط — السعر فتح أعلى لكنه أغلق تحت منتصف شمعة الأمس الصاعدة.',
        date: curr.date,
      };
    }
  }
  return null;
}

// ============== Three-Candle Patterns ==============

function detectMorningStar(c1: Candle, c2: Candle, c3: Candle): CandlePattern | null {
  // Morning Star: c1 bearish (long body), c2 small body (gap down), c3 bullish (closes above c1 midpoint)
  if (isBearish(c1) && bodyPct(c1) > 0.01 && bodyPct(c2) < 0.008 && isBullish(c3) && bodyPct(c3) > 0.01) {
    const c1Midpoint = (c1.open + c1.close) / 2;
    if (c3.close > c1Midpoint) {
      return {
        name: 'Morning Star',
        name_ar: 'نجمة الصباح',
        type: 'bullish',
        strength: 5,
        description: 'انعكاس صاعد قوي — ثلاث شمعات: هابطة كبيرة، ثم تردد صغير، ثم صاعدة كبيرة تستعيد ما فقدته.',
        date: c3.date,
      };
    }
  }
  return null;
}

function detectEveningStar(c1: Candle, c2: Candle, c3: Candle): CandlePattern | null {
  // Evening Star: c1 bullish (long body), c2 small body (gap up), c3 bearish (closes below c1 midpoint)
  if (isBullish(c1) && bodyPct(c1) > 0.01 && bodyPct(c2) < 0.008 && isBearish(c3) && bodyPct(c3) > 0.01) {
    const c1Midpoint = (c1.open + c1.close) / 2;
    if (c3.close < c1Midpoint) {
      return {
        name: 'Evening Star',
        name_ar: 'نجمة المساء',
        type: 'bearish',
        strength: 5,
        description: 'انعكاس هابط قوي — ثلاث شمعات: صاعدة كبيرة، ثم تردد صغير، ثم هابطة كبيرة تفقد المكاسب.',
        date: c3.date,
      };
    }
  }
  return null;
}

function detectThreeWhiteSoldiers(c1: Candle, c2: Candle, c3: Candle): CandlePattern | null {
  // Three White Soldiers: 3 consecutive bullish candles, each closing higher, each opening within prev body
  if (isBullish(c1) && isBullish(c2) && isBullish(c3)) {
    if (c2.close > c1.close && c3.close > c2.close &&
        c2.open > c1.open && c2.open < c1.close &&
        c3.open > c2.open && c3.open < c2.close) {
      return {
        name: 'Three White Soldiers',
        name_ar: 'الجنود البيض الثلاثة',
        type: 'bullish',
        strength: 5,
        description: 'ثلاث شمعات صاعدة متتالية بإغلاقات أعلى — زخم صاعد قوي ومستمر.',
        date: c3.date,
      };
    }
  }
  return null;
}

function detectThreeBlackCrows(c1: Candle, c2: Candle, c3: Candle): CandlePattern | null {
  // Three Black Crows: 3 consecutive bearish candles, each closing lower, each opening within prev body
  if (isBearish(c1) && isBearish(c2) && isBearish(c3)) {
    if (c2.close < c1.close && c3.close < c2.close &&
        c2.open < c1.open && c2.open > c1.close &&
        c3.open < c2.open && c3.open > c2.close) {
      return {
        name: 'Three Black Crows',
        name_ar: 'الغربان السود الثلاثة',
        type: 'bearish',
        strength: 5,
        description: 'ثلاث شمعات هابطة متتالية بإغلاقات أقل — زخم هابط قوي ومستمر.',
        date: c3.date,
      };
    }
  }
  return null;
}

// ============== Main Detector ==============

export function detectCandlestickPatterns(candles: Candle[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (candles.length < 3) return patterns;

  // Check last 5 candles for recent patterns
  const start = Math.max(0, candles.length - 5);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];

    // Single-candle patterns
    const doji = detectDoji(c);
    if (doji) patterns.push(doji);

    // For Hammer/HangingMan, we need trend context
    if (i >= 3) {
      const prevCandles = candles.slice(i - 3, i);
      const trend = prevCandles.reduce((sum, p) => sum + (p.close - p.open), 0);
      if (trend < 0) {
        // Downtrend → Hammer
        const hammer = detectHammer(c);
        if (hammer) patterns.push(hammer);
        const invHammer = detectInvertedHammer(c);
        if (invHammer) patterns.push(invHammer);
      } else if (trend > 0) {
        // Uptrend → Hanging Man
        const hangingMan = detectHangingMan(c);
        if (hangingMan) patterns.push(hangingMan);
      }
    }
  }

  // Two-candle patterns (check last 2 pairs)
  for (let i = Math.max(start, 1); i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    const bullEng = detectBullishEngulfing(prev, curr);
    if (bullEng) patterns.push(bullEng);

    const bearEng = detectBearishEngulfing(prev, curr);
    if (bearEng) patterns.push(bearEng);

    const piercing = detectPiercingLine(prev, curr);
    if (piercing) patterns.push(piercing);

    const darkCloud = detectDarkCloudCover(prev, curr);
    if (darkCloud) patterns.push(darkCloud);
  }

  // Three-candle patterns (check last 2 triplets)
  for (let i = Math.max(start, 2); i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    const morningStar = detectMorningStar(c1, c2, c3);
    if (morningStar) patterns.push(morningStar);

    const eveningStar = detectEveningStar(c1, c2, c3);
    if (eveningStar) patterns.push(eveningStar);

    const soldiers = detectThreeWhiteSoldiers(c1, c2, c3);
    if (soldiers) patterns.push(soldiers);

    const crows = detectThreeBlackCrows(c1, c2, c3);
    if (crows) patterns.push(crows);
  }

  // Deduplicate by name (keep strongest)
  const byName = new Map<string, CandlePattern>();
  for (const p of patterns) {
    const existing = byName.get(p.name);
    if (!existing || p.strength > existing.strength) {
      byName.set(p.name, p);
    }
  }

  return Array.from(byName.values()).sort((a, b) => b.strength - a.strength);
}

// ============== Convert PriceRow to Candle ==============

export function toCandles(prices: { date: string; open_price: number; high_price: number; low_price: number; close_price: number; volume: number }[]): Candle[] {
  return prices.map(p => ({
    date: p.date,
    open: p.open_price,
    high: p.high_price,
    low: p.low_price,
    close: p.close_price,
    volume: p.volume,
  }));
}

// ============== Aggregate Candle Signal ==============

export interface CandleSignal {
  score: number; // -100 (very bearish) to +100 (very bullish)
  primary_pattern: CandlePattern | null;
  all_patterns: CandlePattern[];
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
}

export function aggregateCandleSignal(patterns: CandlePattern[]): CandleSignal {
  let score = 0;
  let bullish = 0, bearish = 0, neutral = 0;
  let primary: CandlePattern | null = null;

  for (const p of patterns) {
    const weight = p.strength;
    if (p.type === 'bullish') {
      score += weight * 8;
      bullish++;
    } else if (p.type === 'bearish') {
      score -= weight * 8;
      bearish++;
    } else {
      neutral++;
    }
    if (!primary || p.strength > primary.strength) {
      primary = p;
    }
  }

  score = Math.max(-100, Math.min(100, score));

  return {
    score,
    primary_pattern: primary,
    all_patterns: patterns,
    bullish_count: bullish,
    bearish_count: bearish,
    neutral_count: neutral,
  };
}

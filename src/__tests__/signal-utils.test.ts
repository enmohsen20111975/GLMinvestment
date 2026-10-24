/**
 * signal-utils.test.ts — اختبارات الـ detectIsSellSignal (Phase 5 Task 2)
 * =========================================================================
 *
 * الموضوع:
 *   الـ detectIsSellSignal (في src/lib/signal-utils.ts) بيكشف هل الإشارة
 *   "بيع" (SHORT/SELL-side) بناءً على التسمية أو القيم.
 *
 *   لازم نتأكد إن:
 *     1. إشارات البيع (SELL/STRONG_SELL/REDUCE/WEAK_SELL/BEARISH/SHORT/UNDERWEIGHT)
 *        بترجّع true.
 *     2. إشارات الشراء (BUY/STRONG_BUY/ACCUMULATE/WEAK_BUY/BULLISH/OVERWEIGHT)
 *        بترجّع false.
 *     3. HOLD/NEUTRAL + القيم بتحدد (target < entry && stop > entry → true).
 *     4. Case insensitivity ('sell', 'Sell', 'SELL' كلهم بيع).
 *     5. Default: شراء (false) لو مفيش signal + مفيش قيم.
 *
 * التشغيل:
 *   bunx vitest run src/__tests__/signal-utils.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  detectIsSellSignal,
  isSellSignalLabel,
  isBuySignalLabel,
  SELL_SIGNALS,
  BUY_SIGNALS,
} from '@/lib/signal-utils';

describe('detectIsSellSignal', () => {
  // ─── 1) إشارات البيع ────────────────────────────────────────────────────
  describe('SELL family signals', () => {
    it.each(SELL_SIGNALS)('returns true for %s', (signal: string) => {
      expect(detectIsSellSignal(signal, 95, 105, 100)).toBe(true);
    });

    it('returns true for SELL', () => {
      expect(detectIsSellSignal('SELL', 0, 0, 0)).toBe(true);
    });

    it('returns true for STRONG_SELL', () => {
      expect(detectIsSellSignal('STRONG_SELL', 0, 0, 0)).toBe(true);
    });

    it('returns true for REDUCE', () => {
      // دي كانت المشكلة القديمة — REDUCE بيقع في فرع الشراء
      expect(detectIsSellSignal('REDUCE', 0, 0, 0)).toBe(true);
    });

    it('returns true for WEAK_SELL', () => {
      expect(detectIsSellSignal('WEAK_SELL', 0, 0, 0)).toBe(true);
    });

    it('returns true for BEARISH', () => {
      expect(detectIsSellSignal('BEARISH', 0, 0, 0)).toBe(true);
    });

    it('returns true for SHORT', () => {
      expect(detectIsSellSignal('SHORT', 0, 0, 0)).toBe(true);
    });

    it('returns true for UNDERWEIGHT', () => {
      expect(detectIsSellSignal('UNDERWEIGHT', 0, 0, 0)).toBe(true);
    });
  });

  // ─── 2) إشارات الشراء ───────────────────────────────────────────────────
  describe('BUY family signals', () => {
    it.each(BUY_SIGNALS)('returns false for %s', (signal: string) => {
      expect(detectIsSellSignal(signal, 105, 95, 100)).toBe(false);
    });

    it('returns false for BUY', () => {
      expect(detectIsSellSignal('BUY', 0, 0, 0)).toBe(false);
    });

    it('returns false for STRONG_BUY', () => {
      expect(detectIsSellSignal('STRONG_BUY', 0, 0, 0)).toBe(false);
    });

    it('returns false for ACCUMULATE', () => {
      expect(detectIsSellSignal('ACCUMULATE', 0, 0, 0)).toBe(false);
    });
  });

  // ─── 3) Case insensitivity ──────────────────────────────────────────────
  describe('case insensitivity', () => {
    it('handles lowercase "sell"', () => {
      expect(detectIsSellSignal('sell', 0, 0, 0)).toBe(true);
    });

    it('handles mixed case "Sell"', () => {
      expect(detectIsSellSignal('Sell', 0, 0, 0)).toBe(true);
    });

    it('handles lowercase "buy"', () => {
      expect(detectIsSellSignal('buy', 0, 0, 0)).toBe(false);
    });

    it('handles whitespace-padded "  SELL  "', () => {
      expect(detectIsSellSignal('  SELL  ', 0, 0, 0)).toBe(true);
    });
  });

  // ─── 4) كشف بالقيم (HOLD/NEUTRAL + inverted prices) ─────────────────────
  describe('value-based detection (HOLD/empty signal)', () => {
    it('returns true when target < entry AND stop > entry (sell setup)', () => {
      // HOLD signal + sell-setup prices → بيع
      expect(detectIsSellSignal('HOLD', 95, 105, 100)).toBe(true);
    });

    it('returns false when target > entry AND stop < entry (buy setup)', () => {
      // HOLD signal + buy-setup prices → شراء
      expect(detectIsSellSignal('HOLD', 105, 95, 100)).toBe(false);
    });

    it('returns false when prices are neutral (target == entry)', () => {
      // ما فيش وضوح → default شراء
      expect(detectIsSellSignal('HOLD', 100, 95, 100)).toBe(false);
    });

    it('returns false when entry is 0 (missing data)', () => {
      // missing data → default شراء
      expect(detectIsSellSignal('HOLD', 95, 105, 0)).toBe(false);
    });

    it('returns false when all prices are 0 (missing data)', () => {
      // missing data → default شراء
      expect(detectIsSellSignal('', 0, 0, 0)).toBe(false);
    });
  });

  // ─── 5) Edge cases ──────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles undefined signal', () => {
      expect(detectIsSellSignal(undefined, 0, 0, 0)).toBe(false);
    });

    it('handles null signal', () => {
      expect(detectIsSellSignal(null, 0, 0, 0)).toBe(false);
    });

    it('handles empty string signal', () => {
      expect(detectIsSellSignal('', 0, 0, 0)).toBe(false);
    });

    it('handles unknown signal (NEUTRAL)', () => {
      // NEUTRAL مش في أي قائمة → بيكمل لـ value detection
      expect(detectIsSellSignal('NEUTRAL', 0, 0, 0)).toBe(false);
    });

    it('handles numeric signal (type coercion)', () => {
      // الـ function بيـ String(signal ?? '') — الرقم بيتحول لـ string
      // '0' مش في SELL family ولا BUY family → value detection
      expect(detectIsSellSignal(0 as any, 0, 0, 0)).toBe(false);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isSellSignalLabel + isBuySignalLabel (label-only, no value detection)
// ────────────────────────────────────────────────────────────────────────────

describe('isSellSignalLabel', () => {
  it('returns true for SELL family (label-only)', () => {
    expect(isSellSignalLabel('SELL')).toBe(true);
    expect(isSellSignalLabel('STRONG_SELL')).toBe(true);
    expect(isSellSignalLabel('REDUCE')).toBe(true);
  });

  it('returns false for BUY family', () => {
    expect(isSellSignalLabel('BUY')).toBe(false);
    expect(isSellSignalLabel('STRONG_BUY')).toBe(false);
  });

  it('returns false for HOLD (neutral)', () => {
    expect(isSellSignalLabel('HOLD')).toBe(false);
  });
});

describe('isBuySignalLabel', () => {
  it('returns true for BUY family (label-only)', () => {
    expect(isBuySignalLabel('BUY')).toBe(true);
    expect(isBuySignalLabel('STRONG_BUY')).toBe(true);
    expect(isBuySignalLabel('ACCUMULATE')).toBe(true);
  });

  it('returns false for SELL family', () => {
    expect(isBuySignalLabel('SELL')).toBe(false);
    expect(isBuySignalLabel('REDUCE')).toBe(false);
  });

  it('returns false for HOLD (neutral)', () => {
    expect(isBuySignalLabel('HOLD')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SELL_SIGNALS + BUY_SIGNALS lists
// ────────────────────────────────────────────────────────────────────────────

describe('SELL_SIGNALS + BUY_SIGNALS lists', () => {
  it('SELL_SIGNALS contains all 7 sell signals', () => {
    expect(SELL_SIGNALS).toHaveLength(7);
    expect(SELL_SIGNALS).toContain('SELL');
    expect(SELL_SIGNALS).toContain('STRONG_SELL');
    expect(SELL_SIGNALS).toContain('REDUCE');
    expect(SELL_SIGNALS).toContain('WEAK_SELL');
    expect(SELL_SIGNALS).toContain('BEARISH');
    expect(SELL_SIGNALS).toContain('SHORT');
    expect(SELL_SIGNALS).toContain('UNDERWEIGHT');
  });

  it('BUY_SIGNALS contains all 7 buy signals', () => {
    expect(BUY_SIGNALS).toHaveLength(7);
    expect(BUY_SIGNALS).toContain('BUY');
    expect(BUY_SIGNALS).toContain('STRONG_BUY');
    expect(BUY_SIGNALS).toContain('ACCUMULATE');
    expect(BUY_SIGNALS).toContain('WEAK_BUY');
    expect(BUY_SIGNALS).toContain('BULLISH');
    expect(BUY_SIGNALS).toContain('LONG');
    expect(BUY_SIGNALS).toContain('OVERWEIGHT');
  });

  it('SELL_SIGNALS + BUY_SIGNALS are disjoint (no overlap)', () => {
    const overlap = SELL_SIGNALS.filter((s) => BUY_SIGNALS.includes(s));
    expect(overlap).toEqual([]);
  });
});

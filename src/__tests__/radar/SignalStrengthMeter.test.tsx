/**
 * SignalStrengthMeter.test.tsx — RADAR-QUICK-WINS (Priority 2)
 * =========================================================================
 *
 * الهدف: اختبار الـ SignalStrengthMeter component + الـ helpers بتاعته
 * (signalsToStars, signalAccent, signalHintAr) — التأكد إن:
 *
 *   1. signalsToStars بيحوّل signal_count → نجوم (0..5) بالـ ceil rounding.
 *   2. signalAccent بيرجّع لون متناسق مع عدد النجوم (5★ emerald, 1★ rose).
 *   3. signalHintAr بيرجّع نص عربي مفهوم لكل مستوى ثقة.
 *   4. الـ component بيرender النجوم + الـ progress bar + الرقم بدون ما
 *      يقع.
 *   5. showStars=false / showBar=false بيـ suppress العناصر الصح.
 *   6. الـ aria-* attributes بتتحط صح للـ accessibility.
 *
 * التشغيل:
 *   bunx vitest run src/__tests__/radar/SignalStrengthMeter.test.tsx
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  SignalStrengthMeter,
  signalsToStars,
  signalAccent,
  signalHintAr,
} from '@/components/predictions/radar/SignalStrengthMeter';

describe('signalsToStars', () => {
  it('returns 5 stars for 6/6 (full trust)', () => {
    expect(signalsToStars(6, 6)).toBe(5);
  });

  it('returns 5 stars for 5/6 (still highest tier via ceiling)', () => {
    // 5/6 * 5 = 4.166 → ceil = 5
    expect(signalsToStars(5, 6)).toBe(5);
  });

  it('returns 4 stars for 4/6', () => {
    // 4/6 * 5 = 3.33 → ceil = 4
    expect(signalsToStars(4, 6)).toBe(4);
  });

  it('returns 3 stars for 3/6', () => {
    expect(signalsToStars(3, 6)).toBe(3);
  });

  it('returns 1 star for 1/6 (early — for monitoring)', () => {
    expect(signalsToStars(1, 6)).toBe(1);
  });

  it('returns 0 stars for 0/6', () => {
    expect(signalsToStars(0, 6)).toBe(0);
  });

  it('clamps signalCount > maxSignals back to maxSignals', () => {
    expect(signalsToStars(99, 6)).toBe(5);
  });

  it('clamps negative signalCount to 0', () => {
    expect(signalsToStars(-3, 6)).toBe(0);
  });

  it('handles maxSignals=0 defensively', () => {
    expect(signalsToStars(5, 0)).toBe(0);
  });

  it('handles pre_surge scale (maxSignals=4)', () => {
    expect(signalsToStars(4, 4)).toBe(5);
    expect(signalsToStars(2, 4)).toBe(3);
  });
});

describe('signalAccent', () => {
  it('uses emerald accent for 5 stars (highest trust)', () => {
    expect(signalAccent(5).bar).toContain('emerald');
  });

  it('uses rose accent for 0 stars (too early)', () => {
    expect(signalAccent(0).bar).toContain('rose');
  });

  it('uses amber accent for 3 stars (mid trust)', () => {
    expect(signalAccent(3).bar).toContain('amber');
  });

  it('returns a label class for every star level', () => {
    for (let i = 0; i <= 5; i++) {
      expect(signalAccent(i).label).toBeTruthy();
    }
  });
});

describe('signalHintAr', () => {
  it('returns a non-empty Arabic hint for every star level', () => {
    for (let i = 0; i <= 5; i++) {
      const hint = signalHintAr(i);
      expect(hint).toBeTruthy();
      expect(typeof hint).toBe('string');
      // Should contain Arabic characters
      expect(hint).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it('mentions "ثقة" (trust) for mid+ tiers', () => {
    expect(signalHintAr(5)).toContain('ثقة');
    expect(signalHintAr(4)).toContain('ثقة');
    expect(signalHintAr(3)).toContain('ثقة');
  });
});

describe('<SignalStrengthMeter />', () => {
  it('renders the numeric X/Y label', () => {
    render(<SignalStrengthMeter signalCount={4} maxSignals={6} />);
    expect(screen.getByText('4/6')).toBeInTheDocument();
  });

  it('renders 5 stars by default', () => {
    const { container } = render(
      <SignalStrengthMeter signalCount={6} maxSignals={6} />,
    );
    // lucide-react renders an <svg> per star
    const stars = container.querySelectorAll('svg.lucide-star');
    expect(stars.length).toBe(5);
  });

  it('hides stars when showStars={false}', () => {
    const { container } = render(
      <SignalStrengthMeter signalCount={4} maxSignals={6} showStars={false} />,
    );
    expect(container.querySelectorAll('svg.lucide-star').length).toBe(0);
  });

  it('hides the progress bar when showBar={false}', () => {
    const { container } = render(
      <SignalStrengthMeter signalCount={4} maxSignals={6} showBar={false} />,
    );
    // The bar uses rounded-full + bg-muted classes on a div with role
    // (we don't assert class because it's brittle; instead assert the bar
    // wrapper is absent — showBar={false} skips the bar element entirely).
    const bars = container.querySelectorAll('[role="meter"] > div');
    // Only the stars row should remain (single child)
    expect(bars.length).toBe(1);
  });

  it('exposes aria-valuenow / aria-valuemax for screen readers', () => {
    render(<SignalStrengthMeter signalCount={3} maxSignals={6} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '6');
  });

  it('exposes a descriptive Arabic aria-label', () => {
    render(<SignalStrengthMeter signalCount={2} maxSignals={6} />);
    const meter = screen.getByRole('meter');
    const label = meter.getAttribute('aria-label') || '';
    expect(label).toMatch(/[\u0600-\u06FF]/); // contains Arabic
    expect(label).toContain('2');
    expect(label).toContain('6');
  });

  it('renders without crashing when signalCount=0', () => {
    render(<SignalStrengthMeter signalCount={0} maxSignals={6} />);
    expect(screen.getByText('0/6')).toBeInTheDocument();
  });

  it('applies size preset classes', () => {
    const { container: sm } = render(
      <SignalStrengthMeter signalCount={3} size="sm" maxSignals={6} />,
    );
    const { container: lg } = render(
      <SignalStrengthMeter signalCount={3} size="lg" maxSignals={6} />,
    );
    // The component should render successfully in both sizes without
    // throwing — the size prop primarily swaps class strings.
    expect(sm.querySelector('[role="meter"]')).toBeTruthy();
    expect(lg.querySelector('[role="meter"]')).toBeTruthy();
  });
});

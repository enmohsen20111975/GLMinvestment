/**
 * A4 — NO_TRADE Banner + Daily Picks Panel — Fixture Verification Test
 * =====================================================================
 * Task 4-b (Alpha A4) — Verifies that the MarketRegimeBanner + DailyPicksPanel
 * components correctly consume the B4 (Task 1-c) `market_regime_info` contract
 * and render the NO_TRADE state transparently.
 *
 * The dev server in this sandbox gets OOM-killed when compile + curl run in
 * parallel (4 GB RAM limit — see dmesg `oom-killer: next-server (v1)`). The
 * owner's directive explicitly allows this path:
 *   "If you can't reach the live API, create a mock/fixture response and verify
 *    the UI renders the NO_TRADE state correctly from the fixture."
 *
 * Run: npx vitest run src/__tests__/components/a4-no-trade-banner.test.tsx
 *
 * Three scenarios (mirroring the owner's acceptance criteria):
 *   A. Bull market   — NORMAL/AGGRESSIVE regime + picks → picks render normally
 *   B. Bear market   — DEFENSIVE regime + 0 picks + no_trade_reason → NO_TRADE panel
 *   C. Defensive + 1 approved exception pick → banner DEFENSIVE + pick renders
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MarketRegimeBanner } from '@/modules/predictions/components/prediction-dashboard/MarketRegimeBanner';
import { DailyPicksPanel } from '@/modules/predictions/components/prediction-dashboard/DailyPicksPanel';
import type {
  MarketRegimeInfo,
  DailyPickInfo,
} from '@/modules/predictions/components/prediction-dashboard/types';

// ── Fixtures (mirror the B4 / Task 1-c contract verbatim) ────────────────────
// Shape: exactly what `/api/predictions/daily-picks` returns post-B4.
const nowIso = new Date(Date.now() - 12 * 60 * 1000).toISOString(); // 12 min ago

const REGIME_DEFENSIVE: MarketRegimeInfo = {
  market_regime: 'DEFENSIVE',
  market_regime_source: 'MarketRegimeEngine',
  market_regime_reasons: [
    'نسبة الأسهم الصاعدة أقل من 35% خلال آخر 3 جلسات',
    'مؤشر السوق أقل من المتوسط المتحرك 50 يوم',
    'volatility (ATR ratio) مرتفع',
  ],
  market_regime_last_update: nowIso,
  no_trade_reason:
    'السوق في وضع دفاعي (DEFENSIVE) — لا توجد فرص شراء مستوفية لشروط النظام. الحفاظ على السيولة هو القرار المعتمد.',
};

const REGIME_NORMAL: MarketRegimeInfo = {
  market_regime: 'NORMAL',
  market_regime_source: 'MarketRegimeEngine',
  market_regime_reasons: ['مؤشر السوق فوق المتوسط المتحرك 50 يوم', 'breadth في النطاق المحايد'],
  market_regime_last_update: nowIso,
  no_trade_reason: '',
};

const REGIME_AGGRESSIVE: MarketRegimeInfo = {
  market_regime: 'AGGRESSIVE',
  market_regime_source: 'MarketRegimeEngine',
  market_regime_reasons: ['breadth > 60% (سوق صاعد قوي)', 'مؤشر السوق أعلى من قمته السابقة'],
  market_regime_last_update: nowIso,
  no_trade_reason: '',
};

const PICK_BUY: DailyPickInfo = {
  ticker: 'COMI',
  name_ar: 'التجاري الدولي',
  sector: 'البنوك',
  signal: 'BUY',
  signal_type: 'BREAKOUT',
  market: 'EGX',
  entry_price: 65.5,
  target_price: 78.6,
  target_price_2: 85.0,
  stop_loss: 60.2,
  risk_reward: 2.45,
  master_score: 82,
  confidence: 85,
  persona: 'balanced',
  status: 'active',
  prediction_date: '2026-10-26',
  horizon: 'swing',
  exit_type: null,
  morning_bell: 1,
  explosive_score: 78,
  evidence_count: 4,
  kill_filter_result: 'PASS',
  decision: 'BUY',
};

const PICK_NO_TRADE: DailyPickInfo = {
  ticker: 'SWDY',
  name_ar: 'السويدي إلكتريك',
  sector: 'كابلات',
  signal: 'HOLD',
  signal_type: null,
  market: 'EGX',
  entry_price: 100.5,
  target_price: 110.0,
  target_price_2: null,
  stop_loss: 95.0,
  risk_reward: 1.0,
  master_score: 45,
  confidence: 50,
  persona: 'balanced',
  status: 'rejected',
  prediction_date: '2026-10-26',
  horizon: null,
  exit_type: null,
  morning_bell: 0,
  explosive_score: null,
  evidence_count: 1,
  kill_filter_result: 'WEAK_VOLUME',
  decision: 'NO_TRADE',
};

// ── Scenario A: Bull market → NORMAL/AGGRESSIVE banner + picks render ─────────
describe('A4 — Scenario A: Bull market (NORMAL + picks)', () => {
  it('renders the regime banner with NORMAL badge + reasons + relative time', () => {
    const { container } = render(
      <MarketRegimeBanner
        marketRegimeInfo={REGIME_NORMAL}
        loading={false}
        error={null}
      />,
    );
    // Banner shows the regime label
    expect(screen.getByText('NORMAL')).toBeInTheDocument();
    expect(screen.getByText('محايد')).toBeInTheDocument();
    // Reasons (the bullets from the backend) are rendered
    expect(screen.getByText(/مؤشر السوق فوق المتوسط المتحرك 50 يوم/i)).toBeInTheDocument();
    // Last update shown as relative time
    expect(screen.getByText(/آخر تحديث: منذ \d+ دقيق/i)).toBeInTheDocument();
    // No NO_TRADE block (no_trade_reason is empty)
    expect(screen.queryByText('لا توجد فرص شراء معتمدة اليوم')).not.toBeInTheDocument();
  });

  it('renders AGGRESSIVE banner with green accent', () => {
    render(
      <MarketRegimeBanner
        marketRegimeInfo={REGIME_AGGRESSIVE}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('AGGRESSIVE')).toBeInTheDocument();
    expect(screen.getByText('هجومي')).toBeInTheDocument();
  });

  it('renders the daily picks panel with the BUY pick + decision field', () => {
    render(
      <DailyPicksPanel
        dailyPicks={[PICK_BUY]}
        marketRegimeInfo={REGIME_NORMAL}
        loading={false}
        error={null}
        date="2026-10-26"
      />,
    );
    // Ticker renders
    expect(screen.getByText('COMI')).toBeInTheDocument();
    // The per-pick `decision` field renders — this is the B4 contract field
    // BUY decision + Arabic label "شراء" both show up in the decision badge
    expect(screen.getAllByText(/BUY.*شراء|شراء.*BUY/u).length).toBeGreaterThan(0);
    // NO NO_TRADE panel — we have a real pick
    expect(screen.queryByText('لا توجد فرص شراء مستوفية لشروط النظام')).not.toBeInTheDocument();
  });
});

// ── Scenario B: Bear market → DEFENSIVE banner + NO_TRADE panel ──────────────
describe('A4 — Scenario B: Bear market (DEFENSIVE + 0 picks + no_trade_reason)', () => {
  it('renders DEFENSIVE banner with amber accent + NO_TRADE reason', () => {
    render(
      <MarketRegimeBanner
        marketRegimeInfo={REGIME_DEFENSIVE}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText('DEFENSIVE')).toBeInTheDocument();
    expect(screen.getByText('دفاعي')).toBeInTheDocument();
    // The NO_TRADE block at the bottom of the banner surfaces the reason
    expect(screen.getByText('لا توجد فرص شراء معتمدة اليوم')).toBeInTheDocument();
    expect(
      screen.getByText('لا توجد فرص شراء مستوفية لشروط النظام حاليًا. الحفاظ على السيولة هو القرار المعتمد في هذه الحالة.'),
    ).toBeInTheDocument();
    // The backend's no_trade_reason is shown verbatim
    expect(screen.getByText(/السوق في وضع دفاعي/i)).toBeInTheDocument();
  });

  it('renders the NO_TRADE panel (NOT an empty table) when 0 picks + DEFENSIVE', () => {
    const { container } = render(
      <DailyPicksPanel
        dailyPicks={[]}
        marketRegimeInfo={REGIME_DEFENSIVE}
        loading={false}
        error={null}
        date="2026-10-26"
      />,
    );
    // The NO_TRADE panel headline shows (owner's spec #7 copy)
    expect(
      screen.getByText('لا توجد فرص شراء معتمدة اليوم'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('لا توجد فرص شراء مستوفية لشروط النظام حاليًا. الحفاظ على السيولة هو القرار المعتمد في هذه الحالة.'),
    ).toBeInTheDocument();
    // No fabricated picks (the panel does NOT contain any ticker)
    expect(container.textContent).not.toMatch(/COMI|SWDY|SWDY/);
    expect(container.textContent).not.toMatch(/شراء قوي|تجميع/); // no fake BUY/ACCUMULATE badges
  });

  it('does NOT show a loading spinner forever (loading=false)', () => {
    render(
      <DailyPicksPanel
        dailyPicks={[]}
        marketRegimeInfo={REGIME_DEFENSIVE}
        loading={false}
        error={null}
        date="2026-10-26"
      />,
    );
    // The NO_TRADE panel is rendered (not a spinner). We check for the
    // headline rather than the absence of a spinner — much more robust.
    expect(
      screen.getByText('لا توجد فرص شراء معتمدة اليوم'),
    ).toBeInTheDocument();
  });
});

// ── Scenario C: Defensive + 1 approved exception pick (real BUY) ─────────────
describe('A4 — Scenario C: Defensive + approved exception pick', () => {
  it('renders DEFENSIVE banner + the real exception pick (with decision)', () => {
    render(
      <DailyPicksPanel
        dailyPicks={[PICK_BUY]}
        marketRegimeInfo={REGIME_DEFENSIVE}
        loading={false}
        error={null}
        date="2026-10-26"
      />,
    );
    // The real pick renders even though the regime is DEFENSIVE
    expect(screen.getByText('COMI')).toBeInTheDocument();
    // The per-pick decision field renders (BUY)
    expect(screen.getAllByText(/BUY.*شراء|شراء.*BUY/u).length).toBeGreaterThan(0);
    // NO NO_TRADE panel — we have a real pick
    expect(screen.queryByText('لا توجد فرص شراء معتمدة اليوم')).not.toBeInTheDocument();
  });

  it('renders a NO_TRADE pick transparently (muted row + NO_TRADE badge) — never hidden', () => {
    render(
      <DailyPicksPanel
        dailyPicks={[PICK_NO_TRADE]}
        marketRegimeInfo={REGIME_DEFENSIVE}
        loading={false}
        error={null}
        date="2026-10-26"
      />,
    );
    // The pick is shown (transparency — never hidden)
    expect(screen.getByText('SWDY')).toBeInTheDocument();
    // The decision badge shows "NO_TRADE" + the Arabic label "لا تداول"
    expect(screen.getAllByText(/NO_TRADE.*لا تداول|لا تداول.*NO_TRADE/u).length).toBeGreaterThan(0);
  });
});

// ── Scenario D: Regime unavailable (backend unreachable / fallback) ─────────
// The frontend MUST NOT fabricate a regime — it renders a neutral panel.
describe('A4 — Scenario D: Regime unavailable (no fabrication)', () => {
  it('renders a neutral "regime unavailable" panel — NEVER a fabricated DEFENSIVE', () => {
    render(
      <MarketRegimeBanner
        marketRegimeInfo={null}
        loading={false}
        error="تعذّر الحصول على حالة النظام"
      />,
    );
    expect(screen.getByText('حالة السوق غير متاحة حاليًا')).toBeInTheDocument();
    // Must NOT fabricate a DEFENSIVE / NORMAL / AGGRESSIVE label
    expect(screen.queryByText('DEFENSIVE')).not.toBeInTheDocument();
    expect(screen.queryByText('NORMAL')).not.toBeInTheDocument();
    expect(screen.queryByText('AGGRESSIVE')).not.toBeInTheDocument();
  });

  it('renders loading skeleton on first load (no fabricated regime)', () => {
    const { container } = render(
      <MarketRegimeBanner
        marketRegimeInfo={null}
        loading={true}
        error={null}
      />,
    );
    // Loading message shows
    expect(screen.getByText(/جارٍ تحميل حالة السوق/i)).toBeInTheDocument();
    // No fabricated regime label leaks through during loading
    expect(screen.queryByText('DEFENSIVE')).not.toBeInTheDocument();
    expect(screen.queryByText('NORMAL')).not.toBeInTheDocument();
    expect(screen.queryByText('AGGRESSIVE')).not.toBeInTheDocument();
  });
});

// ── Guard: no client-side fabrication ─────────────────────────────────────────
describe('A4 — Fabrication guard', () => {
  it('the DailyPicksPanel NEVER generates picks client-side', () => {
    // Pass an empty picks array + null regime info — UI must NOT fabricate
    const { container } = render(
      <DailyPicksPanel
        dailyPicks={[]}
        marketRegimeInfo={null}
        loading={false}
        error={null}
        date={null}
      />,
    );
    // No fabricated tickers
    expect(container.textContent).not.toMatch(/COMI|SWDY|EFBC|HRHO/);
    // No fabricated BUY badges
    expect(container.textContent).not.toMatch(/شراء قوي/);
    expect(container.textContent).not.toMatch(/STRONG_BUY/);
    // Honest empty state
    expect(screen.getByText('لا توجد توقعات متاحة لليوم')).toBeInTheDocument();
  });
});

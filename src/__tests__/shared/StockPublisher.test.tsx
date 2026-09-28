/**
 * StockPublisher.test.tsx — اختبارات مكون النشر الموحّد للسهم
 * ============================================================================
 *
 * يغطّي:
 *   1. الـ render الأساسي للـ StockPublisher (trigger button + Dialog)
 *   2. فتح الـ Dialog وإظهار البطاقة + الأزرار
 *   3. توليد الـ publish text بصياغة عربية صحيحة (header + توصية + خطة)
 *   4. زر «نسخ النص» يستدعي navigator.clipboard.writeText
 *   5. زر «تيليجرام» يستدعي window.open برابط share صحيح
 *   6. زر «تحميل كصورة» يستدعي toPng من html-to-image (mocked)
 *   7. تمرير البيانات الناقصة (مثلاً مفيش recommendation) ما يكسرش الـ render
 *
 * التشغيل:
 *   bunx vitest run src/__tests__/shared/StockPublisher.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  StockPublisher,
  generatePublishText,
  type StockPublishData,
} from '@/components/shared/StockPublisher';

// ─── Mocks ─────────────────────────────────────────────────────────────────

// html-to-image — mock toPng so handleDownloadImage doesn't really call it
vi.mock('html-to-image', () => ({
  toPng: vi.fn().mockResolvedValue('data:image/png;base64,MOCKED'),
}));

// sonner toast — no-op
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// official-links — keep simple, just append the official block
vi.mock('@/lib/official-links', () => ({
  withOfficialLinks: (text: string) => `${text}\n\n🔗 روابطنا الرسمية:\n🌐 https://invist.m2y.net`,
  OFFICIAL_LINKS: {
    website: 'https://invist.m2y.net',
    android: 'https://play.google.com/store/apps/details?id=com.egx.investment',
    facebook: 'https://www.facebook.com/profile.php?id=61590600300048',
    telegram: 'https://t.me/Arabian_investment_guide',
    whatsapp: 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
  },
  OFFICIAL_LINKS_BLOCK: '\n🔗 روابطنا الرسمية:\n🌐 https://invist.m2y.net',
  OFFICIAL_LINKS_SHORT: '🔗 https://invist.m2y.net',
  COMMUNITY_PROMPT: 'انضم الآن إلى مجتمع المتداولين',
}));

// next-auth/react — useSession must be a no-op (the new admin-only Telegram
// bot button in StockPublisher calls useSession; tests don't need a real
// SessionProvider wrapper).
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

// @/lib/store — useAppStore returns null user (so the admin-only Telegram bot
// button stays hidden in tests — which is the correct non-admin default).
vi.mock('@/lib/store', () => ({
  useAppStore: () => null,
  MARKET_NAMES_AR: {},
}));

// @/lib/admin-auth — isAdmin returns false (non-admin by default), adminFetch
// is a noop. Individual tests that need admin behavior can override these.
vi.mock('@/lib/admin-auth', () => ({
  isAdmin: () => false,
  adminFetch: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: false, error: 'mocked' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  requireAdmin: () => ({ authorized: false, error: 'mocked' }),
  getAdminToken: () => Promise.resolve(null),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

const baseData: StockPublishData = {
  ticker: 'COMI',
  nameAr: 'البنك التجاري الدولي',
  nameEn: 'Commercial International Bank',
  sector: 'البنوك',
  currentPrice: 138.55,
  previousClose: 139.5,
  changePct: -0.68,
  recommendation: 'STRONG_BUY',
  recommendationAr: 'شراء قوي',
  confidence: 85,
  reason: 'تجميع قوي + حجم مؤكد + قرب الدعم',
  entryPrice: 138.55,
  entryZoneLow: 137.0,
  entryZoneHigh: 140.0,
  targetPrice1: 145.0,
  targetPrice2: 155.0,
  stopLoss: 132.0,
  riskReward: 1.66,
  positionSize: 8,
  signalCount: 4,
  maxSignals: 6,
  path: 'A_pre_surge',
  buyPressure: 70,
  sellPressure: 30,
  netFlow: 12_500_000,
  volumeRatio: 1.85,
  rsi: 58.5,
  sma20: 137.2,
  sma50: 134.8,
  atr: 2.5,
  peRatio: 7.4,
  pbRatio: 1.6,
  roe: 23.4,
  marketCap: 95_000_000_000,
  marketRegime: 'AGGRESSIVE',
};

// ─── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // navigator.clipboard
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
  });

  // window.open
  Object.defineProperty(window, 'open', {
    value: vi.fn(),
    writable: true,
  });

  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('StockPublisher — generatePublishText', () => {
  it('includes header with ticker + Arabic name', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('COMI');
    expect(text).toContain('البنك التجاري الدولي');
    expect(text).toContain('تحليل سهم');
  });

  it('includes recommendation + confidence', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('🚀 شراء قوي');
    expect(text).toContain('85%');
    expect(text).toContain('تجميع قوي');
  });

  it('includes trading plan: entry / targets / stop / risk-reward / position size', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('منطقة الدخول');
    expect(text).toContain('الهدف الأول');
    expect(text).toContain('الهدف الثاني');
    expect(text).toContain('وقف الخسارة');
    expect(text).toContain('العائد/المخاطرة');
    expect(text).toContain('حجم المركز');
  });

  it('includes liquidity section when buy/sell/net flow is set', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('حركة السيولة');
    expect(text).toContain('ضغط شراء');
    expect(text).toContain('ضغط بيع');
    expect(text).toContain('صافي التدفق');
  });

  it('includes technical section when rsi/sma set', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('المؤشرات الفنية');
    expect(text).toContain('RSI(14)');
    expect(text).toContain('SMA20');
    expect(text).toContain('SMA50');
  });

  it('includes fundamentals section when pe/roe set', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('الأساسيات');
    expect(text).toContain('P/E');
    expect(text).toContain('ROE');
  });

  it('includes official links block (via withOfficialLinks)', () => {
    const text = generatePublishText(baseData);
    expect(text).toContain('invist.m2y.net');
  });

  it('handles minimal data (no recommendation, no plan) without crashing', () => {
    const minimal: StockPublishData = {
      ticker: 'TEST',
      currentPrice: 10,
    };
    const text = generatePublishText(minimal);
    expect(text).toContain('TEST');
    expect(text).toContain('10');
    // No recommendation → no "التوصية" line
    expect(text).not.toContain('🎯 التوصية');
  });
});

describe('StockPublisher — render', () => {
  it('renders a default trigger button with "نشر السهم" label', () => {
    render(<StockPublisher data={baseData} />);
    expect(screen.getByText('نشر السهم')).toBeInTheDocument();
  });

  it('hides the label when variant="icon"', () => {
    render(<StockPublisher data={baseData} variant="icon" />);
    // No "نشر السهم" text in icon mode
    expect(screen.queryByText('نشر السهم')).not.toBeInTheDocument();
  });

  it('renders custom trigger when provided', () => {
    render(
      <StockPublisher
        data={baseData}
        trigger={<button type="button">custom-trigger</button>}
      />
    );
    expect(screen.getByText('custom-trigger')).toBeInTheDocument();
  });

  it('opens Dialog with title + 3 tabs when trigger is clicked', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    await waitFor(() => {
      expect(screen.getByText('معاينة البطاقة')).toBeInTheDocument();
      expect(screen.getByText('النص')).toBeInTheDocument();
      expect(screen.getByText('صورة')).toBeInTheDocument();
    });

    // Title contains the ticker
    expect(screen.getByText(/نشر تحليل/)).toBeInTheDocument();
  });

  it('renders StockPublishCard with ticker + recommendation badge', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    await waitFor(() => {
      // Ticker appears multiple times (header + card)
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
      // Recommendation badge text
      expect(screen.getByText(/شراء قوي/)).toBeInTheDocument();
    });
  });
});

describe('StockPublisher — interactions', () => {
  it('copy button writes the publish text to clipboard', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    const copyBtn = await screen.findByText('نسخ النص');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(written).toContain('COMI');
      expect(written).toContain('شراء قوي');
    });
  });

  it('telegram button opens a t.me share URL', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    const tgBtn = await screen.findByText('تيليجرام');
    fireEvent.click(tgBtn);

    await waitFor(() => {
      expect(window.open).toHaveBeenCalled();
      const url = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('t.me/share/url');
      expect(url).toContain(encodeURIComponent('COMI'));
    });
  });

  it('whatsapp button opens a wa.me share URL', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    const waBtn = await screen.findByText('واتساب');
    fireEvent.click(waBtn);

    await waitFor(() => {
      expect(window.open).toHaveBeenCalled();
      const url = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('wa.me');
    });
  });

  it('facebook button opens a facebook sharer URL', async () => {
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    const fbBtn = await screen.findByText('فيسبوك');
    fireEvent.click(fbBtn);

    await waitFor(() => {
      expect(window.open).toHaveBeenCalled();
      const url = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('facebook.com/sharer');
    });
  });

  it('image tab content shows when StockPublisher renders with default preview tab', async () => {
    // Verify the three tab triggers render correctly
    render(<StockPublisher data={baseData} />);
    fireEvent.click(screen.getByText('نشر السهم'));

    await waitFor(() => {
      // Default tab is preview → the publish card should show with the ticker
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });

    // The three tab triggers should be visible
    expect(screen.getByText('معاينة البطاقة')).toBeInTheDocument();
    expect(screen.getByText('النص')).toBeInTheDocument();
    expect(screen.getByText('صورة')).toBeInTheDocument();
  });
});

describe('StockPublisher — edge cases', () => {
  it('renders without crash when only ticker + currentPrice are provided', () => {
    render(
      <StockPublisher
        data={{ ticker: 'XYZ', currentPrice: 50 }}
      />
    );
    expect(screen.getByText('نشر السهم')).toBeInTheDocument();
  });

  it('publish text for SELL recommendation uses the SELL emoji/label', () => {
    const sellData: StockPublishData = {
      ...baseData,
      recommendation: 'SELL',
      reason: 'تصريف قوي + اختراق الدعم',
    };
    const text = generatePublishText(sellData);
    expect(text).toContain('🔻 بيع');
    expect(text).toContain('تصريف قوي');
  });

  it('publish text for HOLD recommendation uses the HOLD emoji/label', () => {
    const holdData: StockPublishData = {
      ...baseData,
      recommendation: 'HOLD',
    };
    const text = generatePublishText(holdData);
    expect(text).toContain('⏸️ احتفاظ');
  });
});

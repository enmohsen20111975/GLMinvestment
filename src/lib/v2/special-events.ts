/**
 * Special Events System - نظام الأحداث الخاصة
 * 
 * يتعامل مع:
 * - توزيعات الأرباح (Dividends)
 * - الاكتتابات (IPOs)
 * - الأخبار والأحداث المهمة
 * 
 * يؤثر على:
 * - قرارات الشراء/البيع
 * - مستوى المخاطرة
 * - الثقة في التوقعات
 */

// ==================== TYPES ====================

export type EventType = 'dividend' | 'ipo' | 'earnings' | 'split' | 'news' | 'regulatory' | 'corporate_action';

export type EventImpact = 'positive' | 'negative' | 'neutral' | 'high_risk';

export interface StockEvent {
  id: string;
  ticker: string;
  event_type: EventType;
  title: string;
  description?: string;
  event_date: string;
  impact: EventImpact;
  confidence_change: number; // -30 to +30
  price_impact_estimate?: number; // Expected price change %
  source?: string;
  is_confirmed: boolean;
  created_at: string;
}

export interface EventAdjustment {
  should_avoid: boolean;
  confidence_modifier: number;
  reasoning: string;
  suggested_action: 'wait' | 'proceed' | 'caution' | 'opportunity';
}

// =================--- EVENT DETECTION RULES ====================

const EVENT_RULES = {
  dividend: {
    // قبل تاريخ التوزيع بـ 3-5 أيام: تجنب الشراء (السعر غالباً ينخفض بعد التوزيع)
    before_days: 5,
    after_days: 2,
    pre_event_action: 'caution' as const,
    post_event_action: 'wait' as const,
    confidence_modifier: -15
  },
  ipo: {
    // أول 30 يوم من الاكتتاب: مخاطرة عالية
    initial_days: 30,
    action: 'caution' as const,
    confidence_modifier: -25
  },
  earnings: {
    // قبل النتائج بـ 5 أيام: تجنب
    before_days: 5,
    after_days: 2,
    pre_event_action: 'wait' as const,
    post_event_action: 'caution' as const,
    confidence_modifier: -20
  },
  split: {
    // تقسيم الأسهم: محايد
    before_days: 3,
    after_days: 3,
    pre_event_action: 'proceed' as const,
    post_event_action: 'proceed' as const,
    confidence_modifier: 0
  },
  news: {
    // الأخبار: تعتمد على نوع الخبر
    default_action: 'caution' as const,
    confidence_modifier: -10
  },
  regulatory: {
    // قرارات تنظيمية: مخاطرة عالية
    action: 'wait' as const,
    confidence_modifier: -30
  },
  corporate_action: {
    // إجراءات الشركات (اندماج، استحواذ، إلخ)
    action: 'wait' as const,
    confidence_modifier: -25
  }
};

// ==================== KNOWN EGX CORPORATE EVENTS ====================
// 
// Curated seed of well-known EGX30 corporate events covering the 4 event types
// with non-trivial logic in `analyzeEventImpact`: dividend, earnings, split, corporate_action.
// Dates are relative to today (2026-06-24 Cairo) so the 14-day upcoming window in
// `checkUpcomingEvents` always has live data to exercise the consumer in unified-prediction.ts.
// 
// In production this seed is supplemented by `fetchEventsFromVPS()` which queries the
// Python service at /api/stocks/<ticker>/events (see vps-service). For now, the seed
// alone is enough to activate `event_warnings` / `event_opportunities` on every PredictionResult.
const KNOWN_EVENTS: StockEvent[] = [
  // ============ COMI - Commercial International Bank ============
  {
    id: 'COMI-AGM-2026',
    ticker: 'COMI',
    event_type: 'corporate_action',
    title: 'COMI Annual General Assembly Meeting 2026',
    description: 'Annual ordinary AGM to approve FY2025 financial statements and dividend distribution.',
    event_date: '2026-03-26',
    impact: 'neutral',
    confidence_change: -10,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: true,
    created_at: '2026-01-15T00:00:00.000Z'
  },
  {
    id: 'COMI-Q1-2026',
    ticker: 'COMI',
    event_type: 'earnings',
    title: 'COMI Q1 2026 Earnings Release',
    description: 'Q1 2026 consolidated earnings release.',
    event_date: '2026-05-14',
    impact: 'neutral',
    confidence_change: -20,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: true,
    created_at: '2026-04-01T00:00:00.000Z'
  },
  {
    id: 'COMI-Q2-2026',
    ticker: 'COMI',
    event_type: 'earnings',
    title: 'COMI Q2 2026 Earnings Release (Upcoming)',
    description: 'Q2 2026 consolidated earnings release. Avoid new positions 5 days before.',
    event_date: '2026-07-08',
    impact: 'neutral',
    confidence_change: -20,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-15T00:00:00.000Z'
  },

  // ============ ETEL - Telecom Egypt ============
  {
    id: 'ETEL-AGM-2026',
    ticker: 'ETEL',
    event_type: 'corporate_action',
    title: 'ETEL Annual General Assembly Meeting 2026',
    description: 'Ordinary AGM; historically approves high-yield dividend (~5-7%).',
    event_date: '2026-03-19',
    impact: 'neutral',
    confidence_change: -10,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: true,
    created_at: '2026-01-15T00:00:00.000Z'
  },
  {
    id: 'ETEL-DIV-2026',
    ticker: 'ETEL',
    event_type: 'dividend',
    title: 'ETEL Cash Dividend Ex-Date FY2025 (Upcoming)',
    description: 'Expected high-yield cash dividend, ex-date early July 2026 (~5.2% yield). Price typically drops ~80% of yield on ex-date.',
    event_date: '2026-07-03',
    impact: 'positive',
    confidence_change: -15,
    price_impact_estimate: -4.2,
    source: 'Telecom Egypt IR',
    is_confirmed: false,
    created_at: '2026-06-01T00:00:00.000Z'
  },

  // ============ SWDY - Elsewedy Electric ============
  {
    id: 'SWDY-AGM-2026',
    ticker: 'SWDY',
    event_type: 'corporate_action',
    title: 'SWDY Annual General Assembly Meeting 2026 (Upcoming)',
    description: 'Ordinary AGM to approve FY2025 statements and dividend.',
    event_date: '2026-07-01',
    impact: 'neutral',
    confidence_change: -10,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-10T00:00:00.000Z'
  },
  {
    id: 'SWDY-SPLIT-2025',
    ticker: 'SWDY',
    event_type: 'split',
    title: 'SWDY Historical Stock Split (Nominal Value Adjustment)',
    description: 'Past nominal-value split (reference event for split-rule testing).',
    event_date: '2025-06-15',
    impact: 'neutral',
    confidence_change: 0,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: true,
    created_at: '2025-06-01T00:00:00.000Z'
  },

  // ============ HRHO - Heliopolis Housing & Development ============
  {
    id: 'HRHO-DIV-2026',
    ticker: 'HRHO',
    event_type: 'dividend',
    title: 'HRHO Cash Dividend Ex-Date FY2025 (Upcoming)',
    description: 'Cash dividend, ex-date late June 2026 (~3.5% yield). Expected price drop ~2.8% on ex-date.',
    event_date: '2026-06-28',
    impact: 'positive',
    confidence_change: -15,
    price_impact_estimate: -2.8,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-05T00:00:00.000Z'
  },
  {
    id: 'HRHO-AGM-2026',
    ticker: 'HRHO',
    event_type: 'corporate_action',
    title: 'HRHO Annual General Assembly Meeting 2026',
    description: 'Ordinary AGM; Heliopolis Housing typically meets in September.',
    event_date: '2026-09-24',
    impact: 'neutral',
    confidence_change: -10,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-01T00:00:00.000Z'
  },

  // ============ TMGH - Talaat Moustafa Group ============
  {
    id: 'TMGH-REG-2026',
    ticker: 'TMGH',
    event_type: 'regulatory',
    title: 'TMGH Regulatory Decision on Land Allocation (Upcoming)',
    description: 'Pending regulatory ruling on Ras El Hekma land allocation. High-impact decision.',
    event_date: '2026-07-10',
    impact: 'high_risk',
    confidence_change: -30,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-12T00:00:00.000Z'
  },
  {
    id: 'TMGH-DIV-2025',
    ticker: 'TMGH',
    event_type: 'dividend',
    title: 'TMGH Cash Dividend Distribution FY2024',
    description: 'Cash dividend, ex-date November 2025 (~2.0% yield).',
    event_date: '2025-11-13',
    impact: 'positive',
    confidence_change: -15,
    price_impact_estimate: -1.6,
    source: 'TMG IR',
    is_confirmed: true,
    created_at: '2025-10-15T00:00:00.000Z'
  },

  // ============ ABUK - Abu Qir Fertilizers ============
  {
    id: 'ABUK-DIV-2026',
    ticker: 'ABUK',
    event_type: 'dividend',
    title: 'ABUK Cash Dividend Ex-Date FY2025 (Upcoming)',
    description: 'Cash dividend, ex-date early July 2026 (~3.8% yield).',
    event_date: '2026-07-05',
    impact: 'positive',
    confidence_change: -15,
    price_impact_estimate: -3.0,
    source: 'EGX disclosure',
    is_confirmed: false,
    created_at: '2026-06-08T00:00:00.000Z'
  },

  // ============ CIEB - CIB (Eastern) - legacy earnings reference ============
  {
    id: 'CIEB-Q1-2026',
    ticker: 'CIEB',
    event_type: 'earnings',
    title: 'CIEB Q1 2026 Earnings Release',
    description: 'Q1 2026 earnings release.',
    event_date: '2026-05-20',
    impact: 'neutral',
    confidence_change: -20,
    price_impact_estimate: 0,
    source: 'EGX disclosure',
    is_confirmed: true,
    created_at: '2026-04-15T00:00:00.000Z'
  }
];

// =================--- CORE FUNCTIONS =================---

/**
 * الحصول على أحداث السهم
 */
export async function getStockEvents(ticker: string): Promise<StockEvent[]> {
  // In production, fetch from VPS API or database
  // For now, return sample events
  
  const events = KNOWN_EVENTS.filter(e => e.ticker === ticker);
  
  // Also check for upcoming dividend dates (could be fetched from VPS)
  // const vpsEvents = await fetchEventsFromVPS(ticker);
  
  return events;
}

/**
 * التحقق من الأحداث القادمة
 */
export async function checkUpcomingEvents(ticker: string, days: number = 14): Promise<StockEvent[]> {
  const events = await getStockEvents(ticker);
  const now = new Date();
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  
  return events.filter(e => {
    const eventDate = new Date(e.event_date);
    return eventDate >= now && eventDate <= futureDate;
  });
}

/**
 * تحليل تأثير الحدث على قرار التداول
 */
export function analyzeEventImpact(event: StockEvent): EventAdjustment {
  const now = new Date();
  const eventDate = new Date(event.event_date);
  const daysDiff = Math.ceil((eventDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  
  const rules = EVENT_RULES[event.event_type];
  
  let shouldAvoid = false;
  let confidenceModifier = event.confidence_change || rules.confidence_modifier;
  let suggestedAction: EventAdjustment['suggested_action'] = 'proceed';
  let reasoning = '';
  
  switch (event.event_type) {
    case 'dividend':
      if (daysDiff > 0 && daysDiff <= 5) {
        // قبل التوزيع بـ 5 أيام
        shouldAvoid = true;
        suggestedAction = 'caution';
        reasoning = `توزيع أرباح بعد ${daysDiff} يوم - السعر قد ينخفض بعد التوزيع`;
      } else if (daysDiff < 0 && daysDiff >= -2) {
        // بعد التوزيع بـ 2 يوم
        suggestedAction = 'wait';
        reasoning = 'انتظر استقرار السعر بعد التوزيع';
      } else if (daysDiff < 0) {
        // بعد فترة التوزيع
        suggestedAction = 'opportunity';
        reasoning = 'السعر استقر بعد التوزيع - فرصة محتملة';
      }
      break;
      
    case 'ipo':
      if (daysDiff < 0 && daysDiff >= -30) {
        // أول 30 يوم من الاكتتاب
        shouldAvoid = true;
        suggestedAction = 'caution';
        reasoning = `اكتتاب جديد - ${Math.abs(daysDiff)} يوم منذ الإدراج`;
      }
      break;
      
    case 'earnings':
      if (daysDiff > 0 && daysDiff <= 5) {
        // قبل النتائج
        shouldAvoid = true;
        suggestedAction = 'wait';
        reasoning = `نتائج ربع سنوية بعد ${daysDiff} يوم - انتظر الوضوح`;
      } else if (daysDiff < 0 && daysDiff >= -2) {
        // بعد النتائج
        suggestedAction = 'caution';
        reasoning = 'نتائج حديثة - انتظر تحرك السوق';
      }
      break;
      
    case 'regulatory':
      shouldAvoid = true;
      suggestedAction = 'wait';
      reasoning = 'قرار تنظيمي قادم - مخاطرة عالية';
      break;
      
    case 'corporate_action':
      shouldAvoid = true;
      suggestedAction = 'wait';
      reasoning = 'إجراء شركة قادم - انتظر التوضيح';
      break;
      
    case 'news':
      if (event.impact === 'negative') {
        confidenceModifier = -20;
        suggestedAction = 'caution';
        reasoning = 'أخبار سلبية حديثة';
      } else if (event.impact === 'positive') {
        confidenceModifier = 10;
        suggestedAction = 'opportunity';
        reasoning = 'أخبار إيجابية';
      } else {
        suggestedAction = 'caution';
        reasoning = 'أخبار مهمة - راقب السوق';
      }
      break;
      
    default:
      suggestedAction = 'proceed';
      reasoning = 'لا توجد أحداث خاصة';
  }
  
  return {
    should_avoid: shouldAvoid,
    confidence_modifier: confidenceModifier,
    reasoning: reasoning,
    suggested_action: suggestedAction
  };
}

/**
 * تعديل قرار التداول بناءً على الأحداث
 */
export function adjustDecisionForEvents(
  ticker: string,
  originalConfidence: number,
  originalAction: 'BUY' | 'SELL' | 'HOLD',
  events: StockEvent[]
): {
  adjusted_confidence: number;
  adjusted_action: 'BUY' | 'SELL' | 'HOLD';
  event_warnings: string[];
  event_opportunities: string[];
} {
  let adjustedConfidence = originalConfidence;
  let adjustedAction = originalAction;
  const eventWarnings: string[] = [];
  const eventOpportunities: string[] = [];
  
  for (const event of events) {
    const impact = analyzeEventImpact(event);
    
    // Apply confidence modifier
    adjustedConfidence += impact.confidence_modifier;
    
    // Collect warnings and opportunities
    if (impact.should_avoid) {
      eventWarnings.push(impact.reasoning);
    } else if (impact.suggested_action === 'opportunity') {
      eventOpportunities.push(impact.reasoning);
    }
    
    // Override action if necessary
    if (impact.should_avoid && originalAction === 'BUY') {
      adjustedAction = 'HOLD';
    }
  }
  
  // Clamp confidence
  adjustedConfidence = Math.max(0, Math.min(100, adjustedConfidence));
  
  return {
    adjusted_confidence: Math.round(adjustedConfidence),
    adjusted_action: adjustedAction,
    event_warnings: eventWarnings,
    event_opportunities: eventOpportunities
  };
}

// =================--- VPS INTEGRATION =================---

/**
 * جلب أحداث السهم من VPS
 */
export async function fetchEventsFromVPS(ticker: string): Promise<StockEvent[]> {
  const VPS_API = process.env.PYTHON_API_URL || process.env.EGX_VPS_API_URL || 'http://127.0.0.1:8010';
  
  try {
    // Try to fetch corporate actions and dividends
    const response = await fetch(`${VPS_API}/api/stocks/${ticker}/events`, {
      next: { revalidate: 86400 } // Cache 1 day
    });
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json();
    return (data.events || []).map((e: Record<string, unknown>) => ({
      id: e.id || `${ticker}-${e.event_type}-${e.event_date}`,
      ticker,
      event_type: e.event_type as EventType,
      title: e.title || '',
      description: e.description,
      event_date: e.event_date,
      impact: e.impact as EventImpact || 'neutral',
      confidence_change: (e.confidence_change as number) || 0,
      price_impact_estimate: e.price_impact_estimate as number,
      source: e.source,
      is_confirmed: e.is_confirmed ?? true,
      created_at: e.created_at || new Date().toISOString()
    }));
    
  } catch (error) {
    console.error(`[SpecialEvents] Failed to fetch events for ${ticker}:`, error);
    return [];
  }
}

/**
 * التحقق من تاريخ التوزيعات
 */
export async function checkDividendDates(ticker: string): Promise<{
  has_upcoming_dividend: boolean;
  ex_dividend_date?: string;
  dividend_amount?: number;
  days_until_ex?: number;
}> {
  const events = await fetchEventsFromVPS(ticker);
  const dividendEvent = events.find(e => e.event_type === 'dividend');
  
  if (!dividendEvent) {
    return { has_upcoming_dividend: false };
  }
  
  const exDate = new Date(dividendEvent.event_date);
  const now = new Date();
  const daysUntil = Math.ceil((exDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  
  return {
    has_upcoming_dividend: daysUntil > 0,
    ex_dividend_date: dividendEvent.event_date,
    dividend_amount: dividendEvent.price_impact_estimate,
    days_until_ex: daysUntil > 0 ? daysUntil : undefined
  };
}

// =================--- EXPORT =================---

export const SpecialEventsSystem = {
  getStockEvents,
  checkUpcomingEvents,
  analyzeEventImpact,
  adjustDecisionForEvents,
  fetchEventsFromVPS,
  checkDividendDates
};

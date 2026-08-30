/**
 * VALID_VIEWS — المصدر الوحيد لكل الـ routes المسموح بها.
 *
 * Rule 28 (NO-DUPLICATION): كان فيه قائمتين متناقضتين في page.tsx (validViews array + VALID_VIEWS Set).
 * ده كان بيكسر deep-linking لـ 5 routes. دلوقتي اتوحدوا في ملف واحد.
 *
 * كل route جديد لازم يتضاف هنا + في الـ switch في page.tsx.
 */

export const VALID_VIEWS: readonly string[] = [
  // EGX — السوق المصري
  'dashboard', 'stocks', 'stock-filters', 'top-performers', 'screener',
  'portfolio', 'watchlist', 'recommendations', 'reports',
  'learning', 'simulation', 'academy',
  'advanced-analysis', 'unified-analysis', 'specialist-analysis',
  'advanced-portfolio', 'seasonality',
  'prediction-tracking', 'picks-management',
  'smart-confluence',
  'alerts-center', 'trading-memory', 'live-monitor', 'wealth',
  'trading-journal', 'publishing',
  'trading-chart', 'analysis', 'v2-analysis',

  // Crypto — العملات الرقمية
  'crypto', 'crypto-live', 'crypto-portfolio', 'crypto-watchlist',
  'crypto-recommendations', 'crypto-analysis', 'crypto-learning', 'crypto-simulation',
  'crypto-trading-chart', 'crypto-prediction-tracking', 'crypto-screener',

  // Islamic — حسابات دينية
  'zakat', 'tithes',

  // Other
  'subscription', 'settings', 'auth', 'admin', 'about', 'finance', 'backtesting',
] as const;

export const VALID_VIEWS_SET: ReadonlySet<string> = new Set(VALID_VIEWS);

export function isValidView(view: string): boolean {
  return VALID_VIEWS_SET.has(view);
}

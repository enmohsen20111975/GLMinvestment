/**
 * VALID_VIEWS — المصدر الوحيد لكل الـ routes المسموح بها.
 *
 * Rule 28 (NO-DUPLICATION): كان فيه قائمتين متناقضتين في page.tsx (validViews array + VALID_VIEWS Set).
 * ده كان بيكسر deep-linking لـ 5 routes. دلوقتي اتوحدوا في ملف واحد.
 *
 * كل route جديد لازم يتضاف هنا + في الـ switch في page.tsx.
 *
 * UNIFIED-MARKET-UX (Task 2):
 * المنصة كلها كتلة واحدة — الشاشات بتاعة الكريبتو القديمة بقت ببساطة views عادية
 * مع setCurrentMarket('CRYPTO'). الـ CRYPTO_VIEW_REDIRECTS بيوفر redirect table
 * بتربط كل crypto-* view بالـ unified view المناسب (اللي بيستعمل نفس الـ component
 * اللي بيستعمله السوق العادي — الفرق الوحيد إن currentMarket='CRYPTO' في الـ store).
 */

export const VALID_VIEWS: readonly string[] = [
  // EGX — السوق المصري
  'dashboard', 'stocks', 'stock-filters', 'top-performers', 'screener',
  'portfolio', 'watchlist', 'recommendations', 'reports',
  'news',
  'simulation', 'academy',
  'bagholder-rescue', // Task 31-C — محرك إنقاذ الأسهم المزنوقة
  'advanced-analysis', 'unified-analysis', 'specialist-analysis',
  'advanced-portfolio', 'seasonality',
  'prediction-tracking', 'picks-management',
  'incubator',
  'smart-confluence',
  'liquidity-radar',
  'sectors', // حركة القطاعات — تبويب مستقل
  'market-depth',  // MARKET-DEPTH-VIEW — شاشة عمق السوق المنفصلة
  'market-status',  // ALPHA-UX-FIX-7: standalone (moved from #recommendations tab → السوق)
  'historical-trades',  // ALPHA-UX-FIX-7: standalone (moved from #recommendations tab → السوق)
  'dual-track',
  'v82',  // محرك القرار المؤسسي V82
  'alerts-center', 'trading-memory', 'live-monitor', 'wealth',
  'trading-journal', 'publishing',
  'trading-chart', 'analysis', 'v2-analysis',

  // Crypto — العملات الرقمية (بيتبقى في الـ VALID_VIEWS عشان deep links تشتغل،
  // بس page.tsx بتعمل redirect لهم على الـ unified view المناسب + setCurrentMarket('CRYPTO'))
  'crypto', 'crypto-live', 'crypto-portfolio', 'crypto-watchlist',
  'crypto-recommendations', 'crypto-analysis', 'crypto-learning', 'crypto-simulation',
  'crypto-trading-chart', 'crypto-prediction-tracking', 'crypto-screener',

  // Islamic — حسابات دينية
  'zakat', 'tithes', 'sharia',

  // Other
  'subscription', 'settings', 'auth', 'admin', 'about', 'finance', 'backtesting',
  'rescue', // ALPHA-P0: عيادة إنقاذ الصفقات المتعثرة
] as const;

export const VALID_VIEWS_SET: ReadonlySet<string> = new Set(VALID_VIEWS);

export function isValidView(view: string): boolean {
  return VALID_VIEWS_SET.has(view);
}

// ─── UNIFIED-MARKET-UX (Task 2): Crypto view redirects ───────────────────
// كل crypto-* view بيتـ redirect للـ unified view المناسب.
// page.tsx بيسمّي setCurrentMarket('CRYPTO') أول ما الـ view يظهر، فالـ unified
// component بيجيب بيانات الكريبتو من الـ store تلقائياً (UI-Mirror Protocol).
//
// Mapping (المرسل → المستلم):
//   crypto                    → dashboard        (DashboardView + CRYPTO)
//   crypto-live               → stocks           (StocksView + CRYPTO)
//   crypto-recommendations    → recommendations  (MarketAnalysisView + CRYPTO)
//   crypto-trading-chart      → trading-chart   (TradingChartView + CRYPTO)
//   crypto-screener           → stock-filters    (StockScreenerAdvancedView + CRYPTO)
//   crypto-analysis           → smart-confluence  (SmartConfluenceView + CRYPTO)
//   crypto-learning           → academy           (AcademyView + CRYPTO — unified)
//   crypto-simulation         → simulation       (SimulationView + CRYPTO)
//
// ملاحظة: الـ redirects اللي تحت دي مش بتشتغل هنا (مش مهّمة للـ UI-Mirror دلوقتي)
// لأن العميل طلب دمج الشاشات في الـ unified experience:
//   crypto-portfolio, crypto-watchlist, crypto-prediction-tracking — بتفضل على
//   الـ components المتخصصة بتاعتها في page.tsx (مش هتتبدل).
export const CRYPTO_VIEW_REDIRECTS: Readonly<Record<string, string>> = {
  'crypto': 'dashboard',
  'crypto-live': 'stocks',
  'crypto-recommendations': 'recommendations',
  'crypto-trading-chart': 'trading-chart',
  'crypto-screener': 'stock-filters',
  'crypto-analysis': 'smart-confluence',
  'crypto-learning': 'academy',
  'crypto-simulation': 'simulation',
} as const;

// ── قائمة الـ views اللي لازم نست setCurrentMarket('CRYPTO') ─────────────
// أي view في CRYPTO_VIEW_REDIRECTS أو يبدأ بـ 'crypto-' لازم يفعّل وضع الكريبتو.
export function isCryptoView(view: string): boolean {
  return view.startsWith('crypto-') || view === 'crypto';
}

// ── لو الـ view هو crypto-* redirect، نرجّع الـ unified view المناسب ──────
// returns null لو مش crypto redirect (يعني view عادي)
export function resolveCryptoRedirect(view: string): string | null {
  return CRYPTO_VIEW_REDIRECTS[view] ?? null;
}

// ─── ALPHA Navigation Cleanup: Redirects للشاشات المحذوفة ──────────────
// الشاشات دي مـش حذفينها من VALID_VIEWS عشان الروابط الخارجية متـنكسرش.
// بس بـ نـعمل redirect لـ الشاشة الموحدة البديلة.
//
// Mapping (المحذوف → البديل):
//   market-depth     → liquidity-radar  (رادار السيولة الحقيقي)
//   smart-confluence → recommendations  (التوصيات الموحدة)
//   v82              → recommendations  (محرك القرار مدمج في التوصيات)
//   tithes           → sharia           (الحسابات الشرعية الموحدة)
//   zakat            → sharia           (الحسابات الشرعية الموحدة)
export const LEGACY_VIEW_REDIRECTS: Readonly<Record<string, string>> = {
  'market-depth': 'liquidity-radar',
  'smart-confluence': 'recommendations',
  'v82': 'recommendations',
  'tithes': 'sharia',
  'zakat': 'sharia',
} as const;

// ── لو الـ view هو محذوف، نرجّع البديل المناسب ──────────────────────────
// returns null لو مش محذوف (يعني view عادي)
export function resolveLegacyRedirect(view: string): string | null {
  return LEGACY_VIEW_REDIRECTS[view] ?? null;
}


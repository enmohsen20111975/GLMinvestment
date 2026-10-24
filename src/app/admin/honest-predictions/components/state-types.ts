// state types + interfaces — extracted (Phase 3)

};

function formatPercent(val: number | null, withSign = true): string {
 if (val === null || val === undefined) return '—';
 const sign = withSign && val > 0 ? '+' : '';
 return `${sign}${val.toFixed(2)}%`;
}

function formatPrice(val: number | null): string {
 if (val === null || val === undefined) return '—';
 return val.toFixed(2);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function HonestPredictionsPage() {
 const [stats, setStats] = useState<Stats | null>(null);
 const [byMarket, setByMarket] = useState<MarketStat[]>([]);
 const [patterns, setPatterns] = useState<PatternStat[]>([]);
 const [predictions, setPredictions] = useState<Prediction[]>([]);
 const [lessons, setLessons] = useState<Lesson[]>([]);
 const [monthlyBreakdown, setMonthlyBreakdown] = useState<MonthlyStat[]>([]);
 const [cumulativeReturns, setCumulativeReturns] = useState<CumulativePoint[]>([]);
 const [expandedId, setExpandedId] = useState<string | null>(null);
 const [testReport, setTestReport] = useState<Record<string, unknown> | null>(null);
 const [loading, setLoading] = useState(true);
 const [generating, setGenerating] = useState(false);
 const [verifying, setVerifying] = useState(false);
 const [learning, setLearning] = useState(false);
 const [testing, setTesting] = useState(false);
 const [viewMode, setViewMode] = useState<'charts' | 'table'>('charts');

 // TOP-TRADES-037: أفضل صفقات الشهر (للـ Image Card الإعلانية)
 const [topTrades, setTopTrades] = useState<TopTrade[]>([]);

 // Filters
 const [marketFilter, setMarketFilter] = useState('all');
 const [statusFilter, setStatusFilter] = useState('all');
 const [signalFilter, setSignalFilter] = useState('all');
 const [sortBy, setSortBy] = useState('prediction_date');

 // Advanced Settings
 const [settingsOpen, setSettingsOpen] = useState(false);
 const [dynamicParams, setDynamicParams] = useState<Record<string, unknown> | null>(null);
 const [dynamicSource, setDynamicSource] = useState<string>('defaults');

 const fetchDynamicParams = useCallback(async () => {
 try {
 // GHOST-BUSTER-024: cache: 'no-store' + cache buster عشان نمنع Next.js
 // والمتصفح من تخزين الـ response القديم (سبب ظهور البيانات الوهمية)
 const res = await fetch(`/api/admin/generate-historical-predictions?_t=${Date.now()}`, {
 cache: 'no-store',
 headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
 });
 const data = await res.json();
 if (data.success && data.params) {
 setDynamicParams(data.params);
 setDynamicSource(data.source || 'defaults');
 setAtrPeriod(data.params.atrPeriod ?? 14);
 setSwingLookback(data.params.swingLookback ?? 20);
 setRsiOverbought(data.params.rsiOverbought ?? 75);
 setRsiOversold(data.params.rsiOversold ?? 25);
 setMinRiskReward(data.params.minRiskReward ?? 1.5);
 setExitSignalThreshold(data.params.exitSignalThreshold ?? 60);
 }
 } catch { /* ignore */ }
 }, []);

 const [startDate, setStartDate] = useState('2025-01-01');
 const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
 const [tickersPerMarket, setTickersPerMarket] = useState(10);
 const [sampleEveryDays, setSampleEveryDays] = useState(7);
 const [clearExisting, setClearExisting] = useState(true);
 const [atrPeriod, setAtrPeriod] = useState(14);
 const [swingLookback, setSwingLookback] = useState(20);
 const [rsiOverbought, setRsiOverbought] = useState(75);
 const [rsiOversold, setRsiOversold] = useState(25);
 const [minRiskReward, setMinRiskReward] = useState(1.5);
 const [exitSignalThreshold, setExitSignalThreshold] = useState(60);

 useEffect(() => { fetchDynamicParams(); }, [fetchDynamicParams]);

 const fetchStats = useCallback(async () => {
 try {
 // GHOST-BUSTER-024: cache: 'no-store' + cache buster
 const res = await fetch(`/api/predictions/honest-tracking/stats?_t=${Date.now()}`, {
 cache: 'no-store',
 headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
 });
 const data = await res.json();
 if (data.success) {
 setStats(data.stats);
 setByMarket(data.by_market || []);
 setPatterns(data.candlestick_patterns || []);
 setLessons(data.lessons || []);
 // HONEST-V2: new chart datasets
 setMonthlyBreakdown(data.monthly_breakdown || []);
 setCumulativeReturns(data.cumulative_returns || []);
 }
 } catch (e) {
 console.error('Stats error:', e);
 }
 }, []);

 const fetchPredictions = useCallback(async () => {
 try {
 const params = new URLSearchParams({
 market: marketFilter,
 status: statusFilter,
 signal: signalFilter,
 sortBy,
 limit: '100',
 // GHOST-BUSTER-024: cache buster عشان نكسر browser/Next.js cache
 _t: String(Date.now()),
 });
 const res = await fetch(`/api/predictions/honest-tracking/list?${params}`, {
 cache: 'no-store',
 headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
 });
 const data = await res.json();
 if (data.success) {
 setPredictions(data.predictions);
 }
 } catch (e) {
 console.error('Predictions error:', e);
 }
 }, [marketFilter, statusFilter, signalFilter, sortBy]);

 const fetchLessons = useCallback(async () => {
 try {
 await fetchStats();
 } catch (e) {
 console.error('Lessons error:', e);
 }
 }, [fetchStats]);

 const fetchTopTrades = useCallback(async () => {
 try {
 // GHOST-BUSTER-024: cache: 'no-store' + cache buster
 const res = await fetch(`/api/prediction-performance?_t=${Date.now()}`, {
 cache: 'no-store',
 headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
 });
 const data = await res.json();
 if (data.success && data.top_monthly_trades) {
 setTopTrades(data.top_monthly_trades);
 }
 } catch (e) {
 // silent — top trades is optional
 }
 }, []);

 const fetchAll = useCallback(async () => {
 setLoading(true);
 await Promise.all([fetchStats(), fetchPredictions(), fetchTopTrades()]);
 setLoading(false);
 }, [fetchStats, fetchPredictions, fetchTopTrades]);

 useEffect(() => { fetchAll(); }, [fetchAll]);

 // GHOST-BUSTER-024: Auto-refresh كل 5 دقايق (300000ms) عشان لو الـ DB اتغير
 // الشاشة بتتحول فوراً بدون ما المستخدم يعمل refresh يدوي.
 // ده بيتطابق مع متطلب العميل: "الواجهة لازم تسحب API كل 5 دقايق cache: 'no-store'".
 useEffect(() => {
 const intervalId = setInterval(() => {
 fetchAll();
 }, 5 * 60 * 1000); // 5 minutes
 return () => clearInterval(intervalId);
 }, [fetchAll]);

 // Actions
 const handleGenerate = async () => {
 setGenerating(true);
 toast.info('بدأ توليد التوقعات التاريخية الحقيقية لكل الأسواق...');
 try {
 const res = await fetch('/api/admin/generate-historical-predictions', {
 method: 'POST',
 // GHOST-BUSTER-024: no-store حتى لطلبات POST
 cache: 'no-store',
 headers: {
 'Content-Type': 'application/json',
 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
 },
 body: JSON.stringify({
 startDate,
 endDate,
 tickersPerMarket,
 clearExisting,
 sampleEveryDays,
 markets: ['EGX', 'TADAWUL', 'KSE', 'QSE'],
 technicalParams: {
 atrPeriod,
 swingLookback,
 rsiOverbought,
 rsiOversold,
 minRiskReward,
 exitSignalThreshold,
 },
 }),
 });
 const data = await res.json();
 if (data.success) {
 toast.success(`تم توليد ${data.stats.total_predictions} توقع حقيقي عبر ${data.stats.markets_covered.length} سوق — نسبة الفوز الحقيقية ${data.stats.real_win_rate}%`);
 fetchAll();
 } else {
 toast.error(`فشل التوليد: ${data.error}`);
 }
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : String(e);
 toast.error(`خطأ: ${msg}`);
 } finally {
 setGenerating(false);
 }
 };

 const handleVerify = async () => {
 setVerifying(true);
 toast.info('بدأ التحقق من جميع التوقعات المعلقة (حتى 10000)...');
 try {
 const res = await fetch('/api/predictions/honest-tracking/verify-pending', {
 method: 'POST',
 // GHOST-BUSTER-024: no-store
 cache: 'no-store',
 headers: {
 'Content-Type': 'application/json',
 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
 },
 // HONEST-V2: bumped from 200 → 10000 so ALL pending trades are
 // processed in a single click (matches the user's "close trades
 // aggressively" requirement).
 body: JSON.stringify({ limit: 10000 }),
 });
 const data = await res.json();
 if (data.success) {
 const r = data.results;
 const profitTaken = r.profit_taken || 0;
 toast.success(`تم التحقق من ${r.checked} توقع — ${r.target_hits} حققت الهدف، ${r.stopped} ضرب وقف الخسارة، ${profitTaken} جني أرباح، ${r.expired} انتهت`);
 fetchAll();
 // HONEST-V2: auto-learn from wins/losses immediately after verify
 // so the LearningEngine is always up-to-date with the latest outcomes.
 setTimeout(() => {
 handleLearn(true);
 }, 800);
 } else {
 toast.error(`فشل التحقق: ${data.error}`);
 }
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : String(e);
 toast.error(`خطأ: ${msg}`);
 } finally {
 setVerifying(false);
 }
 };

 const handleLearn = async (fromVerify = false) => {
 setLearning(true);
 if (!fromVerify) toast.info('بدأ التحليل والتعلم من الأخطاء...');
 try {
 const res = await fetch('/api/predictions/honest-tracking/learn-from-errors', {
 method: 'POST',
 // GHOST-BUSTER-024: no-store
 cache: 'no-store',
 headers: {
 'Content-Type': 'application/json',
 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
 },
 body: JSON.stringify({ market: 'all' }),
 });
 const data = await res.json();
 if (data.success) {
 // HONEST-V2: learn-from-errors returns `lessons` (array) directly,
 // not `summary.lessons_extracted`. Fix the field name.
 const count = Array.isArray(data.lessons) ? data.lessons.length : 0;
 toast.success(`تم استخراج ${count} درس من تحليل التوقعات المغلقة${fromVerify ? ' (تلقائي بعد التحقق)' : ''}`);
 fetchLessons();
 } else {
 toast.error(`فشل التعلم: ${data.error}`);
 }
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : String(e);
 toast.error(`خطأ: ${msg}`);
 } finally {
 setLearning(false);
 }
 };

 const handleFullTest = async () => {
 setTesting(true);
 setTestReport(null);
 toast.info('جارٍ الاختبار الكامل: توليد + تحقق + تعلم + Python cycle...');
 try {
 const res = await fetch('/api/admin/generate-historical-predictions', {
 method: 'POST',
 // GHOST-BUSTER-024: no-store
 cache: 'no-store',
 headers: {
 'Content-Type': 'application/json',
 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',

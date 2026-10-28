// overlay indicators config — extracted (Phase 3)

function filterMarketHours(candles: OhlcvBar[]): OhlcvBar[] {
 return candles;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TradingViewChart({
 ticker,
 stockName,
 height = 500,
}: TradingViewChartProps) {
 const { resolvedTheme } = useTheme();
 const isDark = resolvedTheme === 'dark';
 const containerRef = useRef<HTMLDivElement>(null);
 const chartRef = useRef<IChartApi | null>(null);
 const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
 const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
 const markersRef = useRef<any>(null);
 const priceLinesRef = useRef<IPriceLine[]>([]);

 const [isLoading, setIsLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [allData, setAllData] = useState<OhlcvBar[]>([]);
 const [lastPrice, setLastPrice] = useState<{ price: number; change: number; changePercent: number } | null>(null);
 const [hoveredPrice, setHoveredPrice] = useState<OhlcvBar | null>(null);
 const [isFullscreen, setIsFullscreen] = useState(false);
 const [timeframe, setTimeframe] = useState<string>('D');
 const [currentRange, setCurrentRange] = useState<string>('1w');
 const [dataSource, setDataSource] = useState<string>('intraday');
 const [chartType, setChartType] = useState<ChartType>('candlestick');
 const [indicators, setIndicators] = useState<IndicatorSettings>({
 sma20: true,
 sma50: true,
 sma200: false,
 ema20: false,
 bollingerBands: false,
 volume: true,
 rsi: false,
 macd: false,
 stochastic: false,
 atr: false,
 obv: false,
 });

 // Market status & display modes
 const [marketClosed, setMarketClosed] = useState(false);
 const [focusMode, setFocusMode] = useState(false);
 const currentMarket = useAppStore((s) => s.currentMarket);
 const [chartEngine, setChartEngine] = useState<'interactive' | 'tradingview_widget'>('tradingview_widget');
 // GLM5.2-A (ALPHA-MARKERS): toggle states for markers + priceLines
 const [showMakerMarkers, setShowMakerMarkers] = useState(true);
 const [showTradeLines, setShowTradeLines] = useState(true);
 const [showSRZones, setShowSRZones] = useState(false);

 const tvSymbol = useMemo(() => {
 const t = (ticker || 'PHDC').toUpperCase().trim();
 if ((currentMarket as string) === 'CRYPTO' || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(t)) {
 return `BINANCE:${t}USDT`;
 }
 if ((currentMarket as string) === 'SAUDI' || currentMarket === 'TADAWUL' || /^\d{4}$/.test(t)) {
 return `TADAWUL:${t}`;
 }
 if (currentMarket === 'US') {
 return `NASDAQ:${t}`;
 }
 return `EGX:${t}`;
 }, [ticker, currentMarket]);

 const tvInterval = useMemo(() => {
 if (timeframe === 'W') return 'W';
 return 'D';
 }, [timeframe]);

 // ─── Fetch Data ────────────────────────────────────────────────────────────

 useEffect(() => {
 let cancelled = false;

 async function fetchData() {
 setIsLoading(true);
 setError(null);
 setMarketClosed(false);

 try {
 const tfConfig = RESOLUTIONS.find((t) => t.key === timeframe);
 const isIntraday = tfConfig?.isIntraday === true;

 let json: any;
 let usedMarketClosedFallback = false;

 // 1. Primary fetch: /api/chart/[ticker] with interval and period
 try {
 const chartRes = await fetch(
 `/api/chart/${ticker}?interval=${timeframe}&period=${currentRange}&asset=stock&_t=${Date.now()}`
 );
 if (chartRes.ok) {
 const chartJson = await chartRes.json();
 if (chartJson.success && Array.isArray(chartJson.data) && chartJson.data.length > 0) {
 json = chartJson;
 setDataSource(chartJson.source || (isIntraday ? 'intraday' : 'daily'));
 }
 }
 } catch {
 // swallow and try fallback below
 }

 // 2. Fallback to /api/v2/chart/full-analysis (unified market analysis)
 if (!json || !json.data || json.data.length === 0) {
 try {
 const v2Tf = isIntraday ? timeframe.toUpperCase() : (timeframe === '1W' ? 'WEEK' : 'DAY');
 const v2Res = await fetch(
 `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=${v2Tf}&limit=365`
 );
 if (v2Res.ok) {
 const v2Json = await v2Res.json();
 if (v2Json.ohlcv && Array.isArray(v2Json.ohlcv) && v2Json.ohlcv.length > 0) {
 json = {
 success: true,
 data: v2Json.ohlcv.map((c: any) => ({
 date: c.time ?? c.date ?? c.timestamp,
 open: c.open,
 high: c.high,
 low: c.low,
 close: c.close,
 volume: c.volume || 0,
 })),
 source: 'full_analysis',
 };
 setDataSource('full_analysis');
 }
 }
 } catch {
 // continue to history fallback
 }
 }

 // 3. Fallback to /api/stocks/[ticker]/history if chart endpoint failed
 if (!json || !json.data || json.data.length === 0) {
 const days = isIntraday ? 30 : 365;
 const historyRes = await fetch(`/api/stocks/${ticker}/history?days=${days}&market=${encodeURIComponent(currentMarket)}`);
 if (historyRes.ok) {
 json = await historyRes.json();
 usedMarketClosedFallback = true;
 setDataSource('fallback_daily');
 }
 }

 if (!cancelled) {
 const rawData = json?.data || [];
 if (rawData.length > 0) {
 // CHART-FIX (2026-10-01): sanitizeCandles now sorts strictly by the
 // parsed timestamp and drops duplicates/unparseable dates, so the
 // old locale-dependent pre-sort is gone.
 const sortedData = sanitizeCandles(rawData as OhlcvBar[]);
 if (sortedData.length === 0) {
 throw new Error('لا توجد بيانات صالحة للعرض لهذا الرمز');
 }
 setAllData(sortedData);

 if (usedMarketClosedFallback || !getEGXMarketStatus().isOpen) {
 setMarketClosed(true);
 }

 // Calculate price change
 if (sortedData.length >= 2) {
 const last = sortedData[sortedData.length - 1];
 const prev = sortedData[sortedData.length - 2];
 const change = last.close - prev.close;
 const changePercent = (change / prev.close) * 100;
 setLastPrice({
 price: last.close,
 change,
 changePercent,
 });
 }
 } else {
 throw new Error(json?.error || 'لا توجد بيانات متاحة لهذا الرمز');
 }
 }
 } catch (err) {
 if (!cancelled) {
 setError('تعذّر تحميل بيانات الرسم البياني. يرجى المحاولة مرة أخرى.');
 }
 } finally {
 if (!cancelled) {
 setIsLoading(false);
 }
 }
 }

 fetchData();

 return () => {
 cancelled = true;
 };
 }, [ticker, timeframe, currentRange, currentMarket]);

 const handleResolutionChange = (resKey: string) => {
 setTimeframe(resKey);
 // If switching to intraday while range is year/all, narrow to 1w for performance
 if (['5m', '15m', '30m'].includes(resKey) && ['1y', 'all'].includes(currentRange)) {
 setCurrentRange('1w');
 } else if (['1D', '1W'].includes(resKey) && currentRange === '1d') {
 setCurrentRange('1m');
 }
 };

 const handleRangeChange = (rKey: string) => {
 setCurrentRange(rKey);
 // If user clicks 1D or 5D on daily chart, switch to intraday so day candles show
 if (['1d', '5d'].includes(rKey) && ['1D', '1W'].includes(timeframe)) {
 setTimeframe(rKey === '1d' ? '5m' : '15m');
 } else if (['1m', '3m', '6m', '1y', 'all'].includes(rKey) && ['5m', '15m'].includes(timeframe)) {
 setTimeframe('1D');
 }
 };

 // ─── Filter data by timeframe & range ────────────────────────────────────────

 const data = React.useMemo(() => {
 if (allData.length === 0) return [];
 const tf = RESOLUTIONS.find((t) => t.key === timeframe);
 const rangeConfig = RANGES.find((r) => r.key === currentRange);
 if (!rangeConfig || rangeConfig.days >= 9999) {
 // Intraday: filter to EGX market hours (10:00 - 14:30 Cairo)
 return tf?.isIntraday ? filterMarketHours(allData) : allData;
 }

 const cutoffSeconds = Math.floor(Date.now() / 1000) - rangeConfig.days * 86400;
 // CHART-FIX (2026-10-01): use the strict parser — `new Date('09/01 10:30')`
 // is locale-dependent and returns NaN, which silently emptied the range.
 const filtered = allData.filter((b) => {
 const t = parseBarSeconds(b.date as unknown);
 return t !== null && t >= cutoffSeconds;
 });
 if (filtered.length === 0) return allData;
 // Intraday: also apply market-hours filter to the range-sliced subset
 return tf?.isIntraday ? filterMarketHours(filtered) : filtered;
 }, [allData, timeframe, currentRange]);

 // ─── Create Chart ──────────────────────────────────────────────────────────

 useEffect(() => {
 if (!containerRef.current || data.length === 0) return;

 // P37-PHASE-1: Focus Mode strips every secondary indicator and keeps only
 // the main price series + volume, so mobile users get a clean chart when
 // too many overlays clutter the view.
 const effectiveIndicators: IndicatorSettings = focusMode
 ? {
 sma20: false,
 sma50: false,
 sma200: false,
 ema20: false,
 bollingerBands: false,
 rsi: false,
 macd: false,
 stochastic: false,
 atr: false,
 obv: false,
 volume: indicators.volume,
 }
 : indicators;

 // Cleanup previous chart
 if (chartRef.current) {
 chartRef.current.remove();
 chartRef.current = null;
 }

 const container = containerRef.current;
 const chartHeight = isFullscreen ? window.innerHeight - 100 : height;

 // Theme-aware colors
 const bgColor = isDark ? '#131722' : '#ffffff';
 const textColor = isDark ? '#d1d4dc' : '#191919';
 const gridColor = isDark ? '#1f2943' : '#e0e0e0';
 const crosshairColor = isDark ? '#758696' : '#9b9b9b';
 const labelBgColor = isDark ? '#2A2E39' : '#f0f0f0';
 const borderColor = isDark ? '#2A2E39' : '#d0d0d0';

 const hasOscillator = effectiveIndicators.rsi || effectiveIndicators.macd || effectiveIndicators.stochastic || effectiveIndicators.atr || effectiveIndicators.obv;

 // Chart options
 const options: DeepPartial<ChartOptions> = {
 width: container.clientWidth,
 height: chartHeight,
 autoSize: true,
 layout: {
 background: { type: ColorType.Solid, color: bgColor },
 textColor,
 fontFamily: 'Trebuchet MS, Roboto, Ubuntu, sans-serif',
 fontSize: 12,
 },
 grid: {
 vertLines: { color: gridColor, style: isDark ? LineStyle.Dotted : LineStyle.Solid },
 horzLines: { color: gridColor, style: isDark ? LineStyle.Dotted : LineStyle.Solid },
 },
 crosshair: {
 mode: CrosshairMode.Normal,

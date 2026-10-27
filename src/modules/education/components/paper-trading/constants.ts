// trading constants + presets — extracted (Phase 3)

 const min = Math.floor(sec / 60);
 if (min < 60) return `منذ ${min} دقيقة`;
 const hr = Math.floor(min / 60);
 if (hr < 24) return `منذ ${hr} ساعة`;
 const day = Math.floor(hr / 24);
 if (day < 30) return `منذ ${day} يوم`;
 const mon = Math.floor(day / 30);
 if (mon < 12) return `منذ ${mon} شهر`;
 return `منذ ${Math.floor(mon / 12)} سنة`;
}

/** Format ISO date as dd/MM/yyyy HH:mm (Arabic digits). */
function dateTimeAr(iso: string | null | undefined): string {
 if (!iso) return '—';
 const d = new Date(iso);
 if (isNaN(d.getTime())) return '—';
 const dd = String(d.getDate()).padStart(2, '0');
 const mm = String(d.getMonth() + 1).padStart(2, '0');
 const yyyy = d.getFullYear();
 const hh = String(d.getHours()).padStart(2, '0');
 const mi = String(d.getMinutes()).padStart(2, '0');
 return new Intl.NumberFormat('ar-EG').format(
 parseInt(`${dd}${mm}${yyyy}${hh}${mi}`, 10),
 ).replace(/(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})/, '$1/$2/$3 $4:$5');
}

// ============================================================
// Constants
// ============================================================

const QUICK_SHARES = [10, 50, 100, 500];
const POLL_INTERVAL_MS = 10_000; // 10s
const LIVE_PRICE_POLL_MS = 5_000; // 5s live price refresh on order panel
const HISTORY_PAGE_SIZE = 20;

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
 stock: 'أسهم',
 crypto: 'كريبتو',
 gold: 'ذهب',
};

// ============================================================
// Main component
// ============================================================

export function PaperTradingWorkstation() {
 // --- Account + positions state ---
 const [account, setAccount] = useState<PaperTradingAccount | null>(null);
 const [positions, setPositions] = useState<OpenPosition[]>([]);
 const [livePrices, setLivePrices] = useState<Record<string, number>>({});
 const [loadingAccount, setLoadingAccount] = useState(true);
 const [resetting, setResetting] = useState(false);

 // --- Trade history ---
 const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
 const [historyVisibleCount, setHistoryVisibleCount] = useState(
 HISTORY_PAGE_SIZE,
 );

 // --- Order form state ---
 const [ticker, setTicker] = useState('');
 const [tickerName, setTickerName] = useState('');
 const [assetType, setAssetType] = useState<AssetType>('stock');
 const [orderType, setOrderType] = useState<OrderType>('BUY');
 const [shares, setShares] = useState<string>('10');
 const [entryPrice, setEntryPrice] = useState<string>('');
 const [stopLoss, setStopLoss] = useState<string>('');
 const [takeProfit, setTakeProfit] = useState<string>('');
 const [livePrice, setLivePrice] = useState<number | null>(null);
 const [livePriceLoading, setLivePriceLoading] = useState(false);
 const [submitting, setSubmitting] = useState(false);

 // --- Close-position dialog state ---
 const [closeTarget, setCloseTarget] = useState<OpenPosition | null>(null);
 const [closing, setClosing] = useState(false);

 // --- Equity history (for chart) ---
 const [equityHistory, setEquityHistory] = useState<
 { time: string; equity: number }[]
 >([]);

 // Track previous autoClosed signatures so we only toast new ones
 const seenAutoClosedRef = useRef<Set<string>>(new Set());

 // ---------------------------------------------------------
 // Fetch account (initial)
 // ---------------------------------------------------------
 const fetchAccount = useCallback(async () => {
 try {
 const res = await fetch('/api/paper-trading-v2/account', {
 cache: 'no-store',
 });
 const data = await res.json();
 if (data?.success && data.account) {
 setAccount(data.account);
 }
 } catch {
 /* silent — polling will retry */
 } finally {
 setLoadingAccount(false);
 }
 }, []);

 // ---------------------------------------------------------
 // Fetch positions (also called by the poller)
 // ---------------------------------------------------------
 const fetchPositions = useCallback(async () => {
 try {
 const res = await fetch('/api/paper-trading-v2/positions', {
 cache: 'no-store',
 });
 const data = await res.json();
 if (!data?.success) return;

 if (data.account) setAccount(data.account);
 setPositions(Array.isArray(data.positions) ? data.positions : []);
 if (data.livePrices && typeof data.livePrices === 'object') {
 setLivePrices(data.livePrices);
 }

 // Append the current equity snapshot to the in-memory equity history
 if (data.account?.total_equity != null) {
 setEquityHistory((prev) => {
 const next = [
 ...prev,
 {
 time: new Date().toLocaleTimeString('ar-EG', {
 hour: '2-digit',
 minute: '2-digit',
 }),
 equity: Math.round(data.account.total_equity * 100) / 100,
 },
 ];
 // Keep last 60 points (10 minutes @ 10s poll)
 return next.slice(-60);
 });
 }

 // Fire toast notifications for any newly auto-closed orders
 const autoClosed: AutoClosedEntry[] = Array.isArray(data.autoClosed)
 ? data.autoClosed
 : [];
 if (autoClosed.length > 0) {
 for (const entry of autoClosed) {
 const key = `${entry.order.id}-${entry.reason}`;
 if (seenAutoClosedRef.current.has(key)) continue;
 seenAutoClosedRef.current.add(key);
 const pnl = entry.order.pnl ?? 0;
 const tickerLabel = entry.order.ticker;
 const pnlLabel = fmtEgp(Math.abs(pnl));
 if (entry.reason === 'STOP_LOSS') {
 toast.error(
 `🔒 تم تفعيل وقف الخسارة لـ ${tickerLabel} — خسارة ${pnlLabel} ج.م`,
 );
 } else {
 toast.success(
 `🎯 تم تحقيق الهدف لـ ${tickerLabel} — ربح ${pnlLabel} ج.م`,
 );
 }
 }
 }
 } catch {
 /* silent — polling will retry */
 }
 }, []);

 // ---------------------------------------------------------
 // Fetch closed orders (trade history)
 // ---------------------------------------------------------
 const fetchClosedOrders = useCallback(async () => {
 try {
 const res = await fetch(
 '/api/paper-trading-v2/orders?status=closed',
 { cache: 'no-store' },
 );
 const data = await res.json();
 if (data?.success) {
 setClosedOrders(Array.isArray(data.orders) ? data.orders : []);
 }
 } catch {
 /* silent */
 }
 }, []);

 // ---------------------------------------------------------
 // Initial load
 // ---------------------------------------------------------
 useEffect(() => {
 fetchAccount();
 fetchPositions();
 fetchClosedOrders();
 }, [fetchAccount, fetchPositions, fetchClosedOrders]);

 // ---------------------------------------------------------
 // Auto-refresh positions every 10s (visible-tab-aware).
 // allowOffMarket = true so the academy simulator keeps polling
 // even on weekends (paper trading ≠ real market access).
 // ---------------------------------------------------------
 useVisibilityAwarePolling(
 () => {
 fetchPositions();
 },
 POLL_INTERVAL_MS,
 [],
 { allowOffMarket: true },
 );

 // ---------------------------------------------------------
 // Live-price polling for the currently selected ticker
 // (separate, faster interval — every 5s)
 // ---------------------------------------------------------
 const fetchLivePriceForTicker = useCallback(async () => {
 if (!ticker) {
 setLivePrice(null);
 return;
 }
 setLivePriceLoading(true);
 try {
 let price: number | null = null;
 if (assetType === 'crypto') {
 const res = await fetch(
 `/api/crypto/live?symbol=${encodeURIComponent(ticker)}`,
 { cache: 'no-store' },
 );
 if (res.ok) {
 const data = await res.json();
 const candidate =
 data?.price ?? data?.current_price ?? data?.last_price;
 if (typeof candidate === 'number' && Number.isFinite(candidate)) {
 price = candidate;
 }
 }
 } else if (assetType === 'gold') {
 const res = await fetch('/api/metals-forex/status', {
 cache: 'no-store',
 });
 if (res.ok) {
 const data = await res.json();
 const candidate =
 data?.gold?.price_per_gram ?? data?.gold_price ?? null;
 if (typeof candidate === 'number' && Number.isFinite(candidate)) {
 price = candidate;
 }
 }
 } else {
 const res = await fetch(
 `/api/stocks/${encodeURIComponent(ticker)}`,
 { cache: 'no-store' },
 );
 if (res.ok) {
 const data = await res.json();
 const stock = data?.stock || data;
 const candidate =
 stock?.current_price ?? stock?.last_price ?? stock?.close ?? null;
 if (typeof candidate === 'number' && Number.isFinite(candidate)) {
 price = candidate;
 }
 }
 }
 if (price != null) {
 setLivePrice(price);
 // Auto-fill entry price if it's empty or matches the previous live price
 setEntryPrice((prev) => {
 if (!prev || prev === '') return String(price);
 const prevNum = parseFloat(prev);
 if (!Number.isFinite(prevNum) || prevNum === livePrice) {
 return String(price);
 }
 return prev; // user has overridden — keep their value
 });
 }
 } catch {
 /* silent */
 } finally {
 setLivePriceLoading(false);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [ticker, assetType]);

 useEffect(() => {
 if (!ticker) return;
 // Fire immediately on ticker / assetType change
 fetchLivePriceForTicker();
 const id = setInterval(() => {
 if (!document.hidden) fetchLivePriceForTicker();
 }, LIVE_PRICE_POLL_MS);
 return () => clearInterval(id);
 }, [ticker, assetType, fetchLivePriceForTicker]);

 // ---------------------------------------------------------
 // Derived order-summary values
 // ---------------------------------------------------------
 const sharesNum = parseFloat(shares) || 0;
 const entryNum = parseFloat(entryPrice) || 0;
 const slNum = stopLoss ? parseFloat(stopLoss) : NaN;
 const tpNum = takeProfit ? parseFloat(takeProfit) : NaN;

 const totalCost = useMemo(
 () => sharesNum * entryNum,
 [sharesNum, entryNum],

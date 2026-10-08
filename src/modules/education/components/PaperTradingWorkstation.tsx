// P40-ACADEMY PILLAR 1: Live Market Paper Trading Workstation
// ============================================================
// P40-ACADEMY-ORCHESTRATOR (Task P40-1)
// Full trading workstation UI where the user places paper orders with live
// market prices from the EGX / crypto / gold backends.
//
// Sections:
//   1. Account Header Bar — virtual_balance, total_equity, total_pnl,
//      win_rate, total_trades, reset button (with confirmation).
//   2. Order Execution Panel — ticker search, asset type segmented control,
//      BUY/SELL toggle, shares input, entry / SL / TP inputs, order summary
//      (cost, risk, reward, R:R), execute button.
//   3. Open Positions Table — auto-refreshing, color-coded P&L, close action
//      with confirmation, auto-closed (SL/TP) toast notifications.
//   4. Trade History — closed orders with close_reason badge + "load more".
//   5. Performance Chart — simple equity curve via Recharts (single point if
//      no history yet).
//
// Polling: /positions endpoint every 10s via useVisibilityAwarePolling
// (off-market allowed since paper trading simulates live prices).

'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { StockSearchDropdown } from '@/modules/portfolio/components/StockSearchDropdown';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Target,
  Shield,
  Zap,
  RefreshCw,
  Loader2,
  X,
  ArrowUpCircle,
  ArrowDownCircle,
  Clock,
  Percent,
  DollarSign,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';

// ============================================================
// Types — match the backend (paper-trading-v2-db.ts)
// ============================================================

interface PaperTradingAccount {
  id: number;
  user_id: string;
  virtual_balance: number;
  total_equity: number;
  starting_balance: number;
  total_pnl: number;
  total_trades: number;
  winning_trades: number;
  win_rate: number;
  created_at: string;
  updated_at: string;
}

type AssetType = 'stock' | 'crypto' | 'gold';
type OrderType = 'BUY' | 'SELL';
type CloseReason = 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT';

interface OpenPosition {
  id: number;
  ticker: string;
  asset_type: string;
  order_type: string;
  shares: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  pnl: number;
  close_price: number | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  position_value: number;
}

interface ClosedOrder {
  id: number;
  ticker: string;
  asset_type: string;
  order_type: string;
  shares: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  pnl: number;
  close_price: number | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

interface AutoClosedEntry {
  order: ClosedOrder;
  closePrice: number;
  reason: 'STOP_LOSS' | 'TAKE_PROFIT';
}

// ============================================================
// Formatters (Arabic / EGP)
// ============================================================

const egpFmt = new Intl.NumberFormat('ar-EG', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });

function fmtEgp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return egpFmt.format(v);
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return numFmt.format(v);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return pctFmt.format(v);
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v ?? 0).toFixed(2);
}

function pnlColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (v < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function rowBgClass(v: number | null | undefined): string {
  if (v == null) return '';
  if (v > 0) return 'bg-emerald-50/40 dark:bg-emerald-950/20';
  if (v < 0) return 'bg-red-50/40 dark:bg-red-950/20';
  return '';
}

/** Format ISO date as a relative Arabic string (e.g. "منذ 5 دقائق"). */
function timeAgoAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'الآن';
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
  );
  const riskAmount = useMemo(() => {
    if (!Number.isFinite(slNum) || slNum <= 0) return 0;
    return Math.abs(entryNum - slNum) * sharesNum;
  }, [slNum, entryNum, sharesNum]);
  const rewardAmount = useMemo(() => {
    if (!Number.isFinite(tpNum) || tpNum <= 0) return 0;
    return Math.abs(tpNum - entryNum) * sharesNum;
  }, [tpNum, entryNum, sharesNum]);
  const rrRatio = useMemo(() => {
    if (riskAmount <= 0 || rewardAmount <= 0) return null;
    return rewardAmount / riskAmount;
  }, [riskAmount, rewardAmount]);

  const slPctBelow = useMemo(() => {
    if (!Number.isFinite(slNum) || entryNum <= 0) return null;
    return ((entryNum - slNum) / entryNum) * 100;
  }, [slNum, entryNum]);
  const tpPctAbove = useMemo(() => {
    if (!Number.isFinite(tpNum) || entryNum <= 0) return null;
    return ((tpNum - entryNum) / entryNum) * 100;
  }, [tpNum, entryNum]);

  // ---------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------
  const handleTickerSelect = useCallback(
    (tk: string, name: string, currentPrice: number) => {
      setTicker(tk);
      setTickerName(name);
      if (currentPrice && Number.isFinite(currentPrice) && currentPrice > 0) {
        setLivePrice(currentPrice);
        setEntryPrice(String(currentPrice));
      } else {
        setEntryPrice('');
      }
    },
    [],
  );

  const handleSubmitOrder = useCallback(async () => {
    if (!ticker) {
      toast.error('اختر السهم أولاً');
      return;
    }
    if (sharesNum <= 0) {
      toast.error('الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    if (entryNum <= 0) {
      toast.error('سعر الدخول يجب أن يكون أكبر من صفر');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        ticker: ticker.toUpperCase(),
        asset_type: assetType,
        order_type: orderType,
        shares: sharesNum,
        entry_price: entryNum,
      };
      if (stopLoss && Number.isFinite(slNum)) body.stop_loss = slNum;
      if (takeProfit && Number.isFinite(tpNum)) body.take_profit = tpNum;

      const res = await fetch('/api/paper-trading-v2/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        const msg = data?.error || 'فشل تنفيذ الأمر';
        toast.error(msg);
        return;
      }

      toast.success(
        `✅ تم تنفيذ أمر ${orderType === 'BUY' ? 'شراء' : 'بيع'} ${fmtNum(sharesNum)} سهم من ${ticker.toUpperCase()} @ ${fmtPrice(entryNum)}`,
      );

      // Clear form (keep ticker + assetType for quick re-order)
      setShares('10');
      setStopLoss('');
      setTakeProfit('');

      // Refresh everything
      await Promise.all([fetchPositions(), fetchAccount(), fetchClosedOrders()]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ الأمر',
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    ticker,
    sharesNum,
    entryNum,
    assetType,
    orderType,
    stopLoss,
    takeProfit,
    slNum,
    tpNum,
    fetchPositions,
    fetchAccount,
    fetchClosedOrders,
  ]);

  const handleResetAccount = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/paper-trading-v2/reset', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'فشل تصفير الحساب');
        return;
      }
      toast.success('تم تصفير الحساب — رصيد جديد: 100,000 ج.م');
      setAccount(data.account);
      setPositions([]);
      setClosedOrders([]);
      setEquityHistory([]);
      setHistoryVisibleCount(HISTORY_PAGE_SIZE);
      seenAutoClosedRef.current.clear();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تصفير الحساب',
      );
    } finally {
      setResetting(false);
    }
  }, []);

  const handleClosePosition = useCallback(
    async (pos: OpenPosition) => {
      setClosing(true);
      try {
        const res = await fetch(
          `/api/paper-trading-v2/orders/${pos.id}/close`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              current_price: pos.current_price,
              reason: 'MANUAL',
            }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'فشل إغلاق الصفقة');
          return;
        }
        toast.success(data.message || 'تم إغلاق الصفقة');
        setCloseTarget(null);
        await Promise.all([
          fetchPositions(),
          fetchAccount(),
          fetchClosedOrders(),
        ]);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'حدث خطأ أثناء الإغلاق',
        );
      } finally {
        setClosing(false);
      }
    },
    [fetchPositions, fetchAccount, fetchClosedOrders],
  );

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------
  if (loadingAccount && !account) {
    return (
      <div
        dir="rtl"
        className="flex items-center justify-center min-h-[400px]"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-sm">جاري تحميل محطة التداول الورقي...</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div
        dir="rtl"
        className="flex items-center justify-center min-h-[400px] p-6"
      >
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <p className="text-red-600 font-medium">
              تعذّر تحميل حساب التداول الورقي
            </p>
            <Button onClick={() => fetchAccount()} variant="outline">
              <RefreshCw className="w-4 h-4 ml-2" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pnlIsProfit = account.total_pnl >= 0;
  const positionsSorted = [...positions].sort(
    (a, b) =>
      new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
  );
  const closedSorted = [...closedOrders].sort(
    (a, b) =>
      new Date(b.closed_at ?? 0).getTime() -
      new Date(a.closed_at ?? 0).getTime(),
  );
  const visibleClosed = closedSorted.slice(0, historyVisibleCount);

  return (
    <div
      dir="rtl"
      className="space-y-4 w-full max-w-[1600px] mx-auto p-2 sm:p-4"
    >
      {/* ==================================================
          1. ACCOUNT HEADER BAR
          ================================================== */}
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
            {/* Account title */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                <Wallet className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">
                  حساب التداول الورقي
                </h2>
                <p className="text-xs text-muted-foreground">
                  رصيد افتراضي 100,000 ج.م
                </p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 flex-1">
              {/* Virtual balance */}
              <div className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                  <DollarSign className="w-3 h-3" />
                  الرصيد المتاح
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {fmtEgp(account.virtual_balance)}
                  <span className="text-[10px] text-muted-foreground mr-1">
                    ج.م
                  </span>
                </div>
              </div>
              {/* Total equity */}
              <div className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                  <Activity className="w-3 h-3" />
                  إجمالي حقوق الملكية
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {fmtEgp(account.total_equity)}
                  <span className="text-[10px] text-muted-foreground mr-1">
                    ج.م
                  </span>
                </div>
              </div>
              {/* Total P&L */}
              <div className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                  {pnlIsProfit ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  إجمالي الربح/الخسارة
                </div>
                <div
                  className={`text-sm font-bold tabular-nums ${pnlColor(account.total_pnl)}`}
                >
                  {pnlIsProfit ? '+' : ''}
                  {fmtEgp(account.total_pnl)}
                  <span className="text-[10px] text-muted-foreground mr-1">
                    ج.م
                  </span>
                </div>
              </div>
              {/* Win rate */}
              <div className="rounded-lg border bg-card p-2.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                  <Percent className="w-3 h-3" />
                  معدل الربح
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {fmtPct(account.win_rate)}%
                </div>
              </div>
              {/* Total trades */}
              <div className="rounded-lg border bg-card p-2.5 col-span-2 md:col-span-1">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                  <Zap className="w-3 h-3" />
                  إجمالي الصفقات
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {fmtNum(account.total_trades)}
                </div>
              </div>
            </div>

            {/* Reset button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={resetting}
                  className="shrink-0"
                >
                  {resetting ? (
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 ml-2" />
                  )}
                  تصفير الحساب
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    تأكيد تصفير الحساب الورقي
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    سيتم إلغاء جميع الصفقات المفتوحة وإعادة الرصيد إلى 100,000
                    ج.م. لا يمكن التراجع عن هذه العملية. هل أنت متأكد؟
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={resetting}>
                    إلغاء
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleResetAccount();
                    }}
                    disabled={resetting}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {resetting ? (
                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    ) : null}
                    نعم، صفّر الحساب
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* ==================================================
          2. ORDER EXECUTION PANEL + POSITIONS TABLE
          ================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Order Execution Panel */}
        <Card className="lg:col-span-4 xl:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-emerald-600" />
              تنفيذ أمر تداول
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {/* Ticker search */}
            <div className="space-y-1.5">
              <Label className="text-xs">البحث عن السهم</Label>
              <StockSearchDropdown
                value={tickerName}
                onSelect={handleTickerSelect}
              />
              {ticker && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    الرمز:{' '}
                    <span className="font-mono font-semibold" dir="ltr">
                      {ticker.toUpperCase()}
                    </span>
                  </span>
                  {livePrice != null && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold tabular-nums">
                      <span className="relative flex w-2 h-2">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
                      </span>
                      {fmtPrice(livePrice)} ج.م
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Asset type selector (segmented control) */}
            <div className="space-y-1.5">
              <Label className="text-xs">نوع الأصل</Label>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg border bg-muted/40">
                {(
                  [
                    { v: 'stock', label: ASSET_TYPE_LABELS.stock },
                    { v: 'crypto', label: ASSET_TYPE_LABELS.crypto },
                    { v: 'gold', label: ASSET_TYPE_LABELS.gold },
                  ] as { v: AssetType; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setAssetType(opt.v)}
                    className={`px-2 py-1.5 text-xs rounded-md font-medium transition-colors ${
                      assetType === opt.v
                        ? 'bg-background shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Order type BUY/SELL toggle */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={orderType === 'BUY' ? 'default' : 'outline'}
                onClick={() => setOrderType('BUY')}
                className={`h-9 ${
                  orderType === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <ArrowUpCircle className="w-4 h-4 ml-1.5" />
                شراء
              </Button>
              <Button
                type="button"
                variant={orderType === 'SELL' ? 'default' : 'outline'}
                onClick={() => setOrderType('SELL')}
                className={`h-9 ${
                  orderType === 'SELL'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                <ArrowDownCircle className="w-4 h-4 ml-1.5" />
                بيع
              </Button>
            </div>

            {/* Shares input + quick buttons */}
            <div className="space-y-1.5">
              <Label className="text-xs">الكمية</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                min={1}
                dir="ltr"
                className="text-right tabular-nums"
              />
              <div className="grid grid-cols-4 gap-1">
                {QUICK_SHARES.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShares(String(q))}
                    className="h-7 text-xs"
                  >
                    {fmtNum(q)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Entry price */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center justify-between">
                <span>سعر الدخول</span>
                {livePriceLoading && (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                )}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="text-right tabular-nums"
              />
              {livePrice != null && (
                <button
                  type="button"
                  onClick={() => setEntryPrice(String(livePrice))}
                  className="text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline"
                >
                  استخدام السعر الحي: {fmtPrice(livePrice)}
                </button>
              )}
            </div>

            {/* Stop loss */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Shield className="w-3 h-3 text-red-600" />
                وقف الخسارة (اختياري)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="text-right tabular-nums"
              />
              {slPctBelow != null && Number.isFinite(slPctBelow) && (
                <p className="text-[10px] text-muted-foreground">
                  {slPctBelow >= 0
                    ? `${fmtPct(Math.abs(slPctBelow))}% تحت سعر الدخول`
                    : `${fmtPct(Math.abs(slPctBelow))}% فوق سعر الدخول (للبيع)`}
                </p>
              )}
            </div>

            {/* Take profit */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Target className="w-3 h-3 text-emerald-600" />
                جني الأرباح (اختياري)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className="text-right tabular-nums"
              />
              {tpPctAbove != null && Number.isFinite(tpPctAbove) && (
                <p className="text-[10px] text-muted-foreground">
                  {tpPctAbove >= 0
                    ? `${fmtPct(Math.abs(tpPctAbove))}% فوق سعر الدخول`
                    : `${fmtPct(Math.abs(tpPctAbove))}% تحت سعر الدخول (للبيع)`}
                </p>
              )}
            </div>

            <Separator />

            {/* Order summary */}
            <div className="rounded-lg bg-muted/40 p-2.5 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">إجمالي التكلفة</span>
                <span className="font-semibold tabular-nums">
                  {fmtEgp(totalCost)} ج.م
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Shield className="w-3 h-3 text-red-600" />
                  المخاطرة
                </span>
                <span className="font-semibold tabular-nums text-red-700 dark:text-red-300">
                  {fmtEgp(riskAmount)} ج.م
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3 text-emerald-600" />
                  العائد المستهدف
                </span>
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {fmtEgp(rewardAmount)} ج.م
                </span>
              </div>
              <div className="flex justify-between border-t pt-1.5 mt-1.5">
                <span className="text-muted-foreground">نسبة العائد/المخاطرة</span>
                <span className="font-bold tabular-nums">
                  {rrRatio == null
                    ? '—'
                    : `1 : ${fmtPct(rrRatio)}`}
                </span>
              </div>
            </div>

            {/* Execute button */}
            <Button
              type="button"
              onClick={handleSubmitOrder}
              disabled={
                submitting ||
                !ticker ||
                sharesNum <= 0 ||
                entryNum <= 0
              }
              className={`w-full h-10 ${
                orderType === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 ml-2" />
              )}
              تنفيذ الأمر
            </Button>
          </CardContent>
        </Card>

        {/* Open Positions Table */}
        <Card className="lg:col-span-8 xl:col-span-9">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="w-4 h-4 text-emerald-600" />
                المراكز المفتوحة
                <Badge variant="secondary" className="text-xs">
                  {fmtNum(positionsSorted.length)}
                </Badge>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchPositions()}
                className="text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5 ml-1" />
                تحديث
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {positionsSorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Clock className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">لا توجد مراكز مفتوحة حالياً</p>
                <p className="text-xs">
                  ابدأ بتنفيذ أول أمر تداول من اللوحة الجانبية
                </p>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                {/* Mobile hint — table scrolls horizontally on narrow screens */}
                <div className="lg:hidden px-3 py-1.5 text-[10px] text-muted-foreground border-b bg-muted/30">
                  ← مرّر أفقياً لرؤية كل الأعمدة →
                </div>
                <table className="w-full text-xs min-w-[820px]">
                  <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                    <tr className="border-b">
                      <th className="text-right p-2 font-medium">السهم</th>
                      <th className="text-center p-2 font-medium">النوع</th>
                      <th className="text-center p-2 font-medium">الكمية</th>
                      <th className="text-center p-2 font-medium">سعر الدخول</th>
                      <th className="text-center p-2 font-medium">السعر الحالي</th>
                      <th className="text-center p-2 font-medium">القيمة السوقية</th>
                      <th className="text-center p-2 font-medium">P&L غير محقق</th>
                      <th className="text-center p-2 font-medium">SL / TP</th>
                      <th className="text-center p-2 font-medium">منذ</th>
                      <th className="text-center p-2 font-medium">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionsSorted.map((pos) => {
                      const isBuy = pos.order_type === 'BUY';
                      const pnl = pos.unrealized_pnl;
                      const livePx =
                        livePrices[pos.ticker] ?? pos.current_price;
                      return (
                        <tr
                          key={pos.id}
                          className={`border-b transition-colors ${rowBgClass(pnl)}`}
                        >
                          <td className="p-2">
                            <div className="font-mono font-semibold" dir="ltr">
                              {pos.ticker}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {ASSET_TYPE_LABELS[pos.asset_type as AssetType] ?? pos.asset_type}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            <Badge
                              variant="outline"
                              className={
                                isBuy
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                              }
                            >
                              {isBuy ? 'شراء' : 'بيع'}
                            </Badge>
                          </td>
                          <td className="p-2 text-center tabular-nums">
                            {fmtNum(pos.shares)}
                          </td>
                          <td className="p-2 text-center tabular-nums" dir="ltr">
                            {fmtPrice(pos.entry_price)}
                          </td>
                          <td className="p-2 text-center tabular-nums font-medium" dir="ltr">
                            {fmtPrice(livePx)}
                            {pos.current_price !== livePx && (
                              <span className="block text-[9px] text-muted-foreground">
                                ({fmtPrice(pos.current_price)})
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center tabular-nums" dir="ltr">
                            {fmtEgp(pos.market_value)}
                          </td>
                          <td
                            className={`p-2 text-center tabular-nums font-semibold ${pnlColor(pnl)}`}
                          >
                            {pnl >= 0 ? '+' : ''}
                            {fmtEgp(pnl)}
                            <span className="block text-[10px] opacity-80">
                              ({pnl >= 0 ? '+' : ''}
                              {fmtPct(pos.unrealized_pnl_pct)}%)
                            </span>
                          </td>
                          <td className="p-2 text-center text-[10px]">
                            {pos.stop_loss != null ? (
                              <div className="text-red-700 dark:text-red-300 tabular-nums" dir="ltr">
                                SL: {fmtPrice(pos.stop_loss)}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">SL: —</div>
                            )}
                            {pos.take_profit != null ? (
                              <div className="text-emerald-700 dark:text-emerald-300 tabular-nums" dir="ltr">
                                TP: {fmtPrice(pos.take_profit)}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">TP: —</div>
                            )}
                          </td>
                          <td className="p-2 text-center text-[10px] text-muted-foreground whitespace-nowrap">
                            {timeAgoAr(pos.opened_at)}
                          </td>
                          <td className="p-2 text-center">
                            <AlertDialog
                              open={
                                closeTarget?.id === pos.id && !!closeTarget
                              }
                              onOpenChange={(open) => {
                                if (!open) setCloseTarget(null);
                              }}
                            >
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCloseTarget(pos)}
                                  className="h-7 text-[11px] px-2"
                                >
                                  <X className="w-3 h-3 ml-1" />
                                  إغلاق
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    تأكيد إغلاق المركز
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    سيتم إغلاق مركز{' '}
                                    <span className="font-mono font-semibold" dir="ltr">
                                      {closeTarget?.ticker}
                                    </span>{' '}
                                    ({closeTarget?.order_type === 'BUY' ? 'شراء' : 'بيع'}{' '}
                                    {fmtNum(closeTarget?.shares ?? 0)} سهم) عند
                                    السعر الحالي{' '}
                                    <span className="font-semibold tabular-nums" dir="ltr">
                                      {fmtPrice(closeTarget?.current_price ?? 0)}
                                    </span>{' '}
                                    ج.م. الربح/الخسارة المتوقع:{' '}
                                    <span
                                      className={`font-semibold tabular-nums ${pnlColor(closeTarget?.unrealized_pnl)}`}
                                    >
                                      {(closeTarget?.unrealized_pnl ?? 0) >= 0 ? '+' : ''}
                                      {fmtEgp(closeTarget?.unrealized_pnl ?? 0)} ج.م
                                    </span>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel disabled={closing}>
                                    إلغاء
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (closeTarget) handleClosePosition(closeTarget);
                                    }}
                                    disabled={closing}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                  >
                                    {closing ? (
                                      <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                    ) : (
                                      <X className="w-4 h-4 ml-2" />
                                    )}
                                    تأكيد الإغلاق
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ==================================================
          3. TRADE HISTORY + PERFORMANCE CHART (Tabs)
          ================================================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4 text-emerald-600" />
            سجل التداول والأداء
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="history" className="w-full">
            <TabsList className="mb-3">
              <TabsTrigger value="history" className="text-xs">
                سجل الصفقات المغلقة
              </TabsTrigger>
              <TabsTrigger value="performance" className="text-xs">
                منحنى الأداء
              </TabsTrigger>
            </TabsList>

            {/* Trade history */}
            <TabsContent value="history" className="space-y-3">
              {closedSorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                  <Clock className="w-7 h-7 mb-2 opacity-50" />
                  <p className="text-sm">لا توجد صفقات مغلقة بعد</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[720px]">
                      <thead className="bg-muted/60">
                        <tr className="border-b">
                          <th className="text-right p-2 font-medium">السهم</th>
                          <th className="text-center p-2 font-medium">النوع</th>
                          <th className="text-center p-2 font-medium">الكمية</th>
                          <th className="text-center p-2 font-medium">سعر الدخول</th>
                          <th className="text-center p-2 font-medium">سعر الإغلاق</th>
                          <th className="text-center p-2 font-medium">الربح/الخسارة</th>
                          <th className="text-center p-2 font-medium">السبب</th>
                          <th className="text-center p-2 font-medium">وقت الإغلاق</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleClosed.map((order) => {
                          const isBuy = order.order_type === 'BUY';
                          const reason = (order.close_reason ?? 'MANUAL') as CloseReason;
                          const reasonLabel: Record<CloseReason, string> = {
                            MANUAL: 'يدوي',
                            STOP_LOSS: 'وقف خسارة',
                            TAKE_PROFIT: 'جني أرباح',
                          };
                          const reasonClass: Record<CloseReason, string> = {
                            MANUAL:
                              'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
                            STOP_LOSS:
                              'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
                            TAKE_PROFIT:
                              'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
                          };
                          return (
                            <tr
                              key={order.id}
                              className={`border-b ${rowBgClass(order.pnl)}`}
                            >
                              <td className="p-2">
                                <div className="font-mono font-semibold" dir="ltr">
                                  {order.ticker}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {ASSET_TYPE_LABELS[order.asset_type as AssetType] ?? order.asset_type}
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                <Badge
                                  variant="outline"
                                  className={
                                    isBuy
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                                  }
                                >
                                  {isBuy ? 'شراء' : 'بيع'}
                                </Badge>
                              </td>
                              <td className="p-2 text-center tabular-nums">
                                {fmtNum(order.shares)}
                              </td>
                              <td className="p-2 text-center tabular-nums" dir="ltr">
                                {fmtPrice(order.entry_price)}
                              </td>
                              <td className="p-2 text-center tabular-nums" dir="ltr">
                                {fmtPrice(order.close_price)}
                              </td>
                              <td
                                className={`p-2 text-center tabular-nums font-semibold ${pnlColor(order.pnl)}`}
                              >
                                {(order.pnl ?? 0) >= 0 ? '+' : ''}
                                {fmtEgp(order.pnl)}
                              </td>
                              <td className="p-2 text-center">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${reasonClass[reason]}`}
                                >
                                  {reasonLabel[reason]}
                                </Badge>
                              </td>
                              <td className="p-2 text-center text-[10px] text-muted-foreground whitespace-nowrap">
                                {dateTimeAr(order.closed_at)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {closedSorted.length > historyVisibleCount && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setHistoryVisibleCount((c) => c + HISTORY_PAGE_SIZE)
                        }
                      >
                        عرض المزيد ({fmtNum(closedSorted.length - historyVisibleCount)} متبقي)
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Performance chart */}
            <TabsContent value="performance">
              {equityHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                  <TrendingUp className="w-7 h-7 mb-2 opacity-50" />
                  <p className="text-sm">
                    سيظهر منحنى حقوق الملكية هنا بعد عدة تحديثات للأسعار
                  </p>
                  <p className="text-xs">
                    يتم تحديث المنحنى كل 10 ثوانٍ مع كل استطلاع للأسعار
                  </p>
                </div>
              ) : (
                <div className="w-full h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={equityHistory}
                      margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
                    >
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fontFamily: 'inherit' }}
                        reversed
                      />
                      <YAxis
                        tick={{ fontSize: 10, fontFamily: 'inherit' }}
                        orientation="right"
                        domain={['auto', 'auto']}
                        tickFormatter={(v: number) =>
                          new Intl.NumberFormat('ar-EG', {
                            notation: 'compact',
                          }).format(v)
                        }
                      />
                      <RechartsTooltip
                        contentStyle={{
                          fontSize: '12px',
                          fontFamily: 'inherit',
                          direction: 'rtl',
                        }}
                        formatter={(value: number) => [
                          `${fmtEgp(value)} ج.م`,
                          'حقوق الملكية',
                        ]}
                        labelFormatter={(label: string) => `الوقت: ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        name="حقوق الملكية"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default PaperTradingWorkstation;

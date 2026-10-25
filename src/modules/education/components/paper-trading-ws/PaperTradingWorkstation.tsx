/**
 * paper-trading-ws/PaperTradingWorkstation.tsx (container)
 * =========================================================
 * Main PaperTradingWorkstation container — full paper-trading simulator
 * for the academy (P40-ACADEMY Pillar 1). Originally 1,550 LOC (single
 * file). Split into paper-trading-ws/ folder in Task F-Phase3-FinalPush.
 *
 * Container owns: state, fetch logic, handlers, polling, auto-close
 * toasts. UI is delegated to AccountHeaderBar, OrderExecutionPanel,
 * OpenPositionsTable, HistoryAndPerformance sub-components.
 *
 * Constitution Rule 30 (Arabic), Rule 62 (GIT-PUSH-DISCIPLINE),
 * Rule 73 (SINGLE-DISPLAY-SOURCE — prices from backend, no fake data).
 */

'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import { fmtPrice } from '@/lib/utils';
import { toast } from 'sonner';
import { fmtEgp, fmtNum } from './helpers';
import {
  HISTORY_PAGE_SIZE,
  LIVE_PRICE_POLL_MS,
  POLL_INTERVAL_MS,
  type AssetType,
  type AutoClosedEntry,
  type ClosedOrder,
  type EquityHistoryPoint,
  type OpenPosition,
  type OrderType,
  type PaperTradingAccount,
} from './types';
import { AccountHeaderBar } from './AccountHeaderBar';
import { OrderExecutionPanel } from './OrderExecutionPanel';
import { OpenPositionsTable } from './OpenPositionsTable';
import { HistoryAndPerformance } from './HistoryAndPerformance';

export function PaperTradingWorkstation() {
  // Account + positions + prices
  const [account, setAccount] = useState<PaperTradingAccount | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [resetting, setResetting] = useState(false);

  // Trade history + equity chart
  const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [equityHistory, setEquityHistory] = useState<EquityHistoryPoint[]>([]);

  // Order form
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

  // Close-position dialog
  const [closeTarget, setCloseTarget] = useState<OpenPosition | null>(null);
  const [closing, setClosing] = useState(false);

  // Track previous autoClosed signatures so we only toast new ones
  const seenAutoClosedRef = useRef<Set<string>>(new Set());

  // Fetch account (initial)
  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trading-v2/account', { cache: 'no-store' });
      const data = await res.json();
      if (data?.success && data.account) setAccount(data.account);
    } catch {
      /* silent — polling will retry */
    } finally {
      setLoadingAccount(false);
    }
  }, []);

  // Fetch positions (also called by the poller)
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trading-v2/positions', { cache: 'no-store' });
      const data = await res.json();
      if (!data?.success) return;
      if (data.account) setAccount(data.account);
      setPositions(Array.isArray(data.positions) ? data.positions : []);
      if (data.livePrices && typeof data.livePrices === 'object') setLivePrices(data.livePrices);

      // Append current equity to in-memory history (keep last 60 points)
      if (data.account?.total_equity != null) {
        setEquityHistory((prev) => [
          ...prev,
          {
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
            equity: Math.round(data.account.total_equity * 100) / 100,
          },
        ].slice(-60));
      }

      // Fire toast notifications for any newly auto-closed orders
      const autoClosed: AutoClosedEntry[] = Array.isArray(data.autoClosed) ? data.autoClosed : [];
      for (const entry of autoClosed) {
        const key = `${entry.order.id}-${entry.reason}`;
        if (seenAutoClosedRef.current.has(key)) continue;
        seenAutoClosedRef.current.add(key);
        const pnl = entry.order.pnl ?? 0;
        const tickerLabel = entry.order.ticker;
        const pnlLabel = fmtEgp(Math.abs(pnl));
        if (entry.reason === 'STOP_LOSS') {
          toast.error(`🔒 تم تفعيل وقف الخسارة لـ ${tickerLabel} — خسارة ${pnlLabel} ج.م`);
        } else {
          toast.success(`🎯 تم تحقيق الهدف لـ ${tickerLabel} — ربح ${pnlLabel} ج.م`);
        }
      }
    } catch {
      /* silent — polling will retry */
    }
  }, []);

  // Fetch closed orders (trade history)
  const fetchClosedOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trading-v2/orders?status=closed', { cache: 'no-store' });
      const data = await res.json();
      if (data?.success) setClosedOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchAccount();
    fetchPositions();
    fetchClosedOrders();
  }, [fetchAccount, fetchPositions, fetchClosedOrders]);

  // Auto-refresh positions every 10s (visible-tab-aware). allowOffMarket = true
  // so the academy simulator keeps polling even on weekends (paper trading).
  useVisibilityAwarePolling(
    () => { fetchPositions(); },
    POLL_INTERVAL_MS,
    [],
    { allowOffMarket: true },
  );

  // Live-price polling for the currently selected ticker (5s interval)
  const fetchLivePriceForTicker = useCallback(async () => {
    if (!ticker) {
      setLivePrice(null);
      return;
    }
    setLivePriceLoading(true);
    try {
      let price: number | null = null;
      if (assetType === 'crypto') {
        const res = await fetch(`/api/crypto/live?symbol=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const candidate = data?.price ?? data?.current_price ?? data?.last_price;
          if (typeof candidate === 'number' && Number.isFinite(candidate)) price = candidate;
        }
      } else if (assetType === 'gold') {
        const res = await fetch('/api/metals-forex/status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const candidate = data?.gold?.price_per_gram ?? data?.gold_price ?? null;
          if (typeof candidate === 'number' && Number.isFinite(candidate)) price = candidate;
        }
      } else {
        const res = await fetch(`/api/stocks/${encodeURIComponent(ticker)}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const stock = data?.stock || data;
          const candidate = stock?.current_price ?? stock?.last_price ?? stock?.close ?? null;
          if (typeof candidate === 'number' && Number.isFinite(candidate)) price = candidate;
        }
      }
      if (price != null) {
        setLivePrice(price);
        // Auto-fill entry price if empty or matches the previous live price
        setEntryPrice((prev) => {
          if (!prev || prev === '') return String(price);
          const prevNum = parseFloat(prev);
          if (!Number.isFinite(prevNum) || prevNum === livePrice) return String(price);
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
    fetchLivePriceForTicker();
    const id = setInterval(() => {
      if (!document.hidden) fetchLivePriceForTicker();
    }, LIVE_PRICE_POLL_MS);
    return () => clearInterval(id);
  }, [ticker, assetType, fetchLivePriceForTicker]);

  // Derived order-summary values
  const sharesNum = parseFloat(shares) || 0;
  const entryNum = parseFloat(entryPrice) || 0;
  const slNum = stopLoss ? parseFloat(stopLoss) : NaN;
  const tpNum = takeProfit ? parseFloat(takeProfit) : NaN;

  const totalCost = useMemo(() => sharesNum * entryNum, [sharesNum, entryNum]);
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

  // Handlers
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
    if (!ticker) { toast.error('اختر السهم أولاً'); return; }
    if (sharesNum <= 0) { toast.error('الكمية يجب أن تكون أكبر من صفر'); return; }
    if (entryNum <= 0) { toast.error('سعر الدخول يجب أن يكون أكبر من صفر'); return; }
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
        toast.error(data?.error || 'فشل تنفيذ الأمر');
        return;
      }
      toast.success(
        `✅ تم تنفيذ أمر ${orderType === 'BUY' ? 'شراء' : 'بيع'} ${fmtNum(
          sharesNum,
        )} سهم من ${ticker.toUpperCase()} @ ${fmtPrice(entryNum)}`,
      );
      // Clear form (keep ticker + assetType for quick re-order)
      setShares('10');
      setStopLoss('');
      setTakeProfit('');
      // Refresh everything
      await Promise.all([fetchPositions(), fetchAccount(), fetchClosedOrders()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ الأمر');
    } finally {
      setSubmitting(false);
    }
  }, [
    ticker, sharesNum, entryNum, assetType, orderType,
    stopLoss, takeProfit, slNum, tpNum,
    fetchPositions, fetchAccount, fetchClosedOrders,
  ]);

  const handleResetAccount = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/paper-trading-v2/reset', { method: 'POST' });
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
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تصفير الحساب');
    } finally {
      setResetting(false);
    }
  }, []);

  const handleClosePosition = useCallback(
    async (pos: OpenPosition) => {
      setClosing(true);
      try {
        const res = await fetch(`/api/paper-trading-v2/orders/${pos.id}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_price: pos.current_price, reason: 'MANUAL' }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'فشل إغلاق الصفقة');
          return;
        }
        toast.success(data.message || 'تم إغلاق الصفقة');
        setCloseTarget(null);
        await Promise.all([fetchPositions(), fetchAccount(), fetchClosedOrders()]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الإغلاق');
      } finally {
        setClosing(false);
      }
    },
    [fetchPositions, fetchAccount, fetchClosedOrders],
  );

  // Render
  if (loadingAccount && !account) {
    return (
      <div dir="rtl" className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-profit" />
          <p className="text-sm">جاري تحميل محطة التداول الورقي...</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div dir="rtl" className="flex items-center justify-center min-h-[400px] p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <p className="text-loss font-medium">تعذّر تحميل حساب التداول الورقي</p>
            <Button onClick={() => fetchAccount()} variant="outline">
              <RefreshCw className="w-4 h-4 ml-2" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4 w-full max-w-[1600px] mx-auto p-2 sm:p-4">
      <AccountHeaderBar account={account} resetting={resetting} onReset={handleResetAccount} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <OrderExecutionPanel
          ticker={ticker}
          tickerName={tickerName}
          onTickerSelect={handleTickerSelect}
          assetType={assetType}
          onAssetTypeChange={setAssetType}
          orderType={orderType}
          onOrderTypeChange={setOrderType}
          shares={shares}
          onSharesChange={setShares}
          entryPrice={entryPrice}
          onEntryPriceChange={setEntryPrice}
          livePrice={livePrice}
          livePriceLoading={livePriceLoading}
          stopLoss={stopLoss}
          onStopLossChange={setStopLoss}
          takeProfit={takeProfit}
          onTakeProfitChange={setTakeProfit}
          slPctBelow={slPctBelow}
          tpPctAbove={tpPctAbove}
          totalCost={totalCost}
          riskAmount={riskAmount}
          rewardAmount={rewardAmount}
          rrRatio={rrRatio}
          submitting={submitting}
          onSubmit={handleSubmitOrder}
        />
        <OpenPositionsTable
          positions={positions}
          livePrices={livePrices}
          onRefresh={fetchPositions}
          closeTarget={closeTarget}
          onCloseTargetChange={setCloseTarget}
          onConfirmClose={handleClosePosition}
          closing={closing}
        />
      </div>

      <HistoryAndPerformance
        closedOrders={closedOrders}
        visibleCount={historyVisibleCount}
        onLoadMore={() => setHistoryVisibleCount((c) => c + HISTORY_PAGE_SIZE)}
        equityHistory={equityHistory}
      />
    </div>
  );
}

export default PaperTradingWorkstation;

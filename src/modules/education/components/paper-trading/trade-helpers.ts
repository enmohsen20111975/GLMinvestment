// trade calculation helpers — extracted (Phase 3)

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
 <Loader2 className="w-8 h-8 animate-spin text-profit" />
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
 <p className="text-loss font-medium">
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
 <Card className="border-profit ">
 <CardContent className="pt-5 pb-4">
 <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
 {/* Account title */}
 <div className="flex items-center gap-3 min-w-0">
 <div className="flex items-center justify-center w-11 h-11 rounded-full bg-profit/10 text-profit border border-profit/20 ">
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
 <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
 <DollarSign className="w-3 h-3" />
 الرصيد المتاح
 </div>
 <div className="text-sm font-bold tabular-nums">
 {fmtEgp(account.virtual_balance)}
 <span className="text-xs text-muted-foreground mr-1">
 ج.م
 </span>
 </div>
 </div>
 {/* Total equity */}
 <div className="rounded-lg border bg-card p-2.5">
 <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
 <Activity className="w-3 h-3" />
 إجمالي حقوق الملكية
 </div>
 <div className="text-sm font-bold tabular-nums">
 {fmtEgp(account.total_equity)}
 <span className="text-xs text-muted-foreground mr-1">
 ج.م
 </span>
 </div>
 </div>
 {/* Total P&L */}
 <div className="rounded-lg border bg-card p-2.5">
 <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
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
 <span className="text-xs text-muted-foreground mr-1">
 ج.م
 </span>
 </div>
 </div>

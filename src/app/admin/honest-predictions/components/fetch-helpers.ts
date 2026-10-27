// fetch + data helpers — extracted (Phase 3)

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
 runFullTest: true,
 }),
 });
 const data = await res.json();
 if (data.success) {
 setTestReport(data);
 toast.success(`الاختبار الكامل اكتمل: ${data.message}`);
 fetchAll();
 } else {
 toast.error(`فشل الاختبار الكامل: ${data.error}`);
 }
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : String(e);
 toast.error(`خطأ في الاختبار: ${msg}`);
 } finally {
 setTesting(false);
 }
 };

 // ============================================================================
 // RENDER
 // ============================================================================

 if (loading && !stats) {
 return (
 <div className="flex items-center justify-center min-h-[60vh]">
 <div className="text-center space-y-4">
 <RefreshCw className="h-12 w-12 animate-spin mx-auto text-primary" />
 <p className="text-muted-foreground">جارٍ تحميل التوقعات الحقيقية...</p>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-6 p-4 md:p-6">
 {/* Header */}
 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
 <div>
 <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
 <Target className="h-7 w-7 text-primary" />
 التوقعات الحقيقية — تتبّع صادق
 </h1>
 <p className="text-muted-foreground mt-1 text-sm md:text-base">
 كل توقع مبني على تحليل فني + شموع يابانية + دعوم/مقاومات، ومتأكد من الأسعار الفعلية. لا توجد بيانات مصطنعة.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Button onClick={handleGenerate} disabled={generating} variant="default" size="sm">
 {generating ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <Zap className="h-4 w-4 ml-2" />}
 {generating ? 'جارٍ التوليد...' : 'توليد التوقعات'}
 </Button>
 <Button onClick={handleVerify} disabled={verifying} variant="outline" size="sm">
 {verifying ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <RefreshCw className="h-4 w-4 ml-2" />}
 {verifying ? 'جارٍ التحقق...' : 'تحقق من المعلقة'}
 </Button>
 <Button onClick={() => handleLearn()} disabled={learning} variant="outline" size="sm">
 {learning ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <Brain className="h-4 w-4 ml-2" />}
 {learning ? 'جارٍ التحليل...' : 'تعلّم من الأخطاء'}
 </Button>
 <Button onClick={handleFullTest} disabled={testing} variant="default" size="sm">
 {testing ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <PlayCircle className="h-4 w-4 ml-2" />}
 {testing ? 'جارٍ الاختبار الكامل...' : ' اختبار كامل'}
 </Button>
 </div>
 </div>

 {/* TOP-TRADES-037 + STOCK-LEAGUE-038: Image Cards للنشر الإعلاني */}
 <div className="flex flex-col lg:flex-row gap-6 justify-center items-start">
 <TopTradesImageCard trades={topTrades} />
 <StockLeagueImageCard />
 </div>

 {/* Advanced Settings Panel */}
 <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
 <div className="flex items-center justify-between">
 <CollapsibleTrigger asChild>
 <Button variant="outline" size="sm" className="gap-2">
 <Settings className="h-4 w-4" />
 ⚙️ إعدادات متقدمة
 {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
 </Button>
 </CollapsibleTrigger>
 {!settingsOpen && (
 <span className="text-xs text-muted-foreground">
 {startDate} → {endDate} | {tickersPerMarket} أسهم/سوق | كل {sampleEveryDays} يوم
 </span>
 )}
 </div>
 <CollapsibleContent>
 <Card className="mt-3 border-profit/20 bg-muted/30">
 <CardContent className="p-4 md:p-6 space-y-6">
 {/* Prediction Period */}
 <div>
 <h3 className="text-sm font-semibold text-profit mb-3 flex items-center gap-2">
 <Activity className="h-4 w-4" />
 فترة التوقعات
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Label htmlFor="startDate" className="text-sm">تاريخ البداية</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>Start Date — beginning of the analysis period</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <Input
 id="startDate"
 type="date"
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className="bg-background"
 />
 </div>
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Label htmlFor="endDate" className="text-sm">تاريخ النهاية</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>End Date — end of the analysis period (default: today)</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <Input
 id="endDate"
 type="date"
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className="bg-background"
 />
 </div>
 </div>
 </div>

 <Separator />

 {/* Analysis Settings */}
 <div>
 <h3 className="text-sm font-semibold text-profit mb-3 flex items-center gap-2">
 <BarChart3 className="h-4 w-4" />
 إعدادات التحليل
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Label className="text-sm">عدد الأسهم لكل سوق</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>Tickers Per Market — number of stocks analyzed per market</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <span className="text-sm font-bold text-profit bg-profit/10 px-2 py-0.5 rounded">{tickersPerMarket}</span>
 </div>
 <Slider
 value={[tickersPerMarket]}
 onValueChange={(v) => setTickersPerMarket(v[0])}
 min={5}
 max={30}
 step={1}
 className="w-full"
 />
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>5</span>
 <span>30</span>
 </div>
 </div>
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Label className="text-sm">فترة أخذ العينات بالأيام</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>Sample Every Days — interval between analysis snapshots</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <span className="text-sm font-bold text-profit bg-profit/10 px-2 py-0.5 rounded">{sampleEveryDays}</span>
 </div>
 <Slider
 value={[sampleEveryDays]}
 onValueChange={(v) => setSampleEveryDays(v[0])}
 min={1}
 max={30}
 step={1}
 className="w-full"
 />
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>1</span>
 <span>30</span>
 </div>
 </div>
 </div>
 <div className="mt-4 flex items-center gap-3">
 <div className="flex items-center gap-2">
 <Label htmlFor="clearExisting" className="text-sm">مسح البيانات الموجودة</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>Clear Existing — remove all previous predictions before generating new ones</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <Switch
 id="clearExisting"
 checked={clearExisting}
 onCheckedChange={setClearExisting}
 />
 </div>
 </div>

 <Separator />

 {/* Dynamic Params Summary */}
 {dynamicParams && (
 <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/40">
 <Brain className="h-4 w-4 text-profit" />
 <div className="text-xs">
 <span className="font-semibold">معاملات ديناميكية:</span>{' '}
 <span className="text-muted-foreground">
 {dynamicSource === 'market-regime'
 ? `معدلة تلقائياً بناءً على السوق (RSI=${(dynamicParams.meta as Record<string, unknown> | undefined)?.avgRsi ?? '-'}, تقلب=${(dynamicParams.meta as Record<string, unknown> | undefined)?.avgAtrPct ?? '-'}%)`
 : 'قيم افتراضية'}
 </span>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={fetchDynamicParams}
 className="h-7 px-2"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </Button>
 </div>
 )}

 {/* Technical Analysis Parameters */}
 <div>
 <h3 className="text-sm font-semibold text-profit mb-3 flex items-center gap-2">
 <CandlestickChart className="h-4 w-4" />
 معاملات التحليل الفني
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Label htmlFor="atrPeriod" className="text-sm">فترة ATR</Label>
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
 </TooltipTrigger>
 <TooltipContent>ATR Period — Average True Range calculation period</TooltipContent>
 </Tooltip>
 </TooltipProvider>
 </div>
 <Input
 id="atrPeriod"
 type="number"
 min={1}
 max={100}
 value={atrPeriod}
 onChange={(e) => setAtrPeriod(Number(e.target.value))}
 className="bg-background"
 />
 </div>
 <div className="space-y-2">
 <div className="flex items-center gap-2">

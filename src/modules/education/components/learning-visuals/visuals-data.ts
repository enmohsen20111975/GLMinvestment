// more visual data — extracted (Phase 3)

 const slice = data.slice(i - period + 1, i + 1);
 return slice.reduce((a, b) => a + b, 0) / period;
 });
 };
 const ma5 = calcSMA(candles, 5);
 const ma10 = calcSMA(candles, 10);

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">المتوسطات المتحركة (MA 5 و MA 10)</h4>
 <svg width="100%" height="200" viewBox="0 0 360 200">
 {/* Price candles */}
 {candles.map((c, i) => {
 const x = 20 + i * 22;
 const y = 180 - (c - 115) * 5;
 return (
 <motion.rect
 key={`c-${i}`}
 x={x} y={y} width="6" height="10"
 fill={c >= candles[i-1] ? '#10b981' : '#ef4444'}
 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
 />
 );
 })}
 {/* MA5 line */}
 <motion.path
 d={`M ${ma5.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
 fill="none" stroke="#f59e0b" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5 }}
 />
 {/* MA10 line */}
 <motion.path
 d={`M ${ma10.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
 fill="none" stroke="#3b82f6" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.3 }}
 />
 </svg>
 <div className="flex justify-center gap-4 mt-2 text-xs">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning" /> MA 5 (سريع)</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> MA 10 (بطيء)</span>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 التقاطع الذهبي: MA السريع يقطع البطيء صعوداً = إشارة شراء
 </p>
 </div>
 );
}

/* ── 12. Bollinger Bands (نطاقات بولينجر) ── */
export function BollingerBandsVisual() {
 const prices = [120, 122, 118, 125, 128, 124, 130, 135, 132, 128, 125, 122, 126, 130, 134];
 const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
 const upper = sma + 8;
 const lower = sma - 8;

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">نطاقات بولينجر (Bollinger Bands)</h4>
 <svg width="100%" height="200" viewBox="0 0 360 200">
 {/* Upper band */}
 <motion.path
 d={`M 20 ${180 - (upper - 115) * 5} Q 180 ${180 - (upper - 115) * 4} 340 ${180 - (upper - 115) * 5}`}
 fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
 />
 {/* Middle (SMA) */}
 <motion.line
 x1="20" y1={180 - (sma - 115) * 5} x2="340" y2={180 - (sma - 115) * 5}
 stroke="#6b7280" strokeWidth="1.5"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.2 }}
 />
 {/* Lower band */}
 <motion.path
 d={`M 20 ${180 - (lower - 115) * 5} Q 180 ${180 - (lower - 115) * 6} 340 ${180 - (lower - 115) * 5}`}
 fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.4 }}
 />
 {/* Price line */}
 <motion.path
 d={`M ${prices.map((p, i) => `${20 + i * 22} ${180 - (p - 115) * 5}`).join(' L ')}`}
 fill="none" stroke="#3b82f6" strokeWidth="2"
 initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.5 }}
 />
 {/* Squeeze annotation */}
 <rect x="140" y="40" width="80" height="20" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3" />
 <text x="150" y="35" fontSize="9" fill="#f59e0b" fontWeight="bold">Squeeze (تضييق)</text>
 </svg>
 <div className="flex justify-center gap-4 mt-2 text-xs flex-wrap">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> السعر</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-muted" /> المتوسط (SMA20)</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-loss" /> النطاق العلوي</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-profit" /> النطاق السفلي</span>
 </div>
 </div>
 );
}

/* ── 13. DCF Flow (نموذج التدفقات النقدية المخصومة) ── */
export function DCFFlowVisual() {
 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">نموذج DCF - كيف نحسب القيمة العادلة</h4>
 <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
 {/* Step 1 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
 className="flex-1 p-3 rounded-lg bg-profit/10 border border-profit/20 text-center"
 >
 <p className="text-xs font-bold text-profit mb-1">1. تقدير التدفقات</p>
 <p className="text-xs">النقدية المتوقعة لـ 5 سنوات</p>
 </motion.div>
 <span className="text-profit text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 2 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
 className="flex-1 p-3 rounded-lg bg-whale/10 border border-whale/20 text-center"
 >
 <p className="text-xs font-bold text-whale mb-1">2. معدل الخصم</p>
 <p className="text-xs">خصم للتضخم والمخاطر</p>
 </motion.div>
 <span className="text-whale text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 3 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
 className="flex-1 p-3 rounded-lg bg-warning/10 border border-warning/20 text-center"
 >
 <p className="text-xs font-bold text-warning mb-1">3. القيمة الطرفية</p>
 <p className="text-xs">قيمة ما بعد 5 سنوات</p>
 </motion.div>
 <span className="text-warning text-center rotate-90 sm:rotate-0">←</span>
 {/* Step 4 */}
 <motion.div
 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
 className="flex-1 p-3 rounded-lg bg-primary/10 border border-purple-500/30 text-center"
 >
 <p className="text-xs font-bold text-primary mb-1">4. القيمة العادلة</p>
 <p className="text-xs">مجموع القيم الحالية</p>
 </motion.div>
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 الفكرة: جنيه اليوم أثمن من جنيه الغد → نخصم التدفقات المستقبلية
 </p>
 </div>
 );
}

/* ── 14. ROE DuPont (تحليل العائد على حقوق الملكية) ── */
export function ROEDuPontVisual() {
 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">تحليل DuPont - فكك ROE لـ 3 مكونات</h4>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
 className="p-3 rounded-lg bg-profit/10 border border-profit/20 text-center"
 >
 <p className="text-xs font-bold text-profit">هامش الربح</p>
 <p className="text-xs text-muted-foreground mb-1">صافي الربح ÷ الإيرادات</p>
 <p className="text-lg font-bold">15%</p>
 </motion.div>
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
 className="p-3 rounded-lg bg-whale/10 border border-whale/20 text-center"
 >
 <p className="text-xs font-bold text-whale">دوران الأصول</p>
 <p className="text-xs text-muted-foreground mb-1">الإيرادات ÷ الأصول</p>
 <p className="text-lg font-bold">1.2x</p>
 </motion.div>
 <motion.div
 initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}
 className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-center"
 >
 <p className="text-xs font-bold text-warning">الرافعة المالية</p>
 <p className="text-xs text-muted-foreground mb-1">الأصول ÷ حقوق الملكية</p>
 <p className="text-lg font-bold">2.0x</p>
 </motion.div>
 </div>
 <div className="mt-3 p-3 rounded-lg bg-primary/10 border border-purple-500/30 text-center">
 <p className="text-xs font-bold text-primary mb-1">ROE = هامش الربح × دوران الأصول × الرافعة</p>
 <p className="text-lg font-bold">15% × 1.2 × 2.0 = 36%</p>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 ميزة DuPont: تعرفك هل ROE العالي بسبب الكفاءة ولا بسبب الديون الكثيرة
 </p>
 </div>
 );
}

/* ── 15. Emotional Cycle (دورة المشاعر في التداول) ── */
export function EmotionalCycleVisual() {
 const emotions = [
 { phase: 'التفاؤل', color: 'bg-profit', icon: '😊' },
 { phase: 'الحماس', color: 'bg-whale', icon: '🤩' },
 { phase: 'النشوة', color: 'bg-whale', icon: '🤑' },
 { phase: 'القلق', color: 'bg-warning', icon: '😰' },
 { phase: 'الإنكار', color: 'bg-warning', icon: '😨' },
 { phase: 'الذعر', color: 'bg-loss', icon: '😱' },
 { phase: 'الاستسلام', color: 'bg-muted', icon: '😞' },
 { phase: 'الاكتئاب', color: 'bg-muted', icon: '😔' },
 ];

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">دورة المشاعر في التداول - احذرها!</h4>
 <div className="grid grid-cols-4 gap-2">
 {emotions.map((e, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: i * 0.1 }}
 className={`flex flex-col items-center p-2 rounded-lg ${e.color} text-white`}
 >
 <span className="text-2xl">{e.icon}</span>
 <span className="text-xs font-bold mt-1">{e.phase}</span>
 </motion.div>
 ))}
 </div>
 <p className="text-xs text-muted-foreground mt-3 text-center">
 الترتيب من اليسار لليمين: مع ارتفاع السعر (مرحلة 1-3) ثم الهبوط (4-8)
 </p>
 </div>
 );
}

/* ── 16. DCA Strategy (استراتيجية المتوسط) ── */
export function DCAStrategyVisual() {
 const months = [
 { month: 'يناير', price: 100, shares: 10, invest: 1000 },
 { month: 'فبراير', price: 80, shares: 12.5, invest: 1000 },
 { month: 'مارس', price: 60, shares: 16.67, invest: 1000 },
 { month: 'أبريل', price: 90, shares: 11.11, invest: 1000 },
 { month: 'مايو', price: 110, shares: 9.09, invest: 1000 },
 ];
 const totalShares = months.reduce((a, m) => a + m.shares, 0);
 const totalInvest = months.reduce((a, m) => a + m.invest, 0);
 const avgPrice = totalInvest / totalShares;

 return (
 <div className="my-6 p-4 rounded-xl bg-card border border-border">
 <h4 className="font-bold mb-3 text-center">استراتيجية DCA - متوسط تكلفة الوحدات</h4>
 <div className="space-y-2">
 {months.map((m, i) => (
 <motion.div
 key={i}
 initial={{ opacity: 0, x: -20 }}
 animate={{ opacity: 1, x: 0 }}
 transition={{ delay: i * 0.15 }}
 className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-muted/30 text-xs"
 >
 <span className="font-semibold">{m.month}</span>
 <span>السعر: {m.price} ج.م</span>
 <span>استثمار: {m.invest} ج.م</span>
 <span className="font-bold text-profit">أسهم: {(m.shares ?? 0).toFixed(2)}</span>
 </motion.div>
 ))}
 </div>
 <div className="mt-3 p-3 rounded-lg bg-profit/10 border border-profit/20">
 <div className="flex justify-between text-sm">
 <span>إجمالي الاستثمار:</span>
 <span className="font-bold">{totalInvest} ج.م</span>
 </div>
 <div className="flex justify-between text-sm">
 <span>إجمالي الأسهم:</span>
 <span className="font-bold">{(totalShares ?? 0).toFixed(2)} سهم</span>
 </div>
 <div className="flex justify-between text-sm font-bold text-profit ">
 <span>متوسط السعر:</span>
 <span>{(avgPrice ?? 0).toFixed(2)} ج.م</span>
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2 text-center">
 DCA بتقلل متوسط السعر لأنك بتشتري أسهم أكثر لما السعر ينزل
 </p>
 </div>
 );
}

/* ── 17. Diagram Dispatcher (يرسم الرسم المناسب حسب الاسم) ── */
export function DiagramRenderer({ type }: { type: string }) {
 switch (type) {
 case 'candlestick-bullish':
 return <CandlestickDiagram variant="bullish" />;
 case 'candlestick-bearish':
 return <CandlestickDiagram variant="bearish" />;
 case 'candlestick-doji':
 return <CandlestickDiagram variant="doji" />;
 case 'candlestick-hammer':
 return <CandlestickDiagram variant="hammer" />;
 case 'pe-ratio':
 return <PERatioVisual />;
 case 'market-hours':
 return <MarketHoursTimeline />;
 case 'portfolio-diversification':
 return <PortfolioDiversification />;
 case 'risk-pyramid':
 return <RiskPyramid />;
 case 'rsi-gauge':
 return <RSIGauge />;
 case 'macd':

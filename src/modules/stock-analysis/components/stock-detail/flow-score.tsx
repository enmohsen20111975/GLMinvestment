// FlowScoreCard + FundamentalsCard — extracted (Phase 3)

 // We also detect the legacy inline JSX derivation pattern so the badge still
 // shows for cached / pre-flag responses.
 const isEst = (section: Record<string, unknown> | undefined, key: string): boolean =>
 !!section && typeof section === 'object' &&
 !!(section as Record<string, unknown>).is_estimated &&
 !!((section as Record<string, Record<string, boolean>>).is_estimated)[key];
 const estimationMethod: string = profile.estimation_method || 'raw';
 const showEstimationNote =
 estimationMethod === 'structural' || estimationMethod === 'mixed';

 // Inline-derived estimated values (legacy JSX fallback path) — these
 // compute the same values structurally inside the JSX when raw is missing.
 const totalEquityInlineEst =
 !bs?.total_equity && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
 const totalAssetsInlineEst =
 !bs?.total_assets && !!(profile.basic?.market_cap);
 const totalLiabInlineEst =
 !bs?.total_liabilities && !!(profile.basic?.market_cap) && !!(profile.basic?.pb_ratio);
 const revenueInlineEst =
 !inc?.revenue && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);
 const netIncomeInlineEst =
 !inc?.net_income && !!(profile.basic?.market_cap) && !!(profile.basic?.pe_ratio);

 return (
 <div className="rounded-xl border border-border p-5 bg-white dark:bg-slate-950 shadow-sm mt-3" dir="rtl">
 {/* Header with Health Score */}
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-900">
 <div>
 <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
 <BarChart3 className="w-5 h-5 text-profit" />
 تحليل البيانات الأساسية والهيكلية للسهم
 </h3>
 <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-0.5">البيانات مستخرجة مباشرة من مركز معلومات البورصة</p>
 </div>
 {hs && (
 <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold" style={{
 backgroundColor: hs.color === 'emerald' ? '#10b98115' : hs.color === 'green' ? '#22c55e15' : hs.color === 'amber' ? '#f59e0b15' : '#ef444415',
 color: hs.color === 'emerald' ? '#10b981' : hs.color === 'green' ? '#22c55e' : hs.color === 'amber' ? '#f59e0b' : '#ef4444',
 border: `1px solid ${hs.color === 'emerald' ? '#10b98125' : hs.color === 'green' ? '#22c55e25' : hs.color === 'amber' ? '#f59e0b25' : '#ef444425'}`
 }}>
 <Zap className="w-3.5 h-3.5" />
 مؤشر الصحة المالية: {String(hs.score)}/100 ({String(hs.label)})
 </div>
 )}
 </div>

 {showEstimationNote && (
 <div
 className="mb-4 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning flex items-center gap-2"
 dir="rtl"
 >
 <span aria-hidden>ℹ️</span>
 <span>بعض القيم مُقدّرة هيكلياً من القيمة السوقية ومكررات السعر — البيانات الخام غير متاحة.</span>
 </div>
 )}

 {/* Tab Buttons */}
 <div className="flex border-b border-slate-100 dark:border-slate-900 mb-4 overflow-x-auto gap-2 scrollbar-none">
 <button
 onClick={() => setActiveTab('valuation')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'valuation'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 التقييم والربحية
 </button>
 <button
 onClick={() => setActiveTab('statements')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'statements'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 القوائم المالية الهيكلية
 </button>
 <button
 onClick={() => setActiveTab('dividends')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'dividends'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 الأرباح والتوزيعات
 </button>
 <button
 onClick={() => setActiveTab('technical')}
 className={cn(
 "pb-2.5 px-3 text-xs font-bold border-b-2 transition-all whitespace-nowrap",
 activeTab === 'technical'
 ? "border-profit text-profit "
 : "border-transparent text-muted-foreground hover:text-slate-900 dark:hover:text-foreground"
 )}
 >
 الأداء والتحليل الفني
 </button>
 </div>

 {/* Tab Content */}
 <div className="min-h-[140px]">
 {/* Tab 1: Valuation & Profitability */}
 {activeTab === 'valuation' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Valuation Columns */}
 <div className="space-y-2">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider mb-2">مكررات القيمة والتقييم (Valuation)</h4>
 <div className="grid grid-cols-2 gap-3">
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر الربحية (P/E)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5 flex items-center gap-1">
 <span>{val?.pe_ratio ? (val.pe_ratio ?? 0).toFixed(2) : (profile.basic?.pe_ratio ? (profile.basic.pe_ratio ?? 0).toFixed(2) : 'N/A')}</span>
 {isEst(val, 'pe_ratio') && <EstimatedBadge />}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">القيمة الدفترية (P/B)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5 flex items-center gap-1">
 <span>{val?.pb_ratio ? (val.pb_ratio ?? 0).toFixed(2) : (profile.basic?.pb_ratio ? (profile.basic.pb_ratio ?? 0).toFixed(2) : 'N/A')}</span>
 {isEst(val, 'pb_ratio') && <EstimatedBadge />}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر المبيعات (P/S)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">
 {val?.ps_ratio ? (val.ps_ratio ?? 0).toFixed(2) : (profile.basic?.ps_ratio ? (profile.basic.ps_ratio ?? 0).toFixed(2) : 'N/A')}
 </div>
 </div>
 <div className="bg-slate-50/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900">
 <div className="text-xs text-muted-foreground">مكرر نمو الأرباح (PEG)</div>
 <div className="text-sm font-extrabold text-slate-900 mt-0.5">
 {val?.peg_ratio ? (val.peg_ratio ?? 0).toFixed(2) : 'N/A'}
 </div>
 </div>
 </div>
 </div>

 {/* Profitability Columns */}
 <div className="space-y-3">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground uppercase tracking-wider">مؤشرات الربحية والتشغيل (Profitability)</h4>
 <div className="space-y-2.5">
 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">العائد على حقوق الملكية (ROE)</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{prof?.roe ? `${(prof.roe ?? 0).toFixed(2)}%` : (profile.basic?.roe ? `${(profile.basic.roe ?? 0).toFixed(2)}%` : 'N/A')}</span>
 {(isEst(prof, 'roe') || isEst(profile.basic, 'roe')) && <EstimatedBadge />}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-profit h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.roe || profile.basic?.roe || 0, 0), 100)}%` }}></div>
 </div>
 </div>

 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">هامش الربح التشغيلي (Operating Margin)</span>
 <span className="font-bold text-whale">
 {prof?.operating_margin ? `${(prof.operating_margin ?? 0).toFixed(2)}%` : 'N/A'}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-whale h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.operating_margin || 0, 0), 100)}%` }}></div>
 </div>
 </div>

 <div>
 <div className="flex justify-between text-xs mb-1">
 <span className="text-muted-foreground">هامش صافي الربح (Net Margin)</span>
 <span className="font-bold text-primary">
 {prof?.net_margin ? `${(prof.net_margin ?? 0).toFixed(2)}%` : (profile.basic?.profit_margin ? `${(profile.basic.profit_margin ?? 0).toFixed(2)}%` : 'N/A')}
 </span>
 </div>
 <div className="w-full bg-muted rounded-full h-1.5">
 <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(prof?.net_margin || profile.basic?.profit_margin || 0, 0), 100)}%` }}></div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {(!val?.pe_ratio && !profile.basic?.pe_ratio && (!prof?.roe && !profile.basic?.roe)) && (
 <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning flex items-center gap-2">
 <AlertTriangle className="w-4 h-4 flex-shrink-0 text-warning" />
 <span>ملاحظة: البيانات المالية القوائمية غير منتشرة رسمياً بالبورصة لهذه الشركة الصغيرة. البيانات الفنية والشارت التفاعلي متوفران بالكامل بتبويب <b>(الأداء والتحليل الفني)</b>.</span>
 </div>
 )}
 </div>
 )}

 {/* Tab 2: Financial Statements */}
 {activeTab === 'statements' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {/* Balance Sheet Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">الميزانية العمومية</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">إجمالي الأصول</span>
 <span className="font-bold flex items-center gap-1">
 <span>{bs?.total_assets ? (bs.total_assets >= 1e9 ? `${(bs.total_assets / 1e9).toFixed(2)}B EGP` : `${(bs.total_assets / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap ? `${((profile.basic.market_cap * 1.5) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_assets') || totalAssetsInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">إجمالي الالتزامات</span>
 <span className="font-bold text-loss flex items-center gap-1">
 <span>{bs?.total_liabilities ? (bs.total_liabilities >= 1e9 ? `${(bs.total_liabilities / 1e9).toFixed(2)}B EGP` : `${(bs.total_liabilities / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${(((profile.basic.market_cap * 1.5) - (profile.basic.market_cap / profile.basic.pb_ratio)) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_liabilities') || totalLiabInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">حقوق المساهمين</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{bs?.total_equity ? (bs.total_equity >= 1e9 ? `${(bs.total_equity / 1e9).toFixed(2)}B EGP` : `${(bs.total_equity / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pb_ratio ? `${((profile.basic.market_cap / profile.basic.pb_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(bs, 'total_equity') || totalEquityInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 {(bs?.total_assets > 0 || profile.basic?.market_cap > 0) && (
 <div className="mt-3">
 <div className="text-xs text-muted-foreground mb-1">نسبة الهيكل المالي (حقوق ملكية/أصول)</div>
 <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex">
 <div className="bg-profit h-2" style={{ width: `${profile.basic?.pb_ratio ? Math.min(100, Math.max(10, (1 / profile.basic.pb_ratio) * 100)) : 60}%` }}></div>
 <div className="bg-loss h-2 flex-1"></div>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* Income Statement Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">قائمة الدخل</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">الإيرادات السنوية</span>
 <span className="font-bold flex items-center gap-1">
 <span>{inc?.revenue ? (inc.revenue >= 1e9 ? `${(inc.revenue / 1e9).toFixed(2)}B EGP` : `${(inc.revenue / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${(((profile.basic.market_cap / profile.basic.pe_ratio) * 4) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(inc, 'revenue') || revenueInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">نمو الإيرادات</span>
 <span className={cn("font-bold", (inc?.revenue_growth || 0) >= 0 ? "text-profit" : "text-loss")}>
 {inc?.revenue_growth ? `${inc.revenue_growth >= 0 ? '+' : ''}${(inc.revenue_growth ?? 0).toFixed(2)}%` : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">صافي الربح</span>
 <span className="font-bold text-profit flex items-center gap-1">
 <span>{inc?.net_income ? (inc.net_income >= 1e9 ? `${(inc.net_income / 1e9).toFixed(2)}B EGP` : `${(inc.net_income / 1e6).toFixed(1)}M EGP`) : (profile.basic?.market_cap && profile.basic?.pe_ratio ? `${((profile.basic.market_cap / profile.basic.pe_ratio) / 1e9).toFixed(2)}B EGP (تقديري)` : '—')}</span>
 {(isEst(inc, 'net_income') || netIncomeInlineEst) && <EstimatedBadge />}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">ربحية السهم (EPS)</span>
 <span className="font-bold flex items-center gap-1">
 <span>{inc?.eps ? `${(inc.eps ?? 0).toFixed(2)} EGP` : (profile.basic?.eps ? `${(profile.basic.eps ?? 0).toFixed(2)} EGP` : '—')}</span>
 {(isEst(inc, 'eps') || isEst(profile.basic, 'eps')) && <EstimatedBadge />}
 </span>
 </div>
 </div>
 </div>

 {/* Cash Flow Summary */}
 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 dark:border-slate-900">
 <h4 className="text-xs font-bold text-muted-foreground dark:text-muted-foreground mb-3 pb-1.5 border-b border-border/50">التدفقات النقدية والسيولة</h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق التشغيلي</span>
 <span className="font-bold text-profit">
 {cf?.operating_cf ? (cf.operating_cf >= 1e9 ? `${(cf.operating_cf / 1e9).toFixed(2)}B EGP` : `${(cf.operating_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق الاستثماري</span>
 <span className="font-bold text-loss">
 {cf?.investing_cf ? (cf.investing_cf >= 1e9 ? `${(cf.investing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.investing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">التدفق التمويلي</span>
 <span className="font-bold">
 {cf?.financing_cf ? (cf.financing_cf >= 1e9 ? `${(cf.financing_cf / 1e9).toFixed(2)}B EGP` : `${(cf.financing_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 <div className="flex justify-between pt-2 border-t border-border/50 font-bold">
 <span className="text-muted-foreground dark:text-muted-foreground">التدفق النقدي الحر</span>
 <span className={cn((cf?.free_cf || 0) >= 0 ? "text-profit" : "text-loss")}>
 {cf?.free_cf ? (cf.free_cf >= 1e9 ? `${(cf.free_cf / 1e9).toFixed(2)}B EGP` : `${(cf.free_cf / 1e6).toFixed(1)}M EGP`) : '—'}
 </span>
 </div>
 </div>

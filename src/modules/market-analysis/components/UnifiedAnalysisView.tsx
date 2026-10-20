'use client'

import React, { useState, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketInfo {
 code: string
 name: string
 name_ar: string
 currency: string
 strategy: string
 min_score: number
 min_rr: number
 weights: Record<string, number>
 notes: string
}

interface PersonaInfo {
 id: string
 name_ar: string
 score_boost: number
 max_trades: number
 position_pct: number
 holding_days: string
 min_rr: number | null
 allowed_signals: string[] | null
 strategies: string[]
}

interface EffectiveConfig {
 min_score_buy: number
 min_rr: number
 position_size: number
 max_trades: number
 stop_atr_mult: number
 target_rr_mult: number
}

interface AnalysisResult {
 ticker: string
 market: string
 persona: string
 signal: string
 signal_ar: string
 score: number
 confidence: number
 current_price: number
 entry_price: number
 stop_loss: number
 stop_loss_pct: number
 target_1: number
 target_pct: number
 risk_reward: number
 rsi: number
 market_regime: string
 rsi_override: boolean
 rr_valid: boolean
 rejection_reason: string | null
 warnings: string[]
 technical_score: number
 volume_score: number
 candle_score: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, string> = {
 STRONG_BUY: 'bg-profit/20 text-profit border-profit/20',
 BUY: 'bg-success/20 text-success border-success/20',
 ACCUMULATE: 'bg-whale/20 text-whale border-whale/20',
 HOLD: 'bg-warning/20 text-warning border-yellow-500/30',
 REDUCE: 'bg-warning/20 text-warning border-orange-500/30',
 SELL: 'bg-loss/20 text-loss border-loss/20',
 STRONG_SELL: 'bg-loss/20 text-loss border-loss/20',
 REJECTED_RR: 'bg-muted/20 text-muted-foreground border-border/30',
 NO_DATA: 'bg-muted/20 text-muted-foreground border-border/30',
}

const PERSONA_ICONS: Record<string, string> = {
 scalper: '⚡',
 trader: '📊',
 investor: '🏛️',
 conservative:'🛡️',
}

const MARKET_FLAGS: Record<string, string> = {
 EGX: '🇪🇬',
 KSA: '🇸🇦',
 KSE: '🇰🇼',
 QSE: '🇶🇦',
 DFM: '🇦🇪',
 CRYPTO: '₿',
}

function ScoreBar({ value, label, color = 'bg-whale' }: {
 value: number; label: string; color?: string
}) {
 return (
 <div className="space-y-1">
 <div className="flex justify-between text-xs">
 <span className="text-muted-foreground">{label}</span>
 <span className="text-foreground font-medium">{(value ?? 0).toFixed(0)}%</span>
 </div>
 <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full transition-all duration-500 ${color}`}
 style={{ width: `${Math.min(100, value)}%` }}
 />
 </div>
 </div>
 )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UnifiedAnalysisView() {
 // State
 const [markets, setMarkets] = useState<MarketInfo[]>([])
 const [personas, setPersonas] = useState<PersonaInfo[]>([])
 const [selectedMarket, setSelectedMarket] = useState('EGX')
 const [selectedPersona, setSelectedPersona] = useState('trader')
 const [effectiveConfig, setEffectiveConfig] = useState<EffectiveConfig | null>(null)

 const [ticker, setTicker] = useState('')
 const [support, setSupport] = useState('')
 const [resistance, setResistance] = useState('')
 const [result, setResult] = useState<AnalysisResult | null>(null)

 const [scanResults, setScanResults] = useState<AnalysisResult[]>([])
 const [scanStats, setScanStats] = useState<Record<string, number>>({})
 const [activeTab, setActiveTab] = useState<'analyze' | 'scan' | 'compare'>('analyze')
 const [compareData, setCompareData] = useState<Record<string, AnalysisResult> | null>(null)

 const [loading, setLoading] = useState(false)
 const [error, setError] = useState<string | null>(null)

 // Load markets & personas
 useEffect(() => {
 const load = async () => {
 try {
 const [mRes, pRes] = await Promise.all([
 fetch('/api/unified?action=markets'),
 fetch('/api/unified?action=personas'),
 ])
 const mData = await mRes.json()
 const pData = await pRes.json()
 setMarkets(mData.markets || [])
 setPersonas(pData.personas || [])
 } catch {
 setError('فشل تحميل الإعدادات من الخادم')
 }
 }
 load()
 }, [])

 // Load effective config when market/persona changes
 useEffect(() => {
 const load = async () => {
 try {
 const res = await fetch(
 `/api/unified?action=config&market=${selectedMarket}&persona=${selectedPersona}`
 )
 const data = await res.json()
 setEffectiveConfig(data.effective || null)
 } catch { /* ignore */ }
 }
 load()
 }, [selectedMarket, selectedPersona])

 // ─── Actions ──────────────────────────────────────────────────────────────

 const handleAnalyze = useCallback(async () => {
 if (!ticker.trim()) { setError('أدخل رمز السهم'); return }
 setLoading(true); setError(null); setResult(null)
 try {
 const res = await fetch('/api/unified', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'analyze',
 ticker: ticker.toUpperCase(),
 market: selectedMarket,
 persona: selectedPersona,
 support: support ? parseFloat(support) : undefined,
 resistance: resistance ? parseFloat(resistance) : undefined,
 }),
 })
 const data = await res.json()
 if (data.result) setResult(data.result)
 else setError(data.error || 'فشل التحليل')
 } catch {
 setError('خطأ في الاتصال بالخادم')
 } finally { setLoading(false) }
 }, [ticker, selectedMarket, selectedPersona, support, resistance])

 const handleScan = useCallback(async () => {
 setLoading(true); setError(null); setScanResults([]); setScanStats({})
 try {
 const res = await fetch('/api/unified', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'scan',
 market: selectedMarket,
 persona: selectedPersona,
 top_n: 20,
 }),
 })
 const data = await res.json()
 if (data.results) { setScanResults(data.results); setScanStats(data.stats || {}) }
 else setError(data.error || 'فشل الفحص')
 } catch {
 setError('خطأ في الاتصال بالخادم')
 } finally { setLoading(false) }
 }, [selectedMarket, selectedPersona])

 const handleCompare = useCallback(async () => {
 if (!ticker.trim()) { setError('أدخل رمز السهم'); return }
 setLoading(true); setError(null); setCompareData(null)
 try {
 const res = await fetch('/api/unified', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'compare',
 ticker: ticker.toUpperCase(),
 market: selectedMarket,
 }),
 })
 const data = await res.json()
 if (data.comparison) setCompareData(data.comparison)
 else setError(data.error || 'فشل المقارنة')
 } catch {
 setError('خطأ في الاتصال بالخادم')
 } finally { setLoading(false) }
 }, [ticker, selectedMarket])

 // ─── Render ───────────────────────────────────────────────────────────────

 return (
 <div className="min-h-screen bg-muted text-foreground p-6" dir="rtl">

 {/* Header */}
 <div className="mb-8 print:hidden">
 <h1 className="text-3xl font-bold from-primary to-purple-400 bg-clip-text text-transparent">
 نظام التحليل الموحد
 </h1>
 <p className="text-muted-foreground mt-1 text-sm">
 محرك واحد لجميع الأسواق · قابل للتخصيص حسب شخصية المتداول
 </p>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

 {/* ─── Config Panel ──────────────────────────────────────────────── */}
 <div className="lg:col-span-1 space-y-4 print:hidden">

 {/* Market Selector */}
 <div className="bg-muted border border-white/10 rounded-2xl p-5">
 <h2 className="text-sm font-semibold text-muted-foreground mb-3">📊 اختر السوق</h2>
 <div className="grid grid-cols-2 gap-2">
 {markets.map(m => (
 <button
 key={m.code}
 onClick={() => setSelectedMarket(m.code)}
 className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
 selectedMarket === m.code
 ? 'bg-whale text-white'
 : 'bg-white/5 text-muted-foreground hover:bg-white/10'
 }`}
 >
 <span>{MARKET_FLAGS[m.code] || '🌍'}</span>
 <span>{m.code}</span>
 </button>
 ))}
 </div>
 </div>

 {/* Persona Selector — REMOVED per Constitution §PERSONA-UNIFY-A
 النظام موحّد على المحرك المتوازن (balanced) فقط. شاشات العميل لا تعرض
 مبدّل شخصيات. لو احتجناها للأدمن فقط، تتعمل في AdminView مش هنا. */}

 {/* Effective Config */}
 {effectiveConfig && (
 <div className="bg-muted border border-white/10 rounded-2xl p-5">
 <h2 className="text-sm font-semibold text-muted-foreground mb-3">⚙️ الإعدادات الفعلية</h2>
 <div className="space-y-2 text-sm">
 {[
 { label: 'الحد الأدنى للشراء', value: `${(effectiveConfig.min_score_buy ?? 0).toFixed(0)}%` },
 { label: 'R/R الأدنى', value: `${effectiveConfig.min_rr}` },
 { label: 'حجم الصفقة', value: `${(effectiveConfig.position_size ?? 0).toFixed(0)}%` },
 { label: 'أقصى صفقات', value: `${effectiveConfig.max_trades}` },
 { label: 'مضاعف ATR', value: `${effectiveConfig.stop_atr_mult}×` },
 { label: 'مضاعف الهدف', value: `${effectiveConfig.target_rr_mult}×` },
 ].map(row => (
 <div key={row.label} className="flex justify-between">
 <span className="text-muted-foreground">{row.label}</span>
 <span className="text-foreground font-mono">{row.value}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 {/* ─── Analysis Panel ────────────────────────────────────────────── */}
 <div className="lg:col-span-2 space-y-4">

 {/* Tabs */}
 <div className="flex gap-2 bg-muted border border-white/10 rounded-2xl p-2 print:hidden">
 {([['analyze','تحليل سهم'],['scan','فحص السوق'],['compare','مقارنة الشخصيات']] as const).map(([tab, label]) => (
 <button
 key={tab}
 onClick={() => { setActiveTab(tab); setError(null) }}
 className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all ${
 activeTab === tab
 ? 'bg-whale text-white'
 : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
 }`}
 >
 {label}
 </button>
 ))}
 </div>

 {/* Analyze / Compare: ticker input */}
 {(activeTab === 'analyze' || activeTab === 'compare') && (
 <div className="bg-muted border border-white/10 rounded-2xl p-5 space-y-4 print:hidden">
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 <input
 value={ticker}
 onChange={e => setTicker(e.target.value.toUpperCase())}
 onKeyDown={e => e.key === 'Enter' && (activeTab === 'analyze' ? handleAnalyze() : handleCompare())}
 placeholder="رمز السهم (مثال: COMI)"
 className="sm:col-span-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-foreground placeholder-gray-500 focus:outline-none focus:border-whale text-sm"
 />
 {activeTab === 'analyze' && (
 <>
 <input
 value={support}
 onChange={e => setSupport(e.target.value)}
 placeholder="مستوى الدعم (اختياري)"
 type="number"
 className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-foreground placeholder-gray-500 focus:outline-none focus:border-whale text-sm"
 />
 <input
 value={resistance}
 onChange={e => setResistance(e.target.value)}
 placeholder="مستوى المقاومة (اختياري)"
 type="number"
 className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-foreground placeholder-gray-500 focus:outline-none focus:border-whale text-sm"
 />
 </>
 )}
 </div>
 <button
 onClick={activeTab === 'analyze' ? handleAnalyze : handleCompare}
 disabled={loading}
 className="w-full py-3 from-primary to-purple-600 rounded-xl font-semibold text-foreground disabled:opacity-50 transition-opacity"
 >
 {loading ? '⏳ جاري التحليل...' : activeTab === 'analyze' ? '🔍 تحليل' : '⚖️ مقارنة الشخصيات'}
 </button>
 </div>
 )}

 {/* Scan: market button */}
 {activeTab === 'scan' && (
 <div className="bg-muted border border-white/10 rounded-2xl p-5">
 <p className="text-muted-foreground text-sm mb-4">
 فحص كامل لسوق <strong className="text-foreground">{MARKET_FLAGS[selectedMarket]} {selectedMarket}</strong> بشخصية <strong className="text-foreground">{personas.find(p=>p.id===selectedPersona)?.name_ar}</strong>
 </p>
 <button
 onClick={handleScan}
 disabled={loading}
 className="w-full py-3 from-primary to-purple-600 rounded-xl font-semibold text-foreground disabled:opacity-50 transition-opacity"
 >
 {loading ? '⏳ جاري الفحص...' : `🔭 فحص ${selectedMarket}`}
 </button>
 </div>
 )}

 {/* Error */}
 {error && (
 <div className="bg-loss/10 border border-loss/20 rounded-xl p-4 text-loss text-sm">
 ❌ {error}
 </div>
 )}

 {/* ─── Analyze Result ─────────────────────────────────────────── */}
 {activeTab === 'analyze' && result && (
 <div className="bg-muted border border-white/10 rounded-2xl p-5 space-y-5 print:bg-white print:text-black print:border-none print:shadow-none">

 {/* Signal Header */}
 <div className="flex items-center justify-between">
 <div>
 <span className="text-2xl font-bold text-foreground print:text-black">{result.ticker}</span>
 <span className="text-muted-foreground text-sm mr-2 print:text-muted-foreground">{result.market} · {result.persona}</span>
 </div>
 <div className="flex gap-2 items-center">
 <button onClick={() => window.print()} className="print:hidden text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors">
 🖨️ طباعة التقرير
 </button>
 <div className={`px-4 py-2 rounded-xl border text-sm font-bold ${SIGNAL_COLORS[result.signal] || SIGNAL_COLORS.HOLD}`}>
 {result.signal_ar}
 </div>
 </div>
 </div>

 {/* Print Only Header (Visible only in print mode) */}
 <div className="hidden print:block text-center border-b border-border pb-4 mb-4">
 <h1 className="text-3xl font-bold mb-2">تقرير التحليل المالي</h1>
 <p className="text-muted-foreground">منصة GLM Investment</p>
 <p className="text-sm text-muted-foreground mt-1">تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</p>
 </div>

 {result.rejection_reason && (
 <div className="bg-loss/10 border border-loss/20 rounded-lg p-3 text-loss text-xs">
 ❌ {result.rejection_reason}
 </div>
 )}

 {/* Price Grid */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
 {[
 { label: 'السعر الحالي', value: Number(result.current_price || 0).toFixed(3), sub: '' },
 { label: 'وقف الخسارة', value: Number(result.stop_loss || 0).toFixed(3), sub: `-${result.stop_loss_pct}%`, color: 'text-loss print:text-loss' },
 { label: 'الهدف', value: Number(result.target_1 || 0).toFixed(3), sub: `+${result.target_pct}%`, color: 'text-success print:text-success' },
 { label: 'R/R', value: Number(result.risk_reward || 0).toFixed(2), sub: result.rr_valid ? '✅ مقبول' : '❌ مرفوض', color: result.rr_valid ? 'text-success print:text-success' : 'text-loss print:text-loss' },
 ].map(item => (
 <div key={item.label} className="bg-white/5 print:bg-muted print:border print:border-border rounded-xl p-3 text-center">
 <div className="text-xs text-muted-foreground print:text-muted-foreground mb-1">{item.label}</div>
 <div className="text-lg font-bold text-foreground print:text-black font-mono">{item.value}</div>
 {item.sub && <div className={`text-xs mt-0.5 ${item.color || 'text-muted-foreground print:text-muted-foreground'}`}>{item.sub}</div>}
 </div>
 ))}
 </div>

 {/* Scores */}
 <div className="space-y-2.5">
 <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">تفاصيل الدرجات</h3>
 <ScoreBar value={Number(result.score || 0)} label="الدرجة الكلية" color="bg-whale" />
 <ScoreBar value={Number(result.technical_score || 0)} label="تقني" color="bg-primary" />
 <ScoreBar value={Number(result.volume_score || 0)} label="حجم" color="bg-cyan-500" />
 <ScoreBar value={Number(result.candle_score || 0)} label="شموع" color="bg-warning" />
 <ScoreBar value={Number(result.confidence || 0)} label="الثقة" color="bg-profit" />
 </div>

 {/* Context */}
 <div className="flex flex-wrap gap-2">
 <span className="px-2 py-1 bg-white/5 rounded-lg text-xs text-muted-foreground">
 RSI: <strong className={Number(result.rsi || 50) > 70 ? 'text-loss' : Number(result.rsi || 50) < 30 ? 'text-success' : 'text-foreground'}>{Number(result.rsi || 50).toFixed(1)}</strong>
 {result.rsi_override && <span className="text-warning mr-1"> ← معدّل</span>}
 </span>
 <span className="px-2 py-1 bg-white/5 rounded-lg text-xs text-muted-foreground">
 حالة السوق: <strong className="text-foreground">{result.market_regime}</strong>
 </span>
 </div>

 {/* Warnings */}
 {result.warnings.length > 0 && (
 <div className="space-y-1">
 {result.warnings.map((w, i) => (
 <div key={i} className="text-xs text-warning/80 bg-warning/10 rounded-lg px-3 py-1.5">{w}</div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* ─── Scan Results ────────────────────────────────────────────── */}
 {activeTab === 'scan' && scanResults.length > 0 && (
 <div className="space-y-3">
 {/* Stats */}
 <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
 {[
 { label: 'شراء قوي', value: scanStats.strong_buy || 0, color: 'text-profit' },
 { label: 'شراء', value: scanStats.buy || 0, color: 'text-success' },
 { label: 'تجميع', value: scanStats.accumulate || 0, color: 'text-whale' },
 { label: 'احتفاظ', value: scanStats.hold || 0, color: 'text-warning' },
 { label: 'Avg Score',value: scanStats.avg_score || 0, color: 'text-whale', suffix:'%' },
 { label: 'Avg R/R', value: scanStats.avg_rr || 0, color: 'text-primary' },
 ].map(s => (
 <div key={s.label} className="bg-muted border border-white/10 rounded-xl p-3 text-center">
 <div className={`text-xl font-bold ${s.color}`}>{typeof s.value === 'number' ? s.value.toFixed(typeof s.value === 'number' && s.value < 10 ? 2 : 0) : s.value}{s.suffix||''}</div>
 <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
 </div>
 ))}
 </div>

 {/* Table */}
 <div className="bg-muted border border-white/10 rounded-2xl overflow-hidden">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-white/10 text-muted-foreground text-xs">
 <th className="px-4 py-3 text-right">السهم</th>
 <th className="px-4 py-3 text-center">الإشارة</th>
 <th className="px-4 py-3 text-center">الدرجة</th>
 <th className="px-4 py-3 text-center">السعر</th>
 <th className="px-4 py-3 text-center">الهدف</th>
 <th className="px-4 py-3 text-center">R/R</th>
 </tr>
 </thead>
 <tbody>
 {scanResults.map((r, i) => (
 <tr
 key={r.ticker}
 className={`border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-white/2'}`}
 onClick={() => { setTicker(r.ticker); setResult(r); setActiveTab('analyze') }}
 >
 <td className="px-4 py-3 font-mono font-bold text-foreground">{r.ticker}</td>
 <td className="px-4 py-3 text-center">
 <span className={`px-2 py-0.5 rounded-lg text-xs border ${SIGNAL_COLORS[r.signal] || ''}`}>
 {r.signal_ar}
 </span>
 </td>
 <td className="px-4 py-3 text-center font-bold text-whale">{Number(r.score || 0).toFixed(0)}</td>
 <td className="px-4 py-3 text-center text-muted-foreground font-mono">{Number(r.current_price || 0).toFixed(3)}</td>
 <td className="px-4 py-3 text-center text-success font-mono">+{r.target_pct}%</td>
 <td className="px-4 py-3 text-center text-primary font-mono">{Number(r.risk_reward || 0).toFixed(2)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {/* ─── Compare Personas ─────────────────────────────────────────── */}
 {activeTab === 'compare' && compareData && (
 <div className="bg-muted border border-white/10 rounded-2xl overflow-hidden">
 <div className="px-5 py-4 border-b border-white/10">
 <h3 className="font-semibold text-foreground">مقارنة الشخصيات: {ticker}</h3>
 </div>
 <div className="divide-y divide-white/5">
 {Object.entries(compareData).map(([persona, r]) => (
 <div key={persona} className="flex items-center justify-between px-5 py-4">
 <div className="flex items-center gap-3">
 <span className="text-xl">{PERSONA_ICONS[persona] || '👤'}</span>
 <div>
 <div className="font-medium text-foreground">{(r as AnalysisResult & { persona_ar?: string }).persona_ar || persona}</div>
 <div className="text-xs text-muted-foreground">Min Score: {Number((r as AnalysisResult & { min_score?: number }).min_score || 0).toFixed(0)}%</div>
 </div>
 </div>
 <div className="flex items-center gap-4">
 <span className="text-muted-foreground text-sm font-mono">{Number((r as AnalysisResult).score || 0).toFixed(0)}</span>
 <span className={`px-3 py-1 rounded-lg border text-xs font-bold ${SIGNAL_COLORS[(r as AnalysisResult).signal] || SIGNAL_COLORS.HOLD}`}>
 {(r as AnalysisResult).signal_ar}
 </span>
 <span className="text-muted-foreground text-xs">R/R: {Number((r as AnalysisResult).risk_reward || 0).toFixed(2)}</span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 </div>
 </div>
 </div>
 )
}

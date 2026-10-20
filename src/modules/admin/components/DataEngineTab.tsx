'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { 
 Play, Square, RefreshCw, ArrowRightLeft,
 AlertTriangle, Activity, Database, Clock, Zap,
 CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp,
 TrendingUp, Coins, Globe, Newspaper, BarChart3, History,
 Calendar, HardDrive
} from 'lucide-react'

// Types
interface EngineStatus {
 running: boolean
 scheduler_active: boolean
 stocks_running: boolean
 crypto_running: boolean
 metals_running: boolean
 forex_running: boolean
 news_running: boolean
 last_stocks_update: string | null
 last_crypto_update: string | null
 last_metals_update: string | null
 last_forex_update: string | null
 last_news_update: string | null
 last_sync: string | null
 logs: string[]
 errors: string[]
 active_jobs: string[]
 historical_progress: {
 current: number
 total: number
 symbol: string
 category: string
 } | null
}

interface HistoricalCategory {
 category: string
 symbols: number
 records: number
}

interface EngineResponse {
 success: boolean
 source: string
 engine: EngineStatus
 counts: {
 stocks: number
 crypto: number
 gold: number
 silver: number
 forex: number
 news: number
 historical_records: number
 historical_symbols: number
 daily_prices: number
 }
 by_market?: Record<string, number>
 historical_categories?: HistoricalCategory[]
 historical_status?: any
}

const REFRESH_INTERVAL = 3000

export function DataEngineTab() {
 const [loading, setLoading] = useState(true)
 const [data, setData] = useState<EngineResponse | null>(null)
 const [triggeringAction, setTriggeringAction] = useState<string | null>(null)
 const [showLogs, setShowLogs] = useState(true)
 const [showErrors, setShowErrors] = useState(true)
 const [showHistorical, setShowHistorical] = useState(false)

 const fetchData = useCallback(async () => {
 try {
 const res = await fetch('/api/data-engine/control')
 const json = await res.json()
 if (json.success) {
 setData(json)
 }
 } catch (error) {
 console.error('Fetch error:', error)
 } finally {
 setLoading(false)
 }
 }, [])

 useEffect(() => {
 fetchData()
 const interval = setInterval(fetchData, REFRESH_INTERVAL)
 return () => clearInterval(interval)
 }, [fetchData])

 const triggerAction = async (action: string, scraper?: string) => {
 setTriggeringAction(action)
 try {
 const res = await fetch('/api/data-engine/control', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ action, scraper })
 })
 const json = await res.json()
 
 if (json.success) {
 toast.success(json.message || 'Success')
 setTimeout(fetchData, 500)
 } else {
 toast.error(json.error || 'Failed')
 }
 } catch (error) {
 toast.error('Connection error')
 } finally {
 setTriggeringAction(null)
 }
 }

 const formatTime = (dateStr: string | null) => {
 if (!dateStr) return '--:--:--'
 try {
 return new Date(dateStr).toLocaleTimeString('en-GB', {
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit'
 })
 } catch {
 return dateStr
 }
 }

 const formatNum = (n: number) => n?.toLocaleString() || '0'

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20 bg-slate-50 min-h-screen">
 <RefreshCw className="w-12 h-12 animate-spin text-profit" />
 <span className="ml-4 text-2xl text-profit font-bold">Loading Engine...</span>
 </div>
 )
 }

 const { engine, counts, source, by_market, historical_categories } = data || {}
 const isActive = engine?.running && engine?.scheduler_active
 const histProgress = engine?.historical_progress

 return (
 <div className="bg-slate-100 min-h-screen p-4 text-slate-900" dir="ltr">
 
 {/* Header */}
 <div className="bg-white rounded-xl p-5 mb-4 border border-slate-200 shadow-sm">
 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-4">
 <div className={cn(
 "w-14 h-14 rounded-xl flex items-center justify-center text-2xl shadow-md",
 isActive ? "bg-profit" : "bg-loss"
 )}>
 {isActive ? '🟢' : '🔴'}
 </div>
 <div>
 <div className="text-2xl font-bold text-slate-800">DATA ENGINE v2.2.0</div>
 <div className="text-sm text-slate-500 flex items-center gap-3 mt-1">
 <span className={cn(
 "px-3 py-1 rounded-lg font-bold text-base",
 isActive ? "bg-profit text-profit" : "bg-loss text-loss"
 )}>
 {isActive ? 'RUNNING' : 'STOPPED'}
 </span>
 <span className="px-3 py-1 rounded-lg bg-slate-200 text-slate-600 text-base">
 {source}
 </span>
 </div>
 </div>
 </div>
 
 <div className="flex gap-3">
 <Button
 variant={isActive ? "destructive" : "default"}
 size="lg"
 className={isActive ? "bg-loss hover:bg-loss h-11 text-base px-6" : "bg-profit hover:bg-profit h-11 text-base px-6"}
 onClick={() => triggerAction(isActive ? 'stop_engine' : 'start_engine')}
 disabled={triggeringAction !== null}
 >
 {triggeringAction === 'start_engine' || triggeringAction === 'stop_engine' ? (
 <Loader2 className="w-5 h-5 animate-spin mr-2" />
 ) : isActive ? (
 <Square className="w-5 h-5 mr-2" />
 ) : (
 <Play className="w-5 h-5 mr-2" />
 )}
 {isActive ? 'STOP' : 'START'}
 </Button>
 
 <Button
 variant="outline"
 size="lg"
 className="border-profit text-profit hover:bg-profit h-11 text-base px-6"
 onClick={() => triggerAction('trigger_all')}
 disabled={triggeringAction !== null}
 >
 <Zap className="w-5 h-5 mr-2" />
 RUN ALL
 </Button>
 
 <Button
 variant="outline"
 size="lg"
 className="border-primary text-primary hover:bg-primary h-11"
 onClick={() => fetchData()}
 >
 <RefreshCw className="w-5 h-5" />
 </Button>
 </div>
 </div>
 
 {/* Historical Progress */}
 {histProgress && histProgress.total > 0 && (
 <div className="mt-4 p-4 bg-primary rounded-xl border border-purple-200">
 <div className="flex items-center gap-3 mb-3">
 <Loader2 className="w-5 h-5 animate-spin text-primary" />
 <span className="text-primary font-bold text-lg">
 HISTORICAL FETCH IN PROGRESS
 </span>
 </div>
 <div className="flex items-center gap-3 text-base">
 <span className="text-slate-600 font-medium">
 {histProgress.current}/{histProgress.total}
 </span>
 <div className="flex-1 h-3 bg-slate-200 rounded-full overflow-hidden">
 <div 
 className="h-full bg-primary transition-all rounded-full"
 style={{ width: `${(histProgress.current / histProgress.total) * 100}%` }}
 />
 </div>
 <span className="text-primary font-mono font-bold">
 {histProgress.symbol}
 </span>
 </div>
 <div className="text-sm text-slate-500 mt-2">
 {histProgress.category}
 </div>
 </div>
 )}
 </div>

 {/* Stats Grid */}
 <div className="grid grid-cols-4 md:grid-cols-8 gap-3 mb-4">
 <div className="bg-white rounded-xl p-4 text-center border border-primary shadow-sm hover:shadow-md transition-shadow">
 <TrendingUp className="w-6 h-6 mx-auto text-primary mb-2" />
 <div className="text-2xl font-bold text-primary">{formatNum(counts?.stocks || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">STOCKS</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-warning shadow-sm hover:shadow-md transition-shadow">
 <Coins className="w-6 h-6 mx-auto text-warning mb-2" />
 <div className="text-2xl font-bold text-warning">{formatNum(counts?.crypto || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">CRYPTO</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-yellow-200 shadow-sm hover:shadow-md transition-shadow">
 <BarChart3 className="w-6 h-6 mx-auto text-warning mb-2" />
 <div className="text-2xl font-bold text-warning">{formatNum(counts?.gold || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">GOLD</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
 <div className="text-2xl font-bold text-slate-500">{formatNum(counts?.silver || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">SILVER</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-profit shadow-sm hover:shadow-md transition-shadow">
 <Globe className="w-6 h-6 mx-auto text-profit mb-2" />
 <div className="text-2xl font-bold text-profit">{formatNum(counts?.forex || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">FOREX</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-cyan-200 shadow-sm hover:shadow-md transition-shadow">
 <Newspaper className="w-6 h-6 mx-auto text-cyan-600 mb-2" />
 <div className="text-2xl font-bold text-cyan-600">{formatNum(counts?.news || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">NEWS</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-purple-200 shadow-sm hover:shadow-md transition-shadow">
 <History className="w-6 h-6 mx-auto text-primary mb-2" />
 <div className="text-2xl font-bold text-primary">{formatNum(counts?.historical_records || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">HIST. DATA</div>
 </div>
 <div className="bg-white rounded-xl p-4 text-center border border-whale shadow-sm hover:shadow-md transition-shadow">
 <Calendar className="w-6 h-6 mx-auto text-whale mb-2" />
 <div className="text-2xl font-bold text-whale">{formatNum(counts?.daily_prices || 0)}</div>
 <div className="text-sm text-slate-500 font-medium mt-1">DAILY PRICES</div>
 </div>
 </div>

 {/* By Market & Historical Summary */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
 {/* By Market */}
 {by_market && Object.keys(by_market).length > 0 && (
 <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
 <div className="text-base text-slate-600 mb-3 font-bold flex items-center gap-2">
 <Database className="w-5 h-5" />
 STOCKS BY MARKET
 </div>
 <div className="flex flex-wrap gap-3">
 {Object.entries(by_market).map(([market, count]) => (
 <div key={market} className="bg-slate-100 px-4 py-2 rounded-lg text-base flex items-center gap-3">
 <span className="text-slate-600 font-medium">{market}</span>
 <span className="text-primary font-bold text-lg">{formatNum(count as number)}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 
 {/* Historical Summary */}
 {counts?.historical_records > 0 && (
 <div className="bg-white rounded-xl p-4 border border-purple-200 shadow-sm">
 <div 
 className="text-base text-slate-600 mb-3 font-bold flex items-center justify-between cursor-pointer"
 onClick={() => setShowHistorical(!showHistorical)}
 >
 <span className="flex items-center gap-2">
 <History className="w-5 h-5 text-primary" />
 HISTORICAL DATA: {counts.historical_symbols} symbols
 </span>
 {showHistorical ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
 </div>
 
 {showHistorical && historical_categories && (
 <div className="grid grid-cols-2 gap-2 text-sm">
 {historical_categories.map((cat, i) => (
 <div key={i} className="bg-slate-50 p-3 rounded-lg">
 <div className="text-slate-700 font-medium truncate">{cat.category}</div>
 <div className="flex gap-3 mt-1">
 <span className="text-primary font-bold">{cat.symbols} symbols</span>
 <span className="text-slate-500">{formatNum(cat.records)} records</span>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 )}
 </div>

 {/* Scrapers Control */}
 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
 {/* Stocks */}
 <div className={cn(
 "bg-white rounded-xl p-4 border-2 shadow-sm",
 engine?.stocks_running ? "border-primary" : "border-slate-200"
 )}>
 <div className="flex items-center justify-between mb-3">
 <TrendingUp className="w-6 h-6 text-primary" />
 <button
 className={cn(
 "text-sm px-3 py-1 rounded-lg font-bold",
 engine?.stocks_running ? "bg-profit text-profit" : "bg-loss text-loss"
 )}
 onClick={() => triggerAction('toggle_scraper', 'stocks')}
 >
 {engine?.stocks_running ? 'ON' : 'OFF'}
 </button>
 </div>
 <div className="text-lg font-bold mb-1">STOCKS</div>
 <div className="text-sm text-slate-500 mb-3">{formatTime(engine?.last_stocks_update)}</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-primary text-primary hover:bg-primary"
 onClick={() => triggerAction('trigger_stocks')}
 disabled={triggeringAction !== null}
 >
 RUN
 </Button>
 </div>

 {/* Crypto */}
 <div className={cn(
 "bg-white rounded-xl p-4 border-2 shadow-sm",
 engine?.crypto_running ? "border-warning" : "border-slate-200"
 )}>
 <div className="flex items-center justify-between mb-3">
 <Coins className="w-6 h-6 text-warning" />
 <button
 className={cn(
 "text-sm px-3 py-1 rounded-lg font-bold",
 engine?.crypto_running ? "bg-profit text-profit" : "bg-loss text-loss"
 )}
 onClick={() => triggerAction('toggle_scraper', 'crypto')}
 >
 {engine?.crypto_running ? 'ON' : 'OFF'}
 </button>
 </div>
 <div className="text-lg font-bold mb-1">CRYPTO</div>
 <div className="text-sm text-slate-500 mb-3">{formatTime(engine?.last_crypto_update)}</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-warning text-warning hover:bg-warning"
 onClick={() => triggerAction('trigger_crypto')}
 disabled={triggeringAction !== null}
 >
 RUN
 </Button>
 </div>

 {/* Metals */}
 <div className={cn(
 "bg-white rounded-xl p-4 border-2 shadow-sm",
 engine?.metals_running ? "border-yellow-500" : "border-slate-200"
 )}>
 <div className="flex items-center justify-between mb-3">
 <BarChart3 className="w-6 h-6 text-warning" />
 <button
 className={cn(
 "text-sm px-3 py-1 rounded-lg font-bold",
 engine?.metals_running ? "bg-profit text-profit" : "bg-loss text-loss"
 )}
 onClick={() => triggerAction('toggle_scraper', 'metals')}
 >
 {engine?.metals_running ? 'ON' : 'OFF'}
 </button>
 </div>
 <div className="text-lg font-bold mb-1">METALS</div>
 <div className="text-sm text-slate-500 mb-3">{formatTime(engine?.last_metals_update)}</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-yellow-500 text-warning hover:bg-warning"
 onClick={() => triggerAction('trigger_metals')}
 disabled={triggeringAction !== null}
 >
 RUN
 </Button>
 </div>

 {/* News */}
 <div className={cn(
 "bg-white rounded-xl p-4 border-2 shadow-sm",
 engine?.news_running ? "border-cyan-500" : "border-slate-200"
 )}>
 <div className="flex items-center justify-between mb-3">
 <Newspaper className="w-6 h-6 text-cyan-600" />
 <button
 className={cn(
 "text-sm px-3 py-1 rounded-lg font-bold",
 engine?.news_running ? "bg-profit text-profit" : "bg-loss text-loss"
 )}
 onClick={() => triggerAction('toggle_scraper', 'news')}
 >
 {engine?.news_running ? 'ON' : 'OFF'}
 </button>
 </div>
 <div className="text-lg font-bold mb-1">NEWS</div>
 <div className="text-sm text-slate-500 mb-3">{formatTime(engine?.last_news_update)}</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-cyan-500 text-cyan-600 hover:bg-cyan-50"
 onClick={() => triggerAction('trigger_news')}
 disabled={triggeringAction !== null}
 >
 RUN
 </Button>
 </div>

 {/* Historical */}
 <div className="bg-white rounded-xl p-4 border-2 border-purple-300 shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <History className="w-6 h-6 text-primary" />
 <div className={cn(
 "w-3 h-3 rounded-full",
 histProgress ? "bg-warning animate-pulse" : "bg-slate-300"
 )} />
 </div>
 <div className="text-lg font-bold mb-1">HISTORICAL</div>
 <div className="text-sm text-slate-500 mb-3">5 Years Yahoo</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-purple-500 text-primary hover:bg-primary"
 onClick={() => triggerAction('trigger_historical')}
 disabled={triggeringAction !== null || histProgress !== null}
 >
 {histProgress ? 'RUNNING...' : 'FETCH'}
 </Button>
 </div>

 {/* Sync */}
 <div className="bg-white rounded-xl p-4 border-2 border-profit shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <ArrowRightLeft className="w-6 h-6 text-profit" />
 <HardDrive className="w-5 h-5 text-profit" />
 </div>
 <div className="text-lg font-bold mb-1">SYNC DB</div>
 <div className="text-sm text-slate-500 mb-3">{formatTime(engine?.last_sync)}</div>
 <Button
 variant="outline"
 size="lg"
 className="w-full h-10 text-sm border-profit text-profit hover:bg-profit"
 onClick={() => triggerAction('trigger_sync')}
 disabled={triggeringAction !== null}
 >
 SYNC
 </Button>
 </div>

 {/* Run All */}
 <div className="bg-gradient-to-br from-profit to-primary rounded-xl p-4 border-2 border-profit shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <Zap className="w-6 h-6 text-profit" />
 </div>
 <div className="text-lg font-bold mb-1">RUN ALL</div>
 <div className="text-sm text-slate-500 mb-3">All scrapers</div>
 <Button
 variant="default"
 size="lg"
 className="w-full h-10 text-sm bg-profit text-white hover:bg-profit"
 onClick={() => triggerAction('trigger_all')}
 disabled={triggeringAction !== null}
 >
 EXECUTE
 </Button>
 </div>
 </div>

 {/* Market Hours */}
 <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-4">
 <div className="flex items-center gap-3 mb-3">
 <Clock className="w-5 h-5 text-primary" />
 <span className="text-base font-bold">MARKET HOURS (Local)</span>
 </div>
 <div className="grid grid-cols-4 gap-3 text-sm">
 <div className="bg-slate-50 p-3 rounded-lg">
 <div className="text-slate-500 font-medium">EGX</div>
 <div className="text-slate-800 font-mono font-bold">10:00-14:30</div>
 </div>
 <div className="bg-slate-50 p-3 rounded-lg">
 <div className="text-slate-500 font-medium">TADAWUL</div>
 <div className="text-slate-800 font-mono font-bold">10:00-15:00</div>
 </div>
 <div className="bg-slate-50 p-3 rounded-lg">
 <div className="text-slate-500 font-medium">KSE</div>
 <div className="text-slate-800 font-mono font-bold">09:00-13:15</div>
 </div>
 <div className="bg-slate-50 p-3 rounded-lg">
 <div className="text-slate-500 font-medium">QSE</div>
 <div className="text-slate-800 font-mono font-bold">09:30-13:15</div>
 </div>
 </div>
 </div>

 {/* Logs */}
 <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
 <div 
 className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 rounded-t-xl"
 onClick={() => setShowLogs(!showLogs)}
 >
 <div className="flex items-center gap-3">
 <Activity className="w-5 h-5 text-profit" />
 <span className="text-base font-bold">SYSTEM LOGS ({engine?.logs?.length || 0})</span>
 </div>
 <div className="flex items-center gap-3">
 <Button
 variant="ghost"
 size="sm"
 className="h-8 text-sm"
 onClick={(e) => {
 e.stopPropagation()
 triggerAction('clear_logs')
 }}
 >
 CLEAR
 </Button>
 {showLogs ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
 </div>
 </div>
 
 {showLogs && (
 <div className="p-4 pt-0">
 <div className="bg-slate-900 rounded-lg p-4 h-72 overflow-y-auto font-mono text-sm">
 {engine?.logs && engine.logs.length > 0 ? (
 engine.logs.slice(-200).map((log, i) => (
 <div key={i} className={cn(
 "py-1 border-b border-slate-700",
 log.includes('✅') || log.includes('completed') || log.includes('SUCCESS') ? "text-profit" :
 log.includes('❌') || log.includes('ERROR') ? "text-loss" :
 log.includes('⚠️') || log.includes('WARNING') ? "text-warning" :
 log.includes('📥') || log.includes('Fetching') ? "text-primary" :
 log.includes('📊') ? "text-cyan-400" :
 "text-slate-300"
 )}>
 {log}
 </div>
 ))
 ) : (
 <div className="text-slate-500 text-center py-8">No logs yet - Run scrapers to see activity</div>
 )}
 </div>
 </div>
 )}
 </div>

 {/* Errors */}
 {engine?.errors && engine.errors.length > 0 && (
 <div className="bg-loss rounded-xl border border-loss mb-4">
 <div 
 className="p-4 flex items-center justify-between cursor-pointer hover:bg-loss/10"
 onClick={() => setShowErrors(!showErrors)}
 >
 <div className="flex items-center gap-3">
 <AlertTriangle className="w-5 h-5 text-loss" />
 <span className="text-base font-bold text-loss">ERRORS ({engine.errors.length})</span>
 </div>
 {showErrors ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
 </div>
 
 {showErrors && (
 <div className="p-4 pt-0">
 <div className="bg-slate-900 rounded-lg p-4 max-h-40 overflow-y-auto font-mono text-sm text-loss">
 {engine.errors.slice(-50).map((err, i) => (
 <div key={i} className="py-1">{err}</div>
 ))}
 </div>
 </div>
 )}
 </div>
 )}

 {/* Footer */}
 <div className="text-center text-sm text-slate-500 mt-3 pb-4">
 Refresh: {REFRESH_INTERVAL / 1000}s | 
 Scheduler: {engine?.scheduler_active ? 'ACTIVE' : 'INACTIVE'} |
 Historical: {counts?.historical_records?.toLocaleString() || 0} records
 </div>
 </div>
 )
}

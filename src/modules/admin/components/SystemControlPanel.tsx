'use client';

/**
 * SystemControlPanel — لوحة التحكم الشاملة
 * ==========================================
 * تحكم ومراقبة كاملة لكل جوانب المشروع:
 * - قواعد البيانات (حالة + ضغط)
 * - الخدمات (إعادة تشغيل)
 * - المحركات (تحكم)
 * - الأسعار (تحديث + فحص)
 * - التوقعات (إحصائيات + إغلاق)
 * - السجلات (مباشر)
 * - إجراءات سريعة
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
 Database, Server, Cpu, HardDrive, Activity, Zap, RefreshCw,
 Play, Trash2, AlertCircle, CheckCircle2, Loader2,
 TrendingUp, Brain, Clock, Bell, Terminal, Power, Settings,
 Radar, Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// PHASE2-ADMIN-PANEL (Task ID: PHASE2-ADMIN-PANEL):
// Owner request: "عرض عداد الصفوف، وحجم كل قاعدة، مع تنبيه أحمر فوري لو
// توقف تحديث أي قاعدة لأكثر من ساعتين" + "حالة الـ scrapers".
//
// The original SystemControlPanel only showed DB size + tables count from
// the Python /api/market-pulse proxy. We now also fetch /api/admin/db
// (Node route) which returns { totalRows, lastModified, size } per DB and
// /api/admin/data-sources which returns VPS + scraper last_update.
//
// Rule 27 (no fabrication): if lastModified is null we show "—" instead of
// inventing a timestamp. If a DB hasn't been modified in >2h we show a red
// stale alert at the top of the overview tab.

interface DbRowMeta {
 name: string;
 totalRows: number | null;
 lastModified: string | null;
 sizeFormatted: string | null;
 tableCount: number | null;
}

interface ScraperHealth {
 name: string;
 status: 'online' | 'offline' | 'unknown';
 detail: string;
 lastUpdate: string | null;
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours (owner requirement)

function isStale(lastModified: string | null): boolean {
 if (!lastModified) return false; // unknown → don't alert
 const d = new Date(lastModified);
 if (isNaN(d.getTime())) return false;
 return Date.now() - d.getTime() > STALE_THRESHOLD_MS;
}

function timeAgoShort(iso: string | null): string {
 if (!iso) return '—';
 const d = new Date(iso);
 if (isNaN(d.getTime())) return '—';
 const diffMs = Date.now() - d.getTime();
 if (diffMs < 0) return 'الآن';
 if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} ث`;
 if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} د`;
 if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} س`;
 return `${Math.floor(diffMs / 86_400_000)} يوم`;
}

type Tab = 'overview' | 'databases' | 'services' | 'engines' | 'prices' | 'predictions' | 'logs';

const TABS: { id: Tab; label: string; icon: any }[] = [
 { id: 'overview', label: 'نظرة عامة', icon: Activity },
 { id: 'databases', label: 'قواعد البيانات', icon: Database },
 { id: 'services', label: 'الخدمات', icon: Server },
 { id: 'engines', label: 'المحركات', icon: Brain },
 { id: 'prices', label: 'الأسعار', icon: TrendingUp },
 { id: 'predictions', label: 'التوقعات', icon: Zap },
 { id: 'logs', label: 'السجلات', icon: Terminal },
];

export function SystemControlPanel() {
 const [activeTab, setActiveTab] = useState<Tab>('overview');
 const [data, setData] = useState<any>(null);
 const [dbMeta, setDbMeta] = useState<DbRowMeta[]>([]);
 const [scrapers, setScrapers] = useState<ScraperHealth[]>([]);
 const [loading, setLoading] = useState(true);
 const [actionLoading, setActionLoading] = useState<string | null>(null);

 const fetchData = useCallback(async () => {
 try {
 const res = await fetch(`/api/system-control?section=${activeTab}`);
 const json = await res.json();
 if (json.success) setData(json.data);
 } catch (e) {
 console.error('[SystemControl] fetch error:', e);
 } finally {
 setLoading(false);
 }
 }, [activeTab]);

 // PHASE2-ADMIN-PANEL: parallel fetch of DB row counts + lastModified
 // + scraper health. These come from Node routes (not the Python proxy)
 // so they work even when /api/system-control is unreachable.
 const fetchDbMeta = useCallback(async () => {
 try {
 const res = await fetch('/api/admin/db', { credentials: 'same-origin' });
 const json = await res.json();
 if (json.success && Array.isArray(json.databases)) {
 setDbMeta(json.databases.map((d: any) => ({
 name: d.name,
 totalRows: typeof d.totalRows === 'number' ? d.totalRows : null,
 lastModified: d.lastModified || null,
 sizeFormatted: d.sizeFormatted || null,
 tableCount: typeof d.tableCount === 'number' ? d.tableCount : null,
 })));
 }
 } catch (e) {
 console.error('[SystemControl] db meta fetch error:', e);
 }
 }, []);

 const fetchScrapers = useCallback(async () => {
 try {
 const res = await fetch('/api/admin/data-sources', { credentials: 'same-origin' });
 const json = await res.json();
 const ds = json?.data_sources;
 if (!ds) return;
 const list: ScraperHealth[] = [];
 // TradingView (via VPS Python)
 list.push({
 name: 'TradingView (VPS)',
 status: ds.vps?.available ? 'online' : 'offline',
 detail: ds.vps?.url || 'غير مُعد',
 lastUpdate: ds.database?.stocks_db?.last_update || null,
 });
 // Yahoo (via Python egxpy bridge — local file present?)
 list.push({
 name: 'Yahoo Finance',
 status: ds.local_python?.available ? 'online' : 'offline',
 detail: ds.local_python?.note || 'Python bridge',
 lastUpdate: ds.database?.stocks_db?.last_update || null,
 });
 // EGKSCO (intraday_aggregated canonical for EGX)
 list.push({
 name: 'EGKSCO (EGX intraday)',
 status: ds.database?.stocks_db?.exists ? 'online' : 'offline',
 detail: 'intraday_aggregated → egksco_scraper.py',
 lastUpdate: ds.database?.stocks_db?.last_update || null,
 });
 // metals.dev (gold_fetcher — checked via gold_prices.db presence proxy)
 list.push({
 name: 'metals.dev (Gold)',
 status: ds.database?.stocks_db?.exists ? 'online' : 'unknown',
 detail: 'gold_fetcher.py → gold_prices.db',
 lastUpdate: ds.database?.stocks_db?.last_update || null,
 });
 setScrapers(list);
 } catch (e) {
 console.error('[SystemControl] scrapers fetch error:', e);
 }
 }, []);

 useEffect(() => {
 setLoading(true);
 fetchData();
 fetchDbMeta();
 fetchScrapers();
 const interval = setInterval(() => {
 fetchData();
 fetchDbMeta();
 fetchScrapers();
 }, 30000); // 30s — was 10s; reduced load by combining 3 endpoints
 return () => clearInterval(interval);
 }, [fetchData, fetchDbMeta, fetchScrapers]);

 const runAction = async (action: string, body?: any) => {
 setActionLoading(action);
 try {
 const res = await fetch(`/api/system-control?action=${action}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: body ? JSON.stringify(body) : undefined,
 });
 const json = await res.json();
 if (json.success) {
 await fetchData();
 }
 } catch (e) {
 console.error('[SystemControl] action error:', e);
 }
 setActionLoading(null);
 };

 // Stale DB alerts — owner requirement: "تنبيه أحمر فوري لو توقف تحديث أي
 // قاعدة لأكثر من ساعتين". Uses dbMeta.lastModified.
 const staleDbs = dbMeta.filter(d => isStale(d.lastModified));

 return (
 <div className="min-h-screen bg-[#0a0e17] text-foreground" dir="rtl">
 {/* Header */}
 <div className="sticky top-0 z-40 bg-[#0a0e17]/95 backdrop-blur-xl border-b border-white/5">
 <div className="flex items-center justify-between p-3">
 <div className="flex items-center gap-2">
 <Settings className="w-5 h-5 text-cyan-400" />
 <h2 className="text-sm font-bold">لوحة التحكم الشاملة</h2>
 <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 text-xs">
 {data?.system ? 'مباشر' : '...'}
 </Badge>
 </div>
 <Button variant="ghost" size="icon" onClick={fetchData} className="h-8 w-8">
 <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
 </Button>
 </div>

 {/* Tabs — horizontal scroll on mobile */}
 <div className="flex gap-1 px-2 pb-2 overflow-x-auto scrollbar-hide-mobile">
 {TABS.map((tab) => {
 const Icon = tab.icon;
 return (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={cn(
 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[40px] whitespace-nowrap',
 activeTab === tab.id
 ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
 : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
 )}
 >
 <Icon className="w-3.5 h-3.5" />
 {tab.label}
 </button>
 );
 })}
 </div>
 </div>

 {/* Content */}
 <div className="p-3 pb-20">
 <AnimatePresence mode="wait">
 <motion.div
 key={activeTab}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 transition={{ duration: 0.2 }}
 >
 {loading && !data ? (
 <div className="flex items-center justify-center py-20">
 <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
 </div>
 ) : (
 <>
 {/* PHASE2-ADMIN-PANEL: red stale-DB alert — owner requirement */}
 {staleDbs.length > 0 && (
 <Card className="bg-loss/10 border-loss/20 p-3 mb-3">
 <div className="flex items-start gap-2">
 <AlertCircle className="w-4 h-4 text-loss shrink-0 mt-0.5" />
 <div className="flex-1">
 <div className="text-xs font-bold text-loss">
 ⚠️ تنبيه: {staleDbs.length} قاعدة بيانات لم تتحدث منذ أكثر من ساعتين
 </div>
 <div className="text-xs text-loss/80 mt-1" dir="ltr">
 {staleDbs.map(d => `${d.name} (${timeAgoShort(d.lastModified)})`).join(' • ')}
 </div>
 </div>
 </div>
 </Card>
 )}
 {activeTab === 'overview' && <OverviewTab data={data} dbMeta={dbMeta} scrapers={scrapers} />}
 {activeTab === 'databases' && <DatabasesTab data={data} dbMeta={dbMeta} runAction={runAction} actionLoading={actionLoading} />}
 {activeTab === 'services' && <ServicesTab data={data} runAction={runAction} actionLoading={actionLoading} />}
 {activeTab === 'engines' && <EnginesTab data={data} />}
 {activeTab === 'prices' && <PricesTab data={data} runAction={runAction} actionLoading={actionLoading} />}
 {activeTab === 'predictions' && <PredictionsTab data={data} runAction={runAction} actionLoading={actionLoading} />}
 {activeTab === 'logs' && <LogsTab data={data} />}
 </>
 )}
 </motion.div>
 </AnimatePresence>
 </div>

 {/* Quick Actions Bar — fixed bottom */}
 <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0e17]/95 backdrop-blur-xl border-t border-white/5 p-2" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
 <div className="flex gap-2 overflow-x-auto scrollbar-hide-mobile">
 <QuickButton icon={RefreshCw} label="تحديث الأسعار" loading={actionLoading === 'update-prices'} onClick={() => runAction('update-prices')} color="emerald" />
 <QuickButton icon={CheckCircle2} label="إغلاق التوقعات" loading={actionLoading === 'run-daily-closer'} onClick={() => runAction('run-daily-closer')} color="amber" />
 <QuickButton icon={TrendingUp} label="لقطة الثروة" loading={actionLoading === 'run-wealth-snapshot'} onClick={() => runAction('run-wealth-snapshot')} color="purple" />
 <QuickButton icon={Trash2} label="مسح الكاش" loading={actionLoading === 'clear-cache'} onClick={() => runAction('clear-cache')} color="red" />
 </div>
 </div>
 </div>
 );
}

// === Overview Tab ===
function OverviewTab({ data, dbMeta, scrapers }: { data: any; dbMeta: DbRowMeta[]; scrapers: ScraperHealth[] }) {
 const sys = data?.system || {};
 const dbs = data?.databases || [];

 const healthyCount = dbs.filter((d: any) => d.status === 'healthy').length;
 const totalSize = dbs.reduce((s: number, d: any) => s + (d.size_kb || 0), 0);
 // PHASE2-ADMIN-PANEL: total rows across all DBs (from /api/admin/db)
 const totalRows = dbMeta.reduce((s, d) => s + (d.totalRows ?? 0), 0);

 return (
 <div className="space-y-3">
 {/* System Stats */}
 <div className="grid grid-cols-2 gap-2">
 <StatCard icon={Cpu} label="المعالج" value={sys.cpu || 'N/A'} color="cyan" />
 <StatCard icon={HardDrive} label="الذاكرة" value={sys.memory || 'N/A'} color="purple" />
 <StatCard icon={Database} label="القرص" value={sys.disk || 'N/A'} color="emerald" />
 <StatCard icon={Clock} label="التشغيل" value={sys.uptime || 'N/A'} color="amber" />
 </div>

 {/* DBs Summary — PHASE2-ADMIN-PANEL: now shows row counts + size */}
 <Card className="bg-white/5 border-white/10 p-3">
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-muted-foreground">قواعد البيانات</span>
 <Badge variant="outline" className="text-profit border-profit/20 text-xs">
 {healthyCount}/{dbs.length} سليمة
 </Badge>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <div className="text-2xl font-bold text-foreground">
 {totalRows > 0 ? totalRows.toLocaleString() : '—'}
 </div>
 <div className="text-xs text-muted-foreground mt-1">إجمالي الصفوف</div>
 </div>
 <div>
 <div className="text-2xl font-bold text-foreground">{(totalSize / 1024).toFixed(0)} MB</div>
 <div className="text-xs text-muted-foreground mt-1">إجمالي حجم البيانات</div>
 </div>
 </div>
 </Card>

 {/* DB List — now enriched with row counts + stale indicator */}
 <div className="space-y-1.5">
 {dbs.length > 0 ? (
 dbs.map((db: any) => {
 const meta = dbMeta.find(m => m.name === db.name);
 return <DBRow key={db.name} db={db} compact meta={meta} />;
 })
 ) : dbMeta.length > 0 ? (
 // Fallback: if Python proxy returned no DBs, show only Node-side meta
 dbMeta.slice(0, 8).map((m) => (
 <DBRow
 key={m.name}
 db={{ name: m.name, size_human: m.sizeFormatted || '—', tables: m.tableCount ?? 0, status: 'healthy' }}
 compact
 meta={m}
 />
 ))
 ) : null}
 </div>

 {/* PHASE2-ADMIN-PANEL: Scraper Health — owner requirement */}
 {scrapers.length > 0 && (
 <Card className="bg-white/5 border-white/10 p-3">
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2">
 <Radar className="w-4 h-4 text-cyan-400" />
 <span className="text-xs font-semibold text-muted-foreground">حالة Scrapers</span>
 </div>
 <Badge variant="outline" className="text-xs">
 {scrapers.filter(s => s.status === 'online').length}/{scrapers.length} نشط
 </Badge>
 </div>
 <div className="space-y-1.5">
 {scrapers.map((s) => (
 <div key={s.name} className="flex items-center justify-between text-xs">
 <div className="flex items-center gap-2">
 <Globe className="w-3 h-3 text-muted-foreground" />
 <span className="text-foreground">{s.name}</span>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground" dir="ltr">
 {timeAgoShort(s.lastUpdate)}
 </span>
 <div
 className={cn(
 'w-2 h-2 rounded-full',
 s.status === 'online' ? 'bg-profit' : s.status === 'offline' ? 'bg-loss' : 'bg-muted'
 )}
 />
 </div>
 </div>
 ))}
 </div>
 </Card>
 )}
 </div>
 );
}

// === Databases Tab ===
function DatabasesTab({ data, dbMeta, runAction, actionLoading }: any) {
 const dbs = data?.databases || [];
 // Merge Python proxy data with Node-side dbMeta (row counts + lastModified)
 const rows = dbs.length > 0
 ? dbs
 : dbMeta.map((m: DbRowMeta) => ({ name: m.name, size_human: m.sizeFormatted || '—', tables: m.tableCount ?? 0, status: 'healthy' }));
 return (
 <div className="space-y-2">
 {rows.map((db: any) => {
 const meta = dbMeta.find((m: DbRowMeta) => m.name === db.name);
 return (
 <DBRow
 key={db.name}
 db={db}
 runAction={runAction}
 actionLoading={actionLoading}
 meta={meta}
 />
 );
 })}
 </div>
 );
}

function DBRow({ db, compact, runAction, actionLoading, meta }: any) {
 const statusColor = db.status === 'healthy' ? 'text-profit' : db.status === 'empty' ? 'text-warning' : 'text-loss';
 const StatusIcon = db.status === 'healthy' ? CheckCircle2 : AlertCircle;
 // PHASE2-ADMIN-PANEL: stale flag from meta.lastModified (>2h = stale)
 const stale = meta?.lastModified ? isStale(meta.lastModified) : false;

 return (
 <Card className={cn('bg-white/5 border-white/10 p-3', stale && 'border-loss/20 bg-loss/5')}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2 min-w-0 flex-1">
 <Database className="w-4 h-4 text-cyan-400 shrink-0" />
 <div className="min-w-0">
 <div className="text-xs font-medium text-foreground truncate">{db.name}</div>
 <div className="text-xs text-muted-foreground">
 {db.size_human || meta?.sizeFormatted || '—'} • {db.tables ?? meta?.tableCount ?? 0} جداول
 {/* PHASE2-ADMIN-PANEL: row count from /api/admin/db */}
 {meta?.totalRows != null && (
 <span className="text-cyan-400/70"> • {meta.totalRows.toLocaleString()} صف</span>
 )}
 </div>
 {/* PHASE2-ADMIN-PANEL: last update + stale alert per-DB */}
 {meta?.lastModified && (
 <div className={cn('text-xs mt-0.5', stale ? 'text-loss font-bold' : 'text-muted-foreground')}>
 آخر تحديث: {timeAgoShort(meta.lastModified)}{stale && ' ⚠️ متأخر'}
 </div>
 )}
 </div>
 </div>
 <div className="flex items-center gap-2 shrink-0">
 <StatusIcon className={cn('w-4 h-4', statusColor)} />
 {!compact && (
 <Button
 size="sm"
 variant="ghost"
 className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
 disabled={actionLoading === `vacuum-${db.name}`}
 onClick={() => runAction('vacuum-db', { db: db.name })}
 >
 {actionLoading === `vacuum-${db.name}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'ضغط'}
 </Button>
 )}
 </div>
 </div>
 </Card>
 );
}

// === Services Tab ===
function ServicesTab({ data, runAction, actionLoading }: any) {
 const services = data || [];
 return (
 <div className="space-y-2">
 {services.map((svc: any) => (
 <Card key={svc.name} className="bg-white/5 border-white/10 p-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Server className="w-4 h-4 text-primary shrink-0" />
 <div>
 <div className="text-xs font-medium text-foreground">{svc.name}</div>
 <div className="text-xs text-muted-foreground">
 {svc.memory ? `${svc.memory} • CPU ${svc.cpu}` : `port ${svc.port || '?'}`}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <div className={cn('w-2 h-2 rounded-full', svc.status === 'online' ? 'bg-profit' : 'bg-loss')} />
 <Button
 size="sm"
 variant="ghost"
 className="h-7 px-2 text-xs text-warning hover:text-warning"
 disabled={actionLoading === `restart-${svc.name}`}
 onClick={() => runAction('restart-service', { service: svc.name })}
 >
 {actionLoading === `restart-${svc.name}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
 </Button>
 </div>
 </div>
 </Card>
 ))}
 </div>
 );
}

// === Engines Tab ===
function EnginesTab({ data }: { data: any }) {
 const engines = data || [];
 return (
 <div className="space-y-2">
 {engines.map((eng: any) => (
 <Card key={eng.id} className="bg-white/5 border-white/10 p-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Brain className="w-4 h-4 text-cyan-400 shrink-0" />
 <div>
 <div className="text-xs font-medium text-foreground">{eng.name}</div>
 <div className="text-xs text-muted-foreground">port {eng.port}</div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {eng.controllable && <Settings className="w-3 h-3 text-cyan-400" />}
 <div className={cn('w-2 h-2 rounded-full', eng.status === 'active' ? 'bg-profit' : 'bg-loss')} />
 </div>
 </div>
 </Card>
 ))}
 </div>
 );
}

// === Prices Tab ===
function PricesTab({ data, runAction, actionLoading }: any) {
 // PHASE2-ADMIN-PANEL (Rule 27 — no fabrication): use null-safe accessors
 // instead of `|| 0` fallbacks that mask missing Python responses.
 const totalStocks: number | null = typeof data?.total_stocks === 'number' ? data.total_stocks : null;
 const freshnessPct: number | null = typeof data?.freshness_pct === 'number' ? data.freshness_pct : null;
 const egxStocks: number | null = typeof data?.egx_stocks === 'number' ? data.egx_stocks : null;
 const historyRows: number | null = typeof data?.price_history_rows === 'number' ? data.price_history_rows : null;
 const fmtNum = (n: number | null): string => n === null ? '—' : n.toLocaleString();
 return (
 <div className="space-y-3">
 <Card className="to-cyan-500/5 border-profit/20 p-4">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <TrendingUp className="w-5 h-5 text-profit" />
 <span className="text-sm font-bold">حالة الأسعار</span>
 </div>
 <Button
 size="sm"
 className="bg-profit hover:bg-profit text-white h-8"
 disabled={actionLoading === 'update-prices'}
 onClick={() => runAction('update-prices')}
 >
 {actionLoading === 'update-prices' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
 <span className="mr-1 text-xs">تحديث</span>
 </Button>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-2xl font-bold text-foreground">{fmtNum(totalStocks)}</div>
 <div className="text-xs text-muted-foreground">إجمالي الأسهم</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-2xl font-bold text-profit">
 {freshnessPct === null ? '—' : `${freshnessPct}%`}
 </div>
 <div className="text-xs text-muted-foreground">طازجة</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-lg font-bold text-cyan-400">{fmtNum(egxStocks)}</div>
 <div className="text-xs text-muted-foreground">أسهم EGX</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-lg font-bold text-primary">{fmtNum(historyRows)}</div>
 <div className="text-xs text-muted-foreground">سجل تاريخي</div>
 </div>
 </div>
 <div className="mt-2 text-center text-xs text-muted-foreground">
 آخر تحديث: {data?.price_history_latest || '—'}
 </div>
 </Card>
 </div>
 );
}

// === Predictions Tab ===
function PredictionsTab({ data, runAction, actionLoading }: any) {
 // PHASE2-ADMIN-PANEL (Rule 27 — no fabrication):
 // Previously: `const wr = data?.win_rate || 0` and `(data?.total || 0)`.
 // That fabricated 0% win rate + 0 counts when the Python proxy returned
 // null. Now we render "—" when the field is null/undefined.
 const wr: number | null = typeof data?.win_rate === 'number' ? data.win_rate : null;
 const total: number | null = typeof data?.total === 'number' ? data.total : null;
 const closed: number | null = typeof data?.closed === 'number' ? data.closed : null;
 const pending: number | null = typeof data?.pending === 'number' ? data.pending : null;

 const fmtNum = (n: number | null): string => n === null ? '—' : n.toLocaleString();

 return (
 <div className="space-y-3">
 <Card className="from-purple-500/10 to-pink-500/5 border-purple-500/20 p-4">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Zap className="w-5 h-5 text-primary" />
 <span className="text-sm font-bold">التوقعات</span>
 </div>
 <Button
 size="sm"
 className="bg-warning hover:bg-warning text-white h-8"
 disabled={actionLoading === 'run-daily-closer'}
 onClick={() => runAction('run-daily-closer')}
 >
 {actionLoading === 'run-daily-closer' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
 <span className="mr-1 text-xs">إغلاق</span>
 </Button>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-2xl font-bold text-foreground">{fmtNum(total)}</div>
 <div className="text-xs text-muted-foreground">إجمالي</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className={cn('text-2xl font-bold', wr === null ? 'text-muted-foreground' : wr >= 50 ? 'text-profit' : 'text-warning')}>
 {wr === null ? '—' : `${wr}%`}
 </div>
 <div className="text-xs text-muted-foreground">معدل النجاح</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-lg font-bold text-cyan-400">{fmtNum(closed)}</div>
 <div className="text-xs text-muted-foreground">مغلقة</div>
 </div>
 <div className="text-center p-2 rounded-lg bg-black/30">
 <div className="text-lg font-bold text-warning">{fmtNum(pending)}</div>
 <div className="text-xs text-muted-foreground">معلقة</div>
 </div>
 </div>
 </Card>
 </div>
 );
}

// === Logs Tab ===
function LogsTab({ data }: { data: any }) {
 const logs = data || [];
 return (
 <Card className="bg-black/40 border-white/10 p-3 h-[60vh]">
 <ScrollArea className="h-full">
 <div className="space-y-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
 {logs.map((log: string, i: number) => (
 <div key={i} className={cn(
 'py-0.5 px-1 rounded',
 log.includes('Error') || log.includes('error') ? 'bg-loss/5 text-loss' : '',
 log.includes('success') || log.includes('✅') ? 'bg-profit/5 text-profit' : '',
 )}>
 {log}
 </div>
 ))}
 {logs.length === 0 && <div className="text-center text-muted-foreground py-8">لا توجد سجلات</div>}
 </div>
 </ScrollArea>
 </Card>
 );
}

// === Helper Components ===
function StatCard({ icon: Icon, label, value, color }: any) {
 const colors: Record<string, string> = {
 cyan: 'text-cyan-400 bg-cyan-500/5 border-cyan-500/20',
 purple: 'text-primary bg-primary/5 border-purple-500/20',
 emerald: 'text-profit bg-profit/5 border-profit/20',
 amber: 'text-warning bg-warning/5 border-warning/20',
 };
 return (
 <Card className={cn('border p-3', colors[color])}>
 <div className="flex items-center gap-2 mb-1">
 <Icon className="w-3.5 h-3.5" />
 <span className="text-xs text-muted-foreground">{label}</span>
 </div>
 <div className="text-xs font-bold text-foreground truncate">{value}</div>
 </Card>
 );
}

function QuickButton({ icon: Icon, label, onClick, loading, color }: any) {
 const colors: Record<string, string> = {
 emerald: 'text-profit border-profit/20 hover:bg-profit/10',
 amber: 'text-warning border-warning/20 hover:bg-warning/10',
 purple: 'text-primary border-purple-500/30 hover:bg-primary/10',
 red: 'text-loss border-loss/20 hover:bg-loss/10',
 };
 return (
 <button
 onClick={onClick}
 disabled={loading}
 className={cn(
 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all min-h-[40px] whitespace-nowrap',
 colors[color]
 )}
 >
 {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
 {label}
 </button>
 );
}

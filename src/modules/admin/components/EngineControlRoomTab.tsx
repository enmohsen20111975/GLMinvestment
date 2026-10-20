'use client';

/**
 * EngineControlRoomTab
 * =====================
 * Task 31-B (Engine Monitor Battalion):
 * One unified "Engine Control Room" — replaces the fragmented view across
 * EnginesStatusTab / DataEngineTab / EngineSettingsTab / CronHealthTab /
 * NewsHealthTab / ShariaManagementTab with a single, dashboard-grade view.
 *
 * Sections:
 * §1. Live Engine Grid — 8 engine cards (Data Engine / Python Backend /
 * WS / Telegram / News / Predictions / Learning / Sharia) with status
 * pills, latency, last-update, errors count, live log tail, action
 * buttons, click → detail Sheet.
 * §2. Per-Engine Deep View — sub-tabs for each engine category
 * (data-engine scrapers / news sources / predictions / sharia /
 * cron / aggregated error console).
 * §3. Quick Actions Bar — start-all / stop-all (with confirm) /
 * full-system check / export report (JSON).
 *
 * APIs consumed:
 * - /api/admin/system-health (port checks for 8 services)
 * - /api/admin/engines-status (detailed data/analysis/prediction engine info)
 * - /api/admin/engines/logs (live log tail from /tmp/*.log)
 * - /api/admin/engines/control (start/stop/restart individual engine)
 * - /api/admin/engines/start-all (batch start)
 * - /api/admin/engines/stop-all (batch stop)
 * - /api/admin/cron-health (25 cron jobs + last_run)
 * - /api/admin/news-health (per-source news health)
 * - /api/sharia (sharia stats + 8 sources + alias review)
 *
 * Rule 30: emerald + amber + red + slate palette only (NO indigo/blue).
 * Rule 4: this is a logical module addition — not a new user-facing route.
 * z-ai-web-dev-sdk NOT used.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
 Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
 Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
 AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
 AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
 AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
 Cpu, Activity, Play, Square, RotateCcw, FileText, AlertTriangle,
 CheckCircle2, XCircle, Loader2, RefreshCw, Search, Download,
 Server, Database, Brain, Newspaper, Send, Clock, ShieldCheck,
 ChevronDown, ChevronUp, Zap, Wifi, WifiOff, Terminal, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// Types — API response shapes
// ============================================================================

interface SystemService {
 id: string;
 name_ar: string;
 type: 'http' | 'tcp' | 'process' | 'file';
 status: 'online' | 'offline' | 'degraded' | 'unknown';
 latency_ms?: number;
 message: string;
 details?: Record<string, unknown>;
}
interface SystemHealthResponse {
 success: boolean;
 timestamp?: string;
 summary?: { total: number; online: number; offline: number; degraded: number; health_score: number };
 services?: SystemService[];
 error?: string;
}

interface EngineLogResult {
 path: string;
 exists: boolean;
 mtime: string | null;
 size: number;
 lines: string[];
 error?: string;
}
interface EngineLogsResponse {
 success: boolean;
 timestamp: string;
 engine?: string;
 engines: Record<string, { label: string; files: EngineLogResult[] }>;
 errors_only?: Array<{ engine: string; path: string; line: string; mtime: string | null }>;
 error?: string;
}

// ============================================================================
// Task 33 — single-engine logs response (Live Log Console consumes this).
// Shape mirrors what /api/admin/engines/logs?engine=X returns.
// ============================================================================
interface SingleEngineLogsResponse {
 success: boolean;
 engine: string;
 label?: string;
 lines: string[];
 total_lines: number;
 fetched_at: string;
 file_exists: boolean;
 latest_mtime?: string | null;
 files?: Array<{ path: string; exists: boolean; mtime: string | null; size: number; line_count: number; error?: string }>;
 error?: string;
}

// Task 33 — per-engine live status response from /api/admin/engines/logs/control?engine=X
interface LiveEngineStatusResponse {
 success: boolean;
 engine: string;
 label?: string;
 type: 'daemon' | 'cron';
 pattern: string;
 running: boolean;
 pids: number[];
 state: 'running' | 'scheduled' | 'stopped';
 timestamp: string;
 error?: string;
}

interface EngineControlResponse {
 success: boolean;
 action?: string;
 engine?: string;
 label?: string;
 message?: string;
 pids?: number[];
 pids_before?: number[];
 pids_after?: number[];
 log_file?: string;
 stdout?: string;
 stderr?: string;
 timestamp?: string;
 error?: string;
}

interface EngineListEntry {
 key: string;
 label: string;
 kill_pattern: string;
 log_file: string;
 running: boolean;
 pids: number[];
}
interface EngineControlListResponse {
 success: boolean;
 timestamp?: string;
 engines?: EngineListEntry[];
 error?: string;
}

interface CronJob {
 id: number;
 schedule: string;
 schedule_human: string;
 days_ar: string;
 command: string;
 full_command: string;
 log_file: string | null;
 last_run: string | null;
 last_run_human: string | null;
 exists_log: boolean;
 description: string;
 category: string;
}
interface CronHealthResponse {
 success: boolean;
 error?: string;
 timestamp?: string;
 source?: string;
 summary?: {
 total_jobs: number;
 jobs_ran: number;
 jobs_never_run: number;
 jobs_run_today: number;
 jobs_stale_7d: number;
 };
 jobs?: CronJob[];
}

interface NewsSourceHealth {
 source: string;
 source_type: 'rss' | 'telegram' | 'web' | 'broken';
 article_count: number;
 last_fetch: string | null;
 last_fetch_human: string | null;
 is_broken: boolean;
 broken_reason?: string;
 success_rate: number;
 success_rate_label: 'healthy' | 'degraded' | 'broken';
}
interface NewsHealthResponse {
 success: boolean;
 error?: string;
 detail?: string;
 timestamp?: string;
 total_sources?: number;
 total_articles?: number;
 broken_sources_count?: number;
 sources?: NewsSourceHealth[];
 known_broken_sources?: Array<{ source: string; reason: string }>;
}

interface ShariaApiResponse {
 success: boolean;
 error?: string;
 stats?: {
 total?: number;
 consensus_count?: number;
 with_sp_rate?: number;
 latest_source_update?: string | null;
 };
 sources?: Array<{ source_key: string; name_ar: string; methodology?: string | null; is_active?: number | boolean }>;
 alias_map?: {
 totals: Array<{ match_method: string; confidence: string; needs_review: number; n: number }>;
 review_queue: Array<{ source_symbol: string; resolved_ticker: string; match_method: string | null; confidence: string | null; needs_review: number | boolean; source_name_ar: string | null; matched_in: string | null; resolved_at: string | null }>;
 };
 primary_method?: string;
 consensus_min?: number;
 generated_at?: string;
}

// ============================================================================
// Engine Catalog — the 8 cards we render in the grid
//
// Task 33 (ROOT-CAUSE-FIRST — Rule 67): split into 2 types:
// - daemon: long-running services that must stay up 24/7. Status pill is
// based on port reachability (online/offline/degraded). Buttons: start,
// stop, restart, view logs.
// - cron: scheduled jobs that run for 30-60s then exit. Status pill is
// always "مجدول" (scheduled) — NEVER "متوقف". Buttons: run-now (manual
// trigger), view logs. last_run + next_run countdown come from cron-health.
//
// ============================================================================

type EngineKey = 'data_engine' | 'python_backend' | 'websocket' | 'telegram' | 'news_agent' | 'predictions' | 'learning' | 'sharia';

interface EngineCatalogEntry {
 key: EngineKey;
 name_ar: string;
 name_en: string;
 port: number | null;
 icon: React.ReactNode;
 /** daemon = 24/7 port-bound service; cron = scheduled one-shot job that
 * exits after running; worker = long-running background Python process that
 * does NOT open a port (e.g. News Agent) — status via pgrep + recent-log. */
 type: 'daemon' | 'cron' | 'worker';
 /** Maps this card to the engine-control / logs keys when applicable. */
 controlKey?: 'data_engine' | 'news' | 'predictions' | 'learning' | 'sharia';
 /** Maps this card to a system-health service id. */
 serviceId?: string;
 /** For cron engines: the crontab command pattern (used to match cron-health jobs). */
 cronCommandPattern?: string;
 /** For cron engines: the human-readable cron schedule (e.g. "0 3 * * 0-4"). */
 cronSchedule?: string;
 /** For cron engines: the Arabic label for the schedule. */
 cronScheduleAr?: string;
 /** For worker engines: the pgrep pattern used to detect the process (e.g. "news-agent"). */
 workerPattern?: string;
 /** For worker engines: the log file path (used to compute last_seen freshness). */
 workerLogPath?: string;
}

const ENGINE_CATALOG: EngineCatalogEntry[] = [
 // ===== Section A: 24/7 Daemons (5) =====
 {
 key: 'data_engine', name_ar: 'محرك البيانات', name_en: 'Data Engine (Flask)', port: 3010, type: 'daemon',
 icon: <Database className="w-4 h-4" />, controlKey: 'data_engine', serviceId: 'data_engine',
 },
 {
 key: 'python_backend', name_ar: 'الـ Backend بايثون', name_en: 'Python Backend', port: 8010, type: 'daemon',
 icon: <Server className="w-4 h-4" />, serviceId: 'python_engine',
 },
 {
 key: 'websocket', name_ar: 'خدمة WebSocket', name_en: 'WebSocket Relay', port: 3005, type: 'daemon',
 icon: <Wifi className="w-4 h-4" />, serviceId: 'websocket',
 },
 {
 key: 'telegram', name_ar: 'بوت تيليجرام', name_en: 'Telegram Events', port: 3003, type: 'daemon',
 icon: <Send className="w-4 h-4" />, serviceId: 'telegram_bot',
 },
 {
 // Task 35-C (ROOT-CAUSE-FIRST — Rule 67): News Agent is a Python worker
 // that does NOT open an HTTP port. The previous entry had
 // `port: 3002, type: 'daemon'` — the system-health probe tried to TCP
 // connect to 3002 and always failed → card showed 🔴 متوقف forever even
 // when the worker was running. Now: type 'worker', status = pgrep -f
 // news-agent + recent-log freshness (last 30 min).
 key: 'news_agent', name_ar: 'محرك الأخبار', name_en: 'News Agent (Worker)', port: null, type: 'worker',
 icon: <Newspaper className="w-4 h-4" />, controlKey: 'news', serviceId: 'news_agent',
 workerPattern: 'news-agent', workerLogPath: '/tmp/news_collector.log',
 },
 // ===== Section B: Scheduled Cron Jobs (3) =====
 {
 key: 'predictions', name_ar: 'محرك التوقعات V40.2', name_en: 'Predictions Engine (V40.2)', port: null, type: 'cron',
 icon: <Brain className="w-4 h-4" />, controlKey: 'predictions',
 cronCommandPattern: 'daily_predictor.py',
 cronSchedule: '0 3 * * 0-4 + 30 13 * * 0-4',
 cronScheduleAr: 'يومياً 05:00 + 15:30 القاهرة',
 },
 {
 key: 'learning', name_ar: 'محرك التعلم الذكي', name_en: 'Learning Engine', port: null, type: 'cron',
 icon: <Activity className="w-4 h-4" />, controlKey: 'learning',
 cronCommandPattern: 'learning_engine.py',
 cronSchedule: '0 15 * * 0-4',
 cronScheduleAr: 'يومياً 17:00 القاهرة',
 },
 {
 key: 'sharia', name_ar: 'محرك الفحص الشرعي', name_en: 'Sharia Compliance', port: null, type: 'cron',
 icon: <ShieldCheck className="w-4 h-4" />, controlKey: 'sharia',
 cronCommandPattern: 'sharia_compliance_scraper.py',
 cronSchedule: '30 15 * * 6',
 cronScheduleAr: 'أسبوعياً السبت 17:30 القاهرة',
 },
];

// Task 33 Phase 4 + Task 35-C: pre-computed splits so we don't filter on every render.
const DAEMON_ENTRIES = ENGINE_CATALOG.filter(e => e.type === 'daemon');
const CRON_ENTRIES = ENGINE_CATALOG.filter(e => e.type === 'cron');
const WORKER_ENTRIES = ENGINE_CATALOG.filter(e => e.type === 'worker');

// ============================================================================
// Helpers
// ============================================================================

function timeAgoBrief(iso: string | null): string {
 if (!iso) return '—';
 const d = new Date(iso);
 if (isNaN(d.getTime())) return '—';
 const diffMs = Date.now() - d.getTime();
 if (diffMs < 0) return d.toLocaleString('ar-EG');
 if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ث`;
 if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} د`;
 if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} س`;
 return `منذ ${Math.floor(diffMs / 86_400_000)} ي`;
}

function statusTone(status: 'online' | 'offline' | 'degraded' | 'unknown' | 'running' | 'stopped' | 'slow' | 'scheduled') {
 switch (status) {
 case 'online':
 case 'running':
 return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 يعمل', bg: 'bg-profit/20' };
 case 'scheduled':
 // Task 35-C: worker engines with no live process but a recent log entry
 // (last 30 min) → "🟢 مجدول" (emerald — it's a periodic worker, not dead).
 return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 مجدول', bg: 'bg-profit/20' };
 case 'offline':
 case 'stopped':
 return { dot: 'bg-loss', badge: 'border-loss text-loss', label: '🔴 متوقف', bg: 'bg-loss/20' };
 case 'degraded':
 case 'slow':
 return { dot: 'bg-warning', badge: 'border-warning text-warning', label: '🟡 بطيء', bg: 'bg-warning/20' };
 default:
 return { dot: 'bg-slate-400', badge: 'border-slate-400 text-slate-700', label: '⚪ غير معروف', bg: 'bg-slate-50 dark:bg-slate-900/20' };
 }
}

function looksLikeError(line: string): boolean {
 const t = line.trim();
 if (!t) return false;
 return /\b(error|traceback|exception|fail|crash|denied|refused|timeout|unreachable|critical)\b/i.test(t);
}

function severityOf(line: string): 'error' | 'warning' | 'info' {
 if (/\b(critical|traceback|exception|crash)\b/i.test(line)) return 'error';
 if (looksLikeError(line)) return 'warning';
 return 'info';
}

function downloadJson(filename: string, payload: unknown) {
 const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
}

// ============================================================================
// Task 33 — cron-specific helpers
// ============================================================================

/** Find the most recent cron job matching the given command pattern. */
function findCronJob(cron: CronHealthResponse | null, pattern: string | undefined): CronJob | null {
 if (!cron?.jobs || !pattern) return null;
 // Match by substring (the command pattern e.g. 'daily_predictor.py' is a
 // substring of the cron entry's full_command).
 const matches = cron.jobs.filter(j => j.full_command.includes(pattern));
 if (matches.length === 0) return null;
 // Sort by last_run descending (most recent first).
 return matches.sort((a, b) => {
 const ta = a.last_run ? new Date(a.last_run).getTime() : 0;
 const tb = b.last_run ? new Date(b.last_run).getTime() : 0;
 return tb - ta;
 })[0];
}

/**
 * Compute the next-run countdown for a cron schedule.
 * Returns a human-readable Arabic string like "بعد 5 ساعات" or "بعد 2 دقيقة".
 * Returns '—' if the schedule is unparseable.
 *
 * NOTE: This is a *rough* countdown — it computes the next occurrence from now
 * using a minimal cron parser (minute/hour/day-of-week only — day-of-month and
 * month are ignored since our schedules are simple).
 */
function nextRunCountdown(schedule: string): string {
 const parts = schedule.trim().split(/\s+/);
 if (parts.length !== 5) return '—';
 const [minute, hour, , , dayOfWeek] = parts;
 const now = new Date();

 // Try the next 7 days × 24 hours × 60 minutes (≈ 10K iterations max).
 // Cheaper than a real cron parser and fine for a UI countdown.
 const maxAheadMs = 7 * 24 * 60 * 60 * 1000;
 const startMs = now.getTime();
 for (let t = startMs + 60_000; t < startMs + maxAheadMs; t += 60_000) {
 const d = new Date(t);
 // day-of-week check (cron: 0=Sun, JS: 0=Sun)
 if (dayOfWeek !== '*') {
 const dowRanges = dayOfWeek.split(',').flatMap(r => {
 if (r.includes('-')) {
 const [a, b] = r.split('-').map(n => parseInt(n, 10));
 return Array.from({ length: b - a + 1 }, (_, i) => a + i);
 }
 return [parseInt(r, 10)];
 });
 if (!dowRanges.includes(d.getDay())) continue;
 }
 // hour check
 if (hour !== '*') {
 const hours: number[] = [];
 if (hour.includes('-')) {
 const [a, b] = hour.split('-').map(n => parseInt(n, 10));
 for (let h = a; h <= b; h++) hours.push(h);
 } else if (hour.includes(',')) {
 hour.split(',').forEach(h => hours.push(parseInt(h, 10)));
 } else if (hour.startsWith('*/')) {
 const step = parseInt(hour.slice(2), 10);
 for (let h = 0; h < 24; h += step) hours.push(h);
 } else {
 hours.push(parseInt(hour, 10));
 }
 if (!hours.includes(d.getHours())) continue;
 }
 // minute check
 if (minute !== '*') {
 const minutes: number[] = [];
 if (minute.startsWith('*/')) {
 const step = parseInt(minute.slice(2), 10);
 for (let m = 0; m < 60; m += step) minutes.push(m);
 } else if (minute.includes(',')) {
 minute.split(',').forEach(m => minutes.push(parseInt(m, 10)));
 } else {
 minutes.push(parseInt(minute, 10));
 }
 if (!minutes.includes(d.getMinutes())) continue;
 }
 // Found the next run.
 const diffMs = t - startMs;
 if (diffMs < 60_000) return `بعد ${Math.floor(diffMs / 1000)} ثانية`;
 if (diffMs < 3_600_000) return `بعد ${Math.floor(diffMs / 60_000)} دقيقة`;
 if (diffMs < 86_400_000) return `بعد ${Math.floor(diffMs / 3_600_000)} ساعة`;
 return `بعد ${Math.floor(diffMs / 86_400_000)} يوم`;
 }
 return '—';
}

/** Tone specifically for cron engines — always "scheduled" (emerald) unless
 * the user just triggered a manual run (running = amber). */
function cronTone(running: boolean) {
 if (running) {
 return { dot: 'bg-warning', badge: 'border-warning text-warning', label: '🟡 يعمل الآن', bg: 'bg-warning/20' };
 }
 // CRITICAL Rule 67 fix: cron engines are NEVER "متوقف" — they're "مجدول".
 return { dot: 'bg-profit', badge: 'border-profit text-profit', label: '🟢 مجدول', bg: 'bg-profit/20' };
}

// ============================================================================
// Engine Card (top grid)
//
// Task 33: now branches on `entry.type`:
// - daemon → renders start/stop/restart + port-based status pill
// - cron → renders run-now + last_run + next_run + "🟢 مجدول" pill
// ============================================================================

interface CronCardInfo {
 last_run: string | null;
 last_run_human: string | null;
 next_run_label: string;
 running: boolean;
}

interface EngineCardProps {
 entry: EngineCatalogEntry;
 service?: SystemService;
 controlInfo?: EngineListEntry;
 logs: string[];
 logsMtime: string | null;
 cronInfo?: CronCardInfo;
 onClick: () => void;
 onAction: (action: 'start' | 'stop' | 'restart') => void;
 /** Open the Live Log Console for this engine. */
 onOpenLiveConsole: () => void;
 actionLoading: boolean;
}

function EngineCard({ entry, service, controlInfo, logs, logsMtime, cronInfo, onClick, onAction, onOpenLiveConsole, actionLoading }: EngineCardProps) {
 // ----- Cron branch — totally different layout -----
 if (entry.type === 'cron') {
 const running = cronInfo?.running ?? false;
 const tone = cronTone(running);
 const errorsCount = logs.filter(looksLikeError).length;
 return (
 <Card
 className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
 onClick={onClick}
 >
 <CardHeader className="pb-2 pt-3">
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
 {entry.icon}
 </div>
 <div className="min-w-0">
 <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
 <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
 </div>
 </div>
 <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="pt-0 pb-3 space-y-2">
 {/* Stats row — schedule + last_run + next_run */}
 <div className="grid grid-cols-3 gap-2 text-center text-xs">
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">الجدولة</div>
 <div className="font-bold truncate" title={entry.cronScheduleAr}>{entry.cronScheduleAr?.split(' ')[0] ?? '—'}</div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">آخر تشغيل</div>
 <div className="font-bold" title={cronInfo?.last_run ?? ''}>{cronInfo?.last_run_human ?? 'لم يُشغّل'}</div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">القادم</div>
 <div className="font-bold">{cronInfo?.next_run_label ?? '—'}</div>
 </div>
 </div>

 {/* Errors badge */}
 {errorsCount > 0 && (
 <div className="flex items-center gap-1 text-xs text-loss">
 <AlertTriangle className="w-3 h-3" />
 {errorsCount} خطأ في آخر السجلات
 </div>
 )}

 {/* Live log tail (3 lines) */}
 <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
 {logs.length === 0 ? (
 <div className="text-slate-500 text-center pt-3">لا توجد سجلات</div>
 ) : (
 logs.slice(-3).map((line, i) => (
 <div
 key={i}
 className={cn(
 'truncate',
 looksLikeError(line) ? 'text-loss' : 'text-slate-300',
 )}
 dir="ltr"
 title={line}
 >
 {line || ' '}
 </div>
 ))
 )}
 </div>

 {/* Action buttons — cron engines only get "Run Now" + "Logs" */}
 <div className="flex gap-1 pt-1">
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
 disabled={actionLoading || running || !entry.controlKey}
 onClick={(e) => { e.stopPropagation(); onAction('start'); }}
 >
 {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
 تشغيل يدوي
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
 onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
 >
 <Terminal className="w-3 h-3" /> السجلات
 </Button>
 </div>
 </CardContent>
 </Card>
 );
 }

 // ----- Worker branch (Task 35-C — Rule 67) -----
 // Worker engines (e.g. News Agent) are long-running Python processes that
 // do NOT open a port. Status logic:
 // 1. controlInfo.running (pgrep -f news-agent) OR service.status === 'online'
 // → "🟢 يعمل" (running)
 // 2. No process but logsMtime within last 30 min
 // → "🟢 مجدول" (scheduled — it's a periodic worker, just not active now)
 // 3. No process and no recent log → "🔴 متوقف" (stopped)
 if (entry.type === 'worker') {
 const processRunning = controlInfo?.running === true || service?.status === 'online';
 let workerStatus: 'running' | 'scheduled' | 'stopped';
 if (processRunning) {
 workerStatus = 'running';
 } else {
 // Check log freshness — if last log entry is <30 min ago, the worker
 // recently ran (it's a periodic worker, not dead).
 const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
 const logTime = logsMtime ? new Date(logsMtime).getTime() : 0;
 workerStatus = logTime > thirtyMinAgo ? 'scheduled' : 'stopped';
 }
 const tone = statusTone(workerStatus);
 const errorsCount = logs.filter(looksLikeError).length;
 return (
 <Card
 className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
 onClick={onClick}
 >
 <CardHeader className="pb-2 pt-3">
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
 {entry.icon}
 </div>
 <div className="min-w-0">
 <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
 <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
 </div>
 </div>
 <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="pt-0 pb-3 space-y-2">
 {/* Stats row — worker shows process pattern + last update (no port, no latency) */}
 <div className="grid grid-cols-3 gap-2 text-center text-xs">
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">العملية</div>
 <div className="font-bold truncate" title={entry.workerPattern ?? ''} dir="ltr">{entry.workerPattern ?? '—'}</div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">PID</div>
 <div className="font-bold" dir="ltr">
 {controlInfo?.pids && controlInfo.pids.length > 0
 ? controlInfo.pids.slice(0, 2).join(', ')
 : '—'}
 </div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">آخر تحديث</div>
 <div className="font-bold">{timeAgoBrief(logsMtime)}</div>
 </div>
 </div>

 {/* Errors badge */}
 {errorsCount > 0 && (
 <div className="flex items-center gap-1 text-xs text-loss">
 <AlertTriangle className="w-3 h-3" />
 {errorsCount} خطأ في آخر السجلات
 </div>
 )}

 {/* Live log tail (3 lines) */}
 <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
 {logs.length === 0 ? (
 <div className="text-slate-500 text-center pt-3">لا توجد سجلات</div>
 ) : (
 logs.slice(-3).map((line, i) => (
 <div
 key={i}
 className={cn(
 'truncate',
 looksLikeError(line) ? 'text-loss' : 'text-slate-300',
 )}
 dir="ltr"
 title={line}
 >
 {line || ' '}
 </div>
 ))
 )}
 </div>

 {/* Action buttons — workers get start / stop / restart / logs (same as daemon) */}
 <div className="flex gap-1 pt-1">
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
 disabled={actionLoading || processRunning}
 onClick={(e) => { e.stopPropagation(); onAction('start'); }}
 >
 {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 تشغيل
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-loss dark:hover:bg-loss/10"
 disabled={actionLoading || !processRunning}
 onClick={(e) => { e.stopPropagation(); onAction('stop'); }}
 >
 <Square className="w-3 h-3" /> إيقاف
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
 disabled={actionLoading || !entry.controlKey}
 onClick={(e) => { e.stopPropagation(); onAction('restart'); }}
 >
 <RotateCcw className="w-3 h-3" /> إعادة
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-slate-100 dark:hover:bg-slate-900/30"
 onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
 title="فتح الكونسول الحي"
 >
 <Terminal className="w-3 h-3" /> السجل
 </Button>
 </div>
 </CardContent>
 </Card>
 );
 }

 // ----- Daemon branch — original behavior (port-based status) -----
 const isRunning = controlInfo
 ? controlInfo.running
 : service
 ? service.status === 'online'
 : false;
 const status: 'running' | 'stopped' | 'slow' = isRunning
 ? (service?.status === 'degraded' ? 'slow' : 'running')
 : 'stopped';
 const tone = statusTone(status);
 const latency = service?.latency_ms;
 const errorsCount = logs.filter(looksLikeError).length;

 return (
 <Card
 className={cn('relative overflow-hidden border cursor-pointer transition-shadow hover:shadow-md', tone.bg)}
 onClick={onClick}
 >
 <CardHeader className="pb-2 pt-3">
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', tone.bg)}>
 {entry.icon}
 </div>
 <div className="min-w-0">
 <CardTitle className="text-sm truncate">{entry.name_ar}</CardTitle>
 <CardDescription className="text-xs truncate" dir="ltr">{entry.name_en}</CardDescription>
 </div>
 </div>
 <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="pt-0 pb-3 space-y-2">
 {/* Stats row */}
 <div className="grid grid-cols-3 gap-2 text-center text-xs">
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">المنفذ</div>
 <div className="font-bold" dir="ltr">{entry.port ?? 'cron'}</div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">Latency</div>
 <div className="font-bold" dir="ltr">{latency ? `${latency}ms` : '—'}</div>
 </div>
 <div className="rounded-md bg-background/60 p-1.5">
 <div className="text-muted-foreground">آخر تحديث</div>
 <div className="font-bold">{timeAgoBrief(logsMtime)}</div>
 </div>
 </div>

 {/* Errors badge */}
 {errorsCount > 0 && (
 <div className="flex items-center gap-1 text-xs text-loss">
 <AlertTriangle className="w-3 h-3" />
 {errorsCount} خطأ في آخر السجلات
 </div>
 )}

 {/* Live log tail (3 lines) */}
 <div className="rounded-md bg-slate-950/95 text-slate-200 p-2 font-mono text-xs leading-tight h-16 overflow-hidden">
 {logs.length === 0 ? (
 <div className="text-slate-500 text-center pt-3">لا توجد سجلات</div>
 ) : (
 logs.slice(-3).map((line, i) => (
 <div
 key={i}
 className={cn(
 'truncate',
 looksLikeError(line) ? 'text-loss' : 'text-slate-300',
 )}
 dir="ltr"
 title={line}
 >
 {line || ' '}
 </div>
 ))
 )}
 </div>

 {/* Action buttons — daemon engines: start / stop / restart / logs */}
 <div className="flex gap-1 pt-1">
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-profit dark:hover:bg-profit/10"
 disabled={actionLoading || isRunning}
 onClick={(e) => { e.stopPropagation(); onAction('start'); }}
 >
 {actionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 تشغيل
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-loss dark:hover:bg-loss/10"
 disabled={actionLoading || !isRunning}
 onClick={(e) => { e.stopPropagation(); onAction('stop'); }}
 >
 <Square className="w-3 h-3" /> إيقاف
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-warning dark:hover:bg-warning/10"
 disabled={actionLoading || !entry.controlKey}
 onClick={(e) => { e.stopPropagation(); onAction('restart'); }}
 >
 <RotateCcw className="w-3 h-3" /> إعادة
 </Button>
 <Button
 size="sm"
 variant="ghost"
 className="h-7 flex-1 text-xs gap-1 hover:bg-slate-100 dark:hover:bg-slate-900/30"
 onClick={(e) => { e.stopPropagation(); onOpenLiveConsole(); }}
 title="فتح الكونسول الحي"
 >
 <Terminal className="w-3 h-3" /> السجل
 </Button>
 </div>
 </CardContent>
 </Card>
 );
}

// ============================================================================
// Live Log Console — Task 33 Phase 5
//
// A bottom Sheet that opens when the user clicks "تشغيل" (daemon) or
// "تشغيل يدوي" (cron). It polls:
// - /api/admin/engines/logs?engine=X&limit=50 every 2s → appends new lines
// - /api/admin/engines/logs/control?engine=X every 2s → checks process state
//
// When the process exits (running: false), it shows ✅/❌ based on the last
// 10 log lines (traceback/error → ❌, otherwise ✅).
//
// Features:
// - Dark terminal-style bg + monospace font + LTR (logs are English/paths).
// - Auto-scroll to bottom on new lines (with manual scroll-up override).
// - Clear button (resets state without closing).
// - Close button.
// - Auto-refresh toggle (default ON).
// - "Re-run" button to trigger the action again.
// ============================================================================

interface LiveLogConsoleProps {
 /** Engine key ('data_engine' | 'news' | 'predictions' | 'learning' | 'sharia') — passed to the API. */
 engineControlKey: 'data_engine' | 'news' | 'predictions' | 'learning' | 'sharia';
 /** Display info from the catalog (icon + Arabic name + type). */
 entry: EngineCatalogEntry;
 /** Whether the parent just triggered an action (shows "جاري التنفيذ..." spinner). */
 actionInProgress: boolean;
 onClose: () => void;
 /** Optional: re-trigger the start action from inside the console. */
 onRerun?: () => void;
}

const LIVE_LOG_POLL_MS = 2000;
const LIVE_LOG_MAX_LINES = 500;

function LiveLogConsole({ engineControlKey, entry, actionInProgress, onClose, onRerun }: LiveLogConsoleProps) {
 const [lines, setLines] = useState<string[]>([]);
 const [autoRefresh, setAutoRefresh] = useState(true);
 const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
 const [fileExists, setFileExists] = useState(false);
 const [liveStatus, setLiveStatus] = useState<LiveEngineStatusResponse | null>(null);
 const [fetchError, setFetchError] = useState<string | null>(null);
 const [processExited, setProcessExited] = useState<boolean>(false);
 const [autoScroll, setAutoScroll] = useState(true);
 const scrollRef = React.useRef<HTMLDivElement>(null);
 const userScrolledRef = React.useRef(false);
 // Ref mirror of liveStatus so the polling closure can read the latest value
 // without re-creating the interval on every status change.
 const liveStatusRef = React.useRef<LiveEngineStatusResponse | null>(null);
 useEffect(() => { liveStatusRef.current = liveStatus; }, [liveStatus]);

 // ----- Pollers (logs + status) every 2s while autoRefresh is on -----
 useEffect(() => {
 if (!autoRefresh) return;
 let cancelled = false;

 const pollOnce = async () => {
 try {
 const [logsRes, statusRes] = await Promise.all([
 fetch(`/api/admin/engines/logs?engine=${encodeURIComponent(engineControlKey)}&limit=50`, {
 credentials: 'same-origin', cache: 'no-store',
 }),
 fetch(`/api/admin/engines/logs/control?engine=${encodeURIComponent(engineControlKey)}`, {
 credentials: 'same-origin', cache: 'no-store',
 }),
 ]);
 const logsJson: SingleEngineLogsResponse = await logsRes.json();
 const statusJson: LiveEngineStatusResponse = await statusRes.json();

 if (cancelled) return;

 if (logsJson.success) {
 setLines(prev => {
 // The API returns the tail of `limit` lines. While a process is
 // running, new lines appear at the end → we append only the lines
 // after the last one we already have (best-effort dedupe).
 const newLines = logsJson.lines.slice(-LIVE_LOG_MAX_LINES);
 if (prev.length === 0) return newLines;
 const lastLine = prev[prev.length - 1];
 const idx = newLines.indexOf(lastLine);
 if (idx >= 0 && idx < newLines.length - 1) {
 return [...prev, ...newLines.slice(idx + 1)].slice(-LIVE_LOG_MAX_LINES);
 }
 // Fallback: if last line not found (log rotated?), just replace.
 return newLines;
 });
 setLastFetchedAt(logsJson.fetched_at);
 setFileExists(logsJson.file_exists);
 setFetchError(null);
 } else {
 setFetchError(logsJson.error || 'فشل تحميل السجلات');
 }

 if (statusJson.success) {
 const wasRunning = liveStatusRef.current?.running === true;
 const isRunningNow = statusJson.running;
 setLiveStatus(statusJson);
 // Detect process exit: was running before, now not running.
 // Only flip if we actually saw it running at least once — otherwise
 // we'd mark "exited" on the very first poll before the action even
 // started.
 if (wasRunning && !isRunningNow) {
 setProcessExited(true);
 }
 }
 } catch (err) {
 if (!cancelled) {
 setFetchError(err instanceof Error ? err.message : 'network error');
 }
 }
 };

 pollOnce();
 const interval = setInterval(pollOnce, LIVE_LOG_POLL_MS);
 return () => {
 cancelled = true;
 clearInterval(interval);
 };
 }, [autoRefresh, engineControlKey]);

 // ----- Auto-scroll on new lines (unless the user scrolled up manually) -----
 useEffect(() => {
 if (!autoScroll) return;
 if (userScrolledRef.current) return;
 const el = scrollRef.current;
 if (el) {
 el.scrollTop = el.scrollHeight;
 }
 }, [lines, autoScroll]);

 const handleScroll = () => {
 const el = scrollRef.current;
 if (!el) return;
 const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
 userScrolledRef.current = !atBottom;
 setAutoScroll(atBottom);
 };

 const handleClear = () => {
 setLines([]);
 setProcessExited(false);
 userScrolledRef.current = false;
 setAutoScroll(true);
 };

 // Determine success/failure based on last 10 lines after process exits.
 const lastTenLines = lines.slice(-10);
 const hasErrorTail = lastTenLines.some(l => /\b(traceback|exception|critical|error:|fatal)\b/i.test(l));
 const exitedSuccessfully = processExited && !hasErrorTail;

 const isCron = entry.type === 'cron';
 const isRunning = liveStatus?.running ?? actionInProgress;

 return (
 <Sheet open onOpenChange={(o) => !o && onClose()}>
 <SheetContent side="bottom" className="h-[80vh] sm:h-[70vh] p-0 flex flex-col gap-0">
 {/* Header */}
 <SheetHeader className="px-4 py-3 border-b bg-slate-900 text-slate-100">
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-2 min-w-0">
 <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
 {entry.icon}
 </div>
 <div className="min-w-0">
 <SheetTitle className="text-sm text-slate-100 flex items-center gap-2">
 <Terminal className="w-4 h-4 text-profit" />
 كونسول حي — {entry.name_ar}
 </SheetTitle>
 <SheetDescription className="text-xs text-slate-400" dir="ltr">
 {entry.name_en} · engine={engineControlKey}
 </SheetDescription>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {/* Status pill */}
 <Badge
 variant="outline"
 className={cn(
 'text-xs shrink-0',
 isRunning
 ? 'border-warning text-warning bg-warning/10'
 : processExited
 ? exitedSuccessfully
 ? 'border-profit text-profit bg-profit/10'
 : 'border-loss text-loss bg-loss/10'
 : 'border-slate-500 text-slate-300 bg-slate-800/50',
 )}
 >
 {isRunning ? (
 <>
 <Loader2 className="w-3 h-3 ml-1 animate-spin" />
 جاري التنفيذ...
 </>
 ) : processExited ? (
 exitedSuccessfully ? (
 <>
 <CheckCircle2 className="w-3 h-3 ml-1" />
 اكتمل التشغيل
 </>
 ) : (
 <>
 <XCircle className="w-3 h-3 ml-1" />
 فشل التشغيل
 </>
 )
 ) : (
 <>
 <Clock className="w-3 h-3 ml-1" />
 بانتظار السجل
 </>
 )}
 </Badge>
 {liveStatus?.pids && liveStatus.pids.length > 0 && (
 <Badge variant="outline" className="text-xs shrink-0 border-slate-500 text-slate-300 bg-slate-800/50">
 PID: {liveStatus.pids.slice(0, 3).join(', ')}
 </Badge>
 )}
 </div>
 </div>
 {/* Toolbar */}
 <div className="flex items-center gap-2 mt-2 text-xs">
 <button
 onClick={() => setAutoRefresh(v => !v)}
 className={cn(
 'flex items-center gap-1 px-2 py-1 rounded-md border',
 autoRefresh
 ? 'border-profit text-profit bg-profit/10'
 : 'border-slate-500 text-slate-400 bg-slate-800/50',
 )}
 >
 <RefreshCw className={cn('w-3 h-3', autoRefresh && 'animate-spin')} />
 {autoRefresh ? 'تحديث تلقائي (2s)' : 'متوقف'}
 </button>
 <button
 onClick={handleClear}
 className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-500 text-slate-300 bg-slate-800/50 hover:bg-slate-700/50"
 >
 <Filter className="w-3 h-3" />
 مسح
 </button>
 {onRerun && (
 <button
 onClick={onRerun}
 disabled={isRunning}
 className="flex items-center gap-1 px-2 py-1 rounded-md border border-warning text-warning bg-warning/10 hover:bg-warning/10 disabled:opacity-50"
 >
 <Zap className="w-3 h-3" />
 {isCron ? 'إعادة التشغيل اليدوي' : 'إعادة المحاولة'}
 </button>
 )}
 <div className="flex-1" />
 <span className="text-slate-500">
 {lines.length} سطر · آخر fetch: {lastFetchedAt ? timeAgoBrief(lastFetchedAt) : '—'}
 </span>
 </div>
 </SheetHeader>

 {/* Terminal body */}
 <div
 ref={scrollRef}
 onScroll={handleScroll}
 className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed p-3"
 dir="ltr"
 >
 {lines.length === 0 ? (
 <div className="text-slate-500 text-center py-8">
 {fetchError ? (
 <span className="text-loss">⚠ {fetchError}</span>
 ) : fileExists ? (
 'الملف موجود لكنه فارغ — بانتظار أول سطر...'
 ) : actionInProgress ? (
 <span className="flex items-center justify-center gap-2">
 <Loader2 className="w-3 h-3 animate-spin" />
 جاري إرسال أمر التشغيل...
 </span>
 ) : (
 'لا يوجد ملف سجل بعد — اضغط "إعادة التشغيل" لبدء محرك جديد'
 )}
 </div>
 ) : (
 lines.map((line, i) => {
 const sev = severityOf(line);
 const color = sev === 'error' ? 'text-loss'
 : sev === 'warning' ? 'text-warning'
 : 'text-slate-300';
 return (
 <div key={i} className={cn('whitespace-pre-wrap break-all', color)}>
 <span className="text-slate-600 select-none">{String(i + 1).padStart(4, ' ')}│ </span>
 {line || ' '}
 </div>
 );
 })
 )}
 {processExited && lines.length > 0 && (
 <div className={cn(
 'mt-2 p-2 rounded border text-xs',
 exitedSuccessfully
 ? 'border-profit bg-profit/10 text-profit'
 : 'border-loss bg-loss/10 text-loss',
 )}>
 {exitedSuccessfully
 ? '✅ اكتمل التشغيل — انتهت العملية بنجاح'
 : '❌ فشل التشغيل — انتهت العملية بخطأ. راجع آخر 10 أسطر بالأعلى.'}
 </div>
 )}
 </div>
 </SheetContent>
 </Sheet>
 );
}

// ============================================================================
// Detail Sheet (when an engine card is clicked)
// ============================================================================

interface DetailSheetProps {
 entry: EngineCatalogEntry | null;
 service?: SystemService;
 controlInfo?: EngineListEntry;
 logs: { path: string; exists: boolean; mtime: string | null; lines: string[] }[];
 onClose: () => void;
 onAction: (action: 'start' | 'stop' | 'restart') => void;
 actionLoading: boolean;
}

function DetailSheet({ entry, service, controlInfo, logs, onClose, onAction, actionLoading }: DetailSheetProps) {
 if (!entry) return null;
 // Task 35-C: workers use process + log-freshness logic (not port-based).
 // Daemons + crons: existing logic (port-reachability via service.status).
 let status: 'running' | 'stopped' | 'slow' | 'scheduled';
 if (entry.type === 'worker') {
 const processRunning = controlInfo?.running === true || service?.status === 'online';
 if (processRunning) {
 status = 'running';
 } else {
 // Check log freshness across all log files for this engine.
 const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
 const hasRecentLog = logs.some(f => f.mtime && new Date(f.mtime).getTime() > thirtyMinAgo);
 status = hasRecentLog ? 'scheduled' : 'stopped';
 }
 } else {
 const isRunning = controlInfo ? controlInfo.running : service ? service.status === 'online' : false;
 status = isRunning
 ? (service?.status === 'degraded' ? 'slow' : 'running')
 : 'stopped';
 }
 const tone = statusTone(status);
 // Detail buttons use "running" as the lock-state (don't allow start if already running).
 const isRunning = status === 'running';

 return (
 <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
 <SheetContent side="left" className="w-full sm:max-w-2xl overflow-y-auto">
 <SheetHeader>
 <div className="flex items-center gap-3">
 <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', tone.bg)}>
 {entry.icon}
 </div>
 <div>
 <SheetTitle className="text-lg">{entry.name_ar}</SheetTitle>
 <SheetDescription dir="ltr" className="text-xs">{entry.name_en} · port {entry.port ?? 'cron'}</SheetDescription>
 </div>
 </div>
 <div className="mt-2 flex items-center gap-2">
 <Badge variant="outline" className={tone.badge}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 {service?.latency_ms !== undefined && (
 <Badge variant="outline" className="text-xs" dir="ltr">
 {service.latency_ms}ms
 </Badge>
 )}
 {controlInfo?.pids && controlInfo.pids.length > 0 && (
 <Badge variant="outline" className="text-xs">PID: {controlInfo.pids.slice(0, 3).join(', ')}</Badge>
 )}
 </div>
 </SheetHeader>

 <div className="px-4 space-y-4">
 {/* Service details */}
 {service && (
 <div className="rounded-lg border border-border p-3 space-y-2">
 <div className="text-xs font-bold text-muted-foreground">حالة الخدمة</div>
 <div className="text-sm">{service.message}</div>
 {service.details && Object.keys(service.details).length > 0 && (
 <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto" dir="ltr">
 {JSON.stringify(service.details, null, 2)}
 </pre>
 )}
 </div>
 )}

 {/* Action buttons */}
 {entry.controlKey && (
 <div className="grid grid-cols-3 gap-2">
 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-profit text-profit hover:bg-profit"
 disabled={actionLoading || isRunning}
 onClick={() => onAction('start')}
 >
 <Play className="w-3 h-3" /> تشغيل
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-loss text-loss hover:bg-loss"
 disabled={actionLoading || !isRunning}
 onClick={() => onAction('stop')}
 >
 <Square className="w-3 h-3" /> إيقاف
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-warning text-warning hover:bg-warning"
 disabled={actionLoading}
 onClick={() => onAction('restart')}
 >
 <RotateCcw className="w-3 h-3" /> إعادة تشغيل
 </Button>
 </div>
 )}

 {/* Logs */}
 <div className="space-y-2">
 <div className="text-xs font-bold text-muted-foreground flex items-center gap-2">
 <FileText className="w-3 h-3" /> السجلات الكاملة
 </div>
 {logs.length === 0 || logs.every(f => !f.exists) ? (
 <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded-md">
 لا توجد ملفات سجلات موجودة لهذا المحرك.
 </div>
 ) : (
 logs.map((f, i) => (
 <div key={i} className="space-y-1">
 <div className="flex items-center justify-between text-xs">
 <code className="text-muted-foreground" dir="ltr">{f.path}</code>
 <span className="text-muted-foreground">
 {f.exists ? (f.mtime ? timeAgoBrief(f.mtime) : 'موجود') : 'غير موجود'}
 </span>
 </div>
 {f.exists && f.lines.length > 0 && (
 <div className="rounded-md bg-slate-950 text-slate-200 p-2 font-mono text-xs leading-relaxed max-h-48 overflow-y-auto" dir="ltr">
 {f.lines.map((line, j) => (
 <div
 key={j}
 className={cn(
 looksLikeError(line) ? 'text-loss' : 'text-slate-300',
 'whitespace-pre-wrap break-all',
 )}
 >
 {line || ' '}
 </div>
 ))}
 </div>
 )}
 </div>
 ))
 )}
 </div>
 </div>
 </SheetContent>
 </Sheet>
 );
}

// ============================================================================
// Per-Engine Deep View sub-components
// ============================================================================

/** Data Engine — scraper-by-scraper status. */
function DataEngineDeepView({ logs }: { logs: EngineLogsResponse | null }) {
 const scrapers = useMemo(() => {
 const fileMap: Record<string, { label: string; path: string }> = {
 'tradingview.log': { label: 'TradingView (EGX)', path: '/tmp/tradingview.log' },
 'us_scraper.log': { label: 'US Stocks (Yahoo)', path: '/tmp/us_scraper.log' },
 'multi_scraper.log': { label: 'Multi-Market', path: '/tmp/multi_scraper.log' },
 'price_updater_morning.log': { label: 'تحديث الأسعار (صباحاً)', path: '/tmp/price_updater_morning.log' },
 'price_updater_evening.log': { label: 'تحديث الأسعار (مساءً)', path: '/tmp/price_updater_evening.log' },
 'price_safetynet.log': { label: 'Safety Net (Yahoo)', path: '/tmp/price_safetynet.log' },
 'regime_engine.log': { label: 'حالة السوق', path: '/tmp/regime_engine.log' },
 };
 const files = logs?.engines?.data_engine?.files || [];
 return Object.entries(fileMap).map(([fname, meta]) => {
 const found = files.find(f => f.path === meta.path) || null;
 return {
 ...meta,
 fname,
 exists: found?.exists ?? false,
 mtime: found?.mtime ?? null,
 lines: found?.lines ?? [],
 };
 });
 }, [logs]);

 return (
 <div className="space-y-3">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {scrapers.map((s) => {
 const running = s.exists && s.mtime
 ? Date.now() - new Date(s.mtime).getTime() < 60 * 60 * 1000
 : false;
 const tone = running
 ? statusTone('running')
 : s.exists
 ? statusTone('slow')
 : statusTone('stopped');
 const errCount = s.lines.filter(looksLikeError).length;
 return (
 <Card key={s.fname} className={cn('border', tone.bg)}>
 <CardContent className="p-3 space-y-2">
 <div className="flex items-center justify-between gap-2">
 <div className="font-bold text-sm">{s.label}</div>
 <Badge variant="outline" className={cn('text-xs', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 </div>
 <div className="grid grid-cols-2 gap-2 text-xs">
 <div>
 <span className="text-muted-foreground">آخر تشغيل: </span>
 <span className="font-bold">{s.mtime ? timeAgoBrief(s.mtime) : 'لم يُشغّل'}</span>
 </div>
 <div>
 <span className="text-muted-foreground">آخر سطر: </span>
 <code className="block truncate" dir="ltr">{s.lines[s.lines.length - 1] || '—'}</code>
 </div>
 </div>
 {errCount > 0 && (
 <div className="flex items-center gap-1 text-xs text-loss">
 <AlertTriangle className="w-3 h-3" /> {errCount} خطأ في آخر 50 سطر
 </div>
 )}
 </CardContent>
 </Card>
 );
 })}
 </div>
 </div>
 );
}

/** News Engine — source-by-source health. */
function NewsEngineDeepView({ news }: { news: NewsHealthResponse | null }) {
 if (!news?.success || !news.sources) {
 return (
 <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
 {news?.error || 'فشل تحميل بيانات مصادر الأخبار.'}
 </div>
 );
 }
 return (
 <div className="space-y-3">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">المصادر</div>
 <div className="font-bold">{news.total_sources ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">المقالات</div>
 <div className="font-bold">{news.total_articles ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">المعطّلة</div>
 <div className="font-bold text-loss">{news.broken_sources_count ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">السليمة</div>
 <div className="font-bold text-profit">
 {(news.sources || []).filter(s => !s.is_broken).length}
 </div>
 </div>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
 {news.sources.map((src) => {
 const tone = src.is_broken
 ? statusTone('stopped')
 : statusTone(src.success_rate_label === 'healthy' ? 'running' : src.success_rate_label === 'degraded' ? 'slow' : 'stopped');
 return (
 <Card key={src.source} className={cn('border', tone.bg)}>
 <CardContent className="p-3 space-y-1">
 <div className="flex items-center justify-between gap-2">
 <div className="font-bold text-xs truncate" dir="ltr">{src.source}</div>
 <Badge variant="outline" className={cn('text-xs', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {src.source_type}
 </Badge>
 </div>
 <div className="text-xs text-muted-foreground">
 {src.article_count} مقال · آخر fetch: {src.last_fetch_human || 'أبداً'}
 </div>
 {src.broken_reason && (
 <div className="text-xs text-loss">{src.broken_reason}</div>
 )}
 </CardContent>
 </Card>
 );
 })}
 </div>
 </div>
 );
}

/** Predictions Engine — by-model performance. */
function PredictionsEngineDeepView({ logs }: { logs: EngineLogsResponse | null }) {
 const files = logs?.engines?.predictions?.files || [];
 // PHASE2-ADMIN-PANEL: owner request — "زر إعادة توليد التوقعات لسوق معين
 // عند الطلب". Since /api/admin/generate-predictions is 410 Gone and
 // /api/daily/rebuild does NOT exist in this codebase, we cannot trigger
 // Python regeneration from the UI. Instead, the button shows a clear
 // message that predictions are auto-generated via cron (daily_predictor.py).
 // Rule 27: no fabricated endpoint call.
 const [market, setMarket] = useState<string>('EGX');
 const [regenLoading, setRegenLoading] = useState(false);

 const handleRegenerate = useCallback(() => {
 setRegenLoading(true);
 // No live endpoint to call — just inform the admin clearly.
 setTimeout(() => {
 setRegenLoading(false);
 toast.info(
 `التوقعات لسوق ${market} تُولّد تلقائيًا عبر cron (daily_predictor.py)`,
 {
 description:
 'مسار /api/admin/generate-predictions معطّل (410 Gone). ' +
 'مسار /api/daily/rebuild غير موجود. ' +
 'يتم التوليد آليًا في 05:00 و15:30 بتوقيت القاهرة.',
 duration: 6000,
 },
 );
 }, 400);
 }, [market]);

 return (
 <div className="space-y-3">
 <div className="rounded-md border border-warning bg-warning/20 p-3 text-xs">
 <AlertTriangle className="w-4 h-4 inline ml-1 text-warning" />
 الأداء لكل نموذج (technical / fundamental / master_score) بيتحسب من predictions.db.
 هنا بنعرض السجلات الحية لمحرك V40.2 + آخر تشغيل لكل job.
 </div>

 {/* PHASE2-ADMIN-PANEL: regenerate predictions for a specific market */}
 <Card className="border-profit/20">
 <CardContent className="p-3">
 <div className="flex flex-wrap items-center gap-2">
 <Brain className="w-4 h-4 text-profit" />
 <span className="text-xs font-semibold">إعادة توليد التوقعات لسوق معين</span>
 <select
 value={market}
 onChange={(e) => setMarket(e.target.value)}
 className="h-8 rounded-md border border-input bg-background px-2 text-xs"
 >
 <option value="EGX">🇪🇬 EGX (مصر)</option>
 <option value="TADAWUL">🇸🇦 TADAWUL (السعودية)</option>
 <option value="KSE">🇰🇼 KSE (الكويت)</option>
 <option value="QSE">🇶🇦 QSE (قطر)</option>
 <option value="US">🇺🇸 US (أمريكا)</option>
 <option value="CRYPTO">₿ CRYPTO (عملات رقمية)</option>
 </select>
 <Button
 size="sm"
 onClick={handleRegenerate}
 disabled={regenLoading}
 className="gap-1.5 h-8 bg-profit hover:bg-profit text-white text-xs"
 >
 {regenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
 إعادة التوليد
 </Button>
 <span className="text-xs text-muted-foreground ml-auto">
 ⚙️ تلقائي عبر cron — لا يدعم التشغيل اليدوي
 </span>
 </div>
 </CardContent>
 </Card>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
 {files.map((f) => {
 const running = f.exists && f.mtime
 ? Date.now() - new Date(f.mtime).getTime() < 60 * 60 * 1000
 : false;
 const tone = running
 ? statusTone('running')
 : f.exists
 ? statusTone('slow')
 : statusTone('stopped');
 const errCount = f.lines.filter(looksLikeError).length;
 return (
 <Card key={f.path} className={cn('border', tone.bg)}>
 <CardContent className="p-3 space-y-2">
 <div className="flex items-center justify-between gap-2">
 <code className="text-xs truncate" dir="ltr">{f.path}</code>
 <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
 <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
 {tone.label}
 </Badge>
 </div>
 <div className="text-xs text-muted-foreground">
 آخر تشغيل: {f.mtime ? timeAgoBrief(f.mtime) : 'لم يُشغّل'}
 </div>
 {errCount > 0 && (
 <div className="text-xs text-loss">{errCount} خطأ</div>
 )}
 {f.exists && f.lines.length > 0 && (
 <div className="rounded bg-slate-950 text-slate-200 p-1.5 font-mono text-xs max-h-24 overflow-y-auto" dir="ltr">
 {f.lines.slice(-5).map((l, i) => (
 <div key={i} className={cn('whitespace-pre-wrap break-all truncate', looksLikeError(l) ? 'text-loss' : 'text-slate-300')}>
 {l || ' '}
 </div>
 ))}
 </div>
 )}
 </CardContent>
 </Card>
 );
 })}
 </div>
 </div>
 );
}

/** Sharia Engine — 8 sources + alias review queue. */
function ShariaEngineDeepView({ sharia }: { sharia: ShariaApiResponse | null }) {
 if (!sharia?.success) {
 return (
 <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
 {sharia?.error || 'فشل تحميل بيانات الفحص الشرعي.'}
 </div>
 );
 }
 const sources = sharia.sources || [];
 const reviewQueue = sharia.alias_map?.review_queue || [];
 return (
 <div className="space-y-3">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">إجمالي الأسهم</div>
 <div className="font-bold">{sharia.stats?.total ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">إجماع</div>
 <div className="font-bold text-profit">{sharia.stats?.consensus_count ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">مع نسبة S&P</div>
 <div className="font-bold">{sharia.stats?.with_sp_rate ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-xs text-muted-foreground">مراجعة مطلوبة</div>
 <div className="font-bold text-warning">{reviewQueue.length}</div>
 </div>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
 {sources.map((s) => (
 <Card key={s.source_key}>
 <CardContent className="p-3 flex items-center justify-between gap-2">
 <div>
 <div className="font-bold text-xs">{s.name_ar}</div>
 <div className="text-xs text-muted-foreground">
 {s.methodology || '—'}
 </div>
 </div>
 <Badge variant="outline" className={cn('text-xs', s.is_active ? 'border-profit text-profit' : 'border-slate-400 text-slate-500')}>
 {s.is_active ? 'نشط' : 'موقوف'}
 </Badge>
 </CardContent>
 </Card>
 ))}
 </div>
 {reviewQueue.length > 0 && (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <AlertTriangle className="w-4 h-4 text-warning" />
 طابور المراجعة ({reviewQueue.length})
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="max-h-64 overflow-y-auto space-y-1">
 {reviewQueue.slice(0, 30).map((row, i) => (
 <div key={i} className="text-xs grid grid-cols-4 gap-2 border-b border-border pb-1">
 <code dir="ltr">{row.source_symbol}</code>
 <code dir="ltr" className="text-profit">{row.resolved_ticker}</code>
 <span className="text-muted-foreground">{row.confidence || '—'}</span>
 <span className="text-muted-foreground truncate">{row.source_name_ar || '—'}</span>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 );
}

/** Cron Jobs — 25 jobs from crontab.txt. */
function CronDeepView({ cron }: { cron: CronHealthResponse | null }) {
 if (!cron?.success || !cron.jobs) {
 return (
 <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
 {cron?.error || 'فشل تحميل بيانات الكرون.'}
 </div>
 );
 }
 return (
 <div className="space-y-3">
 <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
 <div className="rounded-md border p-2">
 <div className="text-muted-foreground">إجمالي</div>
 <div className="font-bold text-base">{cron.summary?.total_jobs ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-muted-foreground">شُغّلت</div>
 <div className="font-bold text-base text-profit">{cron.summary?.jobs_ran ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-muted-foreground">لم تُشغّل</div>
 <div className="font-bold text-base text-loss">{cron.summary?.jobs_never_run ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-muted-foreground">اليوم</div>
 <div className="font-bold text-base text-profit">{cron.summary?.jobs_run_today ?? 0}</div>
 </div>
 <div className="rounded-md border p-2">
 <div className="text-muted-foreground">قديمة</div>
 <div className="font-bold text-base text-warning">{cron.summary?.jobs_stale_7d ?? 0}</div>
 </div>
 </div>
 <div className="max-h-96 overflow-y-auto space-y-1">
 {cron.jobs.map((job) => {
 let tone;
 if (!job.exists_log || !job.last_run) {
 tone = statusTone('stopped');
 } else {
 const ageMs = Date.now() - new Date(job.last_run).getTime();
 if (ageMs < 24 * 60 * 60 * 1000) tone = statusTone('running');
 else if (ageMs < 7 * 24 * 60 * 60 * 1000) tone = statusTone('slow');
 else tone = statusTone('stopped');
 }
 return (
 <div key={job.id} className={cn('p-2 rounded-md border text-xs', tone.bg)}>
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-1">
 <Badge variant="outline" className="text-xs" dir="ltr">#{job.id}</Badge>
 <Badge variant="outline" className="text-xs" dir="ltr">{job.schedule}</Badge>
 <Badge variant="outline" className="text-xs">{job.category}</Badge>
 </div>
 <Badge variant="outline" className={cn('text-xs', tone.badge)}>
 {job.last_run_human || 'لم يُشغّل'}
 </Badge>
 </div>
 <div className="mt-1">{job.description}</div>
 <code className="text-xs text-muted-foreground block mt-0.5 truncate" dir="ltr">{job.command}</code>
 </div>
 );
 })}
 </div>
 </div>
 );
}

/** Console — aggregated errors from all /tmp/*.log files. */
function ConsoleDeepView({ logs, engineFilter, setEngineFilter, search, setSearch }: {
 logs: EngineLogsResponse | null;
 engineFilter: string;
 setEngineFilter: (s: string) => void;
 search: string;
 setSearch: (s: string) => void;
}) {
 const allErrors = useMemo(() => {
 if (!logs?.engines) return [];
 const collected: Array<{ engine: string; path: string; line: string; mtime: string | null }> = [];
 for (const [engKey, eng] of Object.entries(logs.engines)) {
 for (const f of eng.files) {
 if (!f.exists) continue;
 for (const line of f.lines) {
 if (looksLikeError(line)) {
 collected.push({ engine: engKey, path: f.path, line, mtime: f.mtime });
 }
 }
 }
 }
 return collected.reverse().slice(0, 100);
 }, [logs]);

 const filtered = allErrors.filter(e => {
 if (engineFilter !== 'all' && e.engine !== engineFilter) return false;
 if (search && !e.line.toLowerCase().includes(search.toLowerCase())) return false;
 return true;
 });

 return (
 <div className="space-y-3">
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex items-center gap-1">
 <Filter className="w-3 h-3 text-muted-foreground" />
 <select
 value={engineFilter}
 onChange={(e) => setEngineFilter(e.target.value)}
 className="text-xs border rounded px-1 py-0.5 bg-background"
 >
 <option value="all">كل المحركات</option>
 <option value="data_engine">محرك البيانات</option>
 <option value="news">محرك الأخبار</option>
 <option value="predictions">محرك التوقعات</option>
 <option value="learning">محرك التعلّم</option>
 <option value="sharia">الفحص الشرعي</option>
 <option value="cron">المهام المجدولة</option>
 </select>
 </div>
 <div className="flex items-center gap-1 flex-1 min-w-[150px]">
 <Search className="w-3 h-3 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="بحث في السجلات..."
 className="h-7 text-xs"
 />
 </div>
 <Badge variant="outline" className="text-xs">
 {filtered.length} خطأ
 </Badge>
 </div>
 <div className="rounded-md bg-slate-950 text-slate-200 p-3 font-mono text-xs leading-relaxed max-h-[28rem] overflow-y-auto" dir="ltr">
 {filtered.length === 0 ? (
 <div className="text-slate-500 text-center py-8">لا توجد أخطاء 🎉</div>
 ) : (
 filtered.map((err, i) => {
 const sev = severityOf(err.line);
 const color = sev === 'error' ? 'text-loss' : sev === 'warning' ? 'text-warning' : 'text-slate-300';
 return (
 <div key={i} className={cn('whitespace-pre-wrap break-all border-b border-slate-800 pb-1 mb-1', color)}>
 <span className="text-slate-500">[{err.engine}]</span>{' '}
 <span className="text-slate-500">{err.path.split('/').pop()}:</span>{' '}
 {err.line}
 </div>
 );
 })
 )}
 </div>
 </div>
 );
}

// ============================================================================
// Main component
// ============================================================================

type DeepView = 'data-engine' | 'news' | 'predictions' | 'sharia' | 'cron' | 'console';

const DEEP_VIEWS: Array<{ id: DeepView; label: string; icon: React.ReactNode }> = [
 { id: 'data-engine', label: 'محرك البيانات', icon: <Database className="w-3.5 h-3.5" /> },
 { id: 'news', label: 'محرك الأخبار', icon: <Newspaper className="w-3.5 h-3.5" /> },
 { id: 'predictions', label: 'محرك التوقعات', icon: <Brain className="w-3.5 h-3.5" /> },
 { id: 'sharia', label: 'الفحص الشرعي', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
 { id: 'cron', label: 'المهام المجدولة', icon: <Clock className="w-3.5 h-3.5" /> },
 { id: 'console', label: 'الكونسول', icon: <Terminal className="w-3.5 h-3.5" /> },
];

const STATUS_REFRESH_MS = 30_000;
const LOGS_REFRESH_MS = 15_000;

export function EngineControlRoomTab() {
 // ----- Top grid data -----
 const [systemHealth, setSystemHealth] = useState<SystemHealthResponse | null>(null);
 const [controlList, setControlList] = useState<EngineControlListResponse | null>(null);
 const [logs, setLogs] = useState<EngineLogsResponse | null>(null);
 const [cronHealth, setCronHealth] = useState<CronHealthResponse | null>(null);
 const [newsHealth, setNewsHealth] = useState<NewsHealthResponse | null>(null);
 const [sharia, setSharia] = useState<ShariaApiResponse | null>(null);

 const [loadingStatus, setLoadingStatus] = useState(true);
 const [loadingLogs, setLoadingLogs] = useState(true);
 const [actionLoading, setActionLoading] = useState<string | null>(null);
 const [actionEngine, setActionEngine] = useState<string | null>(null);

 // ----- Selected engine for detail sheet -----
 const [selectedEngine, setSelectedEngine] = useState<EngineKey | null>(null);

 // ----- Task 33 Phase 5: Live Log Console state -----
 // When non-null, the Live Log Console Sheet is open for this engine.
 const [liveConsoleEngine, setLiveConsoleEngine] = useState<EngineKey | null>(null);

 // ----- Deep view selection -----
 const [deepView, setDeepView] = useState<DeepView>('data-engine');
 const [consoleEngineFilter, setConsoleEngineFilter] = useState('all');
 const [consoleSearch, setConsoleSearch] = useState('');

 // ----- Batch action loading -----
 const [batchLoading, setBatchLoading] = useState<'start' | 'stop' | 'check' | null>(null);

 // ----- Fetchers -----
 const fetchStatus = useCallback(async () => {
 setLoadingStatus(true);
 try {
 const [shRes, ctrlRes] = await Promise.all([
 fetch('/api/admin/system-health', { credentials: 'same-origin', cache: 'no-store' }),
 fetch('/api/admin/engines/control', { credentials: 'same-origin', cache: 'no-store' }),
 ]);
 const [shJson, ctrlJson] = await Promise.all([shRes.json(), ctrlRes.json()]);
 setSystemHealth(shJson);
 setControlList(ctrlJson);
 } catch (err) {
 console.error('[EngineControlRoomTab] fetchStatus', err);
 } finally {
 setLoadingStatus(false);
 }
 }, []);

 const fetchLogs = useCallback(async () => {
 setLoadingLogs(true);
 try {
 const res = await fetch('/api/admin/engines/logs?limit=50', { credentials: 'same-origin', cache: 'no-store' });
 const json = await res.json();
 setLogs(json);
 } catch (err) {
 console.error('[EngineControlRoomTab] fetchLogs', err);
 } finally {
 setLoadingLogs(false);
 }
 }, []);

 const fetchCron = useCallback(async () => {
 try {
 const res = await fetch('/api/admin/cron-health', { credentials: 'same-origin', cache: 'no-store' });
 const json = await res.json();
 setCronHealth(json);
 } catch (err) {
 console.error('[EngineControlRoomTab] fetchCron', err);
 }
 }, []);

 const fetchNews = useCallback(async () => {
 try {
 const res = await fetch('/api/admin/news-health', { credentials: 'same-origin', cache: 'no-store' });
 const json = await res.json();
 setNewsHealth(json);
 } catch (err) {
 console.error('[EngineControlRoomTab] fetchNews', err);
 }
 }, []);

 const fetchSharia = useCallback(async () => {
 try {
 const res = await fetch('/api/sharia?limit=1', { cache: 'no-store' });
 const json = await res.json();
 setSharia(json);
 } catch (err) {
 console.error('[EngineControlRoomTab] fetchSharia', err);
 }
 }, []);

 useEffect(() => {
 fetchStatus();
 fetchLogs();
 fetchCron();
 fetchNews();
 fetchSharia();
 const statusInterval = setInterval(fetchStatus, STATUS_REFRESH_MS);
 const logsInterval = setInterval(fetchLogs, LOGS_REFRESH_MS);
 return () => {
 clearInterval(statusInterval);
 clearInterval(logsInterval);
 };
 }, [fetchStatus, fetchLogs, fetchCron, fetchNews, fetchSharia]);

 // ----- Engine control action -----
 // Task 33 Phase 5: when action === 'start' (daemon) or 'start' (cron manual
 // run), open the Live Log Console immediately after the POST returns.
 const handleAction = useCallback(async (engineKey: EngineKey, action: 'start' | 'stop' | 'restart') => {
 const entry = ENGINE_CATALOG.find(e => e.key === engineKey);
 if (!entry?.controlKey) {
 toast.error('هذا المحرك لا يدعم التحكم المباشر من اللوحة');
 return;
 }
 setActionLoading(action);
 setActionEngine(engineKey);
 try {
 const res = await fetch('/api/admin/engines/control', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({ engine: entry.controlKey, action }),
 });
 const json: EngineControlResponse = await res.json();
 if (json.success) {
 toast.success(json.message || `${action} OK`);
 // Task 33 Phase 5: open Live Log Console on 'start' (daemon) or
 // 'start' (cron manual trigger) so the user sees live progress.
 if (action === 'start') {
 setLiveConsoleEngine(engineKey);
 }
 // Refresh status after action
 setTimeout(() => {
 fetchStatus();
 fetchLogs();
 }, 1000);
 } else {
 toast.error(json.error || json.message || `فشل: ${action}`);
 // Even on failure, open the Live Log Console so the user can see
 // what went wrong (e.g. venv_missing shows up in the response body).
 if (action === 'start') {
 setLiveConsoleEngine(engineKey);
 }
 }
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
 } finally {
 setActionLoading(null);
 setActionEngine(null);
 }
 }, [fetchStatus, fetchLogs]);

 // ----- Batch actions -----
 const handleStartAll = useCallback(async () => {
 setBatchLoading('start');
 try {
 const res = await fetch('/api/admin/engines/start-all', {
 method: 'POST',
 credentials: 'same-origin',
 });
 const json = await res.json();
 if (json.success) {
 toast.success(`تم تشغيل ${json.summary?.success}/${json.summary?.total} محرك`);
 } else {
 toast.error(`نجح ${json.summary?.success}/${json.summary?.total} — راجع السجلات`);
 }
 setTimeout(() => {
 fetchStatus();
 fetchLogs();
 }, 1500);
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
 } finally {
 setBatchLoading(null);
 }
 }, [fetchStatus, fetchLogs]);

 const handleStopAll = useCallback(async () => {
 setBatchLoading('stop');
 try {
 const res = await fetch('/api/admin/engines/stop-all', {
 method: 'POST',
 credentials: 'same-origin',
 });
 const json = await res.json();
 if (json.success) {
 toast.success(`تم إيقاف ${json.summary?.success}/${json.summary?.total} محرك`);
 } else {
 toast.error(`نجح ${json.summary?.success}/${json.summary?.total} — راجع السجلات`);
 }
 setTimeout(() => {
 fetchStatus();
 fetchLogs();
 }, 1500);
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
 } finally {
 setBatchLoading(null);
 }
 }, [fetchStatus, fetchLogs]);

 const handleFullCheck = useCallback(async () => {
 setBatchLoading('check');
 try {
 await Promise.all([fetchStatus(), fetchLogs(), fetchCron(), fetchNews(), fetchSharia()]);
 toast.success('اكتمل الفحص الشامل');
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'خطأ في الفحص');
 } finally {
 setBatchLoading(null);
 }
 }, [fetchStatus, fetchLogs, fetchCron, fetchNews, fetchSharia]);

 const handleExport = useCallback(() => {
 const payload = {
 exported_at: new Date().toISOString(),
 system_health: systemHealth,
 control_list: controlList,
 logs,
 cron_health: cronHealth,
 news_health: newsHealth,
 sharia,
 };
 downloadJson(`engine-control-room-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, payload);
 toast.success('تم تصدير التقرير');
 }, [systemHealth, controlList, logs, cronHealth, newsHealth, sharia]);

 // ----- Lookup helpers -----
 const serviceFor = useCallback((key: EngineKey): SystemService | undefined => {
 const entry = ENGINE_CATALOG.find(e => e.key === key);
 if (!entry?.serviceId) return undefined;
 return systemHealth?.services?.find(s => s.id === entry.serviceId);
 }, [systemHealth]);

 const controlFor = useCallback((key: EngineKey): EngineListEntry | undefined => {
 const entry = ENGINE_CATALOG.find(e => e.key === key);
 if (!entry?.controlKey) return undefined;
 return controlList?.engines?.find(e => e.key === entry.controlKey);
 }, [controlList]);

 const logsFor = useCallback((key: EngineKey): { lines: string[]; mtime: string | null } => {
 const entry = ENGINE_CATALOG.find(e => e.key === key);
 if (!entry?.controlKey) return { lines: [], mtime: null };
 const eng = logs?.engines?.[entry.controlKey];
 if (!eng) return { lines: [], mtime: null };
 const allLines: string[] = [];
 let latestMtime: string | null = null;
 for (const f of eng.files) {
 if (!f.exists) continue;
 allLines.push(...f.lines);
 if (f.mtime && (!latestMtime || new Date(f.mtime) > new Date(latestMtime))) {
 latestMtime = f.mtime;
 }
 }
 return { lines: allLines.slice(-5), mtime: latestMtime };
 }, [logs]);

 const detailLogsFor = useCallback((key: EngineKey): EngineLogResult[] => {
 const entry = ENGINE_CATALOG.find(e => e.key === key);
 if (!entry?.controlKey) return [];
 return logs?.engines?.[entry.controlKey]?.files || [];
 }, [logs]);

 // ----- Task 33 Phase 4: cron-specific lookup -----
 // Builds the CronCardInfo for a cron engine by joining the cron-health
 // data (last_run) with the live pgrep status (running bool).
 const cronInfoFor = useCallback((key: EngineKey): CronCardInfo | undefined => {
 const entry = ENGINE_CATALOG.find(e => e.key === key);
 if (!entry || entry.type !== 'cron' || !entry.cronCommandPattern) return undefined;
 const job = findCronJob(cronHealth, entry.cronCommandPattern);
 // For cron engines, "running" means the one-shot script is currently
 // executing (pgrep matches the pattern). We get this from controlList
 // (the /api/admin/engines/control GET response that pgrep's all engines).
 const ctrl = controlList?.engines?.find(e => e.key === entry.controlKey);
 const running = ctrl?.running ?? false;
 const nextRun = entry.cronSchedule ? nextRunCountdown(entry.cronSchedule.split(/\s+\+\s+/)[0]) : '—';
 return {
 last_run: job?.last_run ?? null,
 last_run_human: job?.last_run_human ?? null,
 next_run_label: nextRun,
 running,
 };
 }, [cronHealth, controlList]);

 // ----- Health summary -----
 const summary = useMemo(() => {
 if (!systemHealth?.services) return null;
 const online = systemHealth.services.filter(s => s.status === 'online').length;
 const total = systemHealth.services.length;
 return { online, total, score: systemHealth.summary?.health_score ?? 0 };
 }, [systemHealth]);

 const selectedEntry = selectedEngine
 ? ENGINE_CATALOG.find(e => e.key === selectedEngine) || null
 : null;

 return (
 <div className="space-y-5" dir="rtl">
 {/* ============================================================ */}
 {/* Header + Quick Actions Bar */}
 {/* ============================================================ */}
 <Card className="border-warning/20">
 <CardHeader className="pb-3">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <CardTitle className="flex items-center gap-2 text-lg">
 <Cpu className="w-5 h-5 text-warning" />
 غرفة تحكم المحركات
 </CardTitle>
 <CardDescription className="mt-1 text-xs">
 كل المحركات + كونسول الأخطاء + تحكم (تشغيل/إيقاف/إعادة) + مراقبة حية.
 </CardDescription>
 </div>
 <div className="flex items-center gap-2 text-xs">
 {summary && (
 <Badge variant="outline" className="text-xs">
 {summary.online}/{summary.total} خدمة شغّالة
 </Badge>
 )}
 {logs?.errors_only && logs.errors_only.length > 0 && (
 <Badge variant="outline" className="text-xs border-loss text-loss">
 <AlertTriangle className="w-3 h-3 ml-1" />
 {logs.errors_only.length} خطأ
 </Badge>
 )}
 </div>
 </div>
 </CardHeader>
 <CardContent>
 {/* Quick Actions Bar */}
 <div className="flex flex-wrap items-center gap-2">
 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-profit text-profit hover:bg-profit"
 disabled={!!batchLoading}
 onClick={handleStartAll}
 >
 {batchLoading === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
 تشغيل كل المحركات
 </Button>

 <AlertDialog>
 <AlertDialogTrigger asChild>
 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-loss text-loss hover:bg-loss"
 disabled={!!batchLoading}
 >
 {batchLoading === 'stop' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
 إيقاف كل المحركات
 </Button>
 </AlertDialogTrigger>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle>تأكيد إيقاف كل المحركات</AlertDialogTitle>
 <AlertDialogDescription>
 هتوقف كل المحركات (البيانات / الأخبار / التوقعات / التعلّم / الفحص الشرعي). متأكد؟
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel>إلغاء</AlertDialogCancel>
 <AlertDialogAction
 onClick={handleStopAll}
 className="bg-loss hover:bg-loss text-white"
 >
 نعم، أوقف الكل
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>

 <Button
 size="sm"
 variant="outline"
 className="gap-1 border-warning text-warning hover:bg-warning"
 disabled={!!batchLoading}
 onClick={handleFullCheck}
 >
 {batchLoading === 'check' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
 فحص شامل
 </Button>

 <Button
 size="sm"
 variant="ghost"
 className="gap-1"
 onClick={handleExport}
 >
 <Download className="w-3 h-3" />
 تصدير التقرير
 </Button>

 <div className="flex-1" />

 <Button
 size="sm"
 variant="ghost"
 className="gap-1"
 onClick={() => { fetchStatus(); fetchLogs(); }}
 disabled={loadingStatus || loadingLogs}
 >
 <RefreshCw className={cn('w-3 h-3', (loadingStatus || loadingLogs) && 'animate-spin')} />
 تحديث
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* ============================================================ */}
 {/* §1A. Live Engine Grid — 24/7 Daemons (4 cards) */}
 {/* Task 33 Phase 4: split from cron jobs. Daemon status is */}
 {/* port-reachability based (online/offline/degraded). */}
 {/* Task 35-C: news_agent moved to Workers section (it's a */}
 {/* Python worker, not a port-bound daemon). */}
 {/* ============================================================ */}
 <div>
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-bold flex items-center gap-2">
 <Server className="w-4 h-4 text-profit" />
 الخدمات الدائمة (24/7 Daemons)
 <Badge variant="outline" className="text-xs ml-1">{DAEMON_ENTRIES.length}</Badge>
 </h3>
 <span className="text-xs text-muted-foreground">
 تحديث كل 30 ثانية · آخر: {logs?.timestamp ? timeAgoBrief(logs.timestamp) : '—'}
 </span>
 </div>

 {loadingStatus && !systemHealth ? (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
 {Array.from({ length: DAEMON_ENTRIES.length }).map((_, i) => (
 <Skeleton key={i} className="h-44 w-full" />
 ))}
 </div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
 {DAEMON_ENTRIES.map((entry) => {
 const { lines, mtime } = logsFor(entry.key);
 return (
 <EngineCard
 key={entry.key}
 entry={entry}
 service={serviceFor(entry.key)}
 controlInfo={controlFor(entry.key)}
 logs={lines}
 logsMtime={mtime}
 onClick={() => setSelectedEngine(entry.key)}
 onAction={(action) => handleAction(entry.key, action)}
 onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
 actionLoading={!!actionLoading && actionEngine === entry.key}
 />
 );
 })}
 </div>
 )}
 </div>

 {/* ============================================================ */}
 {/* §1A2. Live Engine Grid — Background Workers (Task 35-C) */}
 {/* Workers are Python processes that DON'T open ports */}
 {/* (e.g. News Agent). Status: pgrep + recent-log freshness. */}
 {/* ============================================================ */}
 {WORKER_ENTRIES.length > 0 && (
 <div>
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-bold flex items-center gap-2">
 <Activity className="w-4 h-4 text-profit" />
 عمليات الخلفية (Background Workers)
 <Badge variant="outline" className="text-xs ml-1">{WORKER_ENTRIES.length}</Badge>
 </h3>
 <span className="text-xs text-muted-foreground">
 فحص عبر pgrep · آخر فحص: {controlList?.timestamp ? timeAgoBrief(controlList.timestamp) : '—'}
 </span>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
 {WORKER_ENTRIES.map((entry) => {
 const { lines, mtime } = logsFor(entry.key);
 return (
 <EngineCard
 key={entry.key}
 entry={entry}
 service={serviceFor(entry.key)}
 controlInfo={controlFor(entry.key)}
 logs={lines}
 logsMtime={mtime}
 onClick={() => setSelectedEngine(entry.key)}
 onAction={(action) => handleAction(entry.key, action)}
 onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
 actionLoading={!!actionLoading && actionEngine === entry.key}
 />
 );
 })}
 </div>
 </div>
 )}

 {/* ============================================================ */}
 {/* §1B. Live Engine Grid — Scheduled Cron Jobs (3 cards) */}
 {/* Task 33 Phase 4: cron engines ALWAYS show "🟢 مجدول" */}
 {/* (NEVER "🔴 متوقف"). Manual run via "⚡ تشغيل يدوي". */}
 {/* ============================================================ */}
 <div>
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-bold flex items-center gap-2">
 <Clock className="w-4 h-4 text-warning" />
 المحركات المجدولة (Cron Jobs)
 <Badge variant="outline" className="text-xs ml-1">{CRON_ENTRIES.length}</Badge>
 </h3>
 <span className="text-xs text-muted-foreground">
 تُشغّل تلقائياً حسب الجدولة · آخر فحص كرون: {cronHealth?.timestamp ? timeAgoBrief(cronHealth.timestamp) : '—'}
 </span>
 </div>

 {loadingStatus && !systemHealth ? (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {Array.from({ length: 3 }).map((_, i) => (
 <Skeleton key={i} className="h-44 w-full" />
 ))}
 </div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {CRON_ENTRIES.map((entry) => {
 const { lines, mtime } = logsFor(entry.key);
 return (
 <EngineCard
 key={entry.key}
 entry={entry}
 service={serviceFor(entry.key)}
 controlInfo={controlFor(entry.key)}
 cronInfo={cronInfoFor(entry.key)}
 logs={lines}
 logsMtime={mtime}
 onClick={() => setSelectedEngine(entry.key)}
 onAction={(action) => handleAction(entry.key, action)}
 onOpenLiveConsole={() => setLiveConsoleEngine(entry.key)}
 actionLoading={!!actionLoading && actionEngine === entry.key}
 />
 );
 })}
 </div>
 )}
 </div>

 {/* ============================================================ */}
 {/* §2. Per-Engine Deep View (sub-tabs) */}
 {/* ============================================================ */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-sm flex items-center gap-2">
 <Activity className="w-4 h-4 text-warning" />
 التفاصيل لكل محرك
 </CardTitle>
 </CardHeader>
 <CardContent>
 {/* Sub-tab triggers */}
 <div className="flex flex-wrap items-center gap-1 mb-3 p-1 bg-muted/40 rounded-lg">
 {DEEP_VIEWS.map(v => (
 <button
 key={v.id}
 onClick={() => setDeepView(v.id)}
 className={cn(
 'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs transition-colors',
 deepView === v.id
 ? 'bg-background shadow-sm text-profit font-bold'
 : 'text-muted-foreground hover:text-foreground',
 )}
 >
 {v.icon}
 {v.label}
 </button>
 ))}
 </div>

 {/* Sub-tab content */}
 {loadingLogs && !logs ? (
 <Skeleton className="h-64 w-full" />
 ) : (
 <>
 {deepView === 'data-engine' && <DataEngineDeepView logs={logs} />}
 {deepView === 'news' && <NewsEngineDeepView news={newsHealth} />}
 {deepView === 'predictions' && <PredictionsEngineDeepView logs={logs} />}
 {deepView === 'sharia' && <ShariaEngineDeepView sharia={sharia} />}
 {deepView === 'cron' && <CronDeepView cron={cronHealth} />}
 {deepView === 'console' && (
 <ConsoleDeepView
 logs={logs}
 engineFilter={consoleEngineFilter}
 setEngineFilter={setConsoleEngineFilter}
 search={consoleSearch}
 setSearch={setConsoleSearch}
 />
 )}
 </>
 )}
 </CardContent>
 </Card>

 {/* ============================================================ */}
 {/* Detail Sheet (engine card click) */}
 {/* ============================================================ */}
 <DetailSheet
 entry={selectedEntry}
 service={selectedEntry ? serviceFor(selectedEntry.key) : undefined}
 controlInfo={selectedEntry ? controlFor(selectedEntry.key) : undefined}
 logs={selectedEntry ? detailLogsFor(selectedEntry.key) : []}
 onClose={() => setSelectedEngine(null)}
 onAction={(action) => selectedEntry && handleAction(selectedEntry.key, action)}
 actionLoading={!!actionLoading}
 />

 {/* ============================================================ */}
 {/* Task 33 Phase 5: Live Log Console (bottom Sheet) */}
 {/* Opens when user clicks "تشغيل" (daemon) or "تشغيل يدوي" (cron) */}
 {/* ============================================================ */}
 {liveConsoleEngine && (() => {
 const entry = ENGINE_CATALOG.find(e => e.key === liveConsoleEngine);
 if (!entry?.controlKey) return null;
 return (
 <LiveLogConsole
 engineControlKey={entry.controlKey}
 entry={entry}
 actionInProgress={!!actionLoading && actionEngine === liveConsoleEngine}
 onClose={() => setLiveConsoleEngine(null)}
 onRerun={() => handleAction(liveConsoleEngine, 'start')}
 />
 );
 })()}
 </div>
 );
}

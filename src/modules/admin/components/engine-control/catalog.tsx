/**
 * engine-control/catalog.tsx
 * ==========================
 * ENGINE_CATALOG — the static list of 8 engine cards rendered in the grid.
 *
 * Task 33 (ROOT-CAUSE-FIRST — Rule 67): split into 2 types:
 * - daemon: long-running services that must stay up 24/7. Status pill is
 *   based on port reachability (online/offline/degraded). Buttons: start,
 *   stop, restart, view logs.
 * - cron: scheduled jobs that run for 30-60s then exit. Status pill is
 *   always "مجدول" (scheduled) — NEVER "متوقف". Buttons: run-now (manual
 *   trigger), view logs. last_run + next_run countdown come from cron-health.
 * - worker: long-running Python processes that DON'T open a port (e.g. News
 *   Agent). Status via pgrep + recent-log freshness (last 30 min).
 *
 * Pre-computed splits (DAEMON_ENTRIES, CRON_ENTRIES, WORKER_ENTRIES) so the
 * container doesn't filter on every render.
 */
import React from 'react';
import {
  Database, Server, Wifi, Send, Newspaper, Brain, Activity, ShieldCheck, Clock,
  Terminal,
} from 'lucide-react';
import type { EngineCatalogEntry, DeepView } from './types';

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

const DEEP_VIEWS: Array<{ id: DeepView; label: string; icon: React.ReactNode }> = [
  { id: 'data-engine', label: 'محرك البيانات', icon: <Database className="w-3.5 h-3.5" /> },
  { id: 'news', label: 'محرك الأخبار', icon: <Newspaper className="w-3.5 h-3.5" /> },
  { id: 'predictions', label: 'محرك التوقعات', icon: <Brain className="w-3.5 h-3.5" /> },
  { id: 'sharia', label: 'الفحص الشرعي', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  { id: 'cron', label: 'المهام المجدولة', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'console', label: 'الكونسول', icon: <Terminal className="w-3.5 h-3.5" /> },
];

export { ENGINE_CATALOG, DAEMON_ENTRIES, CRON_ENTRIES, WORKER_ENTRIES, DEEP_VIEWS };

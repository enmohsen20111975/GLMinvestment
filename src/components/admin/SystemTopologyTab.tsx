'use client';

/**
 * SystemTopologyTab (v3 — Full 7-Layer Architecture)
 * =================================================
 * مخطط هندسى حى لكامل بنية النظام — 7 طبقات معمارية:
 *
 *   Layer 0: 🌐 مصادر البيانات (TradingView, CoinGecko, Investing, Yahoo, EGX)
 *      ↓ (10 scrapers in data_engine/scrapers/)
 *   Layer 1: Data Engine (port 5000, 24/7 scraper)
 *      ↓ writes
 *   Layer 2: 💗 data_engine.db (THE HEART — 58 MB, 17 tables)
 *      ↓ feeds
 *   Layer 3: Satellite DBs (stocks.db, price_history.db, predictions.db,
 *            analytics.db, telegram_data.db, auth.db, custom.db)
 *      ↓ feeds
 *   Layer 4: Analysis Engine (Maestro) + Prediction Engine
 *      ↓ verified by
 *   Layer 5: GLM Engines + Confluence V3 + Risk Engine + Backtest Engine
 *      ↓ consumed by
 *   Layer 6: API Layer — Python Flask (:8010) + WebSocket (:3005)
 *      ↓
 *   Layer 7: Frontend (Next.js :3000) → Browser
 *
 * النودات ألوانها حسب الحالة:
 *   أخضر = يعمل / يتدفق
 *   أحمر = متوقف / مقطوع / مفقود
 *   كهرمانى = متأخر / معطّل
 *   رمادى = غير معروف
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, AlertTriangle, CheckCircle2, Clock, Database, Loader2,
    RefreshCw, Server, Wifi, WifiOff, XCircle, Zap, Brain, Cpu,
    Network, ArrowRight, ChevronDown, ChevronUp, Info, Boxes,
    CircuitBoard, HardDrive, Radio, Globe, Eye, AlertCircle,
    Target, Layers, Heart, Shield, FlaskConical, GitBranch,
    Gauge, Sparkles, Timer, Waypoints,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getAdminToken } from '@/lib/admin-auth';

// ============== Types ==============

interface EngineLayer {
    id: string;
    name: string;
    name_ar: string;
    file: string;
    status: 'active' | 'missing' | 'error';
    description: string;
}

interface ServiceNode {
    id: string;
    name: string;
    name_ar: string;
    kind: string;
    port?: number;
    url?: string;
    status: 'running' | 'stopped' | 'degraded' | 'unknown' | 'enabled' | 'disabled' | 'error';
    latency_ms: number;
    last_update: string | null;
    minutes_ago: number | null;
    staleness: 'fresh' | 'stale' | 'old' | 'unknown';
    reason: string;
    layers?: EngineLayer[];
    details?: Record<string, any>;
}

interface DatabaseTable {
    name: string;
    rows: number;
    last_write: string | null;
    expected?: boolean;
}

interface DatabaseNode {
    id: string;
    name: string;
    kind: string;
    path: string;
    exists: boolean;
    size_kb: number;
    tables: DatabaseTable[];
    all_tables_count: number;
    status: 'healthy' | 'empty' | 'missing' | 'corrupted' | 'locked' | 'unknown';
    reason: string;
    last_write: string | null;
    last_modified: string | null;
    minutes_ago: number | null;
    is_heart?: boolean;
    expected_empty?: boolean;
}

interface FlowNode {
    id: string;
    from: string;
    to: string;
    label: string;
    label_ar: string;
    status: 'flowing' | 'cut' | 'stale' | 'unknown';
    reason: string;
    last_transfer: string | null;
    minutes_ago: number | null;
}

interface TopologyData {
    success: boolean;
    timestamp: string;
    services: ServiceNode[];
    databases: DatabaseNode[];
    flows: FlowNode[];
    summary: {
        services_up: number;
        services_total: number;
        dbs_healthy: number;
        dbs_total: number;
        flows_active: number;
        flows_total: number;
        health_score: number;
        heart_status?: string;
        heart_exists?: boolean;
        scrapers_count?: number;
        scrapers_present?: number;
    };
}

// ============== Helpers ==============

const STATUS_COLORS = {
    running: { bg: 'bg-emerald-500', text: 'text-emerald-600', border: 'border-emerald-400', glow: 'shadow-emerald-500/30', label: 'يعمل', stroke: '#10b981' },
    enabled: { bg: 'bg-emerald-500', text: 'text-emerald-600', border: 'border-emerald-400', glow: 'shadow-emerald-500/30', label: 'مفعّل', stroke: '#10b981' },
    stopped: { bg: 'bg-red-500', text: 'text-red-600', border: 'border-red-400', glow: 'shadow-red-500/30', label: 'متوقف', stroke: '#ef4444' },
    error: { bg: 'bg-red-500', text: 'text-red-600', border: 'border-red-400', glow: 'shadow-red-500/30', label: 'خطأ', stroke: '#ef4444' },
    disabled: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-400', glow: 'shadow-amber-500/30', label: 'معطّل', stroke: '#f59e0b' },
    degraded: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-400', glow: 'shadow-amber-500/30', label: 'بطيء', stroke: '#f59e0b' },
    unknown: { bg: 'bg-gray-400', text: 'text-gray-500', border: 'border-gray-300', glow: 'shadow-gray-500/20', label: 'غير معروف', stroke: '#9ca3af' },
    healthy: { bg: 'bg-emerald-500', text: 'text-emerald-600', border: 'border-emerald-400', glow: 'shadow-emerald-500/30', label: 'سليمة', stroke: '#10b981' },
    empty: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-400', glow: 'shadow-amber-500/30', label: 'فارغة', stroke: '#f59e0b' },
    missing: { bg: 'bg-red-500', text: 'text-red-600', border: 'border-red-400', glow: 'shadow-red-500/30', label: 'مفقودة', stroke: '#ef4444' },
    corrupted: { bg: 'bg-red-500', text: 'text-red-600', border: 'border-red-400', glow: 'shadow-red-500/30', label: 'تالفة', stroke: '#ef4444' },
    locked: { bg: 'bg-amber-500', text: 'text-amber-600', border: 'border-amber-400', glow: 'shadow-amber-500/30', label: 'مقفولة', stroke: '#f59e0b' },
    flowing: { bg: 'bg-emerald-500', text: 'text-emerald-600', label: 'يتدفق', stroke: '#10b981' },
    cut: { bg: 'bg-red-500', text: 'text-red-600', label: 'مقطوع', stroke: '#ef4444' },
    stale: { bg: 'bg-amber-500', text: 'text-amber-600', label: 'متأخر', stroke: '#f59e0b' },
} as const;

function getStatusColor(status: string) {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.unknown;
}

function formatTimeAgo(minutesAgo: number | null): string {
    if (minutesAgo === null) return 'غير معروف';
    if (minutesAgo < 1) return 'الآن';
    if (minutesAgo < 60) return `منذ ${minutesAgo} دقيقة`;
    const hours = Math.floor(minutesAgo / 60);
    const mins = minutesAgo % 60;
    if (hours < 24) return `منذ ${hours} س${mins > 0 ? ` و${mins} د` : ''}`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
}

// Task TOPO-1: live "X seconds ago" formatter — driven by the 1-second `now`
// ticker so the UI updates in real time between 10s data refreshes.
function formatLiveSeconds(isoTs: string | null, nowMs: number): string {
    if (!isoTs) return 'غير معروف';
    try {
        const t = new Date(isoTs).getTime();
        if (isNaN(t)) return 'غير معروف';
        const secs = Math.max(0, Math.floor((nowMs - t) / 1000));
        if (secs < 5) return 'الآن';
        if (secs < 60) return `منذ ${secs} ثانية`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `منذ ${mins} د و${secs % 60} ث`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `منذ ${hours} س و${mins % 60} د`;
        const days = Math.floor(hours / 24);
        return `منذ ${days} يوم`;
    } catch {
        return 'غير معروف';
    }
}

function formatSize(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

// ============== Service icon mapping ==============

function getServiceIcon(kind: string) {
    switch (kind) {
        case 'frontend': return <Globe className="w-5 h-5" />;
        case 'backend': return <Server className="w-5 h-5" />;
        case 'data-engine': return <CircuitBoard className="w-5 h-5" />;
        case 'ws-service': return <Radio className="w-5 h-5" />;
        case 'prediction-engine': return <Target className="w-5 h-5" />;
        case 'analytics-engine': return <Cpu className="w-5 h-5" />;
        case 'risk-engine': return <Shield className="w-5 h-5" />;
        case 'backtest-engine': return <FlaskConical className="w-5 h-5" />;
        case 'confluence-engine': return <GitBranch className="w-5 h-5" />;
        default: return <Boxes className="w-5 h-5" />;
    }
}

// ============== Node positions ==============
// SVG viewBox: 0 0 1320 1180
// Layout: top-to-bottom flow with data_engine.db as HEART in center

const NODE_POSITIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
    // Layer 0: External sources + 12 scrapers (top, wide)
    'sources': { x: 240, y: 15, w: 840, h: 130 },
    // Layer 1: Data Engine service (port 5000)
    'data-engine': { x: 460, y: 170, w: 400, h: 85 },
    // Layer 2: 💗 THE HEART — data_engine.db (big, center)
    'data-engine-db': { x: 360, y: 280, w: 600, h: 115 },
    // Layer 3: Real DBs (5 across) — removed analytics/telegram/custom/prisma-predictions per Task 2-b
    'stocks-db': { x: 100, y: 425, w: 200, h: 90 },
    'price-history-db': { x: 320, y: 425, w: 200, h: 90 },
    'predictions-db': { x: 540, y: 425, w: 200, h: 90 },
    'auth-db': { x: 760, y: 425, w: 200, h: 90 },
    // Layer 4: Analysis Engine + Prediction Engine (2 wide)
    'analytics-engine': { x: 220, y: 545, w: 420, h: 110 },
    'prediction-engine': { x: 680, y: 545, w: 420, h: 110 },
    // Layer 5: GLM Engines + Confluence V3 + Risk + Backtest (4 boxes)
    'confluence-engine-v3': { x: 380, y: 680, w: 280, h: 110 },
    'risk-engine': { x: 690, y: 680, w: 280, h: 110 },
    'backtest-engine': { x: 1000, y: 680, w: 280, h: 110 },
    // Layer 6: API Layer (Python Backend + WS Service)
    'python-backend': { x: 320, y: 820, w: 340, h: 100 },
    'ws-service': { x: 690, y: 820, w: 320, h: 100 },
    // Layer 7: Frontend
    'frontend': { x: 380, y: 950, w: 560, h: 80 },
    // Layer 8: Browser (bottom center)
    'browser': { x: 460, y: 1055, w: 400, h: 70 },
};

// ============== Layer bands (background groups with right-side labels) ==============
// Task TOPO-1: 8-layer vertical arrangement — each band is a subtle horizontal
// background tint behind its nodes, with a labelled badge on the right side so
// the architecture reads top→bottom (Sources → Data Engine → Heart → DBs →
// Analysis → Engines → API → Frontend).
const LAYER_BANDS: { id: string; name: string; name_en: string; y: number; h: number; tint: string; accent: string }[] = [
    { id: 'L0', name: 'مصادر البيانات',    name_en: 'Data Sources',                y: 5,   h: 150, tint: 'rgba(168,85,247,0.05)',  accent: '#a855f7' },
    { id: 'L1', name: 'محرك البيانات',    name_en: 'Data Engine (port 5000)',     y: 160, h: 105, tint: 'rgba(16,185,129,0.05)',  accent: '#10b981' },
    { id: 'L2', name: '💗 القلب',         name_en: 'data_engine.db — THE HEART',  y: 275, h: 130, tint: 'rgba(244,63,94,0.06)',   accent: '#f43f5e' },
    { id: 'L3', name: 'قواعد البيانات',   name_en: 'Satellite DBs',               y: 415, h: 105, tint: 'rgba(20,184,166,0.05)',  accent: '#14b8a6' },
    { id: 'L4', name: 'تحليل + تنبؤ',     name_en: 'Analysis + Prediction',       y: 530, h: 130, tint: 'rgba(245,158,11,0.05)',  accent: '#f59e0b' },
    { id: 'L5', name: 'محركات الدعم',     name_en: 'GLM + Risk + Backtest + Confluence', y: 670, h: 130, tint: 'rgba(217,70,239,0.05)', accent: '#d946ef' },
    { id: 'L6', name: 'طبقة الـ API',     name_en: 'Python Flask + WebSocket',    y: 810, h: 115, tint: 'rgba(16,185,129,0.04)',  accent: '#059669' },
    { id: 'L7', name: 'الواجهة الأمامية', name_en: 'Frontend + Browser',          y: 930, h: 200, tint: 'rgba(168,85,247,0.04)',  accent: '#9333ea' },
];

// ============== Main Component ==============

// Task TOPO-1: refresh every 10s (was 15s) so the diagram feels "live".
const REFRESH_INTERVAL = 10000;

export function SystemTopologyTab() {
    const [data, setData] = useState<TopologyData | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Task TOPO-1: live `now` ticker — updates every second so the
    // "آخر تحديث: منذ X ثانية" counter increments in real time without
    // waiting for the 10s data refresh.
    const [now, setNow] = useState<number>(() => Date.now());

    // Task TOPO-1: change detection — set of node IDs whose status changed
    // since the previous refresh. They get a brief amber flash overlay.
    const [changedNodes, setChangedNodes] = useState<Set<string>>(new Set());

    // Ref to previous snapshot — used for diffing without triggering re-renders.
    const previousDataRef = React.useRef<TopologyData | null>(null);

    const fetchTopology = useCallback(async () => {
        try {
            const token = await getAdminToken();
            if (!token) return;
            const res = await fetch('/api/admin/system-topology', {
                headers: { 'X-Admin-Token': token },
                cache: 'no-store',
            });
            const json = await res.json();
            if (json.success) {
                // Task TOPO-1: change detection — diff the new snapshot against
                // the previous one and mark any service/DB whose status changed.
                const prev = previousDataRef.current;
                if (prev) {
                    const changed = new Set<string>();
                    prev.services.forEach(s => {
                        const next = (json.services as ServiceNode[]).find(n => n.id === s.id);
                        if (next && next.status !== s.status) changed.add(s.id);
                    });
                    prev.databases.forEach(d => {
                        const next = (json.databases as DatabaseNode[]).find(n => n.id === d.id);
                        if (next && next.status !== d.status) changed.add(d.id);
                    });
                    if (changed.size > 0) {
                        setChangedNodes(prevSet => {
                            const merged = new Set(prevSet);
                            changed.forEach(c => merged.add(c));
                            return merged;
                        });
                        // Auto-clear the flash after ~3.5s.
                        setTimeout(() => {
                            setChangedNodes(prevSet => {
                                const nextSet = new Set(prevSet);
                                changed.forEach(c => nextSet.delete(c));
                                return nextSet;
                            });
                        }, 3500);
                    }
                }
                previousDataRef.current = json as TopologyData;
                setData(json);
                setLastUpdate(new Date());
            } else {
                toast.error(json.error || 'فشل تحميل المخطط');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error('خطأ في الاتصال: ' + msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTopology();
        const interval = setInterval(fetchTopology, REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchTopology]);

    // Task TOPO-1: 1-second "now" ticker — drives the live time-ago displays.
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);

    // Seconds since the last successful refresh — used by the live status bar.
    const secondsSinceUpdate = lastUpdate
        ? Math.max(0, Math.floor((now - lastUpdate.getTime()) / 1000))
        : 0;

    // ============== Derived data ==============

    const servicesById = useMemo(() => {
        const map: Record<string, ServiceNode> = {};
        data?.services.forEach(s => { map[s.id] = s; });
        return map;
    }, [data]);

    const dbsById = useMemo(() => {
        const map: Record<string, DatabaseNode> = {};
        data?.databases.forEach(d => { map[d.id] = d; });
        return map;
    }, [data]);

    // ============== Node renderers ==============

    function renderServiceNode(svc: ServiceNode) {
        const pos = NODE_POSITIONS[svc.id];
        if (!pos) return null;
        const color = getStatusColor(svc.status);
        const isSelected = selectedNode === svc.id;
        const activeLayers = svc.layers?.filter(l => l.status === 'active').length || 0;
        const totalLayers = svc.layers?.length || 0;
        const hasChanged = changedNodes.has(svc.id);

        return (
            <motion.g
                key={svc.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                onClick={() => setSelectedNode(isSelected ? null : svc.id)}
                style={{ cursor: 'pointer' }}
            >
                {/* Task TOPO-1: change-detection flash — amber pulsing border
                    for ~3.5s after a status transition between refreshes. */}
                {hasChanged && (
                    <rect
                        x={pos.x - 10} y={pos.y - 10} width={pos.w + 20} height={pos.h + 20}
                        rx={16} fill="none" stroke="#fbbf24" strokeWidth={3}
                    >
                        <animate attributeName="opacity" values="1;0.25;1;0.25;1;0" dur="1.8s" repeatCount="1" fill="freeze" />
                        <animate attributeName="stroke-width" values="3;5;3" dur="0.9s" repeatCount="2" fill="freeze" />
                    </rect>
                )}
                {(svc.status === 'running' || svc.status === 'enabled') && (
                    <rect
                        x={pos.x - 4} y={pos.y - 4} width={pos.w + 8} height={pos.h + 8}
                        rx={14} fill="none" stroke="currentColor" strokeWidth={1.5}
                        className={cn('opacity-30', color.text)}
                    />
                )}
                {isSelected && (
                    <rect
                        x={pos.x - 6} y={pos.y - 6} width={pos.w + 12} height={pos.h + 12}
                        rx={16} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="6 3"
                    />
                )}
                <rect
                    x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                    rx={12}
                    fill={svc.status === 'running' || svc.status === 'enabled' ? 'rgba(16,185,129,0.08)' :
                        svc.status === 'stopped' || svc.status === 'error' ? 'rgba(239,68,68,0.08)' :
                            svc.status === 'disabled' || svc.status === 'degraded' ? 'rgba(245,158,11,0.08)' :
                                'rgba(107,114,128,0.05)'}
                    stroke="currentColor"
                    strokeWidth={2}
                    className={color.text}
                />
                <circle
                    cx={pos.x + pos.w - 14} cy={pos.y + 14} r={6}
                    className={color.bg}
                >
                    {(svc.status === 'running' || svc.status === 'enabled') && (
                        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                    )}
                </circle>
                {svc.port && (
                    <text
                        x={pos.x + 12} y={pos.y + 22}
                        fontSize={11} fontFamily="monospace"
                        className="fill-muted-foreground"
                    >
                        :{svc.port}
                    </text>
                )}
                <text
                    x={pos.x + 12} y={pos.y + 44}
                    fontSize={15} fontWeight="bold"
                    className="fill-foreground"
                >
                    {svc.name_ar.length > 30 ? svc.name_ar.slice(0, 30) + '…' : svc.name_ar}
                </text>
                <text
                    x={pos.x + 12} y={pos.y + 62}
                    fontSize={11} fontFamily="monospace"
                    className="fill-muted-foreground"
                >
                    {svc.name.length > 38 ? svc.name.slice(0, 38) + '…' : svc.name}
                </text>
                {/* Layers count for engines */}
                {totalLayers > 0 && (
                    <g>
                        <rect
                            x={pos.x + 12} y={pos.y + 72} width={80} height={18} rx={9}
                            fill="rgba(16,185,129,0.1)" stroke="currentColor" strokeWidth={1}
                            className="text-emerald-500"
                        />
                        <text
                            x={pos.x + 52} y={pos.y + 85}
                            fontSize={10} fontFamily="monospace" textAnchor="middle" fontWeight="bold"
                            className="fill-emerald-600 dark:fill-emerald-400"
                        >
                            {activeLayers}/{totalLayers} طبقة
                        </text>
                    </g>
                )}
                <text
                    x={pos.x + 12} y={pos.y + pos.h - 10}
                    fontSize={10} fontFamily="monospace"
                    className="fill-muted-foreground"
                >
                    {svc.latency_ms > 0 ? `${svc.latency_ms}ms · ` : ''}
                    {formatTimeAgo(svc.minutes_ago)}
                </text>
                {/* Status badge */}
                <g>
                    <rect
                        x={pos.x + pos.w - 80} y={pos.y + pos.h - 24} width={68} height={16} rx={8}
                        className={cn('opacity-90', color.bg)}
                    />
                    <text
                        x={pos.x + pos.w - 46} y={pos.y + pos.h - 12}
                        fontSize={10} textAnchor="middle" fontWeight="bold"
                        className="fill-white"
                    >
                        {color.label}
                    </text>
                </g>
            </motion.g>
        );
    }

    function renderDatabaseNode(db: DatabaseNode) {
        const pos = NODE_POSITIONS[db.id];
        if (!pos || pos.w === 0) return null;
        const color = getStatusColor(db.status);
        const isSelected = selectedNode === db.id;
        const totalRows = db.tables.reduce((s, t) => s + (t.rows > 0 ? t.rows : 0), 0);
        const isHeart = db.is_heart;
        const hasChanged = changedNodes.has(db.id);

        return (
            <motion.g
                key={db.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                onClick={() => setSelectedNode(isSelected ? null : db.id)}
                style={{ cursor: 'pointer' }}
            >
                {/* Task TOPO-1: change-detection flash — amber pulsing border. */}
                {hasChanged && (
                    <rect
                        x={pos.x - 10} y={pos.y - 10} width={pos.w + 20} height={pos.h + 20}
                        rx={isHeart ? 20 : 16} fill="none" stroke="#fbbf24" strokeWidth={3}
                    >
                        <animate attributeName="opacity" values="1;0.25;1;0.25;1;0" dur="1.8s" repeatCount="1" fill="freeze" />
                    </rect>
                )}
                {isSelected && (
                    <rect
                        x={pos.x - 6} y={pos.y - 6} width={pos.w + 12} height={pos.h + 12}
                        rx={16} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="6 3"
                    />
                )}
                {/* Heart gets special pulsing glow */}
                {isHeart && db.exists && (
                    <rect
                        x={pos.x - 8} y={pos.y - 8} width={pos.w + 16} height={pos.h + 16}
                        rx={18} fill="none" stroke="currentColor" strokeWidth={2}
                        className={cn('opacity-40', color.text)}
                    >
                        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
                    </rect>
                )}
                <rect
                    x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                    rx={isHeart ? 16 : 12}
                    fill={isHeart
                        ? (db.status === 'healthy' ? 'rgba(244,63,94,0.12)' : 'rgba(239,68,68,0.12)')
                        : db.status === 'healthy' ? 'rgba(59,130,246,0.08)' :
                            db.status === 'empty' || db.status === 'locked' ? 'rgba(245,158,11,0.08)' :
                                db.status === 'missing' || db.status === 'corrupted' ? 'rgba(239,68,68,0.08)' :
                                    'rgba(107,114,128,0.05)'}
                    stroke="currentColor"
                    strokeWidth={isHeart ? 3 : 2}
                    className={isHeart && db.status === 'healthy' ? 'text-rose-500' : color.text}
                />
                {/* Heart icon for the heart DB */}
                {isHeart && (
                    <g>
                        <circle cx={pos.x + 24} cy={pos.y + 24} r={12} fill="rgba(244,63,94,0.15)" className="text-rose-500" stroke="currentColor" strokeWidth={1.5} />
                        <text x={pos.x + 24} y={pos.y + 28} fontSize={14} textAnchor="middle">💗</text>
                    </g>
                )}
                {/* Cylinder shape for non-heart DBs */}
                {!isHeart && (
                    <>
                        <ellipse
                            cx={pos.x + 24} cy={pos.y + 18} rx={14} ry={5}
                            fill="none" stroke="currentColor" strokeWidth={1.5}
                            className={color.text}
                        />
                        <line
                            x1={pos.x + 10} y1={pos.y + 18} x2={pos.x + 10} y2={pos.y + 32}
                            stroke="currentColor" strokeWidth={1.5} className={color.text}
                        />
                        <line
                            x1={pos.x + 38} y1={pos.y + 18} x2={pos.x + 38} y2={pos.y + 32}
                            stroke="currentColor" strokeWidth={1.5} className={color.text}
                        />
                    </>
                )}
                <circle
                    cx={pos.x + pos.w - 14} cy={pos.y + 14} r={6}
                    className={color.bg}
                />
                <text
                    x={pos.x + (isHeart ? 50 : 50)} y={pos.y + (isHeart ? 32 : 30)}
                    fontSize={isHeart ? 16 : 13} fontWeight="bold"
                    className="fill-foreground"
                >
                    {db.name.length > 22 ? db.name.slice(0, 22) + '…' : db.name}
                </text>
                {isHeart && (
                    <text
                        x={pos.x + 50} y={pos.y + 50}
                        fontSize={11} fontWeight="bold"
                        className="fill-rose-500"
                    >
                        💗 قلب النظام — THE HEART
                    </text>
                )}
                <text
                    x={pos.x + 50} y={pos.y + (isHeart ? 70 : 46)}
                    fontSize={11} fontFamily="monospace"
                    className="fill-muted-foreground"
                >
                    {db.exists ? `${formatSize(db.size_kb)} · ${totalRows.toLocaleString()} صف` : 'غير موجود'}
                </text>
                <text
                    x={pos.x + 50} y={pos.y + (isHeart ? 86 : 62)}
                    fontSize={10} fontFamily="monospace"
                    className="fill-muted-foreground"
                >
                    {db.exists ? `${db.all_tables_count} جدول · ${formatTimeAgo(db.minutes_ago)}` : '—'}
                </text>
                {isHeart && (
                    <text
                        x={pos.x + 50} y={pos.y + 104}
                        fontSize={9} fontFamily="monospace"
                        className="fill-muted-foreground"
                    >
                        stocks · crypto · gold · silver · forex · history
                    </text>
                )}
                {/* Status badge for non-heart DBs */}
                {!isHeart && (
                    <g>
                        <rect
                            x={pos.x + pos.w - 64} y={pos.y + pos.h - 22} width={52} height={14} rx={7}
                            className={cn('opacity-90', color.bg)}
                        />
                        <text
                            x={pos.x + pos.w - 38} y={pos.y + pos.h - 12}
                            fontSize={9} textAnchor="middle" fontWeight="bold"
                            className="fill-white"
                        >
                            {color.label}
                        </text>
                    </g>
                )}
            </motion.g>
        );
    }

    // Sources node — Layer 0: 5 external sources + 12 scraper badges + live status
    function renderSourcesNode() {
        const pos = NODE_POSITIONS['sources'];
        const dataEng = servicesById['data-engine'];
        const heart = dbsById['data-engine-db'];
        const scrapers = dataEng?.layers || [];
        const scrapersActive = scrapers.filter(s => s.status === 'active').length;
        const dataEngRunning = dataEng?.status === 'running';
        const heartHealthy = heart?.status === 'healthy';

        // Key table row counts
        const heartTables = heart?.tables || [];
        const getRowCount = (name: string) => heartTables.find(t => t.name === name)?.rows || 0;

        return (
            <motion.g
                key="sources"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                onClick={() => setSelectedNode(selectedNode === 'sources' ? null : 'sources')}
                style={{ cursor: 'pointer' }}
            >
                {selectedNode === 'sources' && (
                    <rect
                        x={pos.x - 6} y={pos.y - 6} width={pos.w + 12} height={pos.h + 12}
                        rx={16} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="6 3"
                    />
                )}
                <rect
                    x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                    rx={12}
                    fill="rgba(168,85,247,0.08)"
                    stroke="currentColor" strokeWidth={2} className="text-purple-500"
                    strokeDasharray="4 3"
                />
                <text x={pos.x + 12} y={pos.y + 22} fontSize={14} fontWeight="bold" className="fill-foreground">
                    🌐 مصادر البيانات (Data Sources)
                </text>
                <text x={pos.x + 12} y={pos.y + 40} fontSize={10} fontFamily="monospace" className="fill-muted-foreground">
                    TradingView · CoinGecko · Investing · Yahoo Finance · EGX Official
                </text>
                {/* Scrapers row — 12 mini badges */}
                <text x={pos.x + 12} y={pos.y + 60} fontSize={10} fontWeight="bold" className="fill-purple-600 dark:fill-purple-400">
                    📥 {scrapersActive}/{scrapers.length || 10} ساحب (scrapers) في data_engine/scrapers/
                </text>
                {scrapers.slice(0, 10).map((s, i) => {
                    const col = i % 5;
                    const row = Math.floor(i / 5);
                    const bx = pos.x + 12 + col * 162;
                    const by = pos.y + 70 + row * 22;
                    const active = s.status === 'active';
                    return (
                        <g key={s.id}>
                            <rect
                                x={bx} y={by} width={155} height={18} rx={9}
                                fill={active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}
                                stroke="currentColor" strokeWidth={1}
                                className={active ? 'text-emerald-500' : 'text-red-500'}
                            />
                            <circle
                                cx={bx + 10} cy={by + 9} r={3.5}
                                className={active ? 'bg-emerald-500' : 'bg-red-500'}
                                fill={active ? '#10b981' : '#ef4444'}
                            />
                            <text
                                x={bx + 20} y={by + 12}
                                fontSize={9} fontFamily="monospace"
                                className="fill-foreground"
                            >
                                {s.name_ar.length > 22 ? s.name_ar.slice(0, 22) + '…' : s.name_ar}
                            </text>
                        </g>
                    );
                })}
                {/* Live status footer */}
                <g>
                    <rect
                        x={pos.x + 12} y={pos.y + pos.h - 18} width={120} height={14} rx={7}
                        className={dataEngRunning ? 'bg-emerald-500' : 'bg-red-500'}
                        fill={dataEngRunning ? '#10b981' : '#ef4444'}
                    />
                    <text
                        x={pos.x + 72} y={pos.y + pos.h - 8}
                        fontSize={9} textAnchor="middle" fontWeight="bold"
                        className="fill-white"
                    >
                        Data Engine: {dataEngRunning ? 'يعمل' : 'متوقف'}
                    </text>
                    <text
                        x={pos.x + 145} y={pos.y + pos.h - 7}
                        fontSize={9} fontFamily="monospace"
                        className="fill-muted-foreground"
                    >
                        💗 {heartHealthy ? 'سليم' : 'مشاكل'} · stocks={getRowCount('stocks').toLocaleString()} · crypto={getRowCount('crypto_prices').toLocaleString()} · gold={getRowCount('gold_prices').toLocaleString()} · history={getRowCount('historical_data').toLocaleString()}
                    </text>
                </g>
            </motion.g>
        );
    }

    // Static "browser" node
    function renderBrowserNode() {
        const pos = NODE_POSITIONS['browser'];
        return (
            <g key="browser">
                <rect
                    x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                    rx={12}
                    fill="rgba(217,70,239,0.08)"
                    stroke="currentColor" strokeWidth={2} className="text-fuchsia-500"
                />
                <text x={pos.x + 12} y={pos.y + 26} fontSize={13} fontWeight="bold" className="fill-foreground">
                    🖥️ متصفح المستخدم
                </text>
                <text x={pos.x + 12} y={pos.y + 46} fontSize={10} fontFamily="monospace" className="fill-muted-foreground">
                    React UI + Zustand + TanStack Query
                </text>
                <text x={pos.x + 12} y={pos.y + 60} fontSize={10} fontFamily="monospace" className="fill-muted-foreground">
                    socket.io-client (ws://?XTransformPort=3005)
                </text>
            </g>
        );
    }

    // ============== Flow (edge) renderer ==============

    function renderFlow(flow: FlowNode, idx: number) {
        const fromPos = NODE_POSITIONS[flow.from];
        const toPos = NODE_POSITIONS[flow.to];
        if (!fromPos || !toPos) return null;

        const fromX = fromPos.x + fromPos.w / 2;
        const fromY = fromPos.y + fromPos.h;
        const toX = toPos.x + toPos.w / 2;
        const toY = toPos.y;

        const isSideBySide = Math.abs(fromPos.y - toPos.y) < 30 && fromPos.x !== toPos.x;
        const isSameRow = Math.abs(fromPos.y - toPos.y) < 30;
        let path: string;

        if (isSameRow && !isSideBySide) {
            // Same position area — straight line
            path = `M ${fromX} ${fromY} L ${toX} ${toY}`;
        } else if (isSideBySide) {
            const fromX2 = fromPos.x + fromPos.w;
            const toX2 = toPos.x;
            const midX = (fromX2 + toX2) / 2;
            path = `M ${fromX2} ${fromPos.y + fromPos.h / 2} C ${midX} ${fromPos.y + fromPos.h / 2}, ${midX} ${toPos.y + toPos.h / 2}, ${toX2} ${toPos.y + toPos.h / 2}`;
        } else {
            const midY = (fromY + toY) / 2;
            path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
        }

        const color = getStatusColor(flow.status);
        const isFlowing = flow.status === 'flowing';
        const isCut = flow.status === 'cut';
        const isStale = flow.status === 'stale';

        // Task TOPO-1: animated particle count & speed by flow status.
        // flowing → 3 fast particles (green), stale → 1 slow particle (amber),
        // cut → no particles (the line is broken — nothing travels).
        const particleCount = isFlowing ? 3 : isStale ? 1 : 0;
        const particleDur = isFlowing ? 2.2 : isStale ? 4.5 : 1;
        // Stagger the particles evenly across [0, dur).
        const particleDelays = Array.from({ length: particleCount }, (_, i) => (i * particleDur) / particleCount);

        return (
            <g key={flow.id}>
                {/* Background dim path (also gets an id so <animateMotion> could
                    reference it via <mpath> if the inline `path` attribute ever
                    falls back). */}
                <path
                    id={`flow-path-${flow.id}`}
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    className={cn('opacity-30', color.text)}
                />
                {/* Animated flowing dashes */}
                {isFlowing && (
                    <path
                        d={path}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        className={color.text}
                        strokeDasharray="8 12"
                    >
                        <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="1.5s" repeatCount="indefinite" />
                    </path>
                )}
                {/* Task TOPO-1: stale line — slower amber dashes so it visually
                    reads as "trickling" rather than "flowing". */}
                {isStale && (
                    <path
                        d={path}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className={color.text}
                        strokeDasharray="4 8"
                        opacity={0.7}
                    >
                        <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="3s" repeatCount="indefinite" />
                    </path>
                )}
                {/* Cut line — solid red with X pattern */}
                {isCut && (
                    <path
                        d={path}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        className={color.text}
                        strokeDasharray="4 4"
                        opacity={0.8}
                    />
                )}
                {/* Task TOPO-1: animated particles travelling along the path.
                    Each particle is a small glowing dot that follows the path
                    via <animateMotion>. Speed & color reflect flow status:
                      flowing = green fast, stale = amber slow, cut = none. */}
                {particleCount > 0 && particleDelays.map((delay, i) => (
                    <g key={`particle-${flow.id}-${i}`}>
                        {/* Soft glow halo behind the particle */}
                        <circle r={5} fill={color.stroke} opacity={0.18}>
                            <animateMotion
                                dur={`${particleDur}s`}
                                begin={`${delay}s`}
                                repeatCount="indefinite"
                                path={path}
                            />
                        </circle>
                        {/* Bright particle core */}
                        <circle r={2.5} fill={color.stroke} opacity={0.95}>
                            <animateMotion
                                dur={`${particleDur}s`}
                                begin={`${delay}s`}
                                repeatCount="indefinite"
                                path={path}
                            />
                        </circle>
                    </g>
                ))}
                <polygon
                    points={isSideBySide
                        ? `${toPos.x},${toPos.y + toPos.h / 2} ${toPos.x - 8},${toPos.y + toPos.h / 2 - 5} ${toPos.x - 8},${toPos.y + toPos.h / 2 + 5}`
                        : `${toX},${toY} ${toX - 5},${toY - 8} ${toX + 5},${toY - 8}`}
                    className={color.bg}
                />
                {(() => {
                    const labelX = (fromX + toX) / 2;
                    const labelY = isSideBySide ? (fromPos.y + toPos.y) / 2 + 25 : (fromY + toY) / 2;
                    return (
                        <g>
                            <rect
                                x={labelX - 52} y={labelY - 10} width={104} height={20} rx={10}
                                fill="white" stroke="currentColor" strokeWidth={1}
                                className={color.text}
                            />
                            <text
                                x={labelX} y={labelY + 4}
                                fontSize={10} textAnchor="middle" fontWeight="bold"
                                className={color.text}
                            >
                                {color.label} · {flow.label_ar.length > 14 ? flow.label_ar.slice(0, 14) + '…' : flow.label_ar}
                            </text>
                        </g>
                    );
                })()}
            </g>
        );
    }

    // ============== Detail panel ==============

    function renderDetailPanel() {
        if (!selectedNode) return null;
        const svc = servicesById[selectedNode];
        const db = dbsById[selectedNode];

        if (selectedNode === 'sources') {
            const dataEng = servicesById['data-engine'];
            const scrapers = dataEng?.layers || [];
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className="border-2 border-purple-400">
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    <Globe className="w-5 h-5 text-purple-500" />
                                    <CardTitle className="text-base">مصادر البيانات</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">External data sources + 10 scrapers</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                <div className="font-medium mb-2">🌐 المصادر الخارجية</div>
                                <ul className="space-y-1 text-muted-foreground">
                                    <li>• <strong>TradingView</strong> — أسعار الأسهم والمؤشرات</li>
                                    <li>• <strong>CoinGecko</strong> — أسعار العملات الرقمية</li>
                                    <li>• <strong>Investing</strong> — المعادن والفوركس والأخبار</li>
                                    <li>• <strong>Yahoo Finance</strong> — البيانات التاريخية (5 سنوات)</li>
                                    <li>• <strong>EGX Official</strong> — شعارات وأخبار البورصة المصرية</li>
                                </ul>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium">📥 الساحبات (Scrapers)</span>
                                    <Badge variant="outline" className="text-[10px]">
                                        {scrapers.filter(s => s.status === 'active').length}/{scrapers.length}
                                    </Badge>
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                                    {scrapers.map(s => (
                                        <div key={s.id} className="p-2 rounded bg-background/50 border border-border/50">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className="font-mono text-[11px] font-medium">{s.name_ar}</span>
                                                <Badge variant={s.status === 'active' ? 'default' : 'destructive'} className="text-[9px] h-4">
                                                    {s.status === 'active' ? 'موجود' : 'مفقود'}
                                                </Badge>
                                            </div>
                                            <div className="font-mono text-[10px] text-muted-foreground truncate">{s.name}</div>
                                            <div className="text-[10px] text-muted-foreground mt-0.5">{s.description}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        if (svc) {
            const color = getStatusColor(svc.status);
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className={cn('border-2', color.border)}>
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {getServiceIcon(svc.kind)}
                                    <CardTitle className="text-base">{svc.name_ar}</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">{svc.name}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحالة</span>
                                <Badge className={cn(color.bg, 'text-white')}>{color.label}</Badge>
                            </div>
                            {svc.port && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">المنفذ</span>
                                    <span className="font-mono">:{svc.port}</span>
                                </div>
                            )}
                            {svc.url && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">URL</span>
                                    <span className="font-mono text-xs truncate max-w-[180px]">{svc.url}</span>
                                </div>
                            )}
                            {svc.latency_ms > 0 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">زمن الاستجابة</span>
                                    <span className="font-mono">{svc.latency_ms}ms</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">آخر تحديث</span>
                                <span className="font-mono text-xs tabular-nums">
                                    {svc.last_update
                                        ? formatLiveSeconds(svc.last_update, now)
                                        : formatTimeAgo(svc.minutes_ago)}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                <div className="flex items-center gap-1 text-amber-600 font-medium mb-1">
                                    <Info className="w-3.5 h-3.5" />
                                    السبب
                                </div>
                                <p className="text-muted-foreground">{svc.reason}</p>
                            </div>
                            {/* Engine layers */}
                            {svc.layers && svc.layers.length > 0 && (
                                <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                    <div className="flex items-center gap-1 font-medium mb-2">
                                        <Layers className="w-3.5 h-3.5 text-emerald-500" />
                                        الطبقات ({svc.layers.filter(l => l.status === 'active').length}/{svc.layers.length})
                                    </div>
                                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                                        {svc.layers.map(layer => (
                                            <div key={layer.id} className="p-2 rounded bg-background/50 border border-border/50">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <span className="font-mono text-[11px] font-medium">{layer.name_ar}</span>
                                                    <Badge variant={layer.status === 'active' ? 'default' : 'destructive'} className="text-[9px] h-4">
                                                        {layer.status === 'active' ? 'موجود' : 'مفقود'}
                                                    </Badge>
                                                </div>
                                                <div className="font-mono text-[10px] text-muted-foreground truncate">{layer.name}</div>
                                                <div className="text-[10px] text-muted-foreground mt-0.5">{layer.description}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {svc.details && Object.keys(svc.details).length > 0 && (
                                <div className="p-3 rounded-lg bg-muted/30 text-xs">
                                    <div className="font-medium mb-1">تفاصيل</div>
                                    <pre className="text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-48">
                                        {JSON.stringify(svc.details, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        if (db) {
            const color = getStatusColor(db.status);
            return (
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-1"
                >
                    <Card className={cn('border-2', color.border, db.is_heart && 'ring-2 ring-rose-400')}>
                        <CardHeader className="pb-2">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {db.is_heart ? <Heart className="w-5 h-5 text-rose-500" /> : <Database className="w-5 h-5" />}
                                    <CardTitle className="text-base">{db.name}</CardTitle>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)} className="h-7 w-7 p-0">
                                    <XCircle className="w-4 h-4" />
                                </Button>
                            </div>
                            <CardDescription className="font-mono text-xs">
                                {db.is_heart ? '💗 قلب النظام (HEART)' : db.kind}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحالة</span>
                                <Badge className={cn(color.bg, 'text-white')}>{color.label}</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">الحجم</span>
                                <span className="font-mono">{db.exists ? formatSize(db.size_kb) : '—'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">عدد الجداول</span>
                                <span className="font-mono">{db.exists ? db.all_tables_count : '—'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">آخر كتابة</span>
                                <span className="font-mono text-xs tabular-nums">
                                    {db.last_write
                                        ? formatLiveSeconds(db.last_write, now)
                                        : formatTimeAgo(db.minutes_ago)}
                                </span>
                            </div>
                            {db.last_modified && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">آخر تعديل للملف</span>
                                    <span className="font-mono text-xs">{new Date(db.last_modified).toLocaleString('ar-EG')}</span>
                                </div>
                            )}
                            <div className="p-3 rounded-lg bg-muted/50 text-xs">
                                <div className="flex items-center gap-1 text-amber-600 font-medium mb-1">
                                    <Info className="w-3.5 h-3.5" />
                                    السبب
                                </div>
                                <p className="text-muted-foreground">{db.reason}</p>
                            </div>
                            <div>
                                <div className="text-xs font-medium mb-2 text-muted-foreground">
                                    الجداول ({db.tables.length}{db.all_tables_count > db.tables.length ? ` من ${db.all_tables_count}` : ''})
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                                    {db.tables.map(t => (
                                        <div key={t.name} className="flex items-center justify-between p-2 rounded bg-muted/30 text-xs">
                                            <span className="font-mono truncate flex items-center gap-1">
                                                {!t.expected && <span className="text-[9px] text-emerald-500" title="جدول إضافى">+</span>}
                                                {t.name}
                                            </span>
                                            <Badge variant={t.rows === -1 ? 'destructive' : t.rows === 0 ? 'outline' : 'secondary'} className="text-[10px]">
                                                {t.rows === -1 ? 'مفقود' : t.rows.toLocaleString()}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            );
        }

        return null;
    }

    // ============== Loading state ==============

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-20" dir="rtl">
                <div className="text-center space-y-3">
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto" />
                    <p className="text-muted-foreground">جارٍ تحميل المخطط الهندسى...</p>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center py-20" dir="rtl">
                <div className="text-center space-y-3">
                    <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
                    <p className="text-muted-foreground">تعذّر تحميل المخطط</p>
                </div>
            </div>
        );
    }

    const { summary } = data;

    // ============== Main render ==============

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className={cn(
                        'w-12 h-12 rounded-xl flex items-center justify-center',
                        summary.health_score >= 80 ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                            summary.health_score >= 50 ? 'bg-amber-100 dark:bg-amber-900/30' :
                                'bg-red-100 dark:bg-red-900/30'
                    )}>
                        <Network className={cn(
                            'w-6 h-6',
                            summary.health_score >= 80 ? 'text-emerald-600' :
                                summary.health_score >= 50 ? 'text-amber-600' :
                                    'text-red-600'
                        )} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">المخطط الهندسى الحى للنظام</h2>
                        <p className="text-xs text-muted-foreground" dir="rtl">
                            {lastUpdate
                                ? <>آخر تحديث: <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">منذ {secondsSinceUpdate} ثانية</span> ({lastUpdate.toLocaleTimeString('ar-EG')}) · يتجدد كل 10 ثوانٍ</>
                                : 'يتجدد كل 10 ثوانٍ'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchTopology} disabled={loading}>
                        <RefreshCw className={cn('w-4 h-4 ml-1', loading && 'animate-spin')} />
                        تحديث الآن
                    </Button>
                </div>
            </div>

            {/* Task TOPO-1: Live status bar — current time, refresh ago,
                health score, flows count, pulsing LIVE indicator.
                Updates every second via the `now` ticker. */}
            <Card className="border-2 border-emerald-300 dark:border-emerald-800 bg-gradient-to-l from-emerald-50/60 via-transparent to-transparent dark:from-emerald-900/15">
                <CardContent className="p-3">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" dir="rtl">
                        {/* Pulsing LIVE indicator */}
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tracking-wide">LIVE</span>
                        </div>

                        {/* Current time */}
                        <div className="flex items-center gap-1.5" title="الوقت الحالى">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="font-mono text-xs tabular-nums">
                                {new Date(now).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        </div>

                        {/* Last refresh ago (live seconds counter) */}
                        <div className="flex items-center gap-1.5" title="آخر تحديث من الخادم">
                            <Timer className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs">
                                آخر تحديث: <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">منذ {secondsSinceUpdate} ثانية</span>
                            </span>
                        </div>

                        {/* Health score with animated progress bar */}
                        <div className="flex items-center gap-2 min-w-[170px]" title="صحة النظام">
                            <Gauge className={cn(
                                'w-4 h-4',
                                summary.health_score >= 80 ? 'text-emerald-600' :
                                    summary.health_score >= 50 ? 'text-amber-600' : 'text-red-600'
                            )} />
                            <div className="flex-1">
                                <div className="flex justify-between text-[10px] mb-0.5">
                                    <span className="text-muted-foreground">صحة</span>
                                    <span className="font-mono font-bold tabular-nums">{summary.health_score}%</span>
                                </div>
                                <Progress
                                    value={summary.health_score}
                                    className={cn(
                                        'h-1.5 transition-all duration-700',
                                        summary.health_score >= 80 ? '[&>div]:bg-emerald-500' :
                                            summary.health_score >= 50 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
                                    )}
                                />
                            </div>
                        </div>

                        {/* Active flows */}
                        <div className="flex items-center gap-1.5" title="التدفقات النشطة">
                            <Waypoints className="w-4 h-4 text-emerald-600" />
                            <span className="font-mono text-xs">
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{summary.flows_active}</span>
                                <span className="text-muted-foreground">/{summary.flows_total} تدفق</span>
                            </span>
                        </div>

                        {/* Services up */}
                        <div className="flex items-center gap-1.5" title="المحركات العاملة">
                            <Server className="w-4 h-4 text-emerald-600" />
                            <span className="font-mono text-xs">
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{summary.services_up}</span>
                                <span className="text-muted-foreground">/{summary.services_total} محرك</span>
                            </span>
                        </div>

                        {/* Changed-since-last-refresh badge */}
                        {changedNodes.size > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
                                <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                    {changedNodes.size} عنصر تغيّر
                                </span>
                            </div>
                        )}

                        {/* Next refresh countdown */}
                        <div className="flex items-center gap-1.5 mr-auto" title="التحديث القادم خلال">
                            <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', loading && 'animate-spin')} />
                            <span className="text-[11px] text-muted-foreground">
                                التحديث القادم خلال <span className="font-mono font-medium tabular-nums">{Math.max(0, Math.ceil((REFRESH_INTERVAL - secondsSinceUpdate * 1000) / 1000))}ث</span>
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Heart status alert */}
            {summary.heart_exists === false && (
                <div className="p-4 rounded-lg border-2 border-red-400 bg-red-50 dark:bg-red-900/20 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold text-red-700 dark:text-red-400">💀 قلب النظام مفقود!</p>
                        <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                            data_engine.db غير موجود — محرك البيانات (port 5000) متوقف أو لم يشتغل قط.
                            هذا هو القلب الذي يغذّي كل النظام. شغّله الآن:
                            <code className="mx-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 font-mono text-xs">cd data_engine && python3 main.py</code>
                        </p>
                    </div>
                </div>
            )}

            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">صحة النظام</p>
                                <p className={cn(
                                    'text-2xl font-bold',
                                    summary.health_score >= 80 ? 'text-emerald-600' :
                                        summary.health_score >= 50 ? 'text-amber-600' :
                                            'text-red-600'
                                )}>{summary.health_score}%</p>
                            </div>
                            <Activity className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <Progress value={summary.health_score} className={cn(
                            'mt-2 h-1.5',
                            summary.health_score >= 80 ? '[&>div]:bg-emerald-500' :
                                summary.health_score >= 50 ? '[&>div]:bg-amber-500' :
                                    '[&>div]:bg-red-500'
                        )} />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">المحركات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.services_up}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.services_total}</span>
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.services_up === summary.services_total ? '✅ كل المحركات تعمل' :
                                `${summary.services_total - summary.services_up} محرك متوقف`}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">قواعد البيانات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.dbs_healthy}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.dbs_total}</span>
                                </p>
                            </div>
                            <Database className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.dbs_healthy === summary.dbs_total ? '✅ كل القواعد سليمة' :
                                `${summary.dbs_total - summary.dbs_healthy} قاعدة بها مشاكل`}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">تدفقات البيانات</p>
                                <p className="text-2xl font-bold">
                                    <span className="text-emerald-600">{summary.flows_active}</span>
                                    <span className="text-muted-foreground text-base"> / {summary.flows_total}</span>
                                </p>
                            </div>
                            <Zap className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            {summary.flows_active === summary.flows_total ? '✅ كل التدفقات نشطة' :
                                `${summary.flows_total - summary.flows_active} تدفق مقطوع/متأخر`}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Architecture layers legend */}
            <Card className="bg-gradient-to-r from-purple-50 to-emerald-50 dark:from-purple-900/20 dark:to-emerald-900/20 border-purple-200 dark:border-purple-900">
                <CardContent className="p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-purple-700 dark:text-purple-300">الطبقات المعمارية:</span>
                        <Badge variant="outline" className="bg-white dark:bg-background">L0 مصادر</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L1 Data Engine</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300">L2 💗 القلب</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L3 DBs</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L4 Analysis+Prediction</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L5 Risk+Backtest+Confluence</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L6 API</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-white dark:bg-background">L7 Frontend</Badge>
                    </div>
                </CardContent>
            </Card>

            {/* Main diagram + detail panel */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <Card className="lg:col-span-3 overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <CircuitBoard className="w-5 h-5 text-emerald-500" />
                            مخطط العمارة المعمارى (7 طبقات)
                        </CardTitle>
                        <CardDescription className="text-xs">
                            اضغط على أي عنصر لعرض التفاصيل · النقاط المتحركة = جسيمات بيانات تتدفق الآن · 💗 = قلب النظام · يتجدد كل 10 ثوانٍ
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="w-full overflow-x-auto">
                            <svg
                                viewBox="0 0 1480 1180"
                                className="w-full h-auto min-w-[1000px]"
                                style={{
                                    backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)',
                                    backgroundSize: '24px 24px',
                                    backgroundColor: 'rgba(0,0,0,0.01)',
                                }}
                            >
                                {/* Task TOPO-1: 8-layer horizontal bands with right-side labels.
                                    Each band is a subtle tint behind its nodes, plus a labelled
                                    badge on the far right so the architecture reads clearly. */}
                                {LAYER_BANDS.map(band => (
                                    <g key={band.id}>
                                        <rect
                                            x={0} y={band.y} width={1480} height={band.h}
                                            fill={band.tint}
                                        />
                                        <line
                                            x1={0} y1={band.y + band.h} x2={1480} y2={band.y + band.h}
                                            stroke="currentColor" strokeWidth={0.5}
                                            className="text-muted-foreground/15"
                                            strokeDasharray="2 4"
                                        />
                                        {/* Right-side label badge */}
                                        <rect
                                            x={1320} y={band.y + 8} width={150} height={26} rx={13}
                                            fill="rgba(255,255,255,0.92)" stroke={band.accent} strokeWidth={1.5}
                                        />
                                        <text
                                            x={1395} y={band.y + 25}
                                            fontSize={12} fontWeight="bold" textAnchor="middle"
                                            fill={band.accent}
                                        >
                                            {band.id} · {band.name}
                                        </text>
                                        <text
                                            x={1395} y={band.y + band.h - 6}
                                            fontSize={9} fontFamily="monospace" textAnchor="middle"
                                            className="fill-muted-foreground"
                                        >
                                            {band.name_en}
                                        </text>
                                    </g>
                                ))}
                                {data.flows.map((f, i) => renderFlow(f, i))}
                                {renderSourcesNode()}
                                {data.services.map(s => renderServiceNode(s))}
                                {data.databases.map(d => renderDatabaseNode(d))}
                                {renderBrowserNode()}
                            </svg>
                        </div>

                        <div className="px-4 py-3 border-t flex flex-wrap items-center gap-4 text-xs bg-muted/30">
                            <span className="font-medium text-muted-foreground">الدليل:</span>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                                <span>يعمل / يتدفق</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-amber-500" />
                                <span>متأخر / معطّل</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                                <span>متوقف / مقطوع / مفقود</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-gray-400" />
                                <span>غير معروف</span>
                            </div>
                            {/* Task TOPO-1: particle legend */}
                            <div className="flex items-center gap-1.5">
                                <span className="flex w-8 h-3 items-center">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span className="w-1 h-px bg-emerald-500/50 mx-0.5" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
                                    <span className="w-1 h-px bg-emerald-500/50 mx-0.5" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/40" />
                                </span>
                                <span>جسيم بيانات تتدفق</span>
                            </div>
                            {/* Task TOPO-1: change-detection legend */}
                            <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded border-2 border-amber-400 animate-pulse" />
                                <span>تغيّر في آخر تحديث</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Heart className="w-3.5 h-3.5 text-rose-500" />
                                <span>قلب النظام</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Layers className="w-3.5 h-3.5 text-emerald-500" />
                                <span>طبقات المحرك</span>
                            </div>
                            <div className="flex items-center gap-1.5 mr-auto">
                                <Eye className="w-3.5 h-3.5 text-emerald-500" />
                                <span>اضغط على أي عنصر للتفاصيل</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {selectedNode ? renderDetailPanel() : (
                    <Card className="lg:col-span-1">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Info className="w-4 h-4 text-emerald-500" />
                                لوحة التفاصيل
                            </CardTitle>
                            <CardDescription className="text-xs">
                                اضغط على أي عنصر في المخطط لعرض تفاصيله هنا
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">المحركات ({data.services.length})</div>
                                <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
                                    {data.services.map(s => (
                                        <div key={s.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                                            <span className="truncate flex items-center gap-1.5">
                                                {getServiceIcon(s.kind)}
                                                {s.name_ar}
                                            </span>
                                            <Badge variant="outline" className={cn('text-[10px]', getStatusColor(s.status).text)}>
                                                {getStatusColor(s.status).label}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t">
                                <div className="text-xs font-medium text-muted-foreground">قواعد البيانات ({data.databases.length})</div>
                                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                    {data.databases.map(d => (
                                        <div key={d.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                                            <span className="truncate flex items-center gap-1.5">
                                                {d.is_heart ? <Heart className="w-3 h-3 text-rose-500" /> : <Database className="w-3 h-3" />}
                                                {d.name}
                                            </span>
                                            <Badge variant="outline" className={cn('text-[10px]', getStatusColor(d.status).text)}>
                                                {getStatusColor(d.status).label}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t">
                                <div className="text-xs font-medium text-muted-foreground">إحصائيات الطبقات</div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                    <div>• {data.services.reduce((sum, s) => sum + (s.layers?.filter(l => l.status === 'active').length || 0), 0)} طبقة نشطة في المحركات</div>
                                    <div>• {summary.scrapers_present || 0}/{summary.scrapers_count || 0} ساحب بيانات نشط</div>
                                    <div>• {data.databases.reduce((sum, d) => sum + d.all_tables_count, 0)} جدول إجمالي</div>
                                    <div>• {data.flows.filter(f => f.status === 'flowing').length}/{data.flows.length} تدفق نشط</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Detailed flows table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <ArrowRight className="w-5 h-5 text-purple-500" />
                        تفاصيل تدفقات البيانات
                    </CardTitle>
                    <CardDescription className="text-xs">
                        كل سطر يمثّل تدفق بيانات بين عنصرين — الحالة توضّح هل البيانات تنتقل أم لا ولماذا
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-right text-xs text-muted-foreground">
                                    <th className="p-2 font-medium">من → إلى</th>
                                    <th className="p-2 font-medium">الوصف</th>
                                    <th className="p-2 font-medium">الحالة</th>
                                    <th className="p-2 font-medium">آخر نقل</th>
                                    <th className="p-2 font-medium">السبب</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.flows.map(f => {
                                    const color = getStatusColor(f.status);
                                    return (
                                        <tr key={f.id} className="border-b hover:bg-muted/30">
                                            <td className="p-2 font-mono text-xs">
                                                {/* BUG #20 FIX: arrow was reversed. `←` made it look like
                                                    "to → from". Now `→` correctly shows from → to. */}
                                                {f.from} → {f.to}
                                            </td>
                                            <td className="p-2">{f.label_ar}</td>
                                            <td className="p-2">
                                                <Badge variant="outline" className={cn('gap-1', color.text)}>
                                                    <div className={cn('w-2 h-2 rounded-full', color.bg)} />
                                                    {color.label}
                                                </Badge>
                                            </td>
                                            <td className="p-2 text-xs text-muted-foreground font-mono tabular-nums">
                                                {f.last_transfer
                                                    ? formatLiveSeconds(f.last_transfer, now)
                                                    : formatTimeAgo(f.minutes_ago)}
                                            </td>
                                            <td className="p-2 text-xs text-muted-foreground">{f.reason}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

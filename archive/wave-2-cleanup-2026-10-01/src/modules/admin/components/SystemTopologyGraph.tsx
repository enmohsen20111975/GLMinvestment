'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
    Database, Brain, Cpu, Server, Boxes,
    CircuitBoard, Radio, Globe, Target, Shield,
    FlaskConical, GitBranch, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

export interface TopologyData {
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

export function getStatusColor(status: string) {
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

export function formatLiveSeconds(isoTs: string | null, nowMs: number): string {
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

const NODE_POSITIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
    'sources': { x: 240, y: 15, w: 840, h: 130 },
    'data-engine': { x: 460, y: 170, w: 400, h: 85 },
    'data-engine-db': { x: 360, y: 280, w: 600, h: 115 },
    'stocks-db': { x: 100, y: 425, w: 200, h: 90 },
    'price-history-db': { x: 320, y: 425, w: 200, h: 90 },
    'predictions-db': { x: 540, y: 425, w: 200, h: 90 },
    'auth-db': { x: 760, y: 425, w: 200, h: 90 },
    'analytics-engine': { x: 220, y: 545, w: 420, h: 110 },
    'prediction-engine': { x: 680, y: 545, w: 420, h: 110 },
    'confluence-engine-v3': { x: 380, y: 680, w: 280, h: 110 },
    'risk-engine': { x: 690, y: 680, w: 280, h: 110 },
    'backtest-engine': { x: 1000, y: 680, w: 280, h: 110 },
    'python-backend': { x: 320, y: 820, w: 340, h: 100 },
    'ws-service': { x: 690, y: 820, w: 320, h: 100 },
    'frontend': { x: 380, y: 950, w: 560, h: 80 },
    'browser': { x: 460, y: 1055, w: 400, h: 70 },
};

// ============== Layer bands ==============

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

// ============== Props ==============

interface SystemTopologyGraphProps {
    data: TopologyData;
    selectedNode: string | null;
    setSelectedNode: (id: string | null) => void;
    changedNodes: Set<string>;
    now: number;
    servicesById: Record<string, ServiceNode>;
    dbsById: Record<string, DatabaseNode>;
}

// ============== Component ==============

export function SystemTopologyGraph({
    data,
    selectedNode,
    setSelectedNode,
    changedNodes,
    now,
    servicesById,
    dbsById,
}: SystemTopologyGraphProps) {

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
                {isHeart && (
                    <g>
                        <circle cx={pos.x + 24} cy={pos.y + 24} r={12} fill="rgba(244,63,94,0.15)" className="text-rose-500" stroke="currentColor" strokeWidth={1.5} />
                        <text x={pos.x + 24} y={pos.y + 28} fontSize={14} textAnchor="middle">💗</text>
                    </g>
                )}
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

    function renderSourcesNode() {
        const pos = NODE_POSITIONS['sources'];
        const dataEng = servicesById['data-engine'];
        const heart = dbsById['data-engine-db'];
        const scrapers = dataEng?.layers || [];
        const scrapersActive = scrapers.filter(s => s.status === 'active').length;
        const dataEngRunning = dataEng?.status === 'running';
        const heartHealthy = heart?.status === 'healthy';

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

        const particleCount = isFlowing ? 3 : isStale ? 1 : 0;
        const particleDur = isFlowing ? 2.2 : isStale ? 4.5 : 1;
        const particleDelays = Array.from({ length: particleCount }, (_, i) => (i * particleDur) / particleCount);

        return (
            <g key={flow.id}>
                <path
                    id={`flow-path-${flow.id}`}
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    className={cn('opacity-30', color.text)}
                />
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
                {particleCount > 0 && particleDelays.map((delay, i) => (
                    <g key={`particle-${flow.id}-${i}`}>
                        <circle r={5} fill={color.stroke} opacity={0.18}>
                            <animateMotion
                                dur={`${particleDur}s`}
                                begin={`${delay}s`}
                                repeatCount="indefinite"
                                path={path}
                            />
                        </circle>
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

    // ============== Render ==============

    return (
        <>
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
                <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded border-2 border-amber-400 animate-pulse" />
                    <span>تغيّر في آخر تحديث</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-rose-500" />
                    <span>قلب النظام</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <CircuitBoard className="w-3.5 h-3.5 text-emerald-500" />
                    <span>طبقات المحرك</span>
                </div>
                <div className="flex items-center gap-1.5 mr-auto">
                    <Eye className="w-3.5 h-3.5 text-emerald-500" />
                    <span>اضغط على أي عنصر للتفاصيل</span>
                </div>
            </div>
        </>
    );
}

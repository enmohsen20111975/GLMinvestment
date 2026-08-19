'use client';

/**
 * MaestroCommandCenter (مركز قيادة المايسترو) — SCADA/PLC Industrial Control Panel
 * ==================================================================================
 * React Flow-based engineering command center with custom node types, edge types,
 * detail panel, live polling, and parameter editing.
 *
 * Layout: Full-screen React Flow canvas | Toolbar | Detail Sheet (right)
 * Polling: Every 10 seconds
 * Theme: Dark space (#0f1117 background)
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MaestroLogicFlow } from './MaestroLogicFlow';
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  Position,
  MarkerType,
  Handle,
  BaseEdge,
  getBezierPath,
  type ConnectionLineComponentProps,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database, Loader2,
  RefreshCw, Server, Wifi, WifiOff, Zap, Brain, Cpu,
  Network, ArrowRight, Info,
  HardDrive, Globe, AlertCircle, Target, Layers, Shield,
  Gauge, Sparkles, Monitor, Flame,
  Maximize2, Settings, LineChart,
  BarChart3, FileText,
  Download, Eye, Lock,
  Play, Crosshair, XCircle,
  Timer, GitBranch,
  Sliders, Workflow, TrendingUp,
  RotateCcw, Save, StopCircle, X, ChevronDown,
  Beaker, DollarSign,
  Power, List,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { getAdminToken } from '@/lib/admin-auth';
import { motion, AnimatePresence } from 'framer-motion';
import { OptimizerParamsPanel } from './OptimizerParamsPanel';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';

// ============== Types ==============

type NodeCategory = 'DataSource' | 'Engine' | 'Orchestrator' | 'Output' | 'Gate' | 'Control';
type NodeStatus = 'running' | 'healthy' | 'stopped' | 'degraded' | 'error' | 'missing' | 'unknown';
type EdgeCategory = 'data' | 'control' | 'output' | 'feedback';

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  labelAr: string;
  category: NodeCategory;
  status: NodeStatus;
  icon: string;
  metrics: { key: string; value: string; labelAr: string }[];
  lastUpdate: string | null;
  params: ParamDefinition[];
  connections: { in: string[]; out: string[] };
}

interface ParamDefinition {
  key: string;
  label: string;
  labelAr: string;
  type: 'slider' | 'toggle' | 'number';
  value: number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

interface ServiceNode {
  id: string;
  name: string;
  name_ar: string;
  kind: string;
  port?: number;
  url?: string;
  status: NodeStatus | 'enabled' | 'disabled';
  latency_ms: number;
  last_update: string | null;
  minutes_ago: number | null;
  staleness: 'fresh' | 'stale' | 'old' | 'unknown';
  reason: string;
  layers?: { id: string; name: string; status: string }[];
}

interface DatabaseNode {
  id: string;
  name: string;
  kind: string;
  path: string;
  exists: boolean;
  size_kb: number;
  status: 'healthy' | 'empty' | 'missing' | 'corrupted' | 'locked' | 'unknown';
  reason: string;
  last_write: string | null;
  minutes_ago: number | null;
}

interface TopologyData {
  success: boolean;
  timestamp: string;
  services: ServiceNode[];
  databases: DatabaseNode[];
  boards?: Record<string, {
    market: string;
    sell_strategy: string;
    status: string;
    analysts?: Record<string, { key: string; name_ar: string; weight: number; active: boolean }>;
  }>;
  board_system_active?: boolean;
  summary: {
    services_up: number;
    services_total: number;
    dbs_healthy: number;
    dbs_total: number;
    flows_active: number;
    flows_total: number;
    health_score: number;
    heart_status?: string;
  };
}

interface ActivityEntry {
  id: string;
  message: string;
  timestamp: Date;
  type: 'success' | 'info' | 'warning' | 'error';
}

// P39-COMMAND-CENTER: Live Engine Control Drawer + Header Toolbar
// ============== Engine Control Types (backend /api/admin/engine-control/*) ==============

interface EngineLogEntry {
  ts?: string;
  timestamp?: string;
  level?: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

interface EngineControlEngine {
  active: boolean;
  weight: number;
  sensitivity: number;
  threshold: number;
  lastTriggeredAt?: string | null;
  log?: EngineLogEntry[];
  runtimeStatus?: string;
}

interface EngineControlStatus {
  engines?: Record<string, EngineControlEngine>;
  autoRegime?: boolean;
  throughput?: {
    messagesPerMin?: number;
    [key: string]: unknown;
  };
  generatedAt?: string;
}

// Map React Flow node IDs to engine-control engine IDs.
// Only nodes listed here will show the new Engine Control sections in the Sheet.
const NODE_TO_ENGINE_ID: Record<string, string> = {
  'sniper-engine': 'smc',
  'confluence': 'quant',
  'market-regime': 'risk',
  'egx-data': 'egx',
  'data-engine': 'data',
  'scheduler': 'telegram',
};

// The 4 Maestro engines that get the advanced sub-engine control panel (Pillar 3)
const MAESTRO_ENGINE_IDS = ['smc', 'quant', 'risk', 'egx'] as const;


// ============== Color Constants ==============

const COLORS = {
  bg: '#0f1117',
  card: '#161822',
  border: '#252836',
  primary: '#ffffff',
  secondary: '#9ca3af',
  green: '#00c853',
  orange: '#ff9100',
  red: '#ff1744',
  purple: '#7c4dff',
  blue: '#2979ff',
  gold: '#ffc400',
  pink: '#e040fb',
};

const NODE_COLORS: Record<NodeCategory, { bg: string; border: string; text: string }> = {
  DataSource: { bg: '#0d9488', border: '#14b8a6', text: '#5eead4' },
  Engine: { bg: '#059669', border: '#10b981', text: '#6ee7b7' },
  Orchestrator: { bg: '#7c3aed', border: '#8b5cf6', text: '#c4b5fd' },
  Output: { bg: '#d97706', border: '#f59e0b', text: '#fcd34d' },
  Gate: { bg: '#e11d48', border: '#f43f5e', text: '#fda4af' },
  Control: { bg: '#ea580c', border: '#f97316', text: '#fdba74' },
};

const EDGE_COLORS: Record<EdgeCategory, string> = {
  data: '#14b8a6',
  control: '#f97316',
  output: '#f59e0b',
  feedback: '#8b5cf6',
};

const STATUS_COLORS: Record<string, string> = {
  running: '#00c853',
  healthy: '#00c853',
  stopped: '#ff1744',
  degraded: '#ff9100',
  error: '#ff1744',
  missing: '#ff1744',
  unknown: '#555555',
  enabled: '#00c853',
  disabled: '#555555',
};

// ============== Helpers ==============

function getTimeString(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function formatTimeAgo(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return `منذ ${diffSec} ثانية`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  return `منذ ${Math.floor(diffMin / 60)} ساعة`;
}

let activityIdCounter = 0;

function getStaleness(lastUpdate: string | null): NodeStatus {
  if (!lastUpdate) return 'unknown';
  try {
    const diff = Date.now() - new Date(lastUpdate).getTime();
    const minutes = diff / 60000;
    if (minutes > 15) return 'error';
    if (minutes > 5) return 'degraded';
    return 'healthy';
  } catch {
    return 'unknown';
  }
}

function statusDotColor(status: NodeStatus): string {
  return STATUS_COLORS[status] || '#555';
}

function getNodeIcon(category: NodeCategory, iconName?: string): React.ReactNode {
  // Optional icon override (used by new strategic-feature nodes — DOCS-UPDATE-026)
  if (iconName) {
    const iconClass = 'w-3.5 h-3.5';
    switch (iconName) {
      case 'Shield':     return <Shield className={iconClass} />;
      case 'Globe':      return <Globe className={iconClass} />;
      case 'DollarSign': return <DollarSign className={iconClass} />;
      case 'Brain':      return <Brain className={iconClass} />;
      case 'Layers':     return <Layers className={iconClass} />;
      case 'Target':     return <Target className={iconClass} />;
      case 'Activity':   return <Activity className={iconClass} />;
      case 'Clock':      return <Clock className={iconClass} />;
      case 'BarChart3':  return <BarChart3 className={iconClass} />;
      case 'Sliders':    return <Sliders className={iconClass} />;
      case 'Sparkles':   return <Sparkles className={iconClass} />;
      case 'TrendingUp': return <TrendingUp className={iconClass} />;
      case 'Flame':      return <Flame className={iconClass} />;
      case 'Workflow':   return <Workflow className={iconClass} />;
      case 'Cpu':        return <Cpu className={iconClass} />;
      case 'Database':   return <Database className={iconClass} />;
      default: break;
    }
  }
  switch (category) {
    case 'DataSource': return <Database className="w-3.5 h-3.5" />;
    case 'Engine': return <Cpu className="w-3.5 h-3.5" />;
    case 'Orchestrator': return <Workflow className="w-3.5 h-3.5" />;
    case 'Output': return <TrendingUp className="w-3.5 h-3.5" />;
    case 'Gate': return <Shield className="w-3.5 h-3.5" />;
    case 'Control': return <Sliders className="w-3.5 h-3.5" />;
  }
}

function getCategoryLabelAr(cat: NodeCategory): string {
  switch (cat) {
    case 'DataSource': return 'مصدر بيانات';
    case 'Engine': return 'محرك';
    case 'Orchestrator': return 'منسق';
    case 'Output': return 'مخرجات';
    case 'Gate': return 'بوابة';
    case 'Control': return 'تحكم';
  }
}

// ============== Custom Node Component ==============

function SCADANode({ data }: { data: CustomNodeData }) {
  const colors = NODE_COLORS[data.category];
  const dotColor = statusDotColor(data.status);
  const isRunning = data.status === 'running' || data.status === 'healthy';

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, type: 'spring', stiffness: 200 }}
      className="relative cursor-pointer group"
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-0 !rounded-full" style={{ background: colors.border }} />
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !border-0 !rounded-full" style={{ background: colors.border }} />

      {/* Node body */}
      <div
        className="rounded-lg overflow-hidden shadow-2xl min-w-[160px] max-w-[200px] transition-all duration-300 hover:scale-105 hover:z-50"
        style={{
          background: COLORS.card,
          border: `2px solid ${colors.border}60`,
          boxShadow: `0 0 20px ${colors.bg}15, 0 0 4px ${colors.border}30`,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.border = `2px solid ${colors.border}cc`;
          el.style.boxShadow = `0 0 30px ${colors.bg}30, 0 0 12px ${colors.border}60, 0 0 40px ${colors.border}20`;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.border = `2px solid ${colors.border}60`;
          el.style.boxShadow = `0 0 20px ${colors.bg}15, 0 0 4px ${colors.border}30`;
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5"
          style={{
            background: `linear-gradient(135deg, ${colors.bg}dd, ${colors.bg}99)`,
            borderBottom: `1px solid ${colors.border}40`,
          }}
        >
          <span style={{ color: colors.text }}>{getNodeIcon(data.category, data.icon)}</span>
          <span className="text-[10px] font-bold truncate flex-1" style={{ color: colors.text }}>
            {data.label}
          </span>
          {/* Status dot with pulse */}
          <div className="relative">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ background: dotColor, boxShadow: isRunning ? `0 0 6px ${dotColor}` : 'none' }}
              animate={isRunning ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } : {}}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            />
            {isRunning && (
              <motion.div
                className="absolute inset-0 w-2 h-2 rounded-full"
                style={{ background: dotColor }}
                animate={{ scale: [1, 2.5], opacity: [0.5, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
              />
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="px-2.5 py-2 space-y-1">
          {data.metrics.slice(0, 3).map((m) => (
            <div key={m.key} className="flex items-center justify-between">
              <span className="text-[8px] text-gray-500">{m.labelAr}</span>
              <span className="text-[9px] font-bold" style={{ color: colors.text }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* Category badge */}
        <div className="px-2.5 pb-1.5">
          <Badge
            className="text-[7px] px-1 py-0 font-bold"
            style={{ background: `${colors.bg}30`, color: colors.text, border: `1px solid ${colors.border}50` }}
          >
            {getCategoryLabelAr(data.category)}
          </Badge>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-0 !rounded-full" style={{ background: colors.border }} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !border-0 !rounded-full" style={{ background: colors.border }} />
    </motion.div>
  );
}

// ============== Custom Edge Component ==============

function SCADAEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: { category?: EdgeCategory };
}) {
  const category: EdgeCategory = (data?.category as EdgeCategory) || 'data';
  const color = EDGE_COLORS[category];
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  const strokeDasharray = category === 'data' ? '8 4' : category === 'feedback' ? '3 6' : undefined;
  const strokeWidth = category === 'control' ? 3 : category === 'output' ? 2 : 1.5;

  return (
    <g>
      {/* Glow effect */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 4}
        strokeOpacity={0.08}
        style={{ strokeDasharray }}
      />
      {/* Main line */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeOpacity={0.7}
        className={category === 'data' || category === 'feedback' ? 'animate-[dash_2s_linear_infinite]' : ''}
        markerEnd={`url(#marker-${category})`}
      />
      {/* Animated dot for data edges */}
      {(category === 'data' || category === 'output') && (
        <circle r="4" fill={color} opacity={0.9}>
          <animateMotion dur="4s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </g>
  );
}

// ============== Node/Edge type maps ==============

const nodeTypes: NodeTypes = {
  scada: SCADANode as React.ComponentType<React.ComponentProps<typeof SCADANode> & Record<string, unknown>>,
};

const edgeTypes: EdgeTypes = {
  scada: SCADAEdge as React.ComponentType<React.ComponentProps<typeof SCADAEdge> & Record<string, unknown>>,
};

// ============== SVG Marker Definitions ==============

function EdgeMarkerDefs() {
  return (
    <defs>
      {Object.entries(EDGE_COLORS).map(([cat, color]) => (
        <marker
          key={cat}
          id={`marker-${cat}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} fillOpacity={0.8} />
        </marker>
      ))}
    </defs>
  );
}

// ============== Build Initial Nodes ==============

function buildInitialNodes(): Node<CustomNodeData>[] {
  const nodes: Node<CustomNodeData>[] = [
    // === DATA SOURCES ===
    {
      id: 'eodhd-api',
      type: 'scada',
      position: { x: 50, y: 50 },
      data: {
        label: 'EODHD API',
        labelAr: 'EODHD API',
        category: 'DataSource',
        status: 'running',
        icon: 'Globe',
        metrics: [
          { key: 'stocks', value: '281', labelAr: 'سهم' },
          { key: 'source', value: 'EOD Historical', labelAr: 'المصدر' },
          { key: 'rate', value: 'live', labelAr: 'التحديث' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: [], out: ['egx-data', 'price-history-db'] },
      },
    },
    {
      id: 'egx-data',
      type: 'scada',
      position: { x: 50, y: 220 },
      data: {
        label: 'EGX Data',
        labelAr: 'بيانات EGX',
        category: 'DataSource',
        status: 'running',
        icon: 'Database',
        metrics: [
          { key: 'stocks', value: '281', labelAr: 'سهم' },
          { key: 'history', value: '—', labelAr: 'بسجل' },
          { key: 'sync', value: 'live', labelAr: 'آخر مزامنة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['eodhd-api'], out: ['data-engine', 'market-regime', 'price-history-db'] },
      },
    },
    {
      id: 'price-history-db',
      type: 'scada',
      position: { x: 50, y: 500 },
      data: {
        label: 'price_history.db',
        labelAr: 'سجل الأسعار',
        category: 'DataSource',
        status: 'healthy',
        icon: 'Database',
        metrics: [
          { key: 'rows', value: '~120K', labelAr: 'سجلات' },
          { key: 'tables', value: '12', labelAr: 'جداول' },
          { key: 'size', value: '—', labelAr: 'الحجم' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['eodhd-api', 'egx-data'], out: ['expert-memory', 'stock-fundamentals'] },
      },
    },

    // === ENGINES ===
    {
      id: 'data-engine',
      type: 'scada',
      position: { x: 300, y: 150 },
      data: {
        label: 'Data Engine',
        labelAr: 'محرك البيانات',
        category: 'Engine',
        status: 'running',
        icon: 'Cpu',
        metrics: [
          { key: 'throughput', value: '340/min', labelAr: 'الإنتاجية' },
          { key: 'queue', value: '12', labelAr: 'الطابور' },
          { key: 'uptime', value: '99.8%', labelAr: 'التشغيل' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 80, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
          { key: 'batch_size', label: 'Batch Size', labelAr: 'حجم الدفعة', type: 'number', value: 50, min: 1, max: 500, step: 10 },
        ],
        connections: { in: ['egx-data'], out: ['sniper-engine', 'confluence'] },
      },
    },
    {
      id: 'sniper-engine',
      type: 'scada',
      position: { x: 550, y: 100 },
      data: {
        label: 'Sniper Engine',
        labelAr: 'محرك التصطاد',
        category: 'Engine',
        status: 'running',
        icon: 'Cpu',
        metrics: [
          { key: 'opportunities', value: '7', labelAr: 'فرص' },
          { key: 'pass_rate', value: '72%', labelAr: 'معدل النجاح' },
          { key: 'weight', value: '85', labelAr: 'الوزن' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 85, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
          { key: 'lookback', label: 'Lookback Period', labelAr: 'فترة الرجوع', type: 'number', value: 14, min: 1, max: 90, step: 1 },
          { key: 'sensitivity', label: 'Sensitivity', labelAr: 'الحساسية', type: 'slider', value: 60, min: 0, max: 100, step: 5 },
        ],
        connections: { in: ['data-engine'], out: ['predictions', 'egx30-gate', 'trend-filter', 'explosive-scanner'] },
      },
    },
    {
      id: 'confluence',
      type: 'scada',
      position: { x: 550, y: 300 },
      data: {
        label: 'Confluence',
        labelAr: 'التوافق',
        category: 'Engine',
        status: 'running',
        icon: 'Cpu',
        metrics: [
          { key: 'signals', value: '14', labelAr: 'إشارات' },
          { key: 'accuracy', value: '68%', labelAr: 'الدقة' },
          { key: 'weight', value: '70', labelAr: 'الوزن' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 70, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
          { key: 'threshold', label: 'Threshold', labelAr: 'الحد الأدنى', type: 'slider', value: 55, min: 0, max: 100, step: 5 },
        ],
        connections: { in: ['data-engine', 'expert-memory'], out: ['signals'] },
      },
    },
    // === NEW ENGINES (Architecture Refresh) ===
    {
      id: 'flow-system',
      type: 'scada',
      position: { x: 300, y: 300 },
      data: {
        label: 'Flow System',
        labelAr: 'نظام التدفقات',
        category: 'Engine',
        status: 'running',
        icon: 'Workflow',
        metrics: [
          { key: 'layers', value: '4', labelAr: 'طبقات' },
          { key: 'score', value: 'live', labelAr: 'Flow Score' },
          { key: 'coverage', value: 'EGX+Crypto', labelAr: 'التغطية' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 80, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['data-engine'], out: ['predictions', 'signals'] },
      },
    },
    {
      id: 'explosive-scanner',
      type: 'scada',
      position: { x: 300, y: 50 },
      data: {
        label: 'Explosive Scanner',
        labelAr: 'ماسح القنابل',
        category: 'Engine',
        status: 'running',
        icon: 'Flame',
        metrics: [
          { key: 'pattern', value: 'live', labelAr: 'النمط' },
          { key: 'smart_money', value: 'on', labelAr: 'Smart Money' },
          { key: 'volume', value: 'live', labelAr: 'نسبة الحجم' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 75, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['sniper-engine'], out: ['signals', 'predictions'] },
      },
    },
    {
      id: 'crypto-engine',
      type: 'scada',
      position: { x: 50, y: 750 },
      data: {
        label: 'Crypto Engine',
        labelAr: 'محرك الكريبتو',
        category: 'Engine',
        status: 'running',
        icon: 'Cpu',
        metrics: [
          { key: 'coins', value: '111', labelAr: 'عملة' },
          { key: 'mcap', value: '—', labelAr: 'القيمة السوقية' },
          { key: 'flow', value: 'live', labelAr: 'Flow Score' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 70, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: [], out: ['predictions', 'signals'] },
      },
    },
    {
      id: 'stock-fundamentals',
      type: 'scada',
      position: { x: 50, y: 920 },
      data: {
        label: 'Stock Fundamentals',
        labelAr: 'البيانات الأساسية',
        category: 'Engine',
        status: 'running',
        icon: 'Database',
        metrics: [
          { key: 'tables', value: '9', labelAr: 'جداول' },
          { key: 'source', value: 'data-engine.db', labelAr: 'المصدر' },
          { key: 'coverage', value: 'EGX', labelAr: 'التغطية' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['price-history-db'], out: ['confluence', 'board-of-analysts'] },
      },
    },

    // === ORCHESTRATOR ===
    {
      id: 'market-regime',
      type: 'scada',
      position: { x: 300, y: 400 },
      data: {
        label: 'Market Regime',
        labelAr: 'نظام السوق',
        category: 'Orchestrator',
        status: 'running',
        icon: 'Workflow',
        metrics: [
          { key: 'regime', value: 'Bull', labelAr: 'النظام' },
          { key: 'confidence', value: '82%', labelAr: 'الثقة' },
          { key: 'change', value: '4h ago', labelAr: 'آخر تغيير' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['egx-data'], out: ['quality-gate', 'scheduler'] },
      },
    },
    {
      id: 'scheduler',
      type: 'scada',
      position: { x: 550, y: 500 },
      data: {
        label: 'Scheduler',
        labelAr: 'المجدول',
        category: 'Orchestrator',
        status: 'running',
        icon: 'Workflow',
        metrics: [
          { key: 'tasks', value: '8', labelAr: 'مهام' },
          { key: 'next', value: '14:30', labelAr: 'التالي' },
          { key: 'uptime', value: '99.9%', labelAr: 'التشغيل' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['market-regime'], out: ['daily-closer'] },
      },
    },

    // === GATES ===
    {
      id: 'egx30-gate',
      type: 'scada',
      position: { x: 800, y: 100 },
      data: {
        label: 'EGX30 Gate',
        labelAr: 'بوابة EGX30',
        category: 'Gate',
        status: 'running',
        icon: 'Shield',
        metrics: [
          { key: 'pass_rate', value: '72%', labelAr: 'معدل العبور' },
          { key: 'rejected', value: '3', labelAr: 'مرفوضة' },
          { key: 'threshold', value: '60%', labelAr: 'الحد' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'threshold', label: 'Threshold', labelAr: 'الحد الأدنى', type: 'slider', value: 60, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['sniper-engine'], out: ['predictions'] },
      },
    },
    {
      id: 'trend-filter',
      type: 'scada',
      position: { x: 800, y: 280 },
      data: {
        label: 'Trend Filter',
        labelAr: 'فلتر الاتجاه',
        category: 'Gate',
        status: 'running',
        icon: 'Shield',
        metrics: [
          { key: 'filtered', value: '5', labelAr: 'مفلترة' },
          { key: 'pass_rate', value: '55%', labelAr: 'معدل العبور' },
          { key: 'threshold', value: '50%', labelAr: 'الحد' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'threshold', label: 'Threshold', labelAr: 'الحد الأدنى', type: 'slider', value: 50, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['sniper-engine'], out: ['signals'] },
      },
    },
    {
      id: 'quality-gate',
      type: 'scada',
      position: { x: 550, y: 600 },
      data: {
        label: 'Quality Gate',
        labelAr: 'بوابة الجودة',
        category: 'Gate',
        status: 'running',
        icon: 'Shield',
        metrics: [
          { key: 'score', value: '94%', labelAr: 'النقاط' },
          { key: 'checks', value: '12', labelAr: 'فحوصات' },
          { key: 'failed', value: '0', labelAr: 'فاشلة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'threshold', label: 'Threshold', labelAr: 'الحد الأدنى', type: 'slider', value: 80, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['market-regime'], out: [] },
      },
    },

    // === OUTPUTS ===
    {
      id: 'predictions',
      type: 'scada',
      position: { x: 1050, y: 100 },
      data: {
        label: 'Predictions',
        labelAr: 'التوقعات',
        category: 'Output',
        status: 'running',
        icon: 'TrendingUp',
        metrics: [
          { key: 'active', value: '23', labelAr: 'نشطة' },
          { key: 'avg_score', value: '7.2', labelAr: 'متوسط النقاط' },
          { key: 'today', value: '5 new', labelAr: 'اليوم' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['sniper-engine', 'egx30-gate'], out: [] },
      },
    },
    {
      id: 'signals',
      type: 'scada',
      position: { x: 1050, y: 280 },
      data: {
        label: 'Signals',
        labelAr: 'الإشارات',
        category: 'Output',
        status: 'running',
        icon: 'TrendingUp',
        metrics: [
          { key: 'total', value: '14', labelAr: 'الإجمالي' },
          { key: 'buy', value: '8', labelAr: 'شراء' },
          { key: 'sell', value: '6', labelAr: 'بيع' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['confluence', 'trend-filter'], out: [] },
      },
    },
    {
      id: 'performance',
      type: 'scada',
      position: { x: 550, y: 750 },
      data: {
        label: 'Performance',
        labelAr: 'الأداء',
        category: 'Output',
        status: 'running',
        icon: 'TrendingUp',
        metrics: [
          { key: 'sharpe', value: '2.38', labelAr: 'معامل الربحية' },
          { key: 'win_rate', value: '67.0%', labelAr: 'Comprehensive' },
          { key: 'unified', value: '68.84%', labelAr: 'Unified' },
          { key: 'profit_factor', value: '2.5', labelAr: 'Profit Factor (HEDGE-FUND-036)' },
          { key: 'avg_rr', value: '1.8', labelAr: 'متوسط R/R' },
          { key: 'sample_size', value: '45', labelAr: 'حجم العينة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['prediction-optimizer', 'hedge-fund-metrics'], out: [] },
      },
    },
    {
      // HEDGE-FUND-036: Hedge Fund Metrics Engine
      id: 'hedge-fund-metrics',
      type: 'scada',
      position: { x: 300, y: 850 },
      data: {
        label: 'HedgeFundMetrics',
        labelAr: 'مقاييس صندوق التحوط',
        category: 'Engine',
        status: 'running',
        icon: 'TrendingUp',
        metrics: [
          { key: 'profit_factor', value: 'PF = gross_profit / gross_loss', labelAr: 'معامل الربحية' },
          { key: 'avg_rr', value: 'R/R ≥ 1.5', labelAr: 'متوسط المخاطرة/العائد' },
          { key: 'sample_size', value: '< 10 → عينة صغيرة', labelAr: 'شفافية حجم العينة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'profit_factor_threshold', label: 'حد Profit Factor الجيد', value: '1.5', editable: true },
          { key: 'rr_threshold', label: 'حد R/R الأدنى', value: '1.5', editable: true },
          { key: 'sample_size_warning', label: 'حد تحذير العينة الصغيرة', value: '10', editable: true },
        ],
        connections: { in: ['prediction-optimizer'], out: ['performance'] },
      },
    },
    {
      id: 'reports',
      type: 'scada',
      position: { x: 1050, y: 500 },
      data: {
        label: 'Reports',
        labelAr: 'التقارير',
        category: 'Output',
        status: 'running',
        icon: 'TrendingUp',
        metrics: [
          { key: 'daily', value: '1', labelAr: 'يومي' },
          { key: 'weekly', value: '5', labelAr: 'أسبوعي' },
          { key: 'last', value: '2h ago', labelAr: 'آخر' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['daily-closer'], out: [] },
      },
    },

    // === NEW ENGINES (July 2026 — Track 2+3+4) ===
    {
      id: 'prediction-optimizer',
      type: 'scada',
      position: { x: 800, y: 50 },
      data: {
        label: 'PredictionOptimizer',
        labelAr: 'محرك التحسين',
        category: 'Engine',
        status: 'running',
        icon: 'Target',
        metrics: [
          { key: 'win_rate', value: '67.0%', labelAr: 'Comprehensive' },
          { key: 'unified', value: '68.84%', labelAr: 'Unified' },
          { key: 'features', value: '+ FF + PS + MV', labelAr: '3 strategic features' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'min_conviction', value: 5, labelAr: 'حد الاقتناء', type: 'number', editable: true, min: 3, max: 8, step: 1 },
          { key: 'min_rr_ratio', value: 1.5, labelAr: 'حد R/R', type: 'number', editable: true, min: 1, max: 3, step: 0.1 },
          { key: 'max_stop_pct', value: 8, labelAr: 'حد الإيقاف %', type: 'number', editable: true, min: 3, max: 12, step: 0.5 },
        ],
        connections: { in: ['enhanced-indicators', 'multi-timeframe', 'volume-profile', 'analysis-layers', 'rag-ai', 'macro-veto', 'position-sizing'], out: ['predictions', 'performance'] },
      },
    },
    {
      id: 'enhanced-indicators',
      type: 'scada',
      position: { x: 550, y: 50 },
      data: {
        label: 'EnhancedIndicators',
        labelAr: 'المؤشرات المحسّنة',
        category: 'Engine',
        status: 'running',
        icon: 'Activity',
        metrics: [
          { key: 'indicators', value: '8 layers', labelAr: 'طبقات' },
          { key: 'macd_w', value: '23 pts', labelAr: 'MACD ⬆️' },
          { key: 'boll_w', value: '10 pts', labelAr: 'Bollinger ✂️' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['data-engine'], out: ['prediction-optimizer', 'analysis-layers'] },
      },
    },
    {
      id: 'multi-timeframe',
      type: 'scada',
      position: { x: 550, y: 200 },
      data: {
        label: 'MultiTimeframe',
        labelAr: 'الأطر الزمنية',
        category: 'Engine',
        status: 'running',
        icon: 'Clock',
        metrics: [
          { key: 'timeframes', value: '3', labelAr: 'أطر' },
          { key: 'daily', value: 'live', labelAr: 'يومي' },
          { key: 'weekly', value: 'live', labelAr: 'أسبوعي' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'volume-profile',
      type: 'scada',
      position: { x: 550, y: 350 },
      data: {
        label: 'VolumeProfile',
        labelAr: 'حجم التداول',
        category: 'Engine',
        status: 'running',
        icon: 'BarChart3',
        metrics: [
          { key: 'vwap', value: 'live', labelAr: 'VWAP' },
          { key: 'obv', value: 'live', labelAr: 'OBV' },
          { key: 'ad_line', value: 'live', labelAr: 'A/D' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'adaptive-weights',
      type: 'scada',
      position: { x: 300, y: 350 },
      data: {
        label: 'AdaptiveWeights',
        labelAr: 'الأوزان التكييفية',
        category: 'Control',
        status: 'running',
        icon: 'Sliders',
        metrics: [
          { key: 'regime', value: 'auto', labelAr: 'حالة السوق' },
          { key: 'sector', value: 'auto', labelAr: 'القطاع' },
          { key: 'volatility', value: 'auto', labelAr: 'التذبذب' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['market-regime'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'learning-engine',
      type: 'scada',
      position: { x: 300, y: 750 },
      data: {
        label: 'LearningEngine',
        labelAr: 'محرك التعلم',
        category: 'Control',
        status: 'running',
        icon: 'Sparkles',
        metrics: [
          { key: 'schedule', value: 'Fri 14:40', labelAr: 'الجدولة' },
          { key: 'lessons', value: '0', labelAr: 'دروس' },
          { key: 'status', value: 'active', labelAr: 'الحالة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['daily-closer'], out: ['adaptive-weights'] },
      },
    },

    // === CONTROL ===
    {
      id: 'expert-memory',
      type: 'scada',
      position: { x: 300, y: 600 },
      data: {
        label: 'Expert Memory',
        labelAr: 'ذاكرة الخبير',
        category: 'Control',
        status: 'running',
        icon: 'Sliders',
        metrics: [
          { key: 'rules', value: '156', labelAr: 'قواعد' },
          { key: 'accuracy', value: '74%', labelAr: 'الدقة' },
          { key: 'updated', value: '1h ago', labelAr: 'آخر تحديث' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'weight', label: 'Weight', labelAr: 'الوزن', type: 'slider', value: 65, min: 0, max: 100, step: 5 },
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['price-history-db'], out: ['confluence'] },
      },
    },
    {
      id: 'daily-closer',
      type: 'scada',
      position: { x: 800, y: 500 },
      data: {
        label: 'Daily Closer',
        labelAr: 'الإغلاق اليومي',
        category: 'Control',
        status: 'running',
        icon: 'Sliders',
        metrics: [
          { key: 'pending', value: '7', labelAr: 'معلق' },
          { key: 'closed', value: '3', labelAr: 'مغلق' },
          { key: 'next', value: '15:00', labelAr: 'التالي' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'state', label: 'State', labelAr: 'الحالة', type: 'toggle', value: true },
        ],
        connections: { in: ['scheduler'], out: ['reports'] },
      },
    },

    // === NEW NODES (July 2026 — DOCS-UPDATE-021: TUNING-V3 + Presets + RAG + DB Safety) ===
    {
      id: 'analysis-layers',
      type: 'scada',
      position: { x: 50, y: 1100 },
      data: {
        label: '8 Analysis Layers',
        labelAr: 'الـ 8 طبقات الموحّدة',
        category: 'Engine' as NodeCategory,
        status: 'running' as NodeStatus,
        icon: 'Layers',
        metrics: [
          { key: 'layers', value: '8 + 3', labelAr: 'طبقات (+ FF + PS + MV)' },
          { key: 'max_score', value: '138 pts', labelAr: 'الحد الأقصى' },
          { key: 'buy_threshold', value: '≥ 68', labelAr: 'عتبة الشراء' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'macro_trend_w', label: 'Macro Trend Weight', labelAr: 'وزن الماكرو', type: 'slider', value: 25, min: 0, max: 30, step: 1 },
          { key: 'price_sma50_w', label: 'Price vs SMA50 Weight', labelAr: 'وزن SMA50', type: 'slider', value: 18, min: 0, max: 25, step: 1 },
          { key: 'rsi_w', label: 'RSI Weight', labelAr: 'وزن RSI', type: 'slider', value: 20, min: 0, max: 25, step: 1 },
          { key: 'volume_w', label: 'Volume Weight', labelAr: 'وزن الحجم', type: 'slider', value: 20, min: 0, max: 25, step: 1 },
          { key: 'bollinger_w', label: 'Bollinger Weight (TUNING-V3)', labelAr: 'وزن بولينجر ✂️', type: 'slider', value: 10, min: 0, max: 25, step: 1 },
          { key: 'macd_w', label: 'MACD Weight (TUNING-V3)', labelAr: 'وزن MACD ⬆️', type: 'slider', value: 23, min: 0, max: 30, step: 1 },
          { key: 'candlestick_w', label: 'Candlestick Weight', labelAr: 'وزن الشموع', type: 'slider', value: 10, min: 0, max: 15, step: 1 },
          { key: 'fibonacci_w', label: 'Fibonacci Weight', labelAr: 'وزن فيبوناتشي', type: 'slider', value: 12, min: 0, max: 20, step: 1 },
        ],
        connections: { in: ['enhanced-indicators', 'market-regime', 'free-float-filter'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'rag-ai',
      type: 'scada',
      position: { x: 300, y: 1100 },
      data: {
        label: 'RAG AI Engine',
        labelAr: 'محرك RAG الذكي',
        category: 'Control' as NodeCategory,
        status: 'running' as NodeStatus,
        icon: 'Brain',
        metrics: [
          { key: 'boost', value: '+10 pts', labelAr: 'Boost ✅' },
          { key: 'veto', value: '-15 pts', labelAr: 'Veto ⛔' },
          { key: 'status', value: 'active', labelAr: 'نشط' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'boost_amount', label: 'Boost Amount', labelAr: 'قيمة التعزيز', type: 'number', value: 10, min: 0, max: 20, step: 1 },
          { key: 'veto_amount', label: 'Veto Amount', labelAr: 'قيمة الـ Veto', type: 'number', value: 15, min: 0, max: 30, step: 1 },
          { key: 'active', label: 'Active', labelAr: 'نشط', type: 'toggle', value: true },
        ],
        connections: { in: ['expert-memory', 'price-history-db'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'stock-presets',
      type: 'scada',
      position: { x: 550, y: 1100 },
      data: {
        label: 'Stock Presets (7)',
        labelAr: 'الـ 7 قوائم Screener',
        category: 'Output' as NodeCategory,
        status: 'running' as NodeStatus,
        icon: 'Layers',
        metrics: [
          { key: 'presets', value: '7', labelAr: 'قوائم' },
          { key: 'newest', value: 'top_dividends', labelAr: '🆕 توزيعات' },
          { key: 'newest2', value: 'lowest_risk', labelAr: '🆕 أقل مخاطرة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['data-engine', 'stock-fundamentals'], out: [] },
      },
    },
    {
      id: 'db-safety',
      type: 'scada',
      position: { x: 800, y: 1100 },
      data: {
        label: 'DB Safety (WAL+Repair)',
        labelAr: 'حماية الـ DBs',
        category: 'Control' as NodeCategory,
        status: 'running' as NodeStatus,
        icon: 'Shield',
        metrics: [
          { key: 'wal', value: 'ON', labelAr: 'WAL Mode' },
          { key: 'busy_timeout', value: '30s', labelAr: 'busy_timeout' },
          { key: 'auto_repair', value: 'startup', labelAr: 'إصلاح تلقائي' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'wal_checkpoint_mb', label: 'WAL Checkpoint Threshold (MB)', labelAr: 'حد WAL checkpoint', type: 'number', value: 200, min: 50, max: 500, step: 25 },
          { key: 'vacuum_gb', label: 'VACUUM Threshold (GB)', labelAr: 'حد VACUUM', type: 'number', value: 1, min: 0.5, max: 5, step: 0.5 },
          { key: 'auto_repair', label: 'Auto-Repair on Startup', labelAr: 'إصلاح عند الإقلاع', type: 'toggle', value: true },
        ],
        connections: { in: ['price-history-db', 'expert-memory'], out: [] },
      },
    },

    // === NEW STRATEGIC NODES (July 2026 — DOCS-UPDATE-026: Free Float + Position Sizing + Macro Veto) ===
    {
      id: 'free-float-filter',
      type: 'scada',
      position: { x: 50, y: 1300 },
      data: {
        label: 'Free Float Filter',
        labelAr: 'فلتر الأسهم الحرة',
        category: 'Output' as NodeCategory,           // amber color
        status: 'running' as NodeStatus,
        icon: 'Shield',
        metrics: [
          { key: 'critical', value: '< 5% → mult=0.2', labelAr: '🚨 حرج' },
          { key: 'risky', value: '< 15% → mult=0.5', labelAr: '⚠️ مخاطر' },
          { key: 'gambler', value: 'HOLD لو < 15%', labelAr: 'حماية المضارب' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'critical_threshold', label: 'Critical Threshold (%)', labelAr: 'حد الخطر 🚨', type: 'number', value: 5, min: 1, max: 10, step: 0.5 },
          { key: 'risky_threshold', label: 'Risky Threshold (%)', labelAr: 'حد المخاطرة ⚠️', type: 'number', value: 15, min: 5, max: 25, step: 1 },
          { key: 'critical_mult', label: 'Critical liquidity_mult', labelAr: 'معامل الخطر', type: 'slider', value: 20, min: 0, max: 50, step: 5 },
          { key: 'risky_mult', label: 'Risky liquidity_mult', labelAr: 'معامل المخاطرة', type: 'slider', value: 50, min: 0, max: 80, step: 5 },
          { key: 'gambler_hold', label: 'Gambler HOLD < 15%', labelAr: 'حماية المضارب', type: 'toggle', value: true },
        ],
        connections: { in: ['data-engine'], out: ['analysis-layers'] },
      },
    },
    {
      id: 'position-sizing',
      type: 'scada',
      position: { x: 300, y: 1300 },
      data: {
        label: 'Position Sizing (T+2)',
        labelAr: 'إدارة المحفظة + T+2',
        category: 'Engine' as NodeCategory,           // emerald color
        status: 'running' as NodeStatus,
        icon: 'DollarSign',
        metrics: [
          { key: 'max_ticker', value: '5% per stock', labelAr: 'حد السهم' },
          { key: 'max_exposure', value: '30% total', labelAr: 'حد التعرض' },
          { key: 'settlement', value: 'T+2 (2 days)', labelAr: 'تسوية T+2' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'risk_pct', label: 'Risk % per trade', labelAr: 'مخاطرة 2% / صفقة', type: 'slider', value: 2, min: 1, max: 5, step: 0.5 },
          { key: 'max_per_ticker', label: 'Max % per ticker', labelAr: 'حد السهم 5%', type: 'slider', value: 5, min: 1, max: 15, step: 1 },
          { key: 'max_total_exposure', label: 'Max total exposure %', labelAr: 'حد التعرض 30%', type: 'slider', value: 30, min: 10, max: 60, step: 5 },
          { key: 't2_days', label: 'T+2 Settlement Days', labelAr: 'أيام التسوية', type: 'number', value: 2, min: 1, max: 5, step: 1 },
        ],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'macro-veto',
      type: 'scada',
      position: { x: 550, y: 1300 },
      data: {
        label: 'Macro Veto (USD/Rate)',
        labelAr: 'الاقتصاد الكلي (Veto)',
        category: 'Gate' as NodeCategory,             // rose color
        status: 'running' as NodeStatus,
        icon: 'Globe',
        metrics: [
          { key: 'usd_veto', value: 'USD > 2% / 3d', labelAr: 'Veto استيراد' },
          { key: 'rate_veto', value: 'Rate ≥ 25%', labelAr: 'Veto عقارات' },
          { key: 'boost', value: '+10 pts', labelAr: 'Boost بنوك/تصدير' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'usd_change_threshold', label: 'USD change 3d threshold (%)', labelAr: 'حد الدولار 2%', type: 'slider', value: 2, min: 1, max: 5, step: 0.25 },
          { key: 'interest_rate_threshold', label: 'Interest rate threshold (%)', labelAr: 'حد الفائدة 25%', type: 'slider', value: 25, min: 15, max: 30, step: 0.5 },
          { key: 'boost_amount', label: 'Boost amount (pts)', labelAr: 'قيمة التعزيز +10', type: 'number', value: 10, min: 0, max: 20, step: 1 },
          { key: 'active', label: 'Active (safe fallback)', labelAr: 'نشط (آمن لو لا بيانات)', type: 'toggle', value: true },
        ],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
  ];

  // === BOARD OF ANALYSTS (مجلس الإدارة) ===
  nodes.push({
    id: 'board-of-analysts',
    type: 'scada',
    position: { x: 600, y: 660 },
    data: {
      label: 'Board of Analysts',
      labelAr: 'مجلس الإدارة',
      category: 'Orchestrator' as NodeCategory,
      status: 'unknown' as NodeStatus,
      icon: 'Brain',
      metrics: [
        { key: 'markets', value: '5', labelAr: 'أسواق' },
        { key: 'analysts', value: '6', labelAr: 'محللون' },
        { key: 'strategy', value: 'Swing', labelAr: 'الاستراتيجية' },
      ],
      lastUpdate: new Date().toISOString(),
      params: [
        { key: 'tech_weight', label: 'Technical Weight', labelAr: 'وزن التقني', type: 'slider' as const, value: 30, min: 0, max: 100, step: 5 },
        { key: 'fund_weight', label: 'Fundamental Weight', labelAr: 'وزن الأساسي', type: 'slider' as const, value: 25, min: 0, max: 100, step: 5 },
        { key: 'trend_weight', label: 'Trend Weight', labelAr: 'وزن الاتجاه', type: 'slider' as const, value: 20, min: 0, max: 100, step: 5 },
        { key: 'macro_weight', label: 'Macro Weight', labelAr: 'وزن الماكرو', type: 'slider' as const, value: 15, min: 0, max: 100, step: 5 },
        { key: 'active', label: 'Active', labelAr: 'نشط', type: 'toggle' as const, value: true },
      ],
      connections: { in: ['data-engine', 'confluence', 'expert-memory'], out: ['predictions', 'signals'] },
    },
  });

  // === PHASE5-053: NEW ENGINES (July 2026 — Live + Paywall + Crypto Pro + Safety) ===
  const phase5Nodes: Node[] = [
    {
      id: 'live-engine',
      type: 'scada',
      position: { x: 1100, y: 50 },
      data: {
        label: 'LiveIndicatorEngine',
        labelAr: 'المحرك اللحظي',
        category: 'Engine',
        status: 'running',
        icon: 'Zap',
        metrics: [
          { key: 'latency', value: '~50ms', labelAr: 'زمن الاستجابة' },
          { key: 'ws', value: '5s', labelAr: 'بث WebSocket' },
          { key: 'pine', value: '3 patterns', labelAr: 'Pine Script (Dead Cat + Golden + Divergence)' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'buy_threshold', label: 'BUY Threshold', labelAr: 'حد الشراء', type: 'slider' as const, value: 68, min: 0, max: 100, step: 1 },
          { key: 'hold_threshold', label: 'HOLD Threshold', labelAr: 'حد الانتظار', type: 'slider' as const, value: 45, min: 0, max: 100, step: 1 },
          { key: 'trap_vol', label: 'Trap Vol Threshold', labelAr: 'حد فخ المضارب', type: 'slider' as const, value: 1.2, min: 0, max: 3, step: 0.1 },
          { key: 'active', label: 'Active', labelAr: 'نشط', type: 'toggle' as const, value: true },
        ],
        connections: { in: ['data-engine'], out: ['prediction-optimizer', 'alerts-engine', 'sniper-bot'] },
      },
    },
    {
      id: 'narrative-gen',
      type: 'scada',
      position: { x: 1100, y: 200 },
      data: {
        label: 'NarrativeGenerator',
        labelAr: 'مولد السرد البشري',
        category: 'Engine',
        status: 'running',
        icon: 'MessageSquare',
        metrics: [
          { key: 'ai', value: 'Ollama glm-fast', labelAr: 'محرك AI' },
          { key: 'rag', value: 'stock_stories', labelAr: 'RAG من القصص' },
          { key: 'fallback', value: 'build_humanized_reason', labelAr: 'fallback آمن' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['prediction-optimizer'], out: ['performance'] },
      },
    },
    {
      id: 'telegram-ai',
      type: 'scada',
      position: { x: 1100, y: 350 },
      data: {
        label: 'TelegramAIPipeline',
        labelAr: 'بايبلاين التليجرام',
        category: 'Engine',
        status: 'running',
        icon: 'Send',
        metrics: [
          { key: 'keywords', value: 'news + pick', labelAr: 'فلترة كلمات مفتاحية' },
          { key: 'ai', value: 'Ollama glm-fast', labelAr: 'استخراج JSON' },
          { key: 'tables', value: 'telegram_news + signals', labelAr: 'جدولين جديدين' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'alerts-engine',
      type: 'scada',
      position: { x: 1100, y: 500 },
      data: {
        label: 'AlertsEngine',
        labelAr: 'محرك التنبيهات',
        category: 'Engine',
        status: 'running',
        icon: 'Bell',
        metrics: [
          { key: 'types', value: '7 types', labelAr: '7 أنواع تنبيهات' },
          { key: 'sound', value: 'Web Audio API', labelAr: 'صوت (up/down/neutral)' },
          { key: 'debounce', value: '5 min', labelAr: 'debounce لكل تنبيه' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'sound_enabled', label: 'Sound', labelAr: 'الصوت', type: 'toggle' as const, value: true },
          { key: 'notif_enabled', label: 'Browser Notifications', labelAr: 'إشعارات المتصفح', type: 'toggle' as const, value: false },
        ],
        connections: { in: ['live-engine'], out: [] },
      },
    },
    {
      id: 'paywall',
      type: 'scada',
      position: { x: 1100, y: 650 },
      data: {
        label: 'Paywall (Freemium)',
        labelAr: 'نظام الاشتراكات',
        category: 'Gate',
        status: 'running',
        icon: 'Lock',
        metrics: [
          { key: 'free', value: 'Top 3 + 15s delay', labelAr: 'مجاني: Top 3 + تأخير 15s' },
          { key: 'pro', value: 'All + 5s real-time', labelAr: 'مدفوع: كل حاجة + 5s لحظي' },
          { key: 'fomo', value: 'Missed opportunities', labelAr: 'FOMO Engine' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'blur_tickers', label: 'Blur Tickers (Free)', labelAr: 'تشويش الأسماء', type: 'toggle' as const, value: true },
          { key: 'throttle_ws', label: 'Throttle WebSocket (Free)', labelAr: 'إبطاء WebSocket', type: 'toggle' as const, value: true },
        ],
        connections: { in: ['data-engine'], out: ['performance'] },
      },
    },
    {
      id: 'crypto-pro',
      type: 'scada',
      position: { x: 200, y: 500 },
      data: {
        label: 'CryptoProEngine',
        labelAr: 'محرك الكريبتو الاحترافي',
        category: 'Engine',
        status: 'running',
        icon: 'Bitcoin',
        metrics: [
          { key: 'vol_override', value: 'ATR×2 / max 4%', labelAr: 'Volatility Override' },
          { key: 'scam_filter', value: '50M cap + 1M vol', labelAr: 'Scam Filter' },
          { key: 'wick', value: 'candle_close', labelAr: 'Wick Protection' },
          { key: 'rr', value: '≥ 2.0', labelAr: 'R/R إجباري' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'min_market_cap', label: 'Min Market Cap (USD)', labelAr: 'أقل قيمة سوقية', type: 'slider' as const, value: 50000000, min: 0, max: 500000000, step: 10000000 },
          { key: 'min_volume', label: 'Min 24h Volume (USD)', labelAr: 'أقل حجم 24س', type: 'slider' as const, value: 1000000, min: 0, max: 10000000, step: 500000 },
          { key: 'interval', label: 'Fetch Interval (sec)', labelAr: 'فترة السحب', type: 'slider' as const, value: 120, min: 30, max: 600, step: 30 },
        ],
        connections: { in: ['data-engine'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'kill-switch',
      type: 'scada',
      position: { x: 500, y: 600 },
      data: {
        label: 'KillSwitch',
        labelAr: 'مصفدة الأهداف',
        category: 'Gate',
        status: 'running',
        icon: 'Shield',
        metrics: [
          { key: 'target', value: 'target > entry (BUY)', labelAr: 'الهدف > الدخول' },
          { key: 'stop', value: 'stop < entry (BUY)', labelAr: 'الوقف < الدخول' },
          { key: 'rr', value: 'R/R < 1.0 → HOLD', labelAr: 'R/R ضعيف → انتظار' },
          { key: 'penny', value: '< 1 EGP → 2M turnover', labelAr: 'Penny Stocks → 2M' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['prediction-optimizer'], out: ['performance'] },
      },
    },
    {
      id: 'sniper-bot',
      type: 'scada',
      position: { x: 1100, y: 800 },
      data: {
        label: 'TelegramSniperBot',
        labelAr: 'بوت القناص',
        category: 'Output',
        status: 'running',
        icon: 'Crosshair',
        metrics: [
          { key: 'threshold', value: 'Score ≥ 75', labelAr: 'عتبة الإشعار' },
          { key: 'cooldown', value: '30 min', labelAr: 'cooldown لكل سهم' },
          { key: 'cron', value: '5 min', labelAr: 'كل 5 دقايق' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [
          { key: 'score_threshold', label: 'Score Threshold', labelAr: 'حد النتيجة', type: 'slider' as const, value: 75, min: 50, max: 100, step: 1 },
          { key: 'cooldown_min', label: 'Cooldown (min)', labelAr: 'فترة الانتظار', type: 'slider' as const, value: 30, min: 5, max: 120, step: 5 },
        ],
        connections: { in: ['live-engine'], out: [] },
      },
    },
    {
      id: 'feedback-loop',
      type: 'scada',
      position: { x: 500, y: 750 },
      data: {
        label: 'FeedbackLoop',
        labelAr: 'حلقة التغذية الراجعة',
        category: 'Engine',
        status: 'running',
        icon: 'RefreshCw',
        metrics: [
          { key: 'schedule', value: '15:30 daily', labelAr: 'بعد القفلة' },
          { key: 'threshold', value: '70% loss → alert', labelAr: '70% خسارة → إنذار' },
          { key: 'stories', value: 'auto-generate', labelAr: 'توليد قصص تلقائي' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['daily-closer'], out: ['narrative-gen'] },
      },
    },
    {
      id: 'early-trend',
      type: 'scada',
      position: { x: 200, y: 350 },
      data: {
        label: 'EarlyTrendCatcher',
        labelAr: 'ماسح الترند المبكر',
        category: 'Engine',
        status: 'running',
        icon: 'Rocket',
        metrics: [
          { key: 'vol_dryup', value: '< 0.6× avg', labelAr: 'نضوب البيع' },
          { key: 'reversal', value: 'close > SMA20', labelAr: 'بداية الانعكاس' },
          { key: 'support', value: '< 3% from support', labelAr: 'ارتداد من الدعم' },
          { key: 'boost', value: '+15 pts', labelAr: 'رفع النتيجة' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: ['explosive-scanner'], out: ['prediction-optimizer'] },
      },
    },
    {
      id: 'platform-guide',
      type: 'scada',
      position: { x: 800, y: 800 },
      data: {
        label: 'PlatformGuide',
        labelAr: 'مركز المساعدة التفاعلي',
        category: 'Output',
        status: 'running',
        icon: 'HelpCircle',
        metrics: [
          { key: 'sections', value: '5 sections', labelAr: '5 أقسام تفاعلية' },
          { key: 'auto_open', value: '3s first visit', labelAr: 'فتح تلقائي' },
          { key: 'persistence', value: 'localStorage', labelAr: 'حفظ في المتصفح' },
        ],
        lastUpdate: new Date().toISOString(),
        params: [],
        connections: { in: [], out: [] },
      },
    },
  ];

  nodes.push(...phase5Nodes);
  return nodes;
}

// ============== Build Initial Edges ==============

function buildInitialEdges(): Edge[] {
  const edges: Edge[] = [
    // Data flow edges (teal, dashed)
    { id: 'e-eodhd-egx', source: 'eodhd-api', target: 'egx-data', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-eodhd-ph', source: 'eodhd-api', target: 'price-history-db', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-egx-de', source: 'egx-data', target: 'data-engine', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-egx-mr', source: 'egx-data', target: 'market-regime', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-egx-ph', source: 'egx-data', target: 'price-history-db', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-sniper', source: 'data-engine', target: 'sniper-engine', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-conf', source: 'data-engine', target: 'confluence', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-flow', source: 'data-engine', target: 'flow-system', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-sniper-explosive', source: 'sniper-engine', target: 'explosive-scanner', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-ph-expert', source: 'price-history-db', target: 'expert-memory', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-ph-fundamentals', source: 'price-history-db', target: 'stock-fundamentals', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-crypto-predictions', source: 'crypto-engine', target: 'predictions', type: 'scada', data: { category: 'output' } },
    { id: 'e-crypto-signals', source: 'crypto-engine', target: 'signals', type: 'scada', data: { category: 'output' } },
    { id: 'e-flow-predictions', source: 'flow-system', target: 'predictions', type: 'scada', data: { category: 'output' }, animated: true },
    { id: 'e-flow-signals', source: 'flow-system', target: 'signals', type: 'scada', data: { category: 'output' } },

    // Control edges (orange, solid thick)
    { id: 'e-sniper-gate', source: 'sniper-engine', target: 'egx30-gate', type: 'scada', data: { category: 'control' } },
    { id: 'e-sniper-trend', source: 'sniper-engine', target: 'trend-filter', type: 'scada', data: { category: 'control' } },
    { id: 'e-mr-qg', source: 'market-regime', target: 'quality-gate', type: 'scada', data: { category: 'control' } },
    { id: 'e-mr-sched', source: 'market-regime', target: 'scheduler', type: 'scada', data: { category: 'control' } },
    { id: 'e-sched-closer', source: 'scheduler', target: 'daily-closer', type: 'scada', data: { category: 'control' } },

    // Output edges (amber, solid)
    { id: 'e-sniper-pred', source: 'sniper-engine', target: 'predictions', type: 'scada', data: { category: 'output' } },
    { id: 'e-gate-pred', source: 'egx30-gate', target: 'predictions', type: 'scada', data: { category: 'output' } },
    { id: 'e-conf-signals', source: 'confluence', target: 'signals', type: 'scada', data: { category: 'output' } },
    { id: 'e-trend-signals', source: 'trend-filter', target: 'signals', type: 'scada', data: { category: 'output' } },
    { id: 'e-closer-reports', source: 'daily-closer', target: 'reports', type: 'scada', data: { category: 'output' } },

    // Feedback edges (purple, dotted)
    { id: 'e-trend-conf', source: 'trend-filter', target: 'confluence', type: 'scada', data: { category: 'feedback' } },
    { id: 'e-expert-conf', source: 'expert-memory', target: 'confluence', type: 'scada', data: { category: 'feedback' } },

    // Board of Analysts edges (gold — data in, signal out)
    { id: 'e-de-board', source: 'data-engine', target: 'board-of-analysts', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-conf-board', source: 'confluence', target: 'board-of-analysts', type: 'scada', data: { category: 'feedback' } },
    { id: 'e-expert-board', source: 'expert-memory', target: 'board-of-analysts', type: 'scada', data: { category: 'feedback' } },
    { id: 'e-board-pred', source: 'board-of-analysts', target: 'predictions', type: 'scada', data: { category: 'output' } },
    { id: 'e-board-signals', source: 'board-of-analysts', target: 'signals', type: 'scada', data: { category: 'output' } },

    // === NEW ENGINE CONNECTIONS (July 2026) ===
    { id: 'e-de-enhanced', source: 'data-engine', target: 'enhanced-indicators', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-mtf', source: 'data-engine', target: 'multi-timeframe', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-vol', source: 'data-engine', target: 'volume-profile', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-enhanced-opt', source: 'enhanced-indicators', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-mtf-opt', source: 'multi-timeframe', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-vol-opt', source: 'volume-profile', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-mr-adaptive', source: 'market-regime', target: 'adaptive-weights', type: 'scada', data: { category: 'control' } },
    { id: 'e-adaptive-opt', source: 'adaptive-weights', target: 'prediction-optimizer', type: 'scada', data: { category: 'control' } },
    { id: 'e-closer-learning', source: 'daily-closer', target: 'learning-engine', type: 'scada', data: { category: 'control' } },
    { id: 'e-learning-adaptive', source: 'learning-engine', target: 'adaptive-weights', type: 'scada', data: { category: 'feedback' } },
    { id: 'e-opt-predictions', source: 'prediction-optimizer', target: 'predictions', type: 'scada', data: { category: 'output' }, animated: true },
    { id: 'e-opt-perf', source: 'prediction-optimizer', target: 'performance', type: 'scada', data: { category: 'feedback' } },

    // === NEW EDGES (July 2026 — DOCS-UPDATE-021: TUNING-V3 + Presets + RAG + DB Safety) ===
    { id: 'e-enhanced-layers', source: 'enhanced-indicators', target: 'analysis-layers', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-mr-layers', source: 'market-regime', target: 'analysis-layers', type: 'scada', data: { category: 'control' } },
    { id: 'e-layers-opt', source: 'analysis-layers', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-expert-rag', source: 'expert-memory', target: 'rag-ai', type: 'scada', data: { category: 'feedback' } },
    { id: 'e-ph-rag', source: 'price-history-db', target: 'rag-ai', type: 'scada', data: { category: 'data' } },
    { id: 'e-rag-opt', source: 'rag-ai', target: 'prediction-optimizer', type: 'scada', data: { category: 'control' }, animated: true },
    { id: 'e-de-presets', source: 'data-engine', target: 'stock-presets', type: 'scada', data: { category: 'output' } },
    { id: 'e-fund-presets', source: 'stock-fundamentals', target: 'stock-presets', type: 'scada', data: { category: 'output' } },
    { id: 'e-ph-dbsafety', source: 'price-history-db', target: 'db-safety', type: 'scada', data: { category: 'control' } },
    { id: 'e-expert-dbsafety', source: 'expert-memory', target: 'db-safety', type: 'scada', data: { category: 'control' } },

    // === NEW STRATEGIC EDGES (July 2026 — DOCS-UPDATE-026: Free Float + Position Sizing + Macro Veto) ===
    // Data engine → strategic features (they read stocks + macro_indicators)
    { id: 'e-de-freefloat', source: 'data-engine', target: 'free-float-filter', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-position', source: 'data-engine', target: 'position-sizing', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-de-macro', source: 'data-engine', target: 'macro-veto', type: 'scada', data: { category: 'data' }, animated: true },
    // Free Float affects liquidity in analysis-layers
    { id: 'e-freefloat-layers', source: 'free-float-filter', target: 'analysis-layers', type: 'scada', data: { category: 'data' }, animated: true },
    // Macro Veto affects final score in prediction-optimizer
    { id: 'e-macro-opt', source: 'macro-veto', target: 'prediction-optimizer', type: 'scada', data: { category: 'control' }, animated: true },
    // Position Sizing affects final recommendation in prediction-optimizer
    { id: 'e-position-opt', source: 'position-sizing', target: 'prediction-optimizer', type: 'scada', data: { category: 'control' }, animated: true },
    // HEDGE-FUND-036: prediction-optimizer feeds hedge-fund-metrics
    { id: 'e-opt-hfm', source: 'prediction-optimizer', target: 'hedge-fund-metrics', type: 'scada', data: { category: 'data' }, animated: true },
    // HEDGE-FUND-036: hedge-fund-metrics feeds performance
    { id: 'e-hfm-perf', source: 'hedge-fund-metrics', target: 'performance', type: 'scada', data: { category: 'data' }, animated: true },

    // === PHASE5-053: NEW EDGES (July 2026 — Live + Paywall + Crypto Pro + Safety) ===
    // Live Engine
    { id: 'e-de-live', source: 'data-engine', target: 'live-engine', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-live-opt', source: 'live-engine', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-live-alerts', source: 'live-engine', target: 'alerts-engine', type: 'scada', data: { category: 'control' }, animated: true },
    { id: 'e-live-sniper', source: 'live-engine', target: 'sniper-bot', type: 'scada', data: { category: 'control' }, animated: true },
    // Narrative Generator
    { id: 'e-opt-narr', source: 'prediction-optimizer', target: 'narrative-gen', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-narr-perf', source: 'narrative-gen', target: 'performance', type: 'scada', data: { category: 'data' }, animated: true },
    // Telegram AI
    { id: 'e-de-tg', source: 'data-engine', target: 'telegram-ai', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-tg-opt', source: 'telegram-ai', target: 'prediction-optimizer', type: 'scada', data: { category: 'control' }, animated: true },
    // Paywall
    { id: 'e-de-paywall', source: 'data-engine', target: 'paywall', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-paywall-perf', source: 'paywall', target: 'performance', type: 'scada', data: { category: 'control' }, animated: true },
    // Crypto Pro
    { id: 'e-de-crypto-pro', source: 'data-engine', target: 'crypto-pro', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-crypto-pro-opt', source: 'crypto-pro', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
    // Kill Switch
    { id: 'e-opt-ks', source: 'prediction-optimizer', target: 'kill-switch', type: 'scada', data: { category: 'control' }, animated: true },
    { id: 'e-ks-perf', source: 'kill-switch', target: 'performance', type: 'scada', data: { category: 'control' }, animated: true },
    // Feedback Loop
    { id: 'e-dc-fb', source: 'daily-closer', target: 'feedback-loop', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-fb-narr', source: 'feedback-loop', target: 'narrative-gen', type: 'scada', data: { category: 'data' }, animated: true },
    // Early Trend
    { id: 'e-exp-early', source: 'explosive-scanner', target: 'early-trend', type: 'scada', data: { category: 'data' }, animated: true },
    { id: 'e-early-opt', source: 'early-trend', target: 'prediction-optimizer', type: 'scada', data: { category: 'data' }, animated: true },
  ];

  return edges;
}

// ============== Main Component ==============

function MaestroCommandCenterInner() {
  const [topologyData, setTopologyData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showOptimizerPanel, setShowOptimizerPanel] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [paramEdits, setParamEdits] = useState<Record<string, Record<string, number | boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [marketRegime, setMarketRegime] = useState<string | null>(null);
  const [sniperPending, setSniperPending] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reactFlowRef = useRef<HTMLDivElement>(null);

  // P39-COMMAND-CENTER: Engine Control state
  const [engineControl, setEngineControl] = useState<EngineControlStatus | null>(null);
  const [triggeringEngine, setTriggeringEngine] = useState<string | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [engineWeightsEdits, setEngineWeightsEdits] = useState<Record<string, { weight?: number; sensitivity?: number; threshold?: number }>>({});
  const [advancedEdits, setAdvancedEdits] = useState<Record<string, Record<string, number | boolean>>>({});
  const [autoRegimeLocal, setAutoRegimeLocal] = useState<boolean>(true);

  const setCurrentView = useAppStore((state) => state.setCurrentView);

  // Nodes/Edges state
  const [nodes, setNodes, onNodesChange] = useNodesState(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildInitialEdges());

  // Computed selected node data
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) as Node<CustomNodeData> | undefined;
  }, [selectedNodeId, nodes]);

  // ============== Add activity helper ==============

  const addActivity = useCallback((message: string, type: ActivityEntry['type'] = 'info') => {
    setActivities((prev) => {
      const entry: ActivityEntry = {
        id: `act-${Date.now()}-${++activityIdCounter}`,
        message,
        timestamp: new Date(),
        type,
      };
      return [entry, ...prev].slice(0, 8);
    });
  }, []);

  // ============== P39-COMMAND-CENTER: Engine Control fetch & mutations ==============

  const fetchEngineControl = useCallback(async () => {
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/admin/engine-control/status', {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as EngineControlStatus;
      setEngineControl(json);
      if (typeof json.autoRegime === 'boolean') {
        setAutoRegimeLocal(json.autoRegime);
      }
    } catch {
      // Backend (P39-6) may not be deployed yet — fail silently.
    }
  }, []);

  const toggleEngine = useCallback(async (engineId: string, active: boolean) => {
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/admin/engine-control/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ engineId, active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(active ? 'تم تفعيل المحرك' : 'تم إيقاف المحرك');
      addActivity(`${active ? 'تفعيل' : 'إيقاف'} المحرك: ${engineId}`, active ? 'success' : 'warning');
      fetchEngineControl();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل التبديل: ${msg}`);
      addActivity(`فشل تبديل ${engineId}: ${msg}`, 'error');
    }
  }, [addActivity, fetchEngineControl]);

  const saveEngineWeights = useCallback(async (engineId: string) => {
    const edits = engineWeightsEdits[engineId];
    if (!edits) return;
    try {
      const token = await getAdminToken();
      const body: Record<string, number> = {};
      if (typeof edits.weight === 'number') body.weight = edits.weight;
      if (typeof edits.sensitivity === 'number') body.sensitivity = edits.sensitivity;
      if (typeof edits.threshold === 'number') body.threshold = edits.threshold;
      const res = await fetch('/api/admin/engine-control/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ engineId, ...body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('تم حفظ أوزان المحرك');
      addActivity(`حفظ أوزان ${engineId}`, 'success');
      setEngineWeightsEdits((prev) => {
        const next = { ...prev };
        delete next[engineId];
        return next;
      });
      fetchEngineControl();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل حفظ الأوزان: ${msg}`);
      addActivity(`فشل حفظ أوزان ${engineId}: ${msg}`, 'error');
    }
  }, [engineWeightsEdits, addActivity, fetchEngineControl]);

  const triggerEngine = useCallback(async (engineId: string) => {
    setTriggeringEngine(engineId);
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/admin/engine-control/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ engineId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('تم تشغيل المحرك بنجاح');
      addActivity(`تشغيل يدوي: ${engineId}`, 'success');
      fetchEngineControl();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('فشل التشغيل');
      addActivity(`فشل تشغيل ${engineId}: ${msg}`, 'error');
    } finally {
      setTriggeringEngine(null);
    }
  }, [addActivity, fetchEngineControl]);

  const triggerFullBenchmark = useCallback(async () => {
    if (benchmarkRunning) return;
    setBenchmarkRunning(true);
    const engines = MAESTRO_ENGINE_IDS as readonly string[];
    try {
      const token = await getAdminToken();
      for (let i = 0; i < engines.length; i++) {
        const engineId = engines[i];
        toast.loading(`تشغيل الدورة الكاملة: ${i + 1}/${engines.length}...`, { id: 'benchmark-toast' });
        try {
          const res = await fetch('/api/admin/engine-control/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
            body: JSON.stringify({ engineId }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          addActivity(`دورة شاملة (${i + 1}/${engines.length}): ${engineId}`, 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addActivity(`فشل في الدورة الشاملة: ${engineId}: ${msg}`, 'error');
        }
        if (i < engines.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      toast.success('اكتملت الدورة الكاملة لجميع المحركات', { id: 'benchmark-toast' });
      fetchEngineControl();
    } finally {
      setBenchmarkRunning(false);
    }
  }, [benchmarkRunning, addActivity, fetchEngineControl]);

  const toggleAutoRegime = useCallback((next: boolean) => {
    setAutoRegimeLocal(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('engineControl.autoRegime', next ? 'true' : 'false');
      }
    } catch {
      // ignore storage errors
    }
    toast.success(next ? 'تم تفعيل الوضع التلقائي' : 'تم تفعيل التحكم اليدوي');
    addActivity(next ? 'تفعيل الوضع التلقائي' : 'تفعيل التحكم اليدوي', next ? 'info' : 'warning');
  }, [addActivity]);

  const saveAdvancedParams = useCallback(async (engineId: string) => {
    const edits = advancedEdits[engineId];
    if (!edits) return;
    try {
      // Reuse the weights endpoint with a special "advanced" payload shape.
      const token = await getAdminToken();
      const res = await fetch('/api/admin/engine-control/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ engineId, advanced: edits }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('تم حفظ الإعدادات المتقدّمة');
      addActivity(`حفظ إعدادات متقدّمة: ${engineId}`, 'success');
      setAdvancedEdits((prev) => {
        const next = { ...prev };
        delete next[engineId];
        return next;
      });
      fetchEngineControl();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل حفظ الإعدادات المتقدّمة: ${msg}`);
      addActivity(`فشل حفظ الإعدادات المتقدّمة لـ ${engineId}: ${msg}`, 'error');
    }
  }, [advancedEdits, addActivity, fetchEngineControl]);

  // ============== Data fetching ==============

  const fetchData = useCallback(async () => {
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/admin/system-topology', {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTopologyData(json);
      setLastUpdate(new Date());
      setSecondsAgo(0);
      setError(null);

      // Update node statuses from topology data
      if (json.services) {
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            const nd = node as Node<CustomNodeData>;
            // Map service data to nodes
            const serviceMapping: Record<string, string> = {
              'data-engine': 'data',
              'sniper-engine': 'sniper',
              'confluence': 'confluence',
              'market-regime': 'maestro',
              'scheduler': 'scheduler',
              'egx30-gate': 'gate',
              'trend-filter': 'trend',
              'quality-gate': 'quality',
              'daily-closer': 'closer',
              'expert-memory': 'memory',
              'eodhd-api': 'eodhd',
              'egx-data': 'egx',
              'flow-system': 'flow',
              'explosive-scanner': 'explosive',
              'crypto-engine': 'crypto',
              'stock-fundamentals': 'fundamentals',
            };
            const searchKey = serviceMapping[nd.id] || nd.id.toLowerCase();
            const matchingService = json.services.find((s: ServiceNode) =>
              s.name.toLowerCase().includes(searchKey) || s.kind.toLowerCase().includes(searchKey)
            );
            if (matchingService) {
              const newStatus = getStaleness(matchingService.last_update);
              const effectiveStatus: NodeStatus =
                matchingService.status === 'running' || matchingService.status === 'enabled'
                  ? 'running'
                  : matchingService.status === 'degraded'
                  ? 'degraded'
                  : matchingService.status === 'stopped' || matchingService.status === 'disabled'
                  ? 'stopped'
                  : matchingService.status === 'error'
                  ? 'error'
                  : newStatus;

              return {
                ...node,
                data: {
                  ...nd.data,
                  status: effectiveStatus,
                  lastUpdate: matchingService.last_update || nd.data.lastUpdate,
                },
              };
            }
            return node;
          })
        );
      }

      // Update DB nodes from topology data
      if (json.databases) {
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            const nd = node as Node<CustomNodeData>;
            if (nd.data.category === 'DataSource' || nd.id === 'price-history-db') {
              const dbName = nd.data.label.replace('.db', '');
              const matchingDb = json.databases.find((d: DatabaseNode) =>
                d.name.toLowerCase().includes(dbName.toLowerCase())
              );
              if (matchingDb) {
                return {
                  ...node,
                  data: {
                    ...nd.data,
                    status: matchingDb.status === 'healthy' ? 'healthy' : matchingDb.status === 'missing' ? 'error' : 'degraded',
                    lastUpdate: matchingDb.last_write || nd.data.lastUpdate,
                    metrics: nd.data.metrics.map((m) => {
                      if (m.key === 'size') return { ...m, value: `${Math.round(matchingDb.size_kb / 1024)} MB` };
                      if (m.key === 'tables' && matchingDb.size_kb > 0) return { ...m, value: `${matchingDb.size_kb}` };
                      return m;
                    }),
                  },
                };
              }
            }
            return node;
          })
        );
      }

      // Update Board of Analysts node from topology boards data
      if (json.boards) {
        const boardsData = json.boards as TopologyData['boards'];
        const marketsCount = Object.keys(boardsData || {}).length;
        const boardActive = json.board_system_active === true;

        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            if (node.id !== 'board-of-analysts') return node;
            const nd = node as Node<CustomNodeData>;
            const activeMarkets = Object.values(boardsData || {}).filter((b) => b.status === 'active');
            const analystCount = activeMarkets.length > 0
              ? Object.keys(activeMarkets[0].analysts || {}).length
              : 6;
            const firstStrategy = activeMarkets[0]?.sell_strategy || 'Swing';

            return {
              ...node,
              data: {
                ...nd.data,
                status: boardActive ? 'running' : 'error',
                lastUpdate: json.timestamp || nd.data.lastUpdate,
                metrics: [
                  { key: 'markets', value: `${marketsCount}`, labelAr: 'أسواق' },
                  { key: 'analysts', value: `${analystCount}`, labelAr: 'محللون' },
                  { key: 'strategy', value: firstStrategy, labelAr: 'الاستراتيجية' },
                ],
              },
            };
          })
        );
      }

    } catch (err) {

      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [setNodes]);

  const fetchSniperPending = useCallback(async () => {
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/sniper/closer/pending', {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = await res.json();
      const pending = json.pending || json.count || json.total || 0;
      const count = typeof pending === 'number' ? pending : Array.isArray(pending) ? pending.length : 0;
      setSniperPending(count);

      // Update predictions node
      setNodes((prev) =>
        prev.map((n) => {
          const nd = n as Node<CustomNodeData>;
          if (nd.id === 'predictions') {
            return {
              ...n,
              data: {
                ...nd.data,
                metrics: nd.data.metrics.map((m) =>
                  m.key === 'active' ? { ...m, value: String(count) } : m
                ),
              },
            };
          }
          if (nd.id === 'daily-closer') {
            return {
              ...n,
              data: {
                ...nd.data,
                metrics: nd.data.metrics.map((m) =>
                  m.key === 'pending' ? { ...m, value: String(count) } : m
                ),
              },
            };
          }
          return n;
        })
      );
    } catch {
      // silently fail
    }
  }, [setNodes]);

  const fetchMarketRegime = useCallback(async () => {
    try {
      const token = await getAdminToken();
      const res = await fetch('/api/python/maestro/regime?market=EGX', {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      });
      if (!res.ok) {
        setMarketRegime('غير متاح');
        return;
      }
      const json = await res.json();
      const regime = json.regime || json.market_regime || json.status || null;
      setMarketRegime(regime || 'غير متاح');

      // Update market regime node
      if (regime) {
        setNodes((prev) =>
          prev.map((n) => {
            const nd = n as Node<CustomNodeData>;
            if (nd.id === 'market-regime') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  metrics: nd.data.metrics.map((m) =>
                    m.key === 'regime' ? { ...m, value: regime } : m
                  ),
                },
              };
            }
            return n;
          })
        );
      }
    } catch {
      setMarketRegime('غير متاح');
    }
  }, [setNodes]);

  // ============== Live Stats Fetcher ==============
  // Fetches live data from EODHD, Market Pulse, and Crypto endpoints
  // to update node metrics dynamically instead of showing hardcoded values.

  const fetchLiveStats = useCallback(async () => {
    try {
      const [eodhdRes, pulseRes, cryptoRes] = await Promise.allSettled([
        fetch('/api/eodhd/backfill-status', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/market-pulse', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/crypto/live', { cache: 'no-store' }).then((r) => r.json()),
      ]);

      setNodes((prev) =>
        prev.map((n) => {
          const nd = n as Node<CustomNodeData>;

          // === EODHD backfill status → egx-data + price-history-db + eodhd-api ===
          if (eodhdRes.status === 'fulfilled' && eodhdRes.value?.success) {
            const eod = eodhdRes.value as {
              total_stocks?: number;
              stocks_with_history?: number;
              total_records?: number;
              newest_date?: string;
            };
            const totalStocks = eod.total_stocks ?? 281;
            const stocksWithHistory = eod.stocks_with_history ?? 0;
            const totalRecords = eod.total_records ?? 0;

            // Format records count compactly (e.g. 120K, 1.2M)
            const formatRecords = (n: number): string => {
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1_000) return `${Math.round(n / 1000)}K`;
              return `${n}`;
            };

            if (nd.id === 'eodhd-api') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  lastUpdate: new Date().toISOString(),
                  metrics: nd.data.metrics.map((m) => {
                    if (m.key === 'stocks') return { ...m, value: `${totalStocks}` };
                    return m;
                  }),
                },
              };
            }

            if (nd.id === 'egx-data') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  lastUpdate: new Date().toISOString(),
                  metrics: nd.data.metrics.map((m) => {
                    if (m.key === 'stocks') return { ...m, value: `${totalStocks}` };
                    if (m.key === 'history') return { ...m, value: `${stocksWithHistory}` };
                    if (m.key === 'sync') return { ...m, value: eod.newest_date || 'live' };
                    return m;
                  }),
                },
              };
            }

            if (nd.id === 'price-history-db') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  lastUpdate: new Date().toISOString(),
                  metrics: nd.data.metrics.map((m) => {
                    if (m.key === 'rows') return { ...m, value: formatRecords(totalRecords) };
                    return m;
                  }),
                },
              };
            }
          }

          // === Market Pulse → market-regime ===
          if (pulseRes.status === 'fulfilled' && pulseRes.value?.success) {
            const pulse = pulseRes.value as {
              data?: {
                pulse?: { score?: number; label?: string; label_en?: string };
                egx30?: { change_percent?: number };
                breadth?: { gainers?: number; losers?: number };
                divergence?: { regime?: string; regime_ar?: string; action_ar?: string };
              };
            };
            const pulseData = pulse.data;
            const pulseScore = pulseData?.pulse?.score;
            const pulseLabel = pulseData?.pulse?.label_en;
            const regimeAr = pulseData?.divergence?.regime_ar;
            const gainers = pulseData?.breadth?.gainers ?? 0;
            const losers = pulseData?.breadth?.losers ?? 0;
            const breadth = `${gainers}▲/${losers}▼`;

            if (nd.id === 'market-regime') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  lastUpdate: new Date().toISOString(),
                  metrics: nd.data.metrics.map((m) => {
                    if (m.key === 'regime') return { ...m, value: regimeAr || pulseLabel || m.value };
                    if (m.key === 'confidence') return { ...m, value: pulseScore != null ? `${pulseScore.toFixed(1)}` : m.value };
                    if (m.key === 'change') return { ...m, value: breadth };
                    return m;
                  }),
                },
              };
            }
          }

          // === Crypto Live → crypto-engine ===
          if (cryptoRes.status === 'fulfilled' && cryptoRes.value?.success) {
            const crypto = cryptoRes.value as {
              data?: {
                total_coins?: number;
                total_market_cap?: number;
                gainers_count?: number;
                losers_count?: number;
              };
            };
            const cryptoData = crypto.data;
            const totalCoins = cryptoData?.total_coins ?? 111;
            const totalMcap = cryptoData?.total_market_cap ?? 0;

            // Format market cap compactly (e.g. $2.3T, $845B)
            const formatMcap = (v: number): string => {
              if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
              if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
              if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
              return v > 0 ? `$${v}` : '—';
            };

            if (nd.id === 'crypto-engine') {
              return {
                ...n,
                data: {
                  ...nd.data,
                  lastUpdate: new Date().toISOString(),
                  metrics: nd.data.metrics.map((m) => {
                    if (m.key === 'coins') return { ...m, value: `${totalCoins}` };
                    if (m.key === 'mcap') return { ...m, value: formatMcap(totalMcap) };
                    return m;
                  }),
                },
              };
            }
          }

          return n;
        })
      );
    } catch (e) {
      console.error('Live stats fetch error:', e);
    }
  }, [setNodes]);

  // ============== Effects ==============

  useEffect(() => {
    fetchData();
    fetchSniperPending();
    fetchMarketRegime();
    fetchLiveStats();
    fetchEngineControl();
  }, [fetchData, fetchSniperPending, fetchMarketRegime, fetchLiveStats, fetchEngineControl]);

  useEffect(() => {
    if (!autoRefresh || !liveMode) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, liveMode, fetchData]);

  // P39-COMMAND-CENTER: poll engine-control status every 5s (covers throughput counter + log refresh)
  useEffect(() => {
    if (!liveMode) return;
    const interval = setInterval(fetchEngineControl, 5000);
    return () => clearInterval(interval);
  }, [liveMode, fetchEngineControl]);

  // P39-COMMAND-CENTER: hydrate autoRegime from localStorage on first mount
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const stored = window.localStorage.getItem('engineControl.autoRegime');
      if (stored !== null) setAutoRegimeLocal(stored === 'true');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((prev) => prev + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchSniperPending, 30000);
    return () => clearInterval(interval);
  }, [fetchSniperPending]);

  useEffect(() => {
    const interval = setInterval(fetchMarketRegime, 60000);
    return () => clearInterval(interval);
  }, [fetchMarketRegime]);

  useEffect(() => {
    const interval = setInterval(fetchLiveStats, 60000);
    return () => clearInterval(interval);
  }, [fetchLiveStats]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ============== Node click handler ==============

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  // ============== Reset view ==============

  const resetView = useCallback(() => {
    setNodes(buildInitialNodes());
    setEdges(buildInitialEdges());
    setSelectedNodeId(null);
  }, [setNodes, setEdges]);

  // ============== Export layout ==============

  const exportLayout = useCallback(() => {
    const layout = { nodes, edges };
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maestro-layout.json';
    a.click();
    URL.revokeObjectURL(url);
    addActivity('تم تصدير التخطيط', 'success');
  }, [nodes, edges, addActivity]);

  // ============== Parameter save ==============

  const saveParams = useCallback(async (nodeId: string) => {
    setSaving(true);
    try {
      const edits = paramEdits[nodeId];
      if (!edits) return;

      const nodeData = nodes.find((n) => n.id === nodeId) as Node<CustomNodeData> | undefined;
      if (!nodeData) return;

      const token = await getAdminToken();

      // Try different API endpoints based on node type
      if (nodeData.data.category === 'Engine') {
        // Use analysis-engine API
        const weight = edits.weight ?? nodeData.data.params.find((p) => p.key === 'weight')?.value;
        const state = edits.state ?? nodeData.data.params.find((p) => p.key === 'state')?.value;

        if (typeof weight === 'number') {
          await fetch(`/api/v2/pipeline/egx/engine/${nodeId}/weight`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
            body: JSON.stringify({ weight }),
          });
        }

        if (typeof state === 'boolean') {
          await fetch(`/api/v2/pipeline/egx/engine/${nodeId}/toggle`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
            body: JSON.stringify({ enabled: state }),
          });
        }
      }

      // Update local node state
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const nd = n as Node<CustomNodeData>;
          return {
            ...n,
            data: {
              ...nd.data,
              params: nd.data.params.map((p) => {
                if (edits[p.key] !== undefined) {
                  return { ...p, value: edits[p.key] as typeof p.value };
                }
                return p;
              }),
              status: typeof edits.state === 'boolean' ? (edits.state ? 'running' : 'stopped') : nd.data.status,
            },
          };
        })
      );

      setParamEdits((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });

      addActivity(`تم حفظ إعدادات ${nodeData.data.labelAr}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity(`خطأ في الحفظ: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [paramEdits, nodes, setNodes, addActivity]);

  // ============== Quick actions ==============

  const executeAction = useCallback(async (actionId: string, method: string, url: string, successMessage: string) => {
    try {
      const token = await getAdminToken();
      const options: RequestInit = {
        headers: { 'x-admin-token': token },
        cache: 'no-store',
      };
      if (method === 'POST') options.method = 'POST';
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addActivity(successMessage, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity(`خطأ: ${msg}`, 'error');
    }
  }, [addActivity]);

  // ============== Summary stats ==============

  const summary = topologyData?.summary;
  const healthScore = (summary?.health_score && summary.health_score > 0) ? summary.health_score : 64;
  const servicesUp = summary?.services_up ?? 0;
  const servicesTotal = summary?.services_total ?? 0;
  const flowsActive = summary?.flows_active ?? 0;
  const flowsTotal = summary?.flows_total ?? 0;

  // ============== Param value helper ==============

  const getParamValue = useCallback((nodeId: string, paramKey: string, originalValue: number | boolean): number | boolean => {
    return paramEdits[nodeId]?.[paramKey] ?? originalValue;
  }, [paramEdits]);

  const setParamValue = useCallback((nodeId: string, paramKey: string, value: number | boolean) => {
    setParamEdits((prev) => ({
      ...prev,
      [nodeId]: { ...(prev[nodeId] || {}), [paramKey]: value },
    }));
  }, []);

  // ============== Loading State ==============

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4" style={{ background: COLORS.bg }}>
        <Loader2 className="w-10 h-10 animate-spin" style={{ color: COLORS.gold }} />
        <p className="text-sm text-gray-400">جارٍ تحميل مركز القيادة...</p>
      </div>
    );
  }

  // ============== Render ==============

  return (
    <div
      ref={containerRef}
      className="w-full h-screen text-white overflow-hidden flex flex-col"
      style={{ background: COLORS.bg, fontFamily: 'inherit' }}
    >
      {/* ===== Top Toolbar ===== */}
      <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0" style={{ borderColor: COLORS.border, background: `${COLORS.card}f0` }}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5">
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowOptimizerPanel(true)} className="h-8 px-3 text-xs gap-1 text-cyan-400 hover:text-white hover:bg-cyan-500/10 border border-cyan-500/30">
            <Sliders className="w-3.5 h-3.5" />
            معاملات المحرك
          </Button>
          <Button variant="ghost" size="icon" onClick={fetchData} className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <Zap className="w-5 h-5" style={{ color: COLORS.gold }} />
            </motion.div>
            <h1 className="text-lg font-bold tracking-tight">Maestro Command Center</h1>
          </div>
        </div>

        {/* Center stats */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="w-2 h-2 rounded-full"
              style={{ background: liveMode ? COLORS.green : '#555', boxShadow: liveMode ? `0 0 6px ${COLORS.green}` : 'none' }}
            />
            <span className="text-xs font-bold" style={{ color: liveMode ? COLORS.green : '#555' }}>LIVE</span>
          </div>
          <span className="text-xs text-gray-400">{getTimeString()}</span>
          <span className="text-xs text-gray-500">•</span>
          <span className="text-xs text-gray-400">Update: {secondsAgo}s ago</span>
          <span className="text-xs text-gray-500">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Health</span>
            <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.card }}>
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${healthScore}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{ background: healthScore >= 80 ? COLORS.green : COLORS.orange }}
              />
            </div>
            <span className="text-xs font-bold" style={{ color: healthScore >= 80 ? COLORS.green : COLORS.orange }}>{healthScore}%</span>
          </div>
          <span className="text-xs text-gray-500">•</span>
          <span className="text-xs" style={{ color: COLORS.green }}>⚙️ {servicesUp}/{servicesTotal}</span>
          {marketRegime && marketRegime !== 'غير متاح' && (
            <>
              <span className="text-xs text-gray-500">•</span>
              <span className="text-xs" style={{ color: COLORS.gold }}>🌊 {marketRegime}</span>
            </>
          )}
        </div>

        {/* Right toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={resetView} className="h-7 text-xs gap-1 text-gray-400 hover:text-white hover:bg-white/5">
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const newLive = !liveMode;
              setLiveMode(newLive);
              setAutoRefresh(newLive);
              addActivity(newLive ? 'تم تفعيل الوضع الحي' : 'تم إيقاف الوضع الحي', newLive ? 'success' : 'warning');
            }}
            className={cn("h-7 text-xs gap-1", liveMode ? "text-green-400" : "text-gray-500")}
          >
            {liveMode ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {liveMode ? 'LIVE' : 'OFF'}
          </Button>
          <Button variant="ghost" size="sm" onClick={exportLayout} className="h-7 text-xs gap-1 text-gray-400 hover:text-white hover:bg-white/5">
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* ===== P39-COMMAND-CENTER: Master Toolbar (Pillar 4) ===== */}
      <div
        dir="rtl"
        className="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 flex-wrap"
        style={{ borderColor: COLORS.border, background: `${COLORS.card}c0` }}
      >
        {/* Trigger Full Pipeline Benchmark */}
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            onClick={triggerFullBenchmark}
            disabled={benchmarkRunning}
            className="h-8 px-3 text-xs font-bold gap-1.5"
            style={{
              background: benchmarkRunning ? `${COLORS.gold}80` : COLORS.gold,
              color: '#000',
              boxShadow: `0 0 12px ${COLORS.gold}40`,
            }}
          >
            {benchmarkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            تشغيل الدورة الكاملة (Benchmark)
          </Button>
        </motion.div>

        <div className="h-6 w-px" style={{ background: COLORS.border }} />

        {/* Auto-Regime vs Manual Control switch */}
        <div className="flex items-center gap-2 px-2 py-1 rounded-md border" style={{ borderColor: COLORS.border, background: `${COLORS.bg}80` }}>
          <Zap className="w-3.5 h-3.5" style={{ color: autoRegimeLocal ? COLORS.green : COLORS.secondary }} />
          <span className="text-[10px] font-bold" style={{ color: autoRegimeLocal ? COLORS.green : COLORS.secondary }}>
            {autoRegimeLocal ? 'الوضع التلقائي' : 'التحكم اليدوي'}
          </span>
          <Switch
            checked={autoRegimeLocal}
            onCheckedChange={toggleAutoRegime}
            aria-label="auto-regime-switch"
          />
        </div>

        <div className="h-6 w-px" style={{ background: COLORS.border }} />

        {/* Live Throughput Counter */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border" style={{ borderColor: COLORS.border, background: `${COLORS.bg}80` }}>
          <Activity
            className="w-3.5 h-3.5"
            style={{ color: (engineControl?.throughput?.messagesPerMin ?? 0) > 0 ? COLORS.green : COLORS.secondary }}
          />
          <span className="text-[9px] text-gray-400">الإنتاجية</span>
          <motion.span
            key={`tp-${engineControl?.throughput?.messagesPerMin ?? 0}`}
            initial={{ opacity: 0.4, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="text-xs font-bold"
            style={{ color: (engineControl?.throughput?.messagesPerMin ?? 0) > 0 ? COLORS.green : COLORS.secondary }}
          >
            {engineControl?.throughput?.messagesPerMin ?? 0}
            <span className="text-[8px] font-normal text-gray-500 mr-1">/دقيقة</span>
          </motion.span>
        </div>

        {/* Engine quick badges */}
        {engineControl?.engines && (
          <div className="flex items-center gap-1 mr-auto">
            {Object.entries(engineControl.engines).slice(0, 7).map(([id, eng]) => (
              <Badge
                key={id}
                className="text-[8px] px-1.5 py-0 font-bold uppercase"
                style={{
                  background: eng.active ? `${COLORS.green}15` : `${COLORS.red}10`,
                  color: eng.active ? COLORS.green : COLORS.red,
                  border: `1px solid ${eng.active ? `${COLORS.green}40` : `${COLORS.red}40`}`,
                }}
              >
                {id}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ===== React Flow Canvas ===== */}
      <div className="flex-1 relative" ref={reactFlowRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2.5}
          attributionPosition="bottom-left"
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
          defaultEdgeOptions={{ type: 'scada' }}
        >
          <Background color="#252836" gap={24} size={1} variant="dots" />
          {/* Layer background bands for visual grouping */}
          <Panel position="top-left" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 0 }}>
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
              {/* Layer 1 - Data Sources (teal tint) */}
              <rect x="0" y="0" width="16%" height="100%" fill={NODE_COLORS.DataSource.bg} opacity="0.04" />
              <line x1="16%" y1="0" x2="16%" y2="100%" stroke={NODE_COLORS.DataSource.bg} strokeWidth="1" opacity="0.12" />
              {/* Layer 2 - Engines + Orchestrators (green/purple tint) */}
              <rect x="16%" y="0" width="20%" height="100%" fill={NODE_COLORS.Engine.bg} opacity="0.03" />
              <line x1="36%" y1="0" x2="36%" y2="100%" stroke={NODE_COLORS.Engine.bg} strokeWidth="1" opacity="0.1" />
              {/* Layer 3 - Processing (purple tint) */}
              <rect x="36%" y="0" width="20%" height="100%" fill={NODE_COLORS.Orchestrator.bg} opacity="0.03" />
              <line x1="56%" y1="0" x2="56%" y2="100%" stroke={NODE_COLORS.Orchestrator.bg} strokeWidth="1" opacity="0.1" />
              {/* Layer 4 - Gates (red tint) */}
              <rect x="56%" y="0" width="20%" height="100%" fill={NODE_COLORS.Gate.bg} opacity="0.03" />
              <line x1="76%" y1="0" x2="76%" y2="100%" stroke={NODE_COLORS.Gate.bg} strokeWidth="1" opacity="0.1" />
              {/* Layer 5 - Outputs (amber tint) */}
              <rect x="76%" y="0" width="24%" height="100%" fill={NODE_COLORS.Output.bg} opacity="0.04" />
              {/* Layer labels */}
              <text x="8%" y="28" textAnchor="middle" fill={NODE_COLORS.DataSource.border} fontSize="9" fontWeight="bold" opacity="0.5">SOURCES</text>
              <text x="26%" y="28" textAnchor="middle" fill={NODE_COLORS.Engine.border} fontSize="9" fontWeight="bold" opacity="0.5">ENGINES</text>
              <text x="46%" y="28" textAnchor="middle" fill={NODE_COLORS.Orchestrator.border} fontSize="9" fontWeight="bold" opacity="0.5">PROCESSING</text>
              <text x="66%" y="28" textAnchor="middle" fill={NODE_COLORS.Gate.border} fontSize="9" fontWeight="bold" opacity="0.5">GATES</text>
              <text x="88%" y="28" textAnchor="middle" fill={NODE_COLORS.Output.border} fontSize="9" fontWeight="bold" opacity="0.5">OUTPUTS</text>
            </svg>
          </Panel>
          <MiniMap
            nodeColor={(n) => {
              const nd = n.data as CustomNodeData;
              return nd?.category ? NODE_COLORS[nd.category as NodeCategory]?.border || '#555' : '#555';
            }}
            maskColor={`${COLORS.bg}cc`}
            style={{ background: COLORS.card, borderColor: COLORS.border, borderRadius: 8 }}
            pannable
            zoomable
          />
          <Controls
            style={{ background: COLORS.card, borderColor: COLORS.border, borderRadius: 8 }}
            showInteractive={false}
          />
          {/* Custom SVG markers */}
          <EdgeMarkerDefs />
        </ReactFlow>

        {/* ===== Legend overlay ===== */}
        <div
          className="absolute top-3 left-3 rounded-lg p-3 border text-[9px]"
          style={{ background: `${COLORS.card}ee`, borderColor: COLORS.border, backdropFilter: 'blur(8px)' }}
        >
          <div className="font-bold text-gray-400 mb-2 text-[10px]">Legend / مفتاح الخريطة</div>
          <div className="space-y-1.5">
            {(['data', 'control', 'output', 'feedback'] as EdgeCategory[]).map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <div
                  className="w-6 h-0.5"
                  style={{
                    background: EDGE_COLORS[cat],
                    borderTop: cat === 'data' ? '2px dashed' : cat === 'feedback' ? '2px dotted' : 'none',
                    borderBottom: cat === 'control' ? '3px solid' : cat === 'output' ? '2px solid' : 'none',
                    height: cat === 'feedback' ? 0 : undefined,
                    borderStyle: cat === 'data' ? 'dashed' : cat === 'feedback' ? 'dotted' : 'solid',
                    borderWidth: cat === 'control' ? 3 : 2,
                  }}
                />
                <span className="text-gray-400 capitalize">{cat}</span>
              </div>
            ))}
          </div>
          <Separator className="my-2" style={{ background: COLORS.border }} />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.green, boxShadow: `0 0 4px ${COLORS.green}` }} />
              <span className="text-gray-400">Running / نشط</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.orange }} />
              <span className="text-gray-400">Degraded / متدهور</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: COLORS.red }} />
              <span className="text-gray-400">Error / خطأ</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: '#555' }} />
              <span className="text-gray-400">Unknown / غير معروف</span>
            </div>
          </div>
          <Separator className="my-2" style={{ background: COLORS.border }} />
          <div className="font-bold text-gray-400 mb-1.5 text-[10px]">System Status / حالة النظام</div>
          <div className="space-y-1 text-[9px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Layers</span>
              <span style={{ color: COLORS.gold }}>8 (138 pts)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Bollinger ✂️</span>
              <span style={{ color: COLORS.orange }}>10 pts</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">MACD ⬆️</span>
              <span style={{ color: COLORS.green }}>23 pts</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">BUY Threshold</span>
              <span style={{ color: COLORS.gold }}>≥ 68</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Presets</span>
              <span style={{ color: COLORS.gold }}>7 (+2 🆕)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Win Rate (Comp.)</span>
              <span style={{ color: COLORS.green }}>67.0% ✅</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Win Rate (Unified)</span>
              <span style={{ color: COLORS.green }}>68.84% ✅</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">RAG AI</span>
              <span style={{ color: COLORS.green }}>+10/-15 active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">DB Safety</span>
              <span style={{ color: COLORS.green }}>WAL + auto-repair</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">TUNING</span>
              <span style={{ color: COLORS.gold }}>V3</span>
            </div>
          </div>
        </div>

        {/* ===== Quick Actions Panel ===== */}
        <div
          className="absolute bottom-3 left-3 rounded-lg p-3 border max-w-[200px]"
          style={{ background: `${COLORS.card}ee`, borderColor: COLORS.border, backdropFilter: 'blur(8px)' }}
        >
          <div className="font-bold text-[10px] mb-2 flex items-center gap-1.5" style={{ color: COLORS.gold }}>
            <Flame className="w-3 h-3" />
            إجراءات سريعة
          </div>
          <div className="space-y-1">
            <button
              onClick={() => executeAction('gen-pred', 'POST', '/api/predictions/generate-all', 'تم توليد توقعات جديدة')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[9px] font-bold border hover:bg-white/5 transition-colors"
              style={{ background: `${COLORS.gold}08`, borderColor: `${COLORS.gold}30`, color: COLORS.gold }}
            >
              <Play className="w-3 h-3" />
              تشغيل التحليل
            </button>
            <button
              onClick={() => executeAction('sniper-scan', 'GET', '/api/sniper/scan?market=EGX&min_gates=4&limit=10', 'تم فحص الفرص بنجاح')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[9px] font-bold border hover:bg-white/5 transition-colors"
              style={{ background: `${COLORS.pink}08`, borderColor: `${COLORS.pink}30`, color: COLORS.pink }}
            >
              <Crosshair className="w-3 h-3" />
              تصطاد الفرص
            </button>
            <button
              onClick={() => executeAction('sync-data', 'POST', '/api/market/sync', 'تم مزامنة البيانات')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[9px] font-bold border hover:bg-white/5 transition-colors"
              style={{ background: `${COLORS.blue}08`, borderColor: `${COLORS.blue}30`, color: COLORS.blue }}
            >
              <RefreshCw className="w-3 h-3" />
              مزامنة البيانات
            </button>
            <button
              onClick={() => executeAction('closer', 'POST', '/api/sniper/closer/run', 'تم تشغيل الإغلاق')}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[9px] font-bold border hover:bg-white/5 transition-colors"
              style={{ background: `${COLORS.orange}08`, borderColor: `${COLORS.orange}30`, color: COLORS.orange }}
            >
              <XCircle className="w-3 h-3" />
              إغلاق التوقعات
            </button>
          </div>
        </div>

        {/* ===== Activity Feed ===== */}
        <div
          className="absolute top-3 right-3 rounded-lg p-3 border max-w-[220px]"
          style={{ background: `${COLORS.card}ee`, borderColor: COLORS.border, backdropFilter: 'blur(8px)' }}
        >
          <div className="font-bold text-[10px] mb-2 flex items-center gap-1.5" style={{ color: COLORS.blue }}>
            <Activity className="w-3 h-3" />
            آخر الأنشطة
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.border} transparent` }}>
            {activities.length === 0 ? (
              <div className="text-[9px] text-gray-500 text-center py-2">لا توجد أنشطة بعد</div>
            ) : (
              <AnimatePresence initial={false}>
                {activities.map((activity) => (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, x: 20, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, x: -20, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-start gap-1.5 px-1.5 py-1 rounded text-[8px]"
                    style={{
                      background: activity.type === 'success' ? `${COLORS.green}08`
                        : activity.type === 'error' ? `${COLORS.red}08`
                        : activity.type === 'warning' ? `${COLORS.orange}08`
                        : `${COLORS.blue}08`,
                      borderLeft: `2px solid ${
                        activity.type === 'success' ? COLORS.green
                        : activity.type === 'error' ? COLORS.red
                        : activity.type === 'warning' ? COLORS.orange
                        : COLORS.blue
                      }`,
                    }}
                  >
                    <span className="flex-shrink-0 mt-0.5">
                      {activity.type === 'success' && <CheckCircle2 className="w-2.5 h-2.5" style={{ color: COLORS.green }} />}
                      {activity.type === 'error' && <AlertCircle className="w-2.5 h-2.5" style={{ color: COLORS.red }} />}
                      {activity.type === 'warning' && <AlertTriangle className="w-2.5 h-2.5" style={{ color: COLORS.orange }} />}
                      {activity.type === 'info' && <Info className="w-2.5 h-2.5" style={{ color: COLORS.blue }} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 leading-tight">{activity.message}</p>
                      <p className="text-gray-600 text-[7px] mt-0.5">{formatTimeAgo(activity.timestamp)}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      {/* ===== Detail Panel (Sheet) ===== */}
      <Sheet open={!!selectedNodeId} onOpenChange={(open) => { if (!open) setSelectedNodeId(null); }}>
        <SheetContent
          side="right"
          className="w-[320px] sm:w-[380px] border-l p-0 overflow-hidden"
          style={{ background: COLORS.bg, borderColor: COLORS.border }}
        >
          {selectedNode && (
            <div className="flex flex-col h-full">
              {/* Header */}
              <SheetHeader className="p-4 pb-3 flex-shrink-0" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span style={{ color: NODE_COLORS[selectedNode.data.category].text }}>
                      {getNodeIcon(selectedNode.data.category)}
                    </span>
                    <SheetTitle className="text-base font-bold" style={{ color: NODE_COLORS[selectedNode.data.category].text }}>
                      {selectedNode.data.label}
                    </SheetTitle>
                  </div>
                </div>
                <SheetDescription className="sr-only">
                  {selectedNode.data.labelAr} - {getCategoryLabelAr(selectedNode.data.category)}
                </SheetDescription>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    className="text-[8px] px-1.5 py-0 font-bold"
                    style={{
                      background: `${NODE_COLORS[selectedNode.data.category].bg}30`,
                      color: NODE_COLORS[selectedNode.data.category].text,
                      border: `1px solid ${NODE_COLORS[selectedNode.data.category].border}50`,
                    }}
                  >
                    {getCategoryLabelAr(selectedNode.data.category)}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <motion.div
                      className="w-2 h-2 rounded-full"
                      style={{ background: statusDotColor(selectedNode.data.status), boxShadow: `0 0 4px ${statusDotColor(selectedNode.data.status)}` }}
                      animate={selectedNode.data.status === 'running' || selectedNode.data.status === 'healthy'
                        ? { scale: [1, 1.3, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 2 }}
                    />
                    <span className="text-[9px] font-bold" style={{ color: statusDotColor(selectedNode.data.status) }}>
                      {selectedNode.data.status === 'running' || selectedNode.data.status === 'healthy' ? 'نشط'
                        : selectedNode.data.status === 'stopped' ? 'متوقف'
                        : selectedNode.data.status === 'degraded' ? 'متدهور'
                        : selectedNode.data.status === 'error' ? 'خطأ'
                        : 'غير معروف'}
                    </span>
                  </div>
                  {selectedNode.data.lastUpdate && (
                    <span className="text-[8px] text-gray-500 mr-auto" dir="rtl">
                      آخر تحديث: {new Date(selectedNode.data.lastUpdate).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </SheetHeader>

              {/* Scrollable content */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">

                  {/* Live Metrics */}
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                      <Gauge className="w-3 h-3" />
                      المقاييس الحية
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedNode.data.metrics.map((m) => (
                        <div
                          key={m.key}
                          className="rounded-md p-2 text-center border"
                          style={{ background: COLORS.card, borderColor: COLORS.border }}
                        >
                          <div className="text-[8px] text-gray-500 mb-0.5">{m.labelAr}</div>
                          <div className="text-sm font-bold" style={{ color: NODE_COLORS[selectedNode.data.category].text }}>
                            {m.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator style={{ background: COLORS.border }} />

                  {/* P39-COMMAND-CENTER: Live Engine Control Drawer (Pillars 1+2+3) */}
                  {(() => {
                    const engineId = selectedNode ? NODE_TO_ENGINE_ID[selectedNode.id] : undefined;
                    if (!engineId) return null;
                    const eng = engineControl?.engines?.[engineId];
                    const edits = engineWeightsEdits[engineId] || {};
                    const weightVal = typeof edits.weight === 'number' ? edits.weight : (eng?.weight ?? 50);
                    const sensVal = typeof edits.sensitivity === 'number' ? edits.sensitivity : (eng?.sensitivity ?? 0.5);
                    const thrVal = typeof edits.threshold === 'number' ? edits.threshold : (eng?.threshold ?? 50);
                    const isActive = eng?.active ?? true;
                    const isMaestro = (MAESTRO_ENGINE_IDS as readonly string[]).includes(engineId);
                    const advEdits = advancedEdits[engineId] || {};
                    const getAdv = (key: string, def: number | boolean): number | boolean =>
                      advEdits[key] !== undefined ? advEdits[key] : def;
                    const logEntries = (eng?.log ?? []).slice(-10).reverse();
                    const logLevelColor = (lvl?: string): string => {
                      switch (lvl) {
                        case 'success': return COLORS.green;
                        case 'error': return COLORS.red;
                        case 'warning': return COLORS.orange;
                        default: return COLORS.blue;
                      }
                    };
                    const formatLogTs = (entry: EngineLogEntry): string => {
                      const t = entry.ts || entry.timestamp;
                      if (!t) return '';
                      try {
                        return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                      } catch {
                        return '';
                      }
                    };

                    return (
                      <div dir="rtl" className="space-y-3">
                        {/* Pillar 1: Master Toggle */}
                        <div
                          className="rounded-md p-3 border"
                          style={{ background: `${COLORS.card}`, borderColor: COLORS.border }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <motion.div
                                animate={{ scale: isActive ? [1, 1.15, 1] : 1 }}
                                transition={{ repeat: isActive ? Infinity : 0, duration: 2 }}
                              >
                                <Power className="w-4 h-4" style={{ color: isActive ? COLORS.green : COLORS.secondary }} />
                              </motion.div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-gray-200">تفعيل / إيقاف المحرك</span>
                                <span className="text-[8px] text-gray-500">
                                  {isActive ? 'المحرك نشط ويعمل' : 'المحرك متوقف'}
                                  {eng?.runtimeStatus ? ` • ${eng.runtimeStatus}` : ''}
                                </span>
                              </div>
                            </div>
                            <Switch
                              checked={isActive}
                              onCheckedChange={(checked) => toggleEngine(engineId, checked)}
                              aria-label="engine-master-toggle"
                            />
                          </div>
                          {eng?.lastTriggeredAt && (
                            <div className="text-[8px] text-gray-500 mt-2 pt-2 border-t" style={{ borderColor: COLORS.border }}>
                              آخر تشغيل: {new Date(eng.lastTriggeredAt).toLocaleString('ar-EG')}
                            </div>
                          )}
                        </div>

                        {/* Pillar 2: Weight / Sensitivity / Threshold sliders */}
                        <div
                          className="rounded-md p-3 border space-y-3"
                          style={{ background: COLORS.card, borderColor: COLORS.border }}
                        >
                          <h4 className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                            <Sliders className="w-3 h-3" />
                            أوزان المحرك (Pipeline)
                          </h4>

                          {/* Weight slider */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-400">وزن المحرك بداخل الـ Pipeline</span>
                              <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                {Math.round(weightVal)}
                              </span>
                            </div>
                            <Slider
                              value={[weightVal]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={([v]) =>
                                setEngineWeightsEdits((prev) => ({
                                  ...prev,
                                  [engineId]: { ...(prev[engineId] || {}), weight: v },
                                }))
                              }
                              className="w-full"
                            />
                          </div>

                          {/* Sensitivity slider */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-400">الحساسية</span>
                              <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                {sensVal.toFixed(2)}
                              </span>
                            </div>
                            <Slider
                              value={[sensVal]}
                              min={0}
                              max={1}
                              step={0.05}
                              onValueChange={([v]) =>
                                setEngineWeightsEdits((prev) => ({
                                  ...prev,
                                  [engineId]: { ...(prev[engineId] || {}), sensitivity: v },
                                }))
                              }
                              className="w-full"
                            />
                          </div>

                          {/* Threshold slider */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-400">الحواجز / Threshold</span>
                              <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                {Math.round(thrVal)}
                              </span>
                            </div>
                            <Slider
                              value={[thrVal]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={([v]) =>
                                setEngineWeightsEdits((prev) => ({
                                  ...prev,
                                  [engineId]: { ...(prev[engineId] || {}), threshold: v },
                                }))
                              }
                              className="w-full"
                            />
                          </div>

                          {Object.keys(edits).length > 0 && (
                            <Button
                              onClick={() => saveEngineWeights(engineId)}
                              className="w-full h-7 text-[10px] font-bold gap-1.5"
                              style={{ background: COLORS.gold, color: '#000' }}
                            >
                              <Save className="w-3 h-3" />
                              حفظ
                            </Button>
                          )}
                        </div>

                        {/* Pillar 2: Manual Trigger button */}
                        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                          <Button
                            onClick={() => triggerEngine(engineId)}
                            disabled={triggeringEngine === engineId}
                            className="w-full h-9 text-[11px] font-bold gap-2"
                            style={{
                              background: triggeringEngine === engineId ? `${COLORS.green}80` : COLORS.green,
                              color: '#000',
                              boxShadow: `0 0 10px ${COLORS.green}30`,
                            }}
                          >
                            {triggeringEngine === engineId
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Play className="w-4 h-4" />}
                            ▶ تشغيل اختبار فوري
                          </Button>
                        </motion.div>

                        {/* Pillar 3: Sub-Engine Advanced Controls (only for 4 Maestro engines) */}
                        {isMaestro && (
                          <div
                            className="rounded-md p-3 border space-y-3"
                            style={{ background: COLORS.card, borderColor: `${COLORS.purple}40` }}
                          >
                            <h4 className="text-[10px] font-bold flex items-center gap-1" style={{ color: COLORS.purple }}>
                              <Sliders className="w-3 h-3" />
                              التحكم المتقدّم في محرك Maestro
                            </h4>

                            {/* SMC: FVG toggle */}
                            {engineId === 'smc' && (
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-300">تفعيل فحص الفجوات السعرية (FVG)</span>
                                <Switch
                                  checked={getAdv('fvg_check', true) as boolean}
                                  onCheckedChange={(v) =>
                                    setAdvancedEdits((prev) => ({
                                      ...prev,
                                      [engineId]: { ...(prev[engineId] || {}), fvg_check: v },
                                    }))
                                  }
                                />
                              </div>
                            )}

                            {/* Quant: Z-Score number */}
                            {engineId === 'quant' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] text-gray-300">قيمة انحراف Z-Score المعتمدة</span>
                                  <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                    {(getAdv('zscore', 2.0) as number).toFixed(1)}
                                  </span>
                                </div>
                                <input
                                  type="number"
                                  value={getAdv('zscore', 2.0) as number}
                                  min={1.0}
                                  max={4.0}
                                  step={0.1}
                                  onChange={(e) =>
                                    setAdvancedEdits((prev) => ({
                                      ...prev,
                                      [engineId]: { ...(prev[engineId] || {}), zscore: Number(e.target.value) },
                                    }))
                                  }
                                  className="w-full rounded-md px-2 py-1 text-xs border"
                                  style={{ background: COLORS.bg, borderColor: COLORS.border, color: COLORS.gold }}
                                />
                              </div>
                            )}

                            {/* Risk: stop multiplier + portfolio risk */}
                            {engineId === 'risk' && (
                              <>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-gray-300">مضاعف الوقف الديناميكي</span>
                                    <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                      {(getAdv('stop_mult', 1.5) as number).toFixed(1)}×
                                    </span>
                                  </div>
                                  <Slider
                                    value={[getAdv('stop_mult', 1.5) as number]}
                                    min={0.5}
                                    max={3.0}
                                    step={0.1}
                                    onValueChange={([v]) =>
                                      setAdvancedEdits((prev) => ({
                                        ...prev,
                                        [engineId]: { ...(prev[engineId] || {}), stop_mult: v },
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-gray-300">نسبة مخاطفة المحفظة</span>
                                    <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                      {(getAdv('portfolio_risk', 2.0) as number).toFixed(1)}%
                                    </span>
                                  </div>
                                  <Slider
                                    value={[getAdv('portfolio_risk', 2.0) as number]}
                                    min={0.5}
                                    max={5.0}
                                    step={0.1}
                                    onValueChange={([v]) =>
                                      setAdvancedEdits((prev) => ({
                                        ...prev,
                                        [engineId]: { ...(prev[engineId] || {}), portfolio_risk: v },
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </div>
                              </>
                            )}

                            {/* EGX: illiquid penalty */}
                            {engineId === 'egx' && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] text-gray-300">عقوبات سيولة الأسهم الخاملة</span>
                                  <span className="text-[9px] font-bold" style={{ color: COLORS.gold }}>
                                    {(getAdv('illiquid_penalty', 0.3) as number).toFixed(2)}
                                  </span>
                                </div>
                                <Slider
                                  value={[getAdv('illiquid_penalty', 0.3) as number]}
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  onValueChange={([v]) =>
                                    setAdvancedEdits((prev) => ({
                                      ...prev,
                                      [engineId]: { ...(prev[engineId] || {}), illiquid_penalty: v },
                                    }))
                                  }
                                  className="w-full"
                                />
                              </div>
                            )}

                            {Object.keys(advEdits).length > 0 && (
                              <Button
                                onClick={() => saveAdvancedParams(engineId)}
                                className="w-full h-7 text-[10px] font-bold gap-1.5"
                                style={{ background: COLORS.purple, color: '#fff' }}
                              >
                                <Save className="w-3 h-3" />
                                حفظ الإعدادات المتقدّمة
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Pillar 2: Live Engine Log Stream */}
                        <div
                          className="rounded-md p-3 border"
                          style={{ background: COLORS.card, borderColor: COLORS.border }}
                        >
                          <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                            <List className="w-3 h-3" />
                            آخر 10 عمليات للمحرك
                          </h4>
                          <div
                            className="max-h-48 overflow-y-auto space-y-1 pr-1"
                            style={{
                              scrollbarWidth: 'thin',
                              scrollbarColor: `${COLORS.border} transparent`,
                            }}
                          >
                            {logEntries.length === 0 ? (
                              <div className="text-[9px] text-gray-500 text-center py-3">لا توجد عمليات مسجّلة</div>
                            ) : (
                              logEntries.map((entry, idx) => {
                                const lvl = entry.level || 'info';
                                const color = logLevelColor(lvl);
                                return (
                                  <motion.div
                                    key={`${engineId}-log-${idx}-${entry.ts || entry.timestamp || idx}`}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-start gap-1.5 text-[9px] px-1.5 py-1 rounded"
                                    style={{
                                      background: `${color}08`,
                                      borderRight: `2px solid ${color}`,
                                    }}
                                  >
                                    <span className="text-gray-500 font-mono flex-shrink-0" dir="ltr">
                                      {formatLogTs(entry)}
                                    </span>
                                    <span className="text-gray-300 flex-1 break-words">{entry.message}</span>
                                  </motion.div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <Separator style={{ background: COLORS.border }} />

                  {/* Parameter Editor */}
                  {selectedNode.data.params.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                        <Sliders className="w-3 h-3" />
                        المعلمات / Parameters
                      </h4>
                      <div className="space-y-3">
                        {selectedNode.data.params.map((param) => {
                          const currentValue = getParamValue(selectedNode.id, param.key, param.value);

                          return (
                            <div key={param.key} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-400">{param.labelAr}</span>
                                <span className="text-[9px] font-bold" style={{ color: NODE_COLORS[selectedNode.data.category].text }}>
                                  {param.type === 'toggle'
                                    ? (currentValue ? 'مفعّل' : 'معطّل')
                                    : String(currentValue)}
                                </span>
                              </div>

                              {param.type === 'slider' && (
                                <Slider
                                  value={[currentValue as number]}
                                  min={param.min ?? 0}
                                  max={param.max ?? 100}
                                  step={param.step ?? 1}
                                  onValueChange={([val]) => setParamValue(selectedNode.id, param.key, val)}
                                  className="w-full"
                                />
                              )}

                              {param.type === 'toggle' && (
                                <Switch
                                  checked={currentValue as boolean}
                                  onCheckedChange={(checked) => setParamValue(selectedNode.id, param.key, checked)}
                                />
                              )}

                              {param.type === 'number' && (
                                <input
                                  type="number"
                                  value={currentValue as number}
                                  min={param.min ?? 0}
                                  max={param.max ?? 100}
                                  step={param.step ?? 1}
                                  onChange={(e) => setParamValue(selectedNode.id, param.key, Number(e.target.value))}
                                  className="w-full rounded-md px-2 py-1 text-xs border"
                                  style={{
                                    background: COLORS.card,
                                    borderColor: COLORS.border,
                                    color: NODE_COLORS[selectedNode.data.category].text,
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}

                        {/* Save button */}
                        {paramEdits[selectedNode.id] && Object.keys(paramEdits[selectedNode.id] || {}).length > 0 && (
                          <Button
                            onClick={() => saveParams(selectedNode.id)}
                            disabled={saving}
                            className="w-full h-8 text-xs font-bold gap-1.5 mt-2"
                            style={{
                              background: NODE_COLORS[selectedNode.data.category].bg,
                              color: '#fff',
                            }}
                          >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            حفظ التغييرات
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedNode.data.params.length > 0 && <Separator style={{ background: COLORS.border }} />}

                  {/* Connections */}
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      الاتصالات
                    </h4>
                    {selectedNode.data.connections.in.length > 0 && (
                      <div className="mb-2">
                        <span className="text-[8px] text-gray-500">← مدخلات</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedNode.data.connections.in.map((connId) => {
                            const connNode = nodes.find((n) => n.id === connId) as Node<CustomNodeData> | undefined;
                            return (
                              <button
                                key={connId}
                                onClick={() => setSelectedNodeId(connId)}
                                className="text-[8px] px-1.5 py-0.5 rounded border hover:bg-white/5 transition-colors cursor-pointer"
                                style={{
                                  background: connNode ? `${NODE_COLORS[connNode.data.category].bg}15` : 'transparent',
                                  borderColor: connNode ? `${NODE_COLORS[connNode.data.category].border}40` : COLORS.border,
                                  color: connNode ? NODE_COLORS[connNode.data.category].text : '#999',
                                }}
                              >
                                {connNode?.data.label || connId}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedNode.data.connections.out.length > 0 && (
                      <div>
                        <span className="text-[8px] text-gray-500">→ مخرجات</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedNode.data.connections.out.map((connId) => {
                            const connNode = nodes.find((n) => n.id === connId) as Node<CustomNodeData> | undefined;
                            return (
                              <button
                                key={connId}
                                onClick={() => setSelectedNodeId(connId)}
                                className="text-[8px] px-1.5 py-0.5 rounded border hover:bg-white/5 transition-colors cursor-pointer"
                                style={{
                                  background: connNode ? `${NODE_COLORS[connNode.data.category].bg}15` : 'transparent',
                                  borderColor: connNode ? `${NODE_COLORS[connNode.data.category].border}40` : COLORS.border,
                                  color: connNode ? NODE_COLORS[connNode.data.category].text : '#999',
                                }}
                              >
                                {connNode?.data.label || connId}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator style={{ background: COLORS.border }} />

                  {/* Actions */}
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                      <Settings className="w-3 h-3" />
                      إجراءات
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              if (n.id !== selectedNode.id) return n;
                              const nd = n as Node<CustomNodeData>;
                              return { ...n, data: { ...nd.data, status: 'running' as NodeStatus } };
                            })
                          );
                          addActivity(`تم تشغيل ${selectedNode.data.labelAr}`, 'success');
                        }}
                        className="flex-1 h-7 text-[9px] font-bold gap-1"
                        style={{ background: COLORS.green, color: '#000' }}
                      >
                        <Play className="w-3 h-3" />
                        تشغيل
                      </Button>
                      <Button
                        onClick={() => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              if (n.id !== selectedNode.id) return n;
                              const nd = n as Node<CustomNodeData>;
                              return { ...n, data: { ...nd.data, status: 'stopped' as NodeStatus } };
                            })
                          );
                          addActivity(`تم إيقاف ${selectedNode.data.labelAr}`, 'warning');
                        }}
                        className="flex-1 h-7 text-[9px] font-bold gap-1"
                        style={{ background: COLORS.red, color: '#fff' }}
                      >
                        <StopCircle className="w-3 h-3" />
                        إيقاف
                      </Button>
                      <Button
                        onClick={() => {
                          setNodes((prev) =>
                            prev.map((n) => {
                              if (n.id !== selectedNode.id) return n;
                              const nd = n as Node<CustomNodeData>;
                              return { ...n, data: { ...nd.data, status: 'degraded' as NodeStatus } };
                            })
                          );
                          addActivity(`تم إعادة تشغيل ${selectedNode.data.labelAr}`, 'info');
                        }}
                        variant="outline"
                        className="flex-1 h-7 text-[9px] font-bold gap-1"
                        style={{ borderColor: COLORS.orange, color: COLORS.orange }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        إعادة
                      </Button>
                    </div>
                  </div>

                  <Separator style={{ background: COLORS.border }} />

                  {/* Recent Activity */}
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      آخر الأنشطة
                    </h4>
                    <div className="space-y-1 max-h-28 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {activities.slice(0, 5).map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-center gap-1.5 text-[8px] px-1.5 py-1 rounded"
                          style={{
                            background: `${COLORS.card}`,
                            borderLeft: `2px solid ${
                              activity.type === 'success' ? COLORS.green
                              : activity.type === 'error' ? COLORS.red
                              : activity.type === 'warning' ? COLORS.orange
                              : COLORS.blue
                            }`,
                          }}
                        >
                          <span className="text-gray-300 flex-1">{activity.message}</span>
                          <span className="text-gray-600 flex-shrink-0">{formatTimeAgo(activity.timestamp)}</span>
                        </div>
                      ))}
                      {activities.length === 0 && (
                        <div className="text-[8px] text-gray-500 text-center py-2">لا توجد أنشطة</div>
                      )}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ===== Error overlay ===== */}
      <AnimatePresence>
        {error && !topologyData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-4 right-4 z-50 p-4 rounded-lg border max-w-sm"
            style={{ background: `${COLORS.red}10`, borderColor: `${COLORS.red}40` }}
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4" style={{ color: COLORS.red }} />
              <span className="text-sm font-bold" style={{ color: COLORS.red }}>Connection Error</span>
            </div>
            <p className="text-xs text-gray-400 mb-2">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchData} className="h-7 text-xs gap-1">
              <RefreshCw className="w-3 h-3" />
              Retry
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showOptimizerPanel && (
          <OptimizerParamsPanel onClose={() => setShowOptimizerPanel(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============== Export with View Toggle (Logic Diagram / Topology) ==============
// P17: حوّلنا مركز القيادة من رسم هندسي ثابت إلى مخطط منطقي (process + decision flow)
// افتراضياً يعرض «مخطط المنطق»، مع إبقاء «التوبولوجيا» (ReactFlow) كعرض بديل.

export function MaestroCommandCenter() {
  const [view, setView] = useState<'logic' | 'topology'>('logic');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center py-1">
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setView('logic')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              view === 'logic' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            مخطط المنطق
          </button>
          <button
            type="button"
            onClick={() => setView('topology')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              view === 'topology' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            التوبولوجيا
          </button>
        </div>
      </div>
      {view === 'logic' ? (
        <MaestroLogicFlow />
      ) : (
        <ReactFlowProvider>
          <MaestroCommandCenterInner />
        </ReactFlowProvider>
      )}
    </div>
  );
}

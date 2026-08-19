// ============================================================================
// Engine Studio — Type Definitions
// ============================================================================

import type { Node, Edge } from '@xyflow/react';

// ---------- Engine Types ----------

export interface EngineConfig {
  enabled: boolean;
  weight: number;
  signal?: string;
  score?: number;
  confidence?: number;
  reasons?: string[];
  error?: string;
}

export interface PipelineInfo {
  name: string;
  display_name: string;
  description: string;
  is_custom?: boolean;
  engines: Record<string, EngineConfig>;
}

export interface AnalysisResult {
  signal: string;
  score: number;
  confidence: number;
  engines: EngineResult[];
  pipeline: string;
  pipeline_display_name: string;
  ticker: string;
  timestamp: string;
  signal_counts?: Record<string, number>;
}

export interface EngineResult {
  name: string;
  enabled: boolean;
  signal: string;
  score: number;
  confidence: number;
  weight: number;
  weighted_score?: number;
  details?: Record<string, unknown>;
  reasons?: string[];
  error?: string;
}

// ---------- React Flow Node Types ----------

export type EngineNodeData = {
  label: string;
  labelAr: string;
  engineKey: string;
  enabled: boolean;
  weight: number;
  signal?: string;
  score?: number;
  confidence?: number;
  iconType: string;
  colorClass: string;
  bgColorClass: string;
};

export type DataSourceNodeData = {
  label: string;
  labelAr: string;
  ticker: string;
};

export type OrchestratorNodeData = {
  label: string;
  labelAr: string;
  pipelineName: string;
  pipelineDisplayName: string;
  signal?: string;
  score?: number;
  confidence?: number;
};

export type ResultNodeData = {
  label: string;
  labelAr: string;
  signal?: string;
  score?: number;
  confidence?: number;
  timestamp?: string;
};

// ---------- Studio Layout (save/load) ----------

export interface StudioLayout {
  id: string;
  name: string;
  description: string;
  pipeline: string;
  nodes: Node[];
  edges: Edge[];
  created_at: string;
  updated_at: string;
}

// ---------- Engine Visual Config ----------

export const ENGINE_VISUAL: Record<string, {
  iconType: string;
  colorClass: string;
  bgColorClass: string;
  label: string;
  labelAr: string;
}> = {
  fundamental: {
    iconType: 'bar-chart',
    colorClass: 'text-emerald-600',
    bgColorClass: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700',
    label: 'Fundamental',
    labelAr: 'الأساسي',
  },
  technical: {
    iconType: 'activity',
    colorClass: 'text-sky-600',
    bgColorClass: 'bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-700',
    label: 'Technical',
    labelAr: 'الفني',
  },
  candlestick: {
    iconType: 'zap',
    colorClass: 'text-amber-600',
    bgColorClass: 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700',
    label: 'Candlestick',
    labelAr: 'الشموع',
  },
  mean_reversion: {
    iconType: 'trending-down',
    colorClass: 'text-purple-600',
    bgColorClass: 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700',
    label: 'Mean Reversion',
    labelAr: 'عودة للمتوسط',
  },
};

export const SIGNAL_VISUAL: Record<string, { colorClass: string; bgClass: string; emoji: string }> = {
  BUY: { colorClass: 'text-emerald-700', bgClass: 'bg-emerald-100 dark:bg-emerald-900/40', emoji: '🟢' },
  SELL: { colorClass: 'text-red-700', bgClass: 'bg-red-100 dark:bg-red-900/40', emoji: '🔴' },
  HOLD: { colorClass: 'text-yellow-700', bgClass: 'bg-yellow-100 dark:bg-yellow-900/40', emoji: '🟡' },
};

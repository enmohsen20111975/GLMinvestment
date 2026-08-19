'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';

import { EngineNode } from './EngineNode';
import { DataSourceNode } from './DataSourceNode';
import { OrchestratorNode } from './OrchestratorNode';
import { ResultNode } from './ResultNode';
import { CustomEdge } from './CustomEdge';
import { StudioToolbar } from './Toolbar';
import { ResultPanel } from './ResultPanel';
import {
  type EngineNodeData,
  type DataSourceNodeData,
  type OrchestratorNodeData,
  type ResultNodeData,
  type PipelineInfo,
  type AnalysisResult,
  type EngineResult,
  ENGINE_VISUAL,
  SIGNAL_VISUAL,
} from './types';

// ============================================================================
// NODE TYPES (must be defined outside component to prevent re-renders)
// ============================================================================

const nodeTypes: NodeTypes = {
  engineNode: EngineNode,
  dataSourceNode: DataSourceNode,
  orchestratorNode: OrchestratorNode,
  resultNode: ResultNode,
};

const edgeTypes: EdgeTypes = {
  customEdge: CustomEdge,
};

// ============================================================================
// DEFAULT POSITIONS
// ============================================================================

const DEFAULT_NODES: Node[] = [
  // Data Source
  {
    id: 'data-source',
    type: 'dataSourceNode',
    position: { x: 50, y: 200 },
    data: {
      label: 'Stock Data',
      labelAr: 'بيانات السهم',
      ticker: '',
    } as DataSourceNodeData,
  },
  // 4 Engines
  {
    id: 'eng-fundamental',
    type: 'engineNode',
    position: { x: 350, y: 30 },
    data: {
      label: 'Fundamental',
      labelAr: 'الأساسي',
      engineKey: 'fundamental',
      enabled: true,
      weight: 1.0,
      iconType: 'bar-chart',
      colorClass: 'text-emerald-600',
      bgColorClass: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700',
    } as EngineNodeData,
  },
  {
    id: 'eng-technical',
    type: 'engineNode',
    position: { x: 350, y: 180 },
    data: {
      label: 'Technical',
      labelAr: 'الفني',
      engineKey: 'technical',
      enabled: true,
      weight: 1.0,
      iconType: 'activity',
      colorClass: 'text-sky-600',
      bgColorClass: 'bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-700',
    } as EngineNodeData,
  },
  {
    id: 'eng-candlestick',
    type: 'engineNode',
    position: { x: 350, y: 330 },
    data: {
      label: 'Candlestick',
      labelAr: 'الشموع',
      engineKey: 'candlestick',
      enabled: true,
      weight: 1.0,
      iconType: 'zap',
      colorClass: 'text-amber-600',
      bgColorClass: 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700',
    } as EngineNodeData,
  },
  {
    id: 'eng-mean_reversion',
    type: 'engineNode',
    position: { x: 350, y: 480 },
    data: {
      label: 'Mean Reversion',
      labelAr: 'عودة للمتوسط',
      engineKey: 'mean_reversion',
      enabled: true,
      weight: 1.0,
      iconType: 'trending-down',
      colorClass: 'text-purple-600',
      bgColorClass: 'bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700',
    } as EngineNodeData,
  },
  // Orchestrator
  {
    id: 'orchestrator',
    type: 'orchestratorNode',
    position: { x: 700, y: 200 },
    data: {
      label: 'Orchestrator',
      labelAr: 'الموزع',
      pipelineName: 'egx_balanced',
      pipelineDisplayName: 'EGX Balanced',
    } as OrchestratorNodeData,
  },
  // Result
  {
    id: 'result',
    type: 'resultNode',
    position: { x: 1050, y: 200 },
    data: {
      label: 'Result',
      labelAr: 'النتيجة',
    } as ResultNodeData,
  },
];

const DEFAULT_EDGES: Edge[] = [
  // Data Source → Engines
  {
    id: 'ds-fund',
    source: 'data-source',
    target: 'eng-fundamental',
    type: 'customEdge',
    data: { color: '#64748b' },
    animated: true,
  },
  {
    id: 'ds-tech',
    source: 'data-source',
    target: 'eng-technical',
    type: 'customEdge',
    data: { color: '#64748b' },
    animated: true,
  },
  {
    id: 'ds-candle',
    source: 'data-source',
    target: 'eng-candlestick',
    type: 'customEdge',
    data: { color: '#64748b' },
    animated: true,
  },
  {
    id: 'ds-meanrev',
    source: 'data-source',
    target: 'eng-mean_reversion',
    type: 'customEdge',
    data: { color: '#64748b' },
    animated: true,
  },
  // Engines → Orchestrator
  {
    id: 'fund-orch',
    source: 'eng-fundamental',
    target: 'orchestrator',
    targetHandle: 'eng-fundamental',
    type: 'customEdge',
    data: { color: '#10b981' },
    animated: true,
  },
  {
    id: 'tech-orch',
    source: 'eng-technical',
    target: 'orchestrator',
    targetHandle: 'eng-technical',
    type: 'customEdge',
    data: { color: '#0ea5e9' },
    animated: true,
  },
  {
    id: 'candle-orch',
    source: 'eng-candlestick',
    target: 'orchestrator',
    targetHandle: 'eng-candlestick',
    type: 'customEdge',
    data: { color: '#f59e0b' },
    animated: true,
  },
  {
    id: 'meanrev-orch',
    source: 'eng-mean_reversion',
    target: 'orchestrator',
    targetHandle: 'eng-mean_reversion',
    type: 'customEdge',
    data: { color: '#a855f7' },
    animated: true,
  },
  // Orchestrator → Result
  {
    id: 'orch-result',
    source: 'orchestrator',
    target: 'result',
    type: 'customEdge',
    data: { color: '#6366f1' },
    animated: true,
  },
];

// ============================================================================
// API HELPERS
// ============================================================================

async function apiCall<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    return data?.data ?? data;
  } catch {
    return null;
  }
}

// ============================================================================
// INNER FLOW CANVAS (wrapped by ReactFlowProvider)
// ============================================================================

function FlowCanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);

  // State
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [activePipeline, setActivePipeline] = useState('egx_balanced');
  const [ticker, setTicker] = useState('');
  const [executing, setExecuting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [engineHealthy, setEngineHealthy] = useState<boolean | null>(null);
  const [layoutName, setLayoutName] = useState('');

  // Load pipelines on mount
  useEffect(() => {
    loadPipelines();
    checkHealth();
  }, []);

  const loadPipelines = async () => {
    const data = await apiCall<PipelineInfo[]>('/api/v2/pipelines');
    if (data && Array.isArray(data)) {
      setPipelines(data);
    }
  };

  const checkHealth = async () => {
    const data = await apiCall<{ status: string; pipelines_count: number }>('/api/v2/health');
    if (data) {
      setEngineHealthy(data.status === 'healthy');
    }
  };

  // When pipeline changes, update engine nodes' enabled/weight from backend
  useEffect(() => {
    if (pipelines.length === 0) return;
    const pipeline = pipelines.find(p => p.name === activePipeline);
    if (!pipeline) return;

    setNodes(nds =>
      nds.map(node => {
        if (node.type === 'engineNode') {
          const engineKey = (node.data as EngineNodeData).engineKey;
          const engineConfig = pipeline.engines[engineKey];
          if (engineConfig) {
            return {
              ...node,
              data: {
                ...node.data,
                enabled: engineConfig.enabled,
                weight: engineConfig.weight,
                signal: undefined,
                score: undefined,
                confidence: undefined,
              },
            };
          }
        }
        if (node.type === 'orchestratorNode') {
          return {
            ...node,
            data: {
              ...node.data,
              pipelineName: pipeline.name,
              pipelineDisplayName: pipeline.display_name,
              signal: undefined,
              score: undefined,
              confidence: undefined,
            },
          };
        }
        if (node.type === 'resultNode') {
          return {
            ...node,
            data: {
              ...node.data,
              signal: undefined,
              score: undefined,
              confidence: undefined,
              timestamp: undefined,
            },
          };
        }
        return node;
      })
    );

    // Update edge visibility based on engine enabled state
    const engineKeys = Object.keys(pipeline.engines);
    const engineEdgeMap: Record<string, string> = {
      fundamental: 'ds-fund',
      technical: 'ds-tech',
      candlestick: 'ds-candle',
      mean_reversion: 'ds-meanrev',
    };
    const orchEdgeMap: Record<string, string> = {
      fundamental: 'fund-orch',
      technical: 'tech-orch',
      candlestick: 'candle-orch',
      mean_reversion: 'meanrev-orch',
    };

    setEdges(eds =>
      eds.map(edge => {
        // Check data source → engine edges
        for (const key of engineKeys) {
          if (edge.id === engineEdgeMap[key] || edge.id === orchEdgeMap[key]) {
            const isEnabled = pipeline.engines[key]?.enabled ?? true;
            return {
              ...edge,
              data: {
                ...edge.data,
                dashed: !isEnabled,
                color: isEnabled ? (edge.data as Record<string, unknown>)?.color : '#94a3b8',
              },
              animated: isEnabled,
            };
          }
        }
        return edge;
      })
    );
  }, [activePipeline, pipelines, setNodes, setEdges]);

  // Handle new connections
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds =>
        addEdge(
          {
            ...connection,
            type: 'customEdge',
            data: { color: '#6366f1' },
            animated: true,
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Toggle engine from node (double-click)
  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      if (node.type !== 'engineNode') return;
      const nodeData = node.data as EngineNodeData;

      // Optimistic update
      const newEnabled = !nodeData.enabled;
      setNodes(nds =>
        nds.map(n => {
          if (n.id === node.id) {
            return { ...n, data: { ...n.data, enabled: newEnabled, signal: undefined, score: undefined, confidence: undefined } };
          }
          return n;
        })
      );

      // API call
      await apiCall(`/api/v2/pipeline/${activePipeline}/engine/${nodeData.engineKey}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: newEnabled }),
      });

      // Reload pipelines to sync
      loadPipelines();
      toast.success(`${nodeData.label} ${newEnabled ? 'ON' : 'OFF'}`);
    },
    [activePipeline, setNodes]
  );

  // Execute analysis
  const handleExecute = useCallback(async () => {
    if (!ticker.trim()) {
      toast.error('Enter a ticker first');
      return;
    }
    setExecuting(true);
    try {
      const result = await apiCall<AnalysisResult>('/api/v2/analyze', {
        method: 'POST',
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), pipeline: activePipeline }),
      });

      if (result) {
        setAnalysisResult(result);

        // Update data source node with ticker
        setNodes(nds =>
          nds.map(n => {
            if (n.id === 'data-source') {
              return { ...n, data: { ...n.data, ticker: result.ticker } };
            }
            return n;
          })
        );

        // Update engine nodes with results
        setNodes(nds =>
          nds.map(n => {
            if (n.type === 'engineNode') {
              const engineKey = (n.data as EngineNodeData).engineKey;
              const engResult = result.engines?.find((e: EngineResult) => e.name === engineKey);
              if (engResult) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    signal: engResult.signal,
                    score: engResult.score,
                    confidence: engResult.confidence,
                  },
                };
              }
            }
            return n;
          })
        );

        // Update orchestrator node
        setNodes(nds =>
          nds.map(n => {
            if (n.id === 'orchestrator') {
              return {
                ...n,
                data: {
                  ...n.data,
                  signal: result.signal,
                  score: result.score,
                  confidence: result.confidence,
                },
              };
            }
            return n;
          })
        );

        // Update result node
        setNodes(nds =>
          nds.map(n => {
            if (n.id === 'result') {
              return {
                ...n,
                data: {
                  ...n.data,
                  signal: result.signal,
                  score: result.score,
                  confidence: result.confidence,
                  timestamp: result.timestamp,
                },
              };
            }
            return n;
          })
        );

        toast.success(`${result.ticker} → ${result.signal} (${result.score.toFixed(1)})`);
      } else {
        toast.error('Analysis failed');
      }
    } finally {
      setExecuting(false);
    }
  }, [ticker, activePipeline, setNodes]);

  // Save layout
  const handleSave = useCallback(() => {
    if (!layoutName.trim()) return;
    const layout = {
      id: `layout-${Date.now()}`,
      name: layoutName,
      pipeline: activePipeline,
      nodes,
      edges,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const saved = JSON.parse(localStorage.getItem('studio-layouts') || '[]');
    const existing = saved.findIndex((l: { name: string }) => l.name === layoutName);
    if (existing >= 0) {
      saved[existing] = { ...layout, created_at: saved[existing].created_at, updated_at: layout.updated_at };
    } else {
      saved.push(layout);
    }
    localStorage.setItem('studio-layouts', JSON.stringify(saved));
    toast.success(`Layout "${layoutName}" saved`);
  }, [layoutName, activePipeline, nodes, edges]);

  // Load layout
  const handleLoad = useCallback(() => {
    const saved = JSON.parse(localStorage.getItem('studio-layouts') || '[]');
    if (saved.length === 0) {
      toast.info('No saved layouts');
      return;
    }
    // Load most recent layout
    const layout = saved[saved.length - 1];
    if (layout.nodes) setNodes(layout.nodes);
    if (layout.edges) setEdges(layout.edges);
    if (layout.pipeline) setActivePipeline(layout.pipeline);
    setLayoutName(layout.name);
    toast.success(`Layout "${layout.name}" loaded`);
  }, [setNodes, setEdges]);

  // Reset to default
  const handleReset = useCallback(() => {
    setNodes(DEFAULT_NODES);
    setEdges(DEFAULT_EDGES);
    setAnalysisResult(null);
    setTicker('');
    setLayoutName('');
    toast.success('Layout reset');
  }, [setNodes, setEdges]);

  // Export layout as JSON
  const handleExport = useCallback(() => {
    const layout = {
      pipeline: activePipeline,
      nodes,
      edges,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio-layout-${activePipeline}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Layout exported');
  }, [activePipeline, nodes, edges]);

  const currentPipeline = pipelines.find(p => p.name === activePipeline);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <StudioToolbar
        pipelines={pipelines}
        activePipeline={activePipeline}
        onPipelineChange={setActivePipeline}
        currentPipeline={currentPipeline}
        ticker={ticker}
        onTickerChange={setTicker}
        onExecute={handleExecute}
        onSave={handleSave}
        onLoad={handleLoad}
        onReset={handleReset}
        onExport={handleExport}
        executing={executing}
        engineHealthy={engineHealthy}
        layoutName={layoutName}
        onLayoutNameChange={setLayoutName}
      />

      {/* Main Content: Canvas + Result Panel */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* React Flow Canvas */}
        <div className="flex-1 rounded-xl border bg-card shadow-sm overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{
              type: 'customEdge',
              animated: true,
            }}
            proOptions={{ hideAttribution: true }}
            className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#94a3b8" />
            <Controls position="bottom-left" className="!bg-card !border !shadow-md" />
            <MiniMap
              position="bottom-right"
              className="!bg-card !border !shadow-md"
              nodeColor={(node) => {
                if (node.type === 'dataSourceNode') return '#64748b';
                if (node.type === 'orchestratorNode') return '#6366f1';
                if (node.type === 'resultNode') return '#10b981';
                const key = (node.data as EngineNodeData)?.engineKey;
                if (key === 'fundamental') return '#10b981';
                if (key === 'technical') return '#0ea5e9';
                if (key === 'candlestick') return '#f59e0b';
                if (key === 'mean_reversion') return '#a855f7';
                return '#94a3b8';
              }}
              maskColor="rgba(0,0,0,0.1)"
            />
          </ReactFlow>
        </div>

        {/* Result Panel */}
        <div className="w-80 flex-shrink-0">
          <ResultPanel result={analysisResult} loading={executing} />
        </div>
      </div>

      {/* Hint */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span>💡 Double-click an engine node to toggle ON/OFF • Drag nodes to rearrange • Draw edges to connect</span>
        <span>Pipeline: {currentPipeline?.display_name || activePipeline}</span>
      </div>
    </div>
  );
}

// ============================================================================
// EXPORTED WRAPPER (with ReactFlowProvider)
// ============================================================================

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}

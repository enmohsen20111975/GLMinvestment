'use client';

import React from 'react';
import { FlowCanvas } from './FlowCanvas';
import { Sparkles, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * EngineStudio — Visual React Flow Editor
 * ============================================================
 * Drag/drop engine nodes, draw edges, save/load visual layouts,
 * execute analysis, see results flow through the pipeline.
 *
 * Pipeline:
 *   [Stock Data] ──→ [Fundamental] ──┐
 *                   ──→ [Technical]  ──┤
 *                   ──→ [Candlestick]──┤──→ [Orchestrator] ──→ [Result]
 *                   ──→ [MeanRev]    ──┘
 */
export default function EngineStudio() {
  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Engine Studio</h2>
            <p className="text-xs text-muted-foreground">
              Visual Pipeline Editor — Drag, Connect, Analyze
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Info className="h-3 w-3" />
            Double-click to toggle engines
          </Badge>
        </div>
      </div>

      {/* Flow Canvas */}
      <div className="flex-1 min-h-0">
        <FlowCanvas />
      </div>
    </div>
  );
}

'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CircuitBoard, Merge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { OrchestratorNodeData } from './types';
import { SIGNAL_VISUAL } from './types';

function OrchestratorNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as OrchestratorNodeData;
  const signalVisual = nodeData.signal ? SIGNAL_VISUAL[nodeData.signal] : null;

  return (
    <div
      className={`
        min-w-[200px] rounded-xl border-2 shadow-lg p-3
        bg-gradient-to-br from-teal-50 to-violet-50 dark:from-teal-950/30 dark:to-violet-950/30
        border-teal-300 dark:border-teal-700
        ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}
      `}
    >
      {/* Input Handles — left side (4 for 4 engines) */}
      <Handle
        type="target"
        position={Position.Left}
        id="eng-fundamental"
        className="!w-2.5 !h-2.5 !bg-emerald-500 !border-2 !border-white"
        style={{ top: '25%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="eng-technical"
        className="!w-2.5 !h-2.5 !bg-sky-500 !border-2 !border-white"
        style={{ top: '45%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="eng-candlestick"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-white"
        style={{ top: '65%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="eng-mean_reversion"
        className="!w-2.5 !h-2.5 !bg-purple-500 !border-2 !border-white"
        style={{ top: '85%' }}
      />

      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-teal-200 dark:bg-teal-800 flex items-center justify-center">
          <CircuitBoard className="h-4 w-4 text-teal-700 dark:text-teal-200" />
        </div>
        <div>
          <div className="font-semibold text-sm">{nodeData.label}</div>
          <div className="text-[10px] text-muted-foreground">{nodeData.labelAr}</div>
        </div>
      </div>

      {/* Pipeline info */}
      <div className="px-2 py-1 rounded bg-teal-100/50 dark:bg-teal-900/30 text-center mb-2">
        <span className="text-[10px] text-teal-700 dark:text-teal-300">{nodeData.pipelineDisplayName}</span>
      </div>

      {/* Combined result */}
      {nodeData.signal && (
        <div className="flex items-center justify-between mt-1 pt-2 border-t border-teal-200 dark:border-teal-800">
          {signalVisual && (
            <Badge className={`${signalVisual.bgClass} ${signalVisual.colorClass} text-xs font-bold`}>
              {signalVisual.emoji} {nodeData.signal}
            </Badge>
          )}
          {nodeData.score !== undefined && (
            <span className="text-sm font-bold">{nodeData.score.toFixed(1)}/10</span>
          )}
        </div>
      )}

      {/* Merge icon */}
      <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <Merge className="h-3 w-3" />
        <span>Weighted Merge</span>
      </div>

      {/* Output Handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white"
        style={{ top: '50%' }}
      />
    </div>
  );
}

export const OrchestratorNode = memo(OrchestratorNodeComponent);

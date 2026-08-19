'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileOutput, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ResultNodeData } from './types';
import { SIGNAL_VISUAL } from './types';

function ResultNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ResultNodeData;
  const signalVisual = nodeData.signal ? SIGNAL_VISUAL[nodeData.signal] : null;

  return (
    <div
      className={`
        min-w-[180px] rounded-xl border-2 shadow-lg p-3
        bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30
        border-emerald-300 dark:border-emerald-700
        ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}
      `}
    >
      {/* Input Handle — left side */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white"
        style={{ top: '50%' }}
      />

      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-emerald-200 dark:bg-emerald-800 flex items-center justify-center">
          <FileOutput className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
        </div>
        <div>
          <div className="font-semibold text-sm">{nodeData.label}</div>
          <div className="text-[10px] text-muted-foreground">{nodeData.labelAr}</div>
        </div>
      </div>

      {/* Final Result */}
      {nodeData.signal ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center">
            {signalVisual && (
              <Badge className={`${signalVisual.bgClass} ${signalVisual.colorClass} text-lg px-4 py-1 font-bold`}>
                {signalVisual.emoji} {nodeData.signal}
              </Badge>
            )}
          </div>
          {nodeData.score !== undefined && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-1.5 rounded bg-emerald-100/50 dark:bg-emerald-900/30">
                <div className="text-lg font-bold">{nodeData.score.toFixed(1)}</div>
                <div className="text-[10px] text-muted-foreground">Score /10</div>
              </div>
              <div className="p-1.5 rounded bg-emerald-100/50 dark:bg-emerald-900/30">
                <div className="text-lg font-bold">{nodeData.confidence?.toFixed(0)}%</div>
                <div className="text-[10px] text-muted-foreground">Confidence</div>
              </div>
            </div>
          )}
          {nodeData.timestamp && (
            <div className="text-[10px] text-muted-foreground text-center">
              {new Date(nodeData.timestamp).toLocaleTimeString('ar-EG')}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs">Waiting for analysis...</span>
        </div>
      )}
    </div>
  );
}

export const ResultNode = memo(ResultNodeComponent);

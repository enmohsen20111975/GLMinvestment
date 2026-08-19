'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, Activity, Zap, TrendingDown, XCircle,
} from 'lucide-react';
import type { EngineNodeData } from './types';
import { ENGINE_VISUAL, SIGNAL_VISUAL } from './types';

const ICON_MAP: Record<string, React.ReactNode> = {
  'bar-chart': <BarChart3 className="h-5 w-5" />,
  'activity': <Activity className="h-5 w-5" />,
  'zap': <Zap className="h-5 w-5" />,
  'trending-down': <TrendingDown className="h-5 w-5" />,
};

function EngineNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as EngineNodeData;
  const visual = ENGINE_VISUAL[nodeData.engineKey] || ENGINE_VISUAL.technical;
  const signalVisual = nodeData.signal ? SIGNAL_VISUAL[nodeData.signal] : null;

  return (
    <div
      className={`
        min-w-[200px] rounded-xl border-2 shadow-lg transition-all duration-300
        ${visual.bgColorClass}
        ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}
        ${!nodeData.enabled ? 'opacity-50 border-dashed grayscale' : ''}
      `}
    >
      {/* Input Handle — left side */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white"
        style={{ top: '50%' }}
      />

      <div className="p-3">
        {/* Header: icon + name + switch */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={visual.colorClass}>
              {ICON_MAP[nodeData.iconType] || ICON_MAP['activity']}
            </div>
            <div>
              <div className="font-semibold text-sm leading-tight">{nodeData.label}</div>
              <div className="text-[10px] text-muted-foreground">{nodeData.labelAr}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {signalVisual && nodeData.enabled && (
              <Badge className={`${signalVisual.bgClass} ${signalVisual.colorClass} text-[10px] px-1.5 py-0`}>
                {nodeData.signal}
              </Badge>
            )}
            {!nodeData.enabled && (
              <XCircle className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Weight Slider */}
        {nodeData.enabled && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Weight</span>
              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                {nodeData.weight.toFixed(1)}x
              </Badge>
            </div>
            <Slider
              value={[nodeData.weight]}
              min={0}
              max={5}
              step={0.5}
              disabled
              className="w-full"
            />
          </div>
        )}

        {/* Score/Confidence */}
        {nodeData.enabled && nodeData.score !== undefined && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-current/10">
            <span className="text-xs font-bold">{nodeData.score?.toFixed(1)}/10</span>
            <span className="text-[10px] text-muted-foreground">{nodeData.confidence?.toFixed(0)}%</span>
          </div>
        )}
      </div>

      {/* Output Handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-sky-500 !border-2 !border-white"
        style={{ top: '50%' }}
      />
    </div>
  );
}

export const EngineNode = memo(EngineNodeComponent);

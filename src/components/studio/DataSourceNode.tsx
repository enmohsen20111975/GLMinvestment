'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Database, ArrowRight } from 'lucide-react';
import type { DataSourceNodeData } from './types';

function DataSourceNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DataSourceNodeData;

  return (
    <div
      className={`
        min-w-[180px] rounded-xl border-2 shadow-lg p-3
        bg-slate-50 dark:bg-slate-900/50 border-slate-300 dark:border-slate-700
        ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
          <Database className="h-4 w-4 text-slate-600 dark:text-slate-300" />
        </div>
        <div>
          <div className="font-semibold text-sm">{nodeData.label}</div>
          <div className="text-[10px] text-muted-foreground">{nodeData.labelAr}</div>
        </div>
      </div>

      {nodeData.ticker && (
        <div className="mt-1 px-2 py-1 rounded bg-slate-200/50 dark:bg-slate-700/50 text-center">
          <span className="text-sm font-mono font-bold">{nodeData.ticker}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        <span>Stock Data</span>
      </div>

      {/* Output Handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-slate-500 !border-2 !border-white"
        style={{ top: '50%' }}
      />
    </div>
  );
}

export const DataSourceNode = memo(DataSourceNodeComponent);

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Play, Save, FolderOpen, RotateCcw, Loader2, Settings2,
  Sparkles, Download, Upload,
} from 'lucide-react';
import type { PipelineInfo } from './types';

interface ToolbarProps {
  // Pipeline
  pipelines: PipelineInfo[];
  activePipeline: string;
  onPipelineChange: (name: string) => void;
  currentPipeline?: PipelineInfo;

  // Ticker
  ticker: string;
  onTickerChange: (ticker: string) => void;

  // Actions
  onExecute: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onExport: () => void;

  // State
  executing: boolean;
  engineHealthy: boolean | null;
  layoutName: string;
  onLayoutNameChange: (name: string) => void;
}

export function StudioToolbar({
  pipelines,
  activePipeline,
  onPipelineChange,
  currentPipeline,
  ticker,
  onTickerChange,
  onExecute,
  onSave,
  onLoad,
  onReset,
  onExport,
  executing,
  engineHealthy,
  layoutName,
  onLayoutNameChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 bg-card border rounded-xl shadow-sm">
      {/* Pipeline Selector */}
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <Select value={activePipeline} onValueChange={onPipelineChange}>
          <SelectTrigger className="w-[180px] h-9 text-sm">
            <SelectValue placeholder="Pipeline" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map(p => (
              <SelectItem key={p.name} value={p.name}>
                {p.display_name}
                {p.is_custom && ' ⭐'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ticker Input */}
      <div className="flex items-center gap-2">
        <Input
          value={ticker}
          onChange={e => onTickerChange(e.target.value.toUpperCase())}
          placeholder="Ticker (e.g. AAPL)"
          className="w-32 h-9 text-sm font-mono"
          onKeyDown={e => e.key === 'Enter' && onExecute()}
        />
      </div>

      {/* Execute Button */}
      <Button
        onClick={onExecute}
        disabled={executing || !ticker.trim()}
        size="sm"
        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
      >
        {executing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        Execute
      </Button>

      {/* Divider */}
      <div className="h-6 w-px bg-border" />

      {/* Layout Name */}
      <Input
        value={layoutName}
        onChange={e => onLayoutNameChange(e.target.value)}
        placeholder="Layout name"
        className="w-36 h-9 text-sm"
      />

      {/* Save Layout */}
      <Button variant="outline" size="sm" onClick={onSave} disabled={!layoutName.trim()} className="gap-1.5">
        <Save className="h-4 w-4" />
        Save
      </Button>

      {/* Load Layout */}
      <Button variant="outline" size="sm" onClick={onLoad} className="gap-1.5">
        <FolderOpen className="h-4 w-4" />
        Load
      </Button>

      {/* Export */}
      <Button variant="ghost" size="sm" onClick={onExport} className="gap-1.5">
        <Download className="h-4 w-4" />
      </Button>

      {/* Divider */}
      <div className="h-6 w-px bg-border" />

      {/* Reset */}
      <Button variant="outline" size="sm" onClick={onReset} className="gap-1.5">
        <RotateCcw className="h-4 w-4" />
        Reset
      </Button>

      {/* Health */}
      <div className="ml-auto">
        {engineHealthy !== null && (
          <Badge variant={engineHealthy ? 'default' : 'destructive'} className="gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            {engineHealthy ? 'Live' : 'Offline'}
          </Badge>
        )}
      </div>
    </div>
  );
}

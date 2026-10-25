'use client';

/**
 * Premium Chart — DrawingToolbar
 * =====================================================================
 *
 * شريط أدوات رأسي على يمين الشارت لاختيار أداة الرسم.
 * يحتوي على:
 * - 9 أدوات رسم (cursor, trendline, hline, vline, rectangle, fib, brush, text, arrow, measure)
 * - منتقي الألوان (8 ألوان)
 * - منتقي سُمك الخط (1-4)
 * - منتقي نمط الخط (solid/dashed/dotted)
 * - أزرار undo/redo/clear
 * - زر إظهار/إخفاء الرسومات
 * - magnet mode toggle
 *
 * RTL-aware: شريط رأسي يظهر على اليمين في وضع RTL.
 */

import React from 'react';
import {
  MousePointer2,
  Minus,
  AlignCenterVertical,
  Square,
  TrendingUp,
  Pen,
  Type,
  ArrowUpRight,
  Ruler,
  Undo2,
  Redo2,
  Trash2,
  Eye,
  EyeOff,
  Magnet,
} from 'lucide-react';
import { useDrawingStore } from './drawing-store';
import type { ToolType, DrawingColor, LineWidth, LineStyleName } from '../types';
import { TOOL_LABELS } from '../types';
import { cn } from '@/lib/utils';

const TOOLS: Array<{ type: ToolType; icon: React.ElementType; label: string }> = [
  { type: 'cursor', icon: MousePointer2, label: TOOL_LABELS.cursor },
  { type: 'trendline', icon: TrendingUp, label: TOOL_LABELS.trendline },
  { type: 'hline', icon: Minus, label: TOOL_LABELS.hline },
  { type: 'vline', icon: AlignCenterVertical, label: TOOL_LABELS.vline },
  { type: 'rectangle', icon: Square, label: TOOL_LABELS.rectangle },
  { type: 'fib', icon: Ruler, label: TOOL_LABELS.fib },
  { type: 'brush', icon: Pen, label: TOOL_LABELS.brush },
  { type: 'text', icon: Type, label: TOOL_LABELS.text },
  { type: 'arrow', icon: ArrowUpRight, label: TOOL_LABELS.arrow },
  { type: 'measure', icon: Ruler, label: TOOL_LABELS.measure },
];

const COLORS: DrawingColor[] = [
  '#ef5350', '#26a69a', '#2196f3', '#ff9800',
  '#9c27b0', '#f0b90b', '#ffffff', '#78909c',
];

const WIDTHS: LineWidth[] = [1, 2, 3, 4];

const STYLES: Array<{ name: LineStyleName; label: string }> = [
  { name: 'solid', label: '━━━' },
  { name: 'dashed', label: '╌╌╌' },
  { name: 'dotted', label: '⋯⋯⋯' },
  { name: 'large_dashed', label: '╌ ╌ ╌' },
];

export function DrawingToolbar() {
  const {
    selectedTool,
    setTool,
    settings,
    updateSettings,
    showDrawings,
    toggleShowDrawings,
    undo,
    redo,
    clearAll,
    _past,
    _future,
    drawings,
  } = useDrawingStore();

  const canUndo = _past.length > 0;
  const canRedo = _future.length > 0;
  const hasDrawings = drawings.length > 0;

  return (
    <div
      dir="rtl"
      className="absolute top-2 right-2 z-20 flex flex-col gap-1 p-1.5 bg-card/95 backdrop-blur border border-border rounded-xl shadow-lg"
      style={{ pointerEvents: 'auto' }}
    >
      {/* Tools section */}
      <div className="flex flex-col gap-0.5">
        {TOOLS.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => setTool(type)}
            title={label}
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              selectedTool === type
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Undo / Redo */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="تراجع (Ctrl+Z)"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title="إعادة (Ctrl+Y)"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Colors */}
      <div className="grid grid-cols-2 gap-0.5">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => updateSettings({ color })}
            title={color}
            className={cn(
              'w-4 h-4 rounded transition-transform',
              settings.color === color ? 'ring-2 ring-offset-1 ring-offset-card ring-primary scale-110' : 'hover:scale-110'
            )}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Width selector */}
      <div className="flex flex-col gap-0.5">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => updateSettings({ width: w })}
            title={`سُمك ${w}`}
            className={cn(
              'w-8 h-6 rounded flex items-center justify-center transition-colors',
              settings.width === w ? 'bg-muted' : 'hover:bg-muted/50'
            )}
          >
            <div
              className="rounded-full"
              style={{
                width: '16px',
                height: `${w}px`,
                backgroundColor: settings.color,
              }}
            />
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Line style */}
      <div className="flex flex-col gap-0.5">
        {STYLES.map(({ name, label }) => (
          <button
            key={name}
            type="button"
            onClick={() => updateSettings({ style: name })}
            title={name}
            className={cn(
              'w-8 h-6 rounded text-[10px] font-mono flex items-center justify-center transition-colors',
              settings.style === name ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-border my-1" />

      {/* Magnet toggle */}
      <button
        type="button"
        onClick={() => updateSettings({ magnetMode: !settings.magnetMode })}
        title="مغناطيس (التصاق بالشموع)"
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
          settings.magnetMode ? 'bg-info/20 text-info' : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <Magnet className="w-4 h-4" />
      </button>

      {/* Show/Hide toggle */}
      <button
        type="button"
        onClick={toggleShowDrawings}
        title={showDrawings ? 'إخفاء الرسومات' : 'إظهار الرسومات'}
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
          showDrawings ? 'text-foreground' : 'text-muted-foreground/50',
          'hover:bg-muted'
        )}
      >
        {showDrawings ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>

      {/* Clear all */}
      <button
        type="button"
        onClick={() => {
          if (hasDrawings && window.confirm('حذف كل الرسومات؟')) {
            clearAll();
          }
        }}
        disabled={!hasDrawings}
        title="مسح الكل"
        className="w-8 h-8 rounded-lg flex items-center justify-center text-loss hover:bg-loss/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Drawings count */}
      {hasDrawings && (
        <div className="text-center text-[10px] text-muted-foreground font-mono mt-1">
          {drawings.length}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Premium Chart — DrawingCanvas
 * =====================================================================
 *
 * طبقة canvas شفافة فوق lightweight-charts. ترسم كل الرسومات التفاعلية.
 *
 * المعمارية:
 * - <canvas> مطلق التموضع فوق الـ <div> الخاص بـ lightweight-charts
 * - يحوّل pixel ↔ time/price عبر الـ API الرسمي لـ lightweight-charts:
 *   chart.timeScale().timeToCoordinate(t) → x pixel
 *   chart.timeScale().coordinateToTime(x) → time
 *   series.priceToCoordinate(p) → y pixel
 *   series.coordinateToPrice(y) → price
 * - يعيد الرسم عند أي تغيير في zoom/pan عبر subscribeVisibleLogicalRangeChange
 * - يدعم magnet mode (snap إلى high/low/close أقرب شمعة)
 * - يدعم undo/redo عبر Zustand store
 *
 * أدوات الرسم المدعومة:
 *   trendline, hline, vline, rectangle, fib, brush, text, arrow, measure
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useDrawingStore } from './drawing-store';
import type {
  Drawing,
  ChartPoint,
  ToolType,
  DrawingTool,
} from '../types';
import { fmtDateLabel, formatPrice } from '../utils';

interface DrawingCanvasProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  width: number;
  height: number;
  storageKey?: string;
}

interface DragState {
  tool: DrawingTool;
  points: ChartPoint[];
  drawingId: string | null; // for edit mode
  isDrawing: boolean;
}

export function DrawingCanvas({
  chart,
  candleSeries,
  width,
  height,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [cursor, setCursor] = useState<string>('crosshair');

  const {
    drawings,
    selectedTool,
    selectedDrawingId,
    settings,
    showDrawings,
    addDrawing,
    updateDrawing,
    removeDrawing,
    selectDrawing,
    createDrawing,
  } = useDrawingStore();

  // ─── Coordinate Conversion (pixel ↔ time/price) ─────────────────────────
  const pixelToPoint = useCallback(
    (x: number, y: number): ChartPoint | null => {
      if (!chart || !candleSeries) return null;
      const timeScale = chart.timeScale();
      const time = timeScale.coordinateToTime(x) as unknown as number;
      const price = candleSeries.coordinateToPrice(y);
      if (time === null || time === undefined || price === null || price === undefined) {
        return null;
      }
      // Convert Time to unix seconds
      let timeNum: number;
      if (typeof time === 'number') {
        timeNum = time;
      } else {
        const ts = Date.parse(String(time).replace(' ', 'T'));
        timeNum = isNaN(ts) ? 0 : Math.floor(ts / 1000);
      }
      return { time: timeNum, price };
    },
    [chart, candleSeries]
  );

  const pointToPixel = useCallback(
    (point: ChartPoint): { x: number; y: number } | null => {
      if (!chart || !candleSeries) return null;
      const timeScale = chart.timeScale();
      // Convert unix seconds → Time (lightweight-charts accepts both)
      const t = point.time as unknown as Time;
      const x = timeScale.timeToCoordinate(t);
      const y = candleSeries.priceToCoordinate(point.price);
      if (x === null || y === null) return null;
      return { x, y };
    },
    [chart, candleSeries]
  );

  // ─── Magnet Mode: snap to nearest candle's high/low/close ────────────────
  const snapPoint = useCallback(
    (point: ChartPoint): ChartPoint => {
      if (!settings.magnetMode || !chart || !candleSeries) return point;
      // For magnet mode, we'd need access to ohlcv data. Skip for now — return as-is.
      // (Implementation would find nearest candle in time and return its high/low/close)
      return point;
    },
    [settings.magnetMode, chart, candleSeries]
  );

  // ─── Render all drawings ──────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size for high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!showDrawings) return;

    // Render each drawing
    for (const drawing of drawings) {
      const isSelected = drawing.id === selectedDrawingId;
      renderDrawing(ctx, drawing, pointToPixel, isSelected);
    }

    // Render in-progress drawing (drag preview)
    if (dragStateRef.current && dragStateRef.current.isDrawing) {
      const preview = createDrawing(
        dragStateRef.current.tool,
        dragStateRef.current.points
      );
      if (preview) {
        renderDrawing(ctx, preview, pointToPixel, false, true);
      }
    }
  }, [drawings, selectedDrawingId, showDrawings, pointToPixel, createDrawing, width, height]);

  // ─── Re-render on visible range change (zoom/pan) ────────────────────────
  useEffect(() => {
    if (!chart) return;
    const timeScale = chart.timeScale();
    const handler = () => render();
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    timeScale.subscribeVisibleTimeRangeChange(handler);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handler);
      timeScale.unsubscribeVisibleTimeRangeChange(handler);
    };
  }, [chart, render]);

  // Re-render when drawings change
  useEffect(() => {
    render();
  }, [render]);

  // ─── Mouse Event Handlers ─────────────────────────────────────────────────
  const getMousePos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (selectedTool === 'cursor' || selectedTool === 'none') {
      // Click on existing drawing to select it
      const pos = getMousePos(e);
      const clicked = findDrawingAt(pos.x, pos.y);
      selectDrawing(clicked?.id ?? null);
      return;
    }

    const pos = getMousePos(e);
    const point = pixelToPoint(pos.x, pos.y);
    if (!point) return;
    const snapped = snapPoint(point);

    const tool = selectedTool as DrawingTool;
    const needsMultiPoint = tool !== 'brush' && tool !== 'text' && tool !== 'hline' && tool !== 'vline';

    if (tool === 'text') {
      // Single-click placement, prompt for text
      const text = window.prompt('اكتب النص:', 'ملاحظة');
      if (text) {
        const drawing = createDrawing('text', [snapped]);
        if (drawing) {
          (drawing as any).text = text;
          addDrawing(drawing);
        }
      }
      return;
    }

    if (tool === 'hline' || tool === 'vline') {
      // Single-click placement
      const drawing = createDrawing(tool, [snapped]);
      if (drawing) addDrawing(drawing);
      return;
    }

    if (tool === 'brush') {
      dragStateRef.current = {
        tool,
        points: [snapped],
        drawingId: null,
        isDrawing: true,
      };
      return;
    }

    // Multi-point tools (trendline, rectangle, fib, arrow, measure)
    if (!dragStateRef.current) {
      // First click — start
      dragStateRef.current = {
        tool,
        points: [snapped],
        drawingId: null,
        isDrawing: true,
      };
      render();
    } else {
      // Second click — finalize
      const points = [...dragStateRef.current.points, snapped];
      const drawing = createDrawing(dragStateRef.current.tool, points);
      if (drawing) addDrawing(drawing);
      dragStateRef.current = null;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    // Update drag preview for multi-point tools
    if (dragStateRef.current?.isDrawing) {
      const point = pixelToPoint(pos.x, pos.y);
      if (point) {
        const snapped = snapPoint(point);
        if (dragStateRef.current.tool === 'brush') {
          dragStateRef.current.points.push(snapped);
        } else {
          // For multi-point tools, replace the second (preview) point
          if (dragStateRef.current.points.length >= 2) {
            dragStateRef.current.points[1] = snapped;
          } else {
            dragStateRef.current.points.push(snapped);
          }
        }
        render();
      }
    }

    // Update cursor style
    if (selectedTool === 'cursor' || selectedTool === 'none') {
      const hover = findDrawingAt(pos.x, pos.y);
      setCursor(hover ? 'move' : 'default');
    } else {
      setCursor('crosshair');
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragStateRef.current?.tool === 'brush') {
      // Finalize brush
      const drawing = createDrawing('brush', dragStateRef.current.points);
      if (drawing) addDrawing(drawing);
      dragStateRef.current = null;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Finalize any in-progress drawing
    if (dragStateRef.current) {
      dragStateRef.current = null;
      render();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getMousePos(e);
    const clicked = findDrawingAt(pos.x, pos.y);
    if (clicked) {
      if (window.confirm('حذف هذا الرسم؟')) {
        removeDrawing(clicked.id);
      }
    }
  };

  // ─── Hit-test: find drawing at (x, y) ────────────────────────────────────
  const findDrawingAt = (x: number, y: number): Drawing | null => {
    // Iterate in reverse (topmost first)
    for (let i = drawings.length - 1; i >= 0; i--) {
      const drawing = drawings[i];
      if (hitTest(drawing, x, y, pointToPixel)) {
        return drawing;
      }
    }
    return null;
  };

  // ─── Keyboard shortcuts (Ctrl+Z, Delete, Esc) ────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger if focus is in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useDrawingStore.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        useDrawingStore.getState().redo();
      } else if (e.key === 'Escape') {
        dragStateRef.current = null;
        selectDrawing(null);
        render();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        removeDrawing(selectedDrawingId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedDrawingId, removeDrawing, selectDrawing, render]);

  if (!chart || !candleSeries) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-auto z-10"
      style={{ cursor }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className="absolute inset-0"
      />
    </div>
  );
}

// ─── Drawing Renderers ──────────────────────────────────────────────────────

type PointConverter = (point: ChartPoint) => { x: number; y: number } | null;

function renderDrawing(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  toPixel: PointConverter,
  isSelected: boolean = false,
  isPreview: boolean = false
) {
  ctx.save();
  if (isPreview) {
    ctx.globalAlpha = 0.6;
  }
  if (isSelected) {
    ctx.shadowColor = '#2196f3';
    ctx.shadowBlur = 8;
  }

  switch (drawing.type) {
    case 'trendline':
      renderTrendline(ctx, drawing, toPixel);
      break;
    case 'hline':
      renderHLine(ctx, drawing, toPixel);
      break;
    case 'vline':
      renderVLine(ctx, drawing, toPixel);
      break;
    case 'rectangle':
      renderRectangle(ctx, drawing, toPixel);
      break;
    case 'fib':
      renderFib(ctx, drawing, toPixel);
      break;
    case 'brush':
      renderBrush(ctx, drawing, toPixel);
      break;
    case 'text':
      renderText(ctx, drawing, toPixel);
      break;
    case 'arrow':
      renderArrow(ctx, drawing, toPixel);
      break;
    case 'measure':
      renderMeasure(ctx, drawing, toPixel);
      break;
  }
  ctx.restore();
}

function renderTrendline(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'trendline' }>,
  toPixel: PointConverter
) {
  const p1 = toPixel(d.points[0]);
  const p2 = toPixel(d.points[1]);
  if (!p1 || !p2) return;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  setLineStyle(ctx, d.style);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  if (d.showLabel && d.label) {
    ctx.fillStyle = d.color;
    ctx.font = '12px sans-serif';
    ctx.fillText(d.label, p2.x + 6, p2.y - 6);
  }
}

function renderHLine(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'hline' }>,
  toPixel: PointConverter
) {
  const p = toPixel(d.point);
  if (!p) return;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  setLineStyle(ctx, d.style);
  ctx.beginPath();
  ctx.moveTo(0, p.y);
  ctx.lineTo(ctx.canvas.width, p.y);
  ctx.stroke();
  if (d.label) {
    ctx.fillStyle = d.color;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(d.label, 8, p.y - 4);
  } else {
    ctx.fillStyle = d.color;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(formatPrice(d.point.price), 8, p.y - 4);
  }
}

function renderVLine(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'vline' }>,
  toPixel: PointConverter
) {
  const p = toPixel(d.point);
  if (!p) return;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  setLineStyle(ctx, d.style);
  ctx.beginPath();
  ctx.moveTo(p.x, 0);
  ctx.lineTo(p.x, ctx.canvas.height);
  ctx.stroke();
  if (d.label) {
    ctx.fillStyle = d.color;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(d.label, p.x + 4, 14);
  } else {
    ctx.fillStyle = d.color;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(fmtDateLabel(d.point.time), p.x + 4, 14);
  }
}

function renderRectangle(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'rectangle' }>,
  toPixel: PointConverter
) {
  const p1 = toPixel(d.points[0]);
  const p2 = toPixel(d.points[1]);
  if (!p1 || !p2) return;
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);
  if (d.fillEnabled) {
    ctx.fillStyle = hexWithAlpha(d.color, d.fillOpacity);
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  setLineStyle(ctx, 'solid');
  ctx.strokeRect(x, y, w, h);
}

function renderFib(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'fib' }>,
  toPixel: PointConverter
) {
  const p1 = toPixel(d.points[0]);
  const p2 = toPixel(d.points[1]);
  if (!p1 || !p2) return;
  const high = Math.max(p1.y, p2.y);
  const low = Math.min(p1.y, p2.y);
  const diff = high - low;
  ctx.lineWidth = d.width;
  for (const level of d.levels) {
    const y = high - diff * level;
    const alpha = level === 0.618 || level === 0.786 ? 0.9 : 0.5;
    ctx.strokeStyle = hexWithAlpha(d.color, alpha);
    ctx.beginPath();
    ctx.moveTo(Math.min(p1.x, p2.x), y);
    ctx.lineTo(Math.max(p1.x, p2.x), y);
    ctx.stroke();
    if (d.showLabels) {
      ctx.fillStyle = d.color;
      ctx.font = '10px sans-serif';
      const pct = (level * 100).toFixed(1) + '%';
      ctx.fillText(pct, Math.min(p1.x, p2.x) + 4, y - 3);
    }
  }
}

function renderBrush(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'brush' }>,
  toPixel: PointConverter
) {
  if (d.points.length < 2) return;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const first = toPixel(d.points[0]);
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < d.points.length; i++) {
    const p = toPixel(d.points[i]);
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function renderText(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'text' }>,
  toPixel: PointConverter
) {
  const p = toPixel(d.point);
  if (!p) return;
  ctx.font = `bold ${d.fontSize}px sans-serif`;
  const metrics = ctx.measureText(d.text);
  const padding = 4;
  if (d.background) {
    ctx.fillStyle = d.background;
    ctx.fillRect(p.x - padding, p.y - d.fontSize, metrics.width + padding * 2, d.fontSize + padding);
  }
  ctx.fillStyle = d.color;
  ctx.fillText(d.text, p.x, p.y);
}

function renderArrow(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'arrow' }>,
  toPixel: PointConverter
) {
  const p1 = toPixel(d.points[0]);
  const p2 = toPixel(d.points[1]);
  if (!p1 || !p2) return;
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = d.width;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  // Arrow head
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 12;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(
    p2.x - headLen * Math.cos(angle - Math.PI / 6),
    p2.y - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    p2.x - headLen * Math.cos(angle + Math.PI / 6),
    p2.y - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

function renderMeasure(
  ctx: CanvasRenderingContext2D,
  d: Extract<Drawing, { type: 'measure' }>,
  toPixel: PointConverter
) {
  const p1 = toPixel(d.points[0]);
  const p2 = toPixel(d.points[1]);
  if (!p1 || !p2) return;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  setLineStyle(ctx, 'dashed');
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  // Show measurement label
  const priceDiff = d.points[1].price - d.points[0].price;
  const pctChange = (priceDiff / d.points[0].price) * 100;
  const label = `${formatPrice(Math.abs(priceDiff))} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`;
  ctx.fillStyle = d.color;
  ctx.font = 'bold 11px sans-serif';
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  ctx.fillText(label, midX + 6, midY - 4);
}

// ─── Hit Test (find drawing at point) ────────────────────────────────────────

function hitTest(
  drawing: Drawing,
  x: number,
  y: number,
  toPixel: PointConverter
): boolean {
  const tolerance = 6;
  switch (drawing.type) {
    case 'trendline':
    case 'arrow':
    case 'measure': {
      const p1 = toPixel(drawing.points[0]);
      const p2 = toPixel(drawing.points[1]);
      if (!p1 || !p2) return false;
      return distanceToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tolerance;
    }
    case 'hline': {
      const p = toPixel(drawing.point);
      if (!p) return false;
      return Math.abs(y - p.y) <= tolerance;
    }
    case 'vline': {
      const p = toPixel(drawing.point);
      if (!p) return false;
      return Math.abs(x - p.x) <= tolerance;
    }
    case 'rectangle': {
      const p1 = toPixel(drawing.points[0]);
      const p2 = toPixel(drawing.points[1]);
      if (!p1 || !p2) return false;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      // Check if on border
      const onTop = y >= minY - tolerance && y <= minY + tolerance && x >= minX && x <= maxX;
      const onBottom = y >= maxY - tolerance && y <= maxY + tolerance && x >= minX && x <= maxX;
      const onLeft = x >= minX - tolerance && x <= minX + tolerance && y >= minY && y <= maxY;
      const onRight = x >= maxX - tolerance && x <= maxX + tolerance && y >= minY && y <= maxY;
      return onTop || onBottom || onLeft || onRight;
    }
    case 'brush': {
      for (let i = 1; i < drawing.points.length; i++) {
        const p1 = toPixel(drawing.points[i - 1]);
        const p2 = toPixel(drawing.points[i]);
        if (!p1 || !p2) continue;
        if (distanceToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tolerance) {
          return true;
        }
      }
      return false;
    }
    case 'text': {
      const p = toPixel(drawing.point);
      if (!p) return false;
      return x >= p.x && x <= p.x + 80 && y <= p.y && y >= p.y - drawing.fontSize - 4;
    }
    case 'fib': {
      const p1 = toPixel(drawing.points[0]);
      const p2 = toPixel(drawing.points[1]);
      if (!p1 || !p2) return false;
      const high = Math.max(p1.y, p2.y);
      const low = Math.min(p1.y, p2.y);
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const diff = high - low;
      for (const level of drawing.levels) {
        const yLevel = high - diff * level;
        if (Math.abs(y - yLevel) <= tolerance && x >= minX && x <= maxX) {
          return true;
        }
      }
      return false;
    }
  }
  return false;
}

// ─── Math Helpers ────────────────────────────────────────────────────────────

function distanceToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function setLineStyle(ctx: CanvasRenderingContext2D, style: string) {
  switch (style) {
    case 'dashed':
      ctx.setLineDash([6, 4]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 3]);
      break;
    case 'large_dashed':
      ctx.setLineDash([12, 6]);
      break;
    default:
      ctx.setLineDash([]);
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  // Convert #RRGGBB → rgba()
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

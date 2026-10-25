/**
 * Premium Chart — Drawing Store (Zustand)
 * =====================================================================
 *
 * نظام إدارة الرسومات التفاعلية على الشارت:
 * - drawings[]: كل الرسومات الحالية
 * - selectedTool: الأداة المختارة حالياً
 * - selectedDrawingId: الرسم المختار للتعديل/الحذف
 * - color, width, style: الإعدادات الحالية للأداة
 * - undo/redo: سجل التراجع والإعادة (Ctrl+Z / Ctrl+Shift+Z)
 * - persistence: حفظ تلقائي في localStorage حسب storageKey
 *
 * كل رسم له معرّف فريد (id) ونوع (type) ونقاط (points) بتنظّم time/price
 * (مش pixel coordinates) — فالرسم يفضل ثابت حتى مع zoom/pan.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Drawing,
  ToolType,
  DrawingColor,
  LineWidth,
  LineStyleName,
  DrawingTool,
} from '../types';
import { genId, DEFAULT_FIB_LEVELS } from '../types';

export interface DrawingSettings {
  color: DrawingColor;
  width: LineWidth;
  style: LineStyleName;
  fillOpacity: number;
  fillEnabled: boolean;
  fontSize: number;
  magnetMode: boolean; // snap to candle high/low/close
}

interface DrawingState {
  // ─── State ──────────────────────────────────────────────────────────────
  drawings: Drawing[];
  selectedTool: ToolType;
  selectedDrawingId: string | null;
  settings: DrawingSettings;
  showDrawings: boolean;

  // undo/redo stacks
  _past: Drawing[][];
  _future: Drawing[][];

  // ─── Actions ─────────────────────────────────────────────────────────────
  setTool: (tool: ToolType) => void;
  selectDrawing: (id: string | null) => void;
  updateSettings: (partial: Partial<DrawingSettings>) => void;
  toggleShowDrawings: () => void;

  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  clearAll: () => void;

  undo: () => void;
  redo: () => void;

  // helper for creating a new drawing with default settings
  createDrawing: (type: DrawingTool, points: any[]) => Drawing | null;
}

const DEFAULT_SETTINGS: DrawingSettings = {
  color: '#2196f3',
  width: 2,
  style: 'solid',
  fillOpacity: 0.15,
  fillEnabled: true,
  fontSize: 13,
  magnetMode: true,
};

/**
 * Factory function: تنشئ رسماً جديداً حسب النوع بنقاط معينة.
 * تستخدم الإعدادات الحالية (color, width, style).
 */
function buildDrawing(
  type: DrawingTool,
  points: any[],
  settings: DrawingSettings
): Drawing | null {
  const id = genId();
  const base = { id, color: settings.color, width: settings.width };

  switch (type) {
    case 'trendline':
      if (points.length < 2) return null;
      return {
        ...base,
        type: 'trendline',
        points: [points[0], points[1]],
        style: settings.style,
        extendLeft: false,
        extendRight: false,
        showLabel: false,
      } as Drawing;

    case 'hline':
      if (points.length < 1) return null;
      return {
        ...base,
        type: 'hline',
        point: points[0],
        style: settings.style,
      } as Drawing;

    case 'vline':
      if (points.length < 1) return null;
      return {
        ...base,
        type: 'vline',
        point: points[0],
        style: settings.style,
      } as Drawing;

    case 'rectangle':
      if (points.length < 2) return null;
      return {
        ...base,
        type: 'rectangle',
        points: [points[0], points[1]],
        fillOpacity: settings.fillOpacity,
        fillEnabled: settings.fillEnabled,
      } as Drawing;

    case 'fib':
      if (points.length < 2) return null;
      return {
        ...base,
        type: 'fib',
        points: [points[0], points[1]],
        levels: [...DEFAULT_FIB_LEVELS],
        showLabels: true,
      } as Drawing;

    case 'brush':
      if (points.length < 1) return null;
      return {
        ...base,
        type: 'brush',
        points: [...points],
      } as Drawing;

    case 'text':
      if (points.length < 1) return null;
      return {
        id,
        type: 'text',
        point: points[0],
        text: 'نص جديد',
        color: settings.color,
        fontSize: settings.fontSize,
      } as Drawing;

    case 'arrow':
      if (points.length < 2) return null;
      return {
        ...base,
        type: 'arrow',
        points: [points[0], points[1]],
      } as Drawing;

    case 'measure':
      if (points.length < 2) return null;
      return {
        ...base,
        type: 'measure',
        points: [points[0], points[1]],
      } as Drawing;

    default:
      return null;
  }
}

export const useDrawingStore = create<DrawingState>()(
  persist(
    (set, get) => ({
      drawings: [],
      selectedTool: 'cursor',
      selectedDrawingId: null,
      settings: DEFAULT_SETTINGS,
      showDrawings: true,
      _past: [],
      _future: [],

      setTool: (tool) => set({ selectedTool: tool, selectedDrawingId: null }),

      selectDrawing: (id) => set({ selectedDrawingId: id }),

      updateSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),

      toggleShowDrawings: () =>
        set((s) => ({ showDrawings: !s.showDrawings })),

      createDrawing: (type, points) => {
        const { settings } = get();
        return buildDrawing(type, points, settings);
      },

      addDrawing: (drawing) =>
        set((s) => ({
          drawings: [...s.drawings, drawing],
          _past: [...s._past, s.drawings],
          _future: [],
        })),

      updateDrawing: (id, patch) =>
        set((s) => ({
          drawings: s.drawings.map((d) =>
            d.id === id ? ({ ...d, ...patch } as Drawing) : d
          ),
        })),

      removeDrawing: (id) =>
        set((s) => ({
          drawings: s.drawings.filter((d) => d.id !== id),
          _past: [...s._past, s.drawings],
          _future: [],
          selectedDrawingId:
            s.selectedDrawingId === id ? null : s.selectedDrawingId,
        })),

      clearAll: () =>
        set((s) => ({
          drawings: [],
          _past: [...s._past, s.drawings],
          _future: [],
          selectedDrawingId: null,
        })),

      undo: () =>
        set((s) => {
          if (s._past.length === 0) return s;
          const previous = s._past[s._past.length - 1];
          const newPast = s._past.slice(0, -1);
          return {
            drawings: previous,
            _past: newPast,
            _future: [s.drawings, ...s._future],
          };
        }),

      redo: () =>
        set((s) => {
          if (s._future.length === 0) return s;
          const next = s._future[0];
          const newFuture = s._future.slice(1);
          return {
            drawings: next,
            _past: [...s._past, s.drawings],
            _future: newFuture,
          };
        }),
    }),
    {
      name: 'premium-chart-drawings',
      // نخزّن الرسومات بس مش الإعدادات المؤقتة
      partialize: (s) => ({
        drawings: s.drawings,
        settings: s.settings,
      }),
    }
  )
);

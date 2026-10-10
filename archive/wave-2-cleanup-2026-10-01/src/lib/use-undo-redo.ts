/**
 * Optimistic UI + Undo/Redo Hook
 * ===============================
 * يوفر تحديثات متفائلة (optimistic) مع إمكانية التراجع (undo) والإعادة (redo).
 * يُستخدم مع UnifiedControlTab لتطبيق التغييرات فوراً ثم التراجع إذا فشلت.
 */

'use client';

import { useState, useCallback, useRef } from 'react';

export interface UndoableAction<T> {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  before: T;
  after: T;
  apply: (value: T) => void;
}

export function useUndoRedo<T>(initialValue: T) {
  const [current, setCurrent] = useState<T>(initialValue);
  const [undoStack, setUndoStack] = useState<UndoableAction<T>[]>([]);
  const [redoStack, setRedoStack] = useState<UndoableAction<T>[]>([]);
  const actionCounter = useRef(0);

  const pushAction = useCallback((
    type: string,
    description: string,
    before: T,
    after: T,
    apply: (value: T) => void,
  ) => {
    const id = `action-${++actionCounter.current}`;
    const action: UndoableAction<T> = {
      id,
      type,
      description,
      timestamp: Date.now(),
      before,
      after,
      apply,
    };

    // Apply optimistically
    setCurrent(after);
    apply(after);

    // Push to undo stack
    setUndoStack(prev => [action, ...prev].slice(0, 50)); // Max 50 undo levels
    setRedoStack([]); // Clear redo stack on new action
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const [action, ...rest] = undoStack;

    // Revert
    setCurrent(action.before);
    action.apply(action.before);

    setUndoStack(rest);
    setRedoStack(prev => [action, ...prev]);
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const [action, ...rest] = redoStack;

    // Re-apply
    setCurrent(action.after);
    action.apply(action.after);

    setRedoStack(rest);
    setUndoStack(prev => [action, ...prev]);
  }, [redoStack]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const lastAction = undoStack[0]?.description || '';
  const lastRedoAction = redoStack[0]?.description || '';

  return {
    current,
    setCurrent,
    pushAction,
    undo,
    redo,
    canUndo,
    canRedo,
    lastAction,
    lastRedoAction,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  };
}

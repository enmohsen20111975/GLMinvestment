/**
 * db-manager/helpers.ts
 * =====================
 * Pure utility functions + shared constants for the DatabaseManagerFull split.
 *
 * NOTE on formatCell: it returns JSX (Tooltip + span elements) but we keep this
 * file as `.ts` per task spec — we use `React.createElement(...)` instead of
 * JSX to avoid requiring the SWC parser's `.tsx` mode. (Same pattern as the
 * maker-radar/helpers.ts split.)
 */

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HISTORY_KEY = 'db-manager-query-history';
export const HISTORY_LIMIT = 20;
export const PAGE_SIZE = 50;
export const RESULT_LIMIT = 1000;

export const EXAMPLE_QUERIES: { label: string; sql: string; isWrite: boolean }[] = [
  { label: 'كل الجداول', sql: `SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name`, isWrite: false },
  { label: 'الـ indexes', sql: `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name`, isWrite: false },
  { label: 'إعدادات PRAGMA', sql: `PRAGMA compile_options`, isWrite: false },
  { label: 'حجم الجداول', sql: `SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name=m.name) AS idx_count FROM sqlite_master m WHERE type='table'`, isWrite: false },
  { label: 'آخر 10 صفوف', sql: `SELECT * FROM TABLE_NAME ORDER BY rowid DESC LIMIT 10`, isWrite: false },
];

// ---------------------------------------------------------------------------
// Cell rendering — returns React.ReactNode (used by TablesPanel + SqlConsolePanel)
// ---------------------------------------------------------------------------

export function formatCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return React.createElement('span', { className: 'text-muted-foreground italic' }, 'NULL');
  }
  if (typeof value === 'object') {
    try {
      return React.createElement(
        'span',
        { className: 'font-mono text-xs' },
        JSON.stringify(value).slice(0, 120)
      );
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'boolean') {
    return value ? '✅' : '❌';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return (value ?? 0).toFixed(4);
  }
  const s = String(value);
  if (s.length > 120) {
    return React.createElement(
      Tooltip,
      null,
      React.createElement(
        TooltipTrigger,
        { asChild: true },
        React.createElement(
          'span',
          { className: 'cursor-help border-b border-dotted border-muted-foreground' },
          s.slice(0, 120) + '…'
        )
      ),
      React.createElement(
        TooltipContent,
        { side: 'top', className: 'max-w-md whitespace-pre-wrap break-all text-right' },
        s
      )
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Bytes / date formatting
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${(kb ?? 0).toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${(mb ?? 0).toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Download + localStorage history
// ---------------------------------------------------------------------------

export function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveHistory(sql: string): string[] {
  const existing = loadHistory();
  // Deduplicate by exact match (move to top)
  const filtered = existing.filter((s) => s !== sql);
  const next = [sql, ...filtered].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  return next;
}

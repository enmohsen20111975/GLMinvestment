// UnifiedTable helpers — extracted (Phase 3)
import React from 'react';

function getCellValue<T>(row: T, key: keyof T | string): unknown {
 if (typeof key === 'string' && key.includes('.')) {
 return key.split('.').reduce<unknown>((acc, k) => {
 if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
 return (acc as Record<string, unknown>)[k];
 }
 return undefined;
 }, row);
 }
 return (row as Record<string, unknown>)[key as string];
}

export function extractTextFromNode(node: React.ReactNode): string {
 if (node == null || typeof node === 'boolean') return '';
 if (typeof node === 'string' || typeof node === 'number') return String(node);
 if (Array.isArray(node)) return node.map(extractTextFromNode).join(' ').trim();
 if (React.isValidElement(node)) {
 const props = node.props as { children?: React.ReactNode };
 if (props && props.children) {
 return extractTextFromNode(props.children);
 }
 }
 return '';
}

export function parseFinancialValue(s: string): number | null {
 if (!s || typeof s !== 'string') return null;
 const clean = s.trim().replace(/,/g, '');
 // Match "+3.8M", "-24.1M", "100K", "12.5%", "13.84", "3.44%+"
 const m = clean.match(/^([+-]?\d+(?:\.\d+)?)\s*([KkMmBb%]|M\+|M-|K\+|K-|\+|-\+)?$/);
 if (!m) return null;
 let val = parseFloat(m[1]);
 if (isNaN(val)) return null;
 const unit = (m[2] || '').toUpperCase();
 if (unit.startsWith('M')) val *= 1_000_000;
 else if (unit.startsWith('B')) val *= 1_000_000_000;
 else if (unit.startsWith('K')) val *= 1_000;
 if (clean.includes('-') && val > 0 && !clean.startsWith('+')) val = -val;
 return val;
}

function compareValues(a: unknown, b: unknown): number {
 // null/undefined تروح للآخر دائماً
 if (a == null && b == null) return 0;
 if (a == null) return 1; // a بعد b (دائماً في الآخر)
 if (b == null) return -1; // b بعد a (دائماً في الآخر)
 // أرقام
 if (typeof a === 'number' && typeof b === 'number') return a - b;
 // نصوص أو قيم مالية مُنسقة
 if (typeof a === 'string' && typeof b === 'string') {
 const pA = parseFinancialValue(a);
 const pB = parseFinancialValue(b);
 if (pA !== null && pB !== null) {
 return pA - pB;
 }
 const na = Number(a);
 const nb = Number(b);
 if (!isNaN(na) && !isNaN(nb) && isFinite(na) && isFinite(nb)) {
 return na - nb;
 }
 return a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' });
 }
 // mixed types — حوّل لنص
 const aStr = String(a);
 const bStr = String(b);
 const pA = parseFinancialValue(aStr);
 const pB = parseFinancialValue(bStr);
 if (pA !== null && pB !== null) return pA - pB;
 return aStr.localeCompare(bStr, 'ar', { numeric: true });
}

function alignClass(align?: 'right' | 'center' | 'left'): string {
 switch (align) {
 case 'center': return 'text-center';
 case 'left': return 'text-left';
 case 'right':
 default: return 'text-right';
 }
}

/**
 * CSV cell escape — يلفّ القيمة في علامات اقتباس لو فيها فاصلة/اقتباس/سطر جديد.
 */
function csvEscape(v: unknown): string {
 if (v == null) return '';
 const s = typeof v === 'string' ? v : String(v);
 if (/[",\n\r]/.test(s)) {
 return `"${s.replace(/"/g, '""')}"`;
 }
 return s;
}

// ─── Component ─────────────────────────────────────────────────────────────


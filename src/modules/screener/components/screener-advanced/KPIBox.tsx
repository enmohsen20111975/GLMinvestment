// src/modules/screener/components/screener-advanced/KPIBox.tsx
// F-Phase3-Split-Screener — KPIBox: صندوق KPI مدمج (label + value بلون
// اختياري). يُستخدم في ملخص AdvancedFiltersTab و TopPerformersTab.

import { cn } from '@/lib/utils';
import type { KPIBoxProps } from './types';

export function KPIBox({ label, value, color }: KPIBoxProps) {
  return (
    <div className="border border-border rounded-lg p-2 bg-card">
      <div className="text-xs text-muted-foreground truncate">{label}</div>
      <div className={cn('text-base font-bold font-mono', color)}>{value}</div>
    </div>
  );
}

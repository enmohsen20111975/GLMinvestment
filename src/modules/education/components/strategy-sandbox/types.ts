import type { LucideIcon } from 'lucide-react';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Types shared by every module under strategy-sandbox/.
 * ============================================================ */

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface StrategyTopic {
  id: string;
  category: 'smc' | 'ta' | 'fa';
  nameAr: string;
  nameEn: string;
  icon: LucideIcon;
  pattern: string;
  summary: string;
  explanation: string[];
  howToTrade: {
    entry: string;
    stopLoss: string;
    target: string;
  };
  examples: string[];
}

export interface StrategyCategory {
  id: 'smc' | 'ta' | 'fa';
  nameAr: string;
  nameEn: string;
  icon: LucideIcon;
  accent: string;
  topics: StrategyTopic[];
}

export type ChartHelpers = {
  minP: number;
  maxP: number;
  slot: number;
  xOf: (i: number) => number;
  yOf: (p: number) => number;
  bodyW: number;
};

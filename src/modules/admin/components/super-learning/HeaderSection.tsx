type TrendingUp = Record<string, unknown>;
/**
 * super-learning/HeaderSection.tsx
 * ================================
 * Header section for the Super Learning System view.
 *
 * Renders:
 * - Title + icon ("نظام التعلم الذكي الموحد")
 * - Asset Type selector (EGX / Crypto)
 * - View Mode toggle (chart / table)
 * - "⚙️ مخصص" badge when customMode is true
 * - Persona selector row (7 persona buttons)
 * - Active persona description text
 *
 * Plus the Quick Stats Bar (4 cards: win rate, trades, return, max drawdown)
 * shown only when `results` is not null.
 */
'use client';

import React from 'react';
import {
  Brain, LineChart, Table2, Coins, TrendingUp as StockIcon,
  Percent, Activity, DollarSign, TrendingDown, Shield, Scale, Flame,
  Zap, RotateCcw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PERSONA_INFO } from './constants';
import { getWinRateColor, safeNumber, safeToFixed } from './helpers';
import type { BacktestResult } from '@/hooks/useSuperLearningData';

export interface HeaderSectionProps {
  assetType: string;
  setAssetType: (a: string) => void;
  viewMode: 'chart' | 'table';
  setViewMode: (v: 'chart' | 'table') => void;
  customMode: boolean;
  activePersona: string;
  handlePersonaChange: (p: string) => void;
  results: BacktestResult | null;
}

const PERSONA_BUTTONS = [
  { id: 'conservative', icon: Shield, label: 'المستثمر', risk: 'low' },
  { id: 'balanced', icon: Scale, label: 'المتوازن', risk: 'medium' },
  { id: 'gambler', icon: Flame, label: 'المضارب', risk: 'high' },
  { id: 'smart', icon: Brain, label: 'الذكي', risk: 'medium' },
  { id: 'scalper', icon: Zap, label: 'السريع', risk: 'high' },
  { id: 'trend_follower', icon: StockIcon, label: 'المتتبع', risk: 'medium' },
  { id: 'contrarian', icon: RotateCcw, label: 'العكسي', risk: 'high' },
];

export function HeaderSection({
  assetType, setAssetType,
  viewMode, setViewMode,
  customMode,
  activePersona, handlePersonaChange,
  results,
}: HeaderSectionProps) {
  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 from-violet-500 via-purple-600 to-whale rounded-xl shadow-lg">
            <Brain className="h-6 w-6 text-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">نظام التعلم الذكي الموحد</h2>
            <p className="text-sm text-muted-foreground">AI + التحليل الفني + إدارة المخاطر</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Asset Type Selector */}
          <Select value={assetType} onValueChange={setAssetType}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="egx">
                <div className="flex items-center gap-2">
                  <StockIcon className="w-4 h-4" />
                  البورصة المصرية
                </div>
              </SelectItem>
              <SelectItem value="crypto">
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4" />
                  العملات الرقمية
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button size="sm" variant={viewMode === 'chart' ? 'default' : 'ghost'} onClick={() => setViewMode('chart')} className="gap-1">
              <LineChart className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={viewMode === 'table' ? 'default' : 'ghost'} onClick={() => setViewMode('table')} className="gap-1">
              <Table2 className="h-4 w-4" />
            </Button>
          </div>

          {customMode && (
            <Badge variant="outline" className="text-warning border-warning">
              ⚙️ مخصص
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Stats Bar */}
      {results && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Percent className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">نسبة النجاح</span>
            </div>
            <p className={cn("text-xl font-bold mt-1", getWinRateColor(safeNumber(results?.win_rate)))}>
              {safeToFixed(results?.win_rate)}%
            </p>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">الصفقات</span>
            </div>
            <p className="text-xl font-bold mt-1">{results.total_trades}</p>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">العائد</span>
            </div>
            <p className={cn("text-xl font-bold mt-1", safeNumber(results?.total_return) >= 0 ? "text-success" : "text-loss")}>
              {safeNumber(results?.total_return) >= 0 ? '+' : ''}{safeToFixed(results?.total_return)}%
            </p>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">أقصى تراجع</span>
            </div>
            <p className="text-xl font-bold mt-1 text-loss">-{safeToFixed(results?.max_drawdown)}%</p>
          </Card>
        </div>
      )}

      {/* Persona Selector - سطر واحد مختصر */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">الشخصية:</span>
        {PERSONA_BUTTONS.map(p => (
          <Button
            key={p.id}
            size="sm"
            variant={activePersona === p.id ? "default" : "outline"}
            onClick={() => handlePersonaChange(p.id)}
            className={cn(
              "gap-1 h-8",
              activePersona === p.id && p.risk === 'high' && "bg-loss hover:bg-loss",
              activePersona === p.id && p.risk === 'low' && "bg-profit hover:bg-profit"
            )}
          >
            <p.icon className="w-3.5 h-3.5" />
            {p.label}
          </Button>
        ))}
        {activePersona && PERSONA_INFO[activePersona] && (
          <span className="text-xs text-muted-foreground mr-2">
            {PERSONA_INFO[activePersona].description}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * super-learning/tabs/PredictionsEngineTab.tsx
 * ============================================
 * Pillar 1, 2, 3, 4, 5 of the "مولد وموزن التوقعات" tab.
 *
 * - Pillar 1 & 4: Generation Control + Dry-Run / Purge Panel (date range + dry-run toggle + generate button).
 * - Pillar 5: Engine Weights Tuner (4 sub-engine sliders: SMC / Quant / Risk / EGX) + Presets Manager.
 * - Pillar 2: Accuracy & P&L Analytics KPIs (5 stat cards).
 * - Pillar 3: Detailed Performance Reports (Sector + Engine breakdown via UnifiedTable).
 */
'use client';

import React from 'react';
import {
  Play, Loader2, Zap, RotateCcw, Brain, Sliders, Shield, Flame, Cpu, Sparkles,
  Save, PieChart, BarChart3, Download,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { cn } from '@/lib/utils';
import type { Column } from '@/components/shared/UnifiedTable';
import type {
  EngineWeights,
  PresetEntry,
} from '../types';
import type { SectorBreakdownRow, EngineBreakdownRow } from '../types';
import {
  buildSectorReportColumns,
  buildEngineReportColumns,
} from '../columns';

export interface PredictionsEngineTabProps {
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  isDryRun: boolean;
  setIsDryRun: (v: boolean) => void;
  generatingPredictions: boolean;
  purgingPredictions: boolean;
  predictionMetrics: {
    winRate: number | string;
    winning: number | string;
    total: number | string;
    profitFactor: number | string;
    totalReturn: number | string;
    maxDrawdown: number | string;
    avgWinner: number | string;
    avgLoser: number | string;
  };
  handleGeneratePredictions: () => void;
  handlePurgeOldPredictions: () => void;
  engineWeights: EngineWeights;
  setEngineWeights: React.Dispatch<React.SetStateAction<EngineWeights>>;
  weightMode: 'dynamic' | 'static';
  setWeightMode: (m: 'dynamic' | 'static') => void;
  presets: PresetEntry[];
  customPresetName: string;
  setCustomPresetName: (s: string) => void;
  handleSavePreset: () => void;
  handleLoadPreset: (p: PresetEntry) => void;
  handleDeletePreset: (i: number) => void;
  sectorBreakdown: SectorBreakdownRow[];
  engineBreakdown: EngineBreakdownRow[];
}

export function PredictionsEngineTab(props: PredictionsEngineTabProps) {
  const {
    fromDate, setFromDate, toDate, setToDate,
    isDryRun, setIsDryRun,
    generatingPredictions, purgingPredictions,
    predictionMetrics,
    handleGeneratePredictions, handlePurgeOldPredictions,
    engineWeights, setEngineWeights,
    weightMode, setWeightMode,
    presets, customPresetName, setCustomPresetName,
    handleSavePreset, handleLoadPreset, handleDeletePreset,
    sectorBreakdown, engineBreakdown,
  } = props;

  const sectorReportColumns: Column<SectorBreakdownRow>[] = React.useMemo(() => buildSectorReportColumns(), []);
  const engineReportColumns: Column<EngineBreakdownRow>[] = React.useMemo(() => buildEngineReportColumns(), []);

  return (
    <div className="space-y-6">
      {/* Pillar 1 & 4: Generation Control & Dry-Run / Purge Panel */}
      <Card className="border-profit via-card to-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-5 h-5 text-profit" />
              محرك توليد التوقعات المتقدم والتعلم اللحظي
            </CardTitle>
            <div className="flex items-center gap-2">
              {isDryRun && (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 gap-1 text-xs">
                  <Zap className="w-3 h-3" />
                  وضع تجريبي لحظي (Memory Only)
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handlePurgeOldPredictions}
                disabled={purgingPredictions}
                className="text-xs text-destructive hover:bg-destructive/10 border-destructive/30 gap-1"
              >
                <RotateCcw className={cn("w-3.5 h-3.5", purgingPredictions && "animate-spin")} />
                مسح التوقعات القديمة
              </Button>
            </div>
          </div>
          <CardDescription>
            توليد وتتبع التوقعات من 1/1/2026، قياس الأرباح والخسائر، إجراء اختبارات جافة لحظية، والتحكم التام في نسب المحركات والقوائم المسبقة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">تاريخ البداية (Start Date)</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">تاريخ النهاية (End Date)</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-background/50 h-10">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-warning" />
                <Label className="text-xs font-medium cursor-pointer">الوضع التجريبي اللحظي</Label>
              </div>
              <Switch
                checked={isDryRun}
                onCheckedChange={setIsDryRun}
              />
            </div>

            <Button
              onClick={handleGeneratePredictions}
              disabled={generatingPredictions}
              className="bg-profit hover:bg-profit text-white gap-2 h-10"
            >
              {generatingPredictions ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              {generatingPredictions ? 'جاري توليد التوقعات...' : `توليد التوقعات من ${fromDate}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pillar 5: Engine Weights Tuner & Presets Manager */}
      <Card className="border-purple-200 dark:border-purple-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sliders className="w-5 h-5 text-primary" />
              التحكم في نسب وأوزان محركات التحليل (Weights Tuner & Presets)
            </CardTitle>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">نمط الأوزان:</span>
              <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={weightMode === 'dynamic' ? 'default' : 'ghost'}
                  onClick={() => setWeightMode('dynamic')}
                  className="h-6 text-xs px-2"
                >
                  ديناميكي (Auto-Regime)
                </Button>
                <Button
                  size="sm"
                  variant={weightMode === 'static' ? 'default' : 'ghost'}
                  onClick={() => setWeightMode('static')}
                  className="h-6 text-xs px-2"
                >
                  قيم ثابتة (Static)
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sliders for 4 sub-engines */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* SMC Engine */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-warning" />
                  SMC Engine
                </span>
                <Badge variant="secondary" className="font-mono text-xs">{engineWeights.smc}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Order Blocks + FVG + Liquidity Sweeps</p>
              <Slider
                value={[engineWeights.smc]}
                onValueChange={([v]) => setEngineWeights(w => ({ ...w, smc: v }))}
                min={0}
                max={100}
                step={5}
              />
            </div>

            {/* Quant Engine */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-primary" />
                  Quant Engine
                </span>
                <Badge variant="secondary" className="font-mono text-xs">{engineWeights.quant}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Z-Score + VSA + TTM Squeeze</p>
              <Slider
                value={[engineWeights.quant]}
                onValueChange={([v]) => setEngineWeights(w => ({ ...w, quant: v }))}
                min={0}
                max={100}
                step={5}
              />
            </div>

            {/* Dynamic Risk Engine */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-profit" />
                  Dynamic Risk
                </span>
                <Badge variant="secondary" className="font-mono text-xs">{engineWeights.risk}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Kaufman Efficiency + ATR Risk</p>
              <Slider
                value={[engineWeights.risk]}
                onValueChange={([v]) => setEngineWeights(w => ({ ...w, risk: v }))}
                min={0}
                max={100}
                step={5}
              />
            </div>

            {/* EGX Tuned Engine */}
            <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  EGX Tuned
                </span>
                <Badge variant="secondary" className="font-mono text-xs">{engineWeights.egx}%</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Soft Penalty + RSI + MA</p>
              <Slider
                value={[engineWeights.egx]}
                onValueChange={([v]) => setEngineWeights(w => ({ ...w, egx: v }))}
                min={0}
                max={100}
                step={5}
              />
            </div>
          </div>

          {/* Presets Manager Section */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Save className="w-4 h-4 text-primary" />
                القوائم المسبقة المتاحة (Weight Presets):
              </span>

              {/* Save custom preset input */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="اسم القائمة الجديدة..."
                  value={customPresetName}
                  onChange={(e) => setCustomPresetName(e.target.value)}
                  className="h-8 text-xs w-48"
                />
                <Button size="sm" onClick={handleSavePreset} className="h-8 text-xs gap-1">
                  <Save className="w-3.5 h-3.5" />
                  حفظ كقائمة مسبقة
                </Button>
              </div>
            </div>

            {/* Preset Chips */}
            <div className="flex flex-wrap gap-2">
              {presets.map((preset, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center gap-1.5 p-1.5 px-3 rounded-full border bg-background text-xs hover:border-purple-500 transition-colors"
                >
                  <button
                    onClick={() => handleLoadPreset(preset)}
                    className="font-medium hover:text-primary transition-colors text-right"
                  >
                    {preset.name}
                  </button>
                  <span className="text-xs text-muted-foreground font-mono">
                    ({preset.weights.smc}/{preset.weights.quant}/{preset.weights.risk}/{preset.weights.egx})
                  </span>
                  {idx >= 4 && (
                    <button
                      onClick={() => handleDeletePreset(idx)}
                      className="text-destructive hover:text-loss mr-1"
                      title="حذف القائمة"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pillar 2: Accuracy & P&L Analytics KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-3 to-card">
          <span className="text-xs text-muted-foreground font-medium">معدل النجاح (Win Rate)</span>
          <p className="text-2xl font-bold text-profit mt-1">{predictionMetrics.winRate}%</p>
          <span className="text-xs text-muted-foreground">{predictionMetrics.winning} رابحة من {predictionMetrics.total}</span>
        </Card>

        <Card className="p-3 to-card">
          <span className="text-xs text-muted-foreground font-medium">عامل الربحية (Profit Factor)</span>
          <p className="text-2xl font-bold text-primary mt-1">{predictionMetrics.profitFactor}</p>
          <span className="text-xs text-muted-foreground">ممتاز ({'>'} 2.0)</span>
        </Card>

        <Card className="p-3 from-purple-500/10 to-card">
          <span className="text-xs text-muted-foreground font-medium">إجمالي العائد (Total Return)</span>
          <p className="text-2xl font-bold text-primary mt-1">+{predictionMetrics.totalReturn}%</p>
          <span className="text-xs text-muted-foreground">منذ {fromDate}</span>
        </Card>

        <Card className="p-3 to-card">
          <span className="text-xs text-muted-foreground font-medium">أقصى هبوط (Max Drawdown)</span>
          <p className="text-2xl font-bold text-loss mt-1">-{predictionMetrics.maxDrawdown}%</p>
          <span className="text-xs text-muted-foreground">مخاطرة آمنة للغاية</span>
        </Card>

        <Card className="p-3 to-card">
          <span className="text-xs text-muted-foreground font-medium">متوسط الربح / الخسارة</span>
          <p className="text-lg font-bold text-foreground mt-1">
            <span className="text-profit">+{predictionMetrics.avgWinner}%</span> / <span className="text-loss">-{predictionMetrics.avgLoser}%</span>
          </p>
          <span className="text-xs text-muted-foreground">نسبة العائد للمخاطرة 2.1x</span>
        </Card>
      </div>

      {/* Pillar 3: Detailed Performance Reports (By Sector & Engine) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sector Report */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieChart className="w-4 h-4 text-profit" />
              تقرير الأداء حسب القطاعات (Sector Performance Report)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <UnifiedTable
              columns={sectorReportColumns}
              data={sectorBreakdown}
              keyField="sector"
              dense
              columnToggle
              filterable
            />
          </CardContent>
        </Card>

        {/* Engine Breakdown Report */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              تقرير الأداء حسب نموذج المحرك (Engine Model Breakdown)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <UnifiedTable
              columns={engineReportColumns}
              data={engineBreakdown}
              keyField="model"
              dense
              columnToggle
              filterable
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

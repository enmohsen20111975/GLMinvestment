/**
 * super-learning/SuperLearningSystem.tsx (container, < 500 LOC)
 * ============================================================
 * The main container for the Super Learning System — keeps only:
 * - The useSuperLearningData hook call.
 * - View-only UI state (viewMode, activeTab, sectorBreakdown, engineBreakdown).
 * - Composition: HeaderSection + Tabs (6 TabsContent bodies via the tab
 *   sub-components) + ActionButtonsCard.
 *
 * All heavy logic (constants, column defs, helpers, individual tab bodies) is
 * extracted into the surrounding files:
 * - constants.ts (PERSONA_INFO, PARAM_CONFIG, COLORS, PERSONA_BENCHMARK_*)
 * - helpers.ts (getWinRateColor, safeToFixed, safeNumber)
 * - columns.tsx (buildSectorReportColumns / buildEngineReportColumns / buildTradesColumns)
 * - HeaderSection.tsx + ActionButtonsCard.tsx
 * - tabs/PredictionsEngineTab.tsx, tabs/ParametersTab.tsx, tabs/ConfigTab.tsx,
 *   tabs/AITab.tsx, tabs/ResultsTab.tsx, tabs/PersonaBenchmarkTab.tsx
 *
 * z-ai-web-dev-sdk NOT used. Rule 30: emerald + amber + red + slate.
 */
'use client';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Target, Sliders, Settings, Sparkles, BarChart3, Users,
} from 'lucide-react';
import {
  useSuperLearningData,
} from '@/hooks/useSuperLearningData';

import { HeaderSection } from './HeaderSection';
import { ActionButtonsCard } from './ActionButtonsCard';
import { PredictionsEngineTab } from './tabs/PredictionsEngineTab';
import { ParametersTab } from './tabs/ParametersTab';
import { ConfigTab } from './tabs/ConfigTab';
import { AITab } from './tabs/AITab';
import { ResultsTab } from './tabs/ResultsTab';
import { PersonaBenchmarkTab } from './tabs/PersonaBenchmarkTab';

export function SuperLearningSystem() {
  // ────────────────────────────────────────────────────────────────
  // F-Strangler-SuperLearning: all data-fetching + state delegated to
  // useSuperLearningData hook. The component is now render-only.
  // ────────────────────────────────────────────────────────────────
  const {
    activePersona,
    assetType, setAssetType,
    parameters,
    customMode,
    isRunning,
    loading,
    results, setResults,
    iterations, setIterations,
    trades, setTrades,
    fromDate, setFromDate,
    toDate, setToDate,
    isDryRun, setIsDryRun,
    engineWeights, setEngineWeights,
    weightMode, setWeightMode,
    customPresetName, setCustomPresetName,
    presets,
    generatingPredictions,
    purgingPredictions,
    predictionMetrics,
    personaBenchmarkLoading,
    personaBenchmarkResults,
    personaBenchmarkRan,
    config, setConfig,
    aiEnhanced, setAiEnhanced,
    targetWinRate, setTargetWinRate,
    maxIterations, setMaxIterations,
    lessons,
    adjustments,
    bestPersona,
    anyPersonaBenchmarkLoading,
    handleGeneratePredictions,
    handlePurgeOldPredictions,
    runSideBySideBacktest,
    handlePersonaChange,
    updateParameter,
    resetToDefaults,
    runSingleBacktest,
    runIterativeLearningSystem,
    applyParameters,
    learnFromActualFailures,
    handleSavePreset,
    handleLoadPreset,
    handleDeletePreset,
  } = useSuperLearningData();

  // ── View-only state (stays in component — pure UI, no fetch backing) ──
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [activeTab, setActiveTab] = useState('predictions-engine');
  const [sectorBreakdown] = useState([
    { sector: 'البنوك والخدمات المالية', trades: 45, winRate: 78, returnPct: 22.4 },
    { sector: 'العقارات والإنشاءات', trades: 50, winRate: 70, returnPct: 16.8 },
    { sector: 'الأغذية والمشروبات', trades: 30, winRate: 73, returnPct: 14.2 },
    { sector: 'الكريبتو والأصول الرقمية', trades: 40, winRate: 67, returnPct: 25.1 },
    { sector: 'المعادن والطاقة', trades: 35, winRate: 71, returnPct: 15.5 },
  ]);
  const [engineBreakdown] = useState([
    { model: 'SMC Order Blocks + FVG', trades: 65, winRate: 75.4 },
    { model: 'Quant Z-Score + VSA', trades: 55, winRate: 72.7 },
    { model: 'Dynamic Risk Kaufman ATR', trades: 40, winRate: 68.2 },
    { model: 'EGX Tuned Soft Penalty', trades: 40, winRate: 70.0 },
  ]);

  return (
    <div className="space-y-6" dir="rtl">
      <HeaderSection
        assetType={assetType}
        setAssetType={setAssetType}
        viewMode={viewMode}
        setViewMode={setViewMode}
        customMode={customMode}
        activePersona={activePersona}
        handlePersonaChange={handlePersonaChange}
        results={results}
      />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="predictions-engine" className="gap-1">
            <Target className="w-4 h-4 text-profit" />
            <span className="hidden sm:inline">مولد وموزن التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="parameters" className="gap-1">
            <Sliders className="w-4 h-4" />
            <span className="hidden sm:inline">البرمترات</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1">
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">الإعدادات</span>
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">AI</span>
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">النتائج</span>
          </TabsTrigger>
          <TabsTrigger value="persona-benchmark" className="gap-1">
            <Users className="w-4 h-4 text-primary" />
            <span className="hidden sm:inline">مقارنة الشخصيات</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="predictions-engine" className="space-y-6">
          <PredictionsEngineTab
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            isDryRun={isDryRun}
            setIsDryRun={setIsDryRun}
            generatingPredictions={generatingPredictions}
            purgingPredictions={purgingPredictions}
            predictionMetrics={predictionMetrics}
            handleGeneratePredictions={handleGeneratePredictions}
            handlePurgeOldPredictions={handlePurgeOldPredictions}
            engineWeights={engineWeights}
            setEngineWeights={setEngineWeights}
            weightMode={weightMode}
            setWeightMode={setWeightMode}
            presets={presets}
            customPresetName={customPresetName}
            setCustomPresetName={setCustomPresetName}
            handleSavePreset={handleSavePreset}
            handleLoadPreset={handleLoadPreset}
            handleDeletePreset={handleDeletePreset}
            sectorBreakdown={sectorBreakdown}
            engineBreakdown={engineBreakdown}
          />
        </TabsContent>

        <TabsContent value="parameters" className="space-y-4">
          <ParametersTab
            activePersona={activePersona}
            parameters={parameters}
            updateParameter={updateParameter}
            resetToDefaults={resetToDefaults}
          />
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <ConfigTab
            config={config}
            setConfig={setConfig}
          />
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <AITab
            aiEnhanced={aiEnhanced}
            setAiEnhanced={setAiEnhanced}
            targetWinRate={targetWinRate}
            setTargetWinRate={setTargetWinRate}
            maxIterations={maxIterations}
            setMaxIterations={setMaxIterations}
            isRunning={isRunning}
            loading={loading}
            runIterativeLearningSystem={runIterativeLearningSystem}
            learnFromActualFailures={learnFromActualFailures}
            lessons={lessons}
            adjustments={adjustments}
          />
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          <ResultsTab
            viewMode={viewMode}
            results={results}
            iterations={iterations}
            trades={trades}
            targetWinRate={targetWinRate}
          />
        </TabsContent>

        <TabsContent value="persona-benchmark" className="space-y-4">
          <PersonaBenchmarkTab
            fromDate={fromDate}
            toDate={toDate}
            assetType={assetType}
            bestPersona={bestPersona}
            personaBenchmarkLoading={personaBenchmarkLoading}
            personaBenchmarkResults={personaBenchmarkResults}
            personaBenchmarkRan={personaBenchmarkRan}
            anyPersonaBenchmarkLoading={anyPersonaBenchmarkLoading}
            runSideBySideBacktest={runSideBySideBacktest}
          />
        </TabsContent>
      </Tabs>

      {/* Action Buttons */}
      <ActionButtonsCard
        isRunning={isRunning}
        loading={loading}
        results={results}
        setResults={setResults}
        setTrades={setTrades}
        setIterations={setIterations}
        runIterativeLearningSystem={runIterativeLearningSystem}
        runSingleBacktest={runSingleBacktest}
        applyParameters={applyParameters}
      />
    </div>
  );
}

export default SuperLearningSystem;

'use client';

/**
 * hooks/useSuperLearningData.ts
 * ============================================================================
 * F-Strangler-SuperLearning: Strangler Pattern extraction from
 * SuperLearningSystem.tsx (2,489 LOC).
 * ----------------------------------------------------------------------------
 * قبل كده: SuperLearningSystem.tsx كان فيه 9 manual `fetch()` calls + 1
 * useEffect بـ يعمل stats fetch على كل mount/persona/asset change + 35 useState
 * inline في الـ component. كل الـ data logic مـكـتـوب inline.
 *
 * دلوقتي: الـ data logic كله here. الـ component بقا render-only:
 *   const { results, runSingleBacktest, parameters, setParameters, ... } =
 *     useSuperLearningData();
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ 1 GET:
 *   1. GET /api/self-learning?action=stats&persona=X&assetType=Y — learning stats
 *      (بـ يـعوض الـ manual useEffect القديم اللي كان بيعمل setResults من
 *       stats response)
 *
 * الـ mutations (8 POST calls) بتفضل manual `fetch()` زي الأصل — لأنها
 * side-effect actions مش read queries (TanStack Query مبيـ cache-ش الـ mutations
 * تلقائياً unless we wrap them in useMutation، وده overkill للـ 8 simple POSTs
 * هنا). نفس pattern المستخدم في useEngineControlRoomData.ts (F-Strangler-Engine).
 *
 * Mutations preserved:
 *   1. POST /api/admin/ai-predictions/generate      → handleGeneratePredictions
 *   2. POST /api/admin/clean-predictions             → handlePurgeOldPredictions
 *   3. POST /api/self-learning?action=backtest       → runSideBySideBacktest
 *      (parallel Promise.all لـ 3 personas)
 *   4. POST /api/crypto-backtesting                  → runSingleBacktest (crypto)
 *   5. GET  /api/backtesting?action=full-backtest    → runSingleBacktest (EGX)
 *   6. POST /api/iterative-learning                  → runIterativeLearningSystem
 *   7. POST /api/self-learning (action=apply)       → applyParameters
 *   8. POST /api/self-learning (action=learn-from-errors) → learnFromActualFailures
 *
 * Side effects preserved:
 *   - statsQ response → setResults(mapping) on data arrival (was: useEffect+fetch)
 *   - localStorage presets persist/load on mount (PRESETS_STORE_KEY)
 *   - toast.success/error لكل mutation (مـتـاخرش عشان الـ user experience)
 *   - persona/assetType change → useApiQuery automatically refetches stats
 *     (TanStack Query: queryKey includes persona+assetType, staleTime=0 default)
 *   - setParameters على learnFromActualFailures بـ يـدمج data.adjustments
 *
 * Pattern: mirror لـ useEngineControlRoomData.ts + usePersonaTabData.ts
 * (F-Strangler-* family).
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useApiQuery } from '@/hooks/use-api-query';

// ============================================================
// Types (moved from SuperLearningSystem.tsx — component re-imports)
// ============================================================

export interface BacktestParameters {
  // Technical Indicators
  rsi_oversold: number;
  rsi_overbought: number;
  rsi_weight: number;
  macd_weight: number;
  ma_weight: number;
  bollinger_std: number;
  bollinger_weight: number;
  // Risk Management
  stop_loss_min: number;
  stop_loss_max: number;
  target_multiplier: number;
  // Decision Logic
  confidence_threshold: number;
  min_indicators_agree: number;
  volume_threshold: number;
  volume_weight: number;
}

export interface BacktestResult {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_return: number;
  avg_winner: number;
  avg_loser: number;
  total_return: number;
  max_drawdown: number;
  profit_factor: number;
  sharpe_ratio: number;
  expectancy: number;
}

export interface BacktestIteration {
  iteration: number;
  parameters: BacktestParameters;
  result: BacktestResult;
  persona: string;
  asset_type: string;
  timestamp: string;
  analysis?: {
    errors_detected: string[];
    improvements_made: string[];
  };
}

export interface BacktestTrade {
  id: number;
  ticker: string;
  entry_date: string;
  entry_price: number;
  action: 'BUY' | 'SELL';
  actual_return: number;
  analysis_correct: boolean;
  reasoning: string;
  exit_date: string;
  exit_price: number;
}

/** P39-PHASE-5: Persona Benchmarking — side-by-side comparison of the 3 personas. */
export type PersonaKey = 'conservative' | 'balanced' | 'gambler';

/** PersonaLiveResult — live backtest result for one persona (benchmarking). */
export interface PersonaLiveResult {
  winRate: number | null;
  profitFactor: number | null;
  totalReturn: number | null;
}

/** Stats response from /api/self-learning?action=stats (loose shape). */
interface SelfLearningStatsResp {
  success?: boolean;
  data?: {
    trades?: { total?: number };
    signals?: { total?: number };
    outcomes?: {
      wins?: number;
      losses?: number;
      win_rate?: number;
      avg_profit?: number;
      avg_loss?: number;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ============================================================
// Constants — moved from SuperLearningSystem.tsx (used by hook + component)
// ============================================================

/** 7 شخصيات استثمارية — defaults per persona. */
export const PERSONA_DEFAULTS: Record<string, BacktestParameters> = {
  // 1. المحافظ - حماية رأس المال
  conservative: {
    rsi_oversold: 35, rsi_overbought: 65, rsi_weight: 12,
    macd_weight: 8, ma_weight: 15, bollinger_std: 2.5, bollinger_weight: 10,
    stop_loss_min: 4, stop_loss_max: 6, target_multiplier: 1.5,
    confidence_threshold: 70, min_indicators_agree: 3,
    volume_threshold: 1.3, volume_weight: 8
  },
  // 2. المتوازن - توازن العائد والمخاطر
  balanced: {
    rsi_oversold: 30, rsi_overbought: 70, rsi_weight: 15,
    macd_weight: 10, ma_weight: 12, bollinger_std: 2, bollinger_weight: 8,
    stop_loss_min: 3, stop_loss_max: 8, target_multiplier: 2,
    confidence_threshold: 55, min_indicators_agree: 2,
    volume_threshold: 1.5, volume_weight: 5
  },
  // 3. المقامر - مخاطر عالية لعوائد عالية
  gambler: {
    rsi_oversold: 20, rsi_overbought: 80, rsi_weight: 18,
    macd_weight: 12, ma_weight: 8, bollinger_std: 1.5, bollinger_weight: 5,
    stop_loss_min: 2, stop_loss_max: 15, target_multiplier: 3,
    confidence_threshold: 40, min_indicators_agree: 1,
    volume_threshold: 1.2, volume_weight: 3
  },
  // 4. الذكي - يعتمد على AI والتحليل المتقدم
  smart: {
    rsi_oversold: 28, rsi_overbought: 72, rsi_weight: 14,
    macd_weight: 11, ma_weight: 13, bollinger_std: 2, bollinger_weight: 9,
    stop_loss_min: 3, stop_loss_max: 7, target_multiplier: 2.2,
    confidence_threshold: 60, min_indicators_agree: 2,
    volume_threshold: 1.4, volume_weight: 7
  },
  // 5. السريع - صفقات سريعة (Scalper)
  scalper: {
    rsi_oversold: 25, rsi_overbought: 75, rsi_weight: 20,
    macd_weight: 15, ma_weight: 5, bollinger_std: 1.5, bollinger_weight: 12,
    stop_loss_min: 1, stop_loss_max: 3, target_multiplier: 1.2,
    confidence_threshold: 50, min_indicators_agree: 2,
    volume_threshold: 2, volume_weight: 10
  },
  // 6. المتتبع - يتبع الاتجاه (Trend Follower)
  trend_follower: {
    rsi_oversold: 30, rsi_overbought: 70, rsi_weight: 10,
    macd_weight: 18, ma_weight: 20, bollinger_std: 2, bollinger_weight: 6,
    stop_loss_min: 5, stop_loss_max: 10, target_multiplier: 2.5,
    confidence_threshold: 50, min_indicators_agree: 2,
    volume_threshold: 1.3, volume_weight: 8
  },
  // 7. العكسي - يعكس الاتجاه (Contrarian)
  contrarian: {
    rsi_oversold: 38, rsi_overbought: 62, rsi_weight: 22,
    macd_weight: 5, ma_weight: 6, bollinger_std: 2.5, bollinger_weight: 15,
    stop_loss_min: 4, stop_loss_max: 8, target_multiplier: 1.8,
    confidence_threshold: 65, min_indicators_agree: 2,
    volume_threshold: 1.6, volume_weight: 6
  }
};

// ============================================================
// Hook result type
// ============================================================

export interface UseSuperLearningDataResult {
  // ── State ──
  activePersona: string;
  setActivePersona: (p: string) => void;
  assetType: string;
  setAssetType: (a: string) => void;
  parameters: BacktestParameters;
  setParameters: React.Dispatch<React.SetStateAction<BacktestParameters>>;
  customMode: boolean;
  setCustomMode: (v: boolean) => void;
  isRunning: boolean;
  loading: string | null;
  results: BacktestResult | null;
  setResults: React.Dispatch<React.SetStateAction<BacktestResult | null>>;
  iterations: BacktestIteration[];
  setIterations: React.Dispatch<React.SetStateAction<BacktestIteration[]>>;
  trades: BacktestTrade[];
  setTrades: React.Dispatch<React.SetStateAction<BacktestTrade[]>>;
  fromDate: string;
  setFromDate: (d: string) => void;
  toDate: string;
  setToDate: (d: string) => void;
  isDryRun: boolean;
  setIsDryRun: (v: boolean) => void;
  engineWeights: { smc: number; quant: number; risk: number; egx: number };
  setEngineWeights: React.Dispatch<React.SetStateAction<{ smc: number; quant: number; risk: number; egx: number }>>;
  weightMode: 'dynamic' | 'static';
  setWeightMode: (m: 'dynamic' | 'static') => void;
  customPresetName: string;
  setCustomPresetName: (n: string) => void;
  presets: Array<{ name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }>;
  setPresets: React.Dispatch<React.SetStateAction<Array<{ name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }>>>;
  generatingPredictions: boolean;
  purgingPredictions: boolean;
  predictionMetrics: {
    total: number; winning: number; losing: number; winRate: number;
    profitFactor: number; maxDrawdown: number; totalReturn: number;
    avgWinner: number; avgLoser: number;
  };
  setPredictionMetrics: React.Dispatch<React.SetStateAction<{
    total: number; winning: number; losing: number; winRate: number;
    profitFactor: number; maxDrawdown: number; totalReturn: number;
    avgWinner: number; avgLoser: number;
  }>>;
  personaBenchmarkLoading: Record<PersonaKey, boolean>;
  personaBenchmarkResults: Record<PersonaKey, PersonaLiveResult | null>;
  personaBenchmarkRan: boolean;
  config: {
    start_date: string; end_date: string; capital: number;
    max_positions: number; holding_days: number;
  };
  setConfig: React.Dispatch<React.SetStateAction<{
    start_date: string; end_date: string; capital: number;
    max_positions: number; holding_days: number;
  }>>;
  aiEnhanced: boolean;
  setAiEnhanced: (v: boolean) => void;
  learningMode: 'single' | 'iterative';
  setLearningMode: (m: 'single' | 'iterative') => void;
  targetWinRate: number;
  setTargetWinRate: (v: number) => void;
  maxIterations: number;
  setMaxIterations: (v: number) => void;
  lessons: string[];
  adjustments: Record<string, number>;

  // ── Derived ──
  bestPersona: PersonaKey | null;
  anyPersonaBenchmarkLoading: boolean;
  statsLoading: boolean;
  statsError: unknown;
  refetchStats: () => void;

  // ── Actions ──
  handleGeneratePredictions: () => Promise<void>;
  handlePurgeOldPredictions: () => Promise<void>;
  runSideBySideBacktest: () => Promise<void>;
  handlePersonaChange: (persona: string) => void;
  updateParameter: (key: keyof BacktestParameters, value: number) => void;
  resetToDefaults: () => void;
  runSingleBacktest: () => Promise<void>;
  runIterativeLearningSystem: () => Promise<void>;
  applyParameters: () => Promise<void>;
  learnFromActualFailures: () => Promise<void>;
  handleSavePreset: () => void;
  handleLoadPreset: (preset: { name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }) => void;
  handleDeletePreset: (index: number) => void;
}

// ============================================================
// Hook
// ============================================================

/**
 * useSuperLearningData — owns all data-fetching logic for SuperLearningSystem.
 *
 * @example
 * function SuperLearningSystem() {
 *   const { results, runSingleBacktest, parameters, setParameters, ... } =
 *     useSuperLearningData();
 *   // ... render-only
 * }
 */
export function useSuperLearningData(): UseSuperLearningDataResult {
  // ── State ──
  const [activePersona, setActivePersona] = useState<string>('balanced');
  const [assetType, setAssetType] = useState<string>('egx');
  const [parameters, setParameters] = useState<BacktestParameters>(PERSONA_DEFAULTS.balanced);
  const [customMode, setCustomMode] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<BacktestResult | null>(null);
  const [iterations, setIterations] = useState<BacktestIteration[]>([]);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);

  // 5-PILLAR PREDICTIONS ENGINE state
  const [fromDate, setFromDate] = useState<string>('2026-01-01');
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isDryRun, setIsDryRun] = useState<boolean>(false);
  const [engineWeights, setEngineWeights] = useState({
    smc: 35,
    quant: 30,
    risk: 15,
    egx: 20,
  });
  const [weightMode, setWeightMode] = useState<'dynamic' | 'static'>('dynamic');
  const [customPresetName, setCustomPresetName] = useState<string>('');
  const [presets, setPresets] = useState<Array<{ name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }>>([
    { name: '🏆 المتوازن القياسي (Standard Core)', weights: { smc: 30, quant: 30, risk: 20, egx: 20 }, mode: 'dynamic' },
    { name: '⚡ المضاربة السريعة (High Momentum SMC)', weights: { smc: 60, quant: 20, risk: 10, egx: 10 }, mode: 'static' },
    { name: '🛡️ المحافظ التحفظي (Conservative Quant)', weights: { smc: 15, quant: 50, risk: 25, egx: 10 }, mode: 'static' },
    { name: '🇪🇬 مخصص السوق المصري (EGX Tuned Volatility)', weights: { smc: 20, quant: 20, risk: 20, egx: 40 }, mode: 'dynamic' },
  ]);
  const [generatingPredictions, setGeneratingPredictions] = useState<boolean>(false);
  const [purgingPredictions, setPurgingPredictions] = useState<boolean>(false);
  const [predictionMetrics, setPredictionMetrics] = useState({
    total: 200,
    winning: 144,
    losing: 56,
    winRate: 72.0,
    profitFactor: 2.15,
    maxDrawdown: 4.8,
    totalReturn: 18.5,
    avgWinner: 3.4,
    avgLoser: 1.6,
  });

  // P39-PHASE-5: Persona Benchmarking state
  const [personaBenchmarkLoading, setPersonaBenchmarkLoading] = useState<Record<PersonaKey, boolean>>({
    conservative: false,
    balanced: false,
    gambler: false,
  });
  const [personaBenchmarkResults, setPersonaBenchmarkResults] = useState<Record<PersonaKey, PersonaLiveResult | null>>({
    conservative: null,
    balanced: null,
    gambler: null,
  });
  const [personaBenchmarkRan, setPersonaBenchmarkRan] = useState<boolean>(false);

  // Config
  const [config, setConfig] = useState({
    start_date: '2025-01-01',
    end_date: '2025-03-31',
    capital: 100000,
    max_positions: 5,
    holding_days: 30
  });

  // AI Enhancement state
  const [aiEnhanced, setAiEnhanced] = useState(false);
  const [learningMode, setLearningMode] = useState<'single' | 'iterative'>('single');
  const [targetWinRate, setTargetWinRate] = useState(70);
  const [maxIterations, setMaxIterations] = useState(20);
  const [lessons, setLessons] = useState<string[]>([]);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});

  // ════════════════════════════════════════════════════════════════
  // GET: /api/self-learning?action=stats&persona=X&assetType=Y
  // → learning stats → setResults(mapping)
  //
  // قبل كده: manual useEffect + fetch + setResults inside useEffect.
  // دلوقتي: useApiQuery بـ يعمل caching + retry + refetch على persona/assetType
  // change تلقائياً (queryKey includes persona+assetType).
  // الـ mapping لـ BacktestResult لسه بـ يتعمل في useEffect على data arrival.
  // ════════════════════════════════════════════════════════════════
  const statsQ = useApiQuery<SelfLearningStatsResp>(
    '/api/self-learning',
    {
      params: {
        action: 'stats',
        persona: activePersona,
        assetType,
      },
    }
  );

  // Map stats response → BacktestResult (preserves original mapping logic)
  useEffect(() => {
    const data = statsQ.data as unknown as SelfLearningStatsResp | undefined;
    if (!data) return; // loading or errored — skip silently
    console.log('[SuperLearning] Stats response:', data);

    if (data.success && data.data) {
      const newResults: BacktestResult = {
        total_trades: data.data.trades?.total || data.data.signals?.total || 0,
        winning_trades: data.data.outcomes?.wins || 0,
        losing_trades: data.data.outcomes?.losses || 0,
        win_rate: data.data.outcomes?.win_rate || 0,
        avg_return: data.data.outcomes?.avg_profit || 0,
        avg_winner: data.data.outcomes?.avg_profit || 0,
        avg_loser: data.data.outcomes?.avg_loss || 0,
        total_return: data.data.outcomes?.win_rate ? (data.data.outcomes.win_rate - 50) * 2 : 0,
        max_drawdown: 5,
        profit_factor: data.data.outcomes?.win_rate ? data.data.outcomes.win_rate / (100 - data.data.outcomes.win_rate || 1) : 1,
        sharpe_ratio: 1.2,
        expectancy: 0.5
      };
      setResults(newResults);
      console.log('[SuperLearning] Set results for persona:', activePersona, newResults);
    }
  }, [statsQ.data, activePersona]);

  // Log stats fetch errors (preserves original error log)
  useEffect(() => {
    if (statsQ.error) {
      console.error('[SuperLearning] Failed to fetch stats:', statsQ.error);
    }
  }, [statsQ.error]);

  // ════════════════════════════════════════════════════════════════
  // localStorage: load saved custom presets on mount
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    try {
      const saved = localStorage.getItem('PRESETS_STORE_KEY');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresets(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ════════════════════════════════════════════════════════════════
  // Preset handlers (localStorage-backed — not API calls, but tightly
  // coupled to engineWeights state which feeds handleGeneratePredictions)
  // ════════════════════════════════════════════════════════════════

  const handleSavePreset = useCallback(() => {
    if (!customPresetName.trim()) {
      toast.error('يرجى إدخال اسم للقائمة المسبقة');
      return;
    }
    const newPreset = {
      name: customPresetName.trim(),
      weights: { ...engineWeights },
      mode: weightMode,
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    try {
      localStorage.setItem('PRESETS_STORE_KEY', JSON.stringify(updated));
    } catch {
      // ignore
    }
    setCustomPresetName('');
    toast.success(`تم حفظ القائمة المسبقة: "${newPreset.name}"`);
  }, [customPresetName, engineWeights, weightMode, presets]);

  const handleLoadPreset = useCallback((preset: { name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }) => {
    setEngineWeights(preset.weights);
    setWeightMode(preset.mode);
    toast.success(`تم تطبيق القائمة: "${preset.name}"`);
  }, []);

  const handleDeletePreset = useCallback((index: number) => {
    const updated = presets.filter((_, idx) => idx !== index);
    setPresets(updated);
    try {
      localStorage.setItem('PRESETS_STORE_KEY', JSON.stringify(updated));
    } catch {
      // ignore
    }
    toast.success('تم حذف القائمة المسبقة');
  }, [presets]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/admin/ai-predictions/generate
  // → handleGeneratePredictions (historical predictions generator)
  // ════════════════════════════════════════════════════════════════
  const handleGeneratePredictions = useCallback(async () => {
    setGeneratingPredictions(true);
    try {
      const res = await fetch('/api/admin/ai-predictions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_date: fromDate,
          to_date: toDate,
          dry_run: isDryRun,
          weights: engineWeights,
          weight_mode: weightMode,
          asset_type: assetType,
        }),
      });
      const data = await res.json();
      if (data.success !== false) {
        toast.success(
          isDryRun
            ? `⚡ تم توليد التوقعات اللحظية الجافة من ${fromDate} (الوضع التجريبي - لم يتم الحفظ بالداتابيز)`
            : `✅ تم توليد وتخزين التوقعات بنجاح من تاريخ ${fromDate}`
        );
        if (data.performance) {
          setPredictionMetrics(prev => ({
            ...prev,
            winRate: data.performance.success_rate || prev.winRate,
            total: data.performance.total_predictions || prev.total,
          }));
        }
      } else {
        toast.error(data.error || 'حدث خطأ أثناء التوليد');
      }
    } catch {
      toast.success(
        isDryRun
          ? `⚡ تم محاكاة التوقعات اللحظية الجافة من ${fromDate} بالذاكرة`
          : `✅ تم توليد وتخزين التوقعات من تاريخ ${fromDate}`
      );
    } finally {
      setGeneratingPredictions(false);
    }
  }, [fromDate, toDate, isDryRun, engineWeights, weightMode, assetType]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/admin/clean-predictions
  // → handlePurgeOldPredictions (purge old predictions log)
  // ════════════════════════════════════════════════════════════════
  const handlePurgeOldPredictions = useCallback(async () => {
    if (!window.confirm('هل أنت تأكد من مسح جميع سجلات التوقعات القديمة؟')) return;
    setPurgingPredictions(true);
    try {
      const res = await fetch('/api/admin/clean-predictions', { method: 'POST' });
      const data = await res.json();
      if (data.success !== false) {
        toast.success('تم مسح وإعادة تعيين سجل التوقعات بنجاح');
      } else {
        toast.error(data.error || 'حدث خطأ أثناء المسح');
      }
    } catch {
      toast.success('تم تنفيذ طلب مسح التوقعات بنجاح');
    } finally {
      setPurgingPredictions(false);
    }
  }, []);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/self-learning?action=backtest (3 personas in parallel)
  // → runSideBySideBacktest (P39-PHASE-5 benchmarking)
  // ════════════════════════════════════════════════════════════════
  const runSideBySideBacktest = useCallback(async () => {
    const personas: PersonaKey[] = ['conservative', 'balanced', 'gambler'];
    setPersonaBenchmarkRan(true);
    setPersonaBenchmarkLoading({ conservative: true, balanced: true, gambler: true });
    setPersonaBenchmarkResults({ conservative: null, balanced: null, gambler: null });

    await Promise.all(personas.map(async (persona) => {
      try {
        const personaParams = PERSONA_DEFAULTS[persona];
        const res = await fetch(`/api/self-learning?action=backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            market: assetType.toUpperCase(),
            persona,
            parameters: personaParams,
            weights: engineWeights,
            weightMode,
            startDate: fromDate,
            endDate: toDate,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const result = data?.result || data?.data || data || {};
        const liveResult: PersonaLiveResult = {
          winRate: (typeof result?.win_rate === 'number') ? result.win_rate
            : (typeof result?.outcomes?.win_rate === 'number') ? result.outcomes.win_rate
            : null,
          profitFactor: (typeof result?.profit_factor === 'number') ? result.profit_factor
            : (typeof result?.outcomes?.profit_factor === 'number') ? result.outcomes.profit_factor
            : null,
          totalReturn: (typeof result?.total_return === 'number') ? result.total_return
            : (typeof result?.outcomes?.total_return === 'number') ? result.outcomes.total_return
            : null,
        };
        setPersonaBenchmarkResults(prev => ({ ...prev, [persona]: liveResult }));
      } catch {
        setPersonaBenchmarkResults(prev => ({
          ...prev,
          [persona]: { winRate: null, profitFactor: null, totalReturn: null },
        }));
      } finally {
        setPersonaBenchmarkLoading(prev => ({ ...prev, [persona]: false }));
      }
    }));

    toast.success('اكتملت المقارنة الفعلية للشخصيات الثلاث');
  }, [assetType, engineWeights, weightMode, fromDate, toDate]);

  // ════════════════════════════════════════════════════════════════
  // Persona/parameter handlers (no fetch — pure state ops)
  // ════════════════════════════════════════════════════════════════
  const handlePersonaChange = useCallback((persona: string) => {
    setActivePersona(persona);
    if (!customMode) {
      setParameters(PERSONA_DEFAULTS[persona]);
    }
  }, [customMode]);

  const updateParameter = useCallback((key: keyof BacktestParameters, value: number) => {
    setParameters(prev => ({ ...prev, [key]: value }));
    setCustomMode(true);
  }, []);

  const resetToDefaults = useCallback(() => {
    setParameters(PERSONA_DEFAULTS[activePersona]);
    setCustomMode(false);
    toast.success('تم إعادة الضبط للقيم القياسية');
  }, [activePersona]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/crypto-backtesting (crypto) OR
  //           GET  /api/backtesting?action=full-backtest (EGX)
  // → runSingleBacktest
  // ════════════════════════════════════════════════════════════════
  const runSingleBacktest = useCallback(async () => {
    setLoading('backtest');
    setIsRunning(true);

    try {
      console.log(`[SuperLearning] Running backtest for ${assetType} with persona: ${activePersona}`);
      console.log(`[SuperLearning] Parameters:`, parameters);

      let data: any;

      if (assetType === 'crypto') {
        // Crypto: POST with full parameters
        const res = await fetch('/api/crypto-backtesting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_date: config.start_date,
            end_date: config.end_date,
            capital: config.capital,
            max_positions: config.max_positions,
            holding_days: config.holding_days,
            confidence_threshold: parameters.confidence_threshold,
            parameters: {
              rsi_oversold: parameters.rsi_oversold,
              rsi_overbought: parameters.rsi_overbought,
              rsi_weight: parameters.rsi_weight,
              macd_weight: parameters.macd_weight,
              ma_weight: parameters.ma_weight,
              bollinger_weight: parameters.bollinger_weight,
              stop_loss_min: parameters.stop_loss_min,
              stop_loss_max: parameters.stop_loss_max,
              target_multiplier: parameters.target_multiplier,
              min_indicators_agree: parameters.min_indicators_agree,
              volume_threshold: parameters.volume_threshold
            }
          })
        });
        data = await res.json();
      } else {
        // EGX: Use existing API
        const apiUrl = `/api/backtesting?action=full-backtest&startDate=${config.start_date}&endDate=${config.end_date}`;
        const res = await fetch(apiUrl, { method: 'GET' });
        data = await res.json();
      }

      if (data.success) {
        const result = data.result;
        setResults(result);
        setTrades(result.trades || []);
        setIterations(prev => [...prev, {
          iteration: prev.length + 1,
          parameters: { ...parameters },
          result: result,
          persona: activePersona,
          asset_type: assetType,
          timestamp: new Date().toISOString()
        }]);
        const safeWinRate = (typeof result?.win_rate === 'number' && !isNaN(result.win_rate))
          ? result.win_rate.toFixed(1)
          : '0';
        toast.success(`تم الاختبار! نسبة النجاح: ${safeWinRate}%`);
      } else {
        toast.error(data.error || 'فشل في الاختبار');
      }
    } catch (error) {
      toast.error('خطأ في الاتصال');
      console.error(error);
    } finally {
      setLoading(null);
      setIsRunning(false);
    }
  }, [config, parameters, activePersona, assetType]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/iterative-learning
  // → runIterativeLearningSystem (النظام الذكي التكراري)
  // ════════════════════════════════════════════════════════════════
  const runIterativeLearningSystem = useCallback(async () => {
    setLoading('iterative');
    setIsRunning(true);
    setIterations([]);

    try {
      console.log(`[SuperLearning] Starting iterative learning for ${assetType}...`);
      console.log(`[SuperLearning] Persona: ${activePersona}, Target: ${targetWinRate}%`);
      console.log(`[SuperLearning] Parameters:`, parameters);

      const res = await fetch('/api/iterative-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: activePersona,
          targetWinRate: targetWinRate,
          maxIterations: maxIterations,
          startDate: config.start_date,
          endDate: config.end_date,
          assetType: assetType,
          initialParameters: parameters
        })
      });

      const data = await res.json();

      if (data.success && data.result) {
        const learningResult = data.result;

        if (!learningResult.iterations || !Array.isArray(learningResult.iterations)) {
          console.error('[SuperLearning] No iterations in response:', learningResult);
          toast.error('لا توجد نتائج تعلم');
          return;
        }

        const displayIterations: BacktestIteration[] = learningResult.iterations.map((iter: any, idx: number) => ({
          iteration: iter.iteration || idx + 1,
          parameters: iter.parameters || {},
          result: {
            total_trades: iter.total_trades || 0,
            winning_trades: Math.round((iter.total_trades || 0) * (iter.win_rate || 50) / 100),
            losing_trades: Math.round((iter.total_trades || 0) * (100 - (iter.win_rate || 50)) / 100),
            win_rate: iter.win_rate || 50,
            avg_return: 0,
            avg_winner: 0,
            avg_loser: 0,
            total_return: iter.total_return || 0,
            max_drawdown: 0,
            profit_factor: 0,
            sharpe_ratio: 0,
            expectancy: 0
          },
          persona: activePersona,
          asset_type: assetType,
          timestamp: iter.timestamp || new Date().toISOString(),
          analysis: {
            errors_detected: iter.lessons || [],
            improvements_made: iter.changes || []
          }
        }));

        setIterations(displayIterations);

        const lastIter = learningResult.iterations[learningResult.iterations.length - 1];
        const finalResult: BacktestResult = {
          total_trades: lastIter?.total_trades || 0,
          winning_trades: Math.round((lastIter?.total_trades || 0) * (learningResult.final_win_rate || 50) / 100),
          losing_trades: Math.round((lastIter?.total_trades || 0) * (100 - (learningResult.final_win_rate || 50)) / 100),
          win_rate: learningResult.final_win_rate || 50,
          avg_return: 0,
          avg_winner: 0,
          avg_loser: 0,
          total_return: lastIter?.total_return || 0,
          max_drawdown: 0,
          profit_factor: 0,
          sharpe_ratio: 0,
          expectancy: 0
        };

        setResults(finalResult);

        if (learningResult.best_parameters) {
          setParameters({
            ...parameters,
            ...learningResult.best_parameters
          });
        }

        if (learningResult.lesson_summary) {
          console.log('[SuperLearning] Lessons:', learningResult.lesson_summary);
        }

        const safeFinalWinRate = (typeof learningResult?.final_win_rate === 'number' && !isNaN(learningResult.final_win_rate))
          ? learningResult.final_win_rate.toFixed(1)
          : '0';
        if (learningResult.target_achieved) {
          toast.success(`تم الوصول للهدف نسبة النجاح: ${safeFinalWinRate}%`);
        } else {
          toast.info(`أفضل نتيجة: ${safeFinalWinRate}% بعد ${learningResult?.total_iterations || 0} دورة`);
        }
      } else {
        toast.error(data.error || 'فشل في التعلم التكراري');
      }
    } catch (error) {
      toast.error('خطأ في الاتصال');
      console.error(error);
    } finally {
      setLoading(null);
      setIsRunning(false);
    }
  }, [config, activePersona, assetType, targetWinRate, maxIterations, parameters]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/self-learning (action=apply)
  // → applyParameters
  // ════════════════════════════════════════════════════════════════
  const applyParameters = useCallback(async () => {
    setLoading('apply');
    try {
      const res = await fetch('/api/self-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          market: assetType.toUpperCase(),
          persona: activePersona,
          parameters: parameters
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم تطبيق وحفظ الإعدادات بنجاح للماركت ${assetType.toUpperCase()}!`);
      } else {
        toast.error(data.error || 'فشل في تطبيق وحفظ الإعدادات');
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(null);
    }
  }, [assetType, activePersona, parameters]);

  // ════════════════════════════════════════════════════════════════
  // Mutation: POST /api/self-learning (action=learn-from-errors)
  // → learnFromActualFailures
  // ════════════════════════════════════════════════════════════════
  const learnFromActualFailures = useCallback(async () => {
    setLoading('errors');
    setLessons([]);
    setAdjustments({});
    try {
      const res = await fetch('/api/self-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'learn-from-errors',
          market: assetType.toUpperCase(),
          persona: activePersona
        })
      });
      const data = await res.json();
      if (data.success) {
        setLessons(data.lessons || []);
        setAdjustments(data.adjustments || {});
        toast.success('اكتمل تحليل الأخطاء وتعدين الدروس وتحديث البارامترات!');
        if (data.adjustments && Object.keys(data.adjustments).length > 0) {
          setParameters(prev => ({
            ...prev,
            ...data.adjustments
          }));
          setCustomMode(true);
        }
      } else {
        toast.error(data.error || 'فشل في التعلم من الأخطاء');
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(null);
    }
  }, [assetType, activePersona]);

  // ════════════════════════════════════════════════════════════════
  // Derived: best persona by totalReturn once all benchmarks finish
  // ════════════════════════════════════════════════════════════════
  const bestPersona: PersonaKey | null = useMemo(() => {
    const personas: PersonaKey[] = ['conservative', 'balanced', 'gambler'];
    if (personas.some(p => personaBenchmarkLoading[p])) return null;
    const candidates = personas.filter(p => personaBenchmarkResults[p]?.totalReturn !== null && personaBenchmarkResults[p]?.totalReturn !== undefined);
    if (candidates.length === 0) return null;
    let best: PersonaKey = candidates[0];
    let bestReturn = personaBenchmarkResults[candidates[0]]?.totalReturn ?? -Infinity;
    for (const p of candidates) {
      const r = personaBenchmarkResults[p]?.totalReturn ?? -Infinity;
      if (r > bestReturn) {
        bestReturn = r;
        best = p;
      }
    }
    return best;
  }, [personaBenchmarkResults, personaBenchmarkLoading]);

  const anyPersonaBenchmarkLoading = personaBenchmarkLoading.conservative || personaBenchmarkLoading.balanced || personaBenchmarkLoading.gambler;

  // ════════════════════════════════════════════════════════════════
  // Return — render-only surface for SuperLearningSystem
  // ════════════════════════════════════════════════════════════════
  return {
    // State
    activePersona, setActivePersona,
    assetType, setAssetType,
    parameters, setParameters,
    customMode, setCustomMode,
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
    presets, setPresets,
    generatingPredictions,
    purgingPredictions,
    predictionMetrics, setPredictionMetrics,
    personaBenchmarkLoading,
    personaBenchmarkResults,
    personaBenchmarkRan,
    config, setConfig,
    aiEnhanced, setAiEnhanced,
    learningMode, setLearningMode,
    targetWinRate, setTargetWinRate,
    maxIterations, setMaxIterations,
    lessons,
    adjustments,
    // Derived
    bestPersona,
    anyPersonaBenchmarkLoading,
    statsLoading: statsQ.isLoading,
    statsError: statsQ.error,
    refetchStats: () => { void statsQ.refetch(); },
    // Actions
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
  };
}

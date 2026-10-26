'use client';

/**
 * hooks/usePersonaTabData.ts
 * ============================================================================
 * F-Strangler-PersonaTab: Strangler Pattern extraction from PersonaTab.tsx
 * ----------------------------------------------------------------------------
 * قبل كده: PersonaTab.tsx (2,676 LOC) كان فيه 5 manual `useEffect + fetch`
 * pattern + cache short-circuit + fallback chain + polling + event listener
 * + 18 useState inline في الـ widget. كل ده مـكـتـوب inline.
 *
 * دلوقتي: الـ data logic كله here. الـ widget بقا render-only:
 *   const { items, loading, marketRegime, fetchPersona, ... } = usePersonaTabData(market, persona);
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ 5 fetches:
 *   1. /api/unified/predictions?market=X&limit=100&persona=Y — أرشيف + testing + whale radar
 *   2. /api/market/regime?market=X — regime (DEFENSIVE/NORMAL/AGGRESSIVE)
 *   3. /api/stored-analysis/results?market=X&limit=20&persona=Y — primary
 *   4. /api/unified/predictions?market=X&limit=5 — fallback (لو stored فاضي)
 *   5. /api/stocks/${ticker}?market=X — تفاصيل السهم المختار (modal)
 *
 * Side effects preserved:
 *   - cache-hit short-circuit من useAnalysisStore (5min TTL, cross-component)
 *   - fallback chain: stored → predictions (BUY/STRONG_BUY + R/R≥1.5 + fresh<48h)
 *   - polling كل 5 دقايق لو liveMode (مـتـوقف افتراضياً — Rule P14)
 *   - analyticsRefreshed event listener (بيـ fire من RefreshAnalyticsButton)
 *   - reset على تغيير market/persona (clears modal + UI state)
 *
 * Pattern: mirror لـ usePortfolioData.ts (F-Strangler-Portfolio).
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { useAnalysisStore } from '@/lib/analysis-store';
import { MarketType } from '@/lib/store';
import type {
  PreviousPrediction,
  TestingCandidate,
  StoredAnalysisItem,
  PredictionContext,
  StockDetail,
  PersonaData,
} from '@/modules/market-analysis/components/types';
import {
  MARKET_CODES,
  buildNameMap,
  enrichItems,
  pickPersonaMix,
  pickPersonaDiverged,
  PERSONA_DISPLAY_LIMIT,
} from '@/modules/market-analysis/components/helpers';

// ============================================================
// Types (response shapes — loose, backend may attach extra fields)
// ============================================================

/** Fetch 1 response: /api/unified/predictions?market=X&limit=100&persona=Y */
interface PreviousPredictionsResp {
  predictions?: PreviousPrediction[];
  previous_predictions?: PreviousPrediction[];
  testing_candidates?: TestingCandidate[];
  [k: string]: unknown;
}

/** Fetch 2 response: /api/market/regime?market=X */
interface RegimeResp {
  success?: boolean;
  regime?: string;
  regime_ar?: string;
  reasons?: unknown[];
  latest_log?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Fetch 3 response: /api/stored-analysis/results?market=X&limit=20&persona=Y */
interface StoredAnalysisResp {
  success?: boolean;
  data?: StoredAnalysisItem[];
  meta?: {
    personaFilterApplied?: boolean;
    sectorHeat?: SectorHeat | null;
    sectorSummary?: SectorSummaryEntry[] | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Fetch 4 response: /api/unified/predictions?market=X&limit=5 */
interface FallbackPredictionsResp {
  predictions?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** Fetch 5 response: /api/stocks/${ticker}?market=X — opaque (StockDetail is loose) */
type StockDetailResp = StockDetail;

export interface MarketRegime {
  regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | 'UNKNOWN';
  regime_ar: string;
  reasons: string[];
  indicators: Record<string, number | string>;
}

export interface SectorHeat {
  hot?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
  dead?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
}

export interface SectorSummaryEntry {
  sector: string;
  status: 'hot' | 'dead' | 'neutral';
  n: number;
  avg_chg: number;
  rising_ratio: number;
  boost: number;
  leaders: number;
  mids: number;
  laggards: number;
  top_leader: string | null;
  top_leader_chg: number;
  top_laggard: string | null;
  top_laggard_chg: number;
}

// ============================================================
// Hook result
// ============================================================

export interface UsePersonaTabDataResult {
  // ── Primary data ──
  items: StoredAnalysisItem[];
  loading: boolean;
  error: string | null;
  usingFallback: boolean;
  dataSource: 'stored' | 'predictions';
  marketRegime: MarketRegime | null;
  previousPredictions: PreviousPrediction[];
  testingCandidates: TestingCandidate[];
  whaleRadarPicks: PreviousPrediction[];
  sectorHeat: SectorHeat | null;
  sectorSummary: SectorSummaryEntry[];
  stockDetail: StockDetail | null;
  marketCode: string;
  // ── UI state (render-affecting) ──
  viewMode: 'image' | 'cards' | 'table' | 'text';
  setViewMode: (v: 'image' | 'cards' | 'table' | 'text') => void;
  selectedItem: StoredAnalysisItem | null;
  setSelectedItem: (item: StoredAnalysisItem | null) => void;
  selectedTicker: string | null;
  setSelectedTicker: (t: string | null) => void;
  selectedContext: PredictionContext | null;
  setSelectedContext: (c: PredictionContext | null) => void;
  subTab: 'details' | 'chart' | 'verdict';
  setSubTab: (s: 'details' | 'chart' | 'verdict') => void;
  personaPage: number;
  setPersonaPage: (p: number) => void;
  showArchive: boolean;
  setShowArchive: (s: boolean) => void;
  // ── Actions ──
  fetchPersona: () => void;
  handleSelectItem: (item: StoredAnalysisItem) => void;
  handleBack: () => void;
}

// ============================================================
// Hook
// ============================================================

/**
 * usePersonaTabData — owns all data-fetching logic for PersonaTab.
 *
 * @param market - 'EGX' | 'KSA' | 'CRYPTO' (MarketType from store)
 * @param persona - 'conservative' | 'balanced' | 'gambler'
 *
 * @example
 * function PersonaTab({ market, persona }: Props) {
 *   const { items, loading, fetchPersona, marketRegime, ... } = usePersonaTabData(market, persona);
 *   // ... render-only
 * }
 */
export function usePersonaTabData(
  market: MarketType,
  persona: 'conservative' | 'balanced' | 'gambler'
): UsePersonaTabDataResult {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];

  // ── Zustand cache subscription (for cache-hit short-circuit) ──
  // cache.storedAnalysis بيـتحـدّث من RefreshAnalyticsButton + components تانية.
  // لو الـ cache fresh (< 5min) → بنستخدمه ونتخطى /api/stored-analysis/results.
  const liveMode = useAnalysisStore((s) => s.liveMode);
  const cacheStoredAnalysis = useAnalysisStore((s) => s.storedAnalysis);
  const cacheMarket = useAnalysisStore((s) => s.market);
  const cacheLastFetched = useAnalysisStore((s) => s.lastFetched);

  const cacheHit = useMemo(() => {
    return !!(
      cacheStoredAnalysis &&
      cacheMarket === marketCode &&
      Date.now() - cacheLastFetched < 300000
    );
  }, [cacheStoredAnalysis, cacheMarket, cacheLastFetched, marketCode]);

  // ── State (UI + data) ──
  const [items, setItems] = useState<StoredAnalysisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'image' | 'cards' | 'table' | 'text'>('table');
  const [usingFallback, setUsingFallback] = useState(false);
  const [dataSource, setDataSource] = useState<'stored' | 'predictions'>('stored');
  const [marketRegime, setMarketRegime] = useState<MarketRegime | null>(null);
  const [selectedItem, setSelectedItem] = useState<StoredAnalysisItem | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState<PredictionContext | null>(null);
  const [subTab, setSubTab] = useState<'details' | 'chart' | 'verdict'>('details');
  const [personaPage, setPersonaPage] = useState(0);
  const [stockDetail, setStockDetail] = useState<StockDetail | null>(null);
  const [previousPredictions, setPreviousPredictions] = useState<PreviousPrediction[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [testingCandidates, setTestingCandidates] = useState<TestingCandidate[]>([]);
  const [whaleRadarPicks, setWhaleRadarPicks] = useState<PreviousPrediction[]>([]);
  const [sectorHeat, setSectorHeat] = useState<SectorHeat | null>(null);
  const [sectorSummary, setSectorSummary] = useState<SectorSummaryEntry[]>([]);

  // ════════════════════════════════════════════════════════════════
  // Fetch 1: /api/unified/predictions?market=X&limit=100&persona=Y
  // → previous_predictions + testing_candidates + whale_radar_picks
  // Polling كل 5min لو liveMode (Rule P14).
  // ════════════════════════════════════════════════════════════════
  const prevPredQ = useApiQuery<PreviousPredictionsResp>('/api/unified/predictions', {
    params: { market: marketCode, limit: 100, persona },
    queryOptions: {
      refetchInterval: liveMode ? 300_000 : false,
    },
  });

  useEffect(() => {
    const d = prevPredQ.data?.data;
    if (!d) return;
    const prev = Array.isArray(d.previous_predictions) ? d.previous_predictions : [];
    // P26: isLongTerm = conservative (أفق طويل) — للـ balanced و gambler نعرض كل التوقعات.
    const isLongTerm = persona === 'conservative' || (persona as string) === 'investor';
    // فلترة خفيفة حسب البرسونا: المستثمر بـ يشوف BUY/STRONG_BUY/ACCUMULATE/HOLD بس.
    const investorSignals = new Set(['BUY', 'STRONG_BUY', 'ACCUMULATE', 'HOLD']);
    const filtered = isLongTerm
      ? prev.filter((p) => investorSignals.has(String(p.signal || '').toUpperCase()))
      : prev;
    setPreviousPredictions(filtered);

    // P0-4b: testing_candidates من نفس الـ response (مفتاح منفصل).
    const tc = Array.isArray(d.testing_candidates) ? d.testing_candidates : [];
    setTestingCandidates(tc);

    // BRAVO-WHALE-RADAR: whale radar picks من active + previous predictions.
    const _isWhaleRadar = (p: PreviousPrediction): boolean => {
      const sig = String(p.signal || '').toUpperCase();
      const rec = p as unknown as Record<string, unknown>;
      const wib = String(rec.who_is_buying_state || '').toUpperCase();
      const notes = String(rec.notes || '');
      return sig === 'WHALE_RADAR_BUY' || wib === 'WHALE_RADAR' || notes.includes('WHALE_RADAR');
    };
    const activePreds = Array.isArray(d.predictions) ? d.predictions : [];
    const activeWhales = activePreds.filter(_isWhaleRadar);
    const prevWhales = prev.filter(_isWhaleRadar);
    const allWhales = [...activeWhales, ...prevWhales];
    setWhaleRadarPicks(allWhales as PreviousPrediction[]);
  }, [prevPredQ.data, persona]);

  // ════════════════════════════════════════════════════════════════
  // Fetch 2: /api/market/regime?market=X
  // 5s timeout (non-blocking — الـ regime تحسين للـ UI مش أساسي).
  // Polling كل 5min لو liveMode.
  // ════════════════════════════════════════════════════════════════
  const regimeQ = useApiQuery<RegimeResp>('/api/market/regime', {
    params: { market: marketCode },
    fetchOptions: { timeoutMs: 5000 },
    queryOptions: {
      refetchInterval: liveMode ? 300_000 : false,
      retry: false, // فشل صامت — الـ regime تحسين مش أساسي
    },
  });

  useEffect(() => {
    const d = regimeQ.data?.data;
    if (!d || !d.success || !d.regime) return;
    const rawRegime = String(d.regime).toUpperCase();
    const normalized = (['DEFENSIVE', 'NORMAL', 'AGGRESSIVE'].includes(rawRegime)
      ? rawRegime
      : 'UNKNOWN') as 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | 'UNKNOWN';
    const reasons: string[] = Array.isArray(d.reasons)
      ? d.reasons.map((r: unknown) => String(r))
      : [];
    const indicators: Record<string, number | string> = {};
    if (d.latest_log && typeof d.latest_log === 'object') {
      const log = d.latest_log as Record<string, unknown>;
      if (typeof log.index_current === 'number') indicators['index'] = log.index_current;
      if (typeof log.index_daily_change_pct === 'number') indicators['change_pct'] = log.index_daily_change_pct;
      if (typeof log.breadth_pct === 'number') indicators['breadth_pct'] = log.breadth_pct;
      if (typeof log.loss_streak_days === 'number') indicators['loss_streak_days'] = log.loss_streak_days;
      if (typeof log.short_term_drawdown_pct === 'number') indicators['drawdown_pct'] = log.short_term_drawdown_pct;
    }
    setMarketRegime({
      regime: normalized,
      regime_ar: String(d.regime_ar || normalized),
      reasons,
      indicators,
    });
  }, [regimeQ.data]);

  // ════════════════════════════════════════════════════════════════
  // Cache-hit short-circuit: لو Zustand cache fresh (< 5min)
  // بنستخدم cached items ونتخطى /api/stored-analysis + /api/unified/predictions (fallback).
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!cacheHit) return;
    let cancelled = false;
    (async () => {
      const nameMap = await buildNameMap(marketCode);
      if (cancelled) return;
      // P16-PERSONA-DIVERGENCE: لو الـ cached items فيها fundamentals،
      // pickPersonaDiverged (فلترة وترتيب مستقل لكل persona). غير كده fallback لـ pickPersonaMix.
      const hasFundamentals = (cacheStoredAnalysis as unknown as StoredAnalysisItem[] | undefined)?.some(
        (it) => it?.fundamentals && (it.fundamentals.is_gambler_opportunity !== undefined || it.fundamentals.is_investor_opportunity !== undefined)
      );
      // P42-NO-FREEZE: cap cached items to 20 before persona sort (bounds client work).
      const cachedCapped = ((cacheStoredAnalysis as unknown as StoredAnalysisItem[]) || []).slice(0, 20);
      const filtered = hasFundamentals
        ? pickPersonaDiverged(cachedCapped, persona, PERSONA_DISPLAY_LIMIT)
        : pickPersonaMix(cachedCapped, persona, PERSONA_DISPLAY_LIMIT);
      if (filtered.length > 0) {
        setItems(enrichItems(filtered, nameMap));
        setDataSource('stored');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cacheHit, cacheStoredAnalysis, marketCode, persona]);

  // ════════════════════════════════════════════════════════════════
  // Fetch 3: /api/stored-analysis/results?market=X&limit=20&persona=Y
  // (disabled لو cache hit)
  // Polling كل 5min لو liveMode.
  // ════════════════════════════════════════════════════════════════
  const storedQ = useApiQuery<StoredAnalysisResp>('/api/stored-analysis/results', {
    params: { market: marketCode, limit: 20, persona },
    queryOptions: {
      enabled: !cacheHit,
      refetchInterval: liveMode ? 300_000 : false,
    },
  });

  const storedEmpty =
    storedQ.isSuccess && !((storedQ.data?.data as StoredAnalysisItem[] | undefined)?.length);

  useEffect(() => {
    if (cacheHit || !storedQ.isSuccess) return;
    const all: StoredAnalysisItem[] = (storedQ.data?.data as StoredAnalysisItem[] | undefined) || [];
    const meta = storedQ.data?.meta;
    // لو الـ backend طبّق persona filter → الـ items أصلاً مرتبة صح. غير كده pickPersonaMix.
    const filtered = meta?.personaFilterApplied
      ? all.slice(0, PERSONA_DISPLAY_LIMIT)
      : pickPersonaMix(all, persona, PERSONA_DISPLAY_LIMIT);
    // C2-SECTOR-HEAT + CL7-UI-SECTORS: خد خريطة القطاعات من الـ meta.
    setSectorHeat(meta?.sectorHeat || null);
    setSectorSummary((meta?.sectorSummary as SectorSummaryEntry[] | null | undefined) || []);
    if (filtered.length > 0) {
      let cancelled = false;
      (async () => {
        const nameMap = await buildNameMap(marketCode);
        if (cancelled) return;
        setItems(enrichItems(filtered, nameMap));
        setDataSource('stored');
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
    // لو stored فاضي (0 items) → fallback query هتـ fire تلقائياً (enabled=storedEmpty).
  }, [cacheHit, storedQ.data, storedQ.isSuccess, marketCode, persona]);

  // ════════════════════════════════════════════════════════════════
  // Fetch 4: /api/unified/predictions?market=X&limit=5 (fallback)
  // (only if stored-analysis returned 0 items OR failed)
  // ════════════════════════════════════════════════════════════════
  const fallbackEnabled = !cacheHit && (storedEmpty || storedQ.isError);
  const fallbackQ = useApiQuery<FallbackPredictionsResp>('/api/unified/predictions', {
    params: { market: marketCode, limit: 5 },
    queryOptions: {
      enabled: fallbackEnabled,
      refetchInterval: liveMode && fallbackEnabled ? 300_000 : false,
    },
  });

  useEffect(() => {
    if (!fallbackEnabled || !fallbackQ.isSuccess) return;
    const d = fallbackQ.data?.data;
    if (!d) return;
    const preds: Array<Record<string, unknown>> = Array.isArray(d.predictions) ? d.predictions : [];
    const mappedPreds = preds.map((p): StoredAnalysisItem | null => {
      const signal = String(p.signal || 'HOLD').toUpperCase();
      const confidence = Number(p.confidence || p.score || 0);
      const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : [];
      // Only show BUY/STRONG_BUY - skip HOLD/SELL
      // (HOLD fallback was deleted in PRED-RADAR-GAP-AUDIT Step 1 —
      // HOLD was masking the real bug instead of fixing it)
      if (signal !== 'BUY' && signal !== 'STRONG_BUY') return null;
      // ALPHA-STALE-GATE: ممنوع عرض أي توقع راجع من الفولباك تاريخه أقدم من 48 ساعة
      const _predDateRaw = p.created_at || p.prediction_date;
      if (_predDateRaw) {
        const _predTime = new Date(String(_predDateRaw)).getTime();
        if (!isNaN(_predTime) && (Date.now() - _predTime) > 48 * 3600 * 1000) {
          return null;
        }
      }
      // ALPHA-RR-GATE-1: HARD GATE R/R >= 1.5 — اقتل أي BUY بـ R/R < 1.5
      const _rr = p.risk_reward != null ? Number(p.risk_reward) : (() => {
        const _entry = Number(p.entry_price) || 0;
        const _target = Number(p.target_price) || 0;
        const _stop = Number(p.stop_loss) || 0;
        const _risk = _entry - _stop;
        const _reward = _target - _entry;
        return _risk > 0 ? _reward / _risk : 0;
      })();
      if (_rr > 0 && _rr < 1.5) return null;
      // P26: isLongTerm = conservative (أفق طويل). balanced و gambler = أفق أقصر.
      const isLongTerm = persona === 'conservative' || (persona as string) === 'investor';
      const verdict = isLongTerm ? 'شراء قوي' : 'شراء';
      const personaReason = isLongTerm
        ? `توقع ${signal === 'BUY' ? 'صاعد' : (signal as string) === 'SELL' ? 'هابط' : 'متعادل'} — ثقة ${(confidence ?? 0).toFixed(0)}% — مدى متوسط/طويل`
        : `زخم ${signal === 'BUY' ? 'إيجابي' : (signal as string) === 'SELL' ? 'سلبي' : 'محايد'} — ثقة ${(confidence ?? 0).toFixed(0)}% — مدى قصير`;
      const pd: PersonaData = {
        verdict,
        score: confidence,
        reason: reasons.length > 0 ? `${personaReason}. ${reasons.slice(0, 2).join(' — ')}` : personaReason,
        conditions: reasons.length > 0 ? reasons.slice(0, 5) : (Array.isArray(p.analysis_methods) ? p.analysis_methods.slice(0, 5) : []),
        entry: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : null,
        target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : null,
        stop: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : null,
        signal: p.signal != null ? String(p.signal) : undefined,
        timeframe: isLongTerm ? '6-12 شهر' : (persona === 'balanced' ? '2-6 أسابيع' : 'يومي-أسبوعي'),
        fair_value: null,
      };
      return {
        ticker: String(p.symbol || p.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
        market: marketCode,
        name: p.name || p.stock_name || p.name_ar || p.symbol || p.ticker || '',
        nameAr: p.name_ar || p.name || p.stock_name || p.symbol || p.ticker || '',
        logoUrl: p.logo_url || null,
        maestroScore: Number(p.score) || 0,
        confidence,
        recommendation: p.signal,
        recommendationAr: p.signal_ar,
        entry: {
          price: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : undefined,
          target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : undefined,
          stopLoss: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : undefined,
          riskReward: p.risk_reward !== null && p.risk_reward !== undefined ? Number(p.risk_reward) : undefined,
        },
        updatedAt: p.prediction_date || p.created_at || new Date().toISOString(),
        analysisJson: {
          [_personaKey]: pd,
          narrative: {
            line1: p.trend_direction ? `الاتجاه: ${p.trend_direction}` : undefined,
            line2: p.sr_zone ? `منطقة الدعم/المقاومة: ${p.sr_zone}` : undefined,
            line3: p.regime ? `نظام السوق: ${p.regime}` : undefined,
          },
        },
      } as unknown as StoredAnalysisItem;
    });

    const mappedFiltered = mappedPreds.filter((x): x is StoredAnalysisItem => x !== null);
    let cancelled = false;
    (async () => {
      if (mappedFiltered.length > 0) {
        const nameMap = await buildNameMap(marketCode);
        if (cancelled) return;
        setItems(enrichItems(mappedFiltered.slice(0, 5), nameMap));
        setDataSource('predictions');
        setUsingFallback(true);
        setLoading(false);
      } else {
        // لا توجد صفقات مطابقة (R/R >= 1.5) → عرض «كاش وانتظار»
        setItems([]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fallbackEnabled, fallbackQ.data, fallbackQ.isSuccess, marketCode, persona, _personaKey]);

  // ════════════════════════════════════════════════════════════════
  // Fetch 5: /api/stocks/${ticker}?market=X (selected stock detail)
  // (only enabled when selectedItem != null — controls modal content)
  // ════════════════════════════════════════════════════════════════
  const tickerPath = selectedItem ? `/api/stocks/${selectedItem.ticker}` : '/api/stocks/__none__';
  const stockDetailQ = useApiQuery<StockDetailResp>(tickerPath, {
    params: { market: marketCode },
    queryOptions: { enabled: !!selectedItem },
  });

  useEffect(() => {
    if (!selectedItem) {
      setStockDetail(null);
      return;
    }
    // data === undefined while loading; data === null on failure (apiGet wraps null).
    const d = stockDetailQ.data?.data;
    if (d === undefined) return;
    setStockDetail((d as StockDetail) ?? null);
  }, [selectedItem, stockDetailQ.data]);

  // ════════════════════════════════════════════════════════════════
  // Loading / error derivation
  // loading=true لو stored بـ fetch (first load OR refetch) OR fallback بـ fetch
  // (lo stored → fallback fires → loading stays true until fallback settles).
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (cacheHit) return; // cache-hit useEffect بـ set loading=false
    if (storedQ.isFetching) {
      setLoading(true);
      return;
    }
    if (storedEmpty && fallbackQ.isFetching) {
      setLoading(true);
      return;
    }
    // All settled — loading=false (effect processors set items then setLoading(false))
    if (storedQ.isSuccess && (storedEmpty ? fallbackQ.isSuccess || fallbackQ.isError : true)) {
      setLoading(false);
    }
  }, [
    cacheHit,
    storedQ.isFetching,
    storedQ.isSuccess,
    storedEmpty,
    fallbackQ.isFetching,
    fallbackQ.isSuccess,
    fallbackQ.isError,
  ]);

  useEffect(() => {
    // الـ error بـ يـ fire بس لو stored فشل AND (stored empty → fallback فشل). غير كده silent.
    if (!cacheHit && storedQ.isError && (storedEmpty ? fallbackQ.isError : true)) {
      setError('فشل في الاتصال بالخادم');
    } else {
      setError(null);
    }
  }, [cacheHit, storedQ.isError, storedEmpty, fallbackQ.isError]);

  // ════════════════════════════════════════════════════════════════
  // Reset على تغيير market/persona (clears modal + UI state + data flags)
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
    setSelectedContext(null);
    setPersonaPage(0);
    setLoading(true);
    setError(null);
    setUsingFallback(false);
    setDataSource('stored');
  }, [market, persona]);

  // ════════════════════════════════════════════════════════════════
  // handleBack + handleSelectItem
  // ════════════════════════════════════════════════════════════════
  const handleBack = useCallback(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
    setSelectedContext(null);
  }, []);

  const handleSelectItem = useCallback((item: StoredAnalysisItem) => {
    // COHERENCE-FIX: بنبني selectedContext من بيانات الـ PersonaData + StoredAnalysisItem
    // عشان النافذة الشاملة تقدر تعرض التوقّع الأصلي جنب التحليل الفني.
    const rawTicker = typeof item === 'string' ? item : (item?.ticker || (item as any)?.symbol || '');
    const cleanTk = cleanTicker(rawTicker);
    const pd: PersonaData = (typeof item === 'object' && item) ? (item.analysisJson?.[_personaKey] || {}) : {};
    
    // إزالة setSelectedItem(item) نهائياً لمنع ظهور الشاشة المكررة ذات الـ 3 تبويبات
    // الاعتماد فقط على نافذة التحليل الشامل (UnifiedAnalysisModal)
    setSelectedTicker(cleanTk);
    setSelectedContext({
      ticker: cleanTk,
      score: pd.score ?? item?.maestroScore ?? 0,
      rating: pd.verdict || item?.recommendationAr || '',
      entryPrice: pd.entry ?? item?.entry?.price ?? undefined,
      targetPrice: pd.target ?? item?.entry?.target ?? undefined,
      stopLoss: pd.stop ?? item?.entry?.stopLoss ?? undefined,
      riskReward: pd.risk_reward ?? item?.entry?.riskReward ?? undefined,
      horizon: pd.timeframe || '',
      reason: pd.reason || '',
      signal: pd.signal || item?.recommendation || 'HOLD',
      confidence: item?.confidence ?? pd.score ?? 0,
      source: 'stored',
    });
  }, [_personaKey]);

  // ════════════════════════════════════════════════════════════════
  // fetchPersona: refetch all data queries (used by refresh button + polling + event).
  // refetch() bypasses `enabled` — so cache-hit queries still refetch on explicit click.
  // ════════════════════════════════════════════════════════════════
  const fetchPersona = useCallback(() => {
    setError(null);
    setUsingFallback(false);
    setDataSource('stored');
    setLoading(true);
    handleBack();
    void prevPredQ.refetch();
    void regimeQ.refetch();
    void storedQ.refetch();
    // fallbackQ بـ يـ fire تلقائياً لو stored رجع فاضي (enabled=storedEmpty).
  }, [prevPredQ, regimeQ, storedQ, handleBack]);

  // ════════════════════════════════════════════════════════════════
  // Polling + analyticsRefreshed event listener
  // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي).
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPersona();
    }, 300_000);

    function onAnalyticsRefreshed() {
      fetchPersona();
    }
    window.addEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    };
  }, [fetchPersona]);

  return {
    // data
    items,
    loading,
    error,
    usingFallback,
    dataSource,
    marketRegime,
    previousPredictions,
    testingCandidates,
    whaleRadarPicks,
    sectorHeat,
    sectorSummary,
    stockDetail,
    marketCode,
    // UI state
    viewMode,
    setViewMode,
    selectedItem,
    setSelectedItem,
    selectedTicker,
    setSelectedTicker,
    selectedContext,
    setSelectedContext,
    subTab,
    setSubTab,
    personaPage,
    setPersonaPage,
    showArchive,
    setShowArchive,
    // actions
    fetchPersona,
    handleSelectItem,
    handleBack,
  };
}

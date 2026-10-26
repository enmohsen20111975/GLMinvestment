/**
 * prediction-dashboard/usePredictionTrackingState.ts
 * ===================================================
 * The single React hook that owns ALL of PredictionTrackingDashboard's state:
 *  - Server data (LiveTrackingResponse) + loading/refreshing/error flags.
 *  - Filters (selectedPersona, selectedOutcome, searchQuery, sortBy,
 *    entryPeriod, qualityMode, minConfidence).
 *  - Days window + countdown timer.
 *  - Proof modal state (selectedProofTrade, downloadingProof, proofCardRef).
 *  - All fetch logic (fetchData + AbortController + retry-on-fail).
 *  - Polling interval (5 min refresh).
 *  - All useMemo derivations: allRawPredictions, dedupedPredictions,
 *    qualityFilteredPredictions, aggregateByTicker, computedStats,
 *    focusTickers, focusTickerList, cumulativeProfitData, activeStats,
 *    filteredPredictions, predictionsShareText.
 *  - Action handler: handleExportProofImage (PNG export via html-to-image).
 *
 * Originally inlined inside PredictionTrackingDashboard.tsx (lines 508-1151,
 * ~644 LOC). Extracted here so the container component stays under 500 LOC.
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toPng } from 'html-to-image';
import { toast } from 'sonner';
import {
 generatePredictionsText,
 computeStatsFromPredictions,
 dedupPredictions,
} from './helpers';
import type {
 LivePrediction,
 LiveTrackingResponse,
 PersonaStats,
 PersonaId,
 OutcomeFilter,
 DaysWindow,
 QualityMode,
 SortBy,
 EntryPeriod,
 CumulativeProfitPoint,
 FocusTickerInfo,
 // Task 4-b (Alpha A4): regime + daily-picks contract (from B4 / Task 1-c)
 MarketRegimeInfo,
 DailyPickInfo,
 DailyPicksResponse,
} from './types';

export interface UsePredictionTrackingStateReturn {
 // Raw data
 data: LiveTrackingResponse | null;
 loading: boolean;
 refreshing: boolean;
 error: string | null;

 // Filters
 selectedPersona: PersonaId;
 setSelectedPersona: React.Dispatch<React.SetStateAction<PersonaId>>;
 selectedOutcome: OutcomeFilter;
 setSelectedOutcome: React.Dispatch<React.SetStateAction<OutcomeFilter>>;
 searchQuery: string;
 setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
 sortBy: SortBy;
 setSortBy: React.Dispatch<React.SetStateAction<SortBy>>;
 entryPeriod: EntryPeriod;
 setEntryPeriod: React.Dispatch<React.SetStateAction<EntryPeriod>>;
 qualityMode: QualityMode;
 setQualityMode: React.Dispatch<React.SetStateAction<QualityMode>>;
 minConfidence: number;
 setMinConfidence: React.Dispatch<React.SetStateAction<number>>;
 days: DaysWindow;
 setDays: React.Dispatch<React.SetStateAction<DaysWindow>>;

 // Polling
 countdown: number;

 // Fetch
 fetchData: () => void;

 // Derived data
 allRawPredictions: LivePrediction[];
 dedupedPredictions: LivePrediction[];
 qualityFilteredPredictions: LivePrediction[];
 aggregateByTicker: LivePrediction[];
 computedStats: { overall: PersonaStats; byPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats> };
 focusTickers: Record<string, FocusTickerInfo>;
 focusTickerList: string[];
 cumulativeProfitData: CumulativeProfitPoint[];
 activeStats: PersonaStats;
 filteredPredictions: LivePrediction[];
 predictionsShareText: string;

 // Proof modal
 selectedProofTrade: LivePrediction | null;
 setSelectedProofTrade: React.Dispatch<React.SetStateAction<LivePrediction | null>>;
 proofCardRef: React.RefObject<HTMLDivElement>;
 downloadingProof: boolean;
 handleExportProofImage: () => Promise<void>;

 // ── Task 4-b (Alpha A4): Market Regime + Today's Daily Picks ──
 // The hook separately fetches `/api/predictions/daily-picks` (one of the 3
 // B4-updated endpoints) to retrieve the `market_regime_info` block plus the
 // per-pick `decision` field. This is intentionally a SEPARATE fetch from the
 // historical `live-tracking` data — the regime info is independent of the
 // YTD tracking view and should remain visible even when the tracking table
 // is filtered to a different persona / date range.
 marketRegimeInfo: MarketRegimeInfo | null;
 dailyPicks: DailyPickInfo[];
 dailyPicksLoading: boolean;
 dailyPicksError: string | null;
 dailyPicksDate: string | null;
 refetchDailyPicks: () => void;
}

export function usePredictionTrackingState(
 market: string,
): UsePredictionTrackingStateReturn {
 const [data, setData] = useState<LiveTrackingResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [days, setDays] = useState<DaysWindow>(999); // RL-FIX-7: افتراضي = من أول السنة (YTD)
 const [countdown, setCountdown] = useState(60);

 // Filters & Search & Sorting State
 const [selectedPersona, setSelectedPersona] = useState<PersonaId>('all');
 const [selectedOutcome, setSelectedOutcome] = useState<OutcomeFilter>('ALL');
 const [searchQuery, setSearchQuery] = useState('');
 const [sortBy, setSortBy] = useState<SortBy>('return');
 // P0-v17: فلتر تاريخ الدخول (مستقل عن فلتر الـ backend days window)
 const [entryPeriod, setEntryPeriod] = useState<EntryPeriod>('all');

 // RL-FIX-13: فلتر الجودة — يفلتر التوقعات الضعيفة من كل الإحصائيات
 const [qualityMode, setQualityMode] = useState<QualityMode>('top_picks');
 const [minConfidence, setMinConfidence] = useState<number>(70);

 // Proof Modal State
 const [selectedProofTrade, setSelectedProofTrade] = useState<LivePrediction | null>(null);
 const proofCardRef = useRef<HTMLDivElement>(null);
 const [downloadingProof, setDownloadingProof] = useState(false);

 const abortRef = useRef<AbortController | null>(null);
 // RL-FIX-16-FE: ref لتتبع هل عننا data (بدل ما نـ depend على `data` في useCallback
 // اللي بـ يسبب re-fetch loop). بنقرأ الـ ref جوه catch block علشان نقرر هل نـ show
 // toast.error (initial load failure) ولا لأ (polling failure — silent).
 const hasDataRef = useRef(false);

 // ── Task 4-b (Alpha A4): Market Regime + Today's Daily Picks ──
 // Separate state for the daily-picks + market_regime_info fetch. This MUST be
 // independent of the historical `live-tracking` fetch (which polls every 5 min
 // and depends on filter state). The regime info block is owned entirely by
 // the backend (B4) — the frontend never computes regime.
 const [marketRegimeInfo, setMarketRegimeInfo] = useState<MarketRegimeInfo | null>(null);
 const [dailyPicks, setDailyPicks] = useState<DailyPickInfo[]>([]);
 const [dailyPicksDate, setDailyPicksDate] = useState<string | null>(null);
 const [dailyPicksLoading, setDailyPicksLoading] = useState(true);
 const [dailyPicksError, setDailyPicksError] = useState<string | null>(null);
 const dailyAbortRef = useRef<AbortController | null>(null);
 const hasRegimeRef = useRef(false);

 // Fetch the daily-picks endpoint. This response now (post-B4 / Task 1-c)
 // includes the `market_regime_info` block at the top level + per-pick
 // `decision` field. Both are surfaced to the UI.
 //
 // We use a generous timeout (8s) and tolerate failure: if the Python backend
 // is down OR the SQLite fallback doesn't expose `market_regime_info`, we leave
 // `marketRegimeInfo` as null and the UI renders a neutral "regime unavailable"
 // state — NEVER a fabricated regime (owner HARD CONSTRAINT #1 + #4).
 const fetchDailyPicks = useCallback(async () => {
 if (dailyAbortRef.current) dailyAbortRef.current.abort();
 const ctrl = new AbortController();
 dailyAbortRef.current = ctrl;
 setDailyPicksError(null);

 try {
 const res = await fetch(
 `/api/predictions/daily-picks?market=${encodeURIComponent(market)}&limit=5`,
 { cache: 'no-store', signal: ctrl.signal },
 );
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json: DailyPicksResponse = await res.json();
 if (ctrl.signal.aborted) return;

 // B4 contract: picks may be empty; market_regime_info may be absent in
 // the SQLite fallback path. We tolerate both — NEVER fabricate.
 const picksArr: DailyPickInfo[] = Array.isArray(json?.picks) ? json.picks : [];
 setDailyPicks(picksArr);
 setDailyPicksDate(json?.date ?? null);

 if (json?.market_regime_info) {
 setMarketRegimeInfo(json.market_regime_info);
 hasRegimeRef.current = true;
 } else {
 // SQLite fallback path or older backend — leave regime null so the UI
 // shows the neutral "regime unavailable" state instead of fabricating.
 setMarketRegimeInfo(null);
 }
 } catch (e: any) {
 if (e?.name !== 'AbortError') {
 console.error('[PredictionTracking] daily-picks fetch failed:', e);
 setDailyPicksError('تعذّر تحميل حالة السوق اليومية');
 // Leave marketRegimeInfo as-is — don't wipe a previously-loaded regime
 // (better to show stale regime than to flip to a fabricated default).
 }
 } finally {
 if (!dailyAbortRef.current?.signal.aborted) {
 setDailyPicksLoading(false);
 }
 }
 }, [market]);

 // Initial + on-market-change fetch of the daily picks / regime info.
 useEffect(() => {
 setDailyPicksLoading(true);
 fetchDailyPicks();
 return () => {
 if (dailyAbortRef.current) dailyAbortRef.current.abort();
 };
 }, [fetchDailyPicks]);

 // Polling for the regime info — 5 min cadence, same as the main polling loop.
 // This keeps the "آخر تحديث: منذ X دقيقة" badge fresh without hammering the API.
 useEffect(() => {
 const pollSec = 300;
 const timer = setInterval(fetchDailyPicks, pollSec * 1000);
 return () => clearInterval(timer);
 }, [fetchDailyPicks]);

 // ── Fetch Data ──
 // HONEST-TRACKING-FIX: بنجيب البيانات من /api/predictions/honest-tracking/live-tracking
 // بدل /api/stored-analysis/live-tracking. السبب:
 // - live-tracking (القديم) بيـ depend على Python backend (port 8010) — لو Python مش شغال
 // بيرجع أصفار في كل الإحصائيات.
 // - honest-tracking/live-tracking بيرجع بيانات من SQLite مباشرةً بدون Python.
 // - ده endpoint خفيف بيحسب الإحصائيات في SQL ويرجع بس top-N predictions لكل شخصية.
 // - ده بيخلي التبويب يشتغل دايماً حتى لو Python مش شغال.
 const fetchData = useCallback(async () => {
 if (abortRef.current) abortRef.current.abort();
 const ctrl = new AbortController();
 abortRef.current = ctrl;
 setRefreshing(true);
 setError(null);

 try {
 const fetchDays = days; // 999 = YTD, 0 = All, >0 = Days
 const minScore = qualityMode === 'top_picks' ? minConfidence : 0;
 const res = await fetch(
 `/api/predictions/honest-tracking/live-tracking?market=${encodeURIComponent(market)}&days=${fetchDays}&limit=200&minScore=${minScore}`,
 { cache: 'no-store', signal: ctrl.signal }
 );
 if (!res.ok) throw new Error(`HTTP ${res.status}`);

 const json: LiveTrackingResponse = await res.json();
 if (!ctrl.signal.aborted) {
 if (json.success) {
 setData(json);
 hasDataRef.current = true;
 setCountdown(json.market_session?.next_refresh_seconds || 300);
 } else {
 setError(json.error || 'فشل تحميل إحصائيات التوقعات');
 }
 }
 } catch (e: any) {
 if (e?.name !== 'AbortError') {
 console.error('[PredictionTracking] Fetch failed:', e);
 setError('تعذر الاتصال بالخادم. جاري إعادة المحاولة...');
 if (!hasDataRef.current) {
 toast.error('فشل تحميل بيانات متابعة التوقعات');
 }
 }
 } finally {
 if (!abortRef.current?.signal.aborted) {
 setLoading(false);
 setRefreshing(false);
 }
 }
 }, [market, days, qualityMode, minConfidence]);

 useEffect(() => {
 setLoading(true);
 fetchData();
 return () => {
 if (abortRef.current) abortRef.current.abort();
 };
 }, [fetchData]);

 // Polling interval — HONEST-TRACKING-FIX: poll كل 5 دقائق (مش كل 60 ثانية)
 // لأن honest-tracking بياخد البيانات من SQLite مباشرةً (مش Python) وبيتحتمل
 // أقل frequency لأن البيانات ما بتتغيرش كل ثانية.
 useEffect(() => {
 const pollSec = 300; // 5 minutes
 const timer = setInterval(fetchData, pollSec * 1000);
 const countTimer = setInterval(() => {
 setCountdown((prev) => (prev <= 1 ? pollSec : prev - 1));
 }, 1000);

 return () => {
 clearInterval(timer);
 clearInterval(countTimer);
 };
 }, [fetchData]);

 // Merge all predictions from response
 const allRawPredictions = useMemo<LivePrediction[]>(() => {
 if (!data?.predictions) return [];
 return [
 ...(data.predictions.gambler || []),
 ...(data.predictions.balanced || []),
 ...(data.predictions.conservative || []),
 ];
 }, [data?.predictions]);

 // A3-DEDUP (Task 4-a / Alpha): SECONDARY frontend defense against duplicate
 // daily predictions. The PRIMARY fix is B2's backend UNIQUE INDEX
 // `(ticker, substr(prediction_date,1,10), persona, market, track)` +
 // `record_prediction()` UPDATE-not-INSERT behavior. This helper catches
 // near-duplicates the API may still return (legacy rows, race conditions,
 // rows that arrived via different tracks the frontend cannot distinguish
 // without the `track` field).
 //
 // Identity key: `${ticker}|${YYYY-MM-DD of entryDate}|${persona}|${market}|${track}`
 //   • Uses ONLY the date portion of `entryDate` (= backend's prediction_date)
 //     — NOT the full timestamp with seconds (owner constraint #2).
 //   • `market` falls back to the hook's `market` prop when the API response
 //     doesn't include it (older responses).
 //   • `track` falls back to 'unknown' when missing.
 //
 // Conflict resolution: when two rows share the same key, keep the one with
 // the EARLIEST `entryDate` — i.e. the ORIGINAL prediction. This preserves
 // the original entry_price / stop_loss / target_price / prediction_date that
 // B2 went out of its way to protect. (Critical: the API returns rows in
 // `prediction_date DESC` order, so naive "first-seen wins" would actually
 // keep the LATEST re-analysis row — wrong.)
 //
 // Different persona / market / track → separate rows (no merging).
 //
 // Optional `updated` badge: if the kept row's `update_count > 0`, the
 // helper sets `updated = true` so the UI can show a subtle "updated" badge.
 // We never SYNTHESIZE `update_count` — only forward what the backend sent.
 const dedupedPredictions = useMemo<LivePrediction[]>(() => {
  return dedupPredictions(allRawPredictions, market);
 }, [allRawPredictions, market]);

 // RL-FIX-13: Quality-filtered predictions — يطبّق (1) حد الثقة و (2) top-5/يوم/شخصية
 // على كل التوقعات الخام قبل ما تروح للـ stats والـ chart والـ table.
 // لما qualityMode === 'all' بيرجّع كل التوقعات بدون فلترة.
 // FIX-5B: بنطبّق الـ quality filter على dedupedPredictions بدل allRawPredictions
 // علشان الـ dedup يفضل ساري حتى في وضع 'all'.
 const qualityFilteredPredictions = useMemo<LivePrediction[]>(() => {
 if (qualityMode === 'all') return dedupedPredictions;
 // (a) confidence floor
 const filtered = dedupedPredictions.filter((p) => {
 const score = Number(p.confidence ?? p.maestroScore ?? 0);
 return score >= minConfidence;
 });
 // (b) top-N per (entryDate, persona) — مجموع حسب (اليوم، الشخصية) ثم خذ أعلى 5
 const groupKey = (p: LivePrediction) =>
 `${String(p.entryDate || '').slice(0, 10)}__${p.persona || 'unknown'}`;
 const groups = new Map<string, LivePrediction[]>();
 for (const p of filtered) {
 const key = groupKey(p);
 if (!groups.has(key)) groups.set(key, []);
 groups.get(key)!.push(p);
 }
 const kept: LivePrediction[] = [];
 for (const [, group] of groups) {
 group.sort((a, b) =>
 Number(b.confidence ?? b.maestroScore ?? 0) - Number(a.confidence ?? a.maestroScore ?? 0)
 );
 kept.push(...group.slice(0, 5));
 }
 return kept;
 }, [dedupedPredictions, qualityMode, minConfidence]);

 // PERSONA-DEDUP (القاعدة الذهبية: السهم الواحد = صفقة واحدة): للإحصائيات الإجمالية،
 // نخصّص صف واحد لكل (ticker, entryDate) — حتى لو السهم ظهر في أكثر من شخصية.
 // التكرار بين الشخصيات = إشارة قوة (انظر focusTickers)، مش 3 صفقات منفصلة.
 // نختار الصف ذو الأولوية الأعلى: morning_bell → evidence_count → maestroScore/confidence.
 const aggregateByTicker = useMemo<LivePrediction[]>(() => {
 const best = new Map<string, LivePrediction>();
 const rank = (x: LivePrediction) =>
 (x.morning_bell ? 1_000_000 : 0) +
 Number(x.evidence_count ?? 0) * 1_000 +
 Number(x.confidence ?? x.maestroScore ?? 0);
 for (const p of qualityFilteredPredictions) {
 const key = `${p.ticker}__${String(p.entryDate || '').slice(0, 10)}`;
 const prev = best.get(key);
 if (!prev || rank(p) > rank(prev)) best.set(key, p);
 }
 return Array.from(best.values());
 }, [qualityFilteredPredictions]);

 // RL-FIX-13 + PERSONA-DEDUP: الإحصائيات الإجمالية تُحسب من الأسهم المخصّصة (ticker-level)،
 // أما تفصيل الشخصيات فيعرض "تغطية" كل شخصية (السهم في شخصيتين يظهر في الإحمالين) —
 // ده تحليل تغطية مش عدّ صفقات منفصلة. الـ overall هو العدّاد الرسمي للـ WR/PF.
 const computedStats = useMemo<{
 overall: PersonaStats;
 byPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats>;
 }>(() => {
 const overall = computeStatsFromPredictions(aggregateByTicker);
 const byPersona = {
 gambler: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'gambler')),
 balanced: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'balanced')),
 conservative: computeStatsFromPredictions(qualityFilteredPredictions.filter((p) => p.persona === 'conservative')),
 };
 return { overall, byPersona };
 }, [aggregateByTicker, qualityFilteredPredictions]);

 // P0-v17: كشف التكرار بين الشخصيات — السهم اللي يظهر في شخصيتين أو أكتر = "تركيز/قوة"
 // (نظام حساب واحد → التكرار معناه إشارة قوية: يا هتطلع يا هتنزل، لازم نركز كعصابة)
 const focusTickers = useMemo<Record<string, FocusTickerInfo>>(() => {
 const map: Record<string, { count: number; personas: Set<string> }> = {};
 for (const p of qualityFilteredPredictions) {
 if (!p.ticker) continue;
 if (!map[p.ticker]) map[p.ticker] = { count: 0, personas: new Set() };
 map[p.ticker].count += 1;
 if (p.persona) map[p.ticker].personas.add(p.persona);
 }
 const out: Record<string, FocusTickerInfo> = {};
 for (const [tk, info] of Object.entries(map)) {
 if (info.personas.size >= 2) out[tk] = { count: info.count, personas: Array.from(info.personas) };
 }
 return out;
 }, [qualityFilteredPredictions]);

 const focusTickerList = useMemo(() => Object.keys(focusTickers).sort(), [focusTickers]);

 // P0-v17: بيانات الرسم البياني لحركة الأرباح التراكمية (من الصفقات المقفلة فقط)
 // 🔥 VERIFY-FIX-5: الرسم بيقبل نفس فلتر entryPeriod (7d/30d/90d) اللي بيتحكم
 // في الجدول. قبل كده كان الرسم بـ uses allRawPredictions من غير فلتر → لما
 // المستخدم بيغير الفترة الزمنية، الجدول كان بيتحرك بس الرسم بيفضل ثابت.
 // دلوقتي الرسم بـ يتحدث مع تغيير الفترة.
 const cumulativeProfitData = useMemo<CumulativeProfitPoint[]>(() => {
 // احسب حد تاريخ الدخول للفلتر الزمني (نفس منطق filteredPredictions)
 let entryCutoff: number | null = null;
 if (entryPeriod !== 'all') {
 const d = entryPeriod === '7d' ? 7 : entryPeriod === '30d' ? 30 : 90;
 entryCutoff = Date.now() - d * 86400000;
 }

 // PERSONA-DEDUP + Rule 7: الرسم التراكمي يستخدم الأسهم المخصّصة (ticker-level) + HARD cap 50%.
 const closed = aggregateByTicker
 .filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS')
 .filter((p) => p.closedAt && p.returnPct != null)
 .filter((p) => Math.abs(Number(p.returnPct || 0)) <= 50)
 // 🔥 VERIFY-FIX-5: فلتر entryPeriod — نفس اللي الجدول بـ يستخدمه
 .filter((p) => {
 if (entryCutoff === null || !p.entryDate) return true;
 const t = new Date(String(p.entryDate).replace(' ', 'T')).getTime();
 if (isNaN(t)) return true; // لو التاريخ مش مفهوم، خليه (better to show than hide)
 return t >= entryCutoff;
 })
 .map((p) => ({
 ticker: p.ticker,
 closedAt: p.closedAt as string,
 returnPct: Number(p.returnPct),
 }))
 .sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
 let cum = 0;
 return closed.map((c) => {
 cum += c.returnPct;
 return {
 date: String(c.closedAt).slice(0, 10),
 label: `${String(c.closedAt).slice(5, 10)} · ${c.ticker}`,
 cumulative: Math.round(cum * 100) / 100,
 trade: Math.round(c.returnPct * 100) / 100,
 ticker: c.ticker,
 };
 });
 }, [aggregateByTicker, entryPeriod]);

 // RL-FIX-13: Computed Persona Stats — من التوقعات المفلترة بالجودة (مش من backend stats)
 const activeStats = useMemo<PersonaStats>(() => {
 if (!data) return { total: 0, wins: 0, losses: 0, pending: 0, settled: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, closedCount: 0, netReturn: 0, grossProfit: 0, grossLoss: 0, maxLoss: 0, rrRatio: 0 };
 if (selectedPersona === 'all') return computedStats.overall;
 return computedStats.byPersona[selectedPersona] || computedStats.overall;
 }, [data, selectedPersona, computedStats]);

 // Filtered & Sorted Predictions for Proof Table
 const filteredPredictions = useMemo(() => {
 // P0-v17: حساب حد تاريخ الدخول للفلتر الزمني
 let entryCutoff: number | null = null;
 if (entryPeriod !== 'all') {
 const d = entryPeriod === '7d' ? 7 : entryPeriod === '30d' ? 30 : 90;
 entryCutoff = Date.now() - d * 86400000;
 }
 // RL-FIX-7: YTD (days=999) — فلتر client-side من 1 يناير للسنة الحالية
 if (days === 999) {
 const now = new Date();
 const ytdCutoff = new Date(now.getFullYear(), 0, 1).getTime();
 entryCutoff = entryCutoff !== null ? Math.max(entryCutoff, ytdCutoff) : ytdCutoff;
 }

 return qualityFilteredPredictions
 .filter((item) => {
 // Persona filter
 if (selectedPersona !== 'all' && item.persona !== selectedPersona) return false;

 // Outcome filter
 if (selectedOutcome !== 'ALL' && item.outcome !== selectedOutcome) return false;

 // P0-v17: فلتر تاريخ الدخول (client-side)
 if (entryCutoff !== null && item.entryDate) {
 const t = new Date(String(item.entryDate).replace(' ', 'T')).getTime();
 if (!isNaN(t) && t < entryCutoff) return false;
 }

 // Search query filter (Ticker or Name)
 if (searchQuery.trim()) {
 const q = searchQuery.trim().toLowerCase();
 const matchTicker = item.ticker.toLowerCase().includes(q);
 const matchName = (item.nameAr || '').toLowerCase().includes(q);
 if (!matchTicker && !matchName) return false;
 }

 return true;
 })
 .sort((a, b) => {
 if (sortBy === 'return') {
 return (b.returnPct ?? 0) - (a.returnPct ?? 0);
 }
 if (sortBy === 'date') {
 return (b.entryDate || '').localeCompare(a.entryDate || '');
 }
 if (sortBy === 'target') {
 const aDist = a.targetPrice && a.currentPrice ? Math.abs(a.targetPrice - a.currentPrice) : 999;
 const bDist = b.targetPrice && b.currentPrice ? Math.abs(b.targetPrice - b.currentPrice) : 999;
 return aDist - bDist;
 }
 if (sortBy === 'days') {
 return (b.daysSinceEntry ?? 0) - (a.daysSinceEntry ?? 0);
 }
 return 0;
 });
 }, [qualityFilteredPredictions, selectedPersona, selectedOutcome, searchQuery, sortBy, entryPeriod, days]);

 const predictionsShareText = useMemo(
 () => generatePredictionsText(filteredPredictions, data),
 [filteredPredictions, data],
 );

 // Handle Exporting Proof Image
 const handleExportProofImage = useCallback(async () => {
 if (!proofCardRef.current || !selectedProofTrade) return;
 setDownloadingProof(true);
 try {
 const dataUrl = await toPng(proofCardRef.current, {
 quality: 0.95,
 pixelRatio: 2,
 backgroundColor: '#090d16',
 });
 const link = document.createElement('a');
 link.download = `PROOF_${selectedProofTrade.ticker}_${selectedProofTrade.persona}_${Date.now()}.png`;
 link.href = dataUrl;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 toast.success('تمت طباعة واستخراج بطاقة الإثبات بنجاح 📸');
 } catch (err) {
 console.error('Proof export failed:', err);
 toast.error('فشل استخراج بطاقة الإثبات');
 } finally {
 setDownloadingProof(false);
 }
 }, [selectedProofTrade]);

 return {
 // Raw data
 data,
 loading,
 refreshing,
 error,

 // Filters
 selectedPersona,
 setSelectedPersona,
 selectedOutcome,
 setSelectedOutcome,
 searchQuery,
 setSearchQuery,
 sortBy,
 setSortBy,
 entryPeriod,
 setEntryPeriod,
 qualityMode,
 setQualityMode,
 minConfidence,
 setMinConfidence,
 days,
 setDays,

 // Polling
 countdown,

 // Fetch
 fetchData,

 // Derived data
 allRawPredictions,
 dedupedPredictions,
 qualityFilteredPredictions,
 aggregateByTicker,
 computedStats,
 focusTickers,
 focusTickerList,
 cumulativeProfitData,
 activeStats,
 filteredPredictions,
 predictionsShareText,

 // Proof modal
 selectedProofTrade,
 setSelectedProofTrade,
 proofCardRef,
 downloadingProof,
 handleExportProofImage,

 // Task 4-b (Alpha A4): Market Regime + Today's Daily Picks
 marketRegimeInfo,
 dailyPicks,
 dailyPicksLoading,
 dailyPicksError,
 dailyPicksDate,
 refetchDailyPicks: fetchDailyPicks,
 };
}

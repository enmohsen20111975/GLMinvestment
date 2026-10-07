import { create } from 'zustand';

export interface AnalysisCacheData {
  /**
   * Stock rows from /api/stocks. Shape varies per market source (EGX/TADAWUL/crypto…)
   * so we keep it as an opaque record array. Callers must narrow at consumption.
   */
  stocks: Record<string, unknown>[] | null;
  /** Open predictions from /api/unified/predictions (opaque record array). */
  predictions: Record<string, unknown>[] | null;
  /** Closed predictions from the same endpoint (opaque record array). */
  closedPredictions: Record<string, unknown>[] | null;
  /** Stored Maestro analyses — opaque record array (consumers narrow to StoredAnalysisItem). */
  storedAnalysis: Record<string, unknown>[] | null;
  lastFetched: number;
  market: string;
  isFetching: boolean;
  /**
   * 🔥 P14 (أغسطس 2026): مفتاح "الوضع المباشر" المشترك لكل tabs.
   * لما يكون false (الافتراضي)، polling بيتوقف في كل الـ tabs — الصفحة بتجيب
   * البيانات مرة واحدة عند الفتح بس. المستخدم يقدر يفعّله يدوياً بزر "مباشر".
   * ده بيوقف حمّال الـ backend اللي كان بيوقع السيرفر الإنتاجي.
   */
  liveMode: boolean;
}

interface AnalysisStore extends AnalysisCacheData {
  setStocks: (stocks: Record<string, unknown>[]) => void;
  setPredictions: (predictions: Record<string, unknown>[], closed: Record<string, unknown>[]) => void;
  setStoredAnalysis: (items: Record<string, unknown>[]) => void;
  setFetching: (isFetching: boolean) => void;
  setMarket: (market: string) => void;
  setLiveMode: (liveMode: boolean) => void;
  reset: () => void;
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  stocks: null,
  predictions: null,
  closedPredictions: null,
  storedAnalysis: null,
  lastFetched: 0,
  market: '',
  isFetching: false,
  liveMode: false, // 🔥 P14: polling متوقف افتراضياً — المستخدم يفعّله يدوياً
  setStocks: (stocks) => set({ stocks }),
  setPredictions: (predictions, closedPredictions) => set({ predictions, closedPredictions }),
  setStoredAnalysis: (storedAnalysis) => set({ storedAnalysis }),
  setFetching: (isFetching) => set({ isFetching }),
  setMarket: (market) => set({ market }),
  setLiveMode: (liveMode) => set({ liveMode }),
  reset: () => set({
    stocks: null,
    predictions: null,
    closedPredictions: null,
    storedAnalysis: null,
    lastFetched: 0,
    market: '',
    isFetching: false,
    liveMode: false,
  }),
}));

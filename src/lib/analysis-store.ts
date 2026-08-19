import { create } from 'zustand';

export interface AnalysisCacheData {
  stocks: any[] | null;
  predictions: any[] | null;
  closedPredictions: any[] | null;
  storedAnalysis: any[] | null;
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
  setStocks: (stocks: any[]) => void;
  setPredictions: (predictions: any[], closed: any[]) => void;
  setStoredAnalysis: (items: any[]) => void;
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

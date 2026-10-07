'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/* ============================================================
   ALERTS-031: Real-time Price & Score Alerts Store
   ============================================================
   - Persisted to localStorage (survives page refresh)
   - Monitored by use-alerts.ts hook against live ticker data
   - Supports 7 alert types: price_above, price_below, score_above,
     score_below, pine_golden, pine_deadcat, pine_divergence
   ============================================================ */

export type AlertType =
  | 'price_above'
  | 'price_below'
  | 'score_above'
  | 'score_below'
  | 'pine_golden'
  | 'pine_deadcat'
  | 'pine_divergence';

export interface PriceAlert {
  id: string;
  ticker: string;
  type: AlertType;
  /** Threshold value for price_above/price_below/score_above/score_below */
  threshold?: number;
  enabled: boolean;
  createdAt: string;
  /** ISO timestamp of last fire (debounce — don't refire within 5 min) */
  lastFired?: string;
  /** Human-readable label, e.g. "السعر فوق 50.0 جنيه" */
  label: string;
}

export interface AlertsStore {
  alerts: PriceAlert[];
  /** Sound on/off (global toggle) */
  soundEnabled: boolean;
  /** Browser notifications on/off */
  notificationsEnabled: boolean;
  /** Recently fired alert IDs (for visual feedback) */
  recentlyFired: Record<string, string>; // alertId → ISO timestamp

  addAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt' | 'enabled'>) => void;
  removeAlert: (id: string) => void;
  toggleAlert: (id: string) => void;
  toggleSound: () => void;
  toggleNotifications: () => void;
  markFired: (id: string) => void;
  clearRecentlyFired: () => void;
  getAlertsForTicker: (ticker: string) => PriceAlert[];
}

function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export const useAlertsStore = create<AlertsStore>()(
  persist(
    (set, get) => ({
      alerts: [],
      soundEnabled: true,
      notificationsEnabled: false, // off by default — requires permission
      recentlyFired: {},

      addAlert: (alertData) => {
        const newAlert: PriceAlert = {
          ...alertData,
          id: generateId(),
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ alerts: [...s.alerts, newAlert] }));
      },

      removeAlert: (id) => {
        set((s) => ({
          alerts: s.alerts.filter((a) => a.id !== id),
          recentlyFired: Object.fromEntries(
            Object.entries(s.recentlyFired).filter(([k]) => k !== id),
          ),
        }));
      },

      toggleAlert: (id) => {
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, enabled: !a.enabled } : a,
          ),
        }));
      },

      toggleSound: () => {
        set((s) => ({ soundEnabled: !s.soundEnabled }));
      },

      toggleNotifications: () => {
        set((s) => ({ notificationsEnabled: !s.notificationsEnabled }));
      },

      markFired: (id) => {
        const now = new Date().toISOString();
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, lastFired: now } : a,
          ),
          recentlyFired: { ...s.recentlyFired, [id]: now },
        }));
      },

      clearRecentlyFired: () => {
        set({ recentlyFired: {} });
      },

      getAlertsForTicker: (ticker) => {
        return get().alerts.filter(
          (a) => a.ticker === ticker.toUpperCase() && a.enabled,
        );
      },
    }),
    {
      name: 'glminvestment-alerts',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/* ============================================================
   ALERT TYPE METADATA (for UI rendering)
   ============================================================ */

export const ALERT_TYPE_META: Record<
  AlertType,
  { label: string; labelAr: string; icon: string; color: string; needsThreshold: boolean; thresholdLabel: string; thresholdPlaceholder: string }
> = {
  price_above: {
    label: 'Price Above',
    labelAr: 'السعر فوق',
    icon: '📈',
    color: '#22c55e',
    needsThreshold: true,
    thresholdLabel: 'السعر المستهدف (جنيه)',
    thresholdPlaceholder: 'مثال: 50.00',
  },
  price_below: {
    label: 'Price Below',
    labelAr: 'السعر تحت',
    icon: '📉',
    color: '#ef4444',
    needsThreshold: true,
    thresholdLabel: 'السعر المستهدف (جنيه)',
    thresholdPlaceholder: 'مثال: 40.00',
  },
  score_above: {
    label: 'Score Above',
    labelAr: 'الـ Score فوق',
    icon: '🎯',
    color: '#3b82f6',
    needsThreshold: true,
    thresholdLabel: 'الـ Score المستهدف (0-138)',
    thresholdPlaceholder: 'مثال: 75',
  },
  score_below: {
    label: 'Score Below',
    labelAr: 'الـ Score تحت',
    icon: '⚠️',
    color: '#f97316',
    needsThreshold: true,
    thresholdLabel: 'الـ Score المستهدف (0-138)',
    thresholdPlaceholder: 'مثال: 30',
  },
  pine_golden: {
    label: 'Golden Pullback',
    labelAr: 'تصحيح ذهبي 🟢',
    icon: '🟢',
    color: '#84cc16',
    needsThreshold: false,
    thresholdLabel: '',
    thresholdPlaceholder: '',
  },
  pine_deadcat: {
    label: 'Dead Cat Bounce',
    labelAr: 'فخ ارتداد ⚠️',
    icon: '⚠️',
    color: '#ef4444',
    needsThreshold: false,
    thresholdLabel: '',
    thresholdPlaceholder: '',
  },
  pine_divergence: {
    label: 'Bullish Divergence',
    labelAr: 'تباعد إيجابي 📊',
    icon: '📊',
    color: '#3b82f6',
    needsThreshold: false,
    thresholdLabel: '',
    thresholdPlaceholder: '',
  },
};

/** Debounce window: don't refire the same alert within 5 minutes */
export const ALERT_DEBOUNCE_MS = 5 * 60 * 1000;

'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  useAlertsStore,
  ALERT_DEBOUNCE_MS,
  type PriceAlert,
  type AlertType,
} from '@/lib/alerts-store';
import { playAlertSound } from '@/lib/alert-sound';
import type { LiveTickerData } from '@/lib/ws-client';

/* ============================================================
   ALERTS-031: useAlerts Hook
   ============================================================
   - Monitors live ticker data against user-defined alerts
   - Fires: sound + browser notification + toast
   - Debounce: same alert won't refire within 5 minutes
   - Also monitors the global stock:alert WebSocket event for
     cross-ticker alerts (e.g., BUY signal + score ≥ 75)
   ============================================================ */

interface AlertFireContext {
  ticker: string;
  currentPrice: number;
  currentScore: number;
  isGoldenPullback: boolean;
  isDeadCat: boolean;
  isBullishDivergence: boolean;
  signal: string;
  signalAr: string;
}

/** Check if an alert should fire based on current live data */
function shouldAlertFire(alert: PriceAlert, ctx: AlertFireContext): boolean {
  switch (alert.type) {
    case 'price_above':
      return (
        alert.threshold !== undefined &&
        ctx.currentPrice >= alert.threshold
      );
    case 'price_below':
      return (
        alert.threshold !== undefined &&
        ctx.currentPrice <= alert.threshold
      );
    case 'score_above':
      return (
        alert.threshold !== undefined &&
        ctx.currentScore >= alert.threshold
      );
    case 'score_below':
      return (
        alert.threshold !== undefined &&
        ctx.currentScore <= alert.threshold
      );
    case 'pine_golden':
      return ctx.isGoldenPullback;
    case 'pine_deadcat':
      return ctx.isDeadCat;
    case 'pine_divergence':
      return ctx.isBullishDivergence;
    default:
      return false;
  }
}

/** Determine alert direction for sound selection */
function getAlertDirection(type: AlertType): 'up' | 'down' | 'neutral' {
  switch (type) {
    case 'price_above':
    case 'score_above':
    case 'pine_golden':
    case 'pine_divergence':
      return 'up';
    case 'price_below':
    case 'score_below':
    case 'pine_deadcat':
      return 'down';
    default:
      return 'neutral';
  }
}

/** Build human-readable message for the alert */
function buildAlertMessage(alert: PriceAlert, ctx: AlertFireContext): string {
  const priceStr = ctx.currentPrice.toFixed(2);
  switch (alert.type) {
    case 'price_above':
      return `${alert.ticker} وصل ${priceStr} (فوق ${alert.threshold?.toFixed(2)})`;
    case 'price_below':
      return `${alert.ticker} وصل ${priceStr} (تحت ${alert.threshold?.toFixed(2)})`;
    case 'score_above':
      return `${alert.ticker} Score=${ctx.currentScore.toFixed(1)} (فوق ${alert.threshold})`;
    case 'score_below':
      return `${alert.ticker} Score=${ctx.currentScore.toFixed(1)} (تحت ${alert.threshold})`;
    case 'pine_golden':
      return `🟢 ${alert.ticker} تصحيح ذهبي! السعر ${priceStr}`;
    case 'pine_deadcat':
      return `⚠️ ${alert.ticker} فخ ارتداد! ابتعد — السعر ${priceStr}`;
    case 'pine_divergence':
      return `📊 ${alert.ticker} تباعد إيجابي — السعر ${priceStr}`;
    default:
      return `${alert.ticker} تنبيه`;
  }
}

/** Check if alert is within debounce window (5 min since last fire) */
function isWithinDebounce(alert: PriceAlert): boolean {
  if (!alert.lastFired) return false;
  const last = new Date(alert.lastFired).getTime();
  return Date.now() - last < ALERT_DEBOUNCE_MS;
}

/** Show browser notification (if permitted) */
function showBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: `alert-${Date.now()}`,
    });
  } catch {
    // Silent fail
  }
}

/** Request browser notification permission */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * useAlerts Hook — monitors live ticker data and fires alerts.
 *
 * Usage:
 *   const { liveData } = useLiveTicker(ticker);
 *   useAlerts(ticker, liveData);
 */
export function useAlerts(
  ticker: string | null,
  liveData: LiveTickerData | null,
): void {
  // ALERTS-031: Use refs to avoid re-render loops.
  // The previous version subscribed to `alerts` directly, which caused
  // markFired() → alerts change → checkAlerts rebuild → useEffect re-run →
  // markFired() again = infinite loop. Now we read from the store lazily
  // inside the effect via getState(), so the component never re-renders
  // when alerts fire.
  const lastCheckedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!liveData || !ticker) return;

    // Throttle: only check once per 3 seconds per ticker
    const now = Date.now();
    const last = lastCheckedRef.current[ticker] ?? 0;
    if (now - last < 3000) return;
    lastCheckedRef.current[ticker] = now;

    // Read fresh state from the store (no subscription → no re-render)
    const state = useAlertsStore.getState();
    const { alerts, soundEnabled, notificationsEnabled, markFired } = state;

    const ctx: AlertFireContext = {
      ticker: liveData.ticker,
      currentPrice: liveData.today_candle?.close ?? 0,
      currentScore: liveData.score ?? 0,
      isGoldenPullback: liveData.is_golden_pullback ?? false,
      isDeadCat: liveData.is_dead_cat ?? false,
      isBullishDivergence: liveData.is_bullish_divergence ?? false,
      signal: liveData.signal ?? '',
      signalAr: liveData.signal_ar ?? '',
    };

    // Get enabled alerts for this ticker (not within debounce window)
    const tickerAlerts = alerts.filter(
      (a) =>
        a.ticker === ticker.toUpperCase() &&
        a.enabled &&
        !isWithinDebounce(a),
    );

    for (const alert of tickerAlerts) {
      if (!shouldAlertFire(alert, ctx)) continue;

      // Fire the alert!
      const message = buildAlertMessage(alert, ctx);
      const direction = getAlertDirection(alert.type);

      // 1. Sound
      if (soundEnabled) {
        playAlertSound(direction);
      }

      // 2. Browser notification
      if (notificationsEnabled) {
        showBrowserNotification(`🔔 ${alert.ticker} — تنبيه`, message);
      }

      // 3. Toast (visual)
      const toastColor =
        direction === 'up'
          ? 'bg-emerald-950/80 border-emerald-700'
          : direction === 'down'
            ? 'bg-red-950/80 border-red-700'
            : 'bg-blue-950/80 border-blue-700';

      toast.custom(
        () => (
          <div
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border ${toastColor} shadow-2xl backdrop-blur-sm min-w-[300px]`}
          >
            <div className="text-2xl shrink-0">
              {direction === 'up'
                ? '🔔'
                : direction === 'down'
                  ? '🚨'
                  : '📢'}
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-sm font-bold text-white truncate">
                {message}
              </span>
              <span className="text-[10px] text-zinc-400">
                {new Date().toLocaleTimeString('ar-EG', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                • تنبيه آلي
              </span>
            </div>
          </div>
        ),
        { duration: 8000 },
      );

      // 4. Mark as fired (debounce) — safe now, won't re-trigger this effect
      markFired(alert.id);
    }
  }, [liveData, ticker]);
}

/**
 * useCrossTickerAlerts — listens to the global stock:alert WebSocket event
 * for alerts on ANY subscribed ticker (not just the currently open one).
 * This catches BUY signals (score ≥ 75) on watchlist tickers.
 */
export function useCrossTickerAlerts(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }

    let cancelled = false;

    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;

      const wsUrl = `http://${window.location.hostname}:3005`;
      const socket = io(wsUrl, {
        transports: ['polling', 'websocket'],
        forceNew: true,
        timeout: 5000,
      });

      socket.on('stock:alert', (data: { ticker: string; name_ar?: string; price?: number; change?: number; direction?: 'up' | 'down'; message?: string; timestamp: string }) => {
        if (!data?.ticker) return;

        // Skip if no message (regular price alerts without message field)
        if (!data.message) return;

        // Read fresh toggle state from store (no subscription → no re-render loop)
        const { soundEnabled, notificationsEnabled } = useAlertsStore.getState();

        // Sound
        if (soundEnabled) {
          playAlertSound(data.direction === 'down' ? 'down' : 'up');
        }

        // Browser notification
        if (notificationsEnabled) {
          showBrowserNotification(`🔔 ${data.ticker}`, data.message);
        }

        // Toast
        toast.custom(
          () => (
            <div className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border bg-amber-950/80 border-amber-700 shadow-2xl backdrop-blur-sm min-w-[300px]">
              <div className="text-2xl shrink-0">🔥</div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-sm font-bold text-white truncate">
                  {data.message}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {data.name_ar || data.ticker} • LIVE Signal
                </span>
              </div>
            </div>
          ),
          { duration: 10000 },
        );
      });

      socket.on('connect_error', () => {
        // Silent — WebSocket optional
      });
    }).catch(() => {
      // socket.io-client not available
    });

    return () => {
      cancelled = true;
    };
  }, []);
}

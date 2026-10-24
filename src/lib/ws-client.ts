'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNotificationStore } from '@/lib/notification-store';

// ─── Types ───

interface StockUpdate {
  ticker: string;
  name_ar: string;
  current_price: number;
  previous_price: number;
  price_change: number;
  volume: number;
}

interface MarketUpdate {
  stocks: StockUpdate[];
  timestamp: string;
}

interface StockAlert {
  ticker: string;
  name_ar: string;
  price: number;
  change: number;
  direction: 'up' | 'down';
  timestamp: string;
}

interface MarketStatus {
  status: string;
  is_open: boolean;
  stocks: StockUpdate[];
  gainers_count: number;
  losers_count: number;
  unchanged_count: number;
  total_volume: number;
  timestamp: string;
}

// ─── Safe number formatting helpers ───

export function safeToFixed(value: unknown, digits: number = 2, fallback: string = '—'): string {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) ? num.toFixed(digits) : fallback;
}

// ─── Phase 9: Document Visibility Hook ──────────────────────────────────
// Pause-on-Hidden optimization: لو التبويب hidden (background tab)، الـ live
// updates بتبطل re-rendering عشان متهدرش CPU/Network. أول ما التبويب يرجع
// visible، التحديثات بترجع فوراً. ده بيخلي السيرفر يتنفس لو فيه 100 تاب
// مفتوحين في الخلفية.
//
// الـ hook بيرجّع boolean `isVisible`. الـ callers بيستخدموه في الـ event
// handlers عشان يقرروا يعملوا setState ولا لأ.

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      // Log للـ debugging (بس مرة واحدة لكل transition عشان مايزحمش الـ console)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[WS] Tab ${visible ? 'visible — resuming live updates' : 'hidden — pausing live updates'}`);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

// ─── Connection resilience ───
// The ws-service (socket.io on port 3005) lives at vps-service/ws-service/ and
// is started by PM2 / the dev launcher. If it is unreachable (e.g. Caddy's
// XTransformPort proxy cannot upgrade WebSocket in some setups), the client
// retries MAX_RECONNECT_ATTEMPTS times then silently disables real-time updates
// so the rest of the UI keeps working on top of the REST polling fallback.
//
// P19-REAL-TIME-SYNC: على الـ production بنوصل الـ ws-service عبر Caddy
// بـ `?XTransformPort=3005` (path '/socket.io/'). على الـ dev (localhost)
// بنوصل مباشرة على المنفذ 3005.

const MAX_RECONNECT_ATTEMPTS = 1;
let globalConnectFailed = false;

/**
 * P19: ابنِ الـ WebSocket URL المناسب للبيئة الحالية.
 *  - dev (localhost): مباشرة على http://localhost:3005 (أو hostname:3005).
 *  - production: عبر Caddy بـ نفس الـ origin + path '/socket.io/' +
 *    query XTransformPort=3005.
 */
function buildWsUrl(): { url: string; opts?: Record<string, unknown> } {
  if (typeof window === 'undefined') {
    return { url: 'http://localhost:3005' };
  }
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { url: `http://${hostname}:3005` };
  }
  // Production: استخدم نفس الـ origin + path '/socket.io/' عبر Caddy.
  // socket.io-client بياخد الـ origin فقط، والـ path بيكون default '/socket.io/'.
  return {
    url: window.location.origin,
    opts: {
      path: '/socket.io/',
      query: { XTransformPort: '3005' },
    },
  };
}

export function useRealtimeUpdates() {
  // Use `any` for the socket ref since we don't want to statically import socket.io-client
  const socketRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [stockPrices, setStockPrices] = useState<StockUpdate[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const reconnectAttemptsRef = useRef(0);
  const hasErroredRef = useRef(false);

  // Phase 9: Pause-on-Hidden — لما التبويب hidden، بطل re-render للـ live data.
  // الـ socket بيفضل متصل عشان الرجوع فوري أول ما التبويب يرجع visible.
  const isVisible = useDocumentVisibility();
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  const connect = useCallback(() => {
    // P19-REAL-TIME-SYNC: WebSocket enabled on production via Caddy
    // (path '/socket.io/' + query XTransformPort=3005). ما عادش بنعطل الـ WS
    // على الـ production — بنحاول نوصله، ولو فشل بنسكت بس (REST fallback).
    if (globalConnectFailed) {
      return;
    }

    if (socketRef.current?.connected) return;
    if (hasErroredRef.current) return;

    import('socket.io-client').then(({ io }) => {
      // P19: use buildWsUrl() — supports both dev (direct port) and production (Caddy proxy)
      const { url: wsUrl, opts: extraOpts } = buildWsUrl();

      const socket = io(wsUrl, {
        transports: ['polling', 'websocket'], // Allow websocket fallback
        forceNew: true,
        reconnection: true, // Allow reconnection
        reconnectionAttempts: 2, // Limit reconnection attempts
        reconnectionDelay: 3000, // Wait 3s before first retry
        reconnectionDelayMax: 10000, // Max 10s between retries
        timeout: 8000, // 8s timeout (was 5s — too short for Caddy proxy)
        ...(extraOpts || {}),
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      });

      socket.on('disconnect', (_reason: string) => {
        setIsConnected(false);
      });

      socket.on('connect_error', (error: Error) => {
        reconnectAttemptsRef.current++;
        hasErroredRef.current = true;
        // Only log first error, then suppress — avoids console spam
        if (reconnectAttemptsRef.current === 1) {
          console.log('[WS] Connection error (suppressed further logs):', error.message);
        }
        setIsConnected(false);
        // After 2 attempts, silently disable — REST polling takes over
        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          globalConnectFailed = true;
          socket.disconnect();
        }
      });

      socket.on('market:update', (data: MarketUpdate) => {
        // Phase 9: Pause-on-Hidden — بطل re-render لو التبويب hidden
        if (!isVisibleRef.current) return;
        if (data?.stocks?.length) {
          const validStocks = data.stocks.filter((s): s is StockUpdate => s != null && !!s.ticker);
          setStockPrices(validStocks);
        }
      });

      socket.on('market:snapshot', (data: MarketUpdate) => {
        // Phase 9: Pause-on-Hidden — بطل re-render لو التبويب hidden
        if (!isVisibleRef.current) return;
        if (data?.stocks?.length) {
          const validStocks = data.stocks.filter((s): s is StockUpdate => s != null && !!s.ticker);
          setStockPrices(validStocks);
        }
      });

      socket.on('market:status', (data: MarketStatus) => {
        // Phase 9: Pause-on-Hidden — بطل re-render لو التبويب hidden
        if (!isVisibleRef.current) return;
        if (data) setMarketStatus(data);
      });

      socket.on('stock:alert', (data: StockAlert) => {
        // Phase 9: alerts بتفضل تشتغل حتى لو التبويب hidden (الإشعارات مهمة)
        if (!data) return;
        const isUp = data.direction === 'up';
        addNotification({
          type: 'price_alert',
          title: isUp ? 'Price Alert: Up' : 'Price Alert: Down',
          title_ar: isUp ? 'تنبيه ارتفاع سعر' : 'تنبيه انخفاض سعر',
          message: `${data.ticker || ''} ${isUp ? 'rose' : 'dropped'} ${safeToFixed(Math.abs(data.change))}% to ${safeToFixed(data.price)}`,
          message_ar: `${data.name_ar || ''} ${isUp ? 'ارتفع' : 'انخفض'} ${safeToFixed(Math.abs(data.change))}% إلى ${safeToFixed(data.price)}`,
          data: { ticker: data.ticker, price: data.price, change: data.change },
        });
      });

      socket.on('ticker:update', (data: StockUpdate) => {
        // Phase 9: Pause-on-Hidden — بطل re-render لو التبويب hidden
        if (!isVisibleRef.current) return;
        if (!data || !data.ticker) return;
        setStockPrices((prev) => {
          const filtered = prev.filter((s) => s.ticker !== data.ticker);
          return [...filtered, data];
        });
      });
    }).catch(() => {
      console.log('[WS] socket.io-client not available, real-time updates disabled');
      globalConnectFailed = true;
    });
  }, [addNotification]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const subscribeTicker = useCallback((ticker: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe:ticker', ticker.toUpperCase());
    }
  }, []);

  const unsubscribeTicker = useCallback((ticker: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe:ticker', ticker.toUpperCase());
    }
  }, []);

  const getMarketOverview = useCallback(() => {
    return new Promise<MarketStatus | null>((resolve) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('getMarketOverview', (data: MarketStatus) => {
          resolve(data);
        });
      } else {
        resolve(null);
      }
    });
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    stockPrices,
    marketStatus,
    connect,
    disconnect,
    subscribeTicker,
    unsubscribeTicker,
    getMarketOverview,
  };
}

// ─── LIVE-ENGINE-028: useLiveTicker Hook ─────────────────────────────────

export interface LiveTickerData {
  ticker: string;
  mode: string;
  score: number;
  signal: string;
  signal_ar: string;
  live_rsi: number;
  live_macd_hist: number;
  volume_ratio: number;
  candlestick: { name: string; name_ar?: string; signal: string; points: number };
  breakdown: Record<string, { points: number; max: number; value?: number; ratio?: number; hist?: number; pattern?: string }>;
  today_candle: { open: number; high: number; low: number; close: number; volume: number; found: boolean };
  is_dead_cat: boolean;
  is_golden_pullback: boolean;
  is_bullish_divergence: boolean;
  reason: string;
  timestamp: string;
  // P41-DELAYED-DATA-MODE: flags from LiveIndicatorEngine (delayed_mode response)
  delayed_mode?: boolean;
  delayed_minutes?: number;
  breakout_vetoed?: boolean;
  daily_change_pct?: number;
  golden_pullback_boost?: number;
}

export function useLiveTicker(ticker: string | null) {
  const [liveData, setLiveData] = useState<LiveTickerData | null>(null);
  const [isLive, setIsLive] = useState(false);
  const socketRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);
  // P19: خفّض الـ throttle من 5 دقايق لـ 2 ثانية — عشان الـ Live Developing
  // Candle يتحدث فوراً مع كل ticker:update (Hyper Polling كل 2 ثانية وقت الجلسة).
  // الـ data_engine/sync.py بيـ broadcast الأسعار بعد كل sync، والـ ws-service
  // بيـ pushها فوراً للمشتركين. مفيش حاجة نستناها 5 دقايق.
  const THROTTLE_MS = 2 * 1000; // 2 seconds — P19 Hyper Polling

  // Phase 9: Pause-on-Hidden — لما التبويب hidden:
  //   1. emit 'unsubscribe:ticker' للسيرفر عشان يبطل polling للسهم ده (يخلي السيرفر يتنفس)
  //   2. بطل setState للـ ticker:live / ticker:update (بطل re-render)
  // أول ما التبويب يرجع visible: emit 'subscribe:ticker' عشان السيرفر يكمّل البث.
  const isVisible = useDocumentVisibility();
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  // Track the current ticker so the visibility effect can subscribe/unsubscribe
  const tickerRef = useRef<string | null>(null);
  tickerRef.current = ticker ? ticker.toUpperCase() : null;

  // Phase 9: visibility-driven subscribe/unsubscribe
  // لما التبويب يبقى hidden → unsubscribe (السيرفر يبطل polling للسهم)
  // لما التبويب يبقى visible → subscribe (السيرفر يكمّل البث)
  useEffect(() => {
    if (!tickerRef.current) return;
    if (!socketRef.current?.connected) return;

    if (isVisible) {
      // Tab بقا visible → subscribe تاني
      socketRef.current.emit('subscribe:ticker', tickerRef.current);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[WS] Tab visible → re-subscribed to ${tickerRef.current}`);
      }
    } else {
      // Tab بقا hidden → unsubscribe عشان السيرفر يبطل polling
      socketRef.current.emit('unsubscribe:ticker', tickerRef.current);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[WS] Tab hidden → unsubscribed from ${tickerRef.current} (server pauses polling)`);
      }
    }
  }, [isVisible]);

  useEffect(() => {
    if (!ticker || typeof window === 'undefined') {
      setLiveData(null);
      setIsLive(false);
      return;
    }

    // P19-REAL-TIME-SYNC: WebSocket enabled on production via Caddy proxy
    // (path '/socket.io/' + query XTransformPort=3005). ما عادش بنعطل الـ hook
    // على الـ production.

    let cancelled = false;

    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;

      // P19: use buildWsUrl() — supports both dev (direct port) and production (Caddy proxy)
      const { url: wsUrl, opts: extraOpts } = buildWsUrl();
      const socket = io(wsUrl, {
        transports: ['polling', 'websocket'],
        forceNew: true,
        timeout: 5000,
        ...(extraOpts || {}),
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        if (!cancelled) {
          setIsLive(true);
          socket.emit('subscribe:ticker', ticker.toUpperCase());
        }
      });

      socket.on('ticker:live', (data: LiveTickerData) => {
        if (cancelled || data?.ticker !== ticker.toUpperCase()) return;
        // Phase 9: Pause-on-Hidden — بطل setState لو التبويب hidden
        if (!isVisibleRef.current) return;
        const now = Date.now();
        if (now - lastUpdateRef.current < THROTTLE_MS) return;
        lastUpdateRef.current = now;
        setLiveData(data);
      });

      socket.on('ticker:update', (data: StockUpdate) => {
        if (cancelled || data?.ticker !== ticker.toUpperCase()) return;
        // Phase 9: Pause-on-Hidden — بطل setState لو التبويب hidden
        if (!isVisibleRef.current) return;
        const now = Date.now();
        if (now - lastUpdateRef.current < THROTTLE_MS) return;
        lastUpdateRef.current = now;
        setLiveData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            today_candle: {
              ...prev.today_candle,
              close: data.current_price,
              high: Math.max(prev.today_candle.high, data.current_price),
              low: Math.min(prev.today_candle.low, data.current_price),
              volume: data.volume,
            },
          };
        });
      });

      socket.on('disconnect', () => {
        if (!cancelled) setIsLive(false);
      });

      socket.on('connect_error', () => {
        if (!cancelled) setIsLive(false);
      });
    }).catch(() => {
      // socket.io-client not available — silent fallback to REST
    });

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.emit('unsubscribe:ticker', ticker.toUpperCase());
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsLive(false);
    };
  }, [ticker]);

  return { liveData, isLive };
}

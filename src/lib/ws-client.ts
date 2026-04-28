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

// ─── Production check ───
// In production builds, NODE_ENV is always 'production'.
// The mini-service on port 3005 only exists in development sandbox.

const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

export function useRealtimeUpdates() {
  // Use `any` for the socket ref since we don't want to statically import socket.io-client
  const socketRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [stockPrices, setStockPrices] = useState<StockUpdate[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 3;

  const connect = useCallback(() => {
    // ─── COMPLETELY DISABLE IN PRODUCTION ───
    // Don't even try to import socket.io-client in production.
    // This prevents any network requests or console errors.
    if (IS_PRODUCTION) {
      return;
    }

    if (socketRef.current?.connected) return;

    // Dynamic import — only loads socket.io-client in development
    import('socket.io-client').then(({ io }) => {
      const socket = io('/?XTransformPort=3005', {
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 5000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('[WS] Connected to market service');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      });

      socket.on('disconnect', (reason: string) => {
        console.log('[WS] Disconnected:', reason);
        setIsConnected(false);
      });

      socket.on('connect_error', (error: Error) => {
        reconnectAttemptsRef.current++;
        if (reconnectAttemptsRef.current <= 2) {
          console.log('[WS] Connection error:', error.message);
        }
        setIsConnected(false);
      });

      socket.on('market:update', (data: MarketUpdate) => {
        if (data?.stocks?.length) setStockPrices(data.stocks);
      });

      socket.on('market:snapshot', (data: MarketUpdate) => {
        if (data?.stocks?.length) setStockPrices(data.stocks);
      });

      socket.on('market:status', (data: MarketStatus) => {
        if (data) setMarketStatus(data);
      });

      socket.on('stock:alert', (data: StockAlert) => {
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
        if (!data) return;
        setStockPrices((prev) => {
          const filtered = prev.filter((s) => s.ticker !== data.ticker);
          return [...filtered, data];
        });
      });
    }).catch(() => {
      // socket.io-client not available, silently fail
      console.log('[WS] socket.io-client not available, real-time updates disabled');
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

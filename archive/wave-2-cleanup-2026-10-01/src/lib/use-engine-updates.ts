/**
 * Real-Time Engine Updates Hook
 * =============================
 * يوفر تحديثات لحظية لحالة المحركات عبر WebSocket.
 * يستخدم الـ ws-service (port 3005) لجلب التحديثات.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRealtimeUpdates } from '@/lib/ws-client';

export interface EngineUpdate {
  engineId: string;
  status: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export function useEngineUpdates() {
  const { isConnected, stockPrices, marketStatus, connect, disconnect } = useRealtimeUpdates();
  const [engineUpdates, setEngineUpdates] = useState<EngineUpdate[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);

  // Track engine updates from market status changes
  useEffect(() => {
    if (marketStatus) {
      setLastUpdateTime(new Date());
      // Convert market status to engine update format
      const update: EngineUpdate = {
        engineId: 'market-status',
        status: marketStatus.is_open ? 'open' : 'closed',
        timestamp: marketStatus.timestamp,
        data: {
          gainers: marketStatus.gainers_count,
          losers: marketStatus.losers_count,
          unchanged: marketStatus.unchanged_count,
        },
      };
      setEngineUpdates(prev => [update, ...prev.slice(0, 49)]); // Keep last 50 updates
    }
  }, [marketStatus]);

  // Track stock price updates
  useEffect(() => {
    if (stockPrices.length > 0) {
      setLastUpdateTime(new Date());
    }
  }, [stockPrices]);

  const clearUpdates = useCallback(() => {
    setEngineUpdates([]);
  }, []);

  return {
    isConnected,
    engineUpdates,
    lastUpdateTime,
    stockPrices,
    marketStatus,
    clearUpdates,
    reconnect: connect,
    disconnect,
  };
}

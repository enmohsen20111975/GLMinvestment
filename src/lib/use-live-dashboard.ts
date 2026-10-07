'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * BRIEF-048: Live Dashboard Hooks
 * - useHeartbeat: يراقب صحة النظام (heartbeat)
 * - useWhaleAlerts: يستقبل تنبيهات الحيتان
 * - useLiveLedger: يجيب سجل التوقعات + Win Rate
 */

export interface HeartbeatStatus {
  status: 'healthy' | 'stale' | 'error' | 'loading';
  lastUpdate: string;
  message: string;
}

export interface WhaleAlert {
  id: string;
  ticker: string;
  smc_score: number;
  price: number;
  message: string;
  timestamp: string;
}

export interface LiveLedger {
  active_predictions: any[];
  closed_predictions: any[];
  win_rate: number;
  total_signals: number;
  wins: number;
  losses: number;
  live_alerts: any[];
}

/**
 * useHeartbeat - يراقب صحة النظام كل دقيقة
 */
export function useHeartbeat() {
  const [status, setStatus] = useState<HeartbeatStatus>({
    status: 'loading',
    lastUpdate: '',
    message: 'جاري الفحص...',
  });

  useEffect(() => {
    let cancelled = false;

    const checkHeartbeat = async () => {
      try {
        // استخدم الـ market-pulse endpoint كـ heartbeat check
        const res = await fetch('/api/market-pulse', { cache: 'no-store' });
        if (!res.ok) throw new Error('API error');

        const data = await res.json();
        const now = new Date().toLocaleTimeString('ar-EG');

        if (!cancelled) {
          if (data.success || data.egx30 || data.data) {
            setStatus({
              status: 'healthy',
              lastUpdate: now,
              message: 'النظام يعمل لحظياً',
            });
          } else {
            setStatus({
              status: 'stale',
              lastUpdate: now,
              message: 'تأخر في تدفق البيانات',
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus({
            status: 'error',
            lastUpdate: new Date().toLocaleTimeString('ar-EG'),
            message: 'خطأ في الاتصال',
          });
        }
      }
    };

    // فحص فوري
    checkHeartbeat();

    // فحص كل دقيقة
    const interval = setInterval(checkHeartbeat, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

/**
 * useWhaleAlerts - يجيب تنبيهات الحيتان من الـ API
 */
export function useWhaleAlerts() {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [newAlert, setNewAlert] = useState<WhaleAlert | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAlerts = async () => {
      try {
        const res = await fetch('/api/live-monitor/ledger', { cache: 'no-store' });
        if (!res.ok) return;

        const data = await res.json();
        if (cancelled || !data.success) return;

        // استخرج whale alerts من live_alerts
        const whaleAlerts = (data.live_alerts || [])
          .filter((a: any) => a.alert_type === 'LIVE_WHALE_BUY')
          .map((a: any) => ({
            id: `${a.ticker}-${a.timestamp}`,
            ticker: a.ticker,
            smc_score: 0, // سيتم تحديثه لو موجود في الرسالة
            price: 0,
            message: a.message,
            timestamp: a.timestamp,
          }));

        // لو فيه تنبيهات جديدة
        if (whaleAlerts.length > alerts.length && alerts.length >= 0) {
          const latest = whaleAlerts[0];
          if (latest && !alerts.find(a => a.id === latest.id)) {
            setNewAlert(latest);
          }
        }

        setAlerts(whaleAlerts.slice(0, 5)); // آخر 5
      } catch (err) {
        // silent
      }
    };

    // fetch فوري
    fetchAlerts();

    // fetch كل 5 دقايق
    const interval = setInterval(fetchAlerts, 300000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [alerts.length]);

  const clearNewAlert = useCallback(() => setNewAlert(null), []);

  return { alerts, newAlert, clearNewAlert };
}

/**
 * useLiveLedger - يجيب سجل التوقعات + Win Rate
 */
export function useLiveLedger() {
  const [ledger, setLedger] = useState<LiveLedger>({
    active_predictions: [],
    closed_predictions: [],
    win_rate: 0,
    total_signals: 0,
    wins: 0,
    losses: 0,
    live_alerts: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchLedger = async () => {
      try {
        const res = await fetch('/api/live-monitor/ledger', { cache: 'no-store' });
        if (!res.ok) return;

        const data = await res.json();
        if (cancelled || !data.success) return;

        setLedger({
          active_predictions: data.active_predictions || [],
          closed_predictions: data.closed_predictions || [],
          win_rate: data.win_rate || 0,
          total_signals: data.total_signals || 0,
          wins: data.wins || 0,
          losses: data.losses || 0,
          live_alerts: data.live_alerts || [],
        });
      } catch (err) {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // fetch فوري
    fetchLedger();

    // تحديث كل 5 دقايق (real-time PnL)
    const interval = setInterval(fetchLedger, 300000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { ledger, loading };
}

/**
 * useLivePrice - يجيب السعر الحالي للسهم (polling)
 */
export function useLivePrice(ticker: string | null) {
  const [price, setPrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        const res = await fetch(`/api/stocks/${ticker}?_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.price) {
          setPrice(parseFloat(data.price));
          setLastUpdate(new Date().toLocaleTimeString('ar-EG'));
        } else if (data.data?.price) {
          setPrice(parseFloat(data.data.price));
          setLastUpdate(new Date().toLocaleTimeString('ar-EG'));
        }
      } catch (err) {
        // silent
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 300000); // 5 minutes

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticker]);

  return { price, lastUpdate };
}

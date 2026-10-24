'use client';
import { useEffect, useRef } from 'react';
import { getMarketStatus } from '@/lib/market-hours';

interface PollingOptions {
  market?: string;
  allowOffMarket?: boolean;
}

/**
 * Smart Market & Visibility Aware Polling Hook
 * - Polls callback every intervalMs — ONLY when:
 *   1. The browser tab is visible (document.hidden === false).
 *   2. The target market session is currently OPEN (or llowOffMarket is true).
 * 
 * When the market closes or tab is hidden: clears the interval timer completely (0 network requests).
 * When the market opens or tab becomes visible again: fires callback immediately AND resumes interval ticks.
 */
export function useVisibilityAwarePolling(
  callback: () => void,
  intervalMs: number,
  deps: React.DependencyList = [],
  options: PollingOptions = {}
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const market = options.market || 'EGX';
  const allowOffMarket = options.allowOffMarket === true;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const shouldPoll = () => {
      if (document.hidden) return false;
      if (allowOffMarket) return true;
      const status = getMarketStatus(market);
      return status.isOpen;
    };

    const start = () => {
      if (timer) return;
      if (!shouldPoll()) return;

      // Fire immediately when polling condition becomes active
      cbRef.current();
      timer = setInterval(() => {
        if (shouldPoll()) {
          cbRef.current();
        } else {
          stop();
        }
      }, intervalMs);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const checkAndToggle = () => {
      if (shouldPoll()) {
        start();
      } else {
        stop();
      }
    };

    // Initial check
    checkAndToggle();

    const onVisibilityChange = () => {
      checkAndToggle();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Periodically re-check market status every 1 minute to detect market open/close transitions
    const marketCheckTimer = setInterval(() => {
      checkAndToggle();
    }, 60000);

    return () => {
      stop();
      clearInterval(marketCheckTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, market, allowOffMarket, ...deps]);
}

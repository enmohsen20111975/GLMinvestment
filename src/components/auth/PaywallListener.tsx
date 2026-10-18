'use client';

/**
 * PaywallListener — RESTRUCT-A-P3
 * ====================================================================
 * بيسمع window event `paywall:blocked` (اللي api-client بـ dispatchه عند 402/403)
 * + بيـ trigger الـ modal الصح بناءً على user state (guest/registered/trial).
 *
 * Routing (per API-CONTRACT-PAYWALL.md):
 *   - 403 insufficient_tier + guest       → LoginPromptModal (setShowLoginPrompt(true))
 *   - 403 insufficient_tier + registered  → LockModal (variant='upgrade')
 *   - 402 trial_expired + registered      → TrialExpiredModal (soft)
 *
 * الـ component بيـ render LockModal + TrialExpiredModal محليًا.
 * LoginPromptModal بيتـ render بواسطة AuthGate (store.showLoginPrompt).
 *
 * Rule 20: مفيش logic حسابي — الـ routing بـ resolvePaywallAction من subscription-gate.
 * Rule 27: مفيش أرقام وهمية.
 */
import React, { useEffect, useState } from 'react';
import { LockModal } from '@/components/auth/LockModal';
import { TrialExpiredModal } from '@/modules/subscription/components/TrialExpiredModal';
import { useAppStore } from '@/lib/store';
import {
  resolvePaywallAction,
  type PaywallAction,
} from '@/lib/subscription-gate';
import type { PaywallBlockedPayload } from '@/lib/api-client';

interface ActiveLock {
  feature?: string;
  requiredTier?: string;
}

export function PaywallListener() {
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setShowLoginPrompt = useAppStore((s) => s.setShowLoginPrompt);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const [activeLock, setActiveLock] = useState<ActiveLock | null>(null);
  const [showTrialSoft, setShowTrialSoft] = useState(false);

  useEffect(() => {
    const handler = (ev: Event) => {
      const payload = (ev as CustomEvent<PaywallBlockedPayload>).detail;
      if (!payload) return;

      const action: PaywallAction = resolvePaywallAction(
        payload.status,
        payload.errorBody,
        user,
        isAuthenticated,
        payload.url
      );

      switch (action.type) {
        case 'login_prompt':
          // guest → LoginPromptModal (بيتم إدارته بـ store عبر AuthGate)
          setShowLoginPrompt(true);
          break;
        case 'lock_upgrade':
          // registered → LockModal (upgrade)
          setActiveLock({
            feature: action.feature,
            requiredTier: action.requiredTier,
          });
          break;
        case 'trial_expired_soft':
          // registered + trial expired → soft TrialExpiredModal
          setShowTrialSoft(true);
          break;
        case 'none':
        default:
          // مفيش action — اتجاهل
          break;
      }
    };

    window.addEventListener('paywall:blocked', handler);
    return () => window.removeEventListener('paywall:blocked', handler);
  }, [user, isAuthenticated, setShowLoginPrompt]);

  const closeLock = () => setActiveLock(null);
  const goUpgrade = () => {
    setActiveLock(null);
    setCurrentView('subscription');
  };

  return (
    <>
      <LockModal
        open={activeLock !== null}
        onClose={closeLock}
        variant="upgrade"
        onUpgrade={goUpgrade}
        lockedItem={activeLock?.feature}
        requiredTier={activeLock?.requiredTier}
      />
      <TrialExpiredModal
        isExpired={showTrialSoft}
        onResolved={() => setShowTrialSoft(false)}
      />
    </>
  );
}

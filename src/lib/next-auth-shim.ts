'use client';

/**
 * next-auth shim for sandbox/development & client-side reactivity
 * =====================================================================
 * المشكلة: next-auth v4 بيستخدم CommonJS (require) اللي بيكسر Turbopack
 * في Next.js 16. الـ shim ده بيربط مباشرة مع Zustand Store (useAppStore)
 * بحيث أي مكون في الـ frontend يستدعي useSession() يحصل على حالة الـ session
 * الحقيقية والمحدثة فورًا (authenticated للمستخدم المسجل / unauthenticated للزائر).
 */

import React, { createContext, useContext } from 'react';
import { useAppStore } from '@/lib/store';

export interface Session {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    is_admin?: boolean;
    subscription_tier?: string | null;
    username?: string | null;
  };
  expires?: string;
}

interface SessionContextValue {
  data: Session | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  update: (data?: any) => Promise<Session | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const authChecked = useAppStore((s) => s.authChecked);

  let status: 'loading' | 'authenticated' | 'unauthenticated' = 'loading';
  let data: Session | null = null;

  if (isAuthenticated && user) {
    status = 'authenticated';
    data = {
      user: {
        id: user.id,
        name: user.username || user.name || user.email?.split('@')[0],
        email: user.email,
        image: (user as any).image || null,
        is_admin: user.is_admin,
        subscription_tier: user.subscription_tier,
        username: user.username,
      },
      expires: '2099-01-01',
    };
  } else if (authChecked) {
    status = 'unauthenticated';
  }

  const value = {
    data,
    status,
    update: async () => data,
  };

  return React.createElement(SessionContext.Provider, { value }, children);
}

export function useSession() {
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const authChecked = useAppStore((s) => s.authChecked);

  if (isAuthenticated && user) {
    return {
      data: {
        user: {
          id: user.id,
          name: user.username || user.name || user.email?.split('@')[0],
          email: user.email,
          image: (user as any).image || null,
          is_admin: user.is_admin,
          subscription_tier: user.subscription_tier,
          username: user.username,
        },
        expires: '2099-01-01',
      },
      status: 'authenticated' as const,
      update: async () => null,
    };
  }

  if (!authChecked) {
    return { data: null, status: 'loading' as const, update: async () => null };
  }

  return { data: null, status: 'unauthenticated' as const, update: async () => null };
}

export async function signIn(provider?: string, options?: any) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username_or_email: options?.username_or_email || options?.email || options?.username,
        password: options?.password,
      }),
    });
    const data = await res.json();
    if (res.ok && data?.success) {
      const token = data?.token as string | undefined;
      const user = data?.user;
      if (token && typeof window !== 'undefined') {
        try {
          localStorage.setItem('egx_api_key', token);
        } catch {
          // localStorage may be disabled in private mode
        }
      }
      if (user) {
        useAppStore.getState().setUser(user);
        useAppStore.getState().setAuthenticated(true);
        useAppStore.getState().setAuthChecked(true);
      }
      return { ok: true, error: null, token, user };
    }
    return { ok: false, error: data?.error || 'credentials' };
  } catch (e) {
    console.log('[next-auth-shim] signIn error', e);
    return { ok: false, error: 'network' };
  }
}

export async function signOut(options?: any) {
  try {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } catch {}
  useAppStore.getState().logout();
  if (typeof window !== 'undefined') {
    localStorage.removeItem('egx_api_key');
    if (options?.callbackUrl) {
      window.location.href = options.callbackUrl;
    }
  }
  return Promise.resolve(true);
}

export async function getSession() {
  const store = useAppStore.getState();
  if (store.isAuthenticated && store.user) {
    return {
      user: {
        id: store.user.id,
        name: store.user.username || store.user.name || store.user.email?.split('@')[0],
        email: store.user.email,
        image: (store.user as any).image || null,
        is_admin: store.user.is_admin,
        subscription_tier: store.user.subscription_tier,
        username: store.user.username,
      },
      expires: '2099-01-01',
    };
  }
  return null;
}

export async function getCsrfToken() {
  return null;
}

export async function getProviders() {
  return {};
}

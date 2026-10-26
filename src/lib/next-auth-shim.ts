/**
 * next-auth shim for sandbox/development
 * =====================================================================
 * المشكلة: next-auth v4 بيستخدم CommonJS (require) اللي بيكسر Turbopack
 * في Next.js 16. بما إن الـ sandbox مش فيه session حقيقي (API بترجع 404)،
 * بنعمل shim بسيط يرجّع session فارغ → الصفحة تفتح بدون ما تكسر.
 *
 * في production: استخدم next-auth/react الحقيقي.
 */

import React, { createContext, useContext } from 'react';

export interface Session {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires?: string;
}

interface SessionContextValue {
  data: Session | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  update: (data?: any) => Promise<Session | null>;
}

const SessionContext = createContext<SessionContextValue>({
  data: null,
  status: 'unauthenticated',
  update: async () => null,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(SessionContext.Provider, {
    value: { data: null, status: 'unauthenticated', update: async () => null },
  }, children);
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    return { data: null, status: 'unauthenticated' as const, update: async () => null };
  }
  return ctx;
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
      // FIX (2026-10-26): احفظ الـ token الحقيقي اللي رجعه /api/auth/login
      // في localStorage + الـ store، علشان useAuthCheck يقدر يبعت Authorization
      // header صحيح لـ /api/auth/me. قبل ده، الـ shim كان بيرجّع {ok: true} بدون
      // ما يحفظ الـ token → /api/auth/me بيرجع 401 → useAuthCheck بيطرد المستخدم
      // → redirect loop "سجّل تاني". ده الـ root cause لشكوى محسن.
      const token = data?.token as string | undefined;
      const user = data?.user;
      if (token && typeof window !== 'undefined') {
        try {
          localStorage.setItem('egx_api_key', token);
        } catch {
          // localStorage may be disabled (private mode) — non-fatal,
          // useAuthCheck will still get the token via the zustand store.
        }
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
  console.log('[next-auth-shim] signOut called');
  return Promise.resolve(true);
}

export async function getSession() {
  return null;
}

export async function getCsrfToken() {
  return null;
}

export async function getProviders() {
  return {};
}

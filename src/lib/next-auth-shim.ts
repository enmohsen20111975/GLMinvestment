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
  return useContext(SessionContext);
}

export async function signIn(provider?: string, options?: any) {
  console.log('[next-auth-shim] signIn called', provider);
  return Promise.resolve(false);
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

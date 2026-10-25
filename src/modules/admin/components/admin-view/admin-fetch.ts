/**
 * admin-view/admin-fetch.ts
 * =========================
 * Module-scoped helpers for admin API authentication.
 *
 * Originally inlined at the top of AdminView.tsx (lines 247-318) before the
 * component. Pure module — no React, no JSX, no hooks. Imported only by
 * the useAdminState hook.
 *
 * Flow:
 * 1. Try plain `fetch(url, { credentials: 'same-origin' })` — works if
 *    the admin_session httpOnly cookie is already set.
 * 2. On 401/403, try POST `/api/admin/auth/auto-cookie` to auto-set the
 *    cookie (helps Google-logged-in admins).
 * 3. If auto-cookie succeeded, retry the original request.
 * 4. If still failing, fall back to `getAdminToken()` from the legacy
 *    localStorage flow and re-send with `X-Admin-Token` header.
 */

import { getAdminToken } from '@/lib/admin-auth';

// محاولة ضبط admin_session cookie عن طريق auto-cookie endpoint
let _autoCookieAttempted = false;
let _autoCookiePromise: Promise<boolean> | null = null;

async function tryAutoCookie(): Promise<boolean> {
 if (!_autoCookiePromise) {
 _autoCookiePromise = fetch('/api/admin/auth/auto-cookie', {
 method: 'POST',
 credentials: 'same-origin',
 })
 .then(res => {
 if (res.ok) {
 _autoCookieAttempted = true;
 return true;
 }
 // لو فشلت (مش أدمن أو مش مسجل)، متحاولش تاني
 _autoCookieAttempted = true;
 return false;
 })
 .catch(() => {
 // لو network error، حاول تاني بعدين (مش بنحط _autoCookieAttempted = true)
 _autoCookiePromise = null;
 return false;
 });
 }

 return _autoCookiePromise;
}

export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
 // الخطوة 1: جرب الطلب الأول مع credentials: 'same-origin' (عشان الـ httpOnly cookie تترسل)
 // لو الـ admin_session cookie موجودة (اتضبطت من login أو auto-cookie)،
 // requireAdminAsync هتستخدمها مباشرة
 const res = await fetch(url, {
 ...options,
 credentials: 'same-origin',
 });

 // لو نجح أو فشل بسبب مشكلة مش مصادقة، رجّع النتيجة
 if (res.status !== 401 && res.status !== 403) {
 return res;
 }

 // الخطوة 2: لو رجع 401/403، حاول نضبط auto-cookie الأول
 // (ده بيفيد لو المستخدم مسجل بـ Google بس مفيش admin_session cookie)
 const cookieSet = await tryAutoCookie();

 if (cookieSet) {
 // الـ cookie اتضبطت، جرب الطلب تاني
 return fetch(url, {
 ...options,
 credentials: 'same-origin',
 });
 }

 // الخطوة 3: لو auto-cookie فشلت، جرب نجيب token من /api/admin/auth/token
 // (ده بيفيد لو المستخدم عامل login من form)
 const token = await getAdminToken();
 if (!token) {
 return res; // رجّع الـ 401/403 الأصلي
 }

 // الخطوة 4: أعد الطلب مع X-Admin-Token header
 const headers = new Headers(options.headers);
 headers.set('X-Admin-Token', token);
 if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
 headers.set('Content-Type', 'application/json');
 }
 return fetch(url, { ...options, headers, credentials: 'same-origin' });
}

'use client';

/* ============================================================
   ROBO-ADVISOR-P2: Robo-Notifier — التنبيهات الحية + الصوت
   ============================================================
   - بيراقب /api/unified/predictions كل 60 ثانية
   - لما يطلع إشارة شراء/بيع قوية جديدة → Web Notification + Beep
   - لما سهم في التتبع يوصل للهدف أو الوقف → Notification + Beep
   - بيستخدم Notification API + Web Audio API (playAlertSound)
   - بيفتّش إذن الإشعارات من المستخدم
   ============================================================ */

import { playAlertSound } from '@/lib/alert-sound';

const STORAGE_KEY = 'robo_notifier_seen';
const ENABLED_KEY = 'robo_notifier_enabled';
const POLL_INTERVAL_MS = 30_000; // 30 ثانية — تقرير المالك: التحديث اللحظي لازم يكون أسرع
const STRONG_SIGNALS = new Set(['STRONG_BUY', 'STRONG_SELL', 'BUY', 'SELL']);

interface SeenPrediction {
  ticker: string;
  signal: string;
  status: string;
  target_price?: number | null;
  stop_loss?: number | null;
  entry_price: number;
  first_seen: number;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let enabled: boolean | null = null;

/** قرأ التوقعات اللي شفناها قبل كده من localStorage */
function loadSeen(): Record<string, SeenPrediction> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { // silent fallback (safe-by-design)
    return {};
  }
}

/** حفظ التوقعات اللي شفناها */
function saveSeen(seen: Record<string, SeenPrediction>): void {
  if (typeof window === 'undefined') return;
  try {
    // احتفظ بآخر 50 توقع بس عشان الـ storage ما يكبرش
    const entries = Object.entries(seen).slice(-50);
    const trimmed: Record<string, SeenPrediction> = {};
    for (const [k, v] of entries) trimmed[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { // silent fallback (safe-by-design)
    // ignore quota errors
  }
}

/** اطلب إذن الإشعارات من المتصفح (مع timeout عشان ما يهنجش) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    // timeout 3 ثواني عشان الـ requestPermission ممكن يهنج في بعض المتصفحات
    const result = await Promise.race([
      Notification.requestPermission(),
      new Promise<NotificationPermission>((resolve) => setTimeout(() => resolve('default'), 3000)),
    ]);
    return result === 'granted';
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

/** سجّل الـ service worker لدعم الإشعارات في الخلفية */
export async function registerRoboSW(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch { // silent fallback (safe-by-design)
    // الـ SW اختياري — الإشعارات بتشتغل من غيره كمان
  }
}

/** اعرض إشعار + شغّل صوت تنبيه */
function fireNotification(title: string, body: string, direction: 'up' | 'down' | 'neutral'): void {
  // الإشعار
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const icon = '/icon-192.png';
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, { body, icon, tag: 'robo-advisor', renotify: true, badge: icon }).catch(() => {
            new Notification(title, { body, icon });
          });
        });
      } else {
        new Notification(title, { body, icon });
      }
    } catch { // silent fallback (safe-by-design)
      // ignore
    }
  }
  // الصوت
  try {
    playAlertSound(direction);
  } catch { // silent fallback (safe-by-design)
    // ignore
  }
}

/** افحص التوقعات الجديدة والمغلقة وأطلق الإشعارات */
function processPredictions(active: any[], previous: any[]): void {
  const seen = loadSeen();
  const now = Date.now();
  let changed = false;

  // 1. توقعات نشطة جديدة (إشارات قوية لم نرها قبل ذلك)
  for (const p of active) {
    const ticker = p.ticker || p.symbol;
    if (!ticker) continue;
    const sig = String(p.signal || '').toUpperCase();
    const key = `active:${ticker}`;
    const prev = seen[key];

    if (!prev && STRONG_SIGNALS.has(sig)) {
      // توقع جديد قوي → إشعار
      const isBuy = sig.includes('BUY') || sig === 'ACCUMULATE';
      const dir: 'up' | 'down' = isBuy ? 'up' : 'down';
      const emoji = isBuy ? '🚨' : '🔻';
      const action = isBuy ? 'فرصة شراء' : 'إشارة بيع';
      const price = Number(p.entry_price || p.current_price || 0).toFixed(2);
      const target = p.target_price ? Number(p.target_price).toFixed(2) : '—';
      fireNotification(
        `${emoji} ${action}: ${ticker}`,
        `السعر ${price} — الهدف ${target} — الثقة ${Math.round(p.confidence || 0)}%`,
        dir
      );
      seen[key] = { ticker, signal: sig, status: 'PENDING', target_price: p.target_price, stop_loss: p.stop_loss, entry_price: Number(p.entry_price || 0), first_seen: now };
      changed = true;
    } else if (prev) {
      // توقع موجود قبل كده — اتغيرت حالته؟
      // (الـ active بتفضل pending عادة، بس نحدّث القيم)
      seen[key] = { ...prev, signal: sig, target_price: p.target_price, stop_loss: p.stop_loss };
      changed = true;
    }
  }

  // 2. توقعات سابقة وصلت للهدف أو ضربت الوقف (من الأرشيف)
  for (const p of previous) {
    const ticker = p.ticker || p.symbol;
    if (!ticker) continue;
    const status = String(p.status || '').toUpperCase();
    const key = `prev:${ticker}:${status}`;
    if (seen[key]) continue; // أبلغنا عنه قبل كده

    if (status === 'TARGET_HIT') {
      const ret = p.actual_return != null ? `${p.actual_return >= 0 ? '+' : ''}${Number(p.actual_return).toFixed(1)}%` : '';
      fireNotification(
        `✅ السهم ${ticker} وصل للهدف`,
        `احقق أرباحك — العائد ${ret}`,
        'up'
      );
      seen[key] = { ticker, signal: p.signal || '', status, entry_price: Number(p.entry_price || 0), first_seen: now };
      changed = true;
    } else if (status === 'STOPPED') {
      const ret = p.actual_return != null ? `${Number(p.actual_return).toFixed(1)}%` : '';
      fireNotification(
        `❌ السهم ${ticker} ضرب وقف الخسارة`,
        `العائد ${ret} — راجع الموقف`,
        'down'
      );
      seen[key] = { ticker, signal: p.signal || '', status, entry_price: Number(p.entry_price || 0), first_seen: now };
      changed = true;
    }
  }

  if (changed) saveSeen(seen);
}

/** جلب التوقعات من الـ API */
async function fetchPredictions(): Promise<{ active: any[]; previous: any[] } | null> {
  try {
    const _market = typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem('egx_current_market') || '"EGX"')
      : 'EGX';
    const res = await fetch(`/api/unified/predictions?market=${_market}&limit=20&_t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      active: Array.isArray(data.active_predictions || data.predictions) ? (data.active_predictions || data.predictions) : [],
      previous: Array.isArray(data.previous_predictions) ? data.previous_predictions : [],
    };
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

/** دورة المراقبة */
async function pollOnce(): Promise<void> {
  const data = await fetchPredictions();
  if (data) processPredictions(data.active, data.previous);
}

/** شغّل الـ Robo-Notifier */
export function startRoboNotifier(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ENABLED_KEY, '1');
  } catch { /* safe-by-design */ }
  enabled = true;
  // سجّل الـ SW
  registerRoboSW();
  // أول دورة فوراً (بس من غير إشعارات للتوقعات اللي موجودة بالفعل — بس ندهن الـ seen)
  fetchPredictions().then((data) => {
    if (!data) return;
    const seen = loadSeen();
    const now = Date.now();
    for (const p of data.active) {
      const t = p.ticker || p.symbol;
      if (t) seen[`active:${t}`] = { ticker: t, signal: p.signal || '', status: 'PENDING', target_price: p.target_price, stop_loss: p.stop_loss, entry_price: Number(p.entry_price || 0), first_seen: now };
    }
    for (const p of data.previous) {
      const t = p.ticker || p.symbol;
      const st = p.status || '';
      if (t) seen[`prev:${t}:${st}`] = { ticker: t, signal: p.signal || '', status: st, entry_price: Number(p.entry_price || 0), first_seen: now };
    }
    saveSeen(seen);
    // شغّل الـ polling
    pollOnce();
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  });
}

/** وقّف الـ Robo-Notifier */
export function stopRoboNotifier(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(ENABLED_KEY, '0');
    } catch { /* safe-by-design */ }
  }
  enabled = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** هل الـ Notifier شغّال؟ */
export function isRoboNotifierRunning(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem(ENABLED_KEY);
    if (saved === '0') return false;
    return true; // افتراضياً مفعّل للمستخدمين
  } catch { // silent fallback (safe-by-design)
    return true;
  }
}

/** امسح الـ seen cache (للـ testing/reset) */
export function resetRoboSeen(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

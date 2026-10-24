'use client';

/* ============================================================
 P20-CENTRAL-ALERTS: Central Alert Monitor (الجرس المركزي)
 ============================================================
 - Mounts GLOBALLY in AppShell → runs on every page (not just chart)
 - Polls /api/sniper/scan?limit=5 every 5 minutes (Rule 67 — was 60s, caused
 server overload with 100+ concurrent users; see POLL_INTERVAL_MS)
 - ONLY polls when the RoboNotifier toggle is ON (listens to the
 `robo-notifier-toggle` custom event + polls isRoboNotifierRunning()
 as a safety net, so it never misses a toggle).
 - DEBOUNCE (anti-spam): keeps a per-ticker "last signal" map in a ref
 + localStorage. A sound/toast fires ONLY when:
 * a NEW ticker appears with a strong signal, OR
 * an EXISTING ticker's signal CHANGES to a strong signal.
 The same STRONG_BUY appearing every minute → NO repeat sound.
 - First poll after enabling = "seeding" pass: marks everything
 currently in the scan as already-seen (no alert storm on enable).
 - On fire: playAlertSound(direction) + sonner toast with stock info.
 - Returns null — pure background component, no UI.
 ============================================================ */

import { useEffect } from 'react';
import { toast } from 'sonner';
import { playAlertSound } from '@/lib/alert-sound';
import { isRoboNotifierRunning } from '@/lib/robo-notifier';
import { dispatchWhatsAppAlert } from '@/lib/native-notifications';

// Rule 67 (Phase 0 — stability): sniper scan عملية ثقيلة على الـ DB (join بين
// sniper_opportunities + stocks + predictions). كل 60 ثانية كانت بتصنع 100× اللازم
// مع 100 مستخدم متزامن. 5 دقائق interval معقول لخلفية الـ scan — محرك التنبيهات
// الرئيسي بيرصّ أي فرصة جديدة في user_notifications على الـ server cron على كل حال،
// فالـ bell هيرنّ بشكل مستقل.
const POLL_INTERVAL_MS = 5 * 60_000; // 5 دقائق
const SCAN_ENDPOINT = '/api/sniper/scan?limit=5';
const SEEN_KEY = 'central_alert_seen_v1';
const SAFETY_CHECK_MS = 3_000; // فحص الـ toggle كل 3 ثواني كـ safety net

// إشارات "قوية" تستاهل التنبيه (مفيش تنبيه على HOLD/NEUTRAL)
const STRONG_SIGNALS = new Set<string>([
 'STRONG_BUY',
 'STRONG_SELL',
 'BUY',
 'SELL',
]);

interface ScanResult {
 ticker?: string;
 symbol?: string;
 signal?: string;
 signal_ar?: string;
 entry_price?: number | null;
 current_price?: number | null;
 target_price?: number | null;
 stop_loss?: number | null;
 confidence?: number | null;
 status?: string;
 name_ar?: string | null;
}

interface SeenEntry {
 signal: string;
 firstSeen: number;
}

/* ---------- helpers ---------- */

function getTicker(r: ScanResult): string {
 return String(r.ticker || r.symbol || '').toUpperCase();
}

function normalizeSignal(sig: unknown): string {
 return String(sig || '').toUpperCase().trim();
}

function loadSeen(): Record<string, SeenEntry> {
 if (typeof window === 'undefined') return {};
 try {
 const raw = localStorage.getItem(SEEN_KEY);
 return raw ? (JSON.parse(raw) as Record<string, SeenEntry>) : {};
 } catch {
 return {};
 }
}

function saveSeen(seen: Record<string, SeenEntry>): void {
 if (typeof window === 'undefined') return;
 try {
 // احتفظ بآخر 80 سهم بس عشان الـ storage ما يكبرش
 const entries = Object.entries(seen).slice(-80);
 const trimmed: Record<string, SeenEntry> = {};
 for (const [k, v] of entries) trimmed[k] = v;
 localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
 } catch {
 // ignore quota errors
 }
}

function pickDirection(signal: string): 'up' | 'down' | 'neutral' {
 if (signal.includes('BUY')) return 'up';
 if (signal.includes('SELL')) return 'down';
 return 'neutral';
}

function pickEmoji(signal: string): string {
 switch (signal) {
 case 'STRONG_BUY':
 return '🔥';
 case 'BUY':
 return '📈';
 case 'STRONG_SELL':
 return '🔻';
 case 'SELL':
 return '⚠️';
 default:
 return '🔔';
 }
}

function pickLabelAr(signal: string, signalAr?: string): string {
 if (signalAr) return signalAr;
 switch (signal) {
 case 'STRONG_BUY':
 return 'فرصة شراء قوية';
 case 'BUY':
 return 'فرصة شراء';
 case 'STRONG_SELL':
 return 'إشارة بيع قوية';
 case 'SELL':
 return 'إشارة بيع';
 default:
 return 'إشارة جديدة';
 }
}

function fmt(n: number | null | undefined): string {
 if (n == null || Number.isNaN(n)) return '—';
 return Number(n).toFixed(2);
}

/** استخرج قائمة النتائج من أي شكل محتمل للـ response */
function extractResults(data: unknown): ScanResult[] {
 if (!data || typeof data !== 'object') return [];
 const d = data as Record<string, unknown>;
 const candidates: unknown[] = [];
 if (Array.isArray(d.results)) candidates.push(...d.results);
 if (Array.isArray(d.predictions)) candidates.push(...d.predictions);
 if (Array.isArray(d.opportunities)) candidates.push(...d.opportunities);
 if (
 d.data &&
 typeof d.data === 'object' &&
 Array.isArray((d.data as Record<string, unknown>).results)
 ) {
 candidates.push(...((d.data as Record<string, unknown>).results as unknown[]));
 }
 return candidates.filter(
 (x): x is ScanResult => !!x && typeof x === 'object',
 );
}

/* ---------- component ---------- */

export function CentralAlertMonitor() {
 useEffect(() => {
 // كل الـ state جوه الـ effect — مفيش stale closures
 const seen: Record<string, SeenEntry> = loadSeen();
 let seeding = true; // أول poll بعد التفعيل = seeding (مفيش alerts)
 let timer: ReturnType<typeof setInterval> | null = null;

 const pollOnce = async (): Promise<void> => {
 try {
 const res = await fetch(`${SCAN_ENDPOINT}&_t=${Date.now()}`, {
 cache: 'no-store',
 });
 if (!res.ok) return;
 const data = await res.json();
 const results = extractResults(data);
 if (!results.length) return;

 const now = Date.now();
 let changed = false;

 if (seeding) {
 // Seeding pass: علّم كل اللي موجود دلوقتي كـ "seen" بدون alerts
 // عشان منعملش alert storm أول ما المستخدم يفعّل التنبيهات
 for (const r of results) {
 const t = getTicker(r);
 if (!t) continue;
 seen[t] = {
 signal: normalizeSignal(r.signal),
 firstSeen: now,
 };
 }
 changed = true;
 seeding = false;
 } else {
 // Poll عادي: اطلع alerts بس للإشارات الجديدة أو المتغيرة
 for (const r of results) {
 const t = getTicker(r);
 if (!t) continue;
 const sig = normalizeSignal(r.signal);
 if (!STRONG_SIGNALS.has(sig)) continue;

 const prev = seen[t];
 if (!prev || prev.signal !== sig) {
 // سهم جديد أو إشارته اتغيرت → شغّل alert
 const dir = pickDirection(sig);
 const emoji = pickEmoji(sig);
 const label = pickLabelAr(sig, r.signal_ar);
 const price = fmt(r.entry_price ?? r.current_price);
 const target =
 r.target_price != null ? fmt(r.target_price) : '—';

 // إطلاق إشعار الواتساب / فيسبوك + تنبيه سطح المكتب للمتصفح المصغر
 dispatchWhatsAppAlert({
 title: `${label}: ${t}`,
 message: `السعر ${price} — الهدف ${target}`,
 ticker: t,
 type: sig.includes('SELL') ? 'radar_exit_signal' : 'radar_opportunity',
 severity: sig.includes('SELL') ? 'warning' : 'success',
 });

 seen[t] = { signal: sig, firstSeen: now };
 changed = true;
 }
 }
 }

 if (changed) saveSeen(seen);
 } catch {
 // silent — network/parse errors لازم ما تكسرش الـ monitor
 }
 };

 const startPolling = (): void => {
 if (timer) return; // شغال بالفعل
 seeding = true; // كل (re)start يبدأ بـ seeding pass
 pollOnce();
 timer = setInterval(pollOnce, POLL_INTERVAL_MS);
 };

 const stopPolling = (): void => {
 if (timer) {
 clearInterval(timer);
 timer = null;
 }
 };

 // 1. الحالة الابتدائية — لو التنبيهات متفعّلة قبل mount
 if (isRoboNotifierRunning()) startPolling();

 // 2. استمع لـ toggle events من RoboNotifierToggle
 const handler = (e: Event): void => {
 const detail = (e as CustomEvent).detail as
 | { enabled?: boolean }
 | undefined;
 const next = detail?.enabled ?? isRoboNotifierRunning();
 if (next) startPolling();
 else stopPolling();
 };
 window.addEventListener('robo-notifier-toggle', handler);

 // 3. Safety net: افحص الـ flag كل 3 ثواني (لو الـ event فات)
 const safety = setInterval((): void => {
 const running = isRoboNotifierRunning();
 if (running && !timer) startPolling();
 else if (!running && timer) stopPolling();
 }, SAFETY_CHECK_MS);

 return () => {
 window.removeEventListener('robo-notifier-toggle', handler);
 clearInterval(safety);
 stopPolling();
 };
 }, []);

 // مفيش UI — Component خلفي بحت
 return null;
}

/**
 * WebSocket Mini-Service — خدمة التحديثات اللحظية (P19-REAL-TIME-SYNC)
 * ====================================================================
 *
 * P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS:
 *   - Hyper Polling: وقت الجلسة (10:00 → 14:30 Cairo) بـ poll كل 2 ثانية.
 *     خارج الجلسة بـ poll كل 30 ثانية (لا حاجة للـ live updates).
 *   - /broadcast POST endpoint: الـ Python data_engine/sync.py يبعتله
 *     الأسعار الجديدة بعد كل sync عشان يـ pushها فوراً للمشتركين من غير
 *     ما يستنى الـ poll الجاي.
 *   - Live Score poll بفضل كل 5 ثواني وقت الجلسة (بدل 5 دقايق).
 *
 * P41-DELAYED-DATA-MODE (HOW_WE_ANALYZE v10 / PROJECT_DISSECTION):
 *   لو DELAYED_DATA_MINUTES>0 (مثلاً 5)، الـ Live Score polling بيتحول لـ
 *   15 دقيقة (900_000ms) بدل 5 ثواني. السبب: لو الـ data متأخرة 5 دقايق،
 *   الـ polling كل 5 ثواني بيبعت نفس الـ data 60 مرة متكررة — مفيش قيمة
 *   قرارية، بس بيرهق الـ CPU والـ clients بإشارات متأخرة كاذبة. الـ 15 دقيقة
 *   بتيجي من إن شمعة الـ 15M هي الإطار الزمني اللي الـ Live Engine بيتعامل
 *   معاه في وضع التأخير.
 *
 * الأحداث (events) اللي بيبتثها (matching ws-client.ts):
 *   - market:update      — تحديث جماعي لأسعار الأسهم
 *   - market:snapshot    — لقطة كاملة للسوق
 *   - market:status      — حالة السوق (مفتوح/مقفل + gainers/losers)
 *   - stock:alert        — تنبيه لسهم معين (ارتفاع/انخفاض)
 *   - ticker:update      — تحديث لسهم واحد (Hyper Polling: 2s وقت الجلسة)
 *   - ticker:live        — تحديث Live Score/مؤشرات (5s وقت الجلسة، أو 15min لو DELAYED_DATA_MINUTES>0)
 *
 * الأحداث اللي بيستقبلها من العميل:
 *   - subscribe:ticker   — اشتراك في سهم معين
 *   - unsubscribe:ticker — إلغاء اشتراك
 *   - getMarketOverview  — طلب لحظة سوقية
 *
 * البيانات بتيجي من Python backend (port 8010) عبر polling + broadcast push.
 */

import { createServer, IncomingMessage } from 'http';
import { Server } from 'socket.io';
// P19-HOTFIX: شيلنا `import { setInterval, clearTimeout } from 'timers'` —
// clearTimeout و setTimeout دول globals في Node.js و Bun، ومفيش حاجة بتستخدم
// setInterval دلوقتي (بنستخدم setTimeout متكرر للـ adaptive polling). الـ import
// كان dead code وممكن يسبب confusion للـ bundler.

const PORT = 3005;
const PYTHON_BACKEND = process.env.VPS_API_URL || 'http://localhost:8010';

// ─── P41-DELAYED-DATA-MODE: Delayed Data Configuration ───────────────────
// لو الـ data_engine بيوصل بـ price data متأخر (DELAYED_DATA_MINUTES=5)، مفيش
// فايدة من polling كل 5 ثواني — الـ data مش هتتغير في الـ 5 ثواني دي أصلاً.
// فبنـ switch لـ polling كل 15 دقيقة (900_000ms) عشان:
//   1. نقلل استهلاك الـ CPU بنسبة 99% (من 12 calls/min لـ ~0.07 calls/min)
//   2. نمنع إغراق المستخدم بإشارات لحظية متأخرة بـ 5 دقايق (مفيش قيمة قرارية)
//   3. الـ Live Engine نفسه بـ delayed_mode بيلغي الـ breakout signals، فالـ
//      polling السريع مفيش فايدة منه
const DELAYED_DATA_MINUTES = (() => {
  const raw = process.env.DELAYED_DATA_MINUTES;
  const parsed = parseInt(raw || '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();
const IS_DELAYED_MODE = DELAYED_DATA_MINUTES > 0;

// ─── P19: Hyper Polling intervals ───
// وقت الجلسة (10:00 → 14:30 Cairo): poll كل 2 ثانية (Hyper Polling).
// خارج الجلسة: poll كل 30 ثانية (لا حاجة لـ live updates).
const SESSION_POLL_INTERVAL_MS = 2_000;     // 2 ثواني — وقت الجلسة
const OFFSESSION_POLL_INTERVAL_MS = 30_000; // 30 ثانية — خارج الجلسة

// Live Score polling (P19): كل 5 ثواني وقت الجلسة (بدل 5 دقايق).
// P41-DELAYED-DATA-MODE: لو الـ data متأخرة 5 دقايق، نقلل الـ polling لـ 15 دقيقة
// عشان الـ data مش هتتغير في الـ 5 ثواني دي أصلاً، والـ polling السريع بيرهق السيرفر.
const SESSION_LIVE_SCORE_INTERVAL_MS = IS_DELAYED_MODE
  ? 15 * 60 * 1000   // 15 دقيقة — وضع التأخير (P41)
  : 5_000;           // 5 ثواني — وضع live الحقيقي (P19)
const OFFSESSION_LIVE_SCORE_INTERVAL_MS = 300_000; // 5 دقايق خارج الجلسة

// PAYWALL-043: Throttling للمجانيين
const PREMIUM_TICKER_INTERVAL_MS = 5_000;
const FREE_TICKER_INTERVAL_MS = 15_000;

// ─── EGX Session Hours (Africa/Cairo) ───
// EGX بيشغل: الأحد → الخميس، 10:00 → 14:30 (cairo time).
// أيام الأسبوع: Sunday=0, Monday=1, ..., Saturday=6 (JS standard).
// EGX أيام التداول: Sun(0), Mon(1), Tue(2), Wed(3), Thu(4).
const EGX_TRADING_DAYS = [0, 1, 2, 3, 4]; // Sun..Thu
const EGX_SESSION_START_MIN = 10 * 60;    // 10:00 = 600
const EGX_SESSION_END_MIN = 14 * 60 + 30; // 14:30 = 870

/**
 * P19: اتشيك هل جلسة EGX فاتحة دلوقتي (بتوقيت القاهرة).
 * Node.js ما عندهوش native tz support، بس Intl.DateTimeFormat بيدعم
 * `timeZone: 'Africa/Cairo'` وبيـ format الوقت في الـ tz دي.
 */
function isEgxSessionOpen(): boolean {
  try {
    const now = new Date();
    // استخدم Intl عشان نحصل على يوم + ساعة/دقيقة بتوقيت القاهرة
    const cairoParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekdayStr = cairoParts.find((p) => p.type === 'weekday')?.value || '';
    const hourStr = cairoParts.find((p) => p.type === 'hour')?.value || '0';
    const minuteStr = cairoParts.find((p) => p.type === 'minute')?.value || '0';

    // weekday: Sun, Mon, Tue, Wed, Thu, Fri, Sat
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = weekdayMap[weekdayStr];
    if (weekday === undefined || !EGX_TRADING_DAYS.includes(weekday)) {
      return false;
    }

    const hour = parseInt(hourStr, 10) || 0;
    const minute = parseInt(minuteStr, 10) || 0;
    const currentMin = hour * 60 + minute;
    return currentMin >= EGX_SESSION_START_MIN && currentMin <= EGX_SESSION_END_MIN;
  } catch {
    // fallback: اعتبر الجلسة مقفولة (مش بنعمل hyper polling)
    return false;
  }
}

/** رجّع الـ polling interval المناسب حسب حالة الجلسة. */
function getCurrentPollInterval(): number {
  return isEgxSessionOpen() ? SESSION_POLL_INTERVAL_MS : OFFSESSION_POLL_INTERVAL_MS;
}
function getCurrentLiveScoreInterval(): number {
  return isEgxSessionOpen() ? SESSION_LIVE_SCORE_INTERVAL_MS : OFFSESSION_LIVE_SCORE_INTERVAL_MS;
}

// ─── State ───
let lastMarketSnapshot: any[] = [];
let lastMarketStatus: any = null;
const tickerSubscribers = new Map<string, Set<string>>(); // ticker -> socket ids

// P19: آخر سعر لكل ticker — عشان نـ detect التغيرات ونـ push بس لما يتغير.
const lastTickerPrices = new Map<string, number>();

// ─── HTTP Server + Socket.io ───
const httpServer = createServer((req, res) => {
  // Health endpoint
  if (req.url === '/health' || req.url === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'WebSocket Service يعمل (P19-REAL-TIME-SYNC)',
      timestamp: new Date().toISOString(),
      port: PORT,
      egx_session_open: isEgxSessionOpen(),
      poll_interval_ms: getCurrentPollInterval(),
      live_score_interval_ms: getCurrentLiveScoreInterval(),
      // P41-DELAYED-DATA-MODE
      delayed_data_minutes: DELAYED_DATA_MINUTES,
      delayed_mode: IS_DELAYED_MODE,
      connected_clients: io.engine.clientsCount,
      last_snapshot_count: lastMarketSnapshot.length,
      has_market_status: !!lastMarketStatus,
    }));
    return;
  }

  // ─── P19: /broadcast POST endpoint ───
  // الـ Python data_engine/sync.py يبعت POST /broadcast بـ body:
  //   { event: 'prices_synced', timestamp: '...', updates: [{ticker, ...}] }
  // الـ service بيـ emit 'ticker:update' لكل update فيه.
  if (req.url === '/broadcast' && req.method === 'POST') {
    handleBroadcast(req, res);
    return;
  }

  // Socket.io handles everything else (engine.io, socket.io paths)
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Helpers ───
async function fetchJson(url: string, timeoutMs = 8000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** P19: قراءة body من POST request بأمان (size-limited). */
function readRequestBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytesReceived = 0;
    req.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** P19: عالج POST /broadcast اللي بيبعته الـ Python data_engine/sync.py. */
async function handleBroadcast(req: IncomingMessage, res: any) {
  try {
    const bodyText = await readRequestBody(req);
    const payload = JSON.parse(bodyText);

    if (!payload || !Array.isArray(payload.updates)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'updates array required' }));
      return;
    }

    let pushed = 0;
    let alerts = 0;
    for (const update of payload.updates) {
      if (!update || !update.ticker) continue;
      const ticker = String(update.ticker).toUpperCase();

      // لو الـ price اتغير عن آخر قيمة → emit للمشتركين
      const newPrice = Number(update.current_price || 0);
      const oldPrice = lastTickerPrices.get(ticker);
      if (newPrice > 0 && oldPrice !== newPrice) {
        lastTickerPrices.set(ticker, newPrice);

        const updatePayload = {
          ticker,
          name_ar: update.name_ar || ticker,
          current_price: newPrice,
          previous_price: Number(update.previous_close || 0),
          price_change: Number(update.price_change || 0),
          volume: Number(update.volume || 0),
          timestamp: update.timestamp || new Date().toISOString(),
        };

        // emit لكل المشتركين في السهم ده
        // P19-HOTFIX: snapshot الـ socket IDs عشان نتجنب race condition
        const subs = tickerSubscribers.get(ticker);
        if (subs && subs.size > 0) {
          const subsSnapshot = Array.from(subs);
          for (const socketId of subsSnapshot) {
            try { io.to(socketId).emit('ticker:update', updatePayload); } catch (_) {}
          }
          pushed++;
        }

        // تنبيه لو الحركة > 3%
        if (Math.abs(updatePayload.price_change) >= 3) {
          const alert = {
            ticker: updatePayload.ticker,
            name_ar: updatePayload.name_ar,
            price: updatePayload.current_price,
            change: updatePayload.price_change,
            direction: updatePayload.price_change > 0 ? 'up' : ('down' as 'up' | 'down'),
            timestamp: updatePayload.timestamp,
          };
          if (subs) {
            const subsSnapshot = Array.from(subs);
            for (const socketId of subsSnapshot) {
              try { io.to(socketId).emit('stock:alert', alert); } catch (_) {}
            }
            alerts++;
          }
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      received: payload.updates.length,
      pushed,
      alerts,
      timestamp: new Date().toISOString(),
    }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: String(err.message || err) }));
  }
}

// ─── Polling: يجيب بيانات السوق من Python backend ───
// P19: الـ interval بيتغير حسب حالة الجلسة (2s وقت الجلسة، 30s خارجها).
async function pollMarketData() {
  // 1) جلب قائمة الأسهم (snapshot)
  const stocksData = await fetchJson(
    `${PYTHON_BACKEND}/api/stocks?market=EGX&limit=100`,
  );
  if (stocksData && Array.isArray((stocksData.data || stocksData.stocks)) && (stocksData.data || stocksData.stocks).length > 0) {
    lastMarketSnapshot = (stocksData.data || stocksData.stocks).map((s: any) => ({
      ticker: s.ticker || s.symbol,
      name_ar: s.name_ar || s.name || '',
      current_price: Number(s.current_price || s.price || 0),
      previous_price: Number(s.previous_close || 0),
      price_change: Number(s.change_percent || 0),
      volume: Number(s.volume || 0),
    }));
    io.emit('market:snapshot', {
      stocks: lastMarketSnapshot,
      timestamp: new Date().toISOString(),
    });
  }

  // 2) جلب حالة السوق
  const statusData = await fetchJson(`${PYTHON_BACKEND}/api/market/status`);
  if (statusData && statusData.status) {
    lastMarketStatus = {
      status: statusData.status,
      is_open: statusData.is_open ?? false,
      stocks: lastMarketSnapshot,
      gainers_count: statusData.gainers_count ?? 0,
      losers_count: statusData.losers_count ?? 0,
      unchanged_count: statusData.unchanged_count ?? 0,
      total_volume: statusData.total_volume ?? 0,
      timestamp: new Date().toISOString(),
    };
    io.emit('market:status', lastMarketStatus);
  }

  // 3) تحديثات الأسهم المُشتترك فيها (سعر فقط)
  // P19: وقت الجلسة بنـ poll كل ticker مشترك فيه عشان نجيب آخر سعر.
  // خارج الجلسة الـ interval بيبقى 30 ثانية فمش محتاجين hyper polling.
  // P19-HOTFIX: بنـ snapshot الـ entries في array الأول عشان نتجنب race condition
  // لو subscriber اتضاف/اتشال أثناء الـ iteration (Map modification during iteration).
  const tickerEntries = Array.from(tickerSubscribers.entries());
  for (const [ticker, socketIds] of tickerEntries) {
    if (!socketIds || socketIds.size === 0) continue;
    try {
      // Fetch stock price data
      const tickerData = await fetchJson(
        `${PYTHON_BACKEND}/api/stocks/${ticker}`,
        5000,
      );
      if (tickerData && tickerData.current_price != null) {
        const newPrice = Number(tickerData.current_price || 0);
        const oldPrice = lastTickerPrices.get(ticker);

        // P19: emit بس لو السعر اتغير (عشان ما نـ spamش الـ client بإشارات مكررة)
        if (newPrice > 0 && oldPrice !== newPrice) {
          lastTickerPrices.set(ticker, newPrice);
          const update = {
            ticker,
            name_ar: tickerData.name_ar || tickerData.name || '',
            current_price: newPrice,
            previous_price: Number(tickerData.previous_close || 0),
            price_change: Number(tickerData.change_percent || 0),
            volume: Number(tickerData.volume || 0),
          };
          // P19-HOTFIX: snapshot socket IDs (set might change during emit)
          const socketIdsSnapshot = Array.from(socketIds);
          for (const socketId of socketIdsSnapshot) {
            try { io.to(socketId).emit('ticker:update', update); } catch (_) {}
          }
          // تنبيه لو الحركة > 3%
          if (Math.abs(update.price_change) >= 3) {
            const alert = {
              ticker: update.ticker,
              name_ar: update.name_ar,
              price: update.current_price,
              change: update.price_change,
              direction: update.price_change > 0 ? 'up' : ('down' as 'up' | 'down'),
              timestamp: new Date().toISOString(),
            };
            for (const socketId of socketIdsSnapshot) {
              try { io.to(socketId).emit('stock:alert', alert); } catch (_) {}
            }
          }
        }
      }
    } catch (e) {
      // P19-HOTFIX: لو ticker واحد فشل → كمّل للباقي، ما تـ crashش
      console.error(`[WS] pollMarketData: ticker ${ticker} error:`, (e as Error).message);
    }
  }
}

// ─── Polling: يجيب Live Score والمؤشرات (P19: 5s وقت الجلسة) ───
async function pollLiveScores() {
  // P19: خارج الجلسة مش محتاجين live score polling
  if (!isEgxSessionOpen()) {
    return;
  }

  // P19-HOTFIX: snapshot الـ entries عشان نتجنب race condition
  const tickerEntries = Array.from(tickerSubscribers.entries());
  for (const [ticker, socketIds] of tickerEntries) {
    if (!socketIds || socketIds.size === 0) continue;

    try {
      // P19: الـ endpoint ده كان ناقص! دلوقتي موجود في public_routes.py.
      const liveData = await fetchJson(
        `${PYTHON_BACKEND}/api/live/analysis/${ticker}`,
        8000,
      );
      if (liveData && liveData.success) {
        const liveUpdate = {
          ticker,
          // P41-DELAYED-DATA-MODE: مرّر الـ mode الحقيقي من الـ engine
          // (LIVE أو DELAYED_LIVE) + كل الـ delayed flags للـ Frontend
          mode: liveData.mode || 'LIVE',
          delayed_mode: liveData.delayed_mode || false,
          delayed_minutes: liveData.delayed_minutes || 0,
          breakout_vetoed: liveData.breakout_vetoed || false,
          daily_change_pct: liveData.daily_change_pct || 0,
          golden_pullback_boost: liveData.golden_pullback_boost || 0,
          score: liveData.score,
          signal: liveData.signal,
          signal_ar: liveData.signal_ar,
          live_rsi: liveData.live_rsi,
          live_macd_hist: liveData.live_macd_hist,
          volume_ratio: liveData.volume_ratio,
          candlestick: liveData.candlestick,
          breakdown: liveData.breakdown,
          today_candle: liveData.today_candle,
          is_dead_cat: liveData.is_dead_cat,
          is_golden_pullback: liveData.is_golden_pullback,
          is_bullish_divergence: liveData.is_bullish_divergence,
          is_trap: liveData.is_trap,
          is_low_liquidity: liveData.is_low_liquidity,
          reason: liveData.reason,
          db_last_updated: liveData.db_last_updated,
          timestamp: new Date().toISOString(),
        };
        // P19-HOTFIX: snapshot socket IDs
        const socketIdsSnapshot = Array.from(socketIds);
        for (const socketId of socketIdsSnapshot) {
          try { io.to(socketId).emit('ticker:live', liveUpdate); } catch (_) {}
        }
        // تنبيه لو الإشارة تغيرت لـ BUY
        if (liveData.signal === 'BUY' && liveData.score >= 75) {
          const alert = {
            ticker,
            name_ar: ticker,
            price: liveData.today_candle?.close || 0,
            change: liveData.score,
            direction: 'up' as 'up' | 'down',
            message: `🔥 ${ticker} LIVE Score=${liveData.score} — ${liveData.signal_ar}`,
            timestamp: new Date().toISOString(),
          };
          for (const socketId of socketIdsSnapshot) {
            try { io.to(socketId).emit('stock:alert', alert); } catch (_) {}
          }
        }
      }
    } catch (e) {
      // P19-HOTFIX: لو ticker واحد فشل → كمّل للباقي
      console.error(`[WS] pollLiveScores: ticker ${ticker} error:`, (e as Error).message);
    }
  }
}

// ─── Connection handler ───
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id} (total: ${io.engine.clientsCount})`);

  // إرسال لقطة فورية للعميل الجديد
  if (lastMarketSnapshot.length > 0) {
    socket.emit('market:snapshot', {
      stocks: lastMarketSnapshot,
      timestamp: new Date().toISOString(),
    });
  }
  if (lastMarketStatus) {
    socket.emit('market:status', lastMarketStatus);
  }

  // subscribe:ticker
  socket.on('subscribe:ticker', (data: string | { ticker: string; premium?: boolean }) => {
    let t = '';
    let isPremium = false;
    if (typeof data === 'string') {
      t = data.toUpperCase();
    } else if (data && typeof data === 'object') {
      t = (data.ticker || '').toUpperCase();
      isPremium = !!data.premium;
    }
    if (!t) return;
    if (!tickerSubscribers.has(t)) {
      tickerSubscribers.set(t, new Set());
    }
    tickerSubscribers.get(t)!.add(socket.id);
    socket.join(`ticker:${t}`);
    (socket as any)._isPremium = isPremium;
    console.log(`[WS] ${socket.id} subscribed to ${t} (premium: ${isPremium})`);
  });

  socket.on('unsubscribe:ticker', (ticker: string) => {
    const t = (ticker || '').toUpperCase();
    const subs = tickerSubscribers.get(t);
    if (subs) {
      subs.delete(socket.id);
      if (subs.size === 0) tickerSubscribers.delete(t);
    }
    socket.leave(`ticker:${t}`);
  });

  socket.on('getMarketOverview', (callback: (data: any) => void) => {
    if (typeof callback === 'function') {
      callback(lastMarketStatus);
    }
  });

  socket.on('disconnect', (reason: string) => {
    for (const [ticker, socketIds] of tickerSubscribers.entries()) {
      socketIds.delete(socket.id);
      if (socketIds.size === 0) tickerSubscribers.delete(ticker);
    }
    console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error: Error) => {
    console.error(`[WS] Socket error (${socket.id}):`, error.message);
  });
});

// ─── P19: Adaptive Polling Scheduler ───
// بدل setInterval ثابت، بنستخدم setTimeout متكرر بيقرا الـ interval الحالي
// في كل مرة — كده لو الجلسة فتحت/قفلت، الـ polling بيتكيف فوراً.
let marketPollTimer: NodeJS.Timeout | null = null;
let liveScorePollTimer: NodeJS.Timeout | null = null;

function scheduleNextMarketPoll() {
  const interval = getCurrentPollInterval();
  marketPollTimer = setTimeout(async () => {
    try {
      await pollMarketData();
    } catch (e) {
      console.error('[WS] Poll error:', e);
    }
    scheduleNextMarketPoll(); // schedule next — recursive
  }, interval);
}

function scheduleNextLiveScorePoll() {
  const interval = getCurrentLiveScoreInterval();
  liveScorePollTimer = setTimeout(async () => {
    try {
      await pollLiveScores();
    } catch (e) {
      console.error('[WS] Live score poll error:', e);
    }
    scheduleNextLiveScorePoll();
  }, interval);
}

// ─── Start ───
httpServer.listen(PORT, () => {
  const sessionOpen = isEgxSessionOpen();
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║  WebSocket Mini-Service — P19-REAL-TIME-SYNC    ║`);
  console.log(`║  Port: ${PORT}                                       ║`);
  console.log(`║  Backend: ${PYTHON_BACKEND.padEnd(35).slice(0, 35)}║`);
  console.log(`║  EGX Session: ${sessionOpen ? 'OPEN' : 'CLOSED'}                              ║`);
  console.log(`║  Price Poll: ${sessionOpen ? '2s (Hyper)' : '30s'}                          ║`);
  if (IS_DELAYED_MODE) {
    console.log(`║  Live Score Poll: 15min (DELAYED ${DELAYED_DATA_MINUTES}m)      P41         ║`);
  } else {
    console.log(`║  Live Score Poll: ${sessionOpen ? '5s' : '5min'}                       ║`);
  }
  console.log(`║  /broadcast endpoint: ✅ (Python push)           ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  // أول poll فوراً، ثم schedule المتكرر
  pollMarketData().catch((e) => console.error('[WS] Initial poll error:', e));
  pollLiveScores().catch((e) => console.error('[WS] Initial live score error:', e));
  scheduleNextMarketPoll();
  scheduleNextLiveScorePoll();
});

// ─── P19-HOTFIX: Process-level safety nets ───
// لو أي uncaught exception حصلت (race condition, null ref, etc.) → سجّلها
// ومتكريش، بدل ما الـ service تـ crash وترجع 500 للـ clients.
process.on('uncaughtException', (err: Error) => {
  console.error('[WS] ⚠️ uncaughtException (caught, not crashing):', err.message);
  console.error(err.stack || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[WS] ⚠️ unhandledRejection (caught, not crashing):', String(reason));
});

// ─── Graceful shutdown ───
process.on('SIGTERM', () => {
  console.log('[WS] SIGTERM received, shutting down...');
  if (marketPollTimer) clearTimeout(marketPollTimer);
  if (liveScorePollTimer) clearTimeout(liveScorePollTimer);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
});

process.on('SIGINT', () => {
  console.log('[WS] SIGINT received, shutting down...');
  if (marketPollTimer) clearTimeout(marketPollTimer);
  if (liveScorePollTimer) clearTimeout(liveScorePollTimer);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
});

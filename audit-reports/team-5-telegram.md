# Team 5: Telegram + Bot Audit

**Task ID**: TEAM-5-TELEGRAM
**Auditor**: Telegram automation specialist (general-purpose)
**Scope**: Telegram publishing, bot, automation quality and effectiveness
**Date**: 2026-10-09
**Approach**: Pure research — read all production Python + TS files. No code modifications.

---

## 1. Code Inventory

### 1.1 Python telegram modules (`vps-service/telegram/`)

Total: 16 files, ~11,619 LOC of Python.

| File | LOC | Role |
|------|-----|------|
| `auto_poster.py` | 965 | Channel publisher — Telethon-based `TelegramAutoPoster` class + format helpers. Sends `send_message` / `send_photo` to the configured channel. |
| `auto_post_scheduler.py` | 1,831 | **Continuous 5-min polling scheduler.** Triggers 9 distinct post types (daily, weekly, monthly, daily_opportunities, tomorrow_picks, daily_summary, weekly_summary, monthly_summary, morning_bell) + target_hit_tracker loop. |
| `telegram_interactive_bot.py` | 1,418 | Long-polling interactive bot. Stock picker, radar command, daily lessons, subscription gate, inline keyboard buttons. |
| `telegram_client.py` | 1,257 | Canonical Telethon client (user-account session) for **bi-directional** messaging — receives channel messages, processes via AI, can reply/forward. |
| `telegram_target_hit_tracker.py` | 1,068 | Real-time monitor of TP1/TP2 hits during EGX session (10:00–14:35). Generates Playwright 1080×1080 PNG card + HTML caption. |
| `liquidity_alerts.py` | 830 | Four alert types: sector flow IN/OUT, stock accumulation/distribution. Deduped daily via `db/liquidity_alerts_state.json`. |
| `telegram_daily_lessons.py` | 509 | Curriculum of 30 educational lessons. Generates Playwright image + caption. Manual `--now` / `--lesson N` / `--preview`. |
| `telegram_bot_api.py` | 498 | **Retry-aware HTTP Bot API client** (429 flood control + 5xx retries + chunked sends). Most robust sender — but only used by news-agent + a few callers. |
| `telegram_notifier.py` | 434 | Outbound-only notifier (HTTP Bot API). Used by `daily_closer.py` + `telegram_routes.py`. |
| `telegram_report_card.py` | 458 | Generates Playwright image cards for daily/weekly reports. |
| `ai_processor.py` | 452 | Inbound message classifier (recommendation / news / discussion) + symbol extractor. |
| `database.py` | 414 | SQLite store for `tracked_channels`, `telegram_messages`, `extracted_recommendations`. |
| `telegram_chart_generator.py` | 531 | Generates per-ticker candlestick PNG charts for the interactive bot. |
| `telegram_branding.py` | 365 | Official links, QR SVG, inline-button factory, Telethon Button normalizer. |
| `egx_arabic_lookup.py` | 159 | Arabic-name lookup table for EGX tickers. |
| `__init__.py` | 14 | Re-exports `telegram_db`, `ai_processor`, `telegram_service`. |

### 1.2 TypeScript publishing modules

| Path | LOC | Role |
|------|-----|------|
| `src/modules/publishing/components/StockInfographicCard.tsx` | 1,027 | Unified infographic card (1080×1080). |
| `src/modules/publishing/components/StockPublisher.tsx` | 1,128 | Publisher modal — admin posts a stock card to Telegram. |
| `src/modules/publishing/components/UnifiedPublishButton.tsx` | 793 | Single share button → multiple channels. |
| `src/modules/publishing/components/TradeResultsTemplates.tsx` | 1,456 | Templates for trade-results graphics. |
| `src/modules/publishing/components/TradeResultsGenerator.tsx` | 541 | Trade-results image generator. |
| `src/modules/publishing/components/ShareButton.tsx` | 449 | Generic share button (uses `withOfficialLinks`). |
| `src/modules/publishing/components/StockInfographicModal.tsx` | 334 | Modal preview before publish. |
| `src/modules/publishing/lib/stock-publish-text.ts` | 487 | Canonical Arabic share-text generator. |
| `src/modules/publishing/lib/table-share-formatter.ts` | 371 | Stock-detail + market-summary share text. |
| `src/modules/publishing/lib/official-links.ts` | 52 | Single source of `OFFICIAL_LINKS` + `OFFICIAL_LINKS_BLOCK` (with disclaimer). |
| `src/components/publishing/UserPublishingView.tsx` | 739 | User-facing publishing UI. |
| `src/components/publishing/QuickPublishButton.tsx` | 335 | Quick-publish button. |
| `src/modules/admin/components/TelegramPredictionsTab.tsx` | 512 | Admin: shows published/pending predictions + preview-before-publish AlertDialog. |

### 1.3 API routes (Next.js)

- `POST /api/telegram/publish-stock` — admin-only, accepts FormData (image+caption) OR JSON, calls Telegram Bot API `sendPhoto` → fallback `sendMessage`, writes audit trail (`published_at`, `telegram_message_id`, `was_published`) back to `predictions.db`.
- `POST /api/telegram/post` — proxy to Python `:8010/api/telegram/post/*` (message/recommendation/daily-summary/etc.).
- `POST /api/telegram/send-daily-report` — proxy to Python notifier.
- `GET  /api/telegram/[...path]` — catch-all proxy.
- `GET  /api/admin/telegram-predictions` — admin audit dashboard data.

### 1.4 Python REST routes (`vps-service/api/telegram_routes.py`, 1,861 LOC)

52 Flask endpoints under `/api/telegram/*`:
- Status / health (`/status`, `/health`)
- Morning Bell preview + test (`/morning-bell/preview`, `/morning-bell/test`)
- Auth (connect-user, send-code, verify-code, verify-password, status)
- Channels (tracked, my, track, untrack)
- AI (classify, extract-symbols, process, status, clean)
- Posting (connect, message, recommendation, daily-summary, top-recommendations, alert, market-open, market-close, custom)
- Dialogs + chat history
- Group member management
- Notification tests (target-hit, approaching-target, stop-warning, trailing-profit, stop-loss)
- Live monitor (`/notifications/live-monitor`)

### 1.5 PM2 services (`ecosystem.config.js`)

| Service | Script | Interpreter | Restart |
|---------|--------|-------------|---------|
| `python-backend` | `vps-service/main.py` | `.venv/bin/python` | autorestart, 500M |
| `telegram-poster` | `vps-service/telegram/auto_post_scheduler.py` | `.venv/bin/python` (fallback `python3`) | autorestart, 300M |
| `telegram-interactive-bot` | `vps-service/telegram/telegram_interactive_bot.py` | `.venv/bin/python` (fallback `python3`) | autorestart, 300M |
| `telegram-events` | `telegram-events/index.ts` (port 3003) | Bun | autorestart, 150M |

The `telegram-events` Bun service is a socket.io relay that polls `:8010/api/telegram/events/poll` every 2 seconds and broadcasts to admin `TelegramTab.tsx`.

### 1.6 Cron jobs (`crontab.txt`)

| Schedule | Job | Telegram integration |
|----------|-----|---------------------|
| `0 6 * * 0` | `scripts/weekly_radar_report.py --send-telegram` | Weekly PDF+PNG+JSON → Telegram channel |
| `*/5 8-12 * * 0-4` | `vps-service/jobs/intraday_scanner.py --limit 5` | Calls `run_liquidity_alerts()` every 5 min |
| `30 14 * * 0-4` | `scripts/telegram_comprehensive_report.py --send` | Daily comprehensive report |
| `0 14 * * 0-4` | `vps-service/jobs/daily_closer.py` | Calls `TelegramNotifier.notify_target_hit/trailing_profit/stop_loss` |

---

## 2. Publishing Flow

### 2.1 Scheduling logic

`auto_post_scheduler.py:run_scheduler()` runs as a daemon loop (`while running[0]`) with `asyncio.sleep(300)` (5 min) between checks. Each tick:

1. Loads state from `auto_post_state.json`.
2. For each `should_run_*` predicate, fires the corresponding `post_*` coroutine.
3. Updates state (`last_daily`, `last_weekly`, `last_monthly`, `last_tomorrow_picks`, `last_daily_summary`, `last_weekly_summary`, `last_monthly_summary`, `last_morning_bell`) + `posts_count` + last 20 errors.
4. Calls `run_target_hit_tracker` if EGX session is live (10:00–14:35 Cairo, Sun–Thu).

**Time windows** (Africa/Cairo via `get_egypt_time()`):
- Tomorrow Picks: 08:30 ± 4 min, working days only, holidays skipped
- Daily Summary: 16:00 ± 4 min, working days
- Weekly Summary: Friday 09:00 ± 4 min
- Monthly Summary: 1st of month 10:00 ± 4 min
- Morning Bell: 09:45 ± 4 min, working days, holidays skipped
- Daily Predictions: 15:00 hour-sharp, working days
- Weekly Radar Report: Sunday 10:00 hour-sharp (with radar fallback chain)
- Monthly Report: 1st 10:00 hour-sharp

The ±4-min window is explicitly documented as compensating for the 5-min polling cadence ("a tight ±1 window can be missed"). Good defensive engineering.

### 2.2 Triggers

- **Time-based**: All 8 scheduled post types.
- **Event-based**: Target-hit tracker fires when `high_price >= TP1` or `>= TP2` during live session.
- **HTTP-triggered**: Admin can POST to `/api/telegram/post/*` to publish on demand (`message`, `recommendation`, `daily-summary`, `top-recommendations`, `alert`, `market-open`, `market-close`, `custom`).
- **CLI-triggered**: `python3 auto_post_scheduler.py --now daily|weekly|monthly|tomorrow_picks|daily_summary|weekly_summary|monthly_summary|morning_bell` publishes immediately + updates state.

### 2.3 Content published

| Post type | Source | Template function |
|-----------|--------|-------------------|
| Daily predictions | `MarketDailyReport.generate_daily_report()` | `_format_daily_post()` |
| Weekly report | `MarketDailyReport.generate_weekly_report()` | `_format_weekly_post()` |
| Weekly radar | `subprocess.run(scripts/weekly_radar_report.py)` | (inside script) |
| Monthly report | `MarketDailyReport.generate_monthly_report()` | `_format_monthly_post()` |
| Daily opportunities | `analyzers.maestro_orchestrator.daily_opportunities(limit=5)` | `_format_daily_opportunities_post()` (HTML) |
| Tomorrow picks | `ReportsEngine.generate_tomorrow_picks()` | (engine-built text) |
| Daily summary | `ReportsEngine.generate_daily_summary()` | (engine-built text) |
| Weekly summary | `ReportsEngine.generate_weekly_summary()` | (engine-built text) |
| Monthly summary | `ReportsEngine.generate_monthly_summary()` | (engine-built text) |
| Morning bell | `api.stored_analysis_routes._get_morning_bell_data(limit=3)` | `_format_morning_bell_post()` |
| Target hit | `predictions.db` + `stocks.db` cross-check | `format_hit_caption()` |
| Stock alert (HTTP) | caller-supplied dict | `format_stock_alert()` |
| Stock recommendation (HTTP) | caller-supplied dict | `format_recommendation_post()` |
| Market open/close | boilerplate | `format_market_open()` / `format_market_close()` |
| Daily lessons (HTTP via bot) | 30-lesson curriculum | `telegram_daily_lessons.format_telegram_lesson_caption()` |
| Liquidity alerts | `FlowSystemEngine` + `maker_radar_EGX_*.json` + `exit_radar_*.json` | `_format_sector_alert()` / `_format_stock_accumulation()` / `_format_stock_distribution()` |

### 2.4 Post template quality

**Strengths**:
- Every template ends with the `LEGAL_DISCLAIMER` constant (`⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.`) added during AUDIT-PUBLISH-QUALITY.
- Every template ends with `COMMUNITY_PROMPT` + `OFFICIAL_LINKS` block (website, radar, chart, bot, whatsapp, android, telegram).
- Hashtags: `#البورصة_المصرية #توقعات_يومية #EGX #الاستثمار #تداول #مصر`.
- `_fmt_price()` helper returns `'—'` instead of leaking `'0.00'` when source value is `None` / `NaN` / out-of-range.
- `_fmt_pct()` for percentages follows the same rule.
- R/R<1.0 filter (`format_recommendation_post` returns `None` to drop bad predictions entirely) — Phase 8.1.
- Multi-target levels (`tp1`, `tp2`, `sl`, `s1`, `s2`, `r1`, `r2`) only rendered when entry > 0; otherwise skipped with safe placeholder.
- Expert analysis section (`_fetch_expert_analysis`) makes HTTP call to `/api/stocks/[ticker]/expert-analysis` and renders RSI/MA/ROE/PE/EPS/dividend/risk — 5s timeout, fails silently.

**Weaknesses**:
- `format_market_open()` / `format_market_close()` / `format_stock_alert()` are essentially boilerplate — they print a fixed emoji banner + 4 links + disclaimer + hashtag. No market-context data (e.g., yesterday's close, EGX30 level, market regime). The "open" message says "💡 تابعونا للحصول على" — generic CTA.
- `_format_monthly_post()` lacks Arabic names for `best_performers` / `worst_performers` — only ticker + percent.
- `_format_daily_post()` always appends `day_name` from `target_session.day` but if upstream forgot to set it, the line "الجلسة القادمة: " shows blank.
- `format_recommendation_post()` calls `_fetch_expert_analysis` synchronously inside the formatter — if the Node API is slow, formatting blocks the publish path (5s timeout per ticker × 5 tickers = 25s worst case). Should be parallelized or cached.
- Daily-opportunities post mixes Markdown bold syntax (`**bold**`) into HTML body (`<b>...</b>`) inconsistently — it uses `<b>` correctly but auto_poster.py uses `**bold**` Markdown. **Both posts land in the same channel** but with different parse_modes.

---

## 3. Bot Analysis

### 3.1 Available commands

The interactive bot (`telegram_interactive_bot.py`) is a long-polling bot using HTTP Bot API (`requests.get(getUpdates)`). Recognized commands:

| Command / Trigger | Handler | Notes |
|-------------------|---------|-------|
| `/start [param]` | `handle_start()` | Subscription gate + deep-link stock analysis if `start_param` is a ticker. |
| `/help` | (alias for /start) | **No dedicated help text** — falls through to `_send_full_welcome`. |
| `/list`, `قائمة الاسهم`, `الاسهم` | `send_stock_picker_menu()` | Inline keyboard of 12 popular stocks. |
| `/radar`, `الرادار`, `🚀 أسهم الانفجار السعري`, `انفجار` | `handle_radar_command()` | 5 candidates from `predictions.db` (STRONG_BUY/BUY/ACCUMULATE). |
| `/lesson`, `الدروس`, `درس اليوم`, `📚 درس اليوم التعليمي` | `handle_daily_lesson_command()` | Rotating lesson from 30-lesson curriculum. |
| `🌐 منصة التحليل المباشر`, `المنصة`, `الموقع` | (inline response) | No gate — always returns platform URL. |
| Any free-text stock query | `search_stock()` → `send_stock_analysis_response()` | Searches Arabic-alias table + `stocks.db` + `data_engine.db`. |

The `MAIN_MENU_KEYBOARD` is a persistent reply keyboard with 5 buttons:
1. 🔍 فحص سهم من القائمة
2. 🎯 رادار الميكرز اليوم
3. 🚀 أسهم الانفجار السعري
4. 📚 درس اليوم التعليمي
5. 🌐 منصة التحليل المباشر

### 3.2 Inline keyboards + callback queries

`process_update()` handles both `callback_query` and `message` updates. Callback schema:
- `stock:TICKER` → fetch stock + send card with chart image
- `action:show_stock_menu` → re-open stock picker
- `action:show_radar_picks` → re-open radar command

`answer_callback_query()` is called immediately to dismiss the loading spinner (good). But the callback body is not validated against the user's subscription state *before* answering — only `process_update` re-checks `check_subscription(chat_id)` after the answer ack. Acceptable but could be tightened.

### 3.3 Stock search

`search_stock(query)`:
1. Direct match in `ARABIC_ALIASES` (237 entries — exhaustive, includes common misspellings like `السويدى` vs `السويدي`).
2. Substring match (longest-first) — handles `"حديد عز"` → `ESRS`.
3. Falls back to `stocks.db` exact ticker match → `LIKE %query%` on `ticker` / `name_ar` / `name`.
4. Falls back to `data_engine.db` `stock_prices` table.

Returns a unified dict: `{symbol, name_ar, name_en, price, change, open, high, low, volume, market: 'EGX'}`. Hardcoded `market='EGX'` — **multi-market search is not supported by the bot** (TADAWUL/KSE/QSE stocks exist in stocks.db but the bot can't find them).

### 3.4 Stock card (`build_stock_card`)

A complete trading card with:
- Subscription badge (`👑 مشترك VIP` or `⏳ فترة تجريبية (متبقي N أيام)`)
- Current price + change% with 🟢/🔴 icon
- Buy zone (entry_min → entry_max) with warning "لا تطارد السعر"
- TP1 + TP2 (TP2 locked for trial users — `🔒 [محجوب — متاح لمشتركي باقات VIP فقط]`)
- Stop loss with loss %
- R:R ratio (1:X)
- Support/resistance map (د1/د2/م1/م2)
- Radar V40.2 status (signal, confidence, direction)
- Expert analysis section (RSI/MA trend/ROE/PE/EPS/dividend/risk — pulled live from Node API)
- Legal disclaimer
- For trial users: daily-limit usage footer (`تم استخدام X/5 استعلامات اليوم`)

Inline keyboard buttons (VIP):
1. 📊 فتح الشارت الحي | 🎯 رادار الميكرز
2. 🔍 فحص سهم آخر | 🌐 منصة التحليل المباشر

Inline keyboard buttons (Trial):
1. 💎 فتح الهدف الثاني واشتراك VIP
2. 🔍 فحص سهم آخر | 🎯 رادار الميكرز
3. 🌐 ترقية باقتك على المنصة

### 3.5 Subscription gating

`check_subscription(chat_id)`:

1. **Admin bypass** (Rule 50 + Rule 72): If `chat_id ∈ ADMIN_TELEGRAM_IDS` (env-var CSV) → returns `{is_paid: True, tier: 'admin', days_left: 999}` immediately. No DB lookup.
2. **Fail-closed** (Task SECURITY-P0): If `BOT_API_SECRET` env var is empty → returns `{linked: False, is_paid: False, _fail_closed: True}`. Previously was fail-open (granted VIP to anyone if the gate was unreachable).
3. HTTP GET to `/api/bot/check-subscription?chat_id=N` with `X-Bot-Secret` header. 4-second timeout.
4. Fallback to direct `auth.db` query if HTTP fails: looks up `user_telegram_links` for `telegram_chat_id`, then `User` table for `subscription_tier` + `trial_ends_at`. Trial window = 7 days from `created_at` (or `trial_ends_at` if set).
5. Returns `_error: 'gate_offline'` if both HTTP + SQLite fail.

Access-state taxonomy (`get_user_access_status`):
- `paid` (is_paid=True) → unlimited queries
- `trial_active` (linked + trial not expired) → 5 queries/day, TP2 locked
- `trial_expired` (linked + trial expired) → bot fully locked
- `not_linked` (never linked) → invite to register
- `error` (gate offline) → friendly "try again later"

### 3.6 Error handling

- `send_message()` / `send_photo()` use `try/except` + log warning; never raise.
- Long-polling loop catches all exceptions and sleeps 5s before retry.
- Stale messages (>30 min old) are skipped to avoid replay floods.
- `check_subscription` HTTP call has 4s timeout — slow but bounded.
- `_fetch_bot_expert_analysis` has 5s timeout + blanket `except Exception → return "—"`. Silent fallback.
- `generate_stock_chart_image` failure logs warning + falls back to text-only message.

**Weaknesses**:
- **No FloodWait handling** in `send_message` / `send_photo` — if Telegram returns 429, the bot just logs + sleeps 5s and tries the next getUpdates. No retry of the actual send.
- **No backoff** in `run_polling()` — `time.sleep(5)` is fixed.
- **In-memory daily limit counter** `_daily_query_counts` resets on every bot restart. A trial user can effectively bypass the 5-query limit by simply waiting for the next PM2 restart.
- **Counter dict auto-clear** after 5000 entries (`if len(_daily_query_counts) > 5000: _daily_query_counts.clear()`) — clears ALL users' counters under load, not just old ones.

---

## 4. Message Quality

### 4.1 Parse mode inconsistency

This is the most glaring issue:

| Sender | parse_mode | Style used in templates |
|--------|-----------|------------------------|
| `auto_poster.py` (channel) | `'md'` | `**bold**`, `_italic_`, `` `code` `` |
| `auto_post_scheduler.py` (channel) | `'md'` for most | `**bold**`, `` `code` `` |
| `_format_daily_opportunities_post` (channel) | `'HTML'` | `<b>bold</b>`, `<code>` |
| `telegram_notifier.py` (channel alerts) | `'HTML'` | `<b>bold</b>` |
| `telegram_target_hit_tracker.py` (channel) | `'HTML'` | `<b>bold</b>` |
| `liquidity_alerts.py` (channel) | `'HTML'` (via notifier) | `<b>bold</b>` |
| `telegram_interactive_bot.py` (bot DM) | `'HTML'` | `<b>bold</b>`, `<code>` |

**Impact**: A subscriber sees the same `COMI` card rendered with Markdown bold (`**COMI**` literally shows as `*COMI*` or `COMI`) in channel recommendations, but HTML bold (`<b>COMI</b>` → `COMI`) in daily opportunities. Telegram's MarkdownV2 has strict escaping rules (`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!` all need `\` prefix) that are NOT applied. The current `'md'` parse_mode is actually the legacy mode, which is more forgiving but deprecated.

### 4.2 Emojis

Emojis are used consistently across all templates:
- 🟢/🟡/🟠/🔴 for BUY/HOLD/REDUCE/SELL (canonical_signal_ar mapping)
- 📊 📈 📉 🎯 🛑 🚀 💰 💎 ⚖️ 🏦 🌐 📱 ✈️ 💬 📘 🤖
- 🐋 for stock accumulation (whale), 🔥 for surges, ❄️ for declines
- Celebration tiers in `notify_target_hit`: 🎉 for ≥5%, 🎉🏆 for ≥10%, 🎉🎊🏆 for ≥20%

Usage is professional and not overwhelming.

### 4.3 Arabic rendering

All Arabic strings are written in proper MSA (Modern Standard Arabic). RTL is implicit (Telegram renders Arabic RTL automatically). The only LTR mixing is for tickers, prices, and Latin URLs — these are wrapped in `<code>...</code>` (HTML) or `` `...` `` (md) where appropriate.

The bot's `MAIN_MENU_KEYBOARD` uses native Arabic button labels with emoji prefixes — proper RTL display.

### 4.4 Links + CTAs

Every channel post ends with the official links block:

```
━━━━━━━━━━━━━━━━━━━
🌐 الموقع: https://invist.m2y.net
📊 رادار السيولة والتوصيات: https://invist.m2y.net/#recommendations
📈 شارت التحليل الفني: https://invist.m2y.net/#trading-chart
🤖 بوت التحليل الذكي: https://t.me/investusernamebot
💬 تواصل معنا واتساب: https://chat.whatsapp.com/...
📱 تطبيق أندرويد: https://play.google.com/...
✈️ قناة تليجرام: https://t.me/Arabian_investment_guide
━━━━━━━━━━━━━━━━━━━
```

Every channel post also has Telethon inline buttons attached via `normalize_telethon_buttons(buttons, ticker=ticker)` — 3 rows: website+bot, radar+chart, filters+whatsapp. The `auto_poster.send_message` falls back to sending without buttons if Telethon rejects the button payload (good defensive coding).

The interactive bot's stock card has its own custom inline keyboard (different from channel — includes `callback_data` for navigation, not just URL buttons).

### 4.5 Disclaimer

✅ **Present everywhere** after AUDIT-PUBLISH-QUALITY (2026-10-08):

- `auto_poster.py`: `LEGAL_DISCLAIMER` constant appended to all 5 format methods.
- `auto_post_scheduler.py`: `LEGAL_DISCLAIMER` constant (slightly different wording: `⚠️ *تحليل كمي بالذكاء الاصطناعي — إدارة رأس المال مسؤوليتك أولاً*`).
- `telegram_interactive_bot.py`: hardcoded in `build_stock_card` footer.
- `telegram_notifier.py`: **Missing disclaimer** on `notify_target_hit`, `notify_approaching_target`, `notify_stop_warning`, `notify_trailing_profit`, `notify_stop_loss`, `notify_daily_report`, `notify_weekly_report`. The worklog notes this as a known gap: "لو العميل طلب إضافة disclaimer لكل رسالة notifier، ده يتعمل في task منفصل."
- `liquidity_alerts.py`: no disclaimer (sector/stock alerts) — should add.
- `telegram_daily_lessons.py`: caption includes a generic note but no legal disclaimer.
- `official-links.ts` (TS): `OFFICIAL_LINKS_BLOCK` includes disclaimer, auto-appended via `withOfficialLinks()` to every shared text.

---

## 5. Automation Quality

### 5.1 Scheduling logic

- **PM2 manages** all 3 Python services (`python-backend`, `telegram-poster`, `telegram-interactive-bot`) with `autorestart: true`, `max_restarts: 10`, `restart_delay: 5000ms`, `max_memory_restart: 300M`.
- **Cron** runs `weekly_radar_report.py --send-telegram` (Sunday 06:00 UTC) + `telegram_comprehensive_report.py --send` (Mon-Fri 14:30 UTC) + `daily_closer.py` (Mon-Fri 14:00 UTC, which calls notifier).
- **Internal polling** in `auto_post_scheduler.py`: 5-min loop with ±4-min trigger windows.
- **Internal polling** in `telegram_interactive_bot.py`: long-poll `getUpdates?timeout=20` — 20-second long poll, then immediately re-requests.

### 5.2 Rate limiting

- **`telegram_bot_api.py`**: Properly handles 429 + `retry_after` parameter → freezes the client for `retry_after + 1.0` seconds. Also retries 5xx with exponential backoff (`RETRY_BASE_SLEEP * attempt` = 2s, 4s, 6s).
- **`auto_poster.py`**: **No 429 handling.** If Telegram returns FloodWait, the `client.send_message` raises, exception is caught, error returned. Next scheduled post will fail too if flood persists.
- **`telegram_interactive_bot.py`**: **No 429 handling.** `requests.post` will raise on 429, caught by `except Exception`, logs error, sleeps 5s, retries getUpdates. The user's `sendMessage` is lost.
- **`telegram_client.py`**: Properly catches `FloodWaitError` from Telethon and raises a `RuntimeError` with the wait seconds — caller can handle.
- **`telegram_notifier.py`**: **No 429 handling** — just `urlopen` + blanket `except`.

`telegram_bot_api.py` exists as the proper retry-aware client, but `auto_poster.py` and `telegram_interactive_bot.py` (the two long-running PM2 services) **do not use it**. This is a significant architecture gap.

### 5.3 Failure handling + retry logic

| Component | Failure mode | Handling |
|-----------|--------------|----------|
| `auto_post_scheduler` | Post fails | Error appended to `state['errors']` (last 20). State saved. Next tick retries only if `should_run_*` returns True (i.e., next day). **No same-day retry.** |
| `auto_poster.send_message` | Buttons rejected | Retries without buttons. ✅ |
| `auto_poster.send_message` | Generic send error | Returns `{success: False, error: str(e)}`. No retry. |
| `_fetch_expert_analysis` | Node API down | Returns `None` → expert section silently omitted. |
| `telegram_interactive_bot.run_polling` | getUpdates error | Logs, sleeps 5s, retries. |
| `telegram_interactive_bot.send_message` | Send error | Logs, returns None. No retry. User message lost. |
| `telegram_target_hit_tracker` | Playwright fails | Logs, `card_img = None`, sends text-only via `sendMessage` fallback. |
| `telegram_target_hit_tracker` | Send fails | `announced[hit_key]` not set → will retry next 5-min tick. |
| `liquidity_alerts` | Send fails | State not updated → will retry next 5-min tick. |
| `telegram_bot_api` | 429 / 5xx | Retries with backoff. Flood freeze. |

### 5.4 Logging + monitoring

- `auto_post_scheduler.py` uses `print()` with `[datetime]` prefix — goes to PM2 `out_file: './logs/telegram-poster-out.log'`. No structured logging, no log levels.
- `telegram_interactive_bot.py` uses `logging.basicConfig(level=INFO)` with `'%(asctime)s %(levelname)s: %(message)s'` formatter → goes to `./logs/telegram-interactive-bot-out.log`.
- `auto_poster.py` uses bare `print()`.
- `telegram_bot_api.py` uses `logging.getLogger('TelegramBotAPI')`.
- **No metrics** (no Prometheus, no statsd, no counters for sent/failed/dedup).
- **No alerting** (no Slack/PagerDuty/email when the scheduler silently fails to post for 3 days).
- The `auto_post_state.json` keeps `posts_count` (cumulative) + `errors` (last 20) — a human must manually inspect this file. Admin has no UI to view it.
- `TelegramPredictionsTab.tsx` (admin) shows `published_at` + `telegram_message_id` from `predictions.db` — this is the only audit UI.

---

## 6. Integration

### 6.1 Telegram → Platform data sources

| Component | Reads from | Writes to |
|----------|-----------|-----------|
| `auto_poster.get_top_recommendations` | `predictions.db.stored_analyses` + `stocks.db.stocks` (JOIN by ticker for `name_ar`, `sector`) | — |
| `auto_poster.get_market_summary` | `stocks.db.stocks` (EGX filter) | — |
| `auto_poster._fetch_expert_analysis` | HTTP `GET localhost:3000/api/stocks/[ticker]/expert-analysis` | — |
| `auto_post_scheduler` (ReportsEngine) | `analyzers.reports_engine.ReportsEngine` (reads predictions.db + stocks.db) | — |
| `auto_post_scheduler.post_morning_bell` | `api.stored_analysis_routes._get_morning_bell_data(limit=3)` (Python in-process — no HTTP) | — |
| `telegram_interactive_bot.search_stock` | `stocks.db.stocks` + `data_engine.db.stock_prices` | — |
| `telegram_interactive_bot.get_stock_radar_status` | `predictions.db.predictions` (latest row per ticker) + `trader_levels_engine.get_unified_trader_levels` | — |
| `telegram_interactive_bot.check_subscription` | HTTP `/api/bot/check-subscription` + fallback `auth.db.user_telegram_links` + `auth.db.User` | — |
| `telegram_target_hit_tracker.get_active_radar_targets` | `scripts/output/maker_radar_EGX_*.json` + `predictions.db.predictions` + `stocks.db.stocks` (EGX filter) | `predictions.db.predictions` (UPDATE on hit) + `target_hit_state.json` |
| `liquidity_alerts` | `FlowSystemEngine.detect_sector_rotation()` + `maker_radar_EGX_*.json` + `exit_radar_*.json` | `db/liquidity_alerts_state.json` |
| `telegram_notifier._get_today_predictions` | `predictions.db.predictions` | — |
| Next.js `/api/telegram/publish-stock` | — | `predictions.db.predictions` (UPDATE: `published_at`, `telegram_message_id`, `was_published=1`) |

### 6.2 Canonical source

The worklog (PHASE-3) established `utils/canonical_signal.py` as the single source of truth for signal classification. All Telegram modules now import `classify_signal`, `signal_ar`, `classify_accumulation`, `classify_money_flow` from there. ✅ Good.

`trader_levels_engine.get_unified_trader_levels(ticker, current_price)` is the canonical source for entry/target/stop/support/resistance levels. Both `auto_post_scheduler._format_daily_post` and `telegram_interactive_bot.build_stock_card` use it. ✅

`OFFICIAL_LINKS` is defined in **two places**:
- `vps-service/telegram/telegram_branding.py:OFFICIAL_LINKS` (Python, 11 keys including `stocks_url`, `radar_url`, `chart_url`, `filters_url`, `reports_url`, `rescue_url`, `academy_url`, `crypto_url`)
- `src/modules/publishing/lib/official-links.ts:OFFICIAL_LINKS` (TypeScript, 6 keys only)

They overlap on `website`, `android`, `facebook`, `telegram`, `whatsapp`, `bot` — but Python has 5 extra keys not in TS. The TS version is used by every ShareButton / UnifiedPublishButton / StockPublisher. The Python version is used by every channel post. **Drift risk is real** — if a URL changes, it must be updated in both files. There is no test that verifies they match.

### 6.3 Data consistency between platform and Telegram

**Strengths**:
- `predictions.db` is the shared truth — both the Python scheduler and the Next.js admin `/api/telegram/publish-stock` route read/write it.
- `stocks.db` is read-only from the Telegram side — no risk of writes corrupting it.
- `published_at` + `telegram_message_id` + `was_published` columns on `predictions` table give full audit trail of which predictions reached the channel.

**Weaknesses**:
- `auto_poster.format_recommendation_post()` does NOT update `was_published` / `published_at` / `telegram_message_id` after a successful channel post. Only the Next.js admin route does. So if the daily scheduler auto-posts 5 recommendations at 3 PM, the audit trail shows them as "never published" until an admin manually clicks publish from the UI. **This is misleading for the admin dashboard.**
- `target_hit_state.json` dedupes by `f"{ticker}_{hit_level}_{today_str}"` — same ticker hitting TP1 twice in one day won't re-announce (good). But the same ticker hitting TP1 today and TP2 tomorrow is treated as separate (good). And the same ticker hitting TP1 again next week IS re-announced — could be perceived as spam by subscribers.
- No verification that the published message text matches the prediction in the DB. If `format_recommendation_post` produces a different entry price than what's stored (e.g., due to a price update between formatting and sending), the subscriber sees one price but the DB audit trail claims a different "published" price.

---

## 7. Missing Features

### 7.1 Inline keyboards — partial

✅ Channel posts have inline URL buttons (3 rows × 2 buttons = 6 links per post).
✅ Bot DM has inline `callback_data` buttons for navigation (`stock:TICKER`, `action:show_stock_menu`, `action:show_radar_picks`).

❌ No pagination keyboard (e.g., showing top-5 of 50 radar candidates with "Next 5" / "Previous 5" buttons).
❌ No "Save to favorites" callback.
❌ No "Set alert at price X" callback (would require server-side state).
❌ No "Subscribe to ticker alerts" callback.

### 7.2 Callback queries — partial

✅ `answer_callback_query` is called on every callback (dismisses spinner).
❌ The callback `text` parameter is always empty `""` — never shows a toast like `"تم فحص السهم"`.
❌ No callback analytics (which buttons get clicked most).

### 7.3 Media messages

✅ Stock chart images via `send_photo` (Playwright PNG).
✅ Target-hit infographic cards (1080×1080).
✅ Daily lesson infographic cards.
✅ Weekly radar report PDF + PNG.

❌ No media groups (multiple photos in one album).
❌ No video messages (MP4 explainers).
❌ No voice messages (Arabic audio briefings).
❌ No animated stickers (TGS).
❌ No video notes (round videos).

### 7.4 Group vs channel vs private chat handling

❌ **The bot assumes private chat.** `check_subscription(chat_id)` works the same regardless of chat type. If added to a group, every member's `chat_id` is the group ID — `user_telegram_links` has no group concept. The bot would either (a) reject everyone because no `chat_id` matches a linked user, or (b) grant access based on the group admin's link. Undefined behavior.

❌ No `chat_type` filter in `process_update` — group messages trigger `search_stock()` for every member's text, burning API calls + hitting the daily limit counter (which is keyed by `chat_id`, so the whole group shares one counter that resets daily).

❌ The channel publisher (`auto_poster.py`) only publishes to one configured `channel_id`. No multi-channel routing (e.g., EGX predictions to channel A, TADAWUL to channel B, news to channel C).

### 7.5 User onboarding flow

❌ No `/tutorial` command.
❌ No `/subscribe` command (subscription happens on the website, not in-bot).
❌ No guided first-run flow (e.g., "Welcome! Step 1: Pick 3 stocks you follow. Step 2: Set your risk tolerance. Step 3: ...").
❌ No `/settings` command (notification preferences, language, timezone).
❌ No `/cancel` command (to abort a multi-step flow — currently not needed since all flows are single-message).
❌ No `/about`, `/contact`, `/stats`, `/feedback` commands.
❌ No `pay`/`subscribe` deep link with prefilled plan (e.g., `/start premium_plan` → directly opens checkout).

### 7.6 Other missing

- **No webhook mode** — only long-polling. For a high-traffic bot, webhooks are more efficient.
- **No message queue** — if the bot restarts mid-processing, in-flight updates are lost (offset is committed only after `process_update` returns).
- **No per-user rate limiting** — only the daily limit (5/day for trial). A VIP user could spam `/radar` 100 times/sec and there's no throttle.
- **No analytics pipeline** — no event tracking, no funnel metrics, no DAU/MAU.
- **No A/B testing** — every user sees the same template.
- **No localization** — Arabic-only. No English fallback for non-Arabic speakers.
- **No multi-market support in the bot** — `search_stock` hardcodes `market='EGX'`. TADAWUL/KSE/QSE stocks are unreachable.
- **No `/start GROUP_INVITE` deep-link** — can't onboard a user directly into a community group.
- **No message editing** — if a recommendation changes (e.g., target updated), there's no `editMessageText` to fix the original channel post.
- **No message pinning** — important announcements (e.g., market open) aren't pinned.

---

## Critical Issues

### 🔴 C1. `auto_poster.py` has no retry / no 429 handling

`TelegramAutoPoster.send_message` catches `Exception` once (for buttons fallback) and returns `{success: False, error: str(e)}`. There is no retry, no flood-wait handling, no exponential backoff.

A robust `TelegramBotClient` exists at `telegram_bot_api.py` (with proper 429 + 5xx handling + retries + flood freeze + chunked sends + dry_run mode + stats). **It is not used by the scheduler or the interactive bot.** Only news-agent uses it.

**Impact**: If Telegram rate-limits the channel (FloodWait 30s), the daily post fails silently. The state file records the error, but no human is alerted. Next day's post also fails because the flood wait hasn't been respected.

### 🔴 C2. In-memory daily query limit resets on bot restart

`_daily_query_counts: Dict[str, int] = {}` (line 532). PM2 restart wipes this. A trial user who exhausted their 5 queries at 9 AM can get 5 more by simply waiting for the bot to restart (which it does on every code deploy or memory threshold breach).

Also, the counter auto-clears after 5000 entries: `if len(_daily_query_counts) > 5000: _daily_query_counts.clear()`. Under load (e.g., a viral tweet about the bot), all users' counters wipe simultaneously.

**Fix**: Move to `auth.db` or `predictions.db` with a `daily_query_log` table: `(chat_id, date, count)`. Indexed on `(chat_id, date)`.

### 🔴 C3. `auto_poster.py` does not write audit trail to `predictions.db`

After `auto_post_scheduler.post_daily_predictions()` posts a recommendation, the `predictions` table is NOT updated with `was_published=1` / `published_at` / `telegram_message_id`. Only the Next.js `/api/telegram/publish-stock` route does this.

**Impact**: The admin dashboard `TelegramPredictionsTab` shows ~0% published predictions even though the scheduler is publishing daily. This makes the audit trail useless and could lead to double-publishing (admin sees "not published" → manually clicks publish → subscriber gets duplicate).

### 🔴 C4. Parse mode inconsistency causes broken formatting in channel

- `auto_poster.py` uses `parse_mode='md'` with `**bold**` syntax. Markdown mode requires escaping `_`, `*`, `` ` ``, `[`. Arabic text + tickers like `SWDY` are safe, but analysis text containing `_` (e.g., `دعم_د1`) would break.
- `_format_daily_opportunities_post` uses `parse_mode='HTML'` with `<b>bold</b>`.
- Subscribers see inconsistent rendering between daily-predictions (md) and daily-opportunities (HTML) posts in the same channel.

**Fix**: Standardize on `HTML` everywhere. Migrate `auto_poster.py` templates from `**bold**` to `<b>bold</b>`.

### 🔴 C5. `telegram_notifier.py` has no legal disclaimer

The worklog explicitly notes this gap. All 7 notifier methods (`notify_target_hit`, `notify_approaching_target`, `notify_stop_warning`, `notify_trailing_profit`, `notify_stop_loss`, `notify_daily_report`, `notify_weekly_report`) lack the `LEGAL_DISCLAIMER` constant. These are real-time alerts about specific stock movements — arguably the highest-risk messages for a subscriber to act on without seeing a disclaimer.

### 🟡 W1. No same-day retry for failed scheduled posts

If `post_daily_predictions` fails at 3 PM (e.g., transient network error), the state file records `last_daily = None` and the next `should_run_daily` check returns False (because `now.hour != 15`). The post is lost for the day. No retry mechanism exists.

### 🟡 W2. No multi-market bot support

`search_stock` hardcodes `market='EGX'` in its return dict. The bot cannot analyze TADAWUL/KSE/QSE stocks even though they exist in `stocks.db`. This contradicts the platform's 6-market strategy (PHASE-3-MARKET-SEGREGATION).

### 🟡 W3. `_fetch_expert_analysis` blocks the publish path

`auto_poster.format_recommendation_post()` calls `_fetch_expert_analysis(ticker, price)` synchronously. With 5 tickers in a daily post and a 5s timeout each, worst case = 25s blocking the event loop. Should be `asyncio.gather()` or pre-fetched in parallel.

### 🟡 W4. No group chat handling

If a user adds the bot to a group, every text message from every member triggers `search_stock()`. The daily limit counter is keyed by `chat_id` (the group ID), so the entire group shares 5 queries/day. Subscription gate fails because no individual user is linked.

### 🟡 W5. `OFFICIAL_LINKS` duplicated in Python and TypeScript

Two sources of truth with different key sets (Python has 11 keys, TS has 6). URL changes must be applied in both files manually. No test verifies they match.

### 🟡 W6. No webhook mode for inbound channel messages

`telegram_client.py` (Telethon user-account) is used for bi-directional messaging, but the interactive bot uses HTTP long-polling. There is no webhook endpoint to receive Telegram updates — only the 20s long-poll. For high-volume bots, this is inefficient.

### 🟡 W7. No message editing for corrections

If a published recommendation's price/target changes (e.g., the daily-predictor updates the row after the post was sent), there is no `editMessageText` to correct the channel post. Subscribers see stale data.

### 🟡 W8. Target-hit tracker profit filter rejects valid hits

`scan_for_target_hits` rejects `profit_pct > 25.0 or profit_pct < 2.0`. For low-volatility stocks, a 1.5% move to TP1 is legitimately a "hit" but gets filtered. For high-volatility stocks, a 26% move is real but gets filtered as "chart anomaly".

### 🟢 N1. No structured logging

All Python telegram modules use `print()` or basic `logging.basicConfig`. No JSON structured logs, no log levels configurable via env, no correlation IDs.

### 🟢 N2. No metrics / alerting

No Prometheus exporter, no error-rate alerting, no "scheduler hasn't posted in 24h" check.

### 🟢 N3. No tests for telegram modules

`vps-service/tests/` contains 11 test files — none target `telegram/` modules. The worklog mentions "9/9 integration tests passed" for AUDIT-PUBLISH-QUALITY but these are not in the test directory (likely inline scripts).

---

## Recommendations for Improvement

### Priority 1 — Critical fixes (do first)

1. **Migrate `auto_poster.py` to use `TelegramBotClient`** (from `telegram_bot_api.py`). Replace `client.send_message(...)` calls with `TelegramBotClient().send_message(...)` to inherit 429/5xx retry logic, flood-freeze, chunked sends, and stats. Estimated effort: 2-3 hours (signature changes + parse_mode migration).

2. **Persist daily query limit in `auth.db`** instead of in-memory dict. Create table `bot_daily_query_log (chat_id, date, count, PRIMARY KEY(chat_id, date))`. Update on every `check_and_increment_daily_limit` call. Survives restarts + can be audited. Estimated: 1 hour.

3. **Write audit trail from `auto_poster.py`** after every successful channel post. After `poster.send_message(text, ticker='COMI')` returns `{success: True, message_id: N}`, run:
   ```sql
   UPDATE predictions SET published_at = datetime('now'),
     telegram_message_id = N, was_published = 1
   WHERE UPPER(ticker) = ? AND date(prediction_date) = date('now')
   ```
   Mirror the logic in `/api/telegram/publish-stock/route.ts` (lines 175-184). Estimated: 1 hour.

4. **Standardize on `parse_mode='HTML'`** across all Telegram senders. Convert `**bold**` → `<b>bold</b>`, `` `code` `` → `<code>code</code>`, `_italic_` → `<i>italic</i>` in `auto_poster.py` + `auto_post_scheduler.py` templates. Estimated: 2 hours (find/replace + manual review).

5. **Add `LEGAL_DISCLAIMER` to `telegram_notifier.py`** all 7 notify methods. One-line append before `return self._send(msg)`. Estimated: 30 minutes.

### Priority 2 — Quality improvements

6. **Add retry queue for failed scheduled posts.** If `post_daily_predictions` fails, push `{type: 'daily', retry_after: 300}` to a `retry_queue` list in `auto_post_state.json`. The scheduler tick checks this queue every 5 min and retries until success or end-of-day.

7. **Unify `OFFICIAL_LINKS` into a single JSON file** (`vps-service/telegram/official_links.json`) read by both Python (`telegram_branding.py`) and TypeScript (`official-links.ts` at build time via a script). Eliminates drift.

8. **Add FloodWait handling to `telegram_interactive_bot.py`.** When `send_message` returns 429, sleep `retry_after` seconds, then retry the send. Don't lose user messages.

9. **Add `chat_type` filter in `process_update`.** If `message.chat.type == 'group'` or `'supergroup'`, only respond to `/start` and explicit commands — ignore free-text stock queries (or charge against the sender's user_id, not the group chat_id).

10. **Parallelize `_fetch_expert_analysis` in `format_recommendation_post`.** Pre-fetch all expert analyses with `asyncio.gather()` before formatting. Or cache results in a TTL dict (5 min) keyed by ticker.

11. **Add multi-market support to `search_stock`.** Pass `market` parameter from `MAIN_MENU_KEYBOARD` (e.g., add a market-selector row). Return `market` from the stocks.db row, not hardcoded `'EGX'`.

12. **Add structured logging.** Replace `print()` with `logging.getLogger('telegram.poster')` + JSON formatter. Pipe to PM2 logs. Add a `/api/admin/telegram-logs` endpoint for tail.

### Priority 3 — Feature additions

13. **Add missing bot commands**: `/help` (dedicated help text), `/cancel`, `/settings`, `/about`, `/stats` (user's own query count + win rate), `/feedback`.

14. **Add pagination keyboard** for `/radar` command (show 5 of N candidates, with ◀️ / ▶️ buttons to navigate).

15. **Add per-user rate limiting** (e.g., 1 message / 2 seconds) to prevent spam.

16. **Add message editing for corrections.** Store `message_id` per prediction. If the prediction row is updated (new target, new stop), call `editMessageText` to update the channel post.

17. **Add webhook mode** as an alternative to long-polling. `setWebhook` + Flask route `/api/telegram/webhook/<token>`. Reduces latency from 20s to <1s.

18. **Add callback analytics.** Log every `callback_query.data` click to a `bot_callback_log` table. Build an admin dashboard showing which buttons get the most engagement.

19. **Add media group support** for daily-opportunities post (5 photos in one album, each with a ticker card caption).

20. **Add user onboarding flow.** First-time `/start` triggers a 3-step wizard: pick 3 stocks → set risk tolerance → confirm. Stores preferences in `auth.db.user_preferences`.

21. **Add `pay`/`subscribe` deep links** with prefilled plan: `/start premium_monthly` → opens the website checkout with the plan pre-selected.

22. **Add group-chat-aware mode.** If the bot is added to a group, switch to "broadcast" mode: only the group admin can issue commands, and responses are visible to all members.

---

## Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code inventory completeness** | 9/10 | 16 Python + 13 TS files identified. PM2 + cron + REST all mapped. |
| **Publishing flow coverage** | 8/10 | 9 post types, clear triggers, good state management. Lacks retry queue. |
| **Bot command richness** | 5/10 | 5 main commands only. No /help, /cancel, /settings, /stats, /feedback. |
| **Subscription gating** | 8/10 | Fail-closed + admin bypass + HTTP+SQLite fallback. Daily limit in-memory is weak. |
| **Message quality (Arabic)** | 9/10 | Native RTL, proper MSA, consistent emojis. |
| **Message quality (formatting)** | 5/10 | Parse mode inconsistency (md vs HTML) across senders. |
| **Disclaimer coverage** | 7/10 | Present in auto_poster + scheduler + bot. Missing in notifier + liquidity_alerts + daily_lessons. |
| **Rate limiting** | 4/10 | Only `telegram_bot_api.py` handles 429. The two PM2 services do not. |
| **Retry logic** | 4/10 | No same-day retry. No FloodWait respect in poster/bot. |
| **Logging** | 3/10 | `print()` everywhere. No structured logs, no metrics, no alerting. |
| **Integration with platform** | 7/10 | Canonical signal/levels modules used. Audit trail has gap (auto_poster doesn't write back). |
| **Multi-market support** | 3/10 | Bot hardcoded to EGX. Scheduler theoretically multi-market but defaults to 'EGX'. |
| **Inline keyboard richness** | 6/10 | URL buttons + callback buttons present. No pagination, no per-message customization. |
| **Group chat handling** | 2/10 | None. Bot breaks in groups. |
| **User onboarding** | 2/10 | None. No tutorial, no settings, no guided flow. |
| **Overall telegram automation effectiveness** | **6.5/10** | Solid foundation, active publishing, but several critical gaps prevent it from being production-grade. |

---

## Files Reviewed (Full List)

### Python (`vps-service/telegram/`)
- `__init__.py` (14 LOC) — module exports
- `auto_poster.py` (965 LOC) — full read
- `auto_post_scheduler.py` (1,831 LOC) — full read
- `telegram_interactive_bot.py` (1,418 LOC) — full read
- `telegram_client.py` (1,257 LOC) — partial (first 450 lines + structure scan)
- `telegram_target_hit_tracker.py` (1,068 LOC) — partial (first 750 lines)
- `telegram_notifier.py` (434 LOC) — full read
- `telegram_branding.py` (365 LOC) — full read
- `telegram_bot_api.py` (498 LOC) — full read
- `liquidity_alerts.py` (830 LOC) — partial (first 100 + 350-470)
- `ai_processor.py` (452 LOC) — partial (first 120)
- `database.py` (414 LOC) — partial (first 100)
- `telegram_daily_lessons.py` (509 LOC) — partial (first 80)
- `credentials.example.json` (9 LOC) — full read

### Python REST
- `vps-service/api/telegram_routes.py` (1,861 LOC) — full route inventory + detail read of `/post/*` routes

### TypeScript / TSX
- `src/modules/publishing/lib/official-links.ts` (52 LOC) — full read
- `src/modules/admin/components/TelegramPredictionsTab.tsx` (512 LOC) — full read
- `src/app/api/telegram/publish-stock/route.ts` (212 LOC) — full read
- `src/app/api/telegram/post/route.ts` (115 LOC) — full read
- `telegram-events/index.ts` (124 LOC) — partial (first 100)

### Configuration
- `ecosystem.config.js` (424 LOC) — full read
- `crontab.txt` — Telegram-related entries inventoried

### Worklog
- `worklog.md` lines 67,400–67,784 (recent context: AUDIT-PUBLISH-QUALITY, POST-MERGE-FIXES, PHASE3-MARKET-SEGREGATION, PHASE2-ADMIN-PANEL, DOCS-UPDATE-OCT9)

---

**End of audit. No code was modified.**

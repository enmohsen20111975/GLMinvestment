# BOT-SUBSCRIPTION-GATE — Agent Work Record

**Task ID:** BOT-SUBSCRIPTION-GATE
**Agent:** BOT-SUBSCRIPTION-GATE agent
**Date:** 2026-10-01
**Goal:** Make the Telegram bot (`investusernamebot`) part of the monthly subscription — no one can use it without being a registered + paid user on the website.

## What was built

### 1. Prisma schema (`prisma/auth-schema.prisma`)
Added `UserTelegramLink` model:
- Fields: `id`, `user_id` (unique), `telegram_chat_id` (unique), `telegram_username`, `linked_at`, `is_active`.
- Relations: `User` cascade-on-delete.
- Added `TelegramLinks UserTelegramLink[]` to the `User` model.

### 2. Database tables created via raw SQL on `db/auth.db`
- `user_telegram_links` (Prisma-backed via `authDb.userTelegramLink`)
- `bot_link_tokens` (better-sqlite3 backed via `src/lib/bot-link-db.ts`)

### 3. API routes
| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bot/link-token` | POST | `X-Bot-Secret` | Bot mints a 10-min single-use token |
| `/api/bot/link-account` | POST | NextAuth session | Website links the user's account to chat_id |
| `/api/bot/check-subscription` | GET | `X-Bot-Secret` | Bot checks if chat_id is linked + paid |

### 4. Frontend handler (`src/app/page.tsx`)
- `BotLinkHandler` component reads `?bot_link=TOKEN` from URL on mount.
- If unauthenticated: shows AuthView with banner "سجّل دخولك أولاً لربط البوت".
- If authenticated: shows Dialog "تأكيد ربط البوت بحسابك" → POSTs to `/api/bot/link-account` → success message "ارجع للبوت في تليجرام".
- Uses existing `@/components/ui/dialog` + `@/components/ui/button` (no new screens — Rule 4).

### 5. Bot Python code (`vps-service/telegram/telegram_interactive_bot.py`)
- New helpers: `check_subscription()`, `generate_link_token()`, `is_user_allowed()`, `_send_link_prompt()`, `_send_upgrade_prompt()`, `_send_paid_required_prompt()`, `_send_full_welcome()`.
- `handle_start()` now branches on (paid/active-trial) / (linked-free) / (not-linked).
- `process_update()` gates every command except `/start`, `/help`, `/بدء`, and the "🌐 منصة التحليل المباشر" button (which redirects to the website for sign-up).
- Fail-open mode: if `BOT_API_SECRET` is empty, logs a warning and lets requests through (avoids locking paying users during env mishaps).

### 6. Environment
Added `BOT_API_SECRET=glminvestment_bot_secret_2026_change_me_in_production` to `.env`. Production must replace with a strong random secret.

## Verification (all PASS)
1. `bun run lint` → EXIT=0
2. SQLite: `user_telegram_links` table exists.
3. `POST /api/bot/link-token` with secret → returns `{success:true, token, link_url, expires_at, ttl_minutes:10}`
4. `GET /api/bot/check-subscription?chat_id=123456` with secret → returns `{linked:false}`
5. Same call WITHOUT `X-Bot-Secret` → returns 401 `{success:false, error:'unauthorized'}`
6. Negative cases: invalid chat_id → 400; wrong secret → 401; link-account without auth session → 401 with Arabic message.

## Constitution rules respected
- **Rule 4 (NO-NEW-SCREENS):** `?bot_link=TOKEN` is a query param on the existing `/` route, not a new `page.tsx`.
- **Rule 25 (Refactoring-Gated):** lint passes; no unrelated refactors.
- **Rule 55 (P0-WAVE-SECURITY):** `X-Bot-Secret` verified via constant-time compare on both bot-only endpoints; `link-account` requires NextAuth session.
- **Rule 56 (P0-WAVE-SQLI):** all raw SQL uses `?`-bound parameters; table/column names are constants.
- **Rule 60 (MODULE-SYSTEM):** followed existing module pattern (lib helpers in `src/lib/`, API routes under `src/app/api/`).
- **Rule 62 (GIT-PUSH-DISCIPLINE):** parent agent will commit + push with conventional commit message.

## Files touched
**Created (5):**
- `src/lib/bot-link-db.ts`
- `src/app/api/bot/link-token/route.ts`
- `src/app/api/bot/link-account/route.ts`
- `src/app/api/bot/check-subscription/route.ts`
- `/home/z/my-project/agent-ctx/BOT-SUBSCRIPTION-GATE-BOT-SUBSCRIPTION-GATE-agent.md` (this file)

**Modified (4):**
- `prisma/auth-schema.prisma` (+ UserTelegramLink model + User.TelegramLinks relation)
- `src/app/page.tsx` (+ Dialog/Button imports, + BotLinkHandler component, + bot_link URL param handler)
- `vps-service/telegram/telegram_interactive_bot.py` (+ subscription gate)
- `.env` (+ BOT_API_SECRET)

## Known limitations / follow-ups
- The bot-link flow assumes a single Telegram chat_id per user. If a user wants to use the bot from two devices, they'd need to re-link each time (last-link wins). This is intentional per the task spec.
- The fail-open mode in the Python bot is deliberate — it prevents locking paying users when the env is mis-configured. Production monitoring should alert on the `BOT_API_SECRET is empty` warning.
- The `bot_link_tokens` table grows slowly (one row per un-linked /start). The `purgeExpiredBotLinkTokens()` GC runs opportunistically on each `/api/bot/link-token` call. No additional cron needed.

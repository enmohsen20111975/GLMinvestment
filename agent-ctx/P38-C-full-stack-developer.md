# Task ID: P38-C
## Agent: full-stack-developer
## Task: Overhaul `src/components/admin/TelegramTab.tsx` — full Telegram client UI (5 sub-tabs + real-time socket.io) + legacy bot tools preserved

## Context
- Read `/agent-ctx/` — only 3 prior records (3-B, P23-CRYPTO-LAB-FUSION, RECOMMENDATIONS-FIX-022). No P38-A or P38-B agent-ctx records (their work logs are in `worklog.md`).
- Read tail of `worklog.md` for P38-A (Python backend: 11 new routes on `/api/telegram` + event queue + Telethon handlers) and P38-B (socket.io mini-service on port 3003, polls Python `/events/poll` every 2s, emits `telegram:event` + `telegram:new_message`/`message_edited`/`message_deleted`).

## Files Modified
1. `src/components/admin/TelegramTab.tsx` (1089 → 2200 lines, +1111) — complete rewrite.

## Final Structure of TelegramTab.tsx
Single file with 10 sub-components + 7 helpers:

| Component / Helper | Lines | Purpose |
|---|---|---|
| `colorForId(id)` | 105 | Hash-based avatar color (12-color palette, NO blue/indigo) |
| `initialsOf(name)` | 112 | First-letter initials for avatars |
| `formatTime(dateStr)` | 120 | HH:MM Arabic time |
| `formatDateTime(dateStr)` | 131 | Full date-time Arabic |
| `dialogTypeIcon(type)` | 145 | User/Users/Megaphone lucide icons |
| `dialogTypeLabel(type)` | 154 | Arabic label (قناة/مجموعة/مستخدم) |
| **`TelegramTab`** (main) | 164 | 6-tab root, manages authStatus + socket + selectedDialog |
| `EmptyState` | 354 | Card with icon + text for empty lists |
| `NotAuthBanner` | 366 | Amber banner prompting login |
| **`AuthTab`** | 387 | Phone → Code → Password flow + connected user card |
| **`DialogsTab`** | 656 | Searchable dialogs list with avatars, unread badges |
| **`ChatTab`** | 790 | Message history + send/edit/delete + media upload + socket.io real-time + pagination |
| **`MessageBubble`** | 1229 | Outgoing (emerald) / incoming (muted) bubble + actions menu |
| **`MembersTab`** | 1323 | Group members list + add/remove + role badges |
| **`SearchTab`** | 1545 | Global message search → click to open chat |
| **`LegacyBotTab`** | 1688 | Preserved bot features (channels tracking + content scraping/AI-clean/save + recommendations/news tables) |

## Tab Layout (6 sub-tabs)
1. **المصادقة** (Auth) — phone → OTP → 2FA password flow + connected user info card.
2. **المحادثات** (Dialogs) — searchable scrollable list with avatar/type-icon/title/preview/unread-badge/time.
3. **المحادثة** (Chat) — message bubbles (outgoing right-green, incoming left-muted) + send (optimistic) + edit (inline) + delete (AlertDialog confirm) + media upload (FormData + XHR progress) + real-time socket.io listeners + pagination by scroll-to-top.
4. **الأعضاء** (Members) — group/channel only — searchable list + add (user_id + access_hash) + remove.
5. **البحث** (Search) — global search → clickable results open chat.
6. **أدوات البوت** (Legacy Bot) — preserved existing bot features (channels track/untrack/scrape, content browse + AI clean + save as rec/news, recommendations table, news list).

## socket.io-client
- **Already installed** in `package.json`: `"socket.io-client": "^4.8.3"`. Did NOT need `bun add`.
- Connection: `io('/?XTransformPort=3003', { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1500 })`.
- Only connects when `authStatus.connected === true`.
- ChatTab registers 3 listeners (`telegram:new_message`, `telegram:message_edited`, `telegram:message_deleted`) with chat_id matching + dedupe + proper cleanup (`socket.off(event, handler)`).

## API Calls (all relative paths, NO port number)
- `GET /api/telegram/auth/status`
- `POST /api/telegram/auth/send-code`
- `POST /api/telegram/auth/connect-user`
- `POST /api/telegram/auth/verify-code`
- `POST /api/telegram/auth/verify-password`
- `GET /api/telegram/dialogs?limit=100`
- `GET /api/telegram/dialogs/{chat_id}/history?limit=50&offset_id=N`
- `POST /api/telegram/messages/send` `{peer_id, message}`
- `POST /api/telegram/messages/edit` `{peer_id, message_id, new_text}`
- `POST /api/telegram/messages/delete` `{peer_id, message_ids:[], revoke:true}`
- `POST /api/telegram/media/upload` (FormData: peer_id, file, caption)
- `GET /api/telegram/groups/{id}/members?limit=100&offset=0&search=`
- `POST /api/telegram/groups/{id}/add` `{user_id, user_access_hash?}`
- `POST /api/telegram/groups/{id}/remove` `{user_id}`
- `GET /api/telegram/search?q=...&limit=50`
- Legacy: `channels/my`, `channels/tracked`, `channels/track`, `channels/untrack/{id}`, `scrape/all`, `messages`, `ai/clean`, `save`, `recommendations`, `news`.

## Lint Result
- `cd /home/z/my-project && bun run lint` → **EXIT=0** ✅
- Dev server compiled successfully (`✓ Compiled in 6.4s`) — no TypeScript errors.

## Issues Found
1. **Media upload proxy corrupts binary** — `src/app/api/telegram/[...path]/route.ts` uses `body = await request.text()` for all POST/PUT/PATCH. For multipart/form-data, this corrupts binary file content (invalid UTF-8 bytes get replaced with U+FFFD). The `peer_id` and `caption` (ASCII) arrive correctly, but the file binary does not. 
   - **Recommended fix** (NOT applied — task prohibits touching proxy): change `await request.text()` → `await request.arrayBuffer()` and pass `body: Buffer.from(arrayBuffer)` to fetch.
   - Frontend implemented with FormData as task requires; documented in this report.

2. **No backend logout endpoint** — `auth/disconnect` or `auth/logout` route doesn't exist on the Python backend. `handleLogout` does a frontend-only disconnect (clears state, shows login form). The session file remains on disk so re-auth is fast. Toast informs the user.

## Styling
- RTL layout (`dir="rtl"` on root div).
- Arabic labels everywhere.
- Color palette: emerald/teal/cyan/green-600/lime-600/amber-600/orange-600/rose-500/pink-600/fuchsia-600/stone-600/yellow-700 (NO blue/indigo on primary actions).
- Responsive: `flex-wrap` TabsList, `max-h-[Xvh] overflow-y-auto` on lists, mobile-friendly touch targets.

## What I Did NOT Touch
- `.env`, `ecosystem.config.js`
- Main Next.js dev server (did not start/stop)
- Python files
- Mini-service (telegram-events on port 3003)
- Proxy routes (`src/app/api/telegram/[...path]/route.ts`)

## Stage Summary
- TelegramTab.tsx fully rewritten with 5 new client sub-tabs + 1 legacy bot tab.
- Real-time updates via socket.io (port 3003) — ChatTab receives new_message/message_edited/message_deleted events with chat_id matching.
- All 14 new API endpoints from P38-A are wired up with proper 401 handling (auto-switches to Auth tab + toast).
- Optimistic UI for send/edit/delete with rollback on failure.
- Pagination via scroll-to-top with `offset_id`.
- Legacy bot features fully preserved (channels, content, recommendations, news) in a 6th tab.
- Lint passes (exit 0). Dev server compiles cleanly.
- One known issue with media upload proxy (documented above) — needs `request.arrayBuffer()` fix in a future task.

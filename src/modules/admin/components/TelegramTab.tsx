/**
 * TelegramTab.tsx (shim)
 * =======================
 * Re-export shim. The actual implementation now lives in the `telegram-tab/`
 * folder as part of Task F-Phase3-Split-TelegramTab (split from 2,200 LOC).
 *
 * Sub-modules:
 *   - telegram-tab/TelegramTab.tsx   (container, < 200 LOC)
 *   - telegram-tab/AuthTab.tsx       (phone/code/2FA login + connected view)
 *   - telegram-tab/DialogsTab.tsx    (dialogs list)
 *   - telegram-tab/ChatTab.tsx       (active chat view)
 *   - telegram-tab/MessageBubble.tsx (single message bubble)
 *   - telegram-tab/MembersTab.tsx    (group/channel members)
 *   - telegram-tab/SearchTab.tsx     (global search)
 *   - telegram-tab/LegacyBotTab.tsx  (legacy bot tools)
 *   - telegram-tab/EmptyState.tsx
 *   - telegram-tab/NotAuthBanner.tsx
 *   - telegram-tab/types.ts          (all interfaces)
 *   - telegram-tab/helpers.tsx        (utilities)
 */
export { TelegramTab } from './telegram-tab/TelegramTab';

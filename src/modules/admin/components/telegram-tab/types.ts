/**
 * telegram-tab/types.ts
 * =====================
 * All TypeScript interfaces for the TelegramTab split (F-Phase3-Split-TelegramTab).
 *
 * - Core types (AuthUser, AuthStatus, DialogItem, MessageItem, MemberItem,
 *   SearchResult) are used across multiple sub-components.
 * - Legacy bot types (LegacyChannel, LegacyMyChannel, LegacyRec, LegacyNews,
 *   LegacyMessage) are scoped to the LegacyBotTab sub-component but kept here
 *   for centralized type ownership.
 */

// ====== Core auth / chat / member types ======

export interface AuthUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  phone?: string;
}

export interface AuthStatus {
  connected: boolean;
  user?: AuthUser | null;
}

export interface DialogItem {
  id: number;
  title: string;
  type: 'user' | 'group' | 'channel' | string;
  unread_count?: number;
  last_message_text?: string;
  last_message_at?: string;
  username?: string;
}

export interface MessageItem {
  id: number;
  text: string;
  date: string;
  from_id?: number;
  is_outgoing: boolean;
  media_type?: string | null;
  reply_to_msg_id?: number | null;
  pending?: boolean; // local-only optimistic flag
}

export interface MemberItem {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_admin: boolean;
  is_banned: boolean;
}

export interface SearchResult {
  id: number;
  chat_id: number;
  text: string;
  date: string;
  from_id?: number;
}

// ====== Legacy bot types (used by LegacyBotTab) ======

export interface LegacyChannel {
  channel_id: string;
  channel_name: string;
  username?: string;
  market: string;
  content_type: string;
  is_active: number;
}

export interface LegacyMyChannel {
  channel_id: string;
  channel_name: string;
  username?: string;
  type?: string;
  members?: number;
  market?: string;
  content_type?: string;
}

export interface LegacyRec {
  id: number;
  symbol: string;
  market: string;
  action: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  confidence: number;
  channel_name: string;
  created_at: string;
}

export interface LegacyNews {
  id: number;
  title: string;
  market: string;
  sentiment: string;
  importance: number;
  channel_name: string;
  created_at: string;
}

export interface LegacyMessage {
  message_id: number;
  text: string;
  date: string;
  views?: number;
  channel_name?: string;
  has_images?: number;
  is_reply?: boolean;
  reply_to_text?: string | null;
}

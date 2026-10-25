/**
 * telegram-tab/helpers.tsx
 * ========================
 * Pure utility functions + shared constants for the TelegramTab split.
 *
 * NOTE: This file uses `.tsx` extension because `dialogTypeIcon` returns JSX
 * (lucide icons). All other helpers are pure string/date utilities.
 */

import React from 'react';
import {
  Megaphone,
  Users,
  MessageSquare,
  User as UserIcon,
} from 'lucide-react';

// ====== Avatar color palette ======

export const AVATAR_COLORS = [
  'bg-profit', 'bg-whale', 'bg-whale', 'bg-success',
  'bg-lime-600', 'bg-warning', 'bg-warning', 'bg-loss',
  'bg-pink-600', 'bg-fuchsia-600', 'bg-stone-600', 'bg-warning',
];

export function colorForId(id: number | string | undefined): string {
  const s = String(id ?? 'x');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ar-EG', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function dialogTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'channel': return <Megaphone className="h-3.5 w-3.5" />;
    case 'group': return <Users className="h-3.5 w-3.5" />;
    case 'user': return <UserIcon className="h-3.5 w-3.5" />;
    default: return <MessageSquare className="h-3.5 w-3.5" />;
  }
}

export function dialogTypeLabel(type: string): string {
  switch (type) {
    case 'channel': return 'قناة';
    case 'group': return 'مجموعة';
    case 'user': return 'مستخدم';
    default: return 'محادثة';
  }
}

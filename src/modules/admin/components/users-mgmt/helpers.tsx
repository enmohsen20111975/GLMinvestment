/**
 * users-mgmt/helpers.ts
 * =====================
 * Shared helpers + adminFetch for the UsersManagement split
 * (Task F-Phase3-FinalPush — split from 1,543 LOC).
 *
 * Exports:
 *   - adminFetch           — wraps fetch() with X-Admin-Token header
 *   - formatDate / formatDateTime — ar-EG locale display
 *   - getInitials          — avatar initials from name/email
 *   - getRoleBadge / getStatusBadge / getUserActivityBadge — small badge renderers
 *   - getPromoBadge / getTrialBadge — promo + trial status badges
 *   - copyToClipboard      — clipboard copy with toast
 *
 * Rule 30 (CLIENT-FACING-STYLE): Arabic labels.
 */

import React from 'react';
import {
  Activity,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Crown,
  Mail,
  Shield,
  Ticket,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getAdminToken } from '@/lib/admin-auth';
import type { UserDetails } from './types';

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getAdminToken().then((token) => {
    const headers = new Headers(options.headers);
    if (token) {
      headers.set('X-Admin-Token', token);
    }
    if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: options.credentials || 'same-origin',
    });
  });
}

export function formatDate(date: Date | string | null): string {
  if (!date) return 'غير محدد';
  return new Date(date).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(date: Date | string | null): string {
  if (!date) return 'غير محدد';
  return new Date(date).toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getInitials(name: string, email: string): string {
  if (name) {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

export function getRoleBadge(role: string): React.ReactNode {
  switch (role) {
    case 'admin':
      return <Badge className="bg-loss gap-1"><Shield className="w-3 h-3" />مدير</Badge>;
    case 'premium':
      return <Badge className="bg-warning gap-1"><Crown className="w-3 h-3" />بريميوم</Badge>;
    default:
      return <Badge variant="secondary">مستخدم</Badge>;
  }
}

export function getStatusBadge(status: string): React.ReactNode {
  switch (status) {
    case 'active':
      return <Badge className="bg-profit gap-1"><CheckCircle className="w-3 h-3" />نشط</Badge>;
    case 'inactive':
      return <Badge variant="secondary" className="gap-1"><XCircle className="w-3 h-3" />غير نشط</Badge>;
    case 'suspended':
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />موقوف</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function getUserActivityBadge(isActive: boolean): React.ReactNode {
  if (isActive) {
    return <Badge className="bg-profit/10 text-profit border-profit gap-1"><Activity className="w-3 h-3" />نشط</Badge>;
  }
  return <Badge className="bg-slate-500/10 text-muted-foreground border-border gap-1"><XCircle className="w-3 h-3" />غير نشط</Badge>;
}

export function getPromoBadge(promo?: any): React.ReactNode {
  if (!promo) return null;
  const isVip = promo.plan_tier === 'all' || promo.plan_tier === 'developer';
  const isPremium = promo.plan_tier === 'premium';
  return (
    <Badge
      className={cn(
        'gap-1.5 py-0.5 px-2.5 font-medium text-xs border shadow-sm transition-all',
        isVip
          ? 'bg-primary/15 text-primary border-purple-500/40 hover:bg-primary/25'
          : isPremium
            ? 'bg-profit/15 text-profit border-profit/20 hover:bg-profit/25'
            : 'bg-primary/15 text-primary border-primary/20 hover:bg-primary/25',
      )}
    >
      <Ticket className="w-3.5 h-3.5 text-current shrink-0" />
      <span className="font-mono font-bold tracking-wider">{promo.code}</span>
      <span className="text-xs opacity-90 font-sans">({promo.plan_label})</span>
      {promo.is_active ? (
        <span className="text-xs bg-profit/20 text-profit px-1.5 py-0.5 rounded font-mono font-bold">
          {promo.days_left > 365 ? 'مفتوح ♾️' : `${promo.days_left} يوم`}
        </span>
      ) : (
        <span className="text-xs bg-loss/20 text-loss px-1.5 py-0.5 rounded font-sans font-bold">
          منتهي
        </span>
      )}
    </Badge>
  );
}

export function getTrialBadge(trialStatus: any): React.ReactNode {
  if (!trialStatus) return null;
  if (trialStatus.isInTrial) {
    return <Badge className="bg-primary/10 text-primary border-primary gap-1">فترة تجريبية ({trialStatus.daysLeft} يوم)</Badge>;
  }
  if (trialStatus.isInWarning) {
    return <Badge className="bg-warning/10 text-warning border-warning gap-1"><Clock className="w-3 h-3" />تنبيه ({trialStatus.warningDaysLeft} يوم)</Badge>;
  }
  if (trialStatus.isExpiredAndDeletionPending) {
    return <Badge variant="destructive" className="gap-1"><Trash2 className="w-3 h-3" />بانتظار الحذف</Badge>;
  }
  return null;
}

export function copyToClipboard(text: string, onCopied?: (text: string) => void): void {
  navigator.clipboard.writeText(text);
  onCopied?.(text);
  toast.success(`تم نسخ الكود: ${text}`);
}

/** Re-export lucide icons commonly used by sub-components for convenience. */
export {
  Activity,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Crown,
  Mail,
  Shield,
  Ticket,
  Trash2,
  XCircle,
};

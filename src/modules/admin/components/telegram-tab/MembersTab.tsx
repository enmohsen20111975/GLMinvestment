/**
 * telegram-tab/MembersTab.tsx
 * ============================
 * Group/channel members management: list, search, add (by user_id + access_hash),
 * remove. Shown only for groups/channels (not 1:1 user chats).
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Loader2, Plus, Search, Shield, UserPlus, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { WidgetCard } from '@/components/shared/WidgetCard';
import type { MemberItem } from './types';
import { colorForId, initialsOf } from './helpers';
import { EmptyState } from './EmptyState';
import { NotAuthBanner } from './NotAuthBanner';

interface MembersTabProps {
  groupId: number;
  groupTitle: string;
  authenticated: boolean;
  onRequireAuth: () => void;
}

export function MembersTab({ groupId, groupTitle, authenticated, onRequireAuth }: MembersTabProps) {
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addAccessHash, setAddAccessHash] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/groups/${groupId}/members?limit=100&offset=0&search=${encodeURIComponent(search)}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setMembers(Array.isArray(data.members) ? data.members : []);
      } else {
        toast.error(data.error || 'فشل تحميل الأعضاء');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [groupId, search, authenticated, onRequireAuth]);

  useEffect(() => {
    if (authenticated) fetchMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, groupId]);

  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase();
    return name.includes(q) || (m.username?.toLowerCase().includes(q) ?? false);
  });

  const handleAdd = async () => {
    const uid = addUserId.trim();
    if (!uid || !/^\d+$/.test(uid)) { toast.error('أدخل معرّف مستخدم صحيح (رقم)'); return; }
    setAdding(true);
    try {
      const body: { user_id: string; user_access_hash?: string } = { user_id: uid };
      if (addAccessHash.trim()) body.user_access_hash = addAccessHash.trim();
      const res = await fetch(`/api/telegram/groups/${groupId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        toast.success('تمت إضافة العضو ✓');
        setAddUserId('');
        setAddAccessHash('');
        fetchMembers();
      } else {
        toast.error(data.error || 'فشل الإضافة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (m: MemberItem) => {
    try {
      const res = await fetch(`/api/telegram/groups/${groupId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: m.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        toast.success('تم طرد العضو');
        setMembers((prev) => prev.filter((x) => x.id !== m.id));
      } else {
        toast.error(data.error || 'فشل الطرد');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <WidgetCard
      title={`أعضاء: ${groupTitle}`}
      icon={Users}
      iconColor="text-profit"
      onRefresh={fetchMembers}
      refreshing={loading}
      headerClassName="pb-3"
      contentClassName="space-y-4"
      badge={
        <span className="text-xs text-muted-foreground">
          {loading ? 'جاري التحميل...' : `${filtered.length} عضو`}
        </span>
      }
    >
      {/* Add member */}
      <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <UserPlus className="h-4 w-4 text-profit" />
          إضافة عضو
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="معرّف المستخدم (user_id)"
            className="flex-1 min-w-[150px]"
            dir="ltr"
            inputMode="numeric"
          />
          <Input
            value={addAccessHash}
            onChange={(e) => setAddAccessHash(e.target.value)}
            placeholder="access_hash (اختياري)"
            className="flex-1 min-w-[150px]"
            dir="ltr"
          />
          <Button onClick={handleAdd} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Plus className="h-4 w-4 ml-1" />}
            إضافة
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن عضو..."
          className="pr-10"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                <div className="h-2.5 w-1/2 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" />} text={search ? 'لا توجد نتائج' : 'لا توجد أعضاء'} />
      ) : (
        <div className="max-h-[55vh] overflow-y-auto pr-1 -mr-1 space-y-1">
          {filtered.map((m) => {
            const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || 'بدون اسم';
            const roleBadge = m.is_banned ? (
              <Badge className="bg-loss hover:bg-loss text-white text-xs">محظور</Badge>
            ) : m.is_admin ? (
              <Badge className="bg-whale hover:bg-whale text-white text-xs">
                <Shield className="h-2.5 w-2.5 ml-1" />
                مشرف
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">عضو</Badge>
            );
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors"
              >
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className={cn('text-foreground text-sm', colorForId(m.id))}>
                    {initialsOf(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{name}</p>
                    {roleBadge}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span dir="ltr">ID: {m.id}</span>
                    {m.username && <span dir="ltr">@{m.username}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-loss hover:bg-loss dark:hover:bg-loss"
                  onClick={() => handleRemove(m)}
                  title="طرد"
                >
                  <UserPlus className="h-4 w-4 rotate-180" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

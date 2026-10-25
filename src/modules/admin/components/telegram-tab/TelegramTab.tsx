/**
 * telegram-tab/TelegramTab.tsx
 * =============================
 * Container component for the Telegram admin tab.
 *
 * Owns the top-level state: active sub-tab, auth status, currently selected
 * dialog, and the socket.io connection. Delegates rendering to the sub-tabs:
 *   - AuthTab       (phone/code/2FA login + connected user view)
 *   - DialogsTab    (list of chats / groups / channels)
 *   - ChatTab       (active chat view: messages, send, edit, delete, upload)
 *   - MembersTab    (group/channel members management)
 *   - SearchTab     (global messages search)
 *   - LegacyBotTab  (legacy bot-based channel tracking / scrape / AI clean)
 *
 * Extracted from the original 2,200 LOC `TelegramTab.tsx` per Task
 * F-Phase3-Split-TelegramTab. Original file now re-exports this container.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot, Key, MessageSquare, Search, Send, Users,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AuthStatus, DialogItem } from './types';
import { EmptyState } from './EmptyState';
import { AuthTab } from './AuthTab';
import { DialogsTab } from './DialogsTab';
import { ChatTab } from './ChatTab';
import { MembersTab } from './MembersTab';
import { SearchTab } from './SearchTab';
import { LegacyBotTab } from './LegacyBotTab';

export function TelegramTab() {
  const [activeTab, setActiveTab] = useState<string>('auth');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedDialog, setSelectedDialog] = useState<DialogItem | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const fetchAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/status');
      const data = await res.json().catch(() => ({ connected: false }));
      setAuthStatus({
        connected: !!data.connected,
        user: data.user ?? null,
      });
    } catch {
      setAuthStatus({ connected: false });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Connect socket only when authenticated
  useEffect(() => {
    if (authStatus?.connected) {
      let s: Socket | null = null;
      try {
        s = io('/?XTransformPort=3003', {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1500,
        });
        setSocket(s);
      } catch (err) {
        console.error('[TelegramTab] socket.io connect failed', err);
      }
      return () => {
        if (s) {
          s.removeAllListeners();
          s.disconnect();
        }
        setSocket(null);
      };
    }
    return undefined;
  }, [authStatus?.connected]);

  const openDialog = useCallback((dialog: DialogItem) => {
    setSelectedDialog(dialog);
    setActiveTab('chat');
  }, []);

  const openDialogById = useCallback((chat_id: number, fallbackTitle?: string) => {
    setSelectedDialog({
      id: chat_id,
      title: fallbackTitle || `محادثة ${chat_id}`,
      type: 'group',
    });
    setActiveTab('chat');
  }, []);

  const handleLogout = () => {
    // No backend logout endpoint exists; do a frontend-only disconnect.
    // The session file remains on disk (so re-auth is fast).
    setAuthStatus({ connected: false, user: null });
    setSelectedDialog(null);
    setActiveTab('auth');
    toast.info('تم تسجيل الخروج محلياً — ملف الجلسة محفوظ لإعادة الدخول السريع');
  };

  const requireAuth = useCallback(() => {
    setActiveTab('auth');
    toast.error('يرجى تسجيل الدخول أولاً');
  }, []);

  return (
    <div dir="rtl" className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="auth" className="gap-1.5">
            <Key className="h-4 w-4" />
            المصادقة
            {authStatus?.connected ? (
              <span className="inline-block h-2 w-2 rounded-full bg-profit" />
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-loss" />
            )}
          </TabsTrigger>
          <TabsTrigger value="dialogs" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            المحادثات
          </TabsTrigger>
          <TabsTrigger value="chat" disabled={!selectedDialog} className="gap-1.5">
            <Send className="h-4 w-4" />
            المحادثة
          </TabsTrigger>
          <TabsTrigger
            value="members"
            disabled={!selectedDialog || selectedDialog.type === 'user'}
            className="gap-1.5"
          >
            <Users className="h-4 w-4" />
            الأعضاء
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            البحث
          </TabsTrigger>
          <TabsTrigger value="legacy" className="gap-1.5">
            <Bot className="h-4 w-4" />
            أدوات البوت
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <AuthTab
            authStatus={authStatus}
            authLoading={authLoading}
            onRefresh={fetchAuthStatus}
            onLogout={handleLogout}
            onAuthenticated={(status) => {
              setAuthStatus(status);
              setActiveTab('dialogs');
            }}
          />
        </TabsContent>

        <TabsContent value="dialogs">
          <DialogsTab
            authenticated={!!authStatus?.connected}
            openDialog={openDialog}
            onRequireAuth={requireAuth}
          />
        </TabsContent>

        <TabsContent value="chat">
          {selectedDialog ? (
            <ChatTab
              dialog={selectedDialog}
              socket={socket}
              onBack={() => setActiveTab('dialogs')}
              onRequireAuth={requireAuth}
            />
          ) : (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10" />}
              text="اختر محادثة من تبويب المحادثات"
            />
          )}
        </TabsContent>

        <TabsContent value="members">
          {selectedDialog && selectedDialog.type !== 'user' ? (
            <MembersTab
              groupId={selectedDialog.id}
              groupTitle={selectedDialog.title}
              authenticated={!!authStatus?.connected}
              onRequireAuth={requireAuth}
            />
          ) : (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              text="الأعضاء متاحون للمجموعات والقنوات فقط"
            />
          )}
        </TabsContent>

        <TabsContent value="search">
          <SearchTab
            authenticated={!!authStatus?.connected}
            openDialog={(chat_id, title) => openDialogById(chat_id, title)}
            onRequireAuth={requireAuth}
          />
        </TabsContent>

        <TabsContent value="legacy">
          <LegacyBotTab authenticated={!!authStatus?.connected} onRequireAuth={requireAuth} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

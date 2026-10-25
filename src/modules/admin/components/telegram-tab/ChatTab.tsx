/**
 * telegram-tab/ChatTab.tsx
 * ========================
 * The active chat view: messages list, send/edit/delete, media upload,
 * socket.io real-time updates, infinite scroll (older messages).
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Card, CardContent, CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowRight, ChevronUp, Loader2, MessageSquare, Paperclip, RefreshCw, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import type { DialogItem, MessageItem } from './types';
import { colorForId, dialogTypeIcon, dialogTypeLabel, initialsOf } from './helpers';
import { MessageBubble } from './MessageBubble';

interface ChatTabProps {
  dialog: DialogItem;
  socket: Socket | null;
  onBack: () => void;
  onRequireAuth: () => void;
}

export function ChatTab({ dialog, socket, onBack, onRequireAuth }: ChatTabProps) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MessageItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [oldestId, setOldestId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatIdRef = useRef<number>(dialog.id);
  chatIdRef.current = dialog.id;

  // Fetch history
  const fetchHistory = useCallback(async (offsetId?: number) => {
    const isMore = !!offsetId;
    if (isMore) setLoadingMore(true); else setLoading(true);
    try {
      const q = offsetId ? `&offset_id=${offsetId}` : '';
      const res = await fetch(`/api/telegram/dialogs/${dialog.id}/history?limit=50${q}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success && Array.isArray(data.messages)) {
        const newMsgs: MessageItem[] = data.messages;
        if (isMore) {
          if (newMsgs.length === 0) { setHasMore(false); }
          else {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const unique = newMsgs.filter((m) => !existingIds.has(m.id));
              // prepend older
              return [...unique, ...prev];
            });
            const minId = newMsgs.reduce((min, m) => (m.id < min ? m.id : min), newMsgs[0]?.id ?? Infinity);
            setOldestId((prev) => (prev === null ? minId : Math.min(prev, minId)));
            if (newMsgs.length < 50) setHasMore(false);
          }
        } else {
          setMessages(newMsgs);
          if (newMsgs.length > 0) {
            const minId = newMsgs.reduce((min, m) => (m.id < min ? m.id : min), newMsgs[0].id);
            setOldestId(minId);
          }
          if (newMsgs.length < 50) setHasMore(false);
        }
      } else if (!isMore) {
        toast.error(data.error || 'فشل تحميل الرسائل');
      }
    } catch {
      if (!isMore) toast.error('خطأ في الاتصال بالخادم');
    } finally {
      if (isMore) setLoadingMore(false); else setLoading(false);
    }
  }, [dialog.id, onRequireAuth]);

  // Initial load
  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setOldestId(null);
    fetchHistory();
  }, [fetchHistory]);

  // Auto scroll to bottom on first load + new outgoing
  useEffect(() => {
    if (!loading && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.is_outgoing || last?.pending) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, loading]);

  // Socket.io real-time listeners
  useEffect(() => {
    if (!socket) return;
    const handlerNew = (data: { chat_id?: number; message_id?: number; text?: string; from_id?: number; is_outgoing?: boolean }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      const newMsg: MessageItem = {
        id: data.message_id ?? Date.now(),
        text: data.text || '',
        date: new Date().toISOString(),
        from_id: data.from_id,
        is_outgoing: !!data.is_outgoing,
        media_type: null,
        reply_to_msg_id: null,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      // auto-scroll on new incoming
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    };
    const handlerEdited = (data: { chat_id?: number; message_id?: number; text?: string }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      setMessages((prev) => prev.map((m) =>
        m.id === data.message_id ? { ...m, text: data.text ?? m.text, pending: false } : m
      ));
    };
    const handlerDeleted = (data: { chat_id?: number; deleted_ids?: number[] }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      const ids = new Set(data.deleted_ids || []);
      if (ids.size === 0) return;
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    };

    socket.on('telegram:new_message', handlerNew);
    socket.on('telegram:message_edited', handlerEdited);
    socket.on('telegram:message_deleted', handlerDeleted);
    return () => {
      socket.off('telegram:new_message', handlerNew);
      socket.off('telegram:message_edited', handlerEdited);
      socket.off('telegram:message_deleted', handlerDeleted);
    };
  }, [socket]);

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    // optimistic
    const tempId = -Date.now();
    const optimistic: MessageItem = {
      id: tempId,
      text,
      date: new Date().toISOString(),
      is_outgoing: true,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    try {
      const res = await fetch('/api/telegram/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        // replace temp with real id
        const realId = data.message_id ?? data.id;
        setMessages((prev) => prev.map((m) =>
          m.id === tempId ? { ...m, id: realId, pending: false } : m
        ));
      } else {
        toast.error(data.error || 'فشل إرسال الرسالة');
        // remove optimistic
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInput(text); // restore input
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  // Edit message
  const handleStartEdit = (m: MessageItem) => {
    setEditingId(m.id);
    setEditText(m.text);
  };
  const handleCancelEdit = () => { setEditingId(null); setEditText(''); };
  const handleSaveEdit = async () => {
    if (editingId === null) return;
    const newText = editText.trim();
    if (!newText) { toast.error('النص فارغ'); return; }
    const prevText = messages.find((m) => m.id === editingId)?.text;
    setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: newText } : m));
    setEditingId(null);
    try {
      const res = await fetch('/api/telegram/messages/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message_id: editingId, new_text: newText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (!data.success) {
        toast.error(data.error || 'فشل التعديل');
        setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: prevText ?? m.text } : m));
      } else {
        toast.success('تم تعديل الرسالة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: prevText ?? m.text } : m));
    }
  };

  // Delete message
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const prev = messages;
    setMessages((m) => m.filter((x) => x.id !== target.id));
    try {
      const res = await fetch('/api/telegram/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message_ids: [target.id], revoke: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); setMessages(prev); return; }
      if (!data.success) {
        toast.error(data.error || 'فشل الحذف');
        setMessages(prev);
      } else {
        toast.success('تم حذف الرسالة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages(prev);
    }
  };

  // Media upload (note: proxy uses text() body which may corrupt binary — see report)
  const handleFilePick = () => fileInputRef.current?.click();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error('حجم الملف يتجاوز 50MB');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('peer_id', String(dialog.id));
      fd.append('file', file);
      fd.append('caption', '');
      // XMLHttpRequest for progress events
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.open('POST', '/api/telegram/media/upload');
        xhr.send(fd);
      });
      toast.success('تم رفع الملف ✓');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل رفع الملف: ${msg}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Pagination on scroll to top
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop < 50 && hasMore && !loadingMore && !loading && oldestId !== null) {
      fetchHistory(oldestId);
    }
  };

  return (
    <Card className="flex flex-col h-[75vh] min-h-[500px]">
      {/* Header */}
      <CardHeader className="py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Avatar className="h-9 w-9">
            <AvatarFallback className={cn('text-foreground text-sm', colorForId(dialog.id))}>
              {initialsOf(dialog.title)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{dialog.title}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {dialogTypeIcon(dialog.type)} {dialogTypeLabel(dialog.type)}
              {dialog.username && <span dir="ltr">@{dialog.username}</span>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => fetchHistory()} disabled={loading} className="h-8 w-8">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => oldestId !== null && fetchHistory(oldestId)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 ml-1" />
              )}
              تحميل رسائل أقدم
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">لا توجد رسائل — أرسل أول رسالة</p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              editing={editingId === m.id}
              editText={editText}
              onEditText={setEditText}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onStartEdit={() => handleStartEdit(m)}
              onDelete={() => setDeleteTarget(m)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </CardContent>

      {/* Input */}
      <div className="border-t p-3 shrink-0 space-y-2">
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>جاري رفع الملف... {uploadProgress}%</span>
            <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-profit transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,video/*,audio/*,application/pdf"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleFilePick}
            disabled={uploading || sending}
            title="إرفاق ملف"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="اكتب رسالة..."
              disabled={sending || uploading}
            />
          </div>
          <Button onClick={handleSend} disabled={sending || !input.trim() || uploading}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الرسالة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الرسالة؟ سيتم الحذف للجميع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-loss hover:bg-loss text-white"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

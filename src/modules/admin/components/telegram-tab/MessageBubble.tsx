/**
 * telegram-tab/MessageBubble.tsx
 * ===============================
 * Single chat message bubble with inline edit + delete menu.
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  CheckCircle, Loader2, MoreVertical, Paperclip, Pencil, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import type { MessageItem } from './types';
import { formatTime } from './helpers';

interface MessageBubbleProps {
  msg: MessageItem;
  editing: boolean;
  editText: string;
  onEditText: (s: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}

export function MessageBubble({
  msg, editing, editText, onEditText, onSaveEdit, onCancelEdit, onStartEdit, onDelete,
}: MessageBubbleProps) {
  return (
    <div className={cn('flex', msg.is_outgoing ? 'justify-start' : 'justify-end')}>
      {/* RTL: outgoing on left (visually) since dir=rtl reverses — keep using justify-start for outgoing */}
      <div className={cn(
        'group relative max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words shadow-sm',
        msg.is_outgoing
          ? 'bg-profit text-white rounded-tl-sm'
          : 'bg-muted text-foreground rounded-tr-sm'
      )}>
        {editing ? (
          <div className="space-y-2 min-w-[200px]">
            <textarea
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              className="w-full bg-white/10 border border-white/30 rounded p-1.5 text-foreground text-sm resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7" onClick={onSaveEdit}>
                <CheckCircle className="h-3.5 w-3.5 ml-1" />
                حفظ
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-foreground hover:bg-white/10" onClick={onCancelEdit}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          <>
            {msg.media_type && (
              <div className="mb-1 text-xs opacity-80 flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {msg.media_type}
              </div>
            )}
            <p className="whitespace-pre-wrap">{msg.text || '—'}</p>
            <div className={cn(
              'flex items-center gap-1 mt-1 text-xs',
              msg.is_outgoing ? 'text-foreground/70' : 'text-muted-foreground'
            )}>
              <span>{formatTime(msg.date)}</span>
              {msg.pending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            </div>

            {/* Actions menu */}
            {msg.is_outgoing && !msg.pending && (
              <div className="absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={msg.is_outgoing ? { left: -8 } : { right: -8 }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-6 w-6 rounded-full shadow"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={msg.is_outgoing ? 'start' : 'end'}>
                    <DropdownMenuItem onClick={onStartEdit}>
                      <Pencil className="h-3.5 w-3.5 ml-2" />
                      تعديل
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-loss focus:text-loss focus:bg-loss dark:focus:bg-loss"
                    >
                      <Trash2 className="h-3.5 w-3.5 ml-2" />
                      حذف
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

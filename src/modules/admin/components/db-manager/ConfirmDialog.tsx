'use client';

/**
 * db-manager/ConfirmDialog.tsx
 * ================================
 * Global AlertDialog wrapper — driven by ConfirmState passed in from the
 * container. Used by backup / restore / delete / drop-table / truncate /
 * maintenance / daily-restore / daily-delete flows.
 */

import { Loader2, AlertTriangle, Info } from 'lucide-react';

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
import { cn } from '@/lib/utils';

import type { ConfirmDialogProps } from './types';

export function ConfirmDialog({ confirm, busy, onClose, onConfirm }: ConfirmDialogProps) {
  return (
    <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {confirm?.destructive ? (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            ) : (
              <Info className="w-5 h-5" />
            )}
            {confirm?.title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{confirm?.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            className={cn(confirm?.destructive && 'bg-destructive text-foreground hover:bg-destructive/90')}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {confirm?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

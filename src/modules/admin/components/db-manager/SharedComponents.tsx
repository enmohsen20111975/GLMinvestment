'use client';

/**
 * db-manager/SharedComponents.tsx
 * ================================
 * Small shared visual components used across the Database Manager UI:
 * - DbCard (sidebar DB row)
 * - IntegrityBadge (ok/corrupt/unknown pill)
 * - EmptyState (placeholder Card)
 * - StatCard (overview stat tile)
 */

import {
  HardDrive,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { formatBytes } from './helpers';
import type {
  DbCardProps,
  IntegrityBadgeProps,
  EmptyStateProps,
  StatCardProps,
} from './types';

export function DbCard({ db, selected, onSelect }: DbCardProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-right p-3 rounded-lg border transition-all hover:border-profit',
        selected
          ? 'border-profit bg-profit/20'
          : 'border-border bg-card'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <HardDrive
            className={cn(
              'w-4 h-4 flex-shrink-0',
              selected ? 'text-profit' : 'text-muted-foreground'
            )}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{db.name}</div>
            <div className="text-xs text-muted-foreground">
              {db.sizeHuman} · {db.tableCount} جدول · {db.totalRows.toLocaleString('en-US')} صف
            </div>
          </div>
        </div>
        <IntegrityBadge integrity={db.integrity} />
      </div>
      {(db.walPresent || db.shmPresent) && (
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {db.walPresent && (
            <Badge variant="outline" className="text-xs bg-warning/20 text-warning ">
              WAL {formatBytes(db.walSizeBytes)}
            </Badge>
          )}
          {db.shmPresent && (
            <Badge variant="outline" className="text-xs">
              SHM
            </Badge>
          )}
        </div>
      )}
    </button>
  );
}

export function IntegrityBadge({ integrity }: IntegrityBadgeProps) {
  if (integrity === 'ok') {
    return (
      <Badge variant="outline" className="text-xs bg-profit/20 text-profit ">
        <CheckCircle2 className="w-3 h-3" />
        سليمة
      </Badge>
    );
  }
  if (integrity === 'corrupt') {
    return (
      <Badge variant="destructive" className="text-xs">
        <XCircle className="w-3 h-3" />
        تالفة
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      <AlertCircle className="w-3 h-3" />
      غير معروف
    </Badge>
  );
}

export function EmptyState({ icon: Icon, text }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="py-20 text-center">
        <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

export function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-semibold truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

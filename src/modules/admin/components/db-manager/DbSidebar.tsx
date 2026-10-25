'use client';

/**
 * db-manager/DbSidebar.tsx
 * ============================
 * Sidebar DB list — Card showing loading skeletons / empty state /
 * scrollable list of DbCard entries.
 */

import { HardDrive, AlertCircle } from 'lucide-react';

import { WidgetCard } from '@/components/shared/WidgetCard';

import { DbCard } from './SharedComponents';
import type { DbSidebarProps } from './types';

export function DbSidebar({
  databases,
  filteredDatabases,
  loading,
  selectedDb,
  onSelectDb,
}: DbSidebarProps) {
  void databases; // kept in props for potential future use (count badge, etc.)
  return (
    <WidgetCard
      title="قواعد البيانات"
      icon={HardDrive}
      loading={loading && filteredDatabases.length === 0}
      skeletonRows={5}
      skeletonHeight="h-14"
      hideRefresh
      contentClassName="p-2"
    >
      {filteredDatabases.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="text-xs">لا توجد قواعد بيانات</p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-1 pr-1">
          {filteredDatabases.map((db) => (
            <DbCard
              key={db.name}
              db={db}
              selected={selectedDb === db.name}
              onSelect={() => onSelectDb(db.name)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

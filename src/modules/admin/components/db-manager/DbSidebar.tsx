'use client';

/**
 * db-manager/DbSidebar.tsx
 * ============================
 * Sidebar DB list — Card showing loading skeletons / empty state /
 * scrollable list of DbCard entries.
 */

import { HardDrive, AlertCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDrive className="w-4 h-4" />
          قواعد البيانات
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredDatabases.length === 0 ? (
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
      </CardContent>
    </Card>
  );
}

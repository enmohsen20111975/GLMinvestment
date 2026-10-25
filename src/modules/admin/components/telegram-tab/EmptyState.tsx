/**
 * telegram-tab/EmptyState.tsx
 * ===========================
 * Generic empty-state card used across Telegram sub-tabs.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <div className="mb-3 opacity-40">{icon}</div>
        <p className="text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}

/**
 * telegram-tab/NotAuthBanner.tsx
 * ==============================
 * Warning banner shown to the user when a Telegram sub-tab is opened but
 * the Telegram session is not yet authenticated.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Key, XCircle } from 'lucide-react';

export function NotAuthBanner({ onRequireAuth }: { onRequireAuth: () => void }) {
  return (
    <Card className="border-warning bg-warning/10">
      <CardContent className="py-6 flex flex-col items-center text-center gap-3">
        <XCircle className="h-8 w-8 text-warning" />
        <p className="font-medium text-warning ">
          يرجى تسجيل الدخول أولاً
        </p>
        <p className="text-sm text-warning ">
          هذا التبويب يتطلب مصادقة على Telegram
        </p>
        <Button onClick={onRequireAuth} variant="outline">
          <Key className="h-4 w-4 ml-2" />
          الذهاب للمصادقة
        </Button>
      </CardContent>
    </Card>
  );
}

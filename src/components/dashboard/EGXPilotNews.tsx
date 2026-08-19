'use client';

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EGXPilotNews() {
  const { egxPilotNews, egxPilotNewsLoading, loadEgxPilotNews } = useAppStore();

  useEffect(() => {
    loadEgxPilotNews(10); // Load 10 news items
  }, [loadEgxPilotNews]);

  if (egxPilotNewsLoading && !egxPilotNews) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="font-medium">أخبار السوق</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 text-center">
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>جاري تحميل الأخبار...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!egxPilotNews || egxPilotNews.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-3 w-3" />
            <span className="font-medium">أخبار السوق</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-4 text-center">
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span>لا توجد أخبار متاحة حالياً</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="h-3 w-3" />
          <span className="font-medium">أخبار السوق</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="space-y-2">
          {egxPilotNews.slice(0, 5).map((news, index) => (
            <div key={index} className="border-b pb-2 last:border-b-0 last:pb-0 overflow-hidden">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 h-4 w-4">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-1">
                  <h3 className="text-sm font-semibold line-clamp-2 break-words">
                    {news.title || 'بدون عنوان'}
                  </h3>
                  {news.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                      {news.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap">
                      {new Date(news.timestamp || 0).toLocaleDateString('ar-EG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
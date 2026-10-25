// src/modules/screener/components/screener-advanced/CollapsibleSection.tsx
// F-Phase3-Split-Screener — UNIFIED-MARKET-UX (Task 3): Collapsible Section.
// كل فلتر/section في #stock-filters لازم يكون قابل للطي والفرد.
// CollapsibleSection بيلفّ Card في Collapsible شادوكل radix،
// default-open=true عشان كل الـ sections مفتوحة افتراضياً (زي ما العميل طلب).
// الـ trigger هو الـ CardHeader كله (عنوان + أيقونة chevron بتلف).

'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { useTranslation } from '@/lib/i18n-context';
import { cn } from '@/lib/utils';
import type { CollapsibleSectionProps } from './types';

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={className}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full text-right cursor-pointer hover:opacity-80 transition-opacity"
              aria-expanded={open}
            >
              <CardTitle className="text-base flex items-center gap-2 flex-1">
                {icon}
                {title}
              </CardTitle>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {open ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('screener.advanced.collapsible.collapse')}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('screener.advanced.collapsible.expand')}</span>
                  </>
                )}
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={cn('space-y-3', contentClassName)}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

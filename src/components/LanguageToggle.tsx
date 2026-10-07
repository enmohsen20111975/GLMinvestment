'use client';

/**
 * LanguageToggle.tsx — زرار تبديل اللغة (عربى ↔ English).
 *
 * FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01):
 *   Updated to use the new cookie-based I18nContext (useLocale hook)
 *   instead of doing a full page reload. This makes the switch instant
 *   and avoids losing any in-memory state (open modals, unsaved form data, etc).
 *
 * Reference: Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React from 'react';
import { Languages, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/i18n-context';

interface LanguageToggleProps {
  variant?: 'ghost' | 'outline' | 'default';
  size?: 'sm' | 'default' | 'lg' | 'icon';
  className?: string;
}

export function LanguageToggle({
  variant = 'ghost',
  size = 'icon',
  className,
}: LanguageToggleProps) {
  const { locale, setLocale, loading } = useLocale();

  const switchLocale = async (newLocale: 'ar' | 'en') => {
    if (newLocale === locale || loading) return;
    await setLocale(newLocale);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={cn('gap-1.5', className)}
          disabled={loading}
          aria-label="Switch language"
          title={locale === 'ar' ? 'تغيير اللغة' : 'Switch language'}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Languages className="w-4 h-4" />
          )}
          {size !== 'icon' && (
            <span className="text-xs font-medium">
              {locale === 'ar' ? 'ع' : 'EN'}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuItem
          onClick={() => switchLocale('ar')}
          className="gap-2 cursor-pointer"
        >
          <span className="text-base">🇪🇬</span>
          <span className="flex-1">العربية</span>
          {locale === 'ar' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => switchLocale('en')}
          className="gap-2 cursor-pointer"
        >
          <span className="text-base">🇺🇸</span>
          <span className="flex-1">English</span>
          {locale === 'en' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

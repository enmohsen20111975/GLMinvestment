// src/modules/screener/components/screener-advanced/ExportDropdown.tsx
// F-Phase3-Split-Screener — Reusable export dropdown (نص / WhatsApp /
// Facebook / CSV). WhatsAppIcon inline SVG (lucide has no WhatsApp export).
//
// Exports:
//   - WhatsAppIcon  (re-exported by StockScreenerAdvanced.tsx → public API)
//   - ExportDropdown (re-exported by StockScreenerAdvanced.tsx → public API)

'use client';

import { useState, useCallback } from 'react';
import { Copy, Check, Download, Facebook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n-context';
import type { ExportDropdownProps, WhatsAppIconProps } from './types';

// ─── WhatsApp icon (inline SVG — lucide has no WhatsApp export) ─────────────

export function WhatsAppIcon({ className = 'w-4 h-4' }: WhatsAppIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── Reusable export dropdown ──────────────────────────────────────────────

export function ExportDropdown({
  shareText,
  disabled = false,
  showCsv = false,
  onExportCsv,
}: ExportDropdownProps) {
  const t = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyText = useCallback(async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast.success(t('screener.advanced.toast.copyToClipboard'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('screener.advanced.toast.copyFailed'));
    }
  }, [shareText]);

  const handleShareWhatsApp = useCallback(() => {
    if (!shareText) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'width=600,height=400');
  }, [shareText]);

  const handleShareFacebook = useCallback(() => {
    if (!shareText) return;
    const platformUrl = encodeURIComponent(window.location.href);
    const quote = encodeURIComponent(shareText.slice(0, 200));
    const url = `https://www.facebook.com/sharer/sharer.php?u=${platformUrl}&quote=${quote}`;
    window.open(url, '_blank', 'width=600,height=400');
  }, [shareText]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
          <Download className="w-3.5 h-3.5" />
          {t('screener.advanced.buttons.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" dir="rtl">
        <DropdownMenuLabel>{t('screener.advanced.share.exportResults')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopyText} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-profit" /> : <Copy className="w-4 h-4" />}
          {t('screener.advanced.share.copyText')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareWhatsApp} className="gap-2 cursor-pointer">
          <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
          {t('screener.advanced.share.whatsapp')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareFacebook} className="gap-2 cursor-pointer">
          <Facebook className="w-4 h-4 text-[#1877F2]" />
          {t('screener.advanced.share.facebook')}
        </DropdownMenuItem>
        {showCsv && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
              <Download className="w-4 h-4" />
              CSV
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

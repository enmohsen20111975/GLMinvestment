'use client';

import React from 'react';
import { Globe, Shield, FileText, AlertTriangle, Facebook, MessageCircle, Send, Smartphone, Bot } from 'lucide-react';
import Link from 'next/link';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): useTranslation hook.
import { useTranslation } from '@/lib/i18n-context';

export function Footer() {
 const t = useTranslation();

 return (
 <footer className="border-t border-border bg-card/50 mt-auto">
 <div className="max-w-7xl mx-auto px-4 py-4">
 {/* Social Media Links */}
 <div className="flex items-center justify-center gap-4 sm:gap-6 mb-3 pb-3 border-b border-border/50 flex-wrap">
 <a
 href={OFFICIAL_LINKS.website}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors min-h-[44px] py-2"
 title={t('footer.officialSite')}
 >
 <Globe className="w-4 h-4" />
 <span>{t('footer.site')}</span>
 </a>
 <a
 href={OFFICIAL_LINKS.android}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-profit transition-colors min-h-[44px] py-2"
 title={t('footer.androidApp')}
 >
 <Smartphone className="w-4 h-4" />
 <span>{t('footer.android')}</span>
 </a>
 <a
 href={OFFICIAL_LINKS.facebook}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-whale transition-colors min-h-[44px] py-2"
 title={t('footer.facebook')}
 >
 <Facebook className="w-4 h-4" />
 <span>{t('footer.facebook')}</span>
 </a>
 <a
 href={OFFICIAL_LINKS.telegram}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-whale transition-colors min-h-[44px] py-2"
 title={t('footer.telegram')}
 >
 <Send className="w-4 h-4" />
 <span>{t('footer.telegram')}</span>
 </a>
 <a
 href={OFFICIAL_LINKS.bot}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-warning transition-colors min-h-[44px] py-2"
 title={t('footer.botApp')}
 >
 <Bot className="w-4 h-4" />
 <span>{t('footer.bot')}</span>
 </a>
 <a
 href={OFFICIAL_LINKS.whatsapp}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-success transition-colors min-h-[44px] py-2"
 title={t('footer.whatsapp')}
 >
 <MessageCircle className="w-4 h-4" />
 <span>{t('footer.whatsapp')}</span>
 </a>
 </div>

 <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
 {/* Brand */}
 <div className="flex items-center gap-2">
 <img src="/logo-square.png" alt={t('common.appName')} className="w-5 h-5 rounded object-contain shadow-sm" />
 <a
 href={OFFICIAL_LINKS.website}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-2 hover:opacity-80 transition-opacity"
 >
 <Globe className="w-4 h-4 text-primary" />
 <span className="text-xs font-bold text-primary">{t('common.siteUrl')}</span>
 </a>
 <span className="text-xs text-muted-foreground">{t('common.appName')}</span>
 </div>

 {/* Legal Links */}
 <nav className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center" aria-label={t('footer.disclaimer')}>
 <Link
 href="/legal/privacy"
 className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
 >
 <Shield className="w-3 h-3" />
 {t('footer.privacy')}
 </Link>
 <Link
 href="/legal/terms"
 className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
 >
 <FileText className="w-3 h-3" />
 {t('footer.terms')}
 </Link>
 <Link
 href="/legal/disclaimer"
 className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
 >
 <AlertTriangle className="w-3 h-3" />
 {t('footer.disclaimer')}
 </Link>
 </nav>

 {/* Disclaimer note — أمان قانوني */}
 <p className="text-xs text-muted-foreground text-center sm:text-left max-w-[500px] leading-relaxed">
 <strong>{t('footer.disclaimer')}</strong> {t('footer.disclaimer')}
 </p>

 {/* Powered by */}
 <p className="text-xs text-muted-foreground text-center sm:text-left">
 © {new Date().getFullYear()} {t('common.appName')} — {t('footer.rights')}
 </p>
 </div>
 </div>
 </footer>
 );
}

'use client';

import React from 'react';
import { Globe, Shield, FileText, AlertTriangle, Facebook, MessageCircle, Send, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';

export function Footer() {
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
            title="الموقع الرسمي"
          >
            <Globe className="w-4 h-4" />
            <span>الموقع</span>
          </a>
          <a
            href={OFFICIAL_LINKS.android}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-emerald-600 transition-colors min-h-[44px] py-2"
            title="تطبيق أندرويد"
          >
            <Smartphone className="w-4 h-4" />
            <span>أندرويد</span>
          </a>
          <a
            href={OFFICIAL_LINKS.facebook}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-teal-600 transition-colors min-h-[44px] py-2"
            title="تابعنا على فيسبوك"
          >
            <Facebook className="w-4 h-4" />
            <span>فيسبوك</span>
          </a>
          <a
            href={OFFICIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-teal-500 transition-colors min-h-[44px] py-2"
            title="انضم لقناتنا على تليجرام"
          >
            <Send className="w-4 h-4" />
            <span>تليجرام</span>
          </a>
          <a
            href={OFFICIAL_LINKS.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-green-600 transition-colors min-h-[44px] py-2"
            title="انضم لجروب واتساب"
          >
            <MessageCircle className="w-4 h-4" />
            <span>واتساب</span>
          </a>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <img src="/logo-square.png" alt="دليل الاستثمار" className="w-5 h-5 rounded object-contain shadow-sm" />
            <a
              href={OFFICIAL_LINKS.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-primary">invist.m2y.net</span>
            </a>
            <span className="text-xs text-muted-foreground">دليل الاستثمار</span>
          </div>

          {/* Legal Links */}
          <nav className="flex items-center gap-3 sm:gap-4 flex-wrap justify-center" aria-label="روابط قانونية">
            <Link
              href="/legal/privacy"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
            >
              <Shield className="w-3 h-3" />
              سياسة الخصوصية
            </Link>
            <Link
              href="/legal/terms"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
            >
              <FileText className="w-3 h-3" />
              شروط الاستخدام
            </Link>
            <Link
              href="/legal/disclaimer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline min-h-[44px] py-2"
            >
              <AlertTriangle className="w-3 h-3" />
              إخلاء المسؤولية
            </Link>
          </nav>

          {/* Disclaimer note — أمان قانوني */}
          <p className="text-xs text-muted-foreground text-center sm:text-left max-w-[500px] leading-relaxed">
            <strong>إخلاء مسؤولية:</strong> المنصة تقدم رأيًا شخصيًا آليًا لأغراض
            تعليمية وتحليلية فقط، وليست توصية استثمارية أو نصيحة مالية. القرار
            مسؤولية العميل وحده. لا يوجد ضمان للنتائج، والخسارة ممكنة. استشر
            مستشارًا ماليًا مرخصًا قبل أي قرار.
          </p>

          {/* Powered by */}
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            تعمل بتقنية{' '}
            <a
              href={OFFICIAL_LINKS.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              invist.m2y.net
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

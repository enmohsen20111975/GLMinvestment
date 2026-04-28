'use client';

import React from 'react';
import { Globe } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border bg-card/50 mt-auto safe-area-bottom lg:mb-0 mb-16">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <a
              href="https://m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-primary">m2y.net</span>
            </a>
            <span className="text-[10px] text-muted-foreground">منصة استثمار EGX</span>
          </div>

          {/* Legal Links */}
          <nav className="flex items-center gap-4" aria-label="روابط قانونية">
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              onClick={() => {
                // Privacy Policy - could open a modal or navigate
                alert('سياسة الخصوصية - قيد التطوير');
              }}
            >
              سياسة الخصوصية
            </button>
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              onClick={() => {
                // Terms of Use
                alert('شروط الاستخدام - قيد التطوير');
              }}
            >
              شروط الاستخدام
            </button>
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              onClick={() => {
                // Disclaimer
                alert(
                  'إخلاء المسؤولية\n\n' +
                  'هذه المنصة للأغراض التعليمية والتثقيفية فقط.\n' +
                  'جميع المحتوى المعروض (تحليلات، بيانات، رسوم بيانية) لا يُعتبر نصيحة استثمارية أو توصية بشراء أو بيع الأوراق المالية.\n' +
                  'استثمر على مسؤوليتك الخاصة واستشر خبيراً مالياً مرخصاً قبل اتخاذ أي قرار استثماري.\n\n' +
                  'This platform is for educational purposes only. Content does not constitute investment advice. Always consult a licensed financial advisor.'
                );
              }}
            >
              إخلاء المسؤولية
            </button>
          </nav>

          {/* Disclaimer note */}
          <p className="text-[10px] text-muted-foreground/70 text-center sm:text-left max-w-[400px] leading-relaxed">
            المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد توصية استثمارية أو نصيحة مالية. استشر متخصصًا ماليًا قبل اتخاذ أي قرار استثمار.
          </p>

          {/* Powered by */}
          <p className="text-[10px] text-muted-foreground/60 text-center sm:text-left">
            تعمل بتقنية{' '}
            <a
              href="https://m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              m2y.net
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

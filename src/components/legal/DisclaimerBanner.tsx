'use client';

import React, { useState, useCallback } from 'react';
import { AlertTriangle, X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'egx_disclaimer_dismissed_v2';

/**
 * DisclaimerBanner — إخلاء المسؤولية القانوني
 * ===============================================
 * ده أمان قانوني للمنصة. النص ده لازم يظهر في كل جلسة.
 *
 * النقاط القانونية الأساسية:
 * 1. المنصة بتقدم رأي شخصي آلي، مش نصيحة استثمارية مرخصة
 * 2. القرار مسؤولية العميل وحده
 * 3. مفيش أي ضمان للنتائج (لا ربح مضمون ولا نجاح مضمون)
 * 4. السوق فيه مخاطر، الخسارة ممكن تحصل
 * 5. لازم استشارة مستشار مالي مرخص قبل أي قرار
 *
 * النص ده متوافق مع متطلبات هيئة الرقابة المالية المصرية (FRA)
 * والقواعد العامة للإفصاح عن المخاطر في الأسواق المالية.
 */
export function DisclaimerBanner() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return sessionStorage.getItem(STORAGE_KEY) !== 'true';
  });

  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  }, []);

  return (
    <>
      {visible && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 relative z-50">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-center">
              <p
                className="text-xs sm:text-sm text-amber-800 dark:text-amber-200 leading-relaxed font-semibold"
                dir="rtl"
              >
                ⚠️ إخلاء مسؤولية قانوني: هذه المنصة تقدم{' '}
                <strong>رأيًا شخصيًا آليًا</strong> لأغراض تعليمية وتحليلية فقط،
                وليست{' '}
                <strong>نصيحة استثمارية مرخصة</strong> أو نصيحة مالية.
                القرار النهائي مسؤولية العميل وحده.
              </p>
              <p
                className="text-[11px] sm:text-xs text-amber-600 dark:text-amber-300 mt-0.5"
                dir="rtl"
              >
                لا يوجد أي ضمان للنتائج. السوق يحتوي على مخاطر، والخسارة ممكنة.
                استشر مستشارًا ماليًا مرخصًا قبل أي قرار استثماري.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              onClick={handleDismiss}
              aria-label="إغلاق التنبيه"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * LegalDisclaimerFooter — نص قانوني ثابت يظهر في أسفل كل شاشة
 * (مش قابل للـ dismiss — لازم يفضل ظاهر دايماً)
 */
export function LegalDisclaimerFooter() {
  return (
    <div
      className="border-t border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-2 mt-4"
      dir="rtl"
    >
      <p className="text-[10px] sm:text-[11px] text-amber-700 dark:text-amber-400 text-center leading-relaxed">
        <strong>إخلاء مسؤولية:</strong> هذه المنصة تقدم رأيًا شخصيًا آليًا لأغراض
        تعليمية وتحليلية فقط، وليست نصيحة استثمارية مرخصة أو نصيحة مالية. القرار
        النهائي مسؤولية العميل وحده. لا يوجد ضمان للنتائج، والخسارة ممكنة.
        استشر مستشارًا ماليًا مرخصًا قبل أي قرار.{' '}
        <span className="text-amber-600 dark:text-amber-500">
          This platform provides automated personal opinion for educational
          purposes only — not investment advice.
        </span>
      </p>
    </div>
  );
}

/**
 * InlineDisclaimer — نص قانوني مختصر يظهر جوه البطاقات/الشاشات
 * مثلاً: جوه بطاقة توقع، جوه DealAdvisor، إلخ
 */
export function InlineDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p
        className="text-[9px] text-muted-foreground italic mt-1 text-center"
        dir="rtl"
      >
        رأي آلي تعليمي — ليس نصيحة استثمارية مرخصة. القرار مسؤوليتك.
      </p>
    );
  }
  return (
    <p
      className="text-[10px] text-muted-foreground leading-relaxed mt-2 text-center"
      dir="rtl"
    >
      ⚠️ هذا التحليل رأي آلي لأغراض تعليمية فقط، وليس نصيحة استثمارية مرخصة. القرار
      مسؤولية العميل. لا ضمان للنتائج.
    </p>
  );
}

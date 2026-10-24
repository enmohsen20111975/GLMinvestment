/**
 * subscription-view/FAQItem.tsx
 * ============================
 * FAQItem — collapsible Q&A card. Click the question row to toggle the answer
 * (chevron rotates -90° when open). Used in the FAQ section of the
 * SubscriptionView.
 */
'use client';

import React, { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';

export interface FAQItemProps {
  question: string;
  answer: string;
}

export function FAQItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="overflow-hidden border border-border/70 shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-right hover:bg-muted/40 transition-colors"
      >
        <span className="font-bold text-sm md:text-base">{question}</span>
        <ChevronLeft
          className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${
            isOpen ? '-rotate-90 text-primary' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-xs md:text-sm text-muted-foreground leading-relaxed border-t bg-muted/20 pt-3">
          {answer}
        </div>
      )}
    </Card>
  );
}

/** Static FAQ entries — rendered by the FAQSection in the container. */
export const FAQ_ENTRIES: { question: string; answer: string }[] = [
  {
    question: 'ما هو الفرق بين الباقة الفردية والباقة الشاملة VIP؟',
    answer:
      'الباقة الفردية (بريميوم أو برو) تفتح لك سوقاً واحداً تختاره (مثل السوق المصري أو السعودي أو الأمريكي). بينما الباقة الشاملة VIP تفتح لك جميع الأسواق الـ 6 معاً (مصر + السعودية + الكويت + قطر + أمريكا + كريبتو وذهب) مع كامل مزايا برو وقنوات التليجرام لكل الأسواق وخط دعم واتساب VIP مباشر.',
  },
  {
    question: 'كيف يعمل الفاحص الشرعي وهل يغطي جميع الأسواق؟',
    answer:
      'الفاحص الشرعي في المنصة يفحص نسب الديون والفوائد والتوافق المالي وفق المعايير الشرعية المعتمدة (AAOIFI)، ويحسب نسب التطهير المالي ومقدار الزكاة الواجبة على الأسهم. وهو متاح بالكامل لمشتركي بريميوم وبرو والـ VIP.',
  },
  {
    question: 'ما هو محرك إنقاذ الأسهم الخاسرة (Bagholder Rescue)؟',
    answer:
      'أداة حسابية متقدمة في باقتي برو و VIP مخصصة للأسهم المتعلقة أو المحافظ الخاسرة؛ حيث تحسب بدقة أفضل نقاط تعديل متوسط السعر (Average Down) أو التخفيف عند الارتدادات لتقليل الخسائر والتعافي بأقل مخاطرة ممكنة.',
  },
  {
    question: 'ما هي طرق الدفع المتاحة داخل وخارج مصر؟',
    answer:
      'في مصر: نقبل بطاقات فيزا وماستركارد، ومحافظ إلكترونية (فودافون كاش، أورانج، وي، اتصالات)، وكذلك الدفع الفوري عبر InstaPay. ومن دول الخليج وباقي العالم: نقبل جميع البطاقات الائتمانية الدولية بجميع العملات بأمان تام.',
  },
  {
    question: 'هل يتم تجديد الاشتراك تلقائياً؟ وهل يمكنني الإلغاء في أي وقت؟',
    answer:
      'نعم، يمكنك إلغاء التجديد التلقائي في أي وقت بضغطة زر واحدة من إعدادات حسابك دون أي رسوم إضافية، وستحتفظ بكامل المزايا حتى آخر دقيقة في مدة اشتراكك المدفوعة.',
  },
];

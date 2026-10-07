'use client';

import React from 'react';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HelpItem {
  title: string;
  description: string;
  details?: string;
}

interface HelpTooltipProps {
  items: HelpItem[];
  className?: string;
  iconClassName?: string;
}

export function HelpTooltip({ items, className, iconClassName }: HelpTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'rounded-full p-1 hover:bg-muted/80 transition-colors',
              className
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Info className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-sm p-0 bg-popover border-border shadow-lg"
          sideOffset={8}
        >
          <div className="divide-y divide-border">
            {items.map((item, idx) => (
              <div key={idx} className="p-3">
                <h4 className="font-bold text-sm text-foreground mb-1">
                  {item.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
                {item.details && (
                  <p className="text-xs text-muted-foreground/80 mt-1 italic">
                    {item.details}
                  </p>
                )}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Predefined help definitions for common features
export const HELP_DEFINITIONS = {
  // Analysis types
  analysisTypes: {
    title: 'أنواع التحليل',
    items: [
      {
        title: 'التحليل الشامل',
        description: 'تحليل سريع لجميع الأسهم معاً في صفحة واحدة، يعتمد على البيانات الأساسية فقط.',
        details: 'مثالي لمسح سريع للسوق واكتشاف الفرص.',
      },
      {
        title: 'التحليل الفردي',
        description: 'تحليل عميق لسهم واحد يستخدم 4 طبقات تحليل + تحليل خبير AI.',
        details: 'مثالي لقرارات الاستثمار المدروسة.',
      },
    ],
  },

  // Recommendation types
  recommendationTypes: {
    title: 'أنواع التحليلات',
    items: [
      {
        title: 'شراء قوي (Score ≥ 68)',
        description: 'إشارات قوية جداً للشراء مع ثقة عالية.',
      },
      {
        title: 'شراء (Score 60-67)',
        description: 'إشارات إيجابية للشراء مع ثقة جيدة.',
      },
      {
        title: 'تجميع (Score 52-67)',
        description: 'إشارات إيجابية ولكن ليست قوية - يُنصح بالبناء التدريجي للمركز.',
        details: 'اشترِ كميات صغيرة على فترات.',
      },
      {
        title: 'احتفاظ (Score 42-51)',
        description: 'لا إشارات واضحة للبيع أو الشراء - يُنصح بالانتظار ومراقبة.',
        details: 'لا تتخذ قرار حاسم الآن.',
      },
      {
        title: 'بيع (Score < 42)',
        description: 'إشارات سلبية - يُنصح بالبيع أو تجنب الشراء.',
      },
    ],
  },

  // Learning system
  learningSystem: {
    title: 'نظام التعلم الذاتي',
    items: [
      {
        title: 'التعلم التكراري',
        description: 'نظام يختبر آلاف التوليفات من البارامترات للوصول لأفضل نسبة نجاح.',
        details: 'الهدف: 99% نسبة نجاح في التوقعات.',
      },
      {
        title: 'البارامترات المحسنة',
        description: 'قيم محسنة للمؤشرات الفنية (RSI, MACD, إلخ) تُستخدم في التحليل.',
        details: 'يتم حفظها تلقائياً واستخدامها في التحليلات الجديدة.',
      },
      {
        title: 'Cross-Validation',
        description: 'اختبار النتائج على فترات زمنية مختلفة لضمان دقة التوقعات.',
      },
    ],
  },

  // Scoring system
  scoringSystem: {
    title: 'نظام التقييم',
    items: [
      {
        title: 'Composite Score',
        description: 'درجة مركبة من 0-100 تجمع المؤشرات الفنية والأساسية.',
        details: 'كلما زادت الدرجة، زادت قوة الإشارة الإيجابية.',
      },
      {
        title: 'مستوى الثقة',
        description: 'نسبة تعكس مدى موافقة المؤشرات على التحليل.',
      },
      {
        title: 'جودة البيانات',
        description: 'تقييم مدى اكتمال البيانات المتاحة للتحليل.',
      },
    ],
  },

  // Risk management
  riskManagement: {
    title: 'إدارة المخاطر',
    items: [
      {
        title: 'وقف الخسارة (Stop Loss)',
        description: 'نسبة الخسارة المسموحة قبل البيع الاضطراري.',
        details: 'يتراوح عادةً بين 3% و 8%.',
      },
      {
        title: 'هدف الربح (Target)',
        description: 'نسبة الربح المستهدفة قبل البيع.',
        details: 'يُحسب كمضاعف من وقف الخسارة.',
      },
      {
        title: 'حجم المركز',
        description: 'نسبة المحفظة المخصصة لسهم معين.',
      },
    ],
  },
};

// Helper function to get help items
export function getHelpItems(category: keyof typeof HELP_DEFINITIONS): { title: string; description: string; details?: string }[] {
  return HELP_DEFINITIONS[category]?.items || [];
}

'use client';

/**
 * VIP Live Signals Feed — كروت تداول احترافية صالحة للشراء الآن
 * ==================================================================
 * T-ALPHA-A17: يستهلك من /api/v2/commercial-feed (Single Commercial Feed).
 *   • يعرض كروت الصفقات الحية مع الدافع الفني (catalyst) بروز بارز.
 *   • يوفر زر نسخ تفاصيل التوصية جاهز للإرسال عبر Telegram/WhatsApp.
 *   • يعرض بانر السجل الموثق (Audited Performance) + جدول آخر 20 صفقة.
 *
 * Rule 27: لا بيانات وهمية — إذا الـ API فارغ، اعرض رسالة واضحة.
 * Rule 4: لا حساب مالي — كل الأرقام من الـ API.
 * Rule 30: لا أزرق/إنديغو — لوحة زمردي/تركوازي.
 */

    </div>
  );
}

/* ============================================================================
 * Local StatBox — emerald/teal palette (no blue/indigo — Rule 30)
 * ============================================================================ */

interface StatBoxProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  subtext?: string;
}

function StatBox({ icon, label, value, tone = 'neutral', subtext }: StatBoxProps) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-2 space-y-0.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-medium truncate">{label}</span>
      </div>
      <div
        className={cn(
          'text-base font-bold tabular-nums',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'negative' && 'text-red-600 dark:text-red-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-[9px] text-muted-foreground truncate">{subtext}</div>
      )}
    </div>
  );
}

export default VIPLiveSignalsFeed;

/**
 * academy/helpers.ts
 * ============================================================================
 * F-Phase3-Split-Academy: Pure utility functions + non-JSX data constants
 * extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Pure `.ts` (no JSX). All functions return primitives (string / object /
 * array). The constants here are data only — VERDICT_STYLE + SCENARIO_TONE_STYLES
 * reference lucide icons as `typeof` (for type) but never render them as JSX,
 * so this file remains a `.ts` module.
 *
 * Sub-components import these via `from './helpers'` (single source of truth).
 * ============================================================================
 */

import {
  AlertTriangle,
  ArrowDownCircle,
  CheckCircle2,
  Layers,
  Rocket,
  ShieldAlert,
  Target,
  XCircle,
} from 'lucide-react';
import type {
  MdBlock,
  Playbook,
  Scenario,
  ScenarioTone,
  Verdict,
} from './types';

// ─── Advanced lessons tab ─────────────────────────────────────────────────────

/** Badge variant per Arabic level label. Used by AdvancedLessonsTab. */
export const LEVEL_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  'مبتدئ': 'secondary',
  'متوسط': 'default',
  'متقدم': 'destructive',
};

// ─── Markdown parser helpers (used by AdvancedMarkdownRenderer) ──────────────

const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\|([\s:|-]+)\|\s*$/;

export function splitTableRow(raw: string): string[] {
  // raw is everything between the outer pipes — split on un-escaped |
  return raw
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function isTableRow(line: string): boolean {
  return TABLE_ROW_RE.test(line.trim());
}

export function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!TABLE_SEP_RE.test(trimmed)) return false;
  // cells must look like :---, ---:, :---:, or ---
  const cells = splitTableRow(trimmed.slice(1, -1));
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim())) && cells.length > 0;
}

/**
 * Minimal markdown parser — splits source text into blocks for the
 * `AdvancedMarkdownRenderer` component. Handles fenced code, h1-h4, hr,
 * blockquotes, tables, ul, ol, and paragraph blocks.
 *
 * Lifted verbatim from the original AcademyView.tsx (lines 766-866) —
 * no behavior change, only moved to its own module.
 */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip metadata line (the `> **المستوى:** ...` block at the top is parsed as blockquote)
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    if (/^####\s+/.test(line)) {
      blocks.push({ kind: 'h4', text: line.replace(/^####\s+/, '').trim() });
      i++;
      continue;
    }
    if (/^###\s+/.test(line)) {
      blocks.push({ kind: 'h3', text: line.replace(/^###\s+/, '').trim() });
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      blocks.push({ kind: 'h2', text: line.replace(/^##\s+/, '').trim() });
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      blocks.push({ kind: 'h1', text: line.replace(/^#\s+/, '').trim() });
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'blockquote', text: buf.join('\n') });
      continue;
    }
    // Markdown table block — header row + separator + body rows.
    // Detect BEFORE list/paragraph rules so a leading | doesn't get parsed
    // as a bullet. Requires at least: header | separator | (zero or more body rows).
    if (isTableRow(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // Need at least header + separator
      if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
        const headers = splitTableRow(tableLines[0].slice(1, -1));
        const rows = tableLines.slice(2).map((row) =>
          splitTableRow(row.slice(1, -1)),
        );
        blocks.push({ kind: 'table', headers, rows });
        continue;
      }
      // Fallback: wasn't a real table — rewind and parse line-by-line
      i -= tableLines.length - 1;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    blocks.push({ kind: 'paragraph', text: line });
    i++;
  }
  return blocks;
}

// ─── Live Market Scanner helpers (Trading Floor §1) ─────────────────────────

export function changeTone(pct: number): 'up' | 'down' | 'flat' {
  if (pct > 0.001) return 'up';
  if (pct < -0.001) return 'down';
  return 'flat';
}

export function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

export function analysisHint(pct: number): { tone: 'up' | 'down' | 'flat'; hint: string } {
  if (pct > 5)
    return {
      tone: 'up',
      hint: 'زخم صعودي قوي — احذر من جني الأرباح المتأخر. تجنّب الشراء في قمة الجلسة، وانتظر ارتداداً صحياً نحو متوسط ٥ جلسات قبل الدخول.',
    };
  if (pct > 1)
    return {
      tone: 'up',
      hint: 'إيجابي معتدل — راقب تأكيد الحجم. الإدخال الأمثل يكون عند ارتداد بسيط فوق دعم الجلسة السابق مع وقف خسارة واضح أسفله.',
    };
  if (pct < -5)
    return {
      tone: 'down',
      hint: 'ضغط بيعي حاد — لا تتسرع في الشراء. انتظر استقرار السعر فوق الدعم التالي وحجم تناقصي قبل التفكير في الانعكاس.',
    };
  if (pct < -1)
    return {
      tone: 'down',
      hint: 'سلبي معتدل — راقب مستوى الدعم القادم وحجم التداول. كسر الدعم بحجم عالٍ = إشارة خروج؛ تثبيته بحجم منخفض = فرصة محتملة.',
    };
  return {
    tone: 'flat',
    hint: 'حركة جانبية — لا يوجد إجراء واضح. انتظر اختراق مستوى أو كسره بحجم مؤكد قبل الدخول أو الخروج.',
  };
}

// ─── Scenario Decision Tree data + styles (Trading Floor §2) ──────────────

/** Six predefined trading scenarios with branching decision trees. */
export const SCENARIOS: Scenario[] = [
  {
    id: 'support-break',
    title: 'كسر الدعم بحجم عالٍ',
    trigger: 'السهم أغلق تحت مستوى دعم رئيسي بحجم تداول > 1.5× متوسط ٢٠ جلسة.',
    tone: 'bearish',
    branches: [
      {
        condition: 'الإغلاق اليومي مؤكد تحت الدعم والشمة البيعية قوية.',
        action: 'خروج فوري من المركز كاملاً أو تقليص ٥٠٪ على الأقل. لا تتوسط.',
        verdict: 'avoid',
      },
      {
        condition: 'السهم ارتد داخل الجلسة وأغلق فوق الدعم (False Breakdown).',
        action: 'انتظر إغلاق اليوم التالي للتأكيد قبل أي إجراء. لا تشترِ قبل التأكيد.',
        verdict: 'wait',
      },
      {
        condition: 'الدعم المحطوم تحوّل إلى مقاومة وتم اختباره من الأسفل.',
        action: 'بيع المركز القائم عند الاختبار، ولا تفتح مركزاً شرائياً جديداً.',
        verdict: 'avoid',
      },
    ],
  },
  {
    id: 'resistance-break',
    title: 'اختراق المقاومة بحجم مؤكد',
    trigger: 'السهم أغلق فوق مقاومة سابقة بحجم > 1.5× المتوسط وRSI(14) بين ٥٥ و٧٠.',
    tone: 'bullish',
    branches: [
      {
        condition: 'الإغلاق اليومي مؤكد فوق المقاومة والحجم مرتفع.',
        action: 'دخول بنسبة ٥٠٪ من حجم المركز المستهدف، وقف الخسارة أسفل المقاومة المحطومة.',
        verdict: 'go',
      },
      {
        condition: 'السهم اخترق لكنه لم يغلق فوق المقاومة بعد (Inside Day).',
        action: 'لا تتسرع؛ انتظر إغلاق اليوم التالي فوق المقاومة لتأكيد الاختراق.',
        verdict: 'wait',
      },
      {
        condition: 'الاختراق حدث بحجم ضعيف أقل من المتوسط.',
        action: 'تجنّب الدخول — اختراق كاذب محتمل خلال ١-٢ جلسة.',
        verdict: 'avoid',
      },
    ],
  },
  {
    id: 'rsi-divergence',
    title: 'تباعد RSI سلبي',
    trigger: 'السعر صنع قمة أعلى من القمة السابقة، بينما RSI(14) صنع قمة أقل (Bearish Divergence).',
    tone: 'wait',
    branches: [
      {
        condition: 'التباعد واضح على إطار ٤ ساعات ويومي والسعر قرب مقاومة قوية.',
        action: 'تقليص المركز ٣٠-٥٠٪ ورفع وقف الخسارة تحت آخر قمة سعرية.',
        verdict: 'wait',
      },
      {
        condition: 'تأكد التباعد بانكسار خط الاتجاه الصاعد.',
        action: 'خروج كامل من المركز، أو بيع على المكشوف بحجم صغير ووقف محكم.',
        verdict: 'avoid',
      },
      {
        condition: 'RSI ما زال فوق ٦٠ والتباعد غير مؤكد بعد.',
        action: 'لا تبع — انتظر تأكيد الانكسار أو ظهور شمعة هبوطية حادة.',
        verdict: 'wait',
      },
    ],
  },
  {
    id: 'hammer-at-support',
    title: 'شمعة المطرقة عند الدعم',
    trigger: 'شمعة Hammer ظهرت عند مستوى دعم قوي بحجم تداول مرتفع.',
    tone: 'bullish',
    branches: [
      {
        condition: 'المطرقة أغلقت قرب أعلى الجلسة والحجم > متوسط ٢٠ جلسة.',
        action: 'دخول طويل بحجم ٥٠٪ من المركز، وقف الخسارة أسفل ذيل المطرقة مباشرة.',
        verdict: 'go',
      },
      {
        condition: 'المطرقة ظهرت لكن حجم التداول ضعيف.',
        action: 'انتظر تأكيد اليوم التالي بشمعة خضراء فوق المطرقة قبل الدخول.',
        verdict: 'wait',
      },
      {
        condition: 'المطرقة ظهرت في اتجاه هبوطي قوي (RSI < 30) دون عوامل داعمة.',
        action: 'تجنّب — قد تكون مجرد توقف مؤقت قبل استئناف الهبوط.',
        verdict: 'avoid',
      },
    ],
  },
  {
    id: 'gap-up',
    title: 'فجوة سعرية صاعدة (Gap Up)',
    trigger: 'السهم افتتح بفجوة صاعدة > ٣٪ عن إغلاق الأمس.',
    tone: 'neutral',
    branches: [
      {
        condition: 'الفجوة مدعومة بأخبار إيجابية وحجم افتتاح مرتفع (> ٢× المتوسط).',
        action: 'راقب ملء الفجوة؛ إذا تجاوز السعر أعلى الفجوة، ادخل بحجم ٣٠٪ فقط.',
        verdict: 'go',
      },
      {
        condition: 'الفجوة بدون أخبار واضحة وحجم افتتاح عادي.',
        action: 'احذر — الفجوة قد تُملأ خلال نفس الجلسة. لا تتبع السعر.',
        verdict: 'wait',
      },
      {
        condition: 'السعر بدأ يهبط ويقترب من ملء الفجوة.',
        action: 'تجنّب الشراء — انتظر استقرار السعر فوق الفجوة على الأقل ٣ جلسات.',
        verdict: 'avoid',
      },
    ],
  },
  {
    id: 'earnings-momentum',
    title: 'ضغط شرائي بعد إعلان نتائج',
    trigger: 'السهم أعلن نتائج ربع سنوية، والسعر تحرك +/-٥٪ خلال الجلسة التالية.',
    tone: 'neutral',
    branches: [
      {
        condition: 'النتائج فاقت التوقعات (EPS > التوقعات بـ ١٠٪+) والزخم مستمر.',
        action: 'دخول بحجم ٥٠٪ بعد أول ارتداد صغير، وقف تحت سعر الإغلاق الأول.',
        verdict: 'go',
      },
      {
        condition: 'النتائج جيدة لكن السعر وصل لمقاومة قوية.',
        action: 'انتظر اختبار المقاومة وكسرها بحجم قبل الدخول — لا تطارد السعر.',
        verdict: 'wait',
      },
      {
        condition: 'النتائج أقل من التوقعات وانخفاض بحجم عالٍ.',
        action: 'خروج فوري إذا كنت مالكاً، ولا تتوسط بانتظار قاع — الانتظار يكلفك أكثر.',
        verdict: 'avoid',
      },
    ],
  },
];

export const SCENARIO_TONE_STYLES: Record<
  ScenarioTone,
  { accentBorder: string; accentStrip: string; badge: string; badgeLabel: string; iconBg: string }
> = {
  bullish: {
    accentBorder: 'border-profit/20',
    accentStrip: 'bg-profit',
    badge: 'bg-profit/15 text-profit ',
    badgeLabel: 'صعودي',
    iconBg: 'bg-profit/15 text-profit ',
  },
  bearish: {
    accentBorder: 'border-loss/20',
    accentStrip: 'bg-loss',
    badge: 'bg-loss/15 text-loss ',
    badgeLabel: 'هبوطي',
    iconBg: 'bg-loss/15 text-loss ',
  },
  wait: {
    accentBorder: 'border-warning/20',
    accentStrip: 'bg-warning',
    badge: 'bg-warning/15 text-warning ',
    badgeLabel: 'تحذير',
    iconBg: 'bg-warning/15 text-warning ',
  },
  neutral: {
    accentBorder: 'border-slate-500/40',
    accentStrip: 'bg-slate-500',
    badge: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
    badgeLabel: 'مشروط',
    iconBg: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
  },
};

export const VERDICT_STYLE: Record<
  Verdict,
  {
    Icon: typeof CheckCircle2;
    color: string;
    bg: string;
    label: string;
  }
> = {
  go: {
    Icon: CheckCircle2,
    color: 'text-profit ',
    bg: 'bg-profit/10 border-profit/20',
    label: 'إجراء',
  },
  wait: {
    Icon: AlertTriangle,
    color: 'text-warning ',
    bg: 'bg-warning/10 border-warning/20',
    label: 'انتظار',
  },
  avoid: {
    Icon: XCircle,
    color: 'text-loss ',
    bg: 'bg-loss/10 border-loss/20',
    label: 'تجنّب',
  },
};

// ─── Action Playbooks data (Trading Floor §3) ────────────────────────────────

/** Five predefined action plans for common trading situations. */
export const PLAYBOOKS: Playbook[] = [
  {
    id: 'breakout',
    icon: Rocket,
    iconBg: 'bg-profit/15 text-profit ',
    title: 'خطة Breakout (الاختراق)',
    condition:
      'السهم أغلق فوق مقاومة قوية بحجم > 1.5× المتوسط، والاتجاه العام صاعد (السعر فوق 50 MA).',
    steps: [
      'انتظر إغلاقاً يومياً مؤكداً فوق المقاومة (لا تدخل أثناء الجلسة).',
      'ضع أمر شراء بوقف (Buy Stop) أعلى قمة شمعة الاختراق.',
      'حدد وقف الخسارة تحت المقاومة المحطومة (صارت دعماً).',
      'حجم المركز: ٥٠٪ من المخطط، أضف ٢٥٪ عند أول ارتداد صاعد.',
      'جني الأرباح: ٥٠٪ عند 1R، و٥٠٪ عند 2R (R = مسافة وقف الخسارة).',
    ],
    mistake:
      'تطارد السعر بعد الاختراق مباشرة دون انتظار إغلاق مؤكد — يفتح بابًا للاختراقات الكاذبة.',
    example:
      'سهم @ 100 ج.م اخترق مقاومة 98 بإغلاق 102 وحجم 2× المتوسط. دخول @ 102.2، وقف 97، الهدف 1R=107، الهدف 2R=112.',
  },
  {
    id: 'pullback',
    icon: ArrowDownCircle,
    iconBg: 'bg-profit/15 text-profit ',
    title: 'خطة Pullback (شراء الارتداد)',
    condition:
      'السهم في اتجاه صاعد واضح (فوق 50 MA) ويهبط حالياً 2-5% لاختبار متوسط 20 يوم أو دعم قريب.',
    steps: [
      'تأكد أن الاتجاه العام صاعد (50 MA مائل صعوداً + السعر فوق 50 MA).',
      'انتظر ظهور شمعة انعكاس صاعدة (مطرقة أو ابتلاعية) عند الدعم.',
      'ادخل بعد إغلاق الشمعة الصاعدة بحجم ٥٠٪ من المركز.',
      'وقف الخسارة: تحت آخر قاع للارتداد (لا يتجاوز ٥٪ تحت السعر).',
      'الهدف: أعلى قمة سابقة + ٣٪، مع تحريك وقف الخسارة بعد كل قمة جديدة.',
    ],
    mistake:
      'شراء قبل ظهور شمعة انعكاس مؤكدة ظناً أن الارتداد انتهى — يعرضك لاستمرار الهبوط.',
    example:
      'سهم صاعد 80→95 ج.م ارتد إلى 88 (اختبار 20 MA). انتظر شمعة مطرقة @ 88، ادخل @ 89، وقف 85.5، الهدف 98.',
  },
  {
    id: 'stop-loss',
    icon: ShieldAlert,
    iconBg: 'bg-loss/15 text-loss ',
    title: 'خطة Stop-loss آلي (الخروج التلقائي)',
    condition:
      'تم فتح مركز شراء وحددت مسبقاً مستوى وقف الخسارة — والآن وصل السعر لهذا المستوى.',
    steps: [
      'لا تفاوض مع نفسك — نفّذ أمر البيع فوراً عند لمس مستوى وقف الخسارة.',
      'تأكد أن أمر Stop-Loss الآلي فعّل منذ فتح المركز (لا تنسَ تفعيله).',
      'لا تنقل وقف الخسارة لأسفل لتجنب الخروج — أكبر كارثة في التداول.',
      'بعد الخروج، سجّل سبب الخسارة في يوميات التداول لمراجعة لاحقة.',
      'لا تعد فتح نفس السهم في نفس اليوم — انتظر إشارة جديدة واضحة.',
    ],
    mistake:
      'تجميد قرار الخروج وتحويل خسارة صغيرة ٣٪ إلى خسارة كبيرة ١٥٪ بانتظار "يرتد السوق".',
    example:
      'مركز 1000 سهم @ 50 ج.م، وقف 47.5. السعر وصل 47.5 → خروج فوري، خسارة 2,500 ج.م. تجاهل الإشارة: يهبط إلى 42 → خسارة 8,000 ج.م.',
  },
  {
    id: 'dca',
    icon: Layers,
    iconBg: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
    title: 'خطة DCA (متوسط التكلفة)',
    condition:
      'تستثمر في سهم أساسي طويل الأجل (بنك أو قائد قطاع) وتريد تخفيض متوسط التكلفة دون توقيت السوق.',
    steps: [
      'حدد مبلغاً ثابتاً شهرياً (مثلاً 5,000 ج.م) لشراء نفس السهم بغض النظر عن السعر.',
      'اشترِ في نفس اليوم من كل شهر — لا تؤجل بانتظار "سعر أفضل".',
      'راجع الأساسيات كل ربع سنة؛ توقف إذا تغيرت قصة الاستثمار.',
      'لا تزيد المبلغ عند هبوط السعر إلا لسبب أساسي (لا توقيت سوق).',
      'حدد أفق الاستثمار (٣-٥ سنوات على الأقل) قبل البدء.',
    ],
    mistake:
      'التوقف عن الشراء عند هبوط السوق (خوفاً) ثم العودة عند ارتفاع الأسعار — يقلب DCA إلى شراء غالٍ.',
    example:
      '5,000 ج.م شهرياً في سهم بنكي على 12 شهراً بأسعار 28-34 ج.م. متوسط التكلفة الناتج ≈ 30.8 ج.م (أقل من متوسط السوق في 8 من 12 شهراً).',
  },
  {
    id: 'take-profit',
    icon: Target,
    iconBg: 'bg-profit/15 text-profit ',
    title: 'خطة Take-profit متدرج (Scaling Out)',
    condition:
      'المركز في ربح ≥ 1R (مسافة وقف الخسارة) وتريد تأمين الأرباح تدريجياً دون خروج كامل.',
    steps: [
      'عند 1R: بع ٣٣٪ من المركز + حرك وقف الخسارة لنقطة الدخول (Break-even).',
      'عند 2R: بع ٣٣٪ إضافي + حرك وقف الخسارة لـ 1R.',
      'عند 3R: احتفظ بالـ ٣٣٪ الأخيرة بوقف خسارة متحرك (Trailing) أسفل كل قمة.',
      'إذا ظهرت إشارة خروج صريحة (انكسار اتجاه/تباعد سلبي) قبل الهدف، اخرج بالكامل.',
      'لا تعد الدخول في نفس السهم بعد خروج متدرج ناجح إلا بعد إشارة جديدة.',
    ],
    mistake:
      'طمع في تشغيل كامل المركز بانتظار هدف 5R — يحوّل ربحاً مؤكداً 1R إلى خسارة عند ارتداد السعر.',
    example:
      'مركز 1000 سهم @ 20 ج.م، وقف 19 (مسافة 1 ج.م = 1R). @ 21: بع 333 + حرك الوقف لـ 20. @ 22: بع 333 + حرك الوقف لـ 21. الـ 334 الأخيرة بوقف متحرك.',
  },
];

// ─── Bias Detector Quiz data (Practical Tools §2) ────────────────────────────

export const BIAS_QUESTIONS: Array<{
  id: string;
  text: string;
  bias: string;
  lesson: string;
  lessonNum: number;
}> = [
  {
    id: 'loss_aversion',
    text: 'هل بعت سهم رابح بسرعة لكن ماسكت سهم خسران طويلاً؟',
    bias: 'Loss Aversion (تجنّب الخسارة)',
    lesson: 'سيكولوجيا التداول',
    lessonNum: 1,
  },
  {
    id: 'fomo',
    text: 'هل اشتريت سهم بعد ما طلع كتير لأنك خفت تفوت الفرصة؟',
    bias: 'FOMO (الخوف من تفويت الفرصة)',
    lesson: 'سيكولوجيا التداول',
    lessonNum: 1,
  },
  {
    id: 'confirmation',
    text: 'هل بتدوّر على معلومات بتأكد رأيك بس وتتجاهل المعارضة؟',
    bias: 'Confirmation Bias (الانحياز للتأكيد)',
    lesson: 'سيكولوجيا التداول',
    lessonNum: 1,
  },
  {
    id: 'ego',
    text: 'هل رفضت تعترف بخطأ في صفقة خسرانة؟',
    bias: 'Ego / Pride (الأنانية)',
    lesson: 'إدارة المخاطر الكمية',
    lessonNum: 5,
  },
  {
    id: 'revenge',
    text: 'هل زوّدت حجم الصفقة بعد خسارة عشان تعوّض؟',
    bias: 'Revenge Trading (التداول الانتقامي)',
    lesson: 'إدارة المخاطر الكمية',
    lessonNum: 5,
  },
  {
    id: 'hope',
    text: 'هل بتأجّل بيع سهم خسران على أمل "هيرجع"؟',
    bias: 'Hope (الأمل الزائف)',
    lesson: 'سيكولوجيا التداول',
    lessonNum: 1,
  },
  {
    id: 'overtrading',
    text: 'هل بتفتح صفقات كتير في نفس الوقت (> 5)؟',
    bias: 'Overtrading (الإفراط في التداول)',
    lesson: 'إدارة المخاطر الكمية',
    lessonNum: 5,
  },
];

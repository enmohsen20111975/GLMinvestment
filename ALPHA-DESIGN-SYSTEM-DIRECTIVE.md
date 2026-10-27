# 🎯 [DIRECTIVE TO ALPHA: UNIFIED FINANCIAL DESIGN SYSTEM — SINGLE SOURCE OF TRUTH]

**المستهدف:** توحيد الهوية البصرية وباليتة الألوان بالكامل عبر المنصة (`src/`) — كل لون في مكان واحد، لما يتغير كل حاجة تتغير اتوماتيك.

**النطاق المسموح:** مجلد `src/` فقط. ممنوع لمس أي ملف بايثون، وممنوع المساس بالمنطق الرياضي أو الحسابات.

---

## 🛑 1. المشكلة والجريمة الحالية

المشروع فيه **1,325 instance** من ألوان عشوائية في **104 ملف**. كل ملف بيخترع ألوانه الخاصة:

| النمط | instances |
|------|-----------|
| `bg-emerald/rose/amber/cyan` (خلفيات عشوائية) | 411 |
| `text-emerald/rose/amber/cyan` (نصوص عشوائية) | 530 |
| `border-emerald/rose/amber/cyan` (حدود عشوائية) | 369 |
| `bg-loss text-loss` (بدون /) | 15 |
| **إجمالي** | **1,325** |

**كارثة إضافية:** `src/lib/design-tokens.ts` نفسه فيه ألوان عشوائية + corrupted strings:
```typescript
// TONE_SOLID فيها ده (غلط!):
profit: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30-foreground'
//                                                                   ← corrupted: 30-foreground

// SIGNAL_BADGE_STYLES بـ تستخدم emerald/rose/amber بدل profit/loss/warning:
STRONG_BUY: { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-400', ... }
//           ← لازم يبقى: bg: 'bg-profit/10', text: 'text-profit'
```

---

## 🎨 2. الدستور البصري الموحد — 5 نغمات مالية قياسية ONLY

ممنوع نهائياً استخدام `emerald-500` أو `rose-500` أو `amber-500` أو `cyan-500` أو `slate-500` مباشرة. كل الألوان تمر عبر **CSS variables** في `globals.css`:

| النغمة | CSS Variable | الاستخدام المالي | Light Mode | Dark Mode |
|--------|-------------|-----------------|------------|-----------|
| **`profit`** | `--profit: 160 84% 39%` | TARGET_HIT, BUY, ربح | `bg-profit/10 text-profit border-profit/20` | نفسه (CSS var بـ يتغير) |
| **`loss`** | `--loss: 0 84% 60%` | STOPPED, SELL, خسارة | `bg-loss/10 text-loss border-loss/20` | نفسه |
| **`warning`** | `--warning: 38 92% 50%` | PENDING, WARNING, تربص | `bg-warning/10 text-warning border-warning/20` | نفسه |
| **`whale`** | `--whale: 189 95% 43%` | WHALE_RADAR, SMART_MONEY | `bg-whale/10 text-whale border-whale/20` | نفسه |
| **`neutral`** | `--muted: 210 40% 96%` | EXPIRED, CASH, محايد | `bg-muted text-muted-foreground border-border` | نفسه |

**القاعدة الذهبية:** غير الـ CSS variable في مكان واحد → كل المنصة تتغير اتوماتيك.

---

## 🛠️ 3. خطة التنفيذ الإلزامية (Step-by-Step)

### الخطوة 1: تطهير `src/lib/design-tokens.ts`

**أصلح فوراً:**

1. **شيل كل `emerald/rose/amber/cyan/slate` من الـ file كله** — استبدلهم بـ `profit/loss/warning/whale/neutral` (CSS vars):

```typescript
// قبل (غلط):
TONE_SOLID = {
  profit: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30-foreground',
  loss: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30-foreground',
}

// بعد (صح):
TONE_SOLID = {
  profit: 'bg-profit/10 text-profit border border-profit/20',
  loss: 'bg-loss/10 text-loss border border-loss/20',
  warning: 'bg-warning/10 text-warning border border-warning/20',
  whale: 'bg-whale/10 text-whale border border-whale/20',
  neutral: 'bg-muted text-muted-foreground border border-border',
}
```

2. **شيل كل `dark:` overrides** — الـ CSS vars بـ تتغير اتوماتيك في dark mode (مش محتاج `dark:text-emerald-400`).

3. **أصلح `SIGNAL_BADGE_STYLES` + `STATUS_BADGE_STYLES`:**
```typescript
STRONG_BUY: {
  bg: 'bg-profit/10',
  text: 'text-profit',
  border: 'border-profit/20',
  icon: '🟢',
  labelAr: 'شراء قوي',
},
// ... نفس الـ pattern لكل الـ signals
```

4. **أضف `resolveFinancialTone()`:**
```typescript
export type FinancialTone = 'profit' | 'loss' | 'warning' | 'whale' | 'neutral';

export function resolveFinancialTone(statusOrType: string): FinancialTone {
  const s = (statusOrType || '').toUpperCase().trim();
  if (['TARGET_HIT', 'TP1', 'TP2', 'TRAILING_PROFIT', 'BUY', 'STRONG_BUY', 'PROFIT', 'WHALE_RADAR_BUY'].includes(s)) return 'profit';
  if (['STOPPED', 'STOP_LOSS', 'SL', 'SELL', 'STRONG_SELL', 'LOSS', 'DANGER', 'AVOID'].includes(s)) return 'loss';
  if (['PENDING', 'WARNING', 'STALKING', 'INCUBATOR', 'CAUTION', 'REDUCE', 'WAITING'].includes(s)) return 'warning';
  if (['WHALE', 'WHALE_RADAR', 'INSTITUTIONAL', 'SMART_MONEY', 'ACCUMULATE'].includes(s)) return 'whale';
  return 'neutral';
}
```

---

### الخطوة 2: بناء المكوّن المركزي `<FinancialBadge />`

أنشئ: `src/components/shared/ui/FinancialBadge.tsx`

```typescript
import { cn } from '@/lib/utils';
import { resolveFinancialTone, type FinancialTone } from '@/lib/design-tokens';

interface FinancialBadgeProps {
  status?: string;        // auto-resolve للنغمة + النص العربي
  tone?: FinancialTone;   // تحديد يدوي
  label?: string;         // نص مخصص
  size?: 'xs' | 'sm' | 'md';
  pulse?: boolean;        // نقطة نابضة للإشارات النشطة
  icon?: string;          // emoji أو icon
  className?: string;
}

const TONE_CLASSES: Record<FinancialTone, string> = {
  profit: 'bg-profit/10 text-profit border-profit/20',
  loss: 'bg-loss/10 text-loss border-loss/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  whale: 'bg-whale/10 text-whale border-whale/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

const SIZE_CLASSES = {
  xs: 'text-[10px] px-1.5 py-0.5 rounded',
  sm: 'text-xs px-2 py-0.5 rounded-md',
  md: 'text-sm px-2.5 py-1 rounded-md',
};

const STATUS_LABELS_AR: Record<string, string> = {
  TARGET_HIT: 'تم الهدف',
  TRAILING_PROFIT: 'ربح محقق',
  STOPPED: 'وقف خسارة',
  EXPIRED: 'منتهية',
  PENDING: 'نشطة',
  ACTIVE: 'نشط',
  BUY: 'شراء',
  STRONG_BUY: 'شراء قوي',
  SELL: 'بيع',
  STRONG_SELL: 'بيع قوي',
  HOLD: 'احتفاظ',
  ACCUMULATE: 'تجميع',
  WHALE_RADAR_BUY: 'شراء رادار حيتان',
  REDUCE: 'تخفيض',
  AVOID: 'تجنّب',
  WAITING: 'في انتظار',
};

export function FinancialBadge({
  status, tone, label, size = 'sm', pulse, icon, className
}: FinancialBadgeProps) {
  const resolvedTone = tone || (status ? resolveFinancialTone(status) : 'neutral');
  const text = label || (status ? STATUS_LABELS_AR[status.toUpperCase()] || status : '');

  return (
    <span className={cn(
      'inline-flex items-center gap-1 border font-medium',
      TONE_CLASSES[resolvedTone],
      SIZE_CLASSES[size],
      className,
    )}>
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {icon && <span>{icon}</span>}
      {text}
    </span>
  );
}
```

---

### الخطوة 3: تطهير كل الملفات المصابة (104 ملف)

**القاعدة:** كل `bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30` → `<FinancialBadge>` أو `bg-profit/10 text-profit border-profit/20`.

**اول 15 ملف (الأكثر مصابة):**

| # | الملف | instances |
|---|------|-----------|
| 1 | `src/app/admin/honest-predictions/page.tsx` | 50 |
| 2 | `src/app/admin/educational-cards/page.tsx` | 39 |
| 3 | `src/modules/stock-analysis/components/StocksView.tsx` | 29 |
| 4 | `src/modules/radar/components/NetPicksTab.tsx` | 27 |
| 5 | `src/modules/predictions/components/MakerRadarTab.tsx` | 20 |
| 6 | `src/lib/design-tokens.ts` | 18 |
| 7 | `src/modules/market-analysis/components/PersonaTab.tsx` | 15 |
| 8 | `src/modules/market-analysis/components/PredictionsTab.tsx` | 14 |
| 9 | `src/app/backtest/page.tsx` | 14 |
| 10 | `src/app/rescue/page.tsx` | 13 |
| 11 | `src/modules/predictions/components/DualTrackPredictionsView.tsx` | 12 |
| 12 | `src/modules/admin/components/SystemControlPanel.tsx` | 12 |
| 13 | `src/modules/admin/components/DataEngineTab.tsx` | 12 |
| 14 | `src/modules/portfolio/components/EnhancedPortfolioView.tsx` | 11 |
| 15 | `src/modules/sharia/components/ShariaView.tsx` | 10 |

**الـ 89 ملف الباقي:** استخدم `sed` codemod آلي:
```bash
# codemod: استبدل كل الألوان العشوائية بـ semantic tokens
sed -i 's/bg-emerald-500\/15/bg-profit\/10/g'
sed -i 's/bg-emerald-500\/10/bg-profit\/10/g'
sed -i 's/text-emerald-700/text-profit/g'
sed -i 's/text-emerald-600/text-profit/g'
sed -i 's/dark:text-emerald-400//g'  # CSS var بـ يتغير اتوماتيك
sed -i 's/border-emerald-500\/30/border-profit\/20/g'
sed -i 's/border-emerald-500\/20/border-profit\/20/g'

# نفس الـ pattern لـ rose → loss, amber → warning, cyan → whale, slate → neutral
```

---

## 🚫 4. المحظورات الصارمة

- ❌ **ممنوع نهائياً** كتابة `bg-emerald-...` أو `text-rose-...` أو أي لون مباشر داخل ملفات الشاشات
- ❌ **ممنوع نهائياً** `dark:` overrides للألوان (الـ CSS vars بـ تتغير اتوماتيك)
- ❌ **ممنوع نهائياً** تركيبات باهتة أو نصوص بيضاء على خلفيات فاتحة
- ❌ **ممنوع نهائياً** تعديل أي أرقام أو بيانات قادمة من الـ API
- ❌ **ممنوع نهائياً** `git push --force`

---

## 🧪 5. إثبات الإنجاز وقبول التسليم

### Verification 1: Grep Cleanliness
```bash
# لازم النتيجة 0 (صفر):
grep -rnE "bg-emerald-[0-9]|bg-rose-[0-9]|bg-amber-[0-9]|bg-cyan-[0-9]" src/ | grep -v node_modules | wc -l
grep -rnE "text-emerald-[0-9]|text-rose-[0-9]|text-amber-[0-9]|text-cyan-[0-9]" src/ | grep -v node_modules | wc -l
grep -rnE "border-emerald-[0-9]|border-rose-[0-9]|border-amber-[0-9]|border-cyan-[0-9]" src/ | grep -v node_modules | wc -l
grep -rn "dark:text-emerald\|dark:text-rose\|dark:text-amber\|dark:text-cyan" src/ | grep -v node_modules | wc -l
```

### Verification 2: Lint
```bash
bun run lint  # Exit 0
```

### Verification 3: Build
```bash
bun run build  # Exit 0
```

### Verification 4: Single Source of Truth
```bash
# لو غيرت --profit في globals.css → كل المنصة تتغير
# اختبار: غير --profit من 160 84% 39% لـ 0 84% 60%
# النتيجة: كل الـ profit badges تتحول من أخضر لأحمر
```

---

## 📦 6. الـ Deliverables

1. `src/lib/design-tokens.ts` — نضيف من كل ألوان عشوائية + فيه `resolveFinancialTone()`
2. `src/components/shared/ui/FinancialBadge.tsx` — المكوّن المركزي الموحد
3. `src/components/shared/ui/index.ts` — export الـ FinancialBadge
4. **104 ملف** متطهر من ألوان عشوائية
5. **0 instance** من `emerald/rose/amber/cyan/slate` مباشرة في src/
6. **0 `dark:` overrides** للألوان (الـ CSS vars بـ تتغير اتوماتيك)

---

## ⏱️ 7. الترتيب الإلزامي للتنفيذ

1. design-tokens.ts (الأساس)
2. FinancialBadge.tsx (المكوّن)
3. design-tokens.ts cleanup (SIGNAL_BADGE_STYLES + STATUS_BADGE_STYLES)
4. sed codemod على كل src/ (104 ملف)
5. verification (grep + lint + build)
6. commit + push

**مفيش سطر كود هيتقبل غير لما الـ grep يرجع 0.**

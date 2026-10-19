# دليل الأسلوب البصري — GLMinvestment Style Guide

> **Task:** VISUAL-STYLE-GUIDE
> **Reviewers:** سارة (Sarah — UX designer, fintech startup, 28) · عم رشاد (Uncle Rashad — retired bank VP + 30-yr trader, 62)
> **Date:** 2026-10-12
> **Stack:** Next.js 16 · Tailwind CSS 4 · shadcn/ui (New York) · next-themes · Arabic RTL
> **Design tokens:** `--profit` (green) · `--loss` (red) · `--warning` (amber) · `--whale` (cyan) · `--primary` (emerald)

---

## الباب 1: رؤية سارة (Sarah's Vision)

> *أنا مصممة عايشة على Linear و Stripe. أول ما فتحت الكود، حسّيت إن الأساس قوي — بس في حاجات كتير هتـ break الـ eye test لو اتـ left كده.*

### 1.1 ما الذي يعجبني في الـ design الحالي؟

**1. الأساس البصري (tokens) ممتاز.**
`src/app/globals.css:13-115` — نظام HSL variables واضح ومنظم. الـ emerald palette مع الـ cyan whale accent = اختيار قوي. في dark mode، الـ subtle emerald radial gradient (lines 139-142) بيعمل "Bloomberg-feel" من غير ما يكون neon. ده بالظبط الأسلوب اللي بحاول أوصّله لعملائي.

**2. الـ tabular-nums عالمي.** `globals.css:127` — `font-variant-numeric: tabular-nums` على الـ body. خطوة صغيرة لكنها بتحل مشكلة كبيرة في alignment الأرقام. أحسنت.

**3. الـ card polish (lines 174-216).** الـ subtle shadow + `translateY(-1px)` على hover = micro-interaction محترمة. مفيش overshoot، مفيش neon glow. دي responsible.

**4. الـ PriceDisplay (`ui/PriceDisplay.tsx`).** نضيف. baseline alignment (`items-baseline` line 82)، حجمين واضحين، `dir="rtl"` inline، `tabular-nums`، lucide icons (TrendingUp/Down/Minus). ده الـ pattern اللي عاوزاه في كل الـ price displays.

**5. الـ UnifiedEmptyState (`ui/UnifiedEmptyState.tsx`).** `min-h-[240px]` عشان يبقى reserved space، role="status" + aria-live للـ a11y، spinner بـ emerald. ده mature.

**6. الـ Input focus ring (globals.css 255-265).** `border-color: hsl(var(--ring) / 0.6)` + `box-shadow: 0 0 0 2px ... 4px ...` = double-ring gentle. ده من Linear مباشرة.

### 1.2 ما الذي أريد تغييره؟ (be specific)

**1. الإيموجي في الـ badges — كبير، شكله طفولي.**
`ui/SignalBadge.tsx:41-47` — فيه خريطة `emoji: '🟢' / '🔴' / '🟡' / '⚠️'`. لما يتركب جنب عربي شكله patchy، وعلى بعض الـ OS (Windows) الإيموجي أحادي اللون. الـ lucide icons (`CheckCircle2`, `XCircle`, `AlertCircle`) اتنقل ليهم من RiskRewardBadge.tsx — بس SignalBadge استخدم emoji. مش متسق.
```tsx
// SignalBadge.tsx:41-47 — REMOVE emoji
BUY: { label: 'شراء', tone: 'profit', emoji: '🟢' },  // ← delete this
```
كمان `StockDetailDrawer.tsx:65`:
```tsx
{ticker ? ticker.charAt(0) : '📈'}  // ← fallback emoji '📈' = childish
```
و `LiquidityRadarView.tsx:90-94`:
```tsx
{ key: 'all', label: 'الكل', icon: '📋', cls: '...' },
{ key: 'whale_inflow', label: 'تدفق حيتان قوي', icon: '🌊', ... },
{ key: 'whale_outflow', label: 'تصريف صريح', icon: '🩸', ... },
{ key: 'bottom_absorption', label: 'تجميع قيعان', icon: '💎', ... },
{ key: 'correction_exhaustion', label: 'نهاية تصحيح', icon: '🛡️', ... },
```
5 إيموجي غير متسقين في الـ rendering (🌊 vs 🩸 vs 💎 sizes = مختلفة). حولهم لـ lucide: `List` / `Waves` / `TrendingDown` / `Gem` / `ShieldCheck`.

**2. الـ "WYCKOFF-RADAR-V4" latin label في ribbon.**
`LiquidityRadarView.tsx:597`:
```tsx
<span className="font-mono text-[10px] text-profit uppercase tracking-widest">WYCKOFF-RADAR-V4</span>
```
ده developer artifact، مش user-facing label. المستخدم العربي مش هيعرف يعني إيه Wyckoff. غيّره لـ "رادار حيّ — نشط" أو شيله خالص.

**3. الـ LiquidityFlashCell فيها visual clutter كبير.**
`ui/LiquidityFlashCell.tsx:66-77`:
```tsx
'bg-profit/20 text-profit ring-1 ring-profit/40 animate-pulse'
// ...
{isUp && <span className="text-[10px] animate-bounce">▲</span>}
```
3 animations في نفس الوقت: `animate-pulse` على الـ bg + `animate-bounce` على الـ glyph + `transition-all duration-500` على الـ cell. ده seizure-inducing لو في 20 row كده. يحتاج بس:
- `bg-profit/15` (soft tint)
- بدون `animate-pulse` على الـ bg
- `▲` ثابت (مش bouncing) أو lucide `ArrowUp` size-3

**4. hardcoded colors — يكسروا الـ design system.**
`DashboardView.tsx:415`:
```tsx
className={`border-r-4 ${isStrong ? 'border-r-emerald-500' : 'border-r-blue-500'} cursor-pointer ...`}
```
ده user-facing. فيه `border-r-blue-500` = مباشرة خالف Rule 30 (ممنوع blue/indigo). وحتى `border-r-emerald-500` = hardcoded teal; المفروض `border-r-primary` (semantic token).

`TopBar.tsx:399`:
```tsx
<Moon className="h-4 w-4 text-slate-600" />
```
`text-slate-600` hardcoded — يكسر dark mode لأن `slate-600` مظلم في light mode بس تقريباً invisible في dark. المفروض `text-muted-foreground`. (وجدت نفس الـ pattern في 45 ملف تاني — قائمة كاملة في الباب 4.)

**5. الـ redundant `dark:text-X dark:bg-X/40` overrides.**
`DashboardView.tsx:425`:
```tsx
className={`text-[10px] font-bold px-2 py-0.5 rounded ${
  isStrong ? 'bg-profit text-profit dark:bg-profit/40 dark:text-profit' : 'bg-primary text-primary dark:bg-primary/40 dark:text-primary'
}`}
```
الأمرين `text-profit dark:text-profit` بـ نفس القيمة = no-op. ده دليل إن المطور مش بيثق في الـ token system. لما `--profit` بيتغيّر تلقائياً في dark mode، مفيش حاجة محتاجة `dark:` override.
(وجدت الـ pattern ده في **146 ملف**، **1649 occurrence** — ده codebase-wide anti-pattern.)

**6. الـ `<details>/<summary>` native element في dashboard.**
`DashboardView.tsx:490-497`:
```tsx
<details className="rounded-lg border border-profit dark:border-profit/50 bg-profit/30 dark:bg-profit/10">
  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold ...">
    🔔 تنبيهات أسهمك الشخصية
  </summary>
```
Native `<details>` بـ default triangle من OS = مش متسق مع باقي الـ design system. كمان `bg-profit/30` على light mode = أخضر مُشبع جداً (Rashad هيتكلم عنه تحت). المفروض shadcn `Accordion` أو controlled state.

**7. الـ radius مش متسق.**
نفس الـ screen بيستخدم 4 قيم مختلفة:
- `LiquidityRadarView.tsx:463` `rounded-xl` (filter bar)
- `LiquidityRadarView.tsx:527` `rounded-xl` (table container)
- `LiquidityRadarView.tsx:532` `rounded-xl` (pagination)
- `LiquidityRadarView.tsx:538` `Button size="sm"` = default `rounded-md`
- `LiquidityRadarView.tsx:631` `rounded-xl` (market selector)
- `LiquidityRadarView.tsx:651` `rounded-md` (currency pill)

ده visual noise. لما الـ containers كلها `rounded-xl` (12px) بس الـ buttons جواها `rounded-md` (6px) = docking مش نضيف. المفروض 2 قيم بس:
- `rounded-lg` (12px) للـ cards/containers
- `rounded-md` (6px) للـ controls/buttons
- `rounded-full` للـ badges/pills

**8. الـ micro-typography تحت 10px.**
- `TopBar.tsx:274` `text-[10px]` على currency label
- `LiquidityRadarView.tsx:493` `text-[9px]` على filter count `(5)`
- `LiquidityRadarView.tsx:597` `text-[10px]` على WYCKOFF label
- `LiquidityRadarView.tsx:611` `text-[10px]` على "مرقوب: 25 سهم"
- `SignalBadge.tsx:65` `text-[11px]` للـ sm size

تحت 10px = غير قابل للقراءة على شاشات DPI منخفض، خصوصاً للمستخدمين فوق 50. الـ min readable هو 11px (`text-[11px]`)، والمفضل 12px.

**9. الـ spacing rhythm غير متناسق.**
في نفس الـ dashboard:
- `gap-1.5` (DashboardView:312) بين icon و text
- `gap-2` (DashboardView:325) بين buttons
- `gap-3` (DashboardView:218) بين sections
- `space-y-2` (DashboardView:395) داخل الـ section header
- `space-y-3` (DashboardView:204, 308) داخل الـ widget list
- `space-y-4` (DashboardView:381) بين sections
- `mb-3`, `mb-1.5`, `mb-2` كلها موجودة في نفس الـ file

مفيش rhythm واضح. Linear/Stripe بـ يستخدموا 4/8/12/16/24/32 system. مقترح: standardize على `gap-2` (8px) للـ inline elements و `space-y-4` (16px) للـ vertical sections.

**10. الـ page transitions باهتة.**
`page.tsx:902-907`:
```tsx
<motion.div
  key={currentView}
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
>
```
200ms fade + 8px slide = نضيف بس بطيء شوية. Linear بيستخدم 120ms. كمان مفيش exit animation. ممكن نحسّن بـ `duration: 0.15, ease: [0.4, 0, 0.2, 1]`.

### 1.3 اقتراحات سارة للتحسين

**Spacing system (mandatory 4/8 grid):**
```
4  = gap-1   (inline icons + text)
8  = gap-2   (inline controls, label + value)
12 = gap-3   (within a card)
16 = gap-4 / space-y-4  (between cards / sections)
24 = gap-6   (rare, between hero blocks)
32 = gap-8   (page top padding only)
```

**Typography scale (mandatory):**
| Token | px | Use |
|---|---|---|
| `text-xs` | 12px | meta, timestamps, count badges |
| `text-sm` | 14px | body text, table cells |
| `text-base` | 16px | section titles |
| `text-lg` | 18px | card titles |
| `text-xl` | 20px | page titles |
| `text-2xl` | 24px | hero numbers only (price, P&L) |
| `text-[11px]` | 11px | absolute min — count badges only |

**Micro-interactions (additive):**
1. Hover lift على الـ cards (`translateY(-1px)` — موجود بالفعل،.extend لـ 0.25s ease-out).
2. Focus ring على الـ interactive rows في الـ UnifiedTable (presently missing).
3. Loading skeleton shimmer (`globals.css:455-459` — موجود، بس الـ timing `1.5s infinite` بطيء شوية، خليه `1.2s`).
4. Tab switcher animation: `motion.div` بـ `layoutId` عشان الـ active underline يـ slide بدل ما يـ pop.

**Component-level fixes:**
- استبدل كل الـ emojis في `SignalBadge.tsx`, `StockDetailDrawer.tsx`, `LiquidityRadarView.tsx:90-94` بـ lucide icons.
- شيل `animate-pulse` و `animate-bounce` من `LiquidityFlashCell.tsx`. خليها بس `bg-profit/15 transition-colors duration-300`.
- شيل `WYCKOFF-RADAR-V4` من `LiquidityRadarView.tsx:597` (أو حوله لـ "رادار حيّ").
- شيل الـ `<details>` في `DashboardView.tsx:490` وبدّله بـ shadcn `Accordion`.

---

## الباب 2: رؤية عم رشاد (Uncle Rashad's Vision)

> *أنا بـ 30 سنة بورصة. افتحت شاشات كتير — Bloomberg, Reuters Eikon, MetaStock. اللي بيعجبني: بيانات كتير في مساحة صغيرة، contrast عالي، لون واحد لكل معنى ومفيش تكرار. اللي بـ يقلقني هنا: حاجات بتكسّر التركيز وحاجات بتضيّع معلومات.*

### 2.1 ما الذي يعجبني؟

**1. الـ color semantics صحيحة.**
`globals.css:50-55` — `--profit` أخضر للـ gains/buy/up، `--loss` أحمر للـ losses/sell/down، `--whale` cyan للـ institutional liquidity. ده نفس نظام Bloomberg. مفيش لون random — كل لون بـ معنى.

**2. الـ tabular-nums.** مفيش أمر بـ يـ botherني أكتر من الأرقام اللي بتـ shift في الـ column لما بتـ update. `font-variant-numeric: tabular-nums` على الـ body (`globals.css:127`) = حلّ المشكلة من الجذور. ممتاز.

**3. الـ dark mode tinted، مش pure black.**
`globals.css:70` — `--background: 160 5% 6%` = خلفية رمادي مخضر داكنة، مش `0 0% 0%` (pure black). ده بـ يقلل eye strain على جلسات الـ 8 ساعات. Bloomberg بـ يستخدم نفس الـ approach.

**4. الـ DataDisplay components صارمة.**
`PriceDisplay.tsx` — `hasPrice ? price : '—'`. مفيش "0.00" مزيف لما الـ price null. الـ dash = بيانات مش موجودة. ده صح.

**5. الـ RiskRewardBadge فيه floor محدد.**
`RiskRewardBadge.tsx:35` — `floor = 1.8`. لو R/R < 1.8 → أحمر. ده معيار مهني (1.8 = الحد الأدنى عند most pro traders). وجوده hardcoded = قرار دستوري، مش arbitrary.

**6. الـ Sticky TopBar.**
`TopBar.tsx:237` — `sticky top-0 z-40 backdrop-blur-md`. الـ TopBar بـ يفضل ظاهر طول الوقت، حتى لو scroll 2000px. ده essential للـ navigation في dashboard.

**7. الـ UnifiedTable في LiquidityRadarView.**
10 أعمدة مرتبة (ticker, price, change%, sparkline, flow5d, phase, entry, defense, target, action). الـ widths محددة (`width: 'w-20'`, `width: 'min-w-[120px]'`). ده data density محترمة — أكتر من 90% من retail platforms.

### 2.2 ما الذي يقلقني؟ (cite files)

**1. الـ blue border على "Buy" signal = كارثة للمتداول المتمرس.**
`DashboardView.tsx:415`:
```tsx
className={`border-r-4 ${isStrong ? 'border-r-emerald-500' : 'border-r-blue-500'} ...`}
```
معظم الـ traders (نفسي منهم) بـ يتوقعوا:
- **أخضر = شراء (Buy)** — موجود، صح.
- **أحمر = بيع (Sell)** — موجود، صح.
- **أزرق = معلومات (info / neutral)** — مش "Buy" عادي.

لما "Buy" العادي يظهر بأزرق، الـ eye بـ يـ skipه كأنه info. ده dangerous على قرار شراء. الـ pattern الصحيح:
- **Strong Buy** = أخضر مشبع (`bg-profit`)
- **Buy** = أخضر فاتح (`bg-profit/15`)
- **Hold** = أمفر (`bg-warning/15`)
- **Sell** = أحمر فاتح (`bg-loss/15`)
- **Strong Sell** = أحمر مشبع (`bg-loss`)

**2. الـ dashboard بيخفي الـ personal alerts خلف `<details>`.**
`DashboardView.tsx:490-497`:
```tsx
<details className="rounded-lg border ... bg-profit/30 dark:bg-profit/10">
  <summary>🔔 تنبيهات أسهمك الشخصية</summary>
  <div className="p-4 pt-0">
    <MyStocksBriefing />
```
أنا بـ افتح الـ dashboard عشان أشوف تنبيهات أسهمي الأول — ده السبب الوحيد اللي بـ يخليّني أفتح الموقع بدري الصبح. لما ألاقيها خلف toggle = خطأ. لو في 5 تنبيهات حرجة (stop loss hit, target reached, volume spike) لازم يكونوا top-of-fold دايماً.

**3. الـ dark mode contrast في بعض الـ badges ضعيف.**
`DashboardView.tsx:425`:
```tsx
'bg-primary text-primary dark:bg-primary/40 dark:text-primary'
```
في dark mode: `bg-primary/40` (emerald بـ 40% opacity على خلفية داكنة) + `text-primary` (نفس emerald) = الـ text مش هيبان عن الـ bg. **القاعدة:** لو الـ bg بـ opacity، الـ text لازم يكون `text-primary-foreground` (white) أو `text-background` (dark) — مش نفس اللون.

**4. الـ `bg-profit/30` على light mode = أخضر صارخ.**
`DashboardView.tsx:475`:
```tsx
<div className={`rounded-lg border p-3 ${isDefensive ? 'border-loss bg-loss dark:border-loss dark:bg-loss/30' : 'border-profit bg-profit dark:border-profit dark:bg-profit/30'}`}>
```
في light mode، `bg-loss` (solid red `hsl(0 84% 60%)`) على alert box = أحمر فاقع يـ hurts the eye. الـ pattern الصحيح للـ informational alerts: `bg-loss/5 border-loss/30` (soft tint + soft border). الـ solid bg بس للـ critical warnings (خسارة فعلية، مش "السوق دفاعي").

**5. الـ text sizes تحت 10px = مش هقرأها.**
عمري 62. لو الـ currency label `text-[10px]` (`TopBar.tsx:274`) أو filter count `text-[9px]` (`LiquidityRadarView.tsx:493`)، أنا بـ اضطر أقرب الشاشة أو أكبّر. الـ WCAG 2.1 Level AA بـ يقول min text 12px للـ body. الـ 9px = fail.

**6. الـ SignalBadge بـ يستخدم emojis للمعلومات الحرجة.**
`SignalBadge.tsx:41-47` — `🟢` / `🔴` / `🟡` / `⚠️`. أنا colorblind جزئياً (8% من الرجالة كده). لو الـ emoji وحده = معلومة، أنا مش هفرّق بين 🟢 و 🔴 على شاشة monochrome. الـ lucide icons (CheckCircle2 / XCircle / AlertCircle / AlertTriangle) في كل لون = shape-coded، تـ work حتي من غير لون. ده WCAG-compliant.

**7. الـ `text-loss dark:bg-loss/30` overrides بتـ double-apply.**
`DashboardView.tsx:475` و `:490` و `:425`. الـ pattern `border-profit dark:border-profit` بـ معنى "نفس اللون في الاتنين" = no-op. بس لما developer بـ يكتب `dark:bg-loss/30` بعد `bg-loss`، هو بيعمل override مختلف (solid red في light، 30% red في dark). ده inconsistent — في light الـ alert أحمر صريح، في dark نضيف. **المفروض الاتنين متسقين.**

**8. الـ `R/R: <span>{rr}</span>` BUG.**
`DashboardView.tsx:446`:
```tsx
<span className="text-muted-foreground">R/R: <span className="font-mono font-bold">{rr}</span></span>
```
بس `rr` مـ تعرّف على line 409:
```tsx
const rr = (stock as Record<string, unknown>).rrRatio as number | undefined;
```
والـ display اللي بـ يتـ format موجود على line 410:
```tsx
const rrDisplay = rr != null ? rr.toFixed(2) : '—';
```
يعني الـ `{rr}` هتـ render `undefined` أو `[object Object]` لو الـ value موجودة كـ number. الـ variable الصحيح هو `rrDisplay`. ده bug صريح — لازم يـ fix فوراً.

**9. الـ `<details>` بـ default browser styling.**
Native `<details>` بـ يـ render مثلث ▶ من الـ OS. ده مش متسق مع باقي الـ design system. كمان الـ summary بـ يحمل معلومة "تنبيهات أسهمك الشخصية" — مينفعش تـ toggle وتختفي.

**10. مفيش consistent "last updated" timestamps.**
في الـ dashboard و الـ radar، مفيش timestamp visible للـ "آخر تحديث". أنا بـ محتاج أعرف لو الـ price اللي بـ أشوفه من 5 ثواني ولا من 30 دقيقة. الـ `useVisibilityAwarePolling` بـ يـ poll كل 60s بس المستخدم مش بـ يشوف الـ last fetch.

### 2.3 اقتراحات عم رشاد للتحسين

**Contrast و readability (mandatory):**
1. Min text size: 12px (`text-xs`). ممنوع `text-[9px]` و `text-[10px]` except على meta-counters بـ opacity.
2. كل الـ informational alerts بـ `bg-X/5 border-X/30` — soft tints. الـ solid `bg-X` بس للـ critical (loss فعلية، stop hit).
3. كل الـ badges: `bg-X/15 text-X border-X/20` (soft + bordered) — ده الـ pattern اللي FlowPhaseTag.tsx و RiskRewardBadge.tsx بيـستخدموه، والنتيجة ممتازة. التزموا بيه.

**Color semantics (mandatory):**
1. ممنوع `blue` / `slate` / `gray` hardcoded — استخدموا `--primary`, `--profit`, `--loss`, `--warning`, `--whale`, `--muted-foreground`.
2. Buy/Strong Buy = درجات الأخضر (`--profit` solid + `--profit/15` soft).
3. Hold/Wait = amber (`--warning`).
4. Sell/Strong Sell/Avoid = درجات الأحمر (`--loss`).
5. مفيش signal = `bg-muted text-muted-foreground`.

**Information architecture (mandatory):**
1. الـ personal alerts (MyStocksBriefing) = top-of-fold دائماً، مش خلف toggle.
2. كل screen فيه "آخر تحديث: HH:MM:SS" timestamp visible.
3. كل الـ price displays بـ flash لما تتغير (FlashingPriceCell pattern موجود — extend لكل مكان).

**Bugs to fix immediately (priority P0):**
1. `DashboardView.tsx:446` — `{rr}` → `{rrDisplay}`. ده bug صريح.
2. `DashboardView.tsx:415` — `border-r-blue-500` → `border-r-profit/60` (للـ Buy العادي، أخضر فاتح بدل أزرق).
3. `TopBar.tsx:399` — `text-slate-600` → `text-muted-foreground`.
4. `DashboardView.tsx:425` — شيل `dark:bg-X/40 dark:text-X` redundant overrides.

---

## الباب 3: التوافق (The Consensus)

> *الاتنين اتفقنا على 90% من الـ diagnosis. الـ 10% الباقية (أنا بـ أحب micro-interaction أكتر، عم رشاد بـ يحب data density أكتر) سهل يتـ reconcile لما الـ goals متبادلة:*
>
> **"منصة استثمار احترافية بـ هوية بصرية متّسقة، سهلة على العين، صارمة مع البيانات."**

### 3.1 الستايل النهائي المتفق عليه

**Single source of truth:** كل لون، خط، radius، spacing، animation بـ ييجي من `globals.css` tokens أو `tailwind.config.ts`. مفيش hardcoded values في الـ components.

**Identity:** Emerald + cyan financial palette. Bloomberg-terminal feel in dark mode, Stripe-clean in light mode. Tabular numerics everywhere.

**Mood:** Calm, confident, professional. No neon, no emojis in functional UI, no decorative gradients. The data is the design.

### 3.2 Color Palette (final)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--background` | `0 0% 100%` | `160 5% 6%` | Page bg |
| `--foreground` | `160 5% 10%` | `160 5% 95%` | Default text |
| `--card` | `0 0% 100%` | `160 5% 9%` | Card bg |
| `--primary` | `160 84% 39%` | `160 84% 39%` | Brand emerald (CTA, links) |
| `--profit` | `160 84% 39%` | `160 84% 50%` | Gains / Buy / Up |
| `--loss` | `0 84% 60%` | `0 84% 67%` | Losses / Sell / Down |
| `--warning` | `38 92% 50%` | `38 92% 55%` | Hold / Caution |
| `--whale` | `189 95% 43%` | `189 95% 55%` | Institutional liquidity |
| `--muted-foreground` | `160 3% 45%` | `160 5% 64%` | Secondary text |

**Soft badge pattern (mandatory):**
```
profit soft:  bg-profit/15  text-profit  border-profit/20
loss soft:    bg-loss/15    text-loss    border-loss/20
warning soft: bg-warning/15 text-warning border-warning/20
whale soft:   bg-whale/15   text-whale   border-whale/20
muted:        bg-muted      text-muted-foreground  border-border
```

**Solid badge pattern (reserved for critical / CTA only):**
```
profit solid: bg-profit  text-profit-foreground
loss solid:   bg-loss    text-loss-foreground
```

**Forbidden colors:**
- ❌ `blue-*`, `indigo-*`, `sky-*`, `cyan-*` (Tailwind direct — use `--whale` token instead)
- ❌ `slate-*`, `gray-*`, `zinc-*`, `neutral-*` (use `--muted-foreground` / `--border`)
- ❌ `emerald-*`, `green-*`, `red-*`, `amber-*` direct (use `--profit` / `--loss` / `--warning`)
- ❌ `purple-*`, `pink-*`, `rose-*`, `fuchsia-*` (decorative — not financial)
- ❌ `gradient-to-*` except the body radial in `globals.css:132-142`

### 3.3 Typography Scale (final)

| Class | px | Weight | Use |
|---|---|---|---|
| `text-[11px]` | 11 | 600 | Count badges only (`(5)`, `(12)`) |
| `text-xs` | 12 | 500 | Meta, timestamps, currency suffix |
| `text-xs` | 12 | 600 | Small badges, dropdown items |
| `text-sm` | 14 | 400 | Body text, table cells |
| `text-sm` | 14 | 600 | Table headers, card subtitles |
| `text-base` | 16 | 600 | Section titles |
| `text-base` | 16 | 700 | Card titles |
| `text-lg` | 18 | 700 | Page H1 (rare) |
| `text-xl` | 20 | 800 | Hero numbers (price, P&L) |
| `text-2xl` | 24 | 800 | Dashboard hero metrics |

**Fonts:**
- Primary (Arabic + Latin): `Cairo` — already imported in `globals.css:8`.
- Mono (numbers, tickers): `JetBrains Mono` — already mapped in `tailwind.config.ts:95`.
- Fallback chain: `Cairo → Tajawal → system-ui → sans-serif`.

**Mandatory numerics:**
- All price/P&L/percentage displays: `font-mono tabular-nums` (or wrap in `PriceDisplay`).
- All Arabic text in body: Cairo (default body font).
- Tracking: `tracking-tight` (`-0.02em`) on headings (already in `globals.css:146`).

### 3.4 Spacing System (final)

**4/8 grid — no exceptions:**
| Token | px | Use |
|---|---|---|
| `gap-1` | 4 | Icon + adjacent text inline |
| `gap-1.5` | 6 | Icon + tiny label |
| `gap-2` | 8 | Inline buttons, label + value |
| `gap-3` | 12 | Within a card, between field rows |
| `gap-4` / `space-y-4` | 16 | Between cards, section spacing |
| `gap-6` | 24 | Hero block separators (rare) |
| `gap-8` | 32 | Page top/bottom padding |

**Page padding:**
- Mobile: `p-3` (12px)
- Desktop: `p-4` (16px) — already used in `DashboardView.tsx:308, 381`.

**Card padding:**
- Tight: `p-3` (12px) — list rows, dense tables.
- Standard: `p-4` (16px) — default.
- Spacious: `p-5` (20px) — forms, dialogs.

### 3.5 Component Style Rules (final)

**Radius (only 3 values allowed):**
| Token | px | Use |
|---|---|---|
| `rounded-md` | 6 | Buttons, inputs, controls |
| `rounded-lg` | 12 | Cards, panels, sheet headers |
| `rounded-full` | 9999 | Badges, pills, avatars, status dots |
| `rounded-xl` | 16 | **Forbidden** — too large, breaks data density |

**Default radius:** `--radius: 0.75rem` (12px) — already in `globals.css:14`. Correct, don't change.

**Shadow system:**
```css
/* Default card shadow (already in globals.css:175-187) */
[data-slot="card"] {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.05),
    0 1px 2px rgba(0, 0, 0, 0.03);
}
.dark [data-slot="card"] {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.25);
}

/* Hover lift (interactive cards only — opt-in via .card-hover) */
.card-hover:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
  transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
}
```
Forbidden: neon glow, multi-layer colored shadows, blur > 8px on UI surfaces.

**Border:**
- Default: `border border-border` (`hsl(var(--border))` — `160 10% 90%` light / `160 5% 18%` dark).
- Active/hover: `border-primary/30` (subtle emerald tint).
- Semantic accent: `border-r-4 border-r-profit/60` (Strong Buy), `border-r-4 border-r-loss/60` (Strong Sell) — only on the opportunity cards.

### 3.6 Dark / Light Mode Rules (final)

**1. Don't repeat yourself with `dark:` overrides of the same token.**
```tsx
// ❌ FORBIDDEN — these are no-ops, signal distrust of the token system
className="text-profit dark:text-profit"
className="bg-profit/10 dark:bg-profit/10"

// ✅ CORRECT — the token auto-swaps in dark mode
className="text-profit"
className="bg-profit/10"
```
(Found 1649 instances of this pattern — see migration plan in §4.4.)

**2. If you must override, use a different opacity for dark.**
```tsx
// ✅ Acceptable — different intent in dark mode
className="bg-profit/10 dark:bg-profit/20"  // slightly stronger tint on dark surface
```

**3. Contrast minimums (WCAG AA):**
- Body text on background: ratio ≥ 7:1 (AAA).
- Muted text on background: ratio ≥ 4.5:1 (AA).
- Badge text on badge bg: ratio ≥ 4.5:1.
- The current `--muted-foreground` light = `160 3% 45%` on `0 0% 100%` = ratio ~4.6:1. ✓ Pass.
- The current `--muted-foreground` dark = `160 5% 64%` on `160 5% 6%` = ratio ~7.8:1. ✓ Excellent.

**4. Background gradients:**
- Light: subtle radial `hsl(var(--primary) / 0.05)` at top (already in `globals.css:132-133`).
- Dark: deeper radial `hsl(var(--primary) / 0.08)` + `hsl(var(--chart-3) / 0.04)` corner glow (already in `globals.css:139-141`).
- Forbidden: full-page gradients, animated backgrounds, gradient buttons.

**5. Theme toggle:**
- Always in the top-right of the TopBar (`TopBar.tsx:389-402`).
- Icon: `Sun` in dark mode (amber), `Moon` in light (muted-foreground, NOT `slate-600`).
- Persisted via next-themes (already configured).

### 3.7 RTL-specific Rules (final)

**1. Always set `dir="rtl"` on the document root** (`<html dir="rtl">` — set in `app/layout.tsx`). Components inherit.

**2. Don't mirror directional icons manually.** Tailwind's RTL plugin (if installed) auto-flips `ml-*`/`mr-*`. If not installed, use `ps-*`/`pe-*` (padding-inline-start/end) and `ms-*`/`me-*` (margin-inline-start/end) for logical properties.

**3. Numbers + tickers always LTR.** Wrap in `<span dir="ltr">` or use `unicode-bidi: plaintext`:
```tsx
<span className="font-mono tabular-nums" dir="ltr">COMI</span>
<span className="font-mono tabular-nums" dir="ltr">15.42</span>
```
(The current `PriceDisplay.tsx:87` uses `dir="rtl"` on the wrapper — this is fine because the inner number renders correctly due to tabular-nums. But for explicit tickers in tables, prefer `dir="ltr"`.)

**4. Arrows in RTL:** `TrendingUp` / `TrendingDown` from lucide are visual metaphors that work in both LTR and RTL contexts (up = up, down = down). Don't flip them. Same for `ChevronDown` (down = open menu). DO flip `ChevronLeft` ↔ `ChevronRight` in pagination (already done correctly in `LiquidityRadarView.tsx:538,544`).

**5. Numeric prefixes:** `+` / `-` always appear before the number in LTR direction, even in RTL layout:
```tsx
// ✅ Correct — "+2.50%" not "2.50%+"
<span dir="ltr">+2.50%</span>
```

---

## الباب 4: قواعد الإلزام (Mandatory Rules)

> *كل component جديد، كل PR، كل refactor لازم يـ follows القواعد دي. أي violation = PR blocked until fixed.*

### 4.1 القواعد الذهبية (Golden Rules)

**Rule V1 — Tokens only.** كل color، radius، shadow، spacing لازم يـ comes من `globals.css` أو `tailwind.config.ts`. مفيش `text-blue-500`، مفيش `rounded-2xl`، مفيش `shadow-[0_0_20px_rgba(...)]`.

**Rule V2 — No emojis in functional UI.** الإيموجي مسموح بس في:
- الـ market flags (`🇪🇬 🇸🇦 🇰🇼 🇶🇦 🇺🇸 🪙`) — country/currency symbols.
- الـ success/error states في الـ toast notifications (one-time, dismissable).
ممنوع في: badges, status indicators, button labels, table cells, empty states. استخدموا lucide icons (`CheckCircle2`, `XCircle`, `AlertTriangle`, `Info`, `ShieldCheck`, `TrendingUp/Down`, `Layers`).

**Rule V3 — No redundant `dark:` overrides of the same token.** الـ tokens بتـ swap تلقائياً. لو محتاج override different، استخدم opacity مختلفة (`bg-profit/10 dark:bg-profit/20`).

**Rule V4 — Min text size 11px.** ممنوع `text-[9px]`, `text-[10px]`. الـ 11px بس للـ count badges بـ opacity (`opacity-70`). كل الـ readable text = `text-xs` (12px) أو أكبر.

**Rule V5 — Tabular numerics everywhere.** أي رقم (price, P&L, %, volume, R/R, count) لازم `font-mono tabular-nums` أو `class="tabular-nums"` (مفعّل global على body).

**Rule V6 — Two badge variants only.**
- Soft (default): `bg-X/15 text-X border-X/20` — for info, status, tags.
- Solid (critical only): `bg-X text-X-foreground` — for Strong Buy/Sell, critical errors, primary CTA.

**Rule V7 — `dir="rtl"` on the root.** كل الـ text بـ inherits RTL. الـ numbers/tickers بـ تتـ wrap في `<span dir="ltr">`.

**Rule V8 — Accessibility first.** كل interactive element لازم:
- `focus-visible:ring-2 focus-visible:ring-ring` (مفعّل global في `globals.css`).
- `aria-label` على icon-only buttons.
- `role` + `aria-live` على dynamic regions (already in `UnifiedEmptyState.tsx:63-64`).
- Color contrast ≥ 4.5:1 (AA) — verified in §3.6.

### 4.2 ممنوع (Anti-Patterns)

**AP1 — Hardcoded Tailwind colors.**
```tsx
// ❌
className="text-slate-600 bg-blue-50 border-r-emerald-500"
// ✅
className="text-muted-foreground bg-primary/5 border-r-profit/60"
```
**Migration:** 45 ملف فيه `text-slate-*` (see file list in §4.4). كلهم لازم يـ fix.

**AP2 — Redundant dark: overrides.**
```tsx
// ❌
className="text-profit dark:text-profit bg-profit/10 dark:bg-profit/10"
// ✅
className="text-profit bg-profit/10"
```
**Migration:** 1649 occurrence في 146 ملف. ممكن يـ regex-replace بأمان.

**AP3 — Emojis in badges.**
```tsx
// ❌
{ label: 'شراء', tone: 'profit', emoji: '🟢' }
// ✅
{ label: 'شراء', tone: 'profit', Icon: CheckCircle2 }
```
**Migration:** `SignalBadge.tsx`, `StockDetailDrawer.tsx`, `LiquidityRadarView.tsx:90-94`.

**AP4 — Solid bg on informational alerts.**
```tsx
// ❌ — aggressive red on a "market defensive" info box
className="border-loss bg-loss"
// ✅ — soft tint + bordered
className="border-loss/30 bg-loss/5"
```
**Migration:** `DashboardView.tsx:475, 490`.

**AP5 — Native `<details>` element.**
```tsx
// ❌ — uses OS triangle, not in design system
<details><summary>...</summary></details>
// ✅ — use shadcn Accordion
<Accordion type="single" collapsible>
  <AccordionItem value="alerts">
    <AccordionTrigger>...</AccordionTrigger>
    <AccordionContent>...</AccordionContent>
  </AccordionItem>
</Accordion>
```

**AP6 — Animated chaos.**
```tsx
// ❌ — 3 simultaneous animations
className="bg-profit/20 text-profit ring-1 ring-profit/40 animate-pulse"
{isUp && <span className="animate-bounce">▲</span>}
// ✅ — single soft transition
className="bg-profit/15 text-profit transition-colors duration-300"
{isUp && <ArrowUp className="size-3" />}
```

**AP7 — Latin developer artifacts in user-facing UI.**
```tsx
// ❌
<span className="font-mono uppercase tracking-widest">WYCKOFF-RADAR-V4</span>
// ✅ — Arabic user-facing label, or remove entirely
<span className="font-mono text-xs text-muted-foreground">رادار حيّ</span>
```

**AP8 — Magic numbers in layout.**
```tsx
// ❌
maxHeight="calc(100vh - 280px)"
// ✅ — use Tailwind responsive utilities or named tokens
className="max-h-[calc(100vh-280px)]"  // at minimum, extract to a constant
```

**AP9 — Mixed radius on the same screen.**
```tsx
// ❌ — same screen uses rounded-md, rounded-lg, rounded-xl
className="rounded-xl"  // container
className="rounded-md"  // button inside
className="rounded-lg"   // pill inside button
// ✅ — 2 values only (controls = rounded-md, containers = rounded-lg)
```

**AP10 — Hardcoded English in Arabic UI.**
```tsx
// ❌
<span>WYCKOFF-RADAR-V4</span>
<button>Apply Filters</button>
// ✅
<span>رادار حيّ</span>
<button>تطبيق الفلاتر</button>
```

### 4.3 When you create a NEW component — checklist

**Before opening a PR, verify:**

- [ ] Uses only design tokens (`--profit`, `--loss`, etc.) — no `text-blue-*`, `bg-emerald-*`, `text-slate-*`.
- [ ] No `dark:X-X` overrides of the same token (e.g., `text-profit dark:text-profit`).
- [ ] No emojis (except market flags).
- [ ] Uses lucide-react icons consistently (not a mix of lucide + emoji + unicode glyphs).
- [ ] Min text size 11px (`text-[11px]`); readable text 12px+ (`text-xs` minimum).
- [ ] All numbers wrapped in `tabular-nums` (or `font-mono tabular-nums`).
- [ ] `dir="rtl"` set on root, `dir="ltr"` on numeric/ticker spans where needed.
- [ ] Radius uses only `rounded-md` (controls), `rounded-lg` (cards), `rounded-full` (badges).
- [ ] Shadows use only the global `[data-slot="card"]` system or `.card-hover` opt-in.
- [ ] Badges use the soft pattern (`bg-X/15 text-X border-X/20`) by default.
- [ ] Focus states use `focus-visible:ring-2 focus-visible:ring-ring`.
- [ ] Loading states use `<UnifiedEmptyState variant="loading" />` or `<Skeleton>` with shimmer.
- [ ] Error states use `<UnifiedEmptyState variant="error" />`.
- [ ] If it's a list/table: uses `<UnifiedTable>` from `src/components/shared/UnifiedTable.tsx`.
- [ ] If it's a drawer: uses shadcn `<Sheet>` via `StockDetailDrawer` or `FilterDrawer`.
- [ ] If it's a price display: uses `<PriceDisplay>`.
- [ ] If it's a signal: uses `<SignalBadge>`.
- [ ] If it's a flow phase: uses `<FlowPhaseTag>`.
- [ ] If it's a R/R ratio: uses `<RiskRewardBadge>`.
- [ ] If it's an empty state: uses `<UnifiedEmptyState>`.
- [ ] If it's a delta/change: uses `<DeltaBadge>`.
- [ ] If it's an action overflow menu: uses `<ActionMenu>`.

**If the component is not in the unified library** (`src/components/shared/ui/index.ts`), build it there FIRST, then use it. No ad-hoc per-screen components.

### 4.4 Migration Plan — existing violations

**Phase 1 (P0 — bugs + visibility-breaking):**
1. `DashboardView.tsx:446` — `{rr}` → `{rrDisplay}` (functional bug).
2. `DashboardView.tsx:415` — `border-r-blue-500` → `border-r-profit/60` (color semantics violation — Rule 30).
3. `DashboardView.tsx:475` — `bg-loss` solid on info alert → `bg-loss/5 border-loss/30` (contrast).
4. `TopBar.tsx:399` — `text-slate-600` → `text-muted-foreground` (dark mode break).
5. `SignalBadge.tsx:41-47` — remove emojis, add lucide icons.
6. `LiquidityFlashCell.tsx:66-77` — remove `animate-pulse` + `animate-bounce`.

**Phase 2 (P1 — visual consistency):**
7. `DashboardView.tsx:490-497` — replace `<details>` with shadcn Accordion (or move `MyStocksBriefing` to top-of-fold unconditionally).
8. `LiquidityRadarView.tsx:597` — remove "WYCKOFF-RADAR-V4" or translate to "رادار حيّ".
9. `LiquidityRadarView.tsx:90-94` — replace bucket filter emojis with lucide icons.
10. `StockDetailDrawer.tsx:65` — replace `'📈'` fallback with a lucide icon (`CandlestickChart`).
11. `DashboardView.tsx:425` — remove redundant `dark:text-profit dark:bg-primary/40` overrides.
12. Audit radius usage on `LiquidityRadarView.tsx` — standardize on `rounded-lg` for containers, `rounded-md` for controls.

**Phase 3 (P2 — typography polish):**
13. Audit all `text-[9px]` and `text-[10px]` — bump to `text-[11px]` minimum.
14. Audit all `text-slate-*` (45 files) — replace with `text-muted-foreground`.
15. Audit all `dark:text-(profit|loss|warning|primary)` redundant overrides (146 files, 1649 occurrences) — remove where the dark: value matches the light: value.

**Phase 4 (P3 — long-tail consistency):**
16. Audit `<details>` usage across the codebase — replace with shadcn Accordion.
17. Standardize spacing rhythm — `space-y-4` between sections, `gap-2` for inline controls.
18. Add "آخر تحديث" timestamp to all data-driven screens (dashboard, radar, stocks).
19. Extend `FlashingPriceCell` pattern to every price display (currently only in radar).

---

## الملخص (Executive Summary)

الـ design system الحالي فيه **أساس قوي** (tokens, dark mode, tabular numerics, card polish). الـ problems الرئيسية هي:
1. **Hardcoded colors** (blue/slate/emerald direct) بـ تكسر الـ token system — مش widespread بس خطير.
2. **Redundant `dark:` overrides** (1649 occurrence) = code smell indicating distrust of tokens.
3. **Emojis في functional UI** (badges, table cells, fallbacks) = يكسر professionalism.
4. **Text تحت 10px** = مش readable لكبار السن و low-DPI screens.
5. **Inconsistent radius** (`rounded-md` / `rounded-lg` / `rounded-xl` على نفس الـ screen).
6. **Visual clutter** في `LiquidityFlashCell` (3 simultaneous animations).
7. **One functional bug** في `DashboardView.tsx:446` (`rr` vs `rrDisplay`).

الـ consensus: **tokens صارمة، lucide icons، 2 قيم radius بس، min text 11px، soft badges افتراضياً، solid للـ critical فقط، RTL مع LTR على الأرقام.**

المهاجر الـ 4 phases (P0 → P3) بـ covers كل الـ violations الموجودة. الـ Phase 1 (bugs + visibility-breaking) لازم يـ done within 1 sprint. الباقي ممكن يـ rollout تدريجياً.

**Final tagline:** *"البيانات هي التصميم. كل عنصر بصري لازم يخدم قرار استثماري، مش يـ decorateه."*

— سارة & عم رشاد، 2026-10-12

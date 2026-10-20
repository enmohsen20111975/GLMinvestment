/**
 * lib/persona-config.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.3): Canonical persona configuration.
 * ----------------------------------------------------------------------------
 * قبل كده: persona config كان متـفرّق في PersonaTab.tsx (lines 155-184) و
 * مـكرّر في أكتر من مكان:
 *   - PersonaCard component (line 155): persona type + theme + emoji/label
 *   - PersonaTableView (line 765): _personaKey mapping
 *   - PersonaTab body (line 174): isInvestor check + theme
 *   - ExecutiveReportView (line 301): persona type validation
 *   - PredictionTrackingDashboard (line 702): per-persona stats computation
 *
 * فيه bug مشهور: trailing spaces في `'text-profit '`, `'border-profit '`,
 * `'text-warning '`, `'border-warning '` — نفس الباج بتاع helpers.ts. هنا
 * اتصلّح: مفيش trailing spaces و الـ classes بـ تـعمل صح.
 *
 * Migration (Phase 2): كل الأماكن اللي بتـعرّف persona themes هـ تستورد من هنا.
 * ============================================================================
 */

// ============================================================
// Types
// ============================================================

/**
 * 3 personas أساسية في المنصة:
 *   - 'conservative' → المستثمر (أفق طويل: 6-12 شهر)
 *   - 'balanced'     → المتوازن (أفق متوسط: 2-6 أسابيع)
 *   - 'gambler'      → المضارب (أفق قصير: 1-5 أيام)
 *
 * ملاحظة تاريخية: 'investor' كان alias قديم لـ 'conservative'. الكود
 * الحالي بـ يـ support الاتنين للـ backward compat. الـ canonical الجديد
 * بـ يستخدم 'conservative' بس.
 */
export type Persona = 'conservative' | 'balanced' | 'gambler';

/**
 * Legacy alias للـ backward compat. 'investor' == 'conservative'.
 * @deprecated استخدم 'conservative' بدل ده.
 */
export type LegacyPersona = Persona | 'investor';

/**
 * Key for analysisJson (الـ backend بـ يستخدم 'investor' و 'gambler' بس،
 * من غير 'balanced'). الـ balanced بـ يـmap لـ 'gambler' كـ approximation.
 */
export type AnalysisJsonKey = 'investor' | 'gambler';

/**
 * Theme object لكل persona — كل الـ info اللي الـ UI محتاجها.
 */
export interface PersonaTheme {
  /** الـ emoji اللي بـ يـمثّل الـ persona في الـ UI */
  emoji: string;
  /** الـ label عربي للـ persona */
  label: string;
  /** لون accent (text color) */
  accent: string;
  /** خلفية accent (background) */
  accentBg: string;
  /** حدود accent (border color) */
  accentBorder: string;
  /** الأفق الزمني للتوقع بالـ persona ده */
  timeframe: string;
  /** الأفق الزمني بالـ English (للـ logs + APIs) */
  timeframeEn: 'long' | 'mid' | 'short';
  /** وصف قصير للـ persona (للـ tooltips + empty states) */
  description: string;
}

// ============================================================
// Canonical PERSONA_THEMES map
// ============================================================

/**
 * الـ canonical persona themes. لكل persona فيه:
 * - emoji: 🛡️ للمستثمر، ⚖️ للمتوازن، 🎯 للمضارب
 * - label: المستثمر، المتوازن، المضارب
 * - accent: text color class (مفيش trailing spaces!)
 * - accentBg: background color class
 * - accentBorder: border color class
 * - timeframe: الأفق الزمني عربي
 * - timeframeEn: الأفق الزمني إنجليزي
 * - description: وصف قصير
 *
 * @example
 * const theme = PERSONA_THEMES[persona];
 * <span className={cn(theme.accentBg, theme.accentBorder)}>
 *   {theme.emoji} {theme.label}
 * </span>
 */
export const PERSONA_THEMES: Record<Persona, PersonaTheme> = {
  conservative: {
    emoji: '🛡️',
    label: 'المستثمر',
    accent: 'text-profit',
    accentBg: 'bg-profit/10',
    accentBorder: 'border-profit',
    timeframe: '6-12 شهر',
    timeframeEn: 'long',
    description: 'أفق طويل الأمد — أسهم أساسية بـ fundamentals قوية و stability عالي.',
  },
  balanced: {
    emoji: '⚖️',
    label: 'المتوازن',
    accent: 'text-warning',
    accentBg: 'bg-warning/10',
    accentBorder: 'border-warning',
    timeframe: '2-6 أسابيع',
    timeframeEn: 'mid',
    description: 'أفق متوسط — مزيج بين الأسهم الأساسية وفرص النمو.',
  },
  gambler: {
    emoji: '🎯',
    label: 'المضارب',
    accent: 'text-fuchsia-700 dark:text-fuchsia-400',
    accentBg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    accentBorder: 'border-fuchsia-200 dark:border-fuchsia-900',
    timeframe: '1-5 أيام',
    timeframeEn: 'short',
    description: 'أفق قصير الأمد — مضاربة على السيولة و الـ momentum.',
  },
} as const;

// ============================================================
// Helpers
// ============================================================

/**
 * بيعمل normalize لأي قيمة persona (ممكن legacy 'investor') لـ Persona
 * canonical. 'investor' بـ يـرجّع 'conservative'.
 *
 * @example
 * normalizePersona('investor')   // → 'conservative'
 * normalizePersona('balanced')   // → 'balanced'
 * normalizePersona('gambler')     // → 'gambler'
 * normalizePersona('invalid')    // → 'balanced' (default آمن)
 */
export function normalizePersona(p: string | null | undefined): Persona {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'conservative' || s === 'investor') return 'conservative';
  if (s === 'gambler') return 'gambler';
  // Default آمن — balanced في وسط الطيف
  return 'balanced';
}

/**
 * بيرجّع الـ analysisJson key المناسب للـ persona.
 * - 'conservative' → 'investor' (الـ backend بـ يستخدم 'investor')
 * - 'balanced' → 'gambler' (approximation — مفيش 'balanced' في الـ backend)
 * - 'gambler' → 'gambler'
 *
 * @example
 * const key = personaToAnalysisJsonKey('conservative');  // → 'investor'
 * analysisJson[key]  // { score, entry, target, ... }
 */
export function personaToAnalysisJsonKey(p: Persona | LegacyPersona): AnalysisJsonKey {
  const normalized = normalizePersona(p);
  return normalized === 'conservative' ? 'investor' : 'gambler';
}

/**
 * بيرجّع الـ PersonaTheme الكامل للـ persona.
 *
 * @example
 * const theme = getPersonaTheme('conservative');
 * <Card className={cn('border-2', theme.accentBorder)}>...</Card>
 */
export function getPersonaTheme(p: Persona | LegacyPersona | string | null | undefined): PersonaTheme {
  return PERSONA_THEMES[normalizePersona(p)];
}

/**
 * بيرجّع true لو الـ persona ده long-term (conservative/investor).
 * للـ فلاتر اللي بـ تـفصل بين "أفق طويل" و "أفق قصير".
 *
 * @example
 * if (isLongTermPersona(persona)) {
 *   // فلترة الأسهم الشرائية بس
 *   items.filter(i => isBuySignal(i.signal));
 * }
 */
export function isLongTermPersona(p: Persona | LegacyPersona | string | null | undefined): boolean {
  return normalizePersona(p) === 'conservative';
}

/**
 * بيرجّع true لو الـ persona ده short-term (gambler).
 */
export function isShortTermPersona(p: Persona | LegacyPersona | string | null | undefined): boolean {
  return normalizePersona(p) === 'gambler';
}

/**
 * قائمة كل personas (للـ Tab selectors + filters).
 *
 * @example
 * PERSONA_OPTIONS.map(p => <TabsTrigger key={p.value} value={p.value}>{p.theme.emoji} {p.theme.label}</TabsTrigger>)
 */
export const PERSONA_OPTIONS: ReadonlyArray<{
  value: Persona;
  theme: PersonaTheme;
}> = [
  { value: 'conservative', theme: PERSONA_THEMES.conservative },
  { value: 'balanced', theme: PERSONA_THEMES.balanced },
  { value: 'gambler', theme: PERSONA_THEMES.gambler },
] as const;

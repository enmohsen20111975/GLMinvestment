/**
 * visual-templates.ts — قوالب بصرية احترافية لكل ميزة
 * ====================================================================
 *
 * كل ميزة ليها:
 *   - gradient (خلفية متدرّجة)
 *   - accentColor (لون مميز)
 *   - textColor (لون النص الأساسي)
 *   - numberColor (لون الأرقام)
 *   - ctaGradient (gradient للزر)
 *   - emoji
 *   - bgPattern (pattern زخرفي)
 */

export interface VisualTemplate {
  id: string;
  name: string;
  emoji: string;
  gradient: string; // canvas gradient stops
  accentColor: string;
  accentColor2: string;
  textColor: string;
  numberColor: string;
  ctaGradient: string;
  cardBg: string; // خلفية الكروت الداخلية
  borderColor: string;
  glowColor: string;
}

export const VISUAL_TEMPLATES: Record<string, VisualTemplate> = {
  radar: {
    id: 'radar',
    name: 'رادار السيولة',
    emoji: '🛰️',
    gradient: '#0c1445, #1e1b4b, #0369a1',
    accentColor: '#0ea5e9',
    accentColor2: '#0369a1',
    textColor: '#ffffff',
    numberColor: '#fbbf24',
    ctaGradient: '#0ea5e9, #0369a1',
    cardBg: 'rgba(14, 165, 233, 0.15)',
    borderColor: 'rgba(14, 165, 233, 0.4)',
    glowColor: '#0ea5e9',
  },
  predictions: {
    id: 'predictions',
    name: 'التوقعات الذكية',
    emoji: '🎯',
    gradient: '#1a0033, #2d1b4e, #6d28d9',
    accentColor: '#8b5cf6',
    accentColor2: '#6d28d9',
    textColor: '#ffffff',
    numberColor: '#a78bfa',
    ctaGradient: '#8b5cf6, #6d28d9',
    cardBg: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
    glowColor: '#8b5cf6',
  },
  portfolio: {
    id: 'portfolio',
    name: 'المحفظة الذكية',
    emoji: '💼',
    gradient: '#001a0d, #022c1c, #047857',
    accentColor: '#10b981',
    accentColor2: '#047857',
    textColor: '#ffffff',
    numberColor: '#34d399',
    ctaGradient: '#10b981, #047857',
    cardBg: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    glowColor: '#10b981',
  },
  risk: {
    id: 'risk',
    name: 'حاسبة المخاطر',
    emoji: '🛡️',
    gradient: '#1c1300, #2d1b00, #b45309',
    accentColor: '#f59e0b',
    accentColor2: '#b45309',
    textColor: '#ffffff',
    numberColor: '#fcd34d',
    ctaGradient: '#f59e0b, #b45309',
    cardBg: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    glowColor: '#f59e0b',
  },
  stockcard: {
    id: 'stockcard',
    name: 'كارت السهم',
    emoji: '🪙',
    gradient: '#1a001a, #2d0a2d, #9d174d',
    accentColor: '#ec4899',
    accentColor2: '#9d174d',
    textColor: '#ffffff',
    numberColor: '#f9a8d4',
    ctaGradient: '#ec4899, #9d174d',
    cardBg: 'rgba(236, 72, 153, 0.15)',
    borderColor: 'rgba(236, 72, 153, 0.4)',
    glowColor: '#ec4899',
  },
  alerts: {
    id: 'alerts',
    name: 'مركز التنبيهات',
    emoji: '🔔',
    gradient: '#1a0000, #2d0000, #991b1b',
    accentColor: '#ef4444',
    accentColor2: '#991b1b',
    textColor: '#ffffff',
    numberColor: '#fca5a5',
    ctaGradient: '#ef4444, #991b1b',
    cardBg: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
    glowColor: '#ef4444',
  },
  exit: {
    id: 'exit',
    name: 'رادار الخروج',
    emoji: '🚪',
    gradient: '#001a1a, #002d2d, #0f766e',
    accentColor: '#14b8a6',
    accentColor2: '#0f766e',
    textColor: '#ffffff',
    numberColor: '#5eead4',
    ctaGradient: '#14b8a6, #0f766e',
    cardBg: 'rgba(20, 184, 166, 0.15)',
    borderColor: 'rgba(20, 184, 166, 0.4)',
    glowColor: '#14b8a6',
  },
  academy: {
    id: 'academy',
    name: 'أكاديمية التداول',
    emoji: '🎓',
    gradient: '#0a0a2d, #1a1a4d, #4338ca',
    accentColor: '#6366f1',
    accentColor2: '#4338ca',
    textColor: '#ffffff',
    numberColor: '#a5b4fc',
    ctaGradient: '#6366f1, #4338ca',
    cardBg: 'rgba(99, 102, 241, 0.15)',
    borderColor: 'rgba(99, 102, 241, 0.4)',
    glowColor: '#6366f1',
  },
  trades: {
    id: 'trades',
    name: 'صفقات ناجحة',
    emoji: '📈',
    gradient: '#001a0d, #022c1c, #047857',
    accentColor: '#10b981',
    accentColor2: '#059669',
    textColor: '#ffffff',
    numberColor: '#fbbf24',
    ctaGradient: '#10b981, #059669',
    cardBg: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    glowColor: '#10b981',
  },
};

/** جلب template حسب الميزة */
export function getVisualTemplate(feature: string): VisualTemplate {
  return VISUAL_TEMPLATES[feature] || VISUAL_TEMPLATES.radar;
}

/** قائمة كل الـ templates (للـ UI) */
export const TEMPLATE_LIST = Object.values(VISUAL_TEMPLATES);

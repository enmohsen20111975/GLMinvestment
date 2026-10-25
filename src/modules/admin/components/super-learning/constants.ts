/**
 * super-learning/constants.ts
 * ==========================
 * Static display constants for the Super Learning System:
 * - PERSONA_INFO: Arabic labels + descriptions for each of the 7 personas.
 * - PARAM_CONFIG: slider config (min/max/step) for each backtest parameter.
 * - COLORS: hex colors for the recharts charts (winRate, winners, losers, ...).
 * - PERSONA_BENCHMARK_DATA: static estimates (win rate / profit factor / ...)
 *   for the 3 benchmark personas (conservative / balanced / gambler).
 * - PERSONA_BENCHMARK_META: icon/emoji/color/arLabel for each benchmark persona.
 *
 * All values are display-only (no fetch / no state).
 */
import { Shield, Scale, Flame } from 'lucide-react';
import type { BacktestParameters, PersonaKey } from '@/hooks/useSuperLearningData';
import type { PersonaInfoEntry, PersonaBenchmarkStatic } from './types';

// معلومات الشخصيات
export const PERSONA_INFO: Record<string, PersonaInfoEntry> = {
  conservative: {
    ar: 'المستثمر',
    en: 'Conservative',
    description: 'حماية رأس المال هي الأولوية القصوى. صفقات قليلة ومدروسة المخاطر.',
    risk_level: 'low',
    color: 'blue',
    icon: 'Shield'
  },
  balanced: {
    ar: 'المتوازن',
    en: 'Balanced',
    description: 'توازن بين العائد والمخاطر. مناسب لمعظم المستثمرين.',
    risk_level: 'medium',
    color: 'yellow',
    icon: 'Scale'
  },
  gambler: {
    ar: 'المضارب',
    en: 'Gambler',
    description: 'مخاطر عالية لعوائد عالية. للتجارب والمخاطرة فقط.',
    risk_level: 'high',
    color: 'red',
    icon: 'Flame'
  },
  smart: {
    ar: 'الذكي',
    en: 'Smart',
    description: 'يعتمد على AI والتحليل المتقدم. قرارات مبنية على البيانات.',
    risk_level: 'medium',
    color: 'purple',
    icon: 'Brain'
  },
  scalper: {
    ar: 'السريع',
    en: 'Scalper',
    description: 'صفقات سريعة مع أهداف صغيرة. يتطلب متابعة مستمرة.',
    risk_level: 'high',
    color: 'orange',
    icon: 'Zap'
  },
  trend_follower: {
    ar: 'المتتبع',
    en: 'Trend Follower',
    description: 'يتبع الاتجاه العام. يشتري في الصعود ويبيع في الهبوط.',
    risk_level: 'medium',
    color: 'emerald',
    icon: 'TrendingUp'
  },
  contrarian: {
    ar: 'العكسي',
    en: 'Contrarian',
    description: 'يعكس الاتجاه. يشتري لما الناس تبيع ويبيع لما الناس تشتري.',
    risk_level: 'high',
    color: 'pink',
    icon: 'Reverse'
  }
};

export const PARAM_CONFIG: Record<keyof BacktestParameters, {
  ar: string;
  group: 'technical' | 'risk' | 'decision';
  min: number;
  max: number;
  step: number;
  description: string;
}> = {
  rsi_oversold: { ar: 'مستوى RSI للشراء', group: 'technical', min: 15, max: 40, step: 1, description: 'أقل مستوى RSI للشراء' },
  rsi_overbought: { ar: 'مستوى RSI للبيع', group: 'technical', min: 60, max: 85, step: 1, description: 'أعلى مستوى RSI للبيع' },
  rsi_weight: { ar: 'وزن RSI', group: 'technical', min: 5, max: 30, step: 1, description: 'تأثير إشارة RSI' },
  macd_weight: { ar: 'وزن MACD', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير إشارة MACD' },
  ma_weight: { ar: 'وزن المتوسطات', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير المتوسطات' },
  bollinger_std: { ar: 'انحراف Bollinger', group: 'technical', min: 1, max: 3, step: 0.5, description: 'عدد الانحرافات' },
  bollinger_weight: { ar: 'وزن Bollinger', group: 'technical', min: 3, max: 20, step: 1, description: 'تأثير الأشرطة' },
  stop_loss_min: { ar: 'أقل Stop Loss %', group: 'risk', min: 1, max: 6, step: 0.5, description: 'أقل نسبة وقف خسارة' },
  stop_loss_max: { ar: 'أقصى Stop Loss %', group: 'risk', min: 5, max: 20, step: 0.5, description: 'أقصى نسبة وقف خسارة' },
  target_multiplier: { ar: 'مضاعف الهدف', group: 'risk', min: 1, max: 4, step: 0.5, description: 'الهدف = SL × المضاعف' },
  confidence_threshold: { ar: 'حد الثقة', group: 'decision', min: 30, max: 80, step: 5, description: 'أقل ثقة للدخول' },
  min_indicators_agree: { ar: 'أقل مؤشرات متفقة', group: 'decision', min: 1, max: 4, step: 1, description: 'عدد المؤشرات المطلوبة' },
  volume_threshold: { ar: 'حد الحجم', group: 'decision', min: 1, max: 3, step: 0.1, description: 'نسبة الحجم المطلوبة' },
  volume_weight: { ar: 'وزن الحجم', group: 'decision', min: 2, max: 15, step: 1, description: 'تأثير حجم التداول' }
};

export const COLORS = {
  winRate: '#10b981',
  winners: '#22c55e',
  losers: '#ef4444',
  return: '#f59e0b',
  conservative: '#3b82f6',
  balanced: '#eab308',
  gambler: '#ef4444',
  egx: '#8b5cf6',
  crypto: '#f97316'
};

// P39-PHASE-5: Persona Benchmarking — side-by-side comparison of the 3 personas
// Static display estimates derived from persona-dynamic.ts factors + historical EGX/Crypto behavior.

export const PERSONA_BENCHMARK_DATA: Record<PersonaKey, PersonaBenchmarkStatic> = {
  conservative: {
    riskScore: 20,
    stopFactor: 0.8,
    targetFactor: 1.2,
    maxRiskPct: 1.0,
    winRate: 78,
    profitFactor: 1.8,
    maxDrawdown: 2.5,
    avgTradesPerMonth: 8,
    totalReturn: 8.5,
    egxCeiling: 65,
    cryptoCeiling: 0,
    cashFloor: 10,
  },
  balanced: {
    riskScore: 50,
    stopFactor: 1.0,
    targetFactor: 1.0,
    maxRiskPct: 2.0,
    winRate: 72,
    profitFactor: 2.15,
    maxDrawdown: 4.8,
    avgTradesPerMonth: 15,
    totalReturn: 18.5,
    egxCeiling: 55,
    cryptoCeiling: 15,
    cashFloor: 10,
  },
  gambler: {
    riskScore: 85,
    stopFactor: 1.5,
    targetFactor: 1.8,
    maxRiskPct: 4.5,
    winRate: 62,
    profitFactor: 2.8,
    maxDrawdown: 12.0,
    avgTradesPerMonth: 30,
    totalReturn: 42.0,
    egxCeiling: 30,
    cryptoCeiling: 60,
    cashFloor: 5,
  },
};

export const PERSONA_BENCHMARK_META: Record<PersonaKey, { icon: typeof Shield; emoji: string; color: string; arLabel: string }> = {
  conservative: { icon: Shield, emoji: '🛡️', color: '#3b82f6', arLabel: 'المستثمر' },
  balanced: { icon: Scale, emoji: '⚖️', color: '#eab308', arLabel: 'المتوازن' },
  gambler: { icon: Flame, emoji: '🔥', color: '#ef4444', arLabel: 'المضارب' },
};

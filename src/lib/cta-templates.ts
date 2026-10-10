/**
 * cta-templates.ts — قوالب Call-to-Action للاستخدام في الدعوة للإجراء
 * ====================================================================
 *
 * CTAs منظمة حسب: الهدف + القناة + اللغة.
 *
 * القاعدة: يجب أن ينتهي كل إعلان بـ CTA واضح. CTA الضعيف يُضعف
 * فعالية الإعلان.
 */

export type CTAGoal = 'signup' | 'trial' | 'subscribe' | 'follow' | 'share' | 'learn';
export type CTAAudience = 'beginner' | 'intermediate' | 'pro';

interface CTATemplate {
  id: string;
  goal: CTAGoal;
  audience: CTAAudience;
  text: string;
  urgency: 'high' | 'medium' | 'low';
}

export const CTA_TEMPLATES: CTATemplate[] = [
  // === Signup (أعلى تحويل) ===
  { id: 'signup-1', goal: 'signup', audience: 'beginner', text: 'سجّل مجاناً الآن للوصول إلى المنصة', urgency: 'medium' },
  { id: 'signup-2', goal: 'signup', audience: 'beginner', text: 'انضم إلينا مجاناً — بدون بطاقة ائتمان', urgency: 'low' },
  { id: 'signup-3', goal: 'signup', audience: 'intermediate', text: 'ابدأ تجربتك المجانية لمدة 7 أيام — جميع المزايا متاحة', urgency: 'high' },
  { id: 'signup-4', goal: 'signup', audience: 'pro', text: 'جرّب المنصة الاحترافية 7 أيام مجاناً', urgency: 'high' },

  // === Trial (للـ Free users) ===
  { id: 'trial-1', goal: 'trial', audience: 'beginner', text: 'تجربة 7 أيام مجاناً — استكشف جميع المزايا', urgency: 'medium' },
  { id: 'trial-2', goal: 'trial', audience: 'intermediate', text: 'فعّل تجربتك المجانية الآن', urgency: 'high' },

  // === Subscribe (مدفوع) ===
  { id: 'sub-1', goal: 'subscribe', audience: 'intermediate', text: 'اشترك في Premium بـ 99 جنيهاً شهرياً', urgency: 'medium' },
  { id: 'sub-2', goal: 'subscribe', audience: 'pro', text: 'ترقية إلى Pro — أدوات تحليل احترافية متقدمة', urgency: 'medium' },
  { id: 'sub-3', goal: 'subscribe', audience: 'intermediate', text: 'اشترك سنوياً واحصل على شهرين مجاناً', urgency: 'high' },

  // === Follow (لزيادة المتابعين) ===
  { id: 'follow-1', goal: 'follow', audience: 'beginner', text: 'تابعنا للحصول على التحديثات والإشارات', urgency: 'low' },
  { id: 'follow-2', goal: 'follow', audience: 'intermediate', text: 'متابعتك لنا تضمن لك الأولوية في الإشعارات', urgency: 'low' },

  // === Share (viral loop) ===
  { id: 'share-1', goal: 'share', audience: 'beginner', text: 'شارك الفيديو مع مستثمر آخر', urgency: 'low' },
  { id: 'share-2', goal: 'share', audience: 'intermediate', text: 'أرسل الرابط إلى صديق — كلاكما يحصل على شهر Pro مجاناً', urgency: 'medium' },

  // === Learn (للأكاديمية) ===
  { id: 'learn-1', goal: 'learn', audience: 'beginner', text: 'تعلّم التداول من الأساسيات — مجاناً', urgency: 'low' },
  { id: 'learn-2', goal: 'learn', audience: 'beginner', text: 'ابدأ في الاستثمار عبر 8 مستويات تعليمية', urgency: 'medium' },
];

/**
 * جلب CTA حسب الهدف + الجمهور
 */
export function getCTA(goal: CTAGoal, audience: CTAAudience = 'intermediate'): CTATemplate {
  // نحاول إيجاد تطابق مثالي
  const exact = CTA_TEMPLATES.find((c) => c.goal === goal && c.audience === audience);
  if (exact) return exact;

  // البديل: أي CTA بنفس الهدف
  const byGoal = CTA_TEMPLATES.find((c) => c.goal === goal);
  if (byGoal) return byGoal;

  // البديل النهائي
  return CTA_TEMPLATES[0];
}

/**
 * جلب CTA عشوائي (للتنويع في الـ A/B testing)
 */
export function getRandomCTA(goal?: CTAGoal): CTATemplate {
  const pool = goal ? CTA_TEMPLATES.filter((c) => c.goal === goal) : CTA_TEMPLATES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * قائمة الـ CTAs حسب الهدف (للـ UI)
 */
export function getCTAsByGoal(goal: CTAGoal): CTATemplate[] {
  return CTA_TEMPLATES.filter((c) => c.goal === goal);
}

/** كل أهداف الـ CTA (للـ UI) */
export const CTA_GOALS: { value: CTAGoal; label: string; icon: string }[] = [
  { value: 'signup', label: 'تسجيل مجاني', icon: '🆓' },
  { value: 'trial', label: 'تجربة 7 أيام', icon: '⏰' },
  { value: 'subscribe', label: 'اشتراك مدفوع', icon: '💳' },
  { value: 'follow', label: 'متابعة', icon: '➕' },
  { value: 'share', label: 'مشاركة', icon: '🔁' },
  { value: 'learn', label: 'تعلّم', icon: '🎓' },
];

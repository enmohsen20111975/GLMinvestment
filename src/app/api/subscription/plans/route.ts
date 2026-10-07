import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';

/**
 * GET /api/subscription/plans?market=egx
 *
 * بيرجّع قائمة الباقات المتاحة للسوق المحدد مع الأسعار بالعملة المحلية.
 * - market: egx|tadawul|kse|qse|us|crypto|all (default: egx)
 *
 * الرد:
 *   { success, market, currency, plans: [{ tier, name_ar, price_local, price_egp, currency, billing_cycle, features }] }
 *
 * المستخدم بيشوف price_local + currency في الـ UI، لكن بيدفع price_egp عبر Paymob.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const MARKET_ALIASES: Record<string, string> = {
      kuwait: 'kse',
      kw: 'kse',
      qatar: 'qse',
      qa: 'qse',
      saudi: 'tadawul',
      ksa: 'tadawul',
      egypt: 'egx',
      usa: 'us',
    };
    const rawMarket = (url.searchParams.get('market') || 'egx').toLowerCase();
    const market = MARKET_ALIASES[rawMarket] || rawMarket;
    const validMarkets = ['egx', 'tadawul', 'kse', 'qse', 'us', 'crypto', 'gold', 'all'];
    if (!validMarkets.includes(market)) {
      return NextResponse.json(
        { success: false, error: `سوق غير صالح: ${market}. المتاح: ${validMarkets.join(', ')}` },
        { status: 400 },
      );
    }

    // نجيب كل الـ pricing rows للسوق المحدد
    // لو السوق مش egx/tadawul/kse/qse/us/crypto، نستخدم 'all' (للـ B2B)
    const pricingRows = await authDb.marketPricing.findMany({
      where: {
        OR: [{ market }, { market: 'all' }],
        is_active: true,
      },
      orderBy: [{ tier: 'asc' }, { billing_cycle: 'asc' }],
    });

    // فلترة السجلات: نفضل السجلات الخاصة بالسوق، ولو مفيش ناخذ من all (للـ B2B أو VIP fallback)
    const specificTiers = new Set(
      pricingRows.filter((p) => p.market === market).map((p) => `${p.tier}_${p.billing_cycle}`)
    );
    const filteredRows = pricingRows.filter((p) => {
      if (p.market === market) return true;
      // إذا كان من all، نأخذه فقط لو غير موجود للسوق المحدد
      return !specificTiers.has(`${p.tier}_${p.billing_cycle}`);
    });

    // تنسيق الـ plans — مميزات حقيقية ومدققة 100% من المنصة
    const TIER_INFO: Record<string, { name_ar: string; description: string; features: string[] }> = {
      premium: {
        name_ar: 'بريميوم',
        description: 'للمستثمر الجاد — رادار صانع السوق والسيولة وأهداف التوقعات',
        features: [
          'رادار صانع السوق وتدفق السيولة الذكية (تحديثات دورية)',
          'أهداف التوقعات ونقاط الدخول ووقف الخسارة (TP1, TP2, SL)',
          'رادار وسياسة الخروج الاحترافية وإشارات جني الأرباح',
          'الفاحص الشرعي الكامل وحساب زكاة وتطهير الأسهم',
          'فلاتر وتصفيات الأسهم المتقدمة (Screener Filters)',
          'إشعارات وتنبيهات تيليجرام الآلية لفرص السوق',
          'قوائم مراقبة ومحافظ استثمارية غير محدودة',
          'دعم فني ذو أولوية خلال 24 ساعة',
        ],
      },
      pro: {
        name_ar: 'برو',
        description: 'للمضارب المحترف — إنقاذ الأسهم الخاسرة وتصدير التقارير',
        features: [
          'كل مزايا باقة بريميوم بدون أي قيود',
          'محرك إنقاذ الأسهم الخاسرة الذكي (Bagholder Rescue)',
          'ماسحات سوق واستراتيجيات مخصصة (Custom Screeners)',
          'تصدير البيانات والتقارير المالية (Excel / CSV)',
          'تنبيهات فورية متعددة القنوات غير محدودة',
          'ذاكرة التداول وسجل تحليل سلوك المحفظة',
          'وصول API للاستعلامات المباشرة (1000 طلب/يوم)',
          'دعم فني فائق السرعة خلال 4 ساعات',
        ],
      },
      vip_pass: {
        name_ar: 'الباقة الشاملة VIP',
        description: 'جميع أسواق المال في اشتراك واحد (مصر + السعودية + الكويت + قطر + أمريكا + كريبتو وذهب)',
        features: [
          'وصول كامل لجميع الأسواق الـ 6 (مصر، السعودية، الكويت، قطر، أمريكا، كريبتو وذهب)',
          'رادار صانع السوق وتدفق السيولة لجميع البورصات معاً',
          'أهداف التوقعات ورادار الخروج لكافة الأسواق',
          'محرك إنقاذ الأسهم الخاسرة لجميع الأسواق',
          'قنوات تيليجرام مخصصة لكل سوق بدون قيود',
          'جميع مزايا باقة برو لكل الأسواق في اشتراك موحد',
          'خط دعم مباشر VIP عبر واتساب على مدار الساعة',
        ],
      },
      b2b_starter: {
        name_ar: 'B2B Starter',
        description: 'للشركات الصغيرة والوسطاء — API متكامل',
        features: [
          'API access (10,000 طلب/شهر)',
          '3 مستخدمين للنظام',
          'Webhook للإشارات وتنبيهات السيولة',
          'دعم إيميل مخصص خلال 48 ساعة',
        ],
      },
      b2b_pro: {
        name_ar: 'B2B Pro',
        description: 'للشركات والمحافظ الاستثمارية — سعة API أكبر',
        features: [
          'API access (100,000 طلب/شهر)',
          '10 مستخدمين للنظام',
          'تقارير دورية مخصصة ومحلل معتمد',
          'دعم مباشر عبر قناة مخصصة خلال 24 ساعة',
        ],
      },
      b2b_enterprise: {
        name_ar: 'B2B Enterprise',
        description: 'للمؤسسات المالية الكبرى — غير محدود + تخصيص كامل',
        features: [
          'API غير محدود ومعدل استعلامات فائق',
          'عدد مستخدمين غير محدود',
          'لوحة تحكم مخصصة (White-label Dashboard)',
          'مدير حساب شخصي مخصص',
          'دعم مباشر فوري على مدار الساعة',
        ],
      },
    };

    const plans = filteredRows.map((p) => {
      const info = TIER_INFO[p.tier] || { name_ar: p.tier, description: '', features: [] };
      const isVip = p.tier === 'vip_pass';
      const discountPct = isVip ? 65 : 50;
      const multiplier = isVip ? 2.85 : 2.0;
      const originalPriceLocal = Math.round(p.price_local * multiplier);

      return {
        tier: p.tier,
        name_ar: info.name_ar,
        description: info.description,
        price_local: p.price_local,
        original_price_local: originalPriceLocal,
        discount_pct: discountPct,
        price_egp: p.price_egp,
        currency: p.currency,
        billing_cycle: p.billing_cycle,
        features: info.features,
        is_vip: isVip,
        popular: p.tier === 'premium' || isVip,
      };
    });

    // نحدد العملة المعروضة حسب السوق
    const MARKET_CURRENCY: Record<string, string> = {
      egx: 'EGP',
      tadawul: 'SAR',
      kse: 'KWD',
      qse: 'QAR',
      us: 'USD',
      crypto: 'USD',
      gold: 'USD',
      all: 'USD',
    };

    return NextResponse.json({
      success: true,
      market,
      currency: MARKET_CURRENCY[market] || 'EGP',
      plans,
    });
  } catch (err) {
    // Rule 30: no error details to the client. Log server-side only.
    console.error('[subscription/plans] error:', err);
    return NextResponse.json(
      { success: false, error: 'internal_error', error_ar: 'فشل جلب الباقات' },
      { status: 500 },
    );
  }
}

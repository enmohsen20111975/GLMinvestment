export interface PlanData {
  id: string;
  name: string;
  nameAr: string;
  price: number;
  priceYearly: number;
  currency: string;
  features: string[];
  limits: {
    watchlist: number;
    portfolio: number;
    alerts: number;
    aiAnalysis: boolean;
    deepAnalysis: boolean;
    prioritySupport: boolean;
    advancedReports: boolean;
    apiAccess: boolean;
  };
}

const plans: Record<string, PlanData> = {
  free: {
    id: 'free',
    name: 'Free',
    nameAr: 'الأساسية',
    price: 0,
    priceYearly: 0,
    currency: 'EGP',
    features: [
      'قائمة مراقبة حتى 5 أسهم',
      'محفظة استثمارية واحدة',
      '3 تنبيهات أسعار',
      'تحليلات أساسية',
      'بيانات محمية'
    ],
    limits: {
      watchlist: 5,
      portfolio: 1,
      alerts: 3,
      aiAnalysis: false,
      deepAnalysis: false,
      prioritySupport: false,
      advancedReports: false,
      apiAccess: false
    }
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    nameAr: 'الاحترافية',
    price: 199,
    priceYearly: 1990,
    currency: 'EGP',
    features: [
      'قائمة مراقبة حتى 25 سهم',
      '5 محافظ استثمارية',
      '15 تنبيه أسعار',
      'تحليل فني ومالي متقدم',
      'تقارير متقدمة',
      'تحليلات ذكية',
      'دعم بالبريد الإلكتروني'
    ],
    limits: {
      watchlist: 25,
      portfolio: 5,
      alerts: 15,
      aiAnalysis: true,
      deepAnalysis: false,
      prioritySupport: false,
      advancedReports: true,
      apiAccess: false
    }
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    nameAr: 'المتقدمة',
    price: 299,
    priceYearly: 2990,
    currency: 'EGP',
    features: [
      'قائمة مراقبة غير محدودة',
      'محافظ استثمارية غير محدودة',
      'تنبيهات غير محدودة',
      'تحليل فني ومالي عميق',
      'تقارير حصرية ومتقدمة',
      'وصول مبكر للميزات',
      'دعم ذو أولوية 24/7',
      'وصول API'
    ],
    limits: {
      watchlist: 999999,
      portfolio: 999999,
      alerts: 999999,
      aiAnalysis: true,
      deepAnalysis: true,
      prioritySupport: true,
      advancedReports: true,
      apiAccess: true
    }
  },
  developer: {
    id: 'developer',
    name: 'Developer',
    nameAr: 'المطورين',
    price: 599,
    priceYearly: 5990,
    currency: 'EGP',
    features: [
      'كل ميزات الباقة المتقدمة',
      'وصول كامل لـ API',
      'Webhooks للتنبيهات',
      'بيانات لحظية (Real-time)',
      'تصدير البيانات (CSV/JSON)',
      'API Keys متعددة',
      'Rate limit عالي',
      'دعم فني مخصص للمطورين',
      'توثيق API كامل',
      'SDK بلغات متعددة'
    ],
    limits: {
      watchlist: 999999,
      portfolio: 999999,
      alerts: 999999,
      aiAnalysis: true,
      deepAnalysis: true,
      prioritySupport: true,
      advancedReports: true,
      apiAccess: true
    }
  }
};

export function getPlan(planId: string): PlanData | null {
  return plans[planId] || null;
}

export function getAllPlans(): PlanData[] {
  return Object.values(plans);
}

export { plans };

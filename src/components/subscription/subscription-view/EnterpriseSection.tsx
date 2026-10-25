/**
 * subscription-view/EnterpriseSection.tsx
 * ======================================
 * The Enterprise / Developer B2B section — a Card with a violet gradient
 * promoting the "باقة الشركات والمطورين (Enterprise & API)" plan with a
 * starting price of $99/month and a "طلب حساب مطور B2B" button that opens
 * the DeveloperContactModal.
 */
'use client';

import React from 'react';
import { Key, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MarketPricingConfig, Plan } from './types';

export interface EnterpriseSectionProps {
  currentMarket: MarketPricingConfig;
  onRequestDeveloper: (plan: Plan) => void;
}

export function EnterpriseSection({ currentMarket, onRequestDeveloper }: EnterpriseSectionProps) {
  return (
    <div className="mt-12 max-w-5xl mx-auto">
      <Card className="border-2 border-violet-500/30 from-violet-500/5 via-background to-purple-500/5 shadow-xl">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-center md:text-right">
              <div className="w-14 h-14 rounded-2xl from-violet-600 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30">
                <Key className="w-7 h-7 text-foreground" />
              </div>
              <div>
                <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                  <h3 className="text-xl font-bold">باقة الشركات والمطورين (Enterprise & API)</h3>
                  <Badge className="bg-violet-500/20 text-violet-600 dark:text-violet-300 border border-violet-500/30 text-xs">
                    B2B Solutions
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  وصول كامل لواجهة برمجة التطبيقات (API) + Webhooks للتنبيهات اللحظية + معدل استعلامات عالي + لوحة تحكم مخصصة.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 flex-shrink-0">
              <div className="text-center sm:text-right">
                <div className="text-sm text-muted-foreground">تبدأ من</div>
                <div className="text-2xl font-black text-foreground" dir="ltr">$99 <span className="text-xs text-muted-foreground font-normal">/شهر</span></div>
              </div>
              <Button
                onClick={() => {
                  onRequestDeveloper({
                    id: 'developer',
                    name: 'Developer',
                    nameAr: 'الشركات والمطورين',
                    description: 'للشركات والمؤسسات (B2B)',
                    price: currentMarket.prices.developer.monthly,
                    priceYearly: currentMarket.prices.developer.yearly,
                    cta: 'تواصل معنا',
                    features: [],
                    limits: {
                      marketCount: 'كل الأسواق',
                      watchlist: '∞',
                      portfolio: '∞',
                      alerts: '∞',
                      makerRadar: true,
                      predictions: true,
                      exitPolicy: true,
                      sharia: true,
                      screener: true,
                      bagholderRescue: true,
                      exportData: true,
                      telegram: true,
                      prioritySupport: 'مخصص',
                      apiAccess: true,
                    },
                  });
                }}
                className="from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-foreground font-bold px-6 py-5 shadow-lg shadow-violet-500/20"
              >
                <Mail className="w-4 h-4 ml-2" />
                طلب حساب مطور B2B
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

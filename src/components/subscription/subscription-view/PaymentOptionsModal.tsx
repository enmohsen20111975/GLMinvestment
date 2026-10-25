/**
 * subscription-view/PaymentOptionsModal.tsx
 * =======================================
 * Modal overlay that asks the user to pick a payment method (free trial,
 * InstaPay for Egypt only, or Paymob gateway with card / wallet).
 *
 * Calls `onStartFreeTrial` for the free-trial path, or `onPaidSubscription`
 * with 'card' / 'wallet' for the Paymob path.
 */
'use client';

import React from 'react';
import {
  CreditCard, Gift, Loader2, Wallet, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Plan, MarketPricingConfig } from './types';

export interface PaymentOptionsModalProps {
  selectedPlan: Plan;
  currentMarket: MarketPricingConfig;
  billingPeriod: 'monthly' | 'yearly';
  selectedMarketId: string;
  loading: string | null;
  onStartFreeTrial: () => void;
  onPaidSubscription: (plan: Plan, paymentType: 'card' | 'wallet') => void;
  onClose: () => void;
}

export function PaymentOptionsModal({
  selectedPlan,
  currentMarket,
  billingPeriod,
  selectedMarketId,
  loading,
  onStartFreeTrial,
  onPaidSubscription,
  onClose,
}: PaymentOptionsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl border-2 border-profit/20">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto w-16 h-16 rounded-2xl from-profit to-whale flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/30">
            <CreditCard className="w-8 h-8 text-foreground" />
          </div>
          <CardTitle className="text-xl font-bold">إتمام الاشتراك في {selectedPlan.nameAr}</CardTitle>
          <CardDescription className="text-sm">
            سوق: {currentMarket.name} — السعر:{' '}
            <span className="font-bold text-foreground" dir="ltr">
              {billingPeriod === 'yearly'
                ? `${selectedPlan.priceYearly} ${currentMarket.currencyAr} / سنة`
                : `${selectedPlan.price} ${currentMarket.currencyAr} / شهر`}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Free Trial Button */}
          <div className="p-4 rounded-xl border border-profit/20 bg-profit/5">
            <div className="flex items-center gap-3 mb-1">
              <Gift className="w-5 h-5 text-profit " />
              <span className="font-bold text-sm">تجربة مجانية</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              ابدأ فوراً بالتجربة المجانية لمدة شهر مع المزايا الأساسية
            </p>
            <Button
              className="w-full bg-profit hover:bg-profit text-white font-bold text-xs h-9"
              onClick={onStartFreeTrial}
              disabled={loading === 'free-trial'}
            >
              {loading === 'free-trial' ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <Gift className="w-4 h-4 ml-2" />
              )}
              {loading === 'free-trial' ? 'جاري التفعيل...' : 'ابدأ مجاناً الآن'}
            </Button>
          </div>

          {/* InstaPay Option for Egypt */}
          {selectedMarketId === 'egx' && (
            <div className="p-4 rounded-xl border border-purple-500/40 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary " />
                  <span className="font-bold text-sm">الدفع السريع عبر InstaPay</span>
                </div>
                <Badge className="bg-primary text-white text-xs px-2 py-0">فوري</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                حول المبلغ مباشرة لحساب إنستاباي ويتم التفعيل الفوري
              </p>
              <a
                href="https://ipn.eg/S/enmohsen20111975qnb/instapay/36uC2o"
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Button
                  className="w-full from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-foreground font-bold text-xs h-9"
                  type="button"
                >
                  ادفع عبر InstaPay
                </Button>
              </a>
              <p className="text-xs text-center text-muted-foreground mt-2 font-mono" dir="ltr">
                enmohsen20111975qnb@instapay
              </p>
            </div>
          )}

          {/* Paymob Gateway Options */}
          <div className="p-4 rounded-xl border bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-5 h-5 text-foreground" />
              <span className="font-bold text-sm">بوابة الدفع الإلكتروني (Paymob)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              دفع آمن بالبطاقات الائتمانية الدولية أو المحافظ الإلكترونية
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="from-profit to-whale hover:from-profit hover:to-whale text-foreground font-bold text-xs h-10"
                onClick={() => onPaidSubscription(selectedPlan, 'card')}
                disabled={loading === selectedPlan.id}
              >
                {loading === selectedPlan.id ? (
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                ) : (
                  <CreditCard className="w-4 h-4 ml-1" />
                )}
                بطاقة بنكية
              </Button>
              <Button
                className="from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-foreground font-bold text-xs h-10"
                onClick={() => onPaidSubscription(selectedPlan, 'wallet')}
                disabled={loading === selectedPlan.id}
              >
                {loading === selectedPlan.id ? (
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                ) : (
                  <Wallet className="w-4 h-4 ml-1" />
                )}
                محفظة إلكترونية
              </Button>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full text-xs h-9"
            onClick={onClose}
          >
            إلغاء
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

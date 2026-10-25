/**
 * subscription-view/PromoCodeCard.tsx
 * =================================
 * Promo code redemption card — input for a promo/discount code, Enter-to-
 * redeem, and 3 visual states for the submit button (idle / loading /
 * success). Calls `onRedeem` with the trimmed+uppercased code.
 */
'use client';

import React from 'react';
import { Tag, Gift, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export interface PromoCodeCardProps {
  promoCode: string;
  setPromoCode: (s: string) => void;
  promoLoading: boolean;
  promoSuccess: boolean;
  onRedeem: () => void;
}

export function PromoCodeCard({
  promoCode,
  setPromoCode,
  promoLoading,
  promoSuccess,
  onRedeem,
}: PromoCodeCardProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 pb-10">
      <Card className="overflow-hidden border-2 border-profit/20 shadow-lg shadow-emerald-500/5 bg-background/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl from-profit to-whale shadow-md shadow-emerald-500/30">
              <Tag className="w-5 h-5 text-foreground" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                هل لديك كود خصم أو ترقية؟
                <Badge className="bg-profit/15 text-profit border border-profit/20 text-xs px-2 py-0.5">
                  Promo Code
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                أدخل كود الترقية الخاص بك لتفعيل باقتك المتقدمة فوراً
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={promoCode}
              onChange={(e) => {
                setPromoCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !promoLoading && promoCode.trim()) {
                  onRedeem();
                }
              }}
              placeholder="مثال: WELCOME90"
              dir="ltr"
              className="text-center font-mono tracking-widest text-base uppercase h-11"
              maxLength={64}
              disabled={promoLoading}
              aria-label="كود الخصم"
            />
            <Button
              onClick={onRedeem}
              disabled={promoLoading || !promoCode.trim()}
              className="h-11 sm:min-w-[140px] from-profit to-whale hover:from-profit hover:to-whale text-foreground font-bold"
              type="button"
            >
              {promoLoading ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري التفعيل...
                </>
              ) : promoSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 ml-2" />
                  تم التفعيل
                </>
              ) : (
                <>
                  <Gift className="w-4 h-4 ml-2" />
                  تفعيل الكود
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

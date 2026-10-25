/**
 * subscription-view/WalletPaymentModal.tsx
 * =======================================
 * Modal overlay for the Paymob wallet payment flow. Captures the user's
 * mobile-wallet number, posts to /api/paymob/process-wallet, and redirects
 * the user to Paymob's iframe URL once the response arrives.
 *
 * Shows a spinner + "جاري تحويلك لصفحة الدفع..." while the redirect happens.
 */
'use client';

import React, { useState } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { WalletPaymentData } from './types';

export interface WalletPaymentModalProps {
  paymentData: WalletPaymentData;
  onClose: () => void;
}

export function WalletPaymentModal({ paymentData, onClose }: WalletPaymentModalProps) {
  const [walletNumber, setWalletNumber] = useState('');
  const [processing, setProcessing] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!walletNumber || walletNumber.length < 10) {
      toast.error('يرجى إدخال رقم محفظة صحيح');
      return;
    }

    setProcessing(true);
    try {
      const response = await fetch('/api/paymob/process-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_number: walletNumber,
          payment_key: paymentData.paymentKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.redirect_url) {
          setRedirectUrl(data.redirect_url);
          setTimeout(() => {
            window.location.href = data.redirect_url;
          }, 1500);
        } else {
          toast.success(data.message || 'تم إرسال طلب الدفع إلى محفظتك بنجاح!');
        }
      } else {
        toast.error(data.error || 'فشل في عملية الدفع');
        console.error('[Wallet Payment] Error:', data);
      }
    } catch (error) {
      console.error('[Wallet Payment] Error:', error);
      toast.error('حدث خطأ في الاتصال بـ Paymob');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-2 border-purple-500/40">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl from-purple-500 to-violet-600 flex items-center justify-center mb-3 shadow-lg shadow-purple-500/30">
            <Wallet className="w-7 h-7 text-foreground" />
          </div>
          <CardTitle className="text-lg font-bold">الدفع بالمحفظة الإلكترونية</CardTitle>
          <CardDescription className="text-xs">
            أدخل رقم محفظتك لإتمام عملية الدفع عبر Paymob
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {redirectUrl ? (
            <div className="text-center space-y-3 py-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-profit/10 flex items-center justify-center">
                <Loader2 className="w-7 h-7 text-profit animate-spin" />
              </div>
              <p className="font-bold text-sm text-profit">جاري تحويلك لصفحة الدفع...</p>
              <p className="text-xs text-muted-foreground">سيتم تحويلك تلقائياً خلال لحظات</p>
              <a
                href={redirectUrl}
                className="text-xs text-whale underline font-semibold"
                target="_blank"
                rel="noopener noreferrer"
              >
                إذا لم يتم تحويلك اضغط هنا
              </a>
            </div>
          ) : (
            <>
              <div className="bg-muted/40 rounded-xl p-3 text-xs space-y-1 border">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المبلغ المطلوب:</span>
                  <span className="font-bold text-foreground font-mono">
                    {((paymentData.amount ?? 0) / 100).toFixed(2)} ج.م
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">رقم الطلب:</span>
                  <span className="font-mono text-xs">{paymentData.orderId}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block">رقم المحفظة</label>
                <input
                  type="tel"
                  value={walletNumber}
                  onChange={(e) => setWalletNumber(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-xs"
                  dir="ltr"
                  maxLength={11}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  أدخل رقم المحفظة (فودافون كاش، أورانج كاش، وي باي، اتصالات كاش)
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 text-xs" onClick={onClose} disabled={processing}>
                  إلغاء
                </Button>
                <Button
                  className="flex-1 from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-foreground font-bold text-xs"
                  onClick={handleSubmit}
                  disabled={processing}
                >
                  {processing ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Wallet className="w-4 h-4 ml-1" />}
                  {processing ? 'جاري التأكيد...' : 'تأكيد الدفع'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

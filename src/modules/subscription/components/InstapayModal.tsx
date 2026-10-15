'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Upload,
  Copy,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertCircle,
  X,
  FileImage,
  Loader2,
  Lock,
} from 'lucide-react';
import { useSession } from 'next-auth/react';

interface InstapayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: {
    tier: string;
    name_ar: string;
    price: number;
    currency: string;
    billingCycle: string;
    market: string;
  };
}

export function InstapayModal({ open, onOpenChange, plan }: InstapayModalProps) {
  const { data: session } = useSession();
  const [senderPhone, setSenderPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const instapayAccount = process.env.NEXT_PUBLIC_INSTAPAY_ACCOUNT || 'mohsenyousef@instapay';

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(instapayAccount);
    setCopied(true);
    toast.success('تم نسخ حساب إنستاباي بنجاح');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('يرجى اختيار صورة صالحة (PNG أو JPG)');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('حجم الصورة كبير جداً (أقصى حد 10 ميجابايت)');
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.user?.email) {
      toast.error('يجب تسجيل الدخول بالمنصة أولاً');
      return;
    }

    if (!selectedFile) {
      toast.error('يرجى رفع صورة إيصال التحويل');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('receipt', selectedFile);
      formData.append('tier', plan.tier);
      formData.append('market', plan.market);
      formData.append('billingCycle', plan.billingCycle);
      formData.append('amount', String(plan.price));
      formData.append('currency', plan.currency);
      formData.append('senderPhone', senderPhone);
      formData.append('notes', notes);

      const res = await fetch('/api/subscription/instapay/submit', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل إرسال إثبات الدفع');
      }

      setSubmitted(true);
      toast.success(data.message || 'تم إرسال إثبات الدفع بنجاح!');
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ أثناء إرسال إثبات الدفع');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setSelectedFile(null);
    setPreviewUrl(null);
    setSenderPhone('');
    setNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full p-6 text-right" dir="rtl">
        <DialogHeader className="text-right">
          <div className="flex items-center gap-2 mb-1">
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              ⚡
            </span>
            <DialogTitle className="text-xl font-bold">
              الدفع عبر إنستاباي (InstaPay)
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground text-right">
            حوّل المبلغ واعتمد اشتراكك فوراً خلال دقائق بعد مراجعة الإدارة.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-6 space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto text-3xl">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold">تم استلام إثبات الدفع بنجاح! 🎉</h3>
              <p className="text-sm text-muted-foreground">
                طلبك الآن قيد المراجعة لدى الإدارة. سيتم تفعيل حسابك على بريدك الإلكتروني فوراً:
              </p>
              <div className="inline-block p-2 rounded-md bg-muted text-xs font-mono font-semibold mt-2">
                {session?.user?.email}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs text-right space-y-1">
              <div className="flex items-center gap-1 font-bold">
                <Clock className="w-3.5 h-3.5" /> مدة التفعيل المعتادة:
              </div>
              <p>تتم المراجعة والتفعيل خلال 5 إلى 15 دقيقة طوال ساعات العمل.</p>
            </div>
            <Button onClick={handleReset} className="w-full mt-4">
              إغلاق
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {/* Account Box */}
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">عنوان الدفع المعتمد (IPA):</span>
                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]">
                  مباشر ورسمي
                </Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-background/80 border font-mono text-sm">
                <span className="font-bold text-foreground select-all">{instapayAccount}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyAccount}
                  className="h-7 px-2 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'تم النسخ' : 'نسخ'}
                </Button>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground pt-1 border-t border-border/50">
                <span>المبلغ المطلوب تحويله:</span>
                <span className="text-base font-extrabold text-foreground">
                  {plan.price} {plan.currency}
                </span>
              </div>
            </div>

            {/* User Email (Locked) */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center justify-between">
                <span>البريد الإلكتروني المرتبط بالتفعيل:</span>
                <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                  <Lock className="w-3 h-3" /> مؤمّن ومربوط بحسابك
                </span>
              </Label>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/60 border text-xs font-mono text-foreground font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="truncate">{session?.user?.email || 'يرجى تسجيل الدخول أولاً'}</span>
              </div>
            </div>

            {/* Sender Phone/Name */}
            <div className="space-y-1.5">
              <Label htmlFor="senderPhone" className="text-xs">
                اسم الحساب المحول منه أو رقم الهاتف (اختياري للتحقق السريع):
              </Label>
              <Input
                id="senderPhone"
                placeholder="مثال: 010xxxxxxxx أو اسم الحساب"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                className="text-xs text-right"
              />
            </div>

            {/* File Upload Receipt */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-foreground flex items-center gap-1">
                <span>صورة إشعار / إيصال التحويل (Screenshot):</span>
                <span className="text-red-500">*</span>
              </Label>

              {previewUrl ? (
                <div className="relative rounded-lg border p-2 bg-muted/20">
                  <img
                    src={previewUrl}
                    alt="معاينة إيصال الدفع"
                    className="w-full max-h-48 object-contain rounded-md"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    onClick={removeFile}
                    className="absolute top-3 left-3 h-7 w-7 rounded-full shadow-md"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-border hover:border-emerald-500/50 rounded-xl p-4 cursor-pointer bg-muted/10 hover:bg-emerald-500/5 transition-all text-center">
                  <Upload className="w-7 h-7 text-muted-foreground mb-1" />
                  <span className="text-xs font-semibold text-foreground">
                    اضغط لرفع صورة الإيصال أو اسحب الصورة هنا
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">
                    يدعم صور JPG, PNG (بحد أقصى 10MB)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting || !selectedFile || !session?.user?.email}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 py-5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري رفع الإيصال والتحقق...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  إرسال إثبات الدفع للتفعيل
                </>
              )}
            </Button>

            {/* WhatsApp — send receipt instantly */}
            <a
              href={`https://wa.me/201000000000?text=${encodeURIComponent(
                `مرحباً، أريد تفعيل اشتراك ${plan.name_ar}\nحساب إنستاباي: ${instapayAccount}\nالمبلغ: ${plan.price} ${plan.currency}\nالبريد: ${session?.user?.email || ''}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-lg transition-colors text-sm mt-2"
            >
              📱 أرسل إيصال التحويل على واتساب للتفعيل الفوري
            </a>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

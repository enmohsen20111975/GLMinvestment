'use client';

/**
 * FeedbackWidget — floating "report a problem / share your opinion" button.
 *
 * Mounted globally from the root layout. Opens a modal where users can submit
 * a bug report, suggestion, opinion, or praise. Submissions are POSTed to
 * /api/feedback and stored server-side so the admin can review them.
 */

import React, { useState } from 'react';
import {
 MessageSquareText,
 Bug,
 Lightbulb,
 Smile,
 Star,
 Send,
 X,
 Loader2,
} from 'lucide-react';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type FeedbackType = 'bug' | 'suggestion' | 'opinion' | 'praise';

const TYPES: {
 id: FeedbackType;
 label: string;
 icon: React.ReactNode;
 color: string;
}[] = [
 { id: 'bug', label: 'مشكلة', icon: <Bug className="w-4 h-4" />, color: 'text-loss border-loss bg-loss/10 ' },
 { id: 'suggestion', label: 'اقتراح', icon: <Lightbulb className="w-4 h-4" />, color: 'text-warning border-warning bg-warning/10 ' },
 { id: 'opinion', label: 'رأي / ملاحظة', icon: <MessageSquareText className="w-4 h-4" />, color: 'text-sky-600 border-sky-500 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400' },
 { id: 'praise', label: 'إشادة', icon: <Smile className="w-4 h-4" />, color: 'text-profit border-profit bg-profit/10 ' },
];

export function FeedbackWidget() {
 
 const [open, setOpen] = useState(false);
 const [type, setType] = useState<FeedbackType>('bug');
 const [message, setMessage] = useState('');
 const [contact, setContact] = useState('');
 const [rating, setRating] = useState(0);
 const [submitting, setSubmitting] = useState(false);

 const reset = () => {
 setType('bug');
 setMessage('');
 setContact('');
 setRating(0);
 };

 const handleSubmit = async () => {
 if (message.trim().length < 3) {
 toast.error('الرجاء كتابة التفاصيل');
 return;
 }
 setSubmitting(true);
 try {
 const res = await fetch('/api/feedback', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 type,
 message,
 contact,
 rating,
 page:
 typeof window !== 'undefined'
 ? window.location.pathname + window.location.search
 : null,
 }),
 });
 const data = await res.json();
 if (!res.ok || !data.success) {
 throw new Error(data.error || 'فشل الإرسال');
 }
 toast.success('شكراً لك! تم إرسال رأيك بنجاح');
 reset();
 setOpen(false);
 } catch (err) {
 toast.error('تعذّر الإرسال', {
 description: String((err as Error)?.message || err),
 });
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <>
 {/* Floating launcher (bottom-left for RTL) */}
 <button
 type="button"
 onClick={() => setOpen(true)}
 aria-label="أرسل رأيك أو أبلغ عن مشكلة"
 className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-border bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
 >
 <MessageSquareText className="w-4 h-4" />
 <span className="hidden sm:inline">أرسل رأيك</span>
 </button>

 <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
 <DialogContent className="max-w-md">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <MessageSquareText className="w-5 h-5 text-primary" />
 أرسل رأيك أو أبلغ عن مشكلة
 </DialogTitle>
 <DialogDescription>
 ملاحظاتك تساعدنا على تحسين المنصة. يمكنك الإبلاغ عن أي خطأ أو
 اقتراح تحسين.
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4">
 {/* Type selector */}
 <div className="grid grid-cols-2 gap-2">
 {TYPES.map((t) => (
 <button
 key={t.id}
 type="button"
 onClick={() => setType(t.id)}
 className={cn(
 'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
 type === t.id
 ? t.color + ' ring-2 ring-offset-1 ring-current'
 : 'border-border text-muted-foreground hover:bg-muted/50',
 )}
 >
 {t.icon}
 {t.label}
 </button>
 ))}
 </div>

 {/* Rating (optional) */}
 <div>
 <Label className="mb-1.5 block text-xs text-muted-foreground">
 التقييم (اختياري)
 </Label>
 <div className="flex items-center gap-1">
 {[1, 2, 3, 4, 5].map((n) => (
 <button
 key={n}
 type="button"
 onClick={() => setRating(n)}
 aria-label={`${n} نجوم`}
 className="transition-transform hover:scale-110"
 >
 <Star
 className={cn(
 'w-6 h-6',
 n <= rating
 ? 'fill-warning text-warning'
 : 'text-muted-foreground/40',
 )}
 />
 </button>
 ))}
 </div>
 </div>

 {/* Message */}
 <div>
 <Label htmlFor="feedback-message" className="mb-1.5 block text-xs">
 تفاصيل المشكلة أو رأيك *
 </Label>
 <Textarea
 id="feedback-message"
 value={message}
 onChange={(e) => setMessage(e.target.value)}
 placeholder="اكتب ما واجهته أو ما تود اقتراحه..."
 className="min-h-[110px] text-sm"
 dir="rtl"
 />
 </div>

 {/* Contact (optional) */}
 <div>
 <Label htmlFor="feedback-contact" className="mb-1.5 block text-xs text-muted-foreground">
 بريدك أو رقم تواصل (اختياري)
 </Label>
 <Input
 id="feedback-contact"
 value={contact}
 onChange={(e) => setContact(e.target.value)}
 placeholder="للرد عليك إن لزم الأمر"
 className="text-sm"
 dir="rtl"
 />
 </div>
 </div>

 <div className="flex items-center justify-end gap-2 pt-1">
 <Button
 variant="ghost"
 onClick={() => { setOpen(false); reset(); }}
 disabled={submitting}
 >
 <X className="w-4 h-4" />
 إلغاء
 </Button>
 <Button onClick={handleSubmit} disabled={submitting}>
 {submitting ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Send className="w-4 h-4" />
 )}
 إرسال
 </Button>
 </div>
 </DialogContent>
 </Dialog>
 </>
 );
}

export default FeedbackWidget;

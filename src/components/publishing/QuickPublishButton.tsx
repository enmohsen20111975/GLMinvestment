'use client';

import React, { useState } from 'react';
import { MessageSquarePlus, Loader2, CheckCircle, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { withOfficialLinks } from '@/modules/publishing/lib/official-links';

interface QuickPublishButtonProps {
 ticker: string;
 stockName?: string;
 currentPrice?: number;
 analysisData?: {
 signal?: string;
 signalAr?: string;
 score?: number;
 confidence?: number;
 targetPrice?: number;
 stopLoss?: number;
 reasons?: string[];
 warnings?: string[];
 };
 variant?: 'default' | 'outline' | 'ghost';
 size?: 'default' | 'sm' | 'lg' | 'icon';
 className?: string;
}

const SIGNAL_OPTIONS = [
 { value: 'STRONG_BUY', label: 'شراء قوي', color: 'bg-profit' },
 { value: 'BUY', label: 'شراء', color: 'bg-profit' },
 { value: 'ACCUMULATE', label: 'تجميع', color: 'bg-warning' },
 { value: 'HOLD', label: 'احتفاظ', color: 'bg-warning' },
 { value: 'SELL', label: 'بيع', color: 'bg-loss' },
 { value: 'STRONG_SELL', label: 'بيع قوي', color: 'bg-loss' },
];

export function QuickPublishButton({
 ticker,
 stockName,
 currentPrice,
 analysisData,
 variant = 'outline',
 size = 'sm',
 className,
}: QuickPublishButtonProps) {
 const [open, setOpen] = useState(false);
 const [loading, setLoading] = useState(false);
 const [success, setSuccess] = useState(false);
 const [pointsEarned, setPointsEarned] = useState(0);
 
 // Form state
 const [predictionType, setPredictionType] = useState(analysisData?.signal || 'BUY');
 const [targetPrice, setTargetPrice] = useState(analysisData?.targetPrice?.toString() || (currentPrice ? (currentPrice * 1.08).toFixed(2) : ''));
 const [analysis, setAnalysis] = useState('');
 const [timeframe, setTimeframe] = useState('1w');

 // Generate comprehensive report text automatically
 const generateFullReportText = React.useCallback(() => {
 const targetVal = targetPrice || analysisData?.targetPrice?.toString() || (currentPrice ? (currentPrice * 1.08).toFixed(2) : '');
 const signalText = analysisData?.signalAr || SIGNAL_OPTIONS.find(s => s.value === predictionType)?.label || 'تجميع';
 const reasonsList = analysisData?.reasons?.length 
 ? analysisData.reasons.map(r => `• ${r}`).join('\n')
 : '• الاتجاه العام إيجابي مع استقرار التداول فوق مستويات الدعم الرئيسية.';

 return `📊 التقرير الشامل لتقييم وتوقع السهم (${ticker} - ${stockName || ''})
----------------------------------------
🔹 السعر الحالي: ${currentPrice ? (currentPrice ?? 0).toFixed(2) : '—'} ج.م
🔹 الإشارة الفنية: ${signalText} (${analysisData?.score ? (analysisData.score ?? 0).toFixed(0) : '50'} درجة)
🔹 السعر المستهدف المتوقع: ${targetVal} ج.م
🔹 الإطار الزمني: أسبوع
----------------------------------------
💡 أبرز نقاط التحليل الفني والمالي:
${reasonsList}
----------------------------------------
التوقع الفني: السعر المستهدف ${targetVal} ج.م مع مراقبة مستويات الدعم.`;
 }, [ticker, stockName, currentPrice, analysisData, targetPrice, predictionType]);

 // Pre-fill fields automatically on open
 React.useEffect(() => {
 if (open) {
 if (!predictionType || predictionType === 'HOLD') {
 setPredictionType(analysisData?.signal || 'BUY');
 }
 if (!targetPrice) {
 setTargetPrice(analysisData?.targetPrice?.toString() || (currentPrice ? (currentPrice * 1.08).toFixed(2) : ''));
 }
 if (!analysis) {
 setAnalysis(generateFullReportText());
 }
 }
 }, [open, analysisData, currentPrice, generateFullReportText, predictionType, targetPrice, analysis]);

 const handleCopyReport = () => {
 const fullReport = generateFullReportText();
 navigator.clipboard.writeText(withOfficialLinks(fullReport));
 toast.success('تم نسخ التقرير الشامل بنجاح إلى الحافظة!');
 };

 const handleSubmit = async () => {
 const finalContent = withOfficialLinks(analysis || generateFullReportText());
 setLoading(true);
 try {
 const response = await fetch('/api/user-posts', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 post_type: 'prediction',
 ticker,
 title: `توقع ${stockName || ticker} - ${SIGNAL_OPTIONS.find(s => s.value === predictionType)?.label || 'شراء'}`,
 content: finalContent,
 prediction_data: {
 prediction_type: predictionType,
 target_price: targetPrice ? parseFloat(targetPrice) : (currentPrice ? currentPrice * 1.08 : null),
 current_price: currentPrice,
 timeframe,
 confidence: analysisData?.confidence || 80,
 reasons: analysisData?.reasons,
 warnings: analysisData?.warnings,
 },
 }),
 });

 const data = await response.json();

 if (data.success) {
 setSuccess(true);
 setPointsEarned(10);
 toast.success('تم نشر التوقع بنجاح!', {
 description: 'حصلت على 10 نقاط',
 });
 
 // Reset form
 setTimeout(() => {
 setOpen(false);
 setSuccess(false);
 setAnalysis('');
 }, 2000);
 } else {
 toast.error(data.error || 'حدث خطأ أثناء النشر');
 }
 } catch (error) {
 console.error('Publish error:', error);
 toast.error('حدث خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 };

 return (
 <>
 <Button
 variant={variant}
 size={size}
 className={cn('gap-2', className)}
 onClick={() => setOpen(true)}
 >
 <MessageSquarePlus className="w-4 h-4" />
 <span className="hidden sm:inline">نشر التوقع</span>
 </Button>

 <Dialog open={open} onOpenChange={setOpen}>
 <DialogContent className="max-w-md" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <MessageSquarePlus className="w-5 h-5 text-primary" />
 نشر التوقع والتقرير الشامل للسهم
 </DialogTitle>
 <DialogDescription>
 يتم نشر التوقع والتقرير الشامل تلقائياً بضغطة واحدة مع إضافة 10 نقاط لحسابك
 </DialogDescription>
 </DialogHeader>

 {success ? (
 <div className="py-8 text-center">
 <CheckCircle className="w-16 h-16 text-profit mx-auto mb-4" />
 <h3 className="text-lg font-bold mb-2">تم النشر بنجاح!</h3>
 <div className="flex items-center justify-center gap-2 text-profit">
 <Coins className="w-5 h-5" />
 <span className="font-bold">+10 نقاط</span>
 </div>
 </div>
 ) : (
 <div className="space-y-4">
 {/* Stock Info */}
 <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
 <div>
 <p className="font-bold text-profit">{ticker}</p>
 <p className="text-sm text-muted-foreground">{stockName}</p>
 </div>
 {currentPrice && (
 <div className="mr-auto text-left">
 <p className="text-sm text-muted-foreground">السعر الحالي</p>
 <p className="font-bold">{(currentPrice ?? 0).toFixed(2)} ج.م</p>
 </div>
 )}
 </div>

 {/* Signal from Analysis */}
 {analysisData?.signal && (
 <div className="flex items-center gap-2">
 <span className="text-sm text-muted-foreground">الإشارة الحالية:</span>
 <Badge className={SIGNAL_OPTIONS.find(s => s.value === analysisData.signal)?.color}>
 {analysisData.signalAr || SIGNAL_OPTIONS.find(s => s.value === analysisData.signal)?.label}
 </Badge>
 {analysisData.score && (
 <span className="text-sm font-bold">
 ({(analysisData.score ?? 0).toFixed(0)} درجة)
 </span>
 )}
 </div>
 )}

 {/* Prediction Type */}
 <div className="space-y-2">
 <Label>نوع التوقع</Label>
 <Select value={predictionType} onValueChange={setPredictionType}>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {SIGNAL_OPTIONS.map(option => (
 <SelectItem key={option.value} value={option.value}>
 <div className="flex items-center gap-2">
 <div className={cn('w-2 h-2 rounded-full', option.color)} />
 {option.label}
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Target Price */}
 <div className="space-y-2">
 <Label>السعر المستهدف</Label>
 <div className="flex gap-2">
 <input
 type="number"
 value={targetPrice}
 onChange={(e) => setTargetPrice(e.target.value)}
 placeholder={analysisData?.targetPrice?.toFixed(2) || '0.00'}
 className="flex-1 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
 />
 <span className="flex items-center text-muted-foreground">ج.م</span>
 </div>
 </div>

 {/* Timeframe */}
 <div className="space-y-2">
 <Label>الإطار الزمني</Label>
 <Select value={timeframe} onValueChange={setTimeframe}>
 <SelectTrigger>
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="1d">يوم واحد</SelectItem>
 <SelectItem value="3d">3 أيام</SelectItem>
 <SelectItem value="1w">أسبوع</SelectItem>
 <SelectItem value="2w">أسبوعين</SelectItem>
 <SelectItem value="1m">شهر</SelectItem>
 <SelectItem value="3m">3 أشهر</SelectItem>
 </SelectContent>
 </Select>
 </div>

 {/* Analysis Notes */}
 <div className="space-y-2">
 <Label>التقرير الشامل والتحليل المولد تلقائياً</Label>
 <Textarea
 value={analysis}
 onChange={(e) => setAnalysis(e.target.value)}
 placeholder="التقرير التلقائي..."
 rows={5}
 className="font-mono text-xs leading-relaxed"
 />
 </div>

 {/* Points Info */}
 <div className="flex items-center justify-between text-sm text-muted-foreground bg-profit /20 p-2.5 rounded-lg border border-profit/20">
 <div className="flex items-center gap-2">
 <Coins className="w-4 h-4 text-profit" />
 <span className="font-bold text-profit ">ستحصل على 10 نقاط عند نشر هذا التوقع</span>
 </div>
 </div>
 </div>
 )}

 <DialogFooter className="flex flex-col sm:flex-row gap-2">
 {!success && (
 <>
 <Button type="button" variant="secondary" onClick={handleCopyReport} className="gap-1.5 text-xs">
 📋 نسخ التقرير الشامل
 </Button>
 <div className="flex gap-2 mr-auto">
 <Button variant="outline" onClick={() => setOpen(false)}>
 إلغاء
 </Button>
 <Button onClick={handleSubmit} disabled={loading} className="bg-profit hover:bg-profit text-white">
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin ml-2" />
 جارٍ النشر...
 </>
 ) : (
 'نشر التوقع فورياً'
 )}
 </Button>
 </div>
 </>
 )}
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

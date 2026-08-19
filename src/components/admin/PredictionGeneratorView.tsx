'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Play, Save, Trash2, Eye, RefreshCw,
  TrendingUp, TrendingDown, Target, Shield, AlertCircle,
  Calendar, ChevronDown, ChevronUp, Zap, Brain, Database,
  Building2, Globe, CheckCircle, XCircle, Clock, BarChart3,
  Sparkles, ArrowRightLeft, Percent, Hash, DateRange
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

// ============================================================================
// TYPES
// ============================================================================

interface PredictionConfig {
  market: 'EGX' | 'TADAWUL' | 'KSE' | 'QSE';
  persona: 'scalper' | 'trader' | 'investor' | 'conservative';
  start_date: string;
  end_date: string;
  min_daily_predictions: number;
  max_daily_predictions: number;
  holding_period: number;
  target_percent: number;
  stop_loss_percent: number;
  partial_success_threshold: number;
  // تحليل فنى — برامترات جديدة
  min_maestro_score: number;         // أقل درجة مايسترو مقبولة
  min_rr_ratio: number;              // أقل نسبة مخاطرة/عائد
  atr_stop_multiplier: number;       // معامل ATR للوقف
  support_buffer_pct: number;        // نسبة الحماية تحت الدعم %
  resistance_buffer_pct: number;     // نسبة الحماية قبل المقاومة %
  lookback_days: number;             // عدد أيام التحليل
  enable_fibonacci: boolean;         // تفعيل Fibonacci Extension
  enable_exit_signals: boolean;      // تفعيل إشارات الخروج (قمة الخول)
  min_exit_score: number;            // حد إشارة الخروج
  target_basis: string;              // أساس المستهدف (auto/resistance/fibonacci/atr)
  stop_basis: string;                // أساس الوقف (auto/support/swing_low/atr)
}

interface PreviewPrediction {
  id: string;
  ticker: string;
  stock_name_ar: string;
  signal_type: 'BUY' | 'SELL' | 'ACCUMULATE' | 'HOLD';
  entry_price: number;
  target_price: number;
  stop_loss: number;
  maestro_score: number;
  confidence: number;
  prediction_date: string;
  selected: boolean;
}

interface GenerationStats {
  total: number;
  buy: number;
  sell: number;
  accumulate: number;
  avg_score: number;
  avg_confidence: number;
}

// ============================================================================
// MARKET & PERSONA CONFIGS
// ============================================================================

const MARKETS = [
  { id: 'EGX', name: 'البورصة المصرية', nameEn: 'EGX', flag: '🇪🇬' },
  { id: 'TADAWUL', name: 'السوق السعودي', nameEn: 'TADAWUL', flag: '🇸🇦' },
  { id: 'KSE', name: 'بورصة الكويت', nameEn: 'KSE', flag: '🇰🇼' },
  { id: 'QSE', name: 'بورصة قطر', nameEn: 'QSE', flag: '🇶🇦' },
];

const PERSONAS = [
  {
    id: 'scalper',
    name: 'مضارب سريع',
    nameEn: 'Scalper',
    icon: '⚡',
    description: 'T+1، وقف خسارة ضيق، صفقات سريعة',
    holdingPeriod: 1,
    stopLoss: 2,
    target: 3,
  },
  {
    id: 'trader',
    name: 'متداول نشط',
    nameEn: 'Trader',
    icon: '📈',
    description: '3-10 أيام Swing، R/R متوازن',
    holdingPeriod: 7,
    stopLoss: 5,
    target: 10,
  },
  {
    id: 'investor',
    name: 'مستثمر',
    nameEn: 'Investor',
    icon: '💎',
    description: '14-90 يوم، إشارات الشراء والبناء',
    holdingPeriod: 30,
    stopLoss: 10,
    target: 20,
  },
  {
    id: 'conservative',
    name: 'مستثمر',
    nameEn: 'Conservative',
    icon: '🛡️',
    description: 'درجات قبول مرتفعة، وقف خسارة صارم',
    holdingPeriod: 14,
    stopLoss: 5,
    target: 8,
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PredictionGeneratorView() {
  // State
  const [config, setConfig] = useState<PredictionConfig>({
    market: 'EGX',
    persona: 'trader',
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    min_daily_predictions: 3,
    max_daily_predictions: 7,
    holding_period: 7,
    target_percent: 10,
    stop_loss_percent: 5,
    partial_success_threshold: 3,
    // تحليل فنى — برامترات جديدة
    min_maestro_score: 50,
    min_rr_ratio: 1.5,
    atr_stop_multiplier: 1.5,
    support_buffer_pct: 3,
    resistance_buffer_pct: 2,
    lookback_days: 90,
    enable_fibonacci: true,
    enable_exit_signals: true,
    min_exit_score: 60,
    target_basis: 'auto',
    stop_basis: 'auto',
  });

  const [previewPredictions, setPreviewPredictions] = useState<PreviewPrediction[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [stats, setStats] = useState<GenerationStats | null>(null);
  const [activeTab, setActiveTab] = useState<string>('config');

  // Calculate stats when preview changes
  useEffect(() => {
    if (previewPredictions.length > 0) {
      const selectedPreds = previewPredictions.filter(p => p.selected);
      setStats({
        total: selectedPreds.length,
        buy: selectedPreds.filter(p => p.signal_type === 'BUY').length,
        sell: selectedPreds.filter(p => p.signal_type === 'SELL').length,
        accumulate: selectedPreds.filter(p => p.signal_type === 'ACCUMULATE').length,
        avg_score: selectedPreds.reduce((a, b) => a + b.maestro_score, 0) / selectedPreds.length,
        avg_confidence: selectedPreds.reduce((a, b) => a + b.confidence, 0) / selectedPreds.length,
      });
    } else {
      setStats(null);
    }
  }, [previewPredictions]);

  // Handlers
  const handleConfigChange = (key: keyof PredictionConfig, value: string | number) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handlePersonaChange = (personaId: string) => {
    const persona = PERSONAS.find(p => p.id === personaId);
    if (persona) {
      setConfig(prev => ({
        ...prev,
        persona: personaId as PredictionConfig['persona'],
        holding_period: persona.holdingPeriod,
        stop_loss_percent: persona.stopLoss,
        target_percent: persona.target,
      }));
    }
  };

  const handleGeneratePreview = async () => {
    setIsGenerating(true);
    setShowPreview(true);
    setActiveTab('preview');

    try {
      const response = await fetch('/api/python/ai-predictions/generate?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          preview_mode: true,
        }),
      });

      const data = await response.json();

      if (data.success && data.predictions) {
        const predictionsWithSelection = data.predictions.map((p: PreviewPrediction) => ({
          ...p,
          selected: true,
        }));
        setPreviewPredictions(predictionsWithSelection);
        toast.success(`تم توليد ${predictionsWithSelection.length} توقع للمعاينة`);
      } else {
        toast.error(data.error || 'فشل في توليد التوقعات');
      }
    } catch (error) {
      console.error('Error generating predictions:', error);
      toast.error('فشل الاتصال بمحرك التوقعات (Python Backend على المنفذ 8010). تأكد من تشغيل VPS Service قبل بناء التوقعات.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSavePredictions = async () => {
    const selectedPreds = previewPredictions.filter(p => p.selected);
    if (selectedPreds.length === 0) {
      toast.error('الرجاء اختيار توقعات للحفظ');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch('/api/python/ai-predictions/save?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          predictions: selectedPreds,
          config,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`تم حفظ ${selectedPreds.length} توقع بنجاح`);
        setPreviewPredictions([]);
        setShowPreview(false);
        setActiveTab('config');
      } else {
        toast.error(data.error || 'فشل في حفظ التوقعات');
      }
    } catch (error) {
      console.error('Error saving predictions:', error);
      toast.error('حدث خطأ أثناء حفظ التوقعات');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEvaluatePredictions = async () => {
    setIsEvaluating(true);

    try {
      const response = await fetch('/api/python/ai-predictions/evaluate?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: config.market,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`تم تقييم ${data.evaluated_count || 0} توقع`);
      } else {
        toast.error(data.error || 'فشل في تقييم التوقعات');
      }
    } catch (error) {
      console.error('Error evaluating predictions:', error);
      toast.error('حدث خطأ أثناء تقييم التوقعات');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDeletePredictions = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch('/api/python/ai-predictions/clear?XTransformPort=8010', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: config.market,
          before_date: config.end_date,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`تم حذف ${data.deleted_count || 0} توقع`);
      } else {
        toast.error(data.error || 'فشل في حذف التوقعات');
      }
    } catch (error) {
      console.error('Error deleting predictions:', error);
      toast.error('حدث خطأ أثناء حذف التوقعات');
    } finally {
      setIsDeleting(false);
    }
  };

  const togglePredictionSelection = (id: string) => {
    setPreviewPredictions(prev =>
      prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p)
    );
  };

  const selectAllPredictions = (selected: boolean) => {
    setPreviewPredictions(prev => prev.map(p => ({ ...p, selected })));
  };

  // Get signal color
  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'BUY': return 'text-green-500 bg-green-500/10';
      case 'SELL': return 'text-red-500 bg-red-500/10';
      case 'ACCUMULATE': return 'text-blue-500 bg-blue-500/10';
      default: return 'text-gray-500 bg-gray-500/10';
    }
  };

  const getSignalLabel = (signal: string) => {
    switch (signal) {
      case 'BUY': return 'شراء';
      case 'SELL': return 'بيع';
      case 'ACCUMULATE': return 'بناء';
      default: return 'انتظار';
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <Brain className="w-8 h-8 text-primary" />
            مولد التوقعات الذكية
          </h1>
          <p className="text-muted-foreground mt-1">
            توليد وإدارة توقعات AI حسب الأسواق والشخصيات
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="config">
            <Settings className="w-4 h-4 ml-2" />
            إعدادات التوليد
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={previewPredictions.length === 0}>
            <Eye className="w-4 h-4 ml-2" />
            المعاينة ({previewPredictions.filter(p => p.selected).length})
          </TabsTrigger>
        </TabsList>

        {/* Config Tab */}
        <TabsContent value="config" className="space-y-6 mt-6">
          {/* Market Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                اختيار السوق
              </CardTitle>
              <CardDescription>
                اختر السوق المستهدف لتوليد التوقعات
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {MARKETS.map(market => (
                  <button
                    key={market.id}
                    onClick={() => handleConfigChange('market', market.id)}
                    className={cn(
                      'p-4 rounded-lg border-2 transition-all text-center',
                      config.market === market.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <span className="text-2xl">{market.flag}</span>
                    <p className="font-medium mt-2">{market.name}</p>
                    <p className="text-xs text-muted-foreground">{market.nameEn}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Persona Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                شخصية التداول
              </CardTitle>
              <CardDescription>
                كل شخصية لها إعدادات مختلفة للهدف ووقف الخسارة
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {PERSONAS.map(persona => (
                  <button
                    key={persona.id}
                    onClick={() => handlePersonaChange(persona.id)}
                    className={cn(
                      'p-4 rounded-lg border-2 transition-all text-right',
                      config.persona === persona.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <span className="text-2xl">{persona.icon}</span>
                    <p className="font-medium mt-2">{persona.name}</p>
                    <p className="text-xs text-muted-foreground">{persona.nameEn}</p>
                    <p className="text-xs text-muted-foreground mt-2">{persona.description}</p>
                    <div className="flex gap-2 mt-3">
                      <Badge variant="outline" className="text-xs">
                        وقف: {persona.stopLoss}%
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        هدف: {persona.target}%
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Generation Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                إعدادات التوليد
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Date Range */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    تاريخ البداية
                  </Label>
                  <Input
                    type="date"
                    value={config.start_date}
                    onChange={e => handleConfigChange('start_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    تاريخ النهاية
                  </Label>
                  <Input
                    type="date"
                    value={config.end_date}
                    onChange={e => handleConfigChange('end_date', e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              {/* Prediction Counts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    الحد الأدنى للتوقعات اليومية
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={config.min_daily_predictions}
                    onChange={e => handleConfigChange('min_daily_predictions', parseInt(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    الحد الأقصى للتوقعات اليومية
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={config.max_daily_predictions}
                    onChange={e => handleConfigChange('max_daily_predictions', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <Separator />

              {/* Trading Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    فترة الاحتفاظ (أيام)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={config.holding_period}
                    onChange={e => handleConfigChange('holding_period', parseInt(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    نسبة الهدف (%)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    step={0.5}
                    value={config.target_percent}
                    onChange={e => handleConfigChange('target_percent', parseFloat(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    نسبة وقف الخسارة (%)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    step={0.5}
                    value={config.stop_loss_percent}
                    onChange={e => handleConfigChange('stop_loss_percent', parseFloat(e.target.value))}
                  />
                </div>
              </div>

              <Separator />

              {/* Partial Success */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  حد النجاح الجزئي (%)
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  step={0.5}
                  value={config.partial_success_threshold}
                  onChange={e => handleConfigChange('partial_success_threshold', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  أقل نسبة ربح تعتبر نجاح جزئي عند انتهاء المدة
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Technical Analysis Parameters — برامترات التحليل الفنى */}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                برامترات التحليل الفنى والشموع اليابانية
              </CardTitle>
              <CardDescription>
                التحكم فى كيفية حساب المستهدف ووقف الخسارة — بناءً على التحليل الفنى مش نسب ثابتة
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Min Score & R:R */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    أقل درجة مايسترو مقبولة
                  </Label>
                  <Input
                    type="number"
                    min={20}
                    max={90}
                    value={config.min_maestro_score}
                    onChange={e => handleConfigChange('min_maestro_score', parseInt(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    الأسهم اللي درجتها أقل من ده مش هتدخل التوقعات
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4" />
                    أقل نسبة مخاطرة/عائد (R:R)
                  </Label>
                  <Input
                    type="number"
                    min={1.0}
                    max={5.0}
                    step={0.1}
                    value={config.min_rr_ratio}
                    onChange={e => handleConfigChange('min_rr_ratio', parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    الصفقات اللي R:R أقل من ده مرفوضة
                  </p>
                </div>
              </div>

              <Separator />

              {/* ATR & S/R Buffers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    معامل ATR للوقف
                  </Label>
                  <Input
                    type="number"
                    min={0.5}
                    max={3.0}
                    step={0.1}
                    value={config.atr_stop_multiplier}
                    onChange={e => handleConfigChange('atr_stop_multiplier', parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    وقف الخسارة = Entry - (ATR × المعامل ده)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    حماية الدعم (%)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    step={0.5}
                    value={config.support_buffer_pct}
                    onChange={e => handleConfigChange('support_buffer_pct', parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    الوقف يكون كام % تحت الدعم
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    حماية المقاومة (%)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    step={0.5}
                    value={config.resistance_buffer_pct}
                    onChange={e => handleConfigChange('resistance_buffer_pct', parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    المستهدف يكون كام % قبل المقاومة
                  </p>
                </div>
              </div>

              <Separator />

              {/* Lookback & Target/Stop Basis */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <DateRange className="w-4 h-4" />
                    فترة التحليل (أيام)
                  </Label>
                  <Select value={String(config.lookback_days)} onValueChange={v => handleConfigChange('lookback_days', parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 يوم</SelectItem>
                      <SelectItem value="60">60 يوم</SelectItem>
                      <SelectItem value="90">90 يوم</SelectItem>
                      <SelectItem value="180">180 يوم</SelectItem>
                      <SelectItem value="365">سنة كاملة</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    عدد أيام تاريخ السعر المستخدمة فى التحليل
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    أساس المستهدف
                  </Label>
                  <Select value={config.target_basis} onValueChange={v => handleConfigChange('target_basis', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">تلقائي (أفضل طريقة)</SelectItem>
                      <SelectItem value="resistance">المقاومة الفنية</SelectItem>
                      <SelectItem value="fibonacci">Fibonacci 1.618</SelectItem>
                      <SelectItem value="atr">ATR-based</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    إزاي يتحدد المستهدف — تلقائي أو طريقة محددة
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    أساس وقف الخسارة
                  </Label>
                  <Select value={config.stop_basis} onValueChange={v => handleConfigChange('stop_basis', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">تلقائي (أفضل طريقة)</SelectItem>
                      <SelectItem value="support">الدعم الفني</SelectItem>
                      <SelectItem value="swing_low">Swing Low</SelectItem>
                      <SelectItem value="atr">ATR-based</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    إزاي يتحدد الوقف — تلقائي أو طريقة محددة
                  </p>
                </div>
              </div>

              <Separator />

              {/* Toggle Options */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    id="enable-fibonacci"
                    checked={config.enable_fibonacci}
                    onCheckedChange={checked => handleConfigChange('enable_fibonacci', !!checked)}
                  />
                  <div>
                    <Label htmlFor="enable-fibonacci" className="cursor-pointer">
                      تفعيل Fibonacci Extension
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      استخدام 1.618 extension كمستهدف
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    id="enable-exit-signals"
                    checked={config.enable_exit_signals}
                    onCheckedChange={checked => handleConfigChange('enable_exit_signals', !!checked)}
                  />
                  <div>
                    <Label htmlFor="enable-exit-signals" className="cursor-pointer">
                      تفعيل إشارات الخروج (قمة الخول)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      كشف Shooting Star + RSI + Volume Divergence
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    حد إشارة الخروج
                  </Label>
                  <Input
                    type="number"
                    min={20}
                    max={100}
                    step={5}
                    value={config.min_exit_score}
                    onChange={e => handleConfigChange('min_exit_score', parseInt(e.target.value))}
                    disabled={!config.enable_exit_signals}
                  />
                  <p className="text-xs text-muted-foreground">
                    لو إشارة الخروج ≥ ده → نصح بالبيع
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4 justify-center">
            <Button
              size="lg"
              onClick={handleGeneratePreview}
              disabled={isGenerating}
              className="min-w-[200px]"
            >
              {isGenerating ? (
                <RefreshCw className="w-5 h-5 ml-2 animate-spin" />
              ) : (
                <Eye className="w-5 h-5 ml-2" />
              )}
              معاينة التوقعات
            </Button>

            <Button
              size="lg"
              variant="outline"
              onClick={handleEvaluatePredictions}
              disabled={isEvaluating}
            >
              {isEvaluating ? (
                <RefreshCw className="w-5 h-5 ml-2 animate-spin" />
              ) : (
                <Target className="w-5 h-5 ml-2" />
              )}
              تقييم التوقعات
            </Button>

            <Button
              size="lg"
              variant="destructive"
              onClick={handleDeletePredictions}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <RefreshCw className="w-5 h-5 ml-2 animate-spin" />
              ) : (
                <Trash2 className="w-5 h-5 ml-2" />
              )}
              حذف التوقعات
            </Button>
          </div>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="space-y-6 mt-6">
          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-xs text-muted-foreground">إجمالي المحدد</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-green-500">{stats.buy}</div>
                  <p className="text-xs text-muted-foreground">شراء</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-red-500">{stats.sell}</div>
                  <p className="text-xs text-muted-foreground">بيع</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{stats.avg_score.toFixed(1)}</div>
                  <p className="text-xs text-muted-foreground">متوسط الدرجة</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{stats.avg_confidence.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground">متوسط الثقة</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Preview Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>جدول التوقعات المقترحة</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectAllPredictions(true)}
                  >
                    تحديد الكل
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectAllPredictions(false)}
                  >
                    إلغاء التحديد
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>السهم</TableHead>
                        <TableHead>الإشارة</TableHead>
                        <TableHead>الدخول</TableHead>
                        <TableHead>الهدف</TableHead>
                        <TableHead>وقف الخسارة</TableHead>
                        <TableHead>الدرجة</TableHead>
                        <TableHead>الثقة</TableHead>
                        <TableHead>التاريخ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewPredictions.map((prediction) => (
                        <TableRow
                          key={prediction.id}
                          className={cn(
                            'cursor-pointer transition-colors',
                            prediction.selected && 'bg-primary/5'
                          )}
                          onClick={() => togglePredictionSelection(prediction.id)}
                        >
                          <TableCell>
                            <Checkbox
                              checked={prediction.selected}
                              onCheckedChange={() => togglePredictionSelection(prediction.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div>
                              {prediction.ticker}
                              <p className="text-xs text-muted-foreground">
                                {prediction.stock_name_ar}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={getSignalColor(prediction.signal_type)}>
                              {getSignalLabel(prediction.signal_type)}
                            </Badge>
                          </TableCell>
                          <TableCell>{prediction.entry_price.toFixed(2)}</TableCell>
                          <TableCell className="text-green-500">
                            {prediction.target_price.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-red-500">
                            {prediction.stop_loss.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress
                                value={prediction.maestro_score}
                                className="w-16 h-2"
                              />
                              <span className="text-xs">
                                {prediction.maestro_score.toFixed(0)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {prediction.confidence.toFixed(0)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {prediction.prediction_date}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-center gap-4">
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setShowPreview(false);
                setActiveTab('config');
              }}
            >
              <ArrowRightLeft className="w-5 h-5 ml-2" />
              رجوع للإعدادات
            </Button>

            <Button
              size="lg"
              onClick={handleSavePredictions}
              disabled={isSaving || previewPredictions.filter(p => p.selected).length === 0}
              className="min-w-[200px]"
            >
              {isSaving ? (
                <RefreshCw className="w-5 h-5 ml-2 animate-spin" />
              ) : (
                <Save className="w-5 h-5 ml-2" />
              )}
              حفظ التوقعات ({previewPredictions.filter(p => p.selected).length})
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PredictionGeneratorView;

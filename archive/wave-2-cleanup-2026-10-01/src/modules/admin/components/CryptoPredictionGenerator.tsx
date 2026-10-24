'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bitcoin, Play, Save, RefreshCw, TrendingUp, TrendingDown,
  Target, Shield, AlertCircle, Clock, BarChart3, Zap, Brain,
  DollarSign, Percent, Activity, ChevronDown, ChevronUp, Filter,
  Download, Trash2, Eye, Settings, Gauge, Coins
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

// ============================================================================
// TYPES
// ============================================================================

interface CryptoPrediction {
  id: string;
  symbol: string;
  name: string;
  price: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  signal_ar: string;
  maestro_score: number;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward: number;
  position_size_pct: number;
  market_regime: string;
  fear_greed: number;
  btc_dominance: number;
  reasons: string[];
  warnings: string[];
  selected: boolean;
}

interface MarketRegime {
  fear_greed: number;
  btc_dominance: number;
  volatility: string;
  regime: string;
}

interface GenerationConfig {
  limit: number;
  min_score: number;
  include_stablecoins: boolean;
  max_position_size: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LIMITS = [
  { value: '10', label: '10 عملات', description: 'سريع' },
  { value: '20', label: '20 عملة', description: 'قياسي' },
  { value: '50', label: '50 عملة', description: 'شامل' },
  { value: '100', label: '100 عملة', description: 'مفصل' },
];

const SIGNAL_CONFIG = {
  STRONG_BUY: { color: 'text-green-700', bg: 'bg-green-600', label: 'شراء قوي', icon: '🟢🟢' },
  BUY: { color: 'text-green-600', bg: 'bg-green-500', label: 'شراء', icon: '🟢' },
  HOLD: { color: 'text-yellow-600', bg: 'bg-yellow-500', label: 'احتفاظ', icon: '🟡' },
  SELL: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع', icon: '🔴' },
  STRONG_SELL: { color: 'text-red-700', bg: 'bg-red-600', label: 'بيع قوي', icon: '🔴🔴' },
};

const FEAR_GREED_CONFIG = {
  extreme_fear: { min: 0, max: 25, color: 'text-red-600', bg: 'bg-red-100', label: 'خوف شديد 🟢 فرصة' },
  fear: { min: 26, max: 45, color: 'text-orange-600', bg: 'bg-orange-100', label: 'خوف ⚠️ حذر' },
  neutral: { min: 46, max: 55, color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'محايد ⏸️ انتظار' },
  greed: { min: 56, max: 75, color: 'text-green-600', bg: 'bg-green-100', label: 'طمع ⚠️ حذر' },
  extreme_greed: { min: 76, max: 100, color: 'text-emerald-600', bg: 'bg-emerald-100', label: 'طمع شديد 🔴 خطر' },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CryptoPredictionGenerator() {
  // State
  const [config, setConfig] = useState<GenerationConfig>({
    limit: 50,
    min_score: 60,
    include_stablecoins: false,
    max_position_size: 3,
  });

  const [predictions, setPredictions] = useState<CryptoPrediction[]>([]);
  const [marketRegime, setMarketRegime] = useState<MarketRegime | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('config');

  // Stats
  const stats = {
    total: predictions.filter(p => p.selected).length,
    strong_buy: predictions.filter(p => p.selected && p.signal === 'STRONG_BUY').length,
    buy: predictions.filter(p => p.selected && p.signal === 'BUY').length,
    hold: predictions.filter(p => p.selected && p.signal === 'HOLD').length,
    sell: predictions.filter(p => p.selected && ['SELL', 'STRONG_SELL'].includes(p.signal)).length,
    avg_score: predictions.filter(p => p.selected).length > 0 
      ? predictions.filter(p => p.selected).reduce((a, b) => a + b.maestro_score, 0) / predictions.filter(p => p.selected).length 
      : 0,
  };

  // Handlers
  const handleConfigChange = (key: keyof GenerationConfig, value: number | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleGeneratePredictions = async () => {
    setIsGenerating(true);
    setShowPreview(true);
    setActiveTab('preview');

    try {
      // Fetch bulk analysis from Python backend (via Next.js proxy on port 3000)
      const response = await fetch(`/api/python/crypto/bulk-analysis?limit=${config.limit}`);
      const data = await response.json();

      if (data.success) {
        // Set market regime
        setMarketRegime({
          fear_greed: data.market_regime?.fear_greed || 50,
          btc_dominance: data.market_regime?.btc_dominance || 50,
          volatility: data.market_regime?.volatility || 'MEDIUM',
          regime: data.market_regime?.regime || 'NEUTRAL',
        });

        // Convert to predictions format
        const preds: CryptoPrediction[] = (data.data || [])
          .filter((c: any) => config.include_stablecoins || !['usdt', 'usdc', 'busd', 'dai'].includes(c.symbol?.toLowerCase()))
          .filter((c: any) => c.score >= config.min_score)
          .map((c: any) => ({
            id: c.id || c.symbol,
            symbol: c.symbol?.toUpperCase() || 'UNKNOWN',
            name: c.name || c.symbol,
            price: c.price || 0,
            signal: c.signal || 'HOLD',
            signal_ar: c.signal_ar || 'احتفاظ',
            maestro_score: c.score || 50,
            confidence: c.confidence || 50,
            entry_price: c.price || 0,
            target_price: c.target || c.price * 1.15,
            stop_loss: c.stop_loss || c.price * 0.9,
            risk_reward: c.risk_reward || 1.5,
            position_size_pct: c.position_size_pct || config.max_position_size,
            market_regime: c.market_regime || 'NEUTRAL',
            fear_greed: data.market_regime?.fear_greed || 50,
            btc_dominance: data.market_regime?.btc_dominance || 50,
            reasons: c.reasons || [],
            warnings: c.warnings || [],
            selected: c.signal && ['STRONG_BUY', 'BUY'].includes(c.signal),
          }));

        setPredictions(preds);
        toast.success(`تم تحليل ${preds.length} عملة رقمية`);
      } else {
        toast.error(data.error || 'فشل في تحليل العملات');
      }
    } catch (error) {
      console.error('Error generating predictions:', error);
      toast.error('حدث خطأ أثناء تحليل العملات');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSavePredictions = async () => {
    const selectedPreds = predictions.filter(p => p.selected);
    if (selectedPreds.length === 0) {
      toast.error('الرجاء اختيار توقعات للحفظ');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch('/api/python/crypto/predictions/save', {
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
        setPredictions([]);
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

  const togglePredictionSelection = (id: string) => {
    setPredictions(prev =>
      prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p)
    );
  };

  const selectAllPredictions = (selected: boolean) => {
    setPredictions(prev => prev.map(p => ({ ...p, selected })));
  };

  const getFearGreedConfig = (value: number) => {
    return Object.values(FEAR_GREED_CONFIG).find(c => value >= c.min && value <= c.max) || FEAR_GREED_CONFIG.neutral;
  };

  // ─── UnifiedTable columns ────────────────────────────────────────────
  const predictionsColumns: Column<CryptoPrediction>[] = [
    {
      key: 'selected',
      header: '',
      align: 'center',
      width: 'w-12',
      hideable: false,
      render: (p) => (
        <Checkbox
          checked={p.selected}
          onCheckedChange={() => togglePredictionSelection(p.id)}
        />
      ),
    },
    {
      key: 'symbol',
      header: 'العملة',
      sortable: true,
      filterable: true,
      render: (p) => (
        <div className="flex items-center gap-2">
          <span className="font-bold">{p.symbol}</span>
          <span className="text-xs text-muted-foreground">{p.name}</span>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'السعر',
      align: 'right',
      sortable: true,
      width: 'w-28',
      className: 'font-mono',
      render: (p) => `$${p.price.toFixed(4)}`,
    },
    {
      key: 'signal',
      header: 'الإشارة',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (p) => (
        <Badge className={cn('text-white', SIGNAL_CONFIG[p.signal as keyof typeof SIGNAL_CONFIG]?.bg)}>
          {SIGNAL_CONFIG[p.signal as keyof typeof SIGNAL_CONFIG]?.icon} {p.signal_ar}
        </Badge>
      ),
    },
    {
      key: 'maestro_score',
      header: 'الدرجة',
      align: 'right',
      sortable: true,
      width: 'w-32',
      render: (p) => (
        <div className="flex items-center gap-2">
          <Progress value={p.maestro_score} className="w-16 h-2" />
          <span className="text-sm font-medium">{p.maestro_score.toFixed(0)}</span>
        </div>
      ),
    },
    {
      key: 'target_price',
      header: 'الهدف',
      align: 'right',
      sortable: true,
      width: 'w-24',
      className: 'text-green-600 font-mono',
      render: (p) => `$${p.target_price.toFixed(4)}`,
    },
    {
      key: 'stop_loss',
      header: 'وقف الخسارة',
      align: 'right',
      sortable: true,
      width: 'w-24',
      className: 'text-red-600 font-mono',
      render: (p) => `$${p.stop_loss.toFixed(4)}`,
    },
    {
      key: 'risk_reward',
      header: 'R/R',
      align: 'center',
      sortable: true,
      width: 'w-20',
      render: (p) => <Badge variant="outline">{p.risk_reward.toFixed(1)}</Badge>,
    },
    {
      key: 'position_size_pct',
      header: 'الحجم',
      align: 'right',
      sortable: true,
      width: 'w-20',
      render: (p) => `${p.position_size_pct.toFixed(1)}%`,
    },
  ];

  // Render
  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <Bitcoin className="w-8 h-8 text-orange-500" />
            مولد توقعات الكريبتو
          </h1>
          <p className="text-muted-foreground mt-1">
            تحليل شامل للعملات الرقمية باستخدام Python AI
          </p>
        </div>
      </div>

      {/* Market Regime Card */}
      {marketRegime && (
        <Card className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <Gauge className="w-6 h-6 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">Fear & Greed</p>
                <p className={cn("text-xl font-bold", getFearGreedConfig(marketRegime.fear_greed).color)}>
                  {marketRegime.fear_greed}
                </p>
                <p className="text-xs">{getFearGreedConfig(marketRegime.fear_greed).label}</p>
              </div>
              <div className="text-center">
                <Bitcoin className="w-6 h-6 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">BTC Dominance</p>
                <p className="text-xl font-bold">{marketRegime.btc_dominance.toFixed(1)}%</p>
              </div>
              <div className="text-center">
                <Activity className="w-6 h-6 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">التقلب</p>
                <p className="text-xl font-bold">{marketRegime.volatility}</p>
              </div>
              <div className="text-center">
                <TrendingUp className="w-6 h-6 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">حالة السوق</p>
                <p className="text-xl font-bold">{marketRegime.regime}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="config">
            <Settings className="w-4 h-4 ml-2" />
            إعدادات التحليل
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={predictions.length === 0}>
            <Eye className="w-4 h-4 ml-2" />
            النتائج ({predictions.filter(p => p.selected).length})
          </TabsTrigger>
        </TabsList>

        {/* Config Tab */}
        <TabsContent value="config" className="space-y-6 mt-6">
          {/* Analysis Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="w-5 h-5" />
                إعدادات التحليل
              </CardTitle>
              <CardDescription>
                اختر عدد العملات والحد الأدنى للدرجة
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Limit Selection */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  عدد العملات للتحليل
                </Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {LIMITS.map(limit => (
                    <button
                      key={limit.value}
                      onClick={() => handleConfigChange('limit', parseInt(limit.value))}
                      className={cn(
                        'p-3 rounded-lg border-2 transition-all text-center',
                        config.limit === parseInt(limit.value)
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <p className="font-medium">{limit.label}</p>
                      <p className="text-xs text-muted-foreground">{limit.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Min Score */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  أقل درجة مطلوبة: {config.min_score}
                </Label>
                <input
                  type="range"
                  min="40"
                  max="80"
                  value={config.min_score}
                  onChange={(e) => handleConfigChange('min_score', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>40 (شامل)</span>
                  <span>60 (متوسط)</span>
                  <span>80 (صارم)</span>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="stablecoins"
                    checked={config.include_stablecoins}
                    onCheckedChange={(checked) => handleConfigChange('include_stablecoins', checked === true)}
                  />
                  <Label htmlFor="stablecoins" className="text-sm">
                    تضمين العملات المستقرة (USDT, USDC...)
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Generate Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleGeneratePredictions}
              disabled={isGenerating}
              size="lg"
              className="px-8 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 ml-2 animate-spin" />
                  جاري التحليل...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 ml-2" />
                  بدء التحليل
                </>
              )}
            </Button>
          </div>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview" className="space-y-6 mt-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">{stats.total}</p>
                <p className="text-xs text-muted-foreground">المحدد</p>
              </CardContent>
            </Card>
            <Card className="bg-green-500/10">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{stats.strong_buy + stats.buy}</p>
                <p className="text-xs text-muted-foreground">شراء</p>
              </CardContent>
            </Card>
            <Card className="bg-yellow-500/10">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-yellow-600">{stats.hold}</p>
                <p className="text-xs text-muted-foreground">احتفاظ</p>
              </CardContent>
            </Card>
            <Card className="bg-red-500/10">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{stats.sell}</p>
                <p className="text-xs text-muted-foreground">بيع</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold">{stats.avg_score.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">متوسط الدرجة</p>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => selectAllPredictions(true)}>
                تحديد الكل
              </Button>
              <Button variant="outline" size="sm" onClick={() => selectAllPredictions(false)}>
                إلغاء التحديد
              </Button>
            </div>
            <Button
              onClick={handleSavePredictions}
              disabled={isSaving || stats.total === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 ml-2" />
                  حفظ التوقعات ({stats.total})
                </>
              )}
            </Button>
          </div>

          {/* Predictions Table */}
          <Card>
            <CardContent className="p-0">
              <UnifiedTable
                columns={predictionsColumns}
                data={predictions}
                keyField="id"
                dense
                columnToggle
                filterable
                rowClassName={(p) => cn(p.selected && 'bg-primary/5')}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CryptoPredictionGenerator;

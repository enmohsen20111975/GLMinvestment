'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Shield,
  Target,
  AlertTriangle,
  BarChart3,
  Wallet,
  Flame,
  BookOpen,
  Lightbulb,
  RefreshCw,
  Plus,
  Minus,
  Trash2,
  Settings,
  PieChart,
  Scale,
  Turtle,
  Dice5,
  Building2,
  Eye,
  Calculator,
  Save,
  RotateCcw,
  Info,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

interface Position {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  entry_price: number;
  current_price: number;
  stop_loss_pct: number;
  target_price: number;
  sector: string;
  notes?: string;
}

interface PersonaConfig {
  type: string;
  name_ar: string;
  emoji: string;
  risk_tolerance: number;
  max_position_pct: number;
  default_stop_loss: number;
  default_target: number;
  daily_loss_limit: number;
  allocation: {
    stocks: number;
    crypto: number;
    gold: number;
    cash: number;
  };
}

interface PortfolioSettings {
  persona: PersonaConfig;
  total_capital: number;
  cash_available: number;
  risk_per_trade: number;
  max_positions: number;
}

// ============================================================================
// Persona Presets
// ============================================================================

const PERSONAS: Record<string, PersonaConfig> = {
  conservative: {
    type: 'conservative',
    name_ar: 'المستثمر',
    emoji: '🛡️',
    risk_tolerance: 2,
    max_position_pct: 3,
    default_stop_loss: 6,
    default_target: 12,
    daily_loss_limit: 1,
    allocation: { stocks: 65, crypto: 0, gold: 20, cash: 15 }
  },
  cautious: {
    type: 'cautious',
    name_ar: 'الحذر',
    emoji: '🐢',
    risk_tolerance: 4,
    max_position_pct: 5,
    default_stop_loss: 8,
    default_target: 15,
    daily_loss_limit: 2,
    allocation: { stocks: 55, crypto: 5, gold: 20, cash: 20 }
  },
  balanced: {
    type: 'balanced',
    name_ar: 'المتوازن',
    emoji: '⚖️',
    risk_tolerance: 5,
    max_position_pct: 7,
    default_stop_loss: 10,
    default_target: 20,
    daily_loss_limit: 3,
    allocation: { stocks: 50, crypto: 15, gold: 15, cash: 20 }
  },
  active_trader: {
    type: 'active_trader',
    name_ar: 'المضارب',
    emoji: '🎯',
    risk_tolerance: 6,
    max_position_pct: 8,
    default_stop_loss: 10,
    default_target: 18,
    daily_loss_limit: 4,
    allocation: { stocks: 40, crypto: 25, gold: 10, cash: 25 }
  },
  adventurer: {
    type: 'adventurer',
    name_ar: 'المضارب',
    emoji: '🎲',
    risk_tolerance: 7,
    max_position_pct: 10,
    default_stop_loss: 12,
    default_target: 25,
    daily_loss_limit: 5,
    allocation: { stocks: 30, crypto: 40, gold: 5, cash: 25 }
  },
  gambler: {
    type: 'gambler',
    name_ar: 'المضارب',
    emoji: '🔥',
    risk_tolerance: 9,
    max_position_pct: 15,
    default_stop_loss: 15,
    default_target: 30,
    daily_loss_limit: 5,
    allocation: { stocks: 15, crypto: 60, gold: 0, cash: 25 }
  },
  hedger: {
    type: 'hedger',
    name_ar: 'المتحوط',
    emoji: '🏛️',
    risk_tolerance: 3,
    max_position_pct: 8,
    default_stop_loss: 10,
    default_target: 25,
    daily_loss_limit: 2,
    allocation: { stocks: 25, crypto: 10, gold: 30, cash: 35 }
  },
};

const SECTORS = [
  'بنوك',
  'عقارات',
  'اتصالات',
  'صناعة',
  'مواد أساسية',
  'طاقة',
  'تكنولوجيا',
  'سياحة',
  'تجارة',
  'خدمات مالية',
  'أخرى'
];

// ============================================================================
// Main Component
// ============================================================================

export function InteractivePortfolioManager() {
  // State
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  
  // Portfolio Settings
  const [settings, setSettings] = useState<PortfolioSettings>({
    persona: PERSONAS.balanced,
    total_capital: 100000,
    cash_available: 30000,
    risk_per_trade: 2,
    max_positions: 10,
  });
  
  // Positions
  const [positions, setPositions] = useState<Position[]>([]);
  
  // Add Position Dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newPosition, setNewPosition] = useState<Partial<Position>>({
    ticker: '',
    name: '',
    shares: 0,
    entry_price: 0,
    current_price: 0,
    stop_loss_pct: 10,
    target_price: 0,
    sector: 'أخرى',
  });
  
  // Analysis Results
  const [analysis, setAnalysis] = useState<any>(null);
  
  // Scenario Comparison
  const [comparePersona, setComparePersona] = useState<string | null>(null);
  const [scenarioResults, setScenarioResults] = useState<any>(null);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const totalPositionValue = positions.reduce((sum, p) => sum + (p.shares * p.current_price), 0);
  const totalPortfolioValue = totalPositionValue + settings.cash_available;
  const portfolioRisk = positions.reduce((sum, p) => {
    const riskAmount = p.shares * p.entry_price * (p.stop_loss_pct / 100);
    return sum + riskAmount;
  }, 0);
  const riskAsPctOfCapital = (portfolioRisk / settings.total_capital) * 100;
  
  const diversificationScore = calculateDiversification(positions);
  const heatLevel = getHeatLevel(riskAsPctOfCapital);

  // ============================================================================
  // Functions
  // ============================================================================

  function calculateDiversification(positions: Position[]): number {
    if (positions.length === 0) return 100;
    
    const sectorCounts: Record<string, number> = {};
    positions.forEach(p => {
      sectorCounts[p.sector] = (sectorCounts[p.sector] || 0) + 1;
    });
    
    const numSectors = Object.keys(sectorCounts).length;
    const maxSectors = Math.min(positions.length, 10);
    
    return Math.round((numSectors / maxSectors) * 100);
  }

  function getHeatLevel(riskPct: number): { level: string; color: string; icon: React.ReactNode } {
    if (riskPct < 3) return { level: 'آمن', color: 'text-emerald-600', icon: <Shield className="w-5 h-5" /> };
    if (riskPct < 6) return { level: 'حذر', color: 'text-amber-600', icon: <AlertTriangle className="w-5 h-5" /> };
    if (riskPct < 10) return { level: 'خطر', color: 'text-orange-600', icon: <Flame className="w-5 h-5" /> };
    return { level: 'حرج', color: 'text-red-600', icon: <AlertTriangle className="w-5 h-5" /> };
  }

  function handleAddPosition() {
    if (!newPosition.ticker || !newPosition.shares || !newPosition.entry_price) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    
    const position: Position = {
      id: Date.now().toString(),
      ticker: newPosition.ticker!.toUpperCase(),
      name: newPosition.name || newPosition.ticker!,
      shares: newPosition.shares!,
      entry_price: newPosition.entry_price!,
      current_price: newPosition.current_price || newPosition.entry_price!,
      stop_loss_pct: newPosition.stop_loss_pct || settings.persona.default_stop_loss,
      target_price: newPosition.target_price || newPosition.entry_price! * (1 + settings.persona.default_target / 100),
      sector: newPosition.sector || 'أخرى',
    };
    
    setPositions([...positions, position]);
    setAddDialogOpen(false);
    setNewPosition({
      ticker: '',
      name: '',
      shares: 0,
      entry_price: 0,
      current_price: 0,
      stop_loss_pct: settings.persona.default_stop_loss,
      target_price: 0,
      sector: 'أخرى',
    });
    toast.success(`تم إضافة ${position.ticker} للمحفظة`);
  }

  function handleRemovePosition(id: string) {
    setPositions(positions.filter(p => p.id !== id));
    toast.success('تم حذف الصفقة من المحفظة');
  }

  function handlePersonaChange(personaType: string) {
    const persona = PERSONAS[personaType];
    if (persona) {
      setSettings({ ...settings, persona });
      toast.success(`تم تغيير الشخصية إلى ${persona.name_ar}`);
    }
  }

  function runScenarioComparison() {
    if (!comparePersona || comparePersona === settings.persona.type) {
      toast.error('اختر شخصية مختلفة للمقارنة');
      return;
    }
    
    const compareWith = PERSONAS[comparePersona];
    const currentRisk = riskAsPctOfCapital;
    
    // Simulate how the same portfolio would look with different persona
    const adjustedStopLosses = positions.map(p => ({
      ticker: p.ticker,
      current_stop: p.stop_loss_pct,
      adjusted_stop: compareWith.default_stop_loss,
      difference: compareWith.default_stop_loss - p.stop_loss_pct,
    }));
    
    const adjustedRisk = positions.reduce((sum, p) => {
      return sum + (p.shares * p.entry_price * (compareWith.default_stop_loss / 100));
    }, 0);
    
    setScenarioResults({
      currentPersona: settings.persona,
      comparePersona: compareWith,
      currentRisk,
      adjustedRisk: (adjustedRisk / settings.total_capital) * 100,
      stopLossChanges: adjustedStopLosses,
      recommendations: generateComparisonRecommendations(settings.persona, compareWith, positions),
    });
  }

  function generateComparisonRecommendations(current: PersonaConfig, compare: PersonaConfig, positions: Position[]): string[] {
    const recs: string[] = [];
    
    if (compare.risk_tolerance > current.risk_tolerance) {
      recs.push(`شخصية ${compare.name_ar} تقبل مخاطرة أعلى - يمكنك توسيع وقف الخسارة`);
      recs.push(`يمكنك زيادة حجم الصفقات إلى ${compare.max_position_pct}% من رأس المال`);
    } else {
      recs.push(`شخصية ${compare.name_ar} أكثر تحفظاً - يجب تقليص المخاطر`);
      recs.push(`يجب تقليل حجم الصفقات إلى ${compare.max_position_pct}% من رأس المال`);
    }
    
    if (positions.length > compare.max_positions) {
      recs.push(`تحذير: لديك ${positions.length} صفقات بينما الحد الأقصى لشخصية ${compare.name_ar} هو ${compare.max_positions}`);
    }
    
    const cryptoCount = positions.filter(p => p.sector === 'عملات رقمية').length;
    if (cryptoCount > 0 && compare.allocation.crypto === 0) {
      recs.push(`شخصية ${compare.name_ar} لا تستثمر في العملات الرقمية - يجب بيعها`);
    }
    
    return recs;
  }

  function resetToDefaults() {
    setSettings({
      persona: PERSONAS.balanced,
      total_capital: 100000,
      cash_available: 30000,
      risk_per_trade: 2,
      max_positions: 10,
    });
    setPositions([]);
    setAnalysis(null);
    setScenarioResults(null);
    toast.success('تم إعادة ضبط الإعدادات الافتراضية');
  }

  // ============================================================================
  // Render Functions
  // ============================================================================

  const renderSettingsTab = () => (
    <div className="space-y-6">
      {/* Persona Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            نوع الشخصية المستثمر
          </CardTitle>
          <CardDescription>
            اختر الشخصية المناسبة لمستوى المخاطرة الذي تفضله
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.values(PERSONAS).map((persona) => (
              <button
                key={persona.type}
                onClick={() => handlePersonaChange(persona.type)}
                className={cn(
                  "p-3 rounded-lg border-2 transition-all text-center",
                  settings.persona.type === persona.type
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-emerald-300"
                )}
              >
                <span className="text-2xl">{persona.emoji}</span>
                <p className="text-sm font-medium mt-1">{persona.name_ar}</p>
                <p className="text-xs text-muted-foreground">مخاطرة {persona.risk_tolerance}/10</p>
              </button>
            ))}
          </div>
          
          {/* Current Persona Details */}
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{settings.persona.emoji}</span>
              <div>
                <p className="font-bold">{settings.persona.name_ar}</p>
                <p className="text-xs text-muted-foreground">مستوى المخاطرة: {settings.persona.risk_tolerance}/10</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-2 bg-background rounded">
                <p className="text-xs text-muted-foreground">أقصى صفقة</p>
                <p className="font-bold">{settings.persona.max_position_pct}%</p>
              </div>
              <div className="p-2 bg-background rounded">
                <p className="text-xs text-muted-foreground">وقف خسارة</p>
                <p className="font-bold text-red-600">{settings.persona.default_stop_loss}%</p>
              </div>
              <div className="p-2 bg-background rounded">
                <p className="text-xs text-muted-foreground">هدف</p>
                <p className="font-bold text-emerald-600">{settings.persona.default_target}%</p>
              </div>
              <div className="p-2 bg-background rounded">
                <p className="text-xs text-muted-foreground">حد الخسارة اليومي</p>
                <p className="font-bold text-amber-600">{settings.persona.daily_loss_limit}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Capital Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            رأس المال والمخاطر
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>إجمالي رأس المال (ج.م)</Label>
              <Input
                type="number"
                value={settings.total_capital}
                onChange={(e) => setSettings({ ...settings, total_capital: parseFloat(e.target.value) || 0 })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>النقد المتاح (ج.م)</Label>
              <Input
                type="number"
                value={settings.cash_available}
                onChange={(e) => setSettings({ ...settings, cash_available: parseFloat(e.target.value) || 0 })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>المخاطرة لكل صفقة (%)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[settings.risk_per_trade]}
                  onValueChange={([v]) => setSettings({ ...settings, risk_per_trade: v })}
                  min={0.5}
                  max={10}
                  step={0.5}
                  className="flex-1"
                />
                <span className="w-12 text-right font-bold">{settings.risk_per_trade}%</span>
              </div>
            </div>
          </div>
          
          <div>
            <Label>أقصى عدد صفقات</Label>
            <div className="flex items-center gap-2 mt-1">
              <Slider
                value={[settings.max_positions]}
                onValueChange={([v]) => setSettings({ ...settings, max_positions: v })}
                min={1}
                max={20}
                step={1}
                className="flex-1"
              />
              <span className="w-12 text-right font-bold">{settings.max_positions}</span>
            </div>
          </div>
          
          {/* Allocation Preview */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-sm font-medium mb-2">التوزيع المقترح لشخصية {settings.persona.name_ar}</p>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(settings.persona.allocation).map(([asset, pct]) => (
                <div key={asset} className="text-center">
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs mt-1">{pct}%</p>
                  <p className="text-xs text-muted-foreground capitalize">{asset}</p>
                </div>
              ))}
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetToDefaults} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              إعادة الضبط
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderPositionsTab = () => (
    <div className="space-y-6">
      {/* Add Position Button */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-bold">الصفقات الحالية</h3>
          <p className="text-sm text-muted-foreground">
            {positions.length} / {settings.max_positions} صفقات
          </p>
        </div>
        <Button
          onClick={() => setAddDialogOpen(true)}
          disabled={positions.length >= settings.max_positions}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          إضافة صفقة
        </Button>
      </div>

      {/* Positions List */}
      {positions.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <Target className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium">لا توجد صفقات حالياً</p>
            <p className="text-sm text-muted-foreground mt-1">
              أضف صفقاتك لتتبع حرارة المحفظة والمخاطر
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map((position) => (
            <Card key={position.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg">{position.ticker}</span>
                      <Badge variant="outline">{position.sector}</Badge>
                      <Badge className={
                        (position.current_price ?? 0) >= (position.entry_price ?? 0)
                          ? "bg-emerald-500"
                          : "bg-red-500"
                      }>
                        {(position.current_price ?? 0) >= (position.entry_price ?? 0) ? '+' : ''}
                        {(position.entry_price && position.entry_price > 0 
                          ? (((position.current_price ?? 0) - position.entry_price) / position.entry_price) * 100 
                          : 0).toFixed(1)}%
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{position.name}</p>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">الأسهم</p>
                        <p className="font-medium">{(position.shares ?? 0).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">سعر الدخول</p>
                        <p className="font-medium">{(position.entry_price ?? 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">السعر الحالي</p>
                        <p className="font-medium">{(position.current_price ?? 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">وقف الخسارة</p>
                        <p className="font-medium text-red-600">
                          {((position.entry_price ?? 0) * (1 - (position.stop_loss_pct ?? 8) / 100)).toFixed(2)}
                          <span className="text-xs"> ({position.stop_loss_pct ?? 8}%)</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">الهدف</p>
                        <p className="font-medium text-emerald-600">
                          {(position.target_price ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right mr-4">
                    <p className="text-2xl font-bold">
                      {((position.shares ?? 0) * (position.current_price ?? 0)).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">ج.م</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePosition(position.id)}
                      className="text-red-500 hover:text-red-700 mt-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Position Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة صفقة جديدة</DialogTitle>
            <DialogDescription>
              أدخل تفاصيل الصفقة الجديدة
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>رمز السهم</Label>
                <Input
                  placeholder="COMI"
                  value={newPosition.ticker}
                  onChange={(e) => setNewPosition({ ...newPosition, ticker: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <Label>اسم السهم</Label>
                <Input
                  placeholder="البنك التجاري"
                  value={newPosition.name}
                  onChange={(e) => setNewPosition({ ...newPosition, name: e.target.value })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>عدد الأسهم</Label>
                <Input
                  type="number"
                  placeholder="100"
                  value={newPosition.shares || ''}
                  onChange={(e) => setNewPosition({ ...newPosition, shares: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>القطاع</Label>
                <Select
                  value={newPosition.sector}
                  onValueChange={(v) => setNewPosition({ ...newPosition, sector: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTORS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>سعر الدخول</Label>
                <Input
                  type="number"
                  placeholder="138.50"
                  value={newPosition.entry_price || ''}
                  onChange={(e) => setNewPosition({ 
                    ...newPosition, 
                    entry_price: parseFloat(e.target.value) || 0,
                    current_price: parseFloat(e.target.value) || 0,
                  })}
                />
              </div>
              <div>
                <Label>السعر الحالي</Label>
                <Input
                  type="number"
                  placeholder="140.00"
                  value={newPosition.current_price || ''}
                  onChange={(e) => setNewPosition({ ...newPosition, current_price: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>وقف الخسارة (%)</Label>
                <Input
                  type="number"
                  placeholder={settings.persona.default_stop_loss.toString()}
                  value={newPosition.stop_loss_pct || ''}
                  onChange={(e) => setNewPosition({ ...newPosition, stop_loss_pct: parseFloat(e.target.value) || settings.persona.default_stop_loss })}
                />
              </div>
              <div>
                <Label>سعر الهدف</Label>
                <Input
                  type="number"
                  placeholder="155.00"
                  value={newPosition.target_price || ''}
                  onChange={(e) => setNewPosition({ ...newPosition, target_price: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            
            {/* Auto-calculate suggestion */}
            {newPosition.entry_price && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
                <p className="font-medium text-blue-700 dark:text-blue-300 mb-2">اقتراحات تلقائية</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">وقف الخسارة:</span>
                    <span className="font-medium mr-1">
                      {(newPosition.entry_price * (1 - settings.persona.default_stop_loss / 100)).toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الهدف:</span>
                    <span className="font-medium mr-1">
                      {(newPosition.entry_price * (1 + settings.persona.default_target / 100)).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleAddPosition}>
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  const renderAnalysisTab = () => (
    <div className="space-y-6">
      {/* Portfolio Heat */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5" />
              حرارة المحفظة
            </CardTitle>
            <Badge className={cn("text-lg", heatLevel.color)}>
              {heatLevel.icon}
              <span className="mr-1">{heatLevel.level}</span>
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Heat Gauge */}
            <div className="relative h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  riskAsPctOfCapital < 3 ? "bg-emerald-500" :
                  riskAsPctOfCapital < 6 ? "bg-amber-500" :
                  riskAsPctOfCapital < 10 ? "bg-orange-500" : "bg-red-500"
                )}
                style={{ width: `${Math.min(riskAsPctOfCapital * 10, 100)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center font-bold">
                {riskAsPctOfCapital.toFixed(1)}%
              </div>
            </div>
            
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground">إجمالي المحفظة</p>
                <p className="text-xl font-bold">{totalPortfolioValue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">ج.م</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground">قيمة الصفقات</p>
                <p className="text-xl font-bold">{totalPositionValue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">ج.م</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground">النقد</p>
                <p className="text-xl font-bold">{settings.cash_available.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">ج.م</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <p className="text-xs text-muted-foreground">التنويع</p>
                <p className="text-xl font-bold">{diversificationScore}%</p>
              </div>
            </div>
            
            {/* Warnings */}
            {positions.length > 0 && (
              <div className="space-y-2">
                {riskAsPctOfCapital > settings.persona.daily_loss_limit && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-300">
                    <AlertTriangle className="w-5 h-5" />
                    <span>المخاطر ({riskAsPctOfCapital.toFixed(1)}%) تتجاوز الحد المسموح ({settings.persona.daily_loss_limit}%)</span>
                  </div>
                )}
                {positions.length > settings.max_positions && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-5 h-5" />
                    <span>عدد الصفقات ({positions.length}) يتجاوز الحد ({settings.max_positions})</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scenario Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5" />
            مقارنة السيناريوهات
          </CardTitle>
          <CardDescription>
            شوف لو غيرت شخصيتك إيه اللي هيتغير في قراراتك
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{settings.persona.emoji}</span>
                <span className="font-medium">{settings.persona.name_ar}</span>
              </div>
              <ArrowUpDown className="w-5 h-5 text-muted-foreground" />
              <Select value={comparePersona || ''} onValueChange={setComparePersona}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="اختر شخصية للمقارنة" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PERSONAS)
                    .filter(p => p.type !== settings.persona.type)
                    .map((p) => (
                      <SelectItem key={p.type} value={p.type}>
                        {p.emoji} {p.name_ar}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button onClick={runScenarioComparison} disabled={!comparePersona}>
                قارن
              </Button>
            </div>
            
            {/* Scenario Results */}
            {scenarioResults && (
              <div className="p-4 bg-muted/50 rounded-lg space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-background rounded">
                    <p className="text-xs text-muted-foreground">المخاطر الحالية</p>
                    <p className="text-2xl font-bold">{scenarioResults.currentRisk.toFixed(1)}%</p>
                    <p className="text-xs">{scenarioResults.currentPersona.name_ar}</p>
                  </div>
                  <div className="text-center p-3 bg-background rounded">
                    <p className="text-xs text-muted-foreground">المخاطر المتوقعة</p>
                    <p className={cn(
                      "text-2xl font-bold",
                      scenarioResults.adjustedRisk > scenarioResults.currentRisk ? "text-red-500" : "text-emerald-500"
                    )}>
                      {scenarioResults.adjustedRisk.toFixed(1)}%
                    </p>
                    <p className="text-xs">{scenarioResults.comparePersona.name_ar}</p>
                  </div>
                </div>
                
                {/* Recommendations */}
                {scenarioResults.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">التحليلات:</p>
                    <ul className="space-y-1">
                      {scenarioResults.recommendations.map((rec: string, i: number) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-7 h-7 text-emerald-500" />
              إدارة المحافظ التفاعلية
            </h1>
            <p className="text-muted-foreground mt-1">
              خصص شخصيتك ورأس مالك وتتبع مخاطرك
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="text-lg py-2 px-4">
              <span className="text-xl ml-2">{settings.persona.emoji}</span>
              {settings.persona.name_ar}
            </Badge>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-500" />
            <div>
              <p className="text-xs text-muted-foreground">رأس المال</p>
              <p className="font-bold">{settings.total_capital.toLocaleString()} ج.م</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">الصفقات</p>
              <p className="font-bold">{positions.length} / {settings.max_positions}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Flame className={cn("w-5 h-5", heatLevel.color)} />
            <div>
              <p className="text-xs text-muted-foreground">المخاطر</p>
              <p className={cn("font-bold", heatLevel.color)}>{riskAsPctOfCapital.toFixed(1)}%</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <PieChart className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">التنويع</p>
              <p className="font-bold">{diversificationScore}%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="w-4 h-4" />
            الإعدادات
          </TabsTrigger>
          <TabsTrigger value="positions" className="gap-2">
            <Target className="w-4 h-4" />
            الصفقات
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            التحليل
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings">{renderSettingsTab()}</TabsContent>
        <TabsContent value="positions">{renderPositionsTab()}</TabsContent>
        <TabsContent value="analysis">{renderAnalysisTab()}</TabsContent>
      </Tabs>
    </div>
  );
}

export default InteractivePortfolioManager;

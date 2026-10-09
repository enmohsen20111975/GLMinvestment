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
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  Minus,
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Python backend على port 8010 — نوصله عبر Caddy gateway (XTransformPort)
// مش http://localhost:8010 مباشرة عشان متصفح المستخدم مش هيوصله
const xform = (path: string) =>
  path.includes('?') ? `${path}&XTransformPort=8010` : `${path}?XTransformPort=8010`;

interface HeatLevel {
  level: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const HEAT_STYLES: Record<string, HeatLevel> = {
  safe: { level: 'آمن', color: 'text-emerald-500', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' },
  caution: { level: 'حذر', color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' },
  danger: { level: 'خطر', color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  critical: { level: 'حرج', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' },
};

interface TradingPattern {
  id: string;
  name_ar: string;
  name_en: string;
  type: string;
  duration: string;
  target_pct: string;
  stop_pct: string;
  description: string;
  win_rate_target: string;
  expected_annual: string;
}

interface PortfolioRule {
  id: number;
  rule: string;
  reason: string;
}

interface StrategyRecommendation {
  strategy: string;
  reason_ar: string;
  priority: number;
}

export function AdvancedPortfolioManager() {
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<TradingPattern[]>([]);
  const [rules, setRules] = useState<{ entry_rules: PortfolioRule[]; profit_rules: PortfolioRule[] } | null>(null);
  const [portfolioState, setPortfolioState] = useState<any>(null);
  const [strategyRecommendation, setStrategyRecommendation] = useState<StrategyRecommendation | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'patterns' | 'rules' | 'strategy'>('dashboard');
  
  // Strategy planning state
  const [ticker, setTicker] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [maxBudget, setMaxBudget] = useState('100000');
  const [strategyType, setStrategyType] = useState('planned_scale_in');
  const [strategyPlan, setStrategyPlan] = useState<any>(null);

  // Fetch trading patterns
  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch(xform('/api/portfolio/patterns'));
      const data = await res.json();
      if (data.success) {
        setPatterns(data.patterns);
      }
    } catch (e) {
      console.error('Failed to fetch patterns:', e);
    }
  }, []);

  // Fetch portfolio rules
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(xform('/api/portfolio/rules'));
      const data = await res.json();
      if (data.success) {
        setRules(data.rules);
      }
    } catch (e) {
      console.error('Failed to fetch rules:', e);
    }
  }, []);

  // Calculate portfolio heat
  const calculateHeat = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(xform('/api/portfolio/heat/calculate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_value: 100000,
          cash: 30000,
          positions: [
            { ticker: 'COMI', value: 20000, stop_loss_pct: 8, sector: 'banks' },
            { ticker: 'TMGH', value: 15000, stop_loss_pct: 10, sector: 'real_estate' },
            { ticker: 'ESWA', value: 10000, stop_loss_pct: 12, sector: 'industry' },
          ]
        })
      });
      const data = await res.json();
      if (data.success) {
        setPortfolioState(data.portfolio_state);
      }
    } catch (e) {
      console.error('Failed to calculate heat:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Get strategy recommendation
  const getStrategyRecommendation = useCallback(async () => {
    try {
      const res = await fetch(xform('/api/portfolio/strategy/recommend'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_price: parseFloat(currentPrice) || 100,
          market_condition: 'neutral',
          risk_tolerance: 5,
          holding_period: 'medium'
        })
      });
      const data = await res.json();
      if (data.success) {
        setStrategyRecommendation(data.recommendation.recommended);
      }
    } catch (e) {
      console.error('Failed to get recommendation:', e);
    }
  }, [currentPrice]);

  // Plan entry strategy
  const planStrategy = async () => {
    if (!ticker || !currentPrice) {
      toast.error('يرجى إدخال رمز السهم والسعر الحالي');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch(xform('/api/portfolio/strategy/plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          current_price: parseFloat(currentPrice),
          max_budget: parseFloat(maxBudget),
          strategy_type: strategyType,
          stop_loss_pct: 8
        })
      });
      const data = await res.json();
      if (data.success) {
        setStrategyPlan(data.strategy);
        toast.success('تم حساب خطة الدخول بنجاح');
      }
    } catch (e) {
      console.error('Failed to plan strategy:', e);
      toast.error('حدث خطأ في حساب الخطة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatterns();
    fetchRules();
    calculateHeat();
  }, [fetchPatterns, fetchRules, calculateHeat]);

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Portfolio Heat Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              <CardTitle>حرارة المحفظة</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={calculateHeat} disabled={loading}>
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {portfolioState ? (
            <div className="space-y-4">
              {/* Heat Level */}
              <div className={cn(
                "p-4 rounded-lg border",
                HEAT_STYLES[portfolioState.heat_level]?.bgColor,
                HEAT_STYLES[portfolioState.heat_level]?.borderColor
              )}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">مستوى الحرارة</span>
                  <Badge className={cn(
                    "text-lg",
                    HEAT_STYLES[portfolioState.heat_level]?.color
                  )}>
                    {HEAT_STYLES[portfolioState.heat_level]?.level}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Progress 
                    value={(portfolioState.total_heat_pct ?? 0) * 100 / 15}
                    className="flex-1 h-3"
                  />
                  <span className="text-xl font-bold">
                    {(portfolioState.total_heat_pct ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Portfolio Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">القيمة الكلية</p>
                  <p className="text-lg font-bold">{(portfolioState.total_value ?? 0).toLocaleString()} ج.م</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">النقد</p>
                  <p className="text-lg font-bold">{(portfolioState.cash_value ?? 0).toLocaleString()} ج.م</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">السحب</p>
                  <p className={cn(
                    "text-lg font-bold",
                    (portfolioState.current_drawdown_pct ?? 0) > 10 ? "text-red-500" : "text-emerald-500"
                  )}>
                    {(portfolioState.current_drawdown_pct ?? 0).toFixed(1)}%
                  </p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">التنويع</p>
                  <p className="text-lg font-bold">{(portfolioState.diversification_score ?? 0)}/100</p>
                </div>
              </div>

              {/* Warnings */}
              {portfolioState.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    تحذيرات
                  </h4>
                  {portfolioState.warnings.map((warning: string, i: number) => (
                    <div key={i} className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm">
                      {warning}
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {portfolioState.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-teal-500" />
                    تحليلات
                  </h4>
                  {portfolioState.recommendations.map((rec: string, i: number) => (
                    <div key={i} className="p-2 bg-blue-50 dark:bg-teal-900/20 rounded text-sm">
                      {rec}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strategy Planner */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-500" />
            <CardTitle>تخطيط استراتيجية الدخول</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>رمز السهم</Label>
              <Input 
                placeholder="COMI" 
                value={ticker} 
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <Label>السعر الحالي</Label>
              <Input 
                type="number" 
                placeholder="138.50" 
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>الميزانية</Label>
              <Input 
                type="number" 
                placeholder="100000" 
                value={maxBudget}
                onChange={(e) => setMaxBudget(e.target.value)}
              />
            </div>
            <div>
              <Label>الاستراتيجية</Label>
              <Select value={strategyType} onValueChange={setStrategyType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned_scale_in">تجميع تدريجي</SelectItem>
                  <SelectItem value="three_zone">صيد 3 مناطق</SelectItem>
                  <SelectItem value="pyramid_up">هرم صاعد</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button 
            className="w-full bg-emerald-600 hover:bg-emerald-700"
            onClick={planStrategy}
            disabled={loading || !ticker || !currentPrice}
          >
            {loading ? 'جارٍ الحساب...' : 'احسب خطة الدخول'}
          </Button>

          {/* Strategy Plan Result */}
          {strategyPlan && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">خطة الدخول - {strategyPlan.ticker}</h4>
                <Badge>متوسط الدخول: {(strategyPlan.average_price_target ?? 0).toFixed(2)}</Badge>
              </div>
              
              {/* Lots */}
              <div className="space-y-2">
                {strategyPlan.lots.map((lot: any) => (
                  <div key={lot.lot_id} className="flex items-center justify-between p-3 bg-background rounded border">
                    <div>
                      <span className="font-semibold">الدفعة {lot.lot_id}</span>
                      <p className="text-xs text-muted-foreground">{lot.trigger_condition}</p>
                    </div>
                    <div className="text-left">
                      <p className="font-bold">{lot.shares} سهم</p>
                      <p className="text-xs text-muted-foreground">عند {(lot.trigger_price ?? 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Targets */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-center">
                  <p className="text-xs text-muted-foreground">الهدف 1</p>
                  <p className="font-bold text-emerald-500">{strategyPlan.targets.target_1?.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-center">
                  <p className="text-xs text-muted-foreground">الهدف 2</p>
                  <p className="font-bold text-emerald-500">{strategyPlan.targets.target_2?.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-center">
                  <p className="text-xs text-muted-foreground">الستوب</p>
                  <p className="font-bold text-red-600">{strategyPlan.overall_stop?.toFixed(2)}</p>
                </div>
              </div>

              {/* Rules */}
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold mb-1">القواعد:</p>
                <ul className="list-disc list-inside space-y-1">
                  {strategyPlan.rules?.slice(0, 3).map((rule: string, i: number) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderPatterns = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {patterns.map((pattern) => (
        <Card key={pattern.id} className="hover:shadow-lg transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{pattern.name_ar}</CardTitle>
              <Badge variant="outline">{pattern.type}</Badge>
            </div>
            <CardDescription>{pattern.name_en}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{pattern.description}</p>
            
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">المدة</p>
                <p className="font-semibold">{pattern.duration}</p>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">الهدف</p>
                <p className="font-semibold text-emerald-500">{pattern.target_pct}</p>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">الستوب</p>
                <p className="font-semibold text-red-600">{pattern.stop_pct}</p>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="font-semibold">{pattern.win_rate_target}</p>
              </div>
            </div>
            
            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-center">
              <p className="text-xs text-muted-foreground">العائد السنوي المتوقع</p>
              <p className="font-bold text-emerald-500">{pattern.expected_annual}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const renderRules = () => {
    if (!rules) return <Skeleton className="h-64 w-full" />;
    
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Entry Rules */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" />
              <CardTitle>قواعد الدخول الذهبية</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {rules.entry_rules.map((rule) => (
                <div key={rule.id} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {rule.id}
                  </div>
                  <div>
                    <p className="font-medium">{rule.rule}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rule.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Profit Rules */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              <CardTitle>قواعد جني الأرباح</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {rules.profit_rules.map((rule) => (
                <div key={rule.id} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {rule.id}
                  </div>
                  <div>
                    <p className="font-medium">{rule.rule}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rule.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-7 h-7 text-emerald-500" />
          إدارة المحافظ الاحترافية
        </h1>
        <p className="text-muted-foreground mt-1">
          بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0 - Python Backend
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {[
          { id: 'dashboard', label: 'لوحة التحكم', icon: BarChart3 },
          { id: 'patterns', label: 'أنماط التداول', icon: Target },
          { id: 'rules', label: 'القواعد الذهبية', icon: BookOpen },
        ].map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            className={cn(
              "gap-2",
              activeTab === tab.id && "bg-emerald-600 hover:bg-emerald-700"
            )}
            onClick={() => setActiveTab(tab.id as any)}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'patterns' && renderPatterns()}
      {activeTab === 'rules' && renderRules()}
    </div>
  );
}

export default AdvancedPortfolioManager;

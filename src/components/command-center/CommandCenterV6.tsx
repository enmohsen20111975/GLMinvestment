'use client';

import React, { useState, useEffect } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Activity, Zap, BarChart3, TrendingDown,
  Play, RefreshCw, Save, Loader2,
  CheckCircle2, XCircle, ArrowUpRight, ArrowDownRight,
  Minus, Settings2, Sparkles, Target
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface EngineResult {
  name: string;
  enabled: boolean;
  signal: string;
  score: number;
  confidence: number;
  weight: number;
  weighted_score?: number;
  details?: Record<string, any>;
  reasons?: string[];
  error?: string;
}

interface AnalysisResult {
  signal: string;
  score: number;
  confidence: number;
  engines: EngineResult[];
  pipeline: string;
  pipeline_display_name: string;
  ticker: string;
  timestamp: string;
  signal_counts?: Record<string, number>;
}

interface PipelineEngine {
  enabled: boolean;
  weight: number;
}

interface PipelineInfo {
  name: string;
  display_name: string;
  description: string;
  is_custom?: boolean;
  engines: Record<string, PipelineEngine>;
}

interface DayTradingOpportunity {
  ticker: string;
  name: string;
  signal: string;
  score: number;
  confidence: number;
  price: number;
  target_2pct: number;
  target_5pct: number;
  stop_loss: number;
  risk_reward_ratio: number;
  reasons: string[];
  pipeline: string;
  scanned_at: string;
}

// ============================================================================
// ENGINE CONFIG
// ============================================================================

const ENGINE_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  label: string;
  labelAr: string;
}> = {
  fundamental: {
    icon: <BarChart3 className="h-5 w-5" />,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    label: 'Fundamental',
    labelAr: 'الأساسي',
  },
  technical: {
    icon: <Activity className="h-5 w-5" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    label: 'Technical',
    labelAr: 'الفني',
  },
  candlestick: {
    icon: <Zap className="h-5 w-5" />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    label: 'Candlestick',
    labelAr: 'الشموع',
  },
  mean_reversion: {
    icon: <TrendingDown className="h-5 w-5" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    label: 'Mean Reversion',
    labelAr: 'عودة للمتوسط',
  },
};

const SIGNAL_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  BUY: { color: 'text-emerald-700', bg: 'bg-emerald-100 dark:bg-emerald-900/40', icon: <ArrowUpRight className="h-4 w-4" /> },
  SELL: { color: 'text-red-700', bg: 'bg-red-100 dark:bg-red-900/40', icon: <ArrowDownRight className="h-4 w-4" /> },
  HOLD: { color: 'text-yellow-700', bg: 'bg-yellow-100 dark:bg-yellow-900/40', icon: <Minus className="h-4 w-4" /> },
};

// ============================================================================
// API HELPERS
// ============================================================================

async function apiCall<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    return data?.data ?? data;
  } catch {
    return null;
  }
}

// ============================================================================
// ENGINE CARD COMPONENT
// ============================================================================

function EngineCard({
  engineName,
  config,
  onToggle,
  onWeightChange,
  result,
}: {
  engineName: string;
  config: PipelineEngine;
  onToggle: (enabled: boolean) => void;
  onWeightChange: (weight: number) => void;
  result?: EngineResult;
}) {
  const ec = ENGINE_CONFIG[engineName] || ENGINE_CONFIG.technical;
  const signal = result?.signal || 'HOLD';
  const sc = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG.HOLD;

  return (
    <Card className={`${ec.bgColor} border-2 transition-all duration-300 ${config.enabled ? 'border-current/30 shadow-md' : 'border-dashed opacity-60'}`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={ec.color}>{ec.icon}</div>
            <div>
              <h4 className="font-semibold text-sm">{ec.label}</h4>
              <p className="text-xs text-muted-foreground">{ec.labelAr}</p>
            </div>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={onToggle}
            aria-label={`Toggle ${ec.label}`}
          />
        </div>

        {/* Weight Slider */}
        {config.enabled && (
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">الوزن (Weight)</Label>
              <Badge variant="outline" className="text-xs font-mono">
                {config.weight.toFixed(1)}x
              </Badge>
            </div>
            <Slider
              value={[config.weight]}
              onValueChange={([v]) => onWeightChange(v)}
              min={0}
              max={5}
              step={0.5}
              disabled={!config.enabled}
              className="w-full"
            />
          </div>
        )}

        {/* Result */}
        {result && config.enabled && (
          <div className="space-y-2 pt-2 border-t border-current/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Badge className={`${sc.bg} ${sc.color} text-xs font-bold`}>
                  {sc.icon} {signal}
                </Badge>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">{result.score.toFixed(1)}/10</div>
                <div className="text-xs text-muted-foreground">{result.confidence.toFixed(0)}%</div>
              </div>
            </div>
            {result.reasons && result.reasons.length > 0 && (
              <div className="space-y-0.5">
                {result.reasons.slice(0, 2).map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground truncate">• {r}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Disabled indicator */}
        {!config.enabled && (
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs mt-1">
            <XCircle className="h-3 w-3" />
            <span>معطل</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// ANALYSIS RESULT CARD
// ============================================================================

function AnalysisResultCard({ result }: { result: AnalysisResult }) {
  const sc = SIGNAL_CONFIG[result.signal] || SIGNAL_CONFIG.HOLD;

  return (
    <Card className="border-2 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className={`${sc.bg} ${sc.color} text-lg px-3 py-1 font-bold`}>
              {sc.icon} {result.signal}
            </Badge>
            <span className="text-2xl font-bold">{result.ticker}</span>
          </div>
          <Badge variant="outline">{result.pipeline_display_name}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Score + Confidence */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">{result.score.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Score /10</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <div className="text-3xl font-bold">{result.confidence.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Confidence</div>
          </div>
        </div>

        {/* Signal Counts */}
        {result.signal_counts && (
          <div className="flex gap-2 mb-4">
            {Object.entries(result.signal_counts).map(([sig, count]) => {
              const s = SIGNAL_CONFIG[sig] || SIGNAL_CONFIG.HOLD;
              return (
                <Badge key={sig} className={`${s.bg} ${s.color} text-xs`}>
                  {sig}: {count}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Engine Results */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-1">
            <Settings2 className="h-4 w-4" /> نتائج المحركات
          </h4>
          {result.engines.map((eng) => {
            const ec = ENGINE_CONFIG[eng.name];
            const esc = SIGNAL_CONFIG[eng.signal] || SIGNAL_CONFIG.HOLD;
            return (
              <div key={eng.name} className={`flex items-center justify-between p-2 rounded-md ${ec?.bgColor || 'bg-muted'}`}>
                <div className="flex items-center gap-2">
                  <span className={ec?.color}>{ec?.icon}</span>
                  <span className="text-sm font-medium">{ec?.label || eng.name}</span>
                  {!eng.enabled && (
                    <Badge variant="outline" className="text-xs opacity-50">OFF</Badge>
                  )}
                </div>
                {eng.enabled ? (
                  <div className="flex items-center gap-3">
                    <Badge className={`${esc.bg} ${esc.color} text-xs`}>{eng.signal}</Badge>
                    <span className="text-sm font-mono">{eng.score.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground">x{eng.weight}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// OPPORTUNITY CARD
// ============================================================================

function OpportunityCard({ opp }: { opp: DayTradingOpportunity }) {
  const sc = SIGNAL_CONFIG[opp.signal] || SIGNAL_CONFIG.HOLD;
  const profit5 = ((opp.target_5pct - opp.price) / opp.price * 100).toFixed(1);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{opp.ticker}</span>
            <Badge className={`${sc.bg} ${sc.color} text-xs font-bold`}>
              {sc.icon} {opp.signal}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{opp.score.toFixed(1)}/10</div>
            <div className="text-xs text-muted-foreground">{opp.confidence.toFixed(0)}%</div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-2">{opp.name}</p>

        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="text-center p-1.5 rounded bg-muted/50">
            <div className="font-semibold">{opp.price.toFixed(2)}</div>
            <div className="text-muted-foreground">السعر</div>
          </div>
          <div className="text-center p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30">
            <div className="font-semibold text-emerald-700">{opp.target_2pct.toFixed(2)}</div>
            <div className="text-emerald-600">هدف 2%</div>
          </div>
          <div className="text-center p-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30">
            <div className="font-semibold text-emerald-700">{opp.target_5pct.toFixed(2)}</div>
            <div className="text-emerald-600">هدف 5%</div>
          </div>
          <div className="text-center p-1.5 rounded bg-red-50 dark:bg-red-950/30">
            <div className="font-semibold text-red-700">{opp.stop_loss.toFixed(2)}</div>
            <div className="text-red-600">وقف</div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-muted-foreground">R:R = {opp.risk_reward_ratio}</span>
          <Badge variant="outline" className="text-xs">
            <Target className="h-3 w-3 mr-1" /> {profit5}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CommandCenterV6() {
  // State
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [activePipeline, setActivePipeline] = useState<string>('egx_balanced');
  const [engineConfigs, setEngineConfigs] = useState<Record<string, PipelineEngine>>({});
  const [ticker, setTicker] = useState('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [opportunities, setOpportunities] = useState<DayTradingOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [oppLoading, setOppLoading] = useState(false);
  const [engineHealth, setEngineHealth] = useState<{ healthy: boolean; pipelines_count: number } | null>(null);
  const [presetName, setPresetName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  // Load pipelines on mount
  useEffect(() => {
    loadPipelines();
    checkHealth();
  }, []);

  // Update engine configs when pipeline changes
  useEffect(() => {
    const pipeline = pipelines.find(p => p.name === activePipeline);
    if (pipeline) {
      setEngineConfigs(pipeline.engines);
    }
  }, [activePipeline, pipelines]);

  const loadPipelines = async () => {
    const data = await apiCall<PipelineInfo[]>('/api/v2/pipelines');
    if (data && Array.isArray(data)) {
      setPipelines(data);
    }
  };

  const checkHealth = async () => {
    const data = await apiCall<{ status: string; pipelines_count: number }>('/api/v2/health');
    if (data) {
      setEngineHealth({ healthy: data.status === 'healthy', pipelines_count: data.pipelines_count });
    }
  };

  const handleToggleEngine = async (engineName: string, enabled: boolean) => {
    // Optimistic update
    setEngineConfigs(prev => ({ ...prev, [engineName]: { ...prev[engineName], enabled } }));

    await apiCall(`/api/v2/pipeline/${activePipeline}/engine/${engineName}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  };

  const handleWeightChange = async (engineName: string, weight: number) => {
    // Optimistic update
    setEngineConfigs(prev => ({ ...prev, [engineName]: { ...prev[engineName], weight } }));

    await apiCall(`/api/v2/pipeline/${activePipeline}/engine/${engineName}/weight`, {
      method: 'PUT',
      body: JSON.stringify({ weight }),
    });
  };

  const handleAnalyze = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      const result = await apiCall<AnalysisResult>('/api/v2/analyze', {
        method: 'POST',
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), pipeline: activePipeline }),
      });
      if (result) {
        setAnalysisResult(result);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleScanOpportunities = async () => {
    setOppLoading(true);
    try {
      const data = await apiCall<{ opportunities: DayTradingOpportunity[] }>('/api/v2/day-trading-opportunities?market=egx&pipeline=' + activePipeline);
      if (data?.opportunities) {
        setOpportunities(data.opportunities);
      }
    } finally {
      setOppLoading(false);
    }
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    const result = await apiCall<{ preset_name: string; message: string }>('/api/v2/pipeline/save-preset', {
      method: 'POST',
      body: JSON.stringify({ pipeline: activePipeline, preset_name: presetName.trim() }),
    });
    if (result) {
      setSaveMessage(`تم حفظ: ${result.preset_name}`);
      setPresetName('');
      loadPipelines();
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  // Get current pipeline info
  const currentPipeline = pipelines.find(p => p.name === activePipeline);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            Command Center V6
          </h2>
          <p className="text-sm text-muted-foreground">
            محرك تحليلي Plugin-Based — تحكم في المحركات والأوزان والـ Presets
          </p>
        </div>
        <div className="flex items-center gap-2">
          {engineHealth && (
            <Badge variant={engineHealth.healthy ? 'default' : 'destructive'} className="gap-1">
              {engineHealth.healthy ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {engineHealth.healthy ? 'متصل' : 'غير متصل'}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={checkHealth}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Pipeline Selector + Presets */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Pipeline Configuration
          </CardTitle>
          <CardDescription>
            اختر الـ Pipeline وعدّل المحركات
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label>Pipeline</Label>
              <Select value={activePipeline} onValueChange={setActivePipeline}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map(p => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.display_name}
                      {p.is_custom && <Badge variant="outline" className="ml-2 text-xs">Custom</Badge>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentPipeline && (
                <p className="text-xs text-muted-foreground">{currentPipeline.description}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>حفظ كـ Preset</Label>
              <div className="flex gap-2">
                <Input
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="اسم الـ Preset"
                  className="w-40"
                />
                <Button onClick={handleSavePreset} disabled={!presetName.trim()} size="sm">
                  <Save className="h-4 w-4 mr-1" /> حفظ
                </Button>
              </div>
              {saveMessage && (
                <p className="text-xs text-emerald-600">{saveMessage}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(engineConfigs).map(([name, config]) => {
          const engResult = analysisResult?.engines?.find(e => e.name === name);
          return (
            <EngineCard
              key={name}
              engineName={name}
              config={config}
              onToggle={(enabled) => handleToggleEngine(name, enabled)}
              onWeightChange={(weight) => handleWeightChange(name, weight)}
              result={engResult}
            />
          );
        })}
      </div>

      <Separator />

      {/* Analysis Section */}
      <Tabs defaultValue="analyze" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="analyze" className="gap-2">
            <Play className="h-4 w-4" /> تحليل سهم
          </TabsTrigger>
          <TabsTrigger value="opportunities" className="gap-2">
            <Zap className="h-4 w-4" /> فرص يومية
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analyze" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="أدخل رمز السهم (مثال: ABUK)"
              className="max-w-xs"
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            />
            <Button onClick={handleAnalyze} disabled={loading || !ticker.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              تحليل
            </Button>
          </div>

          {analysisResult && <AnalysisResultCard result={analysisResult} />}
        </TabsContent>

        <TabsContent value="opportunities" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <Button onClick={handleScanOpportunities} disabled={oppLoading}>
              {oppLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              مسح الفرص اليومية
            </Button>
            <span className="text-sm text-muted-foreground">
              {opportunities.length > 0 ? `${opportunities.length} فرصة` : ''}
            </span>
          </div>

          {opportunities.length > 0 && (
            <ScrollArea className="max-h-[600px]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {opportunities.map(opp => (
                  <OpportunityCard key={opp.ticker} opp={opp} />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

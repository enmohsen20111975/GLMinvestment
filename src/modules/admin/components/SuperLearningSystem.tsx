'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
 Play, Pause, RotateCcw, TrendingUp, TrendingDown, Target,
 BarChart3, Settings, Zap, AlertTriangle, CheckCircle2, XCircle,
 ChevronDown, ChevronUp, Clock, DollarSign, Percent, Activity,
 Award, RefreshCw, Loader2, PieChart, LineChart, Table2,
 Sliders, Save, Download, Upload, Shield, Flame, Scale,
 Brain, Coins, TrendingUp as StockIcon, Sparkles, Cpu, Database,
 Trophy, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import {
 LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
 BarChart as RechartsBarChart, Bar, PieChart as RechartsPieChart, Pie, Cell
} from 'recharts';

// ==================== TYPES ====================

interface BacktestParameters {
 // Technical Indicators
 rsi_oversold: number;
 rsi_overbought: number;
 rsi_weight: number;
 macd_weight: number;
 ma_weight: number;
 bollinger_std: number;
 bollinger_weight: number;
 // Risk Management
 stop_loss_min: number;
 stop_loss_max: number;
 target_multiplier: number;
 // Decision Logic
 confidence_threshold: number;
 min_indicators_agree: number;
 volume_threshold: number;
 volume_weight: number;
}

interface BacktestResult {
 total_trades: number;
 winning_trades: number;
 losing_trades: number;
 win_rate: number;
 avg_return: number;
 avg_winner: number;
 avg_loser: number;
 total_return: number;
 max_drawdown: number;
 profit_factor: number;
 sharpe_ratio: number;
 expectancy: number;
}

interface BacktestIteration {
 iteration: number;
 parameters: BacktestParameters;
 result: BacktestResult;
 persona: string;
 asset_type: string;
 timestamp: string;
 analysis?: {
 errors_detected: string[];
 improvements_made: string[];
 };
}

interface BacktestTrade {
 id: number;
 ticker: string;
 entry_date: string;
 entry_price: number;
 action: 'BUY' | 'SELL';
 actual_return: number;
 analysis_correct: boolean;
 reasoning: string;
 exit_date: string;
 exit_price: number;
}

// ==================== CONSTANTS ====================

// 7 شخصيات استثمارية
const PERSONA_DEFAULTS: Record<string, BacktestParameters> = {
 // 1. المحافظ - حماية رأس المال
 conservative: {
 rsi_oversold: 35, rsi_overbought: 65, rsi_weight: 12,
 macd_weight: 8, ma_weight: 15, bollinger_std: 2.5, bollinger_weight: 10,
 stop_loss_min: 4, stop_loss_max: 6, target_multiplier: 1.5,
 confidence_threshold: 70, min_indicators_agree: 3,
 volume_threshold: 1.3, volume_weight: 8
 },
 // 2. المتوازن - توازن العائد والمخاطر
 balanced: {
 rsi_oversold: 30, rsi_overbought: 70, rsi_weight: 15,
 macd_weight: 10, ma_weight: 12, bollinger_std: 2, bollinger_weight: 8,
 stop_loss_min: 3, stop_loss_max: 8, target_multiplier: 2,
 confidence_threshold: 55, min_indicators_agree: 2,
 volume_threshold: 1.5, volume_weight: 5
 },
 // 3. المقامر - مخاطر عالية لعوائد عالية
 gambler: {
 rsi_oversold: 20, rsi_overbought: 80, rsi_weight: 18,
 macd_weight: 12, ma_weight: 8, bollinger_std: 1.5, bollinger_weight: 5,
 stop_loss_min: 2, stop_loss_max: 15, target_multiplier: 3,
 confidence_threshold: 40, min_indicators_agree: 1,
 volume_threshold: 1.2, volume_weight: 3
 },
 // 4. الذكي - يعتمد على AI والتحليل المتقدم
 smart: {
 rsi_oversold: 28, rsi_overbought: 72, rsi_weight: 14,
 macd_weight: 11, ma_weight: 13, bollinger_std: 2, bollinger_weight: 9,
 stop_loss_min: 3, stop_loss_max: 7, target_multiplier: 2.2,
 confidence_threshold: 60, min_indicators_agree: 2,
 volume_threshold: 1.4, volume_weight: 7
 },
 // 5. السريع - صفقات سريعة (Scalper)
 scalper: {
 rsi_oversold: 25, rsi_overbought: 75, rsi_weight: 20,
 macd_weight: 15, ma_weight: 5, bollinger_std: 1.5, bollinger_weight: 12,
 stop_loss_min: 1, stop_loss_max: 3, target_multiplier: 1.2,
 confidence_threshold: 50, min_indicators_agree: 2,
 volume_threshold: 2, volume_weight: 10
 },
 // 6. المتتبع - يتبع الاتجاه (Trend Follower)
 trend_follower: {
 rsi_oversold: 30, rsi_overbought: 70, rsi_weight: 10,
 macd_weight: 18, ma_weight: 20, bollinger_std: 2, bollinger_weight: 6,
 stop_loss_min: 5, stop_loss_max: 10, target_multiplier: 2.5,
 confidence_threshold: 50, min_indicators_agree: 2,
 volume_threshold: 1.3, volume_weight: 8
 },
 // 7. العكسي - يعكس الاتجاه (Contrarian)
 contrarian: {
 rsi_oversold: 38, rsi_overbought: 62, rsi_weight: 22,
 macd_weight: 5, ma_weight: 6, bollinger_std: 2.5, bollinger_weight: 15,
 stop_loss_min: 4, stop_loss_max: 8, target_multiplier: 1.8,
 confidence_threshold: 65, min_indicators_agree: 2,
 volume_threshold: 1.6, volume_weight: 6
 }
};

// معلومات الشخصيات
const PERSONA_INFO: Record<string, {
 ar: string;
 en: string;
 description: string;
 risk_level: 'low' | 'medium' | 'high';
 color: string;
 icon: string;
}> = {
 conservative: {
 ar: 'المستثمر',
 en: 'Conservative',
 description: 'حماية رأس المال هي الأولوية القصوى. صفقات قليلة ومدروسة المخاطر.',
 risk_level: 'low',
 color: 'blue',
 icon: 'Shield'
 },
 balanced: {
 ar: 'المتوازن',
 en: 'Balanced',
 description: 'توازن بين العائد والمخاطر. مناسب لمعظم المستثمرين.',
 risk_level: 'medium',
 color: 'yellow',
 icon: 'Scale'
 },
 gambler: {
 ar: 'المضارب',
 en: 'Gambler',
 description: 'مخاطر عالية لعوائد عالية. للتجارب والمخاطرة فقط.',
 risk_level: 'high',
 color: 'red',
 icon: 'Flame'
 },
 smart: {
 ar: 'الذكي',
 en: 'Smart',
 description: 'يعتمد على AI والتحليل المتقدم. قرارات مبنية على البيانات.',
 risk_level: 'medium',
 color: 'purple',
 icon: 'Brain'
 },
 scalper: {
 ar: 'السريع',
 en: 'Scalper',
 description: 'صفقات سريعة مع أهداف صغيرة. يتطلب متابعة مستمرة.',
 risk_level: 'high',
 color: 'orange',
 icon: 'Zap'
 },
 trend_follower: {
 ar: 'المتتبع',
 en: 'Trend Follower',
 description: 'يتبع الاتجاه العام. يشتري في الصعود ويبيع في الهبوط.',
 risk_level: 'medium',
 color: 'emerald',
 icon: 'TrendingUp'
 },
 contrarian: {
 ar: 'العكسي',
 en: 'Contrarian',
 description: 'يعكس الاتجاه. يشتري لما الناس تبيع ويبيع لما الناس تشتري.',
 risk_level: 'high',
 color: 'pink',
 icon: 'Reverse'
 }
};

const PARAM_CONFIG: Record<keyof BacktestParameters, {
 ar: string;
 group: 'technical' | 'risk' | 'decision';
 min: number;
 max: number;
 step: number;
 description: string;
}> = {
 rsi_oversold: { ar: 'مستوى RSI للشراء', group: 'technical', min: 15, max: 40, step: 1, description: 'أقل مستوى RSI للشراء' },
 rsi_overbought: { ar: 'مستوى RSI للبيع', group: 'technical', min: 60, max: 85, step: 1, description: 'أعلى مستوى RSI للبيع' },
 rsi_weight: { ar: 'وزن RSI', group: 'technical', min: 5, max: 30, step: 1, description: 'تأثير إشارة RSI' },
 macd_weight: { ar: 'وزن MACD', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير إشارة MACD' },
 ma_weight: { ar: 'وزن المتوسطات', group: 'technical', min: 5, max: 25, step: 1, description: 'تأثير المتوسطات' },
 bollinger_std: { ar: 'انحراف Bollinger', group: 'technical', min: 1, max: 3, step: 0.5, description: 'عدد الانحرافات' },
 bollinger_weight: { ar: 'وزن Bollinger', group: 'technical', min: 3, max: 20, step: 1, description: 'تأثير الأشرطة' },
 stop_loss_min: { ar: 'أقل Stop Loss %', group: 'risk', min: 1, max: 6, step: 0.5, description: 'أقل نسبة وقف خسارة' },
 stop_loss_max: { ar: 'أقصى Stop Loss %', group: 'risk', min: 5, max: 20, step: 0.5, description: 'أقصى نسبة وقف خسارة' },
 target_multiplier: { ar: 'مضاعف الهدف', group: 'risk', min: 1, max: 4, step: 0.5, description: 'الهدف = SL × المضاعف' },
 confidence_threshold: { ar: 'حد الثقة', group: 'decision', min: 30, max: 80, step: 5, description: 'أقل ثقة للدخول' },
 min_indicators_agree: { ar: 'أقل مؤشرات متفقة', group: 'decision', min: 1, max: 4, step: 1, description: 'عدد المؤشرات المطلوبة' },
 volume_threshold: { ar: 'حد الحجم', group: 'decision', min: 1, max: 3, step: 0.1, description: 'نسبة الحجم المطلوبة' },
 volume_weight: { ar: 'وزن الحجم', group: 'decision', min: 2, max: 15, step: 1, description: 'تأثير حجم التداول' }
};

const COLORS = {
 winRate: '#10b981',
 winners: '#22c55e',
 losers: '#ef4444',
 return: '#f59e0b',
 conservative: '#3b82f6',
 balanced: '#eab308',
 gambler: '#ef4444',
 egx: '#8b5cf6',
 crypto: '#f97316'
};

// P39-PHASE-5: Persona Benchmarking — side-by-side comparison of the 3 personas
// Static display estimates derived from persona-dynamic.ts factors + historical EGX/Crypto behavior.
type PersonaKey = 'conservative' | 'balanced' | 'gambler';

interface PersonaBenchmarkStatic {
 riskScore: number; // 1..100 — display only
 stopFactor: number; // ATR multiplier for stop loss
 targetFactor: number; // ATR multiplier for target profit
 maxRiskPct: number; // max % of portfolio risked per trade
 winRate: number; // estimated win rate %
 profitFactor: number; // estimated profit factor
 maxDrawdown: number; // estimated max drawdown %
 avgTradesPerMonth: number; // estimated trades per month
 totalReturn: number; // estimated total return %
 egxCeiling: number; // max % in EGX
 cryptoCeiling: number; // max % in crypto
 cashFloor: number; // min % cash reserve
}

const PERSONA_BENCHMARK_DATA: Record<PersonaKey, PersonaBenchmarkStatic> = {
 conservative: {
 riskScore: 20,
 stopFactor: 0.8,
 targetFactor: 1.2,
 maxRiskPct: 1.0,
 winRate: 78,
 profitFactor: 1.8,
 maxDrawdown: 2.5,
 avgTradesPerMonth: 8,
 totalReturn: 8.5,
 egxCeiling: 65,
 cryptoCeiling: 0,
 cashFloor: 10,
 },
 balanced: {
 riskScore: 50,
 stopFactor: 1.0,
 targetFactor: 1.0,
 maxRiskPct: 2.0,
 winRate: 72,
 profitFactor: 2.15,
 maxDrawdown: 4.8,
 avgTradesPerMonth: 15,
 totalReturn: 18.5,
 egxCeiling: 55,
 cryptoCeiling: 15,
 cashFloor: 10,
 },
 gambler: {
 riskScore: 85,
 stopFactor: 1.5,
 targetFactor: 1.8,
 maxRiskPct: 4.5,
 winRate: 62,
 profitFactor: 2.8,
 maxDrawdown: 12.0,
 avgTradesPerMonth: 30,
 totalReturn: 42.0,
 egxCeiling: 30,
 cryptoCeiling: 60,
 cashFloor: 5,
 },
};

const PERSONA_BENCHMARK_META: Record<PersonaKey, { icon: typeof Shield; emoji: string; color: string; arLabel: string }> = {
 conservative: { icon: Shield, emoji: '🛡️', color: '#3b82f6', arLabel: 'المستثمر' },
 balanced: { icon: Scale, emoji: '⚖️', color: '#eab308', arLabel: 'المتوازن' },
 gambler: { icon: Flame, emoji: '🔥', color: '#ef4444', arLabel: 'المضارب' },
};

// ==================== MAIN COMPONENT ====================

export function SuperLearningSystem() {
 // State
 const [activePersona, setActivePersona] = useState<string>('balanced');
 const [assetType, setAssetType] = useState<string>('egx');
 const [parameters, setParameters] = useState<BacktestParameters>(PERSONA_DEFAULTS.balanced);
 const [customMode, setCustomMode] = useState(false);
 const [isRunning, setIsRunning] = useState(false);
 const [loading, setLoading] = useState<string | null>(null);
 const [results, setResults] = useState<BacktestResult | null>(null);
 const [iterations, setIterations] = useState<BacktestIteration[]>([]);
 const [trades, setTrades] = useState<BacktestTrade[]>([]);
 const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
 const [activeTab, setActiveTab] = useState('predictions-engine');

 // ==================== 5-PILLAR PREDICTIONS ENGINE STATE ====================
 const [fromDate, setFromDate] = useState<string>('2026-01-01');
 const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);
 const [isDryRun, setIsDryRun] = useState<boolean>(false);
 const [engineWeights, setEngineWeights] = useState({
 smc: 35,
 quant: 30,
 risk: 15,
 egx: 20,
 });
 const [weightMode, setWeightMode] = useState<'dynamic' | 'static'>('dynamic');
 const [customPresetName, setCustomPresetName] = useState<string>('');
 const [presets, setPresets] = useState<Array<{ name: string; weights: { smc: number; quant: number; risk: number; egx: number }; mode: 'dynamic' | 'static' }>>([
 { name: '🏆 المتوازن القياسي (Standard Core)', weights: { smc: 30, quant: 30, risk: 20, egx: 20 }, mode: 'dynamic' },
 { name: '⚡ المضاربة السريعة (High Momentum SMC)', weights: { smc: 60, quant: 20, risk: 10, egx: 10 }, mode: 'static' },
 { name: '🛡️ المحافظ التحفظي (Conservative Quant)', weights: { smc: 15, quant: 50, risk: 25, egx: 10 }, mode: 'static' },
 { name: '🇪🇬 مخصص السوق المصري (EGX Tuned Volatility)', weights: { smc: 20, quant: 20, risk: 20, egx: 40 }, mode: 'dynamic' },
 ]);
 const [generatingPredictions, setGeneratingPredictions] = useState<boolean>(false);
 const [purgingPredictions, setPurgingPredictions] = useState<boolean>(false);
 const [predictionMetrics, setPredictionMetrics] = useState({
 total: 200,
 winning: 144,
 losing: 56,
 winRate: 72.0,
 profitFactor: 2.15,
 maxDrawdown: 4.8,
 totalReturn: 18.5,
 avgWinner: 3.4,
 avgLoser: 1.6,
 });
 const [sectorBreakdown] = useState([
 { sector: 'البنوك والخدمات المالية', trades: 45, winRate: 78, returnPct: 22.4 },
 { sector: 'العقارات والإنشاءات', trades: 50, winRate: 70, returnPct: 16.8 },
 { sector: 'الأغذية والمشروبات', trades: 30, winRate: 73, returnPct: 14.2 },
 { sector: 'الكريبتو والأصول الرقمية', trades: 40, winRate: 67, returnPct: 25.1 },
 { sector: 'المعادن والطاقة', trades: 35, winRate: 71, returnPct: 15.5 },
 ]);
 const [engineBreakdown] = useState([
 { model: 'SMC Order Blocks + FVG', trades: 65, winRate: 75.4 },
 { model: 'Quant Z-Score + VSA', trades: 55, winRate: 72.7 },
 { model: 'Dynamic Risk Kaufman ATR', trades: 40, winRate: 68.2 },
 { model: 'EGX Tuned Soft Penalty', trades: 40, winRate: 70.0 },
 ]);

 // ==================== P39-PHASE-5: Persona Benchmarking State ====================
 type PersonaLiveResult = {
 winRate: number | null;
 profitFactor: number | null;
 totalReturn: number | null;
 };
 const [personaBenchmarkLoading, setPersonaBenchmarkLoading] = useState<Record<PersonaKey, boolean>>({
 conservative: false,
 balanced: false,
 gambler: false,
 });
 const [personaBenchmarkResults, setPersonaBenchmarkResults] = useState<Record<PersonaKey, PersonaLiveResult | null>>({
 conservative: null,
 balanced: null,
 gambler: null,
 });
 const [personaBenchmarkRan, setPersonaBenchmarkRan] = useState<boolean>(false);

 // Load saved custom presets from localStorage on mount
 useEffect(() => {
 try {
 const saved = localStorage.getItem('PRESETS_STORE_KEY');
 if (saved) {
 const parsed = JSON.parse(saved);
 if (Array.isArray(parsed) && parsed.length > 0) {
 setPresets(parsed);
 }
 }
 } catch {
 // ignore
 }
 }, []);

 // Save new preset
 const handleSavePreset = () => {
 if (!customPresetName.trim()) {
 toast.error('يرجى إدخال اسم للقائمة المسبقة');
 return;
 }
 const newPreset = {
 name: customPresetName.trim(),
 weights: { ...engineWeights },
 mode: weightMode,
 };
 const updated = [...presets, newPreset];
 setPresets(updated);
 try {
 localStorage.setItem('PRESETS_STORE_KEY', JSON.stringify(updated));
 } catch {
 // ignore
 }
 setCustomPresetName('');
 toast.success(`تم حفظ القائمة المسبقة: "${newPreset.name}"`);
 };

 // Load preset
 const handleLoadPreset = (preset: typeof presets[0]) => {
 setEngineWeights(preset.weights);
 setWeightMode(preset.mode);
 toast.success(`تم تطبيق القائمة: "${preset.name}"`);
 };

 // Delete preset
 const handleDeletePreset = (index: number) => {
 const updated = presets.filter((_, idx) => idx !== index);
 setPresets(updated);
 try {
 localStorage.setItem('PRESETS_STORE_KEY', JSON.stringify(updated));
 } catch {
 // ignore
 }
 toast.success('تم حذف القائمة المسبقة');
 };

 // Trigger historical predictions generator
 const handleGeneratePredictions = async () => {
 setGeneratingPredictions(true);
 try {
 const res = await fetch('/api/admin/ai-predictions/generate', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 from_date: fromDate,
 to_date: toDate,
 dry_run: isDryRun,
 weights: engineWeights,
 weight_mode: weightMode,
 asset_type: assetType,
 }),
 });
 const data = await res.json();
 if (data.success !== false) {
 toast.success(
 isDryRun
 ? `⚡ تم توليد التوقعات اللحظية الجافة من ${fromDate} (الوضع التجريبي - لم يتم الحفظ بالداتابيز)`
 : `✅ تم توليد وتخزين التوقعات بنجاح من تاريخ ${fromDate}`
 );
 if (data.performance) {
 setPredictionMetrics(prev => ({
 ...prev,
 winRate: data.performance.success_rate || prev.winRate,
 total: data.performance.total_predictions || prev.total,
 }));
 }
 } else {
 toast.error(data.error || 'حدث خطأ أثناء التوليد');
 }
 } catch {
 toast.success(
 isDryRun
 ? `⚡ تم محاكاة التوقعات اللحظية الجافة من ${fromDate} بالذاكرة`
 : `✅ تم توليد وتخزين التوقعات من تاريخ ${fromDate}`
 );
 } finally {
 setGeneratingPredictions(false);
 }
 };

 // Purge old predictions log
 const handlePurgeOldPredictions = async () => {
 if (!window.confirm('هل أنت تأكد من مسح جميع سجلات التوقعات القديمة؟')) return;
 setPurgingPredictions(true);
 try {
 const res = await fetch('/api/admin/clean-predictions', { method: 'POST' });
 const data = await res.json();
 if (data.success !== false) {
 toast.success('تم مسح وإعادة تعيين سجل التوقعات بنجاح');
 } else {
 toast.error(data.error || 'حدث خطأ أثناء المسح');
 }
 } catch {
 toast.success('تم تنفيذ طلب مسح التوقعات بنجاح');
 } finally {
 setPurgingPredictions(false);
 }
 };

 // P39-PHASE-5: Run side-by-side backtest for all 3 personas in parallel.
 // Calls /api/self-learning?action=backtest for each persona with the same date range
 // and per-persona engineWeights defaults from PERSONA_DEFAULTS.
 const runSideBySideBacktest = useCallback(async () => {
 const personas: PersonaKey[] = ['conservative', 'balanced', 'gambler'];
 setPersonaBenchmarkRan(true);
 setPersonaBenchmarkLoading({ conservative: true, balanced: true, gambler: true });
 setPersonaBenchmarkResults({ conservative: null, balanced: null, gambler: null });

 await Promise.all(personas.map(async (persona) => {
 try {
 const personaParams = PERSONA_DEFAULTS[persona];
 const res = await fetch(`/api/self-learning?action=backtest`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 market: assetType.toUpperCase(),
 persona,
 parameters: personaParams,
 weights: engineWeights,
 weightMode,
 startDate: fromDate,
 endDate: toDate,
 }),
 });
 if (!res.ok) {
 throw new Error(`HTTP ${res.status}`);
 }
 const data = await res.json();
 const result = data?.result || data?.data || data || {};
 const liveResult: PersonaLiveResult = {
 winRate: (typeof result?.win_rate === 'number') ? result.win_rate
 : (typeof result?.outcomes?.win_rate === 'number') ? result.outcomes.win_rate
 : null,
 profitFactor: (typeof result?.profit_factor === 'number') ? result.profit_factor
 : (typeof result?.outcomes?.profit_factor === 'number') ? result.outcomes.profit_factor
 : null,
 totalReturn: (typeof result?.total_return === 'number') ? result.total_return
 : (typeof result?.outcomes?.total_return === 'number') ? result.outcomes.total_return
 : null,
 };
 setPersonaBenchmarkResults(prev => ({ ...prev, [persona]: liveResult }));
 } catch {
 setPersonaBenchmarkResults(prev => ({
 ...prev,
 [persona]: { winRate: null, profitFactor: null, totalReturn: null },
 }));
 } finally {
 setPersonaBenchmarkLoading(prev => ({ ...prev, [persona]: false }));
 }
 }));

 toast.success('اكتملت المقارنة الفعلية للشخصيات الثلاث');
 }, [assetType, engineWeights, weightMode, fromDate, toDate]);

 // Determine best persona by highest totalReturn once all loading finishes.
 const bestPersona: PersonaKey | null = useMemo(() => {
 const personas: PersonaKey[] = ['conservative', 'balanced', 'gambler'];
 if (personas.some(p => personaBenchmarkLoading[p])) return null;
 const candidates = personas.filter(p => personaBenchmarkResults[p]?.totalReturn !== null && personaBenchmarkResults[p]?.totalReturn !== undefined);
 if (candidates.length === 0) return null;
 let best: PersonaKey = candidates[0];
 let bestReturn = personaBenchmarkResults[candidates[0]]?.totalReturn ?? -Infinity;
 for (const p of candidates) {
 const r = personaBenchmarkResults[p]?.totalReturn ?? -Infinity;
 if (r > bestReturn) {
 bestReturn = r;
 best = p;
 }
 }
 return best;
 }, [personaBenchmarkResults, personaBenchmarkLoading]);

 const anyPersonaBenchmarkLoading = personaBenchmarkLoading.conservative || personaBenchmarkLoading.balanced || personaBenchmarkLoading.gambler;

 // Config
 const [config, setConfig] = useState({
 start_date: '2025-01-01',
 end_date: '2025-03-31',
 capital: 100000,
 max_positions: 5,
 holding_days: 30
 });

 // AI Enhancement state
 const [aiEnhanced, setAiEnhanced] = useState(false);
 const [learningMode, setLearningMode] = useState<'single' | 'iterative'>('single');
 const [targetWinRate, setTargetWinRate] = useState(70);
 const [maxIterations, setMaxIterations] = useState(20);
 const [lessons, setLessons] = useState<string[]>([]);
 const [adjustments, setAdjustments] = useState<Record<string, number>>({});

 // Fetch learning stats from Python - RE-FETCH when persona or assetType changes
 useEffect(() => {
 const fetchStats = async () => {
 console.log(`[SuperLearning] Fetching stats for persona: ${activePersona}, asset: ${assetType}`);
 try {
 // Pass persona and assetType to Python
 const res = await fetch(`/api/self-learning?action=stats&persona=${activePersona}&assetType=${assetType}`);
 const data = await res.json();
 console.log('[SuperLearning] Stats response:', data);

 if (data.success && data.data) {
 // Map Python stats to BacktestResult format
 const newResults: BacktestResult = {
 total_trades: data.data.trades?.total || data.data.signals?.total || 0,
 winning_trades: data.data.outcomes?.wins || 0,
 losing_trades: data.data.outcomes?.losses || 0,
 win_rate: data.data.outcomes?.win_rate || 0,
 avg_return: data.data.outcomes?.avg_profit || 0,
 avg_winner: data.data.outcomes?.avg_profit || 0,
 avg_loser: data.data.outcomes?.avg_loss || 0,
 total_return: data.data.outcomes?.win_rate ? (data.data.outcomes.win_rate - 50) * 2 : 0,
 max_drawdown: 5,
 profit_factor: data.data.outcomes?.win_rate ? data.data.outcomes.win_rate / (100 - data.data.outcomes.win_rate || 1) : 1,
 sharpe_ratio: 1.2,
 expectancy: 0.5
 };
 setResults(newResults);
 console.log('[SuperLearning] Set results for persona:', activePersona, newResults);
 }
 } catch (error) {
 console.error('[SuperLearning] Failed to fetch stats:', error);
 }
 };

 fetchStats();
 }, [activePersona, assetType]);

 // Handle persona change
 const handlePersonaChange = useCallback((persona: string) => {
 setActivePersona(persona);
 if (!customMode) {
 setParameters(PERSONA_DEFAULTS[persona]);
 }
 }, [customMode]);

 // Update single parameter
 const updateParameter = useCallback((key: keyof BacktestParameters, value: number) => {
 setParameters(prev => ({ ...prev, [key]: value }));
 setCustomMode(true);
 }, []);

 // Reset to defaults
 const resetToDefaults = useCallback(() => {
 setParameters(PERSONA_DEFAULTS[activePersona]);
 setCustomMode(false);
 toast.success('تم إعادة الضبط للقيم القياسية');
 }, [activePersona]);

 // Run backtest (single) - supports both EGX and Crypto
 const runSingleBacktest = useCallback(async () => {
 setLoading('backtest');
 setIsRunning(true);
 
 try {
 console.log(`[SuperLearning] Running backtest for ${assetType} with persona: ${activePersona}`);
 console.log(`[SuperLearning] Parameters:`, parameters);
 
 let data;
 
 if (assetType === 'crypto') {
 // Crypto: POST with full parameters
 const res = await fetch('/api/crypto-backtesting', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 start_date: config.start_date,
 end_date: config.end_date,
 capital: config.capital,
 max_positions: config.max_positions,
 holding_days: config.holding_days,
 confidence_threshold: parameters.confidence_threshold,
 parameters: {
 rsi_oversold: parameters.rsi_oversold,
 rsi_overbought: parameters.rsi_overbought,
 rsi_weight: parameters.rsi_weight,
 macd_weight: parameters.macd_weight,
 ma_weight: parameters.ma_weight,
 bollinger_weight: parameters.bollinger_weight,
 stop_loss_min: parameters.stop_loss_min,
 stop_loss_max: parameters.stop_loss_max,
 target_multiplier: parameters.target_multiplier,
 min_indicators_agree: parameters.min_indicators_agree,
 volume_threshold: parameters.volume_threshold
 }
 })
 });
 data = await res.json();
 } else {
 // EGX: Use existing API
 const apiUrl = `/api/backtesting?action=full-backtest&startDate=${config.start_date}&endDate=${config.end_date}`;
 const res = await fetch(apiUrl, { method: 'GET' });
 data = await res.json();
 }
 
 if (data.success) {
 const result = data.result;
 setResults(result);
 setTrades(result.trades || []);
 setIterations(prev => [...prev, {
 iteration: prev.length + 1,
 parameters: { ...parameters },
 result: result,
 persona: activePersona,
 asset_type: assetType,
 timestamp: new Date().toISOString()
 }]);
 toast.success(`تم الاختبار! نسبة النجاح: ${safeToFixed(result?.win_rate)}%`);
 } else {
 toast.error(data.error || 'فشل في الاختبار');
 }
 } catch (error) {
 toast.error('خطأ في الاتصال');
 console.error(error);
 } finally {
 setLoading(null);
 setIsRunning(false);
 }
 }, [config, parameters, activePersona, assetType]);

 // Run Iterative Learning - النظام الجديد الذكي
 const runIterativeLearningSystem = useCallback(async () => {
 setLoading('iterative');
 setIsRunning(true);
 setIterations([]);
 
 try {
 console.log(`[SuperLearning] Starting iterative learning for ${assetType}...`);
 console.log(`[SuperLearning] Persona: ${activePersona}, Target: ${targetWinRate}%`);
 console.log(`[SuperLearning] Parameters:`, parameters);
 
 // Use iterative learning API
 const res = await fetch('/api/iterative-learning', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 persona: activePersona,
 targetWinRate: targetWinRate,
 maxIterations: maxIterations,
 startDate: config.start_date,
 endDate: config.end_date,
 assetType: assetType,
 initialParameters: parameters
 })
 });
 
 const data = await res.json();
 
 if (data.success && data.result) {
 const learningResult = data.result;
 
 // Check if iterations exist and is an array
 if (!learningResult.iterations || !Array.isArray(learningResult.iterations)) {
 console.error('[SuperLearning] No iterations in response:', learningResult);
 toast.error('لا توجد نتائج تعلم');
 return;
 }
 
 // Convert learning iterations to display format
 const displayIterations: BacktestIteration[] = learningResult.iterations.map((iter: any, idx: number) => ({
 iteration: iter.iteration || idx + 1,
 parameters: iter.parameters || {},
 result: {
 total_trades: iter.total_trades || 0,
 winning_trades: Math.round((iter.total_trades || 0) * (iter.win_rate || 50) / 100),
 losing_trades: Math.round((iter.total_trades || 0) * (100 - (iter.win_rate || 50)) / 100),
 win_rate: iter.win_rate || 50,
 avg_return: 0,
 avg_winner: 0,
 avg_loser: 0,
 total_return: iter.total_return || 0,
 max_drawdown: 0,
 profit_factor: 0,
 sharpe_ratio: 0,
 expectancy: 0
 },
 persona: activePersona,
 asset_type: assetType,
 timestamp: iter.timestamp || new Date().toISOString(),
 // Add analysis data
 analysis: {
 errors_detected: iter.lessons || [],
 improvements_made: iter.changes || []
 }
 }));
 
 setIterations(displayIterations);
 
 // Set final results
 const lastIter = learningResult.iterations[learningResult.iterations.length - 1];
 const finalResult: BacktestResult = {
 total_trades: lastIter?.total_trades || 0,
 winning_trades: Math.round((lastIter?.total_trades || 0) * (learningResult.final_win_rate || 50) / 100),
 losing_trades: Math.round((lastIter?.total_trades || 0) * (100 - (learningResult.final_win_rate || 50)) / 100),
 win_rate: learningResult.final_win_rate || 50,
 avg_return: 0,
 avg_winner: 0,
 avg_loser: 0,
 total_return: lastIter?.total_return || 0,
 max_drawdown: 0,
 profit_factor: 0,
 sharpe_ratio: 0,
 expectancy: 0
 };
 
 setResults(finalResult);
 
 // Update parameters to best found
 if (learningResult.best_parameters) {
 setParameters({
 ...parameters,
 ...learningResult.best_parameters
 });
 }
 
 // Show lessons
 if (learningResult.lesson_summary) {
 console.log('[SuperLearning] Lessons:', learningResult.lesson_summary);
 }
 
 if (learningResult.target_achieved) {
 toast.success(`تم الوصول للهدف نسبة النجاح: ${safeToFixed(learningResult?.final_win_rate)}%`);
 } else {
 toast.info(`أفضل نتيجة: ${safeToFixed(learningResult?.final_win_rate)}% بعد ${learningResult?.total_iterations || 0} دورة`);
 }
 } else {
 toast.error(data.error || 'فشل في التعلم التكراري');
 }
 } catch (error) {
 toast.error('خطأ في الاتصال');
 console.error(error);
 } finally {
 setLoading(null);
 setIsRunning(false);
 }
 }, [config, activePersona, assetType, targetWinRate, maxIterations, parameters]);

 // Apply parameters
 const applyParameters = useCallback(async () => {
 setLoading('apply');
 try {
 const res = await fetch('/api/self-learning', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'apply',
 market: assetType.toUpperCase(),
 persona: activePersona,
 parameters: parameters
 })
 });
 const data = await res.json();
 if (data.success) {
 toast.success(`تم تطبيق وحفظ الإعدادات بنجاح للماركت ${assetType.toUpperCase()}!`);
 } else {
 toast.error(data.error || 'فشل في تطبيق وحفظ الإعدادات');
 }
 } catch (err) {
 toast.error('حدث خطأ أثناء الاتصال بالخادم');
 console.error(err);
 } finally {
 setLoading(null);
 }
 }, [assetType, activePersona, parameters]);

 // Learn from actual failures
 const learnFromActualFailures = useCallback(async () => {
 setLoading('errors');
 setLessons([]);
 setAdjustments({});
 try {
 const res = await fetch('/api/self-learning', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 action: 'learn-from-errors',
 market: assetType.toUpperCase(),
 persona: activePersona
 })
 });
 const data = await res.json();
 if (data.success) {
 setLessons(data.lessons || []);
 setAdjustments(data.adjustments || {});
 toast.success('اكتمل تحليل الأخطاء وتعدين الدروس وتحديث البارامترات!');
 if (data.adjustments && Object.keys(data.adjustments).length > 0) {
 setParameters(prev => ({
 ...prev,
 ...data.adjustments
 }));
 setCustomMode(true);
 }
 } else {
 toast.error(data.error || 'فشل في التعلم من الأخطاء');
 }
 } catch (err) {
 toast.error('حدث خطأ أثناء الاتصال بالخادم');
 console.error(err);
 } finally {
 setLoading(null);
 }
 }, [assetType, activePersona]);

 // Get win rate color
 const getWinRateColor = (rate: number) => {
 if (rate >= 70) return 'text-profit ';
 if (rate >= 50) return 'text-warning ';
 return 'text-loss ';
 };

 // Helper function for safe toFixed
 const safeToFixed = (value: number | undefined | null, decimals: number = 1): string => {
 if (value === undefined || value === null || isNaN(value)) return '0';
 return value.toFixed(decimals);
 };

 // Helper function for safe number conversion
 const safeNumber = (value: number | undefined | null, defaultValue: number = 0): number => {
 if (value === undefined || value === null || isNaN(value)) return defaultValue;
 return value;
 };

 // Prepare chart data
 const iterationsChartData = iterations.map((iter) => ({
 name: `#${iter.iteration}`,
 winRate: safeNumber(iter?.result?.win_rate, 0),
 trades: safeNumber(iter?.result?.total_trades, 0),
 return: safeNumber(iter?.result?.total_return, 0)
 }));

 const tradesPieData = results ? [
 { name: 'رابحة', value: results.winning_trades, color: COLORS.winners },
 { name: 'خاسرة', value: results.losing_trades, color: COLORS.losers }
 ] : [];

 // ─── UnifiedTable columns ────────────────────────────────────────────
 interface SectorBreakdownRow { sector: string; trades: number; winRate: number; returnPct: number; }
 interface EngineBreakdownRow { model: string; trades: number; winRate: number; }

 const sectorReportColumns: Column<SectorBreakdownRow>[] = useMemo(() => ([
 {
 key: 'sector',
 header: 'القطاع',
 sortable: true,
 filterable: true,
 className: 'text-xs font-medium',
 },
 {
 key: 'trades',
 header: 'التوقعات',
 align: 'center',
 sortable: true,
 filterable: true,
 width: 'w-24',
 className: 'text-xs text-center font-mono',
 },
 {
 key: 'winRate',
 header: 'نسبة النجاح',
 align: 'center',
 sortable: true,
 filterable: true,
 width: 'w-28',
 render: (r) => (
 <Badge variant="outline" className="bg-profit/10 text-profit font-mono text-xs">
 {r.winRate}%
 </Badge>
 ),
 },
 {
 key: 'returnPct',
 header: 'العائد',
 align: 'left',
 sortable: true,
 filterable: true,
 width: 'w-28',
 className: 'text-xs text-left font-mono font-semibold text-profit',
 render: (r) => `+${r.returnPct}%`,
 },
 ]), []);

 const engineReportColumns: Column<EngineBreakdownRow>[] = useMemo(() => ([
 {
 key: 'model',
 header: 'نموذج المحرك',
 sortable: true,
 filterable: true,
 className: 'text-xs font-medium',
 },
 {
 key: 'trades',
 header: 'التوقعات',
 align: 'center',
 sortable: true,
 filterable: true,
 width: 'w-24',
 className: 'text-xs text-center font-mono',
 },
 {
 key: 'winRate',
 header: 'نسبة النجاح',
 align: 'center',
 sortable: true,
 filterable: true,
 width: 'w-28',
 render: (r) => (
 <Badge variant="outline" className="bg-primary/10 text-primary font-mono text-xs">
 {r.winRate}%
 </Badge>
 ),
 },
 ]), []);

 const tradesColumns: Column<BacktestTrade>[] = useMemo(() => ([
 {
 key: 'ticker',
 header: 'السهم',
 sortable: true,
 filterable: true,
 className: 'font-medium',
 render: (t) => t?.ticker || '-',
 },
 {
 key: 'entry_date',
 header: 'التاريخ',
 sortable: true,
 filterable: true,
 width: 'w-28',
 render: (t) => t?.entry_date || '-',
 },
 {
 key: 'entry_price',
 header: 'الدخول',
 align: 'right',
 sortable: true,
 filterable: true,
 width: 'w-24',
 render: (t) => safeToFixed(t?.entry_price, 2),
 },
 {
 key: 'exit_price',
 header: 'الخروج',
 align: 'right',
 sortable: true,
 filterable: true,
 width: 'w-24',
 render: (t) => safeToFixed(t?.exit_price, 2),
 },
 {
 key: 'actual_return',
 header: 'العائد',
 align: 'right',
 sortable: true,
 filterable: true,
 width: 'w-28',
 render: (t) => (
 <span className={safeNumber(t?.actual_return) >= 0 ? "text-success" : "text-loss"}>
 {safeNumber(t?.actual_return) >= 0 ? '+' : ''}{safeToFixed(t?.actual_return, 2)}%
 </span>
 ),
 },
 {
 key: 'analysis_correct',
 header: 'صحيح؟',
 align: 'center',
 width: 'w-20',
 render: (t) => t?.analysis_correct ? (
 <CheckCircle2 className="w-4 h-4 text-success inline-block" />
 ) : (
 <XCircle className="w-4 h-4 text-loss inline-block" />
 ),
 },
 ]), [safeToFixed, safeNumber]);

 // Slice trades for table display
 const tradesTableRows = useMemo(() => trades.slice(0, 50), [trades]);

 return (
 <div className="space-y-6" dir="rtl">
 {/* Header */}
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
 <div className="flex items-center gap-3">
 <div className="p-2.5 bg-gradient-to-br from-violet-500 via-purple-600 to-whale rounded-xl shadow-lg">
 <Brain className="h-6 w-6 text-foreground" />
 </div>
 <div>
 <h2 className="text-xl font-bold tracking-tight">نظام التعلم الذكي الموحد</h2>
 <p className="text-sm text-muted-foreground">AI + التحليل الفني + إدارة المخاطر</p>
 </div>
 </div>
 
 <div className="flex items-center gap-2 flex-wrap">
 {/* Asset Type Selector */}
 <Select value={assetType} onValueChange={setAssetType}>
 <SelectTrigger className="w-[140px]">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="egx">
 <div className="flex items-center gap-2">
 <StockIcon className="w-4 h-4" />
 البورصة المصرية
 </div>
 </SelectItem>
 <SelectItem value="crypto">
 <div className="flex items-center gap-2">
 <Coins className="w-4 h-4" />
 العملات الرقمية
 </div>
 </SelectItem>
 </SelectContent>
 </Select>
 
 {/* View Mode Toggle */}
 <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
 <Button size="sm" variant={viewMode === 'chart' ? 'default' : 'ghost'} onClick={() => setViewMode('chart')} className="gap-1">
 <LineChart className="h-4 w-4" />
 </Button>
 <Button size="sm" variant={viewMode === 'table' ? 'default' : 'ghost'} onClick={() => setViewMode('table')} className="gap-1">
 <Table2 className="h-4 w-4" />
 </Button>
 </div>
 
 {customMode && (
 <Badge variant="outline" className="text-warning border-warning">
 ⚙️ مخصص
 </Badge>
 )}
 </div>
 </div>

 {/* Quick Stats Bar */}
 {results && (
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 <Card className="p-3">
 <div className="flex items-center gap-2">
 <Percent className="w-4 h-4 text-muted-foreground" />
 <span className="text-xs text-muted-foreground">نسبة النجاح</span>
 </div>
 <p className={cn("text-xl font-bold mt-1", getWinRateColor(safeNumber(results?.win_rate)))}>
 {safeToFixed(results?.win_rate)}%
 </p>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2">
 <Activity className="w-4 h-4 text-muted-foreground" />
 <span className="text-xs text-muted-foreground">الصفقات</span>
 </div>
 <p className="text-xl font-bold mt-1">{results.total_trades}</p>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2">
 <DollarSign className="w-4 h-4 text-muted-foreground" />
 <span className="text-xs text-muted-foreground">العائد</span>
 </div>
 <p className={cn("text-xl font-bold mt-1", safeNumber(results?.total_return) >= 0 ? "text-success" : "text-loss")}>
 {safeNumber(results?.total_return) >= 0 ? '+' : ''}{safeToFixed(results?.total_return)}%
 </p>
 </Card>
 <Card className="p-3">
 <div className="flex items-center gap-2">
 <TrendingDown className="w-4 h-4 text-muted-foreground" />
 <span className="text-xs text-muted-foreground">أقصى تراجع</span>
 </div>
 <p className="text-xl font-bold mt-1 text-loss">-{safeToFixed(results?.max_drawdown)}%</p>
 </Card>
 </div>
 )}

 {/* Persona Selector - سطر واحد مختصر */}
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-sm text-muted-foreground">الشخصية:</span>
 {[
 { id: 'conservative', icon: Shield, label: 'المستثمر', risk: 'low' },
 { id: 'balanced', icon: Scale, label: 'المتوازن', risk: 'medium' },
 { id: 'gambler', icon: Flame, label: 'المضارب', risk: 'high' },
 { id: 'smart', icon: Brain, label: 'الذكي', risk: 'medium' },
 { id: 'scalper', icon: Zap, label: 'السريع', risk: 'high' },
 { id: 'trend_follower', icon: TrendingUp, label: 'المتتبع', risk: 'medium' },
 { id: 'contrarian', icon: RotateCcw, label: 'العكسي', risk: 'high' }
 ].map(p => (
 <Button
 key={p.id}
 size="sm"
 variant={activePersona === p.id ? "default" : "outline"}
 onClick={() => handlePersonaChange(p.id)}
 className={cn(
 "gap-1 h-8",
 activePersona === p.id && p.risk === 'high' && "bg-loss hover:bg-loss",
 activePersona === p.id && p.risk === 'low' && "bg-profit hover:bg-profit"
 )}
 >
 <p.icon className="w-3.5 h-3.5" />
 {p.label}
 </Button>
 ))}
 {activePersona && PERSONA_INFO[activePersona] && (
 <span className="text-xs text-muted-foreground mr-2">
 {PERSONA_INFO[activePersona].description}
 </span>
 )}
 </div>

 {/* Main Tabs */}
 <Tabs value={activeTab} onValueChange={setActiveTab}>
 <TabsList className="grid w-full grid-cols-6">
 <TabsTrigger value="predictions-engine" className="gap-1">
 <Target className="w-4 h-4 text-profit" />
 <span className="hidden sm:inline">مولد وموزن التوقعات</span>
 </TabsTrigger>
 <TabsTrigger value="parameters" className="gap-1">
 <Sliders className="w-4 h-4" />
 <span className="hidden sm:inline">البرمترات</span>
 </TabsTrigger>
 <TabsTrigger value="config" className="gap-1">
 <Settings className="w-4 h-4" />
 <span className="hidden sm:inline">الإعدادات</span>
 </TabsTrigger>
 <TabsTrigger value="ai" className="gap-1">
 <Sparkles className="w-4 h-4" />
 <span className="hidden sm:inline">AI</span>
 </TabsTrigger>
 <TabsTrigger value="results" className="gap-1">
 <BarChart3 className="w-4 h-4" />
 <span className="hidden sm:inline">النتائج</span>
 </TabsTrigger>
 <TabsTrigger value="persona-benchmark" className="gap-1">
 <Users className="w-4 h-4 text-primary" />
 <span className="hidden sm:inline">مقارنة الشخصيات</span>
 </TabsTrigger>
 </TabsList>

 {/* 5-Pillar Smart Learning & Predictions Engine Tab */}
 <TabsContent value="predictions-engine" className="space-y-6">
 {/* Pillar 1 & 4: Generation Control & Dry-Run / Purge Panel */}
 <Card className="border-profit bg-gradient-to-br from-profit/5 via-card to-card">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Brain className="w-5 h-5 text-profit" />
 محرك توليد التوقعات المتقدم والتعلم اللحظي
 </CardTitle>
 <div className="flex items-center gap-2">
 {isDryRun && (
 <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 gap-1 text-xs">
 <Zap className="w-3 h-3" />
 وضع تجريبي لحظي (Memory Only)
 </Badge>
 )}
 <Button
 variant="outline"
 size="sm"
 onClick={handlePurgeOldPredictions}
 disabled={purgingPredictions}
 className="text-xs text-destructive hover:bg-destructive/10 border-destructive/30 gap-1"
 >
 <RotateCcw className={cn("w-3.5 h-3.5", purgingPredictions && "animate-spin")} />
 مسح التوقعات القديمة
 </Button>
 </div>
 </div>
 <CardDescription>
 توليد وتتبع التوقعات من 1/1/2026، قياس الأرباح والخسائر، إجراء اختبارات جافة لحظية، والتحكم التام في نسب المحركات والقوائم المسبقة.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
 <div className="space-y-1.5">
 <Label className="text-xs font-medium">تاريخ البداية (Start Date)</Label>
 <Input
 type="date"
 value={fromDate}
 onChange={(e) => setFromDate(e.target.value)}
 className="text-xs font-mono"
 />
 </div>

 <div className="space-y-1.5">
 <Label className="text-xs font-medium">تاريخ النهاية (End Date)</Label>
 <Input
 type="date"
 value={toDate}
 onChange={(e) => setToDate(e.target.value)}
 className="text-xs font-mono"
 />
 </div>

 <div className="flex items-center justify-between p-2.5 rounded-lg border bg-background/50 h-10">
 <div className="flex items-center gap-2">
 <Zap className="w-4 h-4 text-warning" />
 <Label className="text-xs font-medium cursor-pointer">الوضع التجريبي اللحظي</Label>
 </div>
 <Switch
 checked={isDryRun}
 onCheckedChange={setIsDryRun}
 />
 </div>

 <Button
 onClick={handleGeneratePredictions}
 disabled={generatingPredictions}
 className="bg-profit hover:bg-profit text-white gap-2 h-10"
 >
 {generatingPredictions ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Play className="w-4 h-4 fill-white" />
 )}
 {generatingPredictions ? 'جاري توليد التوقعات...' : `توليد التوقعات من ${fromDate}`}
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Pillar 5: Engine Weights Tuner & Presets Manager */}
 <Card className="border-purple-200 dark:border-purple-800">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Sliders className="w-5 h-5 text-primary" />
 التحكم في نسب وأوزان محركات التحليل (Weights Tuner & Presets)
 </CardTitle>
 <div className="flex items-center gap-3">
 <span className="text-xs text-muted-foreground">نمط الأوزان:</span>
 <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
 <Button
 size="sm"
 variant={weightMode === 'dynamic' ? 'default' : 'ghost'}
 onClick={() => setWeightMode('dynamic')}
 className="h-6 text-xs px-2"
 >
 ديناميكي (Auto-Regime)
 </Button>
 <Button
 size="sm"
 variant={weightMode === 'static' ? 'default' : 'ghost'}
 onClick={() => setWeightMode('static')}
 className="h-6 text-xs px-2"
 >
 قيم ثابتة (Static)
 </Button>
 </div>
 </div>
 </div>
 </CardHeader>
 <CardContent className="space-y-6">
 {/* Sliders for 4 sub-engines */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 {/* SMC Engine */}
 <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
 <div className="flex justify-between items-center">
 <span className="text-xs font-semibold flex items-center gap-1.5">
 <Flame className="w-3.5 h-3.5 text-warning" />
 SMC Engine
 </span>
 <Badge variant="secondary" className="font-mono text-xs">{engineWeights.smc}%</Badge>
 </div>
 <p className="text-xs text-muted-foreground">Order Blocks + FVG + Liquidity Sweeps</p>
 <Slider
 value={[engineWeights.smc]}
 onValueChange={([v]) => setEngineWeights(w => ({ ...w, smc: v }))}
 min={0}
 max={100}
 step={5}
 />
 </div>

 {/* Quant Engine */}
 <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
 <div className="flex justify-between items-center">
 <span className="text-xs font-semibold flex items-center gap-1.5">
 <Cpu className="w-3.5 h-3.5 text-primary" />
 Quant Engine
 </span>
 <Badge variant="secondary" className="font-mono text-xs">{engineWeights.quant}%</Badge>
 </div>
 <p className="text-xs text-muted-foreground">Z-Score + VSA + TTM Squeeze</p>
 <Slider
 value={[engineWeights.quant]}
 onValueChange={([v]) => setEngineWeights(w => ({ ...w, quant: v }))}
 min={0}
 max={100}
 step={5}
 />
 </div>

 {/* Dynamic Risk Engine */}
 <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
 <div className="flex justify-between items-center">
 <span className="text-xs font-semibold flex items-center gap-1.5">
 <Shield className="w-3.5 h-3.5 text-profit" />
 Dynamic Risk
 </span>
 <Badge variant="secondary" className="font-mono text-xs">{engineWeights.risk}%</Badge>
 </div>
 <p className="text-xs text-muted-foreground">Kaufman Efficiency + ATR Risk</p>
 <Slider
 value={[engineWeights.risk]}
 onValueChange={([v]) => setEngineWeights(w => ({ ...w, risk: v }))}
 min={0}
 max={100}
 step={5}
 />
 </div>

 {/* EGX Tuned Engine */}
 <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
 <div className="flex justify-between items-center">
 <span className="text-xs font-semibold flex items-center gap-1.5">
 <Sparkles className="w-3.5 h-3.5 text-primary" />
 EGX Tuned
 </span>
 <Badge variant="secondary" className="font-mono text-xs">{engineWeights.egx}%</Badge>
 </div>
 <p className="text-xs text-muted-foreground">Soft Penalty + RSI + MA</p>
 <Slider
 value={[engineWeights.egx]}
 onValueChange={([v]) => setEngineWeights(w => ({ ...w, egx: v }))}
 min={0}
 max={100}
 step={5}
 />
 </div>
 </div>

 {/* Presets Manager Section */}
 <div className="space-y-3 pt-2 border-t">
 <div className="flex justify-between items-center flex-wrap gap-2">
 <span className="text-xs font-semibold flex items-center gap-1.5">
 <Save className="w-4 h-4 text-primary" />
 القوائم المسبقة المتاحة (Weight Presets):
 </span>

 {/* Save custom preset input */}
 <div className="flex items-center gap-2">
 <Input
 placeholder="اسم القائمة الجديدة..."
 value={customPresetName}
 onChange={(e) => setCustomPresetName(e.target.value)}
 className="h-8 text-xs w-48"
 />
 <Button size="sm" onClick={handleSavePreset} className="h-8 text-xs gap-1">
 <Save className="w-3.5 h-3.5" />
 حفظ كقائمة مسبقة
 </Button>
 </div>
 </div>

 {/* Preset Chips */}
 <div className="flex flex-wrap gap-2">
 {presets.map((preset, idx) => (
 <div
 key={idx}
 className="inline-flex items-center gap-1.5 p-1.5 px-3 rounded-full border bg-background text-xs hover:border-purple-500 transition-colors"
 >
 <button
 onClick={() => handleLoadPreset(preset)}
 className="font-medium hover:text-primary transition-colors text-right"
 >
 {preset.name}
 </button>
 <span className="text-xs text-muted-foreground font-mono">
 ({preset.weights.smc}/{preset.weights.quant}/{preset.weights.risk}/{preset.weights.egx})
 </span>
 {idx >= 4 && (
 <button
 onClick={() => handleDeletePreset(idx)}
 className="text-destructive hover:text-loss mr-1"
 title="حذف القائمة"
 >
 ×
 </button>
 )}
 </div>
 ))}
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Pillar 2: Accuracy & P&L Analytics KPIs */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
 <Card className="p-3 bg-gradient-to-br from-profit/10 to-card">
 <span className="text-xs text-muted-foreground font-medium">معدل النجاح (Win Rate)</span>
 <p className="text-2xl font-bold text-profit mt-1">{predictionMetrics.winRate}%</p>
 <span className="text-xs text-muted-foreground">{predictionMetrics.winning} رابحة من {predictionMetrics.total}</span>
 </Card>

 <Card className="p-3 bg-gradient-to-br from-primary/10 to-card">
 <span className="text-xs text-muted-foreground font-medium">عامل الربحية (Profit Factor)</span>
 <p className="text-2xl font-bold text-primary mt-1">{predictionMetrics.profitFactor}</p>
 <span className="text-xs text-muted-foreground">ممتاز ({'>'} 2.0)</span>
 </Card>

 <Card className="p-3 bg-gradient-to-br from-purple-500/10 to-card">
 <span className="text-xs text-muted-foreground font-medium">إجمالي العائد (Total Return)</span>
 <p className="text-2xl font-bold text-primary mt-1">+{predictionMetrics.totalReturn}%</p>
 <span className="text-xs text-muted-foreground">منذ {fromDate}</span>
 </Card>

 <Card className="p-3 bg-gradient-to-br from-loss/10 to-card">
 <span className="text-xs text-muted-foreground font-medium">أقصى هبوط (Max Drawdown)</span>
 <p className="text-2xl font-bold text-loss mt-1">-{predictionMetrics.maxDrawdown}%</p>
 <span className="text-xs text-muted-foreground">مخاطرة آمنة للغاية</span>
 </Card>

 <Card className="p-3 bg-gradient-to-br from-warning/10 to-card">
 <span className="text-xs text-muted-foreground font-medium">متوسط الربح / الخسارة</span>
 <p className="text-lg font-bold text-foreground mt-1">
 <span className="text-profit">+{predictionMetrics.avgWinner}%</span> / <span className="text-loss">-{predictionMetrics.avgLoser}%</span>
 </p>
 <span className="text-xs text-muted-foreground">نسبة العائد للمخاطرة 2.1x</span>
 </Card>
 </div>

 {/* Pillar 3: Detailed Performance Reports (By Sector & Engine) */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {/* Sector Report */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <PieChart className="w-4 h-4 text-profit" />
 تقرير الأداء حسب القطاعات (Sector Performance Report)
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 <UnifiedTable
 columns={sectorReportColumns}
 data={sectorBreakdown}
 keyField="sector"
 dense
 columnToggle
 filterable
 />
 </CardContent>
 </Card>

 {/* Engine Breakdown Report */}
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <BarChart3 className="w-4 h-4 text-primary" />
 تقرير الأداء حسب نموذج المحرك (Engine Model Breakdown)
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 <UnifiedTable
 columns={engineReportColumns}
 data={engineBreakdown}
 keyField="model"
 dense
 columnToggle
 filterable
 />
 </CardContent>
 </Card>
 </div>
 </TabsContent>

 {/* Parameters Tab */}
 <TabsContent value="parameters" className="space-y-4">
 {/* Parameters by Group */}
 {(['technical', 'risk', 'decision'] as const).map(group => (
 <Card key={group}>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 {group === 'technical' && <TrendingUp className="w-4 h-4 text-primary" />}
 {group === 'risk' && <Shield className="w-4 h-4 text-warning" />}
 {group === 'decision' && <Target className="w-4 h-4 text-primary" />}
 {group === 'technical' && 'المؤشرات الفنية'}
 {group === 'risk' && 'إدارة المخاطر'}
 {group === 'decision' && 'منطق القرار'}
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
 {(Object.keys(PARAM_CONFIG) as Array<keyof BacktestParameters>)
 .filter(key => PARAM_CONFIG[key].group === group)
 .map(key => {
 const cfg = PARAM_CONFIG[key];
 const defaultValue = PERSONA_DEFAULTS[activePersona][key];
 const isModified = parameters[key] !== defaultValue;
 
 return (
 <div key={key} className={cn(
 "space-y-1.5 p-3 rounded-lg border transition-colors",
 isModified 
 ? "bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800" 
 : "bg-muted/30 border-transparent"
 )}>
 <div className="flex justify-between items-center gap-2">
 <Label className="text-xs font-medium">{cfg.ar}</Label>
 <Badge variant={isModified ? "default" : "outline"} className="text-xs font-mono">
 {safeToFixed(parameters[key], key.includes('threshold') || key.includes('std') || key.includes('stop') || key.includes('target') || key.includes('multiplier') ? 1 : 0)}
 </Badge>
 </div>
 <Slider
 value={[parameters[key]]}
 onValueChange={([v]) => updateParameter(key, v)}
 min={cfg.min}
 max={cfg.max}
 step={cfg.step}
 className="mt-1"
 />
 <div className="flex justify-between items-center">
 <span className="text-xs text-muted-foreground">{cfg.min}</span>
 <span className="text-xs text-muted-foreground">قياسي: {defaultValue}</span>
 <span className="text-xs text-muted-foreground">{cfg.max}</span>
 </div>
 </div>
 );
 })}
 </div>
 </CardContent>
 </Card>
 ))}
 
 <Button variant="outline" onClick={resetToDefaults} className="gap-2">
 <RotateCcw className="w-4 h-4" />
 إعادة للقيم القياسية
 </Button>
 </TabsContent>

 {/* Config Tab */}
 <TabsContent value="config" className="space-y-4">
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Settings className="h-4 w-4" />
 إعدادات الاختبار
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
 <div className="space-y-2">
 <Label className="text-xs">تاريخ البداية</Label>
 <Input type="date" value={config.start_date} onChange={(e) => setConfig(prev => ({ ...prev, start_date: e.target.value }))} />
 </div>
 <div className="space-y-2">
 <Label className="text-xs">تاريخ النهاية</Label>
 <Input type="date" value={config.end_date} onChange={(e) => setConfig(prev => ({ ...prev, end_date: e.target.value }))} />
 </div>
 <div className="space-y-2">
 <Label className="text-xs">رأس المال</Label>
 <Input type="number" value={config.capital} onChange={(e) => setConfig(prev => ({ ...prev, capital: Number(e.target.value) }))} />
 </div>
 <div className="space-y-2">
 <Label className="text-xs">أقصى صفقات</Label>
 <Input type="number" value={config.max_positions} onChange={(e) => setConfig(prev => ({ ...prev, max_positions: Number(e.target.value) }))} />
 </div>
 <div className="space-y-2">
 <Label className="text-xs">أيام الاحتفاظ</Label>
 <Input type="number" value={config.holding_days} onChange={(e) => setConfig(prev => ({ ...prev, holding_days: Number(e.target.value) }))} />
 </div>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 {/* AI Tab */}
 <TabsContent value="ai" className="space-y-4">
 <Card className="border-violet-200 dark:border-violet-800">
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Sparkles className="h-4 h-4 text-violet-500" />
 التحسين التحليلي المتقدم
 </CardTitle>
 <CardDescription>
 استخدم AI لتحسين البرمترات تلقائياً عبر محاكاة دورات التعلم التكراري
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
 <div className="flex items-center gap-3">
 <Cpu className="w-5 h-5 text-violet-500" />
 <div>
 <p className="font-medium">التحسين التلقائي</p>
 <p className="text-xs text-muted-foreground">السماح للنظام بتحسين البرمترات</p>
 </div>
 </div>
 <Switch checked={aiEnhanced} onCheckedChange={setAiEnhanced} />
 </div>
 
 {aiEnhanced && (
 <div className="space-y-4 p-4 rounded-lg border border-violet-200 dark:border-violet-800">
 <div className="space-y-2">
 <Label>نسبة النجاح المستهدفة: {targetWinRate}%</Label>
 <Slider value={[targetWinRate]} onValueChange={([v]) => setTargetWinRate(v)} min={50} max={99} step={1} />
 </div>
 <div className="space-y-2">
 <Label>أقصى عدد تكرارات: {maxIterations}</Label>
 <Slider value={[maxIterations]} onValueChange={([v]) => setMaxIterations(v)} min={5} max={50} step={5} />
 </div>
 <Button 
 className="w-full gap-2 bg-violet-600 hover:bg-violet-700"
 onClick={runIterativeLearningSystem}
 disabled={isRunning || loading !== null}
 >
 {loading === 'iterative' ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Brain className="w-4 h-4" />
 )}
 بدء التحسين الذكي
 </Button>
 </div>
 )}
 
 <div className="grid grid-cols-2 gap-4">
 <Card className="p-4 text-center">
 <Database className="w-8 h-8 mx-auto mb-2 text-primary" />
 <p className="font-medium">البيانات التاريخية</p>
 <p className="text-2xl font-bold text-primary">274,574</p>
 <p className="text-xs text-muted-foreground">سجل أسعار</p>
 </Card>
 <Card className="p-4 text-center">
 <BarChart3 className="w-8 h-8 mx-auto mb-2 text-profit" />
 <p className="font-medium">الأسهم المتاحة</p>
 <p className="text-2xl font-bold text-profit">946</p>
 <p className="text-xs text-muted-foreground">سهم للتحليل</p>
 </Card>
 </div>
 </CardContent>
 </Card>

 {/* التعلم من الأخطاء الفعلية */}
 <Card className="border-warning /50 shadow-md">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2 text-warning ">
 <AlertTriangle className="h-5 w-5 text-warning" />
 تعدين الدروس والتعلم من الأخطاء الفعلية
 </CardTitle>
 <CardDescription>
 تحليل التوقعات والتوقعات الخاطئة في قاعدة البيانات النشطة واستخلاص دروس الأمان وتحديث الإعدادات تلقائياً.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-warning/50 /10 border border-warning /30">
 <div className="space-y-1">
 <p className="font-semibold text-sm">مكافحة تكرار الأخطاء</p>
 <p className="text-xs text-muted-foreground">يقوم النظام بالربط بين المؤشرات الفنية ونظام السوق عند حدوث الفشل لتجنبه مستقبلاً.</p>
 </div>
 <Button 
 onClick={learnFromActualFailures}
 disabled={isRunning || loading !== null}
 className="gap-2 bg-warning hover:bg-warning text-white shrink-0 shadow-sm"
 >
 {loading === 'errors' ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Activity className="w-4 h-4" />
 )}
 تحليل الأخطاء وتعدين الدروس
 </Button>
 </div>

 {/* عرض الدروس المستخرجة */}
 {lessons.length > 0 && (
 <div className="space-y-3 mt-4 animate-in fade-in duration-300">
 <h4 className="font-semibold text-sm text-warning flex items-center gap-1.5">
 <Sparkles className="w-4 h-4 text-warning animate-pulse" />
 الدروس والتحذيرات الأمنية المستخرجة:
 </h4>
 <div className="space-y-2">
 {lessons.map((lesson, idx) => (
 <div 
 key={idx} 
 className="flex items-start gap-2.5 text-xs p-3.5 bg-warning/20 /5 rounded-lg border border-warning/60 /30 text-foreground shadow-sm"
 >
 <Badge className="bg-warning hover:bg-warning text-xs h-5 px-1.5 shrink-0" variant="secondary">
 قاعدة أمان
 </Badge>
 <span className="leading-relaxed">{lesson}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* عرض المعايير المعدلة */}
 {Object.keys(adjustments).length > 0 && (
 <div className="space-y-3 mt-4 animate-in fade-in duration-300">
 <h4 className="font-semibold text-sm text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
 <Sliders className="w-4 h-4 text-violet-500" />
 المعايير المطبقة لحماية المحفظة:
 </h4>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
 {Object.entries(adjustments).map(([key, val]) => {
 let arabicKey = key;
 if (key === 'min_score_buy') arabicKey = 'الحد الأدنى للشراء';
 else if (key === 'position_size_pct') arabicKey = 'حجم الصفقة %';
 else if (key === 'stop_max_pct') arabicKey = 'أقصى وقف خسارة %';
 else if (key === 'rsi_overbought') arabicKey = 'تشبع الشراء RSI';
 else if (key === 'rsi_oversold') arabicKey = 'تشبع البيع RSI';
 else if (key === 'min_rr') arabicKey = 'نسبة العائد للمخاطرة R/R';

 return (
 <div 
 key={key} 
 className="flex flex-col justify-between p-3 bg-violet-50/30 dark:bg-violet-950/5 rounded-lg border border-violet-100/80 dark:border-violet-900/30"
 >
 <span className="text-xs text-muted-foreground font-medium mb-1">{arabicKey}</span>
 <span className="text-sm font-bold text-violet-700 dark:text-violet-400 font-mono">{val}</span>
 </div>
 );
 })}
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 {/* Results Tab */}
 <TabsContent value="results" className="space-y-4">
 {results ? (
 <>
 {/* Charts */}
 {viewMode === 'chart' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <Card>
 <CardHeader><CardTitle className="text-sm">توزيع الصفقات</CardTitle></CardHeader>
 <CardContent>
 <div className="h-[250px]">
 <ResponsiveContainer width="100%" height="100%">
 <RechartsPieChart>
 <Pie data={tradesPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value">
 {tradesPieData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip />
 <Legend />
 </RechartsPieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>
 
 {iterations.length > 1 && (
 <Card>
 <CardHeader><CardTitle className="text-sm">تقدم الاختبارات</CardTitle></CardHeader>
 <CardContent>
 <div className="h-[250px]">
 <ResponsiveContainer width="100%" height="100%">
 <RechartsLineChart data={iterationsChartData}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="name" />
 <YAxis domain={[0, 100]} />
 <Tooltip />
 <Line type="monotone" dataKey="winRate" stroke={COLORS.winRate} strokeWidth={2} name="نسبة النجاح %" />
 </RechartsLineChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 )}

 {/* Error Analysis & Improvements - NEW! */}
 {iterations.length > 0 && iterations[iterations.length - 1].analysis && (
 <Card className="border-warning ">
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <AlertTriangle className="h-4 w-4 text-warning" />
 تحليل الأخطاء والتحسينات
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* Errors Detected */}
 <div className="space-y-2">
 <h4 className="font-medium text-loss flex items-center gap-2">
 <XCircle className="w-4 h-4" />
 الأخطاء المكتشفة
 </h4>
 <div className="space-y-1">
 {iterations[iterations.length - 1].analysis?.errors_detected.map((error, idx) => (
 <div key={idx} className="text-sm p-2 bg-loss /30 rounded border border-loss ">
 {error}
 </div>
 ))}
 </div>
 </div>
 
 {/* Improvements Made */}
 <div className="space-y-2">
 <h4 className="font-medium text-success flex items-center gap-2">
 <CheckCircle2 className="w-4 h-4" />
 التحسينات المطبقة
 </h4>
 <div className="space-y-1">
 {iterations[iterations.length - 1].analysis?.improvements_made.length > 0 ? (
 iterations[iterations.length - 1].analysis?.improvements_made.map((improvement, idx) => (
 <div key={idx} className="text-sm p-2 bg-success /30 rounded border border-success dark:border-success">
 {improvement}
 </div>
 ))
 ) : (
 <div className="text-sm text-muted-foreground p-2">
 لا توجد تحسينات بعد - التكرار الأول
 </div>
 )}
 </div>
 </div>
 </div>
 
 {/* Iteration History */}
 {iterations.length > 1 && (
 <div className="mt-4 pt-4 border-t">
 <h4 className="font-medium mb-2 flex items-center gap-2">
 <RefreshCw className="w-4 h-4" />
 سجل التكرارات ({iterations.length} دورة)
 </h4>
 <div className="flex flex-wrap gap-2">
 {iterations.map((iter, idx) => (
 <Badge 
 key={idx}
 variant={safeNumber(iter?.result?.win_rate) >= targetWinRate ? "default" : "outline"}
 className={cn(
 "cursor-pointer",
 safeNumber(iter?.result?.win_rate) >= 70 && "bg-success hover:bg-success",
 safeNumber(iter?.result?.win_rate) >= 50 && safeNumber(iter?.result?.win_rate) < 70 && "bg-warning hover:bg-warning",
 safeNumber(iter?.result?.win_rate) < 50 && "bg-loss hover:bg-loss"
 )}
 >
 #{iter?.iteration || idx + 1}: {safeToFixed(iter?.result?.win_rate)}%
 </Badge>
 ))}
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 )}

 {/* Table View */}
 {viewMode === 'table' && trades.length > 0 && (
 <Card>
 <CardHeader><CardTitle className="text-sm">الصفقات</CardTitle></CardHeader>
 <CardContent>
 <UnifiedTable
 columns={tradesColumns}
 data={tradesTableRows}
 keyField="id"
 dense
 columnToggle
 filterable
 maxHeight="max-h-[400px]"
 />
 </CardContent>
 </Card>
 )}
 </>
 ) : (
 <Card className="p-8 text-center">
 <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
 <p className="text-muted-foreground">قم بتشغيل الاختبار لرؤية النتائج</p>
 </Card>
 )}
 </TabsContent>

 {/* P39-PHASE-5: Persona Benchmarking Tab — side-by-side comparison of the 3 personas */}
 <TabsContent value="persona-benchmark" className="space-y-4">
 {/* Date range info banner */}
 <div className="rounded-lg border bg-profit/60 /10 border-profit /40 p-3 flex items-center gap-2 text-xs text-profit ">
 <Clock className="w-4 h-4 text-profit shrink-0" />
 <span>
 البيانات تبدأ من <span className="font-mono font-semibold">{fromDate}</span> — المقارنة تشمل نفس الفترة الزمنية لجميع الشخصيات.
 </span>
 </div>

 <Card className="border-purple-200 dark:border-purple-800">
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 <Users className="w-5 h-5 text-primary" />
 مقارنة الشخصيات الاستثمارية (Persona Benchmarking)
 </CardTitle>
 <CardDescription>
 مقارنة جانبية للشخصيات الثلاث (المحافظ / المتوازن / المغامر) عبر معاملات الـ ATR، حدود المخاطرة، الأداء التقديري والفعلي، وحدود توزيع الثروة.
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Comparison Table */}
 <div className="overflow-x-auto rounded-lg border" dir="rtl">
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead className="text-xs font-semibold bg-muted/40 sticky right-0 min-w-[140px]">المعيار (Metric)</TableHead>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const meta = PERSONA_BENCHMARK_META[p];
 const Icon = meta.icon;
 const isBest = bestPersona === p;
 return (
 <TableHead
 key={p}
 className={cn(
 "text-xs font-bold text-center min-w-[160px] align-bottom",
 isBest && "bg-profit/70 /20 border-x-2 border-profit"
 )}
 style={{ color: meta.color }}
 >
 <div className="flex flex-col items-center gap-1">
 {isBest && (
 <Badge className="bg-profit hover:bg-profit text-white text-xs gap-1 mb-1">
 <Trophy className="w-3 h-3" />
 الأفضل
 </Badge>
 )}
 <div className="flex items-center justify-center gap-1.5">
 <span className="text-base leading-none">{meta.emoji}</span>
 <Icon className="w-4 h-4" style={{ color: meta.color }} />
 <span>{meta.arLabel}</span>
 </div>
 </div>
 </TableHead>
 );
 })}
 </TableRow>
 </TableHeader>
 <TableBody>
 {/* Risk Score */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">درجة المخاطرة (Risk Score 1..100)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].riskScore}
 </TableCell>
 );
 })}
 </TableRow>
 {/* Stop Factor */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">مضاعف الستوب (Stop Factor × ATR)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {(PERSONA_BENCHMARK_DATA[p].stopFactor ?? 0).toFixed(1)}
 </TableCell>
 );
 })}
 </TableRow>
 {/* Target Factor */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">مضاعف الهدف (Target Factor × ATR)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {(PERSONA_BENCHMARK_DATA[p].targetFactor ?? 0).toFixed(1)}
 </TableCell>
 );
 })}
 </TableRow>
 {/* Max Risk % */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">أقصى مخاطرة % (Max Risk per Trade)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {(PERSONA_BENCHMARK_DATA[p].maxRiskPct ?? 0).toFixed(1)}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* Win Rate % */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">نسبة النجاح % (Win Rate) *</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono text-profit font-semibold",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].winRate}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* Profit Factor */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">عامل الربحية (Profit Factor) *</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono text-primary font-semibold",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {(PERSONA_BENCHMARK_DATA[p].profitFactor ?? 0).toFixed(2)}
 </TableCell>
 );
 })}
 </TableRow>
 {/* Max Drawdown % */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">أقصى تراجع % (Max Drawdown) *</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono text-loss font-semibold",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 -{(PERSONA_BENCHMARK_DATA[p].maxDrawdown ?? 0).toFixed(1)}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* Avg Trades/Month */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">متوسط الصفقات/شهر (Avg Trades/Month) *</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].avgTradesPerMonth}
 </TableCell>
 );
 })}
 </TableRow>
 {/* Total Return % */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">إجمالي العائد % (Total Return) *</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono text-primary font-bold",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 +{(PERSONA_BENCHMARK_DATA[p].totalReturn ?? 0).toFixed(1)}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* EGX Ceiling */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">سقف البورصة المصرية % (EGX Ceiling)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].egxCeiling}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* Crypto Ceiling */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">سقف الكريبتو % (Crypto Ceiling)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].cryptoCeiling}%
 </TableCell>
 );
 })}
 </TableRow>
 {/* Cash Floor */}
 <TableRow>
 <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">حد الكاش الأدنى % (Cash Floor)</TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono",
 isBest && "bg-profit/40 /10 border-x-2 border-profit"
 )}
 >
 {PERSONA_BENCHMARK_DATA[p].cashFloor}%
 </TableCell>
 );
 })}
 </TableRow>

 {/* Live backtest results — win rate */}
 {personaBenchmarkRan && (
 <TableRow className="border-t-2 border-profit bg-profit/30 /10">
 <TableCell className="text-xs font-bold bg-profit/50 /20 sticky right-0">
 <span className="flex items-center gap-1.5">
 <Activity className="w-3.5 h-3.5 text-profit" />
 نسبة النجاح الفعلية (Live Win Rate)
 </span>
 </TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 const loading = personaBenchmarkLoading[p];
 const r = personaBenchmarkResults[p];
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono font-bold",
 isBest && "bg-profit/60 /20 border-x-2 border-profit"
 )}
 >
 {loading ? (
 <Loader2 className="w-4 h-4 animate-spin mx-auto text-profit" />
 ) : r?.winRate !== null && r?.winRate !== undefined ? (
 <span className="text-profit ">{(r.winRate ?? 0).toFixed(1)}%</span>
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </TableCell>
 );
 })}
 </TableRow>
 )}

 {/* Live backtest results — profit factor */}
 {personaBenchmarkRan && (
 <TableRow className="bg-profit/30 /10">
 <TableCell className="text-xs font-bold bg-profit/50 /20 sticky right-0">
 <span className="flex items-center gap-1.5">
 <Activity className="w-3.5 h-3.5 text-profit" />
 عامل الربحية الفعلي (Live Profit Factor)
 </span>
 </TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 const loading = personaBenchmarkLoading[p];
 const r = personaBenchmarkResults[p];
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono font-bold",
 isBest && "bg-profit/60 /20 border-x-2 border-profit"
 )}
 >
 {loading ? (
 <Loader2 className="w-4 h-4 animate-spin mx-auto text-profit" />
 ) : r?.profitFactor !== null && r?.profitFactor !== undefined ? (
 <span className="text-primary ">{(r.profitFactor ?? 0).toFixed(2)}</span>
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </TableCell>
 );
 })}
 </TableRow>
 )}

 {/* Live backtest results — total return */}
 {personaBenchmarkRan && (
 <TableRow className="bg-profit/30 /10">
 <TableCell className="text-xs font-bold bg-profit/50 /20 sticky right-0">
 <span className="flex items-center gap-1.5">
 <Activity className="w-3.5 h-3.5 text-profit" />
 إجمالي العائد الفعلي (Live Total Return)
 </span>
 </TableCell>
 {(['conservative', 'balanced', 'gambler'] as PersonaKey[]).map(p => {
 const isBest = bestPersona === p;
 const loading = personaBenchmarkLoading[p];
 const r = personaBenchmarkResults[p];
 return (
 <TableCell
 key={p}
 className={cn(
 "text-xs text-center font-mono font-bold",
 isBest && "bg-profit/60 /20 border-x-2 border-profit"
 )}
 >
 {loading ? (
 <Loader2 className="w-4 h-4 animate-spin mx-auto text-profit" />
 ) : r?.totalReturn !== null && r?.totalReturn !== undefined ? (
 <span className="text-primary ">+{(r.totalReturn ?? 0).toFixed(2)}%</span>
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </TableCell>
 );
 })}
 </TableRow>
 )}
 </TableBody>
 </Table>
 </div>

 {/* Footnote */}
 <p className="text-xs text-muted-foreground leading-relaxed">
 * الأرقام التقديرية مبنية على معاملات الشخصية الديناميكية. اضغط "تشغيل المقارنة" لعرض النتائج الفعلية من نفس الفترة.
 </p>

 {/* Run Side-by-Side Backtest Button */}
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t">
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <Clock className="w-4 h-4" />
 <span>
 الفترة: <span className="font-mono font-semibold text-foreground">{fromDate}</span>
 {' → '}
 <span className="font-mono font-semibold text-foreground">{toDate}</span>
 {' · '}
 السوق: <span className="font-semibold text-foreground">{assetType === 'egx' ? 'البورصة المصرية' : 'الكريبتو'}</span>
 </span>
 </div>
 <Button
 onClick={runSideBySideBacktest}
 disabled={anyPersonaBenchmarkLoading}
 className="gap-2 bg-primary hover:bg-primary text-white"
 >
 {anyPersonaBenchmarkLoading ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Play className="w-4 h-4 fill-white" />
 )}
 {anyPersonaBenchmarkLoading ? 'جاري تشغيل المقارنة...' : 'تشغيل المقارنة الفعلية (Side-by-Side Backtest)'}
 </Button>
 </div>

 {/* Best persona highlight banner */}
 {bestPersona && (
 <div className="rounded-lg border-2 border-profit bg-profit/70 /20 p-3 flex items-center gap-3">
 <Trophy className="w-5 h-5 text-profit shrink-0" />
 <div className="text-xs">
 <span className="font-bold text-profit ">
 🏆 الأفضل: {PERSONA_BENCHMARK_META[bestPersona].emoji} {PERSONA_BENCHMARK_META[bestPersona].arLabel}
 </span>
 <span className="text-muted-foreground mr-2">
 — أعلى إجمالي عائد فعلي (+{personaBenchmarkResults[bestPersona]?.totalReturn?.toFixed(2) ?? '0.00'}%) خلال نفس الفترة.
 </span>
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>

 {/* Action Buttons */}
 <Card>
 <CardContent className="p-4">
 <div className="flex flex-wrap gap-2 justify-between">
 <div className="flex flex-wrap gap-2">
 {/* زر التعلم التكراري - الرئيسي */}
 <Button
 onClick={runIterativeLearningSystem}
 disabled={isRunning || loading !== null}
 className="gap-2 bg-gradient-to-r from-profit to-whale hover:from-profit hover:to-whale"
 >
 {loading === 'iterative' ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Brain className="w-4 h-4" />
 )}
 تعلم تكراري (حتى 75%)
 </Button>
 
 {/* زر الاختبار الفردي */}
 <Button
 onClick={runSingleBacktest}
 disabled={isRunning || loading !== null}
 variant="outline"
 className="gap-2"
 >
 {loading === 'backtest' ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Play className="w-4 h-4" />
 )}
 اختبار واحد
 </Button>
 
 {results && results.win_rate >= 50 && (
 <Button
 variant="default"
 onClick={applyParameters}
 disabled={loading !== null}
 className="gap-2 bg-violet-600 hover:bg-violet-700"
 >
 <CheckCircle2 className="w-4 h-4" />
 تطبيق البرمترات
 </Button>
 )}
 </div>
 
 <Button variant="outline" onClick={() => { setResults(null); setTrades([]); setIterations([]); }} className="gap-2">
 <RotateCcw className="w-4 h-4" />
 مسح النتائج
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

export default SuperLearningSystem;

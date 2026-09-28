'use client';

/**
 * OptimizerParamsPanel — لوحة تحكم معاملات PredictionOptimizer
 * ==============================================================
 * تظهر كـ overlay في MaestroCommandCenter.
 * تقرأ المعاملات الحالية من /api/prediction-optimizer/params
 * وتحفظ التعديلات عبر POST.
 * يمكن تشغيل backtest سريع لاختبار المعاملات.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Save, RotateCcw, Play, X, Sliders, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface OptimizerParams {
  min_conviction: number;
  min_rr_ratio: number;
  max_stop_pct: number;
  min_target_pct: number;
  skip_bear_regime: boolean;
  skip_bull_regime: boolean;
  use_adx_filter: boolean;
  adx_threshold: number;
  use_volume_spike: boolean;
  volume_spike_mult: number;
  max_holding_days: number;
}

interface BacktestResult {
  trades: number;
  win_rate: number;
  profit_factor: number;
  avg_return: number;
  stocks_tested: number;
}

export function OptimizerParamsPanel({ onClose }: { onClose: () => void }) {
  const [params, setParams] = useState<OptimizerParams | null>(null);
  const [saving, setSaving] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchParams = useCallback(async () => {
    try {
      const res = await fetch('/api/python/prediction-optimizer/params?XTransformPort=8010');
      const data = await res.json();
      if (data.success) {
        setParams(data.params);
      }
    } catch (e) {
      setError('فشل تحميل المعاملات');
    }
  }, []);

  useEffect(() => {
    fetchParams();
  }, [fetchParams]);

  const updateParam = (key: keyof OptimizerParams, value: number | boolean) => {
    if (!params) return;
    setParams({ ...params, [key]: value });
  };

  const saveParams = async () => {
    if (!params) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/python/prediction-optimizer/params?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (data.success) {
        setParams(data.params);
      } else {
        setError(data.error || 'فشل الحفظ');
      }
    } catch (e) {
      setError('فشل الاتصال');
    }
    setSaving(false);
  };

  const resetParams = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/python/prediction-optimizer/params/reset?XTransformPort=8010', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setParams(data.params);
      }
    } catch (e) {
      setError('فشل إعادة التعيين');
    }
    setSaving(false);
  };

  const runBacktest = async () => {
    if (!params) return;
    setBacktesting(true);
    setBacktestResult(null);
    setError(null);
    try {
      const res = await fetch('/api/python/prediction-optimizer/backtest?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (data.success) {
        setBacktestResult(data.data);
      } else {
        setError(data.error || 'فشل الاختبار');
      }
    } catch (e) {
      setError('فشل الاتصال');
    }
    setBacktesting(false);
  };

  if (!params) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-4 left-4 z-50 w-96 max-h-[80vh] overflow-y-auto rounded-xl border border-cyan-500/30 bg-[#0a0e17]/95 backdrop-blur-xl shadow-2xl"
      dir="rtl"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-cyan-500/20">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">معاملات محرك التحسين</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Conviction Filter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">حد الاقتناء (min conviction)</label>
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">{params.min_conviction}</Badge>
          </div>
          <Slider
            value={[params.min_conviction]}
            onValueChange={(v) => updateParam('min_conviction', v[0])}
            min={3} max={8} step={1}
            className="cursor-pointer"
          />
          <p className="text-[10px] text-gray-500">عدد العوامل المتفقة المطلوب قبل إصدار إشارة</p>
        </div>

        <Separator className="bg-white/5" />

        {/* Risk Management */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">حد الإيقاف % (max stop)</label>
            <Badge variant="outline" className="text-amber-400 border-amber-500/30">{params.max_stop_pct}%</Badge>
          </div>
          <Slider
            value={[params.max_stop_pct]}
            onValueChange={(v) => updateParam('max_stop_pct', v[0])}
            min={2} max={12} step={0.5}
            className="cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">حد الهدف % (min target)</label>
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">{params.min_target_pct}%</Badge>
          </div>
          <Slider
            value={[params.min_target_pct]}
            onValueChange={(v) => updateParam('min_target_pct', v[0])}
            min={3} max={15} step={0.5}
            className="cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">حد R/R (risk/reward)</label>
            <Badge variant="outline" className="text-purple-400 border-purple-500/30">{params.min_rr_ratio}</Badge>
          </div>
          <Slider
            value={[params.min_rr_ratio]}
            onValueChange={(v) => updateParam('min_rr_ratio', v[0])}
            min={1} max={3} step={0.1}
            className="cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">حد أقصى للاحتجاز (أيام)</label>
            <Badge variant="outline" className="text-blue-400 border-blue-500/30">{params.max_holding_days}</Badge>
          </div>
          <Slider
            value={[params.max_holding_days]}
            onValueChange={(v) => updateParam('max_holding_days', v[0])}
            min={5} max={30} step={1}
            className="cursor-pointer"
          />
        </div>

        <Separator className="bg-white/5" />

        {/* Regime Filters */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">فلاتر حالة السوق</h4>
          
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">تخطّي السوق الهابط (bear)</label>
            <Switch
              checked={params.skip_bear_regime}
              onCheckedChange={(v) => updateParam('skip_bear_regime', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">تخطّي السوق الصاعد (bull)</label>
            <Switch
              checked={params.skip_bull_regime}
              onCheckedChange={(v) => updateParam('skip_bull_regime', v)}
            />
          </div>
        </div>

        <Separator className="bg-white/5" />

        {/* Indicator Filters */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">فلاتر المؤشرات</h4>
          
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">فلتر ADX (قوة الاتجاه)</label>
            <Switch
              checked={params.use_adx_filter}
              onCheckedChange={(v) => updateParam('use_adx_filter', v)}
            />
          </div>

          {params.use_adx_filter && (
            <div className="space-y-2 pl-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">حد ADX</label>
                <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">{params.adx_threshold}</Badge>
              </div>
              <Slider
                value={[params.adx_threshold]}
                onValueChange={(v) => updateParam('adx_threshold', v[0])}
                min={10} max={40} step={1}
                className="cursor-pointer"
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-300">فلتر حجم التداول</label>
            <Switch
              checked={params.use_volume_spike}
              onCheckedChange={(v) => updateParam('use_volume_spike', v)}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={saveParams}
            disabled={saving}
            size="sm"
            className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="mr-1">حفظ</span>
          </Button>
          <Button
            onClick={runBacktest}
            disabled={backtesting}
            size="sm"
            variant="outline"
            className="flex-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            {backtesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span className="mr-1">اختبار</span>
          </Button>
          <Button
            onClick={resetParams}
            disabled={saving}
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-white"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>

        {/* Backtest Results */}
        {backtestResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 space-y-2"
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-white">نتيجة الاختبار السريع</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-black/30">
                <div className="text-gray-500">الصفقات</div>
                <div className="text-white font-bold">{backtestResult.trades}</div>
              </div>
              <div className="p-2 rounded bg-black/30">
                <div className="text-gray-500">معدل النجاح</div>
                <div className={`font-bold ${backtestResult.win_rate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {backtestResult.win_rate}%
                </div>
              </div>
              <div className="p-2 rounded bg-black/30">
                <div className="text-gray-500">معامل الربحية</div>
                <div className={`font-bold ${backtestResult.profit_factor >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {backtestResult.profit_factor}
                </div>
              </div>
              <div className="p-2 rounded bg-black/30">
                <div className="text-gray-500">متوسط العائد</div>
                <div className={`font-bold ${backtestResult.avg_return > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {backtestResult.avg_return > 0 ? '+' : ''}{backtestResult.avg_return}%
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-500">
              اختبار على {backtestResult.stocks_tested} سهم — آخر 60 يوم
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

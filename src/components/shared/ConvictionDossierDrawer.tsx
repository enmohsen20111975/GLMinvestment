'use client';

/**
 * ConvictionDossierDrawer — ملف الأدلة والبراهين (4 طبقات)
 * ============================================================================
 * TASK-ALPHA-B (Owner Directive 2026-10-15): إصلاح كارثة التوقعات العريانة.
 *
 * المشكلة: شاشة التوقعات بتقول "شراء فوري" من غير دليل على مين الحوت اللي
 * اشترى، ولا سجل المنصة في السهم ده، ولا التفسير الفني.
 *
 * الحل: Drawer يعرض 4 طبقات من الأدلة (كلها من Python — Rule 20):
 *   1. برهان سيولة الحيتان: آخر 5 جلسات (التاريخ، صافي الكاش، الحجم) + الإجمالي.
 *   2. سجل النزاهة: نسبة نجاح توصيات المنصة السابقة على نفس السهم.
 *   3. هندسة المخاطرة: الدخول، الوقف، الأهداف، R/R، المخاطرة/المكافأة بالجنيه.
 *   4. التفسير المؤسسي: جملتان صريحتان بلغة السوق.
 *
 * Endpoint: GET /api/recommendations/dossier/<ticker> (Python conviction_dossier_bp).
 * Rule 27: NO-FAKE-DATA — كل رقم من البايثون. لو ناقص → "—" + reason.
 * Rule 30: emerald/teal/rose/amber فقط.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DollarSign,
  Trophy,
  Calculator,
  FileText,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WhaleFlowEntry {
  date: string | null;
  net_flow_egp: number;
  volume: number;
}

interface WinRate {
  total_recommendations: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  last_outcome: string | null;
  last_outcome_date: string | null;
}

interface TradeMath {
  entry_price: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  rr_ratio: number | null;
  signal: string | null;
  risk_egp_per_share: number | null;
  reward_egp_per_share: number | null;
}

interface DossierData {
  success: boolean;
  ticker: string;
  name_ar?: string | null;
  sector?: string | null;
  liquidity_bucket?: string | null;
  liquidity_bucket_ar?: string | null;
  whale_flow_history?: WhaleFlowEntry[];
  whale_total_5d_egp?: number;
  historical_win_rate?: WinRate;
  trade_math?: TradeMath;
  technical_rationale?: string;
  error?: string;
  error_ar?: string;
}

interface Props {
  ticker: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmtFlow(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtRR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  return `1:${Number(n).toFixed(2)}`;
}

export function ConvictionDossierDrawer({ ticker, open, onOpenChange }: Props) {
  const [data, setData] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDossier = useCallback(async (tkr: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations/dossier/${encodeURIComponent(tkr)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DossierData;
      if (json.success === false) {
        throw new Error(json.error_ar || json.error || 'فشل تحميل الملف');
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only fetch when the drawer is open AND we have a ticker.
    if (!open || !ticker) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadDossier(ticker);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ticker, loadDossier]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88vh] overflow-y-auto">
        <DrawerHeader className="px-6 pt-6 pb-3 border-b border-border/60">
          <DrawerTitle className="text-lg font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-500" />
            ملف الأدلة والبراهين — {ticker || '—'}
          </DrawerTitle>
          {data?.name_ar && (
            <DrawerDescription className="text-sm">
              {data.name_ar}
              {data?.sector ? ` · ${data.sector}` : ''}
            </DrawerDescription>
          )}
        </DrawerHeader>

        <div className="px-6 py-4 space-y-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                خدمة ملف الأدلة قد تكون غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.
              </p>
            </div>
          )}

          {data && !loading && !error && (
            <>
              {/* 1. برهان سيولة الحيتان */}
              <section className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-bold">برهان سيولة الحيتان (آخر 5 جلسات)</h3>
                  {data.liquidity_bucket_ar && (
                    <Badge variant="outline" className="ms-auto text-[10px]">
                      {data.liquidity_bucket_ar}
                    </Badge>
                  )}
                </div>
                <div className="text-center mb-3">
                  <p className="text-[10px] text-muted-foreground">إجمالي صافي الكاش (5 جلسات)</p>
                  <p
                    className={cn(
                      'text-2xl font-bold tabular-nums',
                      (data.whale_total_5d_egp ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                    )}
                  >
                    {fmtFlow(data.whale_total_5d_egp)} ج.م
                  </p>
                </div>
                {data.whale_flow_history && data.whale_flow_history.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {data.whale_flow_history.map((h, i) => (
                      <div
                        key={`${h.date || i}`}
                        className="flex items-center justify-between text-xs bg-background rounded-md px-2 py-1.5 border border-border/40"
                      >
                        <span className="text-muted-foreground font-mono">{h.date || '—'}</span>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'font-mono font-bold tabular-nums',
                              (h.net_flow_egp ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            )}
                          >
                            {fmtFlow(h.net_flow_egp)} ج.م
                          </span>
                          <span className="text-muted-foreground font-mono text-[10px]">
                            Vol: {fmtFlow(h.volume)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">لا توجد بيانات تدفق متاحة.</p>
                )}
              </section>

              {/* 2. سجل النزاهة */}
              <section className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-bold">سجل النزاهة التاريخي</h3>
                </div>
                {data.historical_win_rate && data.historical_win_rate.total_recommendations > 0 ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-background rounded-md p-2 border border-border/40">
                        <p className="text-[10px] text-muted-foreground">نسبة النجاح</p>
                        <p className="text-lg font-bold tabular-nums text-emerald-500">
                          {data.historical_win_rate.win_rate_pct.toFixed(0)}%
                        </p>
                      </div>
                      <div className="bg-background rounded-md p-2 border border-border/40">
                        <p className="text-[10px] text-muted-foreground">رابحة</p>
                        <p className="text-lg font-bold tabular-nums text-emerald-500">
                          {data.historical_win_rate.wins}
                        </p>
                      </div>
                      <div className="bg-background rounded-md p-2 border border-border/40">
                        <p className="text-[10px] text-muted-foreground">خاسرة</p>
                        <p className="text-lg font-bold tabular-nums text-rose-500">
                          {data.historical_win_rate.losses}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      من إجمالي {data.historical_win_rate.total_recommendations} توصية سابقة على هذا السهم
                      {data.historical_win_rate.last_outcome_date &&
                        ` · آخر نتيجة: ${data.historical_win_rate.last_outcome === 'win' ? '✓ ربح' : data.historical_win_rate.last_outcome === 'loss' ? '✗ خسارة' : 'مفتوحة'} (${data.historical_win_rate.last_outcome_date.split(' ')[0]})`}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    لا يوجد سجل توصيات سابقة على هذا السهم بعد.
                  </p>
                )}
              </section>

              {/* 3. هندسة المخاطرة */}
              <section className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calculator className="w-4 h-4 text-teal-500" />
                  <h3 className="text-sm font-bold">هندسة المخاطرة</h3>
                </div>
                {data.trade_math && data.trade_math.entry_price ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-background rounded-md p-2 border border-emerald-500/20 text-center">
                        <p className="text-[10px] text-muted-foreground">الدخول</p>
                        <p className="font-mono font-bold tabular-nums text-emerald-500">
                          {fmtPrice(data.trade_math.entry_price)}
                        </p>
                      </div>
                      <div className="bg-background rounded-md p-2 border border-rose-500/20 text-center">
                        <p className="text-[10px] text-muted-foreground">الوقف</p>
                        <p className="font-mono font-bold tabular-nums text-rose-500">
                          {fmtPrice(data.trade_math.stop_loss)}
                        </p>
                      </div>
                      <div className="bg-background rounded-md p-2 border border-teal-500/20 text-center">
                        <p className="text-[10px] text-muted-foreground">الهدف 1</p>
                        <p className="font-mono font-bold tabular-nums text-teal-500">
                          {fmtPrice(data.trade_math.target_1)}
                        </p>
                      </div>
                      <div className="bg-background rounded-md p-2 border border-teal-500/20 text-center">
                        <p className="text-[10px] text-muted-foreground">الهدف 2</p>
                        <p className="font-mono font-bold tabular-nums text-teal-600">
                          {fmtPrice(data.trade_math.target_2)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs bg-muted/40 rounded-md p-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground">R/R</p>
                        <p className="font-mono font-bold tabular-nums text-emerald-500">
                          {fmtRR(data.trade_math.rr_ratio)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">مخاطرة/سهم</p>
                        <p className="font-mono font-bold tabular-nums text-rose-500">
                          {fmtPrice(data.trade_math.risk_egp_per_share)} ج.م
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">مكافأة/سهم</p>
                        <p className="font-mono font-bold tabular-nums text-emerald-500">
                          {fmtPrice(data.trade_math.reward_egp_per_share)} ج.م
                        </p>
                      </div>
                    </div>
                    {data.trade_math.signal && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">الإشارة</span>
                        <Badge variant="default" className="bg-emerald-600 text-white">
                          {data.trade_math.signal}
                        </Badge>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    لا توجد صفقة نشطة مخزّنة لحساب هندسة المخاطرة.
                  </p>
                )}
              </section>

              {/* 4. التفسير المؤسسي */}
              <section className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-bold">التفسير المؤسسي</h3>
                </div>
                {data.technical_rationale ? (
                  <p className="text-xs text-foreground leading-relaxed">
                    {data.technical_rationale}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">لا يوجد تفسير فني متاح.</p>
                )}
              </section>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

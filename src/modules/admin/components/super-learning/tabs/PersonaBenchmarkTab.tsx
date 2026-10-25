/**
 * super-learning/tabs/PersonaBenchmarkTab.tsx
 * ===========================================
 * P39-PHASE-5: Persona Benchmarking — side-by-side comparison of the 3 personas
 * (conservative / balanced / gambler) via a static benchmark table + live
 * side-by-side backtest results (winRate / profitFactor / totalReturn).
 *
 * Includes the "تشغيل المقارنة الفعلية" button (calls runSideBySideBacktest) and
 * the "🏆 الأفضل" highlight banner (best persona by live total return).
 */
'use client';

import React from 'react';
import {
  Clock, Users, Trophy, Activity, Loader2, Play,
} from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type {
  PersonaKey, PersonaLiveResult,
} from '@/hooks/useSuperLearningData';
import { PERSONA_BENCHMARK_DATA, PERSONA_BENCHMARK_META } from '../constants';

export interface PersonaBenchmarkTabProps {
  fromDate: string;
  toDate: string;
  assetType: string;
  bestPersona: PersonaKey | null;
  personaBenchmarkLoading: Record<PersonaKey, boolean>;
  personaBenchmarkResults: Record<PersonaKey, PersonaLiveResult | null>;
  personaBenchmarkRan: boolean;
  anyPersonaBenchmarkLoading: boolean;
  runSideBySideBacktest: () => void;
}

const PERSONAS: PersonaKey[] = ['conservative', 'balanced', 'gambler'];

export function PersonaBenchmarkTab(props: PersonaBenchmarkTabProps) {
  const {
    fromDate, toDate, assetType,
    bestPersona,
    personaBenchmarkLoading,
    personaBenchmarkResults,
    personaBenchmarkRan,
    anyPersonaBenchmarkLoading,
    runSideBySideBacktest,
  } = props;

  return (
    <div className="space-y-4">
      {/* Date range info banner */}
      <div className="rounded-lg border bg-profit/10 /10 border-profit/20 p-3 flex items-center gap-2 text-xs text-profit ">
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
                  {PERSONAS.map(p => {
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
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].riskScore}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Stop Factor */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">مضاعف الستوب (Stop Factor × ATR)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {(PERSONA_BENCHMARK_DATA[p].stopFactor ?? 0).toFixed(1)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Target Factor */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">مضاعف الهدف (Target Factor × ATR)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {(PERSONA_BENCHMARK_DATA[p].targetFactor ?? 0).toFixed(1)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Max Risk % */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">أقصى مخاطرة % (Max Risk per Trade)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {(PERSONA_BENCHMARK_DATA[p].maxRiskPct ?? 0).toFixed(1)}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Win Rate % */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">نسبة النجاح % (Win Rate) *</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono text-profit font-semibold", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].winRate}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Profit Factor */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">عامل الربحية (Profit Factor) *</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono text-primary font-semibold", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {(PERSONA_BENCHMARK_DATA[p].profitFactor ?? 0).toFixed(2)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Max Drawdown % */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">أقصى تراجع % (Max Drawdown) *</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono text-loss font-semibold", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        -{(PERSONA_BENCHMARK_DATA[p].maxDrawdown ?? 0).toFixed(1)}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Avg Trades/Month */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">متوسط الصفقات/شهر (Avg Trades/Month) *</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].avgTradesPerMonth}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Total Return % */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">إجمالي العائد % (Total Return) *</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono text-primary font-bold", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        +{(PERSONA_BENCHMARK_DATA[p].totalReturn ?? 0).toFixed(1)}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* EGX Ceiling */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">سقف البورصة المصرية % (EGX Ceiling)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].egxCeiling}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Crypto Ceiling */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">سقف الكريبتو % (Crypto Ceiling)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].cryptoCeiling}%
                      </TableCell>
                    );
                  })}
                </TableRow>
                {/* Cash Floor */}
                <TableRow>
                  <TableCell className="text-xs font-medium bg-muted/30 sticky right-0">حد الكاش الأدنى % (Cash Floor)</TableCell>
                  {PERSONAS.map(p => {
                    const isBest = bestPersona === p;
                    return (
                      <TableCell key={p} className={cn("text-xs text-center font-mono", isBest && "bg-profit/10 /10 border-x-2 border-profit")}>
                        {PERSONA_BENCHMARK_DATA[p].cashFloor}%
                      </TableCell>
                    );
                  })}
                </TableRow>

                {/* Live backtest results — win rate */}
                {personaBenchmarkRan && (
                  <TableRow className="border-t-2 border-profit bg-profit/10 /10">
                    <TableCell className="text-xs font-bold bg-profit/10 /20 sticky right-0">
                      <span className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-profit" />
                        نسبة النجاح الفعلية (Live Win Rate)
                      </span>
                    </TableCell>
                    {PERSONAS.map(p => {
                      const isBest = bestPersona === p;
                      const loading = personaBenchmarkLoading[p];
                      const r = personaBenchmarkResults[p];
                      return (
                        <TableCell key={p} className={cn("text-xs text-center font-mono font-bold", isBest && "bg-profit/10 /20 border-x-2 border-profit")}>
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
                  <TableRow className="bg-profit/10 /10">
                    <TableCell className="text-xs font-bold bg-profit/10 /20 sticky right-0">
                      <span className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-profit" />
                        عامل الربحية الفعلي (Live Profit Factor)
                      </span>
                    </TableCell>
                    {PERSONAS.map(p => {
                      const isBest = bestPersona === p;
                      const loading = personaBenchmarkLoading[p];
                      const r = personaBenchmarkResults[p];
                      return (
                        <TableCell key={p} className={cn("text-xs text-center font-mono font-bold", isBest && "bg-profit/10 /20 border-x-2 border-profit")}>
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
                  <TableRow className="bg-profit/10 /10">
                    <TableCell className="text-xs font-bold bg-profit/10 /20 sticky right-0">
                      <span className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-profit" />
                        إجمالي العائد الفعلي (Live Total Return)
                      </span>
                    </TableCell>
                    {PERSONAS.map(p => {
                      const isBest = bestPersona === p;
                      const loading = personaBenchmarkLoading[p];
                      const r = personaBenchmarkResults[p];
                      return (
                        <TableCell key={p} className={cn("text-xs text-center font-mono font-bold", isBest && "bg-profit/10 /20 border-x-2 border-profit")}>
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
    </div>
  );
}

'use client';

import React from 'react';
import { Calculator, TrendingUp, BarChart3, Award } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

// ==================== SECTOR PE MAP ====================

const SECTOR_PE: Record<string, number> = {
  'Financials': 12,
  'Real Estate': 8,
  'Basic Materials': 10,
  'Food & Beverage': 14,
  'Healthcare': 18,
  'Technology': 20,
  'Industrials': 11,
  'Consumer Goods': 13,
  'Energy': 9,
  'Telecommunications': 15,
  'Consumer Services': 12,
};

// ==================== FORMULA ROW COMPONENT ====================

function FormulaRow({ label, formula, result, highlight }: {
  label: string;
  formula: string;
  result?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2">
      <span className="text-sm text-muted-foreground min-w-[130px] flex-shrink-0">{label}</span>
      <code className="text-xs sm:text-sm font-mono text-foreground/80 leading-relaxed flex-1" dir="ltr" lang="en">
        {formula}
      </code>
      {result && (
        <span className={cn('text-sm font-bold min-w-[80px] text-left flex-shrink-0', highlight && 'text-emerald-600 dark:text-emerald-400')}>
          {result}
        </span>
      )}
    </div>
  );
}

// ==================== VERDICT BADGE ====================

function VerdictBadge({ verdict, verdictAr }: { verdict: string; verdictAr: string }) {
  return (
    <Badge variant="outline" className={cn(
      'text-sm font-bold border-0 px-4 py-1',
      verdict === 'undervalued' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
      verdict === 'fair' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
      verdict === 'overvalued' && 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
    )}>
      {verdictAr}
    </Badge>
  );
}

// ==================== SECTION 1: FAIR VALUE ====================

function FairValueSection() {
  const { selectedStock, professionalAnalysis } = useAppStore();

  if (!selectedStock) return null;

  const prof = professionalAnalysis as Record<string, unknown> | null;
  const profData = prof?.analysis as Record<string, unknown> | null;
  const fairValueData = profData?.fair_value as Record<string, unknown> | null;
  const details = fairValueData?.details as Record<string, unknown> | null;

  const eps = Number(selectedStock.eps) || 0;
  const pb = Number(selectedStock.pb_ratio) || 0;
  const currentPrice = Number(selectedStock.current_price) || 0;
  const sector = selectedStock.sector || '';
  const sectorPE = SECTOR_PE[sector] || 12;

  // BVPS
  const bvps = pb > 0 && currentPrice > 0 ? currentPrice / pb : 0;

  // Use professional analysis data if available, otherwise calculate locally
  const grahamNumber = fairValueData ? Number(fairValueData.graham_number) || 0 : (
    eps > 0 && bvps > 0 ? Math.round(Math.sqrt(22.5 * eps * bvps) * 100) / 100 : 0
  );
  const peBased = fairValueData ? Number(fairValueData.pe_based) || 0 : (
    eps > 0 ? Math.round(sectorPE * eps * 100) / 100 : 0
  );
  const avgFairValue = fairValueData ? Number(fairValueData.average_fair_value) || currentPrice : (
    [grahamNumber, peBased].filter(v => v > 0).length > 0
      ? Math.round([grahamNumber, peBased].filter(v => v > 0).reduce((s, v) => s + v, 0) / [grahamNumber, peBased].filter(v => v > 0).length * 100) / 100
      : currentPrice
  );
  const upsideToFair = fairValueData ? Number(fairValueData.upside_to_fair) || 0 : (
    currentPrice > 0 ? Math.round(((avgFairValue - currentPrice) / currentPrice) * 10000) / 100 : 0
  );
  const verdict = fairValueData ? (fairValueData.verdict as string) || 'fair' : (
    upsideToFair >= 15 ? 'undervalued' : upsideToFair >= -15 ? 'fair' : 'overvalued'
  );
  const verdictAr = fairValueData ? (fairValueData.verdict_ar as string) || 'عادل التقييم' : (
    upsideToFair >= 15 ? 'مقوم بأقل من قيمته' : upsideToFair >= -15 ? 'عادل التقييم' : 'مقوم بأكثر من قيمته'
  );

  // Professional calculation details
  const lynchValue = fairValueData ? Number(fairValueData.lynch_value) || 0 : 0;
  const dcfValue = fairValueData ? Number(fairValueData.dcf_simplified) || 0 : 0;
  const growthRate = details ? Number(details.growth_rate) || 0 : 0;
  const riskFreeRate = details ? Number(details.risk_free_rate) || 17.5 : 17.5;

  const grahamCalc = details?.graham_calc as string || (
    bvps > 0 && eps > 0
      ? `√(22.5 × ${eps.toFixed(2)} × ${bvps.toFixed(2)}) = √(${(22.5 * eps * bvps).toFixed(2)}) = ${grahamNumber.toFixed(2)}`
      : 'غير متاح (EPS أو BVPS غير صالح)'
  );
  const peCalc = details?.pe_calc as string || (
    eps > 0
      ? `${sectorPE} × ${eps.toFixed(2)} = ${peBased.toFixed(2)}`
      : 'غير متاح (EPS غير صالح)'
  );
  const lynchCalc = details?.lynch_calc as string || null;
  const dcfCalc = details?.dcf_calc as string || null;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-xl border bg-muted/30">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">السعر الحالي</p>
          <p className="text-lg font-bold font-mono">{currentPrice.toFixed(2)}</p>
        </div>
        <div className="text-muted-foreground">→</div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">القيمة العادلة</p>
          <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">{avgFairValue.toFixed(2)}</p>
        </div>
        <div className="text-muted-foreground">→</div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">الفرق</p>
          <p className={cn('text-lg font-bold font-mono', upsideToFair >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {upsideToFair >= 0 ? '+' : ''}{upsideToFair.toFixed(1)}%
          </p>
        </div>
        <VerdictBadge verdict={verdict} verdictAr={verdictAr} />
      </div>

      <Separator />

      {/* Graham Number */}
      <p className="text-sm font-bold text-foreground">١. Graham Number (رقم غراهام)</p>
      <FormulaRow
        label="الصيغة"
        formula="√(22.5 × EPS × BVPS)"
      />
      <FormulaRow
        label="الحساب"
        formula={grahamCalc}
        result={grahamNumber > 0 ? `${grahamNumber.toFixed(2)} EGP` : undefined}
      />

      <Separator />

      {/* P/E Based */}
      <p className="text-sm font-bold text-foreground">٢. القيمة على أساس P/E</p>
      <FormulaRow
        label="الصيغة"
        formula={`متوسط P/E القطاع (${sectorPE}) × EPS`}
      />
      <FormulaRow
        label="الحساب"
        formula={peCalc}
        result={peBased > 0 ? `${peBased.toFixed(2)} EGP` : undefined}
      />

      {/* Lynch (only if professional analysis available) */}
      {lynchValue > 0 && lynchCalc && (
        <>
          <Separator />
          <p className="text-sm font-bold text-foreground">٣. قيمة Peter Lynch</p>
          <FormulaRow
            label="الصيغة"
            formula="PEG × EPS × (1 + نمو%)"
          />
          <FormulaRow
            label="الحساب"
            formula={lynchCalc}
            result={`${lynchValue.toFixed(2)} EGP`}
          />
        </>
      )}

      {/* DCF (only if professional analysis available) */}
      {dcfValue > 0 && dcfCalc && (
        <>
          <Separator />
          <p className="text-sm font-bold text-foreground">
            {lynchValue > 0 ? '٤' : '٣'}. التدفقات النقدية المبسطة (DCF)
          </p>
          <FormulaRow
            label="الصيغة"
            formula="EPS × (8.5 + 2×نمو) × (4.4 / معدل_خالي_المخاطر)"
          />
          <FormulaRow
            label="معدل المخاطر"
            formula={`${riskFreeRate}% (معدل البنك المركزي المصري)`}
          />
          <FormulaRow
            label="الحساب"
            formula={dcfCalc}
            result={`${dcfValue.toFixed(2)} EGP`}
          />
        </>
      )}

      <Separator />

      {/* Average */}
      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40">
        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-1">متوسط القيمة العادلة</p>
        <code className="text-xs font-mono text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
          {fairValueData
            ? `Graham: ${grahamNumber.toFixed(2)} | Lynch: ${lynchValue.toFixed(2)} | DCF: ${dcfValue.toFixed(2)} | P/E: ${peBased.toFixed(2)}`
            : `Graham: ${grahamNumber.toFixed(2)} | P/E: ${peBased.toFixed(2)}`}
        </code>
        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1">
          المتوسط = {avgFairValue.toFixed(2)} EGP
        </p>
      </div>
    </div>
  );
}

// ==================== SECTION 2: TECHNICAL CALCULATIONS ====================

function TechnicalCalculationsSection() {
  const { selectedStock, professionalAnalysis } = useAppStore();

  if (!selectedStock) return null;

  const prof = professionalAnalysis as Record<string, unknown> | null;
  const profData = prof?.analysis as Record<string, unknown> | null;
  const indicators = profData?.indicators as Record<string, unknown> | null;
  const macd = indicators?.macd as Record<string, unknown> | null;

  const rsi = Number(selectedStock.rsi) || 0;
  const ma50 = Number(selectedStock.ma_50) || 0;
  const ma200 = Number(selectedStock.ma_200) || 0;
  const currentPrice = Number(selectedStock.current_price) || 0;

  // RSI interpretation
  let rsiZone: string;
  let rsiSignal: string;
  let rsiColor: string;
  if (rsi >= 70) { rsiZone = 'تشبع شرائي'; rsiSignal = 'بيع'; rsiColor = 'text-red-600'; }
  else if (rsi >= 55) { rsiZone = 'قوي'; rsiSignal = 'صعودي'; rsiColor = 'text-emerald-600'; }
  else if (rsi >= 45) { rsiZone = 'محايد'; rsiSignal = 'محايد'; rsiColor = 'text-amber-600'; }
  else if (rsi >= 30) { rsiZone = 'ضعيف'; rsiSignal = 'هبوطي'; rsiColor = 'text-orange-600'; }
  else { rsiZone = 'تشبع بيعي'; rsiSignal = 'شراء'; rsiColor = 'text-emerald-600'; }

  // MA Cross
  const maPosition = ma50 > ma200 ? 'MA50 أعلى من MA200' : 'MA50 أقل من MA200';
  const maCrossSignal = ma50 > ma200 ? 'تقاطع ذهبي (إيجابي)' : 'تقاطع ميت (سلبي)';
  const maCrossColor = ma50 > ma200 ? 'text-emerald-600' : 'text-red-600';

  // MACD
  const macdLine = macd ? Number(macd.line) || 0 : 0;
  const macdSignal = macd ? Number(macd.signal) || 0 : 0;
  const macdHist = macd ? Number(macd.histogram) || 0 : 0;
  const macdText = macd ? macd.signal_text as string : null;
  const macdInterpretation = macdHist > 0 ? 'زخم إيجابي (شراء)' : macdHist < 0 ? 'زخم سلبي (بيع)' : 'محايد';

  return (
    <div className="space-y-4">
      {/* RSI */}
      <div>
        <p className="text-sm font-bold text-foreground mb-2">١. مؤشر القوة النسبية (RSI)</p>
        <FormulaRow
          label="RSI الحالي"
          formula={`${rsi.toFixed(1)}`}
          result={rsiZone}
          highlight={rsi < 30 || rsi > 70}
        />
        <div className="flex gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] border-red-200 text-red-600">≥ 70 تشبع شرائي</Badge>
          <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-600">≤ 30 تشبع بيعي</Badge>
        </div>
        <p className={cn('text-xs mt-1 font-bold', rsiColor)}>← {rsiSignal}</p>
      </div>

      <Separator />

      {/* MA Cross */}
      <div>
        <p className="text-sm font-bold text-foreground mb-2">٢. المتوسطات المتحركة</p>
        <FormulaRow
          label="MA50"
          formula={ma50.toFixed(2)}
        />
        <FormulaRow
          label="MA200"
          formula={ma200.toFixed(2)}
        />
        <FormulaRow
          label="الموقع"
          formula={maPosition}
          result={maCrossSignal}
        />
        <p className={cn('text-xs mt-1 font-bold', maCrossColor)}>← {maCrossSignal}</p>
      </div>

      <Separator />

      {/* MACD */}
      <div>
        <p className="text-sm font-bold text-foreground mb-2">٣. مؤشر MACD</p>
        {macd && (
          <>
            <FormulaRow
              label="MACD Line"
              formula={macdLine.toFixed(4)}
            />
            <FormulaRow
              label="Signal Line"
              formula={macdSignal.toFixed(4)}
            />
            <FormulaRow
              label="Histogram"
              formula={macdHist.toFixed(4)}
              result={macdInterpretation}
              highlight={macdHist > 0}
            />
          </>
        )}
        {macdText && (
          <p className={cn('text-xs mt-1 font-bold', macdHist >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            ← {macdText}
          </p>
        )}
        {!macd && (
          <p className="text-xs text-muted-foreground">بيانات MACD غير متاحة (ينتظر تحميل التحليل المهني)</p>
        )}
      </div>
    </div>
  );
}

// ==================== SECTION 3: SCORE CALCULATIONS ====================

function ScoreCalculationsSection() {
  const { professionalAnalysis } = useAppStore();

  const prof = professionalAnalysis as Record<string, unknown> | null;
  const profData = prof?.analysis as Record<string, unknown> | null;
  const scores = profData?.scores as Record<string, unknown> | null;

  if (!scores) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border">
        <Award className="w-5 h-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          نتائج التحليل المهني غير متاحة بعد. انتظر تحميل البيانات.
        </p>
      </div>
    );
  }

  const technical = Number(scores.technical) || 0;
  const value = Number(scores.value) || 0;
  const quality = Number(scores.quality) || 0;
  const momentum = Number(scores.momentum) || 0;
  const risk = Number(scores.risk) || 0;
  const composite = Number(scores.composite) || 0;

  // Composite calculation: Technical 30% + Value 25% + Quality 25% + Risk-Adj Momentum 10% + Risk-Adj 10%
  const riskAdjMomentum = momentum * ((100 - risk) / 100);
  const riskAdjScore = risk * ((100 - risk) / 100);
  const calculatedComposite = Math.round(
    technical * 0.30 + value * 0.25 + quality * 0.25 + riskAdjMomentum * 0.10 + (100 - riskAdjScore) * 0.10
  );

  return (
    <div className="space-y-4">
      {/* Composite Score */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
        <p className="text-sm font-bold text-foreground mb-2">النتيجة الشاملة (Composite Score)</p>
        <FormulaRow
          label="الصيغة"
          formula="فني×30% + قيمة×25% + جودة×25% + زخم_معدل_مخاطر×10% + (100 - مخاطر_معدلة)×10%"
        />
        <FormulaRow
          label="الحساب"
          formula={`${technical.toFixed(0)}×0.30 + ${value.toFixed(0)}×0.25 + ${quality.toFixed(0)}×0.25 + ${riskAdjMomentum.toFixed(1)}×0.10 + ${(100 - riskAdjScore).toFixed(1)}×0.10`}
          result={`${calculatedComposite}/100`}
          highlight={calculatedComposite >= 60}
        />
      </div>

      <Separator />

      {/* Individual Scores */}
      <div>
        <p className="text-sm font-bold text-foreground mb-2">تفصيل النتائج</p>

        <FormulaRow
          label="النتيجة الفنية"
          formula="RSI + MACD + بولينجر + MA + ستوكاستيك"
          result={`${technical.toFixed(0)}/100`}
          highlight={technical >= 60}
        />

        <FormulaRow
          label="نتيجة القيمة"
          formula="P/E + P/B + توزيعات + EPS"
          result={`${value.toFixed(0)}/100`}
          highlight={value >= 60}
        />

        <FormulaRow
          label="نتيجة الجودة"
          formula="ROE + ديون/حقوق + ثبات الأرباح"
          result={`${quality.toFixed(0)}/100`}
          highlight={quality >= 60}
        />

        <FormulaRow
          label="نتيجة الزخم"
          formula="ROC + MACD + السعر مقابل المتوسطات"
          result={`${momentum.toFixed(0)}/100`}
          highlight={momentum >= 60}
        />

        <FormulaRow
          label="نتيجة المخاطر"
          formula="ATR% + أقصى انخفاض + التقلبات السنوية"
          result={`${risk.toFixed(0)}/100`}
          highlight={risk <= 40}
        />

        <Separator />

        <FormulaRow
          label="زخم معدل المخاطر"
          formula={`${momentum.toFixed(0)} × (100 - ${risk.toFixed(0)}) / 100`}
          result={riskAdjMomentum.toFixed(1)}
        />
      </div>

      <Separator />

      {/* Score Bars */}
      <div className="space-y-2">
        {[
          { label: 'الفني', score: technical, color: 'bg-blue-500' },
          { label: 'القيمة', score: value, color: 'bg-emerald-500' },
          { label: 'الجودة', score: quality, color: 'bg-purple-500' },
          { label: 'الزخم', score: momentum, color: 'bg-amber-500' },
          { label: 'المخاطر', score: risk, color: 'bg-red-500' },
          { label: 'الشامل', score: composite, color: 'bg-primary' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground min-w-[70px]">{item.label}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-700', item.color)}
                style={{ width: `${item.score}%` }}
              />
            </div>
            <span className="text-xs font-bold min-w-[30px] text-left">{item.score.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export function CalculationBreakdown() {
  const { selectedStock } = useAppStore();

  if (!selectedStock) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">تفاصيل الحسابات والمعادلات</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          عرض تفصيلي للمعادلات الرياضية المستخدمة في تحليل السهم {selectedStock.ticker}
        </p>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={['fair-value', 'technical']} className="w-full">
          {/* Section 1: Fair Value */}
          <AccordionItem value="fair-value">
            <AccordionTrigger className="text-sm font-bold">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span>القيمة العادلة (Fair Value)</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <FairValueSection />
            </AccordionContent>
          </AccordionItem>

          {/* Section 2: Technical Calculations */}
          <AccordionItem value="technical">
            <AccordionTrigger className="text-sm font-bold">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <span>الحسابات الفنية</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <TechnicalCalculationsSection />
            </AccordionContent>
          </AccordionItem>

          {/* Section 3: Score Calculations */}
          <AccordionItem value="scores">
            <AccordionTrigger className="text-sm font-bold">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-600" />
                <span>حسابات النتائج</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ScoreCalculationsSection />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

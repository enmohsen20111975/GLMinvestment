/**
 * specialist/PositionSizingCalculator.tsx — §13 Position Sizing (interactive).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1778–1895).
 * Inputs: capital + risk% → Outputs: max shares + per-share risk + actual R:R.
 *
 * Rule 18 floor: R:R ≥ 1.8:1 acceptable; ≥ 2:1 excellent; < 1.8:1 needs review.
 * Uses 1% risk rule (configurable by user, default 1%).
 */
import { useState } from 'react';
import { Calculator, Percent, Wallet } from 'lucide-react';
import { safeNum } from './helpers';
import { SectionCard } from './primitives';

export function PositionSizingCalculator({
  entryPrice,
  stopLoss,
  targetPrice,
  rrRatio,
}: {
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  rrRatio: number | null;
}) {
  const [capital, setCapital] = useState<string>('10000');
  const [riskPct, setRiskPct] = useState<string>('1');

  const capitalNum = safeNum(capital);
  const riskPctNum = safeNum(riskPct);

  const riskAmount = capitalNum != null && riskPctNum != null ? (capitalNum * riskPctNum) / 100 : null;
  const perShareRisk =
    entryPrice != null && stopLoss != null && entryPrice > stopLoss ? entryPrice - stopLoss : null;
  const maxShares =
    riskAmount != null && perShareRisk != null && perShareRisk > 0
      ? Math.floor(riskAmount / perShareRisk)
      : null;
  const maxSharesValue = maxShares != null && entryPrice != null ? maxShares * entryPrice : null;

  return (
    <SectionCard
      icon={<Calculator className="w-4 h-4" />}
      title="حاسبة حجم الصفقة (Position Sizing)"
      description="قاعدة 1% مخاطرة — المدخلات: رأس المال + نسبة المخاطرة. المخرجات: أقصى عدد أسهم + R:R المحسوب"
      accent="amber"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">رأس المال (جنيه)</label>
            <div className="relative">
              <Wallet className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="w-full pr-9 pl-3 py-2 border border-border rounded-lg bg-background text-sm"
                placeholder="10000"
                min="0"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">نسبة المخاطرة (%) — افتراضي 1%</label>
            <div className="relative">
              <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="number"
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
                className="w-full pr-9 pl-3 py-2 border border-border rounded-lg bg-background text-sm"
                placeholder="1"
                min="0"
                max="100"
                step="0.5"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            الحد الموصى به للمخاطرة: 1-3% من رأس المال لكل صفقة (قاعدة 1%)
          </p>
        </div>

        <div className="space-y-2">
          <div className="p-3 bg-profit/10 rounded-lg">
            <p className="text-xs text-muted-foreground">المبلغ المخاطر به</p>
            <p className="text-xl font-bold text-profit mt-1">
              {riskAmount != null ? `${riskAmount.toFixed(2)} جنيه` : '—'}
            </p>
          </div>
          <div className="p-3 bg-warning/10 rounded-lg">
            <p className="text-xs text-muted-foreground">المخاطرة لكل سهم (دخول − وقف)</p>
            <p className="text-xl font-bold text-warning mt-1">
              {perShareRisk != null ? `${perShareRisk.toFixed(2)} جنيه` : '—'}
            </p>
          </div>
          <div className="p-3 bg-slate-50/60 rounded-lg">
            <p className="text-xs text-muted-foreground">أقصى عدد أسهم</p>
            <p className="text-2xl font-bold text-muted-foreground dark:text-slate-200 mt-1">
              {maxShares != null ? maxShares.toLocaleString('en-US') : '—'}
            </p>
            {maxSharesValue != null && (
              <p className="text-xs text-muted-foreground mt-1">
                قيمة الصفقة: {maxSharesValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} جنيه
              </p>
            )}
          </div>
          <div className="p-3 bg-profit/10 rounded-lg">
            <p className="text-xs text-muted-foreground">نسبة المخاطرة/العائد الفعلية</p>
            <p className="text-lg font-bold text-profit mt-1">
              {rrRatio != null ? `${rrRatio.toFixed(2)}:1` : '—'}
            </p>
            {rrRatio != null && (
              <p className="text-xs text-muted-foreground mt-1">
                {rrRatio >= 2
                  ? '✓ ممتازة — R:R ≥ 2:1 (قاعدة 18)'
                  : rrRatio >= 1.8
                  ? '✓ مقبولة — R:R ≥ 1.8:1 (Floor قاعدة 18)'
                  : '⚠ أقل من Floor 1.8:1 — راجع القاعدة 18'}
              </p>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

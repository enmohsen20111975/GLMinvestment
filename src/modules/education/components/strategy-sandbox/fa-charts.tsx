import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Fundamental Analysis bar charts: P/E, P/B, Dividend Yield, Graham.
 * ============================================================ */

export interface BarChartFARow {
  label: string;
  bars: { name: string; value: number; color: string }[];
  note?: string;
}

export function BarChartFA({
  data,
  unitLabel,
}: {
  data: BarChartFARow[];
  unitLabel: string;
}) {
  const allVals = data.flatMap((d) => d.bars.map((b) => b.value));
  const maxV = Math.max(...allVals) * 1.15;
  // suppress unused warning for maxV (kept for future scaling hooks)
  void maxV;
  return (
    <div className="space-y-4">
      {data.map((row, ri) => {
        const groupMax = Math.max(...row.bars.map((b) => b.value)) * 1.1;
        return (
          <motion.div
            key={ri}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 * ri, duration: 0.5 }}
            className="space-y-1.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">{row.label}</span>
              {row.note && <Badge variant="secondary" className="text-xs">{row.note}</Badge>}
            </div>
            <div className="flex items-end gap-2 h-32 border-b border-border/60 pb-1">
              {row.bars.map((b, bi) => (
                <div key={bi} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(b.value / groupMax) * 100}%` }}
                    transition={{ delay: 0.2 + ri * 0.15 + bi * 0.08, duration: 0.6, ease: 'easeOut' }}
                    className="w-full rounded-t-md flex items-start justify-center pt-1"
                    style={{ backgroundColor: b.color, minHeight: 4 }}
                  >
                    <span className="text-xs font-bold text-white">
                      {b.value.toFixed(b.value < 10 ? 2 : 0)}
                    </span>
                  </motion.div>
                  <span className="text-xs text-muted-foreground">{b.name}</span>
                </div>
              ))}
            </div>
          </motion.div>
        );
      })}
      <div className="text-xs text-muted-foreground text-center">{`القيم بـ ${unitLabel}`}</div>
    </div>
  );
}

export function PERatioChart() {
  return (
    <BarChartFA
      unitLabel="ج.م"
      data={[
        {
          label: 'البنك التجاري الدولي (CIB)',
          bars: [
            { name: 'السعر', value: 60, color: '#3b82f6' },
            { name: 'EPS', value: 10, color: '#10b981' },
          ],
          note: 'P/E = 6',
        },
        {
          label: 'أوراسكوم للتنمية (ORHD)',
          bars: [
            { name: 'السعر', value: 30, color: '#3b82f6' },
            { name: 'EPS', value: 1, color: '#10b981' },
          ],
          note: 'P/E = 30',
        },
        {
          label: 'اتصالات مصر (ETEL)',
          bars: [
            { name: 'السعر', value: 18, color: '#3b82f6' },
            { name: 'EPS', value: 1.2, color: '#10b981' },
          ],
          note: 'P/E = 15',
        },
      ]}
    />
  );
}

export function PBRatioChart() {
  return (
    <BarChartFA
      unitLabel="ج.م"
      data={[
        {
          label: 'سهم يتداول تحت القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 8, color: '#ef4444' },
            { name: 'القيمة الدفترية', value: 12, color: '#10b981' },
          ],
          note: 'P/B = 0.67 (رخيص)',
        },
        {
          label: 'سهم عند القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 15, color: '#f59e0b' },
            { name: 'القيمة الدفترية', value: 15, color: '#10b981' },
          ],
          note: 'P/B = 1.0 (عادل)',
        },
        {
          label: 'سهم فوق القيمة الدفترية',
          bars: [
            { name: 'السعر السوقي', value: 45, color: '#3b82f6' },
            { name: 'القيمة الدفترية', value: 15, color: '#10b981' },
          ],
          note: 'P/B = 3.0 (مكلف)',
        },
      ]}
    />
  );
}

export function DividendYieldChart() {
  return (
    <BarChartFA
      unitLabel="ج.م / نسبة"
      data={[
        {
          label: 'سهم سعر 50 ج.م يوزّع 2.5 ج.م',
          bars: [
            { name: 'السعر', value: 50, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 2.5, color: '#10b981' },
          ],
          note: 'Yield = 5%',
        },
        {
          label: 'سهم سعر 100 ج.م يوزّع 3 ج.م',
          bars: [
            { name: 'السعر', value: 100, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 3, color: '#10b981' },
          ],
          note: 'Yield = 3%',
        },
        {
          label: 'سهم سعر 20 ج.م يوزّع 0.4 ج.م',
          bars: [
            { name: 'السعر', value: 20, color: '#3b82f6' },
            { name: 'التوزيع السنوي', value: 0.4, color: '#10b981' },
          ],
          note: 'Yield = 2%',
        },
      ]}
    />
  );
}

export function GrahamNumberChart() {
  // Graham = √(22.5 × EPS × BV)
  const calc = (eps: number, bv: number) => Math.sqrt(22.5 * eps * bv);
  const cases = [
    { label: 'سهم رخيص', eps: 5, bv: 40, price: 45 },
    { label: 'سهم عادل', eps: 4, bv: 30, price: 33 },
    { label: 'سهم مكلف', eps: 3, bv: 20, price: 50 },
  ];
  const data = cases.map((c) => ({
    label: c.label,
    bars: [
      { name: 'السعر السوقي', value: c.price, color: '#3b82f6' },
      { name: 'Graham Number', value: calc(c.eps, c.bv), color: '#10b981' },
    ],
    note: `EPS=${c.eps} | BV=${c.bv}`,
  }));
  return (
    <div className="space-y-4">
      <BarChartFA unitLabel="ج.م" data={data} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="rounded-lg border border-profit/20 bg-profit/5 p-3 text-center"
      >
        <div className="text-sm font-bold text-profit mb-1">
          معادلة Graham
        </div>
        <div dir="ltr" className="font-mono text-base">
          Graham = √(22.5 × EPS × Book Value)
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          22.5 = (P/E=15) × (P/B=1.5) — معايير غراهام للسهم الآمن
        </div>
      </motion.div>
    </div>
  );
}

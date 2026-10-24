import { motion } from 'framer-motion';
import { Target, BookOpen, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { CATEGORIES } from './data';
import type { StrategyTopic } from './types';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * ExplanationPanel — the textual explanation + how-to-trade +
 * real-world examples for the currently selected topic.
 * ============================================================ */

export function ExplanationPanel({ topic }: { topic: StrategyTopic }) {
  const Icon = topic.icon;
  const cat = CATEGORIES.find((c) => c.id === topic.category)!;
  const CatIcon = cat.icon;
  return (
    <motion.div
      key={topic.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-4"
    >
      {/* title */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-1">
          <Icon className={cn('size-6', cat.accent)} />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{topic.nameAr}</h3>
            <Badge variant="outline" className="text-xs" dir="ltr">{topic.nameEn}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{topic.summary}</p>
          <div className="flex items-center gap-1.5 mt-2">
            <CatIcon className={cn('size-3.5', cat.accent)} />
            <span className="text-xs text-muted-foreground">{cat.nameAr}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* explanation bullets */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="size-4 text-primary" />
          <h4 className="font-semibold text-sm">الشرح التفصيلي</h4>
        </div>
        <ul className="space-y-1.5">
          {topic.explanation.map((point, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.4 }}
              className="flex gap-2 text-sm leading-relaxed"
            >
              <span className="text-primary mt-0.5">•</span>
              <span className="text-foreground/90">{point}</span>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* how to trade */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="size-4 text-primary" />
          <h4 className="font-semibold text-sm">كيف تتداوله</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs font-semibold text-profit mb-0.5">✓ نقطة الدخول</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.entry}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-loss mb-0.5">✗ وقف الخسارة</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.stopLoss}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-sky-600 mb-0.5">◎ الهدف</div>
            <div className="text-xs text-foreground/90 leading-relaxed">{topic.howToTrade.target}</div>
          </div>
        </div>
      </div>

      {/* examples */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="size-4 text-warning" />
          <h4 className="font-semibold text-sm">أمثلة حقيقية</h4>
        </div>
        <div className="space-y-1.5">
          {topic.examples.map((ex, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="flex gap-2 text-xs leading-relaxed text-foreground/80 p-2 rounded-md bg-muted/40 border border-border/40"
            >
              <Badge variant="secondary" className="text-xs shrink-0 h-4 px-1.5">مثال</Badge>
              <span>{ex}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

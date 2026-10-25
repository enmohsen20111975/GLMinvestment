'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  BarChart3,
  Layers,
  BookOpen,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { TOPICS, CATEGORIES, FLAT_TOPIC_IDS } from './data';
import { StrategyChart } from './StrategyChart';
import { ExplanationPanel } from './ExplanationPanel';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Container component — wires sidebar/accordion/chart + explanation.
 * All chart primitives live in their own modules; this file stays
 * under 300 LOC on purpose (Rule 75 / Phase-3 split).
 * ============================================================ */

export function StrategySandbox() {
  const [selectedId, setSelectedId] = React.useState<string>('fvg');
  const [mobileCategory, setMobileCategory] = React.useState<'smc' | 'ta' | 'fa'>('smc');

  const selectedTopic = TOPICS.find((t) => t.id === selectedId) ?? TOPICS[0];
  const selectedCat = CATEGORIES.find((c) => c.id === selectedTopic.category)!;

  const goPrev = React.useCallback(() => {
    const idx = FLAT_TOPIC_IDS.indexOf(selectedId);
    const newIdx = (idx - 1 + FLAT_TOPIC_IDS.length) % FLAT_TOPIC_IDS.length;
    setSelectedId(FLAT_TOPIC_IDS[newIdx]);
  }, [selectedId]);

  const goNext = React.useCallback(() => {
    const idx = FLAT_TOPIC_IDS.indexOf(selectedId);
    const newIdx = (idx + 1) % FLAT_TOPIC_IDS.length;
    setSelectedId(FLAT_TOPIC_IDS[newIdx]);
  }, [selectedId]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const t = TOPICS.find((x) => x.id === id);
    if (t) setMobileCategory(t.category);
  };

  return (
    <div dir="rtl" className="w-full space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap py-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
                <Layers className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold leading-tight">مختبر الاستراتيجيات</h2>
                <p className="text-xs text-muted-foreground" dir="ltr">Strategy Chart Sandbox</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {FLAT_TOPIC_IDS.indexOf(selectedId) + 1} / {FLAT_TOPIC_IDS.length}
              </Badge>
              <Button variant="outline" size="sm" onClick={goPrev} className="gap-1">
                <ChevronRight className="size-4" />
                السابق
              </Button>
              <Button variant="outline" size="sm" onClick={goNext} className="gap-1">
                التالي
                <ChevronLeft className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile category tabs */}
      <div className="lg:hidden">
        <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border/60 overflow-x-auto">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = mobileCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setMobileCategory(cat.id)}
                className={cn(
                  'flex-1 min-w-[100px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-background text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('size-3.5', isActive && cat.accent)} />
                {cat.nameAr}
              </button>
            );
          })}
        </div>
        {/* mobile topic chips */}
        <ScrollArea className="w-full whitespace-nowrap rounded-md mt-2">
          <div className="flex gap-1.5 p-1">
            {CATEGORIES.find((c) => c.id === mobileCategory)?.topics.map((t) => {
              const Icon = t.icon;
              const isActive = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.nameAr}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Sidebar — desktop only */}
        <Card className="hidden lg:block h-fit sticky top-4">
          <CardContent className="pt-0">
            <Accordion
              type="single"
              defaultValue={selectedCat.id}
              className="w-full"
            >
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <AccordionItem key={cat.id} value={cat.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('size-4', cat.accent)} />
                        <div className="text-right">
                          <div className="text-sm font-semibold">{cat.nameAr}</div>
                          <div className="text-xs text-muted-foreground" dir="ltr">{cat.nameEn}</div>
                        </div>
                        <Badge variant="secondary" className="text-xs ml-1">{cat.topics.length}</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-1 pt-1">
                        {cat.topics.map((t) => {
                          const TIcon = t.icon;
                          const isActive = selectedId === t.id;
                          return (
                            <button
                              key={t.id}
                              onClick={() => handleSelect(t.id)}
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-md text-right text-sm transition-all border',
                                isActive
                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                  : 'bg-transparent hover:bg-accent border-transparent',
                              )}
                            >
                              <TIcon className="size-4 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{t.nameAr}</div>
                                <div className={cn(
                                  'text-xs truncate',
                                  isActive ? 'text-primary-foreground/70' : 'text-muted-foreground',
                                )} dir="ltr">{t.nameEn}</div>
                              </div>
                              {isActive && <ChevronLeft className="size-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>

        {/* Main content */}
        <Card>
          <CardContent className="pt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35 }}
                className="space-y-4 py-2"
              >
                {/* Chart area */}
                <div className="rounded-xl border border-border/60 to-transparent p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="size-4 text-primary" />
                      <span className="text-sm font-semibold">الشارت التوضيحي</span>
                    </div>
                    <Badge variant="outline" className="text-xs" dir="ltr">
                      {selectedTopic.pattern}
                    </Badge>
                  </div>
                  <StrategyChart topicId={selectedId} />
                </div>

                {/* Explanation */}
                <ExplanationPanel topic={selectedTopic} />
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>

      {/* Footer hint */}
      <div className="text-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="size-3" />
          محتوى تعليمي لأغراض التعلّم فقط — ليس توقع استثمارية. تداول بمسؤوليتك الكاملة.
        </span>
      </div>
    </div>
  );
}

export default StrategySandbox;

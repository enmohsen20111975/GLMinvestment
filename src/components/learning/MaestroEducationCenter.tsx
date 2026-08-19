'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Clock, CheckCircle2, Share2, ChevronLeft,
  Copy, Award, TrendingUp, Hash, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { maestroLessons } from '@/data/learning-content';
import type { MaestroLesson } from '@/data/learning-content';

/* ============================================================
   CONSTANTS
   ============================================================ */

const STORAGE_KEY = 'maestro-completed-lessons';

function getCompletedFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCompletedToStorage(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

/* ============================================================
   MARKDOWN-LIKE RENDERER
   ============================================================ */

function renderContent(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    elements.push(
      <div key={`table-${elements.length}`} className="overflow-x-auto my-4 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              {tableRows[0].map((cell, i) => (
                <th key={i} className="px-3 py-2 text-right font-semibold border-b border-border whitespace-nowrap">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.slice(1).map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 border-b border-border/50 whitespace-nowrap">
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  };

  const flushCode = () => {
    elements.push(
      <pre key={`code-${elements.length}`} className="bg-zinc-900 text-zinc-100 rounded-lg p-4 my-3 overflow-x-auto text-sm font-mono leading-relaxed" dir="ltr">
        {codeLines.join('\n')}
      </pre>
    );
    codeLines = [];
    inCodeBlock = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        if (inTable) flushTable();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true;
      const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim());
      // Skip separator rows like |---|---|
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('> ')) {
      const content = line.trim().slice(2);
      elements.push(
        <blockquote key={`bq-${i}`} className="border-r-4 border-amber-500/60 pr-4 py-1 my-2 bg-amber-500/5 rounded-l-lg italic text-muted-foreground">
          {renderInline(content)}
        </blockquote>
      );
      continue;
    }

    // H3
    if (line.trim().startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-base font-bold mt-4 mb-2 text-foreground">
          {renderInline(line.trim().slice(4))}
        </h3>
      );
      continue;
    }

    // H2
    if (line.trim().startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-lg font-bold mt-5 mb-2 text-foreground">
          {renderInline(line.trim().slice(3))}
        </h2>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line.trim())) {
      const content = line.trim().replace(/^\d+\.\s/, '');
      elements.push(
        <div key={`ol-${i}`} className="flex gap-2 my-1 mr-2">
          <span className="text-primary font-bold min-w-[1.2em]">{line.trim().match(/^\d+/)?.[0]}.</span>
          <span>{renderInline(content)}</span>
        </div>
      );
      continue;
    }

    // Bullet list
    if (line.trim().startsWith('- ')) {
      elements.push(
        <div key={`ul-${i}`} className="flex gap-2 my-1 mr-2">
          <span className="text-primary mt-1.5">•</span>
          <span>{renderInline(line.trim().slice(2))}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} className="my-1 leading-relaxed">
        {renderInline(line)}
      </p>
    );
  }

  // Flush remaining
  if (inCodeBlock) flushCode();
  if (inTable) flushTable();

  return elements;
}

function renderInline(text: string): React.ReactNode {
  // Process bold **text**
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={`b-${match.index}`} className="font-bold text-foreground">{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

/* ============================================================
   DIFFICULTY BADGE COLOR
   ============================================================ */

function getDifficultyStyle(diff: string) {
  switch (diff) {
    case 'مبتدئ':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 'مبتدئ-متوسط':
      return 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30';
    case 'متوسط':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    case 'كل المستويات':
      return 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export function MaestroEducationCenter() {
  const [selectedLesson, setSelectedLesson] = useState<MaestroLesson | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [isMobileList, setIsMobileList] = useState(true);

  useEffect(() => {
    setCompleted(getCompletedFromStorage());
  }, []);

  const completedCount = completed.length;
  const totalCount = maestroLessons.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const toggleComplete = useCallback((lessonId: string) => {
    setCompleted(prev => {
      const next = prev.includes(lessonId)
        ? prev.filter(id => id !== lessonId)
        : [...prev, lessonId];
      saveCompletedToStorage(next);
      return next;
    });
  }, []);

  const handleShareCard = useCallback((lesson: MaestroLesson) => {
    const text = `${lesson.card}\n\n${lesson.hashtag}\n📚 ${lesson.source}\n\n📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈\n🔗 روابطنا الرسمية:\n🌐 https://invist.m2y.net\n📱 https://play.google.com/store/apps/details?id=com.egx.investment\n📘 https://www.facebook.com/profile.php?id=61590600300048\n✈️ https://t.me/Arabian_investment_guide`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success('تم نسخ البطاقة التعليمية!', { duration: 2000 });
    }).catch(() => {
      toast.error('فشل النسخ', { duration: 2000 });
    });
  }, []);

  const handleBack = useCallback(() => {
    setSelectedLesson(null);
    setIsMobileList(true);
  }, []);

  const handleSelectLesson = useCallback((lesson: MaestroLesson) => {
    setSelectedLesson(lesson);
    setIsMobileList(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Progress Bar ────────────────────────────────────── */}
      <Card className="border-border/50 bg-gradient-to-l from-primary/5 via-background to-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-primary" />
              <span className="font-bold text-sm">تقدمك في مكتبة Maestro</span>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {completedCount}/{totalCount} دروس
            </Badge>
          </div>
          <Progress value={progressPct} className="h-2.5" />
          <p className="text-xs text-muted-foreground mt-1.5">
            {completedCount === 0
              ? 'ابدأ رحلتك التعليمية الآن! 🚀'
              : completedCount === totalCount
                ? '🎉 مبروك! أكملت كل الدروس!'
                : `أكمل ${totalCount - completedCount} دروس أخرى للحصول على الشارة`}
          </p>
        </CardContent>
      </Card>

      {/* ── Main Layout ─────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* ── Lesson List (Sidebar) ────────────────────────── */}
        <div className={cn(
          'lg:w-[340px] lg:min-w-[340px] lg:flex-shrink-0',
          isMobileList ? 'block' : 'hidden lg:block'
        )}>
          <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1 custom-scrollbar">
            {maestroLessons.map((lesson, index) => {
              const isCompleted = completed.includes(lesson.id);
              const isActive = selectedLesson?.id === lesson.id;

              return (
                <motion.div
                  key={lesson.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                >
                  <Card
                    className={cn(
                      'cursor-pointer transition-all duration-200 hover:shadow-md border',
                      isActive
                        ? 'border-primary shadow-lg ring-1 ring-primary/20'
                        : 'border-border/50 hover:border-primary/30',
                      isCompleted && !isActive && 'border-emerald-500/30 bg-emerald-500/5'
                    )}
                    onClick={() => handleSelectLesson(lesson)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className={cn(
                          'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 bg-gradient-to-br shadow-sm',
                          lesson.color
                        )}>
                          {lesson.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-bold text-sm truncate">{lesson.title}</h3>
                            {isCompleted && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mb-1.5">{lesson.subtitle}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', getDifficultyStyle(lesson.difficulty))}>
                              {lesson.difficulty}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> {lesson.readTime}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* ── Lesson Content ──────────────────────────────── */}
        <div className={cn(
          'flex-1 min-w-0',
          !isMobileList ? 'block' : 'hidden lg:block'
        )}>
          {!selectedLesson ? (
            /* Empty State */
            <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed border-2 border-border/50">
              <CardContent className="text-center p-8">
                <div className="text-6xl mb-4">📚</div>
                <h3 className="text-xl font-bold mb-2">مكتبة Maestro التعليمية</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  اختر درساً من القائمة لتبدأ رحلتك التعليمية. 8 دروس من أقوى كتب التداول في العالم.
                </p>
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> 8 دروس</span>
                  <span className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> كل المستويات</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Lesson Detail */
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedLesson.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <Card className="border-border/50">
                  <CardContent className="p-0">
                    {/* Header */}
                    <div className={cn(
                      'bg-gradient-to-l p-5 rounded-t-xl',
                      selectedLesson.color
                    )}>
                      {/* Mobile back button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="lg:hidden mb-2 text-white/80 hover:text-white hover:bg-white/10 -mr-2"
                        onClick={handleBack}
                      >
                        <ChevronLeft className="w-4 h-4 ml-1" />
                        رجوع
                      </Button>

                      <div className="flex items-start gap-3">
                        <span className="text-4xl">{selectedLesson.icon}</span>
                        <div className="flex-1">
                          <h2 className="text-xl font-bold text-white mb-1">{selectedLesson.title}</h2>
                          <p className="text-white/80 text-sm mb-3">{selectedLesson.subtitle}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className="bg-white/20 text-white border-white/30 text-xs">
                              {selectedLesson.difficulty}
                            </Badge>
                            <span className="text-white/70 text-xs flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {selectedLesson.readTime}
                            </span>
                            <span className="text-white/70 text-xs flex items-center gap-1">
                              <Hash className="w-3 h-3" /> {selectedLesson.hashtag}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Educational Card */}
                      <div className="mt-4 bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                        <p className="text-white text-sm font-bold">{selectedLesson.card}</p>
                        <p className="text-white/60 text-[10px] mt-1">📚 {selectedLesson.source}</p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50 bg-muted/30">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => handleShareCard(selectedLesson)}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        مشاركة البطاقة
                      </Button>
                      <Button
                        variant={completed.includes(selectedLesson.id) ? 'default' : 'outline'}
                        size="sm"
                        className={cn(
                          'gap-1.5 text-xs',
                          completed.includes(selectedLesson.id)
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : ''
                        )}
                        onClick={() => toggleComplete(selectedLesson.id)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {completed.includes(selectedLesson.id) ? 'مكتمل ✓' : 'تحديد كمكتمل'}
                      </Button>
                      <div className="flex-1" />
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />
                        {selectedLesson.source}
                      </span>
                    </div>

                    {/* Sections */}
                    <div className="px-5 py-4 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {selectedLesson.sections.map((section, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.1, duration: 0.3 }}
                        >
                          <h3 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
                            {section.heading}
                          </h3>
                          <div className="text-sm text-muted-foreground leading-relaxed">
                            {renderContent(section.content)}
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Bottom Actions */}
                    <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={handleBack}
                      >
                        <ChevronLeft className="w-4 h-4 ml-1" />
                        العودة للقائمة
                      </Button>

                      {/* Navigation between lessons */}
                      <div className="flex items-center gap-2">
                        {maestroLessons.indexOf(selectedLesson) > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const prevIdx = maestroLessons.indexOf(selectedLesson) - 1;
                              handleSelectLesson(maestroLessons[prevIdx]);
                            }}
                          >
                            ← السابق
                          </Button>
                        )}
                        {maestroLessons.indexOf(selectedLesson) < maestroLessons.length - 1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const nextIdx = maestroLessons.indexOf(selectedLesson) + 1;
                              handleSelectLesson(maestroLessons[nextIdx]);
                            }}
                          >
                            التالي →
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Custom scrollbar styles */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: hsl(var(--border));
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground));
        }
      `}</style>
    </div>
  );
}

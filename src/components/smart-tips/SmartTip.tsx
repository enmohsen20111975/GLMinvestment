'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, RefreshCw, Shield, TrendingUp, BarChart3, Brain, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface SmartTipData {
  id: number;
  content: string;
  category: string;
  author: string | null;
}

interface SmartTipProps {
  /** Event trigger for contextual tips (e.g., 'dashboard_view', 'stock_detail') */
  trigger?: string;
  /** Force a specific category */
  category?: string;
  /** Auto-refresh interval in seconds (0 = no auto-refresh) */
  refreshInterval?: number;
  /** Show the category icon and label */
  showCategory?: boolean;
  /** Compact mode for embedding in tight spaces */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ==================== CATEGORY CONFIG ====================

const CATEGORY_CONFIG: Record<string, {
  label: string;
  labelEn: string;
  icon: React.ElementType;
  gradient: string;
  border: string;
  bg: string;
  text: string;
  iconBg: string;
  badge: string;
}> = {
  patience: {
    label: 'الصبر والاستثمار',
    labelEn: 'Patience',
    icon: Heart,
    gradient: 'from-emerald-50 to-teal-50',
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/80',
    text: 'text-emerald-900',
    iconBg: 'bg-emerald-100',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  risk: {
    label: 'تجنب المخاطر',
    labelEn: 'Risk',
    icon: Shield,
    gradient: 'from-red-50 to-orange-50',
    border: 'border-red-200',
    bg: 'bg-red-50/80',
    text: 'text-red-900',
    iconBg: 'bg-red-100',
    badge: 'bg-red-100 text-red-700',
  },
  analysis: {
    label: 'التحليل والقرار',
    labelEn: 'Analysis',
    icon: BarChart3,
    gradient: 'from-blue-50 to-indigo-50',
    border: 'border-blue-200',
    bg: 'bg-blue-50/80',
    text: 'text-blue-900',
    iconBg: 'bg-blue-100',
    badge: 'bg-blue-100 text-blue-700',
  },
  egx: {
    label: 'البورصة المصرية',
    labelEn: 'EGX',
    icon: TrendingUp,
    gradient: 'from-amber-50 to-yellow-50',
    border: 'border-amber-200',
    bg: 'bg-amber-50/80',
    text: 'text-amber-900',
    iconBg: 'bg-amber-100',
    badge: 'bg-amber-100 text-amber-700',
  },
  psychology: {
    label: 'نفسية المستثمر',
    labelEn: 'Psychology',
    icon: Brain,
    gradient: 'from-purple-50 to-pink-50',
    border: 'border-purple-200',
    bg: 'bg-purple-50/80',
    text: 'text-purple-900',
    iconBg: 'bg-purple-100',
    badge: 'bg-purple-100 text-purple-700',
  },
  general: {
    label: 'نصيحة عامة',
    labelEn: 'General',
    icon: Lightbulb,
    gradient: 'from-amber-50 to-orange-50',
    border: 'border-amber-200',
    bg: 'bg-amber-50/80',
    text: 'text-amber-900',
    iconBg: 'bg-amber-100',
    badge: 'bg-amber-100 text-amber-700',
  },
};

// ==================== COMPONENT ====================

export function SmartTip({
  trigger,
  category,
  refreshInterval = 0,
  showCategory = true,
  compact = false,
  className,
}: SmartTipProps) {
  const [tip, setTip] = useState<SmartTipData | null>(null);
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTip = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (trigger) params.set('trigger', trigger);
      if (category) params.set('category', category);

      const res = await fetch(`/api/tips/random?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (data.success && data.tip) {
        setTip(data.tip);
        setVisible(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [trigger, category]);

  // Initial fetch
  useEffect(() => {
    fetchTip();
  }, [fetchTip]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval > 0) {
      const timer = setInterval(fetchTip, refreshInterval * 1000);
      return () => clearInterval(timer);
    }
  }, [refreshInterval, fetchTip]);

  const config = useMemo(
    () => CATEGORY_CONFIG[tip?.category || 'general'] || CATEGORY_CONFIG.general,
    [tip?.category]
  );

  const IconComponent = config.icon;

  if (!visible && !compact) return null;

  // Compact mode: inline text without card
  if (compact && tip && !loading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm', config.text, className)}>
        <IconComponent size={14} className="shrink-0 opacity-70" />
        <span className="leading-relaxed">{tip.content}</span>
      </div>
    );
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className={cn(
        'relative overflow-hidden rounded-xl border border-border/50 p-4',
        compact ? 'p-3' : 'p-5',
        className
      )}>
        <div className="flex items-start gap-3">
          <div className="bg-muted rounded-lg p-2 shrink-0">
            <div className="h-5 w-5 bg-muted-foreground/20 rounded animate-pulse" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            <div className="h-4 w-full bg-muted rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Error state: don't render
  if (error || !tip) return null;

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div
          key={tip.id}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 100, scale: 0.95 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className={cn(
            'relative overflow-hidden rounded-xl border',
            config.border,
            config.bg,
            compact ? 'p-3' : 'p-4 sm:p-5',
            'group',
            className
          )}
        >
          {/* Decorative circles */}
          <div className="absolute -top-6 -left-6 w-24 h-24 bg-white/30 rounded-full" />
          <div className="absolute -bottom-4 -right-4 w-16 h-16 bg-white/20 rounded-full" />

          <div className="relative flex items-start gap-3">
            {/* Icon */}
            <div className={cn('rounded-lg p-2 shrink-0', config.iconBg)}>
              <IconComponent
                size={compact ? 18 : 22}
                className={cn(
                  config.text.replace('text-', 'text-').replace('900', '600'),
                  'transition-transform duration-300 group-hover:scale-110'
                )}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Category badge */}
              {showCategory && (
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    config.badge
                  )}>
                    <span>💡</span>
                    {config.label}
                  </span>
                  {tip.author && (
                    <span className="text-xs opacity-50">
                      — {tip.author}
                    </span>
                  )}
                </div>
              )}

              {/* Tip text */}
              <p className={cn(
                'leading-relaxed',
                compact ? 'text-sm' : 'text-sm sm:text-base font-medium',
                config.text
              )}>
                {tip.content}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fetchTip();
                }}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  'hover:bg-white/60',
                  config.text
                )}
                title="نصيحة أخرى"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVisible(false);
                }}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  'hover:bg-white/60',
                  'text-gray-400 hover:text-gray-600'
                )}
                title="إغلاق"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ==================== TIP OF THE DAY ====================

/**
 * A larger, more prominent version for the dashboard hero section.
 */
export function TipOfTheDay({ className }: { className?: string }) {
  const [tip, setTip] = useState<SmartTipData | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    fetch('/api/tips/random?trigger=dashboard_view')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.tip) setTip(data.tip);
      })
      .catch(() => {});
  }, []);

  if (!visible || !tip) return null;

  const config = CATEGORY_CONFIG[tip.category || 'general'] || CATEGORY_CONFIG.general;
  const IconComponent = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className={cn(
        'relative overflow-hidden rounded-2xl border',
        config.border,
        'bg-gradient-to-l',
        config.gradient,
        'p-5 sm:p-6',
        className
      )}
    >
      {/* Large decorative blob */}
      <div className="absolute -top-10 -left-10 w-32 h-32 bg-white/20 rounded-full blur-sm" />
      <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-white/15 rounded-full blur-sm" />

      <div className="relative flex items-start gap-4">
        <div className={cn('rounded-xl p-3 shrink-0 shadow-sm', config.iconBg)}>
          <IconComponent size={28} className={config.text.replace('text-', 'text-').replace('900', '600')} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className={cn('text-sm font-bold', config.text)}>
                💡 نصيحة اليوم
              </h3>
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', config.badge)}>
                {config.label}
              </span>
            </div>
            <button
              onClick={() => setVisible(false)}
              className="p-1.5 rounded-lg hover:bg-white/60 transition-colors text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>

          <p className={cn('text-base sm:text-lg leading-relaxed font-medium', config.text)}>
            {tip.content}
          </p>

          {tip.author && (
            <p className="text-xs opacity-40 mt-2">
              — {tip.author}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== ALL TIPS VIEW (for Learning section) ====================

export function AllTipsView() {
  const [tips, setTips] = useState<Record<string, SmartTipData[]>>({});
  const [activeTab, setActiveTab] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAllTips() {
      try {
        // Get categories
        const catRes = await fetch('/api/tips/random?action=categories');
        const catData = await catRes.json();

        if (!catData.success) return;

        // Fetch tips for each category
        const allTips: Record<string, SmartTipData[]> = {};
        for (const cat of catData.categories) {
          const res = await fetch(`/api/tips/random?action=all&category=${cat.category}`);
          const data = await res.json();
          if (data.success) {
            allTips[cat.category] = data.tips;
          }
        }
        setTips(allTips);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadAllTips();
  }, []);

  const categoryList = Object.keys(CATEGORY_CONFIG);

  const displayedTips = useMemo(() => {
    if (activeTab === 'all') {
      return categoryList.flatMap(cat => (tips[cat] || []).map(t => ({ ...t, _category: cat })));
    }
    return (tips[activeTab] || []).map(t => ({ ...t, _category: activeTab }));
  }, [activeTab, tips, categoryList]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('all')}
          className={cn(
            'px-4 py-2 rounded-full text-sm font-medium transition-all',
            activeTab === 'all'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
          )}
        >
          الكل ({displayedTips.length})
        </button>
        {categoryList.map(cat => {
          const cfg = CATEGORY_CONFIG[cat];
          const count = tips[cat]?.length || 0;
          if (count === 0) return null;
          return (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5',
                activeTab === cat
                  ? cn(cfg.badge, 'shadow-sm')
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              )}
            >
              <cfg.icon size={14} />
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Tips grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        <AnimatePresence>
          {displayedTips.map((tip, idx) => {
            const cfg = CATEGORY_CONFIG[tip._category || tip.category || 'general'];
            const Icon = cfg.icon;
            return (
              <motion.div
                key={tip.id + '-' + tip._category}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
                className={cn(
                  'relative overflow-hidden rounded-xl border p-4',
                  cfg.border,
                  cfg.bg,
                  'group hover:shadow-sm transition-shadow'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn('rounded-lg p-1.5 shrink-0', cfg.iconBg)}>
                    <Icon size={16} className={cfg.text.replace('text-', 'text-').replace('900', '600')} />
                  </div>
                  <div className="flex-1">
                    <p className={cn('text-sm leading-relaxed font-medium', cfg.text)}>
                      {tip.content}
                    </p>
                    {tip.author && (
                      <p className="text-xs opacity-40 mt-1">— {tip.author}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {displayedTips.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد نصائح في هذه الفئة</p>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileJson,
  Database,
  BarChart3,
  TrendingUp,
  Loader2,
  BrainCircuit,
  Lock,
  Crown,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { canAccessFeature, getUpgradeInfo } from '@/lib/subscription-gate';
import { useRouter } from 'next/navigation';

// ==================== TYPES ====================

interface ExportType {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  recordCountLabel: string;
  recordCountFetcher: () => Promise<number>;
}

// ==================== EXPORT TYPES CONFIG ====================

const exportTypes: ExportType[] = [
  {
    id: 'stocks',
    label: 'بيانات الأسهم',
    description: 'تصدير بيانات جميع الأسهم النشطة مع المؤشرات المالية والفنية',
    icon: Database,
    recordCountLabel: 'سهم نشط',
    recordCountFetcher: async () => {
      try {
        const res = await fetch('/api/stocks?page_size=1&is_active=true');
        const data = await res.json();
        return data.total || 0;
      } catch {
        return 0;
      }
    },
  },
  {
    id: 'recommendations',
    label: 'التحليلات',
    description: 'تصدير تحليلات الأسهم مع الدرجات والمؤشرات',
    icon: TrendingUp,
    recordCountLabel: 'تحليل',
    recordCountFetcher: async () => {
      try {
        const res = await fetch('/api/market/recommendations/ai-insights');
        if (!res.ok) return 0;
        const data = await res.json();
        return Array.isArray(data.stock_statuses) ? data.stock_statuses.length : 0;
      } catch {
        return 0;
      }
    },
  },
  {
    id: 'market-summary',
    label: 'ملخص السوق',
    description: 'تصدير ملخص شامل للسوق يشمل المؤشرات والقطاعات والإحصائيات',
    icon: BarChart3,
    recordCountLabel: 'قسم',
    recordCountFetcher: async () => {
      try {
        const res = await fetch('/api/market/overview');
        const data = await res.json();
        return Array.isArray(data.sectors) ? data.sectors.length : 0;
      } catch {
        return 0;
      }
    },
  },
  {
    id: 'ai-adjustment',
    label: 'تعديل التحليلات بالذكاء الاصطناعي',
    description: 'تصدير بيانات التحليلات الشاملة لإعادة ضبطها بواسطة الذكاء الاصطناعي',
    icon: BrainCircuit,
    recordCountLabel: 'تحليل',
    recordCountFetcher: async () => {
      try {
        const res = await fetch('/api/export?type=ai-adjustment&format=json');
        if (!res.ok) return 0;
        const blob = await res.blob();
        try {
          const text = await blob.text();
          const data = JSON.parse(text);
          return Array.isArray(data.recommendations) ? data.recommendations.length : 0;
        } catch {
          return 0;
        }
      } catch {
        return 0;
      }
    },
  },
];

// ==================== HELPER: FILE SIZE ====================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==================== SUBSCRIPTION GATE COMPONENT ====================

function SubscriptionGate({ tier }: { tier: string }) {
  const router = useRouter();
  const upgrade = getUpgradeInfo(tier, 'export_data');

  if (!upgrade) return null;

  return (
    <div className="space-y-4">
      {/* Lock banner */}
      <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="p-6 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Lock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-2">
            <h3 className="font-bold text-base text-foreground">ميزة للاشتراك المدفوع</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {upgrade.message}
            </p>
          </div>

          {/* Export types preview (locked) */}
          <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
            {exportTypes.map((et) => {
              const Icon = et.icon;
              return (
                <div
                  key={et.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-background/60 border border-border/50 opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-right min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{et.label}</p>
                    <p className="text-[10px] text-muted-foreground">CSV / JSON</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upgrade button */}
          <Button
            onClick={() => router.push('/subscription')}
            className="bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white gap-2 px-6"
          >
            <Crown className="w-4 h-4" />
            ترقية إلى باقة {upgrade.requiredTierAr}
          </Button>

          <p className="text-[10px] text-muted-foreground">
            قم بالترقية للوصول إلى تصدير البيانات بجميع الصيغ
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export function DataManager() {
  const { user } = useAppStore();
  const tier = user?.subscription_tier || 'free';
  const hasAccess = canAccessFeature(tier, 'export_data');

  // Export state
  const [exporting, setExporting] = useState<string | null>(null);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});

  // Load record counts on mount
  React.useEffect(() => {
    if (!hasAccess) return;
    exportTypes.forEach(async (et) => {
      try {
        const count = await et.recordCountFetcher();
        setRecordCounts(prev => ({ ...prev, [et.id]: count }));
      } catch {
        // ignore
      }
    });
  }, [hasAccess]);

  // ==================== EXPORT HANDLER ====================

  async function downloadExport(type: string, format: string) {
    if (!hasAccess) {
      toast.error('هذه الميزة متاحة للاشتراكات المدفوعة فقط');
      return;
    }

    setExporting(type);
    try {
      const response = await fetch(`/api/export?type=${type}&format=${format}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'فشل التصدير');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `egx_${type}_${format}_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'json'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      const typeName = exportTypes.find(e => e.id === type)?.label || type;
      toast.success(`تم تصدير ${typeName} بنجاح`, {
        description: `الصيغة: ${format.toUpperCase()} | الحجم: ${formatFileSize(blob.size)}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء التصدير';
      toast.error('فشل التصدير', { description: message });
    } finally {
      setExporting(null);
    }
  }

  // ==================== RENDER ====================

  if (!hasAccess) {
    return (
      <div dir="rtl">
        <SubscriptionGate tier={tier} />
      </div>
    );
  }

  return (
    <div dir="rtl">
      <div className="space-y-4">
        {/* Active subscription badge */}
        <div className="flex items-center justify-between">
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 gap-1 text-xs">
            <Crown className="w-3 h-3" />
            ميزة نشطة — الاشتراك المدفوع
          </Badge>
        </div>

        {exportTypes.map((et) => {
          const Icon = et.icon;
          const isExporting = exporting === et.id;
          const count = recordCounts[et.id];

          return (
            <Card key={et.id} className="overflow-hidden">
              <CardContent className="p-4 md:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Icon & Info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm text-foreground">{et.label}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{et.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                          {count !== undefined ? (
                            <>
                              <Database className="w-3 h-3 ml-1" />
                              {count.toLocaleString('ar-EG')} {et.recordCountLabel}
                            </>
                          ) : (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Format Selector & Export Button */}
                  <div className="flex items-center gap-2 sm:flex-row-reverse">
                    <ExportFormatSelector
                      onSelect={(format) => downloadExport(et.id, format)}
                      disabled={isExporting}
                      loading={isExporting}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Export Tips */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">ملاحظات التصدير:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>ملفات CSV تتضمن ترميز UTF-8 مع BOM لعرض النص العربي بشكل صحيح</li>
                  <li>ملفات JSON تحتوي على بيانات منظمة وسهلة القراءة</li>
                  <li>يمكن فتح ملفات CSV في Excel أو Google Sheets</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ==================== EXPORT FORMAT SELECTOR ====================

function ExportFormatSelector({
  onSelect,
  disabled,
  loading,
}: {
  onSelect: (format: string) => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSelect('csv')}
        disabled={disabled}
        className="gap-1.5 text-xs"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        )}
        CSV
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSelect('json')}
        disabled={disabled}
        className="gap-1.5 text-xs"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FileJson className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
        )}
        JSON
      </Button>
    </div>
  );
}

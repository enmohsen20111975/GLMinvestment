'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  FileText,
  FileSpreadsheet,
  File,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RecommendationExportProps {
  onExport?: (format: string) => void;
}

export function RecommendationsExport({ onExport }: RecommendationExportProps) {
  const [format, setFormat] = useState<string>('txt');
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch recommendations
      const response = await fetch('/api/unified-market-analysis?limit=500');
      const data = await response.json();

      if (!data.success || !data.results?.length) {
        toast.error('لا توجد تحليلات للتصدير');
        return;
      }

      let content = '';
      let filename = '';
      let mimeType = '';

      const date = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (format === 'txt') {
        // Text format - simple and readable
        content = generateTextReport(data.results, date);
        filename = `تحليلات_${new Date().toISOString().split('T')[0]}.txt`;
        mimeType = 'text/plain;charset=utf-8';
      } else if (format === 'csv') {
        // CSV format - for Excel
        content = generateCSV(data.results);
        filename = `recommendations_${new Date().toISOString().split('T')[0]}.csv`;
        mimeType = 'text/csv;charset=utf-8';
      } else if (format === 'json') {
        // JSON format - for developers
        content = JSON.stringify(data.results, null, 2);
        filename = `recommendations_${new Date().toISOString().split('T')[0]}.json`;
        mimeType = 'application/json';
      }

      // Download file
      downloadFile(content, filename, mimeType);
      
      setLastExport(new Date().toLocaleTimeString('ar-EG'));
      toast.success(`تم تصدير ${data.results.length} تحليل`);

      onExport?.(format);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('فشل في تصدير التحليلات');
    } finally {
      setExporting(false);
    }
  };

  const generateTextReport = (results: any[], date: string): string => {
    const buySignals = results.filter((r: any) =>
      ['STRONG_BUY', 'BUY', 'ACCUMULATE'].includes(r.signal)
    );

    let report = `
═══════════════════════════════════════════════════════════════
                    تقرير التحليلات اليومية
                        ${date}
═══════════════════════════════════════════════════════════════

📊 ملخص السوق:
  • إجمالي الأسهم المحللة: ${results.length}
  • فرص الشراء: ${buySignals.length}
  • فرص البيع: ${results.filter((r: any) => ['SELL', 'STRONG_SELL'].includes(r.signal)).length}
  • احتفاظ: ${results.filter((r: any) => r.signal === 'HOLD').length}

═══════════════════════════════════════════════════════════════
                    🟢 فرص الشراء
═══════════════════════════════════════════════════════════════

`;

    buySignals.forEach((stock: any, index: number) => {
      const signalEmoji = stock.signal === 'STRONG_BUY' ? '🔥' : stock.signal === 'BUY' ? '✅' : '📈';
      
      report += `
${index + 1}. ${stock.ticker} ${signalEmoji}
   ─────────────────────────────────────
   │ الإشارة: ${stock.signal_ar || stock.signal}
   │ الدرجة: ${stock.master_score?.toFixed?.(1) || stock.master_score}%
   │ السعر الحالي: ${stock.current_price?.toFixed?.(2) || '-'} جنيه
   │ سعر الدخول: ${stock.entry_price?.toFixed?.(2) || '-'} جنيه
   │ الهدف: ${stock.target_price?.toFixed?.(2) || '-'} جنيه
   │ وقف الخسارة: ${stock.stop_loss?.toFixed?.(2) || '-'} جنيه
   │ R:R: ${stock.risk_reward_ratio?.toFixed?.(2) || '-'}
   │ السيولة: ${stock.liquidity_level || '-'}
   ─────────────────────────────────────
`;
    });

    report += `
═══════════════════════════════════════════════════════════════
                        ⚠️ تنبيه هام
═══════════════════════════════════════════════════════════════

هذا التحليل للأغراض التعليمية فقط ولا يعتبر تحليل استثمارية.
استشر مستشار مالي مرخص قبل اتخاذ أي قرار استثماري.

═══════════════════════════════════════════════════════════════
                    تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}
═══════════════════════════════════════════════════════════════
`;

    return report;
  };

  const generateCSV = (results: any[]): string => {
    // CSV Header
    let csv = 'الترتيب,السهم,الإشارة,الدرجة,السعر الحالي,سعر الدخول,الهدف,وقف الخسارة,R:R,السيولة,المخاطرة\n';

    results.forEach((stock: any, index: number) => {
      csv += `${index + 1},`;
      csv += `${stock.ticker},`;
      csv += `${stock.signal_ar || stock.signal},`;
      csv += `${stock.master_score?.toFixed?.(1) || stock.master_score},`;
      csv += `${stock.current_price?.toFixed?.(2) || ''},`;
      csv += `${stock.entry_price?.toFixed?.(2) || ''},`;
      csv += `${stock.target_price?.toFixed?.(2) || ''},`;
      csv += `${stock.stop_loss?.toFixed?.(2) || ''},`;
      csv += `${stock.risk_reward_ratio?.toFixed?.(2) || ''},`;
      csv += `${stock.liquidity_level || ''},`;
      csv += `${stock.risk_level || ''}\n`;
    });

    return csv;
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-2 border-emerald-200 dark:border-emerald-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-emerald-600" />
          تصدير التحليلات
        </CardTitle>
        <CardDescription>
          حمل التحليلات كملف للاحتفاظ بها أو مشاركتها
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Format Selection */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">صيغة الملف:</span>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="txt">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  نص (.txt)
                </div>
              </SelectItem>
              <SelectItem value="csv">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  Excel (.csv)
                </div>
              </SelectItem>
              <SelectItem value="json">
                <div className="flex items-center gap-2">
                  <File className="w-4 h-4" />
                  JSON (.json)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Format Description */}
        <div className="p-3 rounded-lg bg-muted/50 text-sm">
          {format === 'txt' && (
            <p>📄 ملف نصي منسق بالعربي - مناسب للقراءة والمشاركة</p>
          )}
          {format === 'csv' && (
            <p>📊 ملف Excel - مناسب للتحليل والحسابات</p>
          )}
          {format === 'json' && (
            <p>💻 ملف JSON - مناسب للمطورين والتكامل</p>
          )}
        </div>

        {/* Export Button */}
        <Button
          onClick={handleExport}
          disabled={exporting}
          className="w-full gap-2"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري التصدير...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              تصدير التحليلات
            </>
          )}
        </Button>

        {/* Last Export */}
        {lastExport && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            آخر تصدير: {lastExport}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

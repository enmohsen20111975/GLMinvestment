'use client';

import React, { useState } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Database,
  ClipboardPaste,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface ImportResult {
  success: boolean;
  message: string;
  results: {
    total: number;
    updated: number;
    inserted: number;
    skipped: number;
    errors: string[];
    stocks: Array<{ ticker: string; name: string; price: number }>;
  };
}

export function StockImportCard() {
  const [rawData, setRawData] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<Array<{ ticker: string; name: string; price: string }> | null>(null);

  // معاينة البيانات
  const handlePreview = () => {
    if (!rawData.trim()) {
      toast.error('الرجاء إدخال البيانات أولاً');
      return;
    }

    const lines = rawData.trim().split('\n');
    const previewData = [];

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const columns = lines[i].split('\t').map(col => col.trim());
      previewData.push({
        ticker: columns[0] || '',
        name: columns[1] || '',
        price: columns[2] || '',
      });
    }

    setPreview(previewData);
  };

  // لصق من الحافظة
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawData(text);
        toast.success('تم اللصق من الحافظة');
      } else {
        toast.error('الحافظة فارغة');
      }
    } catch {
      toast.error('فشل في الوصول للحافظة');
    }
  };

  // استيراد البيانات
  const handleImport = async () => {
    if (!rawData.trim()) {
      toast.error('الرجاء إدخال البيانات أولاً');
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/import-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rawData }),
      });

      const data: ImportResult = await res.json();
      setResult(data);

      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message || 'فشل في الاستيراد');
      }
    } catch (err) {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setImporting(false);
    }
  };

  // مسح البيانات
  const handleClear = () => {
    setRawData('');
    setResult(null);
    setPreview(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="w-4 h-4" />
          استيراد بيانات الأسهم
        </CardTitle>
        <CardDescription>
          انسخ البيانات من موقع البورصة المصرية والصقها هنا لتحديث أسعار الأسهم
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* التعليمات */}
        <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
          <p className="font-medium text-foreground">📋 تعليمات:</p>
          <ol className="list-decimal list-inside text-muted-foreground space-y-1 text-xs">
            <li>افتح موقع البورصة المصرية (egx.org.eg)</li>
            <li>اذهب لصفحة أسعار الأسهم</li>
            <li>حدد جدول البيانات كاملاً (من الرمز حتى آخر عمود)</li>
            <li>انسخ البيانات (Ctrl+C أو Cmd+C)</li>
            <li>اضغط "لصق من الحافظة" أو الصق مباشرة في المربع</li>
            <li>اضغط "معاينة" للتأكد من البيانات ثم "استيراد"</li>
          </ol>
        </div>

        {/* أزرار التحكم */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePaste}
            className="gap-1"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            لصق من الحافظة
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            disabled={!rawData.trim()}
            className="gap-1"
          >
            <Eye className="w-3.5 h-3.5" />
            معاينة
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!rawData.trim() || importing}
            className="gap-1"
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            استيراد
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!rawData.trim() && !result}
          >
            مسح
          </Button>
        </div>

        {/* منطقة الإدخال */}
        <div className="space-y-2">
          <label className="text-sm font-medium">البيانات المنسوخة:</label>
          <Textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            placeholder="الصق البيانات هنا...&#10;التنسيق: الرمز	الإسم	السعر	..."
            className="min-h-[150px] font-mono text-xs"
            dir="rtl"
          />
          <p className="text-xs text-muted-foreground">
            {rawData.trim() ? `${rawData.trim().split('\n').length} سطر` : 'لم يتم إدخال بيانات'}
          </p>
        </div>

        {/* المعاينة */}
        {preview && preview.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">معاينة البيانات (أول 10 أسطر):</label>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">السطر</th>
                    <th className="px-3 py-2 text-right font-medium">الرمز</th>
                    <th className="px-3 py-2 text-right font-medium">الاسم</th>
                    <th className="px-3 py-2 text-right font-medium">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono font-bold">{row.ticker}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* النتائج */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              <span className="font-medium">{result.message}</span>
            </div>

            {/* إحصائيات */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2 rounded-lg bg-muted/50 text-center">
                <p className="text-lg font-bold text-blue-600">{result.results.total}</p>
                <p className="text-xs text-muted-foreground">إجمالي</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 text-center">
                <p className="text-lg font-bold text-green-600">{result.results.updated}</p>
                <p className="text-xs text-muted-foreground">محدث</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 text-center">
                <p className="text-lg font-bold text-amber-600">{result.results.inserted}</p>
                <p className="text-xs text-muted-foreground">جديد</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 text-center">
                <p className="text-lg font-bold text-gray-500">{result.results.skipped}</p>
                <p className="text-xs text-muted-foreground">تخطي</p>
              </div>
            </div>

            {/* الأخطاء */}
            {result.results.errors.length > 0 && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700 dark:text-red-400">
                    {result.results.errors.length} خطأ
                  </span>
                </div>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                  {result.results.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* قائمة الأسهم المستوردة */}
            {result.results.stocks.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">الأسهم المستوردة (أول 20):</label>
                <div className="flex flex-wrap gap-1">
                  {result.results.stocks.map((stock, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px]">
                      {stock.ticker}: {stock.price.toFixed(2)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

/**
 * IndicesCSVUploader.tsx
 * ===============================================================================
 *
 * مكون رفع ملف CSV لبيانات المؤشرات التاريخية في لوحة الأدمن.
 *
 * الميزة:
 *   - رفع ملف CSV (drag & drop أو اختيار)
 *   - اختيار الرمز (EGX30/70/100) أو اكتشاف تلقائي من اسم الملف
 *   - عرض تقرير بعد الاستيراد (عدد الصفوف + الفترة الزمنية)
 *   - عرض المؤشرات المستوردة سابقًا
 *   - إزالة التكرارات تلقائيًا (UPSERT)
 * ===============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Database, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface IndexStats {
  symbol: string;
  count: number;
  first_date: string;
  last_date: string;
  last_import: string | null;
}

export function IndicesCSVUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [symbol, setSymbol] = useState<string>('auto');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [indices, setIndices] = useState<IndexStats[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/import-indices-csv');
      const data = await res.json();
      if (data.success) {
        setIndices(data.indices || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndices();
  }, [fetchIndices]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
      setError(null);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.name.endsWith('.csv')) {
      setFile(dropped);
      setResult(null);
      setError(null);
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (symbol !== 'auto') {
        formData.append('symbol', symbol);
      }

      const res = await fetch('/api/admin/import-indices-csv', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.details);
        toast.success(data.message);
        fetchIndices(); // تحديث القائمة
      } else {
        setError(data.error || 'فشل الاستيراد');
        toast.error(data.error || 'فشل الاستيراد');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ غير متوقع');
      toast.error('فشل رفع الملف');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            <CardTitle className="text-base">استيراد بيانات المؤشرات التاريخية</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchIndices} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* المؤشرات المستوردة حاليًا */}
        {indices.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              المؤشرات في قاعدة البيانات
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {indices.map((idx) => (
                <div
                  key={idx.symbol}
                  className="p-2 rounded-lg border border-border bg-muted/30 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="font-mono">{idx.symbol}</Badge>
                    <span className="text-muted-foreground">{idx.count} صف</span>
                  </div>
                  <div className="text-muted-foreground">
                    من {idx.first_date} → {idx.last_date}
                  </div>
                  {idx.last_import && (
                    <div className="text-[10px] text-muted-foreground/70">
                      آخر استيراد: {idx.last_import}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* منطقة الرفع */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
            file ? 'border-emerald-400 bg-emerald-50/30' : 'border-border hover:border-emerald-300'
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileText className="w-8 h-8 text-emerald-600" />
              <span className="text-sm font-bold">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                ارفع ملف CSV هنا أو اضغط للاختيار
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                يدعم: date,value / date,close / time,OHLCV
              </span>
            </div>
          )}
        </div>

        {/* اختيار الرمز */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">الرمز:</span>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">اكتشاف تلقائي</SelectItem>
              <SelectItem value="EGX30">EGX30</SelectItem>
              <SelectItem value="EGX70">EGX70</SelectItem>
              <SelectItem value="EGX100">EGX100</SelectItem>
              <SelectItem value="EGX33">EGX33</SelectItem>
              <SelectItem value="EGX50">EGX50</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* زر الاستيراد */}
        <Button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              جارٍ الاستيراد...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 ml-2" />
              استيراد البيانات
            </>
          )}
        </Button>

        {/* النتيجة */}
        {result && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/30 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-700">تم الاستيراد بنجاح</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">الرمز: </span>
                <Badge variant="secondary" className="font-mono">{result.symbol}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">صفوف مستوردة: </span>
                <strong className="text-emerald-600">{result.imported}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">صفوف متخطاة: </span>
                <strong>{result.skipped}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">إجمالي في DB: </span>
                <strong>{result.total_in_db}</strong>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">الفترة: </span>
                <strong>{result.date_range.first}</strong> → <strong>{result.date_range.last}</strong>
              </div>
            </div>
          </div>
        )}

        {/* الخطأ */}
        {error && (
          <div className="p-3 rounded-lg border border-rose-200 bg-rose-50/30 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600" />
            <span className="text-sm text-rose-700">{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

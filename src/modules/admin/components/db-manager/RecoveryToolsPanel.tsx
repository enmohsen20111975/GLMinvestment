'use client';

/**
 * db-manager/RecoveryToolsPanel.tsx
 * ====================================
 * Maintenance-tab sub-section: Database Recovery Tools (recover single DB,
 * recover all) + Advanced Data Tools (repair-engine, cleanup-symbols,
 * import-egx30, repair-all) + terminal-style console output.
 */

import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  Database as DatabaseIcon,
  Activity,
  ArrowRightLeft,
  History,
  CheckCircle2,
  Info,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import type { RecoveryToolsPanelProps } from './types';

export function RecoveryToolsPanel(props: RecoveryToolsPanelProps) {
  const {
    selectedDb,
    selectedOverview,
    recoverLoading,
    recoverResult,
    advancedLoading,
    advancedOutput,
    onRecoverDb,
    onRecoverAll,
    onAdvancedOperation,
  } = props;

  return (
    <>
      {/* Database Recovery Tools */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-profit" />
            استعادة قواعد البيانات التالفة
          </CardTitle>
          <CardDescription className="text-xs">
            استعادة تلقائية من النسخ الاحتياطية أو إصلاح via WAL Checkpoint + VACUUM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {selectedDb && selectedOverview?.integrity === 'corrupt' && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onRecoverDb(selectedDb)}
                disabled={recoverLoading === selectedDb}
              >
                {recoverLoading === selectedDb ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                استعادة {selectedDb}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onRecoverAll}
              disabled={recoverLoading === 'all'}
              className="text-profit border-profit hover:bg-profit"
            >
              {recoverLoading === 'all' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              )}
              فحص واستعادة الكل
            </Button>
          </div>

          {recoverResult && (
            <Alert variant={recoverResult.result?.recovered ? 'default' : recoverResult.result?.error ? 'destructive' : 'default'}>
              <Info className="h-4 w-4" />
              <AlertTitle>نتيجة الاستعادة — {recoverResult.db}</AlertTitle>
              <AlertDescription>
                <div className="text-sm mt-1 space-y-1">
                  {recoverResult.result?.recovered && (
                    <p className="text-profit ">
                      ✅ تم الاستعادة بنجاح {recoverResult.result.restored_from ? `من: ${recoverResult.result.restored_from}` : ''}
                    </p>
                  )}
                  {recoverResult.result?.method && (
                    <p className="text-xs text-muted-foreground">
                      الطريقة: {recoverResult.result.method}
                    </p>
                  )}
                  {recoverResult.result?.message && (
                    <p className="text-sm">{recoverResult.result.message}</p>
                  )}
                  {recoverResult.result?.error && (
                    <p className="text-loss ">
                      ❌ {recoverResult.result.error}
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Advanced Data Tools */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <DatabaseIcon className="w-4 h-4 text-primary" />
            أدوات تنظيف وإصلاح البيانات المتقدمة (Advanced Data Tools)
          </CardTitle>
          <CardDescription className="text-xs">
            عمليات صيانة وحفظ سلامة متقدمة وتحديث البيانات التاريخية (تشغيل سكربتات VPS مباشرة من المتصفح).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Repair data_engine.db */}
            <div className="border rounded-lg p-3 flex flex-col justify-between gap-3 bg-slate-50/50">
              <div>
                <div className="text-sm font-semibold text-primary flex items-center gap-1.5">
                  <Activity className="w-4 h-4" />
                  إصلاح تلف قاعدة البيانات
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  يقوم بفحص وإصلاح قاعدة بيانات المحرك (<code>data_engine.db</code>) تلقائياً، وإعادة بناء الفهارس المعطوبة صفاً بصف.
                </p>
              </div>
              <Button
                onClick={() => onAdvancedOperation('repair-engine', 'إصلاح قاعدة بيانات المحرك')}
                disabled={advancedLoading !== null}
                size="sm"
                className="bg-primary hover:bg-primary text-white w-full"
              >
                {advancedLoading === 'repair-engine' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                تشغيل الإصلاح الذاتي
              </Button>
            </div>

            {/* Purge and align symbols */}
            <div className="border rounded-lg p-3 flex flex-col justify-between gap-3 bg-slate-50/50">
              <div>
                <div className="text-sm font-semibold text-whale flex items-center gap-1.5">
                  <ArrowRightLeft className="w-4 h-4" />
                  تنظيف الرموز ومحاذاة الأسماء
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  حذف الرموز المشوهة والقديمة (مثل <code>EKHO</code> و <code>MNHD</code>) ومحاذاة أسماء الأسهم لجميع جداول النظام.
                </p>
              </div>
              <Button
                onClick={() => onAdvancedOperation('cleanup-symbols', 'تنظيف الرموز ومحاذاة الأسماء')}
                disabled={advancedLoading !== null}
                size="sm"
                className="bg-whale hover:bg-whale text-white w-full"
              >
                {advancedLoading === 'cleanup-symbols' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                تنظيف ومحاذاة الرموز
              </Button>
            </div>

            {/* Import EGX30 History */}
            <div className="border rounded-lg p-3 flex flex-col justify-between gap-3 bg-slate-50/50">
              <div>
                <div className="text-sm font-semibold text-primary flex items-center gap-1.5">
                  <History className="w-4 h-4" />
                  استيراد تاريخ مؤشر EGX30
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  استيراد البيانات اليومية لمؤشر البورصة المصرية الرئيسي <code>EGX30</code> من ملف الـ CSV وتحديث الأسعار والمقاييس.
                </p>
              </div>
              <Button
                onClick={() => onAdvancedOperation('import-egx30', 'استيراد وتحديث تاريخ EGX30')}
                disabled={advancedLoading !== null}
                size="sm"
                className="bg-primary hover:bg-primary text-white w-full"
              >
                {advancedLoading === 'import-egx30' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <DatabaseIcon className="w-3.5 h-3.5 mr-1.5" />
                )}
                تحديث مؤشر EGX30
              </Button>
            </div>
          </div>

          <div className="border rounded-lg p-3 flex flex-col justify-between gap-3 bg-profit/10 md:col-span-3 border-profit">
            <div>
              <div className="text-sm font-semibold text-profit flex items-center gap-1.5">
                <RefreshCw className="w-4 h-4" />
                إصلاح شامل لجميع قواعد البيانات
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                يفحص ويُصلح جميع قواعد البيانات (19 قاعدة) تلقائياً عبر REINDEX ثم dump/rebuild. يُنشئ backup قبل أي تعديل.
              </p>
            </div>
            <Button
              onClick={() => onAdvancedOperation('repair-all', 'إصلاح شامل لجميع قواعد البيانات')}
              disabled={advancedLoading !== null}
              size="sm"
              className="bg-profit hover:bg-profit text-white w-full"
            >
              {advancedLoading === 'repair-all' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              إصلاح الكل الآن
            </Button>
          </div>

          {/* Terminal console output */}
          {advancedOutput && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">مخرجات السكربت (Console Output):</div>
              <pre className="bg-slate-950 text-slate-200 p-4 rounded-lg text-xs font-mono h-60 overflow-y-auto whitespace-pre-wrap">
                {advancedOutput}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

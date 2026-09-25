'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Database, HardDrive, Upload, RefreshCw, Loader2, Archive,
  CheckCircle2, AlertCircle, Trash2, Github, FileArchive,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface DbInfo {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  modified: string | null;
}

interface BackupArchive {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  created: string | null;
}

interface BackupResponse {
  success: boolean;
  databases: DbInfo[];
  archives: BackupArchive[];
  summary: {
    total_dbs: number;
    total_size_bytes: number;
    total_size_mb: string;
    total_archives: number;
  };
  max_zip_mb: number;
  timestamp: string;
}

interface PostResult {
  success: boolean;
  stamp: string;
  archives: Array<{
    archive_name: string;
    size_bytes: number;
    size_mb: string;
    included_dbs: string[];
  }>;
  summary: {
    total_archives_created: number;
    total_db_files: number;
    pruned_old_archives: number;
  };
  git: {
    committed: boolean;
    pushed: boolean;
    message: string;
  };
  errors: string[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ثانية`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} دقيقة`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} ساعة`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function DbBackupPanel() {
  const [data, setData] = useState<BackupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadToGithub, setUploadToGithub] = useState(true);
  const [pruneOld, setPruneOld] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/db-backup', { credentials: 'same-origin' });
      const json: BackupResponse | { success: false; error: string } = await res.json();
      if (json.success) {
        setData(json as BackupResponse);
      } else {
        toast.error((json as { error: string }).error || 'فشل تحميل قائمة القواعد');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBackup = async () => {
    setZipping(true);
    try {
      const res = await fetch('/api/admin/db-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          upload_to_github: false, // backup only — separate upload step
          prune_older_than_days: pruneOld ? 30 : 0,
        }),
      });
      const json: PostResult = await res.json();
      if (json.success) {
        const created = json.archives?.length || 0;
        if (created > 0) {
          toast.success(`تم إنشاء ${created} أرشيف (${json.archives.reduce((s, a) => s + a.size_bytes, 0) / 1024 / 1024 | 0} MB).`);
        } else {
          toast.info('لم يُنشأ أي أرشيف — تحقق من السجل.');
        }
        if (json.errors?.length) {
          for (const err of json.errors.slice(0, 3)) {
            toast.error(err, { duration: 8000 });
          }
        }
        fetchData();
      } else {
        toast.error(json.error || 'فشل إنشاء النسخة الاحتياطية');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setZipping(false);
    }
  };

  const handleUploadToGithub = async () => {
    setUploading(true);
    try {
      // Run a backup AND push it in one shot (the endpoint handles git add+commit+push)
      const res = await fetch('/api/admin/db-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          upload_to_github: true,
          prune_older_than_days: pruneOld ? 30 : 0,
        }),
      });
      const json: PostResult = await res.json();
      if (json.success) {
        const created = json.archives?.length || 0;
        if (created > 0) {
          toast.success(`تم إنشاء ${created} أرشيف ورفعها على GitHub.`);
        }
        if (json.git?.pushed) {
          toast.success('تم الرفع على GitHub بنجاح.', {
            description: json.git.message,
          });
        } else if (json.git?.committed) {
          toast.warning('تم الالتزام (commit) ولكن فشل الرفع (push).', {
            description: json.git.message,
            duration: 8000,
          });
        } else {
          toast.warning('لم يتم الالتزام أو الرفع.', {
            description: json.git?.message,
            duration: 8000,
          });
        }
        if (json.errors?.length) {
          for (const err of json.errors.slice(0, 3)) {
            toast.error(err, { duration: 8000 });
          }
        }
        fetchData();
      } else {
        toast.error(json.error || 'فشل الرفع على GitHub');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setUploading(false);
    }
  };

  const dbs = data?.databases ?? [];
  const archives = data?.archives ?? [];
  const totalSizeMb = parseFloat(data?.summary.total_size_mb || '0');
  const busy = zipping || uploading;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-emerald-500" />
            النسخ الاحتياطي لقواعد البيانات + رفع GitHub
          </CardTitle>
          <CardDescription>
            ضغط كل ملفات <code className="text-xs bg-muted px-1 rounded">db/*.db</code> في أرشيفات ZIP لا تتجاوز 60MB،
            ثم رفعها إلى <code className="text-xs bg-muted px-1 rounded">data/</code> على GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Options */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={uploadToGithub}
                onCheckedChange={(v) => setUploadToGithub(v === true)}
              />
              <span>رفع على GitHub بعد الضغط</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={pruneOld}
                onCheckedChange={(v) => setPruneOld(v === true)}
              />
              <span>حذف النسخ الأقدم من 30 يوم</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={uploadToGithub ? handleUploadToGithub : handleBackup}
              disabled={busy}
              className="gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              {busy
                ? (uploading ? 'جاري الرفع على GitHub...' : 'جاري الضغط...')
                : (uploadToGithub ? 'ضغط + رفع على GitHub' : 'ضغط قواعد البيانات فقط')}
            </Button>
            <Button
              onClick={fetchData}
              disabled={loading}
              variant="outline"
              className="gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث القائمة
            </Button>
          </div>

          {/* Summary */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <SummaryStat
                icon={<Database className="w-4 h-4 text-emerald-500" />}
                label="قواعد البيانات"
                value={data.summary.total_dbs.toString()}
              />
              <SummaryStat
                icon={<HardDrive className="w-4 h-4 text-sky-500" />}
                label="الحجم الكلي"
                value={`${totalSizeMb.toFixed(1)} MB`}
              />
              <SummaryStat
                icon={<FileArchive className="w-4 h-4 text-amber-500" />}
                label="الأرشيفات الموجودة"
                value={data.summary.total_archives.toString()}
              />
              <SummaryStat
                icon={<Github className="w-4 h-4 text-violet-500" />}
                label="حد الأرشيف الواحد"
                value={`${data.max_zip_mb} MB`}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* DB list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-500" />
            قواعد البيانات ({dbs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && dbs.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : dbs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد قواعد بيانات في مجلد <code className="text-xs bg-muted px-1 rounded">db/</code>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">اسم الملف</th>
                    <th className="p-2 font-medium">الحجم</th>
                    <th className="p-2 font-medium">آخر تعديل</th>
                    <th className="p-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {dbs.map((db) => {
                    const sizeMb = parseFloat(db.size_mb);
                    const isLarge = sizeMb > 50;
                    return (
                      <tr key={db.name} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-mono text-xs" dir="ltr">{db.name}</td>
                        <td className="p-2 whitespace-nowrap">
                          <span className={cn('font-medium', isLarge ? 'text-amber-600' : '')}>
                            {db.size_mb} MB
                          </span>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelative(db.modified)}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            متاح
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing archives */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileArchive className="w-4 h-4 text-amber-500" />
            الأرشيفات الموجودة في <code className="text-xs bg-muted px-1 rounded">data/</code> ({archives.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {archives.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              لا توجد أرشيفات بعد. اضغط &quot;ضغط قواعد البيانات&quot; للبدء.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">اسم الأرشيف</th>
                    <th className="p-2 font-medium">الحجم</th>
                    <th className="p-2 font-medium">تاريخ الإنشاء</th>
                  </tr>
                </thead>
                <tbody>
                  {archives.map((arc) => (
                    <tr key={arc.name} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs" dir="ltr">{arc.name}</td>
                      <td className="p-2 whitespace-nowrap">
                        <Badge variant="secondary">{arc.size_mb} MB</Badge>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelative(arc.created)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function SummaryStat({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

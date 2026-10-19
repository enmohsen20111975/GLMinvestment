'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
 Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
 Database, HardDrive, Upload, RefreshCw, Loader2, Archive,
 CheckCircle2, AlertCircle, Trash2, Github, FileArchive,
 Layers, CheckSquare, Square, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface DbInfo {
 name: string;
 path: string;
 size_bytes: number;
 size_mb: string;
 modified: string | null;
 is_core?: boolean;
}

interface BackupArchive {
 name: string;
 path: string;
 size_bytes: number;
 size_mb: string;
 created: string | null;
 is_part?: boolean;
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
 default_max_zip_mb?: number;
 timestamp: string;
}

interface PostResult {
 success: boolean;
 stamp: string;
 max_part_size_mb?: number;
 selected_count?: number;
 archives: Array<{
 archive_name: string;
 size_bytes: number;
 size_mb: string;
 included_dbs: string[];
 }>;
 summary: {
 total_archives_created: number;
 total_db_files_backed_up: number;
 pruned_old_archives: number;
 };
 git: {
 committed: boolean;
 pushed: boolean;
 message: string;
 push_strategy?: string;
 archived_to_push?: string[];
 remote_archives_deleted?: string[];
 rollback_performed?: boolean;
 ahead_behind?: { ahead: number; behind: number };
 warnings?: string[];
 };
 errors: string[];
 error?: string;
}

interface DeleteResult {
 success: boolean;
 target_type: 'database' | 'archive';
 deleted_count: number;
 deleted_files: string[];
 freed_bytes: number;
 freed_mb: string;
 errors: string[];
 error?: string;
}

interface DeleteModalState {
 open: boolean;
 targetType: 'database' | 'archive';
 fileNames: string[];
 totalMb: string;
 hasCore: boolean;
}

/* ------------------------------------------------------------------ */
/* Constants */
/* ------------------------------------------------------------------ */

const CHUNK_SIZE_OPTIONS = [
 { value: 25, label: '25 MB' },
 { value: 50, label: '50 MB' },
 { value: 60, label: '60 MB (موصى به)', isDefault: true },
 { value: 80, label: '80 MB' },
 { value: 95, label: '95 MB (حد أقصى لـ GitHub)' },
];

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function formatRelative(iso: string | null): string {
 if (!iso) return '—';
 const diffMs = Date.now() - new Date(iso).getTime();
 if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ثانية`;
 if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} دقيقة`;
 if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} ساعة`;
 return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function DbBackupPanel() {
 const [data, setData] = useState<BackupResponse | null>(null);
 const [loading, setLoading] = useState(false);
 const [busy, setBusy] = useState(false);
 const [busyLabel, setBusyLabel] = useState('');

 // Form options
 const [selectedDbs, setSelectedDbs] = useState<Set<string>>(new Set());
 const [maxPartSizeMb, setMaxPartSizeMb] = useState<number>(60);
 const [uploadToGithub, setUploadToGithub] = useState<boolean>(true);
 const [pruneOld, setPruneOld] = useState<boolean>(false);

 // NEW (Task PUSH-STRATEGY-2026-10-06): خيارات الرفع المتقدمة
 type PushStrategy = 'fetch_rebase' | 'fetch_merge' | 'force_push' | 'no_pull';
 const [pushStrategy, setPushStrategy] = useState<PushStrategy>('fetch_rebase');
 const [selectedArchives, setSelectedArchives] = useState<Set<string>>(new Set());
 const [rollbackLastCommit, setRollbackLastCommit] = useState<boolean>(false);
 const [deleteRemoteBeforePush, setDeleteRemoteBeforePush] = useState<Set<string>>(new Set());
 const [gitStatus, setGitStatus] = useState<{
 ahead: number;
 behind: number;
 current_branch: string;
 last_commit: string;
 unpushed_commits: string[];
 rebase_in_progress: boolean;
 merge_in_progress: boolean;
 } | null>(null);
 const [showAdvancedPush, setShowAdvancedPush] = useState<boolean>(false);

 // Deletion modal
 const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);

 // 1. Fetch data
 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const res = await fetch('/api/admin/db-backup', { credentials: 'same-origin' });
 const json: BackupResponse | { success: false; error: string } = await res.json();
 if (json.success) {
 const resp = json as BackupResponse;
 setData(resp);
 // By default, select all databases if selection is empty
 setSelectedDbs((prev) => {
 if (prev.size === 0) {
 return new Set(resp.databases.map((d) => d.name));
 }
 // Filter out deleted dbs
 const currentNames = new Set(resp.databases.map((d) => d.name));
 const next = new Set<string>();
 for (const name of prev) {
 if (currentNames.has(name)) next.add(name);
 }
 return next;
 });
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

 // NEW (Task PUSH-STRATEGY-2026-10-06): جلب حالة الـ git — سيتم تعريفها لاحقاً، لكن useEffect بيتعمل بعد التعريف
 // (مكان useEffect ده تم نقله بعد تعريف fetchGitStatus في الأسفل)

 const dbs = data?.databases ?? [];
 const archives = data?.archives ?? [];

 // Selected summary calculations
 const selectedSummary = useMemo(() => {
 let bytes = 0;
 let count = 0;
 for (const db of dbs) {
 if (selectedDbs.has(db.name)) {
 bytes += db.size_bytes;
 count++;
 }
 }
 return {
 count,
 bytes,
 mb: (bytes / 1024 / 1024).toFixed(1),
 };
 }, [dbs, selectedDbs]);

 // Selection handlers
 const handleToggleDb = (name: string) => {
 setSelectedDbs((prev) => {
 const next = new Set(prev);
 if (next.has(name)) {
 next.delete(name);
 } else {
 next.add(name);
 }
 return next;
 });
 };

 const handleSelectAll = () => {
 setSelectedDbs(new Set(dbs.map((d) => d.name)));
 };

 const handleDeselectAll = () => {
 setSelectedDbs(new Set());
 };

 const handleSelectCoreOnly = () => {
 const core = dbs.filter((d) => d.is_core).map((d) => d.name);
 setSelectedDbs(new Set(core));
 toast.info(`تم تحديد ${core.length} قواعد بيانات أساسية للنظام`);
 };

 const handleSelectNonCore = () => {
 const nonCore = dbs.filter((d) => !d.is_core).map((d) => d.name);
 setSelectedDbs(new Set(nonCore));
 toast.info(`تم تحديد ${nonCore.length} قواعد بيانات إضافية أو قديمة`);
 };

 // 2. Backup Action — مع خيارات الرفع المتقدمة (Task PUSH-STRATEGY-2026-10-06)
 const handleExecuteBackup = async (pushToGithub: boolean) => {
 if (selectedDbs.size === 0) {
 toast.error('يرجى تحديد قاعدة بيانات واحدة على الأقل للنسخ الاحتياطي');
 return;
 }

 setBusy(true);
 setBusyLabel(pushToGithub ? 'جاري الضغط والتجزئة والرفع إلى GitHub...' : 'جاري ضغط وتجزئة القواعد المحددة...');

 try {
 const res = await fetch('/api/admin/db-backup', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({
 upload_to_github: pushToGithub,
 prune_older_than_days: pruneOld ? 30 : 0,
 selected_dbs: Array.from(selectedDbs),
 max_part_size_mb: maxPartSizeMb,
 // NEW: خيارات الرفع المتقدمة
 selected_archives: selectedArchives.size > 0 ? Array.from(selectedArchives) : undefined,
 push_strategy: pushStrategy,
 rollback_last_commit: rollbackLastCommit || undefined,
 delete_remote_archives_before_push: deleteRemoteBeforePush.size > 0 ? Array.from(deleteRemoteBeforePush) : undefined,
 }),
 });

 const json: PostResult = await res.json();
 if (json.success) {
 const created = json.archives?.length || 0;
 const totalMb = json.archives?.reduce((s, a) => s + a.size_bytes, 0) / 1024 / 1024;

 if (created > 0) {
 toast.success(`تم إنشاء ${created} ملف أرشيف (الحجم الإجمالي: ${(totalMb ?? 0).toFixed(1)} MB) بمقاس أقصى ${maxPartSizeMb} MB`);
 }

 if (pushToGithub) {
 if (json.git?.pushed) {
 const aheadBehind = json.git.ahead_behind ? ` (ahead: ${json.git.ahead_behind.ahead}, behind: ${json.git.ahead_behind.behind})` : '';
 toast.success(`تم رفع ${json.git.archived_to_push?.length || created} ملف إلى GitHub بنجاح${aheadBehind}`, {
 description: `${json.git.message} | strategy: ${json.git.push_strategy}`,
 });
 } else if (json.git?.committed) {
 toast.warning('تم حفظ الـ Commit محلياً ولكن تعذر الرفع (push)', {
 description: json.git.message,
 });
 } else {
 toast.warning(json.git?.message || 'لم يكتمل الرفع إلى GitHub');
 }

 // عرض الـ warnings (لو فيه)
 if (json.git?.warnings && json.git.warnings.length > 0) {
 for (const w of json.git.warnings.slice(0, 5)) {
 toast.warning(w, { duration: 8000 });
 }
 }
 if (json.git?.rollback_performed) {
 toast.info('تم التراجع عن آخر commit قبل الرفع');
 }
 if (json.git?.remote_archives_deleted && json.git.remote_archives_deleted.length > 0) {
 toast.info(`تم مسح ${json.git.remote_archives_deleted.length} أرشيف قديم من GitHub`);
 }
 }

 if (json.errors?.length) {
 for (const err of json.errors.slice(0, 3)) {
 toast.error(err, { duration: 8000 });
 }
 }

 fetchData();
 // refresh git status
 fetchGitStatus();
 } else {
 toast.error(json.error || 'فشلت عملية النسخ الاحتياطي');
 }
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال بالخادم');
 } finally {
 setBusy(false);
 setBusyLabel('');
 }
 };

 // 2b. NEW: جلب حالة الـ git (ahead/behind/rebase in progress)
 const fetchGitStatus = useCallback(async () => {
 try {
 const res = await fetch('/api/admin/db-backup', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({ action: 'status' }),
 });
 const json = await res.json();
 if (json.success && json.status) {
 setGitStatus(json.status);
 }
 } catch {
 // silent fail — status is optional
 }
 }, []);

 // جلب حالة الـ git عند التحميل (Task PUSH-STRATEGY-2026-10-06)
 useEffect(() => {
 fetchGitStatus();
 }, [fetchGitStatus]);

 // 2c. NEW: إيقاف اجباري (abort)
 const handleAbort = async () => {
 if (!confirm('⚠️ تأكيد الإيقاف الاجباري؟ سيتم إلغاء أي rebase/merge في progress.')) return;
 setBusy(true);
 setBusyLabel('جاري الإيقاف الاجباري...');
 try {
 const res = await fetch('/api/admin/db-backup', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({ action: 'abort' }),
 });
 const json = await res.json();
 if (json.success) {
 toast.success('تم الإيقاف الاجباري بنجاح', { description: json.results?.join(' | ') });
 fetchGitStatus();
 } else {
 toast.error(json.error || 'فشل الإيقاف');
 }
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 setBusy(false);
 setBusyLabel('');
 }
 };

 // 2d. NEW: rollback آخر commit
 const handleRollback = async () => {
 if (!confirm('⚠️ تأكيد التراجع عن آخر commit؟ التغييرات ستعود للـ staging area (لن تُفقد).')) return;
 setBusy(true);
 setBusyLabel('جاري التراجع عن آخر commit...');
 try {
 const res = await fetch('/api/admin/db-backup', {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({ action: 'rollback' }),
 });
 const json = await res.json();
 if (json.success) {
 toast.success('تم التراجع', { description: json.results?.join(' | ') });
 fetchGitStatus();
 } else {
 toast.error(json.error || 'فشل التراجع');
 }
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 setBusy(false);
 setBusyLabel('');
 }
 };

 // 3. Deletion Modal Trigger
 const openDeleteModalForSingle = (db: DbInfo) => {
 setDeleteModal({
 open: true,
 targetType: 'database',
 fileNames: [db.name],
 totalMb: db.size_mb,
 hasCore: !!db.is_core,
 });
 };

 const openDeleteModalForSelected = () => {
 if (selectedDbs.size === 0) {
 toast.error('يرجى تحديد قواعد بيانات لحذفها');
 return;
 }
 const files = dbs.filter((d) => selectedDbs.has(d.name));
 const totalBytes = files.reduce((s, f) => s + f.size_bytes, 0);
 const hasCore = files.some((f) => f.is_core);

 setDeleteModal({
 open: true,
 targetType: 'database',
 fileNames: files.map((f) => f.name),
 totalMb: (totalBytes / 1024 / 1024).toFixed(1),
 hasCore,
 });
 };

 const openDeleteModalForArchive = (arc: BackupArchive) => {
 setDeleteModal({
 open: true,
 targetType: 'archive',
 fileNames: [arc.name],
 totalMb: arc.size_mb,
 hasCore: false,
 });
 };

 const openDeleteModalForAllArchives = () => {
 if (archives.length === 0) return;
 const totalBytes = archives.reduce((s, a) => s + a.size_bytes, 0);
 setDeleteModal({
 open: true,
 targetType: 'archive',
 fileNames: archives.map((a) => a.name),
 totalMb: (totalBytes / 1024 / 1024).toFixed(1),
 hasCore: false,
 });
 };

 // Execute Deletion
 const handleConfirmDelete = async () => {
 if (!deleteModal || deleteModal.fileNames.length === 0) return;

 setBusy(true);
 setBusyLabel(`جاري حذف ${deleteModal.fileNames.length} ملف...`);

 try {
 const res = await fetch('/api/admin/db-backup', {
 method: 'DELETE',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'same-origin',
 body: JSON.stringify({
 target_type: deleteModal.targetType,
 file_names: deleteModal.fileNames,
 }),
 });

 const json: DeleteResult = await res.json();
 if (json.success) {
 toast.success(`تم حذف ${json.deleted_count} ملف بنجاح، وتم تحرير ${json.freed_mb} MB من مساحة التخزين.`);
 if (json.errors?.length) {
 for (const err of json.errors) {
 toast.error(err);
 }
 }
 setDeleteModal(null);
 fetchData();
 } else {
 toast.error(json.error || 'فشلت عملية الحذف');
 }
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال بالخادم');
 } finally {
 setBusy(false);
 setBusyLabel('');
 }
 };

 const isAllSelected = dbs.length > 0 && selectedDbs.size === dbs.length;

 return (
 <div className="space-y-5" dir="rtl">
 {/* Header & Main Control Card */}
 <Card className="border-border/70 shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 <div>
 <CardTitle className="text-xl flex items-center gap-2.5">
 <Archive className="w-6 h-6 text-profit" />
 النسخ الاحتياطي لقواعد البيانات وإدارتها + رفع GitHub
 </CardTitle>
 <CardDescription className="text-sm mt-1">
 تحديد القواعد المراد نسخها أو مسحها، وتجزئة الأرشيفات الكبيرة تلقائياً لتفادي حدود GitHub.
 </CardDescription>
 </div>

 {/* Quick Actions */}
 <div className="flex items-center gap-2">
 <Button
 onClick={fetchData}
 disabled={loading || busy}
 variant="outline"
 size="sm"
 className="gap-2"
 >
 {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
 تحديث
 </Button>
 </div>
 </div>
 </CardHeader>

 <CardContent className="space-y-4">
 {/* Chunk Size Selector */}
 <div className="p-3.5 rounded-lg bg-muted/40 border border-border/60 space-y-2.5">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
 <label className="text-sm font-semibold flex items-center gap-2">
 <Layers className="w-4 h-4 text-sky-500" />
 أقصى حجم للملف المضغوط (تجزئة الأرشيفات الكبيرة):
 </label>
 <span className="text-xs text-muted-foreground">
 (الملفات الضخمة مثل 1.6GB يتم تقسيمها تلقائياً لأجزاء تحت هذا الحد)
 </span>
 </div>

 <div className="flex flex-wrap gap-2 pt-1">
 {CHUNK_SIZE_OPTIONS.map((opt) => {
 const active = maxPartSizeMb === opt.value;
 return (
 <button
 key={opt.value}
 type="button"
 onClick={() => setMaxPartSizeMb(opt.value)}
 className={cn(
 'px-3 py-1.5 rounded-md text-xs font-medium transition-all border',
 active
 ? 'bg-profit text-white border-profit shadow-sm'
 : 'bg-background hover:bg-muted text-foreground border-border'
 )}
 >
 {opt.label}
 </button>
 );
 })}
 </div>
 </div>

 {/* Options & Settings */}
 <div className="flex flex-wrap items-center gap-6 text-sm pt-1">
 <label className="flex items-center gap-2 cursor-pointer select-none">
 <Checkbox
 checked={uploadToGithub}
 onCheckedChange={(v) => setUploadToGithub(v === true)}
 />
 <span className="font-medium">رفع على GitHub مباشرة بعد الضغط</span>
 </label>
 <label className="flex items-center gap-2 cursor-pointer select-none">
 <Checkbox
 checked={pruneOld}
 onCheckedChange={(v) => setPruneOld(v === true)}
 />
 <span className="text-muted-foreground">حذف النسخ القديمة في data/ الأقدم من 30 يوماً</span>
 </label>
 </div>

 {/* NEW (Task PUSH-STRATEGY-2026-10-06): خيارات الرفع المتقدمة */}
 {uploadToGithub && (
 <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3 mt-1">
 <div className="flex items-center justify-between">
 <h4 className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-2">
 <ShieldAlert className="w-4 h-4" />
 خيارات الرفع المتقدمة (لحالات الطوارئ)
 </h4>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setShowAdvancedPush(!showAdvancedPush)}
 className="h-7 px-2 text-xs"
 >
 {showAdvancedPush ? 'إخفاء' : 'إظهار'}
 </Button>
 </div>

 {/* Git Status */}
 {gitStatus && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <div className="rounded border bg-background p-2">
 <div className="text-muted-foreground">الفرع الحالي</div>
 <div className="font-mono">{gitStatus.current_branch}</div>
 </div>
 <div className="rounded border bg-background p-2">
 <div className="text-muted-foreground">ahead / behind</div>
 <div className="font-mono">
 <span className="text-profit">↑{gitStatus.ahead}</span>
 <span className="mx-1 text-muted-foreground">/</span>
 <span className="text-loss">↓{gitStatus.behind}</span>
 </div>
 </div>
 <div className="rounded border bg-background p-2">
 <div className="text-muted-foreground">rebase / merge</div>
 <div className="font-mono">
 {gitStatus.rebase_in_progress || gitStatus.merge_in_progress ? (
 <span className="text-loss">⚠️ في progress</span>
 ) : (
 <span className="text-profit">✓ نظيف</span>
 )}
 </div>
 </div>
 <div className="rounded border bg-background p-2">
 <div className="text-muted-foreground">unpushed</div>
 <div className="font-mono">{gitStatus.unpushed_commits.length} commits</div>
 </div>
 </div>
 )}

 {showAdvancedPush && (
 <>
 {/* استراتيجية الرفع */}
 <div className="space-y-2">
 <label className="text-xs font-medium text-muted-foreground">استراتيجية الرفع</label>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 {([
 { id: 'fetch_rebase', label: 'fetch + rebase', desc: 'آمن — يدمج remote ثم يرفع' },
 { id: 'fetch_merge', label: 'fetch + merge', desc: 'يحافظ على التاريخ' },
 { id: 'force_push', label: '⚠️ force push', desc: 'خطير — يمسح الـ remote' },
 { id: 'no_pull', label: 'رفع بدون مزامنة', desc: 'لو الـ fetch فشل' },
 ] as const).map(opt => (
 <label
 key={opt.id}
 className={cn(
 'flex flex-col gap-1 rounded border p-2 cursor-pointer hover:bg-accent',
 pushStrategy === opt.id
 ? 'border-violet-500 bg-violet-500/10'
 : 'border-border'
 )}
 >
 <input
 type="radio"
 name="push_strategy"
 value={opt.id}
 checked={pushStrategy === opt.id}
 onChange={() => setPushStrategy(opt.id)}
 className="sr-only"
 />
 <span className="font-medium">{opt.label}</span>
 <span className="text-muted-foreground text-xs">{opt.desc}</span>
 </label>
 ))}
 </div>
 </div>

 {/* خيارات إضافية */}
 <div className="flex flex-wrap gap-4 text-xs">
 <label className="flex items-center gap-2 cursor-pointer">
 <Checkbox
 checked={rollbackLastCommit}
 onCheckedChange={(v) => setRollbackLastCommit(v === true)}
 />
 <span>↩️ التراجع عن آخر commit قبل الرفع (soft reset)</span>
 </label>
 </div>

 {/* أزرار الطوارئ */}
 <div className="flex flex-wrap gap-2 pt-2 border-t border-violet-500/20">
 <Button
 onClick={handleAbort}
 disabled={busy}
 variant="destructive"
 size="sm"
 className="gap-2"
 >
 <ShieldAlert className="w-3.5 h-3.5" />
 إيقاف اجباري (abort rebase/merge)
 </Button>
 <Button
 onClick={handleRollback}
 disabled={busy}
 variant="outline"
 size="sm"
 className="gap-2"
 >
 <RefreshCw className="w-3.5 h-3.5" />
 تراجع عن آخر commit
 </Button>
 <Button
 onClick={fetchGitStatus}
 disabled={busy}
 variant="ghost"
 size="sm"
 className="gap-2"
 >
 <RefreshCw className="w-3.5 h-3.5" />
 تحديث الحالة
 </Button>
 </div>
 </>
 )}
 </div>
 )}

 {/* Action Buttons */}
 <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border/40">
 <Button
 onClick={() => handleExecuteBackup(uploadToGithub)}
 disabled={busy || selectedDbs.size === 0}
 className="gap-2 bg-profit hover:bg-profit text-white"
 >
 {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
 {busy
 ? busyLabel
 : uploadToGithub
 ? `ضغط (${selectedSummary.count}) قواعد ورفعها لـ GitHub`
 : `ضغط (${selectedSummary.count}) قواعد فقط`}
 </Button>

 {!uploadToGithub && (
 <Button
 onClick={() => handleExecuteBackup(true)}
 disabled={busy || selectedDbs.size === 0}
 variant="outline"
 className="gap-2"
 >
 <Github className="w-4 h-4 text-violet-500" />
 ضغط + رفع على GitHub
 </Button>
 )}

 <Button
 onClick={openDeleteModalForSelected}
 disabled={busy || selectedDbs.size === 0}
 variant="destructive"
 className="gap-2 mr-auto"
 >
 <Trash2 className="w-4 h-4" />
 حذف القواعد المحددة ({selectedSummary.count})
 </Button>
 </div>

 {/* Summary Cards */}
 {data && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
 <SummaryStat
 icon={<Database className="w-4 h-4 text-profit" />}
 label="إجمالي قواعد البيانات"
 value={`${data.summary.total_dbs} قاعدة`}
 subValue={`${parseFloat(data.summary.total_size_mb).toFixed(1)} MB الكلي`}
 />
 <SummaryStat
 icon={<CheckSquare className="w-4 h-4 text-sky-500" />}
 label="القواعد المحددة للعمليات"
 value={`${selectedSummary.count} من ${dbs.length}`}
 subValue={`الحجم: ${selectedSummary.mb} MB`}
 />
 <SummaryStat
 icon={<Layers className="w-4 h-4 text-indigo-500" />}
 label="أقصى حجم للتجزئة"
 value={`${maxPartSizeMb} MB`}
 subValue="حد أمان GitHub"
 />
 <SummaryStat
 icon={<FileArchive className="w-4 h-4 text-warning" />}
 label="الأرشيفات في data/"
 value={`${data.summary.total_archives} أرشيف`}
 subValue="جاهزة أو مرفوعة"
 />
 </div>
 )}
 </CardContent>
 </Card>

 {/* Database Files Table */}
 <Card className="border-border/70 shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
 <div>
 <CardTitle className="text-base flex items-center gap-2">
 <Database className="w-4 h-4 text-profit" />
 قواعد البيانات المتاحة ({dbs.length})
 </CardTitle>
 <CardDescription className="text-xs mt-0.5">
 اختر القواعد المراد نسخها احتياطياً أو احذف الملفات القديمة غير المستخدمة.
 </CardDescription>
 </div>

 {/* Selection Quick Buttons */}
 <div className="flex flex-wrap items-center gap-1.5">
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
 className="h-8 text-xs gap-1.5"
 >
 {isAllSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5 text-profit" />}
 {isAllSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
 </Button>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 onClick={handleSelectCoreOnly}
 className="h-8 text-xs text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40"
 >
 الأساسية فقط
 </Button>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 onClick={handleSelectNonCore}
 className="h-8 text-xs text-warning hover:bg-warning dark:hover:bg-warning/40"
 >
 غير الأساسية / القديمة
 </Button>
 </div>
 </div>
 </CardHeader>

 <CardContent>
 {loading && dbs.length === 0 ? (
 <div className="space-y-2">
 {Array.from({ length: 5 }).map((_, i) => (
 <Skeleton key={i} className="h-11 w-full" />
 ))}
 </div>
 ) : dbs.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 لا توجد قواعد بيانات في مجلد <code className="text-xs bg-muted px-1 rounded">db/</code>
 </div>
 ) : (
 <div className="max-h-[460px] overflow-y-auto border rounded-md [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10 border-b">
 <tr className="text-right">
 <th className="p-2.5 w-10 text-center">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={(v) => (v ? handleSelectAll() : handleDeselectAll())}
 aria-label="تحديد الكل"
 />
 </th>
 <th className="p-2.5 font-medium">اسم قاعدة البيانات</th>
 <th className="p-2.5 font-medium">الحجم</th>
 <th className="p-2.5 font-medium">النوع</th>
 <th className="p-2.5 font-medium">آخر تعديل</th>
 <th className="p-2.5 font-medium text-center">الإجراءات</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border/40">
 {dbs.map((db) => {
 const sizeMb = parseFloat(db.size_mb);
 const isHuge = sizeMb > 200;
 const isMedium = sizeMb > 50 && !isHuge;
 const isSelected = selectedDbs.has(db.name);

 return (
 <tr
 key={db.name}
 onClick={() => handleToggleDb(db.name)}
 className={cn(
 'hover:bg-muted/40 cursor-pointer transition-colors',
 isSelected && 'bg-profit/5 /10'
 )}
 >
 <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
 <Checkbox
 checked={isSelected}
 onCheckedChange={() => handleToggleDb(db.name)}
 aria-label={`تحديد ${db.name}`}
 />
 </td>
 <td className="p-2.5 font-mono text-xs font-semibold" dir="ltr">
 {db.name}
 </td>
 <td className="p-2.5 whitespace-nowrap">
 <span
 className={cn(
 'font-medium text-xs',
 isHuge ? 'text-loss font-bold' : isMedium ? 'text-warning font-bold' : ''
 )}
 >
 {sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(2)} GB` : `${db.size_mb} MB`}
 </span>
 </td>
 <td className="p-2.5 whitespace-nowrap">
 {db.is_core ? (
 <Badge variant="outline" className="bg-profit/10 text-profit border-profit/30 text-xs">
 أساسية للنظام
 </Badge>
 ) : (
 <Badge variant="secondary" className="text-xs text-muted-foreground">
 إضافية / أرشيف
 </Badge>
 )}
 </td>
 <td className="p-2.5 text-xs text-muted-foreground whitespace-nowrap">
 {formatRelative(db.modified)}
 </td>
 <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
 <Button
 type="button"
 variant="ghost"
 size="icon"
 onClick={() => openDeleteModalForSingle(db)}
 className="size-7 text-muted-foreground hover:text-loss hover:bg-loss dark:hover:bg-loss/40"
 title="حذف قاعدة البيانات"
 >
 <Trash2 className="w-3.5 h-3.5" />
 </Button>
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

 {/* Existing Archives Table in data/ */}
 <Card className="border-border/70 shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="text-base flex items-center gap-2">
 <FileArchive className="w-4 h-4 text-warning" />
 الأرشيفات الموجودة في <code className="text-xs bg-muted px-1 rounded">data/</code> ({archives.length})
 </CardTitle>
 {archives.length > 0 && (
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={openDeleteModalForAllArchives}
 className="h-7 text-xs text-loss hover:text-loss hover:bg-loss dark:hover:bg-loss/40 border-loss "
 >
 <Trash2 className="w-3 h-3 ml-1" />
 حذف كل الأرشيفات
 </Button>
 )}
 </div>
 </CardHeader>
 <CardContent>
 {archives.length === 0 ? (
 <div className="text-center py-6 text-muted-foreground text-sm">
 <AlertCircle className="w-7 h-7 mx-auto mb-1.5 opacity-50 text-warning" />
 لا توجد ملفات أرشيف في <code className="text-xs bg-muted px-1 rounded">data/</code>. اضغط زر الضغط بالأعلى لإنشاء نسخة جديدة.
 </div>
 ) : (
 <div className="max-h-64 overflow-y-auto border rounded-md [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10 border-b">
 <tr className="text-right">
 <th className="p-2.5 font-medium">اسم الأرشيف</th>
 <th className="p-2.5 font-medium">الحجم</th>
 <th className="p-2.5 font-medium">النوع</th>
 <th className="p-2.5 font-medium">تاريخ الإنشاء</th>
 <th className="p-2.5 font-medium text-center">حذف</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border/40">
 {archives.map((arc) => (
 <tr key={arc.name} className="hover:bg-muted/30 transition-colors">
 <td className="p-2.5 font-mono text-xs" dir="ltr">
 {arc.name}
 </td>
 <td className="p-2.5 whitespace-nowrap">
 <Badge variant="secondary" className="font-mono text-xs">
 {arc.size_mb} MB
 </Badge>
 </td>
 <td className="p-2.5 whitespace-nowrap">
 {arc.is_part ? (
 <Badge variant="outline" className="text-xs text-sky-600 border-sky-400">
 جزء مجزأ (Part)
 </Badge>
 ) : (
 <Badge variant="outline" className="text-xs text-muted-foreground">
 أرشيف كامل
 </Badge>
 )}
 </td>
 <td className="p-2.5 text-xs text-muted-foreground whitespace-nowrap">
 {formatRelative(arc.created)}
 </td>
 <td className="p-2.5 text-center">
 <Button
 type="button"
 variant="ghost"
 size="icon"
 onClick={() => openDeleteModalForArchive(arc)}
 className="size-7 text-muted-foreground hover:text-loss hover:bg-loss dark:hover:bg-loss/40"
 title="حذف هذا الأرشيف"
 >
 <Trash2 className="w-3.5 h-3.5" />
 </Button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </CardContent>
 </Card>

 {/* Confirmation Dialog for File Deletion */}
 <Dialog open={!!deleteModal} onOpenChange={(open) => !open && setDeleteModal(null)}>
 <DialogContent className="max-w-md" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-loss">
 <AlertTriangle className="w-5 h-5 text-loss" />
 تأكيد حذف {deleteModal?.targetType === 'database' ? 'قواعد البيانات' : 'ملفات الأرشيف'}
 </DialogTitle>
 <DialogDescription className="text-sm pt-2">
 هل أنت متأكد من رغبتك في حذف الملفات التالية؟ هذه العملية نهائية ولا يمكن التراجع عنها.
 </DialogDescription>
 </DialogHeader>

 {deleteModal?.hasCore && (
 <div className="p-3 rounded-md bg-loss/10 border border-loss/30 flex items-start gap-2.5 text-loss text-xs leading-relaxed">
 <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-loss" />
 <div>
 <strong>تحذير أمني:</strong> تحتوي القائمة على قاعدة بيانات أساسية لنظام المنصة (مثل stocks.db أو auth.db أو price_history.db). حذفها قد يؤثر على تشغيل النظام إذا لم تكن تملك نسخة احتياطية!
 </div>
 </div>
 )}

 <div className="space-y-2">
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>الملفات المحددة ({deleteModal?.fileNames.length}):</span>
 <span>المساحة المحررة: <strong>{deleteModal?.totalMb} MB</strong></span>
 </div>
 <div className="max-h-36 overflow-y-auto border rounded bg-muted/30 p-2 font-mono text-xs space-y-1" dir="ltr">
 {deleteModal?.fileNames.map((f) => (
 <div key={f} className="text-foreground/80 flex items-center justify-between">
 <span>• {f}</span>
 </div>
 ))}
 </div>
 </div>

 <DialogFooter className="gap-2 sm:gap-0">
 <Button
 type="button"
 variant="outline"
 onClick={() => setDeleteModal(null)}
 disabled={busy}
 >
 إلغاء
 </Button>
 <Button
 type="button"
 variant="destructive"
 onClick={handleConfirmDelete}
 disabled={busy}
 className="gap-2"
 >
 {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
 تأكيد الحذف نهائياً
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

/* ------------------------------------------------------------------ */
/* Small presentational helper */
/* ------------------------------------------------------------------ */

function SummaryStat({
 icon,
 label,
 value,
 subValue,
}: {
 icon: React.ReactNode;
 label: string;
 value: string;
 subValue?: string;
}) {
 return (
 <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs text-muted-foreground">{label}</span>
 {icon}
 </div>
 <div className="text-lg font-bold">{value}</div>
 {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
 </div>
 );
}

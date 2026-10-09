'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Database, HardDrive, Upload, RefreshCw, Loader2, Archive,
  CheckCircle2, AlertCircle, Trash2, Github, FileArchive,
  Layers, CheckSquare, Square, AlertTriangle, ShieldAlert,
  Terminal, Copy, Download, Search, XCircle, StopCircle,
  FileText, ChevronDown, ChevronUp, Sparkles, Check,
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

interface DeleteModalState {
  open: boolean;
  targetType: 'database' | 'archive';
  fileNames: string[];
  totalMb: string;
  hasCore: boolean;
}

export interface ConsoleLogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'step' | 'success' | 'warn' | 'error' | 'git';
  step: string;
  message: string;
  progress: number;
  details?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const CHUNK_SIZE_OPTIONS = [
  { value: 25, label: '25 MB' },
  { value: 50, label: '50 MB' },
  { value: 60, label: '60 MB (موصى به)', isDefault: true },
  { value: 80, label: '80 MB' },
  { value: 95, label: '95 MB (حد أقصى لـ GitHub)' },
];

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

/* ------------------------------------------------------------------ */
/*  Component                                                         */
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

  // Advanced push options
  type PushStrategy = 'fetch_rebase' | 'fetch_merge' | 'force_push' | 'no_pull';
  const [pushStrategy, setPushStrategy] = useState<PushStrategy>('fetch_merge');
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

  // Live Console State
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [currentStepName, setCurrentStepName] = useState<string>('جاهز');
  const [consoleFilter, setConsoleFilter] = useState<'all' | 'error' | 'git' | 'step'>('all');
  const [consoleSearch, setConsoleSearch] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [showConsole, setShowConsole] = useState<boolean>(true);
  const [expandedDetails, setExpandedDetails] = useState<Set<number>>(new Set());
  const [hasCopiedLogs, setHasCopiedLogs] = useState(false);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Deletion modal
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);

  // Auto scroll console
  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs, autoScroll]);

  // 1. Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/db-backup', { credentials: 'same-origin' });
      const json: BackupResponse | { success: false; error: string } = await res.json();
      if (json.success) {
        const resp = json as BackupResponse;
        setData(resp);
        // Default: Select core active databases to prevent multi-GB overload by default
        setSelectedDbs((prev) => {
          if (prev.size === 0) {
            const core = resp.databases.filter((d) => d.is_core).map((d) => d.name);
            return new Set(core.length > 0 ? core : resp.databases.map((d) => d.name));
          }
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

  // Fetch git status
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
      // silent
    }
  }, []);

  useEffect(() => {
    fetchGitStatus();
  }, [fetchGitStatus]);

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

  const handleToggleArchive = (name: string) => {
    setSelectedArchives((prev) => {
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

  // ------------------------------------------------------------------
  //  Live Streaming Backup Execution (with Real-time Console)
  // ------------------------------------------------------------------
  const handleExecuteBackup = async (pushToGithub: boolean, onlyExisting = false) => {
    if (!onlyExisting && selectedDbs.size === 0) {
      toast.error('يرجى تحديد قاعدة بيانات واحدة على الأقل للنسخ الاحتياطي');
      return;
    }
    if (onlyExisting && selectedArchives.size === 0 && archives.length === 0) {
      toast.error('لا توجد أرشيفات في مجلد data/ لرفعها');
      return;
    }

    setBusy(true);
    setCurrentStage('running');
    setProgress(5);
    setCurrentStepName(onlyExisting ? 'تجهيز الأرشيفات للرفع' : 'فحص القواعد والتجهيز');
    setShowConsole(true);
    setBusyLabel(onlyExisting ? 'جاري رفع الأرشيفات المحددة إلى GitHub...' : pushToGithub ? 'جاري الضغط والتجزئة والرفع إلى GitHub...' : 'جاري ضغط وتجزئة القواعد المحددة...');

    // Clear previous logs or start fresh session
    const startNotice: ConsoleLogEntry = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString('ar-EG', { hour12: false }),
      level: 'step',
      step: 'start',
      message: onlyExisting
        ? `🚀 بدء عملية الرفع المباشر للأرشيفات الموجودة إلى GitHub (${selectedArchives.size || archives.length} ملف)`
        : `🚀 بدء عملية ${pushToGithub ? 'الضغط والتجزئة والرفع إلى GitHub' : 'الضغط والتجزئة المحلية'} (${selectedSummary.count} قواعد - ${selectedSummary.mb} MB)`,
      progress: 5,
    };
    setConsoleLogs([startNotice]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/admin/db-backup/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({
          upload_to_github: pushToGithub,
          only_upload_existing: onlyExisting,
          selected_dbs: Array.from(selectedDbs),
          selected_archives: selectedArchives.size > 0 ? Array.from(selectedArchives) : undefined,
          max_part_size_mb: maxPartSizeMb,
          prune_older_than_days: pruneOld ? 30 : 0,
          push_strategy: pushStrategy,
          rollback_last_commit: rollbackLastCommit || undefined,
          delete_remote_archives_before_push: deleteRemoteBeforePush.size > 0 ? Array.from(deleteRemoteBeforePush) : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`خطأ في استجابة الخادم: ${res.status} ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const chunk of parts) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'done') {
                if (event.success) {
                  setCurrentStage('success');
                  setProgress(100);
                  setCurrentStepName('اكتمل بنجاح');
                  toast.success(event.summary?.message || 'اكتملت العملية بنجاح!');
                } else {
                  setCurrentStage('error');
                  setCurrentStepName('حدث خطأ');
                  toast.error(event.summary?.error || 'فشلت العملية، راجع تفاصيل الأخطاء في الكونسول.');
                }
              } else if (event.message) {
                setConsoleLogs((prev) => [...prev, event]);
                if (typeof event.progress === 'number') {
                  setProgress(event.progress);
                }
                if (event.message) {
                  setCurrentStepName(event.message.slice(0, 35));
                }
              }
            } catch {
              // ignore json parse glitch
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        toast.info('تم إلغاء العملية بناءً على طلبك.');
        setConsoleLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString('ar-EG', { hour12: false }),
            level: 'warn',
            step: 'abort',
            message: '⚠️ تم إيقاف العملية بواسطة المستخدم.',
            progress: 100,
          },
        ]);
        setCurrentStage('error');
        setCurrentStepName('تم الإلغاء');
      } else {
        const errMsg = err?.message || 'خطأ غير متوقع في الاتصال بالخادم';
        toast.error(errMsg);
        setConsoleLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString('ar-EG', { hour12: false }),
            level: 'error',
            step: 'fatal',
            message: `❌ خطأ في الاتصال: ${errMsg}`,
            progress: 100,
            details: String(err?.stack || err),
          },
        ]);
        setCurrentStage('error');
        setCurrentStepName('فشل الاتصال');
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
      abortControllerRef.current = null;
      fetchData();
      fetchGitStatus();
    }
  };

  const handleCancelRunning = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Emergency Git Actions
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

  // Deletion modal triggers
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

  const openDeleteModalForSelectedArchives = () => {
    if (selectedArchives.size === 0) {
      toast.error('يرجى تحديد ملفات أرشيف من الجدول لحذفها');
      return;
    }
    const files = archives.filter((a) => selectedArchives.has(a.name));
    const totalBytes = files.reduce((s, a) => s + a.size_bytes, 0);
    setDeleteModal({
      open: true,
      targetType: 'archive',
      fileNames: files.map((a) => a.name),
      totalMb: (totalBytes / 1024 / 1024).toFixed(1),
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

      const json = await res.json();
      if (json.success) {
        toast.success(`تم حذف ${json.deleted_count} ملف بنجاح، وتم تحرير ${json.freed_mb} MB.`);
        setDeleteModal(null);
        setSelectedArchives(new Set());
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

  // Console tools
  const handleCopyLogs = () => {
    const text = consoleLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.details ? `\n--> Details: ${l.details}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setHasCopiedLogs(true);
    setTimeout(() => setHasCopiedLogs(false), 2000);
    toast.success('تم نسخ سجل الكونسول كاملاً إلى الحافظة.');
  };

  const handleDownloadLogs = () => {
    const text = consoleLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}${l.details ? `\n--> Details: ${l.details}` : ''}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_console_log_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('تم تنزيل ملف السجل بنجاح.');
  };

  const handleClearConsole = () => {
    setConsoleLogs([]);
    setCurrentStage('idle');
    setProgress(0);
    setCurrentStepName('جاهز');
    toast.info('تم مسح سجل الكونسول.');
  };

  const toggleDetails = (id: number) => {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filtered console logs
  const filteredLogs = useMemo(() => {
    return consoleLogs.filter((log) => {
      if (consoleFilter === 'error' && log.level !== 'error' && log.level !== 'warn') return false;
      if (consoleFilter === 'git' && log.level !== 'git' && !log.step.includes('git')) return false;
      if (consoleFilter === 'step' && log.level !== 'step') return false;
      if (consoleSearch.trim()) {
        const q = consoleSearch.toLowerCase();
        return (
          log.message.toLowerCase().includes(q) ||
          log.step.toLowerCase().includes(q) ||
          (log.details && log.details.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [consoleLogs, consoleFilter, consoleSearch]);

  const errorCount = useMemo(() => consoleLogs.filter((l) => l.level === 'error').length, [consoleLogs]);
  const warnCount = useMemo(() => consoleLogs.filter((l) => l.level === 'warn').length, [consoleLogs]);

  const isAllSelected = dbs.length > 0 && selectedDbs.size === dbs.length;
  const isTooLarge = Number(selectedSummary.mb) > 350;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header & Main Control Card */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl flex items-center gap-2.5">
                <Archive className="w-6 h-6 text-emerald-500" />
                النسخ الاحتياطي لقواعد البيانات وإدارتها + رفع GitHub
              </CardTitle>
              <CardDescription className="text-sm mt-1">
                ضغط وتجزئة قواعد البيانات تلقائياً وتفادي حدود GitHub مع متابعة سير العمل والأخطاء عبر كونسول تفاعلي مباشر.
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
                تحديث البيانات
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
                (الملفات الضخمة تُقسّم تلقائياً لأجزاء تحت هذا الحد لتفادي حد 100MB في GitHub)
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
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
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

          {/* Advanced Push Options */}
          {uploadToGithub && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3 mt-1">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  خيارات مزامنة ورفع Git المتقدمة
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvancedPush(!showAdvancedPush)}
                  className="h-7 px-2 text-xs"
                >
                  {showAdvancedPush ? 'إخفاء الخيارات' : 'إظهار الخيارات المتقدمة'}
                </Button>
              </div>

              {/* Git Status Bar */}
              {gitStatus && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="rounded border bg-background p-2">
                    <div className="text-muted-foreground">الفرع الحالي</div>
                    <div className="font-mono font-bold text-violet-600 dark:text-violet-400">{gitStatus.current_branch}</div>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <div className="text-muted-foreground">ahead / behind</div>
                    <div className="font-mono">
                      <span className="text-emerald-600 font-bold">↑{gitStatus.ahead}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-rose-600 font-bold">↓{gitStatus.behind}</span>
                    </div>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <div className="text-muted-foreground">حالة الـ Rebase/Merge</div>
                    <div className="font-mono">
                      {gitStatus.rebase_in_progress || gitStatus.merge_in_progress ? (
                        <span className="text-rose-600 font-bold">⚠️ في progress</span>
                      ) : (
                        <span className="text-emerald-600">✓ نظيف</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <div className="text-muted-foreground">Unpushed Commits</div>
                    <div className="font-mono">{gitStatus.unpushed_commits.length} commits</div>
                  </div>
                </div>
              )}

              {showAdvancedPush && (
                <>
                  {/* استراتيجية الرفع */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">استراتيجية التعامل مع التحديثات البعيدة (Remote)</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {([
                        { id: 'fetch_merge', label: 'fetch + merge (موصى به)', desc: 'آمن للدمج ويحافظ على تاريخ Git' },
                        { id: 'fetch_rebase', label: 'fetch + rebase', desc: 'يرتب التاريخ خطياً' },
                        { id: 'no_pull', label: 'رفع بدون مزامنة', desc: 'تجاوز جلب التعديلات البعيدة' },
                        { id: 'force_push', label: '⚠️ force push', desc: 'يستبدل فرع GitHub بالقوة' },
                      ] as const).map((opt) => (
                        <label
                          key={opt.id}
                          className={cn(
                            'flex flex-col gap-1 rounded border p-2 cursor-pointer hover:bg-accent transition-all',
                            pushStrategy === opt.id
                              ? 'border-violet-500 bg-violet-500/15 shadow-sm'
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
                          <span className="font-semibold">{opt.label}</span>
                          <span className="text-muted-foreground text-[10px]">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* خيارات إضافية */}
                  <div className="flex flex-wrap gap-4 text-xs pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={rollbackLastCommit}
                        onCheckedChange={(v) => setRollbackLastCommit(v === true)}
                      />
                      <span>↩️ التراجع عن آخر commit محلي قبل الرفع (soft reset)</span>
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
                      إلغاء أي Rebase/Merge عالق (Abort)
                    </Button>
                    <Button
                      onClick={handleRollback}
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      تراجع عن آخر Commit محلي
                    </Button>
                    <Button
                      onClick={fetchGitStatus}
                      disabled={busy}
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      تحديث حالة Git
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Size Warning Banner if selected > 350MB */}
          {isTooLarge && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <strong>تنبيه حجم كبير:</strong> إجمالي القواعد المحددة {selectedSummary.mb} MB. سيقوم النظام بتجزئة الملفات تلقائياً لأجزاء تحت {maxPartSizeMb} MB حتى لا يرفضها GitHub. يمكنك أيضاً تقليل التحديد للتركيز على القواعد الأساسية فقط.
              </div>
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border/40">
            {/* 1. ضغط ورفع لـ GitHub */}
            <Button
              onClick={() => handleExecuteBackup(uploadToGithub, false)}
              disabled={busy || selectedDbs.size === 0}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              {busy
                ? busyLabel
                : uploadToGithub
                  ? `ضغط (${selectedSummary.count}) قواعد ورفعها لـ GitHub`
                  : `ضغط (${selectedSummary.count}) قواعد فقط`}
            </Button>

            {/* 2. ضغط فقط (لو الزر الأساسي ليس ضغط فقط) */}
            {uploadToGithub && (
              <Button
                onClick={() => handleExecuteBackup(false, false)}
                disabled={busy || selectedDbs.size === 0}
                variant="outline"
                className="gap-2"
              >
                <FileArchive className="w-4 h-4 text-emerald-600" />
                ضغط وتجزئة محلياً فقط
              </Button>
            )}

            {/* 3. رفع الأرشيفات الموجودة فقط دون ضغط جديد */}
            {archives.length > 0 && (
              <Button
                onClick={() => handleExecuteBackup(true, true)}
                disabled={busy}
                variant="secondary"
                className="gap-2 border text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
              >
                <Github className="w-4 h-4 text-violet-500" />
                {selectedArchives.size > 0
                  ? `رفع الأرشيفات المحددة (${selectedArchives.size}) لـ GitHub`
                  : `رفع جميع الأرشيفات الموجودة (${archives.length}) لـ GitHub`}
              </Button>
            )}

            {/* إلغاء العملية أثناء التشغيل */}
            {busy && (
              <Button
                onClick={handleCancelRunning}
                variant="destructive"
                size="sm"
                className="gap-1.5"
              >
                <StopCircle className="w-4 h-4" />
                إلغاء العملية
              </Button>
            )}

            <Button
              onClick={openDeleteModalForSelected}
              disabled={busy || selectedDbs.size === 0}
              variant="ghost"
              className="gap-2 mr-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="w-4 h-4" />
              حذف القواعد المحددة ({selectedSummary.count})
            </Button>
          </div>

          {/* Summary Stat Cards */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <SummaryStat
                icon={<Database className="w-4 h-4 text-emerald-500" />}
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
                icon={<FileArchive className="w-4 h-4 text-amber-500" />}
                label="الأرشيفات في data/"
                value={`${data.summary.total_archives} أرشيف`}
                subValue="جاهزة أو مرفوعة"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/*  LIVE INTERACTIVE CONSOLE (سير العمل ومتابعة الأخطاء في الوقت الفعلي) */}
      {/* ================================================================== */}
      <Card className="border-border/80 shadow-md overflow-hidden bg-slate-950 text-slate-100">
        {/* Console Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 gap-3">
          <div className="flex items-center gap-3">
            {/* Terminal Window Dots */}
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span className="font-mono text-sm font-bold text-slate-200">
                كونسول سير العمل والتشخيص المباشر
              </span>
            </div>

            {/* Status Pill */}
            {currentStage === 'running' && (
              <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/40 text-[11px] gap-1 animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                قيد التنفيذ ({progress}%)
              </Badge>
            )}
            {currentStage === 'success' && (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[11px] gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                اكتمل بنجاح
              </Badge>
            )}
            {currentStage === 'error' && (
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[11px] gap-1">
                <XCircle className="w-3 h-3 text-rose-400" />
                توقف عند خطأ
              </Badge>
            )}
            {currentStage === 'idle' && (
              <Badge variant="outline" className="text-slate-400 border-slate-700 text-[11px]">
                في وضع الاستعداد
              </Badge>
            )}
          </div>

          {/* Console Actions Toolbar */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Filter Tabs */}
            <div className="flex rounded-md bg-slate-800/80 p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setConsoleFilter('all')}
                className={cn(
                  'px-2 py-1 rounded text-[11px] transition-all',
                  consoleFilter === 'all' ? 'bg-slate-700 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                الكل ({consoleLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setConsoleFilter('error')}
                className={cn(
                  'px-2 py-1 rounded text-[11px] transition-all flex items-center gap-1',
                  consoleFilter === 'error' ? 'bg-red-950 text-red-200 font-medium' : 'text-slate-400 hover:text-red-300'
                )}
              >
                الأخطاء
                {errorCount > 0 && (
                  <span className="px-1 py-0.2 bg-red-600 text-white text-[9px] rounded-full">
                    {errorCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setConsoleFilter('git')}
                className={cn(
                  'px-2 py-1 rounded text-[11px] transition-all',
                  consoleFilter === 'git' ? 'bg-violet-950 text-violet-200 font-medium' : 'text-slate-400 hover:text-violet-300'
                )}
              >
                Git
              </button>
            </div>

            {/* Copy Logs */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyLogs}
              disabled={consoleLogs.length === 0}
              className="h-7 px-2 text-slate-300 hover:text-white hover:bg-slate-800 gap-1 text-xs"
              title="نسخ السجل"
            >
              {hasCopiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {hasCopiedLogs ? 'تم النسخ' : 'نسخ'}
            </Button>

            {/* Download Logs */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownloadLogs}
              disabled={consoleLogs.length === 0}
              className="h-7 px-2 text-slate-300 hover:text-white hover:bg-slate-800 gap-1 text-xs"
              title="تنزيل السجل txt"
            >
              <Download className="w-3.5 h-3.5" />
              تنزيل
            </Button>

            {/* Clear Console */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearConsole}
              disabled={consoleLogs.length === 0 || busy}
              className="h-7 px-2 text-slate-400 hover:text-red-300 hover:bg-slate-800 gap-1 text-xs"
              title="مسح الكونسول"
            >
              <Trash2 className="w-3.5 h-3.5" />
              مسح
            </Button>

            {/* Auto Scroll Toggle */}
            <button
              type="button"
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                'h-7 px-2 rounded border text-[11px] transition-colors',
                autoScroll
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              )}
              title="التمرير التلقائي لأسفل السجل"
            >
              تمرير تلقائي: {autoScroll ? 'مفعّل' : 'متوقف'}
            </button>

            {/* Minimize / Expand Console */}
            <button
              type="button"
              onClick={() => setShowConsole(!showConsole)}
              className="h-7 px-1.5 text-slate-400 hover:text-slate-200"
            >
              {showConsole ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Live Progress Bar */}
        {showConsole && (
          <div className="w-full bg-slate-900 border-b border-slate-800 px-4 py-2">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-400 font-bold">{progress}%</span>
                <span>—</span>
                <span className="text-slate-200">{currentStepName}</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {consoleLogs.length} سجل | {errorCount} أخطاء | {warnCount} تحذيرات
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  currentStage === 'error'
                    ? 'bg-rose-500'
                    : currentStage === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-sky-500 to-emerald-500'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Console Body */}
        {showConsole && (
          <div className="p-4 space-y-2 font-mono text-xs">
            {/* Search filter inside console */}
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800/80">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="بحث وتصفية داخل سجل الكونسول..."
                value={consoleSearch}
                onChange={(e) => setConsoleSearch(e.target.value)}
                className="bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none w-full"
              />
              {consoleSearch && (
                <button
                  type="button"
                  onClick={() => setConsoleSearch('')}
                  className="text-slate-500 hover:text-slate-300 text-xs px-1"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Error Diagnostics Alert if any error occurred */}
            {errorCount > 0 && (
              <div className="p-3 rounded-md bg-red-950/40 border border-red-800/60 text-red-200 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-red-300">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  تم رصد أخطاء أثناء تنفيذ العملية:
                </div>
                <div className="text-[11px] text-red-300/90 leading-relaxed">
                  راجع الرسائل الحمراء أدناه. إذا كان الخطأ متعلقاً بـ GitHub (مثل Authentication Failed)، تأكد من صلاحية Personal Access Token في متغيرات البيئة. إذا كان الحجم كبيراً، استخدم تجزئة 50MB أو اختر قواعد أقل.
                </div>
              </div>
            )}

            {/* Console Log Lines */}
            <div className="max-h-[380px] overflow-y-auto space-y-1.5 pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-800 [&::-webkit-scrollbar-thumb]:rounded-full">
              {filteredLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-600">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                  <p>الكونسول جاهز لمتابعة سير العمل.</p>
                  <p className="text-[11px] mt-1 text-slate-600">
                    اضغط زر "ضغط ورفع لـ GitHub" أو "ضغط وتجزئة محلياً" لتبدأ المتابعة المباشرة لحظة بلحظة.
                  </p>
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedDetails.has(log.id);

                  let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
                  let icon = '•';

                  if (log.level === 'step') {
                    badgeColor = 'bg-sky-950/80 text-sky-300 border-sky-800';
                    icon = '⚡';
                  } else if (log.level === 'success') {
                    badgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
                    icon = '✓';
                  } else if (log.level === 'warn') {
                    badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
                    icon = '▲';
                  } else if (log.level === 'error') {
                    badgeColor = 'bg-red-950/90 text-red-300 border-red-800';
                    icon = '✕';
                  } else if (log.level === 'git') {
                    badgeColor = 'bg-violet-950/80 text-violet-300 border-violet-800';
                    icon = '🐙';
                  }

                  return (
                    <div
                      key={log.id}
                      className={cn(
                        'group rounded p-1.5 transition-colors border',
                        log.level === 'error'
                          ? 'bg-red-950/30 border-red-900/50 text-red-200'
                          : log.level === 'warn'
                            ? 'bg-amber-950/20 border-amber-900/40 text-amber-200'
                            : log.level === 'success'
                              ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-100'
                              : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          {/* Timestamp */}
                          <span className="text-[10px] text-slate-500 whitespace-nowrap mt-0.5 select-none font-mono" dir="ltr">
                            [{log.timestamp}]
                          </span>

                          {/* Level Badge */}
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.2 rounded border font-bold uppercase whitespace-nowrap select-none',
                              badgeColor
                            )}
                          >
                            {icon} {log.level}
                          </span>

                          {/* Step Identifier */}
                          <span className="text-[10px] text-slate-500 font-mono select-none">
                            [{log.step}]
                          </span>

                          {/* Message */}
                          <span className="text-xs leading-relaxed break-words font-sans">
                            {log.message}
                          </span>
                        </div>

                        {/* Toggle details if available */}
                        {log.details && (
                          <button
                            type="button"
                            onClick={() => toggleDetails(log.id)}
                            className="text-[10px] text-slate-400 hover:text-slate-200 underline whitespace-nowrap ml-1 shrink-0"
                          >
                            {isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                          </button>
                        )}
                      </div>

                      {/* Expandable Command/Stderr Details */}
                      {log.details && isExpanded && (
                        <div className="mt-2 p-2 rounded bg-black/60 border border-slate-800 font-mono text-[11px] text-slate-400 whitespace-pre-wrap break-all overflow-x-auto" dir="ltr">
                          {log.details}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        )}
      </Card>

      {/* ================================================================== */}
      {/*  AVAILABLE DATABASES TABLE (قواعد البيانات المتاحة) */}
      {/* ================================================================== */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-500" />
                قواعد البيانات المتاحة ({dbs.length})
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                اختر القواعد المراد نسخها احتياطياً. يوصى بالقواعد الأساسية فقط لتفادي التحميل الزائد وسرعة الرفع.
              </CardDescription>
            </div>

            {/* Selection Quick Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectCoreOnly}
                className="h-8 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-500/30 font-semibold"
              >
                <Sparkles className="w-3.5 h-3.5 ml-1 text-emerald-500" />
                الأساسية فقط (موصى به)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
                className="h-8 text-xs gap-1.5"
              >
                {isAllSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />}
                {isAllSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectNonCore}
                className="h-8 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
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
                          isSelected && 'bg-emerald-500/5 dark:bg-emerald-500/10'
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
                              isHuge ? 'text-red-500 font-bold' : isMedium ? 'text-amber-500 font-bold' : ''
                            )}
                          >
                            {sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(2)} GB` : `${db.size_mb} MB`}
                          </span>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {db.is_core ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[11px]">
                              أساسية للنظام
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[11px] text-muted-foreground">
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
                            className="size-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
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

      {/* ================================================================== */}
      {/*  EXISTING ARCHIVES TABLE (الأرشيفات الموجودة في data/) */}
      {/* ================================================================== */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-amber-500" />
                الأرشيفات الجاهزة في <code className="text-xs bg-muted px-1 rounded">data/</code> ({archives.length})
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                الملفات المضغوطة المتاحة للرفع أو الحذف. يمكنك تحديد أرشيفات معينة ورفعها مباشرة إلى GitHub.
              </CardDescription>
            </div>
            {archives.length > 0 && (
              <div className="flex items-center gap-2">
                {selectedArchives.size > 0 && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleExecuteBackup(true, true)}
                    disabled={busy}
                    className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1"
                  >
                    <Github className="w-3.5 h-3.5" />
                    رفع المحددة ({selectedArchives.size}) لـ GitHub
                  </Button>
                )}
                {selectedArchives.size > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openDeleteModalForSelectedArchives}
                    disabled={busy}
                    className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 border-red-200"
                  >
                    <Trash2 className="w-3 h-3 ml-1" />
                    حذف المحددة ({selectedArchives.size})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openDeleteModalForAllArchives}
                  disabled={busy}
                  className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 border-red-200 dark:border-red-900"
                >
                  <Trash2 className="w-3 h-3 ml-1" />
                  حذف الكل
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {archives.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <AlertCircle className="w-7 h-7 mx-auto mb-1.5 opacity-50 text-amber-500" />
              لا توجد ملفات أرشيف في <code className="text-xs bg-muted px-1 rounded">data/</code>. اضغط زر الضغط بالأعلى لإنشاء نسخة جديدة.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto border rounded-md [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10 border-b">
                  <tr className="text-right">
                    <th className="p-2.5 w-10 text-center">
                      <Checkbox
                        checked={archives.length > 0 && selectedArchives.size === archives.length}
                        onCheckedChange={(v) => {
                          if (v) setSelectedArchives(new Set(archives.map((a) => a.name)));
                          else setSelectedArchives(new Set());
                        }}
                        aria-label="تحديد كل الأرشيفات"
                      />
                    </th>
                    <th className="p-2.5 font-medium">اسم الأرشيف</th>
                    <th className="p-2.5 font-medium">الحجم</th>
                    <th className="p-2.5 font-medium">النوع</th>
                    <th className="p-2.5 font-medium">تاريخ الإنشاء</th>
                    <th className="p-2.5 font-medium text-center">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {archives.map((arc) => {
                    const isSelected = selectedArchives.has(arc.name);
                    return (
                      <tr
                        key={arc.name}
                        onClick={() => handleToggleArchive(arc.name)}
                        className={cn(
                          'hover:bg-muted/30 cursor-pointer transition-colors',
                          isSelected && 'bg-violet-500/5 dark:bg-violet-500/10'
                        )}
                      >
                        <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleArchive(arc.name)}
                            aria-label={`تحديد ${arc.name}`}
                          />
                        </td>
                        <td className="p-2.5 font-mono text-xs font-semibold" dir="ltr">
                          {arc.name}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {arc.size_mb} MB
                          </Badge>
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          {arc.is_part ? (
                            <Badge variant="outline" className="text-[10px] text-sky-600 border-sky-400">
                              جزء مجزأ (Part)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              أرشيف كامل
                            </Badge>
                          )}
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelative(arc.created)}
                        </td>
                        <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteModalForArchive(arc)}
                            className="size-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            title="حذف هذا الأرشيف"
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

      {/* Confirmation Dialog for File Deletion */}
      <Dialog open={!!deleteModal} onOpenChange={(open) => !open && setDeleteModal(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              تأكيد حذف {deleteModal?.targetType === 'database' ? 'قواعد البيانات' : 'ملفات الأرشيف'}
            </DialogTitle>
            <DialogDescription className="text-sm pt-2">
              هل أنت متأكد من رغبتك في حذف الملفات التالية؟ هذه العملية نهائية ولا يمكن التراجع عنها.
            </DialogDescription>
          </DialogHeader>

          {deleteModal?.hasCore && (
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/30 flex items-start gap-2.5 text-red-700 dark:text-red-400 text-xs leading-relaxed">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
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
/*  Small presentational helper                                       */
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
      {subValue && <div className="text-[11px] text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

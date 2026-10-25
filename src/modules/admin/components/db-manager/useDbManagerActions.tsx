'use client';

/**
 * db-manager/useDbManagerActions.ts
 * =====================================
 * Custom hook that owns ALL state + handlers for the Database Manager UI.
 *
 * Extracted from the original DatabaseManagerFull.tsx so the container component
 * can stay under 500 LOC. The hook encapsulates:
 *   - UI state (selectedDb, activeTab, page, sortBy, sortDir, search)
 *   - SQL Console state (sql, dryRun, queryResult, queryError, history)
 *   - Backups tab state (backups list + loading + error)
 *   - Maintenance tab state (loading, result)
 *   - Recovery tools state (recoverLoading, recoverResult)
 *   - Advanced ops state (advancedLoading, advancedOutput)
 *   - Bulk ops state (bulkLoading, importFile, importResult)
 *   - Daily backups state (dailyBackups, dailyRestoreResult)
 *   - Global confirmation dialog state (confirm, confirmBusy)
 *   - All fetch handlers + mutations
 *
 * Data fetching for databases/tables/rows/schema is delegated to the existing
 * useDatabaseManagerData hook (Strangler Pattern F-Strangler-DBManager).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useDatabaseManagerData } from '@/hooks/useDatabaseManagerData';

import { HISTORY_KEY, loadHistory, saveHistory } from './helpers';
import type {
  BackupFile,
  ConfirmState,
  HistoricalBackup,
  ImportResult,
  MaintenanceResult,
  QueryResult,
  RecoverResult,
  TabKey,
} from './types';

export function useDbManagerActions() {
  // -------------------------------------------------------------------------
  // UI state (owned by component — Strangler Pattern F-Strangler-DBManager).
  // -------------------------------------------------------------------------
  const [search, setSearch] = useState('');
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Data state (owned by useDatabaseManagerData hook).
  const {
    databases,
    dbsLoading,
    dbsError,
    refetchDatabases,
    tables,
    tablesLoading,
    tablesError,
    refetchTables,
    tableRows,
    rowsLoading,
    rowsError,
    refetchRows,
    schema,
    schemaOpen,
    setSchemaOpen,
    fetchSchema,
  } = useDatabaseManagerData({
    selectedDb,
    selectedTable,
    page,
    sortBy,
    sortDir,
    tablesEnabled: activeTab === 'tables',
    onAutoSelectDb: setSelectedDb,
  });

  // SQL tab state
  const [sql, setSql] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  // Backups tab state
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState<string | null>(null);

  // Maintenance tab state
  const [maintenanceLoading, setMaintenanceLoading] = useState<string | null>(null);
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResult | null>(null);

  // Recovery state
  const [recoverLoading, setRecoverLoading] = useState<string | null>(null);
  const [recoverResult, setRecoverResult] = useState<RecoverResult | null>(null);

  // Advanced operations state
  const [advancedLoading, setAdvancedLoading] = useState<string | null>(null);
  const [advancedOutput, setAdvancedOutput] = useState<string | null>(null);

  // Bulk operations state
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Daily backups tab state
  const [dailyBackups, setDailyBackups] = useState<HistoricalBackup[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyRestoreResult, setDailyRestoreResult] = useState<ImportResult | null>(null);

  // Confirmation dialog
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // -------------------------------------------------------------------------
  // Data fetching — fetchBackups + fetchDailyBackups only. fetchDatabases /
  // fetchTables / fetchTableRows / fetchSchema moved to useDatabaseManagerData
  // hook (Strangler Pattern F-Strangler-DBManager).
  // -------------------------------------------------------------------------

  const fetchBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      const res = await fetch('/api/admin/db-manager/backup');
      const json = await res.json();
      if (json.success) {
        setBackups(json.backups as BackupFile[]);
      } else {
        setBackupsError(json.error || 'فشل تحميل النسخ الاحتياطية');
      }
    } catch (e) {
      setBackupsError(String((e as Error)?.message || e));
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  const fetchDailyBackups = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const res = await fetch('/api/admin/db-manager/historical-backups');
      const json = await res.json();
      if (json.success) {
        setDailyBackups(json.backups as HistoricalBackup[]);
      } else {
        setDailyError(json.error || 'فشل تحميل النسخ اليومية');
      }
    } catch (e) {
      setDailyError(String((e as Error)?.message || e));
    } finally {
      setDailyLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (activeTab === 'backups') {
      fetchBackups();
    }
  }, [activeTab, fetchBackups]);

  useEffect(() => {
    if (activeTab === 'daily') {
      fetchDailyBackups();
    }
  }, [activeTab, fetchDailyBackups]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const selectedOverview = useMemo(
    () => databases.find((d) => d.name === selectedDb) || null,
    [databases, selectedDb]
  );

  const filteredDatabases = useMemo(
    () =>
      databases.filter((d) => d.name.toLowerCase().includes(search.toLowerCase())),
    [databases, search]
  );

  const totalSizeBytes = useMemo(
    () => databases.reduce((acc, d) => acc + d.sizeBytes, 0),
    [databases]
  );

  const integritySummary = useMemo(() => {
    const ok = databases.filter((d) => d.integrity === 'ok').length;
    const corrupt = databases.filter((d) => d.integrity === 'corrupt').length;
    const unknown = databases.filter((d) => d.integrity === 'unknown').length;
    return { ok, corrupt, unknown, total: databases.length };
  }, [databases]);

  const walDbCount = useMemo(
    () => databases.filter((d) => d.walPresent).length,
    [databases]
  );

  // -------------------------------------------------------------------------
  // Handlers — UI navigation
  // -------------------------------------------------------------------------

  const handleSelectDb = (dbName: string) => {
    setSelectedDb(dbName);
    setSelectedTable(null);
    setQueryResult(null);
    setQueryError(null);
    setMaintenanceResult(null);
    setActiveTab('overview');
  };

  const handleRefreshDbs = () => {
    refetchDatabases();
  };

  const handleSort = (colName: string) => {
    if (!selectedDb || !selectedTable) return;
    const newDir: 'asc' | 'desc' = sortBy === colName && sortDir === 'asc' ? 'desc' : 'asc';
    setSortBy(colName);
    setSortDir(newDir);
    setPage(1);
  };

  const handleSelectTable = (table: string) => {
    if (!selectedDb) return;
    setSelectedTable(table);
    setSortBy(undefined);
    setSortDir('asc');
    setPage(1);
  };

  // -------------------------------------------------------------------------
  // SQL Console handlers
  // -------------------------------------------------------------------------

  const handleRunSql = async () => {
    if (!selectedDb) {
      toast.error('اختر قاعدة بيانات أولاً');
      return;
    }
    if (!sql.trim()) {
      toast.error('اكتب استعلام SQL أولاً');
      return;
    }
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    try {
      const res = await fetch('/api/admin/db-manager/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: selectedDb, sql, dryRun }),
      });
      const json = await res.json();
      if (json.success) {
        const result: QueryResult = {
          columns: json.columns || [],
          rows: json.rows || [],
          affected: json.affected || 0,
          durationMs: json.durationMs || 0,
          isWrite: !!json.isWrite,
          truncated: json.truncated,
          explainPlan: json.explainPlan,
        };
        setQueryResult(result);
        if (!dryRun) {
          setHistory(saveHistory(sql));
        }
        toast.success(
          dryRun
            ? 'تم تنفيذ EXPLAIN'
            : result.isWrite
            ? `تم تنفيذ الاستعلام — ${result.affected} صف متأثر`
            : `تم تنفيذ الاستعلام — ${result.rows.length} صف`
        );
      } else {
        setQueryError(json.error || 'فشل التنفيذ');
        toast.error(json.error || 'فشل التنفيذ');
      }
    } catch (e) {
      setQueryError(String((e as Error)?.message || e));
      toast.error(String((e as Error)?.message || e));
    } finally {
      setQueryLoading(false);
    }
  };

  const handleClearSql = () => {
    setSql('');
    setQueryResult(null);
    setQueryError(null);
  };

  const handleExportTable = async (format: 'csv' | 'json') => {
    if (!selectedDb || !selectedTable) return;
    try {
      const url = `/api/admin/db-manager/export?db=${encodeURIComponent(selectedDb)}&table=${encodeURIComponent(selectedTable)}&format=${format}`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || `فشل التصدير (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="([^"]+)"/);
      const fileName = m ? m[1] : `${selectedDb}_${selectedTable}.${format}`;
      const text = await blob.text();
      const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
      const { downloadTextFile } = await import('./helpers');
      downloadTextFile(text, fileName, mime);
      toast.success(`تم تصدير ${selectedTable} كـ ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

  // -------------------------------------------------------------------------
  // Backup / Restore / Delete
  // -------------------------------------------------------------------------

  const handleBackup = async () => {
    if (!selectedDb) return;
    setConfirm({
      title: 'إنشاء نسخة احتياطية',
      description: (
        <span>
          سيتم إنشاء نسخة احتياطية بقيمة <strong>{selectedDb}</strong> في مجلد <code>db/backups/</code>.
          سيتم عمل WAL checkpoint أولاً لضمان اتساق النسخة.
        </span>
      ),
      confirmLabel: 'إنشاء نسخة',
      destructive: false,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/db-manager/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: selectedDb }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success(`تم إنشاء النسخة: ${json.fileName} (${json.sizeHuman})`);
            fetchBackups();
          } else {
            toast.error(json.error || 'فشل النسخ الاحتياطي');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  const handleRestore = (backupFile: string) => {
    if (!selectedDb) return;
    setConfirm({
      title: 'استعادة نسخة احتياطية',
      description: (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تحذير: عملية خطرة</AlertTitle>
            <AlertDescription>
              سيتم استبدال محتوى <strong>{selectedDb}</strong> بمحتوى النسخة <code>{backupFile}</code>.
              سيتم عمل نسخة احتياطية تلقائية للوضع الحالي قبل الاستبدال، لكن لا يمكن التراجع بعد ذلك إلا باستعادة تلك النسخة.
            </AlertDescription>
          </Alert>
          <p className="text-sm">هل أنت متأكد من المتابعة؟</p>
        </div>
      ),
      confirmLabel: 'استعادة الآن',
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/db-manager/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: selectedDb, backupFile }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success('تمت الاستعادة بنجاح — تم حفظ نسخة تلقائية قبلها');
            fetchBackups();
            refetchDatabases();
            if (tables) refetchTables();
          } else {
            toast.error(json.error || 'فشل الاستعادة');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  const handleDeleteBackup = (backupFile: string) => {
    setConfirm({
      title: 'حذف نسخة احتياطية',
      description: (
        <span>
          سيتم حذف النسخة <code>{backupFile}</code> نهائياً. لا يمكن التراجع.
        </span>
      ),
      confirmLabel: 'حذف',
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/db-manager/delete-backup', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: backupFile }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success('تم حذف النسخة');
            fetchBackups();
          } else {
            toast.error(json.error || 'فشل الحذف');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  // -------------------------------------------------------------------------
  // Drop / Truncate table
  // -------------------------------------------------------------------------

  const handleDropTable = (table: string) => {
    if (!selectedDb) return;
    setConfirm({
      title: 'حذف جدول (DROP TABLE)',
      description: (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تحذير: عملية لا يمكن التراجع عنها</AlertTitle>
            <AlertDescription>
              سيتم حذف الجدول <strong>{table}</strong> وكل بياناته نهائياً من <strong>{selectedDb}</strong>.
              يُنصح بعمل نسخة احتياطية قبل المتابعة.
            </AlertDescription>
          </Alert>
          <p className="text-sm">اكتب اسم الجدول للتأكيد:</p>
          <Input
            id="confirm-table-name"
            placeholder={table}
            className="font-mono"
          />
        </div>
      ),
      confirmLabel: 'حذف الجدول',
      destructive: true,
      onConfirm: async () => {
        const input = document.getElementById('confirm-table-name') as HTMLInputElement | null;
        if (input && input.value.trim() !== table) {
          toast.error('اسم الجدول غير مطابق — تم الإلغاء');
          return;
        }
        try {
          const res = await fetch('/api/admin/db-manager/drop-table', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: selectedDb, table }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success(`تم حذف الجدول ${table}`);
            if (selectedDb) {
              setSelectedTable(null);
              refetchTables();
            }
          } else {
            toast.error(json.error || 'فشل الحذف');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  const handleTruncateTable = (table: string) => {
    if (!selectedDb) return;
    setConfirm({
      title: 'تفريغ جدول (DELETE FROM)',
      description: (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تحذير: سيتم حذف كل الصفوف</AlertTitle>
            <AlertDescription>
              سيتم حذف جميع صفوف الجدول <strong>{table}</strong> من <strong>{selectedDb}</strong>.
              بنية الجدول ستبقى، لكن البيانات ستُفقد. يُنصح بعمل نسخة احتياطية أولاً.
            </AlertDescription>
          </Alert>
          <p className="text-sm">هل أنت متأكد؟</p>
        </div>
      ),
      confirmLabel: 'تفريغ الجدول',
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/db-manager/truncate-table', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: selectedDb, table }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success(`تم تفريغ الجدول — ${json.deletedRows} صف محذوف`);
            if (selectedDb) refetchTables();
            if (selectedDb && selectedTable) {
              setPage(1);
              refetchRows();
            }
          } else {
            toast.error(json.error || 'فشل التفريغ');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  // -------------------------------------------------------------------------
  // Maintenance handlers
  // -------------------------------------------------------------------------

  const handleMaintenance = (
    operation: 'VACUUM' | 'INTEGRITY_CHECK' | 'WAL_CHECKPOINT' | 'REINDEX',
    label: string,
    description: React.ReactNode
  ) => {
    if (!selectedDb) return;
    setConfirm({
      title: `${label} — ${selectedDb}`,
      description,
      confirmLabel: label,
      destructive: operation === 'VACUUM',
      onConfirm: async () => {
        setMaintenanceLoading(operation);
        setMaintenanceResult(null);
        try {
          const endpoint = operation.toLowerCase().replace('_', '-');
          const res = await fetch(`/api/admin/db-manager/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db: selectedDb }),
          });
          const json = await res.json();
          if (json.success) {
            const result: MaintenanceResult = {
              success: json.success,
              operation: json.operation || operation,
              durationMs: json.durationMs || 0,
              message: json.message || '',
              report: json.report,
            };
            setMaintenanceResult(result);
            toast.success(`${label} — ${result.message}`);
            refetchDatabases();
          } else {
            setMaintenanceResult({
              success: false,
              operation,
              durationMs: 0,
              message: json.error || 'فشل',
            });
            toast.error(json.error || 'فشل');
          }
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          setMaintenanceResult({ success: false, operation, durationMs: 0, message: msg });
          toast.error(msg);
        } finally {
          setMaintenanceLoading(null);
        }
      },
    });
  };

  const handleRecoverDb = async (dbName: string) => {
    setRecoverLoading(dbName);
    setRecoverResult(null);
    toast.info(`جاري محاولة استعادة ${dbName}...`);
    try {
      const res = await fetch('/api/admin/db-manager/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: dbName }),
      });
      const json = await res.json();
      if (json.success) {
        setRecoverResult({ db: dbName, result: json.data });
        toast.success(`تم استعادة ${dbName} بنجاح`);
      } else {
        setRecoverResult({ db: dbName, result: { error: json.error } });
        toast.error(json.error || 'فشلت الاستعادة');
      }
      refetchDatabases();
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      toast.error(msg);
      setRecoverResult({ db: dbName, result: { error: msg } });
    } finally {
      setRecoverLoading(null);
    }
  };

  const handleRecoverAll = async () => {
    setRecoverLoading('all');
    setRecoverResult(null);
    toast.info('جاري فحص واستعادة جميع قواعد البيانات التالفة...');
    try {
      const res = await fetch('/api/admin/db-manager/recover-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setRecoverResult({ db: 'all', result: json.data });
        toast.success(`تم فحص ${json.data.summary.total} قاعدة — ${json.data.summary.recovered} تم إصلاحها`);
      } else {
        setRecoverResult({ db: 'all', result: { error: json.error } });
        toast.error(json.error || 'فشلت الاستعادة');
      }
      refetchDatabases();
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      toast.error(msg);
      setRecoverResult({ db: 'all', result: { error: msg } });
    } finally {
      setRecoverLoading(null);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  // -------------------------------------------------------------------------
  // Bulk operation handlers
  // -------------------------------------------------------------------------

  const handleAdvancedOperation = async (
    op: 'repair-engine' | 'cleanup-symbols' | 'import-egx30' | 'repair-all',
    label: string
  ) => {
    setAdvancedLoading(op);
    setAdvancedOutput(null);
    toast.info(`جاري تشغيل عملية ${label}...`);
    try {
      const res = await fetch(`/api/admin/db-manager/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تمت عملية ${label} بنجاح`);
        setAdvancedOutput(json.data?.output || 'تمت العملية بنجاح بدون مخرجات نصية');
      } else {
        toast.error(json.error || `فشلت عملية ${label}`);
        setAdvancedOutput(json.error || json.data?.output || 'فشلت العملية');
      }
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      toast.error(msg);
      setAdvancedOutput(`Error: ${msg}`);
    } finally {
      setAdvancedLoading(null);
      refetchDatabases(); // Refresh sizes
    }
  };

  const handleCheckpointAll = async () => {
    setBulkLoading('checkpoint');
    try {
      const res = await fetch('/api/admin/db-manager/checkpoint-all', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم Checkpoint على ${json.results.length} قاعدة بيانات`);
        refetchDatabases();
      } else {
        toast.error(json.error || 'فشل checkpoint');
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    } finally {
      setBulkLoading(null);
    }
  };

  const handleExportAll = async () => {
    setBulkLoading('export');
    try {
      const res = await fetch('/api/admin/db-manager/export-all', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم إنشاء ملف ZIP: ${json.zipFileName} (${json.sizeHuman})`);
        if (json.walWarning.length > 0) {
          toast.warning(`تحذير: ${json.walWarning.length} قاعدة بيانات بها مشاكل WAL`);
        }
        // Trigger download
        window.open(`/api/admin/db-manager/export-all?file=${encodeURIComponent(json.zipFileName)}`, '_blank');
        fetchBackups();
      } else {
        toast.error(json.error || 'فشل التصدير');
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    } finally {
      setBulkLoading(null);
    }
  };

  const handleImportAll = async () => {
    if (!importFile) {
      toast.error('اختر ملف ZIP أولاً');
      return;
    }
    setBulkLoading('import');
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch('/api/admin/db-manager/import-all', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.success) {
        setImportResult({
          restored: json.restored as string[],
          failed: json.failed as string[],
          autoBackupZip: json.autoBackupZip as string,
        });
        toast.success(json.message || 'تم الاستيراد بنجاح');
        setImportFile(null);
        refetchDatabases();
        fetchBackups();
      } else {
        toast.error(json.error || 'فشل الاستيراد');
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    } finally {
      setBulkLoading(null);
    }
  };

  // -------------------------------------------------------------------------
  // Daily backup handlers
  // -------------------------------------------------------------------------

  const handleRestoreDaily = (backupId: string) => {
    setConfirm({
      title: 'استعادة من نسخة يومية',
      description: (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>تحذير: استعادة شاملة</AlertTitle>
            <AlertDescription>
              سيتم استبدال جميع قواعد البيانات الحالية بمحتوى النسخة اليومية{' '}
              <strong>{backupId}</strong>.
              سيتم عمل نسخة احتياطية تلقائية للوضع الحالي قبل الاستبدال.
              <br /><br />
              <strong>ملاحظة:</strong> سيتم استعادة فقط قواعد البيانات الموجودة في النسخة.
              قواعد البيانات المضافة حديثاً وغير الموجودة في النسخة لن تتأثر.
            </AlertDescription>
          </Alert>
          <p className="text-sm">هل أنت متأكد من المتابعة؟</p>
        </div>
      ),
      confirmLabel: 'استعادة الآن',
      destructive: true,
      onConfirm: async () => {
        setDailyRestoreResult(null);
        try {
          const res = await fetch('/api/admin/db-manager/historical-backups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backupId }),
          });
          const json = await res.json();
          if (json.success) {
            const result: ImportResult = {
              restored: json.restored || [],
              failed: json.failed || [],
              autoBackupZip: json.autoBackupZip || '',
            };
            setDailyRestoreResult(result);
            toast.success(json.message || 'تمت الاستعادة بنجاح');
            refetchDatabases();
            fetchDailyBackups();
          } else {
            toast.error(json.error || 'فشل الاستعادة');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  const handleDeleteDaily = (backupId: string) => {
    setConfirm({
      title: 'حذف نسخة يومية',
      description: (
        <span>
          سيتم حذف النسخة اليومية <code>{backupId}</code> نهائياً. لا يمكن التراجع.
        </span>
      ),
      confirmLabel: 'حذف',
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/db-manager/historical-backups', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backupId }),
          });
          const json = await res.json();
          if (json.success) {
            toast.success('تم حذف النسخة اليومية');
            fetchDailyBackups();
          } else {
            toast.error(json.error || 'فشل الحذف');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

  const handleClearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  return {
    // UI state
    search, setSearch,
    selectedDb, setSelectedDb,
    activeTab, setActiveTab,
    selectedTable,
    page, setPage, sortBy, sortDir,
    // Data hook results
    databases, dbsLoading, dbsError, refetchDatabases,
    tables, tablesLoading, tablesError, refetchTables,
    tableRows, rowsLoading, rowsError, refetchRows,
    schema, schemaOpen, setSchemaOpen, fetchSchema,
    // SQL tab
    sql, setSql, dryRun, setDryRun,
    queryResult, queryLoading, queryError,
    history, setHistory,
    // Backups tab
    backups, backupsLoading, backupsError,
    // Maintenance tab
    maintenanceLoading, maintenanceResult,
    // Recovery
    recoverLoading, recoverResult,
    // Advanced ops
    advancedLoading, advancedOutput,
    // Bulk ops
    bulkLoading, importFile, setImportFile, importResult,
    // Daily backups
    dailyBackups, dailyLoading, dailyError, dailyRestoreResult,
    // Confirm dialog
    confirm, confirmBusy,
    // Derived state
    selectedOverview, filteredDatabases, totalSizeBytes, integritySummary, walDbCount,
    // Handlers
    handleSelectDb, handleRefreshDbs, handleSort, handleSelectTable,
    handleRunSql, handleClearSql, handleExportTable,
    handleBackup, handleRestore, handleDeleteBackup,
    handleDropTable, handleTruncateTable,
    handleMaintenance, handleRecoverDb, handleRecoverAll, handleConfirmAction,
    handleAdvancedOperation, handleCheckpointAll, handleExportAll, handleImportAll,
    handleRestoreDaily, handleDeleteDaily, handleClearHistory,
    fetchBackups, fetchDailyBackups,
  };
}

export type UseDbManagerActionsReturn = ReturnType<typeof useDbManagerActions>;

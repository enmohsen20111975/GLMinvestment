'use client';

/**
 * DatabaseManagerFull.tsx
 * =======================
 * مدير قواعد البيانات الكامل — يتيح للأدمن التحكم في كل قواعد بيانات SQLite
 * الموجودة في مجلد db/:
 *   - لوحة معلومات شاملة لكل قاعدة (الحجم، الـ WAL، السلامة، عدد الجداول/الصفوف)
 *   - متصفح جداول مع ترقيم صفحات وفرز حسب العمود
 *   - تنفيذ SQL خام (SELECT + عمليات الكتابة) مع وضع "تجربة" (EXPLAIN) + سجل آخر 20 استعلام
 *   - نسخ احتياطي / استعادة / حذف نسخة
 *   - عمليات الصيانة: VACUUM / INTEGRITY_CHECK / WAL CHECKPOINT / REINDEX
 *   - تصدير جدول كـ CSV أو JSON
 *   - DROP / TRUNCATE لجدول + عرض الـ schema والـ indexes
 *
 * الألوان المستخدمة: primary (افتراضي)، destructive (تحذير/حذف)، amber/teal/emerald (حالة) —
 * لا يستخدم indigo أو blue إطلاقاً.
 *
 * التخطيط: شريط جانبي يسار بقائمة قواعد البيانات + منطقة رئيسية فيها 5 تبويبات
 * (Overview / Tables / SQL Console / Backups / Maintenance).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Database as DatabaseIcon,
  Table as TableIcon,
  RefreshCw,
  Loader2,
  HardDrive,
  Clock,
  AlertCircle,
  Search,
  Play,
  Eraser,
  Download,
  Upload,
  Trash2,
  Activity,
  ShieldCheck,
  Zap,
  History,
  FileJson,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  ArrowRightLeft,
  DatabaseBackup,
  Info,
  AlertTriangle,
  ListTree,
  KeyRound,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types (mirror the API responses)
// ---------------------------------------------------------------------------

interface DatabaseOverview {
  name: string;
  path: string;
  sizeBytes: number;
  sizeHuman: string;
  lastModified: string;
  tableCount: number;
  totalRows: number;
  walPresent: boolean;
  walSizeBytes: number;
  shmPresent: boolean;
  integrity: 'ok' | 'corrupt' | 'unknown';
  integrityMessage?: string;
}

interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  sizeEstimateBytes: number;
  sizeHuman: string;
}

interface TableColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  dfltValue: string | null;
}

interface TableRowsResult {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affected: number;
  durationMs: number;
  isWrite: boolean;
  truncated?: boolean;
  explainPlan?: Record<string, unknown>[];
}

interface MaintenanceResult {
  success: boolean;
  operation: string;
  durationMs: number;
  message: string;
  report?: string | string[];
}

interface BackupFile {
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  createdAt: string;
  db?: string;
}

interface SchemaResult {
  table: string;
  createStatement: string;
  columns: TableColumn[];
  indexes: { name: string; sql: string }[];
}

interface HistoricalBackup {
  id: string;
  date: string;
  dateDisplay: string;
  dayOfWeek: string;
  dbCount: number;
  okCount: number;
  corruptCount: number;
  totalSizeBytes: number;
  totalSizeHuman: string;
  databases: {
    name: string;
    sizeBytes: number;
    sizeHuman: string;
    integrity: 'ok' | 'corrupt' | 'failed';
    integrityMsg?: string;
  }[];
  hasSummary: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'db-manager-query-history';
const HISTORY_LIMIT = 20;
const PAGE_SIZE = 50;
const RESULT_LIMIT = 1000;

const EXAMPLE_QUERIES: { label: string; sql: string; isWrite: boolean }[] = [
  { label: 'كل الجداول', sql: `SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name`, isWrite: false },
  { label: 'الـ indexes', sql: `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name`, isWrite: false },
  { label: 'إعدادات PRAGMA', sql: `PRAGMA compile_options`, isWrite: false },
  { label: 'حجم الجداول', sql: `SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name=m.name) AS idx_count FROM sqlite_master m WHERE type='table'`, isWrite: false },
  { label: 'آخر 10 صفوف', sql: `SELECT * FROM TABLE_NAME ORDER BY rowid DESC LIMIT 10`, isWrite: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }
  if (typeof value === 'object') {
    try {
      return <span className="font-mono text-[11px]">{JSON.stringify(value).slice(0, 120)}</span>;
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'boolean') {
    return value ? '✅' : '❌';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return (value ?? 0).toFixed(4);
  }
  const s = String(value);
  if (s.length > 120) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dotted border-muted-foreground">{s.slice(0, 120)}…</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-md whitespace-pre-wrap break-all text-right">
          {s}
        </TooltipContent>
      </Tooltip>
    );
  }
  return s;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${(kb ?? 0).toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${(mb ?? 0).toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory(sql: string): string[] {
  const existing = loadHistory();
  // Deduplicate by exact match (move to top)
  const filtered = existing.filter((s) => s !== sql);
  const next = [sql, ...filtered].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabKey = 'overview' | 'tables' | 'sql' | 'backups' | 'maintenance' | 'daily';

interface ConfirmState {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => Promise<void> | void;
}

export function DatabaseManagerFull() {
  // Sidebar / overview state
  const [databases, setDatabases] = useState<DatabaseOverview[]>([]);
  const [dbsLoading, setDbsLoading] = useState(true);
  const [dbsError, setDbsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Tables tab state
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableRows, setTableRows] = useState<TableRowsResult | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [schema, setSchema] = useState<SchemaResult | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);

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
  const [recoverResult, setRecoverResult] = useState<{ db: string; result: any } | null>(null);

  // Advanced operations state
  const [advancedLoading, setAdvancedLoading] = useState<string | null>(null);
  const [advancedOutput, setAdvancedOutput] = useState<string | null>(null);

  const handleAdvancedOperation = async (op: 'repair-engine' | 'cleanup-symbols' | 'import-egx30' | 'repair-all', label: string) => {
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
      fetchDatabases(); // Refresh sizes
    }
  };

  // Bulk operations state
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ restored: string[]; failed: string[]; autoBackupZip: string } | null>(null);

  // Daily backups tab state
  const [dailyBackups, setDailyBackups] = useState<HistoricalBackup[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyRestoreResult, setDailyRestoreResult] = useState<{ restored: string[]; failed: string[]; autoBackupZip: string } | null>(null);

  // Confirmation dialog
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchDatabases = useCallback(async () => {
    setDbsLoading(true);
    setDbsError(null);
    try {
      const res = await fetch('/api/admin/db-manager');
      const json = await res.json();
      if (json.success) {
        setDatabases(json.databases as DatabaseOverview[]);
        // Auto-select first DB if none selected
        if (!selectedDb && json.databases.length > 0) {
          setSelectedDb(json.databases[0].name);
        }
      } else {
        setDbsError(json.error || 'فشل تحميل قواعد البيانات');
      }
    } catch (e) {
      setDbsError(String((e as Error)?.message || e));
    } finally {
      setDbsLoading(false);
    }
  }, [selectedDb]);

  const fetchTables = useCallback(async (dbName: string) => {
    setTablesLoading(true);
    setTablesError(null);
    setSelectedTable(null);
    setTableRows(null);
    setSchema(null);
    setSchemaOpen(false);
    try {
      const res = await fetch(`/api/admin/db-manager?db=${encodeURIComponent(dbName)}`);
      const json = await res.json();
      if (json.success) {
        setTables(json.tables as TableSummary[]);
        // Update the overview snapshot for the sidebar (integrity/WAL may change)
        if (json.overview) {
          setDatabases((prev) =>
            prev.map((d) => (d.name === dbName ? (json.overview as DatabaseOverview) : d))
          );
        }
      } else {
        setTablesError(json.error || 'فشل تحميل الجداول');
      }
    } catch (e) {
      setTablesError(String((e as Error)?.message || e));
    } finally {
      setTablesLoading(false);
    }
  }, []);

  const fetchTableRows = useCallback(
    async (dbName: string, table: string, pageNum: number, sb?: string, sd?: 'asc' | 'desc') => {
      setRowsLoading(true);
      setRowsError(null);
      try {
        const params = new URLSearchParams({
          db: dbName,
          table,
          page: String(pageNum),
          limit: String(PAGE_SIZE),
        });
        if (sb) {
          params.set('sortBy', sb);
          params.set('sortDir', sd || 'asc');
        }
        const res = await fetch(`/api/admin/db-manager?${params.toString()}`);
        const json = await res.json();
        if (json.success) {
          setTableRows(json.table as TableRowsResult);
          setPage(pageNum);
        } else {
          setRowsError(json.error || 'فشل تحميل الصفوف');
        }
      } catch (e) {
        setRowsError(String((e as Error)?.message || e));
      } finally {
        setRowsLoading(false);
      }
    },
    []
  );

  const fetchSchema = useCallback(async (dbName: string, table: string) => {
    try {
      const res = await fetch(
        `/api/admin/db-manager/schema?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(table)}`
      );
      const json = await res.json();
      if (json.success) {
        setSchema({
          table: json.table,
          createStatement: json.createStatement,
          columns: json.columns,
          indexes: json.indexes,
        });
        setSchemaOpen(true);
      } else {
        toast.error(json.error || 'فشل تحميل الـ schema');
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  }, []);

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
    fetchDatabases();
  }, [fetchDatabases]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // When the active tab changes to "tables", load tables for the selected DB.
  useEffect(() => {
    if (activeTab === 'tables' && selectedDb && tables === null) {
      fetchTables(selectedDb);
    }
  }, [activeTab, selectedDb, tables, fetchTables]);

  // When the active tab changes to "backups", refresh the backup list.
  useEffect(() => {
    if (activeTab === 'backups') {
      fetchBackups();
    }
  }, [activeTab, fetchBackups]);

  // When the active tab changes to "daily", fetch daily backups.
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
  // Handlers
  // -------------------------------------------------------------------------

  const handleSelectDb = (dbName: string) => {
    setSelectedDb(dbName);
    // Reset tab-specific state
    setTables(null);
    setSelectedTable(null);
    setTableRows(null);
    setSchema(null);
    setSchemaOpen(false);
    setQueryResult(null);
    setQueryError(null);
    setMaintenanceResult(null);
    setActiveTab('overview');
  };

  const handleRefreshDbs = () => {
    fetchDatabases();
  };

  const handleSort = (colName: string) => {
    if (!selectedDb || !selectedTable) return;
    const newDir: 'asc' | 'desc' = sortBy === colName && sortDir === 'asc' ? 'desc' : 'asc';
    setSortBy(colName);
    setSortDir(newDir);
    fetchTableRows(selectedDb, selectedTable, 1, colName, newDir);
  };

  const handleSelectTable = (table: string) => {
    if (!selectedDb) return;
    setSelectedTable(table);
    setSortBy(undefined);
    setSortDir('asc');
    fetchTableRows(selectedDb, table, 1);
  };

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
      downloadTextFile(text, fileName, mime);
      toast.success(`تم تصدير ${selectedTable} كـ ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    }
  };

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
            fetchDatabases();
            if (tables) fetchTables(selectedDb);
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
            if (selectedDb) fetchTables(selectedDb);
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
            if (selectedDb && selectedTable) {
              fetchTableRows(selectedDb, selectedTable, 1);
            }
            if (selectedDb) fetchTables(selectedDb);
          } else {
            toast.error(json.error || 'فشل التفريغ');
          }
        } catch (e) {
          toast.error(String((e as Error)?.message || e));
        }
      },
    });
  };

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
            // Refresh DB overview (size/integrity may change)
            fetchDatabases();
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
      fetchDatabases();
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
      fetchDatabases();
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

  const handleCheckpointAll = async () => {
    setBulkLoading('checkpoint');
    try {
      const res = await fetch('/api/admin/db-manager/checkpoint-all', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم Checkpoint على ${json.results.length} قاعدة بيانات`);
        fetchDatabases();
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
        fetchDatabases();
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
            const result = {
              restored: json.restored || [],
              failed: json.failed || [],
              autoBackupZip: json.autoBackupZip || '',
            };
            setDailyRestoreResult(result);
            toast.success(json.message || 'تمت الاستعادة بنجاح');
            fetchDatabases();
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

  return (
    <>
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                <DatabaseIcon className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">مدير قواعد البيانات</h2>
                <p className="text-sm text-muted-foreground">
                  {databases.length} قاعدة بيانات · {formatBytes(totalSizeBytes)} إجمالي
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Integrity summary */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] gap-1 cursor-default',
                      integritySummary.corrupt > 0
                        ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300'
                        : integritySummary.unknown > 0
                          ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-300'
                          : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                    )}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    {integritySummary.ok}/{integritySummary.total} سليمة
                    {integritySummary.corrupt > 0 && ` · ${integritySummary.corrupt} تالفة`}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> سليمة: {integritySummary.ok}
                    </div>
                    {integritySummary.corrupt > 0 && (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-red-500" /> تالفة: {integritySummary.corrupt}
                      </div>
                    )}
                    {integritySummary.unknown > 0 && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-amber-500" /> غير معروف: {integritySummary.unknown}
                      </div>
                    )}
                    {walDbCount > 0 && (
                      <div className="flex items-center gap-1">
                        <DatabaseBackup className="w-3 h-3 text-amber-500" /> WAL نشط: {walDbCount}
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-6" />
              <Button variant="outline" size="sm" onClick={handleRefreshDbs} disabled={dbsLoading}>
                <RefreshCw className={cn('w-4 h-4 ml-2', dbsLoading && 'animate-spin')} />
                تحديث
              </Button>
            </div>
          </div>

          {/* Bulk operations bar */}
          <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckpointAll}
              disabled={bulkLoading === 'checkpoint'}
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
            >
              {bulkLoading === 'checkpoint' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <DatabaseBackup className="w-3.5 h-3.5" />
              )}
              WAL Checkpoint للكل: {walDbCount} قواعد نشطة
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleExportAll}
              disabled={bulkLoading === 'export'}
            >
              {bulkLoading === 'export' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              تصدير كل القواعد كـ ZIP
            </Button>
            <div className="relative flex items-center gap-2">
              <input
                type="file"
                accept=".zip"
                id="import-zip-input"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setImportFile(f);
                  setImportResult(null);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('import-zip-input')?.click()}
                disabled={bulkLoading === 'import'}
              >
                {bulkLoading === 'import' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {importFile ? `تم الاختيار: ${importFile.name}` : 'اختر ملف ZIP'}
              </Button>
              {importFile && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleImportAll}
                  disabled={bulkLoading === 'import'}
                >
                  استيراد كل القواعد
                </Button>
              )}
            </div>
          </div>

          {/* Import result */}
          {importResult && (
            <Alert variant={importResult.failed.length === 0 ? 'default' : 'destructive'} className="mt-3">
              <Info className="h-4 w-4" />
              <AlertTitle>نتيجة الاستيراد</AlertTitle>
              <AlertDescription>
                <div className="text-sm mt-1 space-y-1">
                  <p className="text-emerald-600 dark:text-emerald-400">
                    تم الاستيراد بنجاح: {importResult.restored.length} قواعد بيانات
                    {importResult.restored.length > 0 && ` (${importResult.restored.join(', ')})`}
                  </p>
                  {importResult.failed.length > 0 && (
                    <p className="text-red-600 dark:text-red-400">
                      فشل: {importResult.failed.length} ({importResult.failed.join(', ')})
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    تم حفظ نسخة احتياطية تلقائية: <code>{importResult.autoBackupZip}</code>
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Search */}
          <div className="relative mt-4">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن قاعدة بيانات..."
              className="pr-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Warning banner */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>تنبيه: أدوات إدارية متقدمة</AlertTitle>
        <AlertDescription>
          هذه الأدوات تتعامل مباشرة مع قواعد بيانات الإنتاج. العمليات المدمرة (DROP / TRUNCATE / VACUUM / استعادة) تتطلب تأكيداً صريحاً. يُنصح بعمل نسخة احتياطية قبل أي تعديل.
        </AlertDescription>
      </Alert>

      {dbsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>خطأ</AlertTitle>
          <AlertDescription>{dbsError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar: DB list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                قواعد البيانات
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {dbsLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : filteredDatabases.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-xs">لا توجد قواعد بيانات</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                  {filteredDatabases.map((db) => (
                    <DbCard
                      key={db.name}
                      db={db}
                      selected={selectedDb === db.name}
                      onSelect={() => handleSelectDb(db.name)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main area: tabs */}
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
            <TabsList className="grid grid-cols-6 w-full">
              <TabsTrigger value="overview">
                <Info className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">نظرة عامة</span>
              </TabsTrigger>
              <TabsTrigger value="tables">
                <TableIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">الجداول</span>
              </TabsTrigger>
              <TabsTrigger value="sql">
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">SQL</span>
              </TabsTrigger>
              <TabsTrigger value="backups">
                <DatabaseBackup className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">النسخ</span>
              </TabsTrigger>
              <TabsTrigger value="daily">
                <History className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">اليومية</span>
              </TabsTrigger>
              <TabsTrigger value="maintenance">
                <Activity className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">الصيانة</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              {selectedOverview ? (
                <OverviewPanel overview={selectedOverview} onBackup={handleBackup} />
              ) : (
                <EmptyState icon={DatabaseIcon} text="اختر قاعدة بيانات من اليمين" />
              )}
            </TabsContent>

            <TabsContent value="tables">
              {selectedDb ? (
                <TablesPanel
                  dbName={selectedDb}
                  tables={tables}
                  tablesLoading={tablesLoading}
                  tablesError={tablesError}
                  selectedTable={selectedTable}
                  onSelectTable={handleSelectTable}
                  tableRows={tableRows}
                  rowsLoading={rowsLoading}
                  rowsError={rowsError}
                  page={page}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onPageChange={(p) =>
                    selectedDb && selectedTable && fetchTableRows(selectedDb, selectedTable, p, sortBy, sortDir)
                  }
                  onExport={handleExportTable}
                  onDropTable={handleDropTable}
                  onTruncateTable={handleTruncateTable}
                  onViewSchema={(t) => selectedDb && fetchSchema(selectedDb, t)}
                  schema={schema}
                  schemaOpen={schemaOpen}
                  onSchemaClose={() => setSchemaOpen(false)}
                  onRetry={() => selectedDb && fetchTables(selectedDb)}
                />
              ) : (
                <EmptyState icon={TableIcon} text="اختر قاعدة بيانات أولاً" />
              )}
            </TabsContent>

            <TabsContent value="sql">
              {selectedDb ? (
                <SqlConsolePanel
                  dbName={selectedDb}
                  sql={sql}
                  setSql={setSql}
                  dryRun={dryRun}
                  setDryRun={setDryRun}
                  onRun={handleRunSql}
                  onClear={handleClearSql}
                  loading={queryLoading}
                  result={queryResult}
                  error={queryError}
                  history={history}
                  onHistoryClick={(s) => setSql(s)}
                  onClearHistory={() => {
                    localStorage.removeItem(HISTORY_KEY);
                    setHistory([]);
                  }}
                />
              ) : (
                <EmptyState icon={Play} text="اختر قاعدة بيانات أولاً" />
              )}
            </TabsContent>

            <TabsContent value="backups">
              {selectedDb ? (
                <BackupsPanel
                  dbName={selectedDb}
                  backups={backups}
                  loading={backupsLoading}
                  error={backupsError}
                  onBackup={handleBackup}
                  onRestore={handleRestore}
                  onDelete={handleDeleteBackup}
                  onRefresh={fetchBackups}
                />
              ) : (
                <EmptyState icon={DatabaseBackup} text="اختر قاعدة بيانات أولاً" />
              )}
            </TabsContent>

            <TabsContent value="daily">
              <DailyBackupsPanel
                backups={dailyBackups}
                loading={dailyLoading}
                error={dailyError}
                restoreResult={dailyRestoreResult}
                onRestore={handleRestoreDaily}
                onDelete={handleDeleteDaily}
                onRefresh={fetchDailyBackups}
              />
            </TabsContent>

            <TabsContent value="maintenance" className="space-y-4">
              {selectedDb && (
                <MaintenancePanel
                  dbName={selectedDb}
                  loading={maintenanceLoading}
                  result={maintenanceResult}
                  onVacuum={() =>
                    handleMaintenance(
                      'VACUUM',
                      'VACUUM',
                      <p className="text-sm">
                        سيتم إعادة بناء ملف <strong>{selectedDb}</strong> لاستعادة المساحة غير المستخدمة.
                        قد يستغرق وقتاً طويلاً للقواعد الكبيرة. سيتم قفل القاعدة أثناء العملية.
                      </p>
                    )
                  }
                  onIntegrity={() =>
                    handleMaintenance(
                      'INTEGRITY_CHECK',
                      'فحص السلامة',
                      <p className="text-sm">
                        سيتم تنفيذ <code>PRAGMA integrity_check</code> على <strong>{selectedDb}</strong> للتأكد من سلامة بنية البيانات. عملية للقراءة فقط وآمنة.
                      </p>
                    )
                  }
                  onWalCheckpoint={() =>
                    handleMaintenance(
                      'WAL_CHECKPOINT',
                      'WAL Checkpoint',
                      <p className="text-sm">
                        سيتم دمج محتوى ملف الـ WAL (-wal) في الملف الرئيسي <strong>{selectedDb}</strong> ثم اقتطاع ملف WAL. مفيد لتحرير مساحة.
                      </p>
                    )
                  }
                  onReindex={() =>
                    handleMaintenance(
                      'REINDEX',
                      'REINDEX',
                      <p className="text-sm">
                        سيتم إعادة بناء جميع الفهارس في <strong>{selectedDb}</strong>. مفيد بعد عمليات حذف كبيرة.
                      </p>
                    )
                  }
                />
              )}

              {/* Database Recovery Tools */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
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
                        onClick={() => handleRecoverDb(selectedDb)}
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
                      onClick={handleRecoverAll}
                      disabled={recoverLoading === 'all'}
                      className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
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
                            <p className="text-emerald-600 dark:text-emerald-400">
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
                            <p className="text-red-600 dark:text-red-400">
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
                    <DatabaseIcon className="w-4 h-4 text-purple-600" />
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
                        <div className="text-sm font-semibold text-purple-700 flex items-center gap-1.5">
                          <Activity className="w-4 h-4" />
                          إصلاح تلف قاعدة البيانات
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          يقوم بفحص وإصلاح قاعدة بيانات المحرك (<code>data_engine.db</code>) تلقائياً، وإعادة بناء الفهارس المعطوبة صفاً بصف.
                        </p>
                      </div>
                      <Button
                        onClick={() => handleAdvancedOperation('repair-engine', 'إصلاح قاعدة بيانات المحرك')}
                        disabled={advancedLoading !== null}
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 text-white w-full"
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
                        <div className="text-sm font-semibold text-teal-700 flex items-center gap-1.5">
                          <ArrowRightLeft className="w-4 h-4" />
                          تنظيف الرموز ومحاذاة الأسماء
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          حذف الرموز المشوهة والقديمة (مثل <code>EKHO</code> و <code>MNHD</code>) ومحاذاة أسماء الأسهم لجميع جداول النظام.
                        </p>
                      </div>
                      <Button
                        onClick={() => handleAdvancedOperation('cleanup-symbols', 'تنظيف الرموز ومحاذاة الأسماء')}
                        disabled={advancedLoading !== null}
                        size="sm"
                        className="bg-teal-600 hover:bg-teal-700 text-white w-full"
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
                        <div className="text-sm font-semibold text-blue-700 flex items-center gap-1.5">
                          <History className="w-4 h-4" />
                          استيراد تاريخ مؤشر EGX30
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          استيراد البيانات اليومية لمؤشر البورصة المصرية الرئيسي <code>EGX30</code> من ملف الـ CSV وتحديث الأسعار والمقاييس.
                        </p>
                      </div>
                      <Button
                        onClick={() => handleAdvancedOperation('import-egx30', 'استيراد وتحديث تاريخ EGX30')}
                        disabled={advancedLoading !== null}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white w-full"
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

                  <div className="border rounded-lg p-3 flex flex-col justify-between gap-3 bg-emerald-50/50 md:col-span-3 border-emerald-200">
                    <div>
                      <div className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                        <RefreshCw className="w-4 h-4" />
                        إصلاح شامل لجميع قواعد البيانات
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        يفحص ويُصلح جميع قواعد البيانات (19 قاعدة) تلقائياً عبر REINDEX ثم dump/rebuild. يُنشئ backup قبل أي تعديل.
                      </p>
                    </div>
                    <Button
                      onClick={() => handleAdvancedOperation('repair-all', 'إصلاح شامل لجميع قواعد البيانات')}
                      disabled={advancedLoading !== null}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
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
                    <div className="text-xs font-semibold text-slate-500">مخرجات السكربت (Console Output):</div>
                    <pre className="bg-slate-950 text-slate-200 p-4 rounded-lg text-xs font-mono h-60 overflow-y-auto whitespace-pre-wrap">
                      {advancedOutput}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            {!selectedDb && !advancedOutput && (
              <EmptyState icon={Activity} text="اختر قاعدة بيانات من القائمة الجانبية لعرض عمليات الصيانة الهيكلية" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>

      {/* Global confirmation dialog */ }
  <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !confirmBusy && setConfirm(null)}>
    <AlertDialogContent className="max-w-lg">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          {confirm?.destructive ? (
            <AlertTriangle className="w-5 h-5 text-destructive" />
          ) : (
            <Info className="w-5 h-5" />
          )}
          {confirm?.title}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div>{confirm?.description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={confirmBusy}>إلغاء</AlertDialogCancel>
        <AlertDialogAction
          onClick={(e) => {
            e.preventDefault();
            handleConfirmAction();
          }}
          disabled={confirmBusy}
          className={cn(confirm?.destructive && 'bg-destructive text-white hover:bg-destructive/90')}
        >
          {confirmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {confirm?.confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  {/* Custom scrollbar + RTL helpers */ }
  <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: hsl(var(--muted-foreground) / 0.3);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground) / 0.5);
        }
      `}</style>
    </div >
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DbCard({
  db,
  selected,
  onSelect,
}: {
  db: DatabaseOverview;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-right p-3 rounded-lg border transition-all hover:border-emerald-400',
        selected
          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
          : 'border-border bg-card'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <HardDrive
            className={cn(
              'w-4 h-4 flex-shrink-0',
              selected ? 'text-emerald-600' : 'text-muted-foreground'
            )}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{db.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {db.sizeHuman} · {db.tableCount} جدول · {db.totalRows.toLocaleString('en-US')} صف
            </div>
          </div>
        </div>
        <IntegrityBadge integrity={db.integrity} />
      </div>
      {(db.walPresent || db.shmPresent) && (
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {db.walPresent && (
            <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">
              WAL {formatBytes(db.walSizeBytes)}
            </Badge>
          )}
          {db.shmPresent && (
            <Badge variant="outline" className="text-[10px]">
              SHM
            </Badge>
          )}
        </div>
      )}
    </button>
  );
}

function IntegrityBadge({ integrity }: { integrity: 'ok' | 'corrupt' | 'unknown' }) {
  if (integrity === 'ok') {
    return (
      <Badge variant="outline" className="text-[10px] bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        سليمة
      </Badge>
    );
  }
  if (integrity === 'corrupt') {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <XCircle className="w-3 h-3" />
        تالفة
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      <AlertCircle className="w-3 h-3" />
      غير معروف
    </Badge>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <Card>
      <CardContent className="py-20 text-center">
        <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overview Panel
// ---------------------------------------------------------------------------

function OverviewPanel({
  overview,
  onBackup,
}: {
  overview: DatabaseOverview;
  onBackup: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="w-5 h-5 text-emerald-600" />
          {overview.name}
        </CardTitle>
        <CardDescription>المسار: {overview.path}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={HardDrive} label="الحجم" value={overview.sizeHuman} />
          <StatCard icon={TableIcon} label="عدد الجداول" value={overview.tableCount.toLocaleString('en-US')} />
          <StatCard icon={ListTree} label="إجمالي الصفوف" value={overview.totalRows.toLocaleString('en-US')} />
          <StatCard
            icon={Clock}
            label="آخر تعديل"
            value={formatDateTime(overview.lastModified)}
          />
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  السلامة (Integrity)
                </span>
                <IntegrityBadge integrity={overview.integrity} />
              </div>
              {overview.integrityMessage && overview.integrity !== 'ok' && (
                <p className="text-xs text-muted-foreground break-all font-mono">
                  {overview.integrityMessage}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <DatabaseBackup className="w-4 h-4" />
                  ملفات WAL/SHM
                </span>
                <div className="flex gap-1">
                  {overview.walPresent ? (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">
                      WAL {formatBytes(overview.walSizeBytes)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">لا WAL</Badge>
                  )}
                  {overview.shmPresent && (
                    <Badge variant="outline" className="text-[10px]">SHM</Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {overview.walPresent
                  ? 'يوجد ملف WAL — تغييرات غير مدمجة بعد. استخدم WAL Checkpoint لدمجها.'
                  : 'لا توجد تغييرات معلّقة في WAL.'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onBackup} variant="default" size="sm">
            <DatabaseBackup className="w-4 h-4" />
            إنشاء نسخة احتياطية
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-semibold truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables Panel
// ---------------------------------------------------------------------------

interface TablesPanelProps {
  dbName: string;
  tables: TableSummary[] | null;
  tablesLoading: boolean;
  tablesError: string | null;
  selectedTable: string | null;
  onSelectTable: (table: string) => void;
  tableRows: TableRowsResult | null;
  rowsLoading: boolean;
  rowsError: string | null;
  page: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  onPageChange: (p: number) => void;
  onExport: (format: 'csv' | 'json') => void;
  onDropTable: (table: string) => void;
  onTruncateTable: (table: string) => void;
  onViewSchema: (table: string) => void;
  schema: SchemaResult | null;
  schemaOpen: boolean;
  onSchemaClose: () => void;
  onRetry: () => void;
}

function TablesPanel(props: TablesPanelProps) {
  const tablesListColumns: Column<TableSummary>[] = useMemo(() => ([
    {
      key: 'name',
      header: 'اسم الجدول',
      sortable: true,
      filterable: true,
      className: 'font-mono text-xs',
    },
    {
      key: 'rowCount',
      header: 'الصفوف',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs',
      render: (t) => t.rowCount.toLocaleString('en-US'),
    },
    {
      key: 'columnCount',
      header: 'الأعمدة',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-xs',
    },
    {
      key: 'sizeHuman',
      header: 'حجم تقديري',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-28',
      className: 'text-xs',
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      width: 'w-32',
      hideable: false,
      render: (t) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => props.onViewSchema(t.name)}
              >
                <Info className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>عرض الـ schema</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-amber-600 hover:text-amber-700"
                onClick={() => props.onTruncateTable(t.name)}
              >
                <Eraser className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>تفريغ الجدول (DELETE)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => props.onDropTable(t.name)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>حذف الجدول (DROP)</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ]), [props]);

  // Build dynamic columns for the selected-table rows based on schema
  const selectedTableColumns: Column<Record<string, unknown>>[] = useMemo(() => {
    if (!props.tableRows || props.tableRows.columns.length === 0) return [];
    return props.tableRows.columns.map((col) => ({
      key: col.name,
      header: col.name,
      sortable: true,
      filterable: true,
      align: 'right' as const,
      className: 'text-xs max-w-[240px] truncate',
      render: (row: Record<string, unknown>) => formatCell(row[col.name]),
      headerClassName: 'cursor-pointer hover:bg-accent select-none',
    }));
  }, [props.tableRows]);

  return (
    <div className="space-y-3">
      {/* Tables list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="w-4 h-4" />
              جداول {props.dbName}
            </CardTitle>
            {props.tables && (
              <Badge variant="outline">{props.tables.length} جدول</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.tablesLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : props.tablesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.tablesError}</AlertDescription>
              <Button variant="outline" size="sm" onClick={props.onRetry} className="mt-2">
                <RefreshCw className="w-3 h-3" />
                إعادة المحاولة
              </Button>
            </Alert>
          ) : !props.tables || props.tables.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              لا توجد جداول في هذه القاعدة
            </div>
          ) : (
            <UnifiedTable
              columns={tablesListColumns}
              data={props.tables || []}
              keyField="name"
              dense
              columnToggle
              filterable
              maxHeight="max-h-72"
              rowClassName={(t) => cn(
                'cursor-pointer',
                props.selectedTable === t.name && 'bg-emerald-50 dark:bg-emerald-950/20',
              )}
              onRowClick={(t) => props.onSelectTable(t.name)}
            />
          )}
        </CardContent>
      </Card>

      {/* Selected table rows */}
      {props.selectedTable && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-emerald-600" />
                  {props.selectedTable}
                </CardTitle>
                {props.tableRows && (
                  <CardDescription>
                    {props.tableRows.totalRows.toLocaleString('en-US')} صف · {props.tableRows.columns.length} عمود · صفحة {props.tableRows.page} من {props.tableRows.totalPages}
                  </CardDescription>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => props.onExport('csv')}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => props.onExport('json')}>
                  <FileJson className="w-3.5 h-3.5" />
                  JSON
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            {props.rowsLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : props.rowsError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{props.rowsError}</AlertDescription>
              </Alert>
            ) : !props.tableRows ? (
              <div className="py-8 text-center text-muted-foreground text-sm">لا توجد بيانات</div>
            ) : (
              <>
                {/* Pagination */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => props.onPageChange(Math.max(1, props.page - 1))}
                      disabled={props.page <= 1}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                      السابق
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => props.onPageChange(Math.min(props.tableRows.totalPages, props.page + 1))}
                      disabled={props.page >= props.tableRows.totalPages}
                    >
                      التالي
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    عرض{' '}
                    {Math.min((props.page - 1) * PAGE_SIZE + 1, props.tableRows.totalRows)}
                    {' - '}
                    {Math.min(props.page * PAGE_SIZE, props.tableRows.totalRows)}
                    {' من '}
                    {props.tableRows.totalRows.toLocaleString('en-US')}
                  </span>
                </div>

                {/* Rows + Sort Control */}
                <div className="flex items-center justify-end gap-2 mb-2 px-1">
                  {props.tableRows && props.tableRows.columns.length > 0 && (
                    <Select value={props.sortBy} onValueChange={(v) => props.onSort(v)}>
                      <SelectTrigger className="w-[200px] h-8 text-xs">
                        <ArrowDownUp className="w-3 h-3 ml-1" />
                        <SelectValue placeholder="ترتيب حسب..." />
                      </SelectTrigger>
                      <SelectContent>
                        {props.tableRows.columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name} {props.sortBy === col.name ? (props.sortDir === 'asc' ? '↑' : '↓') : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {props.sortBy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => props.onSort(props.sortBy)}
                    >
                      {props.sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {props.sortDir === 'asc' ? 'تصاعدي' : 'تنازلي'}
                    </Button>
                  )}
                </div>

                {/* Rows */}
                <div className="max-h-96 overflow-auto custom-scrollbar border rounded-md">
                  <UnifiedTable
                    columns={selectedTableColumns}
                    data={props.tableRows.rows}
                    keyField="_rowIndex"
                    dense
                    maxHeight="max-h-96"
                    emptyTextAr="لا توجد صفوف في هذا الجدول"
                    filterable
                    columnToggle
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Schema dialog */}
      <AlertDialog open={props.schemaOpen} onOpenChange={(o) => !o && props.onSchemaClose()}>
        <AlertDialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto custom-scrollbar">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ListTree className="w-5 h-5" />
              {props.schema ? `Schema: ${props.schema.table}` : 'Schema'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-foreground">
                {props.schema && (
                  <>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <Info className="w-3.5 h-3.5" />
                        CREATE TABLE
                      </div>
                      <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
                        {props.schema.createStatement}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <TableIcon className="w-3.5 h-3.5" />
                        الأعمدة ({props.schema.columns.length})
                      </div>
                      <div className="border rounded-md">
                        <UnifiedTable
                          columns={[
                            { key: 'name', header: 'الاسم', sortable: true, filterable: true, className: 'font-mono text-xs' },
                            { key: 'type', header: 'النوع', align: 'right', sortable: true, filterable: true, width: 'w-24', className: 'text-xs', render: (c) => c.type || 'any' },
                            { key: 'notNull', header: 'NOT NULL', align: 'right', width: 'w-24', className: 'text-xs', render: (c) => c.notNull ? '✅' : '—' },
                            { key: 'pk', header: 'PK', align: 'right', width: 'w-20', className: 'text-xs', render: (c) => c.pk ? '✅' : '—' },
                            { key: 'dfltValue', header: 'افتراضي', align: 'right', sortable: true, filterable: true, className: 'font-mono text-[11px]', render: (c) => c.dfltValue ?? '—' },
                          ]}
                          data={props.schema.columns}
                          keyField="name"
                          dense
                          filterable
                          columnToggle
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <KeyRound className="w-3.5 h-3.5" />
                        الفهارس ({props.schema.indexes.length})
                      </div>
                      {props.schema.indexes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">لا توجد فهارس</p>
                      ) : (
                        <div className="space-y-1">
                          {props.schema.indexes.map((idx) => (
                            <div key={idx.name} className="border rounded p-2">
                              <div className="font-mono text-xs font-medium">{idx.name}</div>
                              <pre className="text-[11px] font-mono text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                                {idx.sql}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إغلاق</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SQL Console Panel
// ---------------------------------------------------------------------------

interface SqlConsolePanelProps {
  dbName: string;
  sql: string;
  setSql: (s: string) => void;
  dryRun: boolean;
  setDryRun: (b: boolean) => void;
  onRun: () => void;
  onClear: () => void;
  loading: boolean;
  result: QueryResult | null;
  error: string | null;
  history: string[];
  onHistoryClick: (s: string) => void;
  onClearHistory: () => void;
}

function SqlConsolePanel(props: SqlConsolePanelProps) {
  const isWrite = useMemo(() => {
    const t = props.sql.trim().toUpperCase();
    const first = t.match(/^([A-Z]+)/)?.[1] || '';
    return !['SELECT', 'WITH', 'PRAGMA', 'EXPLAIN'].includes(first);
  }, [props.sql]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Play className="w-4 h-4" />
              تنفيذ SQL — <span className="font-mono text-emerald-600">{props.dbName}</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={props.dryRun}
                  onChange={(e) => props.setDryRun(e.target.checked)}
                  className="rounded"
                />
                <span>وضع التجربة (EXPLAIN)</span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isWrite && !props.dryRun && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>تحذير: استعلام كتابة</AlertTitle>
              <AlertDescription>
                هذا الاستعلام سيعدل البيانات. لا يمكن التراجع. يُنصح بعمل نسخة احتياطية أولاً.
              </AlertDescription>
            </Alert>
          )}

          <Textarea
            value={props.sql}
            onChange={(e) => props.setSql(e.target.value)}
            placeholder="اكتب استعلام SQL هنا... مثل: SELECT * FROM table_name LIMIT 10"
            className="font-mono text-xs min-h-[120px] resize-y"
            dir="ltr"
          />

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button
                onClick={props.onRun}
                disabled={props.loading || !props.sql.trim()}
                size="sm"
              >
                {props.loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {props.dryRun ? 'تجربة (EXPLAIN)' : 'تنفيذ'}
              </Button>
              <Button onClick={props.onClear} variant="outline" size="sm" disabled={props.loading}>
                <Eraser className="w-3.5 h-3.5" />
                مسح
              </Button>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-muted-foreground ml-1">أمثلة:</span>
              {EXAMPLE_QUERIES.map((ex) => (
                <Button
                  key={ex.label}
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => props.setSql(ex.sql)}
                >
                  {ex.label}
                </Button>
              ))}
            </div>
          </div>

          {/* History */}
          {props.history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <History className="w-3 h-3" />
                  آخر {props.history.length} استعلام
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] text-destructive"
                  onClick={props.onClearHistory}
                >
                  مسح السجل
                </Button>
              </div>
              <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
                {props.history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => props.onHistoryClick(h)}
                    className="block w-full text-right p-1.5 rounded border text-[11px] font-mono hover:bg-accent truncate"
                    title={h}
                  >
                    <span className="text-muted-foreground ml-2">{i + 1}.</span>
                    {h.slice(0, 120)}
                    {h.length > 120 ? '…' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error */}
      {props.error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>خطأ في الاستعلام</AlertTitle>
          <AlertDescription className="font-mono text-xs whitespace-pre-wrap break-all">
            {props.error}
          </AlertDescription>
        </Alert>
      )}

      {/* Result */}
      {props.result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {props.result.isWrite ? (
                  <Zap className="w-4 h-4 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                )}
                النتيجة
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">
                  <Clock className="w-2.5 h-2.5" />
                  {props.result.durationMs} ms
                </Badge>
                {props.result.isWrite ? (
                  <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">
                    {props.result.affected.toLocaleString('en-US')} صف متأثر
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="text-[10px]">
                      {props.result.rows.length} صف
                    </Badge>
                    {props.result.truncated && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">
                        تم اقتطاع النتائج ({RESULT_LIMIT} حد أقصى)
                      </Badge>
                    )}
                  </>
                )}
                {!props.result.isWrite && props.result.rows.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        const headers = props.result!.columns;
                        const lines = [headers.join(',')];
                        for (const r of props.result!.rows) {
                          lines.push(
                            headers
                              .map((h) => {
                                const v = r[h];
                                if (v === null || v === undefined) return '';
                                const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
                                return s.includes(',') || s.includes('"') || s.includes('\n')
                                  ? `"${s.replace(/"/g, '""')}"`
                                  : s;
                              })
                              .join(',')
                          );
                        }
                        downloadTextFile(
                          `\uFEFF${lines.join('\n')}`,
                          `query_result_${Date.now()}.csv`,
                          'text/csv;charset=utf-8'
                        );
                      }}
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() =>
                        downloadTextFile(
                          JSON.stringify(props.result!.rows, null, 2),
                          `query_result_${Date.now()}.json`,
                          'application/json;charset=utf-8'
                        )
                      }
                    >
                      <FileJson className="w-3 h-3" />
                      JSON
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2">
            {props.result.explainPlan ? (
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  خطة التنفيذ (EXPLAIN) — {props.result.explainPlan.length} خط
                </p>
                <div className="max-h-96 overflow-auto custom-scrollbar border rounded-md">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                      <TableRow>
                        {props.result.explainPlan.length > 0 &&
                          Object.keys(props.result.explainPlan[0]).map((k) => (
                            <TableHead key={k} className="text-right font-mono text-[10px]">
                              {k}
                            </TableHead>
                          ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {props.result.explainPlan.map((row, i) => (
                        <TableRow key={i}>
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j} className="font-mono text-[10px]">
                              {String(v)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : props.result.isWrite ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600 mb-2" />
                <p className="text-sm">
                  تم تنفيذ الاستعلام بنجاح —{' '}
                  <strong>{props.result.affected.toLocaleString('en-US')}</strong> صف متأثر.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  الزمن: {props.result.durationMs} ms
                </p>
              </div>
            ) : props.result.rows.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                الاستعلام رجع 0 صف
              </div>
            ) : (
              <div className="max-h-96 overflow-auto custom-scrollbar border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                    <TableRow>
                      {props.result.columns.map((c) => (
                        <TableHead key={c} className="text-right font-mono text-[11px]">
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.result.rows.map((row, i) => (
                      <TableRow key={i}>
                        {props.result!.columns.map((c) => (
                          <TableCell key={c} className="text-xs max-w-[240px] truncate">
                            {formatCell(row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backups Panel
// ---------------------------------------------------------------------------

interface BackupsPanelProps {
  dbName: string;
  backups: BackupFile[];
  loading: boolean;
  error: string | null;
  onBackup: () => void;
  onRestore: (backupFile: string) => void;
  onDelete: (backupFile: string) => void;
  onRefresh: () => void;
}

function BackupsPanel(props: BackupsPanelProps) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4" />
              النسخ الاحتياطية
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.loading}>
                <RefreshCw className={cn('w-3.5 h-3.5', props.loading && 'animate-spin')} />
                تحديث
              </Button>
              <Button size="sm" onClick={props.onBackup}>
                <Upload className="w-3.5 h-3.5" />
                إنشاء نسخة من {props.dbName}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : props.error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : props.backups.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <DatabaseBackup className="w-10 h-10 mx-auto mb-2 opacity-40" />
              لا توجد نسخ احتياطية بعد. اضغط "إنشاء نسخة" للبدء.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scrollbar space-y-2">
              {props.backups.map((b) => (
                <div
                  key={b.name}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium font-mono truncate" title={b.name}>
                      {b.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-1">
                      <HardDrive className="w-3 h-3" />
                      {b.sizeHuman}
                      <Clock className="w-3 h-3" />
                      {formatDateTime(b.createdAt)}
                      {b.db && (
                        <Badge variant="outline" className="text-[10px]">{b.db}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => {
                            // Trigger a download by hitting the backup file directly via a fetch
                            // Since backups live outside /public, we re-list & download through the export API path.
                            // For now, just inform the user that restore is the supported path.
                            toast.info('للحصول على ملف، استخدم زر "استعادة" أو انسخه من مجلد db/backups/');
                          }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>معلومات التنزيل</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-amber-700 hover:text-amber-800 border-amber-300 hover:bg-amber-50"
                          onClick={() => props.onRestore(b.name)}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          استعادة
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>استعادة هذه النسخة إلى {props.dbName}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive"
                          onClick={() => props.onDelete(b.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>حذف النسخة</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          النسخ الاحتياطية تُخزَّن في مجلد <code>db/backups/</code>. كل نسخة تشمل ملف الـ .db الرئيسي وأي ملفات -wal/-shm مرافقة.
          عند الاستعادة، يتم عمل نسخة تلقائية للوضع الحالي أولاً.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maintenance Panel
// ---------------------------------------------------------------------------

interface MaintenancePanelProps {
  dbName: string;
  loading: string | null;
  result: MaintenanceResult | null;
  onVacuum: () => void;
  onIntegrity: () => void;
  onWalCheckpoint: () => void;
  onReindex: () => void;
}

function MaintenancePanel(props: MaintenancePanelProps) {
  const operations: {
    key: string;
    label: string;
    description: string;
    icon: React.ElementType;
    onClick: () => void;
    destructive: boolean;
  }[] = [
      {
        key: 'VACUUM',
        label: 'VACUUM',
        description: 'إعادة بناء الملف لاستعادة المساحة غير المستخدمة. مفيد بعد حذف كميات كبيرة من البيانات.',
        icon: Zap,
        onClick: props.onVacuum,
        destructive: true,
      },
      {
        key: 'INTEGRITY_CHECK',
        label: 'فحص السلامة',
        description: 'PRAGMA integrity_check — يتحقق من سلامة بنية B-Tree والصفحات. آمن (للقراءة فقط).',
        icon: ShieldCheck,
        onClick: props.onIntegrity,
        destructive: false,
      },
      {
        key: 'WAL_CHECKPOINT',
        label: 'WAL Checkpoint',
        description: 'يدمج التغييرات المعلّقة في ملف الـ WAL إلى الملف الرئيسي ثم يقتطع الـ WAL.',
        icon: DatabaseBackup,
        onClick: props.onWalCheckpoint,
        destructive: false,
      },
      {
        key: 'REINDEX',
        label: 'REINDEX',
        description: 'يعيد بناء كل الفهارس في القاعدة. مفيد بعد تعديلات كبيرة لتحسين الأداء.',
        icon: ListTree,
        onClick: props.onReindex,
        destructive: false,
      },
    ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            عمليات الصيانة — <span className="font-mono text-emerald-600">{props.dbName}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {operations.map((op) => (
            <div key={op.key} className="border rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <op.icon
                  className={cn(
                    'w-5 h-5 flex-shrink-0 mt-0.5',
                    op.destructive ? 'text-amber-600' : 'text-emerald-600'
                  )}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{op.label}</div>
                  <p className="text-[11px] text-muted-foreground mt-1">{op.description}</p>
                </div>
              </div>
              <Button
                onClick={op.onClick}
                disabled={!!props.loading}
                size="sm"
                variant={op.destructive ? 'outline' : 'default'}
                className={cn(
                  op.destructive &&
                  'text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-800'
                )}
              >
                {props.loading === op.key ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <op.icon className="w-3.5 h-3.5" />
                )}
                {op.label}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {props.result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {props.result.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
              نتيجة {props.result.operation}
            </CardTitle>
            <CardDescription>
              الزمن: {props.result.durationMs} ms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Alert variant={props.result.success ? 'default' : 'destructive'}>
              <AlertDescription>{props.result.message}</AlertDescription>
            </Alert>
            {props.result.report && (
              <div>
                <div className="text-xs font-semibold mb-1">التقرير الكامل:</div>
                <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar">
                  {Array.isArray(props.result.report)
                    ? props.result.report.join('\n')
                    : props.result.report}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Backups Panel
// ---------------------------------------------------------------------------

interface DailyBackupsPanelProps {
  backups: HistoricalBackup[];
  loading: boolean;
  error: string | null;
  restoreResult: { restored: string[]; failed: string[]; autoBackupZip: string } | null;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onRefresh: () => void;
}

function DailyBackupsPanel(props: DailyBackupsPanelProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4" />
              النسخ الاحتياطية اليومية (آخر 7 أيام + الأسبوعية + الشهرية)
            </CardTitle>
            <Button variant="outline" size="sm" onClick={props.onRefresh} disabled={props.loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', props.loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {props.loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : props.error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : props.backups.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <History className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>لا توجد نسخ احتياطية يومية حتى الآن.</p>
              <p className="text-xs mt-2 text-muted-foreground">
                شغّل سكربت <code>vps-service/scripts/daily_backup.py</code> عبر cron لإضافة النسخ اليومية.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto custom-scrollbar space-y-3">
              {props.backups.map((backup) => (
                <div
                  key={backup.id}
                  className={cn(
                    'border rounded-lg p-4',
                    backup.corruptCount > 0
                      ? 'border-red-300 bg-red-50/30 dark:bg-red-950/10'
                      : 'border-border bg-card'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{backup.dateDisplay}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {backup.dayOfWeek}
                        </Badge>
                        {backup.hasSummary ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            مُلخّص
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">
                            <AlertCircle className="w-3 h-3" />
                            مفحوص يدوياً
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                        <span>{backup.dbCount} قاعدة بيانات</span>
                        <span>{backup.totalSizeHuman}</span>
                        <span className={cn(backup.corruptCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                          <CheckCircle2 className="w-3 h-3 inline" /> {backup.okCount} سليمة
                          {backup.corruptCount > 0 && (
                            <>
                              {' · '}
                              <XCircle className="w-3 h-3 inline" /> {backup.corruptCount} تالفة
                            </>
                          )}
                        </span>
                      </div>
                      {backup.databases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {backup.databases.map((db) => (
                            <Tooltip key={db.name}>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[10px] gap-1 cursor-default',
                                    db.integrity === 'ok'
                                      ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                                      : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                                  )}
                                >
                                  {db.integrity === 'ok' ? (
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                  ) : (
                                    <XCircle className="w-2.5 h-2.5" />
                                  )}
                                  {db.name}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  <p>{db.name}</p>
                                  <p>{db.sizeHuman}</p>
                                  <p className={db.integrity === 'ok' ? 'text-emerald-400' : 'text-red-400'}>
                                    {db.integrity === 'ok' ? 'سليمة' : db.integrityMsg || 'تالفة'}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-amber-700 hover:text-amber-800 border-amber-300 hover:bg-amber-50"
                            onClick={() => props.onRestore(backup.id)}
                            disabled={backup.corruptCount > 0}
                          >
                            <Upload className="w-3.5 h-3.5" />
                            استعادة الكل
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {backup.corruptCount > 0
                            ? 'لا يمكن الاستعادة — توجد قواعد بيانات تالفة'
                            : 'استعادة جميع قواعد البيانات من هذه النسخة'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-destructive hover:text-destructive"
                            onClick={() => props.onDelete(backup.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>حذف النسخة</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {props.restoreResult && (
        <Alert variant={props.restoreResult.failed.length === 0 ? 'default' : 'destructive'}>
          <Info className="h-4 w-4" />
          <AlertTitle>نتيجة الاستعادة</AlertTitle>
          <AlertDescription>
            <div className="text-sm mt-1 space-y-1">
              <p className="text-emerald-600 dark:text-emerald-400">
                تم الاستعادة بنجاح: {props.restoreResult.restored.length} قواعد بيانات
                {props.restoreResult.restored.length > 0 && ` (${props.restoreResult.restored.join(', ')})`}
              </p>
              {props.restoreResult.failed.length > 0 && (
                <p className="text-red-600 dark:text-red-400">
                  فشل: {props.restoreResult.failed.length} ({props.restoreResult.failed.join(', ')})
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                تم حفظ نسخة احتياطية تلقائية: <code>{props.restoreResult.autoBackupZip}</code>
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          النسخ اليومية تُنشأ تلقائياً عبر سكربت cron. يتم الاحتفاظ بـ 7 نسخ يومية + 4 نسخ أسبوعية (الأحد) + 3 نسخ شهرية (أول الشهر).{' '}
          النسخ تُفحص تلقائياً قبل الحفظ، والنسخة التالفة تُعلّم ولا تسمح بالاستعادة منها.
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * db-manager/types.ts
 * ===================
 * All TypeScript types + interfaces for the DatabaseManagerFull split.
 *
 * Data-related types (DatabaseOverview, TableSummary, TableColumn,
 * TableRowsResult, SchemaResult) are imported from `@/hooks/useDatabaseManagerData`
 * (Strangler Pattern F-Strangler-DBManager) — they're re-exported here so the
 * sub-components only need one import path.
 */

export type {
  DatabaseOverview,
  TableSummary,
  TableColumn,
  TableRowsResult,
  SchemaResult,
} from '@/hooks/useDatabaseManagerData';

// ---------------------------------------------------------------------------
// Component-local types — query results / backups / maintenance
// (still owned by component — not part of the data hook yet).
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  affected: number;
  durationMs: number;
  isWrite: boolean;
  truncated?: boolean;
  explainPlan?: Record<string, unknown>[];
}

export interface MaintenanceResult {
  success: boolean;
  operation: string;
  durationMs: number;
  message: string;
  report?: string | string[];
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  createdAt: string;
  db?: string;
}

export interface HistoricalBackup {
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
// Container-local types
// ---------------------------------------------------------------------------

export type TabKey = 'overview' | 'tables' | 'sql' | 'backups' | 'maintenance' | 'daily';

export interface ConfirmState {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => Promise<void> | void;
}

export interface ImportResult {
  restored: string[];
  failed: string[];
  autoBackupZip: string;
}

export interface RecoverResult {
  db: string;
  result: any;
}

// ---------------------------------------------------------------------------
// Sub-component Props
// ---------------------------------------------------------------------------

export interface DbCardProps {
  db: import('@/hooks/useDatabaseManagerData').DatabaseOverview;
  selected: boolean;
  onSelect: () => void;
}

export interface IntegrityBadgeProps {
  integrity: 'ok' | 'corrupt' | 'unknown';
}

export interface EmptyStateProps {
  icon: React.ElementType;
  text: string;
}

export interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
}

export interface OverviewPanelProps {
  overview: import('@/hooks/useDatabaseManagerData').DatabaseOverview;
  onBackup: () => void;
}

export interface TablesPanelProps {
  dbName: string;
  tables: import('@/hooks/useDatabaseManagerData').TableSummary[] | null;
  tablesLoading: boolean;
  tablesError: string | null;
  selectedTable: string | null;
  onSelectTable: (table: string) => void;
  tableRows: import('@/hooks/useDatabaseManagerData').TableRowsResult | null;
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
  schema: import('@/hooks/useDatabaseManagerData').SchemaResult | null;
  schemaOpen: boolean;
  onSchemaClose: () => void;
  onRetry: () => void;
}

export interface SqlConsolePanelProps {
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

export interface BackupsPanelProps {
  dbName: string;
  backups: BackupFile[];
  loading: boolean;
  error: string | null;
  onBackup: () => void;
  onRestore: (backupFile: string) => void;
  onDelete: (backupFile: string) => void;
  onRefresh: () => void;
}

export interface MaintenancePanelProps {
  dbName: string;
  loading: string | null;
  result: MaintenanceResult | null;
  onVacuum: () => void;
  onIntegrity: () => void;
  onWalCheckpoint: () => void;
  onReindex: () => void;
}

export interface DailyBackupsPanelProps {
  backups: HistoricalBackup[];
  loading: boolean;
  error: string | null;
  restoreResult: ImportResult | null;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onRefresh: () => void;
}

export interface ConfirmDialogProps {
  confirm: ConfirmState | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export interface HeaderBarProps {
  databaseCount: number;
  totalSizeBytes: number;
  integritySummary: { ok: number; corrupt: number; unknown: number; total: number };
  walDbCount: number;
  dbsLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  bulkLoading: string | null;
  importFile: File | null;
  importResult: ImportResult | null;
  onImportFileChange: (file: File | null) => void;
  onCheckpointAll: () => void;
  onExportAll: () => void;
  onImportAll: () => void;
}

export interface DbSidebarProps {
  databases: import('@/hooks/useDatabaseManagerData').DatabaseOverview[];
  filteredDatabases: import('@/hooks/useDatabaseManagerData').DatabaseOverview[];
  loading: boolean;
  selectedDb: string | null;
  onSelectDb: (name: string) => void;
}

export interface RecoveryToolsPanelProps {
  selectedDb: string | null;
  selectedOverview: import('@/hooks/useDatabaseManagerData').DatabaseOverview | null;
  recoverLoading: string | null;
  recoverResult: RecoverResult | null;
  advancedLoading: string | null;
  advancedOutput: string | null;
  onRecoverDb: (dbName: string) => void;
  onRecoverAll: () => void;
  onAdvancedOperation: (
    op: 'repair-engine' | 'cleanup-symbols' | 'import-egx30' | 'repair-all',
    label: string
  ) => void;
}

'use client';

/**
 * hooks/useDatabaseManagerData.ts
 * ============================================================================
 * F-Strangler-DBManager: Strangler Pattern extraction from DatabaseManagerFull
 * ----------------------------------------------------------------------------
 * قبل كده: DatabaseManagerFull.tsx (3,291 LOC) كان فيه 4 useCallback fetch
 * handlers + 10 useState لـ data-related state (databases / tables / tableRows /
 * schema) كلهم inline في الـ component. الـ fetch logic اختلط بـ render logic.
 *
 * دلوقتي: الـ data logic كله here. الـ component بقا render-only:
 *   const {
 *     databases, dbsLoading, dbsError, refetchDatabases,
 *     tables, tablesLoading, tablesError, refetchTables,
 *     tableRows, rowsLoading, rowsError, refetchRows,
 *     schema, schemaOpen, setSchemaOpen, fetchSchema,
 *   } = useDatabaseManagerData({ selectedDb, selectedTable, page, sortBy, sortDir,
 *                                tablesEnabled, onAutoSelectDb });
 *
 * الـ hook بيستخدم TanStack Query (useQuery) لـ 3 من الـ 4 fetches:
 *   1. GET /api/admin/db-manager                                    ← databases overview
 *   2. GET /api/admin/db-manager?db=X                                ← tables for db X
 *   3. GET /api/admin/db-manager?db=X&table=Y&page=N&limit=50[&sortBy&sortDir]
 *                                                                   ← paginated rows
 *
 * الـ fetch الرابع (schema) بيتم بـ manual fetch لأنه button-triggered (لا حاجة
 * لـ cache — المستخدم بيـطلب الـ schema لما يضغط زر "عرض الـ schema").
 *
 * Side effects محفوظة زي ما هي:
 *   - fetchDatabases: auto-selects أول db لو مفيش selectedDb
 *   - fetchTables: بيـ update الـ overview snapshot في الـ dbsQ cache (sidebar
 *     integrity/WAL بيتحدث بعد كل fetch tables)
 *   - fetchSchema: بيـ set schemaOpen=true وبيـ toast.error على الفشل
 *
 * TanStack Query v5 notes:
 *   - `enabled`: لما يكون false، الـ query مش بـ تشتغل. الـ cached data بيفضل
 *     محفوظ. لما enabled يبقى true تاني، الـ query بـ تشتغل (لو الـ cache stale
 *     أو مفيش cache).
 *   - `staleTime: Infinity`: الـ cache مبيبقاش stale (no auto-refetch on re-enable
 *     ولا على window focus). ده matches original behavior (مفيش auto-refetch
 *     للـ tables/rows — كلها imperative بـ refetch*() callbacks).
 *   - `placeholderData: undefined` (default): لما queryKey يتغير، الـ data بـ
 *     تبقى undefined + isLoading=true. مفيش flash للـ old data.
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiGet, type ApiResponse } from '@/lib/api-client';

// ============================================================
// Types — owned by the hook (component imports them via `export type`)
// ============================================================

export interface DatabaseOverview {
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

export interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  sizeEstimateBytes: number;
  sizeHuman: string;
}

export interface TableColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  dfltValue: string | null;
}

export interface TableRowsResult {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SchemaResult {
  table: string;
  createStatement: string;
  columns: TableColumn[];
  indexes: { name: string; sql: string }[];
}

// ============================================================
// Internal response shapes (mirror the API JSON)
// ============================================================

/** GET /api/admin/db-manager → { success, databases } */
interface DbListResponse {
  success: boolean;
  databases?: DatabaseOverview[];
  error?: string;
}

/** GET /api/admin/db-manager?db=X → { success, tables, overview? } */
interface TablesResponse {
  success: boolean;
  tables?: TableSummary[];
  overview?: DatabaseOverview;
  error?: string;
}

/** GET /api/admin/db-manager?db=X&table=Y&page=N&limit=L → { success, table: TableRowsResult } */
interface RowsResponse {
  success: boolean;
  table?: TableRowsResult;
  error?: string;
}

/** GET /api/admin/db-manager/schema?db=X&table=Y → { success, table, createStatement, columns, indexes } */
interface SchemaApiResponse {
  success: boolean;
  table?: string;
  createStatement?: string;
  columns?: TableColumn[];
  indexes?: { name: string; sql: string }[];
  error?: string;
}

// ============================================================
// Constants
// ============================================================

const PAGE_SIZE = 50;

// ============================================================
// Hook options + return type
// ============================================================

export interface UseDatabaseManagerDataOptions {
  /** The currently selected DB (component state). null = none selected yet. */
  selectedDb: string | null;
  /** The currently selected table (component state). null = none selected. */
  selectedTable: string | null;
  /** Current page (1-based, component state). */
  page: number;
  /** Current sort column (component state). undefined = no sort. */
  sortBy: string | undefined;
  /** Current sort direction (component state). */
  sortDir: 'asc' | 'desc';
  /** Whether the tables query should run (true when activeTab === 'tables'). */
  tablesEnabled: boolean;
  /** Callback to auto-select the first db on initial load. */
  onAutoSelectDb: (name: string) => void;
}

export interface UseDatabaseManagerDataResult {
  // Databases overview
  databases: DatabaseOverview[];
  dbsLoading: boolean;
  dbsError: string | null;
  refetchDatabases: () => Promise<void>;

  // Tables for selectedDb
  tables: TableSummary[] | null;
  tablesLoading: boolean;
  tablesError: string | null;
  refetchTables: () => Promise<void>;

  // Table rows (paginated)
  tableRows: TableRowsResult | null;
  rowsLoading: boolean;
  rowsError: string | null;
  refetchRows: () => Promise<void>;

  // Schema (manual button-triggered)
  schema: SchemaResult | null;
  schemaOpen: boolean;
  setSchemaOpen: (open: boolean) => void;
  fetchSchema: (dbName: string, table: string) => Promise<void>;
}

// ============================================================
// Hook implementation
// ============================================================

export function useDatabaseManagerData(
  opts: UseDatabaseManagerDataOptions
): UseDatabaseManagerDataResult {
  const { selectedDb, selectedTable, page, sortBy, sortDir, tablesEnabled, onAutoSelectDb } = opts;
  const queryClient = useQueryClient();

  // -------------------------------------------------------------------------
  // 1) Databases overview — GET /api/admin/db-manager
  // -------------------------------------------------------------------------

  const dbsQ = useQuery<ApiResponse<DbListResponse>>({
    queryKey: ['db-manager', 'databases'],
    queryFn: () => apiGet<DbListResponse>('/api/admin/db-manager'),
    // Default staleTime (0) — refetches on mount/focus. Same as original behavior
    // (fetchDatabases was always called fresh on mount + on demand).
  } satisfies UseQueryOptions<ApiResponse<DbListResponse>>);

  // Auto-select first db once when the list loads and none is selected.
  // Mirrors original: `if (!selectedDb && json.databases.length > 0) setSelectedDb(json.databases[0].name)`.
  // Use a ref-like guard so we don't re-fire when the user manually deselects later.
  const [autoSelected, setAutoSelected] = useState(false);
  useEffect(() => {
    if (autoSelected) return;
    const json = dbsQ.data as unknown as DbListResponse | undefined;
    const list = json?.success ? (json.databases ?? []) : [];
    if (!selectedDb && list.length > 0) {
      setAutoSelected(true);
      onAutoSelectDb(list[0].name);
    }
  }, [autoSelected, dbsQ.data, selectedDb, onAutoSelectDb]);

  const databases = useMemo<DatabaseOverview[]>(() => {
    const json = dbsQ.data as unknown as DbListResponse | undefined;
    if (!json?.success) return [];
    return (json.databases ?? []) as DatabaseOverview[];
  }, [dbsQ.data]);

  const dbsLoading = dbsQ.isLoading;
  const dbsError = useMemo<string | null>(() => {
    if (dbsQ.error) return String((dbsQ.error as Error)?.message || dbsQ.error);
    const json = dbsQ.data as unknown as DbListResponse | undefined;
    if (json && !json.success) return json.error ?? 'فشل تحميل قواعد البيانات';
    return null;
  }, [dbsQ.data, dbsQ.error]);

  const refetchDatabases = useCallback(async () => {
    await dbsQ.refetch();
  }, [dbsQ]);

  // -------------------------------------------------------------------------
  // 2) Tables for selectedDb — GET /api/admin/db-manager?db=X
  // -------------------------------------------------------------------------

  const tablesQ = useQuery<ApiResponse<TablesResponse>>({
    queryKey: ['db-manager', 'tables', selectedDb],
    queryFn: () =>
      apiGet<TablesResponse>(`/api/admin/db-manager?db=${encodeURIComponent(selectedDb!)}`),
    enabled: !!selectedDb && tablesEnabled,
    // staleTime: Infinity — matches original "tables !== null → no refetch" guard.
    // Switching tabs back doesn't trigger refetch (only manual refetchTables() does).
    staleTime: Infinity,
  } satisfies UseQueryOptions<ApiResponse<TablesResponse>>);

  const tables = useMemo<TableSummary[] | null>(() => {
    if (!selectedDb) return null; // gate on selectedDb so cache doesn't leak across db changes
    const json = tablesQ.data as unknown as TablesResponse | undefined;
    if (!json?.success) return null;
    return (json.tables ?? null) as TableSummary[] | null;
  }, [tablesQ.data, selectedDb]);

  const tablesLoading = !!selectedDb && tablesEnabled && tablesQ.isLoading;
  const tablesError = useMemo<string | null>(() => {
    if (!selectedDb) return null;
    if (tablesQ.error) return String((tablesQ.error as Error)?.message || tablesQ.error);
    const json = tablesQ.data as unknown as TablesResponse | undefined;
    if (json && !json.success) return json.error ?? 'فشل تحميل الجداول';
    return null;
  }, [tablesQ.data, tablesQ.error, selectedDb]);

  const refetchTables = useCallback(async () => {
    if (!selectedDb) return;
    await tablesQ.refetch();
  }, [tablesQ, selectedDb]);

  // Side effect: when tables query completes, sync the overview snapshot back
  // into the dbsQ cache so the sidebar reflects updated integrity/WAL/size.
  // Mirrors original:
  //   if (json.overview) setDatabases((prev) =>
  //     prev.map((d) => (d.name === dbName ? json.overview : d)));
  useEffect(() => {
    if (!selectedDb) return;
    const json = tablesQ.data as unknown as TablesResponse | undefined;
    const updatedOverview = json?.success ? json.overview : undefined;
    if (!updatedOverview) return;
    queryClient.setQueryData<ApiResponse<DbListResponse>>(
      ['db-manager', 'databases'],
      (old) => {
        if (!old?.success) return old;
        const oldJson = old as unknown as DbListResponse;
        const prevList = oldJson.databases ?? [];
        if (!Array.isArray(prevList) || prevList.length === 0) return old;
        const nextList = prevList.map((d) => (d.name === selectedDb ? updatedOverview : d));
        return { ...old, databases: nextList } as ApiResponse<DbListResponse>;
      }
    );
  }, [tablesQ.data, selectedDb, queryClient]);

  // -------------------------------------------------------------------------
  // 3) Table rows (paginated) — GET /api/admin/db-manager?db=X&table=Y&page=N&limit=L[&sortBy&sortDir]
  // -------------------------------------------------------------------------

  const rowsQ = useQuery<ApiResponse<RowsResponse>>({
    queryKey: ['db-manager', 'rows', selectedDb, selectedTable, page, sortBy ?? '', sortDir],
    queryFn: () => {
      const params = new URLSearchParams({
        db: selectedDb!,
        table: selectedTable!,
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (sortBy) {
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);
      }
      return apiGet<RowsResponse>(`/api/admin/db-manager?${params.toString()}`);
    },
    enabled: !!selectedDb && !!selectedTable,
    staleTime: Infinity, // no auto-refetch — only state-change refetch (new key) + manual refetchRows()
  } satisfies UseQueryOptions<ApiResponse<RowsResponse>>);

  const tableRows = useMemo<TableRowsResult | null>(() => {
    if (!selectedDb || !selectedTable) return null; // gate so cache doesn't leak across changes
    const json = rowsQ.data as unknown as RowsResponse | undefined;
    if (!json?.success) return null;
    return (json.table ?? null) as TableRowsResult | null;
  }, [rowsQ.data, selectedDb, selectedTable]);

  const rowsLoading = !!selectedDb && !!selectedTable && rowsQ.isLoading;
  const rowsError = useMemo<string | null>(() => {
    if (!selectedDb || !selectedTable) return null;
    if (rowsQ.error) return String((rowsQ.error as Error)?.message || rowsQ.error);
    const json = rowsQ.data as unknown as RowsResponse | undefined;
    if (json && !json.success) return json.error ?? 'فشل تحميل الصفوف';
    return null;
  }, [rowsQ.data, rowsQ.error, selectedDb, selectedTable]);

  const refetchRows = useCallback(async () => {
    if (!selectedDb || !selectedTable) return;
    await rowsQ.refetch();
  }, [rowsQ, selectedDb, selectedTable]);

  // -------------------------------------------------------------------------
  // 4) Schema — manual fetch (button-triggered, no cache)
  // -------------------------------------------------------------------------

  const [schema, setSchema] = useState<SchemaResult | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);

  // Reset schema state when selectedDb OR selectedTable changes (mirrors original
  // handleSelectDb which cleared schema/schemaOpen, and original fetchTables
  // which reset selectedTable → tableRows → schema as a side effect of a fresh
  // tables fetch after destructive ops like DROP/TRUNCATE).
  useEffect(() => {
    setSchema(null);
    setSchemaOpen(false);
  }, [selectedDb, selectedTable]);

  const fetchSchema = useCallback(async (dbName: string, table: string) => {
    try {
      const json = (await apiGet<SchemaApiResponse>(
        `/api/admin/db-manager/schema?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(table)}`
      )) as unknown as SchemaApiResponse;
      if (json.success && json.table && json.createStatement && json.columns && json.indexes) {
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

  // -------------------------------------------------------------------------

  return {
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
  };
}

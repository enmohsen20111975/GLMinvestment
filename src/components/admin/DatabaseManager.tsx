'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import {
  Database as DatabaseIcon,
  Table as TableIcon,
  Trash2,
  Edit3,
  Plus,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Search,
  Loader2,
  HardDrive,
  Shield,
  AlertTriangle,
  Database as DbIcon,
  CheckCircle2,
  XCircle,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Filter,
  Zap,
} from 'lucide-react'
import { RowEditorModal, type ColumnSchema } from './RowEditorModal'

interface DatabaseInfo {
  name: string
  size: number
  sizeFormatted: string
  tableCount: number
  totalRows: number
  protected: boolean
  lastModified: string
}

interface TableInfo {
  name: string
  rowCount: number
  schema: ColumnSchema[]
}

interface QueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  schema: ColumnSchema[]
}

const PAGE_SIZES = [25, 50, 100, 200, 500]

export function DatabaseManager() {
  // الحالة العامة
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [selectedDb, setSelectedDb] = useState<string | null>(null)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [loadingDbs, setLoadingDbs] = useState(false)
  const [loadingTables, setLoadingTables] = useState(false)
  const [loadingData, setLoadingData] = useState(false)

  // حالة الاستعلام
  const [data, setData] = useState<QueryResult | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})

  // حالة الـ modals
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'insert' | 'update'>('insert')
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null)
  const [deleteDbTarget, setDeleteDbTarget] = useState<DatabaseInfo | null>(null)
  const [deleteRowTarget, setDeleteRowTarget] = useState<Record<string, unknown> | null>(null)
  const [confirmText, setConfirmText] = useState('')

  // ─── جلب قواعد البيانات ────────────────────────────────────────────
  const fetchDatabases = useCallback(async () => {
    setLoadingDbs(true)
    try {
      const res = await fetch('/api/admin/db')
      const json = await res.json()
      if (json.success) {
        setDatabases(json.databases)
      } else {
        toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({
        title: 'خطأ في الاتصال',
        description: e instanceof Error ? e.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoadingDbs(false)
    }
  }, [])

  // ─── جلب الجداول ───────────────────────────────────────────────────
  const fetchTables = useCallback(async (dbName: string) => {
    setLoadingTables(true)
    setSelectedTable(null)
    setData(null)
    setFilters({})
    setActiveFilters({})
    setSortColumn(null)
    setPage(1)
    try {
      const res = await fetch(`/api/admin/db/${encodeURIComponent(dbName)}`)
      const json = await res.json()
      if (json.success) {
        setTables(json.tables)
      } else {
        toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({
        title: 'خطأ',
        description: e instanceof Error ? e.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoadingTables(false)
    }
  }, [])

  // ─── جلب بيانات الجدول ─────────────────────────────────────────────
  const fetchTableData = useCallback(async () => {
    if (!selectedDb || !selectedTable) return

    setLoadingData(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (sortColumn) {
        params.set('sortColumn', sortColumn)
        params.set('sortDirection', sortDirection)
      }
      for (const [col, val] of Object.entries(activeFilters)) {
        if (val) params.set(`filter_${col}`, val)
      }

      const res = await fetch(
        `/api/admin/db/${encodeURIComponent(selectedDb)}/${encodeURIComponent(selectedTable)}?${params}`
      )
      const json = await res.json()
      if (json.success) {
        setData(json)
      } else {
        toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({
        title: 'خطأ',
        description: e instanceof Error ? e.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoadingData(false)
    }
  }, [selectedDb, selectedTable, page, pageSize, sortColumn, sortDirection, activeFilters])

  useEffect(() => {
    fetchDatabases()
  }, [fetchDatabases])

  useEffect(() => {
    if (selectedDb) fetchTables(selectedDb)
  }, [selectedDb, fetchTables])

  useEffect(() => {
    if (selectedTable) fetchTableData()
  }, [selectedTable, fetchTableData])

  // ─── الترتيب ───────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
    setPage(1)
  }

  // ─── تطبيق الفلاتر ─────────────────────────────────────────────────
  const applyFilters = () => {
    setActiveFilters(filters)
    setPage(1)
  }

  const clearFilters = () => {
    setFilters({})
    setActiveFilters({})
    setPage(1)
  }

  const hasActiveFilters = useMemo(
    () => Object.values(activeFilters).some((v) => v),
    [activeFilters]
  )

  // ─── الـ Primary Key ────────────────────────────────────────────────
  const pkColumn = useMemo(() => {
    if (!data?.schema) return null
    const pk = data.schema.find((s) => s.primaryKey)
    return pk?.name || data.schema[0]?.name || null
  }, [data])

  // ─── الحفظ (insert/update) ─────────────────────────────────────────
  const handleSave = async (values: Record<string, unknown>) => {
    if (!selectedDb || !selectedTable) return { success: false, error: 'خطأ' }

    if (editorMode === 'insert') {
      const res = await fetch(
        `/api/admin/db/${encodeURIComponent(selectedDb)}/${encodeURIComponent(selectedTable)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        }
      )
      const json = await res.json()
      if (json.success) {
        toast({ title: 'تم الإدراج', description: `rowId: ${json.rowId}` })
        fetchTableData()
        return { success: true }
      }
      return { success: false, error: json.error }
    } else {
      // update
      if (!pkColumn || !editingRow) {
        return { success: false, error: 'لا يوجد مفتاح أساسي' }
      }
      const pkValue = editingRow[pkColumn]
      const res = await fetch(
        `/api/admin/db/${encodeURIComponent(selectedDb)}/${encodeURIComponent(selectedTable)}/${encodeURIComponent(String(pkValue))}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values, primaryKeyColumn: pkColumn }),
        }
      )
      const json = await res.json()
      if (json.success) {
        toast({ title: 'تم التحديث', description: `${json.changes} صف` })
        fetchTableData()
        return { success: true }
      }
      return { success: false, error: json.error }
    }
  }

  // ─── مسح صف ────────────────────────────────────────────────────────
  const handleDeleteRow = async () => {
    if (!selectedDb || !selectedTable || !deleteRowTarget || !pkColumn) return

    const pkValue = deleteRowTarget[pkColumn]
    const res = await fetch(
      `/api/admin/db/${encodeURIComponent(selectedDb)}/${encodeURIComponent(selectedTable)}/${encodeURIComponent(String(pkValue))}?pk=${encodeURIComponent(pkColumn)}`,
      { method: 'DELETE' }
    )
    const json = await res.json()
    if (json.success) {
      toast({ title: 'تم المسح', description: `${json.changes} صف` })
      fetchTableData()
    } else {
      toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
    }
    setDeleteRowTarget(null)
  }

  // ─── مسف قاعدة بيانات ──────────────────────────────────────────────
  const handleDeleteDb = async () => {
    if (!deleteDbTarget) return
    if (confirmText !== deleteDbTarget.name) {
      toast({
        title: 'خطأ',
        description: 'اسم التأكيد غير مطابق',
        variant: 'destructive',
      })
      return
    }

    const res = await fetch(
      `/api/admin/db/${encodeURIComponent(deleteDbTarget.name)}?backup=true`,
      { method: 'DELETE' }
    )
    const json = await res.json()
    if (json.success) {
      toast({
        title: 'تم مسف القاعدة',
        description: json.backupPath
          ? `backup: ${json.backupPath.split('/').pop()}`
          : 'بدون backup',
      })
      if (selectedDb === deleteDbTarget.name) {
        setSelectedDb(null)
      }
      setDeleteDbTarget(null)
      setConfirmText('')
      fetchDatabases()
    } else {
      toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
    }
  }

  // ─── VACUUM ────────────────────────────────────────────────────────
  const handleVacuum = async (dbName: string) => {
    try {
      const res = await fetch(
        `/api/admin/db/${encodeURIComponent(dbName)}?action=vacuum`
      )
      const json = await res.json()
      if (json.success) {
        const saved = ((json.beforeSize - json.afterSize) / 1024).toFixed(0)
        toast({
          title: 'تم VACUUM',
          description: `وفّر ${saved} KB (${(json.beforeSize / 1024 / 1024).toFixed(2)}MB → ${(json.afterSize / 1024 / 1024).toFixed(2)}MB)`,
        })
        fetchDatabases()
      } else {
        toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'خطأ', description: String(e), variant: 'destructive' })
    }
  }

  // ─── فحص سلامة ─────────────────────────────────────────────────────
  const handleIntegrity = async (dbName: string) => {
    try {
      const res = await fetch('/api/admin/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'integrity', db: dbName }),
      })
      const json = await res.json()
      if (json.success) {
        toast({
          title: json.result === 'ok' ? '✓ سليمة' : '⚠ مشكلة',
          description: json.result,
          variant: json.result === 'ok' ? 'default' : 'destructive',
        })
      } else {
        toast({ title: 'خطأ', description: json.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'خطأ', description: String(e), variant: 'destructive' })
    }
  }

  // ─── تنسيق قيمة الخلية ─────────────────────────────────────────────
  const formatCell = (val: unknown): string => {
    if (val === null || val === undefined) return 'NULL'
    if (typeof val === 'object') return JSON.stringify(val).slice(0, 100) + (JSON.stringify(val).length > 100 ? '...' : '')
    const str = String(val)
    return str.length > 100 ? str.slice(0, 100) + '...' : str
  }

  const isCellNull = (val: unknown) => val === null || val === undefined

  // ─── إجمالي حجم الـ DBs ─────────────────────────────────────────────
  const totalSize = useMemo(
    () => databases.reduce((sum, d) => sum + d.size, 0),
    [databases]
  )

  return (
    <div className="space-y-4">
      {/* الهيدر */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DatabaseIcon className="h-5 w-5" />
              مدير قواعد البيانات
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <HardDrive className="h-3 w-3 mr-1" />
                الإجمالي: {(totalSize / 1024 / 1024).toFixed(2)} MB
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchDatabases} disabled={loadingDbs}>
                {loadingDbs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                تحديث
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* القائمة الجانبية — قواعد البيانات */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <DbIcon className="h-4 w-4" />
              قواعد البيانات ({databases.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)] min-h-[400px]">
              <div className="space-y-1 px-3 pb-3">
                {loadingDbs && databases.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : databases.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    مفيش قواعد بيانات
                  </div>
                ) : (
                  databases.map((db) => (
                    <div
                      key={db.name}
                      className={`rounded-lg border transition-colors cursor-pointer ${
                        selectedDb === db.name
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedDb(db.name)}
                    >
                      <div className="p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {db.protected ? (
                              <Shield className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                            ) : (
                              <DatabaseIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className="text-sm font-medium truncate">{db.name}</span>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Badge variant="secondary" className="text-[10px] h-4">
                            {db.sizeFormatted}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-4">
                            {db.tableCount} جدول
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-4">
                            {db.totalRows.toLocaleString()} صف
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleIntegrity(db.name)
                            }}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-0.5" />
                            فحص
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleVacuum(db.name)
                            }}
                          >
                            <Zap className="h-3 w-3 mr-0.5" />
                            ضغط
                          </Button>
                          {!db.protected && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteDbTarget(db)
                                setConfirmText('')
                              }}
                            >
                              <Trash2 className="h-3 w-3 mr-0.5" />
                              مسح
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* المنطقة الرئيسية */}
        <div className="space-y-4">
          {!selectedDb ? (
            <Card className="h-[calc(100vh-280px)] min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center">
                <DatabaseIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  اختر قاعدة بيانات من القائمة على اليسار
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* شريط الجداول */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TableIcon className="h-4 w-4" />
                      جداول {selectedDb}
                    </CardTitle>
                    {loadingTables && <Loader2 className="h-4 w-4 animate-spin" />}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="max-h-32">
                    <div className="flex flex-wrap gap-1.5">
                      {tables.map((t) => (
                        <Button
                          key={t.name}
                          variant={selectedTable === t.name ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setSelectedTable(t.name)
                            setPage(1)
                            setFilters({})
                            setActiveFilters({})
                            setSortColumn(null)
                          }}
                        >
                          {t.name}
                          <Badge
                            variant="secondary"
                            className="ml-1.5 text-[10px] h-4"
                          >
                            {t.rowCount.toLocaleString()}
                          </Badge>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* جدول البيانات */}
              {selectedTable && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TableIcon className="h-4 w-4" />
                        {selectedTable}
                        {data && (
                          <Badge variant="outline" className="ml-2">
                            {data.total.toLocaleString()} صف
                          </Badge>
                        )}
                        {hasActiveFilters && (
                          <Badge variant="secondary" className="ml-1">
                            <Filter className="h-3 w-3 mr-1" />
                            مُفلتر
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchTableData()}
                          disabled={loadingData}
                        >
                          {loadingData ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          تحديث
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditorMode('insert')
                            setEditingRow(null)
                            setEditorOpen(true)
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          صف جديد
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {loadingData && !data ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : data && data.rows.length > 0 ? (
                      <>
                        <div className="overflow-auto max-h-[calc(100vh-520px)] min-h-[300px] border-t">
                          <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                              <TableRow>
                                <TableHead className="w-[80px] text-center">إجراءات</TableHead>
                                {data.columns.map((col) => {
                                  const schema = data.schema.find((s) => s.name === col)
                                  const isSorted = sortColumn === col
                                  return (
                                    <TableHead key={col} className="min-w-[140px]">
                                      <div className="space-y-1">
                                        <button
                                          className="flex items-center gap-1 hover:text-primary transition-colors w-full text-left"
                                          onClick={() => handleSort(col)}
                                        >
                                          <span className="font-mono text-xs">{col}</span>
                                          {schema?.primaryKey && (
                                            <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                                              PK
                                            </Badge>
                                          )}
                                          {isSorted ? (
                                            sortDirection === 'asc' ? (
                                              <ChevronUp className="h-3 w-3 text-primary" />
                                            ) : (
                                              <ChevronDown className="h-3 w-3 text-primary" />
                                            )
                                          ) : (
                                            <div className="flex flex-col -space-y-1.5 opacity-30">
                                              <ChevronUp className="h-3 w-3" />
                                              <ChevronDown className="h-3 w-3" />
                                            </div>
                                          )}
                                        </button>
                                        {/* فلتر لكل عمود */}
                                        <div className="relative">
                                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                          <Input
                                            placeholder="فلتر..."
                                            value={filters[col] || ''}
                                            onChange={(e) =>
                                              setFilters({ ...filters, [col]: e.target.value })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') applyFilters()
                                            }}
                                            className="h-6 text-[10px] pl-6"
                                          />
                                        </div>
                                      </div>
                                    </TableHead>
                                  )
                                })}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.rows.map((row, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={() => {
                                          setEditorMode('update')
                                          setEditingRow(row)
                                          setEditorOpen(true)
                                        }}
                                      >
                                        <Edit3 className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                        onClick={() => setDeleteRowTarget(row)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                  {data.columns.map((col) => {
                                    const val = row[col]
                                    return (
                                      <TableCell
                                        key={col}
                                        className={`font-mono text-xs max-w-[300px] ${
                                          isCellNull(val) ? 'text-muted-foreground italic' : ''
                                        }`}
                                      >
                                        <div className="truncate" title={formatCell(val)}>
                                          {formatCell(val)}
                                        </div>
                                      </TableCell>
                                    )
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* شريط التقسيم */}
                        <div className="flex items-center justify-between gap-2 p-3 border-t flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">صفوف لكل صفحة:</span>
                            <Select
                              value={String(pageSize)}
                              onValueChange={(v) => {
                                setPageSize(Number(v))
                                setPage(1)
                              }}
                            >
                              <SelectTrigger className="h-7 w-[70px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PAGE_SIZES.map((s) => (
                                  <SelectItem key={s} value={String(s)}>
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="text-xs text-muted-foreground">
                            صف {data.page} من {data.totalPages} ({data.total.toLocaleString()} إجمالي)
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setPage(1)}
                              disabled={page === 1}
                            >
                              <ChevronsLeft className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setPage(page - 1)}
                              disabled={page === 1}
                            >
                              <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setPage(page + 1)}
                              disabled={page === data.totalPages}
                            >
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setPage(data.totalPages)}
                              disabled={page === data.totalPages}
                            >
                              <ChevronsRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* شريط الفلاتر */}
                        {hasActiveFilters && (
                          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t bg-muted/30">
                            <div className="flex items-center gap-2 text-xs">
                              <Filter className="h-3 w-3" />
                              <span>الفلاتر النشطة:</span>
                              {Object.entries(activeFilters)
                                .filter(([, v]) => v)
                                .map(([k, v]) => (
                                  <Badge key={k} variant="secondary" className="text-[10px]">
                                    {k} = {v}
                                  </Badge>
                                ))}
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>
                              مسح الفلاتر
                            </Button>
                          </div>
                        )}
                      </>
                    ) : data && data.rows.length === 0 ? (
                      <div className="text-center py-12">
                        <XCircle className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">مفيش بيانات</p>
                        {hasActiveFilters && (
                          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                            مسح الفلاتر
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal: محرر الصفوف */}
      {data?.schema && (
        <RowEditorModal
          open={editorOpen}
          onClose={() => {
            setEditorOpen(false)
            setEditingRow(null)
          }}
          schema={data.schema}
          initialRow={editingRow}
          mode={editorMode}
          onSave={handleSave}
        />
      )}

      {/* Dialog: تأكيد مسح صف */}
      <AlertDialog
        open={!!deleteRowTarget}
        onOpenChange={(open) => !open && setDeleteRowTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              مسف الصف؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من مسف هذا الصف؟ هذا الإجراء لا يمكن التراجع عنه.
              {pkColumn && deleteRowTarget && (
                <div className="mt-2 p-2 rounded bg-muted font-mono text-xs">
                  {pkColumn} = {String(deleteRowTarget[pkColumn])}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRow}
              className="bg-red-600 hover:bg-red-700"
            >
              مسف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: تأكيد مسف قاعدة بيانات */}
      <AlertDialog
        open={!!deleteDbTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDbTarget(null)
            setConfirmText('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              مسف قاعدة البيانات؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  هل أنت متأكد من مسف <strong className="font-mono">{deleteDbTarget?.name}</strong>؟
                </p>
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs">
                  ⚠️ سيتم عمل backup تلقائي قبل المسح في:{' '}
                  <code className="font-mono">db/backups/</code>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 rounded bg-muted">
                    <div className="text-muted-foreground">الحجم</div>
                    <div className="font-mono">{deleteDbTarget?.sizeFormatted}</div>
                  </div>
                  <div className="p-2 rounded bg-muted">
                    <div className="text-muted-foreground">الجداول</div>
                    <div className="font-mono">{deleteDbTarget?.tableCount}</div>
                  </div>
                  <div className="p-2 rounded bg-muted">
                    <div className="text-muted-foreground">الصفوف</div>
                    <div className="font-mono">{deleteDbTarget?.totalRows.toLocaleString()}</div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-medium">
                    اكتب اسم القاعدة للتأكيد:{' '}
                    <code className="font-mono text-red-500">{deleteDbTarget?.name}</code>
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={deleteDbTarget?.name}
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDb}
              className="bg-red-600 hover:bg-red-700"
              disabled={confirmText !== deleteDbTarget?.name}
            >
              مسف القاعدة نهائياً
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

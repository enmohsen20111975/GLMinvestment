'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Database,
    Table as TableIcon,
    ChevronRight,
    ChevronDown,
    Search,
    RefreshCw,
    Loader2,
    FileText,
    HardDrive,
    Clock,
    AlertCircle,
    ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface DbInfo {
    name: string;
    size_mb: number;
    last_modified: string;
    tables?: { name: string; rows: number }[];
}

interface TableData {
    name: string;
    columns: { name: string; type: string; not_null: boolean; pk: boolean }[];
    total_rows: number;
    page: number;
    total_pages: number;
    rows: Record<string, any>[];
}

export function DatabaseExplorer() {
    const [databases, setDatabases] = useState<DbInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedDb, setExpandedDb] = useState<string | null>(null);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [tableData, setTableData] = useState<TableData | null>(null);
    const [tableLoading, setTableLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [dbTables, setDbTables] = useState<Record<string, { name: string; rows: number }[]>>({});

    const fetchDatabases = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/db-explorer');
            const json = await res.json();
            if (json.success) {
                setDatabases(json.databases);
            }
        } catch (e) {
            console.error('Failed to fetch databases:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchTables = useCallback(async (dbName: string) => {
        try {
            const res = await fetch(`/api/admin/db-explorer?db=${encodeURIComponent(dbName)}`);
            const json = await res.json();
            if (json.success) {
                setDbTables(prev => ({ ...prev, [dbName]: json.tables }));
            }
        } catch (e) {
            console.error('Failed to fetch tables:', e);
        }
    }, []);

    const fetchTableData = useCallback(async (dbName: string, tableName: string, pageNum: number) => {
        setTableLoading(true);
        setSelectedTable(tableName);
        try {
            const res = await fetch(
                `/api/admin/db-explorer?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}&page=${pageNum}&limit=20`
            );
            const json = await res.json();
            if (json.success) {
                setTableData(json.table);
                setPage(pageNum);
            }
        } catch (e) {
            console.error('Failed to fetch table data:', e);
        } finally {
            setTableLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDatabases();
    }, [fetchDatabases]);

    const handleDbToggle = (dbName: string) => {
        if (expandedDb === dbName) {
            setExpandedDb(null);
            setSelectedTable(null);
            setTableData(null);
        } else {
            setExpandedDb(dbName);
            if (!dbTables[dbName]) {
                fetchTables(dbName);
            }
            setSelectedTable(null);
            setTableData(null);
        }
    };

    const filteredDbs = databases.filter(db =>
        db.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const formatSize = (mb: number) => {
        if (mb < 1) return `${Math.round(mb * 1024)} KB`;
        if (mb < 100) return `${mb.toFixed(2)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    };

    const formatDate = (date: string) => {
        try {
            return new Date(date).toLocaleString('ar-EG', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch { return date; }
    };

    const totalSize = databases.reduce((acc, db) => acc + db.size_mb, 0);

    return (
        <div className="space-y-4" dir="rtl">
            {/* Header */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center">
                                <Database className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">مستكشف قواعد البيانات</h2>
                                <p className="text-sm text-muted-foreground">
                                    {databases.length} قاعدة بيانات · {formatSize(totalSize)} إجمالي
                                </p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={fetchDatabases} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 ml-2', loading && 'animate-spin')} />
                            تحديث
                        </Button>
                    </div>

                    {/* Search */}
                    <div className="relative mt-4">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="ابحث عن قاعدة بيانات..."
                            className="pr-10"
                        />
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                    <span className="mr-3 text-lg text-blue-600 font-bold">جاري تحميل قواعد البيانات...</span>
                </div>
            ) : filteredDbs.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                        <p className="text-muted-foreground">لا توجد قواعد بيانات</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Database List */}
                    <div className="lg:col-span-1 space-y-2">
                        {filteredDbs.map((db) => (
                            <Card
                                key={db.name}
                                className={cn(
                                    'cursor-pointer transition-all hover:border-blue-300',
                                    expandedDb === db.name && 'border-blue-500'
                                )}
                                onClick={() => handleDbToggle(db.name)}
                            >
                                <CardContent className="p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            {expandedDb === db.name ? (
                                                <ChevronDown className="w-4 h-4 flex-shrink-0 text-blue-500" />
                                            ) : (
                                                <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                                            )}
                                            <HardDrive className="w-4 h-4 flex-shrink-0 text-blue-500" />
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium truncate">{db.name}</div>
                                                <div className="text-xs text-muted-foreground">{formatSize(db.size_mb)}</div>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] flex-shrink-0">
                                            {dbTables[db.name]?.length || '?'} جداول
                                        </Badge>
                                    </div>

                                    {/* Tables list */}
                                    {expandedDb === db.name && dbTables[db.name] && (
                                        <div className="mt-2 space-y-1 pr-6">
                                            {dbTables[db.name].map((table) => (
                                                <button
                                                    key={table.name}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        fetchTableData(db.name, table.name, 1);
                                                    }}
                                                    className={cn(
                                                        'flex items-center justify-between w-full p-2 rounded-lg text-xs transition-colors',
                                                        selectedTable === table.name
                                                            ? 'bg-blue-100 dark:bg-blue-950/30 text-blue-700'
                                                            : 'hover:bg-muted'
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <TableIcon className="w-3 h-3 flex-shrink-0" />
                                                        <span className="truncate">{table.name}</span>
                                                    </div>
                                                    <span className="text-muted-foreground">{table.rows.toLocaleString()}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Table Data */}
                    <div className="lg:col-span-2">
                        {tableLoading ? (
                            <Card>
                                <CardContent className="py-20 flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                                </CardContent>
                            </Card>
                        ) : tableData ? (
                            <Card>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <TableIcon className="w-4 h-4 text-blue-500" />
                                                {tableData.name}
                                            </CardTitle>
                                            <CardDescription>
                                                {tableData.total_rows.toLocaleString()} صف · {tableData.columns.length} عمود
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline">
                                                صفحة {page} من {tableData.total_pages}
                                            </Badge>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {/* Pagination */}
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline" size="sm"
                                                onClick={() => fetchTableData(expandedDb!, tableData.name, page - 1)}
                                                disabled={page <= 1}
                                            >
                                                السابق
                                            </Button>
                                            <Button
                                                variant="outline" size="sm"
                                                onClick={() => fetchTableData(expandedDb!, tableData.name, page + 1)}
                                                disabled={page >= tableData.total_pages}
                                            >
                                                التالي
                                            </Button>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            عرض {(page - 1) * 20 + 1}-{Math.min(page * 20, tableData.total_rows)} من {tableData.total_rows.toLocaleString()}
                                        </span>
                                    </div>

                                    {/* Table */}
                                    <div className="overflow-x-auto border rounded-lg">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-muted/50">
                                                    {tableData.columns.map((col) => (
                                                        <th key={col.name} className="p-2 text-right font-medium whitespace-nowrap border-l last:border-l-0">
                                                            <div className="flex items-center gap-1">
                                                                {col.name}
                                                                {col.pk && <Badge variant="outline" className="text-[8px] px-1">PK</Badge>}
                                                            </div>
                                                            <div className="text-[10px] text-muted-foreground">{col.type}</div>
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tableData.rows.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={tableData.columns.length} className="p-8 text-center text-muted-foreground">
                                                            لا توجد بيانات
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    tableData.rows.map((row, i) => (
                                                        <tr key={i} className="border-t hover:bg-muted/30">
                                                            {tableData.columns.map((col) => (
                                                                <td key={col.name} className="p-2 border-l last:border-l-0 max-w-[200px] truncate">
                                                                    {formatCellValue(row[col.name])}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="py-20 text-center">
                                    <Database className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                                    <p className="text-muted-foreground">اختر جدولاً لعرض بياناته</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        اختر قاعدة بيانات من اليمين، ثم اختر جدول
                                    </p>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            )}

            {/* Summary */}
            {databases.length > 0 && (
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Database className="w-3 h-3" />
                                {databases.length} قواعد بيانات
                            </span>
                            <span className="flex items-center gap-1">
                                <HardDrive className="w-3 h-3" />
                                {formatSize(totalSize)}
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                آخر تحديث: {formatDate(Math.max(...databases.map(d => new Date(d.last_modified).getTime())).toString())}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function formatCellValue(value: any): React.ReactNode {
    if (value === null || value === undefined) {
        return <span className="text-muted-foreground italic">NULL</span>;
    }
    if (typeof value === 'object') {
        try { return JSON.stringify(value).slice(0, 100); }
        catch { return String(value); }
    }
    if (typeof value === 'boolean') {
        return value ? '✅' : '❌';
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return value.toLocaleString();
        return value.toFixed(4);
    }
    return String(value).slice(0, 200);
}
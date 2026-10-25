'use client';

/**
 * db-manager/SqlConsolePanel.tsx
 * =================================
 * SQL Console tab — textarea for raw SQL, dry-run (EXPLAIN) toggle,
 * example queries, history (last 20), and result table with CSV/JSON export.
 */

import { useMemo } from 'react';
import {
  Play,
  Eraser,
  History,
  Loader2,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Zap,
  Clock,
  FileSpreadsheet,
  FileJson,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { formatCell, downloadTextFile, EXAMPLE_QUERIES, RESULT_LIMIT } from './helpers';
import type { SqlConsolePanelProps } from './types';

export function SqlConsolePanel(props: SqlConsolePanelProps) {
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
              تنفيذ SQL — <span className="font-mono text-profit">{props.dbName}</span>
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
              <span className="text-xs text-muted-foreground ml-1">أمثلة:</span>
              {EXAMPLE_QUERIES.map((ex) => (
                <Button
                  key={ex.label}
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
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
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <History className="w-3 h-3" />
                  آخر {props.history.length} استعلام
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive"
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
                    className="block w-full text-right p-1.5 rounded border text-xs font-mono hover:bg-accent truncate"
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
                  <Zap className="w-4 h-4 text-warning" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-profit" />
                )}
                النتيجة
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  <Clock className="w-2.5 h-2.5" />
                  {props.result.durationMs} ms
                </Badge>
                {props.result.isWrite ? (
                  <Badge variant="outline" className="text-xs bg-warning/20 text-warning ">
                    {props.result.affected.toLocaleString('en-US')} صف متأثر
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="text-xs">
                      {props.result.rows.length} صف
                    </Badge>
                    {props.result.truncated && (
                      <Badge variant="outline" className="text-xs bg-warning/20 text-warning ">
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
                      className="h-7 text-xs"
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
                      className="h-7 text-xs"
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
                            <TableHead key={k} className="text-right font-mono text-xs">
                              {k}
                            </TableHead>
                          ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {props.result.explainPlan.map((row, i) => (
                        <TableRow key={i}>
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j} className="font-mono text-xs">
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
                <CheckCircle2 className="w-10 h-10 mx-auto text-profit mb-2" />
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
                        <TableHead key={c} className="text-right font-mono text-xs">
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

'use client';

/**
 * InvestorsDataEntryTab
 * ======================
 * Admin tab for manual entry of EGX investor-flow data
 * (مصريين / عرب / أجانب — buy/sell/net).
 *
 * Owner directive (2026-10-22): "اديـنى امكانية انى احط البيانات دى من
 * لوحة الادمن" — when automated scraping fails or produces wrong values,
 * the admin opens EGX in their real browser, reads the numbers, and enters
 * them here. The data is upserted to investors_data with
 * source='admin_manual_entry' (NOT 'computed_estimate' — so it shows on
 * the dashboard panel + passes the freshness gate).
 *
 * POST /api/admin/investors-data — upserts one day's data.
 * GET  /api/admin/investors-data — returns last 10 real rows for preview.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Users, Save, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { WidgetCard } from '@/components/shared/WidgetCard';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toFixed(0);
}

function netColor(n: number): string {
  return n >= 0 ? 'text-profit' : 'text-loss';
}

interface Row {
  date: string;
  individuals_buys_value: number | null;
  individuals_sells_value: number | null;
  individuals_net_value: number | null;
  arab_buys_value: number | null;
  arab_sells_value: number | null;
  arab_net_value: number | null;
  foreign_buys_value: number | null;
  foreign_sells_value: number | null;
  foreign_net_value: number | null;
  source: string | null;
}

export function InvestorsDataEntryTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [egyBuys, setEgyBuys] = useState('');
  const [egySells, setEgySells] = useState('');
  const [arabBuys, setArabBuys] = useState('');
  const [arabSells, setArabSells] = useState('');
  const [foreignBuys, setForeignBuys] = useState('');
  const [foreignSells, setForeignSells] = useState('');
  const [numTrades, setNumTrades] = useState('');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/investors-data');
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } catch (e) {
      // silent
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const n = (v: string) => Number(v.replace(/,/g, '').trim()) || 0;

  const egyNet = n(egyBuys) - n(egySells);
  const arabNet = n(arabBuys) - n(arabSells);
  const foreignNet = n(foreignBuys) - n(foreignSells);

  const handleSave = async () => {
    if (!date) { toast.error('التاريخ مطلوب'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/investors-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          egyptians_buys: n(egyBuys),
          egyptians_sells: n(egySells),
          arab_buys: n(arabBuys),
          arab_sells: n(arabSells),
          foreign_buys: n(foreignBuys),
          foreign_sells: n(foreignSells),
          number_of_trades: numTrades ? n(numTrades) : 0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`تم حفظ بيانات ${date} — صافي مصريين: ${fmt(data.row.egy_net)}`);
        fetchRows();
      } else {
        toast.error(data.error || 'فشل الحفظ');
      }
    } catch (e: any) {
      toast.error('خطأ في الشبكة: ' + (e?.message || ''));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <WidgetCard
        title="إدخال بيانات تدفّق المستثمرين (EGX)"
        icon={Users}
        hideRefresh
        headerClassName="pb-2"
      >
        {/* Help banner */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs">
          <ExternalLink className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <div className="font-semibold">المصدر الرسمي:</div>
            <a href="https://beta.egx.com.eg/ar/market/investors" target="_blank" rel="noopener"
               className="text-primary underline break-all">
              https://beta.egx.com.eg/ar/market/investors
            </a>
            <div className="text-muted-foreground">
              افتح الرابط في المتصفح، اقرأ الأرقام (شراء/بيع لكل نوع)، وأدخلها بالجنيه المصري (مثال: 1.22B = 1220000000).
            </div>
          </div>
        </div>

        {/* Date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="date">التاريخ</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="trades">عدد الصفقات (اختياري)</Label>
            <Input id="trades" placeholder="1174000" value={numTrades} onChange={(e) => setNumTrades(e.target.value)} />
          </div>
        </div>

        {/* Input table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead>شراء (ج.م)</TableHead>
                <TableHead>بيع (ج.م)</TableHead>
                <TableHead>صافي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-semibold">مصريين</TableCell>
                <TableCell><Input placeholder="1220000000" value={egyBuys} onChange={(e) => setEgyBuys(e.target.value)} /></TableCell>
                <TableCell><Input placeholder="900000000" value={egySells} onChange={(e) => setEgySells(e.target.value)} /></TableCell>
                <TableCell className={netColor(egyNet) + ' font-bold tabular-nums'}>{fmt(egyNet)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">عرب</TableCell>
                <TableCell><Input placeholder="0" value={arabBuys} onChange={(e) => setArabBuys(e.target.value)} /></TableCell>
                <TableCell><Input placeholder="0" value={arabSells} onChange={(e) => setArabSells(e.target.value)} /></TableCell>
                <TableCell className={netColor(arabNet) + ' font-bold tabular-nums'}>{fmt(arabNet)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">أجانب</TableCell>
                <TableCell><Input placeholder="121000000" value={foreignBuys} onChange={(e) => setForeignBuys(e.target.value)} /></TableCell>
                <TableCell><Input placeholder="484000000" value={foreignSells} onChange={(e) => setForeignSells(e.target.value)} /></TableCell>
                <TableCell className={netColor(foreignNet) + ' font-bold tabular-nums'}>{fmt(foreignNet)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 ml-1" />
            {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
          </Button>
          <Button variant="outline" onClick={fetchRows} disabled={loading}>
            <RefreshCw className="w-4 h-4 ml-1" />
            تحديث
          </Button>
        </div>
      </WidgetCard>

      {/* Preview of existing rows */}
      <WidgetCard
        title="آخر البيانات المدخلة"
        hideRefresh
        headerClassName="pb-2"
      >
        {rows.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            لا توجد بيانات بعد. أدخل أول صف أعلاه.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>مصريين (صافي)</TableHead>
                  <TableHead>عرب (صافي)</TableHead>
                  <TableHead>أجانب (صافي)</TableHead>
                  <TableHead>المصدر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.date}</TableCell>
                    <TableCell className={netColor(r.individuals_net_value ?? 0) + ' font-bold tabular-nums'}>
                      {fmt(r.individuals_net_value ?? 0)}
                    </TableCell>
                    <TableCell className={netColor(r.arab_net_value ?? 0) + ' font-bold tabular-nums'}>
                      {fmt(r.arab_net_value ?? 0)}
                    </TableCell>
                    <TableCell className={netColor(r.foreign_net_value ?? 0) + ' font-bold tabular-nums'}>
                      {fmt(r.foreign_net_value ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {r.source || 'unknown'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </WidgetCard>
    </div>
  );
}

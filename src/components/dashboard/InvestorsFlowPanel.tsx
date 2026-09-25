'use client';

/**
 * InvestorsFlowPanel — حركة المستثمرين (العرب + الأجانب)
 * =======================================================
 * يعرض تدفق الأموال من المستثمرين:
 * - الأفراد (شراء/بيع/صافي)
 * - العرب (شراء/بيع/صافي)
 * - الأجانب (شراء/بيع/صافي)
 * - إجمالي الصفقات
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface InvestorData {
  date: string;
  individuals_buys: number;
  individuals_sells: number;
  individuals_net: number;
  arab_buys: number;
  arab_sells: number;
  arab_net: number;
  foreign_buys: number;
  foreign_sells: number;
  foreign_net: number;
  total_buys: number;
  total_sells: number;
  number_of_trades: number;
}

export function InvestorsFlowPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvestorData | null>(null);
  const [history, setHistory] = useState<InvestorData[]>([]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/egx/investors?latest=true&days=7');
      const json = await res.json();
      if (json.success) {
        if (json.latest) setData(json.latest);
        if (json.history) setHistory(json.history);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <Card dir="rtl" className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري تحميل بيانات المستثمرين...
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card dir="rtl" className="p-4">
        <div className="text-center text-xs text-muted-foreground py-4">
          لا توجد بيانات مستثمرين متاحة حالياً
        </div>
      </Card>
    );
  }

  const formatNum = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return n.toFixed(0);
  };

  const Row = ({ label, buys, sells, net }: { label: string; buys: number; sells: number; net: number }) => (
    <div className="grid grid-cols-4 gap-1 items-center py-1.5 border-b border-border/30 last:border-0">
      <div className="text-xs font-medium">{label}</div>
      <div className="text-xs text-emerald-600 text-center">{formatNum(buys)}</div>
      <div className="text-xs text-red-600 text-center">{formatNum(sells)}</div>
      <div className={cn("text-xs text-center font-bold", net >= 0 ? "text-emerald-600" : "text-red-600")}>
        {net >= 0 ? '+' : ''}{formatNum(net)}
      </div>
    </div>
  );

  return (
    <Card dir="rtl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-500" />
          حركة المستثمرين
          {data.date && <Badge variant="outline" className="text-[10px]">{data.date}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Header */}
        <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground pb-1 border-b border-border/50">
          <div>الفئة</div>
          <div className="text-center text-emerald-500">شراء</div>
          <div className="text-center text-red-500">بيع</div>
          <div className="text-center">صافي</div>
        </div>

        {/* Rows */}
        <Row label="الأفراد" buys={data.individuals_buys} sells={data.individuals_sells} net={data.individuals_net} />
        <Row label="العرب" buys={data.arab_buys} sells={data.arab_sells} net={data.arab_net} />
        <Row label="الأجانب" buys={data.foreign_buys} sells={data.foreign_sells} net={data.foreign_net} />

        {/* Summary */}
        <div className="mt-3 pt-2 border-t border-border/50 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">إجمالي التداول:</span>
            <span className="font-bold">{formatNum(data.total_buys + data.total_sells)} ج.م</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">عدد الصفقات:</span>
            <span className="font-bold">{data.number_of_trades?.toLocaleString() || '—'}</span>
          </div>
        </div>

        {/* Trend indicators */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
          {data.arab_net >= 0 ? (
            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
              <TrendingUp className="w-3 h-3 ml-1" />
              العرب يشترون
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30">
              <TrendingDown className="w-3 h-3 ml-1" />
              العرب يبيعون
            </Badge>
          )}
          {data.foreign_net >= 0 ? (
            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
              <TrendingUp className="w-3 h-3 ml-1" />
              الأجانب يشترون
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30">
              <TrendingDown className="w-3 h-3 ml-1" />
              الأجانب يبيعون
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

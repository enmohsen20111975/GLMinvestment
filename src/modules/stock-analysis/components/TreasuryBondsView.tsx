'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Landmark,
  FileText,
  Calendar,
  Percent,
  TrendingUp,
  Shield,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';

// Types
interface TreasuryBond {
  symbol: string;
  name: string;
  name_ar: string;
  coupon_rate: number;
  maturity_date: string;
  issue_date: string;
  current_price: number;
  par_value: number;
  ytm: number; // Yield to Maturity
  duration: string;
  type: 'government_bond' | 'investment_certificate' | 'treasury_bill';
}

interface BondsData {
  government_bonds: TreasuryBond[];
  investment_certificates: TreasuryBond[];
  treasury_bills: TreasuryBond[];
}

// ملاحظة: تم حذف MOCK_BONDS بالكامل — لا توجد بيانات سندات حقيقية متاحة في النظام.
// المكوّن يحاول الآن جلب البيانات من /api/bonds (إذا توفّر مستقبلاً) ويعرض حالة فارغة صادقة عند عدم التوفّر.

type TabType = 'government_bonds' | 'investment_certificates' | 'treasury_bills';

const TABS: { key: TabType; label: string; icon: React.ReactNode }[] = [
  { key: 'government_bonds', label: 'السندات الحكومية', icon: <Landmark className="w-4 h-4" /> },
  { key: 'investment_certificates', label: 'شهادات الاستثمار', icon: <FileText className="w-4 h-4" /> },
  { key: 'treasury_bills', label: 'أذون الخزانة', icon: <Percent className="w-4 h-4" /> },
];

function BondRow({ bond }: { bond: TreasuryBond }) {
  const maturityDate = new Date(bond.maturity_date);
  const issueDate = new Date(bond.issue_date);
  const daysToMaturity = Math.ceil((maturityDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
            {bond.symbol}
          </span>
          <span className="text-xs text-muted-foreground">{bond.name_ar}</span>
        </div>
      </TableCell>
      <TableCell className="text-left tabular-nums">
        <span className="font-semibold text-sm">
          {bond.type === 'investment_certificate' 
            ? bond.current_price.toLocaleString() 
            : bond.current_price.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground mr-1">ج.م</span>
      </TableCell>
      <TableCell className="text-left tabular-nums">
        {bond.coupon_rate > 0 ? (
          <div className="flex items-center gap-1">
            <Percent className="w-3 h-3 text-muted-foreground" />
            <span className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">
              {bond.coupon_rate.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </TableCell>
      <TableCell className="text-left tabular-nums">
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-amber-500" />
          <span className="font-semibold text-sm text-amber-600 dark:text-amber-400">
            {bond.ytm.toFixed(2)}%
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <span className="text-sm">{bond.duration}</span>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {maturityDate.toLocaleDateString('ar-EG')}
          </span>
          <Badge 
            variant={daysToMaturity < 90 ? "default" : "secondary"} 
            className={cn(
              "text-[10px] w-fit",
              daysToMaturity < 90 && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            )}
          >
            <Clock className="w-3 h-3 ml-1" />
            {daysToMaturity} يوم
          </Badge>
        </div>
      </TableCell>
    </TableRow>
  );
}

function BondsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 border-b border-border/50">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-28" />
        </div>
      ))}
    </div>
  );
}

// UnifiedTable columns for bonds (Rule 52 — uses UnifiedTable instead of manual <Table>)
const bondColumns: Column<TreasuryBond>[] = [
  {
    key: 'symbol',
    header: 'الرمز / الاسم',
    align: 'right',
    sortable: true,
    render: (bond) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
          {bond.symbol}
        </span>
        <span className="text-xs text-muted-foreground">{bond.name_ar}</span>
      </div>
    ),
  },
  {
    key: 'current_price',
    header: 'السعر',
    align: 'left',
    sortable: true,
    render: (bond) => (
      <span className="text-left tabular-nums inline-block w-full">
        <span className="font-semibold text-sm">
          {bond.type === 'investment_certificate'
            ? bond.current_price.toLocaleString()
            : bond.current_price.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground mr-1">ج.م</span>
      </span>
    ),
  },
  {
    key: 'coupon_rate',
    header: 'العائد السنوي',
    align: 'left',
    sortable: true,
    render: (bond) =>
      bond.coupon_rate > 0 ? (
        <span className="text-left tabular-nums inline-flex items-center gap-1 w-full justify-start">
          <Percent className="w-3 h-3 text-muted-foreground" />
          <span className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">
            {bond.coupon_rate.toFixed(2)}%
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
  },
  {
    key: 'ytm',
    header: 'العائد للاستحقاق',
    align: 'left',
    sortable: true,
    render: (bond) => (
      <span className="text-left tabular-nums inline-flex items-center gap-1 w-full justify-start">
        <TrendingUp className="w-3 h-3 text-amber-500" />
        <span className="font-semibold text-sm text-amber-600 dark:text-amber-400">
          {bond.ytm.toFixed(2)}%
        </span>
      </span>
    ),
  },
  {
    key: 'duration',
    header: 'المدة',
    align: 'right',
    sortable: true,
    render: (bond) => <span className="text-sm">{bond.duration}</span>,
  },
  {
    key: 'maturity_date',
    header: 'تاريخ الاستحقاق',
    align: 'right',
    sortable: true,
    render: (bond) => {
      const maturityDate = new Date(bond.maturity_date);
      const daysToMaturity = Math.ceil(
        (maturityDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {maturityDate.toLocaleDateString('ar-EG')}
          </span>
          <Badge
            variant={daysToMaturity < 90 ? 'default' : 'secondary'}
            className={cn(
              'text-[10px] w-fit',
              daysToMaturity < 90 &&
                'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
            )}
          >
            <Clock className="w-3 h-3 ml-1" />
            {daysToMaturity} يوم
          </Badge>
        </div>
      );
    },
  },
];

export function TreasuryBondsView() {
  const [activeTab, setActiveTab] = useState<TabType>('government_bonds');
  const [bonds, setBonds] = useState<BondsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [integrationPending, setIntegrationPending] = useState(false);

  const loadBonds = async () => {
    setIsLoading(true);
    try {
      // محاولة جلب بيانات سندات حقيقية من /api/bonds (إذا أُضيف مستقبلاً).
      // ممنوع استخدام بيانات مُفبركة — نعرض حالة فارغة عند عدم التوفّر.
      const response = await fetch('/api/bonds', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        if (data && (data.government_bonds || data.investment_certificates || data.treasury_bills)) {
          setBonds({
            government_bonds: Array.isArray(data.government_bonds) ? data.government_bonds : [],
            investment_certificates: Array.isArray(data.investment_certificates) ? data.investment_certificates : [],
            treasury_bills: Array.isArray(data.treasury_bills) ? data.treasury_bills : [],
          });
          setIntegrationPending(false);
          setLastUpdate(new Date());
          return;
        }
      }
      // لا يوجد API حقيقي للسندات — عرض حالة فارغة صادقة.
      setBonds(null);
      setIntegrationPending(true);
    } catch (error) {
      console.error('Failed to load bonds:', error);
      setBonds(null);
      setIntegrationPending(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBonds();
  }, []);

  const currentBonds = bonds ? bonds[activeTab] : [];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card className="py-0 gap-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <Landmark className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="font-bold text-lg">أدوات الدخل الثابت</h2>
                <p className="text-sm text-muted-foreground">
                  السندات الحكومية وشهادات الاستثمار وأذون الخزانة
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lastUpdate && (
                <span className="text-xs text-muted-foreground">
                  آخر تحديث: {lastUpdate.toLocaleTimeString('ar-EG')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={loadBonds}
                disabled={isLoading}
                className="h-8 gap-1"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                تحديث
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap border',
              activeTab === tab.key
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Info Banner */}
      <Card className="py-0 gap-0 bg-blue-50 dark:bg-blue-950/20 border-teal-200 dark:border-teal-900">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-teal-700 dark:text-teal-300">
              <strong>تنبيه:</strong> الأسعار المعروضة هي آخر أسعار التداول وقد تختلف عن الأسعار الحالية.
              يرجى التحقق من الأسعار من مصادرك المعتادة قبل اتخاذ أي قرار استثماري.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="py-0 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <BondsSkeleton />
            </div>
          ) : integrationPending ? (
            <div className="p-8 text-center">
              <div className="flex flex-col items-center gap-3 max-w-md mx-auto">
                <div className="p-3 bg-muted/50 rounded-full">
                  <Landmark className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-base font-medium">لا توجد سندات متاحة حالياً</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  تكامل بيانات السندات الحكومية وشهادات الاستثمار وأذون الخزانة قيد التنفيذ.
                  ستظهر البيانات هنا تلقائياً عند توفّر مصدر حقيقي لها (مثل CBE أو Egypt Bond Index).
                </p>
                <Button variant="outline" size="sm" onClick={loadBonds} className="mt-1 h-8 gap-1">
                  <RefreshCw className="w-3.5 h-3.5" />
                  إعادة المحاولة
                </Button>
              </div>
            </div>
          ) : (
            <UnifiedTable<TreasuryBond>
              columns={bondColumns}
              data={currentBonds}
              keyField="symbol"
              emptyTextAr="لا توجد بيانات متاحة في هذا القسم"
              emptyText="لا توجد بيانات متاحة في هذا القسم"
            />
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {!isLoading && bonds && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="py-0 gap-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                  <Landmark className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">السندات الحكومية</p>
                  <p className="text-lg font-bold">{bonds.government_bonds.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="py-0 gap-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                  <FileText className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">شهادات الاستثمار</p>
                  <p className="text-lg font-bold">{bonds.investment_certificates.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="py-0 gap-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <Percent className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">أذون الخزانة</p>
                  <p className="text-lg font-bold">{bonds.treasury_bills.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Package,
  Coins,
  Building2,
  Landmark,
  FileCheck,
  BarChart3,
  DollarSign,
  Gem,
  Home,
  Banknote,
  Wallet,
} from 'lucide-react';
import { WealthCommandCenter } from '@/components/portfolio/WealthCommandCenter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

// Types
interface StockAsset {
  id: string;
  stock_symbol: string;
  stock_name?: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  profit_loss: number;
  profit_loss_percent: number;
  action?: string;
  action_ar?: string;
  reason?: string;
  alerts?: string[];
  confidence?: number;
  stop_loss?: number;
  take_profit?: number;
  rsi?: number;
}

interface GoldAsset {
  id: string;
  name: string;
  weight_grams: number;
  purchase_price_per_gram: number;
  total_cost: number;
  karat: number;
  current_price_per_gram: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
}

interface RealEstateAsset {
  id: string;
  name: string;
  property_type: string;
  address?: string;
  purchase_price: number;
  estimated_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  area_sqm?: number;
  is_rented: boolean;
  monthly_rent?: number;
}

interface BankDeposit {
  id: string;
  bank_name: string;
  deposit_type: string;
  principal_amount: number;
  interest_rate: number;
  interest_accrued: number;
  total_value: number;
  days_elapsed: number;
}

interface InvestmentCertificate {
  id: string;
  certificate_name: string;
  bank_name: string;
  principal_amount: number;
  annual_return_rate: number;
  total_return: number;
  current_value: number;
  days_elapsed: number;
}

interface InvestmentFund {
  id: string;
  fund_name: string;
  units_owned: number;
  purchase_price_per_unit: number;
  total_cost: number;
  current_value: number;
  profit_loss: number;
  profit_loss_percent: number;
}

interface ForeignCurrency {
  id: string;
  currency_code: string;
  currency_name?: string;
  amount: number;
  purchase_rate: number;
  purchase_cost_egp: number;
  current_rate: number;
  current_value_egp: number;
  profit_loss: number;
  profit_loss_percent: number;
}

interface PortfolioData {
  success: boolean;
  assets: {
    stocks?: StockAsset[];
    gold?: GoldAsset[];
    real_estate?: RealEstateAsset[];
    deposits?: BankDeposit[];
    certificates?: InvestmentCertificate[];
    funds?: InvestmentFund[];
    currencies?: ForeignCurrency[];
  };
  summary: {
    total_value: number;
    total_cost: number;
    total_profit_loss: number;
    total_profit_loss_percent: number;
  };
  history?: { date: string; value: number }[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '0.00%';
  }
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function PLBadge({ profitLoss, profitLossPercent }: { profitLoss: number; profitLossPercent: number }) {
  const safeProfitLoss = profitLoss ?? 0;
  const safeProfitLossPercent = profitLossPercent ?? 0;
  const isProfit = safeProfitLoss >= 0;
  return (
    <div className={`p-2 rounded-lg ${isProfit ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
      <p className={`font-bold text-sm ${isProfit ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">
        {formatCurrency(safeProfitLoss)}
      </p>
      <p className={`text-xs ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
        {formatPercent(safeProfitLossPercent)}
      </p>
    </div>
  );
}

// القرار الذكي (محسوب في بايثون عبر SmartPortfolioMonitor)
function actionStyle(action?: string): string {
  switch (action) {
    case 'STOP_LOSS':
    case 'SELL':
      return 'bg-red-600 text-white';
    case 'TAKE_PROFIT':
      return 'bg-emerald-600 text-white';
    case 'BUY_MORE':
      return 'bg-blue-600 text-white';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

// Asset Cards
function StockCard({ stock }: { stock: StockAsset }) {
  const avgCost = stock.avg_cost ?? 0;
  const currentPrice = stock.current_price ?? 0;
  const alerts = stock.alerts || [];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold">{stock.stock_symbol}</h3>
              <Badge variant="outline" className="text-xs">سهم</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{stock.stock_name || stock.stock_symbol}</p>
          </div>
          <PLBadge profitLoss={stock.profit_loss ?? 0} profitLossPercent={stock.profit_loss_percent ?? 0} />
        </div>

        {stock.action_ar ? (
          <div className={`mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${actionStyle(stock.action)}`}>
            <span>{stock.action_ar}</span>
            {stock.confidence ? <span className="text-xs opacity-90">ثقة {stock.confidence}%</span> : null}
          </div>
        ) : null}
        {stock.reason ? (
          <p className="mt-2 text-xs text-muted-foreground">{stock.reason}</p>
        ) : null}
        {alerts.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {alerts.map((a, i) => (
              <li key={i} className="text-xs text-red-600 dark:text-red-400">{a}</li>
            ))}
          </ul>
        ) : null}

        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">الكمية</p>
            <p className="font-medium">{(stock.shares ?? 0).toLocaleString()}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">متوسط التكلفة</p>
            <p className="font-medium" dir="ltr">{avgCost.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">السعر الحالي</p>
            <p className="font-medium" dir="ltr">{currentPrice > 0 ? currentPrice.toFixed(2) : '-'}</p>
          </div>
        </div>
        <div className="flex justify-between mt-3 text-sm">
          <span className="text-muted-foreground">القيمة السوقية:</span>
          <span className="font-medium" dir="ltr">{formatCurrency(stock.market_value ?? 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function GoldCard({ gold }: { gold: GoldAsset }) {
  const weightGrams = gold.weight_grams ?? 0;
  const purchasePricePerGram = gold.purchase_price_per_gram ?? 0;
  const currentPricePerGram = gold.current_price_per_gram ?? purchasePricePerGram;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <Gem className="w-4 h-4 text-yellow-500" />
              <h3 className="font-bold">{gold.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground">عيار {gold.karat ?? 21}</p>
          </div>
          <PLBadge profitLoss={gold.profit_loss ?? 0} profitLossPercent={gold.profit_loss_percent ?? 0} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">الوزن (جرام)</p>
            <p className="font-medium">{weightGrams.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">سعر الشراء/جرام</p>
            <p className="font-medium" dir="ltr">{purchasePricePerGram.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">السعر الحالي/جرام</p>
            <p className="font-medium" dir="ltr">{currentPricePerGram > 0 ? currentPricePerGram.toFixed(2) : '-'}</p>
          </div>
        </div>
        <div className="flex justify-between mt-3 text-sm">
          <span className="text-muted-foreground">القيمة الحالية:</span>
          <span className="font-medium" dir="ltr">{formatCurrency(gold.current_value ?? 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function RealEstateCard({ property }: { property: RealEstateAsset }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-blue-500" />
              <h3 className="font-bold">{property.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{property.address || property.property_type}</p>
          </div>
          <PLBadge profitLoss={property.profit_loss} profitLossPercent={property.profit_loss_percent} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">سعر الشراء</p>
            <p className="font-medium" dir="ltr">{formatCurrency(property.purchase_price)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">القيمة التقديرية</p>
            <p className="font-medium" dir="ltr">{formatCurrency(property.estimated_value)}</p>
          </div>
        </div>
        {property.area_sqm && (
          <div className="flex justify-between mt-3 text-sm">
            <span className="text-muted-foreground">المساحة:</span>
            <span className="font-medium">{property.area_sqm} م²</span>
          </div>
        )}
        {property.is_rented && property.monthly_rent && (
          <div className="flex justify-between mt-2 text-sm">
            <span className="text-muted-foreground">الإيجار الشهري:</span>
            <span className="font-medium text-emerald-600" dir="ltr">{formatCurrency(property.monthly_rent)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DepositCard({ deposit }: { deposit: BankDeposit & any }) {
  const principal = deposit.principal_amount || deposit.total_invested || 0;
  const rate = deposit.interest_rate || deposit.certificate_return_rate || deposit.annual_return_rate || 0;
  const yearly = deposit.yearly_interest || (rate > 0 && principal > 0 ? principal * (rate / 100) : 0);
  const monthly = deposit.monthly_interest || (yearly > 0 ? yearly / 12 : 0);
  const daily = deposit.daily_interest || (yearly > 0 ? yearly / 365 : 0);
  const accrued = deposit.interest_accrued || deposit.accrued_interest || 0;
  const currentVal = deposit.total_value || deposit.current_value || (principal + accrued);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-green-500" />
              <h3 className="font-bold">{deposit.bank_name || deposit.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{deposit.deposit_type === 'FIXED' ? 'وديعة لأجل' : 'حساب توفير'}</p>
          </div>
          <div className="text-left">
            <p className="font-bold text-emerald-600" dir="ltr">{formatCurrency(currentVal)}</p>
            <p className="text-xs text-muted-foreground">القيمة الحالية</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">المبلغ الأصلي</p>
            <p className="font-medium" dir="ltr">{formatCurrency(principal)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">الفائدة السنوية</p>
            <p className="font-medium">{rate}%</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">العائد السنوي</p>
            <p className="font-medium text-emerald-600" dir="ltr">{formatCurrency(yearly)}</p>
          </div>
        </div>
        {rate > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-muted-foreground pt-2 border-t border-dashed">
            <div className="flex justify-between">
              <span>العائد الشهري:</span>
              <span className="font-medium text-foreground">{formatCurrency(monthly)}</span>
            </div>
            <div className="flex justify-between">
              <span>العائد اليومي:</span>
              <span className="font-medium text-foreground">{formatCurrency(daily)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CertificateCard({ cert }: { cert: InvestmentCertificate & any }) {
  const principal = cert.principal_amount || cert.total_invested || 0;
  const rate = cert.annual_return_rate || cert.certificate_return_rate || cert.interest_rate || 0;
  const yearly = cert.yearly_interest || (rate > 0 && principal > 0 ? principal * (rate / 100) : 0);
  const monthly = cert.monthly_interest || (yearly > 0 ? yearly / 12 : 0);
  const daily = cert.daily_interest || (yearly > 0 ? yearly / 365 : 0);
  const accrued = cert.total_return || cert.accrued_interest || cert.interest_accrued || 0;
  const currentVal = cert.current_value || cert.total_value || (principal + accrued);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-purple-500" />
              <h3 className="font-bold">{cert.certificate_name || cert.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{cert.bank_name}</p>
          </div>
          <div className="text-left">
            <p className="font-bold text-emerald-600" dir="ltr">{formatCurrency(currentVal)}</p>
            <p className="text-xs text-muted-foreground">القيمة الحالية</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">المبلغ</p>
            <p className="font-medium" dir="ltr">{formatCurrency(principal)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">العائد السنوي</p>
            <p className="font-medium">{rate}%</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">مبلغ العائد/سنة</p>
            <p className="font-medium text-emerald-600" dir="ltr">{formatCurrency(yearly)}</p>
          </div>
        </div>
        {rate > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-muted-foreground pt-2 border-t border-dashed">
            <div className="flex justify-between">
              <span>العائد الشهري:</span>
              <span className="font-medium text-foreground">{formatCurrency(monthly)}</span>
            </div>
            <div className="flex justify-between">
              <span>العائد اليومي:</span>
              <span className="font-medium text-foreground">{formatCurrency(daily)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FundCard({ fund }: { fund: InvestmentFund }) {
  const unitsOwned = fund.units_owned ?? 0;
  const currentPricePerUnit = fund.current_price_per_unit ?? 0;
  
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              <h3 className="font-bold">{fund.fund_name}</h3>
            </div>
          </div>
          <PLBadge profitLoss={fund.profit_loss ?? 0} profitLossPercent={fund.profit_loss_percent ?? 0} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">عدد الوحدات</p>
            <p className="font-medium">{unitsOwned.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">سعر الوحدة</p>
            <p className="font-medium" dir="ltr">{currentPricePerUnit > 0 ? currentPricePerUnit.toFixed(2) : '-'}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">القيمة الحالية</p>
            <p className="font-medium" dir="ltr">{formatCurrency(fund.current_value ?? 0)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CurrencyCard({ currency }: { currency: ForeignCurrency }) {
  const amount = currency.amount ?? 0;
  const purchaseRate = currency.purchase_rate ?? 0;
  const currentRate = currency.current_rate ?? 0;
  
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <h3 className="font-bold">{currency.currency_code}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{currency.currency_name || currency.currency_code}</p>
          </div>
          <PLBadge profitLoss={currency.profit_loss ?? 0} profitLossPercent={currency.profit_loss_percent ?? 0} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">الكمية</p>
            <p className="font-medium">{amount.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">سعر الشراء</p>
            <p className="font-medium" dir="ltr">{purchaseRate.toFixed(2)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-xs text-muted-foreground">السعر الحالي</p>
            <p className="font-medium" dir="ltr">{currentRate > 0 ? currentRate.toFixed(2) : '-'}</p>
          </div>
        </div>
        <div className="flex justify-between mt-3 text-sm">
          <span className="text-muted-foreground">القيمة بالجنيه:</span>
          <span className="font-medium" dir="ltr">{formatCurrency(currency.current_value_egp ?? 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Add Asset Dialog
function AddAssetDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [assetType, setAssetType] = useState('stock');
  const [form, setForm] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/portfolio/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_type: assetType, ...form }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success('تم إضافة الأصل بنجاح');
        setForm({});
        setOpen(false);
        onAdded();
      } else {
        throw new Error(data.error || 'حدث خطأ');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الإضافة');
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => {
    switch (assetType) {
      case 'stock':
        return (
          <>
            <div className="space-y-2">
              <Label>رمز السهم</Label>
              <Input
                value={form.symbol || ''}
                onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                placeholder="HRHO"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>عدد الأسهم</Label>
                <Input
                  type="number"
                  value={form.shares || ''}
                  onChange={(e) => setForm({ ...form, shares: e.target.value })}
                  placeholder="100"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>متوسط التكلفة</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.avg_cost || ''}
                  onChange={(e) => setForm({ ...form, avg_cost: e.target.value })}
                  placeholder="25.50"
                  required
                />
              </div>
            </div>
          </>
        );

      case 'gold':
        return (
          <>
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ذهب عيار 21"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الوزن (جرام)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.weight_grams || ''}
                  onChange={(e) => setForm({ ...form, weight_grams: e.target.value })}
                  placeholder="50"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>العيار</Label>
                <Select value={form.karat || '21'} onValueChange={(v) => setForm({ ...form, karat: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24</SelectItem>
                    <SelectItem value="21">21</SelectItem>
                    <SelectItem value="18">18</SelectItem>
                    <SelectItem value="14">14</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>سعر الشراء للجرام</Label>
              <Input
                type="number"
                step="0.01"
                value={form.purchase_price_per_gram || ''}
                onChange={(e) => setForm({ ...form, purchase_price_per_gram: e.target.value })}
                placeholder="4000"
                required
              />
            </div>
          </>
        );

      case 'realestate':
        return (
          <>
            <div className="space-y-2">
              <Label>اسم العقار</Label>
              <Input
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="شقة بالمعادي"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>سعر الشراء</Label>
                <Input
                  type="number"
                  value={form.purchase_price || ''}
                  onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                  placeholder="1000000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>القيمة التقديرية الحالية</Label>
                <Input
                  type="number"
                  value={form.estimated_value || ''}
                  onChange={(e) => setForm({ ...form, estimated_value: e.target.value })}
                  placeholder="1200000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>نوع العقار</Label>
              <Select value={form.property_type || 'APARTMENT'} onValueChange={(v) => setForm({ ...form, property_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APARTMENT">شقة</SelectItem>
                  <SelectItem value="VILLA">فيلا</SelectItem>
                  <SelectItem value="LAND">أرض</SelectItem>
                  <SelectItem value="COMMERCIAL">تجاري</SelectItem>
                  <SelectItem value="SHOP">محل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        );

      case 'deposit':
        return (
          <>
            <div className="space-y-2">
              <Label>اسم البنك</Label>
              <Input
                value={form.bank_name || ''}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="البنك الأهلي"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المبلغ</Label>
                <Input
                  type="number"
                  value={form.principal_amount || ''}
                  onChange={(e) => setForm({ ...form, principal_amount: e.target.value })}
                  placeholder="100000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>نسبة الفائدة %</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.interest_rate || ''}
                  onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                  placeholder="20"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>نوع الوديعة</Label>
              <Select value={form.deposit_type || 'FIXED'} onValueChange={(v) => setForm({ ...form, deposit_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">وديعة لأجل</SelectItem>
                  <SelectItem value="SAVINGS">حساب توفير</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        );

      case 'certificate':
        return (
          <>
            <div className="space-y-2">
              <Label>اسم الشهادة</Label>
              <Input
                value={form.certificate_name || ''}
                onChange={(e) => setForm({ ...form, certificate_name: e.target.value })}
                placeholder="شهادة البنك الأهلي 20%"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>اسم البنك</Label>
              <Input
                value={form.bank_name || ''}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="البنك الأهلي"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>المبلغ</Label>
                <Input
                  type="number"
                  value={form.principal_amount || ''}
                  onChange={(e) => setForm({ ...form, principal_amount: e.target.value })}
                  placeholder="100000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>العائد السنوي %</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.annual_return_rate || ''}
                  onChange={(e) => setForm({ ...form, annual_return_rate: e.target.value })}
                  placeholder="20"
                  required
                />
              </div>
            </div>
          </>
        );

      case 'currency':
        return (
          <>
            <div className="space-y-2">
              <Label>العملة</Label>
              <Select value={form.currency_code || 'USD'} onValueChange={(v) => setForm({ ...form, currency_code: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">دولار أمريكي (USD)</SelectItem>
                  <SelectItem value="EUR">يورو (EUR)</SelectItem>
                  <SelectItem value="GBP">جنيه إسترليني (GBP)</SelectItem>
                  <SelectItem value="SAR">ريال سعودي (SAR)</SelectItem>
                  <SelectItem value="AED">درهم إماراتي (AED)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الكمية</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount || ''}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="1000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>سعر الشراء (جنيه)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.purchase_rate || ''}
                  onChange={(e) => setForm({ ...form, purchase_rate: e.target.value })}
                  placeholder="50"
                  required
                />
              </div>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4" />
          إضافة أصل
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إضافة أصل جديد</DialogTitle>
          <DialogDescription>أضف أصل جديد لمحفظتك</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>نوع الأصل</Label>
            <Select value={assetType} onValueChange={setAssetType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stock">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    أسهم
                  </div>
                </SelectItem>
                <SelectItem value="gold">
                  <div className="flex items-center gap-2">
                    <Gem className="w-4 h-4" />
                    ذهب
                  </div>
                </SelectItem>
                <SelectItem value="realestate">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4" />
                    عقارات
                  </div>
                </SelectItem>
                <SelectItem value="deposit">
                  <div className="flex items-center gap-2">
                    <Landmark className="w-4 h-4" />
                    ودائع بنكية
                  </div>
                </SelectItem>
                <SelectItem value="certificate">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4" />
                    شهادات استثمار
                  </div>
                </SelectItem>
                <SelectItem value="currency">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    عملات أجنبية
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {renderForm()}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                جارٍ الإضافة...
              </>
            ) : (
              'إضافة'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/assets');
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        throw new Error(json.error || 'حدث خطأ');
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء جلب المحفظة');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto p-4 space-y-4" dir="rtl">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container max-w-4xl mx-auto p-4" dir="rtl">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">لا توجد بيانات</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { assets: _rawAssets, summary: _rawSummary } = data;
  // P4-FIX: API بيرجّع holdings مش assets — نأمّن defaults للـ panels
  const assets = _rawAssets || {};
  const summary = _rawSummary || {};
  const isProfit = (summary.total_profit_loss ?? 0) >= 0;

  // Count assets by type
  const counts = {
    stocks: assets.stocks?.length || 0,
    gold: assets.gold?.length || 0,
    real_estate: assets.real_estate?.length || 0,
    deposits: assets.deposits?.length || 0,
    certificates: assets.certificates?.length || 0,
    funds: assets.funds?.length || 0,
    currencies: assets.currencies?.length || 0,
  };

  return (
    <div className="w-full space-y-6" dir="rtl">
      {/* Wealth Command Center (غرفة عمليات إدارة الأموال) */}
      <WealthCommandCenter />

      <div className="container max-w-6xl mx-auto px-4 space-y-6">
        {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-600" />
            محفظتي
          </h1>
          <p className="text-muted-foreground">إدارة كل أصولك في مكان واحد</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPortfolio} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          <AddAssetDialog onAdded={fetchPortfolio} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">إجمالي قيمة المحفظة</p>
            <p className="text-2xl font-bold" dir="ltr">{formatCurrency((summary || {}).total_value ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
            <p className="text-xl font-bold" dir="ltr">{formatCurrency((summary || {}).total_cost ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className={isProfit ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">الربح/الخسارة</p>
            <p className={`text-xl font-bold ${isProfit ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">
              {formatCurrency((summary || {}).total_profit_loss ?? 0)}
            </p>
            <p className={`text-sm ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatPercent((summary || {}).total_profit_loss_percent ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Wealth Chart */}
      {data.history && data.history.length > 0 && (
        <Card className="p-4 mt-4">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="text-lg">تطور الثروة</CardTitle>
          </CardHeader>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.history}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `${v / 1000}k`} />
                <RechartsTooltip formatter={(val: number) => formatCurrency(val)} labelFormatter={(lbl) => `التاريخ: ${lbl}`} />
                <Line type="monotone" dataKey="value" stroke="#059669" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Assets Tabs */}
      <Tabs defaultValue="stocks" className="w-full">
        <TabsList className="w-full flex-wrap h-auto gap-1">
          <TabsTrigger value="stocks" className="gap-1">
            <Package className="w-4 h-4" />
            أسهم ({counts.stocks})
          </TabsTrigger>
          <TabsTrigger value="gold" className="gap-1">
            <Gem className="w-4 h-4" />
            ذهب ({counts.gold})
          </TabsTrigger>
          <TabsTrigger value="realestate" className="gap-1">
            <Home className="w-4 h-4" />
            عقارات ({counts.real_estate})
          </TabsTrigger>
          <TabsTrigger value="deposits" className="gap-1">
            <Landmark className="w-4 h-4" />
            ودائع ({counts.deposits})
          </TabsTrigger>
          <TabsTrigger value="certificates" className="gap-1">
            <FileCheck className="w-4 h-4" />
            شهادات ({counts.certificates})
          </TabsTrigger>
          <TabsTrigger value="currencies" className="gap-1">
            <DollarSign className="w-4 h-4" />
            عملات ({counts.currencies})
          </TabsTrigger>
        </TabsList>

        {/* Stocks */}
        <TabsContent value="stocks" className="space-y-3 mt-4">
          {counts.stocks === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد أسهم في محفظتك</p>
              </CardContent>
            </Card>
          ) : (
            assets.stocks?.map((stock) => <StockCard key={stock.id} stock={stock} />)
          )}
        </TabsContent>

        {/* Gold */}
        <TabsContent value="gold" className="space-y-3 mt-4">
          {counts.gold === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Gem className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا يوجد ذهب في محفظتك</p>
              </CardContent>
            </Card>
          ) : (
            assets.gold?.map((gold) => <GoldCard key={gold.id} gold={gold} />)
          )}
        </TabsContent>

        {/* Real Estate */}
        <TabsContent value="realestate" className="space-y-3 mt-4">
          {counts.real_estate === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Home className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد عقارات في محفظتك</p>
              </CardContent>
            </Card>
          ) : (
            assets.real_estate?.map((property) => <RealEstateCard key={property.id} property={property} />)
          )}
        </TabsContent>

        {/* Deposits */}
        <TabsContent value="deposits" className="space-y-3 mt-4">
          {counts.deposits === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Landmark className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد ودائع بنكية</p>
              </CardContent>
            </Card>
          ) : (
            assets.deposits?.map((deposit) => <DepositCard key={deposit.id} deposit={deposit} />)
          )}
        </TabsContent>

        {/* Certificates */}
        <TabsContent value="certificates" className="space-y-3 mt-4">
          {counts.certificates === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد شهادات استثمار</p>
              </CardContent>
            </Card>
          ) : (
            assets.certificates?.map((cert) => <CertificateCard key={cert.id} cert={cert} />)
          )}
        </TabsContent>

        {/* Currencies */}
        <TabsContent value="currencies" className="space-y-3 mt-4">
          {counts.currencies === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد عملات أجنبية</p>
              </CardContent>
            </Card>
          ) : (
            assets.currencies?.map((currency) => <CurrencyCard key={currency.id} currency={currency} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground text-center p-4 border-t">
        <p>⚠️ هذه التحليلات للأغراض التعليمية فقط وليست تحليل استثمارية</p>
      </div>
      </div>
    </div>
  );
}

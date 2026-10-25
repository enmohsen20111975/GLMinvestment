import {
  BarChart3,
  Eye,
  History,
  Plus,
  Search,
  ShoppingCart,
  Star,
  Trophy,
  Wallet,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart as RechartsPieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { cn } from '@/lib/utils';

import { INITIAL_BALANCE, SECTOR_COLORS } from './constants';
import {
  formatCurrency,
  formatNumber,
} from './helpers';
import type { Column } from '@/components/shared/UnifiedTable';
import type {
  EGXStock,
  Position,
  Transaction,
} from './types';
import type {
  HoldingsRow,
  TransactionRow,
  OpenTradeDialog,
} from './columns';

/* ============================================================
 * SimulationView — Tabs
 * The five tab screens (dashboard / trading / portfolio /
 * transactions / watchlist). They receive all derived data and
 * callbacks as props so they stay purely presentational.
 * ============================================================ */

interface TabBundleProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  // dashboard
  balance: number;
  portfolioValue: number;
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  investedAmount: number;
  tradeCount: number;
  chartData: { time: string; value: number }[];
  stocks: EGXStock[];
  flashingTickers: Record<string, 'up' | 'down'>;
  // trading
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  filteredStocks: EGXStock[];
  stockListColumns: Column<EGXStock>[];
  // portfolio
  positions: Position[];
  holdingsRows: HoldingsRow[];
  holdingsColumns: Column<HoldingsRow>[];
  sectorAllocation: { sector: string; value: number; percent: number }[];
  currencyLabel: string;
  // transactions
  transactionFilter: 'all' | 'buy' | 'sell';
  onTransactionFilterChange: (f: 'all' | 'buy' | 'sell') => void;
  filteredTransactions: Transaction[];
  transactionsRows: TransactionRow[];
  transactionsColumns: Column<TransactionRow>[];
  // watchlist
  watchlist: string[];
  onToggleWatchlist: (ticker: string) => void;
  onOpenTradeDialog: OpenTradeDialog;
}

export function SimulationTabs(props: TabBundleProps) {
  const {
    activeTab,
    onTabChange,
    balance,
    portfolioValue,
    totalValue,
    totalPnL,
    totalPnLPercent,
    investedAmount,
    tradeCount,
    chartData,
    stocks,
    flashingTickers,
    searchQuery,
    onSearchQueryChange,
    filteredStocks,
    stockListColumns,
    positions,
    holdingsRows,
    holdingsColumns,
    sectorAllocation,
    currencyLabel,
    transactionFilter,
    onTransactionFilterChange,
    filteredTransactions,
    transactionsRows,
    transactionsColumns,
    watchlist,
    onToggleWatchlist,
    onOpenTradeDialog,
  } = props;

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
      <TabsList className="flex flex-wrap h-auto gap-1">
        <TabsTrigger value="dashboard" className="gap-1.5">
          <BarChart3 className="h-4 w-4" />
          لوحة التحكم
        </TabsTrigger>
        <TabsTrigger value="trading" className="gap-1.5">
          <ShoppingCart className="h-4 w-4" />
          التداول
        </TabsTrigger>
        <TabsTrigger value="portfolio" className="gap-1.5">
          <Wallet className="h-4 w-4" />
          المحفظة
        </TabsTrigger>
        <TabsTrigger value="transactions" className="gap-1.5">
          <History className="h-4 w-4" />
          سجل المعاملات
        </TabsTrigger>
        <TabsTrigger value="watchlist" className="gap-1.5">
          <Eye className="h-4 w-4" />
          قائمة الرغبات
        </TabsTrigger>
      </TabsList>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tab 1: Dashboard */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <TabsContent value="dashboard" className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">الرصيد النقدي</p>
                  <p className="text-xl font-bold">{formatCurrency(balance, currencyLabel)}</p>
                </div>
                <div className="p-2 bg-profit/10 rounded-lg">
                  <Wallet className="h-5 w-5 text-profit " />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">قيمة المحفظة</p>
                  <p className="text-xl font-bold">{formatCurrency(portfolioValue, currencyLabel)}</p>
                </div>
                <div className="p-2 bg-whale/10 rounded-lg">
                  <span className="block h-5 w-5 text-whale">$</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cn('relative overflow-hidden', totalPnL >= 0 ? 'border-profit ' : 'border-loss ')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الربح/الخسارة</p>
                  <p className={cn('text-xl font-bold', totalPnL >= 0 ? 'text-profit ' : 'text-loss ')}>
                    {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL, currencyLabel)}
                  </p>
                </div>
                <div className={cn('p-2 rounded-lg', totalPnL >= 0 ? 'bg-profit/10' : 'bg-loss/10')}>
                  {totalPnL >= 0 ? <ArrowUpRight className="h-5 w-5 text-profit" /> : <ArrowDownRight className="h-5 w-5 text-loss" />}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">نسبة الربح/الخسارة</p>
                  <p className={cn('text-xl font-bold', totalPnLPercent >= 0 ? 'text-profit ' : 'text-loss ')}>
                    {totalPnLPercent >= 0 ? '+' : ''}{(totalPnLPercent ?? 0).toFixed(2)}%
                  </p>
                </div>
                <div className={cn('p-2 rounded-lg', totalPnLPercent >= 0 ? 'bg-profit/10' : 'bg-loss/10')}>
                  <span className="block h-5 w-5 text-profit text-base font-bold" aria-hidden>%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">عدد الصفقات</p>
                  <p className="text-xl font-bold">{tradeCount}</p>
                </div>
                <div className="p-2 bg-warning/10 rounded-lg">
                  <span className="block h-5 w-5 text-warning text-base font-bold" aria-hidden>⚡</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart + Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <WidgetCard
          	title="أداء المحفظة"
          	icon={ArrowUpRight}
          	iconSize="h-4 w-4"
          	titleClassName="text-base"
          	className="lg:col-span-2"
          >

              {chartData.length > 1 ? (
                <ChartContainer
                  config={{
                    value: {
                      label: 'قيمة المحفظة',
                      color: 'hsl(160, 84%, 39%)',
                      theme: { light: 'hsl(160, 84%, 39%)', dark: 'hsl(160, 84%, 52%)' },
                    },
                  }}
                  className="h-[280px] w-full"
                >
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" domain={['auto', 'auto']} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-value)"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                  <p>سيتم عرض الرسم البياني بعد أول تحديث للأسعار</p>
                </div>
              )}
          </WidgetCard>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-warning" aria-hidden>⚡</span>
                إجراءات سريعة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">الرصيد المتاح</p>
                <p className="text-2xl font-bold text-profit ">{formatCurrency(balance, currencyLabel)}</p>
                <Progress value={((INITIAL_BALANCE - balance) / INITIAL_BALANCE) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">مستثمر: {formatCurrency(investedAmount, currencyLabel)} من {formatCurrency(INITIAL_BALANCE, currencyLabel)}</p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Button
                  className="w-full gap-2 bg-profit hover:bg-profit"
                  onClick={() => onTabChange('trading')}
                >
                  <ShoppingCart className="h-4 w-4" />
                  شراء أسهم
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => onTabChange('portfolio')}
                >
                  <Wallet className="h-4 w-4" />
                  عرض المحفظة
                </Button>
              </div>
              <Separator />
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">إحصائيات سريعة</p>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">القيمة الإجمالية</span>
                  <span className="font-medium">{formatCurrency(totalValue, currencyLabel)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">المركز المفتوحة</span>
                  <span className="font-medium">{positions.length}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">العمولة</span>
                  <span className="font-medium">0.15%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Market Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span aria-hidden>↻</span>
              نظرة على السوق
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 max-h-[400px] overflow-y-auto">
              {stocks.slice(0, 12).map((stock) => (
                <div
                  key={stock.ticker}
                  className={cn(
                    'rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md',
                    flashingTickers[stock.ticker] === 'up' && 'bg-profit/10 border-profit',
                    flashingTickers[stock.ticker] === 'down' && 'bg-loss/10 border-loss',
                  )}
                  onClick={() => onOpenTradeDialog(stock, 'buy')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{stock.ticker}</span>
                    <span className={cn('text-xs font-medium', stock.change >= 0 ? 'text-profit' : 'text-loss')}>
                      {stock.change >= 0 ? '+' : ''}{stock.changePercent}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{stock.name_ar}</p>
                  <p className="text-sm font-bold mt-1">{formatNumber(stock.price)} {currencyLabel}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tab 2: Trading */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <TabsContent value="trading" className="space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ابحث عن سهم بالرمز أو الاسم أو القطاع..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="pr-10 text-right"
          />
        </div>

        {/* Stock List */}
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              <UnifiedTable<EGXStock>
                columns={stockListColumns}
                data={filteredStocks}
                keyField="ticker"
                dense
                columnToggle
                filterable
                maxHeight="max-h-[600px]"
                rowClassName={(s) => cn(
                  'transition-colors',
                  flashingTickers[s.ticker] === 'up' && 'bg-profit/10 /20',
                  flashingTickers[s.ticker] === 'down' && 'bg-loss/10 /20',
                )}
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tab 3: Portfolio */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <TabsContent value="portfolio" className="space-y-6">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">الرصيد النقدي</p>
              <p className="text-lg font-bold">{formatCurrency(balance, currencyLabel)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">إجمالي الاستثمار</p>
              <p className="text-lg font-bold">{formatCurrency(investedAmount, currencyLabel)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">القيمة الحالية</p>
              <p className="text-lg font-bold">{formatCurrency(portfolioValue, currencyLabel)}</p>
            </CardContent>
          </Card>
          <Card className={cn(totalPnL >= 0 ? 'border-profit ' : 'border-loss ')}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">الربح/الخسارة غير المحقق</p>
              <p className={cn('text-lg font-bold', totalPnL >= 0 ? 'text-profit' : 'text-loss')}>
                {totalPnL >= 0 ? '+' : ''}{formatCurrency(portfolioValue - investedAmount, currencyLabel)}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Holdings */}
          <WidgetCard
          	title="الأصول المحتفظ بها"
          	icon={Wallet}
          	iconSize="h-4 w-4"
          	titleClassName="text-base"
          	className="lg:col-span-2"
          	contentClassName="p-0"
          >

              {positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                  <Trophy className="h-12 w-12 text-muted-foreground/30" />
                  <p>لا توجد أصول محتفظ بها حالياً</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTabChange('trading')}
                    className="gap-1.5"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    ابدأ التداول
                  </Button>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  <UnifiedTable
                    columns={holdingsColumns}
                    data={holdingsRows}
                    keyField="ticker"
                    dense
                    columnToggle
                    filterable
                    maxHeight="max-h-[400px]"
                  />
                </div>
              )}
          </WidgetCard>

          {/* Sector Allocation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span aria-hidden>🥧</span>
                توزيع القطاعات
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sectorAllocation.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
                  <span aria-hidden className="text-2xl">🥧</span>
                  <p className="text-sm">لا توجد بيانات للعرض</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Pie Chart */}
                  <div className="h-[180px] w-full">
                    <ChartContainer
                      config={Object.fromEntries(sectorAllocation.map((s) => [s.sector, { label: s.sector, color: SECTOR_COLORS[s.sector] || '#888' }]))}
                      className="h-full w-full"
                    >
                      <RechartsPieChart>
                        <Pie
                          data={sectorAllocation}
                          dataKey="value"
                          nameKey="sector"
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={2}
                        >
                          {sectorAllocation.map((entry, index) => (
                            <Cell key={index} fill={SECTOR_COLORS[entry.sector] || '#888'} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value, currencyLabel)}
                          contentStyle={{
                            borderRadius: '8px',
                            border: '1px solid hsl(var(--border))',
                            background: 'hsl(var(--background))',
                            fontSize: '12px',
                          }}
                        />
                      </RechartsPieChart>
                    </ChartContainer>
                  </div>

                  {/* Legend */}
                  <div className="space-y-2">
                    {sectorAllocation.map((item) => (
                      <div key={item.sector} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: SECTOR_COLORS[item.sector] || '#888' }} />
                          <span className="text-xs truncate">{item.sector}</span>
                        </div>
                        <span className="text-xs font-mono font-medium whitespace-nowrap">{(item.percent ?? 0).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tab 4: Transaction History */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <TabsContent value="transactions" className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <History className="h-5 w-5" />
            سجل المعاملات
          </h3>
          <Select value={transactionFilter} onValueChange={(v) => onTransactionFilterChange(v as 'all' | 'buy' | 'sell')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="buy">الشراء فقط</SelectItem>
              <SelectItem value="sell">البيع فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            {filteredTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                <History className="h-12 w-12 text-muted-foreground/30" />
                <p>لا توجد معاملات بعد</p>
                <Button variant="outline" size="sm" onClick={() => onTabChange('trading')} className="gap-1.5">
                  <ShoppingCart className="h-4 w-4" />
                  ابدأ التداول
                </Button>
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                <UnifiedTable
                  columns={transactionsColumns}
                  data={transactionsRows}
                  keyField="id"
                  dense
                  columnToggle
                  filterable
                  maxHeight="max-h-[500px]"
                />
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Tab 5: Watchlist */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <TabsContent value="watchlist" className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Eye className="h-5 w-5" />
            قائمة الرغبات
            <Badge variant="outline">{watchlist.length}</Badge>
          </h3>
        </div>

        {watchlist.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
              <Star className="h-12 w-12 text-muted-foreground/30" />
              <p>قائمة الرغبات فارغة</p>
              <p className="text-sm">أضف الأسهم التي تريد مراقبتها من صفحة التداول</p>
              <Button variant="outline" size="sm" onClick={() => onTabChange('trading')} className="gap-1.5">
                <Search className="h-4 w-4" />
                استعراض الأسهم
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {watchlist.map((ticker) => {
              const stock = stocks.find((s) => s.ticker === ticker);
              if (!stock) return null;
              return (
                <Card
                  key={ticker}
                  className={cn(
                    'transition-all hover:shadow-md cursor-pointer',
                    flashingTickers[ticker] === 'up' && 'border-profit bg-profit/10',
                    flashingTickers[ticker] === 'down' && 'border-loss bg-loss/10',
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono">{stock.ticker}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-warning hover:text-warning hover:bg-warning"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleWatchlist(ticker);
                            }}
                          >
                            <Star className="h-4 w-4 fill-warning" />
                          </Button>
                        </div>
                        <p className="font-medium mt-1">{stock.name_ar}</p>
                        <p className="text-xs text-muted-foreground">{stock.sector}</p>
                      </div>
                      <div className="text-left">
                        <p className="text-lg font-bold font-mono">{formatNumber(stock.price)}</p>
                        <div className={cn('flex items-center gap-0.5 justify-end text-sm font-medium', stock.change >= 0 ? 'text-profit' : 'text-loss')}>
                          {stock.change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          {stock.change >= 0 ? '+' : ''}{(stock.changePercent ?? 0).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1 bg-profit hover:bg-profit"
                        onClick={() => onOpenTradeDialog(stock, 'buy')}
                      >
                        <Plus className="h-3 w-3" />
                        شراء
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs gap-1"
                        onClick={() => onOpenTradeDialog(stock, 'sell')}
                      >
                        <Minus className="h-3 w-3" />
                        بيع
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Add from search */}
        <WidgetCard
        	title="إضافة أسهم لقائمة الرغبات"
        	icon={Plus}
        	iconSize="h-4 w-4"
        	titleClassName="text-base"
        	contentClassName="space-y-4"
        >

            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن سهم..."
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto">
              {filteredStocks
                .filter((s) => !watchlist.includes(s.ticker))
                .slice(0, 8)
                .map((stock) => (
                  <div
                    key={stock.ticker}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{stock.name_ar}</p>
                      <p className="text-xs text-muted-foreground">{stock.ticker}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-warning"
                      onClick={() => onToggleWatchlist(stock.ticker)}
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
            </div>
        </WidgetCard>
      </TabsContent>
    </Tabs>
  );
}

/* Unused import suppressor — ResponsiveContainer currently not needed but kept
   in case future charts need it (avoids accidental import cycle removal). */
void ResponsiveContainer;

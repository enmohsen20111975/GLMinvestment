// types + interfaces — extracted (Phase 3)

// P40-ACADEMY PILLAR 1: Live Market Paper Trading Workstation
// ============================================================
// P40-ACADEMY-ORCHESTRATOR (Task P40-1)
// Full trading workstation UI where the user places paper orders with live
// market prices from the EGX / crypto / gold backends.
//
// Sections:
// 1. Account Header Bar — virtual_balance, total_equity, total_pnl,
// win_rate, total_trades, reset button (with confirmation).
// 2. Order Execution Panel — ticker search, asset type segmented control,
// BUY/SELL toggle, shares input, entry / SL / TP inputs, order summary
// (cost, risk, reward, R:R), execute button.
// 3. Open Positions Table — auto-refreshing, color-coded P&L, close action
// with confirmation, auto-closed (SL/TP) toast notifications.
// 4. Trade History — closed orders with close_reason badge + "load more".
// 5. Performance Chart — simple equity curve via Recharts (single point if
// no history yet).
//
// Polling: /positions endpoint every 10s via useVisibilityAwarePolling
// (off-market allowed since paper trading simulates live prices).

'use client';

import React, {
 useState,
 useEffect,
 useCallback,
 useMemo,
 useRef,
} from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
 AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { StockSearchDropdown } from '@/modules/portfolio/components/StockSearchDropdown';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
// P0-COMPONENT-UNIFICATION Phase 2.7: canonical fmtPrice from '@/lib/utils'
import { fmtPrice } from '@/lib/utils';
import {
 TrendingUp,
 TrendingDown,
 Wallet,
 Target,
 Shield,
 Zap,
 RefreshCw,
 Loader2,
 X,
 ArrowUpCircle,
 ArrowDownCircle,
 Clock,
 Percent,
 DollarSign,
 Activity,
} from 'lucide-react';
import { toast } from 'sonner';
import {
 LineChart,
 Line,
 XAxis,
 YAxis,
 Tooltip as RechartsTooltip,
 ResponsiveContainer,
} from 'recharts';

// ============================================================
// Types — match the backend (paper-trading-v2-db.ts)
// ============================================================

interface PaperTradingAccount {
 id: number;
 user_id: string;
 virtual_balance: number;
 total_equity: number;
 starting_balance: number;
 total_pnl: number;
 total_trades: number;
 winning_trades: number;
 win_rate: number;
 created_at: string;
 updated_at: string;
}

type AssetType = 'stock' | 'crypto' | 'gold';
type OrderType = 'BUY' | 'SELL';
type CloseReason = 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT';

interface OpenPosition {
 id: number;
 ticker: string;
 asset_type: string;
 order_type: string;
 shares: number;
 entry_price: number;
 stop_loss: number | null;
 take_profit: number | null;
 status: string;
 pnl: number;
 close_price: number | null;
 close_reason: string | null;
 opened_at: string;
 closed_at: string | null;
 notes: string | null;
 current_price: number;
 market_value: number;
 unrealized_pnl: number;
 unrealized_pnl_pct: number;
 position_value: number;
}

interface ClosedOrder {
 id: number;
 ticker: string;
 asset_type: string;
 order_type: string;
 shares: number;
 entry_price: number;
 stop_loss: number | null;
 take_profit: number | null;
 status: string;
 pnl: number;
 close_price: number | null;
 close_reason: string | null;
 opened_at: string;
 closed_at: string | null;
 notes: string | null;
}

interface AutoClosedEntry {
 order: ClosedOrder;
 closePrice: number;
 reason: 'STOP_LOSS' | 'TAKE_PROFIT';
}

// ============================================================
// Formatters (Arabic / EGP)
// ============================================================

const egpFmt = new Intl.NumberFormat('ar-EG', {
 maximumFractionDigits: 2,
 minimumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });

function fmtEgp(v: number | null | undefined): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return egpFmt.format(v);
}

function fmtNum(v: number | null | undefined): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return numFmt.format(v);
}

function fmtPct(v: number | null | undefined): string {
 if (v == null || !Number.isFinite(v)) return '—';
 return pctFmt.format(v);
}

// P0-COMPONENT-UNIFICATION Phase 2.7: removed local fmtPrice — now imported from '@/lib/utils'.
// (was: function fmtPrice(v) { if (v == null...) return '—'; return (v ?? 0).toFixed(2); })

function pnlColor(v: number | null | undefined): string {
 if (v == null) return 'text-muted-foreground';
 if (v > 0) return 'text-profit ';
 if (v < 0) return 'text-loss ';
 return 'text-muted-foreground';
}

function rowBgClass(v: number | null | undefined): string {
 if (v == null) return '';
 if (v > 0) return 'bg-profit/10 /20';
 if (v < 0) return 'bg-loss/10 /20';
 return '';
}

/** Format ISO date as a relative Arabic string (e.g. "منذ 5 دقائق"). */
function timeAgoAr(iso: string | null | undefined): string {
 if (!iso) return '—';
 const ts = new Date(iso).getTime();
 if (!Number.isFinite(ts)) return '—';
 const diff = Date.now() - ts;
 const sec = Math.floor(diff / 1000);
 if (sec < 60) return 'الآن';

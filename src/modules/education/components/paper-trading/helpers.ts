// PaperTradingWorkstation helpers (Phase 3)

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

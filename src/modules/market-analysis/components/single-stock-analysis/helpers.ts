// SingleStockAnalysisView helpers (Phase 3)

'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// InteractiveChart REMOVED — moved to archive. TradingViewChart is the sole chart.
import { TradingViewChart } from '@/modules/stock-analysis/components/TradingViewChart';
import ChartControls from './ChartControls';
import { InstitutionalDecisionPanel } from './InstitutionalDecisionPanel';
// CANONICAL: بانر محرك القرار المؤسسي V60.2 — WHO IS BUYING (مطابق Pine Script)
import { CanonicalWhoIsBuyingBanner } from './CanonicalWhoIsBuyingBanner';
import { DealAdvisorPanel } from '@/components/deal-advisor/DealAdvisorPanel';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
 Search,
 AlertTriangle,
 RefreshCw,
 TrendingUp,
 TrendingDown,
 BarChart3,
 Target,
 Activity,
 Share2,
 ShoppingCart,
 Wallet,
 Bell,
 BellRing,
 Star,
 Plus,
 Trash2,
 Maximize2,
 Minimize2,
 ChevronDown,
 SlidersHorizontal,
 Image,
 Download,
 Loader2,
 Check,
} from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlertsStore } from '@/lib/alerts-store';
import { HeartbeatStatusBar, WhaleAlertListener } from '@/modules/market-analysis/components/LiveDashboard';
import { AlertPanel } from './AlertPanel';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import type { PredictionContext } from './types';

interface OHLCVCandle {
 time: string;
 open: number;
 high: number;
 low: number;
 close: number;
 volume: number;
}

interface IndicatorPoint {
 time: string;
 value: number | null;
}

// ── P42-FRONTEND-1: Candle Probability & Stock DNA shapes ────────────────
interface CandleProbabilities {
 up_prob: number;
 dn_prob: number;
 bias: string;
 bias_en: string;
 bias_color: string;
 bias_emoji: string;
 prev_candle: string;
 break_high_0pct: number;
 break_high_1pct: number;
 break_high_2pct: number;
 break_low_0pct: number;
 break_low_1pct: number;
 break_low_2pct: number;
 total_green: number;
 total_red: number;
 sample_size: number;
 confidence: string;
 prev_high: number;
 prev_low: number;
 target_up_1pct: number;
 target_up_2pct: number;
 target_dn_1pct: number;
 target_dn_2pct: number;
}

interface MonthStat {
 month: string;
 month_num: number;
 avg_change: number;
}


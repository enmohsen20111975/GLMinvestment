/**
 * recommendations/backtest — thin proxy to /api/market-pulse (canonical).
 * Task P1-CLEANUP (2026-10-08): unified from 29-LOC copy-paste to 1-line delegation.
 * The route name is kept for backward compat with frontend callers.
 */
import { NextRequest } from 'next/server';
import { marketPulseProxy } from '@/lib/market-pulse-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) { return marketPulseProxy(req); }


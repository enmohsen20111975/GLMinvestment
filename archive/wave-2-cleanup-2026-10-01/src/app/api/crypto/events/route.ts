/**
 * Crypto Events API
 * ================
 * Returns upcoming crypto events (token unlocks, forks, regulatory, whale movements).
 * Proxies to Python backend /api/crypto/events with fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s

const PYTHON_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const url = symbol
      ? `${PYTHON_URL}/api/crypto-phase4/events?symbol=${encodeURIComponent(symbol)}`
      : `${PYTHON_URL}/api/crypto-phase4/events`;

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    } as any);
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${res.status}`,
        events: [],
        source: 'python-backend-error',
      }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({
      ...data,
      source: 'python-backend',
    });
  } catch (err: any) {
    // Fallback: return known event types
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      events: [],
      event_types: [
        {
          type: 'token_unlock',
          name: 'Token Unlock (Vesting)',
          typical_impact: '-15%',
          recommendation: 'WAIT',
          modifier_rules: '≤7d: -15 | ≤14d: -10 | ≤30d: -5',
        },
        {
          type: 'hard_fork',
          name: 'Hard Fork / Network Upgrade',
          typical_impact: '±20%',
          recommendation: 'CAUTION',
          modifier_rules: '≤14d: -10 | ≤30d: -5',
        },
        {
          type: 'exchange_listing',
          name: 'Exchange Listing',
          typical_impact: '+30% short',
          recommendation: 'AVOID (FOMO)',
          modifier_rules: '-8 (don\'t chase)',
        },
        {
          type: 'sec_regulatory',
          name: 'SEC / Regulatory Action',
          typical_impact: '-40%',
          recommendation: 'WAIT',
          modifier_rules: 'pending: -15 | recent: -10',
        },
        {
          type: 'whale_movement',
          name: 'Whale Movement',
          typical_impact: '±10%',
          recommendation: 'CAUTION',
          modifier_rules: 'large move: -5',
        },
        {
          type: 'staking_reward',
          name: 'Staking Reward',
          typical_impact: '+5% APY',
          recommendation: 'INFO',
          modifier_rules: '+2 (slight positive)',
        },
        {
          type: 'mainnet_launch',
          name: 'Mainnet Launch',
          typical_impact: '+15-25%',
          recommendation: 'POSITIVE',
          modifier_rules: 'confirmed: +5',
        },
        {
          type: 'protocol_upgrade',
          name: 'Protocol Upgrade',
          typical_impact: '±10%',
          recommendation: 'CAUTION',
          modifier_rules: '≤7d: -3',
        },
      ],
      source: 'fallback',
      disclaimer: 'Python backend unreachable — showing event type definitions only. No live events available.',
    });
  }
}

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProtectionCheckRequest {
  ticker: string;
  tradeValuePercent: number;
  userId?: string;
}

interface ProtectionResult {
  passed: boolean;
  protectionType: string | null;
  severity: 'warning' | 'soft_lock' | 'hard_lock';
  messageAr: string;
  messageEn: string;
  actionRequired: string;
  lockUntil?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_POSITION_PERCENT = 15.0;
const DAILY_LOSS_LIMIT_PERCENT = 5.0;
const CONSECUTIVE_LOSSES_LIMIT = 3;

// In-memory state (would be database in production)
const userStates: Record<string, {
  persona: string;
  dailyPnlPercent: number;
  consecutiveLosses: number;
  positions: Record<string, number>;
  lockedUntil: string | null;
  lockReason: string | null;
}> = {};

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body: ProtectionCheckRequest = await request.json();
    const { ticker, tradeValuePercent, userId = 'default' } = body;

    // Get or create user state
    if (!userStates[userId]) {
      userStates[userId] = {
        persona: 'balanced',
        dailyPnlPercent: 0,
        consecutiveLosses: 0,
        positions: {},
        lockedUntil: null,
        lockReason: null,
      };
    }

    const state = userStates[userId];
    const result = checkAllProtections(state, ticker.toUpperCase(), tradeValuePercent);

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[POST /api/portfolio/check] Error:', error);
    return NextResponse.json(
      {
        success: false,
        passed: true, // Default to pass on error
        protectionType: null,
        severity: 'warning',
        messageAr: 'لم يتم التحقق من الحماية',
        messageEn: 'Protection check failed',
        actionRequired: 'proceed',
        error: String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default';

    const state = userStates[userId] || {
      persona: 'balanced',
      dailyPnlPercent: 0,
      consecutiveLosses: 0,
      positions: {},
      lockedUntil: null,
      lockReason: null,
    };

    return NextResponse.json({
      success: true,
      state: {
        persona: state.persona,
        dailyPnlPercent: state.dailyPnlPercent,
        consecutiveLosses: state.consecutiveLosses,
        positions: state.positions,
        lockedUntil: state.lockedUntil,
        lockReason: state.lockReason,
        canTrade: !state.lockedUntil || new Date(state.lockedUntil) < new Date(),
      },
    });
  } catch (error) {
    console.error('[GET /api/portfolio/check] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Protection Logic
// ---------------------------------------------------------------------------

function checkAllProtections(
  state: typeof userStates[string],
  ticker: string,
  tradeValuePercent: number
): ProtectionResult {
  // 1. Check user lock
  if (state.lockedUntil) {
    const lockDate = new Date(state.lockedUntil);
    if (lockDate > new Date()) {
      return {
        passed: false,
        protectionType: state.lockReason === 'consecutive_losses' ? 'consecutive_losses' : 'daily_loss',
        severity: 'hard_lock',
        messageAr: `حسابك مقفل حتى ${lockDate.toLocaleTimeString('ar-EG')} — ${state.lockReason === 'consecutive_losses' ? 'قاعدة الـ 3' : 'خسارة يومية'}`,
        messageEn: `Account locked until ${lockDate.toLocaleTimeString()} — ${state.lockReason}`,
        actionRequired: 'wait',
        lockUntil: state.lockedUntil,
      };
    }
  }

  // 2. Check Daily Loss
  if (state.dailyPnlPercent <= -DAILY_LOSS_LIMIT_PERCENT) {
    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return {
      passed: false,
      protectionType: 'daily_loss',
      severity: 'hard_lock',
      messageAr: 'حان وقت المراجعة — استراحة مقترحة 24 ساعة',
      messageEn: 'Time for review — 24 hour break suggested',
      actionRequired: 'lock_24h',
      lockUntil: lockUntil.toISOString(),
      details: { dailyLossPercent: state.dailyPnlPercent },
    };
  }

  // 3. Check Consecutive Losses
  if (state.consecutiveLosses >= CONSECUTIVE_LOSSES_LIMIT) {
    const lockUntil = new Date(Date.now() + 72 * 60 * 60 * 1000);
    return {
      passed: false,
      protectionType: 'consecutive_losses',
      severity: 'hard_lock',
      messageAr: 'قاعدة الـ 3: استراحة إجبارية للحماية 72 ساعة',
      messageEn: 'Rule of 3: Mandatory 72-hour break for protection',
      actionRequired: 'lock_72h',
      lockUntil: lockUntil.toISOString(),
      details: { consecutiveLosses: state.consecutiveLosses },
    };
  }

  // 4. Check Max Position
  const currentPosition = state.positions?.[ticker] || 0;
  const newPositionPercent = currentPosition + tradeValuePercent;
  
  if (newPositionPercent > MAX_POSITION_PERCENT) {
    const maxAllowed = MAX_POSITION_PERCENT - currentPosition;
    return {
      passed: false,
      protectionType: 'max_position',
      severity: 'soft_lock',
      messageAr: `تحليل: 15% كحد أقصى للتنويع — يمكنك إضافة ${maxAllowed.toFixed(1)}% فقط`,
      messageEn: `Recommendation: 15% max for diversification — you can add ${maxAllowed.toFixed(1)}% only`,
      actionRequired: 'reduce_size',
      details: {
        currentPosition,
        requested: tradeValuePercent,
        maxAllowed,
      },
    };
  }

  // All protections passed
  return {
    passed: true,
    protectionType: null,
    severity: 'warning',
    messageAr: 'تم التحقق — يمكنك المتابعة',
    messageEn: 'Verified — you can proceed',
    actionRequired: 'proceed',
  };
}

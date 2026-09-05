import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * Crypto Simulation API - Python Backend = THE BRAIN
 * 
 * All simulation logic is in Python backend:
 * - Portfolio management
 * - Trade execution
 * - P/L calculation
 * - Position tracking
 * 
 * Node.js = DISPLAY ONLY
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// GET - Get portfolio status
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id') || 'demo';

    // Call Python backend for portfolio - THE BRAIN
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/crypto/simulation/portfolio?user_id=${userId}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          source: 'python_backend',
          portfolio: data.portfolio
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[Crypto Simulation] Python backend not available');
    }

    // ❌ NO FAKE DATA - Return error instead of demo portfolio
    return NextResponse.json({
      success: false,
      source: 'error',
      error: 'Python backend unavailable. Cannot fetch portfolio data.',
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('[Crypto Simulation] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get portfolio'
    }, { status: 500 });
  }
}

// POST - Execute trade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id = 'demo', coin_id, action, amount } = body;

    if (!coin_id || !amount || amount <= 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid parameters. Required: coin_id, action (BUY/SELL), amount (> 0)'
      }, { status: 400 });
    }

    // Call Python backend to execute trade - THE BRAIN
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/crypto/simulation/trade`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id,
          coin_id,
          action: action.toUpperCase(),
          amount: parseFloat(amount)
        })
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          source: 'python_backend',
          ...data
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[Crypto Simulation Trade] Python backend not available');
    }

    return NextResponse.json({
      success: false,
      error: 'Python backend unavailable for trade execution'
    });

  } catch (error) {
    console.error('[Crypto Simulation Trade] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Trade execution failed'
    }, { status: 500 });
  }
}

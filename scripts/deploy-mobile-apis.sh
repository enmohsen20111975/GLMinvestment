#!/bin/bash
# =============================================================================
# Mobile APIs Deployment Script
# =============================
# 
# This script creates all mobile API files on your production server.
# 
# Usage:
#   chmod +x deploy-mobile-apis.sh
#   ./deploy-mobile-apis.sh
#
# After running, restart PM2:
#   pm2 restart nextjs-frontend
# =============================================================================

set -e

BASE_DIR="/root/GLMinvestment"
API_DIR="$BASE_DIR/src/app/api/mobile"

echo "=============================================="
echo "Mobile APIs Deployment Script"
echo "=============================================="
echo ""
echo "Base directory: $BASE_DIR"
echo "API directory: $API_DIR"
echo ""

# Create directories
echo "Creating directories..."
mkdir -p "$API_DIR/market/overview"
mkdir -p "$API_DIR/market/recommendations/ai-insights"
mkdir -p "$API_DIR/predictions"
mkdir -p "$API_DIR/portfolio"
mkdir -p "$API_DIR/crypto"
mkdir -p "$API_DIR/auth/me"
mkdir -p "$API_DIR/recommendations"
mkdir -p "$API_DIR/watchlist-enhanced"

echo "✓ Directories created"
echo ""

# =============================================================================
# 1. Mobile Market Overview API
# =============================================================================
echo "Creating /api/mobile/market/overview/route.ts..."
cat > "$API_DIR/market/overview/route.ts" << 'ENDOFFILE'
/**
 * Mobile Market Overview API
 * 
 * GET /api/mobile/market/overview
 * 
 * Returns market summary, top gainers, top losers, most active stocks
 * Uses Python Backend first, then falls back to Local DB
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

export async function GET() {
  try {
    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>('/api/market/overview');

    if (pythonResult.success && pythonResult.data) {
      const data = pythonResult.data;
      
      // Transform Python response to mobile format
      const gainers = (data.gainers || []).map((s: any) => ({
        ticker: s.symbol || s.ticker,
        name: s.name || '',
        name_ar: s.name_ar || s.name || '',
        current_price: s.current_price || 0,
        change: s.change_amount || 0,
        change_percent: s.change_percent || 0,
        volume: s.volume || 0,
      }));

      const losers = (data.losers || []).map((s: any) => ({
        ticker: s.symbol || s.ticker,
        name: s.name || '',
        name_ar: s.name_ar || s.name || '',
        current_price: s.current_price || 0,
        change: s.change_amount || 0,
        change_percent: s.change_percent || 0,
        volume: s.volume || 0,
      }));

      const mostActive = (data.most_active || []).map((s: any) => ({
        ticker: s.symbol || s.ticker,
        name: s.name || '',
        name_ar: s.name_ar || s.name || '',
        current_price: s.current_price || 0,
        change: s.change_amount || 0,
        change_percent: s.change_percent || 0,
        volume: s.volume || 0,
      }));

      // Determine market status
      const now = new Date();
      const hour = now.getUTCHours() + 2; // Egypt timezone
      const day = now.getUTCDay();
      const isWeekend = day === 5 || day === 6;
      const isMarketHours = hour >= 10 && hour < 14.5;
      const isOpen = !isWeekend && isMarketHours;

      return NextResponse.json({
        success: true,
        source: 'python_backend',
        timestamp: new Date().toISOString(),
        market_status: {
          is_open: isOpen,
          status: isOpen ? 'open' : 'closed',
          current_session: isOpen ? 'trading' : 'closed',
          timezone: 'Africa/Cairo',
        },
        summary: {
          total_stocks: data.stats?.total || gainers.length + losers.length,
          gainers: data.stats?.gainers || gainers.length,
          losers: data.stats?.losers || losers.length,
          unchanged: 0,
          total_volume: mostActive.reduce((sum: number, s: any) => sum + (s.volume || 0), 0),
        },
        top_gainers: gainers.slice(0, 10),
        top_losers: losers.slice(0, 10),
        most_active: mostActive.slice(0, 10),
      });
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    const stocks = dbLite.prepare(`
      SELECT 
        ticker, name, name_ar, current_price, previous_close, volume,
        high_price, low_price, open_price, sector
      FROM stocks
      WHERE is_active = 1
    `).all() as Array<{
      ticker: string;
      name: string;
      name_ar: string;
      current_price: number;
      previous_close: number;
      volume: number;
      high_price: number;
      low_price: number;
      open_price: number;
      sector: string;
    }>;

    if (stocks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No stocks data available. Please sync from admin panel.',
        market_status: { is_open: false, status: 'closed' },
        summary: { total_stocks: 0, gainers: 0, losers: 0, unchanged: 0 },
        top_gainers: [],
        top_losers: [],
        most_active: [],
      });
    }

    // Process stocks
    let gainersCount = 0;
    let losersCount = 0;
    let unchangedCount = 0;
    
    const gainersList: any[] = [];
    const losersList: any[] = [];
    const activeList: any[] = [];

    for (const stock of stocks) {
      const change = stock.current_price - stock.previous_close;
      const changePercent = stock.previous_close > 0
        ? ((stock.current_price - stock.previous_close) / stock.previous_close) * 100
        : 0;

      const stockData = {
        ticker: stock.ticker,
        name: stock.name,
        name_ar: stock.name_ar,
        current_price: stock.current_price,
        change: Math.round(change * 100) / 100,
        change_percent: Math.round(changePercent * 100) / 100,
        volume: stock.volume || 0,
      };

      if (changePercent > 0) {
        gainersCount++;
        gainersList.push(stockData);
      } else if (changePercent < 0) {
        losersCount++;
        losersList.push(stockData);
      } else {
        unchangedCount++;
      }

      if (stock.volume > 0) {
        activeList.push(stockData);
      }
    }

    // Sort lists
    gainersList.sort((a, b) => b.change_percent - a.change_percent);
    losersList.sort((a, b) => a.change_percent - b.change_percent);
    activeList.sort((a, b) => b.volume - a.volume);

    // Determine market status
    const now = new Date();
    const hour = now.getUTCHours() + 2;
    const day = now.getUTCDay();
    const isWeekend = day === 5 || day === 6;
    const isMarketHours = hour >= 10 && hour < 14.5;
    const isOpen = !isWeekend && isMarketHours;

    return NextResponse.json({
      success: true,
      source: 'local_db',
      timestamp: new Date().toISOString(),
      market_status: {
        is_open: isOpen,
        status: isOpen ? 'open' : 'closed',
        current_session: isOpen ? 'trading' : 'closed',
        timezone: 'Africa/Cairo',
      },
      summary: {
        total_stocks: stocks.length,
        gainers: gainersCount,
        losers: losersCount,
        unchanged: unchangedCount,
        total_volume: stocks.reduce((sum, s) => sum + (s.volume || 0), 0),
      },
      top_gainers: gainersList.slice(0, 10),
      top_losers: losersList.slice(0, 10),
      most_active: activeList.slice(0, 10),
    });

  } catch (error) {
    console.error('[GET /api/mobile/market/overview] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get market overview', detail: String(error) },
      { status: 500 }
    );
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/market/overview/route.ts"

# =============================================================================
# 2. Mobile Predictions API
# =============================================================================
echo "Creating /api/mobile/predictions/route.ts..."
cat > "$API_DIR/predictions/route.ts" << 'ENDOFFILE'
/**
 * Mobile Predictions API
 * ======================
 *
 * GET /api/mobile/predictions
 *
 * Returns recent AI predictions and stats
 * Uses Python Backend first, then falls back to Local DB
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

export async function GET() {
  try {
    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>('/api/predictions?limit=20');

    if (pythonResult.success && pythonResult.data?.predictions?.length > 0) {
      const predictions = pythonResult.data.predictions.map((p: any) => ({
        id: p.id,
        symbol: p.symbol || p.ticker,
        market: p.market || 'EGX',
        signal: p.signal || p.prediction || 'HOLD',
        confidence: p.confidence || 50,
        entry_price: p.entry_price || p.current_price || 0,
        target_price: p.target_price || p.predicted_price || 0,
        stop_loss: p.stop_loss || 0,
        reasoning: p.reasoning || p.analysis || '',
        created_at: p.created_at || p.prediction_date,
        verify_date: p.verify_date,
        verified: p.verified === true || p.verified === 1,
        result: p.result,
        final_price: p.final_price,
        profit_loss_pct: p.profit_loss_pct ? Math.round(p.profit_loss_pct * 100) / 100 : null,
      }));

      return NextResponse.json({
        success: true,
        source: 'python_backend',
        predictions,
        stats: {
          total_predictions: pythonResult.data.stats?.total || predictions.length,
          verified_predictions: pythonResult.data.stats?.verified || 0,
          successful: pythonResult.data.stats?.successful || 0,
          failed: pythonResult.data.stats?.failed || 0,
          success_rate: pythonResult.data.stats?.success_rate || 0,
        },
      });
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    // Check if predictions table exists
    try {
      const predictions = dbLite.prepare(`
        SELECT 
          id, symbol, market, signal, confidence,
          entry_price, target_price, stop_loss, reasoning,
          created_at, verify_date, verified, result, final_price, profit_loss_pct
        FROM DeepSeekPrediction
        ORDER BY created_at DESC
        LIMIT 20
      `).all() as any[];

      const totalResult = dbLite.prepare('SELECT COUNT(*) as count FROM DeepSeekPrediction').get() as { count: number };
      const verifiedResult = dbLite.prepare('SELECT COUNT(*) as count FROM DeepSeekPrediction WHERE verified = 1').get() as { count: number };
      const successfulResult = dbLite.prepare("SELECT COUNT(*) as count FROM DeepSeekPrediction WHERE verified = 1 AND result = 'SUCCESS'").get() as { count: number };

      const total = totalResult?.count || 0;
      const verified = verifiedResult?.count || 0;
      const successful = successfulResult?.count || 0;
      const successRate = verified > 0 ? (successful / verified) * 100 : 0;

      return NextResponse.json({
        success: true,
        source: 'local_db',
        predictions: predictions.map(p => ({
          id: p.id,
          symbol: p.symbol,
          market: p.market,
          signal: p.signal,
          confidence: p.confidence,
          entry_price: p.entry_price,
          target_price: p.target_price,
          stop_loss: p.stop_loss,
          reasoning: p.reasoning,
          created_at: p.created_at,
          verify_date: p.verify_date,
          verified: p.verified === 1,
          result: p.result,
          final_price: p.final_price,
          profit_loss_pct: p.profit_loss_pct ? Math.round(p.profit_loss_pct * 100) / 100 : null,
        })),
        stats: {
          total_predictions: total,
          verified_predictions: verified,
          successful,
          failed: verified - successful,
          success_rate: Math.round(successRate * 10) / 10,
        },
      });
    } catch {
      // Predictions table doesn't exist
      return NextResponse.json({
        success: true,
        source: 'local_db',
        predictions: [],
        stats: {
          total_predictions: 0,
          verified_predictions: 0,
          successful: 0,
          failed: 0,
          success_rate: 0,
        },
      });
    }

  } catch (error) {
    console.error('[GET /api/mobile/predictions] Error:', error);

    return NextResponse.json({
      success: true,
      predictions: [],
      stats: {
        total_predictions: 0,
        verified_predictions: 0,
        successful: 0,
        failed: 0,
        success_rate: 0,
      },
    });
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/predictions/route.ts"

# =============================================================================
# 3. Mobile Crypto API
# =============================================================================
echo "Creating /api/mobile/crypto/route.ts..."
cat > "$API_DIR/crypto/route.ts" << 'ENDOFFILE'
/**
 * GET /api/mobile/crypto
 *
 * Mobile-specific endpoint for crypto prices
 * Uses Python Backend first, then returns mock data as fallback
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>('/api/crypto');

    if (pythonResult.success && pythonResult.data) {
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        ...pythonResult.data,
      });
    }

    // 2. Fallback: Return mock crypto data
    // In production, this should fetch from a real crypto API
    const cryptoData = [
      {
        symbol: 'BTC',
        name: 'Bitcoin',
        name_ar: 'بيتكوين',
        price: 67500,
        change_24h: 2.5,
        market_cap: 1320000000000,
        volume_24h: 28500000000,
      },
      {
        symbol: 'ETH',
        name: 'Ethereum',
        name_ar: 'إيثيريوم',
        price: 3450,
        change_24h: 1.8,
        market_cap: 415000000000,
        volume_24h: 12500000000,
      },
      {
        symbol: 'BNB',
        name: 'Binance Coin',
        name_ar: 'عملة بينانس',
        price: 585,
        change_24h: -0.5,
        market_cap: 87000000000,
        volume_24h: 1200000000,
      },
      {
        symbol: 'SOL',
        name: 'Solana',
        name_ar: 'سولانا',
        price: 145,
        change_24h: 3.2,
        market_cap: 63000000000,
        volume_24h: 2100000000,
      },
      {
        symbol: 'XRP',
        name: 'Ripple',
        name_ar: 'ريبل',
        price: 0.52,
        change_24h: -1.2,
        market_cap: 28000000000,
        volume_24h: 1100000000,
      },
    ];

    return NextResponse.json({
      success: true,
      source: 'fallback',
      crypto: cryptoData,
      timestamp: new Date().toISOString(),
      disclaimer: 'أسعار تقريبية - غير مخصصة للتداول الفعلي',
    });

  } catch (error) {
    console.error('[/api/mobile/crypto] Error:', error);
    return NextResponse.json({
      success: true,
      crypto: [],
      timestamp: new Date().toISOString(),
      error: 'Unable to fetch crypto data',
    });
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/crypto/route.ts"

# =============================================================================
# 4. Mobile Auth Me API
# =============================================================================
echo "Creating /api/mobile/auth/me/route.ts..."
cat > "$API_DIR/auth/me/route.ts" << 'ENDOFFILE'
/**
 * GET /api/mobile/auth/me
 *
 * Get current user info using Bearer token
 * Mobile-specific endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json({
        success: false,
        error: 'Authorization header مطلوب',
        error_en: 'Authorization header required',
      }, { status: 401 });
    }

    // Extract token
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return NextResponse.json({
        success: false,
        error: 'Token غير صالح',
        error_en: 'Invalid token',
      }, { status: 401 });
    }

    // Find token in database
    try {
      const apiToken = await db.apiToken.findUnique({
        where: { token },
        include: { User: true },
      });

      if (!apiToken) {
        return NextResponse.json({
          success: false,
          error: 'Token غير موجود',
          error_en: 'Token not found',
        }, { status: 401 });
      }

      // Check if token is expired
      if (apiToken.expires_at < new Date()) {
        return NextResponse.json({
          success: false,
          error: 'Token منتهي الصلاحية',
          error_en: 'Token expired',
        }, { status: 401 });
      }

      // Check if user is active
      if (!apiToken.User?.is_active) {
        return NextResponse.json({
          success: false,
          error: 'الحساب غير مفعل',
          error_en: 'Account is deactivated',
        }, { status: 403 });
      }

      // Update last used timestamp
      await db.apiToken.update({
        where: { id: apiToken.id },
        data: { last_used: new Date() },
      }).catch(() => {});

      const user = apiToken.User;

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          image: user.image,
          subscription_tier: user.subscription_tier || 'free',
          default_risk_tolerance: user.default_risk_tolerance || 'medium',
          is_admin: user.subscription_tier === 'admin',
          is_active: user.is_active,
          email_verified: !!user.email_verified,
          last_login: user.last_login?.toISOString() || null,
          created_at: user.created_at?.toISOString() || null,
        },
      });

    } catch (dbError) {
      // Database error - user table might not exist
      console.error('[Mobile Auth] DB Error:', dbError);
      
      // Return a mock user for now
      return NextResponse.json({
        success: true,
        user: {
          id: 'demo-user',
          email: 'demo@example.com',
          username: 'demo',
          name: 'Demo User',
          image: null,
          subscription_tier: 'free',
          default_risk_tolerance: 'medium',
          is_admin: false,
          is_active: true,
          email_verified: true,
          last_login: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        _demo: true,
      });
    }

  } catch (error) {
    console.error('[GET /api/mobile/auth/me] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء جلب بيانات المستخدم',
      error_en: 'Error fetching user data',
    }, { status: 500 });
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/auth/me/route.ts"

# =============================================================================
# 5. Mobile Recommendations API
# =============================================================================
echo "Creating /api/mobile/recommendations/route.ts..."
cat > "$API_DIR/recommendations/route.ts" << 'ENDOFFILE'
/**
 * Mobile Recommendations API
 * 
 * GET /api/mobile/recommendations
 * 
 * Returns stock recommendations based on persona
 * Uses Python Backend first, then falls back to Local DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

// Persona thresholds
const PERSONA_THRESHOLDS = {
  conservative: 75,
  balanced: 65,
  gambler: 50,
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const persona = (searchParams.get('persona') || 'balanced') as keyof typeof PERSONA_THRESHOLDS;
    const limit = parseInt(searchParams.get('limit') || '10');

    const threshold = PERSONA_THRESHOLDS[persona] || 65;

    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>(`/api/recommendations?persona=${persona}&limit=${limit}`);

    if (pythonResult.success && pythonResult.data?.recommendations?.length > 0) {
      const recommendations = pythonResult.data.recommendations.map((r: any) => ({
        ticker: r.ticker || r.symbol,
        name: r.name || '',
        name_ar: r.name_ar || r.name || '',
        sector: r.sector || '',
        current_price: r.current_price || r.entry_price || 0,
        change_percent: r.change_percent || 0,
        score: r.score || r.confidence || 70,
        recommendation: r.recommendation || r.action || 'buy',
        signals: r.signals || [],
        target_price: r.target_price || r.current_price * 1.15,
        stop_loss: r.stop_loss || r.current_price * 0.92,
      }));

      return NextResponse.json({
        success: true,
        source: 'python_backend',
        timestamp: new Date().toISOString(),
        persona,
        threshold,
        recommendations,
        total_analyzed: pythonResult.data.total_analyzed || recommendations.length,
        passed_filter: recommendations.length,
      });
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    const stocks = dbLite.prepare(`
      SELECT 
        ticker, name, name_ar, current_price, previous_close, sector, volume
      FROM stocks
      WHERE is_active = 1 AND current_price > 0
    `).all() as Array<{
      ticker: string;
      name: string;
      name_ar: string;
      current_price: number;
      previous_close: number;
      sector: string;
      volume: number;
    }>;

    // Score each stock
    const scoredStocks = stocks.map(stock => {
      let score = 50;
      const signals: string[] = [];

      const changePercent = stock.previous_close > 0
        ? ((stock.current_price - stock.previous_close) / stock.previous_close) * 100
        : 0;

      if (changePercent > 0 && changePercent < 5) {
        score += 15;
        signals.push('positive_momentum');
      } else if (changePercent > 0 && changePercent < 10) {
        score += 10;
        signals.push('moderate_gain');
      } else if (changePercent < 0 && changePercent > -5) {
        score += 5;
        signals.push('slight_dip');
      }

      if (stock.volume > 1000000) {
        score += 10;
        signals.push('high_liquidity');
      } else if (stock.volume > 100000) {
        score += 5;
        signals.push('good_liquidity');
      }

      return {
        ...stock,
        score: Math.min(100, Math.max(0, score)),
        change_percent: Math.round(changePercent * 100) / 100,
        signals,
      };
    });

    // Filter by threshold and sort
    const recommendations = scoredStocks
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const getRecommendation = (score: number) => {
      if (score >= 85) return 'strong_buy';
      if (score >= 70) return 'buy';
      if (score >= 50) return 'hold';
      return 'avoid';
    };

    return NextResponse.json({
      success: true,
      source: 'local_db',
      timestamp: new Date().toISOString(),
      persona,
      threshold,
      recommendations: recommendations.map(s => ({
        ticker: s.ticker,
        name: s.name,
        name_ar: s.name_ar,
        sector: s.sector,
        current_price: s.current_price,
        change_percent: s.change_percent,
        score: s.score,
        recommendation: getRecommendation(s.score),
        signals: s.signals,
        target_price: s.current_price * 1.15,
        stop_loss: s.current_price * 0.92,
      })),
      total_analyzed: stocks.length,
      passed_filter: scoredStocks.filter(s => s.score >= threshold).length,
    });

  } catch (error) {
    console.error('[GET /api/mobile/recommendations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get recommendations', detail: String(error) },
      { status: 500 }
    );
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/recommendations/route.ts"

# =============================================================================
# 6. Mobile AI Insights API
# =============================================================================
echo "Creating /api/mobile/market/recommendations/ai-insights/route.ts..."
cat > "$API_DIR/market/recommendations/ai-insights/route.ts" << 'ENDOFFILE'
/**
 * GET /api/mobile/market/recommendations/ai-insights
 *
 * Mobile-specific endpoint for AI market insights
 * Uses Python Backend first, then local DB fallback
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

export async function GET() {
  try {
    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>('/api/market/recommendations/ai-insights');

    if (pythonResult.success && pythonResult.data) {
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        ...pythonResult.data,
      });
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    // Get market data for analysis
    const stocks = dbLite.prepare(`
      SELECT ticker, current_price, previous_close, volume, rsi
      FROM stocks
      WHERE is_active = 1 AND current_price > 0
    `).all() as Array<{
      ticker: string;
      current_price: number;
      previous_close: number;
      volume: number;
      rsi: number;
    }>;

    if (stocks.length === 0) {
      return NextResponse.json({
        success: true,
        source: 'local_db',
        overall_sentiment: 'neutral',
        sentiment_ar: 'محايد',
        confidence: 0,
        key_factors: ['لا توجد بيانات كافية'],
        recommendation: 'hold',
        recommendation_ar: 'احتفاظ',
      });
    }

    // Calculate sentiment
    let bullishCount = 0;
    let bearishCount = 0;
    let totalVolume = 0;

    for (const stock of stocks) {
      const changePercent = stock.previous_close > 0
        ? ((stock.current_price - stock.previous_close) / stock.previous_close) * 100
        : 0;
      totalVolume += stock.volume || 0;
      if (changePercent > 2) bullishCount++;
      else if (changePercent < -2) bearishCount++;
    }

    const total = stocks.length;
    const bullishPercent = (bullishCount / total) * 100;
    const bearishPercent = (bearishCount / total) * 100;

    let overallSentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let confidence = 50;

    if (bullishPercent > 40) {
      overallSentiment = 'bullish';
      confidence = Math.min(90, 50 + bullishPercent - bearishPercent);
    } else if (bearishPercent > 40) {
      overallSentiment = 'bearish';
      confidence = Math.min(90, 50 + bearishPercent - bullishPercent);
    }

    const keyFactors: string[] = [];
    if (bullishPercent > 30) keyFactors.push(`${bullishPercent.toFixed(0)}% من الأسهم صاعدة`);
    if (bearishPercent > 30) keyFactors.push(`${bearishPercent.toFixed(0)}% من الأسهم هابطة`);
    if (totalVolume > 10000000) keyFactors.push('سيولة عالية في السوق');

    let recommendation = 'hold';
    let recommendationAr = 'احتفاظ';
    if (overallSentiment === 'bullish' && confidence > 60) {
      recommendation = 'buy';
      recommendationAr = 'شراء';
    } else if (overallSentiment === 'bearish' && confidence > 60) {
      recommendation = 'sell';
      recommendationAr = 'بيع';
    }

    const sentimentArMap = {
      bullish: 'صعودي',
      bearish: 'هبوطي',
      neutral: 'محايد',
    };

    return NextResponse.json({
      success: true,
      source: 'local_db',
      overall_sentiment: overallSentiment,
      sentiment_ar: sentimentArMap[overallSentiment],
      confidence: Math.round(confidence),
      key_factors: keyFactors.length > 0 ? keyFactors : ['السوق متوازن'],
      recommendation,
      recommendation_ar: recommendationAr,
    });

  } catch (error) {
    console.error('[/api/mobile/market/recommendations/ai-insights] Error:', error);
    return NextResponse.json({
      success: true,
      overall_sentiment: 'neutral',
      sentiment_ar: 'محايد',
      confidence: 0,
      key_factors: ['خطأ في تحليل البيانات'],
      recommendation: 'hold',
      recommendation_ar: 'احتفاظ',
    });
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/market/recommendations/ai-insights/route.ts"

# =============================================================================
# 7. Mobile Watchlist Enhanced API
# =============================================================================
echo "Creating /api/mobile/watchlist-enhanced/route.ts..."
cat > "$API_DIR/watchlist-enhanced/route.ts" << 'ENDOFFILE'
/**
 * GET /api/mobile/watchlist-enhanced
 *
 * Mobile-specific endpoint for enhanced watchlist
 * Uses Python Backend first, then local DB fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { db } from '@/lib/db';

async function getUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) return null;

  try {
    const apiToken = await db.apiToken.findUnique({
      where: { token },
      select: { user_id: true, expires_at: true },
    });

    if (!apiToken || apiToken.expires_at < new Date()) return null;
    return apiToken.user_id;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);

    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<any>('/api/watchlist-enhanced');

    if (pythonResult.success && pythonResult.data) {
      return NextResponse.json({
        success: true,
        source: 'python_backend',
        ...pythonResult.data,
      });
    }

    // 2. Fallback to Local DB
    if (!userId) {
      return NextResponse.json({
        success: true,
        source: 'local_db',
        watchlist: [],
        summary: {
          total: 0,
          gainers: 0,
          losers: 0,
          alerts: 0,
        },
      });
    }

    await ensureInitialized();
    const dbLite = getLightDb();

    // Get watchlist from SQLite
    const watchlistItems = dbLite.prepare(`
      SELECT
        w.id, w.user_id, w.stock_id, w.alert_price_above, w.alert_price_below,
        w.alert_change_percent, w.notes, w.purchase_price, w.quantity,
        s.ticker, s.name, s.name_ar, s.current_price, s.previous_close, s.sector, s.volume
      FROM user_stock_watchlists w
      JOIN stocks s ON w.stock_id = s.id
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC
    `).all(userId) as any[];

    const watchlist = [];
    let gainers = 0;
    let losers = 0;
    let alerts = 0;

    for (const item of watchlistItems) {
      const changePercent = item.previous_close > 0
        ? ((item.current_price - item.previous_close) / item.previous_close) * 100
        : 0;

      if (changePercent > 0) gainers++;
      else if (changePercent < 0) losers++;

      // Check alerts
      const hasAlertAbove = item.alert_price_above && item.current_price >= item.alert_price_above;
      const hasAlertBelow = item.alert_price_below && item.current_price <= item.alert_price_below;
      if (hasAlertAbove || hasAlertBelow) alerts++;

      // Calculate P&L if purchase price is set
      let pnl = null;
      let pnlPercent = null;
      if (item.purchase_price && item.purchase_price > 0) {
        pnl = (item.current_price - item.purchase_price) * (item.quantity || 1);
        pnlPercent = ((item.current_price - item.purchase_price) / item.purchase_price) * 100;
      }

      watchlist.push({
        id: item.id,
        ticker: item.ticker,
        name: item.name || item.ticker,
        name_ar: item.name_ar || item.name || item.ticker,
        sector: item.sector,
        current_price: item.current_price || 0,
        previous_close: item.previous_close || 0,
        change_percent: Math.round(changePercent * 100) / 100,
        volume: item.volume || 0,
        alert_price_above: item.alert_price_above,
        alert_price_below: item.alert_price_below,
        notes: item.notes,
        purchase_price: item.purchase_price,
        quantity: item.quantity,
        pnl: pnl ? Math.round(pnl * 100) / 100 : null,
        pnl_percent: pnlPercent ? Math.round(pnlPercent * 100) / 100 : null,
        has_alert: hasAlertAbove || hasAlertBelow,
      });
    }

    return NextResponse.json({
      success: true,
      source: 'local_db',
      watchlist,
      summary: {
        total: watchlist.length,
        gainers,
        losers,
        alerts,
      },
    });

  } catch (error) {
    console.error('[/api/mobile/watchlist-enhanced] Error:', error);
    return NextResponse.json({
      success: true,
      watchlist: [],
      summary: { total: 0, gainers: 0, losers: 0, alerts: 0 },
    });
  }
}
ENDOFFILE
echo "✓ Created /api/mobile/watchlist-enhanced/route.ts"

# =============================================================================
# 8. Mobile Portfolio API
# =============================================================================
echo "Creating /api/mobile/portfolio/route.ts..."
cat > "$API_DIR/portfolio/route.ts" << 'ENDOFFILE'
/**
 * Mobile Portfolio API
 *
 * GET /api/mobile/portfolio - Get user portfolio (stocks, gold, certificates)
 * POST /api/mobile/portfolio - Add position to portfolio
 * DELETE /api/mobile/portfolio - Remove position
 *
 * Headers:
 *   Authorization: Bearer <token>
 *
 * Uses portfolio_assets table which supports all asset types.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { getFinanceDb } from '@/lib/finance-db';

/**
 * Get user ID from Bearer token
 */
async function getUserIdFromToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) return null;

  const apiToken = await db.apiToken.findUnique({
    where: { token },
    select: { user_id: true, expires_at: true },
  });

  if (!apiToken || apiToken.expires_at < new Date()) {
    return null;
  }

  return apiToken.user_id;
}

/** Ensure table exists helper */
const PORTFOLIO_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS portfolio_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'stock',
    name TEXT NOT NULL,
    total_invested REAL NOT NULL DEFAULT 0,
    current_value REAL NOT NULL DEFAULT 0,
    notes TEXT,
    weight_grams REAL,
    karat INTEGER,
    purchase_price_per_gram REAL,
    bank_name TEXT,
    interest_rate REAL,
    certificate_duration_months INTEGER,
    certificate_return_rate REAL,
    certificate_maturity_date TEXT,
    fund_name TEXT,
    fund_type TEXT,
    stock_id INTEGER,
    stock_ticker TEXT,
    quantity REAL,
    avg_buy_price REAL,
    added_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`;

function ensurePortfolioAssetsTable(sqliteDb: any): void {
  sqliteDb.prepare(PORTFOLIO_TABLE_DDL).run();
}

/**
 * GET /api/mobile/portfolio
 * Get all portfolio assets for authenticated user from stocks.db
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    console.log('[Mobile Portfolio] Fetching from stocks.db for user:', userId);

    const sqliteDb = await getFinanceDb();
    ensurePortfolioAssetsTable(sqliteDb);

    // Fallback logic for admin/demo user to show the big test data
    let effectiveUserId = userId;
    const countRow = sqliteDb.prepare("SELECT COUNT(*) as count FROM portfolio_assets WHERE user_id = ?").get(effectiveUserId) as { count: number } | undefined;
    const count = countRow?.count ?? 0;
    
    const adminEmails = ['enmohsen20111975@gmail.com', 'ceo@m2y.net'];
    
    // Fetch email to check if admin
    let userEmail = '';
    try {
      const userObj = await db.user.findUnique({ where: { id: userId } });
      userEmail = userObj?.email || '';
    } catch (_) {}

    const isAdmin = adminEmails.includes(userEmail.toLowerCase()) || userId === '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd' || userId === 'cmo8o12ix0000jqfcl9mbsi1s';

    if (count === 0 && (isAdmin || userId === '105051756603508628603')) {
      console.log('[Mobile Portfolio] Falling back to demo user ID to load default data');
      effectiveUserId = '105051756603508628603';
    }

    // Query portfolio_assets from stocks.db
    const portfolioAssets = sqliteDb.prepare("SELECT * FROM portfolio_assets WHERE user_id = ? ORDER BY added_at DESC").all(effectiveUserId) as any[];

    console.log('[Mobile Portfolio] Found', portfolioAssets.length, 'assets for user:', effectiveUserId);

    // Ensure DB is initialized for stock prices
    await ensureInitialized();
    const dbLite = getLightDb();

    // Enrich portfolio items
    const enrichedItems = portfolioAssets.map((asset) => {
      const item: any = {
        id: asset.id,
        type: asset.type,
        name: asset.name,
        total_invested: asset.total_invested || 0,
        current_value: asset.current_value || 0,
        notes: asset.notes,
        added_at: asset.added_at,
      };

      if (asset.type === 'stock' && asset.stock_ticker) {
        // Get current stock price
        const stockData = dbLite.prepare(`
          SELECT current_price, name, name_ar, sector, previous_close
          FROM stocks
          WHERE ticker = ?
        `).get(asset.stock_ticker) as { current_price: number; name: string; name_ar: string; sector: string; previous_close: number } | undefined;

        const currentPrice = stockData?.current_price || asset.avg_buy_price || 0;
        const quantity = asset.quantity || 0;
        const avgBuyPrice = asset.avg_buy_price || 0;
        const marketValue = quantity * currentPrice;
        const costBasis = quantity * avgBuyPrice;
        const unrealizedPnl = marketValue - costBasis;
        const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

        return {
          ...item,
          ticker: asset.stock_ticker,
          stock_name: stockData?.name_ar || stockData?.name || asset.stock_ticker,
          sector: stockData?.sector || 'غير محدد',
          quantity,
          avg_cost: avgBuyPrice,
          current_price: currentPrice,
          market_value: marketValue,
          cost_basis: costBasis,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_percent: Math.round(unrealizedPnlPercent * 100) / 100,
          change_percent: stockData?.previous_close > 0
            ? ((currentPrice - stockData.previous_close) / stockData.previous_close) * 100
            : 0,
          status: getStatus(unrealizedPnlPercent),
          status_ar: getStatusAr(unrealizedPnlPercent),
        };
      }

      if (asset.type === 'gold') {
        const weightGrams = asset.weight_grams || 0;
        const purchasePricePerGram = asset.purchase_price_per_gram || 0;
        const costBasis = weightGrams * purchasePricePerGram;
        const marketValue = asset.current_value || costBasis;
        const unrealizedPnl = marketValue - costBasis;
        const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

        return {
          ...item,
          weight_grams: weightGrams,
          karat: asset.karat,
          purchase_price_per_gram: purchasePricePerGram,
          market_value: marketValue,
          cost_basis: costBasis,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_percent: Math.round(unrealizedPnlPercent * 100) / 100,
          status: getStatus(unrealizedPnlPercent),
          status_ar: getStatusAr(unrealizedPnlPercent),
        };
      }

      if (asset.type === 'certificate') {
        const totalInvested = asset.total_invested || 0;
        const returnRate = asset.certificate_return_rate || 0;
        const annualReturn = totalInvested * (returnRate / 100);

        return {
          ...item,
          bank_name: asset.bank_name,
          interest_rate: asset.interest_rate,
          certificate_duration_months: asset.certificate_duration_months,
          certificate_return_rate: returnRate,
          certificate_maturity_date: asset.certificate_maturity_date,
          annual_return: annualReturn,
          monthly_return: annualReturn / 12,
          market_value: totalInvested,
          cost_basis: totalInvested,
        };
      }

      return item;
    });

    // Calculate summary
    const totalInvested = enrichedItems.reduce((sum, item) => sum + (item.total_invested || item.cost_basis || 0), 0);
    const totalMarketValue = enrichedItems.reduce((sum, item) => sum + (item.market_value || item.current_value || 0), 0);
    const totalUnrealizedPnl = totalMarketValue - totalInvested;
    const totalUnrealizedPnlPercent = totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0;

    // Group by type
    const byType = {
      stocks: enrichedItems.filter(i => i.type === 'stock'),
      gold: enrichedItems.filter(i => i.type === 'gold'),
      certificates: enrichedItems.filter(i => i.type === 'certificate'),
      funds: enrichedItems.filter(i => i.type === 'fund'),
    };

    return NextResponse.json({
      success: true,
      items: enrichedItems,
      positions: enrichedItems.filter(i => i.type === 'stock'), // Backward compatibility
      summary: {
        total_items: enrichedItems.length,
        total_positions: byType.stocks.length,
        total_invested: totalInvested,
        total_market_value: totalMarketValue,
        total_unrealized_pnl: totalUnrealizedPnl,
        total_unrealized_pnl_percent: Math.round(totalUnrealizedPnlPercent * 100) / 100,
        stocks_count: byType.stocks.length,
        gold_items: byType.gold.length,
        certificates_count: byType.certificates.length,
        winning_positions: enrichedItems.filter(i => (i.unrealized_pnl || 0) > 0).length,
        losing_positions: enrichedItems.filter(i => (i.unrealized_pnl || 0) < 0).length,
      },
      by_type: byType,
    });

  } catch (error) {
    console.error('[GET /api/mobile/portfolio] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch portfolio', detail: String(error), items: [], positions: [] },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/portfolio
 * Add a new asset (stock, gold, certificate) to stocks.db
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      type, // stock, gold, certificate, fund
      stock_symbol,
      shares,
      avg_cost,
      weight_grams,
      karat,
      purchase_price_per_gram,
      bank_name,
      interest_rate,
      certificate_duration_months,
      certificate_return_rate,
      certificate_maturity_date,
      name,
      total_invested,
      notes,
    } = body;

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'نوع الأصل مطلوب (stock, gold, certificate, fund)' },
        { status: 400 }
      );
    }

    // Build insert data based on type
    const insertData: any = {
      user_id: userId,
      type,
      name: name || '',
      total_invested: total_invested || 0,
      current_value: 0,
      notes,
    };

    if (type === 'stock') {
      const ticker = stock_symbol?.toUpperCase();

      if (!ticker || !shares || !avg_cost) {
        return NextResponse.json(
          { success: false, error: 'بيانات السهم غير كاملة: stock_symbol, shares, avg_cost' },
          { status: 400 }
        );
      }

      // Verify stock exists
      await ensureInitialized();
      const dbLite = getLightDb();
      const stock = dbLite.prepare('SELECT ticker, name, name_ar FROM stocks WHERE ticker = ? COLLATE NOCASE')
        .get(ticker) as { ticker: string; name: string; name_ar: string } | undefined;

      if (!stock) {
        return NextResponse.json(
          { success: false, error: `السهم ${ticker} غير موجود` },
          { status: 404 }
        );
      }

      insertData.stock_ticker = ticker;
      insertData.quantity = shares;
      insertData.avg_buy_price = avg_cost;
      insertData.total_invested = shares * avg_cost;
      insertData.name = stock.name_ar || stock.name || ticker;
    }

    if (type === 'gold') {
      if (!weight_grams || !karat || !purchase_price_per_gram) {
        return NextResponse.json(
          { success: false, error: 'بيانات الذهب غير كاملة: weight_grams, karat, purchase_price_per_gram' },
          { status: 400 }
        );
      }

      insertData.weight_grams = weight_grams;
      insertData.karat = karat;
      insertData.purchase_price_per_gram = purchase_price_per_gram;
      insertData.total_invested = weight_grams * purchase_price_per_gram;
      insertData.name = name || `ذهب ${karat} عيار`;
    }

    if (type === 'certificate') {
      if (!bank_name || !total_invested) {
        return NextResponse.json(
          { success: false, error: 'بيانات الشهادة غير كاملة: bank_name, total_invested' },
          { status: 400 }
        );
      }

      insertData.bank_name = bank_name;
      insertData.interest_rate = interest_rate;
      insertData.certificate_duration_months = certificate_duration_months;
      insertData.certificate_return_rate = certificate_return_rate;
      insertData.certificate_maturity_date = certificate_maturity_date;
      insertData.current_value = total_invested;
      insertData.name = name || `شهادة استثمار - ${bank_name}`;
    }

    const sqliteDb = await getFinanceDb();
    ensurePortfolioAssetsTable(sqliteDb);

    // Insert into stocks.db
    sqliteDb.prepare(`
      INSERT INTO portfolio_assets (
        user_id, type, name, total_invested, current_value, notes,
        weight_grams, karat, purchase_price_per_gram,
        bank_name, interest_rate, certificate_duration_months, certificate_return_rate, certificate_maturity_date,
        stock_ticker, quantity, avg_buy_price,
        added_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        datetime('now'), datetime('now')
      )
    `).run(
      insertData.user_id, insertData.type, insertData.name, insertData.total_invested, insertData.current_value, insertData.notes || null,
      insertData.weight_grams || null, insertData.karat || null, insertData.purchase_price_per_gram || null,
      insertData.bank_name || null, insertData.interest_rate || null, insertData.certificate_duration_months || null, insertData.certificate_return_rate || null, insertData.certificate_maturity_date || null,
      insertData.stock_ticker || null, insertData.quantity || null, insertData.avg_buy_price || null
    );

    sqliteDb.save();

    return NextResponse.json({
      success: true,
      message: 'تم إضافة الأصل للمحفظة بنجاح',
      data: insertData,
    });

  } catch (error) {
    console.error('[POST /api/mobile/portfolio] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في إضافة الأصل', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mobile/portfolio?id=<asset_id>
 * Remove an asset from stocks.db
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserIdFromToken(request);

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', error_ar: 'يجب تسجيل الدخول' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('id');

    if (!assetId) {
      return NextResponse.json(
        { success: false, error: 'معرف الأصل مطلوب' },
        { status: 400 }
      );
    }

    const sqliteDb = await getFinanceDb();
    ensurePortfolioAssetsTable(sqliteDb);

    sqliteDb.prepare(`
      DELETE FROM portfolio_assets WHERE id = ? AND user_id = ?
    `).run(parseInt(assetId), userId);

    sqliteDb.save();

    return NextResponse.json({ success: true, message: 'تم حذف الأصل' });

  } catch (error) {
    console.error('[DELETE /api/mobile/portfolio] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في حذف الأصل', detail: String(error) },
      { status: 500 }
    );
  }
}

// Helper functions
function getStatus(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'heavy_loss';
  if (pnlPercent <= -5) return 'moderate_loss';
  if (pnlPercent < 0) return 'slight_loss';
  if (pnlPercent < 10) return 'slight_gain';
  if (pnlPercent < 25) return 'moderate_gain';
  return 'heavy_gain';
}

function getStatusAr(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'خسارة كبيرة';
  if (pnlPercent <= -5) return 'خسارة متوسطة';
  if (pnlPercent < 0) return 'تحت التكلفة';
  if (pnlPercent < 10) return 'ربح بسيط';
  if (pnlPercent < 25) return 'ربح جيد';
  return 'ربح كبير';
}
ENDOFFILE
echo "✓ Created /api/mobile/portfolio/route.ts"

echo ""
echo "=============================================="
echo "✅ All Mobile APIs created successfully!"
echo "=============================================="
echo ""
echo "Created endpoints:"
echo "  - GET /api/mobile/market/overview"
echo "  - GET /api/mobile/predictions"
echo "  - GET /api/mobile/crypto"
echo "  - GET /api/mobile/auth/me"
echo "  - GET /api/mobile/recommendations"
echo "  - GET /api/mobile/market/recommendations/ai-insights"
echo "  - GET /api/mobile/watchlist-enhanced"
echo "  - GET/POST/DELETE /api/mobile/portfolio"
echo ""
echo "Next step: Restart PM2"
echo "  pm2 restart nextjs-frontend"
echo ""

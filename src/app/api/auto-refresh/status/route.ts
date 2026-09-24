export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'

const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:5000'
const DATA_ENGINE_VERSION = '2.1.0'

export async function GET() {
  try {
    // Try to get status from Python data engine
    const response = await fetch(`${DATA_ENGINE_URL}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })
    
    if (response.ok) {
      const data = await response.json()
      
      // Transform to expected format
      return NextResponse.json({
        running: data.engine?.scheduler_active || false,
        interval: 300, // 5 minutes
        next_run: null,
        started_at: data.engine?.last_stocks_update,
        tasks: {
          stocks: {
            script: 'tradingview_scraper.py',
            name: 'سحب الأسهم',
            last_run: data.engine?.last_stocks_update,
            status: data.engine?.last_stocks_update ? 'success' : 'pending',
            count: data.db_stats?.data_engine?.stocks || 0
          },
          crypto: {
            script: 'crypto_fetcher.py',
            name: 'العملات الرقمية',
            last_run: data.engine?.last_crypto_update,
            status: data.engine?.last_crypto_update ? 'success' : 'pending',
            count: data.db_stats?.data_engine?.crypto || 0
          },
          metals_forex: {
            script: 'metals_forex_fetcher.py',
            name: 'الذهب والعملات',
            last_run: data.engine?.last_metals_update,
            status: data.engine?.last_metals_update ? 'success' : 'pending',
            count: (data.db_stats?.data_engine?.gold || 0)
          }
        },
        last_run: data.engine?.last_sync || data.engine?.last_stocks_update,
        logs: data.engine?.logs || [],
        errors: data.engine?.errors || [],
        db_stats: data.db_stats,
        version: DATA_ENGINE_VERSION,
        source: 'python_data_engine'
      })
    }
    
    // Fallback if Python engine not available
    return NextResponse.json({
      running: false,
      interval: 300,
      next_run: null,
      tasks: {},
      logs: ['⚠️ Python Data Engine غير متاح - تأكد من تشغيله على بورت 5000'],
      version: DATA_ENGINE_VERSION,
      source: 'fallback',
      error: 'Cannot connect to Python Data Engine'
    })
    
  } catch (error) {
    return NextResponse.json({
      running: false,
      interval: 300,
      next_run: null,
      tasks: {},
      logs: ['⚠️ Python Data Engine غير متاح - تأكد من تشغيله على بورت 5000'],
      version: DATA_ENGINE_VERSION,
      source: 'error',
      error: String(error)
    })
  }
}

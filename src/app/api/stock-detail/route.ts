import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db')

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
  }

  try {
    const db = new Database(DB_PATH, { readonly: true })

    // Get basic stock info
    const stock = db.prepare(`
      SELECT * FROM stocks WHERE symbol = ?
    `).get(symbol) as Record<string, unknown> | undefined

    if (!stock) {
      db.close()
      return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    }

    // Get all tab data
    const tabTables = [
      'tab_performance',
      'tab_valuation',
      'tab_dividends',
      'tab_profitability',
      'tab_income_statement',
      'tab_balance_sheet',
      'tab_cash_flow',
      'tab_technical_analysis'
    ]

    const tabData: Record<string, unknown> = {}
    
    for (const table of tabTables) {
      try {
        const data = db.prepare(`SELECT * FROM "${table}" WHERE symbol = ?`).get(symbol)
        tabData[table] = data || null
      } catch {
        tabData[table] = null
      }
    }

    // Get historical data (last 30 records)
    const historical = db.prepare(`
      SELECT date, open, high, low, close, volume 
      FROM historical_data 
      WHERE symbol = ? 
      ORDER BY date DESC 
      LIMIT 30
    `).all(symbol) as unknown[]

    // Get related news
    const news = db.prepare(`
      SELECT * FROM market_news 
      WHERE market = ? 
      ORDER BY fetched_at DESC 
      LIMIT 5
    `).all((stock as Record<string, unknown>).market as string) as unknown[]

    db.close()

    return NextResponse.json({
      stock,
      tabs: tabData,
      historical,
      news
    })

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

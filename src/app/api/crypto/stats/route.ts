import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db')

export async function GET() {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: false })
    
    const rows = db.prepare('SELECT * FROM crypto_prices ORDER BY market_cap_rank LIMIT 20').all() as any[]

    const topCryptos = rows.map(row => ({
      symbol: row.symbol,
      name: row.name,
      current_price: row.current_price,
      price_change_percent_24h: row.price_change_percent_24h,
      market_cap: row.market_cap,
      market_cap_rank: row.market_cap_rank
    }))

    const totalMarketCap = rows.reduce((sum, r) => sum + (r.market_cap || 0), 0)
    
    db.close()
    return NextResponse.json({ 
      totalCryptos: rows.length, 
      topCryptos, 
      stats: { totalMarketCap, avgChange: 0 } 
    })
  } catch {
    return NextResponse.json({ totalCryptos: 0, topCryptos: [], stats: {} })
  }
}

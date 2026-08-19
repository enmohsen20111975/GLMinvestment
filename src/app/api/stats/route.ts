import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'db', 'data_engine.db')

export async function GET() {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: false })
    
    const rows = db.prepare('SELECT market, COUNT(*) as count FROM stocks GROUP BY market').all() as any[]
    
    const expectedStocks: Record<string, number> = {
      'مصر': 300, 'السعودية': 400, 'الكويت': 150, 'قطر': 60
    }

    const markets: Record<string, { count: number; percent: number }> = {}
    let totalStocks = 0

    rows.forEach(row => {
      const expected = expectedStocks[row.market] || 100
      markets[row.market] = {
        count: row.count,
        percent: Math.round((row.count / expected) * 100)
      }
      totalStocks += row.count
    })

    db.close()
    return NextResponse.json({ totalStocks, markets, stats: {} })
  } catch {
    return NextResponse.json({ totalStocks: 0, markets: {}, stats: {} })
  }
}

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const statusFile = path.join(process.cwd(), 'data', 'scraper_status.json')
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf-8')
      return NextResponse.json(JSON.parse(content))
    }
    return NextResponse.json({ running: false, currentMarket: '', progress: {}, logs: [] })
  } catch {
    return NextResponse.json({ running: false, currentMarket: '', progress: {}, logs: [] })
  }
}

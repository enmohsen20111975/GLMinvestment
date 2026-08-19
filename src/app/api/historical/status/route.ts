import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'historical_status.json')

export async function GET() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      return NextResponse.json(status)
    }
    return NextResponse.json({
      running: false,
      progress: { current: 0, total: 0, symbol: '' },
      logs: [],
      results: []
    })
  } catch {
    return NextResponse.json({
      running: false,
      progress: { current: 0, total: 0, symbol: '' },
      logs: [],
      results: []
    })
  }
}

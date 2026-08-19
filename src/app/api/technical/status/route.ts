import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'technical_status.json')

interface TechnicalResult {
  ticker: string
  market: string
  price: number
  rsi: number | null
  macd: number | null
  recommendation: string
}

interface TechnicalStatus {
  running: boolean
  progress: { market: string; current: number; total: number }
  logs: string[]
  results: TechnicalResult[]
  startTime: string | null
}

const defaultStatus: TechnicalStatus = {
  running: false,
  progress: { market: '', current: 0, total: 0 },
  logs: [],
  results: [],
  startTime: null
}

export async function GET() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = fs.readFileSync(STATUS_FILE, 'utf-8')
      const status = JSON.parse(data)
      return NextResponse.json(status)
    }
    return NextResponse.json(defaultStatus)
  } catch (error) {
    return NextResponse.json(defaultStatus)
  }
}

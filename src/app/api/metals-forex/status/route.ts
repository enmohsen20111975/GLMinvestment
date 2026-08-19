import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

type MetalsForexStatus = {
  running: boolean
  progress: { current: number; total: number }
  logs: string[]
  results: {
    metals: Array<{
      symbol: string
      name: string
      price_usd: number
    }>
    currencies: {
      arab: Array<{
        code: string
        name: string
        rate_to_usd: number
      }>
    }
    last_update: string | null
  }
}

function getStatusFilePath(): string {
  return path.join(process.cwd(), 'data', 'metals_forex_status.json')
}

function getDataFilePath(): string {
  return path.join(process.cwd(), 'data-engine', 'data', 'metals_forex_latest.json')
}

export async function GET() {
  try {
    // Try to read latest data
    const dataFile = getDataFilePath()
    let results = {
      metals: [],
      currencies: { arab: [], major: [] },
      last_update: null
    }
    
    if (fs.existsSync(dataFile)) {
      const content = fs.readFileSync(dataFile, 'utf-8')
      results = JSON.parse(content)
    }
    
    // Try to read status
    const statusFile = getStatusFilePath()
    let status: MetalsForexStatus = {
      running: false,
      progress: { current: 0, total: 0 },
      logs: [],
      results: results
    }
    
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf-8')
      const savedStatus = JSON.parse(content)
      status = { ...status, ...savedStatus, results }
    }
    
    return NextResponse.json(status)
    
  } catch (error) {
    console.error('Failed to read metals/forex status:', error)
    return NextResponse.json({
      running: false,
      progress: { current: 0, total: 0 },
      logs: [],
      results: {
        metals: [],
        currencies: { arab: [], major: [] },
        last_update: null
      }
    })
  }
}

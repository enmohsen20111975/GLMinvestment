import { NextResponse } from 'next/server'
export const dynamic = "force-dynamic";

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'historical_status.json')
const FETCHER_SCRIPT = path.join(process.cwd(), 'data-engine', 'scrapers', 'historical_fetcher.py')

function updateStatus(data: any) {
  try {
    const dir = path.dirname(STATUS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    
    let current = {}
    if (fs.existsSync(STATUS_FILE)) {
      try { current = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) } catch {}
    }
    
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...current, ...data }, null, 2))
  } catch (error) {
    console.error('Error updating status:', error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const period = body.period || '1y'
    
    // Check if already running
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      if (status.running) {
        return NextResponse.json({ 
          success: false, 
          message: 'Historical fetch already running' 
        })
      }
    }
    
    // Check script
    if (!fs.existsSync(FETCHER_SCRIPT)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Historical fetcher script not found' 
      })
    }
    
    // Initialize status
    updateStatus({
      running: true,
      progress: { current: 0, total: 0, symbol: '' },
      logs: [' بدء سحب البيانات التاريخية...'],
      results: []
    })
    
    // Run Python script
    const proc = spawn('python3', [FETCHER_SCRIPT, period], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    proc.stdout?.on('data', (data) => {
      console.log('[Historical]', data.toString())
    })
    
    proc.stderr?.on('data', (data) => {
      console.error('[Historical Error]', data.toString())
    })
    
    proc.on('close', (code) => {
      updateStatus({ running: false })
      console.log('[Historical] Exited with code:', code)
    })
    
    proc.unref()
    
    return NextResponse.json({
      success: true,
      message: 'Historical data fetch started',
      period
    })
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}

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

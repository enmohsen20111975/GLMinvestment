import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'technical_status.json')
const FETCHER_SCRIPT = path.join(process.cwd(), 'data-engine', 'scrapers', 'technical_fetcher.py')

interface TechnicalStatus {
  running: boolean
  progress: { market: string; current: number; total: number }
  logs: string[]
  results: Array<{
    ticker: string
    market: string
    price: number
    rsi: number | null
    macd: number | null
    recommendation: string
  }>
  startTime: string | null
}

function updateStatus(status: Partial<TechnicalStatus>) {
  const currentStatus: TechnicalStatus = {
    running: false,
    progress: { market: '', current: 0, total: 0 },
    logs: [],
    results: [],
    startTime: null,
    ...(fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) : {}),
    ...status
  }
  
  // Keep only last 100 logs
  if (currentStatus.logs.length > 100) {
    currentStatus.logs = currentStatus.logs.slice(-100)
  }
  
  fs.writeFileSync(STATUS_FILE, JSON.stringify(currentStatus, null, 2))
}

export async function POST() {
  try {
    // Check if already running
    if (fs.existsSync(STATUS_FILE)) {
      const currentStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      if (currentStatus.running) {
        return NextResponse.json({ 
          success: false, 
          message: 'Technical analysis already running' 
        })
      }
    }

    // Check if script exists
    if (!fs.existsSync(FETCHER_SCRIPT)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Technical fetcher script not found' 
      })
    }

    // Update status to running
    updateStatus({
      running: true,
      progress: { market: '', current: 0, total: 0 },
      logs: ['[START] Starting Technical Analysis with TradingView TA...'],
      startTime: new Date().toISOString()
    })

    // Spawn Python process
    const pythonProcess = spawn('python3', [FETCHER_SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env }
    })

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString()
      try {
        const parsed = JSON.parse(output)
        if (parsed.type === 'progress') {
          updateStatus({
            progress: parsed.progress,
            logs: [`[PROGRESS] ${parsed.progress.market}: ${parsed.progress.current}/${parsed.progress.total}`]
          })
        } else if (parsed.type === 'result') {
          const currentStatus = fs.existsSync(STATUS_FILE) 
            ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
            : { results: [], logs: [] }
          
          updateStatus({
            results: [...(currentStatus.results || []), parsed.result],
            logs: [`[RESULT] ${parsed.result.ticker}: ${parsed.result.recommendation}`]
          })
        } else if (parsed.type === 'log') {
          updateStatus({ logs: [parsed.message] })
        }
      } catch {
        // Plain log message
        updateStatus({ logs: [`[INFO] ${output.trim()}`] })
      }
    })

    pythonProcess.stderr.on('data', (data) => {
      updateStatus({ logs: [`[ERROR] ${data.toString().trim()}`] })
    })

    pythonProcess.on('close', (code) => {
      updateStatus({
        running: false,
        logs: [`[END] Process finished with code ${code}`]
      })
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Technical analysis started' 
    })
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 })
  }
}

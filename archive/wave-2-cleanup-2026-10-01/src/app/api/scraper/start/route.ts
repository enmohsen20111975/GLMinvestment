export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'scraper_status.json')
const SCRAPER_SCRIPT = path.join(process.cwd(), 'data_engine', 'scrapers', 'tradingview_scraper.py')

interface ScraperStatus {
  running: boolean
  startTime: string | null
  currentMarket: string
  progress: Record<string, { stocks: number; status: string }>
  logs: string[]
}

function getStatus(): ScraperStatus {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const content = fs.readFileSync(STATUS_FILE, 'utf-8')
      if (content.trim()) {
        return JSON.parse(content)
      }
    }
  } catch (error) {
    console.error('Error reading status:', error)
  }
  return {
    running: false,
    startTime: null,
    currentMarket: '',
    progress: {},
    logs: []
  }
}

function updateStatus(status: Partial<ScraperStatus>) {
  const currentStatus = {
    ...getStatus(),
    ...status
  }
  
  if (currentStatus.logs.length > 100) {
    currentStatus.logs = currentStatus.logs.slice(-100)
  }
  
  try {
    const dir = path.dirname(STATUS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(STATUS_FILE, JSON.stringify(currentStatus, null, 2))
  } catch (error) {
    console.error('Error writing status:', error)
  }
}

export async function POST() {
  try {
    // Check if already running
    const currentStatus = getStatus()
    if (currentStatus.running) {
      return NextResponse.json({ 
        success: false, 
        message: 'Scraper already running' 
      })
    }

    // Check if script exists
    if (!fs.existsSync(SCRAPER_SCRIPT)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Scraper script not found' 
      })
    }

    // Update status to running
    updateStatus({
      running: true,
      startTime: new Date().toISOString(),
      currentMarket: '',
      progress: {},
      logs: ['[START] Starting TradingView Scraper...']
    })

    // Spawn Python process
    const pythonProcess = spawn('python3', [SCRAPER_SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env }
    })

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString()
      try {
        const parsed = JSON.parse(output)
        if (parsed.type === 'progress') {
          const existingStatus = getStatus()
          updateStatus({
            currentMarket: parsed.market,
            progress: {
              ...existingStatus.progress,
              [parsed.market]: { stocks: parsed.count, status: parsed.status }
            },
            logs: [`[PROGRESS] ${parsed.market}: ${parsed.count} stocks`]
          })
        } else if (parsed.type === 'log') {
          updateStatus({ logs: [parsed.message] })
        }
      } catch {
        updateStatus({ logs: [`[INFO] ${output.trim()}`] })
      }
    })

    pythonProcess.stderr.on('data', (data) => {
      updateStatus({ logs: [`[ERROR] ${data.toString().trim()}`] })
    })

    pythonProcess.on('close', (code) => {
      updateStatus({
        running: false,
        logs: [`[END] Scraper finished with code ${code}`]
      })
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Scraper started' 
    })
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 })
  }
}

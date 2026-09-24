export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.join(process.cwd(), 'data')
const SCRIPTS_DIR = path.join(process.cwd(), 'data-engine', 'scrapers')

function updateStatus(filename: string, data: any) {
  const filePath = path.join(DATA_DIR, filename)
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    
    let current = {}
    if (fs.existsSync(filePath)) {
      try {
        current = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      } catch {}
    }
    
    const updated = { ...current, ...data, lastUpdate: new Date().toISOString() }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2))
  } catch (error) {
    console.error(`Error updating ${filename}:`, error)
  }
}

function runScript(scriptName: string, statusFile: string) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  
  if (!fs.existsSync(scriptPath)) {
    updateStatus(statusFile, { running: false, error: 'Script not found' })
    return null
  }
  
  const proc = spawn('python3', [scriptPath], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  
  proc.stdout?.on('data', (data) => {
    const output = data.toString()
    console.log(`[${scriptName}]`, output)
  })
  
  proc.stderr?.on('data', (data) => {
    console.error(`[${scriptName} ERROR]`, data.toString())
  })
  
  proc.on('close', (code) => {
    console.log(`[${scriptName}] Exited with code ${code}`)
  })
  
  proc.unref()
  return proc
}

export async function POST() {
  try {
    // Initialize all statuses
    updateStatus('metals_forex_status.json', {
      running: true,
      progress: { current: 0, total: 3 },
      logs: [' بدء سحب الذهب والعملات...']
    })
    
    updateStatus('crypto_status.json', {
      running: true,
      progress: { current: 0, total: 60 },
      logs: [' بدء سحب العملات الرقمية...']
    })
    
    updateStatus('scraper_status.json', {
      running: true,
      currentMarket: '',
      progress: {},
      logs: [' بدء سحب الأسهم...']
    })
    
    // Run all scripts in parallel
    runScript('metals_forex_fetcher.py', 'metals_forex_status.json')
    runScript('crypto_fetcher.py', 'crypto_status.json')
    runScript('tradingview_scraper.py', 'scraper_status.json')
    
    return NextResponse.json({
      success: true,
      message: 'All tasks started in background',
      tasks: [
        { name: 'metals_forex', status: 'running', script: 'metals_forex_fetcher.py' },
        { name: 'crypto', status: 'running', script: 'crypto_fetcher.py' },
        { name: 'stocks', status: 'running', script: 'tradingview_scraper.py' }
      ]
    })
    
  } catch (error) {
    console.error('Run-all error:', error)
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}

export async function GET() {
  try {
    const statuses: any = {}
    
    // Read all status files
    const files = [
      { name: 'metals_forex', file: 'metals_forex_status.json' },
      { name: 'crypto', file: 'crypto_status.json' },
      { name: 'stocks', file: 'scraper_status.json' }
    ]
    
    for (const { name, file } of files) {
      const filePath = path.join(DATA_DIR, file)
      if (fs.existsSync(filePath)) {
        try {
          statuses[name] = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        } catch {
          statuses[name] = { running: false }
        }
      } else {
        statuses[name] = { running: false }
      }
    }
    
    // Check if any task is running
    const anyRunning = Object.values(statuses).some((s: any) => s.running)
    
    return NextResponse.json({
      running: anyRunning,
      tasks: statuses
    })
    
  } catch (error) {
    return NextResponse.json({
      running: false,
      error: String(error)
    })
  }
}

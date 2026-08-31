import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

declare global {
  var metalsForexProcess: ReturnType<typeof spawn> | null
}

function getStatusFilePath(): string {
  return path.join(process.cwd(), 'data', 'metals_forex_status.json')
}

function saveStatus(status: any): void {
  try {
    const dataDir = path.join(process.cwd(), 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(getStatusFilePath(), JSON.stringify(status, null, 2))
  } catch (error) {
    console.error('Failed to save status:', error)
  }
}

export async function POST() {
  try {
    // Initialize status
    const newStatus = {
      running: true,
      progress: { current: 0, total: 20 },
      logs: [' بدء سحب بيانات الذهب والعملات...'],
      results: null
    }
    saveStatus(newStatus)

    // Run Python script
    const scriptPath = path.join(process.cwd(), 'data-engine', 'scrapers', 'metals_forex_fetcher.py')
    
    const proc = spawn('python3', [scriptPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.join(process.cwd(), 'data-engine', 'scrapers')
    })

    global.metalsForexProcess = proc

    // Handle output
    proc.stdout?.on('data', (data) => {
      const output = data.toString()
      console.log('[Metals/Forex]', output)
      
      const statusPath = getStatusFilePath()
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
        
        if (output.trim()) {
          status.logs.push(`[${new Date().toLocaleTimeString('ar-EG')}] ${output.trim()}`)
          if (status.logs.length > 100) {
            status.logs = status.logs.slice(-100)
          }
        }
        
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
      }
    })

    proc.stderr?.on('data', (data) => {
      console.error('[Metals/Forex Error]', data.toString())
    })

    proc.on('close', (code) => {
      console.log('[Metals/Forex] Exited with code:', code)
      const statusPath = getStatusFilePath()
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
        status.running = false
        status.logs.push(`✅ انتهى السحب`)
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
      }
    })

    proc.unref()

    return NextResponse.json({
      success: true,
      message: 'Metals & Forex fetcher started',
      status: newStatus
    })

  } catch (error) {
    console.error('Failed to start metals/forex fetcher:', error)
    return NextResponse.json({
      error: 'Failed to start',
      details: String(error)
    }, { status: 500 })
  }
}

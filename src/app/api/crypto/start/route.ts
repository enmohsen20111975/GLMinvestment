export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const STATUS_FILE = path.join(process.cwd(), 'data', 'crypto_status.json')
const FETCHER_SCRIPT = path.join(process.cwd(), 'data-engine', 'scrapers', 'crypto_fetcher.py')

interface CryptoStatus {
  running: boolean
  progress: { current: number; total: number; currentCoin: string }
  logs: string[]
}

function getStatus(): CryptoStatus {
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
    progress: { current: 0, total: 0, currentCoin: '' },
    logs: []
  }
}

function updateStatus(status: Partial<CryptoStatus>) {
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
        message: 'Crypto fetcher already running' 
      })
    }

    // Check if script exists
    if (!fs.existsSync(FETCHER_SCRIPT)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Crypto fetcher script not found' 
      })
    }

    // Update status
    updateStatus({
      running: true,
      progress: { current: 0, total: 0, currentCoin: '' },
      logs: ['[START] Starting Crypto Fetcher...']
    })

    // Spawn Python process
    const pythonProcess = spawn('python3', [FETCHER_SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env },
      detached: true, // عشان نقدر نـ kill الـ process tree
    })

    // احفظ الـ PID عشان نقدر نوقفه بعدين في /api/crypto/stop
    updateStatus({ pid: pythonProcess.pid })

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString()
      updateStatus({ logs: [`[INFO] ${output.trim()}`] })
    })

    pythonProcess.stderr.on('data', (data) => {
      updateStatus({ logs: [`[ERROR] ${data.toString().trim()}`] })
    })

    pythonProcess.on('close', (code) => {
      updateStatus({
        running: false,
        pid: undefined,
        logs: [`[END] Crypto fetcher finished with code ${code}`]
      })
    })

    return NextResponse.json({
      success: true,
      message: 'Crypto fetcher started',
      pid: pythonProcess.pid,
    })
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 })
  }
}

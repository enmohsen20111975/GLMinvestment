import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const STATUS_FILE = path.join(process.cwd(), 'data', 'auto_refresh_status.json')
const SCHEDULER_SCRIPT = path.join(process.cwd(), 'data-engine', 'scrapers', 'auto_refresh_scheduler.py')

declare global {
  var schedulerProcess: ReturnType<typeof spawn> | null
}

export async function POST() {
  try {
    // Check if already running
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      if (status.running) {
        return NextResponse.json({ 
          success: false, 
          message: 'Auto refresh already running' 
        })
      }
    }
    
    // Check script
    if (!fs.existsSync(SCHEDULER_SCRIPT)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Scheduler script not found' 
      })
    }
    
    // Run scheduler
    const proc = spawn('python3', [SCHEDULER_SCRIPT], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    global.schedulerProcess = proc
    
    proc.stdout?.on('data', (data) => {
      console.log('[Scheduler]', data.toString())
    })
    
    proc.stderr?.on('data', (data) => {
      console.error('[Scheduler Error]', data.toString())
    })
    
    proc.on('close', (code) => {
      console.log('[Scheduler] Exited with code:', code)
      global.schedulerProcess = null
    })
    
    proc.unref()
    
    return NextResponse.json({
      success: true,
      message: 'Auto refresh scheduler started',
      interval: '10 minutes'
    })
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}

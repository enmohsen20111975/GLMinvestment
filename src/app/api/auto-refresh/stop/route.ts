export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const STATUS_FILE = path.join(process.cwd(), 'data-engine', 'data', 'auto_refresh_status.json')

export async function POST() {
  try {
    // Kill scheduler process
    try {
      await execAsync('pkill -f auto_refresh_scheduler.py')
    } catch {}
    
    // Update status
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        ...status,
        running: false,
        logs: [...(status.logs || []), '[STOP] Scheduler stopped by user']
      }, null, 2))
    }
    
    return NextResponse.json({
      success: true,
      message: 'Auto refresh scheduler stopped'
    })
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 })
  }
}

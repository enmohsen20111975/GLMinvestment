import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const STATUS_FILE = path.join(process.cwd(), 'data', 'technical_status.json')

export async function POST() {
  try {
    // Kill any running technical fetcher processes
    try {
      await execAsync('pkill -f technical_fetcher.py')
    } catch {
      // Process might not be running
    }

    // Update status
    if (fs.existsSync(STATUS_FILE)) {
      const currentStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        ...currentStatus,
        running: false,
        logs: [...currentStatus.logs, '[STOP] Technical analysis stopped by user']
      }, null, 2))
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Technical analysis stopped' 
    })
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 })
  }
}

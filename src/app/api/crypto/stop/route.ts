import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

const STATUS_FILE = path.join(process.cwd(), 'data', 'crypto_status.json')

interface CryptoStatus {
  running: boolean
  progress: { current: number; total: number; currentCoin: string }
  logs: string[]
  pid?: number
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
    const currentStatus = getStatus()

    if (!currentStatus.running) {
      return NextResponse.json({
        success: true,
        message: 'Crypto fetcher was not running',
        was_running: false,
      })
    }

    // لو عندنا PID، حاول تنهي العملية
    let killed = false
    if (currentStatus.pid) {
      try {
        process.kill(currentStatus.pid, 'SIGTERM')
        killed = true
      } catch (e) {
        // العملية ممكن تكون خلصت أصلاً
        killed = false
      }
    }

    // حدّث الـ status لـ not running
    updateStatus({
      running: false,
      pid: undefined,
      logs: [
        ...currentStatus.logs,
        `[STOP] Crypto fetcher stopped${killed ? ` (PID ${currentStatus.pid} killed)` : ' (no PID)'}`,
      ],
    })

    return NextResponse.json({
      success: true,
      message: 'Crypto fetcher stopped',
      was_running: true,
      process_killed: killed,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Failed to stop crypto fetcher',
      },
      { status: 500 }
    )
  }
}

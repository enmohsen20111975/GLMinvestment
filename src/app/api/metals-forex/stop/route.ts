import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

declare global {
  var metalsForexProcess: ReturnType<typeof import('child_process').spawn> | null
}

function getStatusFilePath(): string {
  return path.join(process.cwd(), 'data', 'metals_forex_status.json')
}

export async function POST() {
  try {
    if (global.metalsForexProcess) {
      global.metalsForexProcess.kill('SIGTERM')
      global.metalsForexProcess = null
    }

    const statusFile = getStatusFilePath()
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'))
      status.running = false
      status.logs.push('⏹️ تم الإيقاف يدوياً')
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2))
    }

    return NextResponse.json({ success: true, message: 'Stopped' })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

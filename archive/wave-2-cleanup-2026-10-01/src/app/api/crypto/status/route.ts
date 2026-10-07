export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const statusFile = path.join(process.cwd(), 'data', 'crypto_status.json')
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf-8')
      return NextResponse.json(JSON.parse(content))
    }
    return NextResponse.json({ running: false, progress: {}, logs: [] })
  } catch {
    return NextResponse.json({ running: false, progress: {}, logs: [] })
  }
}

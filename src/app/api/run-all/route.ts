export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.* calls with async fs/promises
// equivalents in updateStatus / runScript / GET handler so the event loop is
// never blocked on status JSON reads/writes.
import { access, mkdir, readFile, writeFile } from 'fs/promises'

const DATA_DIR = path.join(process.cwd(), 'data')
const SCRIPTS_DIR = path.join(process.cwd(), 'data-engine', 'scrapers')

// P0-14-ASYNC fix (2026-09-27): updateStatus is now async.
async function updateStatus(filename: string, data: any): Promise<void> {
  const filePath = path.join(DATA_DIR, filename)
  try {
    try {
      await access(DATA_DIR);
    } catch {
      await mkdir(DATA_DIR, { recursive: true });
    }

    let current = {}
    try {
      await access(filePath);
      const raw = await readFile(filePath, 'utf-8');
      current = JSON.parse(raw);
    } catch {}

    const updated = { ...current, ...data, lastUpdate: new Date().toISOString() }
    await writeFile(filePath, JSON.stringify(updated, null, 2))
  } catch (error) {
    console.error(`Error updating ${filename}:`, error)
  }
}

// P0-14-ASYNC fix (2026-09-27): runScript is now async (calls updateStatus).
async function runScript(scriptName: string, statusFile: string): Promise<any> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)

  try {
    await access(scriptPath);
  } catch {
    await updateStatus(statusFile, { running: false, error: 'Script not found' })
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
    await updateStatus('metals_forex_status.json', {
      running: true,
      progress: { current: 0, total: 3 },
      logs: [' بدء سحب الذهب والعملات...']
    })

    await updateStatus('crypto_status.json', {
      running: true,
      progress: { current: 0, total: 60 },
      logs: [' بدء سحب العملات الرقمية...']
    })

    await updateStatus('scraper_status.json', {
      running: true,
      currentMarket: '',
      progress: {},
      logs: [' بدء سحب الأسهم...']
    })

    // Run all scripts in parallel
    await runScript('metals_forex_fetcher.py', 'metals_forex_status.json')
    await runScript('crypto_fetcher.py', 'crypto_status.json')
    await runScript('tradingview_scraper.py', 'scraper_status.json')
    
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
      try {
        await access(filePath);
        try {
          const raw = await readFile(filePath, 'utf-8');
          statuses[name] = JSON.parse(raw);
        } catch {
          statuses[name] = { running: false };
        }
      } catch {
        statuses[name] = { running: false };
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

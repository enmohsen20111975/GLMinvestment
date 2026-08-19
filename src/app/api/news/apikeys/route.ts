import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import path from 'path'

const NEWS_DB = path.join(process.cwd(), 'db', 'stocks.db')  // Consolidated July 2026

// GET - Fetch all API keys
export async function GET() {
  try {
    const db = new Database(NEWS_DB, { readonly: true, fileMustExist: false })
    
    let keys = []
    try {
      const rows = db.prepare(`
        SELECT id, service, api_key, api_url, dashboard_url, is_active, 
               daily_limit, daily_used, last_used, last_error, status
        FROM news_api_keys
        ORDER BY service ASC
      `).all() as any[]
      
      keys = rows.map(row => ({
        id: row.id?.toString() || '',
        service: row.service,
        api_key: row.api_key,
        api_url: row.api_url,
        dashboard_url: row.dashboard_url,
        is_active: row.is_active === 1,
        daily_limit: row.daily_limit,
        daily_used: row.daily_used || 0,
        last_used: row.last_used,
        last_error: row.last_error,
        status: row.status
      }))
    } catch (e) {
      console.log('Table might not exist yet:', e)
    }
    
    db.close()
    
    return NextResponse.json({
      success: true,
      keys
    })
  } catch (error) {
    console.error('Error fetching API keys:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch API keys',
      keys: []
    })
  }
}

// POST - Create or update API key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { service, api_key, api_url, dashboard_url, is_active, daily_limit } = body
    
    if (!service || !api_key) {
      return NextResponse.json({
        success: false,
        error: 'Service and API key are required'
      }, { status: 400 })
    }
    
    const db = new Database(NEWS_DB)
    
    // Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS news_api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT UNIQUE,
        api_key TEXT,
        api_url TEXT,
        dashboard_url TEXT,
        is_active INTEGER DEFAULT 1,
        daily_limit INTEGER,
        daily_used INTEGER DEFAULT 0,
        last_used TEXT,
        last_error TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Upsert
    const existing = db.prepare('SELECT id FROM news_api_keys WHERE service = ?').get(service)
    
    if (existing) {
      db.prepare(`
        UPDATE news_api_keys SET
          api_key = ?,
          api_url = ?,
          dashboard_url = ?,
          is_active = ?,
          daily_limit = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE service = ?
      `).run(
        api_key,
        api_url || null,
        dashboard_url || null,
        is_active !== false ? 1 : 0,
        daily_limit || null,
        service
      )
    } else {
      db.prepare(`
        INSERT INTO news_api_keys (service, api_key, api_url, dashboard_url, is_active, daily_limit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        service,
        api_key,
        api_url || null,
        dashboard_url || null,
        is_active !== false ? 1 : 0,
        daily_limit || null
      )
    }
    
    db.close()
    
    return NextResponse.json({
      success: true,
      message: 'API key saved'
    })
  } catch (error) {
    console.error('Error saving API key:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to save API key'
    }, { status: 500 })
  }
}

// DELETE - Delete API key
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const service = searchParams.get('service')
    
    if (!service) {
      return NextResponse.json({
        success: false,
        error: 'Service name is required'
      }, { status: 400 })
    }
    
    const db = new Database(NEWS_DB)
    db.prepare('DELETE FROM news_api_keys WHERE service = ?').run(service)
    db.close()
    
    return NextResponse.json({
      success: true
    })
  } catch (error) {
    console.error('Error deleting API key:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete API key'
    }, { status: 500 })
  }
}

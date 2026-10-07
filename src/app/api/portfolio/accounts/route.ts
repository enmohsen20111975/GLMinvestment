import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

export const dynamic = 'force-dynamic';

function ensurePortfoliosTable(db: any) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      broker TEXT DEFAULT 'manual',
      market TEXT DEFAULT 'EGX',
      currency TEXT DEFAULT 'EGP',
      color TEXT DEFAULT 'blue',
      is_master INTEGER DEFAULT 0,
      initial_capital REAL DEFAULT 100000,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  try { db.prepare("ALTER TABLE portfolios ADD COLUMN color TEXT DEFAULT 'blue'").run(); } catch {}
  try { db.prepare("ALTER TABLE portfolio_assets ADD COLUMN portfolio_id TEXT DEFAULT 'default'").run(); } catch {}
}

function ensureMasterPortfolio(db: any, userId: string) {
  const master = db.prepare("SELECT id FROM portfolios WHERE (user_id = ? OR user_id = 'default') AND is_master = 1 LIMIT 1").get(userId) as any;
  if (master) return master.id;
  const res = db.prepare(`
    INSERT INTO portfolios (user_id, name, broker, market, currency, color, is_master, initial_capital)
    VALUES (?, 'المحفظة الأم', 'master', 'EGX', 'EGP', 'emerald', 1, 100000)
  `).run(userId);
  return res.lastInsertRowid;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id') || '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd';
    const db = await getFinanceDb();
    ensurePortfoliosTable(db);
    const masterId = ensureMasterPortfolio(db, userId);

    const rows = db.prepare("SELECT * FROM portfolios WHERE user_id = ? OR user_id = 'default' ORDER BY is_master DESC, id ASC").all(userId) as any[];
    const portfolios = rows.map(r => ({ ...r, is_master: Boolean(r.is_master) }));

    return NextResponse.json({
      success: true,
      user_id: userId,
      master_portfolio_id: masterId,
      count: portfolios.length,
      portfolios,
    });
  } catch (e) {
    console.error('[GET /api/portfolio/accounts] Error:', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await getFinanceDb();
    ensurePortfoliosTable(db);

    const body = await req.json();
    const userId = body.user_id || '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd';
    const action = body.action || 'create';

    ensureMasterPortfolio(db, userId);

    if (action === 'delete') {
      const pid = body.portfolio_id;
      if (!pid) return NextResponse.json({ success: false, error: 'portfolio_id missing' }, { status: 400 });
      db.prepare("DELETE FROM portfolios WHERE id = ? AND is_master = 0").run(pid);
      return NextResponse.json({ success: true, message: 'Portfolio deleted' });
    }

    if (action === 'update') {
      const pid = body.portfolio_id;
      const { name, broker, market, currency, color, initial_capital } = body;
      if (!pid || !name) return NextResponse.json({ success: false, error: 'Invalid parameters' }, { status: 400 });
      db.prepare(`
        UPDATE portfolios
        SET name = ?, broker = ?, market = ?, currency = ?, color = ?, initial_capital = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(name, broker || 'manual', market || 'EGX', currency || 'EGP', color || 'blue', Number(initial_capital) || 0, pid);
      return NextResponse.json({ success: true, message: 'Portfolio updated' });
    }

    // create
    const { name, broker, market, currency, color, initial_capital } = body;
    if (!name) return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });

    const res = db.prepare(`
      INSERT INTO portfolios (user_id, name, broker, market, currency, color, is_master, initial_capital)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(userId, name.trim(), broker || 'manual', market || 'EGX', currency || 'EGP', color || 'blue', Number(initial_capital) || 0);

    return NextResponse.json({
      success: true,
      portfolio: {
        id: res.lastInsertRowid,
        user_id: userId,
        name: name.trim(),
        broker: broker || 'manual',
        market: market || 'EGX',
        currency: currency || 'EGP',
        color: color || 'blue',
        is_master: false,
        initial_capital: Number(initial_capital) || 0,
      },
    });
  } catch (e) {
    console.error('[POST /api/portfolio/accounts] Error:', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

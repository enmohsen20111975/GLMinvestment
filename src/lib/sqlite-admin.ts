import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

/**
 * SQLite Admin Library
 * مكتبة آمنة لإدارة قواعد بيانات SQLite من لوحة الأدمن
 */

const DB_DIR = path.join(process.cwd(), 'db')

// ─── قواعد بيانات محمية — لا يمكن حذفها ───────────────────────────
// PROTECT-FIX v2 (2026-10-08): بعد تحليل دقيق، اتعمل تنظيف للقائمة.
// القاعدة: بس الـ DBs اللي بـ تتعمل ليها reference كـ "مسار ملف فعلي"
// (db/xxx.db أو 'xxx.db' في string literal) في الكود الحي.
const PROTECTED_DBS = new Set([
  // ── CRITICAL: النظام مش هيشتغل من غيرهم ──
  'stocks.db',              // بيانات أسهم EGX — 428 مرجع كملف
  'predictions.db',         // توقعات V40.2 — 248 مرجع كملف
  'data_engine.db',         // كاش محرك البيانات — 182 مرجع كملف
  'price_history.db',       // الأسعار التاريخية — 180 مرجع كملف
  'auth.db',                // المستخدمين والجلسات (Prisma) — 25 مرجع كملف
  'custom.db',              // Prisma default schema (DATABASE_URL)
  'intraday.db',            // بيانات intraday — 41 مرجع كملف
  'news.db',                // الأخبار — 24 مرجع كملف
  'crypto.db',              // بيانات العملات الرقمية — 22 مرجع كملف
  // ── IMPORTANT: بيانات قابلة للتجديد بس مهمة ──
  'historical.db',          // بيانات تاريخية — 9 مراجع
  'gold_prices.db',         // أسعار الذهب — 8 مراجع
  'learned.db',             // دروس التعلم الآلي — 5 مراجع
  'egypt_stocks.db',        // أسهم مصرية — 4 مراجع
  'production_snapshot.db', // snapshot الإنتاج — 3 مراجع
  'paper_trading.db',       // تداول ورقي — 2 مراجع
  'finance.db',             // محفظة — 2 مراجع
  'decision_log.db',        // سجل القرارات — 2 مراجع
  'crypto_learning.db',     // تعلم العملات الرقمية — 2 مراجع
  'crypto_disclosures.db',  // إفصاحات العملات الرقمية — 2 مراجع
  'content.db',             // محتوى — 2 مراجع
  'community.db',           // مجتمع — 2 مراجع
  'analytics.db',           // تحليلات — 1+ مرجع
  'unified_stocks.db',      // أسهم موحدة (عربي)
])

export interface DatabaseInfo {
  name: string
  size: number
  sizeFormatted: string
  tableCount: number
  totalRows: number
  protected: boolean
  lastModified: string
}

export interface TableSchema {
  cid: number
  name: string
  type: string
  notNull: boolean
  defaultValue: string | null
  primaryKey: boolean
}

export interface TableInfo {
  name: string
  rowCount: number
  schema: TableSchema[]
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ─── التحقق من اسم آمن ─────────────────────────────────────────────
function validateName(name: string, type: 'db' | 'table'): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`اسم ${type} غير صالح`)
  }
  // اسم DB: حروف/أرقام/_-. وينتهي بـ .db
  if (type === 'db') {
    if (!/^[\w.-]+\.db$/.test(name)) {
      throw new Error(`اسم قاعدة البيانات غير صالح: ${name}`)
    }
    // منع path traversal
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('مسار غير صالح')
    }
  } else {
    // اسم جدول: حروف/أرقام/_
    if (!/^[\w]+$/.test(name)) {
      throw new Error(`اسم الجدول غير صالح: ${name}`)
    }
  }
}

// ─── فتح قاعدة بيانات ──────────────────────────────────────────────
export function openDb(dbName: string): Database.Database {
  validateName(dbName, 'db')
  const dbPath = path.join(DB_DIR, dbName)

  if (!fs.existsSync(dbPath)) {
    throw new Error(`قاعدة البيانات غير موجودة: ${dbName}`)
  }

  const db = new Database(dbPath, { readonly: false, fileMustExist: true })
  db.pragma('journal_mode = WAL')
  return db
}

// ─── قائمة قواعد البيانات ──────────────────────────────────────────
export function listDatabases(): DatabaseInfo[] {
  if (!fs.existsSync(DB_DIR)) {
    return []
  }

  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.db'))

  return files.map((name) => {
    const dbPath = path.join(DB_DIR, name)
    const stat = fs.statSync(dbPath)
    const size = stat.size
    const isProtected = PROTECTED_DBS.has(name)

    let tableCount = 0
    let totalRows = 0

    try {
      const db = new Database(dbPath, { readonly: true })
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[]

      tableCount = tables.length
      for (const t of tables) {
        try {
          const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as {
            c: number
          }
          totalRows += count.c
        } catch { // silent fallback (safe-by-design)
          // تخطّي الجداول المعطوبة
        }
      }
      db.close()
    } catch { // silent fallback (safe-by-design)
      // قاعدة معطوبة — نرجّعها لكن بـ 0
    }

    return {
      name,
      size,
      sizeFormatted: formatSize(size),
      tableCount,
      totalRows,
      protected: isProtected,
      lastModified: stat.mtime.toISOString(),
    }
  })
}

// ─── قائمة الجداول في DB ───────────────────────────────────────────
export function listTables(dbName: string): TableInfo[] {
  const db = openDb(dbName)
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]

    return tables.map((t) => {
      const schema = db.prepare(`PRAGMA table_info("${t.name}")`).all() as TableSchema[]
      let rowCount = 0
      try {
        const r = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }
        rowCount = r.c
      } catch { // silent fallback (safe-by-design)
        // skip
      }
      return { name: t.name, rowCount, schema }
    })
  } finally {
    db.close()
  }
}

// ─── استعلام عن جدول مع فلتر/ترتيب/تقسيم ───────────────────────────
export function queryTable(
  dbName: string,
  tableName: string,
  options: {
    page?: number
    pageSize?: number
    filters?: Record<string, string>
    sortColumn?: string
    sortDirection?: 'asc' | 'desc'
  } = {}
): QueryResult {
  const { page = 1, pageSize = 50, filters = {}, sortColumn, sortDirection = 'asc' } = options

  const db = openDb(dbName)
  try {
    validateName(tableName, 'table')

    // التحقق من وجود الجدول
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName)
    if (!tableExists) {
      throw new Error(`الجدول غير موجود: ${tableName}`)
    }

    // نجيب الـ schema عشان نعرف الأعمدة
    const schema = db.prepare(`PRAGMA table_info("${tableName}")`).all() as TableSchema[]
    const columns = schema.map((s) => s.name)

    // بناء WHERE من الفلاتر
    const whereClauses: string[] = []
    const whereParams: unknown[] = []

    for (const [col, val] of Object.entries(filters)) {
      if (!val || !columns.includes(col)) continue
      // فلتر نصي مرن (LIKE) لو القيمة مش رقمية كاملة
      const isNumeric = /^-?\d+(\.\d+)?$/.test(val)
      if (isNumeric) {
        whereClauses.push(`"${col}" = ?`)
        whereParams.push(Number(val))
      } else {
        whereClauses.push(`CAST("${col}" AS TEXT) LIKE ?`)
        whereParams.push(`%${val}%`)
      }
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // الترتيب
    let orderSql = ''
    if (sortColumn && columns.includes(sortColumn)) {
      orderSql = `ORDER BY "${sortColumn}" ${sortDirection === 'desc' ? 'DESC' : 'ASC'}`
    }

    // عدّ الإجمالي
    const countRow = db
      .prepare(`SELECT COUNT(*) as c FROM "${tableName}" ${whereSql}`)
      .get(...whereParams) as { c: number }
    const total = countRow.c

    // التحقق من حدود الصفحة
    const safePageSize = Math.min(Math.max(pageSize, 1), 500)
    const safePage = Math.min(Math.max(page, 1), Math.ceil(total / safePageSize) || 1)
    const offset = (safePage - 1) * safePageSize

    // نجيب الصفوف
    const rows = db
      .prepare(
        `SELECT * FROM "${tableName}" ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
      )
      .all(...whereParams, safePageSize, offset) as Record<string, unknown>[]

    return {
      rows,
      columns,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    }
  } finally {
    db.close()
  }
}

// ─── إدراج صف ──────────────────────────────────────────────────────
export function insertRow(
  dbName: string,
  tableName: string,
  values: Record<string, unknown>
): { success: boolean; rowId?: number; error?: string } {
  const db = openDb(dbName)
  try {
    validateName(tableName, 'table')
    const schema = db.prepare(`PRAGMA table_info("${tableName}")`).all() as TableSchema[]
    const columns = schema.map((s) => s.name)

    // فلترة القيم للأعمدة الموجودة فقط
    const filteredValues: Record<string, unknown> = {}
    for (const col of columns) {
      if (col in values) {
        filteredValues[col] = values[col]
      }
    }

    const cols = Object.keys(filteredValues)
    if (cols.length === 0) {
      return { success: false, error: 'مفيش أعمدة صالحة للإدراج' }
    }

    const placeholders = cols.map(() => '?').join(', ')
    const colList = cols.map((c) => `"${c}"`).join(', ')

    const stmt = db.prepare(
      `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`
    )
    const result = stmt.run(...cols.map((c) => filteredValues[c]))
    return { success: true, rowId: Number(result.lastInsertRowid) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    db.close()
  }
}

// ─── تحديث صف ──────────────────────────────────────────────────────
export function updateRow(
  dbName: string,
  tableName: string,
  primaryKeyColumn: string,
  primaryKeyValue: unknown,
  values: Record<string, unknown>
): { success: boolean; changes?: number; error?: string } {
  const db = openDb(dbName)
  try {
    validateName(tableName, 'table')
    const schema = db.prepare(`PRAGMA table_info("${tableName}")`).all() as TableSchema[]
    const columns = schema.map((s) => s.name)

    if (!columns.includes(primaryKeyColumn)) {
      return { success: false, error: `العمود المفتاحي غير موجود: ${primaryKeyColumn}` }
    }

    const setClauses: string[] = []
    const setParams: unknown[] = []

    for (const [col, val] of Object.entries(values)) {
      if (col === primaryKeyColumn) continue
      if (!columns.includes(col)) continue
      setClauses.push(`"${col}" = ?`)
      setParams.push(val)
    }

    if (setClauses.length === 0) {
      return { success: false, error: 'مفيش أعمدة للتحديث' }
    }

    setParams.push(primaryKeyValue)

    const stmt = db.prepare(
      `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE "${primaryKeyColumn}" = ?`
    )
    const result = stmt.run(...setParams)
    return { success: true, changes: result.changes }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    db.close()
  }
}

// ─── مسح صف ────────────────────────────────────────────────────────
export function deleteRow(
  dbName: string,
  tableName: string,
  primaryKeyColumn: string,
  primaryKeyValue: unknown
): { success: boolean; changes?: number; error?: string } {
  const db = openDb(dbName)
  try {
    validateName(tableName, 'table')
    const lowerTable = tableName.toLowerCase();
    if (lowerTable === 'predictions' || lowerTable === 'predictions_history' || lowerTable === 'aiprediction') {
      return { success: false, error: `جدول ${tableName} محمي تماماً من الحذف عبر Next.js بموجب الحماية القضائية P0` }
    }
    const schema = db.prepare(`PRAGMA table_info("${tableName}")`).all() as TableSchema[]
    const columns = schema.map((s) => s.name)

    if (!columns.includes(primaryKeyColumn)) {
      return { success: false, error: `العمود المفتاحي غير موجود: ${primaryKeyColumn}` }
    }

    const stmt = db.prepare(
      `DELETE FROM "${tableName}" WHERE "${primaryKeyColumn}" = ?`
    )
    const result = stmt.run(primaryKeyValue)
    return { success: true, changes: result.changes }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    db.close()
  }
}

// ─── مسح قاعدة بيانات كاملة ────────────────────────────────────────
export function deleteDatabase(
  dbName: string,
  makeBackup = true
): { success: boolean; backupPath?: string; error?: string } {
  validateName(dbName, 'db')

  if (PROTECTED_DBS.has(dbName)) {
    return { success: false, error: `قاعدة البيانات ${dbName} محمية ولا يمكن حذفها` }
  }

  const dbPath = path.join(DB_DIR, dbName)
  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `قاعدة البيانات غير موجودة: ${dbName}` }
  }

  let backupPath: string | undefined

  try {
    // backup قبل الحذف
    if (makeBackup) {
      const backupDir = path.join(DB_DIR, 'backups')
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = path.join(backupDir, `${dbName.replace(/\.db$/, '')}-backup-${ts}.db`)
      fs.copyFileSync(dbPath, backupPath)
    }

    // مسح ملفات WAL و SHM لو موجودة
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)

    // مسف الـ DB نفسها
    fs.unlinkSync(dbPath)

    return { success: true, backupPath }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── VACUUM قاعدة بيانات ───────────────────────────────────────────
export function vacuumDatabase(
  dbName: string
): { success: boolean; beforeSize?: number; afterSize?: number; error?: string } {
  validateName(dbName, 'db')
  const dbPath = path.join(DB_DIR, dbName)

  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `قاعدة البيانات غير موجودة: ${dbName}` }
  }

  const beforeSize = fs.statSync(dbPath).size

  try {
    const db = new Database(dbPath, { readonly: false, fileMustExist: true })
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.exec('VACUUM')
    db.close()

    const afterSize = fs.statSync(dbPath).size
    return { success: true, beforeSize, afterSize }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      beforeSize,
    }
  }
}

// ─── فحص سلامة ──────────────────────────────────────────────────────
export function integrityCheck(
  dbName: string
): { success: boolean; result?: string; error?: string } {
  validateName(dbName, 'db')
  const dbPath = path.join(DB_DIR, dbName)

  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `قاعدة البيانات غير موجودة: ${dbName}` }
  }

  try {
    const db = new Database(dbPath, { readonly: true })
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    db.close()
    return { success: true, result: result.integrity_check }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── تنفيذ SQL خام (للأدمن المتقدم) ────────────────────────────────
export function executeRawSql(
  dbName: string,
  sql: string,
  readOnly = false
): {
  success: boolean
  rows?: Record<string, unknown>[]
  changes?: number
  error?: string
} {
  validateName(dbName, 'db')
  const dbPath = path.join(DB_DIR, dbName)

  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `قاعدة البيانات غير موجودة: ${dbName}` }
  }

  try {
    const db = new Database(dbPath, { readonly, fileMustExist: true })

    // منع أووامر خطرة لو مش read-only
    if (!readOnly) {
      const trimmed = sql.trim().toLowerCase()
      if (trimmed.includes('attach') || trimmed.includes('detach')) {
        db.close()
        return { success: false, error: 'ATTACH/DETACH ممنوع' }
      }
    }

    const trimmed = sql.trim()
    if (
      trimmed.toLowerCase().startsWith('select') ||
      trimmed.toLowerCase().startsWith('pragma') ||
      trimmed.toLowerCase().startsWith('with')
    ) {
      const rows = db.prepare(sql).all() as Record<string, unknown>[]
      db.close()
      return { success: true, rows }
    } else {
      const result = db.exec(sql)
      db.close()
      return { success: true, changes: result.changes }
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── دوال مساعدة ───────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function isProtected(dbName: string): boolean {
  return PROTECTED_DBS.has(dbName)
}

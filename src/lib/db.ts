import { PrismaClient } from '@prisma/client'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Ensure the auth database file exists before Prisma tries to open it.
 * On Hostinger shared hosting, we CANNOT run `prisma db push` via execSync
 * because it spawns child processes that exceed thread limits.
 * Instead, we simply copy the DB file from a fallback location if missing.
 */
function ensureAuthDbFile(): void {
  try {
    const dbUrl = process.env.DATABASE_URL || 'file:./db/auth.db'
    let dbPath: string
    if (dbUrl.startsWith('file:')) {
      const rawPath = dbUrl.slice(5)
      if (rawPath.startsWith('./')) {
        dbPath = join(process.cwd(), rawPath.slice(2))
      } else if (rawPath.startsWith('/')) {
        dbPath = rawPath
      } else {
        dbPath = join(process.cwd(), rawPath)
      }
    } else {
      dbPath = join(process.cwd(), 'db', 'auth.db')
    }

    if (!existsSync(dbPath)) {
      console.log(`[db] Auth database not found at ${dbPath}. Attempting to copy from fallback...`)
      const dir = dirname(dbPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Try known fallback paths where auth.db might exist
      const fallbackPaths = [
        join(process.cwd(), 'prisma', 'db', 'auth.db'),
        join(process.cwd(), 'db', 'auth.db'),
        join(dirname(process.cwd()), 'db', 'auth.db'),
      ]
      const fallback = fallbackPaths.find(p => existsSync(p))
      if (fallback) {
        copyFileSync(fallback, dbPath)
        console.log(`[db] Copied auth database from ${fallback}`)
      } else {
        console.warn(`[db] No fallback auth.db found. Prisma will create tables on first write.`)
      }
    }
  } catch (err) {
    console.warn('[db] ensureAuthDbFile failed (non-critical):', err)
  }
}

// Ensure DB file exists on first import (lightweight — no child processes)
ensureAuthDbFile()

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

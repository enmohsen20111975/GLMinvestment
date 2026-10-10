/**
 * Database Explorer API
 * =====================
 * API لعرض محتويات قواعد البيانات SQLite
 * يستخدم better-sqlite3 للقراءة فقط
 */
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

const DB_DIR = path.join(process.cwd(), 'db');

type DbInfo = {
    name: string;
    size_mb: number;
    tables: { name: string; rows: number }[];
    last_modified: string;
};

export async function GET(req: NextRequest) {
    const authError = await requireAdminAsync(req);
    if (authError) return authError;
    try {
        const url = new URL(req.url);
        const dbName = url.searchParams.get('db');
        const tableName = url.searchParams.get('table');
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

        if (!fs.existsSync(DB_DIR)) {
            return NextResponse.json({ success: false, error: 'Database directory not found' });
        }

        const allDbs = fs.readdirSync(DB_DIR)
            .filter(f => f.endsWith('.db') && !f.includes('-shm') && !f.includes('-wal'))
            .map(f => {
                const fp = path.join(DB_DIR, f);
                const stat = fs.statSync(fp);
                return {
                    name: f,
                    path: fp,
                    size_mb: Math.round(stat.size / 1024 / 1024 * 100) / 100,
                    last_modified: stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => b.size_mb - a.size_mb);

        // If no specific DB requested, return list
        if (!dbName) {
            return NextResponse.json({
                success: true,
                databases: allDbs.map(({ name, size_mb, last_modified }) => ({
                    name,
                    size_mb,
                    last_modified,
                })),
            });
        }

        // Find the requested DB
        const dbFile = allDbs.find(d => d.name === dbName);
        if (!dbFile) {
            return NextResponse.json({ success: false, error: `Database '${dbName}' not found` });
        }

        const db = new Database(dbFile.path, { readonly: true, timeout: 5000 });
        db.pragma('busy_timeout = 5000');

        // Get tables
        const tables = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
        ).all() as { name: string }[];

        const tableInfo = tables.map((t: { name: string }) => {
            // P0-12-SQLI fix (2026-09-27): the value `t.name` comes from
            // sqlite_master (DB metadata, not user input) and is wrapped in
            // double quotes. We additionally validate it matches the strict
            // SQLite identifier pattern so a corrupted sqlite_master row
            // can't break out of the quoting.
            const safeName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name) ? t.name : '';
            if (!safeName) {
                return { name: t.name, rows: 0 };
            }
            const count = db.prepare(`SELECT COUNT(*) as count FROM "${safeName}"`).get() as { count: number };
            return { name: t.name, rows: count.count };
        });

        // If a specific table is requested, return its data
        if (tableName) {
            // P0-12-SQLI fix (2026-09-27): enforce a strict SQLite identifier
            // pattern before interpolating tableName into any SQL. Although
            // `tableInfo.find(t => t.name === tableName)` below would reject
            // unknown tables, an attacker could still attempt to break out of
            // the double-quoted interpolation (e.g. tableName = 'foo"; --').
            // The regex limits identifiers to [A-Za-z_][A-Za-z0-9_]* which
            // covers every legitimate table name in our schema.
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
                db.close();
                return NextResponse.json(
                    { success: false, error: `Invalid table name '${tableName}'. Only alphanumeric + underscore identifiers are allowed.` },
                    { status: 400 }
                );
            }
            const table = tableInfo.find(t => t.name === tableName);
            if (!table) {
                db.close();
                return NextResponse.json({ success: false, error: `Table '${tableName}' not found` });
            }

            // Get columns
            const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as any[];

            // Get row count
            const totalRows = table.rows;
            const totalPages = Math.ceil(totalRows / limit);

            // Get data
            const offset = (page - 1) * limit;
            const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(limit, offset);

            db.close();

            return NextResponse.json({
                success: true,
                database: dbName,
                table: {
                    name: tableName,
                    columns: columns.map((c: any) => ({
                        name: c.name,
                        type: c.type,
                        not_null: !!c.notnull,
                        pk: !!c.pk,
                    })),
                    total_rows: totalRows,
                    page,
                    total_pages: totalPages,
                    rows,
                },
            });
        }

        db.close();

        return NextResponse.json({
            success: true,
            database: dbName,
            size_mb: dbFile.size_mb,
            last_modified: dbFile.last_modified,
            tables: tableInfo,
        });

    } catch (error: any) {
        console.error('[admin:db-explorer]', error);
        return NextResponse.json({
            success: false,
            error: 'internal_error',
        }, { status: 500 });
    }
}
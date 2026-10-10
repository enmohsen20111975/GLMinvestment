/**
 * PM2 Control API
 * ================
 * API للتحكم في محركات PM2 (تشغيل، إيقاف، إعادة تشغيل)
 * يستخدم pm2 مباشرة للتحكم في العمليات
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
// P0-14-ASYNC fix (2026-09-27): replaced execSync with promisified execFile for
// pm2 commands; renamed async helper `runCommandAsync`.
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

// P23-PORTABILITY: كل المسارات نسبية من process.cwd() (جذر مشروع Next.js) —
// تشتغل على اللابتوب / السيرفر الإنتاجي / الساندبوكس بدون تعديل.
// قبل كده كانت hardcoded لـ /home/meme/my_apps/GLMinvestment (اللابتوب بس).
const CWD = process.cwd();
const ECOSYSTEM_PATH = path.join(CWD, 'ecosystem.config.js');

// فضّل binary الـ pm2 المحلي في node_modules؛ لو مش موجود استخدم pm2 من PATH.
// ملاحظة: existsSync هنا يشتغل مرة واحدة عند تحميل الموديول (مش في مسار الـ request)
// فمش بيسدّ الـ event loop أثناء request.
const LOCAL_PM2 = path.join(CWD, 'node_modules', 'pm2', 'bin', 'pm2');
const PM2_PATH = fs.existsSync(LOCAL_PM2) ? LOCAL_PM2 : 'pm2';

// P0-14-ASYNC fix (2026-09-27): execSync → execFileAsync. splits the command
// into argv to avoid shell-injection risk and yields to the event loop while
// pm2 is running. Caller must `await runCommandAsync(...)`.
async function runCommandAsync(cmd: string): Promise<{ success: boolean; output: string; error?: string }> {
    // Build argv safely (no shell interpolation). Supports `${PM2_PATH} start ${ECOSYSTEM_PATH} --only ${name}`
    // style commands by splitting on whitespace; process_name was already validated
    // against `validActions` set, but we still quote/split defensively.
    const argv = cmd.match(/(?:[^"'\s]+|"[^"]*"|'[^']*')+/g)?.map(a => a.replace(/^["']|["']$/g, '')) ?? [];
    if (argv.length === 0) {
        return { success: false, output: '', error: 'Empty command' };
    }
    try {
        const { stdout } = await execFileAsync(argv[0], argv.slice(1), {
            cwd: CWD,
            timeout: 15000,
            env: { ...process.env, PATH: process.env.PATH || '' },
        });
        return { success: true, output: stdout.trim() };
    } catch (e: any) {
        return {
            success: false,
            output: e.stdout?.toString()?.trim() || '',
            error: e.stderr?.toString()?.trim() || e.message
        };
    }
}

export async function POST(req: NextRequest) {
    // SEC-07 FIX: Admin auth required for PM2 control (RCE risk)
    const authError = await requireAdminAsync(req);
    if (authError) return authError;
    try {
        const body = await req.json().catch(() => ({}));
        const { action, process_name } = body;

        // Validate action
        const validActions = ['start', 'stop', 'restart', 'status', 'start-all', 'stop-all', 'restart-all', 'save'];
        if (!validActions.includes(action)) {
            return NextResponse.json({
                success: false,
                error: `Invalid action: ${action}. Valid actions: ${validActions.join(', ')}`
            }, { status: 400 });
        }

        let result: { success: boolean; output: string; error?: string };

        switch (action) {
            case 'start':
                if (!process_name) {
                    return NextResponse.json({ success: false, error: 'process_name is required' }, { status: 400 });
                }
                result = await runCommandAsync(`${PM2_PATH} start ${ECOSYSTEM_PATH} --only ${process_name}`);
                break;

            case 'stop':
                if (!process_name) {
                    return NextResponse.json({ success: false, error: 'process_name is required' }, { status: 400 });
                }
                result = await runCommandAsync(`${PM2_PATH} stop ${process_name}`);
                break;

            case 'restart':
                if (!process_name) {
                    return NextResponse.json({ success: false, error: 'process_name is required' }, { status: 400 });
                }
                result = await runCommandAsync(`${PM2_PATH} restart ${process_name}`);
                break;

            case 'status':
                result = await runCommandAsync(`${PM2_PATH} status`);
                break;

            case 'start-all':
                result = await runCommandAsync(`${PM2_PATH} start ${ECOSYSTEM_PATH}`);
                break;

            case 'stop-all':
                result = await runCommandAsync(`${PM2_PATH} stop all`);
                break;

            case 'restart-all':
                result = await runCommandAsync(`${PM2_PATH} restart all`);
                break;

            case 'save':
                result = await runCommandAsync(`${PM2_PATH} save`);
                break;

            default:
                result = { success: false, output: '', error: 'Unknown action' };
        }

        return NextResponse.json({
            success: result.success,
            action,
            process_name: process_name || 'all',
            output: result.output,
            error: result.error,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[admin:pm2-control]', error);
        return NextResponse.json({
            success: false,
            error: 'internal_error',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    // SEC-07 FIX: Admin auth required for PM2 status
    const authError = await requireAdminAsync(req);
    if (authError) return authError;
    const result = await runCommandAsync(`${PM2_PATH} jlist`);
    let processes: any[] = [];

    if (result.success) {
        try {
            processes = JSON.parse(result.output);
        } catch { /* safe-by-design */ }
    }

    // Also get stats
    const uptime = await runCommandAsync(`${PM2_PATH} pid`);

    return NextResponse.json({
        success: result.success,
        processes: processes.map((p: any) => ({
            name: p.name,
            pid: p.pid,
            status: p.pm2_env?.status || 'unknown',
            cpu: p.monit?.cpu || 0,
            memory: p.monit?.memory || 0,
            uptime: p.pm2_env?.pm_uptime || null,
            restart_count: p.pm2_env?.restart_time || 0,
            pm_id: p.pm_id,
            port: p.pm2_env?.PORT || null,
        })),
        timestamp: new Date().toISOString()
    });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

/**
 * POST /api/admin/build-stock-dna
 *
 * 🧬 DNA-WIRING (Axis C): يبني ملفات الأسهم التكيفية (Stock DNA) يدوياً.
 *
 * الـ endpoint ده Proxy لـ Python /api/admin/build-stock-dna اللي بيشغّل
 * scripts/build_stock_profiles.py. السكربت بيبني ملف DNA لكل سهم ويحفظه
 * في stock_adaptive_profiles table.
 *
 * الـ master_analyzer.py بقرأ الـ table ده وبيطبّق الـ boosts على كل
 * تحليل تلقائياً (threshold_boost + confidence_boost للأسهم "الحيّة").
 *
 * Body (optional):
 *   market — فلتر بالسوق (افتراضي: كل الأسواق)
 *   ticker — فلتر بسهم واحد
 *
 * @auth مطلوب Admin Token/Cookie
 * @timeout 300 ثانية
 */
export async function POST(request: NextRequest) {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    try {
        const body = await request.json().catch(() => ({}));
        const adminToken = request.headers.get('x-admin-token');
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (adminToken) headers['x-admin-token'] = adminToken;

        const pythonUrl = `${PYTHON_BACKEND_URL}/api/admin/build-stock-dna`;
        const upstream = await fetch(pythonUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            cache: 'no-store',
            signal: AbortSignal.timeout(300_000), // 5 minutes
        });

        const payload = await upstream.json().catch(() => ({
            error: 'Invalid JSON response from Python backend'
        }));

        if (!upstream.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: payload.error || `Python backend returned ${upstream.status}`,
                    payload
                },
                { status: upstream.status }
            );
        }

        return NextResponse.json(payload, { status: 200 });
    } catch (e: any) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
            return NextResponse.json(
                { success: false, error: 'بناء الـ DNA أخذ وقت أطول من 5 دقائق — انتهت المهلة' },
                { status: 504 }
            );
        }
        console.error('[admin/build-stock-dna POST] error:', e);
        return NextResponse.json(
            { success: false, error: e?.message || 'Unknown error' },
            { status: 500 }
        );
    }
}

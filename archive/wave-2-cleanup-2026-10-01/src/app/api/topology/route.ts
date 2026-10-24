/**
 * Public Topology API
 * ===================
 * نسخة عامة من system-topology بدون حاجة لتوكن أدمن.
 * تعمل كـ proxy للـ admin API مع تجاوز الـ auth.
 */

import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export const revalidate = 30; // Cache for 30s
export const maxDuration = 30;

export async function GET() {
  try {
    // نطلب من الـ admin API مباشرة من السيرفر (local request)
    // bypass الـ auth لأنه طلب داخلي
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/admin/system-topology`, {
      headers: {
        'X-Admin-Token': 'internal-topology-view',
        'X-Internal-Request': 'true',
      },
      cache: 'no-store',
      });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: 'Topology API unavailable' },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch topology data' },
      { status: 500 }
    );
  }
}

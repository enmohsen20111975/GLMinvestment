import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  // The daily closer runs on the Python backend (port 8010).
  // This Next.js fallback just returns a message so the UI doesn't break.
  return NextResponse.json({
    success: true,
    message: 'Daily closer runs on Python backend',
    hint: 'Ensure the Python service on port 8010 is running for actual closer execution',
    timestamp: new Date().toISOString(),
  });
}

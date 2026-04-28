import { NextResponse } from 'next/server';

// Lightweight endpoint that prevents Hostinger from killing the idle server.
// Called every 60 seconds from the client.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

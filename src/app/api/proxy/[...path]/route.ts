import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = 'http://127.0.0.1:8100';
const API_KEY = '47f38c51575ba0af91f086a57eaf7964275da92a81eb78b46e28bc22fb6ba11c';

// Headers that should be forwarded from client to backend
const FORWARD_HEADERS = ['content-type', 'accept', 'authorization'];

// Headers that should NOT be sent to the backend (hop-by-hop headers)
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

async function proxyRequest(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendPath = path.join('/');
  const url = `${BACKEND_URL}/api/${backendPath}`;

  // Build headers for the backend request
  const headers: Record<string, string> = {};

  // Forward relevant headers from the incoming request
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && FORWARD_HEADERS.includes(key.toLowerCase())) {
      headers[key] = value;
    }
  });

  // Always include the API key
  headers['X-API-Key'] = API_KEY;

  // Build request options
  const init: RequestInit = {
    headers,
    cache: 'no-store',
  };

  // Forward body for non-GET methods
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      init.body = await request.text();
    } else {
      init.body = await request.arrayBuffer();
    }
  }

  try {
    const res = await fetch(url, init);

    // Build response headers
    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`[Proxy] Error proxying ${request.method} /api/${backendPath}:`, error);
    return NextResponse.json(
      { detail: 'Backend service unavailable', error: String(error) },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

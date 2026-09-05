import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * Telegram Proxy Route
 * ====================
 * يوجه طلبات /api/telegram/* إلى Python Backend
 *
 * يعمل بطريقتين:
 * 1. لو فيه XTransformPort في الـ query → يستخدم البورت ده
 * 2. لو مفيش → يستخدم PYTHON_BACKEND_URL أو localhost:8010
 *
 * هذا يحل مشكلة عدم وجود Caddy gateway على الـ laptop
 */

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const backendPath = path.join('/');

  // Get XTransformPort from query (if present)
  const searchParams = new URL(request.url).searchParams;
  const transformPort = searchParams.get('XTransformPort');

  // Remove XTransformPort from the forwarded query
  searchParams.delete('XTransformPort');

  // Determine backend URL
  let baseUrl: string;
  if (transformPort) {
    baseUrl = `http://127.0.0.1:${transformPort}`;
  } else {
    baseUrl = PYTHON_BACKEND_URL.replace('localhost', '127.0.0.1');
  }

  // Build the backend URL
  const queryString = searchParams.toString();
  const url = `${baseUrl}/api/telegram/${backendPath}${queryString ? `?${queryString}` : ''}`;

  // Build headers for the backend request
  const headers: Record<string, string> = {};
  const contentType = request.headers.get('content-type') || '';

  // P38-FIX: For multipart/form-data (file uploads), use arrayBuffer to avoid
  // corrupting binary data. For JSON/text, use .text(). The content-type header
  // (including the multipart boundary) must be forwarded as-is.
  if (contentType) {
    headers['content-type'] = contentType;
  }

  // Get request body if POST/PUT
  let body: BodyInit | undefined;
  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    if (contentType.includes('multipart/form-data')) {
      // Binary-safe: forward raw bytes
      const arrayBuf = await request.arrayBuffer();
      body = Buffer.from(arrayBuf);
    } else {
      body = await request.text();
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Get response content type
    const respContentType = response.headers.get('content-type') || 'application/json';

    // Return the response
    const responseData = await response.text();

    return new NextResponse(responseData, {
      status: response.status,
      headers: {
        'content-type': respContentType,
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
      },
    });
  } catch (error: any) {
    console.error(`[Telegram Proxy] Error forwarding to ${url}:`, error);

    if (error?.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الطلب - تأكد من تشغيل Python Backend على port 8010' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'فشل في الاتصال بـ Python Backend',
        details: error?.message || String(error),
        hint: 'تأكد من تشغيل Python Backend على port 8010',
      },
      { status: 502 }
    );
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as OPTIONS,
};

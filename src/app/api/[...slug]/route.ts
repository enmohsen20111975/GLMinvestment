/**
 * Catch-all handler for unmatched /api/* routes.
 *
 * WHY THIS EXISTS:
 * The mobile (Flutter) client expects JSON from every API call. When a route
 * does not exist on this Next.js server, Next.js returns its default HTML 404
 * page. The client's JSON parser then throws and the app crashes ("everything
 * broke on mobile"). This catch-all converts every unmatched /api/* request
 * into a clean, parseable JSON 404 response, so missing endpoints degrade
 * gracefully instead of crashing the client.
 *
 * More specific route files (e.g. app/api/stocks/[ticker]/route.ts) always
 * take precedence over this catch-all, so existing endpoints are unaffected.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export async function GET(request: NextRequest) {
  return jsonNotFound(request);
}

export async function POST(request: NextRequest) {
  return jsonNotFound(request);
}

export async function PUT(request: NextRequest) {
  return jsonNotFound(request);
}

export async function PATCH(request: NextRequest) {
  return jsonNotFound(request);
}

export async function DELETE(request: NextRequest) {
  return jsonNotFound(request);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: ALLOWED_METHODS.join(', '),
      'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
    },
  });
}

function jsonNotFound(request: NextRequest) {
  const path = request.nextUrl.pathname;
  return NextResponse.json(
    {
      success: false,
      error: 'endpoint_not_found',
      error_ar: 'هذا المسار غير متوفر حالياً',
      path,
      method: request.method,
    },
    {
      status: 404,
      headers: {
        Allow: ALLOWED_METHODS.join(', '),
        'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
      },
    }
  );
}

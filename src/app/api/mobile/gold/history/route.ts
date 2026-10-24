/**
 * GET /api/mobile/gold/history?karat=24&days=30
 * Mobile gold price history — primary path called by the Flutter app
 * (lib/api/client.dart:1429).
 *
 * Delegates to the shared helper at @/lib/gold-history-helper so the
 * alias at /api/metals/gold/history returns identical data.
 */

import { NextRequest } from 'next/server';
import { buildGoldHistory } from '@/lib/gold-history-helper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return buildGoldHistory(req);
}

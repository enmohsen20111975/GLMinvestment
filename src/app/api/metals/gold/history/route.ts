/**
 * GET /api/metals/gold/history?karat=24&days=30
 * Gold price history (alias path).
 *
 * Delegates to the shared helper at @/lib/gold-history-helper.
 * The Flutter app (lib/api/client.dart:1440) calls this endpoint when the
 * primary /api/mobile/gold/history call fails.
 */

import { NextRequest } from 'next/server';
import { buildGoldHistory } from '@/lib/gold-history-helper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return buildGoldHistory(req);
}

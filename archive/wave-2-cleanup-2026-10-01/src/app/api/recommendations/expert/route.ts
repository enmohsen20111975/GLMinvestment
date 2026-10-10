/**
 * /api/recommendations/expert — alias endpoint
 * =============================================
 * The Flutter app calls this URL (lib/api/client.dart:1053) but the actual
 * implementation lives at `/api/expert-recommendations`.
 *
 * We simply re-export the handlers from the canonical route so behaviour,
 * query params (status, market, expert, symbol, session_date, limit), and
 * response shapes are identical.
 *
 * Methods supported: GET, POST, PUT, DELETE — all proxied.
 */

export const dynamic = 'force-dynamic';

export {
  GET,
  POST,
  PUT,
  DELETE,
} from '@/app/api/expert-recommendations/route';

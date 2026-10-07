/**
 * /api/data-engine/reload — مستقبل webhook من data_engine بعد كل مزامنة
 * =====================================================================
 * Step 4.3 من الخطة: التحديث اللحظي.
 *
 * لما data_engine تخلص scraper + sync، بتبعت POST هنا عشان نُعلم Next.js
 * يعيد تحميل الكاش وتظهر البيانات الجديدة في الـ UI لحظياً.
 *
 * الحماية:
 *   - Shared secret عبر هيدر X-Webhook-Secret (يطابق process.env.SHARED_SECRET)
 *   - لو SHARED_SECRET مش مت setter، الـ endpoint بيرفض كل الطلبات (safe default)
 *
 * الاستخدام (من data_engine/realtime_sync.py):
 *   POST /api/data-engine/reload
 *   Headers: { X-Webhook-Secret: <secret>, Content-Type: application/json }
 *   Body: { event: "stocks_synced", timestamp, payload: {...} }
 *
 * الإعداد (.env):
 *   SHARED_SECRET=<نفس القيمة في data_engine>
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** تحقق من shared secret في الهيدر */
function authorize(req: NextRequest): boolean {
  const expected = process.env.SHARED_SECRET;
  // safe default: لو السر مش مت setter، ارفض كل شيء
  if (!expected) return false;
  const received = req.headers.get("x-webhook-secret");
  if (!received) return false;
  // مقارنة بثبات (يمنع timing attacks تقريباً)
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  // 1) تحقق من السر
  if (!authorize(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized: invalid or missing X-Webhook-Secret" },
      { status: 401 }
    );
  }

  // 2) اقرأ الحدث
  let body: { event?: string; timestamp?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const event = body.event || "unknown";

  // 3) أعد تحميل الكاش — امسح كل الصفحات اللي بتعرض بيانات السوق
  //    revalidatePath بيخلي الـ cached data يُعاد توليده في الطلب التالي.
  const pathsToReload = [
    "/", // الصفحة الرئيسية (لو فيها بيانات سوق)
    "/api/admin/db",
    "/api/recommendations",
    "/api/health",
  ];
  for (const p of pathsToReload) {
    try {
      revalidatePath(p);
    } catch {
      // بعض المسارات مش هتتعدّل (no-op) — تجاهل
    }
  }
  // أعد تحميل كل الـ layout (يشمل كل الصفحات الفرعية)
  try {
    revalidatePath("/", "layout");
  } catch {
    // ignore
  }

  return NextResponse.json({
    success: true,
    event,
    revalidatedAt: new Date().toISOString(),
    revalidatedPaths: pathsToReload,
  });
}

/** GET: فحص صحة الـ endpoint (ما بيعملش reload) */
export async function GET() {
  const configured = !!process.env.SHARED_SECRET;
  return NextResponse.json({
    success: true,
    endpoint: "/api/data-engine/reload",
    webhookSecretConfigured: configured,
    method: "POST",
    requiredHeader: "X-Webhook-Secret",
  });
}

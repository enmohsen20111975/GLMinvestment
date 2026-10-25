import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added user auth guard — money endpoint,
// was previously callable by anonymous users. Now requires authenticated
// session (NextAuth cookie OR Bearer token).
import { requireAuthAsync } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';


/**
 * POST /api/paymob/process-wallet
 * Process Mobile Wallet payment with Paymob API from backend (server-side, avoiding CORS).
 * 
 * Body: { wallet_number: string, payment_key: string }
 */
export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard (money endpoint)
  const auth = await requireAuthAsync(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { wallet_number, payment_key } = body;

    if (!wallet_number || !payment_key) {
      return NextResponse.json(
        { success: false, error: 'رقم المحفظة ورمز الدفع مطلوبان' },
        { status: 400 }
      );
    }

    const response = await fetch('https://accept.paymob.com/api/acceptance/payments/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: {
          identifier: wallet_number,
          subtype: 'WALLET',
        },
        payment_token: payment_key,
      }),
    });

    const data = await response.json();

    // Check Paymob response
    const redirectUrl = data.redirect_url || data.iframe_redirection_url || '';

    if (data.pending || data.success || redirectUrl) {
      return NextResponse.json({
        success: true,
        redirect_url: redirectUrl,
        message: data['data.message'] || data.data?.message || 'تم إرسال طلب الدفع بنجاح',
      });
    }

    const errorMessage = data['data.message'] || data.data?.message || data.message || 'فشلت عملية الدفع عبر المحفظة';

    return NextResponse.json({
      success: false,
      error: errorMessage,
    });
  } catch (error) {
    console.error('[POST /api/paymob/process-wallet] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء معالجة دفع المحفظة' },
      { status: 500 }
    );
  }
}

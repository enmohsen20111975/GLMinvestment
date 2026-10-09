import { verifyAdminRequest } from './admin-auth-server';
import { isAdmin } from './admin-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function getPaywallUser(req: NextRequest): Promise<PaywallUser> {
  // default: free user
  const defaultUser: PaywallUser = {
    is_premium: false,
    subscription_tier: 'free',
    user_id: null,
  };

  try {
    // 1. Direct admin check (x-admin-token header or admin_session cookie)
    if (verifyAdminRequest(req)) {
      return {
        is_premium: true,
        subscription_tier: 'admin',
        user_id: 'admin',
      };
    }

    // 2. Direct server session check via NextAuth
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        const email = session.user.email.toLowerCase().trim();
        const username = ((session.user as Record<string, unknown>).username as string || '').toLowerCase().trim();
        const isUserAdmin =
          isAdmin(email, username) ||
          (session.user as Record<string, unknown>).is_admin === true ||
          (session.user as Record<string, unknown>).subscription_tier === 'admin' ||
          (session.user as Record<string, unknown>).subscription_tier === 'premium';

        if (isUserAdmin) {
          return {
            is_premium: true,
            subscription_tier: 'admin',
            user_id: session.user.id || 'admin',
          };
        }

        const tier = ((session.user as Record<string, unknown>).subscription_tier as string) || 'free';
        const isPremiumTier = tier === 'premium' || tier === 'admin';
        return {
          is_premium: isPremiumTier,
          subscription_tier: isPremiumTier ? 'premium' : tier,
          user_id: session.user.id || null,
        };
      }
    } catch { // silent fallback (safe-by-design)
      // Ignore session read error, fallback to /api/auth/me fetch
    }

    // 3. Fallback: Query /api/auth/me passing request headers (cookie, authorization, x-admin-token)
    const authRes = await fetch(new URL('/api/auth/me', req.url), {
      headers: {
        cookie: req.headers.get('cookie') || '',
        authorization: req.headers.get('authorization') || '',
        'x-admin-token': req.headers.get('x-admin-token') || '',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (authRes.ok) {
      const authData = await authRes.json();
      if (authData.success && authData.user) {
        const tier = authData.user.subscription_tier || 'free';
        const isUserAdmin =
          authData.user.is_admin === true ||
          tier === 'admin' ||
          tier === 'premium' ||
          isAdmin(authData.user.email, authData.user.username);

        return {
          is_premium: isUserAdmin || tier === 'premium' || tier === 'admin',
          subscription_tier: isUserAdmin ? 'admin' : tier,
          user_id: authData.user.id || null,
        };
      }
    }
  } catch (err) {
    console.error('[getPaywallUser] Error checking auth:', err);
  }

  return defaultUser;
}

/**
 * تطبق الـ Paywall على نتائج التوقعات.
 *
 * للمجانيين:
 * - Top 3 سيولة: أسماء ظاهرة (التذوق)
 * - باقي الأسهم: ticker = "🔒" + name_ar = "🔒 اشترك لمعرفة السهم"
 * - narrative: مقصوص عند 30 حرف + "..."
 * - score + signal + rr: ظاهرة (عشان يحس إن المنصة بتكسب)
 */
export function applyPaywallToResults(
  results: any[],
  isPremium: boolean
): any[] {
  if (isPremium) return results; // Premium = كل حاجة ظاهرة

  return results.map((item, index) => {
    // Top 3 (أعلى سيولة/ترتيب) = ظاهرة
    if (index < 3) return item;

    // باقي الأسهم = تشويش
    const blurred = { ...item };

    // إخفاء الـ ticker
    blurred.ticker = '🔒';
    blurred._locked = true;

    // إخفاء الاسم
    if (blurred.name_ar) blurred.name_ar = '🔒 اشترك لمعرفة السهم';
    if (blurred.name) blurred.name = '🔒';

    // قص الـ narrative عند 30 حرف
    if (blurred.humanized_reason && blurred.humanized_reason.length > 30) {
      blurred.humanized_reason = blurred.humanized_reason.substring(0, 30) + '...';
    }
    if (blurred.reason && blurred.reason.length > 30) {
      blurred.reason = blurred.reason.substring(0, 30) + '...';
    }
    if (blurred.analysis_text && blurred.analysis_text.length > 30) {
      blurred.analysis_text = blurred.analysis_text.substring(0, 30) + '...';
    }

    // score + signal + rr تفضل ظاهرة (التذوق)
    return blurred;
  });
}

/**
 * تطبق الـ Paywall على نتيجة تحليل سهم واحد (chart full-analysis).
 *
 * للمجانيين:
 * - trap_detector: null (مخفي)
 * - early_trend: null (مخفي)
 * - is_trap: false (مخفي)
 * - is_low_liquidity: false (مخفي)
 * - trailing_stop: null (مخفي)
 * - partial_exit_note: null (مخفي)
 */
export function applyPaywallToChartAnalysis(
  data: any,
  isPremium: boolean
): any {
  if (isPremium) return data; // Premium = كل حاجة ظاهرة

  const locked = { ...data };

  // إخفاء الفخاخ والترند المبكر
  if (locked.confluence) {
    // الـ signal + score تفضل ظاهرة
    // بس الـ trap flags تتشال
  }

  // إخفاء الـ Trap Detector
  locked.is_trap = undefined;
  locked.is_low_liquidity = undefined;
  locked.trap_detector = null;

  // إخفاء الـ Early Trend
  locked.is_early_trend = undefined;
  locked.early_trend_reason = undefined;

  // إخفاء الـ Trailing Stop
  if (locked.risk) {
    locked.risk.trailing_stop = null;
    locked.risk.trailing_logic = null;
    locked.risk.partial_exit_note = null;
  }

  // إخفاء الـ humanized_reason التفصيلي (قصه)
  if (locked.humanized_reason && locked.humanized_reason.length > 30) {
    locked.humanized_reason = locked.humanized_reason.substring(0, 30) + '... 🔒';
  }
  if (locked.recommendation_message) {
    locked.recommendation_message = '🔒 ميزة المدفوع — اشترك لرؤية التوقع الكاملة';
  }

  // علامة Paywall
  locked._paywall = {
    trap_detector: '🔒 ميزة المدفوع',
    early_trend: '🔒 ميزة المدفوع',
    trailing_stop: '🔒 ميزة المدفوع',
    full_narrative: '🔒 ميزة المدفوع',
  };

  return locked;
}

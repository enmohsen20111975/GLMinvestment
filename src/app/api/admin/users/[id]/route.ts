import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { requireAdminAsync } from '@/lib/admin-auth-server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// GET /api/admin/users/[id]
// Get a specific user by ID.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        image: true,
        is_active: true,
        subscription_tier: true,
        default_risk_tolerance: true,
        last_login: true,
        email_verified: true,
        created_at: true,
        updated_at: true,
        _count: {
          select: {
            portfolioPositions: { where: { is_active: true } },
            apiTokens: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username || user.email.split('@')[0],
        name: user.name,
        image: user.image,
        role: user.subscription_tier === 'admin' ? 'admin' : 
              user.subscription_tier === 'premium' ? 'premium' : 'user',
        status: user.is_active ? 'active' : 'inactive',
        emailVerified: user.email_verified,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login,
        loginCount: user._count?.apiTokens || 0,
        _count: {
          portfolio: user._count?.portfolioPositions || 0,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/users/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب المستخدم' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/[id]
// Update a user's role or status.
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json();
    const { role, status, name, email, password } = body;

    // Build update data
    const updateData: any = {};

    let targetTier: string | null = null;
    if (role) {
      const { PAID_TIERS } = await import('@/lib/subscription-gate');
      const normalizedRole = String(role).toLowerCase().trim();
      targetTier = normalizedRole === 'admin' ? 'admin' :
                   PAID_TIERS.has(normalizedRole) ? normalizedRole :
                   normalizedRole === 'premium' ? 'premium' :
                   normalizedRole === 'user' || normalizedRole === 'free' ? 'free' : normalizedRole;

      updateData.subscription_tier = targetTier;
      if (PAID_TIERS.has(targetTier)) {
        updateData.trial_ends_at = null; // Clear trial since user is upgraded
      }
    }

    if (status) {
      updateData.is_active = status === 'active';
    }

    if (name !== undefined) {
      updateData.name = name || null;
    }

    if (email) {
      // Check if email is already used by another user
      const existingUser = await db.user.findFirst({
        where: { 
          email,
          NOT: { id }
        },
      });
      if (existingUser) {
        return NextResponse.json(
          { success: false, error: 'البريد الإلكتروني مستخدم بالفعل' },
          { status: 400 }
        );
      }
      updateData.email = email;
    }

    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    // Update user
    const user = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        subscription_tier: true,
        is_active: true,
        updated_at: true,
      },
    });

    // If tier was updated, ensure UserSubscription table reflects active state and cache is cleared
    if (targetTier) {
      try {
        const { PAID_TIERS, invalidateSubStatusCache } = await import('@/lib/subscription-gate');
        const { randomUUID } = await import('crypto');

        if (PAID_TIERS.has(targetTier)) {
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const existingSub = await db.userSubscription.findFirst({ where: { user_id: id } });
          if (existingSub) {
            await db.userSubscription.update({
              where: { id: existingSub.id },
              data: {
                plan_id: targetTier,
                status: 'active',
                expires_at: expiresAt,
                payment_method: 'admin_grant',
                started_at: new Date().toISOString(),
              },
            });
          } else {
            await db.userSubscription.create({
              data: {
                id: randomUUID(),
                user_id: id,
                plan_id: targetTier,
                status: 'active',
                expires_at: expiresAt,
                payment_method: 'admin_grant',
                started_at: new Date().toISOString(),
              },
            });
          }
        } else if (targetTier === 'free') {
          const existingSub = await db.userSubscription.findFirst({ where: { user_id: id } });
          if (existingSub) {
            await db.userSubscription.update({
              where: { id: existingSub.id },
              data: { status: 'cancelled' },
            });
          }
        }

        invalidateSubStatusCache(id);
      } catch (subErr) {
        console.warn('[PATCH /api/admin/users/[id]] UserSubscription sync warning:', subErr);
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.subscription_tier === 'admin' ? 'admin' : 
              user.subscription_tier !== 'free' ? user.subscription_tier : 'user',
        status: user.is_active ? 'active' : 'inactive',
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    console.error('[PATCH /api/admin/users/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث المستخدم' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/[id]
// Delete a user.
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id } = await params;

    // Check if user exists
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, subscription_tier: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Prevent deleting the last admin
    if (user.subscription_tier === 'admin') {
      const adminCount = await db.user.count({
        where: { subscription_tier: 'admin' },
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          { success: false, error: 'لا يمكن حذف آخر مدير في النظام' },
          { status: 400 }
        );
      }
    }

    // Delete user (cascading deletes should handle related records)
    await db.user.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'تم حذف المستخدم بنجاح',
    });
  } catch (error) {
    console.error('[DELETE /api/admin/users/[id]] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء حذف المستخدم' },
      { status: 500 }
    );
  }
}

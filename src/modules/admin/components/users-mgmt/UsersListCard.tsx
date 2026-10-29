/**
 * users-mgmt/UsersListCard.tsx
 * ============================
 * Users list card — renders the table of users with avatar + role/status
 * badges + trial/promo badges + row dropdown menu (view/edit/delete/etc).
 *
 * Extracted from UsersManagement.tsx (1,543 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import {
  Activity,
  Calendar,
  CheckCircle,
  Clock,
  Crown,
  Eye,
  Key,
  Mail,
  MoreVertical,
  Shield,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  formatDate,
  getInitials,
  getPromoBadge,
  getRoleBadge,
  getStatusBadge,
  getTrialBadge,
  getUserActivityBadge,
} from './helpers';
import type { UserDetails } from './types';

export interface UsersListCardProps {
  loading: boolean;
  users: UserDetails[];
  filteredUsers: UserDetails[];
  promoStats: {
    totalWithPromo: number;
    activePromoUsers: number;
    expiredPromoUsers: number;
  } | null;
  onViewUser: (user: UserDetails) => void;
  onOpenPromoModal: (user: UserDetails) => void;
  onRevokePromo: (userId: string) => void;
  onUpdateUserRole: (userId: string, role: 'user' | 'premium' | 'admin') => void;
  onUpdateUserStatus: (userId: string, status: 'active' | 'inactive' | 'suspended') => void;
  onAskDelete: (user: UserDetails) => void;
}

export function UsersListCard({
  loading,
  users,
  filteredUsers,
  promoStats,
  onViewUser,
  onOpenPromoModal,
  onRevokePromo,
  onUpdateUserRole,
  onUpdateUserStatus,
  onAskDelete,
}: UsersListCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            قائمة المستخدمين
            <Badge variant="secondary">{filteredUsers.length}</Badge>
          </CardTitle>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="gap-1.5 border-purple-500/40 bg-primary/10 text-primary py-1 px-2.5"
            >
              <Ticket className="w-3.5 h-3.5 text-primary" />
              <span>مستخدمو البرومو كود:</span>
              <strong className="font-mono text-foreground font-bold">
                {promoStats?.totalWithPromo ?? users.filter((u) => !!u.promoCode).length}
              </strong>
              <span className="text-xs text-profit font-normal">
                (نشط:{' '}
                {promoStats?.activePromoUsers ??
                  users.filter((u) => u.promoCode?.is_active).length}
                )
              </span>
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">لا يوجد مستخدمين</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredUsers.map((user) => {
              const usageMaxPageViews = Math.max(
                1,
                ...filteredUsers.filter((u) => u.usage).map((u) => u.usage!.pageViews),
              );
              const usageMaxFeatureUses = Math.max(
                1,
                ...filteredUsers.filter((u) => u.usage).map((u) => u.usage!.featureUses),
              );

              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={user.image ?? undefined} />
                      <AvatarFallback>
                        {getInitials(user.name || '', user.email)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">
                          {user.name || user.username}
                        </span>
                        {getRoleBadge((user.role as string) || '')}
                        {getStatusBadge((user.status as string) || '')}
                        {getUserActivityBadge(Boolean(user.isActive))}
                        {getTrialBadge(user.trialStatus)}
                        {getPromoBadge(user.promoCode)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </span>
                        {user.emailVerified && (
                          <span className="text-profit flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            موثق
                          </span>
                        )}
                        {user.promoCode && (
                          <span className="flex items-center gap-1 text-xs text-primary font-mono">
                            <Ticket className="w-3 h-3" />
                            تفعيل: {formatDate((user.promoCode.redeemed_at as string | null) ?? null)}
                            {user.promoCode.expires_at &&
                              ` | انتهاء: ${formatDate(user.promoCode.expires_at)}`}
                          </span>
                        )}
                      </div>
                      {user.usage && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {user.usage.pageViews}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{
                                width: `${Math.min(100, (user.usage.pageViews / usageMaxPageViews) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            {user.usage.featureUses}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-warning rounded-full"
                              style={{
                                width: `${Math.min(100, (user.usage.featureUses / usageMaxFeatureUses) * 100)}%`,
                              }}
                            />
                          </div>
                          {user.usage.lastActive && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(user.usage.lastActive).toLocaleDateString('ar-EG', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                          {(user.loginCount ?? 0) > 0 && (
                            <span className="flex items-center gap-1">
                              <Key className="w-3 h-3" />
                              {user.loginCount ?? 0} دخول
                            </span>
                          )}
                          {(user.lastActive as any) && (
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" />
                              {new Date(user.lastActive as string).toLocaleDateString('ar-EG', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewUser(user)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>إجراءات</DropdownMenuLabel>
                        <DropdownMenuSeparator />

                        <DropdownMenuItem onClick={() => onViewUser(user)}>
                          <Eye className="w-4 h-4 ml-2" />
                          عرض التفاصيل
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>كود الخصم والاشتراك</DropdownMenuLabel>

                        <DropdownMenuItem onClick={() => onOpenPromoModal(user)}>
                          <Ticket className="w-4 h-4 ml-2 text-primary" />
                          {user.promoCode ? 'تعديل / تجديد البرومو كود' : 'تفعيل برومو كود للمستخدم'}
                        </DropdownMenuItem>

                        {user.promoCode && (
                          <DropdownMenuItem
                            onClick={() => onRevokePromo(user.id)}
                            className="text-loss"
                          >
                            <XCircle className="w-4 h-4 ml-2" />
                            إلغاء البرومو كود
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>تغيير الدور</DropdownMenuLabel>

                        <DropdownMenuItem onClick={() => onUpdateUserRole(user.id, 'user')}>
                          <Users className="w-4 h-4 ml-2" />
                          مستخدم عادي
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpdateUserRole(user.id, 'premium')}>
                          <Crown className="w-4 h-4 ml-2" />
                          بروميوم
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpdateUserRole(user.id, 'admin')}>
                          <Shield className="w-4 h-4 ml-2" />
                          مدير
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>تغيير الحالة</DropdownMenuLabel>

                        <DropdownMenuItem onClick={() => onUpdateUserStatus(user.id, 'active')}>
                          <CheckCircle className="w-4 h-4 ml-2 text-profit" />
                          تفعيل
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpdateUserStatus(user.id, 'inactive')}>
                          <XCircle className="w-4 h-4 ml-2 text-warning" />
                          تعطيل
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onUpdateUserStatus(user.id, 'suspended')}>
                          <XCircle className="w-4 h-4 ml-2 text-loss" />
                          إيقاف
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={() => onAskDelete(user)}
                          className="text-loss focus:text-loss"
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف المستخدم
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

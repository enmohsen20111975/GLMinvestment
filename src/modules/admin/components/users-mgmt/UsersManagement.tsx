/**
 * users-mgmt/UsersManagement.tsx (container)
 * ===========================================
 * Main UsersManagement container — admin panel for user CRUD, role/status
 * updates, promo-code assignment, expired-trial cleanup, and per-user
 * usage stats display.
 *
 * Originally 1,543 LOC (single file). Split into users-mgmt/ folder in
 * Task F-Phase3-FinalPush. Container now owns:
 *   - All fetch + mutation logic (users list, promo codes, role/status, cleanup)
 *   - All dialog visibility state + selected user state
 *   - All filter state (search/role/status/promo)
 * UI is delegated to dedicated sub-components (UsersFilters, UsersListCard,
 * UserDetailsDialog, AddUserDialog, DeleteUserDialog, CleanupDialog,
 * AssignPromoDialog).
 *
 * Reference:
 * - Constitution Rule 30 (CLIENT-FACING-STYLE): Arabic labels.
 * - Constitution Rule 62 (GIT-PUSH-DISCIPLINE).
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { adminFetch } from './helpers';
import type {
  AvailablePromoCode,
  NewUserForm,
  UserDetails,
  UsersResponse,
} from './types';
import { AddUserDialog } from './AddUserDialog';
import { CleanupDialog } from './CleanupDialog';
import { DeleteUserDialog } from './DeleteUserDialog';
import { AssignPromoDialog } from './AssignPromoDialog';
import { UsersFilters } from './UsersFilters';
import { UsersListCard } from './UsersListCard';
import { UserDetailsDialog } from './UserDetailsDialog';

export function UsersManagement() {
  const [users, setUsers] = useState<UserDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [promoFilter, setPromoFilter] = useState<string>('all');
  const [promoStats, setPromoStats] = useState<{
    totalWithPromo: number;
    activePromoUsers: number;
    expiredPromoUsers: number;
  } | null>(null);

  // Promo modal state
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoTargetUser, setPromoTargetUser] = useState<UserDetails | null>(null);
  const [availablePromoCodes, setAvailablePromoCodes] = useState<AvailablePromoCode[]>([]);
  const [selectedPromoCode, setSelectedPromoCode] = useState<string>('');
  const [customPromoTier, setCustomPromoTier] = useState<string>('all');
  const [customPromoDays, setCustomPromoDays] = useState<number>(30);
  const [customPromoCodeInput, setCustomPromoCodeInput] = useState<string>('');
  const [isAssigningPromo] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserDetails | null>(null);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);

  // Add user form state
  const [newUser, setNewUser] = useState<NewUserForm>({
    email: '',
    username: '',
    name: '',
    password: '',
    role: 'user',
  });

  const fetchAvailablePromoCodes = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/promo-codes');
      const data = await res.json();
      if (data.success && Array.isArray(data.promo_codes)) {
        setAvailablePromoCodes(
          data.promo_codes.filter((p: AvailablePromoCode) => p.is_active),
        );
      }
    } catch {
      /* ignore — admin already sees toast */
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (roleFilter !== 'all') params.append('role', roleFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (promoFilter !== 'all') params.append('promo', promoFilter);
      params.append('withUsage', '1');

      const res = await adminFetch(`/api/admin/users?${params.toString()}`);
      const data: UsersResponse = await res.json();

      if (data.success) {
        setUsers(data.users);
        if (data.promoStats) setPromoStats(data.promoStats);
      } else {
        toast.error('فشل في تحميل المستخدمين');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter, promoFilter]);

  useEffect(() => {
    fetchUsers();
    fetchAvailablePromoCodes();
  }, [fetchUsers, fetchAvailablePromoCodes]);

  // ─── User mutations ───────────────────────────────────────────────────

  const handleUpdateUserStatus = async (
    userId: string,
    status: 'active' | 'inactive' | 'suspended',
  ) => {
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('تم تحديث حالة المستخدم');
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في تحديث المستخدم');
    }
  };

  const handleUpdateUserRole = async (
    userId: string,
    role: 'user' | 'premium' | 'admin',
  ) => {
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('تم تحديث دور المستخدم');
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في تحديث المستخدم');
    }
  };

  // ─── Promo handlers ────────────────────────────────────────────────────

  const handleOpenPromoModal = (user: UserDetails) => {
    setPromoTargetUser(user);
    setSelectedPromoCode(user.promoCode?.code || '');
    setCustomPromoTier(user.promoCode?.plan_tier || 'all');
    setCustomPromoDays(user.promoCode?.premium_days || 30);
    setCustomPromoCodeInput('');
    setShowPromoModal(true);
    fetchAvailablePromoCodes();
  };

  const handleRevokePromo = async (userId: string) => {
    if (
      !confirm(
        'هل أنت متأكد من رغبتك في إلغاء كود الخصم لهذا المستخدم وإعادته للباقة المجانية؟',
      )
    ) {
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/promo`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم إلغاء كود الخصم بنجاح');
        if (selectedUser?.id === userId) {
          setSelectedUser({
            ...selectedUser,
            promoCode: null,
            role: 'user',
          });
        }
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل إلغاء كود الخصم');
      }
    } catch (e) {
      toast.error('حدث خطأ أثناء إلغاء كود الخصم');
    }
  };

  const handleAssignPromoSuccess = (updatedUser?: UserDetails) => {
    if (updatedUser && selectedUser?.id === updatedUser.id) {
      setSelectedUser(updatedUser);
    }
    fetchUsers();
  };

  // ─── Row actions ───────────────────────────────────────────────────────

  const handleViewUser = (user: UserDetails) => {
    setSelectedUser(user);
    setShowUserDetails(true);
  };

  const handleAskDelete = (user: UserDetails) => {
    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  // Filter users locally for instant feedback
  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      !searchQuery ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.promoCode &&
        user.promoCode.code.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

    let matchesPromo = true;
    if (promoFilter === 'with_promo') {
      matchesPromo = !!user.promoCode;
    } else if (promoFilter === 'active_promo') {
      matchesPromo = !!(user.promoCode && user.promoCode.is_active);
    } else if (promoFilter === 'expired_promo') {
      matchesPromo = !!(user.promoCode && user.promoCode.is_expired);
    } else if (promoFilter === 'vip') {
      matchesPromo = !!(
        user.promoCode &&
        (user.promoCode.plan_tier === 'all' || user.promoCode.plan_tier === 'developer')
      );
    } else if (promoFilter === 'premium') {
      matchesPromo = !!(user.promoCode && user.promoCode.plan_tier === 'premium');
    } else if (promoFilter === 'normal') {
      matchesPromo = !!(user.promoCode && user.promoCode.plan_tier === 'normal');
    } else if (promoFilter === 'without_promo') {
      matchesPromo = !user.promoCode;
    }

    return matchesSearch && matchesRole && matchesStatus && matchesPromo;
  });

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">إدارة المستخدمين</h2>
          <p className="text-sm text-muted-foreground">عرض وإدارة جميع مستخدمي المنصة</p>
        </div>

        <AddUserDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          newUser={newUser}
          onUserChange={setNewUser}
          onAdded={fetchUsers}
        />

        <CleanupDialog
          open={showCleanupDialog}
          onOpenChange={setShowCleanupDialog}
          onDone={fetchUsers}
        />
      </div>

      {/* Filters */}
      <UsersFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        promoFilter={promoFilter}
        onPromoFilterChange={setPromoFilter}
        loading={loading}
        onRefresh={fetchUsers}
      />

      {/* Users List */}
      <UsersListCard
        loading={loading}
        users={users}
        filteredUsers={filteredUsers}
        promoStats={promoStats}
        onViewUser={handleViewUser}
        onOpenPromoModal={handleOpenPromoModal}
        onRevokePromo={handleRevokePromo}
        onUpdateUserRole={handleUpdateUserRole}
        onUpdateUserStatus={handleUpdateUserStatus}
        onAskDelete={handleAskDelete}
      />

      {/* User Details Dialog */}
      <UserDetailsDialog
        open={showUserDetails}
        onOpenChange={setShowUserDetails}
        user={selectedUser}
        copiedCode={copiedCode}
        onCopiedCode={setCopiedCode}
        onEditPromo={handleOpenPromoModal}
        onRevokePromo={handleRevokePromo}
        onAskDelete={handleAskDelete}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteUserDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        user={userToDelete}
        onDeleted={fetchUsers}
      />

      {/* Assign / Update Promo Modal Dialog */}
      <AssignPromoDialog
        open={showPromoModal}
        onOpenChange={setShowPromoModal}
        targetUser={promoTargetUser}
        availablePromoCodes={availablePromoCodes}
        selectedPromoCode={selectedPromoCode}
        onSelectedPromoCodeChange={setSelectedPromoCode}
        customPromoTier={customPromoTier}
        onCustomPromoTierChange={setCustomPromoTier}
        customPromoDays={customPromoDays}
        onCustomPromoDaysChange={setCustomPromoDays}
        customPromoCodeInput={customPromoCodeInput}
        onCustomPromoCodeInputChange={setCustomPromoCodeInput}
        onAssigned={handleAssignPromoSuccess}
      />
    </div>
  );
}

export default UsersManagement;

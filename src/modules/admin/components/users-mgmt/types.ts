// UsersManagement types (Phase 3)
export interface UserDetails {
  id: string;
  email: string;
  name: string | null;
  subscription_tier: string;
  created_at: string;
  is_admin: boolean;
}

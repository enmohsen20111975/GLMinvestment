// UsersManagement helpers (Phase 3)

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
 Users,
 UserPlus,
 Trash2,
 Edit,
 Search,
 MoreVertical,
 Mail,
 Phone,
 Calendar,
 Shield,
 Crown,
 CheckCircle,
 XCircle,
 Clock,
 Loader2,
 Eye,
 EyeOff,
 Key,
 Activity,
 TrendingUp,
 Heart,
 Bell,
 Ticket,
 Gift,
 Sparkles,
 Copy,
 Check,
 RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
 DialogTrigger,
} from '@/components/ui/dialog';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getAdminToken } from '@/lib/admin-auth';

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

interface UserDetails {
 id: string;
 email: string;
 username: string;
 name?: string;
 image?: string;
 role: 'user' | 'premium' | 'admin';
 status: 'active' | 'inactive' | 'suspended';
 emailVerified: Date | null;
 createdAt: Date;
 updatedAt: Date;
 lastLoginAt?: Date | null;
 lastActive?: string | null;
 loginCount: number;
 isActive: boolean;
 trialStatus?: {

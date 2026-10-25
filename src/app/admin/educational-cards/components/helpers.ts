// helpers + formatters — extracted (Phase 3)

'use client';

export const dynamic = "force-dynamic";

/**
 * صفحة الأدمن: الكروت التعليمية
 * =================================
 *
 * تعرض الكروت التعليمية المُولّدة من Python Backend وتسمح بالتحكم اليدوي:
 * - جلب قائمة الدروس (GET /api/admin/educational-cards/lessons)
 * - جلب قائمة الكروت (GET /api/admin/educational-cards)
 * - توليد كروت جديدة (POST /api/admin/educational-cards)
 * - جلب كارت محدد (GET /api/admin/educational-cards/[id])
 * - نشر على تليجرام (POST /api/admin/educational-cards/[id]?action=publish)
 * - تحميل الصورة (GET /api/admin/educational-cards/[id]/image)
 * - حذف كارت (DELETE /api/admin/educational-cards/[id])
 *
 * Architecture: Python = THE BRAIN, Next.js = DISPLAY ONLY
 *
 * Legal Compliance: نستخدم "توقعات" فقط (تجنّب الكلمات المحظورة)
 * Platform: دليل الاستثمار
 * Logo: /logo-square.png
 * Colors: amber/emerald/teal/orange (no indigo/blue)
 */

import { WidgetCard } from '@/components/shared/WidgetCard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
 GraduationCap,
 BookOpen,
 TrendingUp,
 CheckCircle2,
 Clock,
 RefreshCw,
 Eye,
 Send,
 Download,
 X,
 Loader2,
 AlertCircle,
 AlertTriangle,
 Sparkles,
 Image as ImageIcon,
 FileText,
 Trash2,
 Layers,
 Film,
 Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { getAdminToken } from '../../../lib/admin-auth';

import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '../../../components/ui/table';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../../components/ui/select';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '../../../components/ui/dialog';
import { Checkbox } from '../../../components/ui/checkbox';
import { cn } from '../../../lib/utils';

// ============================================================================
// TYPES
// ============================================================================

type CardCategory = 'stocks' | 'crypto';
type CardStatus = 'pending' | 'generated' | 'published' | 'failed';
type CardStyle = 'modern' | 'classic' | 'simple';
type CategoryFilter = 'all' | CardCategory;
type DifficultyFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';

interface LessonItem {
 id: string;
 title?: string;
 category?: CardCategory | string;
 content?: string;
 description?: string;
 difficulty?: string;
 course_id?: string;
 course_title?: string;
 [key: string]: unknown;
}

interface LessonsResponse {
 success?: boolean;
 lessons?: LessonItem[];
 data?: LessonItem[];
 total?: number;
 error?: string;
}

interface CardListItem {
 id: string;
 status: CardStatus | string;
 title?: string;
 category?: CardCategory | string;
 created_at?: string;
 generated_at?: string;
 published_at?: string;
 has_image?: boolean;
 has_text?: boolean;
 has_video?: boolean;
 lesson_id?: string;
 style?: string;
 error?: string | null;
 [key: string]: unknown;
}

interface CardFull extends CardListItem {
 text?: string;
 content?: string;
 image_url?: string;
 video_url?: string;
 telegram_message_id?: string;
 metadata?: Record<string, unknown>;
}

interface ListResponse {
 success?: boolean;
 items?: CardListItem[];
 cards?: CardListItem[];
 data?: CardListItem[];
 total?: number;
 stats?: {
 total?: number;
 published?: number;
 lessons?: number;
 last_generated_at?: string;
 [key: string]: unknown;
 };
 error?: string;
}

interface SingleResponse {
 success?: boolean;
 card?: CardFull;
 data?: CardFull;
 error?: string;
}

interface GenerateResponse {
 success?: boolean;
 card?: CardFull;
 cards?: CardFull[];
 data?: CardFull | CardFull[];
 message?: string;
 error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORY_META: Record<
 CardCategory | 'other',
 { label: string; color: 'amber' | 'emerald' | 'teal' | 'orange' }
> = {
 stocks: { label: 'الأسهم', color: 'amber' },
 crypto: { label: 'العملات الرقمية', color: 'emerald' },
 other: { label: 'أخرى', color: 'teal' },
};

const STATUS_META: Record<
 CardStatus,
 { label: string; badgeClass: string; dotClass: string }
> = {
 pending: {
 label: 'قيد الانتظار',
 badgeClass:
 'border-warning/20 bg-warning/5 text-warning dark:text-warning',
 dotClass: 'bg-warning',
 },
 generated: {
 label: 'تم التوليد',
 badgeClass:
 'border-profit/20 bg-profit/5 text-profit',
 dotClass: 'bg-profit',
 },
 published: {
 label: 'تم النشر',

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
 'border-amber-500/30 bg-amber-50 text-amber-700 dark:text-amber-300',
 dotClass: 'bg-warning',
 },
 generated: {
 label: 'تم التوليد',
 badgeClass:
 'border-emerald-500/30 bg-emerald-50 text-profit dark:text-emerald-300',
 dotClass: 'bg-profit',
 },
 published: {
 label: 'تم النشر',
 badgeClass:
 'border-teal-500/30 bg-teal-50 text-teal-700 dark:text-teal-300',
 dotClass: 'bg-whale',
 },
 failed: {
 label: 'فشل',
 badgeClass:
 'border-red-500/30 bg-red-50 text-red-700 dark:text-red-300',
 dotClass: 'bg-danger',
 },
};

const STYLE_OPTIONS: { value: CardStyle; label: string; description: string }[] = [
 { value: 'modern', label: 'حديث', description: 'تصميم عصري بألوان متدرجة' },
 { value: 'classic', label: 'كلاسيكي', description: 'تصميم تقليدي أنيق' },
 { value: 'simple', label: 'بسيط', description: 'تصميم بسيط ومباشر' },
];

const NUM_CARDS_OPTIONS: { value: number; label: string }[] = [
 { value: 1, label: '1 كارت' },
 { value: 3, label: '3 كروت' },
 { value: 5, label: '5 كروت' },
 { value: 7, label: '7 كروت' },
];

const VIDEO_DURATION_OPTIONS: { value: number; label: string }[] = [
 { value: 3, label: '3 ثواني' },
 { value: 5, label: '5 ثواني' },
 { value: 8, label: '8 ثواني' },
];

const CATEGORY_FILTER_OPTIONS: { value: CategoryFilter; label: string }[] = [
 { value: 'all', label: 'كل الفئات' },
 { value: 'stocks', label: 'الأسهم' },
 { value: 'crypto', label: 'العملات الرقمية' },
];

const DIFFICULTY_FILTER_OPTIONS: { value: DifficultyFilter; label: string }[] = [
 { value: 'all', label: 'كل المستويات' },
 { value: 'beginner', label: 'مبتدئ' },
 { value: 'intermediate', label: 'متوسط' },
 { value: 'advanced', label: 'متقدم' },
];

const DIFFICULTY_META: Record<DifficultyFilter, { label: string; color: string }> = {
 all: { label: 'كل المستويات', color: 'text-gray-500' },
 beginner: { label: 'مبتدئ', color: 'text-profit' },
 intermediate: { label: 'متوسط', color: 'text-warning' },
 advanced: { label: 'متقدم', color: 'text-danger' },
};

// ============================================================================
// HELPERS
// ============================================================================

function normalizeDifficulty(d: unknown): DifficultyFilter {
 if (!d) return 'all';
 const diff = String(d).toLowerCase();
 if (diff.includes('beginner') || diff.includes('مبتدئ')) return 'beginner';
 if (diff.includes('intermediate') || diff.includes('متوسط')) return 'intermediate';
 if (diff.includes('advanced') || diff.includes('متقدم')) return 'advanced';
 return 'all';
}

function normalizeCategory(c: unknown): CardCategory | 'other' {
 if (c === 'stocks' || c === 'crypto') return c;
 if (typeof c === 'string' && c.toLowerCase().includes('crypto')) return 'crypto';
 if (typeof c === 'string' && c.toLowerCase().includes('stock')) return 'stocks';
 return 'other';
}

function normalizeStatus(s: unknown): CardStatus {
 if (s === 'pending' || s === 'generated' || s === 'published' || s === 'failed') {
 return s;
 }
 return 'pending';
}

function normalizeStyle(s: unknown): CardStyle {
 if (s === 'modern' || s === 'classic' || s === 'simple') return s;
 return 'modern';
}

function getCategoryMeta(c: unknown) {
 const normalized = normalizeCategory(c);
 return CATEGORY_META[normalized] || CATEGORY_META.other;
}

function getColorClasses(
 color: 'amber' | 'emerald' | 'teal' | 'orange'
): { text: string; bg: string; border: string; hover: string } {
 return {
 amber: {
 text: 'text-warning',
 bg: 'bg-amber-100 dark:bg-amber-950/50',
 border: 'border-amber-300 dark:border-amber-800',
 hover: 'hover:bg-amber-200 dark:hover:bg-amber-900/60',
 },
 emerald: {
 text: 'text-profit',
 bg: 'bg-emerald-100 dark:bg-emerald-950/50',
 border: 'border-emerald-300 dark:border-emerald-800',
 hover: 'hover:bg-emerald-200 dark:hover:bg-emerald-900/60',
 },
 teal: {
 text: 'text-whale',
 bg: 'bg-teal-100 dark:bg-teal-950/50',
 border: 'border-teal-300 dark:border-teal-800',
 hover: 'hover:bg-teal-200 dark:hover:bg-teal-900/60',
 },
 orange: {
 text: 'text-orange-600 dark:text-orange-400',
 bg: 'bg-orange-100 dark:bg-orange-950/50',
 border: 'border-orange-300 dark:border-orange-800',
 hover: 'hover:bg-orange-200 dark:hover:bg-orange-900/60',
 },
 }[color];
}

function formatDate(value?: string | null): string {
 if (!value) return '—';
 try {
 const d = new Date(value);
 if (Number.isNaN(d.getTime())) return String(value);
 return d.toLocaleString('ar-EG', {
 year: 'numeric',
 month: '2-digit',
 day: '2-digit',
 hour: '2-digit',
 minute: '2-digit',
 });
 } catch {
 return String(value);
 }
}

function formatRelative(value?: string | null): string {
 if (!value) return '—';
 try {
 const d = new Date(value);
 if (Number.isNaN(d.getTime())) return String(value);
 const diff = Date.now() - d.getTime();
 const minutes = Math.floor(diff / 60000);
 if (minutes < 1) return 'الآن';
 if (minutes < 60) return `منذ ${minutes} دقيقة`;
 const hours = Math.floor(minutes / 60);
 if (hours < 24) return `منذ ${hours} ساعة`;
 const days = Math.floor(hours / 24);
 if (days < 30) return `منذ ${days} يوم`;
 return formatDate(value);
 } catch {
 return String(value);
 }
}

function downloadBlob(blob: Blob, filename: string) {
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function AdminEducationalCardsPage() {
 // Helper: admin fetch مع توكن المصادقة
 const adminFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
 const token = await getAdminToken();
 if (!token) {
 return new Response(JSON.stringify({ success: false, error: 'غير مسجل الدخول' }), {
 status: 401,
 headers: { 'Content-Type': 'application/json' },
 });
 }
 const headers = new Headers(options.headers);
 headers.set('X-Admin-Token', token);
 return fetch(url, { ...options, headers });
 }, []);

 // State: data
 const [cards, setCards] = useState<CardListItem[]>([]);
 const [lessons, setLessons] = useState<LessonItem[]>([]);
 const [stats, setStats] = useState<{
 total: number;
 published: number;
 lessonsCount: number;
 lastGeneratedAt?: string;
 }>({ total: 0, published: 0, lessonsCount: 0 });

 // State: filters & generation settings
 const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
 const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
 const [selectedLessonId, setSelectedLessonId] = useState<string>('');
 const [cardStyle, setCardStyle] = useState<CardStyle>('modern');
 const [numCards, setNumCards] = useState<number>(3);
 const [generateVideo, setGenerateVideo] = useState<boolean>(false);
 const [videoDuration, setVideoDuration] = useState<number>(5);

 // State: UI
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [lessonsLoading, setLessonsLoading] = useState(false);
 const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
 const [generating, setGenerating] = useState(false);

 // State: preview modal
 const [previewCard, setPreviewCard] = useState<CardFull | null>(null);
 const [previewLoading, setPreviewLoading] = useState(false);
 const [previewOpen, setPreviewOpen] = useState(false);

 // State: actions
 const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
 const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

 // --------------------------------------------------------------------------
 // Filtered lessons (client-side difficulty filter + grouping)
 // --------------------------------------------------------------------------
 const filteredLessons = useMemo(() => {
 return lessons.filter((lesson) => {
 if (difficultyFilter === 'all') return true;
 const normalizedDifficulty = normalizeDifficulty(lesson.difficulty);
 return normalizedDifficulty === difficultyFilter;
 });
 }, [lessons, difficultyFilter]);

 // Group lessons by category for better display
 const groupedLessons = useMemo(() => {
 const groups: Record<string, LessonItem[]> = {};
 filteredLessons.forEach((lesson) => {
 const cat = normalizeCategory(lesson.category) || 'other';
 if (!groups[cat]) groups[cat] = [];
 groups[cat].push(lesson);
 });
 return groups;
 }, [filteredLessons]);

 // --------------------------------------------------------------------------
 // Fetch lessons
 // --------------------------------------------------------------------------
 const fetchLessons = useCallback(async () => {
 setLessonsLoading(true);
 try {
 const params = new URLSearchParams();
 if (categoryFilter !== 'all') params.set('category', categoryFilter);

 const res = await adminFetch(
 `/api/admin/educational-cards/lessons${params.toString() ? `?${params.toString()}` : ''}`,
 { cache: 'no-store' }
 );
 const data: LessonsResponse = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في جلب الدروس');
 return;
 }

 const rawList = data.lessons || data.data?.items || data.data || (Array.isArray(data) ? data : []);
 const list: LessonItem[] = Array.isArray(rawList) ? rawList : [];
 setLessons(list);
 // Auto-select first lesson if available and none selected
 if (list.length > 0 && !selectedLessonId) {
 setSelectedLessonId(list[0].id);
 }
 } catch (err) {
 console.error('[admin/educational-cards] fetchLessons error:', err);
 toast.error('خطأ في جلب الدروس');
 } finally {
 setLessonsLoading(false);
 }
 }, [categoryFilter, selectedLessonId]);

 // --------------------------------------------------------------------------
 // Fetch cards list
 // --------------------------------------------------------------------------
 const fetchCards = useCallback(
 async (mode: 'initial' | 'refresh' = 'refresh') => {
 if (mode === 'initial') {
 setLoading(true);
 } else {
 setRefreshing(true);
 }
 try {
 const params = new URLSearchParams();
 params.set('limit', '50');
 if (categoryFilter !== 'all') params.set('category', categoryFilter);

 const res = await adminFetch(
 `/api/admin/educational-cards?${params.toString()}`,
 { cache: 'no-store' }
 );
 const data: ListResponse = await res.json();

 if (!res.ok) {
 // 403/401 = مشكلة مصادقة (مش مشكلة اتصال بالباك اند)
 if (res.status === 403 || res.status === 401) {
 toast.error('ليس لديك صلاحية الوصول');
 return;
 }
 setBackendOnline(false);
 toast.error(data.error || 'فشل في جلب الكروت');
 return;
 }

 setBackendOnline(true);
 const list = data.items || data.cards || (Array.isArray(data.data) ? data.data : []);
 setCards(Array.isArray(list) ? list : []);

 if (data.stats) {
 setStats({
 total: data.stats.total ?? list.length,
 published:
 data.stats.published ??
 list.filter((c) => normalizeStatus(c.status) === 'published').length,
 lessonsCount: data.stats.lessons ?? 0,
 lastGeneratedAt: data.stats.last_generated_at,
 });
 } else {
 // Compute stats from the list as a fallback
 const publishedCount = list.filter(
 (c) => normalizeStatus(c.status) === 'published'
 ).length;
 const lastGenerated = list.find(
 (c) =>
 normalizeStatus(c.status) === 'generated' ||
 normalizeStatus(c.status) === 'published'
 );
 setStats({
 total: list.length,
 published: publishedCount,
 lessonsCount: stats.lessonsCount,
 lastGeneratedAt: lastGenerated?.generated_at || lastGenerated?.created_at,
 });
 }
 } catch (err) {
 // Connection error (network failure) = الباك اند فعلاً مش متاح
 setBackendOnline(false);
 console.error('[admin/educational-cards] fetchCards error:', err);
 toast.error('تعذّر تحميل الكروت التعليمية');
 } finally {
 if (mode === 'initial') {
 setLoading(false);
 } else {
 setRefreshing(false);
 }
 }
 },
 [categoryFilter, stats.lessonsCount]
 );

 // Initial load - fetch both lessons and cards
 useEffect(() => {
 fetchCards('initial');
 fetchLessons();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Refetch when category filter changes
 useEffect(() => {
 if (!loading) {
 fetchCards('refresh');
 fetchLessons();
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [categoryFilter]);

 // --------------------------------------------------------------------------
 // Selected lesson preview
 // --------------------------------------------------------------------------
 const selectedLesson = useMemo(() => {
 if (!selectedLessonId) return null;
 return lessons.find((l) => l.id === selectedLessonId) || null;
 }, [lessons, selectedLessonId]);

 // --------------------------------------------------------------------------
 // Generate cards
 // --------------------------------------------------------------------------
 // === Handlers للميزات الجديدة ===
 const [generatingExtra, setGeneratingExtra] = useState(false);

 const handleGenerateInfographic = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد الإنفوجرافيك...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'infographic' }),
 });
 const data = await res.json();
 if (data.success) {
 const info = data.data?.data || data.data;
 toast.success('تم توليد الإنفوجرافيك ✓', { id: toastId });
 if (info?.infographic_url) {
 window.open(info.infographic_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد الإنفوجرافيك', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGeneratePDF = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد PDF...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'pdf' }),
 });
 const data = await res.json();
 if (data.success) {
 const pdf = data.data?.data || data.data;
 toast.success('تم توليد PDF ✓', { id: toastId });
 if (pdf?.pdf_url) {
 window.open(pdf.pdf_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد PDF', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGenerateGIF = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد GIF متحرك...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'gif' }),
 });
 const data = await res.json();
 if (data.success) {
 const gif = data.data?.data || data.data;
 toast.success('تم توليد GIF ✓', { id: toastId });
 if (gif?.gif_url) {
 window.open(gif.gif_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد GIF', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGenerate = async () => {
 if (!selectedLessonId) {
 toast.error('من فضلك اختر درساً أولاً');
 return;
 }

 setGenerating(true);
 const toastId = toast.loading('جاري توليد الكروت التعليمية...');

 try {
 const body: Record<string, unknown> = {
 lesson_id: selectedLessonId,
 style: cardStyle,
 num_cards: numCards,
 generate_video: generateVideo,
 };

 if (generateVideo) {
 body.video_duration = videoDuration;
 }

 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const data: GenerateResponse = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في توليد الكروت', { id: toastId });
 return;
 }

 const message =
 data.message ||
 (Array.isArray(data.cards) && data.cards.length > 0
 ? `تم توليد ${data.cards.length} كارت بنجاح`
 : 'تم توليد الكروت بنجاح');
 toast.success(message, { id: toastId });

 // Refresh the list
 await fetchCards('refresh');
 } catch (err) {
 console.error('[admin/educational-cards] generate error:', err);
 toast.error('خطأ في توليد الكروت', { id: toastId });
 } finally {
 setGenerating(false);
 }
 };

 // --------------------------------------------------------------------------
 // View single card (open modal)
 // --------------------------------------------------------------------------
 const handleView = async (cardId: string) => {
 setPreviewOpen(true);
 setPreviewLoading(true);
 setPreviewCard(null);
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(cardId)}`,
 { cache: 'no-store' }
 );
 const data: SingleResponse = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في جلب الكارت');
 setPreviewOpen(false);
 return;
 }

 const card = data.card || data.data || null;
 setPreviewCard(card);
 } catch (err) {
 console.error('[admin/educational-cards] view error:', err);
 toast.error('خطأ في جلب الكارت');
 setPreviewOpen(false);
 } finally {
 setPreviewLoading(false);
 }
 };

 // --------------------------------------------------------------------------
 // Publish to Telegram
 // --------------------------------------------------------------------------
 const handlePublish = async (cardId: string) => {
 setPublishingIds((prev) => new Set(prev).add(cardId));
 const toastId = toast.loading('جاري النشر على تليجرام...');
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(cardId)}?action=publish`,
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({}),
 }
 );
 const data = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل النشر على تليجرام', { id: toastId });
 return;
 }

 toast.success(data.message || 'تم النشر على تليجرام بنجاح', { id: toastId });
 // If preview is open, update it
 if (previewCard?.id === cardId && previewCard) {
 setPreviewCard({ ...previewCard, status: 'published' });
 }
 // Refresh list
 await fetchCards('refresh');
 } catch (err) {
 console.error('[admin/educational-cards] publish error:', err);
 toast.error('خطأ في النشر على تليجرام', { id: toastId });
 } finally {
 setPublishingIds((prev) => {
 const next = new Set(prev);
 next.delete(cardId);
 return next;
 });
 }
 };

 // --------------------------------------------------------------------------
 // Delete a card
 // --------------------------------------------------------------------------
 const handleDelete = async (cardId: string) => {
 if (!window.confirm('هل أنت متأكد من حذف هذا الكارت؟ لا يمكن التراجع عن هذا الإجراء.')) {
 return;
 }

 setDeletingIds((prev) => new Set(prev).add(cardId));
 const toastId = toast.loading('جاري حذف الكارت...');
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(cardId)}`,
 { method: 'DELETE' }
 );
 const data = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في حذف الكارت', { id: toastId });
 return;
 }

 toast.success('تم حذف الكارت بنجاح', { id: toastId });

 // If preview is open with the deleted card, close it
 if (previewCard?.id === cardId) {
 setPreviewOpen(false);
 setPreviewCard(null);
 }
 // Refresh list
 await fetchCards('refresh');
 } catch (err) {
 console.error('[admin/educational-cards] delete error:', err);
 toast.error('خطأ في حذف الكارت', { id: toastId });
 } finally {
 setDeletingIds((prev) => {
 const next = new Set(prev);
 next.delete(cardId);
 return next;
 });
 }
 };

 // --------------------------------------------------------------------------
 // Download image
 // --------------------------------------------------------------------------
 const handleDownloadImage = async (card: CardFull | CardListItem) => {
 if (!card.id) {
 toast.error('معرف الكارت غير متوفر');
 return;
 }
 const toastId = toast.loading('جاري تحميل الصورة...');
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(card.id)}/image`,
 { cache: 'no-store' }
 );
 if (!res.ok) {
 const data = await res.json().catch(() => ({}));
 toast.error(data.error || 'فشل في تحميل الصورة', { id: toastId });
 return;
 }
 const blob = await res.blob();
 const title = card.title || card.id;
 const filename = `كارت-تعليمي-${title}.png`;
 downloadBlob(blob, filename);
 toast.success('تم تحميل الصورة', { id: toastId });
 } catch (err) {
 console.error('[admin/educational-cards] download image error:', err);
 toast.error('خطأ في تحميل الصورة', { id: toastId });
 }
 };

 // --------------------------------------------------------------------------
 // Render: Loading state
 // --------------------------------------------------------------------------
 if (loading) {
 return (
 <div
 dir="rtl"
 className="min-h-screen bg-gradient-to-br from-amber-50/30 via-background to-emerald-50/30 dark:from-amber-950/10 dark:via-background dark:to-emerald-950/10 flex items-center justify-center"
 >
 <div className="text-center space-y-4">
 <Loader2 className="w-12 h-12 animate-spin text-warning mx-auto" />
 <p className="text-muted-foreground">جاري تحميل الكروت التعليمية...</p>
 </div>
 </div>
 );
 }

 // --------------------------------------------------------------------------
 // Render: Main
 // --------------------------------------------------------------------------
 return (
 <div
 dir="rtl"
 className="min-h-screen bg-gradient-to-br from-amber-50/30 via-background to-emerald-50/30 dark:from-amber-950/10 dark:via-background dark:to-emerald-950/10"
 >
 <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
 {/* ====================================================================
 HEADER
 ==================================================================== */}
 <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
 <div className="flex items-center gap-4">
 <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 ring-2 ring-amber-500/30">
 <img
 src="/logo-square.png"
 alt="دليل الاستثمار"
 className="w-full h-full object-cover"
 />
 </div>
 <div>
 <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 text-foreground">
 <GraduationCap className="w-7 h-7 text-warning" />
 الكروت التعليمية
 </h1>
 <p className="text-sm text-muted-foreground mt-0.5">
 دليل الاستثمار - أنشئ كروت تعليمية احترافية للنشر
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <Button
 variant="outline"
 size="sm"
 onClick={() => {
 fetchCards('refresh');
 fetchLessons();
 }}
 disabled={refreshing}
 className="border-amber-300 hover:bg-amber-50 dark:border-amber-800 dark:hover:bg-amber-950/40"
 >
 <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
 تحديث
 </Button>
 </div>
 </header>

 {/* Backend status alert */}
 {backendOnline === false && (
 <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-800 p-4 flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
 <div className="flex-1">
 <p className="font-semibold text-red-800 dark:text-red-300">
 تعذّر تحميل الكروت التعليمية
 </p>
 <p className="text-sm text-red-700 mt-1">
 حاول مرة أخرى بعد لحظات. الكروت لا يمكن
 جلبها أو توليدها الآن.
 </p>
 </div>
 </div>
 )}

 {/* ====================================================================
 STATS CARDS
 ==================================================================== */}
 <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
 {/* Total generated */}
 <Card className="border-amber-200/60 dark:border-amber-900/50 bg-gradient-to-br from-amber-50/60 to-amber-100/30 dark:from-amber-950/30 dark:to-amber-900/10">
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between text-sm font-medium text-amber-700 dark:text-amber-300">
 <span>إجمالي الكروت المولّدة</span>
 <Layers className="w-4 h-4" />
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">
 {stats.total}
 </div>
 <p className="text-xs text-muted-foreground mt-1">كارت تعليمي</p>
 </CardContent>
 </Card>

 {/* Published */}
 <Card className="border-emerald-200/60 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/60 to-emerald-100/30 dark:from-emerald-950/30 dark:to-emerald-900/10">
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between text-sm font-medium text-profit dark:text-emerald-300">
 <span>الكروت المنشورة</span>
 <CheckCircle2 className="w-4 h-4" />
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-3xl font-bold text-profit dark:text-emerald-300">
 {stats.published}
 </div>
 <p className="text-xs text-muted-foreground mt-1">منشور على تليجرام</p>
 </CardContent>
 </Card>

{/* Lessons available */}
 <Card className="border-teal-200/60 dark:border-teal-900/50 bg-gradient-to-br from-teal-50/60 to-teal-100/30 dark:from-teal-950/30 dark:to-teal-900/10">
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between text-sm font-medium text-teal-700 dark:text-teal-300">
 <span>الدروس المتاحة</span>
 <BookOpen className="w-4 h-4" />
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-3xl font-bold text-teal-700 dark:text-teal-300">
 {stats.lessonsCount || lessons.length}
 </div>
 <div className="mt-2 space-y-1">
 {Object.entries(groupedLessons).map(([cat, catLessons]) => (
 <div key={cat} className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">{CATEGORY_META[cat as CardCategory]?.label || cat}</span>
 <Badge variant="outline" className="text-[10px] h-5">
 {catLessons.length} درس
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Last generation */}
 <Card className="border-orange-200/60 dark:border-orange-900/50 bg-gradient-to-br from-orange-50/60 to-orange-100/30 dark:from-orange-950/30 dark:to-orange-900/10">
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center justify-between text-sm font-medium text-orange-700 dark:text-orange-300">
 <span>آخر توليد</span>
 <Clock className="w-4 h-4" />
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-base font-bold text-orange-700 dark:text-orange-300 leading-tight">
 {formatRelative(stats.lastGeneratedAt)}
 </div>
 <p className="text-xs text-muted-foreground mt-1">آخر كارت تم توليده</p>
 </CardContent>
 </Card>
 </section>

 {/* ====================================================================
 AVAILABLE LESSONS + GENERATION SETTINGS
 ==================================================================== */}
 <section>
 <Card className="border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-l from-amber-50/40 to-emerald-50/40 dark:from-amber-950/20 dark:to-emerald-950/20">
 <CardHeader>
 <CardTitle className="flex items-center gap-2 text-base">
 <Sparkles className="w-5 h-5 text-warning" />
 إنشاء كروت تعليمية جديدة
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-6">
{/* Category filter */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground">
 الفئة
 </label>
 <Select
 value={categoryFilter}
 onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}
 >
 <SelectTrigger className="w-full sm:w-56">
 <SelectValue placeholder="كل الفئات" />
 </SelectTrigger>
 <SelectContent>
 {CATEGORY_FILTER_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={opt.value}>
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Difficulty filter */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground">
 المستوى
 </label>
 <Select
 value={difficultyFilter}
 onValueChange={(v) => setDifficultyFilter(v as DifficultyFilter)}
 >
 <SelectTrigger className="w-full sm:w-56">
 <SelectValue placeholder="كل المستويات" />
 </SelectTrigger>
 <SelectContent>
 {DIFFICULTY_FILTER_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={opt.value}>
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

{/* Lesson selection */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground">
 اختر الدرس
 </label>
 {lessonsLoading ? (
 <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
 <Loader2 className="w-4 h-4 animate-spin" />
 جاري تحميل الدروس...
 </div>
 ) : lessons.length === 0 ? (
 <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
 <AlertCircle className="w-4 h-4" />
 لا توجد دروس متاحة
 </div>
 ) : (
 <Select
 value={selectedLessonId}
 onValueChange={(v) => setSelectedLessonId(v)}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="اختر درساً..." />
 </SelectTrigger>
 <SelectContent>
 {Object.entries(groupedLessons).map(([cat, catLessons]) => {
 const catMeta = getCategoryMeta(cat);
 const catColor = catMeta.color;
 return (
 <React.Fragment key={cat}>
 <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border mb-1">
 {catMeta.label}
 </div>
 {catLessons.map((lesson) => {
 const lessonDiff = normalizeDifficulty(lesson.difficulty);
 const diffMeta = DIFFICULTY_META[lessonDiff];
 return (
 <SelectItem key={lesson.id} value={lesson.id}>
 <span className="flex items-center justify-between gap-2 w-full">
 <span className="flex items-center gap-2">
 <span className={cn('text-xs', catColor === 'amber' ? 'text-warning' : catColor === 'emerald' ? 'text-profit' : 'text-whale')}>
 ●
 </span>
 <span className="truncate max-w-[200px]">{lesson.title || lesson.id}</span>
 </span>
 {lessonDiff !== 'all' && (
 <Badge 
 variant="outline" 
 className={cn('text-[10px] h-5 px-1.5', diffMeta.color)}
 >
 {diffMeta.label}
 </Badge>
 )}
 </span>
 </SelectItem>
 );
 })}
 </React.Fragment>
 );
 })}
 </SelectContent>
 </Select>
 )}
 </div>

{/* Lesson preview */}
 {selectedLesson && (
 <div className="rounded-lg border border-border bg-muted/30 p-4">
 <div className="flex items-center justify-between mb-2">
 <p className="text-xs text-muted-foreground flex items-center gap-1">
 <BookOpen className="w-3.5 h-3.5" />
 معاينة الدرس المختار
 </p>
 <div className="flex items-center gap-2">
 {(() => {
 const lessonCat = normalizeCategory(selectedLesson.category);
 const lessonDiff = normalizeDifficulty(selectedLesson.difficulty);
 return (
 <>
 <Badge variant="outline" className={cn('text-xs', lessonCat === 'stocks' ? 'text-warning' : lessonCat === 'crypto' ? 'text-profit' : 'text-whale')}>
 {CATEGORY_META[lessonCat]?.label || 'أخرى'}
 </Badge>
 {lessonDiff !== 'all' && (
 <Badge variant="outline" className={cn('text-xs', DIFFICULTY_META[lessonDiff].color)}>
 {DIFFICULTY_META[lessonDiff].label}
 </Badge>
 )}
 </>
 );
 })()}
 </div>
 </div>
 <p className="font-semibold text-foreground mb-1">
 {selectedLesson.title || selectedLesson.id}
 </p>
 <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
 {selectedLesson.content ||
 selectedLesson.description ||
 'لا يوجد محتوى متاح للعرض'}
 </p>
 </div>
 )}

 {/* Generation settings */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
 {/* Card style */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground">
 نمط الكارت
 </label>
 <Select
 value={cardStyle}
 onValueChange={(v) => setCardStyle(normalizeStyle(v))}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="اختر النمط" />
 </SelectTrigger>
 <SelectContent>
 {STYLE_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={opt.value}>
 <span className="flex flex-col">
 <span>{opt.label}</span>
 <span className="text-xs text-muted-foreground">
 {opt.description}
 </span>
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Number of cards */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground">
 عدد الكروت
 </label>
 <Select
 value={String(numCards)}
 onValueChange={(v) => setNumCards(Number(v))}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="عدد الكروت" />
 </SelectTrigger>
 <SelectContent>
 {NUM_CARDS_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={String(opt.value)}>
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Video duration (only when video enabled) */}
 <div className="space-y-1.5">
 <label
 className={cn(
 'text-xs font-medium',
 generateVideo
 ? 'text-muted-foreground'
 : 'text-muted-foreground/60'
 )}
 >
 مدة كل كارت في الفيديو
 </label>
 <Select
 value={String(videoDuration)}
 onValueChange={(v) => setVideoDuration(Number(v))}
 disabled={!generateVideo}
 >
 <SelectTrigger className="w-full">
 <SelectValue placeholder="مدة الفيديو" />
 </SelectTrigger>
 <SelectContent>
 {VIDEO_DURATION_OPTIONS.map((opt) => (
 <SelectItem key={opt.value} value={String(opt.value)}>
 {opt.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 {/* Generate video checkbox */}
 <div className="flex items-center space-x-2 space-x-reverse">
 <Checkbox
 id="generate-video"
 checked={generateVideo}
 onCheckedChange={(checked) =>
 setGenerateVideo(checked === true)
 }
 />
 <label
 htmlFor="generate-video"
 className="text-sm font-medium leading-none cursor-pointer flex items-center gap-1.5"
 >
 <Film className="w-4 h-4 text-warning" />
 توليد فيديو من الكروت (لو متاح)
 </label>
 </div>

 {/* Extra formats - Infographic / PDF / GIF */}
 <div className="flex flex-wrap gap-2 justify-end mb-3">
 <Button
 onClick={handleGenerateInfographic}
 disabled={generatingExtra || !selectedLessonId}
 variant="outline"
 className="border-amber-500/40 text-amber-700 hover:bg-warning/10 gap-2"
 >
 {generatingExtra ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
 إنفوجرافيك
 </Button>
 <Button
 onClick={handleGeneratePDF}
 disabled={generatingExtra || !selectedLessonId}
 variant="outline"
 className="border-red-500/40 text-red-700 hover:bg-danger/10 gap-2"
 >
 {generatingExtra ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
 PDF
 </Button>
 <Button
 onClick={handleGenerateGIF}
 disabled={generatingExtra || !selectedLessonId}
 variant="outline"
 className="border-purple-500/40 text-purple-700 dark:text-purple-400 hover:bg-purple-500/10 gap-2"
 >
 {generatingExtra ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
 GIF متحرك
 </Button>
 </div>

 {/* Generate button - كروت */}
 <div className="flex justify-end">
 <Button
 onClick={handleGenerate}
 disabled={generating || !selectedLessonId}
 className="bg-profit hover:bg-emerald-700 text-white gap-2"
 >
 {generating ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 جاري التوليد...
 </>
 ) : (
 <>
 <Sparkles className="w-4 h-4" />
 توليد الكروت
 </>
 )}
 </Button>
 </div>
 </CardContent>
 </Card>
 </section>

 {/* ====================================================================
 CARDS TABLE
 ==================================================================== */}
 <section>
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center justify-between text-base">
 <span className="flex items-center gap-2">
 <Layers className="w-5 h-5 text-profit" />
 جدول الكروت المولّدة
 </span>
 <Badge
 variant="secondary"
 className="bg-amber-100 text-amber-700 dark:text-amber-300 border-amber-300/40"
 >
 {cards.length} كارت
 </Badge>
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 {cards.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
 <GraduationCap className="w-12 h-12 text-muted-foreground/40 mb-3" />
 <p className="text-muted-foreground font-medium">لا توجد كروت</p>
 <p className="text-sm text-muted-foreground/70 mt-1">
 جرّب توليد كروت جديدة من الإعدادات في الأعلى أو غيّر الفلاتر
 </p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <Table>
 <TableHeader>
 <TableRow className="bg-muted/40">
 <TableHead className="text-right">التاريخ</TableHead>
 <TableHead className="text-right">العنوان</TableHead>
 <TableHead className="text-right">الفئة</TableHead>
 <TableHead className="text-right">الحالة</TableHead>
 <TableHead className="text-right">إجراءات</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {cards.map((card) => {
 const status = normalizeStatus(card.status);
 const catMeta = getCategoryMeta(card.category);
 const catColors = getColorClasses(catMeta.color);
 const statusMeta = STATUS_META[status];
 const isPublishing = publishingIds.has(card.id);
 const isDeleting = deletingIds.has(card.id);

 return (
 <TableRow key={card.id}>
 <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
 {formatDate(card.generated_at || card.created_at)}
 </TableCell>
 <TableCell className="max-w-xs">
 <p className="text-sm truncate" title={card.title || ''}>
 {card.title || '—'}
 </p>
 </TableCell>
 <TableCell>
 <Badge
 className={cn(
 'gap-1.5',
 catColors.bg,
 catColors.text,
 catColors.border
 )}
 variant="outline"
 >
 {catMeta.label}
 </Badge>
 </TableCell>
 <TableCell>
 <Badge
 className={cn('gap-1.5', statusMeta.badgeClass)}
 variant="outline"
 >
 <span
 className={cn(
 'w-1.5 h-1.5 rounded-full',
 statusMeta.dotClass
 )}
 />
 {statusMeta.label}
 </Badge>
 </TableCell>
 <TableCell>
 <div className="flex items-center gap-1">
 <Button
 variant="ghost"
 size="sm"
 onClick={() => handleView(card.id)}
 className="h-8 w-8 p-0 text-profit hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
 title="عرض"
 >
 <Eye className="w-4 h-4" />
 </Button>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => handlePublish(card.id)}
 disabled={
 isPublishing ||
 status === 'published' ||
 status === 'pending'
 }
 className="h-8 w-8 p-0 text-whale hover:bg-teal-50 dark:hover:bg-teal-950/40 disabled:opacity-40"
 title={
 status === 'published'
 ? 'تم النشر بالفعل'
 : status === 'pending'
 ? 'الكارت قيد الانتظار'
 : 'نشر على تليجرام'
 }
 >
 {isPublishing ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Send className="w-4 h-4" />
 )}
 </Button>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => handleDownloadImage(card)}
 disabled={
 !card.has_image &&
 status !== 'generated' &&
 status !== 'published'
 }
 className="h-8 w-8 p-0 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/40 disabled:opacity-40"
 title="تحميل الصورة"
 >
 <Download className="w-4 h-4" />
 </Button>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => handleDelete(card.id)}
 disabled={isDeleting}
 className="h-8 w-8 p-0 text-danger hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40"
 title="حذف"
 >
 {isDeleting ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Trash2 className="w-4 h-4" />
 )}
 </Button>
 </div>
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>
 </div>
 )}
 </CardContent>
 </Card>
 </section>

 {/* ====================================================================
 PREVIEW MODAL
 ==================================================================== */}
 <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
 <DialogContent
 className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
 dir="rtl"
 >
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-lg">
 <GraduationCap className="w-5 h-5 text-warning" />
 {previewCard ? previewCard.title || 'كارت تعليمي' : 'تحميل الكارت...'}
 </DialogTitle>
 <DialogDescription>عرض تفاصيل الكارت التعليمي</DialogDescription>
 </DialogHeader>

 <div className="flex-1 overflow-y-auto px-1">
 {previewLoading ? (
 <div className="flex flex-col items-center justify-center py-16">
 <Loader2 className="w-10 h-10 animate-spin text-warning mb-3" />
 <p className="text-muted-foreground">جاري جلب الكارت...</p>
 </div>
 ) : previewCard ? (
 <div className="space-y-4">
 {/* Meta row */}
 <div className="flex flex-wrap items-center gap-2 text-xs">
 <Badge
 className={cn(
 'gap-1.5',
 STATUS_META[normalizeStatus(previewCard.status)].badgeClass
 )}
 variant="outline"
 >
 <span
 className={cn(
 'w-1.5 h-1.5 rounded-full',
 STATUS_META[normalizeStatus(previewCard.status)].dotClass
 )}
 />
 {STATUS_META[normalizeStatus(previewCard.status)].label}
 </Badge>
 {previewCard.category && (
 <Badge
 className={cn(
 'gap-1.5',
 getColorClasses(getCategoryMeta(previewCard.category).color).bg,
 getColorClasses(getCategoryMeta(previewCard.category).color).text
 )}
 variant="outline"
 >
 {getCategoryMeta(previewCard.category).label}
 </Badge>
 )}
 <span className="text-muted-foreground">
 التاريخ:{' '}
 {formatDate(
 previewCard.generated_at || previewCard.created_at
 )}
 </span>
 {previewCard.published_at && (
 <span className="text-muted-foreground">
 آخر نشر: {formatDate(previewCard.published_at)}
 </span>
 )}
 </div>

 {/* Error (if failed) */}
 {previewCard.status === 'failed' && previewCard.error && (
 <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
 <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
 <div>
 <p className="text-sm font-semibold text-red-800 dark:text-red-300">
 سبب الفشل
 </p>
 <p className="text-xs text-red-700 mt-1">
 {previewCard.error}
 </p>
 </div>
 </div>
 )}

 {/* Text content */}
 {previewCard.text || previewCard.content ? (
 <div className="rounded-lg border border-border bg-muted/30 p-4">
 <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
 <BookOpen className="w-3.5 h-3.5" />
 النص الكامل
 </p>
 <pre
 dir="rtl"
 className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground max-h-64 overflow-y-auto"
 >
 {previewCard.text || previewCard.content}
 </pre>
 </div>
 ) : (
 <div className="rounded-lg border border-dashed border-border p-8 text-center">
 <BookOpen className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
 <p className="text-sm text-muted-foreground">
 لا يوجد نص متاح لهذا الكارت
 </p>
 </div>
 )}

 {/* Image (if exists) */}
 {previewCard.has_image && previewCard.id && (
 <div className="rounded-lg border border-border bg-muted/30 p-4">
 <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
 <ImageIcon className="w-3.5 h-3.5" />
 صورة الكارت
 </p>
 <div className="rounded-md overflow-hidden border border-border bg-white dark:bg-black/40 flex items-center justify-center min-h-[200px]">
 <img
 src={`/api/admin/educational-cards/${encodeURIComponent(
 previewCard.id
 )}/image`}
 alt={previewCard.title || 'كارت تعليمي'}
 className="max-w-full h-auto"
 loading="lazy"
 />
 </div>
 </div>
 )}

 {/* Video section (if available) */}
 {previewCard.has_video &&
 (previewCard.video_url || previewCard.id) && (
 <div className="rounded-lg border border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-800/50 p-4">
 <p className="text-xs text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
 <Film className="w-3.5 h-3.5" />
 الفيديو المولّد
 </p>
 <div className="rounded-md overflow-hidden border border-border bg-black flex items-center justify-center min-h-[200px]">
 {previewCard.video_url ? (
 <video
 src={previewCard.video_url}
 controls
 className="max-w-full h-auto"
 >
 متصفحك لا يدعم تشغيل الفيديو.
 </video>
 ) : (
 <div className="flex flex-col items-center gap-2 p-6 text-center">
 <Play className="w-10 h-10 text-warning/70" />
 <p className="text-sm text-muted-foreground">
 الفيديو متاح للتحميل فقط
 </p>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 ) : (
 <div className="flex flex-col items-center justify-center py-16">
 <AlertCircle className="w-10 h-10 text-muted-foreground/40 mb-2" />
 <p className="text-muted-foreground">لا يمكن تحميل الكارت</p>
 </div>
 )}
 </div>

 <DialogFooter className="flex flex-wrap items-center gap-2 pt-4 border-t border-border">
 <Button
 variant="outline"
 onClick={() => previewCard && handleDownloadImage(previewCard)}
 disabled={!previewCard}
 className="border-orange-300 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/40"
 >
 <Download className="w-4 h-4" />
 تحميل الصورة
 </Button>
 <Button
 onClick={() => previewCard && handlePublish(previewCard.id)}
 disabled={
 !previewCard ||
 publishingIds.has(previewCard.id) ||
 normalizeStatus(previewCard.status) === 'published' ||
 normalizeStatus(previewCard.status) === 'pending'
 }
 className="bg-profit hover:bg-emerald-700 text-white"
 >
 {previewCard && publishingIds.has(previewCard.id) ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : (
 <Send className="w-4 h-4" />
 )}
 نشر على تليجرام
 </Button>
 <Button
 variant="ghost"
 onClick={() => setPreviewOpen(false)}
 className="mr-auto"
 >
 <X className="w-4 h-4" />
 إغلاق
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 </div>
 );
}

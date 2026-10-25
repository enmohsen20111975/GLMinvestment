// card type definitions — extracted (Phase 3)

 badgeClass:
 'border-whale/20 bg-teal-50 text-whale dark:bg-teal-950/40 dark:text-whale',
 dotClass: 'bg-whale',
 },
 failed: {
 label: 'فشل',
 badgeClass:
 'border-red-500/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
 dotClass: 'bg-red-500',
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
 advanced: { label: 'متقدم', color: 'text-red-600' },
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
 text: 'text-warning dark:text-warning',
 bg: 'bg-warning/10',
 border: 'border-warning/30 dark:border-warning/30',
 hover: 'hover:bg-warning/10 dark:hover:bg-warning/30/60',
 },
 emerald: {
 text: 'text-profit dark:text-profit',
 bg: 'bg-profit/10',
 border: 'border-profit/30 ',
 hover: 'hover:bg-profit/10 dark:hover:bg-profit/30/60',
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

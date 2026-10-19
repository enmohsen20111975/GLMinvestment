'use client';

/**
 * EngineSettingsTab — إعدادات المحرك الديناميكي
 * =================================================
 * DYNAMIC-ADMIN-UI: تبويب الأدمن اللي بيخلّيه يتحكم في كل thresholds
 * المحرك ديناميكياً بدون ما يلمس الكود.
 *
 * الفلسفة: مفيش رقم ثابت في الكود. كل الإعدادات (سيولة، RSI، حجم،
 * درجة شراء، وقف خسارة، R/R، إلخ) بتتقرأ من جدول `system_settings`
 * في stocks.db، والأدمن يقدر يعدّلها من هنا.
 *
 * المصدر: GET /api/admin/engine-settings
 *         POST /api/admin/engine-settings (body: { updates: { key: value } })
 *         POST /api/admin/engine-settings/reset
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Save,
    RotateCcw,
    Settings,
    RefreshCw,
    Loader2,
    AlertCircle,
    CheckCircle2,
    Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

// ============== Types ==============

type SettingValue = number | string | boolean;
type SettingsMap = Record<string, SettingValue>;

interface SettingMeta {
    description: string;
    category: string;
}

type DescriptionsMap = Record<string, SettingMeta>;

interface ApiResponse {
    success: boolean;
    settings?: SettingsMap;
    descriptions?: DescriptionsMap;
    warning?: string;
    source?: string;
}

interface PostResponse {
    success: boolean;
    results?: Record<string, boolean>;
    error?: string;
    updated_count?: number;
    total_count?: number;
}

// ============== Constants ==============

const CATEGORY_LABELS: Record<string, string> = {
    liquidity: 'السيولة',
    volume: 'الحجم',
    rsi: 'مؤشر RSI',
    scoring: 'درجات الشراء',
    risk: 'إدارة المخاطر',
    targets: 'الأهداف',
    delayed_data: 'تعويض التأخير',
    free_float: 'الأسهم الحرة',
    limits: 'حدود المحرك',
};

const CATEGORY_ORDER = [
    'liquidity',
    'volume',
    'rsi',
    'scoring',
    'risk',
    'targets',
    'delayed_data',
    'free_float',
    'limits',
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    liquidity: 'فلتر السيولة — الحدود الدنيا للدوران والحجم والسعر',
    volume: 'فلتر الحجم — مضاعفات الحجم حسب صخب السوق',
    rsi: 'مؤشر القوة النسبية — عتبات التشبع الشرائي والبيعي',
    scoring: 'درجات الشراء — عتبات BUY / ACCUMULATE / HOLD',
    risk: 'إدارة المخاطر — مضاعفات ATR وحدود وقف الخسارة',
    targets: 'الأهداف — نسب R/R حسب حالة السوق',
    delayed_data: 'تعويض تأخير البيانات — تأكيد الإغلاق ومكافآت الـ pullback',
    free_float: 'الأسهم الحرة — حدود ومعاملات الخطورة',
    limits: 'حدود المحرك — عمر التحليل والثقة الدنيا',
};

// ============== Component ==============

export function EngineSettingsTab() {
    const [settings, setSettings] = useState<SettingsMap>({});
    const [descriptions, setDescriptions] = useState<DescriptionsMap>({});
    const [originalSettings, setOriginalSettings] = useState<SettingsMap>({});
    const [draft, setDraft] = useState<SettingsMap>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);

    // ============== Fetch ==============
    const fetchSettings = useCallback(async () => {
        setLoading(true);
        setError(null);
        setWarning(null);
        try {
            const res = await fetch('/api/admin/engine-settings', {
                method: 'GET',
                credentials: 'same-origin',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as ApiResponse;
            if (!data.success) {
                throw new Error('Failed to load engine settings');
            }
            const nextSettings = data.settings || {};
            setSettings(nextSettings);
            setOriginalSettings(nextSettings);
            setDraft(nextSettings);
            setDescriptions(data.descriptions || {});
            if (data.warning) {
                setWarning(data.warning);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            setError(msg);
            toast.error('فشل تحميل إعدادات المحرك', { description: msg });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchSettings();
    }, [fetchSettings]);

    // ============== Changed values (only post what's different) ==============
    const changedKeys = useMemo(() => {
        const keys: string[] = [];
        for (const k of Object.keys(draft)) {
            const orig = originalSettings[k];
            const current = draft[k];
            // Compare as strings to handle int/float properly
            if (String(orig ?? '') !== String(current ?? '')) {
                keys.push(k);
            }
        }
        return keys;
    }, [draft, originalSettings]);

    const hasChanges = changedKeys.length > 0;

    // ============== Group settings by category ==============
    const grouped = useMemo(() => {
        const groups: Record<string, Array<{ key: string; meta?: SettingMeta }>> = {};
        for (const key of Object.keys(descriptions)) {
            const meta = descriptions[key];
            if (!meta) continue;
            const cat = meta.category || 'general';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({ key, meta });
        }
        // Include any settings that exist in `settings` but missing from descriptions
        for (const key of Object.keys(settings)) {
            if (!descriptions[key]) {
                const cat = 'general';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push({ key, meta: undefined });
            }
        }
        return groups;
    }, [descriptions, settings]);

    const orderedCategories = useMemo(() => {
        const known = CATEGORY_ORDER.filter((c) => grouped[c] && grouped[c].length > 0);
        const extras = Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c));
        return [...known, ...extras];
    }, [grouped]);

    // ============== Input handlers ==============
    const handleValueChange = (key: string, raw: string) => {
        // Try to coerce back to number; keep as string if NaN
        const trimmed = raw.trim();
        if (trimmed === '') {
            setDraft((prev) => ({ ...prev, [key]: '' }));
            return;
        }
        const num = Number(trimmed);
        if (!Number.isNaN(num) && /^-?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(trimmed)) {
            setDraft((prev) => ({ ...prev, [key]: num }));
        } else {
            setDraft((prev) => ({ ...prev, [key]: trimmed }));
        }
    };

    const handleResetField = (key: string) => {
        setDraft((prev) => ({ ...prev, [key]: originalSettings[key] }));
    };

    // ============== Save ==============
    const handleSave = async () => {
        if (!hasChanges) return;
        setSaving(true);
        try {
            const updates: Record<string, number | string | boolean> = {};
            for (const k of changedKeys) {
                updates[k] = draft[k];
            }
            const res = await fetch('/api/admin/engine-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ updates }),
            });
            const data = (await res.json()) as PostResponse;
            if (!res.ok || !data.success) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            const failed = Object.entries(data.results || {})
                .filter(([, ok]) => !ok)
                .map(([k]) => k);
            if (failed.length > 0) {
                toast.warning('تم الحفظ جزئياً', {
                    description: `فشل تحديث: ${failed.join('، ')}`,
                });
            } else {
                toast.success('تم حفظ التغييرات', {
                    description: `تم تحديث ${data.updated_count ?? changedKeys.length} إعداد`,
                });
            }
            // Refresh from server to sync authoritative state
            await fetchSettings();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            toast.error('فشل حفظ الإعدادات', { description: msg });
        } finally {
            setSaving(false);
        }
    };

    // ============== Reset to defaults ==============
    const handleResetAll = async () => {
        setResetting(true);
        try {
            const res = await fetch('/api/admin/engine-settings/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
            });
            const data = (await res.json()) as { success: boolean; error?: string; message?: string };
            if (!res.ok || !data.success) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            toast.success('تمت الاستعادة', {
                description: data.message || 'تمت استعادة كل الإعدادات لقيمها الافتراضية',
            });
            await fetchSettings();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            toast.error('فشل الاستعادة', { description: msg });
        } finally {
            setResetting(false);
        }
    };

    const handleDiscard = () => {
        setDraft(originalSettings);
        toast.info('تم إلغاء التغييرات غير المحفوظة');
    };

    // ============== Render ==============

    if (loading) {
        return (
            <div className="space-y-6" dir="rtl">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-3 w-72" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Card key={i}>
                            <CardHeader>
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-3 w-48" />
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {Array.from({ length: 4 }).map((_, j) => (
                                    <div key={j} className="space-y-1.5">
                                        <Skeleton className="h-3 w-40" />
                                        <Skeleton className="h-9 w-full" />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6" dir="rtl">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                        <Settings className="w-5 h-5 text-warning" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            إعدادات المحرك
                            <Badge variant="secondary" className="text-[10px]">
                                {Object.keys(settings).length} إعداد
                            </Badge>
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            تحكّم ديناميكي في كل thresholds المحرك بدون لمس الكود
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchSettings()}
                        disabled={saving || resetting}
                    >
                        <RefreshCw className="w-4 h-4 ml-1" />
                        تحديث
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDiscard}
                        disabled={!hasChanges || saving || resetting}
                    >
                        إلغاء التغييرات
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={!hasChanges || saving || resetting}
                    >
                        {saving ? (
                            <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                        ) : (
                            <Save className="w-4 h-4 ml-1" />
                        )}
                        حفظ التغييرات
                        {hasChanges && (
                            <Badge variant="default" className="mr-1 text-[10px] py-0 px-1.5">
                                {changedKeys.length}
                            </Badge>
                        )}
                    </Button>

                    {/* Reset with confirmation */}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="destructive"
                                size="sm"
                                disabled={saving || resetting}
                            >
                                {resetting ? (
                                    <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                                ) : (
                                    <RotateCcw className="w-4 h-4 ml-1" />
                                )}
                                استعادة الافتراضي
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>استعادة كل الإعدادات للافتراضي؟</AlertDialogTitle>
                                <AlertDialogDescription>
                                    هذا الإجراء سيستبدل كل القيم الحالية بالقيم الافتراضية المعرّفة في الكود.
                                    الإجراء لا يمكن التراجع عنه. تأكّد إنك فاهم اللي بتعمله.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() => void handleResetAll()}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    نعم، استعد الافتراضي
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            {/* Error / Warning banners */}
            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertTitle>تعذّر تحميل الإعدادات</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {warning && !error && (
                <Alert>
                    <Info className="w-4 h-4" />
                    <AlertTitle>تنبيه</AlertTitle>
                    <AlertDescription>{warning}</AlertDescription>
                </Alert>
            )}

            {hasChanges && (
                <Alert>
                    <CheckCircle2 className="w-4 h-4" />
                    <AlertTitle>لديك تغييرات غير محفوظة</AlertTitle>
                    <AlertDescription>
                        {changedKeys.length} إعداد معدّل — اضغط «حفظ التغييرات» لتطبيقها.
                    </AlertDescription>
                </Alert>
            )}

            {/* Categories grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {orderedCategories.map((cat) => {
                    const items = grouped[cat] || [];
                    if (items.length === 0) return null;
                    const label = CATEGORY_LABELS[cat] || cat;
                    const description = CATEGORY_DESCRIPTIONS[cat] || '';
                    return (
                        <Card key={cat} className="flex flex-col">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        {label}
                                        <Badge variant="outline" className="text-[10px]">
                                            {items.length}
                                        </Badge>
                                    </CardTitle>
                                </div>
                                {description && (
                                    <CardDescription className="text-xs">
                                        {description}
                                    </CardDescription>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-3 flex-1">
                                {items.map(({ key, meta }) => {
                                    const value = draft[key];
                                    const isChanged = changedKeys.includes(key);
                                    return (
                                        <div key={key} className="space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <Label
                                                    htmlFor={`setting-${key}`}
                                                    className="text-xs font-medium leading-tight"
                                                >
                                                    {key}
                                                </Label>
                                                <div className="flex items-center gap-1.5">
                                                    {isChanged && (
                                                        <Badge
                                                            variant="default"
                                                            className="text-[9px] py-0 px-1.5 bg-warning hover:bg-warning"
                                                        >
                                                            مُعدّل
                                                        </Badge>
                                                    )}
                                                    {isChanged && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-5 px-1.5 text-[10px]"
                                                            onClick={() => handleResetField(key)}
                                                        >
                                                            تراجع
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <Input
                                                id={`setting-${key}`}
                                                type="text"
                                                inputMode="decimal"
                                                dir="ltr"
                                                value={value === undefined || value === null ? '' : String(value)}
                                                onChange={(e) => handleValueChange(key, e.target.value)}
                                                className={`text-sm font-mono ${isChanged ? 'border-warning focus-visible:ring-warning/30' : ''}`}
                                                disabled={saving || resetting}
                                            />
                                            {meta?.description && (
                                                <p className="text-[11px] text-muted-foreground leading-snug">
                                                    {meta.description}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Bottom save bar (sticky-feel) */}
            {hasChanges && (
                <div className="sticky bottom-4 z-10">
                    <Card className="border-warning/40 bg-warning/80 dark:bg-warning/30 backdrop-blur">
                        <CardContent className="py-3 px-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-sm">
                                <span className="font-medium">{changedKeys.length}</span> تغيير في الانتظار
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDiscard}
                                    disabled={saving || resetting}
                                >
                                    إلغاء
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={saving || resetting}
                                >
                                    {saving ? (
                                        <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                                    ) : (
                                        <Save className="w-4 h-4 ml-1" />
                                    )}
                                    حفظ التغييرات
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}

export default EngineSettingsTab;

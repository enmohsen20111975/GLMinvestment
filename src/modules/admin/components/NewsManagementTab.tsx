'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Newspaper,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Eye,
  SlidersHorizontal,
  X,
  Building2,
  Flame,
  CheckSquare,
  Square,
  Sparkles,
  Pencil,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { adminFetch } from '@/lib/admin-auth';

interface AdminNewsItem {
  id: number;
  global_id: string;
  title: string;
  content: string;
  source: string;
  url?: string;
  tickers: string[];
  importance: number;
  sentiment: string;
  image_paths?: string[];
  published_at: string;
}

interface SourceCount {
  source: string;
  count: number;
}

export function NewsManagementTab() {
  const [news, setNews] = useState<AdminNewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sources, setSources] = useState<SourceCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  // PHASE2-ADMIN-PANEL: owner request — "فلترة الأخبار المؤثرة (High-Impact
  // Catalysts)". 0 = no filter, 70 = high-impact only (default cutoff).
  const [minImportance, setMinImportance] = useState<number>(0);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Add News Dialog / Drawer
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newSource, setNewSource] = useState('أدمن المنصة');
  const [newUrl, setNewUrl] = useState('');
  const [newTickers, setNewTickers] = useState('');
  const [newImportance, setNewImportance] = useState(75);
  const [newSentiment, setNewSentiment] = useState<'positive' | 'neutral' | 'negative'>('neutral');

  // Preview Article Modal
  const [previewItem, setPreviewItem] = useState<AdminNewsItem | null>(null);

  // Edit News Modal
  const [editItem, setEditItem] = useState<AdminNewsItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editTickers, setEditTickers] = useState('');
  const [editImportance, setEditImportance] = useState(75);
  const [editSentiment, setEditSentiment] = useState<'positive' | 'neutral' | 'negative'>('neutral');

  const openEditModal = (item: AdminNewsItem) => {
    setEditItem(item);
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditSource(item.source);
    setEditUrl(item.url || '');
    setEditTickers(item.tickers?.join(', ') || '');
    setEditImportance(item.importance || 75);
    setEditSentiment((item.sentiment as any) || 'neutral');
  };

  const handleUpdateNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editItem.id,
          title: editTitle.trim(),
          content: editContent.trim(),
          source: editSource.trim() || 'أدمن المنصة',
          url: editUrl.trim() || undefined,
          tickers: editTickers.trim() || undefined,
          importance: Number(editImportance),
          sentiment: editSentiment,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تعديل وتحديث الخبر بنجاح!');
        setEditItem(null);
        fetchNews(page);
      } else {
        toast.error(data.error || 'فشل في تعديل الخبر');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Fetch News
  const fetchNews = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: '25',
      });
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedSource && selectedSource !== 'all') params.set('source', selectedSource);
      // PHASE2-ADMIN-PANEL: min_importance filter (High-Impact Catalysts)
      if (minImportance > 0) params.set('min_importance', String(minImportance));

      const res = await adminFetch(`/api/admin/news?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setNews(data.news || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setSources(data.sources || []);
        setSelectedIds(new Set()); // Clear selection on fetch
      } else {
        toast.error(data.error || 'فشل في تحميل قائمة الأخبار');
      }
    } catch (err: any) {
      toast.error('خطأ في الاتصال بالخادم: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, selectedSource, minImportance]);

  useEffect(() => {
    fetchNews(1);
    setPage(1);
  }, [searchQuery, selectedSource, minImportance]);

  // Handle single delete
  const handleDeleteOne = async (item: AdminNewsItem) => {
    if (!confirm(`هل أنت متأكد من حذف الخبر:\n"${item.title.slice(0, 70)}..."؟`)) return;

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_one', id: item.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف الخبر بنجاح');
        fetchNews(page);
      } else {
        toast.error(data.error || 'فشل في حذف الخبر');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Batch Delete
  const handleDeleteBatch = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`هل أنت متأكد من حذف ${selectedIds.size} خبر محدد نهائياً؟`)) return;

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_batch',
          ids: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم حذف ${data.deletedCount} خبر بنجاح`);
        setSelectedIds(new Set());
        fetchNews(1);
      } else {
        toast.error(data.error || 'فشل في حذف الأخبار المحددة');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Purge All News
  const handlePurgeAll = async () => {
    const code = prompt('⚠️ تحذير شديد الأهمية!\nلتفريغ ومسح جميع الأخبار من قاعدة البيانات بالكامل، اكتب: مسح_الكل');
    if (code !== 'مسح_الكل') {
      if (code !== null) toast.error('تم إلغاء التفريغ — الكود غير مطابق');
      return;
    }

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge_all' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم مسح وتفريغ جميع الأخبار (${data.deletedCount} خبر)`);
        fetchNews(1);
      } else {
        toast.error(data.error || 'فشل في تفريغ الأخبار');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Purge By Source
  const handlePurgeBySource = async (sourceName: string) => {
    if (!confirm(`هل أنت متأكد من مسح جميع أخبار المصدر: "${sourceName}"؟`)) return;

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_by_source', source: sourceName }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم مسح ${data.deletedCount} خبر من مصدر ${sourceName}`);
        fetchNews(1);
      } else {
        toast.error(data.error || 'فشل في مسح أخبار المصدر');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle Selection
  const toggleSelectOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === news.length && news.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(news.map((n) => n.id)));
    }
  };

  // Submit Add News
  const handleAddNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error('يرجى إدخال عنوان الخبر');
      return;
    }

    setActionLoading(true);
    try {
      const res = await adminFetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
          source: newSource.trim() || 'أدمن المنصة',
          url: newUrl.trim() || undefined,
          tickers: newTickers.trim() || undefined,
          importance: Number(newImportance),
          sentiment: newSentiment,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تمت إضافة الخبر بنجاح!');
        setShowAddModal(false);
        setNewTitle('');
        setNewContent('');
        setNewUrl('');
        setNewTickers('');
        fetchNews(1);
      } else {
        toast.error(data.error || 'فشل في إضافة الخبر');
      }
    } catch (err: any) {
      toast.error('حدث خطأ: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const isAllSelected = news.length > 0 && selectedIds.size === news.length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Banner & Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Newspaper className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">إدارة الأخبار والتحليلات</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              تحكم كامل في مسح الأخبار الزائدة، تنظيف المصادر، إضافة أخبار يدوية، وتفريغ القائمة
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNews(page)}
            disabled={loading || actionLoading}
            className="gap-1.5 text-xs h-9"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>

          <Button
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="gap-1.5 text-xs h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة خبر يدوي
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={handlePurgeAll}
            disabled={actionLoading || total === 0}
            className="gap-1.5 text-xs h-9"
          >
            <Trash2 className="w-3.5 h-3.5" />
            تفريغ الكل
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card border-border/70">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">إجمالي الأخبار الحالية</p>
              <h3 className="text-2xl font-bold text-foreground mt-1">{total}</h3>
            </div>
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Newspaper className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/70 sm:col-span-2">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-2">توزيع الأخبار حسب المصدر (اضغط للحذف السريع للمصدر):</p>
            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
              {sources.length === 0 ? (
                <span className="text-xs text-muted-foreground">لا توجد مصادر حالياً</span>
              ) : (
                sources.map((s) => (
                  <div
                    key={s.source}
                    className="inline-flex items-center gap-1.5 text-xs bg-muted/60 border border-border px-2 py-1 rounded-md"
                  >
                    <span className="font-semibold text-foreground">{s.source}</span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
                      {s.count}
                    </Badge>
                    <button
                      type="button"
                      title={`مسح جميع أخبار ${s.source}`}
                      onClick={() => handlePurgeBySource(s.source)}
                      className="text-muted-foreground hover:text-rose-500 transition-colors mr-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control & Search Bar */}
      <Card className="bg-card border-border/70">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث في الأخبار أو الرمز أو المحتوى..."
                className="pr-9 h-9 text-xs bg-muted/30"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Source Filter Dropdown */}
            <div className="w-full md:w-56">
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">كل المصادر ({total})</option>
                {sources.map((s) => (
                  <option key={s.source} value={s.source}>
                    {s.source} ({s.count})
                  </option>
                ))}
              </select>
            </div>

            {/* PHASE2-ADMIN-PANEL: Impact Filter — owner request:
                "فلترة الأخبار المؤثرة (High-Impact Catalysts)" */}
            <div className="w-full md:w-44">
              <select
                value={String(minImportance)}
                onChange={(e) => setMinImportance(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="0">كل الأهمية</option>
                <option value="40">⚠️ متوسطة+ (40+)</option>
                <option value="70">🔥 عالية التأثير (70+)</option>
                <option value="85">💥 حرجة (85+)</option>
              </select>
            </div>
          </div>

          {/* Batch Actions Bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-foreground animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-rose-500" />
                <span>
                  تم تحديد <strong>{selectedIds.size}</strong> خبر
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteBatch}
                  disabled={actionLoading}
                  className="gap-1.5 h-7 text-xs"
                >
                  <Trash2 className="w-3 h-3" />
                  حذف المحدد ({selectedIds.size})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  إلغاء التحديد
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* News Table / List */}
      <Card className="bg-card border-border/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                <th className="p-3 w-10 text-center">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    title={isAllSelected ? 'إلغاء تحديد الكل' : 'تحديد كل الصفحة'}
                    className="text-foreground hover:text-primary transition-colors"
                  >
                    {isAllSelected ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="p-3">عنوان الخبر</th>
                <th className="p-3 w-32">المصدر</th>
                <th className="p-3 w-28">الأسهم</th>
                <th className="p-3 w-28">الأهمية</th>
                <th className="p-3 w-32">التاريخ</th>
                <th className="p-3 w-28 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading && news.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
                    جاري تحميل الأخبار...
                  </td>
                </tr>
              ) : news.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    لا توجد أخبار مطابقة لمعايير البحث الحالية.
                  </td>
                </tr>
              ) : (
                news.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'hover:bg-muted/30 transition-colors',
                        isSelected && 'bg-primary/5'
                      )}
                    >
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(item.id)}
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                          ) : (
                            <Square className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      </td>

                      {/* Title & Preview */}
                      <td className="p-3 max-w-md">
                        <div className="font-semibold text-foreground leading-snug line-clamp-2">
                          {item.title}
                        </div>
                        {item.content && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {item.content.slice(0, 100)}...
                          </div>
                        )}
                      </td>

                      {/* Source */}
                      <td className="p-3">
                        <Badge variant="outline" className="text-[11px] font-normal gap-1">
                          <Building2 className="w-3 h-3" />
                          {item.source}
                        </Badge>
                      </td>

                      {/* Tickers */}
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {item.tickers && item.tickers.length > 0 ? (
                            item.tickers.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                              >
                                {t}
                              </span>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-[10px]">-</span>
                          )}
                        </div>
                      </td>

                      {/* Importance & Sentiment */}
                      <td className="p-3">
                        <div className="flex flex-col gap-1 items-start">
                          <Badge
                            className={cn(
                              'text-[10px] py-0 px-1.5',
                              item.importance >= 70
                                ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                                : item.importance >= 40
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {item.importance}/100
                          </Badge>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="p-3 text-muted-foreground text-[11px]">
                        {item.published_at ? new Date(item.published_at).toLocaleDateString('ar-EG') : '-'}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Preview button */}
                          <button
                            type="button"
                            onClick={() => setPreviewItem(item)}
                            title="معاينة النص الكامل"
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit button */}
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            title="تعديل هذا الخبر"
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-amber-500 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Source Link */}
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="فتح الرابط الأصلي"
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* Delete button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(item)}
                            disabled={actionLoading}
                            title="حذف هذا الخبر"
                            className="p-1.5 rounded-md hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between p-3 border-t border-border bg-card text-xs text-muted-foreground">
          <div>
            عرض صفحة <strong>{page}</strong> من <strong>{totalPages}</strong> (إجمالي {total} خبر)
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const prev = Math.max(page - 1, 1);
                setPage(prev);
                fetchNews(prev);
              }}
              disabled={page <= 1 || loading}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = Math.min(page + 1, totalPages);
                setPage(next);
                fetchNews(next);
              }}
              disabled={page >= totalPages || loading}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Modal: Add Manual News */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">إضافة خبر جديد إلى النظام</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddNews} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-foreground font-semibold mb-1">
                  عنوان الخبر <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: البنك المركزي يقرر تثبيت أسعار الفائدة..."
                  className="text-xs h-9 bg-background"
                />
              </div>

              <div>
                <label className="block text-foreground font-semibold mb-1">المصدر</label>
                <Input
                  type="text"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  placeholder="أدمن المنصة / رويترز / البورصة المصرية..."
                  className="text-xs h-9 bg-background"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-semibold mb-1">الأسهم المرتبطة (مفصولة بفواصل)</label>
                  <Input
                    type="text"
                    value={newTickers}
                    onChange={(e) => setNewTickers(e.target.value)}
                    placeholder="COMI, TMGH, HRHO"
                    className="text-xs h-9 font-mono bg-background"
                  />
                </div>
                <div>
                  <label className="block text-foreground font-semibold mb-1">رابط المصدر الأصلي (اختياري)</label>
                  <Input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://..."
                    className="text-xs h-9 bg-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-semibold mb-1">درجة الأهمية (10 - 100)</label>
                  <Input
                    type="number"
                    min="10"
                    max="100"
                    value={newImportance}
                    onChange={(e) => setNewImportance(Number(e.target.value))}
                    className="text-xs h-9 bg-background"
                  />
                </div>
                <div>
                  <label className="block text-foreground font-semibold mb-1">التوجه الاستثماري للخبر</label>
                  <select
                    value={newSentiment}
                    onChange={(e: any) => setNewSentiment(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="positive">إيجابي (Bullish)</option>
                    <option value="neutral">محايد (Neutral)</option>
                    <option value="negative">سلبي (Bearish)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-foreground font-semibold mb-1">محتوى الخبر كاملاً</label>
                <textarea
                  rows={5}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="اكتب أو الصق تفاصيل الخبر بالكامل هنا..."
                  className="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddModal(false)}
                  className="h-8 text-xs"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={actionLoading}
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {actionLoading ? 'جاري الإضافة...' : 'نشر وحفظ الخبر'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Preview Full Article */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4 text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {previewItem.source}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {previewItem.published_at ? new Date(previewItem.published_at).toLocaleString('ar-EG') : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <h3 className="text-lg font-bold text-foreground leading-snug">{previewItem.title}</h3>

            <div className="p-4 rounded-lg bg-muted/40 border border-border text-foreground text-xs leading-relaxed whitespace-pre-line">
              {previewItem.content || 'لا يوجد محتوى نصي متاح لهذا الخبر.'}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1">
                {previewItem.tickers?.map((t) => (
                  <Badge key={t} className="bg-primary/10 text-primary border border-primary/20 text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>

              {previewItem.url && (
                <a
                  href={previewItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <span>رابط المصدر الأصلي</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit News */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 text-right" dir="rtl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-foreground">تعديل الخبر (معرّف: #{editItem.id})</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateNews} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-foreground font-semibold mb-1">
                  عنوان الخبر <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-xs h-9 bg-background font-semibold"
                />
              </div>

              <div>
                <label className="block text-foreground font-semibold mb-1">المصدر</label>
                <Input
                  type="text"
                  value={editSource}
                  onChange={(e) => setEditSource(e.target.value)}
                  className="text-xs h-9 bg-background"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-semibold mb-1">الأسهم المرتبطة</label>
                  <Input
                    type="text"
                    value={editTickers}
                    onChange={(e) => setEditTickers(e.target.value)}
                    placeholder="COMI, TMGH"
                    className="text-xs h-9 font-mono bg-background"
                  />
                </div>
                <div>
                  <label className="block text-foreground font-semibold mb-1">رابط المصدر الأصلي</label>
                  <Input
                    type="url"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder="https://..."
                    className="text-xs h-9 bg-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-semibold mb-1">درجة الأهمية (10 - 100)</label>
                  <Input
                    type="number"
                    min="10"
                    max="100"
                    value={editImportance}
                    onChange={(e) => setEditImportance(Number(e.target.value))}
                    className="text-xs h-9 bg-background"
                  />
                </div>
                <div>
                  <label className="block text-foreground font-semibold mb-1">التوجه الاستثماري</label>
                  <select
                    value={editSentiment}
                    onChange={(e: any) => setEditSentiment(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="positive">إيجابي (Bullish)</option>
                    <option value="neutral">محايد (Neutral)</option>
                    <option value="negative">سلبي (Bearish)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-foreground font-semibold mb-1">نص ومحتوى الخبر</label>
                <textarea
                  rows={6}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditItem(null)}
                  className="h-8 text-xs"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={actionLoading}
                  className="h-8 text-xs bg-amber-600 text-white hover:bg-amber-700"
                >
                  {actionLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

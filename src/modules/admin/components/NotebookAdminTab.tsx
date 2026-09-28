'use client';

/**
 * NotebookAdminTab — تبويب إدارة Stock Notebooks في الأدمن
 * ========================================================
 * يقرأ ويكتب من خلال Python API (لا منطق مكرر في الواجهة).
 *
 * الميزات:
 *  1. قائمة كل النوتبوكس (symbol, danger_level, liquidity, correction)
 *  2. عرض تفاصيل نوتبوك سهم
 *  3. زر تحديث/إعادة بناء
 *  4. إضافة درس جديد
 *  5. تعديل machine_summary
 *  6. إحصائيات سريعة
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, BookOpen, AlertTriangle, CheckCircle, Plus, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface NotebookSummary {
  symbol: string;
  name_ar: string;
  last_updated: string;
  danger_level: number;
  liquidity_profile: string;
  typical_correction_pct: number;
  has_lessons: boolean;
  lesson_count: number;
  version: number;
  complete: boolean;
}

interface NotebookDetail {
  symbol: string;
  name_ar: string;
  market: string;
  sector: string;
  last_updated: string;
  version: number;
  identity: Record<string, any>;
  price_behavior: Record<string, any>;
  machine_summary: {
    typical_correction_pct: number;
    max_expected_correction_pct: number;
    liquidity_profile: string;
    danger_level: number;
    preferred_entry_style: string;
    avoid_chase: boolean;
    distribution_sensitivity: string;
  };
  danger_flags: string[];
  learned_lessons: Array<{
    date: string;
    type: string;
    summary: string;
    lesson: string;
  }>;
}

const PYTHON_PORT = '8010';

export function NotebookAdminTab() {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<NotebookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddLesson, setShowAddLesson] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [lessonForm, setLessonForm] = useState({ type: 'success', summary: '', lesson: '', date: '' });
  const [summaryForm, setSummaryForm] = useState<Record<string, any>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/list?XTransformPort=${PYTHON_PORT}`);
      const data = await res.json();
      if (data.success) {
        setNotebooks(data.notebooks);
      }
    } catch (e) {
      toast.error('فشل تحميل القائمة');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/stats?XTransformPort=${PYTHON_PORT}`);
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (e) {
      // silent
    }
  }, []);

  const fetchDetail = useCallback(async (symbol: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${symbol}?XTransformPort=${PYTHON_PORT}`);
      const data = await res.json();
      if (data.success) {
        setSelected(data.notebook);
        setSummaryForm(data.notebook.machine_summary || {});
      } else {
        toast.error('النوتبوك غير موجود');
      }
    } catch (e) {
      toast.error('فشل تحميل النوتبوك');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNotebook = useCallback(async (symbol: string) => {
    setBuilding(true);
    toast.info(`جاري إعادة بناء نوتبوك ${symbol}...`);
    try {
      const res = await fetch(`/api/notebooks/${symbol}/refresh?force=1&XTransformPort=${PYTHON_PORT}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`تم تحديث نوتبوك ${symbol}`);
        setSelected(data.notebook);
        setSummaryForm(data.notebook.machine_summary || {});
        fetchList();
        fetchStats();
      } else {
        toast.error('فشل التحديث');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
    } finally {
      setBuilding(false);
    }
  }, [fetchList, fetchStats]);

  const buildAll = useCallback(async () => {
    setBuilding(true);
    toast.info('جاري البناء الجماعي لكل الأسهم...');
    try {
      const res = await fetch(`/api/notebooks/build-all?force=1&XTransformPort=${PYTHON_PORT}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const r = data.result;
        toast.success(`تم بناء ${r.built} نوتبوك (أخطاء: ${r.errors})`);
        fetchList();
        fetchStats();
      }
    } catch (e) {
      toast.error('خطأ في البناء الجماعي');
    } finally {
      setBuilding(false);
    }
  }, [fetchList, fetchStats]);

  const addLesson = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/notebooks/${selected.symbol}/lesson?XTransformPort=${PYTHON_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lessonForm),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم إضافة الدرس');
        setShowAddLesson(false);
        setLessonForm({ type: 'success', summary: '', lesson: '', date: '' });
        fetchDetail(selected.symbol);
      } else {
        toast.error('فشل إضافة الدرس');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
    }
  }, [selected, lessonForm, fetchDetail]);

  const saveSummary = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/notebooks/${selected.symbol}/summary?XTransformPort=${PYTHON_PORT}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summaryForm }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حفظ التعديلات');
        setEditingSummary(false);
        fetchDetail(selected.symbol);
      } else {
        toast.error('فشل الحفظ');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال');
    }
  }, [selected, summaryForm, fetchDetail]);

  useEffect(() => {
    fetchList();
    fetchStats();
  }, [fetchList, fetchStats]);

  const filtered = notebooks.filter(n =>
    n.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.name_ar.includes(searchQuery)
  );

  const dangerColor = (level: number) => {
    if (level >= 5) return 'bg-red-500 text-white';
    if (level >= 4) return 'bg-orange-500 text-white';
    if (level >= 3) return 'bg-yellow-500 text-white';
    return 'bg-emerald-500 text-white';
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header + Stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-600" />
          <h2 className="text-xl font-bold">Stock Notebooks</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { fetchList(); fetchStats(); }} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-1 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button size="sm" onClick={buildAll} disabled={building}>
            {building ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Plus className="h-4 w-4 ml-1" />}
            بناء جماعي
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3">
            <div className="text-2xl font-bold text-emerald-600">{stats.total}</div>
            <div className="text-xs text-muted-foreground">إجمالي النوتبوكس</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-blue-600">{stats.complete}</div>
            <div className="text-xs text-muted-foreground">مكتمل</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-orange-600">{stats.high_danger}</div>
            <div className="text-xs text-muted-foreground">خطر عالي</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-purple-600">{stats.with_lessons}</div>
            <div className="text-xs text-muted-foreground">بها دروس</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-gray-600">{stats.incomplete}</div>
            <div className="text-xs text-muted-foreground">ناقص</div>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Notebook List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">قائمة الأسهم ({filtered.length})</CardTitle>
            <Input
              placeholder="بحث بالرمز أو الاسم..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-2"
            />
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-1">
                {filtered.map((nb) => (
                  <div
                    key={nb.symbol}
                    onClick={() => fetchDetail(nb.symbol)}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer hover:bg-muted transition-colors ${
                      selected?.symbol === nb.symbol ? 'bg-muted' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${dangerColor(nb.danger_level)}`}>
                        {nb.danger_level}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{nb.symbol}</div>
                        <div className="text-xs text-muted-foreground truncate">{nb.name_ar}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      {nb.complete ? (
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-yellow-500" />
                      )}
                      {nb.typical_correction_pct > 0 && (
                        <span className="text-muted-foreground">{nb.typical_correction_pct}%</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right: Detail View */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                {selected ? `${selected.symbol} — ${selected.name_ar}` : 'تفاصيل النوتبوك'}
              </CardTitle>
              {selected && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => refreshNotebook(selected.symbol)} disabled={building}>
                    <RefreshCw className="h-3.5 w-3.5 ml-1" />
                    تحديث
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAddLesson(!showAddLesson)}>
                    <Plus className="h-3.5 w-3.5 ml-1" />
                    درس
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-center text-muted-foreground py-12">
                <BookOpen className="h-12 w-12 mx-auto mb-2 opacity-30" />
                اختر سهماً من القائمة
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-4">
                  {/* Machine Summary */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold">Machine Summary</h4>
                      <Button size="sm" variant="ghost" onClick={() => setEditingSummary(!editingSummary)}>
                        {editingSummary ? 'إلغاء' : 'تعديل'}
                      </Button>
                    </div>
                    {editingSummary ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs">danger_level (1-5)</label>
                            <Input
                              type="number"
                              min={1} max={5}
                              value={summaryForm.danger_level || 1}
                              onChange={(e) => setSummaryForm({ ...summaryForm, danger_level: parseInt(e.target.value) || 1 })}
                            />
                          </div>
                          <div>
                            <label className="text-xs">typical_correction_pct</label>
                            <Input
                              type="number"
                              value={summaryForm.typical_correction_pct || 0}
                              onChange={(e) => setSummaryForm({ ...summaryForm, typical_correction_pct: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                          <div>
                            <label className="text-xs">liquidity_profile</label>
                            <Select
                              value={summaryForm.liquidity_profile || 'medium'}
                              onValueChange={(v) => setSummaryForm({ ...summaryForm, liquidity_profile: v })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="high">high</SelectItem>
                                <SelectItem value="medium">medium</SelectItem>
                                <SelectItem value="low">low</SelectItem>
                                <SelectItem value="very_low">very_low</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs">distribution_sensitivity</label>
                            <Select
                              value={summaryForm.distribution_sensitivity || 'medium'}
                              onValueChange={(v) => setSummaryForm({ ...summaryForm, distribution_sensitivity: v })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="high">high</SelectItem>
                                <SelectItem value="medium">medium</SelectItem>
                                <SelectItem value="low">low</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs">avoid_chase</label>
                            <Select
                              value={String(summaryForm.avoid_chase ?? true)}
                              onValueChange={(v) => setSummaryForm({ ...summaryForm, avoid_chase: v === 'true' })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">true</SelectItem>
                                <SelectItem value="false">false</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button size="sm" onClick={saveSummary}>
                          <Save className="h-3.5 w-3.5 ml-1" />
                          حفظ
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>danger_level: <Badge className={dangerColor(selected.machine_summary.danger_level)}>{selected.machine_summary.danger_level}</Badge></div>
                        <div>liquidity: <span className="font-medium">{selected.machine_summary.liquidity_profile}</span></div>
                        <div>correction: <span className="font-medium">{selected.machine_summary.typical_correction_pct}%</span></div>
                        <div>max_corr: <span className="font-medium">{selected.machine_summary.max_expected_correction_pct}%</span></div>
                        <div>avoid_chase: <span className="font-medium">{String(selected.machine_summary.avoid_chase)}</span></div>
                        <div>dist_sens: <span className="font-medium">{selected.machine_summary.distribution_sensitivity}</span></div>
                      </div>
                    )}
                  </div>

                  {/* Danger Flags */}
                  {selected.danger_flags.length > 0 && (
                    <div>
                      <h4 className="text-sm font-bold mb-1">Danger Flags</h4>
                      <div className="flex flex-wrap gap-1">
                        {selected.danger_flags.map((f, i) => (
                          <Badge key={i} variant="destructive" className="text-xs">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add Lesson Form */}
                  {showAddLesson && (
                    <div className="border rounded p-3 space-y-2 bg-muted/30">
                      <h4 className="text-sm font-bold">درس جديد</h4>
                      <Select
                        value={lessonForm.type}
                        onValueChange={(v) => setLessonForm({ ...lessonForm, type: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="success">نجاح</SelectItem>
                          <SelectItem value="failure">فشل</SelectItem>
                          <SelectItem value="info">معلومة</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="التاريخ (YYYY-MM-DD)"
                        value={lessonForm.date}
                        onChange={(e) => setLessonForm({ ...lessonForm, date: e.target.value })}
                      />
                      <Input
                        placeholder="ملخص"
                        value={lessonForm.summary}
                        onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })}
                      />
                      <Textarea
                        placeholder="الدرس المستفاد"
                        value={lessonForm.lesson}
                        onChange={(e) => setLessonForm({ ...lessonForm, lesson: e.target.value })}
                        rows={2}
                      />
                      <Button size="sm" onClick={addLesson}>
                        <Plus className="h-3.5 w-3.5 ml-1" />
                        إضافة
                      </Button>
                    </div>
                  )}

                  {/* Learned Lessons */}
                  {selected.learned_lessons.length > 0 && (
                    <div>
                      <h4 className="text-sm font-bold mb-1">الدروس ({selected.learned_lessons.length})</h4>
                      <div className="space-y-2">
                        {selected.learned_lessons.map((lesson, i) => (
                          <div key={i} className="border rounded p-2 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={lesson.type === 'success' ? 'default' : lesson.type === 'failure' ? 'destructive' : 'secondary'}>
                                {lesson.type}
                              </Badge>
                              <span className="text-muted-foreground">{lesson.date}</span>
                            </div>
                            <div className="font-medium">{lesson.summary}</div>
                            <div className="text-muted-foreground mt-1">{lesson.lesson}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    آخر تحديث: {selected.last_updated} | إصدار: {selected.version}
                  </div>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

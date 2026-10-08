'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import {
  Plus, Trash2, Edit, RefreshCw, Search, Filter,
  TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle,
  MessageSquare, Send, Copy, Clock, User, ChevronDown, ChevronUp,
  FileText, List, Grip
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface ExpertRecommendation {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  expert_name: string;
  expert_source?: string;
  action: string;
  recommendation_type: 'quick' | 'detailed' | 'trade';
  entry_price: number;
  entry_price_from?: number;
  entry_price_to?: number;
  entry_condition?: string;
  target_price?: number;
  target_price_2?: number;
  investment_target?: number;
  stop_loss?: number;
  stop_loss_condition?: string;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  technical_analysis?: string;
  fundamental_analysis?: string;
  recommendation_reason?: string;
  session_date?: string;
  session_type?: string;
  expected_duration?: string;
  expected_duration_days?: number;
  notes?: string;
  status: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'CLOSED' | 'EXPIRED';
  final_price?: number;
  profit_loss_percent?: number;
  hit_target?: number;
  hit_stop_loss?: number;
  created_at: string;
  updated_at?: string;
}

interface ExpertInfo {
  code: string;
  name_ar: string;
  source: string;
  type: string;
}

// ============================================================================
// Constants
// ============================================================================

const EXPERTS: ExpertInfo[] = [
  { code: 'AF', name_ar: 'أحمد الفيومي', source: 'واتساب', type: 'محلل فني' },
  { code: 'RR', name_ar: 'ريمون رؤوف', source: 'مباشر للأوراق المالية', type: 'محلل فني' },
  { code: 'MH', name_ar: 'محسن', source: 'دليل الاستثمار', type: 'محلل استثماري' },
  { code: 'ADMIN', name_ar: 'توقّع الإدارة', source: 'منصة دليل الاستثمار', type: 'توقّع رسمي' },
];

const ACTIONS = [
  { value: 'BUY', label: 'شراء', color: 'bg-emerald-500' },
  { value: 'SELL', label: 'بيع', color: 'bg-red-500' },
  { value: 'ACCUMULATE', label: 'تجميع', color: 'bg-blue-500' },
  { value: 'REDUCE', label: 'تخفيض', color: 'bg-orange-500' },
  { value: 'HOLD', label: 'احتفاظ', color: 'bg-gray-500' },
];

const STATUSES = [
  { value: 'PENDING', label: 'قيد التنفيذ', color: 'bg-blue-500' },
  { value: 'TARGET_HIT', label: 'حقق الهدف', color: 'bg-emerald-500' },
  { value: 'STOP_HIT', label: 'ضرب الاستوب', color: 'bg-red-500' },
  { value: 'CLOSED', label: 'مغلق', color: 'bg-gray-500' },
  { value: 'EXPIRED', label: 'منتهي', color: 'bg-yellow-500' },
];

// ============================================================================
// Main Component
// ============================================================================

export function HumanRecommendationsAdmin() {
  const [recommendations, setRecommendations] = useState<ExpertRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterExpert, setFilterExpert] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingRec, setEditingRec] = useState<ExpertRecommendation | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<Partial<ExpertRecommendation>>({
    stock_symbol: '',
    stock_name_ar: '',
    expert_name: 'ADMIN',
    action: 'BUY',
    recommendation_type: 'detailed',
    entry_price: 0,
    entry_price_from: 0,
    entry_price_to: 0,
    target_price: 0,
    target_price_2: 0,
    investment_target: 0,
    stop_loss: 0,
    stop_loss_condition: '',
    support_level: 0,
    resistance_level: 0,
    notes: '',
    session_date: new Date().toISOString().split('T')[0],
    session_type: 'صباحية',
  });

  // Import state
  const [importText, setImportText] = useState('');
  const [importDate, setImportDate] = useState(new Date().toISOString().split('T')[0]);

  // Fetch recommendations
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.append('status', filterStatus);
      if (filterExpert !== 'all') params.append('expert', filterExpert);
      params.append('limit', '200');

      const res = await fetch(`/api/expert-recommendations?${params}`);
      const data = await res.json();

      if (data.success) {
        setRecommendations(data.recommendations || []);
      }
    } catch (err) {
      console.error('Error fetching recommendations:', err);
      toast.error('خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterExpert]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset form
  const resetForm = () => {
    setFormData({
      stock_symbol: '',
      stock_name_ar: '',
      expert_name: 'ADMIN',
      action: 'BUY',
      recommendation_type: 'detailed',
      entry_price: 0,
      entry_price_from: 0,
      entry_price_to: 0,
      target_price: 0,
      target_price_2: 0,
      investment_target: 0,
      stop_loss: 0,
      stop_loss_condition: '',
      support_level: 0,
      resistance_level: 0,
      notes: '',
      session_date: new Date().toISOString().split('T')[0],
      session_type: 'صباحية',
    });
  };

  // Add recommendation
  const handleAdd = async () => {
    if (!formData.stock_symbol || !formData.entry_price) {
      toast.error('يرجى ملء الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/expert-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (data.success) {
        toast.success('تم إضافة التوقّع بنجاح');
        setShowAddDialog(false);
        resetForm();
        fetchData();
      } else {
        toast.error(data.error || 'فشل في إضافة التوقّع');
      }
    } catch (err) {
      toast.error('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  // Update recommendation
  const handleUpdate = async () => {
    if (!editingRec) return;

    setSaving(true);
    try {
      const res = await fetch('/api/expert-recommendations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingRec.id, ...formData }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث التوقّع');
        setShowEditDialog(false);
        setEditingRec(null);
        resetForm();
        fetchData();
      } else {
        toast.error(data.error || 'فشل في التحديث');
      }
    } catch (err) {
      toast.error('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  // Delete recommendation
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/expert-recommendations?id=${id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف التوقّع');
        fetchData();
      } else {
        toast.error(data.error || 'فشل في الحذف');
      }
    } catch (err) {
      toast.error('خطأ في الاتصال');
    }
  };

  // Import from text
  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error('يرجى إدخال نص التوقعات');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/expert-recommendations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: importText,
          session_date: importDate,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.message || `تم استيراد ${data.imported} توقّع`);
        setShowImportDialog(false);
        setImportText('');
        fetchData();
      } else {
        toast.error(data.error || 'فشل في الاستيراد');
      }
    } catch (err) {
      toast.error('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  // Open edit dialog
  const openEdit = (rec: ExpertRecommendation) => {
    setEditingRec(rec);
    setFormData({
      stock_symbol: rec.stock_symbol,
      stock_name_ar: rec.stock_name_ar,
      expert_name: rec.expert_name,
      action: rec.action,
      recommendation_type: rec.recommendation_type,
      entry_price: rec.entry_price,
      entry_price_from: rec.entry_price_from,
      entry_price_to: rec.entry_price_to,
      target_price: rec.target_price,
      target_price_2: rec.target_price_2,
      investment_target: rec.investment_target,
      stop_loss: rec.stop_loss,
      stop_loss_condition: rec.stop_loss_condition,
      support_level: rec.support_level,
      resistance_level: rec.resistance_level,
      notes: rec.notes,
      session_date: rec.session_date,
      session_type: rec.session_type,
      status: rec.status,
    });
    setShowEditDialog(true);
  };

  // Filter recommendations
  const filteredRecs = recommendations.filter(rec => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (!rec.stock_symbol.toLowerCase().includes(search) &&
          !rec.stock_name_ar?.toLowerCase().includes(search) &&
          !rec.notes?.toLowerCase().includes(search)) {
        return false;
      }
    }
    return true;
  });

  // Stats
  const stats = {
    total: recommendations.length,
    pending: recommendations.filter(r => r.status === 'PENDING').length,
    targetHit: recommendations.filter(r => r.status === 'TARGET_HIT').length,
    stopHit: recommendations.filter(r => r.status === 'STOP_HIT').length,
    closed: recommendations.filter(r => r.status === 'CLOSED').length,
  };

  // Format price
  const formatPrice = (price: number | null | undefined) => {
    if (!price) return '—';
    return price.toFixed(2);
  };

  // ─── UnifiedTable columns ────────────────────────────────────────────
  const recsColumns: Column<ExpertRecommendation>[] = [
    {
      key: '_expand',
      header: '',
      align: 'center',
      width: 'w-12',
      hideable: false,
      render: (r) => expandedId === r.id
        ? <ChevronUp className="w-4 h-4 inline-block" />
        : <ChevronDown className="w-4 h-4 inline-block" />,
    },
    {
      key: 'stock_symbol',
      header: 'السهم',
      sortable: true,
      filterable: true,
      render: (r) => (
        <div>
          <span className="font-bold">{r.stock_symbol}</span>
          {r.stock_name_ar && (
            <span className="text-muted-foreground mr-2 text-sm">{r.stock_name_ar}</span>
          )}
        </div>
      ),
    },
    {
      key: 'expert_name',
      header: 'المحلل',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-32',
      render: (r) => {
        const expert = EXPERTS.find(e => e.code === r.expert_name);
        return <Badge variant="outline">{expert?.name_ar || r.expert_name}</Badge>;
      },
    },
    {
      key: 'action',
      header: 'الإجراء',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (r) => {
        const action = ACTIONS.find(a => a.value === r.action);
        return (
          <Badge className={cn("text-white", action?.color || 'bg-gray-500')}>
            {action?.label || r.action}
          </Badge>
        );
      },
    },
    {
      key: 'entry_price',
      header: 'الدخول',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      render: (r) => formatPrice(r.entry_price),
    },
    {
      key: 'target_price',
      header: 'الهدف',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-emerald-600 font-medium',
      render: (r) => formatPrice(r.target_price),
    },
    {
      key: 'stop_loss',
      header: 'الاستوب',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-24',
      className: 'text-red-600',
      render: (r) => formatPrice(r.stop_loss),
    },
    {
      key: 'status',
      header: 'الحالة',
      align: 'center',
      sortable: true,
      filterable: true,
      width: 'w-28',
      render: (r) => {
        const status = STATUSES.find(s => s.value === r.status);
        return (
          <Badge className={cn("text-white", status?.color || 'bg-gray-500')}>
            {status?.label || r.status}
          </Badge>
        );
      },
    },
    {
      key: 'session_date',
      header: 'التاريخ',
      align: 'right',
      sortable: true,
      filterable: true,
      width: 'w-32',
      className: 'text-sm text-muted-foreground',
    },
    {
      key: 'actions',
      header: 'إجراءات',
      align: 'center',
      width: 'w-20',
      hideable: false,
      render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
            <Edit className="w-4 h-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>حذف التوقّع</AlertDialogTitle>
                <AlertDialogDescription>
                  هل أنت متأكد من حذف توقّع {r.stock_symbol}؟
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-500 hover:bg-red-600"
                  onClick={() => handleDelete(r.id)}
                >
                  حذف
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
    },
  ];

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">توقعات المحللين</h2>
          <p className="text-sm text-muted-foreground">إدارة التوقعات البشرية للمستخدمين</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)} className="gap-1">
            <FileText className="w-4 h-4" />
            استيراد
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setShowAddDialog(true); }} className="gap-1">
            <Plus className="w-4 h-4" />
            إضافة توقّع
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">الإجمالي</div>
        </Card>
        <Card className="p-3 text-center bg-blue-50 dark:bg-blue-900/20">
          <div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
          <div className="text-xs text-muted-foreground">قيد التنفيذ</div>
        </Card>
        <Card className="p-3 text-center bg-emerald-50 dark:bg-emerald-900/20">
          <div className="text-2xl font-bold text-emerald-600">{stats.targetHit}</div>
          <div className="text-xs text-muted-foreground">حققت الهدف</div>
        </Card>
        <Card className="p-3 text-center bg-red-50 dark:bg-red-900/20">
          <div className="text-2xl font-bold text-red-600">{stats.stopHit}</div>
          <div className="text-xs text-muted-foreground">ضرب الاستوب</div>
        </Card>
        <Card className="p-3 text-center bg-gray-50 dark:bg-gray-900/20">
          <div className="text-2xl font-bold text-gray-600">{stats.closed}</div>
          <div className="text-xs text-muted-foreground">مغلقة</div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-48">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم أو الرمز..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-9"
                />
              </div>
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterExpert} onValueChange={setFilterExpert}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="المحلل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المحللين</SelectItem>
                {EXPERTS.map(e => (
                  <SelectItem key={e.code} value={e.code}>{e.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations List */}
      <Card>
        <CardContent className="p-0">
          {filteredRecs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد توقعات</p>
            </div>
          ) : (
            <UnifiedTable
              columns={recsColumns}
              data={filteredRecs}
              keyField="id"
              dense
              columnToggle
              filterable
              expandable
              onRowClick={(r) => setExpandedId(expandedId === r.id ? null : r.id)}
              rowClassName={() => 'cursor-pointer hover:bg-muted/50'}
              expandRender={(rec) => (
                <div className="p-4 bg-muted/30">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium">منطقة الدخول:</span>{' '}
                      {formatPrice(rec.entry_price_from)} - {formatPrice(rec.entry_price_to)}
                    </div>
                    <div>
                      <span className="font-medium">الهدف الثاني:</span>{' '}
                      {formatPrice(rec.target_price_2)}
                    </div>
                    <div>
                      <span className="font-medium">الهدف الاستثماري:</span>{' '}
                      {formatPrice(rec.investment_target)}
                    </div>
                    <div>
                      <span className="font-medium">الدعم:</span>{' '}
                      {formatPrice(rec.support_level)}
                    </div>
                    <div>
                      <span className="font-medium">المقاومة:</span>{' '}
                      {formatPrice(rec.resistance_level)}
                    </div>
                    <div>
                      <span className="font-medium">شرط الاستوب:</span>{' '}
                      {rec.stop_loss_condition || '—'}
                    </div>
                    {rec.notes && (
                      <div className="col-span-3">
                        <span className="font-medium">ملاحظات:</span>{' '}
                        {rec.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>إضافة توقّع جديد</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>رمز السهم *</Label>
              <Input
                value={formData.stock_symbol}
                onChange={(e) => setFormData({ ...formData, stock_symbol: e.target.value.toUpperCase() })}
                placeholder="COMI"
              />
            </div>
            <div className="space-y-2">
              <Label>اسم السهم</Label>
              <Input
                value={formData.stock_name_ar}
                onChange={(e) => setFormData({ ...formData, stock_name_ar: e.target.value })}
                placeholder="البنك التجاري الدولي"
              />
            </div>
            <div className="space-y-2">
              <Label>المحلل</Label>
              <Select
                value={formData.expert_name}
                onValueChange={(v) => setFormData({ ...formData, expert_name: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPERTS.map(e => (
                    <SelectItem key={e.code} value={e.code}>{e.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الإجراء</Label>
              <Select
                value={formData.action}
                onValueChange={(v) => setFormData({ ...formData, action: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map(a => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>سعر الدخول *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.entry_price || ''}
                onChange={(e) => setFormData({ ...formData, entry_price: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>نوع التوقّع</Label>
              <Select
                value={formData.recommendation_type}
                onValueChange={(v) => setFormData({ ...formData, recommendation_type: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">سريعة</SelectItem>
                  <SelectItem value="detailed">مفصلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>سعر الدخول من</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.entry_price_from || ''}
                onChange={(e) => setFormData({ ...formData, entry_price_from: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>سعر الدخول إلى</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.entry_price_to || ''}
                onChange={(e) => setFormData({ ...formData, entry_price_to: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الهدف الأول</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.target_price || ''}
                onChange={(e) => setFormData({ ...formData, target_price: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الهدف الثاني</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.target_price_2 || ''}
                onChange={(e) => setFormData({ ...formData, target_price_2: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الهدف الاستثماري</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.investment_target || ''}
                onChange={(e) => setFormData({ ...formData, investment_target: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الاستوب لوس</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.stop_loss || ''}
                onChange={(e) => setFormData({ ...formData, stop_loss: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>شرط الاستوب</Label>
              <Input
                value={formData.stop_loss_condition || ''}
                onChange={(e) => setFormData({ ...formData, stop_loss_condition: e.target.value })}
                placeholder="إغلاق"
              />
            </div>
            <div className="space-y-2">
              <Label>مستوى الدعم</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.support_level || ''}
                onChange={(e) => setFormData({ ...formData, support_level: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>مستوى المقاومة</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.resistance_level || ''}
                onChange={(e) => setFormData({ ...formData, resistance_level: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>تاريخ الجلسة</Label>
              <Input
                type="date"
                value={formData.session_date || ''}
                onChange={(e) => setFormData({ ...formData, session_date: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="ملاحظات إضافية..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل التوقّع</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>رمز السهم</Label>
              <Input
                value={formData.stock_symbol}
                onChange={(e) => setFormData({ ...formData, stock_symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label>اسم السهم</Label>
              <Input
                value={formData.stock_name_ar}
                onChange={(e) => setFormData({ ...formData, stock_name_ar: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>المحلل</Label>
              <Select
                value={formData.expert_name}
                onValueChange={(v) => setFormData({ ...formData, expert_name: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPERTS.map(e => (
                    <SelectItem key={e.code} value={e.code}>{e.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الإجراء</Label>
              <Select
                value={formData.action}
                onValueChange={(v) => setFormData({ ...formData, action: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map(a => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>سعر الدخول</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.entry_price || ''}
                onChange={(e) => setFormData({ ...formData, entry_price: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الحالة</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData({ ...formData, status: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الهدف الأول</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.target_price || ''}
                onChange={(e) => setFormData({ ...formData, target_price: parseFloat(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>الاستوب لوس</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.stop_loss || ''}
                onChange={(e) => setFormData({ ...formData, stop_loss: parseFloat(e.target.value) })}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>إلغاء</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">📋 استيراد توقعات من نص واتساب</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>تاريخ الجلسة</Label>
              <Input
                type="date"
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>نص التوقعات (واتساب)</Label>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`*توقعات صباحية لجلسة الأحد 7-6-2026*

1- *جهينة JUFO اخر سعر 29.90*
شراء واحتفاظ في 29.70 الي 29.45
او الاستقرار اعلاه 29.90 يعطي شراء
*هدف البيع 31.50 ثم 34.80*
*هدف استثماري في 36 جنية*
استوب كسر 28.70 اغلاق

2- *الكابلات ELEC اخر سعر 2.17*
...`}
                rows={12}
                className="font-mono text-sm"
              />
            </div>
            <div className="bg-muted/50 p-3 rounded-lg text-sm">
              <p className="font-medium mb-2">✅ يتم استخراج البيانات تلقائياً:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>رمز السهم واسمه وآخر سعر</li>
                <li>منطقة الدخول (من - إلى)</li>
                <li>أهداف البيع والهدف الاستثماري</li>
                <li>وقف الخسارة وشرطه</li>
                <li>مستويات الدعم والمقاومة</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>إلغاء</Button>
            <Button onClick={handleImport} disabled={saving}>
              {saving ? 'جاري الاستيراد...' : 'استيراد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default HumanRecommendationsAdmin;

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Wallet, Plus, Trash2, Pencil, RefreshCw, Layers, Building2, Bitcoin } from 'lucide-react';
import { toast } from 'sonner';

export interface PortfolioAccount {
  id: number;
  user_id: string;
  name: string;
  broker: string;
  market: string;
  currency: string;
  color?: string;
  is_master: boolean;
  initial_capital: number;
  created_at?: string;
  updated_at?: string;
  current_value?: number;
  cash?: number;
  invested?: number;
  pnl?: number;
  pnl_pct?: number;
  positions_count?: number;
}

export const COLOR_OPTIONS = [
  { value: 'emerald', label: '🟢 أخضر (Emerald)', class: 'bg-emerald-500/20 text-emerald-400 border-emerald-700' },
  { value: 'blue', label: '🔵 أزرق (Blue)', class: 'bg-blue-500/20 text-blue-400 border-blue-700' },
  { value: 'purple', label: '🟣 بنفسجي (Purple)', class: 'bg-purple-500/20 text-purple-400 border-purple-700' },
  { value: 'amber', label: '🟡 أصفر / ذهبي (Amber)', class: 'bg-amber-500/20 text-amber-400 border-amber-700' },
  { value: 'rose', label: '🔴 أحمر / وردي (Rose)', class: 'bg-rose-500/20 text-rose-400 border-rose-700' },
  { value: 'indigo', label: '🔷 نيلي (Indigo)', class: 'bg-indigo-500/20 text-indigo-400 border-indigo-700' },
  { value: 'teal', label: '🪸 تركوازي (Teal)', class: 'bg-teal-500/20 text-teal-400 border-teal-700' },
  { value: 'cyan', label: '🌐 سيان (Cyan)', class: 'bg-cyan-500/20 text-cyan-400 border-cyan-700' },
];

export function getPortfolioColorClass(colorName?: string): string {
  const found = COLOR_OPTIONS.find(c => c.value === colorName);
  return found ? found.class : 'bg-blue-500/20 text-blue-400 border-blue-700';
}

interface MultiPortfolioSelectorProps {
  userId: string;
  selectedPortfolioId: number | 'master';
  onSelect: (id: number | 'master') => void;
  onRefresh?: () => void;
}

const BROKER_OPTIONS = [
  { value: 'Thndr', label: 'ثاندر (Thndr - EGX)', icon: '📱' },
  { value: 'Direct', label: 'مباشر (Mubasher - EGX/GCC)', icon: '🖥️' },
  { value: 'InteractiveBrokers', label: 'إنترأكتيف بروكرز (Interactive Brokers - US/Global)', icon: '🌐' },
  { value: 'Derayah', label: 'دراية المالية (Derayah - KSA)', icon: '🇸🇦' },
  { value: 'Binance', label: 'بينانس (Binance - Crypto)', icon: '🟡' },
  { value: 'Hermes', label: 'هيرميس (EFG Hermes)', icon: '🏛️' },
  { value: 'Manual', label: 'حساب يدوي (Manual / Other)', icon: '✋' },
];

const MARKET_OPTIONS = [
  { value: 'ALL', label: 'جميع الأسواق العالمية (Global All Markets)' },
  { value: 'EGX', label: 'البورصة المصرية (EGX - Egypt)' },
  { value: 'US', label: 'الأسهم الأمريكية (US Stocks - NYSE / NASDAQ)' },
  { value: 'TADAWUL', label: 'السوق السعودي (Saudi Tadawul - KSA)' },
  { value: 'CRYPTO', label: 'العملات الرقمية (Crypto)' },
  { value: 'FOREX', label: 'العملات الأجنبية والفوركس (Forex)' },
  { value: 'METALS', label: 'الذهب والمعادن (Gold & Metals)' },
];

const CURRENCY_OPTIONS = [
  { value: 'EGP', label: 'جنيه مصري (EGP)' },
  { value: 'USD', label: 'دولار أمريكي (USD)' },
  { value: 'SAR', label: 'ريال سعودي (SAR)' },
  { value: 'EUR', label: 'يورو (EUR)' },
  { value: 'AED', label: 'درهم إماراتي (AED)' },
  { value: 'USDT', label: 'تيزر (USDT)' },
];

function getBrokerIcon(broker: string): React.ReactNode {
  if (broker === 'Binance') return <Bitcoin className="h-3.5 w-3.5" />;
  if (broker === 'master') return <Layers className="h-3.5 w-3.5" />;
  return <Building2 className="h-3.5 w-3.5" />;
}

function getBrokerColor(broker: string): string {
  if (broker === 'Binance') return 'text-amber-400 bg-amber-950/40 border-amber-800';
  if (broker === 'master') return 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
  if (broker === 'Thndr') return 'text-blue-400 bg-blue-950/40 border-blue-800';
  if (broker === 'Direct') return 'text-purple-400 bg-purple-950/40 border-purple-800';
  return 'text-zinc-400 bg-zinc-900/40 border-zinc-700';
}

export function MultiPortfolioSelector({
  userId,
  selectedPortfolioId,
  onSelect,
  onRefresh,
}: MultiPortfolioSelectorProps) {
  const [portfolios, setPortfolios] = useState<PortfolioAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<PortfolioAccount | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formBroker, setFormBroker] = useState('Thndr');
  const [formMarket, setFormMarket] = useState('EGX');
  const [formCurrency, setFormCurrency] = useState('EGP');
  const [formColor, setFormColor] = useState('blue');
  const [formCapital, setFormCapital] = useState('');

  // Edit modal state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<PortfolioAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editBroker, setEditBroker] = useState('Thndr');
  const [editMarket, setEditMarket] = useState('EGX');
  const [editCurrency, setEditCurrency] = useState('EGP');
  const [editColor, setEditColor] = useState('blue');
  const [editCapital, setEditCapital] = useState('');

  const [saving, setSaving] = useState(false);

  const fetchPortfolios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/accounts?user_id=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.success) {
        setPortfolios(data.portfolios || []);
      } else {
        toast.error('فشل تحميل المحافظ', { description: data.error });
      }
    } catch (err) {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchPortfolios();
  }, [fetchPortfolios]);

  const handleAddPortfolio = async () => {
    if (!formName.trim()) {
      toast.error('أدخل اسم المحفظة');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/portfolio/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          name: formName.trim(),
          broker: formBroker,
          market: formMarket,
          currency: formCurrency,
          color: formColor,
          initial_capital: formCapital ? parseFloat(formCapital) : 0,
          action: 'create',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم إنشاء المحفظة بنجاح ✅', { description: formName });
        setAddDialogOpen(false);
        setFormName('');
        setFormCapital('');
        fetchPortfolios();
        onRefresh?.();
      } else {
        toast.error('فشل إنشاء المحفظة', { description: data.error });
      }
    } catch {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (portfolio: PortfolioAccount) => {
    setEditingPortfolio(portfolio);
    setEditName(portfolio.name);
    setEditBroker(portfolio.broker || 'Thndr');
    setEditMarket(portfolio.market || 'EGX');
    setEditCurrency(portfolio.currency || 'EGP');
    setEditColor(portfolio.color || 'blue');
    setEditCapital(portfolio.initial_capital ? String(portfolio.initial_capital) : '');
    setEditDialogOpen(true);
  };

  const handleUpdatePortfolio = async () => {
    if (!editingPortfolio || !editName.trim()) {
      toast.error('أدخل اسم المحفظة');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/portfolio/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          portfolio_id: editingPortfolio.id,
          name: editName.trim(),
          broker: editBroker,
          market: editMarket,
          currency: editCurrency,
          color: editColor,
          initial_capital: editCapital ? parseFloat(editCapital) : 0,
          action: 'update',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث المحفظة بنجاح ✅');
        setEditDialogOpen(false);
        fetchPortfolios();
        onRefresh?.();
      } else {
        toast.error('فشل تحديث المحفظة', { description: data.error });
      }
    } catch {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePortfolio = async (portfolio: PortfolioAccount) => {
    try {
      const res = await fetch('/api/portfolio/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          portfolio_id: portfolio.id,
          action: 'delete',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف المحفظة');
        setDeleteConfirm(null);
        if (selectedPortfolioId === portfolio.id) {
          onSelect('master');
        }
        fetchPortfolios();
        onRefresh?.();
      } else {
        toast.error('فشل الحذف', { description: data.error });
      }
    } catch {
      toast.error('فشل الاتصال بالخادم');
    }
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-bold text-foreground">المحافظ متعددة الحسابات</h3>
          {portfolios.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {portfolios.length} محفظة
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPortfolios}
            disabled={loading}
            className="h-7 w-7 p-0"
            title="تحديث"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="h-3.5 w-3.5 ml-1" />
            محفظة جديدة
          </Button>
        </div>
      </div>

      {/* Portfolio tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Master tab */}
        <button
          onClick={() => onSelect('master')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
            selectedPortfolioId === 'master'
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-700'
              : 'bg-zinc-900/40 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300'
          }`}
          title="عرض المحفظة الأم (المجمّعة)"
        >
          <Layers className="h-3.5 w-3.5" />
          المحفظة الأم
        </button>

        {/* Sub-portfolio tabs */}
        {portfolios
          .filter((p) => !p.is_master)
          .map((p) => {
            const colorStyle = getPortfolioColorClass(p.color);
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  selectedPortfolioId === p.id
                    ? colorStyle
                    : 'bg-zinc-900/40 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300'
                }`}
                title={`${p.name} (${p.broker})`}
              >
                {getBrokerIcon(p.broker)}
                <span className="truncate max-w-[120px]">{p.name}</span>
                {p.broker && (
                  <span className="text-[9px] opacity-70">({p.broker})</span>
                )}
              </button>
            );
          })}
      </div>

      {/* Add Portfolio Modal */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-500" />
              إضافة محفظة جديدة
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">اسم المحفظة *</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="مثال: محفظة ثاندر للأسهم"
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">الوسيط (Broker)</label>
                <Select value={formBroker} onValueChange={setFormBroker}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKER_OPTIONS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.icon} {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">السوق</label>
                <Select value={formMarket} onValueChange={setFormMarket}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">العملة</label>
                <Select value={formCurrency} onValueChange={setFormCurrency}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">لون المحفظة المميز 🎨</label>
                <Select value={formColor} onValueChange={setFormColor}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">رأس المال الابتدائي</label>
              <Input
                type="number"
                value={formCapital}
                onChange={(e) => setFormCapital(e.target.value)}
                placeholder="0"
                className="h-9"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleAddPortfolio} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving ? 'جاري الحفظ...' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Portfolio Modal */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-400">
              <Pencil className="h-5 w-5 text-blue-400" />
              تعديل بيانات المحفظة &quot;{editingPortfolio?.name}&quot;
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">اسم المحفظة *</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="اسم المحفظة"
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">الوسيط (Broker)</label>
                <Select value={editBroker} onValueChange={setEditBroker}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKER_OPTIONS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.icon} {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">السوق</label>
                <Select value={editMarket} onValueChange={setEditMarket}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">العملة</label>
                <Select value={editCurrency} onValueChange={setEditCurrency}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">لون المحفظة المميز 🎨</label>
                <Select value={editColor} onValueChange={setEditColor}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">رأس المال الابتدائي</label>
              <Input
                type="number"
                value={editCapital}
                onChange={(e) => setEditCapital(e.target.value)}
                placeholder="0"
                className="h-9"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleUpdatePortfolio} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? 'جاري التحديث...' : 'حفظ التعديلات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Trash2 className="h-5 w-5" />
              حذف المحفظة
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            هل أنت متأكد من حذف محفظة &quot;{deleteConfirm?.name}&quot;؟
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDeletePortfolio(deleteConfirm)}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Portfolio list with Edit & Delete buttons (only sub-portfolios) */}
      {portfolios.filter((p) => !p.is_master).length > 0 && selectedPortfolioId === 'master' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">إدارة المحافظ الفرعية والألوان:</p>
          {portfolios
            .filter((p) => !p.is_master)
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full ${getPortfolioColorClass(p.color)}`}>
                    {getBrokerIcon(p.broker)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${getPortfolioColorClass(p.color)}`}>
                        {p.color || 'blue'}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {p.broker} • {p.market} • {p.currency}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(p)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-400 hover:bg-blue-950/40"
                    title="تعديل المحفظة"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirm(p)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500 hover:bg-red-950/40"
                    title="حذف"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

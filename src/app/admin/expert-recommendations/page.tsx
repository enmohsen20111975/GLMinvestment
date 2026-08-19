'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  User,
  Target,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Upload,
  Download,
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Award,
  Clock,
  Search,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface Stock {
  ticker: string;
  name_ar?: string;
  name_en?: string;
  last_price?: number;
  sector?: string;
}

interface ExpertRecommendation {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  expert_name: string;
  expert_source: string;
  action: string;
  recommendation_type: string;
  entry_price: number;
  entry_price_from?: number | null;
  entry_price_to?: number | null;
  entry_condition?: string | null;
  target_price?: number;
  target_price_2?: number;
  investment_target?: number;
  stop_loss?: number;
  stop_loss_condition?: string | null;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  expected_profit_investment?: number;
  technical_analysis?: string;
  fundamental_analysis?: string;
  recommendation_reason?: string;
  session_date?: string;
  session_type?: string;
  recommendation_date: string;
  expected_duration?: string;
  expected_duration_days?: number;
  status: string;
  final_price?: number;
  profit_loss_percent?: number;
  hit_target: boolean;
  hit_stop_loss: boolean;
  notes?: string;
}

interface ExpertStats {
  expert_name: string;
  total_recommendations: number;
  successful_recommendations: number;
  success_rate: number;
  avg_return: number;
}

// ==================== COMPONENT ====================

export default function ExpertRecommendationsAdminPage() {
  // State
  const [recommendations, setRecommendations] = useState<ExpertRecommendation[]>([]);
  const [expertStats, setExpertStats] = useState<ExpertStats[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    stock_symbol: '',
    stock_name_ar: '',
    expert_name: '',
    expert_source: '',
    action: 'BUY',
    recommendation_type: 'detailed',
    entry_price: '',
    entry_price_from: '',
    entry_price_to: '',
    entry_condition: '',
    target_price: '',
    target_price_2: '',
    investment_target: '',
    stop_loss: '',
    stop_loss_condition: '',
    support_level: '',
    resistance_level: '',
    expected_profit_min: '',
    expected_profit_max: '',
    expected_profit_investment: '',
    technical_analysis: '',
    fundamental_analysis: '',
    recommendation_reason: '',
    session_date: '',
    session_type: 'صباحية',
    expected_duration: '',
    expected_duration_days: '',
    notes: '',
  });
  
  // Stock search
  const [stockSearch, setStockSearch] = useState('');
  const [showStockDropdown, setShowStockDropdown] = useState(false);
  const [importText, setImportText] = useState('');

  // Fetch stocks list
  const fetchStocks = useCallback(async () => {
    setStocksLoading(true);
    try {
      const res = await fetch('/api/stocks?limit=500');
      const data = await res.json();
      if (data.stocks) {
        setStocks(data.stocks.map((s: any) => ({
          ticker: s.ticker,
          name_ar: s.name_ar,
          name_en: s.name_en,
          last_price: s.last_price || s.close_price,
          sector: s.sector,
        })));
      }
    } catch (error) {
      console.error('Error fetching stocks:', error);
    } finally {
      setStocksLoading(false);
    }
  }, []);

  // Fetch recommendations
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/expert-recommendations?limit=200');
      const data = await res.json();
      if (data.success) {
        setRecommendations(data.recommendations || []);
        setExpertStats(data.expertStats || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStocks();
    fetchData();
  }, [fetchStocks, fetchData]);

  // Filter stocks by search
  const filteredStocks = useMemo(() => {
    if (!stockSearch.trim()) return stocks.slice(0, 50);
    const q = stockSearch.toLowerCase();
    return stocks
      .filter(s => 
        s.ticker.toLowerCase().includes(q) || 
        (s.name_ar && s.name_ar.includes(q)) ||
        (s.name_en && s.name_en.toLowerCase().includes(q))
      )
      .slice(0, 20);
  }, [stocks, stockSearch]);

  // Handle stock selection
  const handleSelectStock = (stock: Stock) => {
    setFormData(prev => ({
      ...prev,
      stock_symbol: stock.ticker,
      stock_name_ar: stock.name_ar || '',
      entry_price: stock.last_price ? stock.last_price.toString() : prev.entry_price,
    }));
    setStockSearch('');
    setShowStockDropdown(false);
  };

  // Handle add recommendation
  const handleAddRecommendation = async () => {
    // Only stock_symbol is required
    if (!formData.stock_symbol.trim()) {
      toast.error('يرجى اختيار السهم');
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
        toast.success('تم إضافة التحليل بنجاح');
        setAddDialogOpen(false);
        resetForm();
        fetchData();
      } else {
        toast.error(data.error || 'فشل في إضافة التحليل');
      }
    } catch (error) {
      toast.error('فشل في إضافة التحليل');
    } finally {
      setSaving(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      stock_symbol: '',
      stock_name_ar: '',
      expert_name: '',
      expert_source: '',
      action: 'BUY',
      recommendation_type: 'detailed',
      entry_price: '',
      entry_price_from: '',
      entry_price_to: '',
      entry_condition: '',
      target_price: '',
      target_price_2: '',
      investment_target: '',
      stop_loss: '',
      stop_loss_condition: '',
      support_level: '',
      resistance_level: '',
      expected_profit_min: '',
      expected_profit_max: '',
      expected_profit_investment: '',
      technical_analysis: '',
      fundamental_analysis: '',
      recommendation_reason: '',
      session_date: '',
      session_type: 'صباحية',
      expected_duration: '',
      expected_duration_days: '',
      notes: '',
    });
    setStockSearch('');
  };

  // Handle import
  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error('يرجى إدخال البيانات');
      return;
    }

    try {
      let recommendations: any[] = [];
      
      try {
        recommendations = JSON.parse(importText);
      } catch {
        const lines = importText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const rec: any = {};
          headers.forEach((h, idx) => {
            rec[h] = values[idx]?.trim();
          });
          recommendations.push(rec);
        }
      }

      if (!Array.isArray(recommendations) || recommendations.length === 0) {
        toast.error('صيغة البيانات غير صحيحة');
        return;
      }

      const res = await fetch('/api/expert-recommendations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendations }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setImportDialogOpen(false);
        setImportText('');
        fetchData();
      } else {
        toast.error(data.error || 'فشل في الاستيراد');
      }
    } catch (error) {
      toast.error('فشل في تحليل البيانات');
    }
  };

  // Delete recommendation
  const deleteRecommendation = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه التحليل؟')) return;
    try {
      const res = await fetch(`/api/expert-recommendations?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('تم حذف التحليل');
        fetchData();
      }
    } catch (error) {
      toast.error('فشل في حذف التحليل');
    }
  };

  // Status helpers
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-blue-500';
      case 'HIT_TARGET': return 'bg-emerald-500';
      case 'STOPPED': return 'bg-red-500';
      case 'CLOSED': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'PENDING': return 'قيد المتابعة';
      case 'HIT_TARGET': return 'حقق الهدف';
      case 'STOPPED': return 'وقف خسارة';
      case 'CLOSED': return 'مغلق';
      case 'CANCELLED': return 'ملغي';
      default: return status;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'BUY': return 'شراء';
      case 'BUY_AND_HOLD': return 'شراء واحتفاظ';
      case 'AVERAGE_DOWN': return 'متوسط شراء';
      case 'SELL': return 'بيع';
      case 'HOLD': return 'احتفاظ';
      default: return action;
    }
  };

  const getRecTypeLabel = (type: string) => {
    switch (type) {
      case 'quick': return '⚡ سريعة';
      case 'detailed': return '📋 تفصيلية';
      default: return type;
    }
  };

  const filteredRecs = recommendations.filter(r => {
    if (activeTab === 'pending') return r.status === 'PENDING';
    if (activeTab === 'quick') return r.recommendation_type === 'quick';
    if (activeTab === 'detailed') return r.recommendation_type === 'detailed' || !r.recommendation_type;
    if (activeTab === 'closed') return r.status !== 'PENDING';
    return true;
  });

  // Get selected stock info
  const selectedStock = useMemo(() => {
    return stocks.find(s => s.ticker === formData.stock_symbol);
  }, [stocks, formData.stock_symbol]);

  return (
    <div className="container mx-auto p-4 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">تحليلات الخبراء</h1>
          <p className="text-muted-foreground">إدارة ومتابعة تحليلات الخبراء</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 ml-2" />
            تحديث
          </Button>
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="w-4 h-4 ml-2" />
                استيراد
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>استيراد تحليلات الخبراء</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  أدخل البيانات بصيغة JSON أو CSV
                </div>
                <textarea
                  className="w-full h-64 p-3 border rounded-lg font-mono text-sm"
                  placeholder={`[
  {"stock_symbol": "COMI", "expert_name": "خبير 1", "action": "BUY", "entry_price": 25.5, "target_price": 28},
  {"stock_symbol": "ETAL", "expert_name": "خبير 2", "action": "SELL", "entry_price": 10.2}
]`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={handleImport} className="flex-1">
                    استيراد
                  </Button>
                  <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 ml-2" />
                إضافة تحليل
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold">إضافة تحليل جديدة</DialogTitle>
                <p className="text-sm text-muted-foreground">يمكنك إضافة التحليل بأي قدر من البيانات المتاحة</p>
              </DialogHeader>
              
              <div className="space-y-6">
                {/* Recommendation Type Toggle */}
                <div className="flex gap-2 p-1 bg-muted rounded-lg">
                  <button
                    type="button"
                    className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-1 ${formData.recommendation_type === 'detailed' ? 'bg-emerald-600 text-white' : 'hover:bg-muted/80'}`}
                    onClick={() => setFormData({ ...formData, recommendation_type: 'detailed' })}
                  >
                    📋 تفصيلية
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-1 ${formData.recommendation_type === 'quick' ? 'bg-purple-600 text-white' : 'hover:bg-muted/80'}`}
                    onClick={() => setFormData({ ...formData, recommendation_type: 'quick', action: formData.action === 'HOLD' ? 'BUY' : formData.action })}
                  >
                    ⚡ سريعة (T+0)
                  </button>
                </div>

                {/* Stock Selection - Main Field */}
                <Card className="border-2 border-emerald-200 dark:border-emerald-900">
                  <CardContent className="p-4">
                    <Label className="text-base font-bold text-emerald-700 dark:text-emerald-300 mb-2 block">
                      اختيار السهم (مطلوب)
                    </Label>
                    <div className="relative">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            placeholder="ابحث برمز السهم أو اسمه..."
                            value={stockSearch}
                            onChange={(e) => {
                              setStockSearch(e.target.value);
                              setShowStockDropdown(true);
                            }}
                            onFocus={() => setShowStockDropdown(true)}
                            className="pr-9"
                          />
                        </div>
                        {formData.stock_symbol && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-100 dark:bg-emerald-950/30 rounded-lg">
                            <span className="font-bold text-emerald-700">{formData.stock_symbol}</span>
                            {selectedStock?.last_price && (
                              <span className="text-sm text-muted-foreground">
                                ({selectedStock.last_price.toFixed(2)} ج.م)
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                resetForm();
                              }}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      {/* Stock Dropdown */}
                      {showStockDropdown && stockSearch && (
                        <div className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {stocksLoading ? (
                            <div className="p-4 text-center text-muted-foreground">
                              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                              <span className="mt-2 block">جاري تحميل الأسهم...</span>
                            </div>
                          ) : filteredStocks.length === 0 ? (
                            <div className="p-4 text-center text-muted-foreground">
                              لا توجد نتائج
                            </div>
                          ) : (
                            filteredStocks.map((stock) => (
                              <button
                                key={stock.ticker}
                                className="w-full p-3 text-right hover:bg-muted flex items-center justify-between"
                                onClick={() => handleSelectStock(stock)}
                              >
                                <div>
                                  <span className="font-bold">{stock.ticker}</span>
                                  {stock.name_ar && (
                                    <span className="text-muted-foreground mr-2">- {stock.name_ar}</span>
                                  )}
                                </div>
                                {stock.last_price && (
                                  <span className="text-sm text-muted-foreground">
                                    {stock.last_price.toFixed(2)} ج.م
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Selected stock info */}
                    {selectedStock && (
                      <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">الاسم: </span>
                            <span className="font-medium">{selectedStock.name_ar || '—'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">السعر الحالي: </span>
                            <span className="font-bold text-emerald-600">
                              {selectedStock.last_price?.toFixed(2) || '—'} ج.م
                            </span>
                          </div>
                          {selectedStock.sector && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">القطاع: </span>
                              <span>{selectedStock.sector}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Expert & Action Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>اسم الخبير</Label>
                    <Input
                      value={formData.expert_name}
                      onChange={(e) => setFormData({ ...formData, expert_name: e.target.value })}
                      placeholder="اسم الخبير أو المصدر"
                    />
                  </div>
                  <div>
                    <Label>مصدر التحليل</Label>
                    <Input
                      value={formData.expert_source}
                      onChange={(e) => setFormData({ ...formData, expert_source: e.target.value })}
                      placeholder="جلسة، قناة، تحليل..."
                    />
                  </div>
                </div>

                {/* Action & Entry Price */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>التحليل</Label>
                    <select
                      className="w-full p-2 border rounded-lg bg-background"
                      value={formData.action}
                      onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                    >
                      <option value="BUY">شراء</option>
                      <option value="BUY_AND_HOLD">شراء واحتفاظ</option>
                      <option value="AVERAGE_DOWN">متوسط شراء</option>
                      <option value="SELL">بيع</option>
                      <option value="HOLD">احتفاظ</option>
                    </select>
                  </div>
                  <div>
                    <Label>سعر الدخول</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.entry_price}
                      onChange={(e) => setFormData({ ...formData, entry_price: e.target.value })}
                      placeholder={selectedStock?.last_price?.toFixed(2) || "السعر الحالي"}
                    />
                    {selectedStock?.last_price && !formData.entry_price && (
                      <p className="text-xs text-muted-foreground mt-1">
                        السعر الحالي: {selectedStock.last_price.toFixed(2)} ج.م
                      </p>
                    )}
                  </div>
                </div>

                {/* Target & Stop Loss */}
                <div className={formData.recommendation_type === 'detailed' ? 'grid grid-cols-1 md:grid-cols-4 gap-4' : 'grid grid-cols-1 md:grid-cols-2 gap-4'}>
                  <div>
                    <Label>السعر المستهدف 1</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.target_price}
                      onChange={(e) => setFormData({ ...formData, target_price: e.target.value })}
                      placeholder="الهدف الأول"
                    />
                  </div>
                  {formData.recommendation_type === 'detailed' && (
                    <>
                      <div>
                        <Label>السعر المستهدف 2</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.target_price_2}
                          onChange={(e) => setFormData({ ...formData, target_price_2: e.target.value })}
                          placeholder="الهدف الثاني"
                        />
                      </div>
                      <div>
                        <Label>الهدف الاستثماري</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.investment_target}
                          onChange={(e) => setFormData({ ...formData, investment_target: e.target.value })}
                          placeholder="الهدف الاستثماري"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <Label>وقف الخسارة</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.stop_loss}
                      onChange={(e) => setFormData({ ...formData, stop_loss: e.target.value })}
                      placeholder="حد الخسارة"
                    />
                  </div>
                </div>

                {/* Entry Price Range (detailed only) */}
                {formData.recommendation_type === 'detailed' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>سعر الدخول من</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.entry_price_from}
                        onChange={(e) => setFormData({ ...formData, entry_price_from: e.target.value })}
                        placeholder="88.30"
                      />
                    </div>
                    <div>
                      <Label>سعر الدخول إلى</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.entry_price_to}
                        onChange={(e) => setFormData({ ...formData, entry_price_to: e.target.value })}
                        placeholder="88.00"
                      />
                    </div>
                    <div>
                      <Label>شرط الدخول</Label>
                      <Input
                        value={formData.entry_condition}
                        onChange={(e) => setFormData({ ...formData, entry_condition: e.target.value })}
                        placeholder="أو الاستقرار أعلاه 88.90"
                      />
                    </div>
                  </div>
                )}

                {/* Support & Resistance */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>مستوى الدعم</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.support_level}
                      onChange={(e) => setFormData({ ...formData, support_level: e.target.value })}
                      placeholder="مستوى الدعم"
                    />
                  </div>
                  {formData.recommendation_type === 'detailed' && (
                    <div>
                      <Label>مستوى المقاومة</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.resistance_level}
                        onChange={(e) => setFormData({ ...formData, resistance_level: e.target.value })}
                        placeholder="مستوى المقاومة"
                      />
                    </div>
                  )}
                </div>

                {/* Expected Profit (detailed only) */}
                {formData.recommendation_type === 'detailed' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>الربح المتوقع % (أدنى)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.expected_profit_min}
                        onChange={(e) => setFormData({ ...formData, expected_profit_min: e.target.value })}
                        placeholder="2.5%"
                      />
                    </div>
                    <div>
                      <Label>الربح المتوقع % (أقصى)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.expected_profit_max}
                        onChange={(e) => setFormData({ ...formData, expected_profit_max: e.target.value })}
                        placeholder="4%"
                      />
                    </div>
                    <div>
                      <Label>ربح الهدف الاستثماري %</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.expected_profit_investment}
                        onChange={(e) => setFormData({ ...formData, expected_profit_investment: e.target.value })}
                        placeholder="7%"
                      />
                    </div>
                  </div>
                )}

                {/* Session Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>تاريخ الجلسة</Label>
                    <Input
                      type="date"
                      value={formData.session_date}
                      onChange={(e) => setFormData({ ...formData, session_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>نوع الجلسة</Label>
                    <select
                      className="w-full p-2 border rounded-lg bg-background"
                      value={formData.session_type}
                      onChange={(e) => setFormData({ ...formData, session_type: e.target.value })}
                    >
                      <option value="صباحية">صباحية</option>
                      <option value="مسائية">مسائية</option>
                      <option value="مباشرة">مباشرة</option>
                      <option value="تحليل">تحليل</option>
                    </select>
                  </div>
                </div>

                {/* Stop Loss Condition & Duration (detailed only) */}
                {formData.recommendation_type === 'detailed' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>شرط وقف الخسارة</Label>
                      <select
                        className="w-full p-2 border rounded-lg bg-background"
                        value={formData.stop_loss_condition || 'none'}
                        onChange={(e) => setFormData({ ...formData, stop_loss_condition: e.target.value === 'none' ? '' : e.target.value })}
                      >
                        <option value="none">بدون شرط</option>
                        <option value="اغلاق">كسر بإغلاق</option>
                        <option value="intraday">كسر خلال الجلسة</option>
                      </select>
                    </div>
                    <div>
                      <Label>المدة المتوقعة</Label>
                      <Input
                        value={formData.expected_duration}
                        onChange={(e) => setFormData({ ...formData, expected_duration: e.target.value })}
                        placeholder="1-2 أسبوع"
                      />
                    </div>
                    <div>
                      <Label>عدد الأيام المتوقع</Label>
                      <Input
                        type="number"
                        value={formData.expected_duration_days}
                        onChange={(e) => setFormData({ ...formData, expected_duration_days: e.target.value })}
                        placeholder="5"
                      />
                    </div>
                  </div>
                )}

                {/* Analysis (detailed only) */}
                {formData.recommendation_type === 'detailed' && (
                  <div className="space-y-4">
                    <div>
                      <Label>التحليل الفني</Label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-[80px]"
                        value={formData.technical_analysis}
                        onChange={(e) => setFormData({ ...formData, technical_analysis: e.target.value })}
                        placeholder="نقاط التحليل الفني..."
                      />
                    </div>
                    <div>
                      <Label>التحليل الأساسي</Label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-[80px]"
                        value={formData.fundamental_analysis}
                        onChange={(e) => setFormData({ ...formData, fundamental_analysis: e.target.value })}
                        placeholder="نقاط التحليل الأساسي..."
                      />
                    </div>
                    <div>
                      <Label>سبب التحليل</Label>
                      <textarea
                        className="w-full p-2 border rounded-lg min-h-[60px]"
                        value={formData.recommendation_reason}
                        onChange={(e) => setFormData({ ...formData, recommendation_reason: e.target.value })}
                        placeholder="سبب التحليل أو ملخص التحليل..."
                      />
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <Label>ملاحظات</Label>
                  <textarea
                    className="w-full p-2 border rounded-lg min-h-[60px]"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={formData.recommendation_type === 'quick' ? 'مثال: مكسب 3% في نفس اليوم T+0' : 'ملاحظات إضافية...'}
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  <Button 
                    onClick={handleAddRecommendation} 
                    className={`flex-1 ${formData.recommendation_type === 'quick' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    disabled={saving || !formData.stock_symbol}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                        جاري الحفظ...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 ml-2" />
                        حفظ التحليل
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm(); }}>
                    إلغاء
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Expert Stats */}
      {expertStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5" />
              ترتيب الخبراء
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {expertStats.map((expert, idx) => (
                <div key={expert.expert_name} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{expert.expert_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {expert.total_recommendations} تحليل
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-emerald-600">
                      {expert.success_rate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      متوسط: {expert.avg_return?.toFixed(1) || 0}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">قيد المتابعة ({recommendations.filter(r => r.status === 'PENDING').length})</TabsTrigger>
          <TabsTrigger value="quick">⚡ سريعة ({recommendations.filter(r => r.recommendation_type === 'quick').length})</TabsTrigger>
          <TabsTrigger value="detailed">📋 تفصيلية ({recommendations.filter(r => r.recommendation_type === 'detailed' || !r.recommendation_type).length})</TabsTrigger>
          <TabsTrigger value="closed">مغلقة ({recommendations.filter(r => r.status !== 'PENDING').length})</TabsTrigger>
          <TabsTrigger value="all">الكل ({recommendations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          <Card>
            <CardHeader>
              <CardTitle>قائمة التحليلات</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  <p className="mt-2 text-muted-foreground">جارٍ التحميل...</p>
                </div>
              ) : filteredRecs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  لا توجد تحليلات
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {filteredRecs.map((rec) => (
                      <div
                        key={rec.id}
                        className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors ${rec.recommendation_type === 'quick' ? 'border-purple-200 dark:border-purple-900 bg-purple-50/30 dark:bg-purple-950/10' : ''}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <div className="font-bold text-lg">{rec.stock_symbol}</div>
                            {rec.stock_name_ar && (
                              <div className="text-xs text-muted-foreground">{rec.stock_name_ar}</div>
                            )}
                          </div>
                          <Badge className={cn('text-white', getStatusColor(rec.status))}>
                            {getStatusLabel(rec.status)}
                          </Badge>
                          <Badge variant="outline" className={rec.recommendation_type === 'quick' ? 'border-purple-400 text-purple-600' : ''}>
                            {getRecTypeLabel(rec.recommendation_type)}
                          </Badge>
                          <div className={cn(
                            'flex items-center gap-1',
                            rec.action === 'BUY' || rec.action === 'BUY_AND_HOLD' ? 'text-emerald-600' : 'text-red-600'
                          )}>
                            {rec.action === 'BUY' || rec.action === 'BUY_AND_HOLD' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            <span className="font-medium">{getActionLabel(rec.action)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-center">
                            <div className="text-xs text-muted-foreground">الخبير</div>
                            <div className="font-medium">{rec.expert_name || '—'}</div>
                          </div>
                          {rec.entry_price && (
                            <div>
                              <span className="text-muted-foreground">الدخول: </span>
                              <span className="font-medium">
                                {rec.entry_price_from && rec.entry_price_to
                                  ? `${rec.entry_price_from.toFixed(2)}-${rec.entry_price_to.toFixed(2)}`
                                  : rec.entry_price.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {rec.target_price && (
                            <div className="text-emerald-600">
                              <span className="text-muted-foreground">هدف 1: </span>
                              <span className="font-medium">{rec.target_price.toFixed(2)}</span>
                            </div>
                          )}
                          {rec.target_price_2 && (
                            <div className="text-emerald-500">
                              <span className="text-muted-foreground">هدف 2: </span>
                              <span className="font-medium">{rec.target_price_2.toFixed(2)}</span>
                            </div>
                          )}
                          {rec.investment_target && (
                            <div className="text-blue-600">
                              <span className="text-muted-foreground">استثماري: </span>
                              <span className="font-medium">{rec.investment_target.toFixed(2)}</span>
                            </div>
                          )}
                          {rec.stop_loss && (
                            <div className="text-red-600">
                              <span className="text-muted-foreground">ستوب: </span>
                              <span className="font-medium">{rec.stop_loss.toFixed(2)}</span>
                              {rec.stop_loss_condition && <span className="text-[9px]">({rec.stop_loss_condition})</span>}
                            </div>
                          )}
                          {rec.profit_loss_percent !== null && rec.profit_loss_percent !== undefined && (
                            <div className={cn(
                              'font-bold',
                              rec.profit_loss_percent >= 0 ? 'text-emerald-600' : 'text-red-600'
                            )}>
                              {rec.profit_loss_percent.toFixed(1)}%
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteRecommendation(rec.id)}
                            className="text-red-500 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

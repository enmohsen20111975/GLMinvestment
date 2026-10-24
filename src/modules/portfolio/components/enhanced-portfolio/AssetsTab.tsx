'use client';

/**
 * enhanced-portfolio/AssetsTab.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: AssetsTab memoized component extracted from
 * EnhancedPortfolioView.tsx (lines ~521-1820, ~1300 LOC).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so background store
 * updates (RealtimeTicker, etc.) don't re-render the entire tab tree when its
 * props (selectedPortfolioId) haven't changed.
 *
 * Form state (formType, formName, etc.) lives here — passed down to no other
 * sub-components (the dialog is rendered inline).
 *
 * Uses usePortfolioData hook (Phase 2 extraction) for all data-fetching.
 * Renders WealthAllocationMatrixCard + RealReturnPanel + RiskProfilerQuiz +
 * BagHolderRescuePanel + TopUpRecommendationsPanel + RoboAdvisorPanel +
 * DynamicRiskProfilerModal inline.
 * ============================================================================
 */

import { useState, useMemo, useCallback, memo } from 'react';
import {
        AlertTriangle,
        Plus,
        Trash2,
        Pencil,
        Sparkles,
        Landmark,
        Coins,
        CreditCard,
        Wallet,
        RefreshCw,
        Shield,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle,
} from '@/components/ui/dialog';
import {
        Select,
        SelectContent,
        SelectItem,
        SelectTrigger,
        SelectValue,
} from '@/components/ui/select';
import { StockPublisher } from '@/modules/publishing/components/StockPublisher';
import { getPortfolioColorClass } from '@/modules/portfolio/components/MultiPortfolioSelector';
import { RealReturnPanel } from '@/modules/portfolio/components/RealReturnPanel';
import { BagHolderRescuePanel } from '@/modules/portfolio/components/BagHolderRescuePanel';
import { TopUpRecommendationsPanel } from '@/modules/portfolio/components/TopUpRecommendationsPanel';
import { RiskProfilerQuiz } from '@/modules/portfolio/components/RiskProfilerQuiz';
import { RoboAdvisorPanel } from '@/modules/portfolio/components/RoboAdvisorPanel';
import { DynamicRiskProfilerModal } from '@/components/persona/DynamicRiskProfilerModal';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { useTranslation } from '@/lib/i18n-context';
import { trackFeature } from '@/lib/analytics';
// P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
import {
        checkWealthAllocationMatrix,
        personaLabelAr,
        type WealthAllocationAlert,
} from '@/lib/persona-dynamic';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import type { AssetType, PortfolioAsset } from '@/types';
import {
        inferStockMarket,
        formatCurrencyRaw,
        formatPercent,
        ASSET_TYPE_LABELS,
        ASSET_TYPE_COLORS,
        FUND_TYPES,
} from './helpers';
import { WealthAllocationMatrixCard } from './WealthAllocationMatrixCard';
import { StockSearchDropdown } from './StockSearchDropdown';
import { CryptoSearchDropdown } from './CryptoSearchDropdown';
import type { AssetsTabProps } from './types';

export const AssetsTab = memo(function AssetsTab({ selectedPortfolioId = 'master' }: AssetsTabProps) {
        const { currentMarket } = useAppStore();
        const { loadStockDetail, displayCurrency, usdRate, sarRate, persona, setDealAdvisorPrefill, setCurrentView } = useAppStore();
        const t = useTranslation();
        // P39-PHASE-2: state for the DynamicRiskProfilerModal (إعادة الاختبار button).
        const [profilerOpen, setProfilerOpen] = useState(false);
        // P37-PHASE-2B-4A: local currency-aware formatter — shadows the module-level
        // EGP-only version so every wealth value rendered inside this tab follows
        // the header's EGP/USD/SAR toggle. Per-row raw market prices (stock/gold
        // per-gram) intentionally keep their inline `toFixed(2)} ج.م` suffix.
        const formatCurrency = (value: number | null | undefined) =>
                formatCurrencyRaw(value, displayCurrency, usdRate, sarRate);
        // ── F-Strangler-Portfolio: all data-fetching logic extracted to the
        // usePortfolioData hook (TanStack Query under the hood). The widget is now
        // render-only — side effects (setFxRates, usePortfolioStore.updateFromCalcValues,
        // 30s visibility-aware polling) live in the hook.
        const {
                assets,
                obligations,
                netWorthData,
                loading,
                refreshing,
                portfoliosMap,
                goldPrices,
                refetch: refetchPortfolioData,
        } = usePortfolioData(selectedPortfolioId);
        const [filterType, setFilterType] = useState<string>('all');

        const [addDialogOpen, setAddDialogOpen] = useState(false);
        const [editAsset, setEditAsset] = useState<(PortfolioAsset & Record<string, unknown>) | null>(null);
        const [editDialogOpen, setEditDialogOpen] = useState(false);
        const [deleteId, setDeleteId] = useState<number | null>(null);
        const [saving, setSaving] = useState(false);
        // Task 7: Pre-fill BagHolderRescuePanel when a losing position badge is clicked
        const [rescueProps, setRescueProps] = useState<{ ticker: string; buyPrice: number; quantity: number; autoAnalyze: boolean } | null>(null);

        // Form state
        const [formType, setFormType] = useState<AssetType>('stock');
        const [formName, setFormName] = useState('');
        const [formTotalInvested, setFormTotalInvested] = useState('');
        const [formCurrentValue, setFormCurrentValue] = useState('');
        const [formNotes, setFormNotes] = useState('');
        // Gold
        const [formWeight, setFormWeight] = useState('');
        const [formKarat, setFormKarat] = useState('21');
        const [formPricePerGram, setFormPricePerGram] = useState('');
        // Bank
        const [formBankName, setFormBankName] = useState('');
        const [formInterestRate, setFormInterestRate] = useState('');
        // Certificate
        const [formDuration, setFormDuration] = useState('');
        const [formReturnRate, setFormReturnRate] = useState('');
        const [formMaturityDate, setFormMaturityDate] = useState('');
        // Fund
        const [formFundName, setFormFundName] = useState('');
        const [formFundType, setFormFundType] = useState('');
        // Fixed-income fund specific
        const [formAnnualReturn, setFormAnnualReturn] = useState('');
        const [formReturnType, setFormReturnType] = useState<'annual' | 'monthly' | 'daily'>('annual');
        const [formPurchaseDate, setFormPurchaseDate] = useState('');
        // Stock
        const [formTicker, setFormTicker] = useState('');
        const [formQuantity, setFormQuantity] = useState('');
        const [formAvgBuyPrice, setFormAvgBuyPrice] = useState('');
        const [formSelectedPrice, setFormSelectedPrice] = useState<number | null>(null);

        const resetForm = () => {
                setFormType('stock');
                setFormName(''); setFormTotalInvested(''); setFormCurrentValue(''); setFormNotes('');
                setFormWeight(''); setFormKarat('21'); setFormPricePerGram('');
                setFormBankName(''); setFormInterestRate('');
                setFormDuration(''); setFormReturnRate(''); setFormMaturityDate('');
                setFormFundName(''); setFormFundType('');
                setFormAnnualReturn(''); setFormReturnType('annual'); setFormPurchaseDate('');
                setFormTicker(''); setFormQuantity(''); setFormAvgBuyPrice(''); setFormSelectedPrice(null);
        };

        // (F-Strangler-Portfolio) loadAssets + goldPrices state + 30s polling +
        // portfoliosMap session-fetch — all extracted to usePortfolioData() above.

        const addToWatchlist = async (ticker: string) => {
                try {
                        // USER-ANALYTICS-EMITTERS: track watchlist_add from portfolio flow (fire-and-forget).
                        trackFeature('watchlist_add', ticker);
                        await fetch('/api/watchlist', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ticker }),
                        });
                        toast.success(t('portfolio.toast.addToWatchlistSuccess', { ticker }));
                } catch {
                        // Watchlist add is best-effort; don't block the main flow
                }
        };

        const handleStockSelect = (ticker: string, name: string, currentPrice: number) => {
                setFormTicker(ticker);
                setFormName(name);
                setFormSelectedPrice(currentPrice);
                // Auto-fill current value if quantity & buy price exist
                if (formQuantity && formAvgBuyPrice) {
                        const qty = parseInt(formQuantity) || 0;
                        const buy = parseFloat(formAvgBuyPrice) || 0;
                        if (qty > 0 && buy > 0) {
                                setFormTotalInvested(String(qty * buy));
                        }
                }
        };

        const handleSave = async () => {
                if (formType === 'stock' && !formTicker) {
                        toast.error(t('portfolio.toast.selectStock'));
                        return;
                }
                // Task 3: Crypto also requires a symbol selection
                if (formType === 'crypto' && !formTicker) {
                        toast.error(t('portfolio.toast.selectCrypto'));
                        return;
                }
                if (!formName || formName.trim().length === 0) {
                        toast.error(t('portfolio.toast.enterAssetName'));
                        return;
                }

                setSaving(true);
                const payload: Record<string, unknown> = {
                        type: formType,
                        name: formName,
                        total_invested: formTotalInvested ? parseFloat(formTotalInvested) : 0,
                        current_value: formCurrentValue ? parseFloat(formCurrentValue) : 0,
                        notes: formNotes.trim() || null,
                        portfolio_id: selectedPortfolioId && selectedPortfolioId !== 'master' ? String(selectedPortfolioId) : 'default',
                };
                if (formType === 'gold') {
                        payload.weight_grams = formWeight ? parseFloat(formWeight) : null;
                        payload.karat = formKarat ? parseInt(formKarat) : 21;
                        payload.purchase_price_per_gram = formPricePerGram ? parseFloat(formPricePerGram) : null;
                }
                if (formType === 'bank') {
                        payload.bank_name = formBankName;
                        payload.interest_rate = formInterestRate ? parseFloat(formInterestRate) : null;
                }
                if (formType === 'certificate') {
                        payload.certificate_duration_months = formDuration ? parseInt(formDuration) : null;
                        payload.certificate_return_rate = formReturnRate ? parseFloat(formReturnRate) : null;
                        payload.certificate_maturity_date = formMaturityDate || null;
                }
                if (formType === 'fund') {
                        payload.fund_name = formFundName;
                        payload.fund_type = formFundType;
                        if (formFundType === 'fixed_income') {
                                payload.annual_return_rate = formAnnualReturn ? parseFloat(formAnnualReturn) : null;
                                payload.return_type = formReturnType || 'annual';
                                payload.purchase_date = formPurchaseDate || null;
                        }
                }
                if (formType === 'stock') {
                        payload.stock_ticker = formTicker;
                        payload.quantity = formQuantity ? parseInt(formQuantity) : null;
                        payload.avg_buy_price = formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null;
                        // PHASE3-MARKET-SEGREGATION (Task F): store the selected market alongside
                        // the ticker so the badge (added above) shows the correct market later.
                        // If the user is viewing the dashboard under TADAWUL, new stock additions
                        // automatically tag themselves as TADAWUL — no manual selection needed.
                        payload.stock_market = currentMarket;
                }
                // ── Task 3: Crypto payload — reuse stock_ticker column for symbol ──
                if (formType === 'crypto') {
                        payload.stock_ticker = formTicker;
                        payload.quantity = formQuantity ? parseFloat(formQuantity) : null;
                        payload.avg_buy_price = formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null;
                        payload.market = 'CRYPTO';
                        payload.currency = 'USD';
                }

                try {
                        const res = await fetch('/api/finance/assets', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload),
                        });
                        let data: Record<string, unknown>;
                        try {
                                data = await res.json();
                        } catch {
                                const text = await res.text().catch(() => '');
                                console.error('[Asset Add] Non-JSON response:', res.status, text);
                                toast.error(t('portfolio.toast.serverError'), { duration: 10000 });
                                return;
                        }
                        if (data.success) {
                                toast.success(t('portfolio.toast.addAssetSuccess'));
                                // USER-ANALYTICS-EMITTERS: track portfolio_add (Rule 27 — real action, fire-and-forget).
                                trackFeature('portfolio_add', formTicker || formType);
                                // Auto-add stock to watchlist
                                if (formType === 'stock' && formTicker) {
                                        addToWatchlist(formTicker);
                                }
                                setAddDialogOpen(false);
                                resetForm();
                                void refetchPortfolioData();
                        } else {
                                const detailMsg = data.detail ? ` (${data.detail})` : '';
                                console.error('[Asset Add] Server error:', data);
                                toast.error(String(data.error || t('portfolio.toast.addAssetFailed')) + detailMsg, { duration: 10000 });
                        }
                } catch (fetchErr) {
                        console.error('[Asset Add] Fetch error:', fetchErr);
                        toast.error(t('portfolio.toast.connectionError'));
                } finally {
                        setSaving(false);
                }
        };

        const handleEditSave = async () => {
                if (!editAsset?.id) return;
                setSaving(true);
                const payload: Record<string, unknown> = {
                        name: formName,
                        total_invested: formTotalInvested ? parseFloat(formTotalInvested) : 0,
                        current_value: formCurrentValue ? parseFloat(formCurrentValue) : 0,
                        notes: formNotes.trim() || null,
                        quantity: formQuantity ? parseInt(formQuantity) : null,
                        avg_buy_price: formAvgBuyPrice ? parseFloat(formAvgBuyPrice) : null,
                };
                // Preserve fixed-income fund fields when editing
                if (formType === 'fund' && formFundType === 'fixed_income') {
                        payload.annual_return_rate = formAnnualReturn ? parseFloat(formAnnualReturn) : null;
                        payload.return_type = formReturnType || 'annual';
                        payload.purchase_date = formPurchaseDate || null;
                }
                try {
                        const res = await fetch(`/api/finance/assets/${editAsset.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload),
                        });
                        const data = await res.json();
                        if (data.success) {
                                toast.success(t('portfolio.toast.updateAssetSuccess'));
                                setEditDialogOpen(false);
                                void refetchPortfolioData();
                        } else {
                                toast.error(data.error || t('portfolio.toast.updateAssetFailed'));
                        }
                } catch {
                        toast.error(t('portfolio.toast.connectionError'));
                } finally {
                        setSaving(false);
                }
        };

        const handleDelete = async () => {
                if (!deleteId) return;
                try {
                        const res = await fetch(`/api/finance/assets/${deleteId}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                                toast.success(t('portfolio.toast.deleteAssetSuccess'));
                                setDeleteId(null);
                                void refetchPortfolioData();
                        } else {
                                toast.error(data.error || t('portfolio.toast.deleteAssetFailed'));
                        }
                } catch {
                        toast.error(t('portfolio.toast.connectionError'));
                }
        };

        const openEdit = (asset: PortfolioAsset & Record<string, unknown>) => {
                setEditAsset(asset);
                setFormType(asset.type);
                setFormName(asset.name);
                setFormTotalInvested(String(asset.total_invested));
                setFormCurrentValue(String(asset.current_value));
                setFormNotes(asset.notes || '');
                setFormTicker(asset.stock_ticker || '');
                setFormQuantity(asset.quantity ? String(asset.quantity) : '');
                setFormAvgBuyPrice(asset.avg_buy_price ? String(asset.avg_buy_price) : '');
                // Fund-specific fields (populate so fixed_income payload preservation works on edit)
                setFormFundName((asset.fund_name as string) || '');
                setFormFundType((asset.fund_type as string) || '');
                setFormAnnualReturn(asset.annual_return_rate ? String(asset.annual_return_rate) : '');
                setFormReturnType((asset.return_type as 'annual' | 'monthly' | 'daily') || 'annual');
                setFormPurchaseDate((asset.purchase_date as string) || '');
                setEditDialogOpen(true);
        };

        const filteredAssets = filterType === 'all'
                ? assets
                : (assets || []).filter((a) => a.type === filterType);

        const totalAssets = (assets || []).reduce((s, a) => s + (a.current_value || 0), 0);
        const totalInvested = (assets || []).reduce((s, a) => s + (a.total_invested || 0), 0);
        const totalGainLoss = totalAssets - totalInvested;
        const totalReturnPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

        // Calculate net wealth = assets - liabilities
        const totalLiabilities = (obligations || []).reduce((s, o) => s + (o.remaining_amount || 0), 0);
        const netWealth = totalAssets - totalLiabilities;

        // ── Task 6: Compute live allocation by type for RiskProfilerQuiz rebalance ──
        const currentAllocation = (() => {
                if (totalAssets <= 0) return undefined;
                const byCat = { stocks: 0, gold: 0, cash: 0, crypto: 0 };
                for (const a of assets || []) {
                        const val = Number(a.current_value || 0);
                        if (val <= 0) continue;
                        const t = (a.type || 'other').toLowerCase();
                        if (t === 'stock') byCat.stocks += val;
                        else if (t === 'gold' || t === 'silver') byCat.gold += val;
                        else if (t === 'crypto') byCat.crypto += val;
                        else if (['bank', 'certificate', 'fund', 'deposit', 'currency', 'forex'].includes(t)) byCat.cash += val;
                }
                return {
                        stocks: (byCat.stocks / totalAssets) * 100,
                        gold: (byCat.gold / totalAssets) * 100,
                        cash: (byCat.cash / totalAssets) * 100,
                        crypto: (byCat.crypto / totalAssets) * 100,
                        totalValue: totalAssets,
                };
        })();

        // ── P31 TASK 4: Proactive bag-holder detection (loss >= 15%) ──
        // Banner at the top of the portfolio — appears automatically when any stock is
        // down 15%+ (live_price <= purchase * 0.85). Click → opens BagHolderRescuePanel
        // pre-filled with the worst position + auto-analyze.
        const severeLossPositions = assets
                .filter(a => {
                        const t = String(a.type || '').toLowerCase();
                        return t === 'stock' && a.stock_ticker && Number(a.profit_loss_percent || 0) <= -15;
                })
                .sort((a, b) => Number(a.profit_loss_percent || 0) - Number(b.profit_loss_percent || 0));

        // P39-PHASE-2: Wealth Allocation Matrix — aggregate current values per asset
        // class in EGP (NEVER converted — displayCurrency only affects rendering, not
        // the math passed to checkWealthAllocationMatrix). Mapping mirrors the
        // existing `currentAllocation` above: stock→egx, crypto→crypto, gold/silver→gold,
        // bank/certificate/fund/deposit/currency/forex/cash→cash.
        const portfolioNetWorthEGP = netWorthData?.gross ?? totalAssets;
        const wealthValuesEGP = useMemo(() => {
                const v = { egx: 0, crypto: 0, gold: 0, cash: 0 };
                for (const a of assets || []) {
                        const val = Number(a.current_value || 0);
                        if (!Number.isFinite(val) || val <= 0) continue;
                        const t = String(a.type || '').toLowerCase();
                        if (t === 'stock') v.egx += val;
                        else if (t === 'crypto') v.crypto += val;
                        else if (t === 'gold' || t === 'silver') v.gold += val;
                        else if (['bank', 'certificate', 'fund', 'deposit', 'currency', 'forex', 'cash'].includes(t)) v.cash += val;
                }
                return v;
        }, [assets]);
        const wealthAlerts: WealthAllocationAlert[] = useMemo(
                () => checkWealthAllocationMatrix(wealthValuesEGP, portfolioNetWorthEGP, persona),
                [wealthValuesEGP, portfolioNetWorthEGP, persona],
        );

        // P39-PHASE-2: Auto-Rebalance — UI-only suggestions (no actual sells).
        // For each asset class over its ceiling, pick the largest holding in that
        // class and toast a sell suggestion that would bring the allocation back
        // to the persona's ceiling. Cash floor (minimum reserve) is reported
        // separately as a warning.
        const handleAutoRebalance = useCallback(() => {
                if (wealthAlerts.length === 0) {
                        toast.success(t('portfolio.toast.portfolioBalanced'));
                        return;
                }
                const overCeiling = wealthAlerts.filter((a) => a.asset !== 'cash' && a.overflow > 0);
                const cashAlert = wealthAlerts.find((a) => a.asset === 'cash');
                if (overCeiling.length === 0) {
                        if (cashAlert && cashAlert.severity !== 'ok') {
                                toast.warning(cashAlert.messageAr, { duration: 7000 });
                        } else {
                                toast.success(t('portfolio.toast.portfolioBalanced'));
                        }
                        return;
                }
                const assetLabels: Record<string, string> = {
                        egx: 'الأسهم',
                        crypto: 'العملات الرقمية',
                        gold: 'الذهب',
                };
                const typeMap: Record<string, string[]> = {
                        egx: ['stock'],
                        crypto: ['crypto'],
                        gold: ['gold', 'silver'],
                };
                overCeiling.forEach((alert) => {
                        const allowedTypes = typeMap[alert.asset] || [];
                        const holdings = (assets || [])
                                .filter((a) => allowedTypes.includes(String(a.type || '').toLowerCase()) && Number(a.current_value || 0) > 0)
                                .sort((a, b) => Number(b.current_value || 0) - Number(a.current_value || 0));
                        if (holdings.length === 0) {
                                toast.warning(alert.messageAr, { duration: 7000 });
                                return;
                        }
                        const top = holdings[0];
                        const ticker = String(top.stock_ticker || top.name || 'الأصل');
                        const overflowValueEGP = (alert.overflow / 100) * portfolioNetWorthEGP;
                        const price = Number(top.current_stock_price || top.current_value || 0);
                        const sellQty = price > 0 ? Math.ceil(overflowValueEGP / price) : 0;
                        const qtyLabel = sellQty > 0 ? `${sellQty.toLocaleString('ar-EG')} وحدة من ` : '';
                        toast.warning(
                                `بيع ${qtyLabel}${ticker} لتقليل نسبة ${assetLabels[alert.asset] || alert.asset} من ${(alert.currentPercent ?? 0).toFixed(1)}% إلى ${alert.ceilingPercent}%`,
                                { duration: 8000 },
                        );
                });
        }, [wealthAlerts, assets, portfolioNetWorthEGP]);

        if (loading) {
                return (
                        <div className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {[...Array(4)].map((_, i) => (
                                                <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-7 w-28" /></CardContent></Card>
                                        ))}
                                </div>
                                {[...Array(3)].map((_, i) => (
                                        <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
                                ))}
                        </div>
                );
        }

        return (
                <div className="space-y-6">
                        {/* P31 TASK 4: Proactive rescue banner — auto-appears when a stock is down >= 15% */}
                        {severeLossPositions.length > 0 && (() => {
                                const worst = severeLossPositions[0];
                                const lossPct = Math.abs(Number(worst.profit_loss_percent || 0));
                                return (
                                        <button
                                                type="button"
                                                onClick={() => {
                                                        setRescueProps({
                                                                ticker: String(worst.stock_ticker),
                                                                buyPrice: Number(worst.avg_buy_price || worst.purchase_price || 0),
                                                                quantity: Number(worst.quantity || worst.shares || 0),
                                                                autoAnalyze: true,
                                                        });
                                                        setTimeout(() => {
                                                                document.getElementById('bag-holder-rescue-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                        }, 100);
                                                }}
                                                className="w-full text-right rounded-lg border-2 border-loss bg-loss/10 p-4 animate-pulse hover:bg-loss dark:hover:bg-loss/10 transition-colors"
                                                title="اضغط للحصول على خطة إنقاذ فورية"
                                        >
                                                <div className="flex items-center gap-3 flex-wrap">
                                                        <span className="text-2xl">🚨</span>
                                                        <div className="flex-1 min-w-0">
                                                                <div className="font-bold text-loss text-sm md:text-base">
                                                                        تنبيه: أنت مزنوق في {severeLossPositions.length} {severeLossPositions.length === 1 ? 'سهم' : 'أسهم'} بخسارة 15% أو أكبر
                                                                </div>
                                                                <div className="text-xs text-loss mt-0.5">
                                                                        أسوأها: <span dir="ltr" className="font-bold">{worst.stock_ticker}</span> بخسارة {(lossPct ?? 0).toFixed(1)}% — اضغط هنا للحصول على خطة الإنقاذ الفورية
                                                                </div>
                                                        </div>
                                                </div>
                                        </button>
                                );
                        })()}

                        {/* ROBO-ADVISOR-P3: محرك العائد الحقيقي (التضخم) */}
                        <RealReturnPanel />

                        {/* ROBO-ADVISOR-P4: محرك تقييم المخاطر + Rebalancing */}
                        {/* Task 6: Pass live allocation so the quiz can show smart rebalance alerts */}
                        <RiskProfilerQuiz currentAllocation={currentAllocation} />

                        {/* ROBO-ADVISOR-P4: محرك إنقاذ الأسهم المزنوقة */}
                        {/* Task 7: Pre-fill from clicked losing position via rescueProps state */}
                        <div id="bag-holder-rescue-anchor">
                                <BagHolderRescuePanel
                                        key={rescueProps ? `rescue-${rescueProps.ticker}` : 'rescue-default'}
                                        ticker={rescueProps?.ticker}
                                        buyPrice={rescueProps?.buyPrice}
                                        quantity={rescueProps?.quantity}
                                        autoAnalyze={rescueProps?.autoAnalyze}
                                />
                        </div>

                        {/* MONEY-TIER2.9: توقعات زيادة المركز — الأسهم الرابحة ≥ 10% */}
                        <TopUpRecommendationsPanel />

                        {/* P37-PHASE-2B-4A: Currency badge — tells users which currency the
                                aggregate wealth totals below are displayed in. Per-row raw market
                                prices (stock/gold per-gram) stay in EGP and use the inline suffix.
                                P39-PHASE-2: persona badge + "إعادة اختبار الشخصية" button on the
                                other side — opens DynamicRiskProfilerModal to recompute the persona. */}
                        <div className="flex items-center justify-between gap-2 flex-wrap" dir="rtl">
                                <div className="flex items-center gap-2">
                                        <Badge className="text-xs gap-1 bg-profit/10 text-profit border border-profit/20 border-profit ">
                                                <Shield className="w-3 h-3" />
                                                {t('portfolio.persona.label', { persona: personaLabelAr(persona) })}
                                        </Badge>
                                        <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 px-2 text-xs text-muted-foreground hover:text-profit"
                                                onClick={() => setProfilerOpen(true)}
                                        >
                                                <RefreshCw className="w-3 h-3 ml-1" />
                                                {t('portfolio.persona.retest')}
                                        </Button>
                                </div>
                                <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                                        {t('portfolio.currency.label', { currency: displayCurrency })}
                                </Badge>
                        </div>

                        {/* Summary Cards — B-1: Backend P34 net-worth math (gross / debts / net / monthly yield) */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Card className="p-4">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                                <Landmark className="w-4 h-4" />
                                                <span className="text-xs font-medium">{t('portfolio.summary.totalAssets')}</span>
                                        </div>
                                        <p className="text-lg md:text-xl font-bold">{formatCurrency(netWorthData?.gross ?? totalAssets)}</p>
                                </Card>
                                <Card className="p-4">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                                <CreditCard className="w-4 h-4 text-warning" />
                                                <span className="text-xs font-medium">{t('portfolio.summary.totalLiabilities')}</span>
                                        </div>
                                        <p className="text-lg md:text-xl font-bold text-warning ">
                                                {formatCurrency(netWorthData?.debts ?? totalLiabilities)}
                                        </p>
                                        {totalLiabilities > 0 && (netWorthData?.debts ?? 0) === 0 && (
                                                <p className="text-xs text-muted-foreground mt-1">{t('portfolio.summary.afterDeduction', { amount: formatCurrency(totalLiabilities) })}</p>
                                        )}
                                </Card>
                                <Card className="p-4 ring-1 ring-profit/30 bg-profit/5">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                                <Wallet className="w-4 h-4 text-profit" />
                                                <span className="text-xs font-medium">{t('portfolio.summary.netWorth')}</span>
                                        </div>
                                        <p className={cn('text-lg md:text-xl font-bold', (netWorthData?.net ?? netWealth) >= 0 ? 'text-profit ' : 'text-loss ')}>
                                                {formatCurrency(netWorthData?.net ?? netWealth)}
                                        </p>
                                </Card>
                                <Card className="p-4">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                                <Coins className="w-4 h-4 text-profit" />
                                                <span className="text-xs font-medium">{t('portfolio.summary.monthlyYield')}</span>
                                        </div>
                                        <p className="text-lg md:text-xl font-bold text-profit ">
                                                {formatCurrency(netWorthData?.monthlyYield ?? 0)}
                                        </p>
                                        {netWorthData && netWorthData.annualYield > 0 && (
                                                <p className="text-xs text-muted-foreground mt-1">{t('portfolio.summary.annualYield', { amount: formatCurrency(netWorthData.annualYield) })}</p>
                                        )}
                                </Card>
                        </div>

                        {/* P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
                         Renders a 4-column grid (egx/crypto/gold/cash) with current % vs ceiling %,
                         a progress bar with a red ceiling marker, severity-coloured borders, an
                         alerts list for any severity !== 'ok', and an Auto-Rebalance button that
                         toasts sell suggestions. All math is EGP-only (displayCurrency does NOT
                         affect the allocation computation). */}
                        <WealthAllocationMatrixCard
                                alerts={wealthAlerts}
                                personaLabel={personaLabelAr(persona)}
                                onRebalance={handleAutoRebalance}
                        />

                        {/* ROBO-ADVISOR-P33: 5 features — projection + rebalancing + equity curve + pie + table */}
                        <RoboAdvisorPanel assets={assets as unknown as any[]} />

                        {/* Filter & Add */}
                        <div className="flex flex-wrap items-center gap-2 justify-between">
                                <div className="flex flex-wrap gap-2">
                                        <Button size="sm" variant={filterType === 'all' ? 'default' : 'outline'} onClick={() => setFilterType('all')}>{t('portfolio.buttons.all')}</Button>
                                        {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => (
                                                <Button key={type} size="sm" variant={filterType === type ? 'default' : 'outline'} onClick={() => setFilterType(type)}>
                                                        {t(`portfolio.assetTypes.${type}`)}
                                                </Button>
                                        ))}
                                </div>
                                <div className="flex items-center gap-2">
                                        {refreshing && (
                                                <span className="text-xs text-muted-foreground flex items-center gap-1 animate-pulse">
                                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                                        {t('portfolio.buttons.liveRefresh')}
                                                </span>
                                        )}
                                        <Button className="bg-profit hover:bg-profit text-white" size="sm" onClick={() => { resetForm(); setAddDialogOpen(true); }}>
                                                <Plus className="w-4 h-4 ml-1.5" />
                                                {t('portfolio.buttons.addAsset')}
                                        </Button>
                                </div>
                        </div>

                        {/* Assets List - Grouped by Type */}
                        {filteredAssets.length === 0 ? (
                                <Card className="border-dashed">
                                        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                                                <Landmark className="w-10 h-10 text-muted-foreground mb-3" />
                                                <h3 className="text-lg font-semibold mb-1">{t('portfolio.empty.noAssets')}</h3>
                                                <p className="text-sm text-muted-foreground">أضف أصولك المالية لتتبعها هنا</p>
                                        </CardContent>
                                </Card>
                        ) : (
                                <Accordion type="multiple" defaultValue={['stock', 'gold', 'bank', 'certificate', 'fund', 'crypto', 'real_estate', 'other']} className="space-y-3 w-full">
                                        {/* Group assets by type */}
                                        {(['stock', 'gold', 'bank', 'certificate', 'fund', 'crypto', 'real_estate', 'other'] as AssetType[]).map((groupType) => {
                                                const groupAssets = filteredAssets.filter((a) => a.type === groupType);
                                                if (groupAssets.length === 0) return null;

                                                const groupInvested = groupAssets.reduce((s, a) => s + (a.total_invested || 0), 0);
                                                const groupCurrentValue = groupAssets.reduce((s, a) => s + (a.current_value || 0), 0);
                                                const groupProfitLoss = groupCurrentValue - groupInvested;
                                                const groupProfitLossPercent = groupInvested > 0 ? (groupProfitLoss / groupInvested) * 100 : 0;
                                                const groupDailyInterest = groupAssets.reduce((s, a) => s + (Number(a.daily_interest) || 0), 0);
                                                const groupMonthlyInterest = groupAssets.reduce((s, a) => s + (Number(a.monthly_interest) || 0), 0);
                                                const groupYearlyInterest = groupAssets.reduce((s, a) => s + (Number(a.yearly_interest) || 0), 0);

                                                return (
                                                        <AccordionItem key={groupType} value={groupType} className="border rounded-lg bg-card px-4">
                                                                {/* Group Header — P30 TASK 6: Accordion trigger */}
                                                                <AccordionTrigger className="hover:no-underline bg-muted/30 rounded-lg px-3 py-3 hover:bg-muted/50">
                                                                        <div className="flex items-center gap-2">
                                                                                <Badge className={ASSET_TYPE_COLORS[groupType]}>{ASSET_TYPE_LABELS[groupType]}</Badge>
                                                                                <span className="text-sm text-muted-foreground">({groupAssets.length})</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-4 text-sm">
                                                                                <div className="text-left">
                                                                                        <span className="text-muted-foreground">القيمة: </span>
                                                                                        <span className="font-semibold">{formatCurrency(groupCurrentValue)}</span>
                                                                                </div>
                                                                                <div className={cn('text-left font-semibold', groupProfitLoss >= 0 ? 'text-profit ' : 'text-loss ')}>
                                                                                        {formatPercent(groupProfitLossPercent)}
                                                                                </div>
                                                                                {/* Show interest for bank/certificate/fund */}
                                                                                {['bank', 'certificate', 'fund'].includes(groupType) && groupYearlyInterest > 0 && (
                                                                                        <div className="text-left text-profit ">
                                                                                                <span className="text-xs">عائد سنوي: </span>
                                                                                                <span className="font-semibold">{formatCurrency(groupYearlyInterest)}</span>
                                                                                        </div>
                                                                                )}
                                                                        </div>
                                                                </AccordionTrigger>

                                                                {/* Assets Grid */}
                                                                <AccordionContent className="pt-2">
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                                {groupAssets.map((asset) => {
                                                                                        const isStock = asset.type === 'stock';
                                                                                        const isInterestBearing = ['bank', 'certificate', 'fund', 'deposit'].includes(asset.type);

                                                                                        let invested = Number(asset.total_invested || 0);

                                                                                        // Interest bearing calculations
                                                                                        const rate = Number(asset.interest_rate || asset.certificate_return_rate || asset.annual_return_rate || asset.return_rate || 0);
                                                                                        const returnType = (asset.return_type || 'annual') as 'daily' | 'monthly' | 'annual';

                                                                                        // Server-precomputed values take precedence; otherwise recompute locally with return_type awareness
                                                                                        let yearlyInterest = Number(asset.yearly_interest);
                                                                                        let dailyInterest = Number(asset.daily_interest);
                                                                                        let monthlyInterest = Number(asset.monthly_interest);

                                                                                        if ((!yearlyInterest || yearlyInterest === 0) && rate > 0 && invested > 0) {
                                                                                                let yearlyInterestCalc: number;
                                                                                                let dailyInterestCalc: number;
                                                                                                let monthlyInterestCalc: number;
                                                                                                if (returnType === 'daily') {
                                                                                                        dailyInterestCalc = invested * (rate / 100);
                                                                                                        monthlyInterestCalc = dailyInterestCalc * 30;
                                                                                                        yearlyInterestCalc = dailyInterestCalc * 365;
                                                                                                } else if (returnType === 'monthly') {
                                                                                                        monthlyInterestCalc = invested * (rate / 100);
                                                                                                        yearlyInterestCalc = monthlyInterestCalc * 12;
                                                                                                        dailyInterestCalc = yearlyInterestCalc / 365;
                                                                                                } else {
                                                                                                        yearlyInterestCalc = invested * (rate / 100);
                                                                                                        monthlyInterestCalc = yearlyInterestCalc / 12;
                                                                                                        dailyInterestCalc = yearlyInterestCalc / 365;
                                                                                                }
                                                                                                yearlyInterest = yearlyInterestCalc;
                                                                                                monthlyInterest = monthlyInterestCalc;
                                                                                                dailyInterest = dailyInterestCalc;
                                                                                        }
                                                                                        if (!monthlyInterest && yearlyInterest > 0) monthlyInterest = yearlyInterest / 12;
                                                                                        if (!dailyInterest && yearlyInterest > 0) dailyInterest = yearlyInterest / 365;

                                                                                        let daysElapsed = Number(asset.days_elapsed);
                                                                                        if (isNaN(daysElapsed) || daysElapsed <= 0) {
                                                                                                const dateStr = (asset.purchase_date || asset.added_at) as string | undefined;
                                                                                                const addedDate = dateStr ? new Date(dateStr).getTime() : Date.now();
                                                                                                daysElapsed = Math.max(0, Math.floor((Date.now() - addedDate) / (1000 * 60 * 60 * 24)));
                                                                                        }
                                                                                        const accruedInterest = Number(asset.accrued_interest || asset.interest_accrued) || (dailyInterest * daysElapsed);

                                                                                        // Gold calculations
                                                                                        const weightGrams = Number(asset.weight_grams || 0);
                                                                                        const karat = Number(asset.karat || 24);
                                                                                        const purchasePricePerGram = Number(asset.purchase_price_per_gram || 0);
                                                                                        if (invested <= 0 && weightGrams > 0 && purchasePricePerGram > 0) {
                                                                                                invested = weightGrams * purchasePricePerGram;
                                                                                        }
                                                                                        // UNIFY-FIX (Rule 27 NO-FAKE-DATA): أزلت أسعار الذهب الوهمية (4200/3675/3150)
                                                                                        // لو goldPrices = null → اعرض "— بيانات غير متاحة" بدل القيم الوهمية
                                                                                        const goldPricesObj = goldPrices || null;
                                                                                        const livePricePerGram = Number(asset.current_price_per_gram) ||
                                                                                                (goldPricesObj ? (karat === 24 ? goldPricesObj['24k'] : karat === 21 ? goldPricesObj['21k'] : karat === 18 ? goldPricesObj['18k'] : goldPricesObj['24k']) : 0);

                                                                                        // Current Value fallback
                                                                                        let currVal = Number(asset.current_value || 0);
                                                                                        if (currVal <= 0) {
                                                                                                if (isInterestBearing && invested > 0) {
                                                                                                        currVal = invested + accruedInterest;
                                                                                                } else if ((asset.type === 'gold' || (asset.type as string) === 'silver') && weightGrams > 0 && livePricePerGram > 0) {
                                                                                                        currVal = weightGrams * livePricePerGram;
                                                                                                } else if (invested > 0) {
                                                                                                        currVal = invested;
                                                                                                }
                                                                                        }

                                                                                        const gl = currVal - invested;
                                                                                        const glPct = invested > 0 ? (gl / invested) * 100 : 0;

                                                                                        const currentPrice = Number(asset.current_stock_price) || 0;
                                                                                        const priceChange = Number(asset.stock_change_percent) || 0;
                                                                                        const qty = Number(asset.quantity) || 0;
                                                                                        const avgBuy = Number(asset.avg_buy_price) || 0;

                                                                                        return (
                                                                                                <Card key={asset.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => { if (isStock && asset.stock_ticker) loadStockDetail(asset.stock_ticker); }}>
                                                                                                        <CardContent className="p-4">
                                                                                                                <div className="flex items-start justify-between mb-3">
                                                                                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                                                                                <div className="min-w-0">
                                                                                                                                        <h3 className="font-semibold text-sm truncate">{asset.name}</h3>
                                                                                                                                        {isStock && asset.stock_ticker && (
                                                                                                                                                <span className="text-xs text-muted-foreground block" dir="ltr">{asset.stock_ticker}</span>
                                                                                                                                        )}
                                                                                                                                        {isStock && asset.stock_ticker && (() => {
                                                                                                                                                // PHASE3-MARKET-SEGREGATION (Task F): أضف badge بـ
                                                                                                                                                // سوق السهم علشان العميل يفرّق بين EGX و TADAWUL و US.
                                                                                                                                                // لو المحفظة فيها أسهم من أسواق مختلفة، الـ badge بـ يوضّح
                                                                                                                                                // كل سهم بتاع أي سوق بدل ما يبقوا مخلوطين بدون تمييز.
                                                                                                                                                const m = inferStockMarket(String(asset.stock_ticker), String((asset as Record<string, unknown>).stock_market ?? ''));
                                                                                                                                                if (!m || m === 'EGX') return null; // EGX هو الافتراضي — ما نظهرش badge
                                                                                                                                                const label = MARKET_NAMES_AR[m];
                                                                                                                                                return (
                                                                                                                                                        <Badge variant="outline" className="text-xs px-1.5 py-0 mt-1 ml-1 inline-flex items-center gap-1 bg-primary/10 border-primary text-primary ">
                                                                                                                                                                🏛️ {label}
                                                                                                                                                        </Badge>
                                                                                                                                                );
                                                                                                                                        })()}
                                                                                                                                        {Boolean(asset.portfolio_id) && String(asset.portfolio_id) !== 'default' && (
                                                                                                                                                <Badge
                                                                                                                                                        variant="outline"
                                                                                                                                                        className={cn(
                                                                                                                                                                "text-xs px-1.5 py-0 mt-1 inline-flex items-center gap-1",
                                                                                                                                                                getPortfolioColorClass(portfoliosMap[String(asset.portfolio_id)]?.color)
                                                                                                                                                        )}
                                                                                                                                                >
                                                                                                                                                        📁 {portfoliosMap[String(asset.portfolio_id)]?.name || `محفظة #${asset.portfolio_id}`}
                                                                                                                                                </Badge>
                                                                                                                                        )}
                                                                                                                                </div>
                                                                                                                        </div>
                                                                                                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                                                                                                                {/* P30 TASK 4: Bag-Holder Rescue badge — pulsing red for stocks with P&L <= -10% */}
                                                                                                                                {isStock && asset.stock_ticker && glPct <= -10 && (
                                                                                                                                        <Button
                                                                                                                                                variant="outline"
                                                                                                                                                size="sm"
                                                                                                                                                className="h-7 px-2 mr-1 text-xs font-bold border-loss text-loss bg-loss/10 hover:bg-loss dark:hover:bg-loss/10 animate-pulse"
                                                                                                                                                onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        e.preventDefault();
                                                                                                                                                        setRescueProps({
                                                                                                                                                                ticker: String(asset.stock_ticker),
                                                                                                                                                                buyPrice: avgBuy,
                                                                                                                                                                quantity: qty,
                                                                                                                                                                autoAnalyze: true,
                                                                                                                                                        });
                                                                                                                                                        // Scroll to the rescue panel
                                                                                                                                                        setTimeout(() => {
                                                                                                                                                                document.getElementById('bag-holder-rescue-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                                                                                        }, 100);
                                                                                                                                                }}
                                                                                                                                                title="هذا السهم مزنوق بخسارة — اضغط للإنقاذ الفوري"
                                                                                                                                        >
                                                                                                                                                🚨 مزنوق
                                                                                                                                        </Button>
                                                                                                                                )}
                                                                                                                                {/* Deal Advisor button — opens #trading-chart with prefill
                                                                                                                                 (ticker + avg_buy_price + quantity) so the user lands
                                                                                                                                 directly on the Deal Advisor panel for this position. */}
                                                                                                                                {isStock && asset.stock_ticker && (
                                                                                                                                        <Button
                                                                                                                                                variant="outline"
                                                                                                                                                size="sm"
                                                                                                                                                className="h-7 px-2 mr-1 text-xs font-bold border-primary text-primary hover:bg-primary/10"
                                                                                                                                                onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        e.preventDefault();
                                                                                                                                                        setDealAdvisorPrefill({
                                                                                                                                                                ticker: String(asset.stock_ticker),
                                                                                                                                                                entryPrice: avgBuy > 0 ? avgBuy : null,
                                                                                                                                                                entryQty: qty > 0 ? qty : null,
                                                                                                                                                                source: 'portfolio',
                                                                                                                                                        });
                                                                                                                                                        setCurrentView('trading-chart');
                                                                                                                                                }}
                                                                                                                                                title="افتح مستشار الصفقة لهذا المركز"
                                                                                                                                        >
                                                                                                                                                <Sparkles className="w-3 h-3 ml-1" />
                                                                                                                                                مستشار
                                                                                                                                        </Button>
                                                                                                                                )}
                                                                                                                                {isStock && asset.stock_ticker && (
                                                                                                                                        <span
                                                                                                                                                onClick={(e) => {
                                                                                                                                                        e.stopPropagation();
                                                                                                                                                        e.preventDefault();
                                                                                                                                                }}
                                                                                                                                                className="inline-flex"
                                                                                                                                        >
                                                                                                                                                <StockPublisher
                                                                                                                                                        data={{
                                                                                                                                                                ticker: String(asset.stock_ticker),
                                                                                                                                                                currentPrice: Number(currentPrice || asset.current_value || 0),
                                                                                                                                                                entryPrice: avgBuy > 0 ? avgBuy : undefined,
                                                                                                                                                                changePct: Number(priceChange) || undefined,
                                                                                                                                                        }}
                                                                                                                                                        variant="icon"
                                                                                                                                                        size="sm"
                                                                                                                                                />
                                                                                                                                        </span>
                                                                                                                                )}
                                                                                                                                <Button variant="outline" size="icon" className="h-9 w-9" onClick={(e) => { e.stopPropagation(); e.preventDefault(); openEdit(asset); }} title="تعديل"><Pencil className="w-3.5 h-3.5" /></Button>
                                                                                                                                <Button variant="outline" size="icon" className="h-7 w-7 text-muted-foreground hover:text-loss hover:border-loss hover:bg-loss dark:hover:bg-loss/10" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDeleteId(asset.id!); }} title="حذف"><Trash2 className="w-3.5 h-3.5" /></Button>
                                                                                                                        </div>
                                                                                                                </div>

                                                                                                                <div className="space-y-2">
                                                                                                                        <div className="flex justify-between text-sm">
                                                                                                                                <span className="text-muted-foreground">المستثمر</span>
                                                                                                                                <span className="font-medium">{formatCurrency(invested)}</span>
                                                                                                                        </div>

                                                                                                                        {/* Stock: Show current price */}
                                                                                                                        {isStock && currentPrice > 0 && (
                                                                                                                                <div className="flex justify-between text-sm">
                                                                                                                                        <span className="text-muted-foreground">السعر الحالي</span>
                                                                                                                                        <span className="font-medium" dir="ltr">{(currentPrice ?? 0).toFixed(2)} ج.م</span>
                                                                                                                                </div>
                                                                                                                        )}

                                                                                                                        <div className="flex justify-between text-sm">
                                                                                                                                <span className="text-muted-foreground">القيمة الحالية</span>
                                                                                                                                <span className="font-medium">{formatCurrency(currVal)}</span>
                                                                                                                        </div>

                                                                                                                        {/* Profit/Loss */}
                                                                                                                        <div className="flex justify-between text-sm">
                                                                                                                                <span className="text-muted-foreground">الربح/الخسارة</span>
                                                                                                                                <span className={cn('font-semibold', gl >= 0 ? 'text-profit ' : 'text-loss ')}>
                                                                                                                                        {gl >= 0 ? '+' : ''}{formatCurrency(gl)} ({formatPercent(glPct)})
                                                                                                                                </span>
                                                                                                                        </div>

                                                                                                                        {/* Stock: Daily change */}
                                                                                                                        {isStock && currentPrice > 0 && (
                                                                                                                                <div className="flex justify-between text-sm">
                                                                                                                                        <span className="text-muted-foreground">تغيير اليوم</span>
                                                                                                                                        <span className={cn('font-medium', priceChange >= 0 ? 'text-profit ' : 'text-loss ')}>
                                                                                                                                                {formatPercent(priceChange)}
                                                                                                                                        </span>
                                                                                                                                </div>
                                                                                                                        )}

                                                                                                                        {/* Interest-bearing assets: Show interest breakdown */}
                                                                                                                        {isInterestBearing && (rate > 0 || yearlyInterest > 0) && (
                                                                                                                                <>
                                                                                                                                        <div className="flex justify-between text-sm text-profit pt-1 border-t border-dashed">
                                                                                                                                                <span className="text-muted-foreground">العائد السنوي المتوقع</span>
                                                                                                                                                <span className="font-semibold">{formatCurrency(yearlyInterest)}</span>
                                                                                                                                        </div>
                                                                                                                                        <div className="flex justify-between text-xs text-muted-foreground">
                                                                                                                                                <span>شهري</span>
                                                                                                                                                <span>{formatCurrency(monthlyInterest)}</span>
                                                                                                                                        </div>
                                                                                                                                        <div className="flex justify-between text-xs text-muted-foreground">
                                                                                                                                                <span>يومي</span>
                                                                                                                                                <span>{formatCurrency(dailyInterest)}</span>
                                                                                                                                        </div>
                                                                                                                                        {accruedInterest > 0 && (
                                                                                                                                                <div className="mt-2 p-2 bg-profit/20 rounded text-xs">
                                                                                                                                                        <div className="flex justify-between">
                                                                                                                                                                <span className="text-muted-foreground">الفائدة المكتسبة</span>
                                                                                                                                                                <span className="font-semibold text-profit ">
                                                                                                                                                                        {formatCurrency(accruedInterest)}
                                                                                                                                                                </span>
                                                                                                                                                        </div>
                                                                                                                                                        {daysElapsed > 0 && (
                                                                                                                                                                <div className="text-muted-foreground mt-1">منذ {daysElapsed} يوم</div>
                                                                                                                                                        )}
                                                                                                                                                </div>
                                                                                                                                        )}
                                                                                                                                </>
                                                                                                                        )}
                                                                                                                </div>

                                                                                                                {/* Footer info */}
                                                                                                                {isStock && qty > 0 && (
                                                                                                                        <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                                                                                                                {qty.toLocaleString('ar-EG')} سهم @ {(avgBuy ?? 0).toFixed(2)} ج.م
                                                                                                                        </div>
                                                                                                                )}
                                                                                                                {asset.type === 'gold' && (
                                                                                                                        <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                                                                                                                {weightGrams ? `${weightGrams.toLocaleString('ar-EG')} جرام` : ''} {karat ? `عيار ${karat}` : ''}
                                                                                                                                {livePricePerGram > 0 && (
                                                                                                                                        <span className="block mt-1 text-profit ">
                                                                                                                                                سعر الجرام الحالي: {(livePricePerGram ?? 0).toFixed(2)} ج.م
                                                                                                                                        </span>
                                                                                                                                )}
                                                                                                                        </div>
                                                                                                                )}
                                                                                                                {(asset.type === 'bank' || (asset.type as string) === 'deposit') && (
                                                                                                                        <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                                                                                                                {asset.bank_name || ''} {rate > 0 ? `| فائدة ${rate}% سنوياً` : ''}
                                                                                                                        </div>
                                                                                                                )}
                                                                                                                {asset.type === 'certificate' && (
                                                                                                                        <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                                                                                                                {asset.certificate_duration_months ? `${asset.certificate_duration_months} شهر` : ''}
                                                                                                                                {rate > 0 ? ` | فائدة ${rate}% سنوياً` : ''}
                                                                                                                        </div>
                                                                                                                )}
                                                                                                        </CardContent>
                                                                                                </Card>
                                                                                        );
                                                                                })}
                                                                        </div>
                                                                </AccordionContent>
                                                        </AccordionItem>
                                                );
                                        })}
                                </Accordion>
                        )}

                        {/* Add Asset Dialog */}
                        <Dialog open={addDialogOpen} onOpenChange={(v) => { if (!v) { resetForm(); } setAddDialogOpen(v); }}>
                                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
                                        <DialogHeader>
                                                <DialogTitle>إضافة أصل جديد</DialogTitle>
                                                <DialogDescription>أضف أصلًا ماليًا إلى محفظتك المتنوعة</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4 py-2">
                                                <div className="space-y-2">
                                                        <Label>نوع الأصل</Label>
                                                        <Select value={formType} onValueChange={(v) => { setFormType(v as AssetType); if (v !== 'stock') { setFormTicker(''); setFormSelectedPrice(null); } }}>
                                                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                        {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((t) => (
                                                                                <SelectItem key={t} value={t}>{ASSET_TYPE_LABELS[t]}</SelectItem>
                                                                        ))}
                                                                </SelectContent>
                                                        </Select>
                                                </div>

                                                {/* Stock specific with search dropdown */}
                                                {formType === 'stock' && (
                                                        <>
                                                                <div className="space-y-2">
                                                                        <Label>اختر السهم <span className="text-xs text-muted-foreground">(سيتم إضافته تلقائيًا لقائمة المراقبة)</span></Label>
                                                                        <StockSearchDropdown
                                                                                value={formTicker ? `${formTicker} - ${formName}` : ''}
                                                                                onSelect={(ticker, name, price) => handleStockSelect(ticker, name, price)}
                                                                        />
                                                                </div>
                                                                {formSelectedPrice && formSelectedPrice > 0 && (
                                                                        <div className="bg-muted rounded-md px-3 py-2 text-xs flex justify-between">
                                                                                <span className="text-muted-foreground">السعر الحالي للسهم</span>
                                                                                <span className="font-semibold" dir="ltr">{(formSelectedPrice ?? 0).toFixed(2)} ج.م</span>
                                                                        </div>
                                                                )}
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2"><Label>الكمية</Label><Input type="number" value={formQuantity} onChange={(e) => {
                                                                                setFormQuantity(e.target.value);
                                                                                // Auto-calculate total invested
                                                                                const qty = parseInt(e.target.value) || 0;
                                                                                const buy = parseFloat(formAvgBuyPrice) || 0;
                                                                                if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                                                                        }} placeholder="0" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>متوسط سعر الشراء</Label><Input type="number" value={formAvgBuyPrice} onChange={(e) => {
                                                                                setFormAvgBuyPrice(e.target.value);
                                                                                const qty = parseInt(formQuantity) || 0;
                                                                                const buy = parseFloat(e.target.value) || 0;
                                                                                if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                                                                        }} placeholder="0.00" dir="ltr" /></div>
                                                                </div>
                                                                {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
                                                                        <div className="bg-profit/20 border border-profit rounded-md px-3 py-2 text-sm">
                                                                                <span className="text-muted-foreground">إجمالي التكلفة: </span>
                                                                                <span className="font-bold text-profit ">{formatCurrency(parseFloat(formTotalInvested))}</span>
                                                                        </div>
                                                                )}
                                                        </>
                                                )}

                                                {/* Gold specific */}
                                                {formType === 'gold' && (
                                                        <>
                                                                <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: سوار ذهب، خاتم" /></div>
                                                                {goldPrices && (
                                                                        <div className="bg-warning/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 text-sm">
                                                                                <div className="font-semibold text-warning mb-2">أسعار الذهب الحالية (للجرام):</div>
                                                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                                                        <div>عيار ٢٤: <span className="font-bold text-warning ">{goldPrices['24k']?.toFixed(2) || '—'} ج.م</span></div>
                                                                                        <div>عيار ٢١: <span className="font-bold text-warning ">{goldPrices['21k']?.toFixed(2) || '—'} ج.م</span></div>
                                                                                        <div>عيار ١٨: <span className="font-bold text-warning ">{goldPrices['18k']?.toFixed(2) || '—'} ج.م</span></div>
                                                                                </div>
                                                                        </div>
                                                                )}
                                                                <div className="grid grid-cols-3 gap-3">
                                                                        <div className="space-y-2"><Label>الوزن (جرام)</Label><Input type="number" value={formWeight} onChange={(e) => {
                                                                                setFormWeight(e.target.value);
                                                                                // حساب تلقائي: الوزن × سعر الجرام الحالي
                                                                                const weight = parseFloat(e.target.value) || 0;
                                                                                const karatVal = parseInt(formKarat) || 21;
                                                                                let gramPrice = goldPrices?.['21k'] || 0;
                                                                                if (karatVal === 24) gramPrice = goldPrices?.['24k'] || 0;
                                                                                else if (karatVal === 18) gramPrice = goldPrices?.['18k'] || 0;
                                                                                if (weight > 0 && gramPrice > 0) {
                                                                                        setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
                                                                                }
                                                                        }} placeholder="0" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>العيار</Label>
                                                                                <Select value={formKarat} onValueChange={(v) => {
                                                                                        setFormKarat(v);
                                                                                        // إعادة الحساب عند تغيير العيار
                                                                                        const weight = parseFloat(formWeight) || 0;
                                                                                        let gramPrice = goldPrices?.['21k'] || 0;
                                                                                        if (v === '24') gramPrice = goldPrices?.['24k'] || 0;
                                                                                        else if (v === '18') gramPrice = goldPrices?.['18k'] || 0;
                                                                                        if (weight > 0 && gramPrice > 0) {
                                                                                                setFormCurrentValue(String((weight * gramPrice).toFixed(2)));
                                                                                        }
                                                                                }}>
                                                                                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                                                                        <SelectContent><SelectItem value="18">١٨</SelectItem><SelectItem value="21">٢١</SelectItem><SelectItem value="24">٢٤</SelectItem></SelectContent>
                                                                                </Select>
                                                                        </div>
                                                                        <div className="space-y-2"><Label>سعر الشراء/جرام</Label><Input type="number" value={formPricePerGram} onChange={(e) => {
                                                                                setFormPricePerGram(e.target.value);
                                                                                const weight = parseFloat(formWeight) || 0;
                                                                                const price = parseFloat(e.target.value) || 0;
                                                                                if (weight > 0 && price > 0) {
                                                                                        setFormTotalInvested(String((weight * price).toFixed(2)));
                                                                                }
                                                                        }} placeholder="0.00" dir="ltr" /></div>
                                                                </div>
                                                                {formWeight && formPricePerGram && (
                                                                        <div className="bg-muted rounded-md px-3 py-2 text-sm flex justify-between">
                                                                                <span className="text-muted-foreground">تكلفة الشراء (المستثمر):</span>
                                                                                <span className="font-bold">{formatCurrency(parseFloat(formWeight) * parseFloat(formPricePerGram))}</span>
                                                                        </div>
                                                                )}
                                                                {formWeight && formCurrentValue && parseFloat(formCurrentValue) > 0 && (
                                                                        <div className="bg-profit/20 border border-profit rounded-md px-3 py-2 text-sm flex justify-between">
                                                                                <span className="text-muted-foreground">القيمة الحالية:</span>
                                                                                <span className="font-bold text-profit ">{formatCurrency(parseFloat(formCurrentValue))}</span>
                                                                        </div>
                                                                )}
                                                        </>
                                                )}

                                                {/* Bank specific */}
                                                {formType === 'bank' && (
                                                        <>
                                                                <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: حساب التوفير" /></div>
                                                                <div className="space-y-2"><Label>اسم البنك</Label><Input value={formBankName} onChange={(e) => setFormBankName(e.target.value)} placeholder="مثال: البنك الأهلي" /></div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2"><Label>الرصيد</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>سعر الفائدة %</Label><Input type="number" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} placeholder="0" dir="ltr" /></div>
                                                                </div>
                                                        </>
                                                )}

                                                {/* Certificate specific */}
                                                {formType === 'certificate' && (
                                                        <>
                                                                <div className="space-y-2"><Label>اسم الشهادة</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="شهادة التوفير" /></div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2"><Label>المبلغ</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>المدة (شهر)</Label><Input type="number" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} placeholder="0" dir="ltr" /></div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2"><Label>العائد %</Label><Input type="number" value={formReturnRate} onChange={(e) => setFormReturnRate(e.target.value)} placeholder="0" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>تاريخ الاستحقاق</Label><Input type="date" value={formMaturityDate} onChange={(e) => setFormMaturityDate(e.target.value)} dir="ltr" /></div>
                                                                </div>
                                                        </>
                                                )}

                                                {/* Fund specific */}
                                                {formType === 'fund' && (
                                                        <>
                                                                <div className="space-y-2"><Label>اسم الأصل</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: صندوق مصر" /></div>
                                                                <div className="space-y-2"><Label>اسم الصندوق</Label><Input value={formFundName} onChange={(e) => setFormFundName(e.target.value)} placeholder="صندوق الأسهم" /></div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2">
                                                                                <Label>نوع الصندوق</Label>
                                                                                <Select value={formFundType} onValueChange={setFormFundType}>
                                                                                        <SelectTrigger className="w-full"><SelectValue placeholder="اختر نوع الصندوق" /></SelectTrigger>
                                                                                        <SelectContent>
                                                                                                {FUND_TYPES.map((ft) => (
                                                                                                        <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                                                                                                ))}
                                                                                        </SelectContent>
                                                                                </Select>
                                                                        </div>
                                                                        <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                </div>
                                                                <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                {formFundType === 'fixed_income' && (
                                                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-profit/10 rounded-lg border border-profit ">
                                                                                <div className="space-y-2">
                                                                                        <Label className="text-profit ">العائد السنوي %</Label>
                                                                                        <Input type="number" step="0.01" value={formAnnualReturn} onChange={(e) => setFormAnnualReturn(e.target.value)} placeholder="مثال: 15.5" dir="ltr" />
                                                                                </div>
                                                                                <div className="space-y-2">
                                                                                        <Label className="text-profit ">نوع العائد</Label>
                                                                                        <Select value={formReturnType} onValueChange={(v) => setFormReturnType(v as 'annual' | 'monthly' | 'daily')}>
                                                                                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                                                                                <SelectContent>
                                                                                                        <SelectItem value="annual">سنوي</SelectItem>
                                                                                                        <SelectItem value="monthly">شهري</SelectItem>
                                                                                                        <SelectItem value="daily">يومي</SelectItem>
                                                                                                </SelectContent>
                                                                                        </Select>
                                                                                </div>
                                                                                <div className="space-y-2">
                                                                                        <Label className="text-profit ">تاريخ الشراء</Label>
                                                                                        <Input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} dir="ltr" />
                                                                                </div>
                                                                                <p className="text-xs text-muted-foreground sm:col-span-3">
                                                                                        سيتم حساب القيمة الحالية تلقائياً: القيمة الحالية = المبلغ المستثمر + (العائد اليومي × عدد الأيام منذ الشراء)
                                                                                </p>
                                                                        </div>
                                                                )}
                                                        </>
                                                )}

                                                {/* Other / default name + invested + current */}
                                                {(formType === 'real_estate' || formType === 'other') && (
                                                        <>
                                                                <div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={formType === 'real_estate' ? 'اسم العقار' : 'اسم الأصل'} /></div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2"><Label>المبلغ المستثمر</Label><Input type="number" value={formTotalInvested} onChange={(e) => setFormTotalInvested(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                        <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} placeholder="0.00" dir="ltr" /></div>
                                                                </div>
                                                        </>
                                                )}

                                                {/* ── Task 3: Crypto add-asset form (Live Portfolio Overhaul) ── */}
                                                {formType === 'crypto' && (
                                                        <>
                                                                <div className="space-y-2">
                                                                        <Label>اختر العملة <span className="text-xs text-muted-foreground">(من Binance)</span></Label>
                                                                        <CryptoSearchDropdown
                                                                                value={formTicker ? `${formTicker} - ${formName}` : ''}
                                                                                onSelect={(symbol, name, priceUsd) => {
                                                                                        setFormTicker(symbol);
                                                                                        setFormName(name || symbol);
                                                                                        setFormSelectedPrice(priceUsd);
                                                                                }}
                                                                        />
                                                                </div>
                                                                {formSelectedPrice && formSelectedPrice > 0 && (
                                                                        <div className="bg-warning/20 border border-orange-200 dark:border-orange-800 rounded-md px-3 py-2 text-xs flex justify-between">
                                                                                <span className="text-muted-foreground">السعر الحالي (USD)</span>
                                                                                <span className="font-semibold text-warning " dir="ltr">${(formSelectedPrice ?? 0).toFixed(2)}</span>
                                                                        </div>
                                                                )}
                                                                <div className="grid grid-cols-2 gap-3">
                                                                        <div className="space-y-2">
                                                                                <Label>الكمية</Label>
                                                                                <Input type="number" value={formQuantity} onChange={(e) => {
                                                                                        setFormQuantity(e.target.value);
                                                                                        const qty = parseFloat(e.target.value) || 0;
                                                                                        const buy = parseFloat(formAvgBuyPrice) || 0;
                                                                                        if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                                                                                }} placeholder="0.00" dir="ltr" />
                                                                        </div>
                                                                        <div className="space-y-2">
                                                                                <Label>سعر الشراء (USD)</Label>
                                                                                <Input type="number" value={formAvgBuyPrice} onChange={(e) => {
                                                                                        setFormAvgBuyPrice(e.target.value);
                                                                                        const qty = parseFloat(formQuantity) || 0;
                                                                                        const buy = parseFloat(e.target.value) || 0;
                                                                                        if (qty > 0 && buy > 0) setFormTotalInvested(String(qty * buy));
                                                                                }} placeholder="0.00" dir="ltr" />
                                                                        </div>
                                                                </div>
                                                                {formQuantity && formAvgBuyPrice && parseFloat(formTotalInvested) > 0 && (
                                                                        <div className="bg-profit/20 border border-profit rounded-md px-3 py-2 text-sm">
                                                                                <span className="text-muted-foreground">إجمالي التكلفة (USD): </span>
                                                                                <span className="font-bold text-profit ">${parseFloat(formTotalInvested).toFixed(2)}</span>
                                                                        </div>
                                                                )}
                                                                <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                                                                        💡 السعر بالدولار. القيمة الحالية هتتحدث تلقائياً من Binance كل 30 ثانية.
                                                                </p>
                                                        </>
                                                )}

                                                <div className="space-y-2"><Label>ملاحظات (اختياري)</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="أضف ملاحظاتك..." rows={2} /></div>
                                        </div>
                                        <DialogFooter className="gap-2 sm:gap-0">
                                                <Button variant="outline" onClick={() => { resetForm(); setAddDialogOpen(false); }}>إلغاء</Button>
                                                <Button className="bg-profit hover:bg-profit text-white" onClick={handleSave} disabled={saving}>
                                                        {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> جاري الإضافة...</> : 'إضافة'}
                                                </Button>
                                        </DialogFooter>
                                </DialogContent>
                        </Dialog>

                        {/* Edit Dialog */}
                        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
                                        <DialogHeader><DialogTitle>تعديل الأصل</DialogTitle></DialogHeader>
                                        <div className="space-y-4">
                                                <div className="space-y-2">
                                                        <Label>نوع الأصل</Label>
                                                        <Input value={ASSET_TYPE_LABELS[formType] || formType} disabled className="bg-muted" />
                                                </div>
                                                {formType === 'stock' && editAsset?.stock_ticker && (
                                                        <div className="space-y-2">
                                                                <Label>السهم</Label>
                                                                <Input value={`${editAsset.stock_ticker} - ${editAsset.name}`} disabled className="bg-muted" dir="ltr" />
                                                        </div>
                                                )}
                                                {formType !== 'stock' && (
                                                        <div className="space-y-2"><Label>الاسم</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
                                                )}
                                                <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-2">
                                                                <Label>{formType === 'stock' ? 'متوسط سعر الشراء' : 'المبلغ المستثمر'}</Label>
                                                                <Input type="number" value={formAvgBuyPrice || formTotalInvested} onChange={(e) => {
                                                                        if (formType === 'stock') setFormAvgBuyPrice(e.target.value);
                                                                        else setFormTotalInvested(e.target.value);
                                                                }} dir="ltr" />
                                                        </div>
                                                        {formType === 'stock' ? (
                                                                <div className="space-y-2"><Label>الكمية</Label><Input type="number" value={formQuantity} onChange={(e) => setFormQuantity(e.target.value)} dir="ltr" /></div>
                                                        ) : (
                                                                <div className="space-y-2"><Label>القيمة الحالية</Label><Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" /></div>
                                                        )}
                                                </div>
                                                {formType === 'stock' && (
                                                        <div className="space-y-2">
                                                                <Label>القيمة الحالية (تلقائية من السوق)</Label>
                                                                <Input type="number" value={formCurrentValue} onChange={(e) => setFormCurrentValue(e.target.value)} dir="ltr" placeholder="0.00" />
                                                        </div>
                                                )}
                                                <div className="space-y-2"><Label>ملاحظات</Label><Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} /></div>
                                        </div>
                                        <DialogFooter className="gap-2 sm:gap-0">
                                                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>إلغاء</Button>
                                                <Button className="bg-profit hover:bg-profit text-white" onClick={handleEditSave} disabled={saving}>
                                                        {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1.5" /> جاري الحفظ...</> : 'حفظ'}
                                                </Button>
                                        </DialogFooter>
                                </DialogContent>
                        </Dialog>

                        {/* Delete Confirmation */}
                        <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
                                <DialogContent className="sm:max-w-sm" dir="rtl">
                                        <DialogHeader>
                                                <DialogTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="w-5 h-5" /> تأكيد الحذف</DialogTitle>
                                                <DialogDescription>هل أنت متأكد من حذف هذا الأصل؟ لا يمكن التراجع عن هذا الإجراء.</DialogDescription>
                                        </DialogHeader>
                                        <DialogFooter className="gap-2 sm:gap-0">
                                                <Button variant="outline" onClick={() => setDeleteId(null)}>إلغاء</Button>
                                                <Button className="bg-loss hover:bg-loss text-white" onClick={handleDelete}>حذف</Button>
                                        </DialogFooter>
                                </DialogContent>
                        </Dialog>

                        {/* P39-PHASE-2: DynamicRiskProfilerModal — mounted at the end so the
                         "إعادة اختبار الشخصية" button can open it. On complete it just closes;
                         the store's setRiskToleranceScore → setPersona pipeline handles the
                         actual persona update (see src/lib/store.ts). */}
                        <DynamicRiskProfilerModal
                                open={profilerOpen}
                                onOpenChange={setProfilerOpen}
                                onComplete={() => setProfilerOpen(false)}
                        />
                </div>
        );
});

/**
 * prediction-dashboard/ProofModal.tsx
 * ==================================
 * Trade-proof modal dialog. Rendered when `selectedProofTrade != null`.
 *
 * Shows a verified "بطاقة إثبات التوقع" card with:
 *  - Header: badge + outcome + ticker + name + return %.
 *  - 3x3 grid of trade numbers (entry / exit / target1 / target2 / stop /
 *    entry date / execution date).
 *  - Analysis reason block (Task IMPROVEMENT-25) + fallback rationale.
 *  - Institutional intelligence grid (target3 / support / resistance /
 *    who_is_buying / hmm_regime) — Task IMPROVEMENT-25.
 *  - Footer metadata + "تحميل بطاقة الإثبات 📸" PNG export button.
 *
 * The PNG export uses html-to-image's `toPng` on the `proofCardRef`
 * (forwarded from the parent state hook).
 *
 * Originally inlined at lines 1938-2092 of PredictionTrackingDashboard.tsx
 * (~154 LOC).
 */

'use client';

import React from 'react';
import { Download, Loader2, Shield } from 'lucide-react';
import {
 Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, fmtPrice } from '@/lib/utils';
import { PERSONA_CONFIG, OUTCOME_CONFIG } from './constants';
import { formatDateShort, formatReturnPct } from './helpers';
import type { LivePrediction } from './types';

interface ProofModalProps {
 selectedProofTrade: LivePrediction | null;
 onClose: () => void;
 proofCardRef: React.RefObject<HTMLDivElement>;
 downloadingProof: boolean;
 onExportImage: () => Promise<void>;
}

export function ProofModal({
 selectedProofTrade,
 onClose,
 proofCardRef,
 downloadingProof,
 onExportImage,
}: ProofModalProps) {
 return (
 <Dialog open={!!selectedProofTrade} onOpenChange={(open) => !open && onClose()}>
 <DialogContent className="max-w-lg p-0 bg-popover border-border shadow-2xl rounded-2xl overflow-hidden dir-rtl">
 {selectedProofTrade && (
 <div ref={proofCardRef} className="p-6 bg-card space-y-4 relative">
 <DialogHeader className="p-0 border-b border-border/60 pb-3">
 <div className="flex items-center justify-between">
 <Badge variant="outline" className="bg-profit/10 text-profit border-profit/20 font-bold text-xs gap-1">
 <Shield className="w-3.5 h-3.5" />
 بطاقة إثبات التوقع الموثقة
 </Badge>
 <Badge className={cn('text-xs font-bold', OUTCOME_CONFIG[selectedProofTrade.outcome].badge)}>
 {OUTCOME_CONFIG[selectedProofTrade.outcome].label}
 </Badge>
 </div>

 <DialogTitle className="text-xl font-black text-foreground mt-2 flex items-center justify-between">
 <span>{selectedProofTrade.ticker} ({selectedProofTrade.nameAr || selectedProofTrade.ticker})</span>
 <span className="font-mono text-profit text-lg">
 {formatReturnPct(selectedProofTrade.returnPct).text}
 </span>
 </DialogTitle>
 <DialogDescription className="text-xs text-muted-foreground">
 توقع شخصي {PERSONA_CONFIG[selectedProofTrade.persona].emoji} {PERSONA_CONFIG[selectedProofTrade.persona].nameAr} — صدرت بتاريخ {formatDateShort(selectedProofTrade.entryDate)} — التنفيذ: {(selectedProofTrade.executionDate || selectedProofTrade.closedAt) ? formatDateShort(selectedProofTrade.executionDate || selectedProofTrade.closedAt) : 'معلّقة'}
 </DialogDescription>
 </DialogHeader>

 {/* RL-FIX-6: Trade Proof Numbers Grid — 3x3 grid includes second target + dates */}
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-muted/30 border border-border/60 rounded-xl font-mono text-xs">
 <div>
 <span className="text-muted-foreground text-xs block">سعر الدخول المعتمد:</span>
 <strong className="text-foreground text-sm font-bold">{fmtPrice(selectedProofTrade.entryPrice)} ج.م</strong>
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">سعر الإغلاق / الحالي:</span>
 <strong className="text-foreground text-sm font-bold">{fmtPrice(selectedProofTrade.exitPrice || selectedProofTrade.currentPrice)} ج.م</strong>
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">المستهدف الأول (Target 1):</span>
 <strong className="text-profit text-sm font-bold">🎯 {fmtPrice(selectedProofTrade.targetPrice)} ج.م</strong>
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">المستهدف الثاني (Target 2):</span>
 {(selectedProofTrade.targetPrice2 != null && Number(selectedProofTrade.targetPrice2) > 0) ? (
 <strong className="text-whale text-sm font-bold">🎯 {fmtPrice(selectedProofTrade.targetPrice2)} ج.م</strong>
 ) : (
 <strong className="text-muted-foreground text-sm font-bold">—</strong>
 )}
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">وقف الخسارة (Stop):</span>
 <strong className="text-loss text-sm font-bold">🛑 {fmtPrice(selectedProofTrade.stopLoss)} ج.م</strong>
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">تاريخ التوقع:</span>
 <strong className="text-foreground text-sm font-bold">{formatDateShort(selectedProofTrade.entryDate)}</strong>
 </div>
 <div>
 <span className="text-muted-foreground text-xs block">تاريخ التنفيذ:</span>
 <strong className="text-foreground text-sm font-bold">
 {(selectedProofTrade.executionDate || selectedProofTrade.closedAt)
 ? formatDateShort(selectedProofTrade.executionDate || selectedProofTrade.closedAt)
 : 'معلّقة ⏳'}
 </strong>
 </div>
 </div>

 {/* Reason / Proof Rationale */}
 <div className="space-y-2 text-xs">
 <span className="font-bold text-foreground">دليل وتحليل التوقع:</span>

 {/* Task IMPROVEMENT-25: عرض التحليل الفني الشامل (analysis_reason) */}
 {(selectedProofTrade as any).analysis_reason && (
 <div className="p-3 bg-profit/10 /20 border border-profit/20 /30 rounded-xl text-foreground text-xs leading-relaxed whitespace-pre-line">
 {String((selectedProofTrade as any).analysis_reason)}
 </div>
 )}

 {/* fallback: القديم */}
 <p className="p-3 bg-background border border-border/60 rounded-xl text-muted-foreground text-xs leading-relaxed">
 {selectedProofTrade.reason || 'تم إغلاق الصفقة بناءً على تحقق الهدف الفني وحساب حركة السعر المباشرة.'}
 </p>
 </div>

 {/* Task IMPROVEMENT-25: بطاقة الذكاء المؤسسي + HMM + الدعوم/المقاومات */}
 {((selectedProofTrade as any).who_is_buying || (selectedProofTrade as any).hmm_regime || (selectedProofTrade as any).target_price_3 || (selectedProofTrade as any).support_level) && (
 <div className="grid grid-cols-2 gap-2 p-3 bg-muted/20 border border-border/40 rounded-xl text-xs">
 {/* الهدف الثالث (DNA projection) */}
 {(selectedProofTrade as any).target_price_3 && (
 <div>
 <span className="text-muted-foreground text-xs block">الهدف الثالث (DNA):</span>
 <strong className="text-primary text-sm font-bold">🧬 {fmtPrice((selectedProofTrade as any).target_price_3)} ج.م</strong>
 </div>
 )}

 {/* الدعوم/المقاومات */}
 {(selectedProofTrade as any).support_level && (
 <div>
 <span className="text-muted-foreground text-xs block">الدعم:</span>
 <strong className="text-profit text-sm font-bold">📊 {fmtPrice((selectedProofTrade as any).support_level)} ج.م</strong>
 </div>
 )}
 {(selectedProofTrade as any).resistance_level && (
 <div>
 <span className="text-muted-foreground text-xs block">المقاومة:</span>
 <strong className="text-loss text-sm font-bold">📊 {fmtPrice((selectedProofTrade as any).resistance_level)} ج.م</strong>
 </div>
 )}

 {/* WHO IS BUYING */}
 {(selectedProofTrade as any).who_is_buying && (
 <div>
 <span className="text-muted-foreground text-xs block">من يشتري؟</span>
 <strong className="text-primary text-sm font-bold">{String((selectedProofTrade as any).who_is_buying)}</strong>
 </div>
 )}

 {/* HMM Regime */}
 {(selectedProofTrade as any).hmm_regime && (
 <div>
 <span className="text-muted-foreground text-xs block">حالة السوق (HMM):</span>
 <strong className="text-primary text-sm font-bold">🧠 {String((selectedProofTrade as any).hmm_regime)}</strong>
 </div>
 )}
 </div>
 )}

 {/* Footer Proof Metadata */}
 <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/40">
 <span>تاريخ التوثيق: {new Date().toLocaleDateString('ar-EG')}</span>
 <span className="font-mono text-profit font-bold">M2Y INVESTMENT VERIFIED</span>
 </div>

 {/* Modal Actions */}
 <div className="flex items-center justify-end gap-2 pt-2 print:hidden">
 <Button
 variant="outline"
 size="sm"
 onClick={onExportImage}
 disabled={downloadingProof}
 className="h-8 text-xs font-bold border-profit/20 text-profit gap-1"
 >
 {downloadingProof ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
 تحميل بطاقة الإثبات 📸
 </Button>
 <DialogClose asChild>
 <Button variant="secondary" size="sm" className="h-8 text-xs font-bold">
 إغلاق
 </Button>
 </DialogClose>
 </div>
 </div>
 )}
 </DialogContent>
 </Dialog>
 );
}

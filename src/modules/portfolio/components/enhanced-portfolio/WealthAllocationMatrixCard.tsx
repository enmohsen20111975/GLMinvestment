'use client';

/**
 * enhanced-portfolio/WealthAllocationMatrixCard.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: WealthAllocationMatrixCard extracted from
 * EnhancedPortfolioView.tsx (lines ~1828-1959).
 *
 * P39-PHASE-2: Wealth Allocation Matrix — persona-aware asset ceilings + alerts.
 * Pure presentational component: receives pre-computed alerts + persona label +
 * rebalance handler from AssetsTab. Renders a 4-column responsive grid with a
 * progress bar and a red ceiling marker, an alerts list, and the Auto-Rebalance
 * button. dir="rtl" Arabic UI throughout.
 * ============================================================================
 */

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { TrendingUp, Bitcoin, Gem, Banknote, Scale, Shield, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { WealthAllocationAlert } from '@/lib/persona-dynamic';
import type { WealthAllocationMatrixCardProps } from './types';

export function WealthAllocationMatrixCard({
	alerts,
	personaLabel,
	onRebalance,
}: WealthAllocationMatrixCardProps) {
	const assetMeta: Record<WealthAllocationAlert['asset'], { label: string; icon: ReactNode }> = {
		egx: { label: 'الأسهم المصرية', icon: <TrendingUp className="w-4 h-4" /> },
		crypto: { label: 'العملات الرقمية', icon: <Bitcoin className="w-4 h-4" /> },
		gold: { label: 'الذهب', icon: <Gem className="w-4 h-4" /> },
		cash: { label: 'السيولة', icon: <Banknote className="w-4 h-4" /> },
	};
	const severityBorder: Record<WealthAllocationAlert['severity'], string> = {
		ok: 'border-profit/20',
		warning: 'border-warning/20',
		critical: 'border-loss/70',
	};
	const severityText: Record<WealthAllocationAlert['severity'], string> = {
		ok: 'text-profit ',
		warning: 'text-warning ',
		critical: 'text-loss ',
	};
	const orderedAssets: WealthAllocationAlert['asset'][] = ['egx', 'crypto', 'gold', 'cash'];
	const visibleAlerts = alerts.filter((a) => a.severity !== 'ok');

	return (
		<Card dir="rtl" className="border-2 border-profit/20">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-2 flex-wrap">
					<CardTitle className="text-sm md:text-base font-bold flex items-center gap-2">
						<Scale className="w-4 h-4 text-profit" />
						مصفوفة توزيع الثروة — شخصية: {personaLabel}
					</CardTitle>
					<Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
						<Shield className="w-3 h-3" />
						سقوف {personaLabel}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* 4-column grid: egx / crypto / gold / cash */}
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
					{orderedAssets.map((key) => {
						const alert = alerts.find((a) => a.asset === key);
						if (!alert) return null;
						const meta = assetMeta[key];
						const fillPct = Math.min(100, Math.max(0, alert.currentPercent));
						const ceilingPos = Math.min(100, Math.max(0, alert.ceilingPercent));
						return (
							<div
								key={key}
								className={cn('rounded-lg border-2 p-3 bg-card', severityBorder[alert.severity])}
							>
								<div className="flex items-center gap-2 mb-2">
									<span className={cn('flex-shrink-0', severityText[alert.severity])}>{meta.icon}</span>
									<span className="text-xs font-semibold truncate">{meta.label}</span>
								</div>
								<div className="flex items-baseline gap-1.5 mb-2">
									<span className={cn('text-2xl font-bold', severityText[alert.severity])}>
										{(alert.currentPercent ?? 0).toFixed(1)}%
									</span>
									<span className="text-xs text-muted-foreground">
										/ سقف {alert.ceilingPercent}%
									</span>
								</div>
								{/* Progress bar (shadcn Progress) with red ceiling marker overlay.
								 The marker is a sibling of Progress (not a child) because
								 Progress uses overflow-hidden on its root. */}
								<div className="relative">
									<Progress
										value={fillPct}
										className={cn(
											'h-2',
											alert.severity === 'critical' && '[&>[data-slot=progress-indicator]]:bg-loss',
											alert.severity === 'warning' && '[&>[data-slot=progress-indicator]]:bg-warning',
											alert.severity === 'ok' && '[&>[data-slot=progress-indicator]]:bg-profit',
										)}
									/>
									{/* Vertical red line at the ceiling position */}
									{ceilingPos > 0 && ceilingPos < 100 && (
										<div
											className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-loss rounded-full"
											style={{ left: `${ceilingPos}%` }}
											title={`السقف: ${alert.ceilingPercent}%`}
										/>
									)}
								</div>
							</div>
						);
					})}
				</div>

				{/* Alerts list (only non-ok severities) */}
				{visibleAlerts.length > 0 && (
					<ul className="space-y-1.5">
						{visibleAlerts.map((a) => (
							<li
								key={a.asset}
								className={cn(
									'text-xs flex items-start gap-1.5 rounded-md px-2 py-1.5',
									a.severity === 'critical'
										? 'bg-loss/10 text-loss '
										: 'bg-warning/10 text-warning ',
								)}
							>
								<AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
								<span>{a.messageAr}</span>
							</li>
						))}
					</ul>
				)}

				{/* Auto-Rebalance button */}
				<div className="flex items-center gap-2 pt-1">
					<Button size="sm" variant="outline" onClick={onRebalance}>
						<RefreshCw className="w-3.5 h-3.5 ml-1.5" />
						إعادة التوازن التلقائي
					</Button>
					{visibleAlerts.length === 0 && (
						<span className="text-xs text-profit flex items-center gap-1">
							<CheckCircle2 className="w-3.5 h-3.5" />
							المحفظة متوازنة وفقاً لشخصيتك الاستثمارية
						</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

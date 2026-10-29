'use client';

/**
 * persona/WhaleRadarSection.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Smart Money Radar section (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 1969-2055 of `../PersonaTab.tsx`. Renders the whale-radar
 * picks (Quiet Accumulation) as a 3-col grid of fuchsia-accented cards.
 *
 * BRAVO-WHALE-RADAR-HUNTER-MODE (Per Mohsen's directive 2026-10-20):
 * Shows when the general market is in DEFENSIVE mode AND there's quiet whale
 * accumulation. Picks come from `maker_radar.py` (path
 * B_quiet_accumulation_strong — 5/6 or 6/6 signals + 10M+ EGP liquidity).
 *
 * ⚠️ Calculated-risk trades — strict capital management (2% portfolio).
 * ============================================================================
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { WhaleRadarSectionProps } from './types';

export function WhaleRadarSection({ picks }: WhaleRadarSectionProps) {
  if (picks.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐋</span>
          <div>
            <h4 className="text-sm md:text-base font-bold text-foreground flex items-center gap-2">
              <span>رادار صانع السوق والسيولة الذكية</span>
              <span className="text-xs font-normal text-muted-foreground font-mono">
                ({picks.length})
              </span>
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              تجميع هادئ للسيولة المؤسسية في صفقات ذات قيعان سعرية
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className="border-warning/30 bg-warning/10 text-warning text-[10px] font-medium"
          >
            ⚠️ مخاطرة محسوبة
          </Badge>
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/10 text-primary text-[10px] font-medium"
          >
            حجم 2% فقط
          </Badge>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {picks.slice(0, 6).map((p, i) => {
          const entry = Number(p.entry_price || p.current_price || 0);
          const target = Number(p.target_price || 0);
          const stop = Number(p.stop_loss || 0);
          const rr = stop > 0 && entry > 0 ? (target - entry) / (entry - stop) : 0;
          const notes = String((p as any).notes || '');
          // Parse the technical reason from notes (after "WHALE_RADAR | ")
          const techReason = notes.includes('WHALE_RADAR |')
            ? notes.split('WHALE_RADAR |')[1]
            : notes;
          return (
            <div
              key={`whale-${(p.ticker || '') + '-' + i}`}
              className="rounded-lg border border-fuchsia-500/20 bg-white/80/60 p-3 hover:border-fuchsia-500/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{p.ticker}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 font-semibold">
                  🐋 تجميع هادئ
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-xs">
                <div>
                  <div className="text-muted-foreground">دخول</div>
                  <div className="font-mono font-bold">{entry > 0 ? entry.toFixed(2) : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">هدف</div>
                  <div className="font-mono font-bold text-profit">
                    {target > 0 ? target.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">وقف</div>
                  <div className="font-mono font-bold text-loss">
                    {stop > 0 ? stop.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-fuchsia-500/10">
                <span className="text-[10px] text-muted-foreground">
                  R:R ={' '}
                  <span className={`font-bold ${rr >= 1.8 ? 'text-profit' : 'text-warning'}`}>
                    {rr.toFixed(2)}
                  </span>
                </span>
                <span className="text-[10px] text-warning dark:text-warning font-bold">
                  حجم مقترح: 2%
                </span>
              </div>
              {techReason && (
                <p
                  className="text-[10px] text-muted-foreground mt-2 line-clamp-2"
                  title={techReason}
                >
                  {techReason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2 border-t border-fuchsia-500/20 text-[10px] text-muted-foreground">
        ⚠️ تنبيه: هذه صفقات رادار حيتان ذات طابع خاص — ليست توصيات شراء آمنة. السوق العام في وضع دفاعي،
        لكن الحيتان بـ تجمع بهدوء. التزم بـ إدارة رأس المال الصارمة (2% من المحفظة) ووقف الخسارة الحديدي.
      </div>
    </div>
  );
}

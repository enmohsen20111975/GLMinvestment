'use client';

/**
 * persona/PersonaTableView.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — PersonaTableView component (extracted verbatim).
 * ----------------------------------------------------------------------------
 * Originally lines 762-1028 of `../PersonaTab.tsx`. Renders the persona
 * predictions as a 13-column desktop table:
 *
 *   # / السهم / المرحلة / الاسم / السعر وقت التحليل / أعلى-أقل / التقييم /
 *   النتيجة / الدخول / الهدف / الوقف / R/R / أفق الاستثمار / السبب
 *
 * Features:
 *   - ALPHA-FIX Task 4 (Golden Retest): Stage filter chips — derived from
 *     recommendation + analysisJson (correction_end / early_break /
 *     bottom_accumulation / correcting).
 *   - PRICE INVARIANT GUARD: client-side safety check that flags stopped-out,
 *     target-hit, and stale rows with explicit badges + opacity dimming.
 *   - Enriches each row with live prices from `useAnalysisStore` stocks map.
 * ============================================================================
 */

import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn, fmtPrice, verdictStyle, computeRR, rrColor, scoreColor } from '@/lib/utils';
import { useAnalysisStore } from '@/lib/analysis-store';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import type { PersonaTableViewProps, StageFilterKey } from './types';
import { deriveStage, STAGE_META, STAGE_FILTERS, getPersonaJsonKey } from './helpers';
import {
  pickValidPrice,
} from '../helpers';

export function PersonaTableView({
  items,
  persona,
  market,
  onSelectItem,
}: PersonaTableViewProps) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = getPersonaJsonKey(persona);
  const stocks = useAnalysisStore((state) => state.stocks) || [];

  // ══════════════════════════════════════════════════════════════════════
  // ALPHA-FIX Task 4 (Golden Retest): Stage filter + derivation
  // يتم استنتاج مرحلة السهم من الـ recommendation + analysis_json
  // 🛡️ نهاية تصحيح | ⚡ بداية انطلاق | 💎 تجميع قيعان | ⏳ جاري التصحيح
  // ══════════════════════════════════════════════════════════════════════
  const [stageFilter, setStageFilter] = useState<StageFilterKey>('all');

  // Apply stage filter
  const filteredItems =
    stageFilter === 'all'
      ? items
      : items.filter((it) => deriveStage(it, _personaKey) === stageFilter);

  const stocksMap = useMemo(() => {
    const map = new Map<string, any>();
    stocks.forEach((s) => {
      const sTicker = String((s as Record<string, unknown>).ticker || '');
      if (sTicker) {
        const clean = sTicker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(sTicker.toUpperCase(), s);
      }
    });
    return map;
  }, [stocks]);

  return (
    <div className="rounded-md border overflow-x-auto bg-card">
      {/* ALPHA-FIX Task 4: Stage filter buttons — فلتر حركة السهم */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/30 overflow-x-auto">
        <span className="text-[10px] text-muted-foreground ml-1 whitespace-nowrap">المرحلة:</span>
        {STAGE_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStageFilter(s.key as StageFilterKey)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors',
              stageFilter === s.key
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-muted-foreground hover:bg-accent border border-transparent'
            )}
          >
            <span>{s.emoji}</span>
            {s.label}
          </button>
        ))}
      </div>
      <table className="w-full text-sm min-w-[950px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">السهم</th>
            <th className="p-2 text-center font-medium">المرحلة</th>
            <th className="p-2 text-right font-medium">الاسم</th>
            <th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>
            <th className="p-2 text-center font-medium">أعلى / أقل سعر</th>
            <th className="p-2 text-center font-medium">التقييم</th>
            <th className="p-2 text-center font-medium">النتيجة</th>
            <th className="p-2 text-center font-medium">الدخول</th>
            <th className="p-2 text-center font-medium">الهدف</th>
            <th className="p-2 text-center font-medium">الوقف</th>
            <th className="p-2 text-center font-medium">R/R</th>
            <th className="p-2 text-center font-medium hidden md:table-cell">أفق الاستثمار</th>
            <th className="p-2 text-right font-medium hidden lg:table-cell">السبب</th>
          </tr>
        </thead>
        <tbody>
          {filteredItems.map((it, idx) => {
            // ALPHA-FIX Task 4: derive the stock's movement stage
            const _stage = deriveStage(it, _personaKey);
            const _stageInfo = STAGE_META[_stage];
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd =
              it.analysisJson?.[_personaKey] || {
                verdict: it.recommendationAr || '',
                score: it.maestroScore || 0,
                reason: '',
                signal: it.recommendation || 'HOLD',
                entry: it.entry?.price ?? null,
                target: it.entry?.target ?? null,
                stop: it.entry?.stopLoss ?? null,
                timeframe:
                  persona === 'balanced'
                    ? '2-6 أسابيع'
                    : persona === 'conservative'
                      ? '6-12 شهر'
                      : '1-5 أيام',
              };
            const cleanTicker = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
            const stockInfo = stocksMap.get(cleanTicker) || stocksMap.get(it.ticker.toUpperCase());
            const curPrice = pickValidPrice(
              stockInfo?.current_price,
              stockInfo?.close,
              pd.entry,
              typeof it.entry === 'object' ? it.entry?.price : undefined,
              it.analysisJson?.context?.historical?.current_price_zone
            );
            const highPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.high_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.high_52w : undefined,
              pd.high,
              pd.resistance,
              stockInfo?.resistance,
              pd.target && pd.entry ? Math.max(Number(pd.target), Number(pd.entry)) : pd.target,
              stockInfo?.high_price
            );
            const lowPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.low_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.low_52w : undefined,
              pd.low,
              pd.support,
              stockInfo?.support,
              pd.stop && pd.entry ? Math.min(Number(pd.stop), Number(pd.entry)) : pd.stop,
              stockInfo?.low_price
            );
            const style = verdictStyle(pd.verdict);
            const rr = computeRR(pd as unknown as Record<string, unknown>);
            const score = pd.score ?? it.maestroScore ?? 0;
            // 🔥 P0-UI FIX: STALE/MISMATCH flags من الـ backend
            // it.stale = السعر الحي بعيد عن entry بـ >20% (توقع قديمة)
            // it.priceTargetMismatch = السعر الحالي ≥ target (الهدف محقّق، التوقع منتهية)
            const isStale = Boolean(it.stale);
            const isMismatch = Boolean(it.priceTargetMismatch);
            const staleReason = (it.staleReason as string) || '';

            // ════════════════════════════════════════════════════════════════════
            // PRICE INVARIANT GUARD (Client-side safety check)
            // Per ALPHA Operational Directive — منع عرض توصيات متناقضة.
            // مثال: سهم بلتون سعره 2.64 والدخول 3.16 والوقف 2.97 ← لازم يـبان
            // كـ "ملغية" مش "شراء قوي".
            // ════════════════════════════════════════════════════════════════════
            const _entryVal = pd.entry ? Number(pd.entry) : null;
            const _stopVal = pd.stop ? Number(pd.stop) : null;
            const _targetVal = pd.target ? Number(pd.target) : null;
            const _curVal = curPrice ? Number(curPrice) : null;

            // (1) فحص الوقف المضروب: stop >= current → الصفقة ميتة (STOPPED_OUT)
            const _isStoppedOut = _stopVal != null && _curVal != null && _stopVal >= _curVal;

            // (2) فحص الهدف المحقق: current >= target → الصفقة منتهية بالهدف (TARGET_HIT)
            const _isTargetHit = _targetVal != null && _curVal != null && _curVal >= _targetVal;

            // (3) فحص الشذوذ السعري: |cur - entry| / entry > 8% → بيانات قديمة
            const _isPriceMismatch =
              _entryVal != null &&
              _curVal != null &&
              _entryVal > 0 &&
              Math.abs(_curVal - _entryVal) / _entryVal > 0.08;

            // (4) R/R غير صالح: لو الوقف أعلى من السعر الحالي
            const _isRRInvalid = _isStoppedOut;

            // الحالة الموحدة (priority: stopped > target_hit > stale)
            const _invariantStatus = _isStoppedOut
              ? 'STOPPED_OUT'
              : _isTargetHit
                ? 'TARGET_HIT'
                : _isPriceMismatch
                  ? 'STALE'
                  : null;

            // دمج مع الـ backend flags
            const _showStoppedOut = _isStoppedOut || isMismatch;
            const _showTargetHit = _isTargetHit || isMismatch;
            const _showStale = _isPriceMismatch || isStale;
            const _anyInvariant = _showStoppedOut || _showTargetHit || _showStale;

            const rowOpacity = _showStoppedOut ? 'opacity-50' : _showStale ? 'opacity-70' : '';

            return (
              <tr
                key={cleanTicker}
                className={cn(
                  'border-t border-border hover:bg-muted/40 transition-colors cursor-pointer',
                  rowOpacity
                )}
                onClick={() => onSelectItem?.(it)}
              >
                <td className="p-2 text-center font-mono text-xs">{idx + 1}</td>
                <td className="p-2 font-bold text-xs">
                  <div className="flex items-center gap-1.5">
                    <StockIconMini
                      ticker={cleanTicker}
                      name={it.nameAr || it.name}
                      sector={it.sector}
                      logoUrl={it.logoUrl}
                      className="w-6 h-6"
                    />
                    <span>{cleanTicker}</span>
                    {/* PRICE INVARIANT GUARD: badge يوضح حالة الصفقة بشكل صريح */}
                    {_anyInvariant &&
                      (_showStoppedOut ? (
                        <span
                          className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-loss/20 bg-loss/10 text-loss whitespace-nowrap"
                          title="الوقف أعلى من السعر الحالي — الصفقة ميتة"
                        >
                          🚫 ملغية - كسر الوقف
                        </span>
                      ) : _showTargetHit ? (
                        <span
                          className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-profit/20 bg-profit/10 text-profit whitespace-nowrap"
                          title="السعر الحالي ≥ الهدف — الهدف تحقق"
                        >
                          ✅ تحقق الهدف
                        </span>
                      ) : _showStale ? (
                        <span
                          className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-warning/20 bg-warning/10 text-warning whitespace-nowrap"
                          title="السعر الحالي بعيد عن الدخول بـ >8% — بيانات قديمة"
                        >
                          ⚠️ بيانات قديمة
                        </span>
                      ) : null)}
                  </div>
                </td>
                {/* ALPHA-FIX Task 4: Stage Tag column — مرحلة السهم */}
                <td className="p-2 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap',
                      _stageInfo.className
                    )}
                  >
                    {_stageInfo.emoji} {_stageInfo.label}
                  </span>
                </td>
                <td
                  className="p-2 text-xs text-muted-foreground max-w-[120px] truncate"
                  title={it.nameAr || it.name || cleanTicker}
                >
                  {it.nameAr || it.name || cleanTicker}
                </td>
                <td
                  className={cn(
                    'p-2 text-center font-mono text-xs font-bold',
                    _anyInvariant ? 'text-warning' : 'text-primary'
                  )}
                  title={_anyInvariant ? 'الصفقة فيها شذوذ سعري' : undefined}
                >
                  {fmtPrice(curPrice)}
                </td>
                <td className="p-2 text-center font-mono text-xs whitespace-nowrap">
                  <span className="text-profit font-semibold">▲ {fmtPrice(highPrice)}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-loss font-semibold">▼ {fmtPrice(lowPrice)}</span>
                </td>
                <td className="p-2 text-center">
                  {/* PRICE INVARIANT GUARD: منع إظهار "شراء قوي" للصفقات الميتة */}
                  {_showStoppedOut ? (
                    <Badge className="text-xs font-bold border border-loss/20 bg-loss/10 text-loss">
                      ملغية - كسر الوقف
                    </Badge>
                  ) : _showTargetHit ? (
                    <Badge className="text-xs font-bold border border-profit/20 bg-profit/10 text-profit">
                      تحقق الهدف
                    </Badge>
                  ) : _showStale ? (
                    <Badge
                      className="text-xs font-bold border border-warning/20 bg-warning/10 text-warning"
                      title={staleReason}
                    >
                      بيانات قديمة
                    </Badge>
                  ) : (
                    <Badge
                      style={{ backgroundColor: style.bg, color: style.color }}
                      className="text-xs font-bold border-0"
                    >
                      {pd.verdict || 'متابعة'}
                    </Badge>
                  )}
                </td>
                <td className={cn('p-2 text-center font-mono text-xs', scoreColor(pd.score))}>
                  {Number(score).toFixed(0)}
                </td>
                <td className="p-2 text-center font-mono text-xs tabular-nums">
                  {fmtPrice(pd.entry)}
                </td>
                <td className="p-2 text-center font-mono text-xs tabular-nums text-profit glow-profit">
                  {fmtPrice(pd.target)}
                </td>
                <td className="p-2 text-center font-mono text-xs tabular-nums text-loss glow-loss">
                  {fmtPrice(pd.stop)}
                </td>
                {/* R/R — ممنوع إظهار قيمة موجبة للصفقات المكسورة */}
                <td
                  className={cn(
                    'p-2 text-center font-mono text-xs tabular-nums font-bold',
                    _isRRInvalid ? 'text-muted-foreground' : rrColor(rr)
                  )}
                >
                  {_isRRInvalid ? '—' : rr != null ? `${rr.toFixed(2)}:1` : '—'}
                </td>
                <td className="p-2 text-center text-xs hidden md:table-cell">
                  {pd.timeframe || '—'}
                </td>
                <td
                  className="p-2 text-right hidden lg:table-cell text-xs text-muted-foreground max-w-[250px] truncate"
                  title={pd.reason}
                >
                  {pd.reason || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

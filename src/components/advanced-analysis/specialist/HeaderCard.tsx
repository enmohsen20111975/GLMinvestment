/**
 * specialist/HeaderCard.tsx — §1 Header Card (icon + ticker + name + sector + price).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 2119–2227).
 * Shows: stock icon + ticker + Arabic name + sector/industry badges + price + change.
 * Trend + EGX30/70/100 + sharia + suspended badges.
 * Includes StockPublisher (publishing module) icon variant.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { MARKET_NAMES_AR } from '@/lib/store';
import { StockPublisher } from '@/modules/publishing/components/StockPublisher';
import type { ShariaResponse, StockInfo } from './types';
import { fmtNum, safeNum, safeStr } from './helpers';
import { StockIcon } from './primitives';

export function HeaderCard({
  info,
  symbol,
  iconUrl,
  sharia,
  market,
}: {
  info: StockInfo;
  symbol: string;
  iconUrl: string | null;
  sharia: ShariaResponse | null;
  market: string;
}) {
  const nameAr = safeStr(info.name_ar) ?? safeStr(info.name) ?? symbol;
  const sector = safeStr(info.sector);
  const industry = safeStr(info.industry);
  const current = safeNum(info.current_price);
  const changePct = safeNum(info.change_percent);
  const changeValue = safeNum(info.change_value);
  const trend = safeStr(info.trend);
  const isEgx30 = info.is_egx30 === 1 || info.is_egx30 === true;
  const isEgx70 = info.is_egx70 === 1 || info.is_egx70 === true;
  const isEgx100 = info.is_egx100 === 1 || info.is_egx100 === true;
  const isSuspended = info.is_suspended === 1 || info.is_suspended === true;

  const trendAr = trend == null ? null
    : trend === 'صاعد' || trend.toLowerCase().includes('up') || trend.toLowerCase().includes('bull')
    ? { txt: 'صاعد', cls: 'bg-profit/10 text-profit border border-profit/20 ' }
    : trend === 'هابط' || trend.toLowerCase().includes('down') || trend.toLowerCase().includes('bear')
    ? { txt: 'هابط', cls: 'bg-loss/10 text-loss border border-loss/20 ' }
    : { txt: trend, cls: 'bg-muted text-muted-foreground dark:text-muted-foreground' };

  const shariaHalal = sharia?.success
    ? (safeNum(sharia.metric?.is_halal_consensus) === 1 || sharia.metric?.is_halal_consensus === true)
    : null;

  return (
    <Card className="bg-white border-2 border-border shadow-sm">
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0 flex-1 flex items-start gap-3">
            <StockIcon symbol={symbol} iconUrl={iconUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-2xl sm:text-3xl font-bold">{symbol}</h2>
                {trendAr && <Badge className={`text-xs ${trendAr.cls}`}>{trendAr.txt}</Badge>}
                {isEgx30 && <Badge variant="outline" className="text-xs border-profit text-profit">EGX30</Badge>}
                {isEgx70 && <Badge variant="outline" className="text-xs border-warning text-warning">EGX70</Badge>}
                {isEgx100 && <Badge variant="outline" className="text-xs">EGX100</Badge>}
                {shariaHalal != null && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      shariaHalal
                        ? 'border-profit text-profit bg-profit/10'
                        : 'border-loss text-loss bg-loss/10'
                    }`}
                  >
                    {shariaHalal ? '✓ متوافق شرعياً' : '✗ غير متوافق'}
                  </Badge>
                )}
                {isSuspended && (
                  <Badge variant="destructive" className="text-xs">متوقف</Badge>
                )}
                <StockPublisher
                  data={{
                    ticker: symbol,
                    nameAr: nameAr ?? undefined,
                    nameEn: safeStr(info.name) ?? undefined,
                    sector: sector ?? undefined,
                    currentPrice: current ?? 0,
                  }}
                  variant="icon"
                  size="sm"
                />
              </div>
              <p className="text-sm sm:text-base text-muted-foreground">{nameAr}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {sector && <Badge variant="outline" className="text-xs">{sector}</Badge>}
                {industry && <Badge variant="outline" className="text-xs">{industry}</Badge>}
                <Badge variant="outline" className="text-xs">
                  {MARKET_NAMES_AR[market as keyof typeof MARKET_NAMES_AR] ?? market}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-center md:text-left flex-shrink-0">
            <div className="text-3xl sm:text-4xl font-bold">{fmtNum(current, 2)}</div>
            {changePct != null && (
              <p
                className={`text-sm font-semibold mt-1 flex items-center justify-center md:justify-start gap-1 ${
                  changePct >= 0 ? 'text-profit' : 'text-loss'
                }`}
              >
                {changePct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                {changePct >= 0 ? '+' : ''}{(changePct ?? 0).toFixed(2)}%
                {changeValue != null && <span className="text-xs text-muted-foreground">({changeValue >= 0 ? '+' : ''}{changeValue.toFixed(2)})</span>}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

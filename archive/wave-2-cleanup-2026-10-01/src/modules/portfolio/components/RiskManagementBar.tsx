'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert, PieChart, Activity } from 'lucide-react';

interface SectorExp {
  sector: string;
  percentage: number;
}

interface RiskManagementBarProps {
  portfolioHeat?: number;
  sectorExposure?: SectorExp[];
  warning?: string | null;
}

export const RiskManagementBar: React.FC<RiskManagementBarProps> = ({
  portfolioHeat = 24.5,
  sectorExposure = [
    { sector: 'بنوك وخدمات مالية', percentage: 42.0 },
    { sector: 'صناعة وطاقة', percentage: 25.0 },
    { sector: 'عقارات ومقاولات', percentage: 18.0 },
    { sector: 'اتصالات وتكنولوجيا', percentage: 15.0 },
  ],
  warning = '⚠️ تركيز عالي في قطاع بنوك وخدمات مالية (42.0%)',
}) => {
  const highRiskSector = sectorExposure.find((s) => s.percentage > 40.0);

  return (
    <div className="w-full space-y-3 mb-6 dir-rtl">
      {/* Sector Concentration Warning Banner if sector > 40% */}
      {(warning || highRiskSector) && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-red-950/40 border border-red-500/30 text-red-400 text-sm font-medium animate-pulse shadow-lg shadow-red-950/20">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <span>
              {warning || `⚠️ تركيز عالي في قطاع ${highRiskSector?.sector} (${highRiskSector?.percentage}%) — يُنصح بتنويع الأصول`}
            </span>
          </div>
          <span className="px-2.5 py-1 text-xs font-bold bg-red-500/20 rounded-md border border-red-500/40 text-red-300">
            مخاطر تركيز مرتفعة
          </span>
        </div>
      )}

      {/* Main Horizontal Risk Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/95 to-slate-950/90 border border-slate-800 shadow-xl backdrop-blur-md">
        {/* Portfolio Heat Indicator */}
        <div className="md:col-span-4 flex items-center justify-between p-3 rounded-xl bg-slate-850/80 border border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-medium">حرارة المحفظة (Portfolio Heat)</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {portfolioHeat}% <span className="text-xs font-normal text-slate-400">معرض لخطر الـ Stop Loss</span>
              </div>
            </div>
          </div>
          <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                portfolioHeat > 35 ? 'bg-red-500' : portfolioHeat > 20 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, portfolioHeat)}%` }}
            />
          </div>
        </div>

        {/* Sector Exposure Chips */}
        <div className="md:col-span-8 flex items-center justify-between p-3 rounded-xl bg-slate-850/80 border border-slate-800 overflow-x-auto gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <PieChart className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-300">التعرض القطاعي:</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {sectorExposure.map((sec, idx) => {
              const isHigh = sec.percentage > 40;
              return (
                <span
                  key={idx}
                  className={`px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap border transition-all ${
                    isHigh
                      ? 'bg-red-500/20 border-red-500/40 text-red-300 font-bold'
                      : 'bg-slate-800/80 border-slate-700/60 text-slate-300'
                  }`}
                >
                  {sec.sector}: <span className={isHigh ? 'text-red-400' : 'text-emerald-400'}>{sec.percentage}%</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

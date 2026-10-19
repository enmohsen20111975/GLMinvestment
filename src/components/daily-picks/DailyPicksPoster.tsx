'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  TrendingUp, Calendar, Download, RefreshCw, Loader2,
  AlertTriangle, Shield
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';

interface DailyPick {
  id: string;
  rank: number;
  ticker: string;
  name: string;
  signal: string;
  signal_ar: string;
  buy_price: number;
  target_price: number;
  stop_loss: number;
  target_pct: string;
  confidence: number;
  score: number;
  prediction_date: string;
  market: string;
  logo_url: string;
}

export function DailyPicksPoster() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [picks, setPicks] = useState<DailyPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);

  const fetchPicks = useCallback(async () => {
    setLoading(true);
    try {
      const marketCode = currentMarket === 'TADAWUL' ? 'TADAWUL' : currentMarket;
      const res = await fetch(`/api/confluence/daily-picks?market=${marketCode}&limit=15`);
      if (res.ok) {
        const data = await res.json();
        setPicks(data.picks || []);
      }
    } catch (error) {
      console.error('Error fetching picks:', error);
      toast.error('فشل في تحميل التوقعات');
    } finally {
      setLoading(false);
    }
  }, [currentMarket]);

  useEffect(() => {
    fetchPicks();
  }, [fetchPicks]);

  // Format date in Arabic
  const formatDateArabic = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const dayName = days[d.getDay()];
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return `${dayName}: ${day}-${month}-${year}`;
  };

  // Export to PNG
  const exportToPNG = async () => {
    if (!posterRef.current) return;

    setExporting(true);
    try {
      // Dynamic import to avoid SSR issues
      const html2canvas = (await import('html2canvas')).default;
      
      const canvas = await html2canvas(posterRef.current, {
        scale: 2,
        backgroundColor: '#0a0e27',
        useCORS: true,
        logging: false,
        width: 1080,
        windowWidth: 1080,
      });

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `مضاربات-${currentMarket}-${picks[0]?.prediction_date || 'today'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success('تم تحميل البوستر ✓');
      }, 'image/png');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('فشل في تصدير البوستر');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-profit" />
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">لا توجد توقعات متاحة اليوم</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchPicks}>
          <RefreshCw className="w-4 h-4 ml-1" />
          تحديث
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">🎯 مضاربات اليوم - {MARKET_NAMES_AR[currentMarket]}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPicks} disabled={loading}>
            <RefreshCw className="w-4 h-4 ml-1" />
            تحديث
          </Button>
          <Button size="sm" onClick={exportToPNG} disabled={exporting}>
            {exporting ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <Download className="w-4 h-4 ml-1" />
            )}
            تحميل PNG
          </Button>
        </div>
      </div>

      {/* Poster */}
      <div className="flex justify-center overflow-x-auto">
        <div
          ref={posterRef}
          dir="rtl"
          style={{ width: '1080px', maxWidth: '100%' }}
          className="bg-[#0a0e27] shadow-2xl"
        >
          {/* HEADER */}
          <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f1535 0%, #1a1f3a 100%)' }}>
            {/* Background candles effect */}
            <div className="absolute inset-0 opacity-10">
              <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="candles" x="0" y="0" width="40" height="100" patternUnits="userSpaceOnUse">
                    <rect x="15" y="20" width="10" height="40" fill="#00a651" />
                    <rect x="18" y="10" width="4" height="60" fill="#00a651" />
                    <rect x="15" y="70" width="10" height="20" fill="#e31937" />
                    <rect x="18" y="65" width="4" height="30" fill="#e31937" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#candles)" />
              </svg>
            </div>

            {/* Green arrow with bars (left) */}
            <div className="absolute top-6 left-6 opacity-80">
              <svg width="120" height="100" viewBox="0 0 120 100">
                {/* Bars */}
                <rect x="10" y="70" width="12" height="25" fill="#00a651" opacity="0.6" />
                <rect x="28" y="60" width="12" height="35" fill="#00a651" opacity="0.7" />
                <rect x="46" y="45" width="12" height="50" fill="#00a651" opacity="0.8" />
                <rect x="64" y="30" width="12" height="65" fill="#00a651" opacity="0.9" />
                {/* Arrow */}
                <path d="M 5 85 L 80 20 L 70 20 M 80 20 L 80 30" stroke="#00a651" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {/* Gold bull (right) - using emoji as placeholder */}
            <div className="absolute top-6 right-6 text-7xl" style={{ filter: 'drop-shadow(0 0 20px rgba(255, 215, 0, 0.5))' }}>
              🐂
            </div>

            {/* Title */}
            <div className="relative px-8 py-12 text-center">
              <h1 className="text-6xl font-black mb-2" style={{ 
                color: '#ffd700',
                textShadow: '0 0 30px rgba(255, 215, 0, 0.5), 0 4px 6px rgba(0,0,0,0.8)',
                fontFamily: 'Cairo, Tajawal, sans-serif'
              }}>
                مضاربات اليوم
              </h1>
              <p className="text-2xl font-bold mb-3" style={{ 
                color: '#ffd700',
                WebkitTextStroke: '1px white',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)'
              }}>
                دليل الاستثمار
              </p>
              {/* Stars */}
              <div className="flex justify-center gap-1 mb-4">
                <span className="text-2xl" style={{ color: '#ffd700', textShadow: '0 0 10px rgba(255,215,0,0.5)' }}>⭐</span>
                <span className="text-2xl" style={{ color: '#ffd700', textShadow: '0 0 10px rgba(255,215,0,0.5)' }}>⭐</span>
                <span className="text-2xl" style={{ color: '#ffd700', textShadow: '0 0 10px rgba(255,215,0,0.5)' }}>⭐</span>
              </div>
              {/* Date badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: '#ffd700' }}>
                <Calendar className="w-5 h-5 text-[#0a0e27]" />
                <span className="font-bold text-[#0a0e27] text-lg">
                  {formatDateArabic(picks[0]?.prediction_date)}
                </span>
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="bg-white">
            {/* Table Header */}
            <div className="grid grid-cols-4 text-white font-bold text-center" style={{ borderBottom: '2px solid #ffd700' }}>
              <div className="py-3 px-2 text-lg" style={{ background: '#1e3a8a' }}>السهم</div>
              <div className="py-3 px-2 text-lg" style={{ background: '#00a651' }}>سعر الشراء</div>
              <div className="py-3 px-2 text-lg" style={{ background: '#00a651' }}>الهدف</div>
              <div className="py-3 px-2 text-lg" style={{ background: '#e31937' }}>وقف الخسارة</div>
            </div>

            {/* Table Rows */}
            {picks.map((pick, idx) => (
              <div
                key={pick.id}
                className="grid grid-cols-4 items-center text-center"
                style={{ 
                  borderBottom: '1px solid #e5e7eb',
                  background: idx % 2 === 0 ? '#ffffff' : '#f9fafb'
                }}
              >
                {/* Stock Name */}
                <div className="py-3 px-2 flex items-center gap-2 justify-start">
                  <div 
                    className="w-10 h-10 rounded-full bg-whale flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: '#1e3a8a' }}
                  >
                    {pick.ticker.substring(0, 3)}
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-base text-[#111]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      {pick.name}
                    </div>
                    <div className="text-xs text-gray-500">{pick.ticker}</div>
                  </div>
                </div>

                {/* Buy Price */}
                <div className="py-3 px-2">
                  <div className="text-[10px] text-gray-500 mb-0">شراء من</div>
                  <div className="text-2xl font-bold" style={{ color: '#0033cc' }}>
                    {(pick.buy_price ?? 0).toFixed(2)}
                  </div>
                </div>

                {/* Target */}
                <div className="py-3 px-2">
                  <div className="text-2xl font-bold" style={{ color: '#00a651' }}>
                    {(pick.target_price ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs font-semibold" style={{ color: '#00a651' }}>
                    +{pick.target_pct || 0}%
                  </div>
                </div>

                {/* Stop Loss */}
                <div className="py-3 px-2">
                  <div className="text-[10px] text-gray-500 mb-0">وقف الخسارة</div>
                  <div className="text-2xl font-bold" style={{ color: '#e31937' }}>
                    {(pick.stop_loss ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* FOOTER */}
          <div style={{ background: 'linear-gradient(135deg, #0f1535 0%, #1a1f3a 100%)' }}>
            {/* Gold top border */}
            <div style={{ height: '3px', background: '#ffd700' }} />
            
            <div className="px-8 py-6 flex items-center justify-between gap-4">
              {/* Warning */}
              <div className="flex items-start gap-3 flex-1">
                <AlertTriangle className="w-8 h-8 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div className="text-white text-sm space-y-1">
                  <p className="font-semibold">
                    ⚠️ هذا المحتوى للتوعية التعليمية فقط وليس توقعة شراء أو بيع
                  </p>
                  <p className="text-xs text-gray-300">
                    إدارة رأس المال والالتزام بوقف الخسارة أهم من تحقيق الربح
                  </p>
                </div>
              </div>
              
              {/* Shield */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-success flex items-center justify-center">
                  <Shield className="w-7 h-7 text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

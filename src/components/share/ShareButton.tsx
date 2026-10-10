'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Share2, Copy, Check, Image, Loader2, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShareStockData {
  ticker: string;
  name: string;
  nameAr: string;
  price: number;
  change?: number;
  recommendation?: string;
  recommendationAr?: string;
  confidence?: number;
  metrics?: {
    pe?: number;
    roe?: number;
    pb?: number;
    dividendYield?: number;
    eps?: number;
    debtToEquity?: number;
  };
  fairValue?: number;
  upsidePotential?: number;
  targetPrice?: number;
  stopLoss?: number;
  buyPrice?: number;        // سعر الشراء الجيد
  sellPrice?: number;       // سعر البيع المقترح
  expectedReturn?: number;  // العائد المتوقع %
  riskLevel?: string;
  sector?: string;
  // ─── PHASE2-PUBLISHING-CARDS (owner directive) ─────────────────────────
  // شارة السوق + تواريخ التوقّع/التحقق/المدة + R:R + سعر الدخول + شعار السهم.
  market?: string;            // 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO'
  marketNameAr?: string;      // اسم السوق بالعربية (مثل: البورصة المصرية)
  predictionDate?: string;    // تاريخ التوقّع
  verificationDate?: string;  // تاريخ التحقق (إصابة الهدف)
  daysTaken?: number;         // عدد الأيام من التوقّع للتحقق
  riskReward?: number;        // معامل الربحية (R:R)
  entryPrice?: number;        // سعر الدخول المقترح
  logoUrl?: string;           // شعار السهم (الوجه) — fallback: أول حرف من ticker
}

// ─── Share Card (hidden, for image generation) ──────────────────────────────

function ShareCard({
  data,
  cardRef,
}: {
  data: ShareStockData;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const change = data.change;
  const isPositive = change !== undefined && change >= 0;

  const getRecColor = (rec?: string): string => {
    if (!rec) return '#10b981';
    const r = rec.toLowerCase();
    if (r.includes('strong buy') || r.includes('شراء قوي')) return '#059669';
    if (r.includes('buy') || r.includes('شراء')) return '#10b981';
    if (r.includes('hold') || r.includes('احتفاظ') || r.includes('متابعة')) return '#f59e0b';
    if (r.includes('avoid') || r.includes('تجنب') || r.includes('sell') || r.includes('بيع')) return '#ef4444';
    return '#6b7280';
  };

  const recColor = getRecColor(data.recommendation);

  // PHASE2-PUBLISHING-CARDS: شارة السوق بالعربية + اسم المنصة
  const platformName = 'دليل الاستثمار';

  // صياغة التواريخ بالعربية (Rule 27: null/invalid → "—")
  const fmtDateAr = (dateStr?: string): string => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '—';
    }
  };

  const todayStr = fmtDateAr(new Date().toISOString());
  const predictionDateStr = data.predictionDate ? fmtDateAr(data.predictionDate) : '—';
  const verificationDateStr = data.verificationDate ? fmtDateAr(data.verificationDate) : '—';
  const daysTakenStr =
    data.daysTaken != null && Number.isFinite(data.daysTaken)
      ? `${data.daysTaken} يوم`
      : '—';

  return (
    <div
      ref={cardRef}
      style={{
        width: '600px',
        padding: '32px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: '16px',
        fontFamily: 'Arial, sans-serif',
        direction: 'rtl',
        color: '#f8fafc',
      }}
    >
      {/* PHASE2-PUBLISHING-CARDS: Platform branding strip — اسم المنصة + السوق */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', marginBottom: '20px', borderRadius: '8px',
        background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '6px',
            background: 'linear-gradient(135deg, #eab308, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#0f172a', fontWeight: 'bold', fontSize: '14px',
          }}>
            د
          </div>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#facc15' }}>{platformName}</span>
        </div>
        {data.market && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '3px 10px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.08)',
          }}>
            <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#facc15', fontFamily: 'monospace' }}>
              {data.market}
            </span>
            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
              {data.marketNameAr || ''}
            </span>
          </div>
        )}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #059669, #0d9488)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 'bold', fontSize: '18px',
              overflow: 'hidden',
            }}>
              {data.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.logoUrl}
                  alt={data.ticker}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>{data.ticker.charAt(0)}</span>
              )}
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f8fafc' }}>{data.ticker}</div>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>{data.nameAr || data.name}</div>
            </div>
          </div>
          {data.sector && (
            <div style={{
              display: 'inline-block', padding: '4px 12px', borderRadius: '20px',
              background: 'rgba(255,255,255,0.1)', fontSize: '12px', color: '#94a3b8',
            }}>
              {data.sector}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            padding: '6px 16px', borderRadius: '20px',
            background: 'linear-gradient(135deg, #059669, #0d9488)',
            color: 'white', fontWeight: 'bold', fontSize: '13px',
          }}>
            {platformName}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', textAlign: 'left' }} suppressHydrationWarning>
            {todayStr}
          </div>
        </div>
      </div>

      {/* Price */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '20px' }}>
        <span style={{ fontSize: '36px', fontWeight: 'bold', color: '#f8fafc' }}>{(data.price ?? 0).toFixed(2)}</span>
        <span style={{ fontSize: '13px', color: '#64748b' }}>جنيه مصري</span>
        {change !== undefined && (
          <span style={{
            padding: '4px 12px', borderRadius: '20px',
            background: isPositive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: isPositive ? '#10b981' : '#ef4444', fontSize: '14px', fontWeight: '600',
          }}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
          </span>
        )}
      </div>

      {/* Recommendation Badge */}
      {data.recommendation && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px',
          padding: '12px 16px', borderRadius: '12px',
          background: `${recColor}15`, border: `1px solid ${recColor}30`,
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: recColor }} />
          <span style={{ fontSize: '16px', fontWeight: 'bold', color: recColor }}>
            التحليل: {data.recommendationAr || data.recommendation}
          </span>
          {data.confidence !== undefined && (
            <span style={{
              marginRight: 'auto', padding: '4px 12px', borderRadius: '20px',
              background: `${recColor}20`, color: recColor, fontSize: '13px', fontWeight: '600',
            }}>
              ثقة: {(data.confidence ?? 0).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Trading Prices - أسعار التداول */}
      {(data.entryPrice || data.buyPrice || data.targetPrice || data.sellPrice || data.stopLoss || data.fairValue || data.riskReward) && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px', fontWeight: '600' }}>
            〰️ أسعار التداول المهمة 〰️
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {data.entryPrice != null && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.18)', border: '1px solid rgba(59, 130, 246, 0.35)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>🎯 سعر الدخول المقترح</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3b82f6' }}>{(data.entryPrice ?? 0).toFixed(2)}</div>
              </div>
            )}
            {data.buyPrice && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>✅ سعر الشراء الجيد</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>{(data.buyPrice ?? 0).toFixed(2)}</div>
              </div>
            )}
            {(data.sellPrice || data.targetPrice) && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>📤 سعر البيع المقترح</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3b82f6' }}>
                  {(data.sellPrice || data.targetPrice)!.toFixed(2)}
                </div>
              </div>
            )}
            {data.targetPrice && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>🎯 السعر المستهدف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>{(data.targetPrice ?? 0).toFixed(2)}</div>
              </div>
            )}
            {data.stopLoss && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>🛑 وقف الخسارة</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444' }}>{(data.stopLoss ?? 0).toFixed(2)}</div>
              </div>
            )}
            {data.fairValue && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>📐 القيمة العادلة</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(data.fairValue ?? 0).toFixed(2)}</div>
              </div>
            )}
            {data.riskReward != null && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>⚖️ معامل الربحية (R:R)</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f59e0b' }}>
                  {(data.riskReward ?? 0).toFixed(1)} : 1
                </div>
              </div>
            )}
            {(data.expectedReturn ?? data.upsidePotential) !== undefined && (data.expectedReturn ?? data.upsidePotential) !== 0 && (
              <div style={{
                padding: '12px 16px', borderRadius: '12px', background: 'rgba(16,185,129,0.1)',
              }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>📈 العائد المتوقع</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>
                  {((data.expectedReturn ?? data.upsidePotential)!) >= 0 ? '+' : ''}
                  {((data.expectedReturn ?? data.upsidePotential)!)?.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PHASE2-PUBLISHING-CARDS: تواريخ التوقّع / التحقق / المدة */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px', marginBottom: '16px', borderRadius: '8px',
        background: 'rgba(234, 179, 8, 0.08)', border: '1px solid rgba(234, 179, 8, 0.2)',
        fontSize: '11px', color: '#cbd5e1',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px' }}>تاريخ التوقّع</div>
          <div style={{ fontWeight: 'bold', color: '#facc15', fontFamily: 'monospace' }}>{predictionDateStr}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px' }}>تاريخ التحقق</div>
          <div style={{ fontWeight: 'bold', color: '#10b981', fontFamily: 'monospace' }}>{verificationDateStr}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px' }}>المدة المستغرقة</div>
          <div style={{ fontWeight: 'bold', color: '#f8fafc', fontFamily: 'monospace' }}>{daysTakenStr}</div>
        </div>
      </div>

      {/* Metrics Grid */}
      {data.metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {data.metrics.pe !== undefined && data.metrics.pe !== 0 && (
            <MetricBox label="P/E" value={(data.metrics.pe ?? 0).toFixed(1)} />
          )}
          {data.metrics.roe !== undefined && data.metrics.roe !== 0 && (
            <MetricBox label="ROE" value={(data.metrics.roe ?? 0).toFixed(1) + '%'} highlight={data.metrics.roe > 15} />
          )}
          {data.metrics.pb !== undefined && data.metrics.pb !== 0 && (
            <MetricBox label="P/B" value={(data.metrics.pb ?? 0).toFixed(1)} />
          )}
          {data.metrics.dividendYield !== undefined && data.metrics.dividendYield !== 0 && (
            <MetricBox label="عائد التوزيعات" value={(data.metrics.dividendYield ?? 0).toFixed(1) + '%'} highlight={data.metrics.dividendYield > 3} />
          )}
          {data.metrics.eps !== undefined && data.metrics.eps !== 0 && (
            <MetricBox label="EPS" value={(data.metrics.eps ?? 0).toFixed(2) + ' EGP'} />
          )}
          {data.metrics.debtToEquity !== undefined && data.metrics.debtToEquity !== 0 && (
            <MetricBox label="دين/حقوق ملكية" value={(data.metrics.debtToEquity ?? 0).toFixed(2)} />
          )}
        </div>
      )}

      {/* Footer — PHASE2-PUBLISHING-CARDS: owner's exact required disclaimer */}
      <div style={{
        marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{
          padding: '8px 12px', borderRadius: '8px',
          background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)',
          marginBottom: '8px',
        }}>
          <p style={{ fontSize: '11px', color: '#fbbf24', textAlign: 'center', fontWeight: '600' }}>
            ⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. قرارات الاستثمار مسؤوليتك الكاملة.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#475569' }}>تحليل تلقائي بالذكاء الاصطناعي</span>
          <span style={{ fontSize: '11px', color: '#475569' }}>دليل الاستثمار</span>
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: '10px',
      background: highlight ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
    }}>
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '15px', fontWeight: 'bold', color: highlight ? '#10b981' : '#f8fafc' }}>{value}</div>
    </div>
  );
}

// ─── Share Button Component ──────────────────────────────────────────────────

interface ShareButtonProps {
  stockData: ShareStockData;
  iconOnly?: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
  className?: string;
}

export function ShareButton({
  stockData,
  iconOnly,
  variant = 'outline',
  size = 'sm',
  className,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Guard against undefined stockData
  if (!stockData || !stockData.ticker) {
    return null;
  }

  // Generate share text
  const getShareText = useCallback(() => {
    const d = stockData;
    const changeStr = d.change !== undefined ? `${d.change >= 0 ? '▲' : '▼'} ${Math.abs(d.change).toFixed(2)}%` : '';

    // PHASE2-PUBLISHING-CARDS: الترويسة — اسم المنصة + السهم + السوق
    let text = `📈 ${'دليل الاستثمار'} — تحليل ${d.ticker}`;
    if (d.nameAr || d.name) text += ` — ${d.nameAr || d.name}`;
    text += `\n`;
    if (d.market) {
      const marketLabel = d.marketNameAr ? `${d.marketNameAr} (${d.market})` : d.market;
      text += `🏛️ السوق: ${marketLabel}\n`;
    }
    text += `💰 السعر الحالي: ${(d.price ?? 0).toFixed(2)} ج.م ${changeStr}\n`;

    if (d.recommendation) {
      text += `🎯 الإشارة: ${d.recommendationAr || d.recommendation}\n`;
    }
    if (d.confidence !== undefined) {
      text += `📊 مستوى الثقة: ${(d.confidence ?? 0).toFixed(0)}%\n`;
    }

    // === أسعار التداول المهمة ===
    text += `\n〰️〰️ أسعار التداول 〰️〰️\n`;

    if (d.entryPrice != null) {
      text += `🎯 سعر الدخول: ${(d.entryPrice ?? 0).toFixed(2)} ج.م\n`;
    }

    if (d.buyPrice) {
      text += `✅ سعر الشراء الجيد: ${(d.buyPrice ?? 0).toFixed(2)} ج.م\n`;
    } else if (d.fairValue && d.fairValue < d.price * 0.95) {
      // إذا القيمة العادلة أقل من السعر بـ 5%، نستخدمها كسعر شراء
      text += `✅ سعر الشراء الجيد: ${(d.fairValue ?? 0).toFixed(2)} ج.م\n`;
    }

    if (d.targetPrice) {
      text += `🎯 السعر المستهدف: ${(d.targetPrice ?? 0).toFixed(2)} ج.م\n`;
    }

    if (d.sellPrice) {
      text += `📤 سعر البيع المقترح: ${(d.sellPrice ?? 0).toFixed(2)} ج.م\n`;
    } else if (d.targetPrice) {
      text += `📤 سعر البيع المقترح: ${(d.targetPrice ?? 0).toFixed(2)} ج.م\n`;
    }

    if (d.stopLoss) {
      text += `🛑 وقف الخسارة: ${(d.stopLoss ?? 0).toFixed(2)} ج.م\n`;
    }

    // PHASE2-PUBLISHING-CARDS: معامل الربحية R:R
    if (d.riskReward != null) {
      text += `⚖️ معامل الربحية (R:R): ${(d.riskReward ?? 0).toFixed(1)} : 1\n`;
    }

    if (d.expectedReturn !== undefined) {
      text += `📈 العائد المتوقع: ${d.expectedReturn >= 0 ? '+' : ''}${(d.expectedReturn ?? 0).toFixed(1)}%\n`;
    } else if (d.upsidePotential !== undefined && d.upsidePotential !== 0) {
      text += `📈 العائد المتوقع: ${d.upsidePotential >= 0 ? '+' : ''}${(d.upsidePotential ?? 0).toFixed(1)}%\n`;
    }

    // === القيمة العادلة ===
    if (d.fairValue) {
      text += `\n📐 القيمة العادلة: ${(d.fairValue ?? 0).toFixed(2)} ج.م`;
      if (d.upsidePotential !== undefined && d.upsidePotential !== 0) {
        text += ` (${d.upsidePotential >= 0 ? '+' : ''}${(d.upsidePotential ?? 0).toFixed(1)}%)`;
      }
      text += `\n`;
    }

    // === المؤشرات المالية ===
    if (d.metrics) {
      const m = d.metrics;
      const hasMetrics = m.pe || m.roe || m.pb || m.dividendYield;
      if (hasMetrics) {
        text += `\n📊 المؤشرات المالية:\n`;
        if (m.pe) text += `   P/E: ${(m.pe ?? 0).toFixed(1)} | `;
        if (m.roe) text += `ROE: ${(m.roe ?? 0).toFixed(1)}% | `;
        if (m.pb) text += `P/B: ${(m.pb ?? 0).toFixed(1)}\n`;
        if (m.dividendYield) text += `   عائد التوزيعات: ${(m.dividendYield ?? 0).toFixed(1)}%\n`;
      }
    }

    if (d.riskLevel) {
      const riskMap: Record<string, string> = { Low: 'منخفض', Medium: 'متوسط', High: 'مرتفع', 'Very High': 'مرتفع جداً' };
      text += `\n⚠️ مستوى المخاطرة: ${riskMap[d.riskLevel] || d.riskLevel}\n`;
    }
    if (d.sector) text += `🏢 القطاع: ${d.sector}\n`;

    // PHASE2-PUBLISHING-CARDS: التواريخ (توقّع / تحقق / مدة)
    if (d.predictionDate || d.verificationDate || d.daysTaken != null) {
      text += `\n📅 تواريخ التوقّع:\n`;
      if (d.predictionDate) text += `   • توقّع: ${d.predictionDate}\n`;
      if (d.verificationDate) text += `   • تحقق: ${d.verificationDate}\n`;
      if (d.daysTaken != null) text += `   • المدة: ${d.daysTaken} يوم\n`;
    }

    // === التوقيع + الروابط الرسمية + الإخلاء الإجباري ===
    text += `\n━━━━━━━━━━━━━━━━━`;
    text += `\n⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. قرارات الاستثمار مسؤوليتك الكاملة.`;
    text += `\nدليل الاستثمار — تحليل ذكي للأسواق المالية`;
    text += OFFICIAL_LINKS_BLOCK;

    // === الهاشتاجات (متكيّفة مع السوق) ===
    const marketHashtagMap: Record<string, string> = {
      EGX: '#البورصة_المصرية #EGX #مصر',
      TADAWUL: '#السوق_السعودي #تداول #TADAWUL',
      KSE: '#بورصة_الكويت #KSE',
      QSE: '#بورصة_قطر #QSE',
      US: '#البورصة_الأمريكية #NYSE #NASDAQ',
      CRYPTO: '#العملات_الرقمية #CRYPTO',
    };
    const marketHashtags = d.market
      ? (marketHashtagMap[d.market] || `#${d.market}`)
      : '#البورصة_المصرية #توقعات_أسهم #EGX';
    text += `\n\n#توقعات_أسهم #الاستثمار #تداول #الاقتصاد ${marketHashtags}`;

    return text;
  }, [stockData]);

  // Generate image from card
  const generateImage = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    try {
      setGeneratingImage(true);
      const dataUrl = await toPng(cardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (err) {
      console.error('Image generation failed:', err);
      return null;
    } finally {
      setGeneratingImage(false);
    }
  }, []);

  // Copy text to clipboard
  const handleCopyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getShareText());
      setCopied(true);
      toast.success('تم نسخ النص بنجاح');
      setTimeout(() => setCopied(false), 2000);
    } catch { // silent fallback (safe-by-design)
      toast.error('فشل نسخ النص');
    }
  }, [getShareText]);

  // Native share (mobile)
  const handleNativeShare = useCallback(async () => {
    if (!navigator.share) {
      toast.error('المشاركة غير مدعومة في هذا المتصفح');
      return;
    }
    try {
      const imageBlob = await generateImage();
      const shareData: ShareData = {
        title: `تحليل ${stockData.ticker} - دليل الاستثمار`,
        text: getShareText(),
      };
      if (imageBlob && navigator.canShare) {
        const file = new File([imageBlob], `${stockData.ticker}_analysis.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }
      await navigator.share(shareData);
      setOpen(false);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Share failed:', err);
        toast.error('فشل في المشاركة');
      }
    }
  }, [stockData, generateImage, getShareText]);

  // Download image
  const handleDownloadImage = useCallback(async () => {
    const blob = await generateImage();
    if (!blob) {
      toast.error('فشل في إنشاء الصورة');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stockData.ticker}_analysis_${new Date().toISOString().split('T')[0]}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('تم تحميل الصورة بنجاح');
  }, [generateImage, stockData.ticker]);

  const shareText = getShareText();
  const platformUrl = typeof window !== 'undefined' ? window.location.origin : 'https://invist.m2y.net';
  // PHASE2-PUBLISHING-CARDS: نص مختصر يتضمن المنصة + السهم + السوق + السعر + الإشارة + الإخلاء.
  const _s = stockData;
  const _marketLine = _s.market
    ? `السوق: ${_s.marketNameAr ? `${_s.marketNameAr} (${_s.market})` : _s.market}\n`
    : '';
  const shortText =
    `دليل الاستثمار — تحليل ${_s.ticker}${_s.nameAr || _s.name ? ` — ${_s.nameAr || _s.name}` : ''}\n` +
    (_marketLine) +
    `السعر: ${(_s.price ?? 0).toFixed(2)} ج.م\n` +
    `الإشارة: ${_s.recommendationAr || _s.recommendation || 'غير محدد'}\n` +
    `⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. قرارات الاستثمار مسؤوليتك الكاملة.` +
    OFFICIAL_LINKS_BLOCK;
  
  const shareUrls = {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
    // فيسبوك لا يدعم النص المخصص، نستخدم الرابط فقط
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(platformUrl)}&quote=${encodeURIComponent(shortText)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(platformUrl)}&text=${encodeURIComponent(shareText)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(platformUrl)}`,
  };

  return (
    <>
      {/* Hidden card for image generation */}
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', zIndex: -1 }}>
        <ShareCard data={stockData} cardRef={cardRef} />
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={cn('gap-2', className)}
            aria-label="مشاركة التحليل"
          >
            <Share2 className="w-4 h-4" />
            {!iconOnly && <span className="hidden sm:inline">مشاركة</span>}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align={iconOnly ? 'center' : 'end'}
          side="bottom"
          sideOffset={8}
          className="w-80 p-0 overflow-hidden rounded-xl shadow-xl border"
          dir="rtl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b bg-muted/50">
            <h3 className="text-sm font-bold text-foreground">مشاركة تحليل {stockData.ticker}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{stockData.nameAr || stockData.name}</p>
          </div>

          {/* Options */}
          <div className="p-3 space-y-1.5">
            {/* Native Share (mobile) */}
            {typeof navigator !== 'undefined' && navigator.share && (
              <button
                onClick={handleNativeShare}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-right"
              >
                <Share2 className="w-4 h-4 text-primary" />
                <span>مشاركة...</span>
              </button>
            )}

            {/* Copy Text */}
            <button
              onClick={handleCopyText}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-right"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
              <span>{copied ? 'تم النسخ!' : 'نسخ النص'}</span>
            </button>

            {/* Download Image */}
            <button
              onClick={handleDownloadImage}
              disabled={generatingImage}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-muted transition-colors text-right disabled:opacity-50"
            >
              {generatingImage ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Image className="w-4 h-4 text-muted-foreground" />}
              <span>{generatingImage ? 'جارٍ إنشاء الصورة...' : 'تحميل كصورة'}</span>
            </button>

            <div className="h-px bg-border my-2" />

            {/* Social Media */}
            <p className="px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">مشاركة على</p>

            <div className="grid grid-cols-2 gap-1.5">
              <SocialShareButton label="X (تويتر)" onClick={() => window.open(shareUrls.twitter, '_blank', 'width=600,height=400')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </SocialShareButton>
              <SocialShareButton label="فيسبوك" onClick={() => window.open(shareUrls.facebook, '_blank', 'width=600,height=400')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </SocialShareButton>
              <SocialShareButton label="واتساب" onClick={() => window.open(shareUrls.whatsapp, '_blank')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
              </SocialShareButton>
              <SocialShareButton label="تيليجرام" onClick={() => window.open(shareUrls.telegram, '_blank')}>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#0088cc"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
              </SocialShareButton>
              <SocialShareButton label="بوت التحليل" onClick={() => window.open(OFFICIAL_LINKS.bot, '_blank', 'noopener,noreferrer')}>
                <Bot className="w-4 h-4 text-amber-600" />
              </SocialShareButton>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

// ─── Social Share Button ─────────────────────────────────────────────────────

function SocialShareButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors text-right"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

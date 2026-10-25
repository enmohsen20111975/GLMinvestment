/**
 * specialist/ShareButtons.tsx — Social share buttons (WhatsApp/FB/Telegram/copy).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 2064–2117).
 * Builds Arabic share text with current price + change + trend + support/resistance.
 */
import { Button } from '@/components/ui/button';
import { Download, Facebook, MessageCircle, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import type { StockInfo } from './types';
import { safeNum, safeStr } from './helpers';
import { SectionCard } from './primitives';

export function ShareButtons({ info, ticker }: { info: StockInfo; ticker: string }) {
  const nameAr = safeStr(info.name_ar) ?? safeStr(info.name) ?? ticker;
  const current = safeNum(info.current_price);
  const changePct = safeNum(info.change_percent);
  const trend = safeStr(info.trend);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);

  const shareText = `📊 تحليل سهم ${ticker} - ${nameAr}

💰 السعر الحالي: ${current != null ? current.toFixed(2) : '—'}
${changePct != null ? `${changePct >= 0 ? '📈' : '📉'} التغير: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%\n` : ''}📊 الاتجاه: ${trend ?? '—'}
🛡️ الدعم: ${support != null ? support.toFixed(2) : '—'}
🎯 المقاومة: ${resistance != null ? resistance.toFixed(2) : '—'}
${OFFICIAL_LINKS_BLOCK}

#EGX #استثمار #تحليل_فني`;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const handleShare = (kind: 'whatsapp' | 'facebook' | 'telegram' | 'copy') => {
    if (kind === 'whatsapp') window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
    else if (kind === 'facebook')
      window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(shareText)}&u=${encodeURIComponent(shareUrl)}`, '_blank');
    else if (kind === 'telegram')
      window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank');
    else {
      navigator.clipboard.writeText(shareText);
      toast.success('تم نسخ التحليل!');
    }
  };

  return (
    <SectionCard icon={<Share2 className="w-4 h-4" />} title="مشاركة التحليل" accent="slate">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleShare('whatsapp')} size="sm" className="bg-profit hover:bg-profit text-white gap-1.5">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </Button>
        <Button onClick={() => handleShare('facebook')} size="sm" className="bg-profit hover:bg-profit text-white gap-1.5">
          <Facebook className="w-4 h-4" /> Facebook
        </Button>
        <Button onClick={() => handleShare('telegram')} size="sm" className="bg-slate-600 hover:bg-slate-700 text-foreground gap-1.5">
          <Send className="w-4 h-4" /> Telegram
        </Button>
        <Button onClick={() => handleShare('copy')} size="sm" variant="outline" className="gap-1.5">
          <Download className="w-4 h-4" /> نسخ
        </Button>
      </div>
    </SectionCard>
  );
}

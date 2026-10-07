/**
 * 😈 المحرك 1: محرك التناقض (Divergence Engine)
 *
 * لما يحصل خبر، قارن بين:
 * - الخبر بيقول إيه؟ (كويس / سيء / محايد)
 * - السعر عمل إيه بعد الخبر بـ 30 دقيقة؟ (طلع / نزل / مفيش حركة)
 *
 * المنطق:
 * - خبر كويس + السعر نزل = 🚨 إشارة قوية (حد كبير بيبيع — "توزيع")
 * - خبر سيء + السعر طلع = 🚨 إشارة قوية (حد كبير بيجمع — "تراكم")
 * - خبر كويس + سعر طلع = عادي
 * - خبر سيء + سعر نزل = عادي
 */

import type { DivergenceSignal, NewsItem, PriceReaction } from './types';

// ==================== تحليل التناقض ====================

export function analyzeDivergence(
  news: NewsItem,
  reaction: PriceReaction
): DivergenceSignal {
  const newsSays = news.sentiment;
  const marketDid = reaction.direction;

  let divergenceType: DivergenceSignal['divergenceType'] = 'normal';
  let strength: DivergenceSignal['strength'] = 'none';
  let signalScore = 0;
  let devilVerdict = '';

  // القاعدة الذهبية: "السوق صح — أنا غلط"
  // خبر كويس + سعر نزل = توزيع (Distribution)
  if (newsSays === 'positive' && marketDid === 'down') {
    divergenceType = 'distribution';
    const magnitude = Math.abs(reaction.changePercent);
    strength = magnitude > 1.5 ? 'very_strong' : magnitude > 0.5 ? 'strong' : 'weak';
    signalScore = -Math.min(100, magnitude * 30); // كل ما النزول أكبر، الإشارة أقوى

    devilVerdict = `الخبر بيقول "كويس" (${news.title.slice(0, 50)}...), بس السوق نزل ${reaction.changePercent.toFixed(2)}% `;
    if (strength === 'very_strong') {
      devilVerdict += '— 🚨🚨 حد كبير بيبيع بقوة. ابعد فوراً. ده "توزيع" حقيقي.';
    } else if (strength === 'strong') {
      devilVerdict += '— 🚨 التوزيع بدأ. ابعد.';
    } else {
      devilVerdict += '— احذر. فيه بيع خفيف. راقب.';
    }
  }
  // خبر سيء + سعر طلع = تراكم (Accumulation)
  else if (newsSays === 'negative' && marketDid === 'up') {
    divergenceType = 'accumulation';
    const magnitude = Math.abs(reaction.changePercent);
    strength = magnitude > 1.5 ? 'very_strong' : magnitude > 0.5 ? 'strong' : 'weak';
    signalScore = Math.min(100, magnitude * 30);

    devilVerdict = `الخبر بيقول "سيء" (${news.title.slice(0, 50)}...), بس السوق طلع ${reaction.changePercent.toFixed(2)}% `;
    if (strength === 'very_strong') {
      devilVerdict += '— 🟢🟢 حد كبير بيجمع بقوة. ده "تراكم" حقيقي. فرصة.';
    } else if (strength === 'strong') {
      devilVerdict += '— 🟢 التراكم بدأ. فرصة محتملة.';
    } else {
      devilVerdict += '— فيه شراء خفيف. راقب.';
    }
  }
  // خبر كويس + سعر طلع = عادي
  else if (newsSays === 'positive' && marketDid === 'up') {
    divergenceType = 'normal';
    strength = 'none';
    signalScore = 10; // إشارة موجبة ضعيفة
    devilVerdict = `الخبر كويس والسعر طلع ${reaction.changePercent.toFixed(2)}% — الكل شايف الخبر. حركة طبيعية.`;
  }
  // خبر سيء + سعر نزل = عادي
  else if (newsSays === 'negative' && marketDid === 'down') {
    divergenceType = 'normal';
    strength = 'none';
    signalScore = -10;
    devilVerdict = `الخبر سيء والسعر نزل ${reaction.changePercent.toFixed(2)}% — الكل شايف الخبر. حركة طبيعية.`;
  }
  // مفيش رد فعل (السهم نايم)
  else if (marketDid === 'flat') {
    divergenceType = 'no_reaction';
    strength = 'weak';
    signalScore = -5;
    devilVerdict = `الخبر ${newsSays === 'positive' ? 'كويس' : newsSays === 'negative' ? 'سيء' : 'محايد'} بس السهم ماتحركش — مفيش سيولة أو مفيش اهتمام. احذر.`;
  }
  // محايد
  else {
    divergenceType = 'normal';
    strength = 'none';
    signalScore = 0;
    devilVerdict = 'الخبر محايد — مفيش تناقض واضح.';
  }

  // تعديل حسب السيولة
  if (reaction.volumeRatio && reaction.volumeRatio < 0.7) {
    devilVerdict += ' ⚠️ السيولة منخفضة — الحركة مش موثوقة.';
    signalScore = signalScore * 0.5; // نص القيمة
  }

  return {
    newsTitle: news.title,
    newsSays,
    marketDid,
    divergenceType,
    strength,
    devilVerdict,
    signalScore: Math.round(signalScore),
  };
}

// ==================== اكتشاف التناقض من قائمة أخبار ====================

export function findStrongestDivergence(
  newsList: NewsItem[],
  reactions: Map<string, PriceReaction>
): DivergenceSignal | null {
  let strongest: DivergenceSignal | null = null;
  let strongestAbs = 0;

  for (const news of newsList) {
    const reaction = reactions.get(news.title) || reactions.get(news.publishedAt);
    if (!reaction) continue;

    const signal = analyzeDivergence(news, reaction);
    const abs = Math.abs(signal.signalScore);
    if (abs > strongestAbs) {
      strongestAbs = abs;
      strongest = signal;
    }
  }

  return strongest;
}

// ==================== محرك مبسط (للأخبار بدون بيانات سعر مفصلة) ====================

export function quickDivergence(
  newsSentiment: 'positive' | 'negative' | 'neutral',
  priceChangePercent: number,
  volumeRatio: number = 1
): DivergenceSignal {
  const direction: PriceReaction['direction'] =
    priceChangePercent > 0.3 ? 'up' : priceChangePercent < -0.3 ? 'down' : 'flat';

  const reaction: PriceReaction = {
    priceBefore: 100,
    priceAfter: 100 * (1 + priceChangePercent / 100),
    changePercent: priceChangePercent,
    volumeRatio,
    direction,
  };

  const news: NewsItem = {
    title: 'آخر خبر',
    sentiment: newsSentiment,
    sentimentScore: newsSentiment === 'positive' ? 50 : newsSentiment === 'negative' ? -50 : 0,
    publishedAt: new Date().toISOString(),
  };

  return analyzeDivergence(news, reaction);
}

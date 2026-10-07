/**
 * 😈 مصفوفة السيناريوهات (Scenario Matrix)
 *
 * لو السوق اتغير، إيه هيحصل لـ {ticker}؟
 * 3 سيناريوهات لكل سهم:
 * 1. السوق يطلع
 * 2. السوق يعرض
 * 3. السوق ينزل
 */

import type { ScenarioMatrix, StockScenario } from './types';
import { runChainReaction } from './chain-reaction-engine';
import type { MacroEventType } from './types';

// ==================== بناء مصفوفة السيناريوهات ====================

export interface ScenarioInput {
  ticker: string;
  nameAr?: string;
  beta?: number; // حساسية السهم للسوق (1 = متوسط)
  currentPrice?: number;
  marketRegime?: 'bull' | 'bear' | 'range' | 'transition';
  macroEvent?: MacroEventType; // لو فيه حدث ماكرو شغال
}

export function buildScenarioMatrix(input: ScenarioInput): ScenarioMatrix {
  const { ticker, nameAr, beta = 1.0, macroEvent } = input;

  // احتمالات حسب وضع السوق
  let bullProb = 0.30;
  let rangeProb = 0.50;
  let bearProb = 0.20;

  if (input.marketRegime === 'bull') {
    bullProb = 0.50; rangeProb = 0.35; bearProb = 0.15;
  } else if (input.marketRegime === 'bear') {
    bullProb = 0.15; rangeProb = 0.35; bearProb = 0.50;
  } else if (input.marketRegime === 'transition') {
    bullProb = 0.25; rangeProb = 0.30; bearProb = 0.45;
  }

  // حركة السوق في كل سيناريو
  const bullMarketMove = 3;
  const rangeMarketMove = 0;
  const bearMarketMove = -5;

  // حركة السهم = حركة السوق × beta
  let bullStockMove = bullMarketMove * beta;
  let rangeStockMove = rangeMarketMove;
  let bearStockMove = bearMarketMove * beta;

  // لو فيه حدث ماكرو، نضيف تأثيره
  if (macroEvent) {
    const chain = runChainReaction(macroEvent, 'up', 2);
    const stockImpact = [...chain.beneficiaries, ...chain.sufferers, ...chain.mixed]
      .find(c => c.ticker === ticker);
    if (stockImpact) {
      bullStockMove += stockImpact.impactPercent * 0.5;
      bearStockMove += stockImpact.impactPercent * 0.5;
    }
  }

  const scenarios: StockScenario[] = [
    {
      name: 'السيناريو الذهبي',
      probability: bullProb,
      marketMove: bullMarketMove,
      stockMove: parseFloat(bullStockMove.toFixed(1)),
      action: bullStockMove > 3 ? 'buy_now' : 'wait',
      reasoning: `السوق يطلع ${bullMarketMove}% → ${ticker} هيطلع ${bullStockMove.toFixed(1)}% (beta ${beta}). ${bullStockMove > 5 ? 'ألفا قوية' : 'حركة عادية'}`,
    },
    {
      name: 'السيناريو العرضي',
      probability: rangeProb,
      marketMove: rangeMarketMove,
      stockMove: parseFloat(rangeStockMove.toFixed(1)),
      action: 'wait',
      reasoning: `السوق يعرض عند مستوياته → ${ticker} يعرض. انتظر الكسر`,
    },
    {
      name: 'السيناريو الأسود',
      probability: bearProb,
      marketMove: bearMarketMove,
      stockMove: parseFloat(bearStockMove.toFixed(1)),
      action: bearStockMove < -7 ? 'sell_or_avoid' : 'wait',
      reasoning: `السوق ينزل ${Math.abs(bearMarketMove)}% → ${ticker} ينزل ${bearStockMove.toFixed(1)}%. ${bearStockMove < -7 ? 'كسر الوقف — بيع' : 'نزول محتمل'}`,
    },
  ];

  // تحديد الحالات
  const bestCase = scenarios[0];
  const baseCase = scenarios[1];
  const worstCase = scenarios[2];

  // كلام الشيطان
  const expectedMove = scenarios.reduce((sum, s) => sum + s.probability * s.stockMove, 0);
  let devilVerdict = `القيمة المتوقعة: ${expectedMove.toFixed(1)}%. `;

  if (expectedMove > 2) {
    devilVerdict += `🟢 الميل للصعود — العبة: اشترِ دلوقتي`;
  } else if (expectedMove < -2) {
    devilVerdict += `🔴 الميل للنزول — العبة: ابعد أو بيع`;
  } else {
    devilVerdict += `🟡 المحصلة محايدة — العبة: انتظر`;
  }

  if (worstCase.stockMove < -10) {
    devilVerdict += ` ⚠️ احذر: السيناريو الأسود ممكن يكسر الوقف`;
  }

  return {
    ticker,
    scenarios,
    bestCase,
    worstCase,
    baseCase,
    devilVerdict,
  };
}

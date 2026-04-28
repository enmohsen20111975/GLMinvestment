import { NextResponse } from 'next/server';
import { generateRecommendations } from '@/lib/v2/recommendation-engine';
import type { RecommendResponse } from '@/lib/v2/types';
import { ensureInitialized } from '@/lib/egx-db';

/**
 * GET /api/v2/live-analysis
 * 
 * Real-time analysis endpoint that:
 * 1. Re-runs the full V2.1.0 recommendation engine on LIVE database data
 * 2. Computes price changes since last analysis (detects upgrades/downgrades)
 * 3. Uses LLM (via z-ai-web-dev-sdk) to generate market commentary
 * 
 * This endpoint is designed to be called every 15-30 minutes for fresh analysis.
 */
export async function GET() {
  const startTime = Date.now();

  try {
    // CRITICAL: Initialize sql.js WASM before any database access
    await ensureInitialized();

    // ===== STEP 1: Run full recommendation engine on live data =====
    let result: RecommendResponse;
    try {
      result = generateRecommendations({ limit: 100 });
    } catch (engineErr) {
      // Heavy DB unavailable - return minimal response instead of 500
      console.warn('[Live Analysis] Recommendation engine failed (heavy DB unavailable):', engineErr);
      return NextResponse.json({
        market: {
          regime: 'neutral' as const,
          regimeMultiplier: 1.0,
          indexYTDChange: 0,
          sectorAverages: [],
          fearCashPercent: 20,
          totalStocksAnalyzed: 0,
          passedSafetyFilter: 0,
          recommendations: { strongBuy: 0, buy: 0, hold: 0, avoid: 0, strongAvoid: 0 },
          diversificationIssues: ['قاعدة بيانات التحليل غير متاحة حالياً'],
          capDistribution: { large: 0, mid: 0, small: 0 },
        },
        stocks: [],
        generatedAt: new Date().toISOString(),
        analysisVersion: '2.1.0',
        _live: {
          analyzedAt: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
          changes: [],
          aiCommentary: 'تحليل غير متاح حالياً - قاعدة البيانات الثقيلة غير محملة.',
          nextRefreshMinutes: 15,
          engineVersion: '2.1.0',
          heavyDbUnavailable: true,
        },
      });
    }

    // ===== STEP 2: Detect changes (price movements, recommendation shifts) =====
    const changes = detectChanges(result);

    // ===== STEP 3: Generate AI market commentary =====
    let aiCommentary: string | null = null;
    try {
      aiCommentary = await generateAICommentary(result, changes);
    } catch (aiErr) {
      console.warn('[Live Analysis] AI commentary failed (non-critical):', aiErr);
      aiCommentary = generateFallbackCommentary(result, changes);
    }

    // ===== STEP 4: Build response =====
    const processingTimeMs = Date.now() - startTime;

    return NextResponse.json({
      ...result,
      _live: {
        analyzedAt: new Date().toISOString(),
        processingTimeMs,
        changes,
        aiCommentary,
        nextRefreshMinutes: 15,
        engineVersion: result.analysisVersion,
      },
    });
  } catch (error) {
    console.error('[GET /api/v2/live-analysis] Error:', error);
    return NextResponse.json(
      { error: 'Live analysis failed', detail: String(error) },
      { status: 500 }
    );
  }
}

// ==================== CHANGE DETECTION ====================

interface AnalysisChange {
  type: 'upgrade' | 'downgrade' | 'new_buy' | 'new_sell' | 'price_alert';
  ticker: string;
  nameAr: string;
  previous?: string;
  current: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  messageAr: string;
}

function detectChanges(result: RecommendResponse): AnalysisChange[] {
  const changes: AnalysisChange[] = [];
  const { stocks, market } = result;

  // Detect significant price changes (> 2% move)
  for (const stock of stocks) {
    const priceChange = stock.previousClose > 0
      ? ((stock.currentPrice - stock.previousClose) / stock.previousClose) * 100
      : 0;

    if (Math.abs(priceChange) > 2) {
      const isUp = priceChange > 0;
      changes.push({
        type: 'price_alert',
        ticker: stock.ticker,
        nameAr: stock.nameAr,
        current: stock.recommendation,
        severity: Math.abs(priceChange) > 5 ? 'high' : 'medium',
        message: `${stock.ticker} ${isUp ? 'surged' : 'dropped'} ${Math.abs(priceChange).toFixed(1)}%`,
        messageAr: `${stock.nameAr} (${stock.ticker}) ${isUp ? 'ارتفع' : 'انخفض'} ${Math.abs(priceChange).toFixed(1)}%`,
      });
    }
  }

  // Detect new strong buy signals
  const strongBuys = stocks.filter(s => s.recommendation === 'Strong Buy');
  for (const sb of strongBuys.slice(0, 3)) {
    changes.push({
      type: 'new_buy',
      ticker: sb.ticker,
      nameAr: sb.nameAr,
      current: 'Strong Buy',
      severity: 'high',
      message: `${sb.ticker} triggered Strong Buy (score: ${sb.compositeScore})`,
      messageAr: `${sb.nameAr} (${sb.ticker}) - إشارة شراء قوي (درجة: ${sb.compositeScore})`,
    });
  }

  // Detect new avoid signals with high confidence
  const strongAvoids = stocks.filter(s => 
    (s.recommendation === 'Strong Avoid' || s.recommendation === 'Avoid') && s.confidence > 60
  );
  for (const sa of strongAvoids.slice(0, 2)) {
    changes.push({
      type: 'new_sell',
      ticker: sa.ticker,
      nameAr: sa.nameAr,
      current: sa.recommendation,
      severity: sa.recommendation === 'Strong Avoid' ? 'high' : 'medium',
      message: `${sa.ticker} flagged as ${sa.recommendation} (confidence: ${sa.confidence}%)`,
      messageAr: `${sa.nameAr} (${sa.ticker}) - إشارة ${sa.recommendationAr} (ثقة: ${sa.confidence}%)`,
    });
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  changes.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

  return changes.slice(0, 10);
}

// ==================== AI COMMENTARY ====================

async function generateAICommentary(
  result: RecommendResponse,
  changes: AnalysisChange[]
): Promise<string> {
  // Dynamically import z-ai-web-dev-sdk
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  const zai = await ZAI.create();

  const { market, stocks } = result;
  const recs = market.recommendations;
  const totalStocks = stocks.length;
  
  // Build context for AI
  const topBuys = stocks
    .filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy')
    .slice(0, 5)
    .map(s => `${s.ticker} (${s.nameAr}) - ${s.recommendationAr} - سعر ${s.currentPrice.toFixed(2)} ج.م - القيمة العادلة ${s.fairValue.averageFairValue.toFixed(2)} ج.م - إمكانية نمو ${s.fairValue.upsidePotential.toFixed(1)}%`);

  const topAvoids = stocks
    .filter(s => s.recommendation === 'Strong Avoid' || s.recommendation === 'Avoid')
    .slice(0, 3)
    .map(s => `${s.ticker} (${s.nameAr}) - ${s.recommendationAr} - ${s.riskAssessment.levelAr}`);

  const changeSummary = changes.length > 0
    ? changes.slice(0, 5).map(c => `- ${c.messageAr}`).join('\n')
    : 'لا توجد تحركات كبيرة في هذا التحليل.';

  const prompt = `أنت محلل مالي متخصص في البورصة المصرية (EGX). قم بتحليل البيانات التالية وقدم تقريراً مختصراً بالعربية (3-4 فقرات) يتضمن:

1. ملخص حالة السوق الحالية وإشارات التحليلات
2. أبرز الفرص والمخاطر
3. تحليلات عملية للمستثمر

**بيانات التحليل:**
- نظام السوق: ${market.regime === 'bull' ? 'صاعد' : market.regime === 'bear' ? 'هابط' : 'محايد'} (مضاعف: ${market.regimeMultiplier.toFixed(2)}x)
- إجمالي الأسهم المحللة: ${totalStocks} | اجتازت الأمان: ${market.passedSafetyFilter}
- التحليلات: شراء قوي ${recs.strongBuy} | شراء ${recs.buy} | احتفاظ ${recs.hold} | تجنب ${recs.avoid} | تجنب قوي ${recs.strongAvoid}
- نسبة الاحتفاظ بالنقد المقترحة: ${market.fearCashPercent.toFixed(0)}%

**أفضل فرص الشراء:**
${topBuys.join('\n') || 'لا توجد فرص شراء قوية في الوقت الحالي'}

**تحذيرات مهمة:**
${topAvoids.join('\n') || 'لا توجد تحذيرات عالية'}

**أحدث التحركات:**
${changeSummary}

**تنبيهات التنويع:**
${market.diversificationIssues.length > 0 ? market.diversificationIssues.join(' | ') : 'لا توجد تنبيهات'}

اكتب التقرير بالعربية بشكل مختصر ومهني. استخدم أرقاماً محددة. أضف تحذيراً في النهاية أن هذا تحليل آلي لأغراض تعليمية وليس نصيحة استثمارية.`;

  const response = await zai.functions.invoke('llm', {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: 'أنت محلل مالي متخصص في البورصة المصرية. اكتب تقارير مختصرة ومهنية بالعربية. لا تستخدم markdown.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 600,
  });

  const commentary = response?.choices?.[0]?.message?.content || '';
  
  if (!commentary) {
    throw new Error('Empty AI response');
  }

  return commentary;
}

function generateFallbackCommentary(
  result: RecommendResponse,
  changes: AnalysisChange[]
): string {
  const { market, stocks } = result;
  const recs = market.recommendations;
  const total = stocks.length;
  const buyPct = total > 0 ? (((recs.strongBuy + recs.buy) / total) * 100).toFixed(1) : '0';
  const sellPct = total > 0 ? (((recs.avoid + recs.strongAvoid) / total) * 100).toFixed(1) : '0';

  const regimeAr = market.regime === 'bull' ? 'صاعد' : market.regime === 'bear' ? 'هابط' : 'محايد';

  let commentary = `تحليل البورصة المصرية (${new Date().toLocaleDateString('ar-EG')})\n\n`;
  commentary += `السوق في وضع ${regimeAr} مع مضاعف ${market.regimeMultiplier.toFixed(2)}x. `;
  commentary += `من إجمالي ${total} سهم محلل، اجتاز ${market.passedSafetyFilter} فلتر الأمان المالي.\n\n`;

  if (Number(buyPct) > 30) {
    commentary += `يظهر التحليل إشارات إيجابية مع ${buyPct}% من الأسهم في منطقة الشراء. `;
  } else if (Number(sellPct) > 40) {
    commentary += `السوق يظهر ضغطاً بيعياً مع ${sellPct}% من الأسهم في منطقة التجنب. `;
  } else {
    commentary += `السوق متوازن نسبياً مع توزيع متنوع بين التحليلات. `;
  }

  commentary += `نسبة الاحتفاظ بالنقد المقترحة ${market.fearCashPercent.toFixed(0)}%. `;

  if (changes.length > 0) {
    commentary += `\n\nأبرز التحركات: ${changes.slice(0, 3).map(c => c.messageAr).join(' | ')}`;
  }

  if (market.diversificationIssues.length > 0) {
    commentary += `\n\nتنبيهات: ${market.diversificationIssues.slice(0, 2).join(' | ')}`;
  }

  commentary += '\n\n⚠️ هذا تحليل آلي لأغراض تعليمية وليس توصية استثمارية.';

  return commentary;
}

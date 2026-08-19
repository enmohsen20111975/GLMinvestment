/**
 * Memory Engine - محرك الذاكرة للـ AI
 * 
 * 3 جداول SQLite:
 * 1. MemoryConversation - كل محادثة
 * 2. MemoryDecision - كل قرار تقني
 * 3. MemoryMetric - الأرقام المهمة
 * 
 * الفائدة: أي AI جديد يقدر يقرأ الذاكرة ويكمل من وقفنا
 */

import { db } from '@/lib/db';

export interface ConversationMemory {
  id?: string;
  question: string;
  answer: string;
  page_context?: string;
  market?: string;
  model_used?: string;
}

export interface DecisionMemory {
  decision_type: string;
  decision: string;
  reasoning?: string;
  indicators?: Record<string, any>;
  news_context?: string;
}

export interface MetricMemory {
  metric_type: string;
  metric_name: string;
  value_float?: number;
  value_int?: number;
  value_string?: string;
  symbol?: string;
  market?: string;
  period?: string;
  source?: string;
}

class MemoryEngine {
  /**
   * سجل محادثة جديدة
   */
  async logConversation(conv: ConversationMemory): Promise<string> {
    const record = await db.memoryConversation.create({
      data: {
        question: conv.question,
        answer: conv.answer,
        page_context: conv.page_context,
        market: conv.market,
        model_used: conv.model_used
      }
    });

    return record.id;
  }

  /**
   * ابحث في المحادثات السابقة
   */
  async searchConversations(query: string, limit: number = 5): Promise<ConversationMemory[]> {
    const results = await db.memoryConversation.findMany({
      where: {
        OR: [
          { question: { contains: query } },
          { answer: { contains: query } }
        ]
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });

    return results.map(r => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      page_context: r.page_context || undefined,
      market: r.market || undefined,
      model_used: r.model_used || undefined
    }));
  }

  /**
   * سجل قرار تقني
   */
  async logDecision(dec: DecisionMemory): Promise<string> {
    const record = await db.memoryDecision.create({
      data: {
        decision_type: dec.decision_type,
        decision: dec.decision,
        reasoning: dec.reasoning,
        indicators: dec.indicators ? JSON.stringify(dec.indicators) : null,
        news_context: dec.news_context
      }
    });

    return record.id;
  }

  /**
   * حدث نتيجة القرار
   */
  async updateDecisionOutcome(decisionId: string, outcome: string, lessons?: string): Promise<void> {
    await db.memoryDecision.update({
      where: { id: decisionId },
      data: {
        outcome,
        lessons_learned: lessons,
        verified_at: new Date()
      }
    });
  }

  /**
   * احصل على قرارات سابقة
   */
  async getDecisions(type?: string, limit: number = 10): Promise<DecisionMemory[]> {
    const results = await db.memoryDecision.findMany({
      where: type ? { decision_type: type } : undefined,
      orderBy: { created_at: 'desc' },
      take: limit
    });

    return results.map(r => ({
      decision_type: r.decision_type,
      decision: r.decision,
      reasoning: r.reasoning || undefined,
      indicators: r.indicators ? JSON.parse(r.indicators) : undefined,
      news_context: r.news_context || undefined
    }));
  }

  /**
   * سجل رقم مهم
   */
  async logMetric(metric: MetricMemory): Promise<void> {
    await db.memoryMetric.upsert({
      where: {
        metric_type_metric_name_period: {
          metric_type: metric.metric_type,
          metric_name: metric.metric_name,
          period: metric.period || 'all_time'
        }
      },
      create: {
        metric_type: metric.metric_type,
        metric_name: metric.metric_name,
        value_float: metric.value_float,
        value_int: metric.value_int,
        value_string: metric.value_string,
        symbol: metric.symbol,
        market: metric.market,
        period: metric.period || 'all_time',
        source: metric.source
      },
      update: {
        value_float: metric.value_float,
        value_int: metric.value_int,
        value_string: metric.value_string,
        source: metric.source
      }
    });
  }

  /**
   * احصل على رقم مهم
   */
  async getMetric(metricType: string, metricName: string, period?: string): Promise<MetricMemory | null> {
    const result = await db.memoryMetric.findUnique({
      where: {
        metric_type_metric_name_period: {
          metric_type: metricType,
          metric_name: metricName,
          period: period || 'all_time'
        }
      }
    });

    if (!result) return null;

    return {
      metric_type: result.metric_type,
      metric_name: result.metric_name,
      value_float: result.value_float || undefined,
      value_int: result.value_int || undefined,
      value_string: result.value_string || undefined,
      symbol: result.symbol || undefined,
      market: result.market || undefined,
      period: result.period || undefined,
      source: result.source || undefined
    };
  }

  /**
   * احصل على سياق للمحادثة
   * هذا هو الـ context اللي يتبعت لـ AI
   */
  async getContextForQuery(query: string): Promise<string> {
    const contexts: string[] = [];

    // 1. ابحث عن محادثات مشابهة
    const similarConvs = await this.searchConversations(query, 3);
    if (similarConvs.length > 0) {
      contexts.push('محادثات سابقة مشابهة:');
      similarConvs.forEach((c, i) => {
        contexts.push(`${i + 1}. سؤال: ${c.question}`);
        contexts.push(`   جواب: ${c.answer?.substring(0, 200)}...`);
      });
    }

    // 2. احصل على قرارات سابقة
    const decisions = await this.getDecisions('signal', 3);
    if (decisions.length > 0) {
      contexts.push('\nإشارات سابقة:');
      decisions.forEach((d, i) => {
        contexts.push(`${i + 1}. ${d.decision} - ${d.outcome || 'قيد المتابعة'}`);
        if (d.reasoning) contexts.push(`   السبب: ${d.reasoning}`);
      });
    }

    // 3. احصل على نسبة الدقة
    const accuracy = await this.getMetric('signal_accuracy', 'overall');
    if (accuracy && accuracy.value_float) {
      contexts.push(`\nنسبة دقة الإشارات: ${accuracy.value_float.toFixed(1)}%`);
    }

    return contexts.length > 0 ? contexts.join('\n') : '';
  }

  /**
   * احصل على ملخص الذاكرة
   */
  async getSummary(): Promise<{
    conversations: number;
    decisions: number;
    metrics: number;
    accuracy: number;
  }> {
    const [convs, decs, metrics] = await Promise.all([
      db.memoryConversation.count(),
      db.memoryDecision.count(),
      db.memoryMetric.count()
    ]);

    const accuracy = await this.getMetric('signal_accuracy', 'overall');

    return {
      conversations: convs,
      decisions: decs,
      metrics: metrics,
      accuracy: accuracy?.value_float || 0
    };
  }
}

// Export singleton
export const memory = new MemoryEngine();
export default memory;

'use client';

/**
 * MathRenderer
 * ============
 * مكوّن لعرض المعادلات الرياضية بشكل احترافي باستخدام KaTeX.
 *
 * الاستخدام:
 * <MathRenderer expression="RSI = 100 - \frac{100}{1 + RS}" />
 * <MathRenderer block expression="\text{EMA}_t = \alpha \cdot P_t + (1-\alpha) \cdot \text{EMA}_{t-1}" />
 * <MathRenderer text="السعر الحالي: $P_t$ والهدف: $T$" />
 *
 * يدعم 3 أوضاع:
 * 1. Inline math: $...$ داخل نص عادي
 * 2. Block math: $$...$$ في سطر منفصل
 * 3. Direct expression: معادلة واحدة مباشرة
 */

import React from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import 'katex/dist/katex.min.css';

interface MathRendererProps {
 /** المعادلة مباشرة (بدون $) */
 expression?: string;
 /** نص فيه معادلات مدمجة بـ $...$ أو $$...$$ */
 text?: string;
 /** عرض كـ block (سطر منفصل) بدلاً من inline */
 block?: boolean;
 /** className إضافي */
 className?: string;
}

/**
 * عرض معادلة واحدة مباشرة
 */
export function MathExpression({ expression, block = false }: { expression: string; block?: boolean }) {
 try {
 if (block) {
 return <BlockMath math={expression} />;
 }
 return <InlineMath math={expression} />;
 } catch (e) {
 // لو فيه خطأ في المعادلة، اعرضها كنص عادي
 return <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{expression}</code>;
 }
}

/**
 * عرض نص فيه معادلات مدمجة
 * يدعم: $inline$ و $$block$$
 */
export function MathText({ text, className = '' }: { text: string; className?: string }) {
 // تقسيم النص على $$...$$ و $...$
 const parts: Array<{ type: 'text' | 'inline' | 'block'; content: string }> = [];

 // الأول: $$...$$ (block)
 const blockParts = text.split(/\$\$(.+?)\$\$/gs);
 for (let i = 0; i < blockParts.length; i++) {
 if (i % 2 === 0) {
 // نص عادي - ممكن فيه $...$ inline
 const inlineParts = blockParts[i].split(/\$(.+?)\$/gs);
 for (let j = 0; j < inlineParts.length; j++) {
 if (j % 2 === 0) {
 if (inlineParts[j]) {
 parts.push({ type: 'text', content: inlineParts[j] });
 }
 } else {
 parts.push({ type: 'inline', content: inlineParts[j] });
 }
 }
 } else {
 parts.push({ type: 'block', content: blockParts[i] });
 }
 }

 return (
 <span className={className}>
 {parts.map((part, idx) => {
 if (part.type === 'block') {
 return (
 <div key={idx} className="my-3 overflow-x-auto">
 <MathExpression expression={part.content} block />
 </div>
 );
 }
 if (part.type === 'inline') {
 return <MathExpression key={idx} expression={part.content} />;
 }
 return <React.Fragment key={idx}>{part.content}</React.Fragment>;
 })}
 </span>
 );
}

/**
 * المكوّن الرئيسي - يدعم 3 أوضاع
 */
export function MathRenderer({ expression, text, block = false, className = '' }: MathRendererProps) {
 if (expression) {
 return (
 <span className={className}>
 <MathExpression expression={expression} block={block} />
 </span>
 );
 }

 if (text) {
 return <MathText text={text} className={className} />;
 }

 return null;
}

/**
 * مكوّن جاهز للمعادلات المالية الشائعة
 */
export function FinancialFormula({ name }: { name: string }) {
 const formulas: Record<string, string> = {
 rsi: 'RSI = 100 - \\frac{100}{1 + RS}',
 rs: 'RS = \\frac{\\text{متوسط المكاسب}}{\\text{متوسط الخسائر}}',
 ema: '\\text{EMA}_t = \\alpha \\cdot P_t + (1-\\alpha) \\cdot \\text{EMA}_{t-1}',
 alpha: '\\alpha = \\frac{2}{N + 1}',
 sma: '\\text{SMA} = \\frac{P_1 + P_2 + \\cdots + P_n}{n} = \\frac{1}{n}\\sum_{i=1}^{n} P_i',
 macd: '\\text{MACD} = \\text{EMA}_{12} - \\text{EMA}_{26}',
 macd_signal: '\\text{Signal} = \\text{EMA}_9(\\text{MACD})',
 bollinger_upper: '\\text{Upper} = \\text{SMA}_{20} + 2\\sigma',
 bollinger_lower: '\\text{Lower} = \\text{SMA}_{20} - 2\\sigma',
 bollinger_width: '\\text{Width} = \\text{Upper} - \\text{Lower} = 4\\sigma',
 std_dev: '\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(P_i - \\text{SMA})^2}',
 pe_ratio: '\\text{P/E} = \\frac{\\text{سعر السهم}}{\\text{ربحية السهم (EPS)}}',
 pb_ratio: '\\text{P/B} = \\frac{\\text{سعر السهم}}{\\text{قيمة السهم الدفترية}}',
 roe: '\\text{ROE} = \\frac{\\text{صافي الربح}}{\\text{حقوق المساهمين}} \\times 100\\%',
 profit_margin: '\\text{هامش الربح} = \\frac{\\text{صافي الربح}}{\\text{الإيرادات}} \\times 100\\%',
 dividend_yield: '\\text{عائد التوزيع} = \\frac{\\text{التوزيع السنوي}}{\\text{سعر السهم}} \\times 100\\%',
 risk_reward: '\\text{R/R} = \\frac{\\text{الربح المتوقع}}{\\text{المخاطرة}} = \\frac{T - E}{E - S}',
 position_size: '\\text{حجم المركز} = \\frac{\\text{رأس المال} \\times \\text{نسبة المخاطرة\\%}}{\\text{المخاطرة لكل سهم}}',
 fibonacci: '\\text{المستويات} = 0,\\ 0.236,\\ 0.382,\\ 0.5,\\ 0.618,\\ 0.786,\\ 1.0',
 sharpe_ratio: '\\text{Sharpe} = \\frac{R_p - R_f}{\\sigma_p}',
 compound_return: 'R = \\left(1 + r_1\\right)\\left(1 + r_2\\right)\\cdots\\left(1 + r_n\\right) - 1',
 volatility: '\\sigma_{\\text{سنوي}} = \\sigma_{\\text{يومي}} \\times \\sqrt{252}',
 };

 const formula = formulas[name.toLowerCase().replace(/[\s-]/g, '_')];

 if (!formula) {
 return null;
 }

 return (
 <div className="my-3 p-4 bg-muted/50 rounded-lg border border-border overflow-x-auto">
 <MathExpression expression={formula} block />
 </div>
 );
}

export default MathRenderer;

import { FVGChart, OrderBlockChart, LiquiditySweepChart, MSSChart } from './smc-charts';
import {
  HeadShouldersChart,
  TrianglesChart,
  RSIDivergenceChart,
  MACDChart,
  BollingerChart,
} from './ta-charts';
import { PERatioChart, PBRatioChart, DividendYieldChart, GrahamNumberChart } from './fa-charts';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * StrategyChart dispatcher — renders the right chart for each topic.
 * ============================================================ */

export function StrategyChart({ topicId }: { topicId: string }) {
  switch (topicId) {
    case 'fvg':
      return <FVGChart />;
    case 'order-block':
      return <OrderBlockChart />;
    case 'liquidity-sweep':
      return <LiquiditySweepChart />;
    case 'mss':
      return <MSSChart />;
    case 'head-shoulders':
      return <HeadShouldersChart />;
    case 'triangles':
      return <TrianglesChart />;
    case 'rsi-divergence':
      return <RSIDivergenceChart />;
    case 'macd-crossover':
      return <MACDChart />;
    case 'bollinger-squeeze':
      return <BollingerChart />;
    case 'pe-ratio':
      return <PERatioChart />;
    case 'pb-ratio':
      return <PBRatioChart />;
    case 'dividend-yield':
      return <DividendYieldChart />;
    case 'graham-number':
      return <GrahamNumberChart />;
    default:
      return <FVGChart />;
  }
}

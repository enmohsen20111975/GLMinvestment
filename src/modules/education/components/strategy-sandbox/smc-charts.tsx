import { CandleChart, AnimatedG, Label, Arrow } from './chart-primitives';
import { generateSyntheticCandles } from './helpers';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * SMC / ICT chart components (FVG, Order Block, Liquidity Sweep, MSS).
 * ============================================================ */

export function FVGChart() {
  const candles = generateSyntheticCandles('fvg');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        // FVG: gap between candle[5].high and candle[7].low
        const gapLeft = xOf(5) - bodyW / 2;
        const gapRight = xOf(7) + bodyW / 2;
        const gapTop = yOf(candles[5].h);
        const gapBot = yOf(candles[7].l);
        return (
          <>
            <AnimatedG delay={0.1}>
              <rect
                x={gapLeft}
                y={gapTop}
                width={gapRight - gapLeft}
                height={gapBot - gapTop}
                fill="#3b82f6"
                opacity={0.18}
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Label
                x={(gapLeft + gapRight) / 2}
                y={(gapTop + gapBot) / 2 + 4}
                text="FVG"
                color="#3b82f6"
                size={13}
              />
            </AnimatedG>
            <AnimatedG delay={0.45}>
              <Arrow
                from={{ x: xOf(11), y: yOf(candles[12].l) + 22 }}
                to={{ x: xOf(11), y: (gapTop + gapBot) / 2 }}
                color="#f59e0b"
              />
              <Label
                x={xOf(11)}
                y={yOf(candles[12].l) + 34}
                text="عودة لملء الفجوة"
                color="#f59e0b"
                size={10}
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(13), y: (gapTop + gapBot) / 2 }}
                to={{ x: xOf(18), y: yOf(candles[18].c) - 14 }}
                color="#10b981"
              />
              <Label x={xOf(20)} y={yOf(candles[18].c) - 18} text="ارتداد صاعد" color="#10b981" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

export function OrderBlockChart() {
  const candles = generateSyntheticCandles('orderBlock');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        const obCandle = candles[4];
        const obLeft = xOf(4) - bodyW / 2;
        const obRight = xOf(4) + bodyW / 2;
        const obTop = yOf(obCandle.h);
        const obBot = yOf(obCandle.l);
        return (
          <>
            <AnimatedG delay={0.1}>
              <rect
                x={obLeft - 2}
                y={obTop}
                width={obRight - obLeft + 4}
                height={obBot - obTop}
                fill="#ef4444"
                opacity={0.18}
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Label x={xOf(4)} y={obTop - 4} text="OB" color="#ef4444" size={12} />
            </AnimatedG>
            <AnimatedG delay={0.4}>
              <Arrow
                from={{ x: xOf(5), y: yOf(candles[5].o) }}
                to={{ x: xOf(7), y: yOf(candles[7].c) }}
                color="#10b981"
              />
              <Label
                x={xOf(7) + 6}
                y={yOf(candles[7].c) - 4}
                text="اندفاع صاعد قوي"
                color="#10b981"
                size={10}
                anchor="start"
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(14), y: yOf(candles[14].l) + 22 }}
                to={{ x: xOf(15), y: (obTop + obBot) / 2 }}
                color="#f59e0b"
              />
              <Label
                x={xOf(15)}
                y={yOf(candles[14].l) + 34}
                text="اختبار OB"
                color="#f59e0b"
                size={10}
              />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

export function LiquiditySweepChart() {
  const candles = generateSyntheticCandles('liquiditySweep');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf, bodyW }) => {
        const peak1 = candles[3].h;
        const peak2 = candles[9].h;
        const sweepCandle = candles[15];
        const sweepLineY = yOf(Math.max(peak1, peak2));
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(2)}
                y1={sweepLineY}
                x2={xOf(18)}
                y2={sweepLineY}
                stroke="#a855f7"
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              <Label x={xOf(2) - 6} y={sweepLineY - 4} text="قمة سيولة" color="#a855f7" size={10} anchor="end" />
            </AnimatedG>
            <AnimatedG delay={0.4}>
              <Arrow
                from={{ x: xOf(14), y: yOf(candles[14].c) - 22 }}
                to={{ x: xOf(15), y: yOf(sweepCandle.h) + 4 }}
                color="#ef4444"
              />
              <Label
                x={xOf(15)}
                y={yOf(sweepCandle.h) - 6}
                text="سويب (جمع سيولة)"
                color="#ef4444"
                size={10}
              />
            </AnimatedG>
            <AnimatedG delay={0.7}>
              <Arrow
                from={{ x: xOf(16), y: yOf(candles[18].c) }}
                to={{ x: xOf(19), y: yOf(candles[19].c) + 10 }}
                color="#10b981"
              />
              <Label
                x={xOf(20)}
                y={yOf(candles[18].c) + 18}
                text="ارتداد هابط"
                color="#10b981"
                size={10}
              />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

export function MSSChart() {
  const candles = generateSyntheticCandles('mss');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf }) => {
        const low1 = candles[4].l;
        const low2 = candles[11].l;
        const low3 = candles[18].l;
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(4)}
                y1={yOf(low1)}
                x2={xOf(11)}
                y2={yOf(low2)}
                stroke="#3b82f6"
                strokeWidth={1.4}
                strokeDasharray="3 3"
              />
              <line
                x1={xOf(11)}
                y1={yOf(low2)}
                x2={xOf(18)}
                y2={yOf(low3)}
                stroke="#3b82f6"
                strokeWidth={1.4}
                strokeDasharray="3 3"
              />
              <Label x={xOf(4)} y={yOf(low1) + 14} text="قاع1" color="#3b82f6" size={9} />
              <Label x={xOf(11)} y={yOf(low2) + 14} text="قاع2 (أعلى)" color="#3b82f6" size={9} />
              <Label x={xOf(18)} y={yOf(low3) + 14} text="قاع3 (أعلى)" color="#3b82f6" size={9} />
            </AnimatedG>
            <AnimatedG delay={0.5}>
              <line
                x1={xOf(18)}
                y1={yOf(low3)}
                x2={xOf(23)}
                y2={yOf(low3)}
                stroke="#ef4444"
                strokeWidth={1.2}
                strokeDasharray="2 2"
              />
              <Arrow
                from={{ x: xOf(21), y: yOf(low3) - 20 }}
                to={{ x: xOf(22), y: yOf(candles[22].l) }}
                color="#ef4444"
              />
              <Label x={xOf(22)} y={yOf(low3) - 26} text="MSS: كسر القاع" color="#ef4444" size={11} />
            </AnimatedG>
            <AnimatedG delay={0.85}>
              <Arrow
                from={{ x: xOf(23), y: yOf(candles[23].o) }}
                to={{ x: xOf(25), y: yOf(candles[25].c) }}
                color="#ef4444"
              />
              <Label x={xOf(25)} y={yOf(candles[25].c) + 16} text="استمرار هابط" color="#ef4444" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

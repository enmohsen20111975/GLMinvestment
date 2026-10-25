import { motion } from 'framer-motion';
import { CandleChart, AnimatedG, Label, Arrow } from './chart-primitives';
import {
  generateSyntheticCandles,
  CHART_W,
  CHART_H,
  PAD,
  PLOT_W,
  PLOT_H,
} from './helpers';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Traditional TA chart components: Head&Shoulders, Triangles,
 * RSI Divergence, MACD Crossover, Bollinger Squeeze.
 * ============================================================ */

export function HeadShouldersChart() {
  const candles = generateSyntheticCandles('headShoulders');
  return (
    <CandleChart candles={candles}>
      {({ xOf, yOf }) => {
        const lsHigh = candles[5].h;
        const headHigh = candles[13].h;
        const rsHigh = candles[21].h;
        const necklineY = yOf(Math.min(candles[6].l, candles[14].l));
        return (
          <>
            <AnimatedG delay={0.1}>
              <line
                x1={xOf(2)}
                y1={necklineY}
                x2={xOf(25)}
                y2={necklineY}
                stroke="#f59e0b"
                strokeWidth={1.6}
                strokeDasharray="5 3"
              />
              <Label x={xOf(25) + 4} y={necklineY + 4} text="خط الرقبة" color="#f59e0b" size={10} anchor="start" />
            </AnimatedG>
            <AnimatedG delay={0.35}>
              <Arrow from={{ x: xOf(5), y: yOf(lsHigh) - 22 }} to={{ x: xOf(5), y: yOf(lsHigh) - 4 }} color="#3b82f6" />
              <Label x={xOf(5)} y={yOf(lsHigh) - 28} text="كتف أيسر" color="#3b82f6" size={10} />
            </AnimatedG>
            <AnimatedG delay={0.55}>
              <Arrow from={{ x: xOf(13), y: yOf(headHigh) - 22 }} to={{ x: xOf(13), y: yOf(headHigh) - 4 }} color="#a855f7" />
              <Label x={xOf(13)} y={yOf(headHigh) - 28} text="الرأس" color="#a855f7" size={11} />
            </AnimatedG>
            <AnimatedG delay={0.75}>
              <Arrow from={{ x: xOf(21), y: yOf(rsHigh) - 22 }} to={{ x: xOf(21), y: yOf(rsHigh) - 4 }} color="#3b82f6" />
              <Label x={xOf(21)} y={yOf(rsHigh) - 28} text="كتف أيمن" color="#3b82f6" size={10} />
            </AnimatedG>
            <AnimatedG delay={1.0}>
              <Arrow
                from={{ x: xOf(23), y: necklineY }}
                to={{ x: xOf(25), y: yOf(candles[25].c) }}
                color="#ef4444"
              />
              <Label x={xOf(25)} y={yOf(candles[25].c) + 14} text="كسر الرقبة" color="#ef4444" size={10} />
            </AnimatedG>
          </>
        );
      }}
    </CandleChart>
  );
}

export function TrianglesChart() {
  // Three small triangle SVGs side-by-side
  const W = 188;
  const H = 200;
  const pad = 14;

  const renderTriangle = (
    type: 'asc' | 'desc' | 'sym',
    color: string,
    label: string,
    breakoutUp: boolean,
  ) => {
    const top = pad;
    const bot = H - pad - 18;
    const left = pad + 8;
    const right = W - pad - 8;
    const midX = (left + right) / 2;

    let upperLine: [number, number][];
    let lowerLine: [number, number][];

    if (type === 'asc') {
      // top flat, bottom rising
      upperLine = [[left, top + 20], [right, top + 20]];
      lowerLine = [[left, bot], [right, top + 35]];
    } else if (type === 'desc') {
      // top falling, bottom flat
      upperLine = [[left, top + 20], [right, bot]];
      lowerLine = [[left, bot], [right, bot]];
    } else {
      // sym: top falling, bottom rising → apex at right
      upperLine = [[left, top + 15], [right, (top + bot) / 2]];
      lowerLine = [[left, bot], [right, (top + bot) / 2]];
    }

    const breakX = right;
    const breakY = breakoutUp ? (top + 20) - 18 : bot + 18;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* candles hint */}
        {Array.from({ length: 18 }).map((_, i) => {
          const cx = left + (i / 17) * (right - left);
          const isBull = i % 2 === 0;
          const cy = (top + bot) / 2 + Math.sin(i * 0.7) * 6;
          const ch = isBull ? 6 : -6;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy - ch}
              x2={cx}
              y2={cy + ch}
              stroke={isBull ? '#10b981' : '#ef4444'}
              strokeWidth={2}
              opacity={0.55}
            />
          );
        })}
        {/* trendlines */}
        <polyline
          points={upperLine.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
        <polyline
          points={lowerLine.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
        {/* apex dot */}
        <circle cx={right} cy={(top + bot) / 2} r={2.5} fill={color} />
        {/* breakout arrow */}
        <motion.g
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Arrow
            from={{ x: midX + 18, y: (top + bot) / 2 }}
            to={{ x: breakX + 6, y: breakoutUp ? top + 4 : bot - 4 }}
            color={breakoutUp ? '#10b981' : '#ef4444'}
          />
        </motion.g>
        <text x={midX} y={bot + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill={color}>
          {label}
        </text>
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('asc', '#10b981', 'مثلث صاعد', true)}
      </div>
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('desc', '#ef4444', 'مثلث هابط', false)}
      </div>
      <div className="rounded-lg border p-2 bg-muted/20">
        {renderTriangle('sym', '#a855f7', 'مثلث متماثل', true)}
      </div>
    </div>
  );
}

export function RSIDivergenceChart() {
  const candles = generateSyntheticCandles('rsiDiv');
  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs text-muted-foreground mb-1">شارت السعر (Price)</div>
        <CandleChart candles={candles}>
          {({ xOf, yOf }) => {
            const p1 = candles[6].h;
            const p2 = candles[18].h;
            return (
              <>
                <AnimatedG delay={0.2}>
                  <line
                    x1={xOf(6)}
                    y1={yOf(p1)}
                    x2={xOf(18)}
                    y2={yOf(p2)}
                    stroke="#ef4444"
                    strokeWidth={1.8}
                  />
                  <Label x={xOf(6)} y={yOf(p1) - 8} text="قمة 1" color="#ef4444" size={9} />
                  <Label x={xOf(18)} y={yOf(p2) - 8} text="قمة أعلى" color="#ef4444" size={9} />
                </AnimatedG>
              </>
            );
          }}
        </CandleChart>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">مؤشر RSI (14)</div>
        <RSIPane />
      </div>
    </div>
  );
}

function RSIPane() {
  // RSI line that diverges from price (lower high)
  const W = CHART_W;
  const H = 110;
  const padL = 44, padR = 14, padT = 8, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const N = 26;
  // RSI values (0-100)
  const rsi = Array.from({ length: N }, (_, i) => {
    if (i === 6) return 75; // first peak (high)
    if (i === 18) return 68; // second peak (lower) → divergence
    if (i < 6) return 55 + Math.sin(i * 0.6) * 5;
    if (i < 18) return 55 + Math.cos(i * 0.4) * 4;
    return 50 - (i - 18) * 2.5; // downtrend
  });
  const xOf = (i: number) => padL + (i / (N - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - (v / 100) * plotH;
  const pathD = rsi.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" dir="ltr">
      {/* 30/70 lines */}
      {[30, 50, 70].map((v) => (
        <g key={v}>
          <line
            x1={padL}
            y1={yOf(v)}
            x2={W - padR}
            y2={yOf(v)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text x={6} y={yOf(v) + 4} fontSize="9" className="fill-muted-foreground">{v}</text>
        </g>
      ))}
      {/* RSI line */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth={1.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* Divergence arrows */}
      <AnimatedG delay={1.0}>
        <line x1={xOf(6)} y1={yOf(75)} x2={xOf(18)} y2={yOf(68)} stroke="#ef4444" strokeWidth={1.6} />
        <Label x={xOf(6)} y={yOf(75) - 6} text="RSI قمة 1 (75)" color="#ef4444" size={9} anchor="middle" />
        <Label x={xOf(18)} y={yOf(68) - 6} text="RSI قمة أدنى (68)" color="#ef4444" size={9} anchor="middle" />
      </AnimatedG>
    </svg>
  );
}

export function MACDChart() {
  // MACD line + signal line + histogram
  const W = CHART_W;
  const H = CHART_H;
  const padL = 44, padR = 14, padT = 18, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const N = 30;
  const macd: number[] = [];
  const signal: number[] = [];
  for (let i = 0; i < N; i++) {
    const v = Math.sin(i * 0.35) * 2 + Math.cos(i * 0.18) * 1.2 + (i - 15) * 0.06;
    macd.push(+(v ?? 0).toFixed(2));
    const sig = i === 0 ? v : signal[i - 1] + (v - (signal[i - 1] ?? v)) * 0.25;
    signal.push(+(sig ?? 0).toFixed(2));
  }
  const allVals = [...macd, ...signal];
  const minV = Math.min(...allVals) - 0.5;
  const maxV = Math.max(...allVals) + 0.5;
  const xOf = (i: number) => padL + (i / (N - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;
  const macdPath = macd.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
  const sigPath = signal.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');

  // Find crossover index (macd crosses above signal)
  let crossIdx = -1;
  for (let i = 1; i < N; i++) {
    if (macd[i - 1] < signal[i - 1] && macd[i] >= signal[i]) {
      crossIdx = i;
      break;
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" dir="ltr">
      {/* zero line */}
      <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} stroke="currentColor" className="text-border" strokeWidth={1.2} />
      <text x={6} y={yOf(0) + 4} fontSize="10" className="fill-muted-foreground">0</text>
      {/* histogram */}
      {macd.map((v, i) => {
        const h = Math.abs(yOf(v) - yOf(0));
        const isPos = v >= 0;
        return (
          <rect
            key={i}
            x={xOf(i) - 3}
            y={isPos ? yOf(v) : yOf(0)}
            width={6}
            height={Math.max(0.5, h)}
            fill={isPos ? '#10b981' : '#ef4444'}
            opacity={0.5}
          />
        );
      })}
      {/* signal line */}
      <motion.path
        d={sigPath}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={1.6}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* macd line */}
      <motion.path
        d={macdPath}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.8}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      {/* crossover marker */}
      {crossIdx >= 0 && (
        <AnimatedG delay={1.4}>
          <circle cx={xOf(crossIdx)} cy={yOf(macd[crossIdx])} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} />
          <Arrow
            from={{ x: xOf(crossIdx), y: yOf(macd[crossIdx]) - 24 }}
            to={{ x: xOf(crossIdx), y: yOf(macd[crossIdx]) - 8 }}
            color="#10b981"
          />
          <Label x={xOf(crossIdx)} y={yOf(macd[crossIdx]) - 30} text="تقاطع شراء" color="#10b981" size={10} />
        </AnimatedG>
      )}
      {/* legend */}
      <g>
        <line x1={padL + 4} y1={padT + 6} x2={padL + 18} y2={padT + 6} stroke="#3b82f6" strokeWidth={2} />
        <text x={padL + 22} y={padT + 9} fontSize="10" className="fill-foreground">MACD</text>
        <line x1={padL + 70} y1={padT + 6} x2={padL + 84} y2={padT + 6} stroke="#f59e0b" strokeWidth={2} />
        <text x={padL + 88} y={padT + 9} fontSize="10" className="fill-foreground">Signal</text>
      </g>
    </svg>
  );
}

export function BollingerChart() {
  const candles = generateSyntheticCandles('bollinger');
  // Compute simple SMA(20) and bands
  const period = 20;
  const closes = candles.map((c) => c.c);
  const mid: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg;
  });
  // For visualization, widen bands more visibly
  const upper: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg + (i < 14 ? std * 0.6 + 0.3 : std * 2 + 1.5); // squeeze then expand
  });
  const lower: (number | null)[] = closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return avg - (i < 14 ? std * 0.6 + 0.3 : std * 2 + 1.5);
  });

  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  const allVals = [...lows, ...highs, ...(upper.filter(Boolean) as number[]), ...(lower.filter(Boolean) as number[])];
  const minP = Math.min(...allVals) - 1;
  const maxP = Math.max(...allVals) + 1;
  const slot = PLOT_W / candles.length;
  const xOf = (i: number) => PAD.left + i * slot + slot / 2;
  const yOf = (p: number) => PAD.top + PLOT_H - ((p - minP) / (maxP - minP)) * PLOT_H;

  const linePath = (arr: (number | null)[]) => {
    let d = '';
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      d += `${started ? 'L' : 'M'} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  // Squeeze zone shading
  const squeezeStart = xOf(0);
  const squeezeEnd = xOf(13);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" dir="ltr">
      {/* squeeze zone */}
      <rect
        x={squeezeStart}
        y={PAD.top}
        width={squeezeEnd - squeezeStart}
        height={PLOT_H}
        fill="#f59e0b"
        opacity={0.08}
      />
      <text x={(squeezeStart + squeezeEnd) / 2} y={PAD.top + 14} fontSize="11" fill="#f59e0b" textAnchor="middle" fontWeight="700">
        منطقة الانضغاط
      </text>

      {/* candles */}
      {candles.map((c, i) => {
        const isBull = c.c >= c.o;
        const color = isBull ? '#10b981' : '#ef4444';
        const x = xOf(i);
        const bodyW = Math.max(4, slot * 0.6);
        const bodyTop = yOf(Math.max(c.o, c.c));
        const bodyBot = yOf(Math.min(c.o, c.c));
        return (
          <g key={i}>
            <line x1={x} y1={yOf(c.h)} x2={x} y2={yOf(c.l)} stroke={color} strokeWidth={1.2} />
            <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={Math.max(1.5, bodyBot - bodyTop)} fill={color} />
          </g>
        );
      })}

      {/* Bollinger bands */}
      <motion.path
        d={linePath(upper)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />
      <motion.path
        d={linePath(mid)}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />
      <motion.path
        d={linePath(lower)}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={1.5}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.3 }}
      />

      {/* expansion arrow */}
      <AnimatedG delay={1.4}>
        <Arrow
          from={{ x: xOf(14), y: yOf(candles[14].o) - 10 }}
          to={{ x: xOf(18), y: yOf(candles[18].c) - 18 }}
          color="#10b981"
        />
        <Label x={xOf(20)} y={yOf(candles[18].c) - 22} text="انفجار صاعد" color="#10b981" size={10} anchor="start" />
      </AnimatedG>

      {/* legend */}
      <g>
        <line x1={PAD.left + 4} y1={PAD.top + 4} x2={PAD.left + 18} y2={PAD.top + 4} stroke="#3b82f6" strokeWidth={2} />
        <text x={PAD.left + 22} y={PAD.top + 7} fontSize="10" className="fill-foreground">الباندات</text>
      </g>
    </svg>
  );
}

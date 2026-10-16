'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Activity, ArrowLeft, Clock, Radio } from 'lucide-react';

/* ============================================================
   GLMinvestment · /admin/ops-dcs — DCS OPS CONTROL CENTER
   ------------------------------------------------------------
   Industrial SCADA / P&ID flow diagram (pure SVG, no
   reactflow). Same as the sandbox preview, wrapped for the
   admin panel. The iframe embed from AdminView.tsx points
   here (the back-link auto-hides when in an iframe). Polls
   /api/dcs/topology every 3s. Honest amber banner when
   ENGINE IDLE (Rule 27). Python calc brain (Rule 4/67b).
   ============================================================ */

// ────────────────────────────────────────────────────────────
// TYPES — topology contract (single source of truth)
// ────────────────────────────────────────────────────────────

interface TopologyMeta {
  title: string;
  snapshot_date: string;
  engine_state: 'IDLE' | 'RUNNING';
  engine_idle_since: string;
  live_flow_source: string;
  calc_brain: string;
  server_time: string;
}

type NodeState = 'running' | 'ok' | 'idle' | 'stopped' | 'unknown';
type NodeType = 'source' | 'db' | 'engine' | 'gate' | 'output' | 'job';
type EdgeKind = 'data' | 'control' | 'decision';

interface TopologyNode {
  id: string;
  label: string;
  type: NodeType;
  lane: number;
  x: number;
  y: number;
  state: NodeState;
  sub: string;
  last_run?: string;
}

interface TopologyEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  active: boolean;
  label?: string;
  dashed?: boolean;
}

interface Topology {
  meta: TopologyMeta;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  legend: {
    states: Record<string, string>;
    edges: Record<string, string>;
  };
}

// ────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────

const NODE_W = 170;
const NODE_H = 56;
const SVG_W = 1240;
const SVG_H = 620;
const POLL_MS = 3000;
const DOT_DUR_S = 2.2;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const STATE_COLORS: Record<NodeState, string> = {
  running: '#22c55e',
  ok: '#06b6d4',
  idle: '#475569',
  stopped: '#ef4444',
  unknown: '#f59e0b',
};

const TYPE_TAG_COLORS: Record<NodeType, string> = {
  source: '#06b6d4',
  db: '#22c55e',
  engine: '#f59e0b',
  gate: '#a855f7',
  output: '#06b6d4',
  job: '#64748b',
};

const EDGE_BASE_COLOR: Record<EdgeKind, string> = {
  data: '#06b6d4',
  control: '#f59e0b',
  decision: '#22c55e',
};

// ────────────────────────────────────────────────────────────
// HOOKS
// ────────────────────────────────────────────────────────────

function useEetClock(intervalMs = 1000): string {
  const [time, setTime] = useState('--:--:--');
  useEffect(() => {
    const tick = () => {
      const opts: Intl.DateTimeFormatOptions = {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };
      try {
        setTime(new Intl.DateTimeFormat('en-GB', opts).format(new Date()));
      } catch {
        setTime(new Date().toISOString().slice(11, 19));
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return time;
}

/** Detects whether the page is embedded in an iframe (auto-hides the
 *  back-link when it is, so the iframe tab inside AdminView doesn't
 *  show a redundant nav link). Uses useSyncExternalStore so the value
 *  is read post-hydration without triggering set-state-in-effect. */
const IFRAME_SUBSCRIBE = () => () => {};
const IFRAME_CLIENT_SNAPSHOT = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true; // cross-origin — treat as iframe
  }
};
const IFRAME_SERVER_SNAPSHOT = (): boolean => false;

function useInIframe(): boolean {
  return useSyncExternalStore(
    IFRAME_SUBSCRIBE,
    IFRAME_CLIENT_SNAPSHOT,
    IFRAME_SERVER_SNAPSHOT,
  );
}

interface PollState {
  topo: Topology | null;
  error: string | null;
  loading: boolean;
}

function useTopologyPolling(url: string): PollState {
  const [state, setState] = useState<PollState>({
    topo: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Topology;
        if (!aborted) {
          setState({ topo: json, error: null, loading: false });
        }
      } catch (e) {
        if (aborted || controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        }));
      } finally {
        if (!aborted) {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    poll();
    return () => {
      aborted = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url]);

  return state;
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

function edgeColor(edge: TopologyEdge): string {
  if (edge.kind === 'decision' && (edge.label ?? '').toUpperCase().startsWith('KILL')) {
    return '#ef4444';
  }
  return EDGE_BASE_COLOR[edge.kind];
}

function edgeOpacity(edge: TopologyEdge): number {
  if (!edge.active) return edge.kind === 'decision' ? 0.3 : 0.25;
  if (edge.kind === 'decision') return 0.9;
  if (edge.kind === 'control') return 0.8;
  return 0.9;
}

function computePath(from: TopologyNode, to: TopologyNode): string {
  const sx = from.x + NODE_W / 2;
  const sy = from.y + NODE_H / 2;
  const ex = to.x + NODE_W / 2;
  const ey = to.y + NODE_H / 2;
  const dx = ex - sx;
  const dy = ey - sy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const c = Math.min(80, Math.max(20, Math.abs(dx) * 0.5));
    return `M ${sx} ${sy} C ${sx + c} ${sy}, ${ex - c} ${ey}, ${ex} ${ey}`;
  }
  const c = Math.min(40, Math.max(15, Math.abs(dy) * 0.5));
  return `M ${sx} ${sy} C ${sx} ${sy + c}, ${ex} ${ey - c}, ${ex} ${ey}`;
}

function pathMidpoint(
  from: TopologyNode,
  to: TopologyNode,
): { mx: number; my: number } {
  const sx = from.x + NODE_W / 2;
  const sy = from.y + NODE_H / 2;
  const ex = to.x + NODE_W / 2;
  const ey = to.y + NODE_H / 2;
  return { mx: (sx + ex) / 2, my: (sy + ey) / 2 };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtServerTime(iso: string): string {
  const t = iso.slice(11, 19);
  return t ? `${t}Z` : iso;
}

// ────────────────────────────────────────────────────────────
// NODE
// ────────────────────────────────────────────────────────────

function Node({ node }: { node: TopologyNode }) {
  const color = STATE_COLORS[node.state];
  const isRunning = node.state === 'running';
  const isStopped = node.state === 'stopped';
  const isDcs = node.id === 'out_dcs';
  const tagColor = TYPE_TAG_COLORS[node.type];
  const subText = node.sub ?? '';
  const label = truncate(node.label, 22);
  const sub = truncate(subText, 24);

  return (
    <g transform={`translate(${node.x},${node.y})`} style={{ cursor: 'pointer' }}>
      {isDcs && (
        <>
          <rect
            x={-8}
            y={-8}
            width={NODE_W + 16}
            height={NODE_H + 16}
            rx={14}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={0.5}
          >
            <animate
              attributeName="opacity"
              values="0.25;0.85;0.25"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-width"
              values="1;2.6;1"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </rect>
          <text
            x={NODE_W + 6}
            y={-2}
            fill={color}
            fontSize={9}
            fontFamily={MONO}
            fontWeight={700}
          >
            ◀ YOU ARE HERE
          </text>
        </>
      )}

      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill="#13181f"
        stroke={color}
        strokeWidth={1.5}
      />

      <rect x={0} y={0} width={5} height={NODE_H} rx={2.5} fill={tagColor} opacity={0.9} />

      {isRunning && (
        <circle cx={14} cy={14} r={11} fill={color} opacity={0.18}>
          <animate
            attributeName="opacity"
            values="0.08;0.4;0.08"
            dur="1.2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      <circle cx={14} cy={14} r={5} fill={color}>
        {isRunning && (
          <animate
            attributeName="opacity"
            values="0.4;1;0.4"
            dur="1.2s"
            repeatCount="indefinite"
          />
        )}
      </circle>

      {isStopped && (
        <g transform={`translate(${NODE_W - 28},8)`}>
          <rect width={24} height={12} rx={2} fill="#ef4444" />
          <text
            x={12}
            y={9.5}
            fill="#0a0e14"
            fontSize={8}
            fontWeight={700}
            textAnchor="middle"
            fontFamily={MONO}
          >
            STOP
          </text>
        </g>
      )}

      <text x={26} y={20} fill="#e2e8f0" fontSize={11} fontWeight={600} fontFamily={MONO}>
        {label}
      </text>

      <text x={26} y={36} fill="#64748b" fontSize={10} fontFamily={MONO}>
        {sub}
      </text>

      {node.last_run && (
        <text x={26} y={50} fill="#475569" fontSize={8} fontFamily={MONO}>
          last_run: {node.last_run.slice(0, 10)}
        </text>
      )}

      <title>
        {`${node.label} | state=${node.state} | ${subText}${node.last_run ? ` | last_run=${node.last_run}` : ''}`}
      </title>
    </g>
  );
}

// ────────────────────────────────────────────────────────────
// EDGE
// ────────────────────────────────────────────────────────────

function Edge({
  edge,
  idx,
  from,
  to,
}: {
  edge: TopologyEdge;
  idx: number;
  from: TopologyNode;
  to: TopologyNode;
}) {
  const color = edgeColor(edge);
  const opacity = edgeOpacity(edge);
  const path = computePath(from, to);
  const pathId = `edge-${idx}`;
  const { mx, my } = pathMidpoint(from, to);
  const isDashed = edge.kind === 'control' || edge.dashed === true;
  const blocked = !edge.active && (from.state === 'stopped' || to.state === 'stopped');
  const labelText = edge.label ?? '';
  const labelWidth = labelText.length * 5.4 + 8;

  return (
    <g>
      <path
        id={pathId}
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={opacity}
        strokeDasharray={isDashed ? '6 4' : undefined}
        strokeLinecap="round"
      />

      {blocked && (
        <g transform={`translate(${mx},${my})`}>
          <circle r={7} fill="#0a0e14" stroke="#ef4444" strokeWidth={1} />
          <path
            d="M -3.5,-3.5 L 3.5,3.5 M 3.5,-3.5 L -3.5,3.5"
            stroke="#ef4444"
            strokeWidth={1.4}
            fill="none"
          />
        </g>
      )}

      {edge.active &&
        [0, 0.45, 0.9].map((offset, i) => (
          <circle key={i} r={3.2} fill={color} opacity={0.95}>
            <animateMotion
              dur={`${DOT_DUR_S}s`}
              begin={`${offset}s`}
              repeatCount="indefinite"
              rotate="auto"
            >
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        ))}

      {labelText && (
        <g transform={`translate(${mx},${my})`}>
          <rect
            x={-labelWidth / 2}
            y={-7}
            width={labelWidth}
            height={11}
            rx={2}
            fill="#0a0e14"
            opacity={0.92}
          />
          <text
            x={0}
            y={2}
            fill="#94a3b8"
            fontSize={9}
            textAnchor="middle"
            fontFamily={MONO}
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
}

// ────────────────────────────────────────────────────────────
// HEADER (admin)
// ────────────────────────────────────────────────────────────

function Header({
  meta,
  eet,
  showBackLink,
}: {
  meta: TopologyMeta | null;
  eet: string;
  showBackLink: boolean;
}) {
  const isIdle = meta?.engine_state === 'IDLE';

  return (
    <header className="border-b border-border bg-background px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {showBackLink && (
            <a
              href="/#admin"
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-emerald-500/60 hover:text-emerald-400"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Admin
            </a>
          )}
          <h1 className="font-mono text-base font-bold tracking-tight text-emerald-400 sm:text-lg">
            DCS Ops Control Center
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-400">
            <Radio className="h-3 w-3 animate-pulse" />
            LIVE
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            GLMinvestment · distributed control system · admin · no mock
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-slate-400">
            EET <span className="text-emerald-400">{eet}</span>
          </span>
          {meta && (
            <span className="text-slate-400">
              SRV <span className="text-cyan-400">{fmtServerTime(meta.server_time)}</span>
            </span>
          )}
        </div>
      </div>

      {meta ? (
        <>
          <div
            className={cn(
              'mt-2 font-mono text-[11px] leading-relaxed',
              isIdle ? 'text-amber-400' : 'text-slate-400',
            )}
          >
            SNAPSHOT <span className="text-foreground">{meta.snapshot_date}</span>
            {' · '}ENGINE{' '}
            <span
              className={cn(
                'font-bold',
                isIdle ? 'text-amber-400' : 'text-emerald-400',
              )}
            >
              {meta.engine_state}
            </span>
            {meta.engine_idle_since && (
              <>
                {' · '}IDLE SINCE{' '}
                <span className="text-amber-300">
                  {meta.engine_idle_since.slice(0, 10)}
                </span>
              </>
            )}
            {' · '}LIVE FLOW:{' '}
            <span className="text-cyan-400">{meta.live_flow_source}</span>
            {' · '}CALC BRAIN:{' '}
            <span className="text-emerald-400">{meta.calc_brain}</span>
          </div>
          {isIdle && (
            <div className="mt-1 font-mono text-[10px] leading-relaxed text-amber-500/80">
              ⚠ most flows are QUIET (no animated dots) — engine offline since{' '}
              {meta.engine_idle_since.slice(0, 10)}. Only DB → API → DCS polling
              shows live data flow.
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 font-mono text-[11px] text-slate-600">
          loading topology snapshot…
        </div>
      )}
    </header>
  );
}

// ────────────────────────────────────────────────────────────
// LEGEND
// ────────────────────────────────────────────────────────────

function Legend() {
  const states: { key: NodeState; label: string; color: string }[] = [
    { key: 'running', label: 'working now (animated)', color: '#22c55e' },
    { key: 'ok', label: 'available / healthy', color: '#06b6d4' },
    { key: 'idle', label: 'present but inactive', color: '#475569' },
    { key: 'stopped', label: 'halted', color: '#ef4444' },
    { key: 'unknown', label: 'no live telemetry', color: '#f59e0b' },
  ];
  const edges: { label: string; color: string; dashed?: boolean }[] = [
    { label: 'data transport (cyan)', color: '#06b6d4' },
    { label: 'control / schedule (amber dashed)', color: '#f59e0b', dashed: true },
    { label: 'decision PASS (green)', color: '#22c55e' },
    { label: 'decision KILL (red)', color: '#ef4444' },
  ];

  return (
    <div className="border-t border-border bg-background px-4 py-3 font-mono text-[11px]">
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
        <div>
          <div className="mb-1 text-muted-foreground">NODE STATES</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {states.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-300">{s.key}</span>
                <span className="text-slate-600">— {s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-muted-foreground">EDGE TYPES</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {edges.map((e) => (
              <div key={e.label} className="flex items-center gap-1.5">
                <svg width="22" height="6" aria-hidden="true">
                  <line
                    x1={0}
                    y1={3}
                    x2={22}
                    y2={3}
                    stroke={e.color}
                    strokeWidth={2}
                    strokeDasharray={e.dashed ? '4 2' : undefined}
                  />
                </svg>
                <span className="text-slate-300">{e.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-muted-foreground lg:ml-auto">
          animated dots = live data flow · still line = inactive / stopped · red X = blocked pipe
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// FOOTER
// ────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background px-4 py-3 font-mono text-[10px] tracking-wide text-muted-foreground">
      BRAVO 2 · PYTHON CALC BRAIN (RULE 4/67B) · REAL PRODUCTION DATA (RULE 27) · NO MOCK · LIVE TOPOLOGY
    </footer>
  );
}

// ────────────────────────────────────────────────────────────
// TOPOLOGY DIAGRAM (pure SVG)
// ────────────────────────────────────────────────────────────

function TopologyDiagram({ topo }: { topo: Topology }) {
  const nodeMap = useMemo(() => {
    const m = new Map<string, TopologyNode>();
    for (const n of topo.nodes) m.set(n.id, n);
    return m;
  }, [topo.nodes]);

  const laneLabels: { x: number; y: number; label: string }[] = [
    { x: 175, y: 605, label: 'SOURCES' },
    { x: 415, y: 605, label: 'DATABASES' },
    { x: 685, y: 605, label: 'ENGINES' },
    { x: 945, y: 605, label: 'GATES' },
    { x: 1175, y: 605, label: 'OUTPUTS' },
  ];

  const activeCount = topo.edges.filter((e) => e.active).length;

  return (
    <div className="bg-background p-2 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>
          NODES <span className="text-slate-300">{topo.nodes.length}</span>
        </span>
        <span>
          EDGES <span className="text-slate-300">{topo.edges.length}</span>
        </span>
        <span>
          ACTIVE FLOWS <span className="text-emerald-400">{activeCount}</span>
          <span className="text-slate-600"> / {topo.edges.length}</span>
        </span>
        <span className="text-slate-600">
          (inactive edges shown as still / dimmed lines)
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          role="img"
          aria-label="GLMinvestment live system topology — factory SCADA flow diagram"
          style={{
            minWidth: 980,
            width: '100%',
            maxWidth: 1400,
            height: 'auto',
            display: 'block',
            margin: '0 auto',
            background: '#0a0e14',
          }}
        >
          <defs>
            <pattern
              id="topo-grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="#1e2937"
                strokeWidth="0.5"
                opacity="0.35"
              />
            </pattern>
          </defs>

          <rect width={SVG_W} height={SVG_H} fill="#0a0e14" />
          <rect width={SVG_W} height={SVG_H} fill="url(#topo-grid)" />

          <text
            x={475}
            y={15}
            fill="#475569"
            fontSize={10}
            textAnchor="middle"
            fontFamily={MONO}
            fontWeight={600}
          >
            ◤ JOBS BAND (scheduled)
          </text>
          {laneLabels.map((lane) => (
            <text
              key={lane.label}
              x={lane.x}
              y={lane.y}
              fill="#475569"
              fontSize={10}
              textAnchor="middle"
              fontFamily={MONO}
              fontWeight={600}
            >
              {lane.label}
            </text>
          ))}

          {topo.edges.map((e, i) => {
            const from = nodeMap.get(e.from);
            const to = nodeMap.get(e.to);
            if (!from || !to) return null;
            return <Edge key={`e-${i}`} edge={e} idx={i} from={from} to={to} />;
          })}

          {topo.nodes.map((n) => (
            <Node key={n.id} node={n} />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// PAGE
// ────────────────────────────────────────────────────────────

export default function OpsDcsPage() {
  const [topology, setTopology] = useState<any>(null);
  const [topoLoading, setTopoLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchTopology = async () => {
      try {
        const res = await fetch('/api/dcs/topology', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setTopology(json);
        }
      } catch { /* graceful */ }
      finally { if (!cancelled) setTopoLoading(false); }
    };
    fetchTopology();
    const interval = setInterval(fetchTopology, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const controlNode = async (node: string, action: string) => {
    try {
      await fetch(`/api/dcs/control/${node}/${action}`, { method: 'POST', cache: 'no-store' });
    } catch { /* graceful */ }
  };
  const { topo, error, loading } = useTopologyPolling('/api/dcs/topology');
  const eet = useEetClock();
  const inIframe = useInIframe();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header meta={topo?.meta ?? null} eet={eet} showBackLink={!inIframe} />

      <main className="flex-1">
        {loading && !topo && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
            <Activity className="h-6 w-6 animate-pulse text-emerald-500" />
            <div className="font-mono text-sm text-slate-400">BOOTING TOPOLOGY…</div>
            <Skeleton className="h-2 w-64" />
            <div className="font-mono text-[11px] text-slate-600">
              waiting for /api/dcs/topology
            </div>
          </div>
        )}

        {error && !topo && !loading && (
          <div className="m-4 border-2 border-amber-500/50 bg-amber-500/10 p-4 font-mono text-sm text-amber-300">
            ⚠ TOPOLOGY OFFLINE — {error}. Retrying every 3s…
          </div>
        )}

        {topo && <TopologyDiagram topo={topo} />}
      </main>

      <Legend />
      <Footer />
    </div>
  );
}

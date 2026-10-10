/**
 * Engine Control Store
 * ====================
 * Persistence layer for the Interactive Command Center's engine control
 * drawer. Stores per-engine state (active flag, weights, sensitivity,
 * threshold, last-triggered timestamp, recent log entries), a global
 * auto-regime flag, and a throughput counter.
 *
 * Backed by a single JSON file at `db/engine_control.json`. Writes are
 * atomic (write to `.tmp` then rename). Reads return a sensible default
 * shape if the file is missing or corrupted.
 */

import fs from 'fs';
import path from 'path';

// ============== Types ==============

export type EngineLogType = 'info' | 'success' | 'error' | 'warning';

export interface EngineLogEntry {
  timestamp: string; // ISO string
  message: string;
  type: EngineLogType;
}

export interface EngineState {
  active: boolean;
  weight: number; // 0..100
  sensitivity: number; // 0..1
  threshold: number; // 0..100
  lastTriggeredAt: string | null; // ISO string | null
  log: EngineLogEntry[];
}

export interface EngineControlState {
  engines: Record<string, EngineState>;
  autoRegime: boolean;
  throughput: {
    messagesPerMin: number;
    lastResetAt: string | null;
  };
}

export type RuntimeStatus = 'running' | 'paused' | 'idle' | 'error';

// ============== Constants ==============

const DB_DIR = path.join(process.cwd(), 'db');
const FILE_PATH = path.join(DB_DIR, 'engine_control.json');
const TMP_PATH = FILE_PATH + '.tmp';
const LOG_CAP = 10;

/** Canonical list of engine IDs managed by the command center. */
export const ENGINE_IDS = [
  'smc',
  'quant',
  'risk',
  'egx',
  'data',
  'telegram',
  'websocket',
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export function isKnownEngine(id: string): id is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(id);
}

// ============== Default state ==============

function defaultEngineState(
  weight: number,
  threshold: number,
): EngineState {
  return {
    active: true,
    weight,
    sensitivity: 0.5,
    threshold,
    lastTriggeredAt: null,
    log: [],
  };
}

export function defaultEngineControlState(): EngineControlState {
  return {
    engines: {
      smc: defaultEngineState(35, 70),
      quant: defaultEngineState(30, 65),
      risk: defaultEngineState(15, 75),
      egx: defaultEngineState(20, 80),
      data: defaultEngineState(100, 50),
      telegram: defaultEngineState(100, 50),
      websocket: defaultEngineState(100, 50),
    },
    autoRegime: true,
    throughput: { messagesPerMin: 0, lastResetAt: null },
  };
}

// ============== Core IO ==============

/**
 * Read the persisted engine control state. Returns the default shape if
 * the file is missing, empty, or fails to parse.
 */
export function readEngineControl(): EngineControlState {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      return defaultEngineControlState();
    }
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    if (!raw.trim()) return defaultEngineControlState();
    const parsed = JSON.parse(raw) as Partial<EngineControlState>;
    return mergeWithDefaults(parsed);
  } catch { // silent fallback (safe-by-design)
    return defaultEngineControlState();
  }
}

/**
 * Atomically write the engine control state to disk. Writes to a `.tmp`
 * file first then renames — guarantees readers never see a half-written
 * JSON.
 */
export function writeEngineControl(state: EngineControlState): void {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(TMP_PATH, json, 'utf-8');
    fs.renameSync(TMP_PATH, FILE_PATH);
  } catch (err) {
    // Best-effort cleanup of the temp file if rename failed.
    try {
      if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
    } catch { // silent fallback (safe-by-design)
      /* ignore */
    }
    throw err;
  }
}

// ============== Mutators ==============

/**
 * Append a log entry to the given engine. Caps the log at the last
 * `LOG_CAP` entries.
 */
export function appendEngineLog(
  engineId: string,
  message: string,
  type: EngineLogType,
): void {
  if (!isKnownEngine(engineId)) return;
  const state = readEngineControl();
  const engine = state.engines[engineId];
  if (!engine) return;
  const entry: EngineLogEntry = {
    timestamp: new Date().toISOString(),
    message,
    type,
  };
  engine.log = [...engine.log, entry].slice(-LOG_CAP);
  writeEngineControl(state);
}

/**
 * Toggle an engine's active flag.
 */
export function setEngineActive(engineId: string, active: boolean): void {
  if (!isKnownEngine(engineId)) return;
  const state = readEngineControl();
  const engine = state.engines[engineId];
  if (!engine) return;
  engine.active = active;
  writeEngineControl(state);
}

/**
 * Update an engine's tunable weight parameters. Only the supplied
 * fields are touched; the rest are left unchanged.
 */
export function setEngineWeights(
  engineId: string,
  params: Partial<Pick<EngineState, 'weight' | 'sensitivity' | 'threshold'>>,
): void {
  if (!isKnownEngine(engineId)) return;
  const state = readEngineControl();
  const engine = state.engines[engineId];
  if (!engine) return;
  if (typeof params.weight === 'number') engine.weight = params.weight;
  if (typeof params.sensitivity === 'number')
    engine.sensitivity = params.sensitivity;
  if (typeof params.threshold === 'number') engine.threshold = params.threshold;
  writeEngineControl(state);
}

/**
 * Mark an engine as triggered right now (sets `lastTriggeredAt`).
 */
export function markTriggered(engineId: string): void {
  if (!isKnownEngine(engineId)) return;
  const state = readEngineControl();
  const engine = state.engines[engineId];
  if (!engine) return;
  engine.lastTriggeredAt = new Date().toISOString();
  writeEngineControl(state);
}

/**
 * Increment the messages-per-minute throughput counter. Resets the
 * counter and stamps `lastResetAt` if more than a minute has elapsed
 * since the last reset — gives a rough live throughput figure.
 */
export function bumpThroughput(count: number): void {
  const state = readEngineControl();
  const now = Date.now();
  const lastReset = state.throughput.lastResetAt
    ? new Date(state.throughput.lastResetAt).getTime()
    : 0;
  if (now - lastReset > 60_000) {
    state.throughput.messagesPerMin = count;
    state.throughput.lastResetAt = new Date(now).toISOString();
  } else {
    state.throughput.messagesPerMin += count;
  }
  writeEngineControl(state);
}

// ============== Derived helpers ==============

/**
 * Compute the runtime status of an engine from its persisted state.
 * - `active === false` → 'paused'
 * - `active === true` and triggered within 5 minutes → 'running'
 * - otherwise → 'idle'
 */
export function runtimeStatusOf(engine: EngineState): RuntimeStatus {
  if (!engine.active) return 'paused';
  if (!engine.lastTriggeredAt) return 'idle';
  const ts = new Date(engine.lastTriggeredAt).getTime();
  if (Number.isNaN(ts)) return 'idle';
  return Date.now() - ts <= 5 * 60_000 ? 'running' : 'idle';
}

// ============== Internal ==============

/** Merge a partially-persisted state with defaults so callers always
 * get a fully-populated `EngineControlState`. Missing engines are
 * filled from the default state. */
function mergeWithDefaults(parsed: Partial<EngineControlState>): EngineControlState {
  const defaults = defaultEngineControlState();
  const engines: Record<string, EngineState> = { ...defaults.engines };
  if (parsed.engines && typeof parsed.engines === 'object') {
    for (const id of Object.keys(defaults.engines)) {
      const incoming = (parsed.engines as Record<string, unknown>)[id];
      if (incoming && typeof incoming === 'object') {
        const inc = incoming as Partial<EngineState>;
        engines[id] = {
          active: typeof inc.active === 'boolean' ? inc.active : true,
          weight: typeof inc.weight === 'number' ? inc.weight : defaults.engines[id].weight,
          sensitivity:
            typeof inc.sensitivity === 'number'
              ? inc.sensitivity
              : defaults.engines[id].sensitivity,
          threshold:
            typeof inc.threshold === 'number'
              ? inc.threshold
              : defaults.engines[id].threshold,
          lastTriggeredAt:
            typeof inc.lastTriggeredAt === 'string' || inc.lastTriggeredAt === null
              ? inc.lastTriggeredAt
              : null,
          log: Array.isArray(inc.log) ? (inc.log as EngineLogEntry[]).slice(-LOG_CAP) : [],
        };
      }
    }
  }
  const throughput = parsed.throughput && typeof parsed.throughput === 'object'
    ? {
        messagesPerMin:
          typeof parsed.throughput.messagesPerMin === 'number'
            ? parsed.throughput.messagesPerMin
            : 0,
        lastResetAt:
          typeof parsed.throughput.lastResetAt === 'string' || parsed.throughput.lastResetAt === null
            ? parsed.throughput.lastResetAt
            : null,
      }
    : { messagesPerMin: 0, lastResetAt: null };
  return {
    engines,
    autoRegime: typeof parsed.autoRegime === 'boolean' ? parsed.autoRegime : true,
    throughput,
  };
}

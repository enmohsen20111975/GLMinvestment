/**
 * Structured JSON Logger
 * ======================
 * P0 #15 fix (2026-09-27): Project had no structured logging before this.
 *
 * Why structured?
 * - Every log line is a single JSON object → trivially greppable + ingestible
 *   by any log aggregator (Loki, ELK, Datadog, CloudWatch, Sentry Logs).
 * - Includes timestamp + level + message + arbitrary context fields.
 * - Respects LOG_LEVEL env var (debug/info/warn/error).
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('user logged in', { userId: 42, ip: req.ip });
 *   logger.error('DB write failed', { ticker: 'COMI', err: e.message });
 *
 * Output (one JSON object per line on stdout/stderr):
 *   {"timestamp":"2026-09-27T14:30:00.000Z","level":"info","message":"user logged in","userId":42,"ip":"127.0.0.1"}
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Minimum level to emit. Reads from env on module load — change requires restart.
const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';

/**
 * Emit a structured log entry as a single JSON line.
 *
 * @param level   Severity
 * @param message Human-readable message (NOT interpolated — pass context as object)
 * @param context Arbitrary additional fields (serialized as top-level JSON keys)
 */
export function log(level: LogLevel, message: string, context?: LogContext): void {
  // Drop if below configured threshold
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const serialized = JSON.stringify(entry);

  // Route by severity so stderr/stdout are properly separated (12-factor).
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

/**
 * Convenience logger object — the typical import surface.
 *
 *   import { logger } from '@/lib/logger';
 *   logger.info('hi', { extra: 'data' });
 */
export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
};

export default logger;

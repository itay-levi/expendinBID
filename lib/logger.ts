// Minimal placeholder logger so stub/dev-only code paths don't reach for console.* directly.
// Swap for pino/winston (or whatever the deployment target standardizes on) before shipping —
// this exists only so "no console.log in production code" has somewhere legitimate to go for now.
/* eslint-disable no-console */
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => console.info(`[info] ${message}`, meta ?? ''),
  warn: (message: string, meta?: Record<string, unknown>) => console.warn(`[warn] ${message}`, meta ?? ''),
  error: (message: string, meta?: Record<string, unknown>) => console.error(`[error] ${message}`, meta ?? ''),
}

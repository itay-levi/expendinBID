import fs from 'node:fs'
import path from 'node:path'
import { ERROR_CATALOG, type ErrorCode } from './errorCatalog'

export type Level = 'STEP' | 'INFO' | 'OK' | 'PAY' | 'WARN' | 'ERROR' | 'FINDING' | 'SERVER'
export type Details = Record<string, unknown>
/** `important` shows only steps, warnings, errors and findings on screen; the file always gets everything. */
export type ConsoleMode = 'all' | 'important'

const COLOR: Record<Level, string> = {
  STEP: '\x1b[1;36m',
  INFO: '\x1b[37m',
  OK: '\x1b[32m',
  PAY: '\x1b[35m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[1;31m',
  FINDING: '\x1b[1;93m',
  SERVER: '\x1b[90m',
}
const RESET = '\x1b[0m'
const IMPORTANT: ReadonlySet<Level> = new Set<Level>(['STEP', 'WARN', 'ERROR', 'FINDING'])
const DETAIL_LIMIT = 800
const PAD = ' '.repeat(14)

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\r?\n/g, ' / ')
  return flat.length <= limit ? flat : `${flat.slice(0, limit)} ...(+${flat.length - limit} chars)`
}

/**
 * Writes two logs side by side:
 *
 *  - `sim-<time>.log` — for people. One line per event; errors expand into an indented block with
 *    what happened, what was expected, the exact request/response and a hint, so a single error
 *    can be understood without reading anything around it.
 *  - `sim-<time>.jsonl` — for tools. The same events, one JSON object per line, untruncated.
 */
export class SimLogger {
  readonly humanPath: string
  readonly jsonPath: string
  consoleMode: ConsoleMode = 'all'
  readonly counts: Record<Level, number> = { STEP: 0, INFO: 0, OK: 0, PAY: 0, WARN: 0, ERROR: 0, FINDING: 0, SERVER: 0 }
  readonly codes = new Map<ErrorCode, number>()
  /** Every warning's text, so the summary can list them without anyone searching the log. */
  readonly warnings: string[] = []
  private readonly human: fs.WriteStream
  private readonly json: fs.WriteStream
  private readonly startedAt = Date.now()

  constructor(dir: string, runId: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.humanPath = path.join(dir, `sim-${runId}.log`)
    this.jsonPath = path.join(dir, `sim-${runId}.jsonl`)
    this.human = fs.createWriteStream(this.humanPath, { flags: 'a' })
    this.json = fs.createWriteStream(this.jsonPath, { flags: 'a' })
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  /** mm:ss.mmm since the simulator started — the same clock in every line. */
  stamp(): string {
    const ms = this.elapsedMs()
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.floor((ms % 60_000) / 1_000)
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1_000).padStart(3, '0')}`
  }

  write(level: Level, category: string, actor: string, message: string, details?: Details, code?: ErrorCode): void {
    this.counts[level] += 1
    if (level === 'WARN' && this.warnings.length < 100) this.warnings.push(actor ? `${actor}: ${message}` : message)
    if (code) this.codes.set(code, (this.codes.get(code) ?? 0) + 1)

    const lines = [
      `[${this.stamp()}] ${level.padEnd(7)} ${category.padEnd(9)} ${oneLine(actor, 26).padEnd(26)} ${message}${code ? `  [${code}]` : ''}`,
    ]
    if (code) lines.push(`${PAD}| what      : ${ERROR_CATALOG[code].title}`)
    for (const [key, value] of Object.entries(details ?? {})) {
      if (value !== undefined) lines.push(`${PAD}| ${key.padEnd(10)}: ${oneLine(stringify(value), DETAIL_LIMIT)}`)
    }
    if (code) lines.push(`${PAD}| where     : ${ERROR_CATALOG[code].hint}`)
    const text = lines.join('\n')

    this.human.write(`${text}\n`)
    let json: string
    try {
      json = JSON.stringify({ at: new Date().toISOString(), t: this.elapsedMs(), level, category, actor, message, code, details })
    } catch {
      json = JSON.stringify({ at: new Date().toISOString(), t: this.elapsedMs(), level, category, actor, message, code })
    }
    this.json.write(`${json}\n`)

    if (this.consoleMode === 'all' || IMPORTANT.has(level)) process.stdout.write(`${COLOR[level]}${text}${RESET}\n`)
  }

  step(message: string): void {
    this.write('STEP', 'SIM', '', message)
  }
  info(category: string, actor: string, message: string, details?: Details): void {
    this.write('INFO', category, actor, message, details)
  }
  ok(category: string, actor: string, message: string, details?: Details): void {
    this.write('OK', category, actor, message, details)
  }
  pay(category: string, actor: string, message: string, details?: Details): void {
    this.write('PAY', category, actor, message, details)
  }
  warn(category: string, actor: string, message: string, details?: Details, code?: ErrorCode): void {
    this.write('WARN', category, actor, message, details, code)
  }
  error(category: string, actor: string, message: string, code: ErrorCode, details?: Details): void {
    this.write('ERROR', category, actor, message, details, code)
  }
  finding(category: string, message: string, details?: Details): void {
    this.write('FINDING', category, '', message, details)
  }
  server(message: string): void {
    this.write('SERVER', 'APP-LOG', 'next-server', message)
  }

  /** Free text (the summary) — written to the readable log and, by default, the screen. */
  raw(text: string, toConsole = true): void {
    this.human.write(`${text}\n`)
    if (toConsole) process.stdout.write(`${text}\n`)
  }

  close(): Promise<void> {
    const end = (stream: fs.WriteStream) => new Promise<void>((resolve) => stream.end(() => resolve()))
    return Promise.all([end(this.human), end(this.json)]).then(() => undefined)
  }
}

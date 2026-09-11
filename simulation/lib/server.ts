import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const SIM_ROOT = path.resolve(__dirname, '..')
export const PROJECT_ROOT = path.resolve(SIM_ROOT, '..')

/** Its own build folder, so it never collides with your `npm run dev` (which uses .next). */
const DIST_DIR = '.next-sim'
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
/** Safety cap when re-joining a multi-line log entry that never closes. */
const MAX_JOINED_LINES = 40
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type ServerLine = { text: string; kind: 'crash' | 'app-error' | 'app-warn' | 'other' }
export type SimServer = { baseUrl: string; stop(): Promise<void>; exited(): boolean }

/**
 * Sorts a line of the app's output. `[error]` / `[warn]` come from the app's own logger — many are
 * expected (refused attacks log loudly) — so they are shown for context, not counted as failures.
 * Next.js crash markers and uncaught exceptions are real problems.
 */
export function classifyServerLine(text: string): ServerLine {
  if (/⨯|Unhandled (Runtime Error|Rejection)|uncaughtException|unhandledRejection|FATAL ERROR|heap out of memory/i.test(text)) {
    return { text, kind: 'crash' }
  }
  if (/^\s*(TypeError|ReferenceError|RangeError|SyntaxError): /.test(text)) return { text, kind: 'crash' }
  if (text.startsWith('[error]')) return { text, kind: 'app-error' }
  if (text.startsWith('[warn]')) return { text, kind: 'app-warn' }
  return { text, kind: 'other' }
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Pick another one with --port, e.g. --port 3200.`)))
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(port)
  })
}

/**
 * Starts a private `next dev` for the simulation.
 *
 * Isolated from your own dev server on every axis: its own port, its own build folder (.next-sim),
 * its own database (simulation/.data), no payment keys (so checkout settles in demo mode and no
 * money can move), and a webhook secret only the simulator knows, so it can play the part of Dodo.
 *
 * Launches the Next.js binary directly rather than `npm run dev`, because that script's pre-step
 * frees port 3000 — it would kill YOUR dev server.
 */
export async function startSimServer(options: {
  port: number
  dataDir: string
  webhookSecret: string
  logPath: string
  keepData: boolean
  onLine: (line: ServerLine) => void
}): Promise<SimServer> {
  const dataDir = path.resolve(options.dataDir)
  const allowedRoot = path.join(SIM_ROOT, '.data')
  if (!dataDir.startsWith(allowedRoot)) throw new Error(`Refusing to use a database folder outside simulation/.data: ${dataDir}`)
  if (!options.keepData) fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dataDir), { recursive: true })

  await assertPortFree(options.port)

  const nextBin = path.join(PROJECT_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!fs.existsSync(nextBin)) throw new Error('Next.js is not installed here — run npm install first.')

  fs.mkdirSync(path.dirname(options.logPath), { recursive: true })
  const logStream = fs.createWriteStream(options.logPath, { flags: 'a' })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(options.port),
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: '1',
    // Its own PGlite database. An empty DATABASE_URL keeps it off any real Postgres you configured.
    PGLITE_PATH: path.relative(PROJECT_ROOT, dataDir),
    DATABASE_URL: '',
    USE_IN_MEMORY_REPOSITORIES: '',
    // No payment provider: checkout settles instantly in demo mode and no real money can move.
    DODO_PAYMENTS_API_KEY: '',
    DODO_PAYMENTS_PRODUCT_ID: '',
    PADDLE_API_KEY: '',
    PADDLE_PRICE_ID: '',
    ALLOW_DEMO_MODE: '',
    // ...but the Dodo webhook is live, with a secret only the simulator knows, so it can act as Dodo.
    DODO_PAYMENTS_WEBHOOK_SECRET: options.webhookSecret,
    TRUSTED_PROXY_HOPS: '1',
    SITE_URL: `http://localhost:${options.port}`,
  }

  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(options.port)], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })

  let exited = false
  child.once('exit', () => {
    exited = true
  })

  const pump = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return
    let buffer = ''
    // The app logs `[warn] message { ...object... }`, and Node prints a large object across several
    // lines. The continuation lines are gathered back onto the first, so the simulator's log shows
    // the whole entry instead of a message cut off at "{".
    let pending: string[] | null = null
    const emit = (text: string) => options.onLine(classifyServerLine(text))
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      logStream.write(chunk)
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const text = part.replace(ANSI, '').trim()
        if (!text) continue
        if (pending) {
          pending.push(text)
          if (text === '}' || pending.length >= MAX_JOINED_LINES) {
            emit(pending.join(' '))
            pending = null
          }
          continue
        }
        if (/^\[(error|warn)\]/.test(text) && text.endsWith('{')) {
          pending = [text]
          continue
        }
        emit(text)
      }
    })
  }
  pump(child.stdout)
  pump(child.stderr)

  const stop = async (): Promise<void> => {
    if (!exited && child.pid !== undefined) {
      const pid = child.pid
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        if (process.platform === 'win32') {
          // /T takes the whole tree: next dev runs its server in child processes.
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        } else {
          try {
            process.kill(-pid, 'SIGTERM')
          } catch {
            resolve()
          }
        }
      })
    }
    await new Promise<void>((resolve) => logStream.end(() => resolve()))
  }

  return { baseUrl: `http://localhost:${options.port}`, stop, exited: () => exited }
}

/** Waits until the map API answers. The first request compiles the app and builds its database. */
export async function waitForServer(
  baseUrl: string,
  exited: () => boolean,
  onWait: (seconds: number) => void,
  timeoutMs = 300_000,
): Promise<void> {
  const started = Date.now()
  let lastNotice = 0
  while (Date.now() - started < timeoutMs) {
    if (exited()) throw new Error('The private server exited while starting — see logs/latest-server.log.')
    try {
      const response = await fetch(`${baseUrl}/api/map?minQ=0&maxQ=0&minR=0&maxR=0`, { signal: AbortSignal.timeout(90_000) })
      if (response.status === 200) return
    } catch {
      // Not listening yet.
    }
    const seconds = Math.floor((Date.now() - started) / 1_000)
    if (seconds - lastNotice >= 10) {
      lastNotice = seconds
      onWait(seconds)
    }
    await sleep(1_000)
  }
  throw new Error(`The private server was not ready after ${timeoutMs / 1_000}s — see logs/latest-server.log.`)
}

export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(command as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    // The URL is printed as well; opening the browser is a convenience.
  }
}

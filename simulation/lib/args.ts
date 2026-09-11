export type SpeedName = 'slow' | 'medium' | 'fast' | 'turbo'

export type SpeedPreset = {
  name: SpeedName
  /** Average gap between advertiser actions. */
  actionEveryMs: number
  /** Advertiser actions allowed in flight at the same time. */
  concurrency: number
  /** Simulated people browsing the map. */
  visitors: number
  /** How often each visitor's browser re-reads the map. The real UI polls every 8 seconds. */
  visitorPollMs: number
  /** Default length of the story at this speed. */
  durationMs: number
  description: string
}

export const SPEEDS: Record<SpeedName, SpeedPreset> = {
  slow: {
    name: 'slow',
    actionEveryMs: 4_000,
    concurrency: 1,
    visitors: 8,
    visitorPollMs: 8_000,
    durationMs: 10 * 60_000,
    description: 'one action every ~4s — easy to follow on the map',
  },
  medium: {
    name: 'medium',
    actionEveryMs: 1_500,
    concurrency: 1,
    visitors: 20,
    visitorPollMs: 8_000,
    durationMs: 5 * 60_000,
    description: 'one action every ~1.5s',
  },
  fast: {
    name: 'fast',
    actionEveryMs: 350,
    concurrency: 3,
    visitors: 40,
    visitorPollMs: 8_000,
    durationMs: 2 * 60_000,
    description: 'several actions a second — the whole story in about 2 minutes',
  },
  turbo: {
    name: 'turbo',
    actionEveryMs: 60,
    concurrency: 6,
    visitors: 80,
    visitorPollMs: 3_000,
    durationMs: 90_000,
    description: 'stress test — as fast as the server will go',
  },
}

export type RunConfig = {
  speed: SpeedName
  durationMs: number
  advertisers: number
  /** Null means "whatever the speed preset says". */
  visitors: number | null
  port: number
  attachUrl: string | null
  webhookSecret: string | null
  keepData: boolean
  open: boolean
  exitWhenDone: boolean
  seed: number
  attacks: boolean
}

export const MAX_ADVERTISERS = 60

export const HELP = `
Hex Wars simulator
------------------
Runs a PRIVATE copy of the app (its own port, build folder and database) and fills it with
simulated visitors and advertisers who claim tiles, take them from each other, pay, and try to
cheat. Watch the real UI in your browser; read the detailed log afterwards.

  npm run sim                          medium speed (~5 minutes)
  npm run sim:slow                     one action every ~4s — easy to follow
  npm run sim:fast                     the whole story in ~2 minutes
  npm run sim:turbo                    stress test (90 seconds)
  npm run sim -- --speed fast --duration 90s --seed 42

Options
  --speed slow|medium|fast|turbo       pace (default: medium)
  --duration 90s | 5m                  how long advertisers keep acting (default: set by speed)
  --advertisers N                      how many of the ${MAX_ADVERTISERS} real URLs take part (default: all)
  --visitors N                         people browsing the map (default: set by speed)
  --seed N                             replay the same run (exact at slow and medium)
  --port N                             port for the private server (default: 3100)
  --keep-data                          continue from the last simulated world instead of a fresh one
  --no-attacks                         skip the scam and attack attempts
  --no-open                            do not open the browser
  --exit                               stop the private server as soon as the run finishes
  --attach http://localhost:3000       drive a server that is ALREADY running (writes to its database!)
  --webhook-secret whsec_...           with --attach: that server's DODO_PAYMENTS_WEBHOOK_SECRET

While it runs:  1 slow   2 medium   3 fast   4 turbo   p pause/resume   s status   q finish

Logs: simulation/logs/latest.log (readable), latest.jsonl (machine), latest-server.log (the app)
`

const FLAGS = new Set([
  'speed',
  'duration',
  'advertisers',
  'visitors',
  'seed',
  'port',
  'keep-data',
  'no-attacks',
  'no-open',
  'exit',
  'attach',
  'webhook-secret',
  'help',
  'h',
])

/** "90s", "5m", "1500ms", "1h", or a bare number of seconds. */
export function parseDuration(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()
  const factor = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000
  return Math.round(amount * factor)
}

function positiveInt(name: string, value: string | true | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`--${name} must be a whole number between 1 and ${max} (got "${String(value)}")`)
  }
  return parsed
}

export function parseArgs(argv: readonly string[]): RunConfig | 'help' {
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}". Run with --help to see the options.`)
    const [key, inline] = arg.slice(2).split('=', 2) as [string, string | undefined]
    if (!FLAGS.has(key)) throw new Error(`Unknown option --${key}. Run with --help to see the options.`)
    if (inline !== undefined) {
      flags.set(key, inline)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, true)
    }
  }

  if (flags.has('help') || flags.has('h')) return 'help'

  const speedFlag = flags.get('speed')
  const speed = (typeof speedFlag === 'string' ? speedFlag : 'medium') as SpeedName
  if (!(speed in SPEEDS)) throw new Error(`--speed must be one of: ${Object.keys(SPEEDS).join(', ')}`)

  const durationFlag = flags.get('duration')
  const durationMs = typeof durationFlag === 'string' ? parseDuration(durationFlag) : SPEEDS[speed].durationMs
  if (durationMs === null || durationMs < 5_000) throw new Error('--duration must be at least 5s, e.g. 90s or 5m')

  const attachFlag = flags.get('attach')
  let attachUrl: string | null = null
  if (attachFlag !== undefined) {
    if (typeof attachFlag !== 'string') throw new Error('--attach needs a URL, e.g. --attach http://localhost:3000')
    attachUrl = new URL(attachFlag).origin
  }

  const secretFlag = flags.get('webhook-secret')
  const seedFlag = flags.get('seed')

  return {
    speed,
    durationMs,
    advertisers: positiveInt('advertisers', flags.get('advertisers'), MAX_ADVERTISERS, MAX_ADVERTISERS),
    visitors: flags.has('visitors') ? positiveInt('visitors', flags.get('visitors'), 1, 500) : null,
    port: positiveInt('port', flags.get('port'), 3100, 65535),
    attachUrl,
    webhookSecret: typeof secretFlag === 'string' ? secretFlag : null,
    keepData: flags.has('keep-data'),
    open: !flags.has('no-open'),
    exitWhenDone: flags.has('exit'),
    seed: seedFlag === undefined ? Math.floor(Date.now() % 1_000_000) : positiveInt('seed', seedFlag, 1, 2_147_483_647),
    attacks: !flags.has('no-attacks'),
  }
}

/**
 * Hex Wars simulator — see simulation/README.md.
 *
 * Starts a private copy of the app (its own port, build folder and database), fills it with
 * simulated visitors and the advertisers in ./advertisers.ts, pays through the real checkout and
 * the real Dodo payment webhook, tries a set of scams and attacks, checks that everything adds up,
 * and writes a detailed log. Nothing in the app imports this folder; delete it to remove it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { formatCents } from '@/lib/pricing/takeoverPricing'
import { ADVERTISER_URLS, colorFor, platformPageNotes } from './advertisers'
import { HELP, parseArgs, SPEEDS, type RunConfig } from './lib/args'
import { PROBES, runProbe } from './lib/attacks'
import { advertiserAttacks, advertiserExpands, advertiserJoins, raceForTile, visitorSession } from './lib/behaviours'
import { createStats, makeAdvertiser, type Advertiser, type SimContext } from './lib/context'
import { attachControls } from './lib/controls'
import { SimHttp, type SimRequest } from './lib/http'
import { checkOrphans, finalChecks } from './lib/invariants'
import { SimLedger } from './lib/ledger'
import { errorMessage, SimLogger } from './lib/logger'
import { Metrics } from './lib/metrics'
import { reportFailure } from './lib/purchase'
import { createRng, type Rng } from './lib/rng'
import { openBrowser, SIM_ROOT, startSimServer, waitForServer, type SimServer } from './lib/server'
import { buildSummary, formatDuration } from './lib/summary'
import { createWebhookSecret } from './lib/webhooks'
import { World } from './lib/world'

const OBSERVER_IP = '10.99.0.1'
/** Below this much budget left, an advertiser sits out until the next top-up. */
const MIN_BUDGET_LEFT_CENTS = 5_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function runStamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '').replace(/[:T]/g, '-')
}

function relative(file: string): string {
  return path.relative(process.cwd(), file) || file
}

function createAdvertisers(config: RunConfig, rng: Rng): Advertiser[] {
  return ADVERTISER_URLS.slice(0, config.advertisers).map((url, index) => {
    const dollars = index < 6 ? rng.int(4_000, 7_000) : index < 12 ? rng.int(1_200, 2_500) : rng.int(150, 700)
    return makeAdvertiser({
      index,
      url,
      ip: `10.20.${Math.floor(index / 250)}.${(index % 250) + 1}`,
      color: colorFor(new URL(url).hostname),
      budgetCents: dollars * 100,
    })
  })
}

function statusLine(ctx: SimContext): string {
  const actions = [...ctx.stats.actions.values()].reduce((sum, count) => sum + count, 0)
  return [
    `status: speed ${ctx.speed.name}${ctx.paused ? ' (PAUSED)' : ''}`,
    `actions ${actions}`,
    `purchases ${ctx.ledger.applied.length}`,
    `paid ${formatCents(ctx.ledger.paidCents())}`,
    `takeovers ${ctx.ledger.takeovers()}`,
    `races ${ctx.stats.races}`,
    `visitors ${ctx.stats.visitorsOnline}`,
    `errors ${ctx.log.counts.ERROR}`,
    `warnings ${ctx.log.counts.WARN}`,
  ].join(' | ')
}

/** Hits every route once so the first real request is not also a compile. */
async function warmUp(ctx: SimContext): Promise<void> {
  const base = { endpoint: 'warm-up', ip: OBSERVER_IP, timeoutMs: 240_000 }
  const routes: Array<{ label: string; request: SimRequest }> = [
    { label: 'home page', request: { ...base, method: 'GET', path: '/' } },
    { label: 'checkout', request: { ...base, method: 'POST', path: '/api/checkout/create-session', body: {} } },
    { label: 'brand preview', request: { ...base, method: 'POST', path: '/api/brand/resolve', body: {} } },
    {
      label: 'payment webhook',
      request: { ...base, method: 'POST', path: '/api/webhooks/dodo', rawBody: '{}', headers: { 'content-type': 'application/json' } },
    },
    { label: 'logo proxy', request: { ...base, method: 'GET', path: '/api/brand/logo' } },
  ]
  for (const route of routes) {
    ctx.log.step(`preparing the ${route.label} (the first request compiles it)`)
    const response = await ctx.http.send(route.request)
    if (response.status === 0 || response.status >= 500) reportFailure(ctx, 'WARMUP', 'simulator', `the ${route.label} did not start`, response)
  }
}

type Kind = 'join' | 'expand' | 'takeover' | 'race'

/** What happens next. Early on, advertisers mostly arrive; later, they mostly fight. */
function pickKind(rng: Rng, progress: number, waiting: number, active: number): Kind | null {
  const weights: Array<[Kind, number]> = [
    ['join', waiting === 0 ? 0 : progress < 0.25 ? 70 : progress < 0.6 ? 20 : 8],
    ['expand', active === 0 ? 0 : progress < 0.25 ? 22 : 35],
    ['takeover', active === 0 ? 0 : progress < 0.25 ? 6 : progress < 0.7 ? 35 : 55],
    ['race', active < 2 ? 0 : 5],
  ]
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  if (total === 0) return null
  let roll = rng.next() * total
  for (const [kind, weight] of weights) {
    if (roll < weight) return kind
    roll -= weight
  }
  return null
}

function topUpBudgets(ctx: SimContext): void {
  const broke = ctx.advertisers.filter((adv) => adv.joined && !adv.blocked && adv.budgetCents - adv.spentCents < MIN_BUDGET_LEFT_CENTS)
  if (broke.length === 0) return
  for (const adv of broke) adv.budgetCents += Math.max(20_000, Math.round(adv.budgetCents * 0.5))
  ctx.log.step(`a new week — ${broke.length} advertisers top up their ad budgets and come back for more`)
}

async function runOneAction(ctx: SimContext, progress: number): Promise<void> {
  const waiting = ctx.advertisers.filter((adv) => !adv.joined && !adv.blocked && adv.joinAttempts < 3)
  const active = ctx.advertisers.filter(
    (adv) => adv.joined && !adv.blocked && adv.budgetCents - adv.spentCents >= MIN_BUDGET_LEFT_CENTS,
  )
  const kind = pickKind(ctx.rng, progress, waiting.length, active.length)
  if (!kind) {
    topUpBudgets(ctx)
    return
  }
  if (kind === 'join') return advertiserJoins(ctx, ctx.rng.pick(waiting.slice(0, 3)))
  if (kind === 'expand') return advertiserExpands(ctx, ctx.rng.pick(active))
  if (kind === 'takeover') return advertiserAttacks(ctx, ctx.rng.pick(active))
  const [first, second] = ctx.rng.shuffle(active)
  if (first && second) await raceForTile(ctx, first, second)
}

/**
 * The main loop: advertisers act at the chosen pace, several at once at the faster speeds. Attacks
 * are spread across the run and each one runs alone, so its before/after checks are exact.
 */
async function runStory(ctx: SimContext, durationMs: number): Promise<void> {
  const probes = ctx.config.attacks ? PROBES.filter((probe) => ctx.webhookSecret !== null || !probe.needsWebhook) : []
  const dueAt = probes.map((_, index) => 0.1 + (0.8 * index) / Math.max(1, probes.length - 1))
  let nextProbe = 0
  const inFlight = new Set<Promise<void>>()
  let activeMs = 0
  let last = Date.now()

  while (!ctx.stopRequested) {
    const now = Date.now()
    if (!ctx.paused) activeMs += now - last
    last = now
    const progress = activeMs / durationMs
    if (progress >= 1) break
    if (ctx.paused) {
      await sleep(200)
      continue
    }

    const probe = probes[nextProbe]
    const due = dueAt[nextProbe]
    if (probe && due !== undefined && progress >= due) {
      await Promise.allSettled([...inFlight])
      nextProbe += 1
      await runProbe(ctx, probe)
      continue
    }

    while (inFlight.size >= ctx.speed.concurrency) await Promise.race([...inFlight])
    const task: Promise<void> = runOneAction(ctx, progress).catch((error: unknown) => {
      ctx.log.error('SIM', 'simulator', `an action crashed inside the simulator: ${errorMessage(error)}`, 'E-SIM-BUG', {
        stack: error instanceof Error ? error.stack : undefined,
      })
    })
    inFlight.add(task)
    void task.then(() => inFlight.delete(task))
    await sleep(Math.max(10, ctx.speed.actionEveryMs * (0.6 + ctx.rng.next() * 0.8)))
  }

  // A run that reached its end still gets every attack; a run stopped early does not.
  if (!ctx.stopRequested) {
    while (nextProbe < probes.length) {
      const probe = probes[nextProbe]
      nextProbe += 1
      if (!probe) break
      await Promise.allSettled([...inFlight])
      await runProbe(ctx, probe)
    }
  }
  await Promise.allSettled([...inFlight])
}

/** Visitors arrive gradually over `rampMs`, like people finding the site. */
function startVisitors(ctx: SimContext, count: number, rampMs: number, isStopped: () => boolean): Array<Promise<void>> {
  return Array.from({ length: count }, (_, index) =>
    (async () => {
      await sleep((rampMs * index) / Math.max(1, count))
      if (!isStopped()) await visitorSession(ctx, index, isStopped)
    })().catch((error: unknown) => {
      ctx.log.error('VISIT', `visitor-${index + 1}`, `a visitor crashed inside the simulator: ${errorMessage(error)}`, 'E-SIM-BUG')
    }),
  )
}

function copyLatest(logsDir: string, files: Array<[string | null, string]>): void {
  for (const [from, name] of files) {
    if (!from || !fs.existsSync(from)) continue
    try {
      fs.copyFileSync(from, path.join(logsDir, name))
    } catch {
      // Best effort: the timestamped files are the originals.
    }
  }
}

async function main(): Promise<void> {
  let parsed: RunConfig | 'help'
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error: unknown) {
    process.stderr.write(`\n${errorMessage(error)}\n\n`)
    process.exitCode = 2
    return
  }
  if (parsed === 'help') {
    process.stdout.write(HELP)
    return
  }
  const config = parsed

  const startedAt = new Date()
  const stamp = runStamp(startedAt)
  const logsDir = path.join(SIM_ROOT, 'logs')
  const log = new SimLogger(logsDir, stamp)
  log.consoleMode = config.speed === 'slow' || config.speed === 'medium' ? 'all' : 'important'
  const serverLogPath = config.attachUrl ? null : path.join(logsDir, `server-${stamp}.log`)
  const summaryPath = path.join(logsDir, `summary-${stamp}.txt`)
  const metrics = new Metrics()
  const rng = createRng(config.seed)
  const webhookSecret = config.attachUrl ? config.webhookSecret : createWebhookSecret()

  let server: SimServer | null = null
  let ctx: SimContext | null = null
  let releaseKeepAlive: (() => void) | null = null
  let detachControls: () => void = () => undefined

  const quit = (): void => {
    if (releaseKeepAlive) {
      const release = releaseKeepAlive
      releaseKeepAlive = null
      release()
      return
    }
    if (ctx && !ctx.stopRequested) {
      ctx.stopRequested = true
      log.step('finishing — wrapping up the run and writing the summary (press q again to stop immediately)')
      return
    }
    log.step('stopping immediately')
    detachControls()
    void (server ? server.stop() : Promise.resolve()).finally(() => process.exit(130))
  }
  process.on('SIGINT', quit)

  log.raw(
    [
      '',
      '  HEX WARS SIMULATOR',
      `  speed ${config.speed} — ${SPEEDS[config.speed].description}`,
      `  story length ${formatDuration(config.durationMs)} · ${config.advertisers} advertisers · seed ${config.seed} (rerun with --seed ${config.seed})`,
      `  readable log: ${relative(log.humanPath)}`,
      '',
    ].join('\n'),
  )

  try {
    if (!config.attachUrl) {
      log.step(
        `starting a private copy of the app on port ${config.port} — own build folder (.next-sim) and database (simulation/.data); your dev server and data are not touched`,
      )
      const started = await startSimServer({
        port: config.port,
        dataDir: path.join(SIM_ROOT, '.data', 'pglite'),
        webhookSecret: webhookSecret as string,
        logPath: serverLogPath as string,
        keepData: config.keepData,
        onLine: (line) => {
          if (line.kind === 'crash') log.error('SERVER', 'next-server', line.text, 'E-SERVER-CRASH')
          else if (line.kind === 'app-error' || line.kind === 'app-warn') log.server(line.text)
        },
      })
      server = started
      await waitForServer(started.baseUrl, started.exited, (seconds) =>
        log.step(`still starting (${seconds}s) — the first start compiles the app and builds its database`),
      )
    } else {
      log.step(`attaching to ${config.attachUrl} — this WRITES to that server's database`)
      if (!webhookSecret) log.step('no --webhook-secret: payments go through checkout only, and payment-webhook attacks are skipped')
    }

    const baseUrl = config.attachUrl ?? (server as SimServer).baseUrl
    const context: SimContext = {
      config,
      speed: SPEEDS[config.speed],
      http: new SimHttp(baseUrl, metrics),
      log,
      metrics,
      ledger: new SimLedger(),
      rng,
      webhookSecret,
      advertisers: createAdvertisers(config, rng),
      stats: createStats(),
      observerIp: OBSERVER_IP,
      paused: false,
      stopRequested: false,
      baselineRevenueCents: 0,
    }
    ctx = context

    await warmUp(context)
    const baseline = await World.load(context.http, OBSERVER_IP)
    if (!baseline.world) throw new Error(`could not read the starting map (HTTP ${baseline.response.status})`)
    context.baselineRevenueCents = baseline.world.market?.totalWarRevenueCents ?? 0
    log.step(
      `starting map: ${baseline.world.hexes.size} owned tiles, ${baseline.world.empires.size} companies, revenue so far ${formatCents(context.baselineRevenueCents)}`,
    )

    const platformNotes = platformPageNotes(context.advertisers.map((adv) => adv.url))
    if (platformNotes.length > 0) {
      const text = `${platformNotes.length} advertiser URLs point at a page on a shared platform rather than a company site — ${platformNotes.join('; ')}.`
      context.stats.findings.push(text)
      log.finding('IDENTITY', text)
    }

    if (config.open) {
      openBrowser(baseUrl)
      log.step(`opened ${baseUrl} in your browser — the map refreshes every 8 seconds, so changes arrive in waves`)
    } else {
      log.step(`watch it at ${baseUrl}`)
    }

    detachControls = attachControls({
      setSpeed: (name) => {
        context.speed = SPEEDS[name]
        log.consoleMode = name === 'slow' || name === 'medium' ? 'all' : 'important'
        log.step(`speed is now ${name} — ${SPEEDS[name].description}`)
      },
      togglePause: () => {
        context.paused = !context.paused
        log.step(context.paused ? 'PAUSED — press p to resume' : 'resumed')
      },
      status: () => log.step(statusLine(context)),
      quit,
    })
    log.step('keys: 1 slow · 2 medium · 3 fast · 4 turbo · p pause · s status · q finish')

    let visitorsStopped = false
    const visitorCount = config.visitors ?? SPEEDS[config.speed].visitors
    const visitors = startVisitors(context, visitorCount, Math.min(60_000, config.durationMs * 0.3), () => visitorsStopped || context.stopRequested)

    let checking = false
    const heartbeat = setInterval(
      () => {
        if (context.paused || checking) return
        checking = true
        log.step(statusLine(context))
        void World.load(context.http, OBSERVER_IP)
          .then(({ world }) => {
            if (world) checkOrphans(context, world)
          })
          .finally(() => {
            checking = false
          })
      },
      config.speed === 'slow' ? 30_000 : 15_000,
    )

    log.step(`the story begins: ${context.advertisers.length} advertisers will arrive, build territory, fight over it and pay (${visitorCount} people browsing)`)
    await runStory(context, config.durationMs)
    clearInterval(heartbeat)
    visitorsStopped = true
    await Promise.race([Promise.allSettled(visitors), sleep(3_000)])

    log.step('the story is over — running the final consistency checks')
    const { checks, world } = await finalChecks(context)
    const summary = buildSummary(context, {
      checks,
      world,
      startedAt,
      endedAt: new Date(),
      baseUrl,
      files: {
        log: relative(path.join(logsDir, 'latest.log')),
        json: relative(path.join(logsDir, 'latest.jsonl')),
        server: serverLogPath ? relative(path.join(logsDir, 'latest-server.log')) : null,
        summary: relative(path.join(logsDir, 'latest-summary.txt')),
      },
    })
    log.raw(summary.text)
    fs.writeFileSync(summaryPath, `${summary.text}\n`)
    process.exitCode = summary.passed ? 0 : 1

    if (server && !config.exitWhenDone) {
      log.step(`the simulated world is still running at ${baseUrl} — look around in the browser. Press q (or Ctrl+C) to stop it.`)
      await new Promise<void>((resolve) => {
        releaseKeepAlive = resolve
      })
    }
  } catch (error: unknown) {
    log.error('SIM', 'simulator', `the simulation stopped: ${errorMessage(error)}`, 'E-SIM-BUG', {
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exitCode = 1
  } finally {
    detachControls()
    process.off('SIGINT', quit)
    if (server) {
      log.step('stopping the private server')
      await server.stop()
    }
    await log.close()
    copyLatest(logsDir, [
      [log.humanPath, 'latest.log'],
      [log.jsonPath, 'latest.jsonl'],
      [serverLogPath, 'latest-server.log'],
      [fs.existsSync(summaryPath) ? summaryPath : null, 'latest-summary.txt'],
    ])
    process.stdout.write(`\nLogs: ${relative(path.join(logsDir, 'latest.log'))}  (send this file if something looks wrong)\n`)
  }
}

void main()

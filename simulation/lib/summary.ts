import { formatCents } from '@/lib/pricing/takeoverPricing'
import type { SimContext } from './context'
import { ERROR_CATALOG } from './errorCatalog'
import type { CheckResult } from './invariants'
import type { World } from './world'

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1_000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

function formatMs(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${Math.round(value)}ms`
}

export type SummaryInput = {
  checks: CheckResult[]
  world: World | null
  startedAt: Date
  endedAt: Date
  baseUrl: string
  files: { log: string; json: string; server: string | null; summary: string }
}

/** The end-of-run report: printed, appended to the readable log, and saved on its own. */
export function buildSummary(ctx: SimContext, input: SummaryInput): { text: string; passed: boolean } {
  const lines: string[] = []
  const rule = '='.repeat(88)
  const failed = input.checks.filter((check) => !check.passed)
  const errors = ctx.log.counts.ERROR
  const passed = errors === 0 && failed.length === 0

  lines.push('', rule, '  HEX WARS SIMULATION — SUMMARY', rule)
  lines.push(`  Result   : ${passed ? 'PASS — no errors, every check passed' : `NEEDS ATTENTION — ${errors} error(s), ${failed.length} failed check(s)`}`)
  lines.push(
    `  Run      : ${input.startedAt.toISOString()}  speed ${ctx.config.speed}  seed ${ctx.config.seed}  length ${formatDuration(input.endedAt.getTime() - input.startedAt.getTime())}`,
  )
  lines.push(`  Server   : ${input.baseUrl}`)
  lines.push('')

  lines.push('  STORY')
  lines.push(`    advertisers joined   : ${ctx.advertisers.filter((adv) => adv.joined).length} of ${ctx.advertisers.length}      visitors at peak : ${ctx.stats.visitorsPeak}`)
  const actions = [...ctx.stats.actions.entries()].map(([kind, count]) => `${kind} ${count}`).join(', ') || 'none'
  lines.push(`    actions              : ${actions}`)
  lines.push(`    purchases accepted   : ${ctx.ledger.applied.length}      tiles taken from rivals : ${ctx.ledger.takeovers()}      races lost : ${ctx.stats.races}`)
  lines.push(`    refused correctly    : ${ctx.stats.refusedAsExpected}      paid but not delivered (needs a refund) : ${ctx.stats.paidNotDelivered}`)
  lines.push(`    blocked (chargeback) : ${[...ctx.ledger.blocked.keys()].join(', ') || 'none'}`)
  lines.push('')

  lines.push('  MONEY')
  lines.push(`    customers paid       : ${formatCents(ctx.ledger.paidCents())} (including protection and tax)`)
  lines.push(`    territory revenue    : ${formatCents(ctx.ledger.revenueCents())}`)
  const spenders = ctx.advertisers
    .filter((adv) => adv.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, 6)
  lines.push(`    biggest spenders     : ${spenders.map((adv) => `${adv.domain} ${formatCents(adv.spentCents)}`).join(', ') || 'none'}`)
  if (input.world) {
    const territories = [...input.world.ownerCounts().entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    lines.push(`    biggest territories  : ${territories.map(([owner, tiles]) => `${owner} ${tiles}`).join(', ')}`)
  }
  lines.push('')

  lines.push('  CHECKS')
  for (const check of input.checks) lines.push(`    [${check.passed ? 'PASS' : 'FAIL'}] ${check.name} — ${check.detail}`)
  lines.push('')

  if (ctx.stats.probes.length > 0) {
    lines.push('  ATTACKS AND SCAM ATTEMPTS')
    for (const probe of ctx.stats.probes) {
      const tag = { stopped: 'STOPPED', 'not-stopped': 'WORKED!', finding: 'FINDING', skipped: 'SKIPPED' }[probe.outcome]
      lines.push(`    [${tag}] ${probe.title}`)
      lines.push(`              ${probe.note}`)
    }
    lines.push('')
  }

  if (ctx.stats.findings.length > 0) {
    lines.push('  FINDINGS — not crashes, but things worth deciding on')
    ctx.stats.findings.forEach((text, index) => lines.push(`    ${index + 1}. ${text}`))
    lines.push('')
  }

  lines.push('  PERFORMANCE                                    calls      p50      p95      max    4xx  5xx  no-answer')
  for (const row of ctx.metrics.rows()) {
    if (row.endpoint === 'warm-up') continue
    lines.push(
      `    ${row.endpoint.padEnd(42)} ${String(row.count).padStart(6)} ${formatMs(row.p50).padStart(8)} ${formatMs(row.p95).padStart(8)} ${formatMs(row.max).padStart(8)} ${String(row.clientErrors).padStart(6)} ${String(row.serverErrors).padStart(4)} ${String(row.networkErrors).padStart(10)}`,
    )
  }
  lines.push('    (4xx are mostly intended: refusals and blocked attacks)')
  lines.push('')

  lines.push(`  PROBLEMS   errors ${ctx.log.counts.ERROR}   warnings ${ctx.log.counts.WARN}   findings ${ctx.log.counts.FINDING}`)
  const codes = [...ctx.log.codes.entries()].sort((a, b) => b[1] - a[1])
  for (const [code, count] of codes) lines.push(`    ${String(count).padStart(4)} x [${code}] ${ERROR_CATALOG[code].title}`)
  if (codes.length > 0) lines.push('    Search the log for the [code] to see each one with its request, response and a hint.')
  if (ctx.log.warnings.length > 0) {
    lines.push('    warnings:')
    for (const warning of ctx.log.warnings.slice(0, 12)) lines.push(`      - ${warning}`)
    if (ctx.log.warnings.length > 12) lines.push(`      ... and ${ctx.log.warnings.length - 12} more in the log`)
  }
  lines.push('')

  lines.push('  FILES')
  lines.push(`    readable log : ${input.files.log}`)
  lines.push(`    JSON log     : ${input.files.json}`)
  if (input.files.server) lines.push(`    app output   : ${input.files.server}`)
  lines.push(`    this summary : ${input.files.summary}`)
  lines.push('')
  lines.push(
    passed
      ? '  Everything held up. Try --speed turbo or a longer --duration to push harder.'
      : '  Something needs a look: send simulation/logs/latest.log and latest-server.log, plus what you saw in the browser.',
  )
  lines.push(rule)
  return { text: lines.join('\n'), passed }
}

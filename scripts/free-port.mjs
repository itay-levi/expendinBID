#!/usr/bin/env node
/**
 * Frees a TCP port before the dev server tries to bind it.
 *
 * Wired to npm's `predev` hook, so `npm run dev` — the command everyone already types — simply
 * stops failing on a port left busy by a previous run. A dev server that survives a closed
 * terminal is the normal case on Windows, not an edge case.
 *
 * Exits 0 whether or not it found anything: this must never be the reason `npm run dev` fails.
 *
 * Usage: node scripts/free-port.mjs [port]
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const port = Number(process.argv[2] ?? 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`free-port: "${process.argv[2]}" is not a valid port`)
  process.exit(0)
}

/** PIDs listening on `port`. Empty when nothing holds it, or when the lookup itself fails. */
function findListeners() {
  try {
    if (process.platform === 'win32') {
      // `netstat` rather than PowerShell's Get-NetTCPConnection: it is present on every Windows
      // install including stripped-down CI images, and costs no shell startup.
      const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf-8' })
      const pids = new Set()
      for (const line of output.split(/\r?\n/)) {
        const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i)
        if (match && Number(match[1]) === port) pids.add(Number(match[2]))
      }
      return [...pids]
    }

    const output = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
    return output.split('\n').map(Number).filter(Boolean)
  } catch {
    // Nothing listening (lsof exits non-zero), or the tool is missing. Either way there is
    // nothing to kill and nothing worth failing over.
    return []
  }
}

const pids = findListeners().filter((pid) => pid !== process.pid)

if (pids.length === 0) {
  console.log(`free-port: :${port} is already free`)
  process.exit(0)
}

for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      // /T kills the process tree: `npm run dev` spawns next, which spawns its own workers, and
      // killing only the parent orphans children that keep the port — and keep rewriting .next.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
    console.log(`free-port: killed PID ${pid} holding :${port}`)
  } catch {
    console.warn(`free-port: could not kill PID ${pid} — it may already be gone`)
  }
}

import { readDodoConfig, type DodoConfig, type EnvSource } from './dodoClient'
import { readPaddleConfig, type PaddleConfig } from './paddleClient'

export type ActiveProvider =
  | { kind: 'dodo'; config: DodoConfig }
  | { kind: 'paddle'; config: PaddleConfig }
  | { kind: 'demo' }
  | { kind: 'unconfigured' }

/**
 * Which payment path checkout takes.
 *
 * Dodo Payments when configured — it is the current provider. Paddle still works when it is the
 * only one configured, so an existing deployment keeps taking payments. With neither, free demo
 * claims only where they are explicitly allowed; otherwise checkout is closed.
 */
export function selectPaymentProvider(env: EnvSource = process.env): ActiveProvider {
  const dodo = readDodoConfig(env)
  if (dodo) return { kind: 'dodo', config: dodo }

  const paddle = readPaddleConfig()
  if (paddle) return { kind: 'paddle', config: paddle }

  return isDemoModeAllowed(env) ? { kind: 'demo' } : { kind: 'unconfigured' }
}

/**
 * Demo mode gives territory away, so a deployment has to opt into it rather than fall into it.
 *
 * It used to switch on whenever a payment key was missing. A production deploy that merely failed
 * to load a key — a typo'd variable name, a secret not attached to the environment — then handed
 * free hexes to every visitor, with nothing in the logs to say so. Local development keeps demo
 * mode by default; a production build needs ALLOW_DEMO_MODE=true.
 */
export function isDemoModeAllowed(env: EnvSource = process.env): boolean {
  if (env.ALLOW_DEMO_MODE === 'true') return true
  return env.NODE_ENV !== 'production'
}

/**
 * The origin buyers are sent back to after checkout.
 *
 * SITE_URL when set, because behind a proxy the request's own origin can be an internal hostname
 * the buyer's browser cannot reach. Otherwise the origin the request arrived on.
 */
export function siteOrigin(request: Request, env: EnvSource = process.env): string {
  const configured = env.SITE_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // A malformed SITE_URL falls back to the request origin rather than breaking checkout.
    }
  }
  return new URL(request.url).origin
}

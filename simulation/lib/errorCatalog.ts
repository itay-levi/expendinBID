/**
 * Every problem the simulator can report, with a plain-English title and where to start looking.
 *
 * Each ERROR/WARN line in the log carries one of these codes in [brackets], so a log can be
 * searched for one kind of problem, and the summary counts them by code.
 */
export type ErrorCode =
  | 'E-HTTP-5XX'
  | 'E-NETWORK'
  | 'E-UNEXPECTED-STATUS'
  | 'E-PRICE-MISMATCH'
  | 'E-REFUSED-VALID'
  | 'E-RULES-DISAGREE'
  | 'E-NOT-APPLIED'
  | 'E-WRONG-PRICE-RECORDED'
  | 'E-DOUBLE-SALE'
  | 'E-REVENUE-DRIFT'
  | 'E-STATE-DRIFT'
  | 'E-ORPHAN-OWNER'
  | 'E-ATTACK-NOT-STOPPED'
  | 'E-BLOCKED-BOUGHT'
  | 'E-SERVER-CRASH'
  | 'E-RATE-LIMITED-USER'
  | 'E-WEBHOOK-REJECTED'
  | 'E-SLOW'
  | 'E-SIM-BUG'

export const ERROR_CATALOG: Record<ErrorCode, { title: string; hint: string }> = {
  'E-HTTP-5XX': {
    title: 'The server crashed while handling a request (HTTP 5xx)',
    hint: 'Open logs/latest-server.log at the same time for the stack trace. Routes live in app/api/.',
  },
  'E-NETWORK': {
    title: 'The request got no answer (connection refused, reset, or timed out)',
    hint: 'The private server may have crashed or stalled — check the end of logs/latest-server.log. A timeout under load points at a slow route or a busy database.',
  },
  'E-UNEXPECTED-STATUS': {
    title: 'The server answered with a status the simulator did not expect',
    hint: 'Compare the request and response below. Either the API changed, or a check is refusing valid input.',
  },
  'E-PRICE-MISMATCH': {
    title: 'The buyer was charged a different amount than the price they were shown',
    hint: 'Both sides price with quoteForHexes (lib/pricing/takeoverPricing.ts). Nobody else touched these tiles, so one side used different inputs — billboard count, protection, or tile state.',
  },
  'E-REFUSED-VALID': {
    title: 'The server refused a purchase the game rules allow',
    hint: 'No other buyer changed these tiles, yet the server said no. Compare the rules (lib/hex/selectionEligibility.ts) with app/api/checkout/create-session/route.ts and lib/payments/settleTakeover.ts.',
  },
  'E-RULES-DISAGREE': {
    title: 'The server accepted a purchase the game rules say it should refuse',
    hint: 'The claim bar would have blocked this basket, but the server sold it. Compare lib/hex/selectionEligibility.ts with the checkout route.',
  },
  'E-NOT-APPLIED': {
    title: 'The purchase "succeeded" but the buyer does not own the tiles',
    hint: 'Settlement said applied, the map disagrees. Check applyTakeoverBatch (lib/repository/postgresHexRepository.ts) and the map read (app/api/map/route.ts).',
  },
  'E-WRONG-PRICE-RECORDED': {
    title: 'A tile was recorded at a different price than its share of the payment',
    hint: 'Each tile should hold an even share of the territory total (splitEvenly in lib/payments/settleTakeover.ts). A wrong value makes the next takeover too cheap or too dear.',
  },
  'E-DOUBLE-SALE': {
    title: 'CRITICAL — the same tile was sold twice from the same state',
    hint: 'Two payments both passed the compare-and-swap. Look at the row lock and the INSERT ... ON CONFLICT path in applyTakeoverBatch (lib/repository/postgresHexRepository.ts).',
  },
  'E-REVENUE-DRIFT': {
    title: 'Revenue shown on the map does not match what was paid for territory',
    hint: 'Revenue is the sum of takeover_events.price_paid_cents. A drift means a purchase wrote the wrong ledger rows, or wrote them twice.',
  },
  'E-STATE-DRIFT': {
    title: 'Final tile ownership differs from what the payments add up to',
    hint: 'Replaying every successful payment in order gives a different owner or price than the map shows. The tile and the payments involved are listed.',
  },
  'E-ORPHAN-OWNER': {
    title: 'A tile is owned by a company the map has no record of',
    hint: 'The map returns companies only for owners it can find. An owner without a company row means the empire write and the tile write got out of step.',
  },
  'E-ATTACK-NOT-STOPPED': {
    title: 'SECURITY — an attack or scam attempt WORKED',
    hint: 'The attack, its exact request and what it achieved are below. This is a hole to close before going live.',
  },
  'E-BLOCKED-BOUGHT': {
    title: 'A domain blocked for a chargeback still managed to buy',
    hint: 'Check the blocklist test in app/api/checkout/create-session/route.ts and normalizeDomain (lib/repository/paymentAuditRepository.ts).',
  },
  'E-SERVER-CRASH': {
    title: 'The server printed a crash or an unhandled error',
    hint: 'The quoted line is from the app. The full stack trace is in logs/latest-server.log at this time.',
  },
  'E-RATE-LIMITED-USER': {
    title: 'A normal (non-abusive) simulated person was rate-limited',
    hint: 'Either a limit is too tight for real use, or the simulator acted faster than a person would. Limits are set per route with rateLimit(...).',
  },
  'E-WEBHOOK-REJECTED': {
    title: 'A correctly signed payment webhook was rejected',
    hint: 'The simulator signs with the secret it gave the server. A 401 means verification changed or the server never got DODO_PAYMENTS_WEBHOOK_SECRET.',
  },
  'E-SLOW': {
    title: 'An endpoint is slower than it should be',
    hint: 'See the performance table. Checkout reads the buyer\'s website on every purchase, so slow sites show up there.',
  },
  'E-SIM-BUG': {
    title: 'The simulator itself failed — not necessarily a problem in the app',
    hint: 'Send this log; the stack below points into simulation/.',
  },
}

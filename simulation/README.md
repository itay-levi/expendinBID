# Hex Wars simulator

A self-contained simulation of Hex Wars with realistic users. Visitors browse the map, and 60 advertisers (real product URLs) arrive, claim tiles, expand, open second billboards, take tiles from each other and **pay**. On top of that, a set of scams and attacks runs against the app. You watch the **real UI** in your browser while it runs, and get a detailed log at the end that pinpoints anything that went wrong.

## It never touches your app, your dev server or your data

The simulator starts its own private copy of the app:

|                | your `npm run dev`          | the simulator                                                    |
| -------------- | --------------------------- | ---------------------------------------------------------------- |
| port           | 3000                        | **3100** (`--port` to change)                                    |
| build folder   | `.next`                     | `.next-sim`                                                      |
| database       | `.pglite`                   | `simulation/.data/pglite` (fresh every run)                      |
| payments       | whatever your `.env` says   | demo checkout + simulated Dodo webhooks — **no real money, no Dodo account** |

It launches Next.js directly, not through `npm run dev`, because that script's pre-step frees port 3000 and would kill your running dev server. Both can run at the same time.

## Run it

```bash
npm run sim            # medium speed, ~5 minutes
npm run sim:slow       # one action every ~4 s — easy to follow on the map
npm run sim:fast       # the whole story in ~2 minutes
npm run sim:turbo      # stress test, 90 seconds

npm run sim -- --speed fast --duration 90s --seed 42
npm run sim -- --help  # every option
```

The first start takes a minute: it compiles the app and builds a fresh database. Your browser opens at <http://localhost:3100> when everything is ready.

### Options

| option | what it does |
| --- | --- |
| `--speed slow\|medium\|fast\|turbo` | pace of the advertisers (default `medium`) |
| `--duration 90s` / `5m` | how long advertisers keep acting (default set by speed) |
| `--advertisers N` | how many of the 60 URLs take part |
| `--visitors N` | people browsing the map |
| `--seed N` | replay a run — exact at slow/medium (fast/turbo run actions in parallel, so timing varies) |
| `--keep-data` | continue from the last simulated world instead of a fresh one |
| `--no-attacks` | skip the scam and attack attempts |
| `--no-open` | don't open the browser |
| `--exit` | stop the private server as soon as the run ends (default: keep it up so you can look around) |
| `--attach http://localhost:3000` | drive a server that is already running — **writes to its database** |
| `--webhook-secret whsec_…` | with `--attach`: that server's `DODO_PAYMENTS_WEBHOOK_SECRET` |

### Keys while it runs

`1` slow · `2` medium · `3` fast · `4` turbo · `p` pause/resume · `s` status · `q` finish (press again to stop at once)

When the story ends, the summary prints and the simulated world **stays running** so you can explore it in the browser. Press `q` to shut it down.

## What happens

1. **Advertisers arrive.** They start from the top of the list, and bigger spenders come first. Each types its URL, and the app reads the real site for its logo and description. Then it claims a first block near the centre.
2. **They grow.** They expand into open ground next to their territory, and sometimes open a second billboard elsewhere, which pays the spread premium.
3. **They fight.** They take rival tiles on their border, which is what the red attack arrows invite. Some buy protection, and sometimes two buyers race for the same tile at the same moment.
4. **They pay.** About two thirds of purchases go through checkout. The rest arrive as signed Dodo `payment.succeeded` webhooks, which is exactly how real payments land in production. Some of those include tax on top.
5. **People browse.** Visitors load the page and re-read the map every 8 s, like the real UI does, and load logos.
6. **Scams and attacks** run one at a time, spread across the run (list below).
7. **Final checks** compare everything the simulator paid for with what the app reports.

The UI refreshes the map every 8 seconds, so changes appear in waves. At `slow` you can follow individual purchases.

## Scams and attacks it tries

Each has a result the app **must** produce; anything else is logged as `[E-ATTACK-NOT-STOPPED]`.

- fake a "payment succeeded" webhook with the wrong signature → **401, no tiles**
- replay a genuine payment webhook → **duplicate, no second tile, revenue unchanged**
- pay one cent less than the price → **refused (amount_mismatch)**
- pay in a different currency → **refused (amount_mismatch)**
- pay for a tile someone else bought while you were paying → **not delivered; flagged "needs a refund"**
- buy, file a chargeback, then come back as `www.`, `domain.`, UPPERCASE and from a new IP → **domain blocked, every comeback refused (403)**
- dispute a payment that never happened, to get someone else blocked → **ignored**
- check out without accepting the terms → **400**
- the same tile twice in one basket → **400**
- advertise `localhost`, a database port, cloud metadata, a local file → **400**
- a 60 KB checkout body → **413**
- 12 checkouts in a row from one address → **rate-limited (429)**
- buy a tile you already own → **refused**
- snipe a tile deep inside a rival's territory, at checkout and via a paid webhook → **refused both ways**
- take a protected tile → **refused**
- flood the webhook with a 300 KB body and unknown events → **413 / ignored**
- **probes that report findings, not errors:**
  - split a 3-tile purchase into three single-tile checkouts: does it dodge the escalating price?
  - use the logo proxy to serve an image from a site that isn't an advertiser

## Reading the log

Everything goes to `simulation/logs/`:

| file | for |
| --- | --- |
| `latest.log` | **you** — one line per event, errors expanded with details |
| `latest-summary.txt` | the end-of-run report on its own |
| `latest-server.log` | the app's own output (stack traces live here) |
| `latest.jsonl` | tools — every event as JSON |

Each run also keeps timestamped copies (`sim-<time>.log`, …).

A normal line:

```
[01:12.345] PAY     TAKEOVER  outrank.so                 paid $45.00 by checkout for 1 tile — took hex_3,-2 from see.io
```

`[mm:ss.mmm]` is time since start — the same clock the server log's events line up with. The levels are:

| level | meaning |
| --- | --- |
| `STEP` | what the simulator is doing |
| `INFO` | something a user did |
| `OK` | a check or defence held |
| `PAY` | money moved, or a payment that needs a refund (`REFUND`) |
| `WARN` | worth a look |
| `ERROR` | a real problem |
| `FINDING` | a design issue to decide on (not a crash) |
| `SERVER` | a line the app itself logged, shown for context |

An error expands into a block that stands on its own:

```
[02:40.118] ERROR   EXPAND    tutti.so                   the server refused a purchase the game rules allow  [E-REFUSED-VALID]
              | what      : The server refused a purchase the game rules allow
              | tiles     : hex_5,1 (open), hex_6,1 (open)
              | shown     : $30.00 = territory $30.00 + protection $0.00
              | rules     : allowed
              | request   : POST /api/checkout/create-session {"hexIds":["hex_5,1","hex_6,1"],...}
              | response  : 409 {"success":false,"error":"..."}
              | where     : Compare the rules (lib/hex/selectionEligibility.ts) with ...
```

Every error has a code in `[brackets]`. Search for it to find each occurrence; the summary counts them by code. The full catalogue is in `lib/errorCatalog.ts`.

**If something looks wrong:** send `latest.log` and `latest-server.log`, plus a line about what you saw in the browser. That is enough to find the cause.

## Final checks

- every owned tile belongs to a known company
- **no tile was ever sold twice from the same state** (double-sale detection)
- final owners and recorded prices match the chain of payments, tile by tile
- revenue shown on the map equals exactly what was paid for territory
- domains blocked for a chargeback never bought again
- no server crashes or 5xx responses
- every attack was stopped
- response times: map p95 under 1 s, checkout p95 under 8 s

## Good to know

- **Real sites are contacted.** The app reads each advertiser's website when they type the URL and again at each purchase, exactly as it would in production. That's a handful of ordinary page requests per site per run.
- **Brand colours** are picked by the simulator. A real buyer's browser samples them from the logo, and there is no browser here.
- **Rate limits are realistic.** Each simulated person has their own address, sent the way a proxy would send it, and never checks out more than 6 times a minute. A `WARN [E-RATE-LIMITED-USER]` therefore means a limit is too tight for normal use.
- **Races are expected at fast/turbo.** When two buyers act on the same tiles, one loses. That is logged as `INFO`, and only unexplained refusals are errors.

## Removing it before production

Nothing in `app/`, `components/` or `lib/` imports this folder, and `next build` never includes it. To remove it completely:

1. delete `simulation/`
2. in `package.json`, remove the four `sim*` scripts and the `tsx` devDependency
3. in `tsconfig.json`, remove `.next-sim/types/**/*.ts` from `include`
4. in `.gitignore`, remove the three simulator lines

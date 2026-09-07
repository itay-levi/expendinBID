-- Hex Wars — initial schema.
--
-- Design note that drives everything below: UNCLAIMED HEXES ARE NOT ROWS. A hex nobody has bought
-- has no state worth storing — its price is the base price, it has no owner, no lock, no history —
-- so it is derived from its coordinates in application code (lib/hex/hexIdentity.ts) and never
-- written. Consequences:
--   * the map is unbounded at zero storage cost, and "make the map bigger" is not a migration;
--   * table size tracks revenue, not world size;
--   * every read below is a primary-key hit or a bounded index range, never a full scan.

-- No BEGIN/COMMIT here: lib/db/migrate.ts wraps each file in one transaction, and committing
-- early would leave the schema applied with no ledger row, so the next boot re-runs the file.

CREATE TABLE empires (
  -- The hostname, which is also the application's natural identity for an empire. Deriving the id
  -- from the submitted URL server-side (rather than accepting a client-supplied one) is what makes
  -- "who is acquiring this" non-forgeable.
  id                  TEXT        PRIMARY KEY,
  domain              TEXT        NOT NULL,
  url                 TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  logo_url            TEXT        NOT NULL DEFAULT '',
  primary_color_hex   TEXT        NOT NULL DEFAULT '#8A2BE2',
  og_title            TEXT        NOT NULL DEFAULT '',
  og_description      TEXT        NOT NULL DEFAULT '',
  capital_hex_id      TEXT,
  -- Opt-in only. ARCHITECTURE.md §18 covers why there is no email column here.
  notify_webhook_url  TEXT,
  founded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT empires_color_is_hex CHECK (primary_color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE hexes (
  -- Axial coordinates are the real key; the composite primary key gives locality for free, so the
  -- neighbour lookups the adjacency rule performs land on adjacent index pages.
  q                   INTEGER     NOT NULL,
  r                   INTEGER     NOT NULL,
  owner_id            TEXT        NOT NULL REFERENCES empires(id) ON DELETE CASCADE,
  is_capital          BOOLEAN     NOT NULL DEFAULT FALSE,
  last_price_paid_cents BIGINT    NOT NULL,
  is_contested        BOOLEAN     NOT NULL DEFAULT FALSE,
  owned_since         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "Protect Hex" upsell (ARCHITECTURE.md §17). NULL = not protected.
  locked_until        TIMESTAMPTZ,

  PRIMARY KEY (q, r),
  CONSTRAINT hexes_price_non_negative CHECK (last_price_paid_cents >= 0)
);

-- "Show me everything this empire owns" — the leaderboard, the elimination check, and an empire's
-- own territory view. Without it, each of those is a sequential scan of every hex ever sold.
CREATE INDEX hexes_owner_idx ON hexes (owner_id);

-- Bounding-box queries for a viewport ("which sold hexes are on screen"). The renderer asks for a
-- rectangle of coordinates, so the range scan on q must be narrowed by r to stay bounded.
CREATE INDEX hexes_bbox_idx ON hexes (q, r) INCLUDE (owner_id);

-- Partial indexes: both predicates match a tiny fraction of rows, so indexing only the matching
-- ones keeps these small enough to stay cached regardless of how large the table grows.
CREATE INDEX hexes_contested_idx ON hexes (owner_id) WHERE is_contested;
CREATE INDEX hexes_locked_idx ON hexes (locked_until) WHERE locked_until IS NOT NULL;

CREATE TABLE takeover_events (
  id                  BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hex_q               INTEGER     NOT NULL,
  hex_r               INTEGER     NOT NULL,
  attacker_empire_id  TEXT        NOT NULL REFERENCES empires(id) ON DELETE CASCADE,
  defender_empire_id  TEXT        REFERENCES empires(id) ON DELETE SET NULL,
  price_paid_cents    BIGINT      NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The live ticker reads "most recent N events", which is this index scanned backwards.
CREATE INDEX takeover_events_created_at_idx ON takeover_events (created_at DESC);
CREATE INDEX takeover_events_hex_idx ON takeover_events (hex_q, hex_r, created_at DESC);

-- Idempotency for the payment webhook (ARCHITECTURE.md §12). A processor retries on any non-2xx,
-- and retries are expected rather than exceptional, so the same event WILL arrive twice. The unique
-- constraint is what makes applying it twice impossible — not an application-level "have I seen
-- this?" check, which races against itself under concurrency.
CREATE TABLE processed_webhook_events (
  webhook_id          TEXT        PRIMARY KEY,
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Old rows are only needed for as long as the processor might retry; without pruning this grows
-- forever. Index supports the delete-by-age job.
CREATE INDEX processed_webhook_events_processed_at_idx ON processed_webhook_events (processed_at);


-- ---------------------------------------------------------------------------------------------
-- The takeover transaction, for reference. `FOR UPDATE` is the entire concurrency story
-- (ARCHITECTURE.md §8): two attackers clicking the same hex in the same millisecond serialize
-- here, the second one re-reads the price the first just set, and its bid is re-validated against
-- that. Doing this check in application code instead — read, compare, write — is a lost update.
--
--   BEGIN;
--     SELECT last_price_paid_cents, locked_until
--       FROM hexes WHERE q = $1 AND r = $2
--       FOR UPDATE;
--     -- (no row: the hex is unsold, price is the base price, and the INSERT below claims it)
--     INSERT INTO hexes (q, r, owner_id, last_price_paid_cents, owned_since)
--       VALUES ($1, $2, $3, $4, now())
--       ON CONFLICT (q, r) DO UPDATE
--         SET owner_id = EXCLUDED.owner_id,
--             last_price_paid_cents = EXCLUDED.last_price_paid_cents,
--             owned_since = EXCLUDED.owned_since,
--             is_contested = FALSE;
--     INSERT INTO takeover_events (...) VALUES (...);
--   COMMIT;
--
-- Note the INSERT ... ON CONFLICT: because unsold hexes have no row, a first purchase is an insert
-- and a takeover is an update, and this expresses both without the application needing to know
-- which case it is.

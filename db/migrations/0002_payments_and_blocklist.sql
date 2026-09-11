-- Payment audit trail and chargeback blocklist.
--
-- A dispute from the payment provider carries only a payment id. Without a record tying that id to
-- the buyer, a chargeback could not be traced back to anyone, and "all sales are final" would be
-- unenforceable in practice. With it, a disputed payment identifies the domain that filed it, and
-- that domain can be refused future purchases.

CREATE TABLE settled_payments (
  provider      TEXT        NOT NULL,
  payment_id    TEXT        NOT NULL,
  empire_id     TEXT        NOT NULL REFERENCES empires(id),
  amount_cents  BIGINT      NOT NULL CHECK (amount_cents >= 0),
  currency      TEXT        NOT NULL,
  hex_ids       TEXT[]      NOT NULL,
  settled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, payment_id)
);
CREATE INDEX settled_payments_empire_idx ON settled_payments (empire_id, settled_at DESC);

-- Domains refused at checkout: filed a chargeback on delivered territory, or removed for abuse.
-- Keyed by hostname, the same identity empires use, so a blocked buyer cannot come back through a
-- different path to the same empire.
CREATE TABLE blocked_domains (
  domain       TEXT        PRIMARY KEY,
  reason       TEXT        NOT NULL,
  payment_id   TEXT,
  blocked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

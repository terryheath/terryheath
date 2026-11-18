'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(cfg.dataDir, 'shop.db'));

// the table was first called memberships: rename it once so existing rows are kept
try { if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memberships'").get()) { db.exec('ALTER TABLE memberships RENAME TO subscriptions'); db.exec('DROP INDEX IF EXISTS memberships_stripe'); db.exec('DROP INDEX IF EXISTS memberships_comp'); db.exec('DROP INDEX IF EXISTS memberships_email'); } } catch (e) { console.error('subscriptions table rename failed:', e.message); }

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS orders (
    session_id        TEXT PRIMARY KEY,
    payment_intent    TEXT,
    email             TEXT NOT NULL,
    name              TEXT,
    livemode          INTEGER NOT NULL DEFAULT 1,
    ordered_at        TEXT NOT NULL,
    recorded_at       TEXT NOT NULL,
    purchase_email_at TEXT,
    staff_email_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS links (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES orders(session_id),
    line_index    INTEGER NOT NULL,
    original      INTEGER NOT NULL DEFAULT 1,
    product_id    TEXT,
    sku           TEXT,
    title         TEXT NOT NULL,
    file_key      TEXT,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
    release_at    TEXT,
    issued_at     TEXT,
    expires_at    TEXT,
    max_downloads INTEGER NOT NULL,
    emailed_at    TEXT,
    revoked_at    TEXT,
    replaced_by   TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS links_original_line
    ON links (session_id, line_index) WHERE original = 1;
  CREATE INDEX IF NOT EXISTS links_status ON links (status);

  CREATE TABLE IF NOT EXISTS downloads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id      TEXT NOT NULL REFERENCES links(id),
    at           TEXT NOT NULL,
    completed_at TEXT,
    ip_hash      TEXT,
    user_agent   TEXT
  );
  CREATE INDEX IF NOT EXISTS downloads_link ON downloads (link_id);

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    session_id TEXT,
    link_id    TEXT,
    kind       TEXT NOT NULL,
    detail     TEXT
  );
  CREATE INDEX IF NOT EXISTS events_session ON events (session_id);

  -- Subscriptions (replace Ghost tiers). One row per entitlement: paid by Stripe subscription, or complimentary.
  CREATE TABLE IF NOT EXISTS members (
    email           TEXT PRIMARY KEY,
    name            TEXT,
    stripe_customer TEXT,
    created_at      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL REFERENCES members(email),
    publication         TEXT NOT NULL,                       -- 'review' | 'whiterabbit'
    kind                TEXT NOT NULL,                       -- 'ebook' | 'print'
    source              TEXT NOT NULL,                       -- 'stripe' | 'comp' (granted from a signed agreement that chose a subscription)
    stripe_subscription TEXT,
    status              TEXT NOT NULL,                       -- 'active' | 'past_due' | 'canceled' | 'expired'
    period_end          TEXT,                                -- paid: end of the current period; comp: expiry
    note                TEXT,                                -- e.g. 'Subscription taken in place of payment: <piece> (<issue>)'
    ref                 TEXT,                                -- agreement submission id for comps
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe ON subscriptions (stripe_subscription, publication) WHERE stripe_subscription IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_comp ON subscriptions (ref, publication) WHERE source = 'comp' AND ref IS NOT NULL;
  CREATE INDEX IF NOT EXISTS subscriptions_email ON subscriptions (email);
`);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function logEvent(kind, { sessionId = null, linkId = null, detail = null } = {}) {
  db.prepare('INSERT INTO events (at, session_id, link_id, kind, detail) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), sessionId, linkId, kind, detail);
}

module.exports = { db, tx, logEvent };

import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { config } from './config.js';

fs.mkdirSync(path.dirname(config.database.path), { recursive: true });

export const db = new Database(config.database.path);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableHasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS discord_users (
    discord_user_id TEXT PRIMARY KEY,
    supabase_user_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pageant_sessions (
    id TEXT PRIMARY KEY,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    left_harmie_id TEXT NOT NULL,
    right_harmie_id TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    expires_at TEXT,
    winner_harmie_id TEXT,
    loser_harmie_id TEXT,
    resolved_by_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    closed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pageant_sessions_message_id ON pageant_sessions (message_id);
  CREATE INDEX IF NOT EXISTS idx_pageant_sessions_status ON pageant_sessions (status);

  CREATE TABLE IF NOT EXISTS pageant_session_votes (
    session_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    selected_side TEXT NOT NULL,
    winner_harmie_id TEXT NOT NULL,
    loser_harmie_id TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, voter_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pageant_session_votes_session
    ON pageant_session_votes (session_id, created_at);

  CREATE TABLE IF NOT EXISTS local_harmie_stats (
    harmie_id TEXT PRIMARY KEY,
    elo_score INTEGER NOT NULL DEFAULT 1200,
    total_matches INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS local_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    voter_id TEXT NOT NULL,
    winner_harmie_id TEXT NOT NULL,
    loser_harmie_id TEXT NOT NULL,
    pair_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_local_votes_voter ON local_votes (voter_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_local_votes_pair ON local_votes (voter_id, pair_key, created_at);

  CREATE TABLE IF NOT EXISTS wallet_challenges (
    token TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT,
    nonce TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    wallet_address TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    operation TEXT NOT NULL DEFAULT 'link',
    target_wallet_address TEXT,
    csrf_token TEXT,
    request_id TEXT,
    siws_input_json TEXT,
    created_ip_hash TEXT,
    user_agent TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_wallet_challenges_user ON wallet_challenges (discord_user_id, status);

  CREATE TABLE IF NOT EXISTS verified_wallets (
    discord_user_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL UNIQUE,
    harmie_count INTEGER NOT NULL DEFAULT 0,
    collection_share REAL NOT NULL DEFAULT 0,
    verified_at TEXT NOT NULL,
    last_checked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_wallet_holdings (
    discord_user_id TEXT NOT NULL,
    mint_address TEXT NOT NULL,
    name TEXT,
    image_url TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (discord_user_id, mint_address)
  );

  CREATE TABLE IF NOT EXISTS verified_wallet_links (
    id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL UNIQUE,
    wallet_label TEXT,
    verification_method TEXT NOT NULL DEFAULT 'siws',
    is_primary INTEGER NOT NULL DEFAULT 0,
    harmie_count INTEGER NOT NULL DEFAULT 0,
    collection_share REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    last_status_reason TEXT,
    verified_at TEXT NOT NULL,
    last_checked_at TEXT NOT NULL,
    last_success_at TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_verified_wallet_links_user
    ON verified_wallet_links (discord_user_id, verified_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_wallet_links_primary
    ON verified_wallet_links (discord_user_id)
    WHERE is_primary = 1;

  CREATE TABLE IF NOT EXISTS verified_wallet_link_holdings (
    wallet_link_id TEXT NOT NULL,
    mint_address TEXT NOT NULL,
    name TEXT,
    image_url TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (wallet_link_id, mint_address),
    FOREIGN KEY (wallet_link_id) REFERENCES verified_wallet_links(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS guild_wallet_memberships (
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    activity_channel_id TEXT,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, discord_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_guild_wallet_memberships_user
    ON guild_wallet_memberships (discord_user_id);

  CREATE TABLE IF NOT EXISTS guild_trade_announcements (
    guild_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    announced_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, signature)
  );

  CREATE INDEX IF NOT EXISTS idx_guild_trade_announcements_guild
    ON guild_trade_announcements (guild_id);

  CREATE TABLE IF NOT EXISTS guild_card_messages (
    guild_id TEXT NOT NULL,
    card_kind TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, card_kind)
  );

  CREATE TABLE IF NOT EXISTS wallet_verification_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    discord_user_id TEXT,
    wallet_address TEXT,
    challenge_token TEXT,
    request_ip_hash TEXT,
    user_agent TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_wallet_verification_audit_log_created_at
    ON wallet_verification_audit_log (created_at);
  CREATE INDEX IF NOT EXISTS idx_wallet_verification_audit_log_user
    ON wallet_verification_audit_log (discord_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_wallet_verification_audit_log_ip
    ON wallet_verification_audit_log (request_ip_hash, created_at);
`);

if (!tableHasColumn('wallet_challenges', 'channel_id')) {
  db.exec(`ALTER TABLE wallet_challenges ADD COLUMN channel_id TEXT`);
}

if (!tableHasColumn('guild_wallet_memberships', 'activity_channel_id')) {
  db.exec(`ALTER TABLE guild_wallet_memberships ADD COLUMN activity_channel_id TEXT`);
}

if (!tableHasColumn('pageant_sessions', 'expires_at')) {
  db.exec(`ALTER TABLE pageant_sessions ADD COLUMN expires_at TEXT`);
}

if (!tableHasColumn('pageant_sessions', 'closed_at')) {
  db.exec(`ALTER TABLE pageant_sessions ADD COLUMN closed_at TEXT`);
}

for (const [columnName, definition] of [
  ['operation', `TEXT NOT NULL DEFAULT 'link'`],
  ['target_wallet_address', 'TEXT'],
  ['csrf_token', 'TEXT'],
  ['request_id', 'TEXT'],
  ['siws_input_json', 'TEXT'],
  ['created_ip_hash', 'TEXT'],
  ['user_agent', 'TEXT'],
  ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['failure_reason', 'TEXT'],
]) {
  if (!tableHasColumn('wallet_challenges', columnName)) {
    db.exec(`ALTER TABLE wallet_challenges ADD COLUMN ${columnName} ${definition}`);
  }
}

const migrateLegacyWalletRows = db.transaction(() => {
  const legacyRows = db.prepare(`
    SELECT discord_user_id, wallet_address, harmie_count, collection_share, verified_at, last_checked_at
    FROM verified_wallets
  `).all();

  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO verified_wallet_links (
      id,
      discord_user_id,
      wallet_address,
      verification_method,
      is_primary,
      harmie_count,
      collection_share,
      status,
      verified_at,
      last_checked_at,
      last_success_at,
      consecutive_failures
    )
    VALUES (?, ?, ?, 'legacy', 1, ?, ?, 'active', ?, ?, ?, 0)
  `);

  const insertHolding = db.prepare(`
    INSERT OR IGNORE INTO verified_wallet_link_holdings (
      wallet_link_id,
      mint_address,
      name,
      image_url,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const row of legacyRows) {
    const linkId = `legacy:${row.discord_user_id}:${row.wallet_address}`;
    insertLink.run(
      linkId,
      row.discord_user_id,
      row.wallet_address,
      row.harmie_count,
      row.collection_share,
      row.verified_at,
      row.last_checked_at,
      row.last_checked_at,
    );

    const holdings = db.prepare(`
      SELECT mint_address, name, image_url, updated_at
      FROM verified_wallet_holdings
      WHERE discord_user_id = ?
    `).all(row.discord_user_id);

    for (const holding of holdings) {
      insertHolding.run(
        linkId,
        holding.mint_address,
        holding.name,
        holding.image_url,
        holding.updated_at,
      );
    }
  }
});

migrateLegacyWalletRows();

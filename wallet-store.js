import { randomUUID } from 'node:crypto';

import { createSignInMessageText } from '@solana/wallet-standard-util';

import { config } from './config.js';
import { db } from './db.js';
import { createSignedRequestId, createWalletNonce, randomToken } from './security.js';

function createError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function nowIso() {
  return new Date().toISOString();
}

function buildSiwsInput({
  discordUserId,
  token,
  nonce,
  createdAt,
  expiresAt,
  operation,
  targetWalletAddress,
}) {
  const requestId = createSignedRequestId({
    token,
    discordUserId,
    nonce,
    operation,
    targetWalletAddress: targetWalletAddress || null,
    issuedAt: createdAt,
  });

  const input = {
    domain: config.web.host,
    statement:
      operation === 'reverify'
        ? 'Verify you still control this wallet for Harmie Bot.'
        : 'Verify ownership of this wallet for Harmie Bot.',
    uri: `${config.web.publicBaseUrl}/verify`,
    version: '1',
    chainId: config.solana.chainId,
    nonce,
    issuedAt: createdAt,
    expirationTime: expiresAt,
    notBefore: createdAt,
    requestId,
    resources: [
      `${config.web.publicBaseUrl}/verify`,
      `${config.market.magicEdenCollectionUrl}`,
      `solana:collection/${config.solana.collectionMint}`,
    ],
  };

  return {
    input,
    requestId,
    preview: createSignInMessageText({
      ...input,
      address: targetWalletAddress || '<wallet selected in your wallet app>',
    }),
  };
}

export function createWalletChallenge({
  discordUserId,
  guildId = null,
  channelId = null,
  operation = 'link',
  targetWalletAddress = null,
  requestIpHash = null,
  userAgent = null,
}) {
  const token = randomUUID();
  const nonce = createWalletNonce(18);
  const csrfToken = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.wallet.nonceTtlSeconds * 1000).toISOString();
  const { input, requestId, preview } = buildSiwsInput({
    discordUserId,
    token,
    nonce,
    createdAt,
    expiresAt,
    operation,
    targetWalletAddress,
  });

  db.prepare(`
    INSERT INTO wallet_challenges (
      token,
      discord_user_id,
      guild_id,
      channel_id,
      nonce,
      message,
      status,
      wallet_address,
      created_at,
      expires_at,
      operation,
      target_wallet_address,
      csrf_token,
      request_id,
      siws_input_json,
      created_ip_hash,
      user_agent,
      attempts
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    token,
    discordUserId,
    guildId,
    channelId,
    nonce,
    preview,
    createdAt,
    expiresAt,
    operation,
    targetWalletAddress,
    csrfToken,
    requestId,
    JSON.stringify(input),
    requestIpHash,
    userAgent,
  );

  return {
    token,
    discordUserId,
    guildId,
    channelId,
    operation,
    targetWalletAddress,
    csrfToken,
    signInInput: input,
    createdAt,
    expiresAt,
  };
}

export function getWalletChallenge(token) {
  const row =
    db.prepare(`
      SELECT *
      FROM wallet_challenges
      WHERE token = ?
    `).get(token) || null;

  if (!row) {
    return null;
  }

  return {
    ...row,
    sign_in_input: row.siws_input_json ? JSON.parse(row.siws_input_json) : null,
  };
}

export function incrementWalletChallengeAttempt(token, failureReason = null) {
  db.prepare(`
    UPDATE wallet_challenges
    SET
      attempts = attempts + 1,
      failure_reason = ?
    WHERE token = ?
  `).run(failureReason, token);

  return getWalletChallenge(token);
}

export function markWalletChallengeUsed(token, walletAddress) {
  const result = db.prepare(`
    UPDATE wallet_challenges
    SET
      status = 'used',
      wallet_address = ?,
      used_at = ?,
      failure_reason = NULL
    WHERE token = ? AND status = 'pending'
  `).run(walletAddress, nowIso(), token);

  return result.changes === 1;
}

export function revokeWalletChallenge(token, reason) {
  db.prepare(`
    UPDATE wallet_challenges
    SET
      status = 'revoked',
      failure_reason = ?
    WHERE token = ? AND status = 'pending'
  `).run(reason, token);
}

export function logWalletAuditEvent({
  eventType,
  status,
  discordUserId = null,
  walletAddress = null,
  challengeToken = null,
  requestIpHash = null,
  userAgent = null,
  details = null,
}) {
  db.prepare(`
    INSERT INTO wallet_verification_audit_log (
      event_type,
      status,
      discord_user_id,
      wallet_address,
      challenge_token,
      request_ip_hash,
      user_agent,
      details_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    status,
    discordUserId,
    walletAddress,
    challengeToken,
    requestIpHash,
    userAgent,
    details ? JSON.stringify(details) : null,
    nowIso(),
  );
}

export function countRecentWalletAuditEvents({
  eventType = null,
  discordUserId = null,
  requestIpHash = null,
  sinceMs,
}) {
  const createdAfter = new Date(Date.now() - sinceMs).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM wallet_verification_audit_log
    WHERE created_at >= ?
      AND (? IS NULL OR event_type = ?)
      AND (? IS NULL OR discord_user_id = ?)
      AND (? IS NULL OR request_ip_hash = ?)
  `).get(
    createdAfter,
    eventType,
    eventType,
    discordUserId,
    discordUserId,
    requestIpHash,
    requestIpHash,
  );

  return row?.count ?? 0;
}

export function countUserWalletLinks(discordUserId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM verified_wallet_links
    WHERE discord_user_id = ?
  `).get(discordUserId);

  return row?.count ?? 0;
}

export function getWalletLinkByAddress(discordUserId, walletAddress) {
  return (
    db.prepare(`
      SELECT *
      FROM verified_wallet_links
      WHERE discord_user_id = ? AND wallet_address = ?
    `).get(discordUserId, walletAddress) || null
  );
}

function getPrimaryWalletLink(discordUserId) {
  return (
    db.prepare(`
      SELECT *
      FROM verified_wallet_links
      WHERE discord_user_id = ? AND is_primary = 1
      LIMIT 1
    `).get(discordUserId) || null
  );
}

export function listWalletLinks(discordUserId) {
  return db.prepare(`
    SELECT *
    FROM verified_wallet_links
    WHERE discord_user_id = ?
    ORDER BY is_primary DESC, verified_at ASC, wallet_address ASC
  `).all(discordUserId);
}

export function listWalletLinkHoldings(walletLinkId) {
  return db.prepare(`
    SELECT mint_address, name, image_url, updated_at
    FROM verified_wallet_link_holdings
    WHERE wallet_link_id = ?
    ORDER BY mint_address ASC
  `).all(walletLinkId);
}

export const replaceWalletHoldings = db.transaction((walletLinkId, holdings) => {
  const timestamp = nowIso();

  db.prepare(`
    DELETE FROM verified_wallet_link_holdings
    WHERE wallet_link_id = ?
  `).run(walletLinkId);

  const insert = db.prepare(`
    INSERT INTO verified_wallet_link_holdings (
      wallet_link_id,
      mint_address,
      name,
      image_url,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const holding of holdings) {
    insert.run(
      walletLinkId,
      holding.mintAddress,
      holding.name || null,
      holding.image || null,
      timestamp,
    );
  }
});

export const saveVerifiedWalletLink = db.transaction(
  ({
    discordUserId,
    guildId = null,
    activityChannelId = null,
    walletAddress,
    walletLabel = null,
    harmieCount,
    totalSupply = 500,
    verificationMethod = 'siws',
  }) => {
    const existingOwner = db.prepare(`
      SELECT discord_user_id
      FROM verified_wallet_links
      WHERE wallet_address = ?
    `).get(walletAddress);

    if (existingOwner && existingOwner.discord_user_id !== discordUserId) {
      throw createError('That wallet is already linked to another Discord user.', {
        kind: 'policy',
      });
    }

    const timestamp = nowIso();
    const existingLink = getWalletLinkByAddress(discordUserId, walletAddress);
    const shouldBePrimary = existingLink?.is_primary || !getPrimaryWalletLink(discordUserId);
    const linkId = existingLink?.id || randomUUID();

    if (shouldBePrimary) {
      db.prepare(`
        UPDATE verified_wallet_links
        SET is_primary = 0
        WHERE discord_user_id = ?
      `).run(discordUserId);
    }

    db.prepare(`
      INSERT INTO verified_wallet_links (
        id,
        discord_user_id,
        wallet_address,
        wallet_label,
        verification_method,
        is_primary,
        harmie_count,
        collection_share,
        status,
        last_status_reason,
        verified_at,
        last_checked_at,
        last_success_at,
        consecutive_failures
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        wallet_address = excluded.wallet_address,
        wallet_label = excluded.wallet_label,
        verification_method = excluded.verification_method,
        is_primary = excluded.is_primary,
        harmie_count = excluded.harmie_count,
        collection_share = excluded.collection_share,
        status = 'active',
        last_status_reason = NULL,
        verified_at = excluded.verified_at,
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        consecutive_failures = 0
    `).run(
      linkId,
      discordUserId,
      walletAddress,
      walletLabel,
      verificationMethod,
      shouldBePrimary ? 1 : 0,
      harmieCount,
      totalSupply > 0 ? harmieCount / totalSupply : 0,
      timestamp,
      timestamp,
      timestamp,
    );

    if (guildId) {
      db.prepare(`
        INSERT INTO guild_wallet_memberships (
          guild_id,
          discord_user_id,
          activity_channel_id,
          linked_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
          activity_channel_id = excluded.activity_channel_id,
          linked_at = excluded.linked_at
      `).run(guildId, discordUserId, activityChannelId, timestamp);
    }

    return db.prepare(`
      SELECT *
      FROM verified_wallet_links
      WHERE id = ?
    `).get(linkId);
  },
);

export function getWalletSummary(discordUserId) {
  const wallets = listWalletLinks(discordUserId);
  if (wallets.length === 0) {
    return null;
  }

  const totalHeld = wallets.reduce((sum, wallet) => sum + (wallet.harmie_count || 0), 0);
  const totalShare = wallets.reduce((sum, wallet) => sum + (wallet.collection_share || 0), 0);
  const primary = wallets.find((wallet) => wallet.is_primary) || wallets[0];

  return {
    discord_user_id: discordUserId,
    total_harmie_count: totalHeld,
    total_collection_share: totalShare,
    primary_wallet_address: primary.wallet_address,
    last_checked_at: wallets.reduce(
      (latest, wallet) =>
        !latest || Date.parse(wallet.last_checked_at) > Date.parse(latest)
          ? wallet.last_checked_at
          : latest,
      null,
    ),
    wallets,
  };
}

export function updateWalletLinkSnapshot(walletLinkId, harmieCount, totalSupply = 500) {
  db.prepare(`
    UPDATE verified_wallet_links
    SET
      harmie_count = ?,
      collection_share = ?,
      status = 'active',
      last_status_reason = NULL,
      last_checked_at = ?,
      last_success_at = ?,
      consecutive_failures = 0
    WHERE id = ?
  `).run(
    harmieCount,
    totalSupply > 0 ? harmieCount / totalSupply : 0,
    nowIso(),
    nowIso(),
    walletLinkId,
  );

  return (
    db.prepare(`
      SELECT *
      FROM verified_wallet_links
      WHERE id = ?
    `).get(walletLinkId) || null
  );
}

export function markWalletLinkRefreshFailure(walletLinkId, reason) {
  const link = db.prepare(`
    SELECT consecutive_failures
    FROM verified_wallet_links
    WHERE id = ?
  `).get(walletLinkId);

  if (!link) {
    return null;
  }

  const failures = (link.consecutive_failures || 0) + 1;
  const status = failures >= config.wallet.staleFailureThreshold ? 'stale' : 'active';

  db.prepare(`
    UPDATE verified_wallet_links
    SET
      consecutive_failures = ?,
      status = ?,
      last_status_reason = ?,
      last_checked_at = ?
    WHERE id = ?
  `).run(failures, status, reason, nowIso(), walletLinkId);

  return (
    db.prepare(`
      SELECT *
      FROM verified_wallet_links
      WHERE id = ?
    `).get(walletLinkId) || null
  );
}

export const removeWalletLink = db.transaction((discordUserId, walletAddress) => {
  const link = getWalletLinkByAddress(discordUserId, walletAddress);
  if (!link) {
    return false;
  }

  db.prepare(`
    DELETE FROM verified_wallet_links
    WHERE id = ?
  `).run(link.id);

  if (link.is_primary) {
    const replacement = db.prepare(`
      SELECT id
      FROM verified_wallet_links
      WHERE discord_user_id = ?
      ORDER BY verified_at ASC
      LIMIT 1
    `).get(discordUserId);

    if (replacement) {
      db.prepare(`
        UPDATE verified_wallet_links
        SET is_primary = 1
        WHERE id = ?
      `).run(replacement.id);
    }
  }

  return true;
});

export function listGuildVerifiedWallets(guildId) {
  return db.prepare(`
    SELECT
      memberships.guild_id,
      links.id AS wallet_link_id,
      links.discord_user_id,
      links.wallet_address,
      links.wallet_label,
      links.is_primary,
      links.harmie_count,
      links.collection_share,
      links.status,
      links.last_status_reason,
      links.verified_at,
      links.last_checked_at,
      links.last_success_at,
      links.consecutive_failures
    FROM guild_wallet_memberships AS memberships
    INNER JOIN verified_wallet_links AS links
      ON links.discord_user_id = memberships.discord_user_id
    WHERE memberships.guild_id = ?
    ORDER BY links.harmie_count DESC, links.verified_at ASC
  `).all(guildId);
}

export function listTrackedWalletMemberships() {
  return db.prepare(`
    SELECT
      memberships.guild_id,
      memberships.discord_user_id,
      memberships.activity_channel_id,
      links.id AS wallet_link_id,
      links.wallet_address,
      links.wallet_label,
      links.is_primary,
      links.harmie_count,
      links.collection_share,
      links.status,
      links.last_status_reason,
      links.verified_at,
      links.last_checked_at,
      links.last_success_at,
      links.consecutive_failures
    FROM guild_wallet_memberships AS memberships
    INNER JOIN verified_wallet_links AS links
      ON links.discord_user_id = memberships.discord_user_id
    ORDER BY memberships.guild_id, memberships.discord_user_id, links.verified_at
  `).all();
}

export function getGuildWalletAuditSnapshot(guildId) {
  const rows = listGuildVerifiedWallets(guildId);
  const linkedMembers = new Set(rows.map((row) => row.discord_user_id)).size;
  const staleLinks = rows.filter((row) => row.status === 'stale');
  const activeLinks = rows.filter((row) => row.status === 'active');

  return {
    linkedMembers,
    linkedWallets: rows.length,
    activeWallets: activeLinks.length,
    staleWallets: staleLinks.length,
    staleLinks: staleLinks.slice(0, 10),
  };
}

export function hasGuildTradeHistory(guildId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM guild_trade_announcements
    WHERE guild_id = ?
  `).get(guildId);

  return (row?.count ?? 0) > 0;
}

export function hasGuildTradeBeenAnnounced(guildId, signature) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM guild_trade_announcements
      WHERE guild_id = ? AND signature = ?
    `).get(guildId, signature),
  );
}

export const markGuildTradeAnnounced = db.transaction((guildId, signatures) => {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO guild_trade_announcements (
      guild_id,
      signature,
      announced_at
    )
    VALUES (?, ?, ?)
  `);

  const timestamp = nowIso();
  for (const signature of signatures) {
    insert.run(guildId, signature, timestamp);
  }
});

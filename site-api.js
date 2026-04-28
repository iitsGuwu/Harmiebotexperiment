import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { decryptSecret, encryptSecret } from './security.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

const harmieCache = {
  data: null,
  fetchedAt: 0,
};

function createError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function authHeaders(accessToken = config.supabase.key) {
  return {
    apikey: config.supabase.key,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function supabaseJson(url, { method = 'GET', accessToken, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: authHeaders(accessToken),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.msg ||
      payload?.error_description ||
      payload?.error ||
      `Supabase request failed with status ${response.status}`;

    throw createError(message, {
      status: response.status,
      payload,
    });
  }

  return payload;
}

async function relayJson(url, { method = 'POST', body, secret, timeoutMs } = {}) {
  const rawBody = JSON.stringify(body ?? {});
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'X-Harmie-Bot-Timestamp': timestamp,
      'X-Harmie-Bot-Signature': signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      `Relay request failed with status ${response.status}`;

    throw createError(message, {
      status: response.status,
      payload,
    });
  }

  return payload;
}

function mapAttributes(attributes) {
  if (Array.isArray(attributes)) {
    return Object.fromEntries(
      attributes
        .filter((item) => item && item.trait_type && item.value !== undefined)
        .map((item) => [item.trait_type, item.value]),
    );
  }

  if (attributes && typeof attributes === 'object') {
    return attributes;
  }

  return {};
}

function mapHarmie(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const attributes = mapAttributes(metadata.attributes);

  return {
    id: row.id,
    name: row.name || `Harmie ${row.id}`,
    image: row.image_url || metadata.image || '',
    description: metadata.description || '',
    attributes,
    eloScore: row.elo_score ?? config.pageant.defaultElo,
    totalMatches: row.total_matches ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
  };
}

function sortByRanking(a, b) {
  return (
    (b.eloScore ?? config.pageant.defaultElo) - (a.eloScore ?? config.pageant.defaultElo) ||
    (b.totalMatches ?? 0) - (a.totalMatches ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export async function listSiteHarmies({ force = false } = {}) {
  if (!force && harmieCache.data && Date.now() - harmieCache.fetchedAt < CACHE_TTL_MS) {
    return harmieCache.data;
  }

  const url = new URL(`${config.supabase.url}/rest/v1/harmies`);
  url.searchParams.set('select', 'id,name,image_url,metadata,elo_score,total_matches,wins,losses');
  url.searchParams.set('order', 'name.asc');

  const rows = await supabaseJson(url.toString());
  const harmies = Array.isArray(rows) ? rows.map(mapHarmie) : [];

  harmieCache.data = harmies;
  harmieCache.fetchedAt = Date.now();

  return harmies;
}

export function invalidateSiteHarmiesCache() {
  harmieCache.fetchedAt = 0;
}

export async function getSiteRankings(limit = 10) {
  const harmies = await listSiteHarmies();
  return [...harmies].sort(sortByRanking).slice(0, limit);
}

export async function findSiteHarmie(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return null;

  const harmies = await listSiteHarmies();

  const exact = harmies.find(
    (harmie) =>
      harmie.id.toLowerCase() === normalized ||
      harmie.name.toLowerCase() === normalized ||
      harmie.name.toLowerCase() === `harmies #${normalized}` ||
      harmie.name.toLowerCase() === `harmie #${normalized}`,
  );

  if (exact) return exact;

  if (/^\d+$/.test(normalized)) {
    const byNumber = harmies.find((harmie) => harmie.name.toLowerCase().includes(`#${normalized}`));
    if (byNumber) return byNumber;
  }

  return (
    harmies.find((harmie) => harmie.name.toLowerCase().includes(normalized)) ||
    harmies.find((harmie) => harmie.id.toLowerCase().includes(normalized)) ||
    null
  );
}

function saveDiscordIdentity(discordUserId, session) {
  db.prepare(`
    INSERT INTO discord_users (
      discord_user_id,
      supabase_user_id,
      access_token,
      refresh_token,
      expires_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      supabase_user_id = excluded.supabase_user_id,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    discordUserId,
    session.user?.id || null,
    encryptSecret(session.access_token),
    encryptSecret(session.refresh_token),
    session.expires_at,
    new Date().toISOString(),
  );
}

function getStoredDiscordIdentity(discordUserId) {
  const row =
    db.prepare(`
      SELECT discord_user_id, supabase_user_id, access_token, refresh_token, expires_at
      FROM discord_users
      WHERE discord_user_id = ?
    `).get(discordUserId) || null;

  if (!row) {
    return null;
  }

  return {
    ...row,
    access_token: decryptSecret(row.access_token),
    refresh_token: decryptSecret(row.refresh_token),
  };
}

async function createDiscordIdentity(discordUserId) {
  const session = await supabaseJson(`${config.supabase.url}/auth/v1/signup`, {
    method: 'POST',
    body: {
      data: {
        discord_user_id: discordUserId,
        source: 'harmie-discord-bot',
      },
    },
  });

  saveDiscordIdentity(discordUserId, session);
  return getStoredDiscordIdentity(discordUserId);
}

async function refreshDiscordIdentity(record) {
  const session = await supabaseJson(
    `${config.supabase.url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      body: {
        refresh_token: record.refresh_token,
      },
    },
  );

  saveDiscordIdentity(record.discord_user_id, session);
  return getStoredDiscordIdentity(record.discord_user_id);
}

export async function ensureDiscordIdentity(discordUserId) {
  const existing = getStoredDiscordIdentity(discordUserId);
  const now = Math.floor(Date.now() / 1000);
  const minExpiry = now + config.pageant.siteSessionRefreshSkewSeconds;

  if (!existing) {
    return createDiscordIdentity(discordUserId);
  }

  if (existing.expires_at > minExpiry) {
    return existing;
  }

  try {
    return await refreshDiscordIdentity(existing);
  } catch {
    return createDiscordIdentity(discordUserId);
  }
}

function normalizeSiteVoteMessage(rawMessage) {
  const lower = String(rawMessage || '').toLowerCase();

  if (lower.includes('already voted') || lower.includes('duplicate')) {
    return 'You already voted on this exact matchup recently.';
  }

  if (lower.includes('daily vote limit')) {
    return 'You hit the site vote limit for today. Try again tomorrow.';
  }

  if (lower.includes('too fast') || lower.includes('rate limit') || lower.includes('too many')) {
    return 'Slow down a bit before casting another vote.';
  }

  if (lower.includes('not found')) {
    return 'That Harmie pair could not be found on the site right now.';
  }

  if (lower.includes('not authenticated')) {
    return 'The bot could not authenticate against the site vote API.';
  }

  return rawMessage || 'The site rejected this vote.';
}

function classifySiteVoteError(rawMessage) {
  const lower = String(rawMessage || '').toLowerCase();

  if (
    lower.includes('already voted') ||
    lower.includes('duplicate') ||
    lower.includes('daily vote limit') ||
    lower.includes('too fast') ||
    lower.includes('rate limit') ||
    lower.includes('too many') ||
    lower.includes('not found')
  ) {
    return 'policy';
  }

  return 'integration';
}

export async function submitSiteVote({ discordUserId, winnerId, loserId }) {
  let identity;

  try {
    identity = await ensureDiscordIdentity(discordUserId);
  } catch (error) {
    throw createError(`Site voting is unavailable right now: ${error.message}`, {
      kind: 'integration',
      cause: error,
    });
  }

  let payload;

  try {
    payload = await supabaseJson(`${config.supabase.url}/rest/v1/rpc/submit_vote`, {
      method: 'POST',
      accessToken: identity.access_token,
      body: {
        p_winner_id: winnerId,
        p_loser_id: loserId,
        p_fingerprint: null,
      },
    });
  } catch (error) {
    throw createError(`The site vote RPC could not be reached: ${error.message}`, {
      kind: 'integration',
      cause: error,
    });
  }

  if (payload?.success === false) {
    const message = normalizeSiteVoteMessage(payload.error);

    throw createError(message, {
      kind: classifySiteVoteError(payload.error),
      siteError: payload.error,
    });
  }

  return {
    mode: 'site',
  };
}

export async function submitRelayVote({
  sessionId,
  discordUserId,
  discordGuildId,
  winnerId,
  loserId,
  interactionId,
}) {
  const relayUrl = config.pageant.relay.url;
  const relaySecret = config.pageant.relay.secret;

  if (!relayUrl || !relaySecret) {
    throw createError('Relay voting is not configured yet. Add PAGEANT_RELAY_URL and PAGEANT_RELAY_SECRET.', {
      kind: 'integration',
    });
  }

  let payload;

  try {
    payload = await relayJson(relayUrl, {
      method: 'POST',
      secret: relaySecret,
      timeoutMs: config.pageant.relay.timeoutMs,
      body: {
        matchupId: sessionId,
        winnerId,
        loserId,
        discordUserId,
        discordGuildId,
        interactionId,
        idempotencyKey: interactionId || `${sessionId}:${discordUserId}:${winnerId}:${loserId}`,
      },
    });
  } catch (error) {
    throw createError(`The pageant relay could not be reached: ${error.message}`, {
      kind: 'integration',
      cause: error,
    });
  }

  if (payload?.success === false) {
    const message = normalizeSiteVoteMessage(payload.error || payload.message);

    throw createError(message, {
      kind: classifySiteVoteError(payload.error || payload.message),
      relayError: payload.error || payload.message,
    });
  }

  return {
    mode: 'relay',
    relay: payload,
  };
}

export { sortByRanking };

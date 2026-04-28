import { randomUUID } from 'node:crypto';

import { config } from './config.js';
import { db } from './db.js';

function createError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function pairKeyFor(leftHarmieId, rightHarmieId) {
  return [leftHarmieId, rightHarmieId].sort().join(':');
}

export function createPageantSession({
  guildId,
  channelId,
  messageId = null,
  createdByUserId,
  leftHarmieId,
  rightHarmieId,
  sourceMode,
}) {
  const id = randomUUID();
  const expiresAt = addMinutes(new Date(), config.pageant.votingWindowMinutes).toISOString();

  db.prepare(`
    INSERT INTO pageant_sessions (
      id,
      guild_id,
      channel_id,
      message_id,
      left_harmie_id,
      right_harmie_id,
      source_mode,
      created_by_user_id,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    guildId,
    channelId,
    messageId,
    leftHarmieId,
    rightHarmieId,
    sourceMode,
    createdByUserId,
    expiresAt,
  );

  return getPageantSession(id);
}

export function attachMessageToSession(sessionId, messageId) {
  db.prepare(`
    UPDATE pageant_sessions
    SET message_id = ?
    WHERE id = ?
  `).run(messageId, sessionId);
}

export function updatePageantSessionSourceMode(sessionId, sourceMode) {
  db.prepare(`
    UPDATE pageant_sessions
    SET source_mode = ?
    WHERE id = ?
  `).run(sourceMode, sessionId);
}

export function getPageantSession(sessionId) {
  return (
    db.prepare(`
      SELECT *
      FROM pageant_sessions
      WHERE id = ?
    `).get(sessionId) || null
  );
}

export function claimPageantSession(sessionId) {
  const result = db.prepare(`
    UPDATE pageant_sessions
    SET status = 'processing'
    WHERE id = ? AND status = 'open'
  `).run(sessionId);

  return result.changes === 1;
}

export function reopenPageantSession(sessionId) {
  db.prepare(`
    UPDATE pageant_sessions
    SET status = 'open'
    WHERE id = ? AND status = 'processing'
  `).run(sessionId);
}

export function closePageantSession(
  sessionId,
  { status, resolvedByUserId, winnerHarmieId = null, loserHarmieId = null },
) {
  db.prepare(`
    UPDATE pageant_sessions
    SET
      status = ?,
      resolved_by_user_id = ?,
      winner_harmie_id = ?,
      loser_harmie_id = ?,
      resolved_at = ?,
      closed_at = ?
    WHERE id = ? AND status IN ('processing', 'open')
  `).run(status, resolvedByUserId, winnerHarmieId, loserHarmieId, nowIso(), nowIso(), sessionId);
}

export function hasPageantSessionExpired(session) {
  return Boolean(session?.expires_at) && Date.parse(session.expires_at) <= Date.now();
}

export function listExpiredOpenPageantSessions() {
  return db.prepare(`
    SELECT *
    FROM pageant_sessions
    WHERE status = 'open'
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
  `).all();
}

export function hasPageantSessionVote(sessionId, voterId) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM pageant_session_votes
      WHERE session_id = ? AND voter_id = ?
    `).get(sessionId, voterId),
  );
}

export function getPageantVoteSummary(sessionId) {
  const rows = db.prepare(`
    SELECT selected_side, COUNT(*) AS vote_count
    FROM pageant_session_votes
    WHERE session_id = ?
    GROUP BY selected_side
  `).all(sessionId);

  const summary = {
    left: 0,
    right: 0,
    total: 0,
  };

  for (const row of rows) {
    const side = row.selected_side === 'left' ? 'left' : 'right';
    summary[side] = row.vote_count;
    summary.total += row.vote_count;
  }

  return summary;
}

export function getPageantSessionResult(sessionId) {
  const summary = getPageantVoteSummary(sessionId);

  if (summary.left === summary.right) {
    return {
      ...summary,
      winningSide: 'tie',
    };
  }

  return {
    ...summary,
    winningSide: summary.left > summary.right ? 'left' : 'right',
  };
}

export function recordPageantSessionVote({
  sessionId,
  voterId,
  selectedSide,
  winnerHarmieId,
  loserHarmieId,
  sourceMode,
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO pageant_session_votes (
      session_id,
      voter_id,
      selected_side,
      winner_harmie_id,
      loser_harmie_id,
      source_mode
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, voterId, selectedSide, winnerHarmieId, loserHarmieId, sourceMode);

  return result.changes === 1;
}

function ensureLocalStat(harmieId) {
  db.prepare(`
    INSERT INTO local_harmie_stats (harmie_id)
    VALUES (?)
    ON CONFLICT(harmie_id) DO NOTHING
  `).run(harmieId);
}

function getLocalStat(harmieId) {
  ensureLocalStat(harmieId);

  return db.prepare(`
    SELECT harmie_id, elo_score, total_matches, wins, losses
    FROM local_harmie_stats
    WHERE harmie_id = ?
  `).get(harmieId);
}

export function getLocalStatsMap() {
  const rows = db.prepare(`
    SELECT harmie_id, elo_score, total_matches, wins, losses
    FROM local_harmie_stats
  `).all();

  return Object.fromEntries(
    rows.map((row) => [
      row.harmie_id,
      {
        eloScore: row.elo_score,
        totalMatches: row.total_matches,
        wins: row.wins,
        losses: row.losses,
      },
    ]),
  );
}

export function getLocalStatsForHarmie(harmieId) {
  const row = db.prepare(`
    SELECT harmie_id, elo_score, total_matches, wins, losses
    FROM local_harmie_stats
    WHERE harmie_id = ?
  `).get(harmieId);

  if (!row) {
    return {
      eloScore: config.pageant.defaultElo,
      totalMatches: 0,
      wins: 0,
      losses: 0,
    };
  }

  return {
    eloScore: row.elo_score,
    totalMatches: row.total_matches,
    wins: row.wins,
    losses: row.losses,
  };
}

export function applyStatsScope(harmies, scope) {
  if (scope !== 'discord') {
    return harmies;
  }

  const localStats = getLocalStatsMap();

  return harmies.map((harmie) => {
    const stats = localStats[harmie.id];

    if (!stats) {
      return {
        ...harmie,
        eloScore: config.pageant.defaultElo,
        totalMatches: 0,
        wins: 0,
        losses: 0,
      };
    }

    return {
      ...harmie,
      ...stats,
    };
  });
}

export function sortByRank(a, b) {
  return (
    (b.eloScore ?? config.pageant.defaultElo) - (a.eloScore ?? config.pageant.defaultElo) ||
    (b.totalMatches ?? 0) - (a.totalMatches ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export function calculateVoteDeltas(winner, loser) {
  const winnerK =
    (winner.totalMatches ?? 0) >= config.pageant.establishedThreshold
      ? config.pageant.establishedKFactor
      : config.pageant.newKFactor;
  const loserK =
    (loser.totalMatches ?? 0) >= config.pageant.establishedThreshold
      ? config.pageant.establishedKFactor
      : config.pageant.newKFactor;

  const winnerExpected = 1 / (1 + 10 ** (((loser.eloScore ?? config.pageant.defaultElo) - (winner.eloScore ?? config.pageant.defaultElo)) / 400));
  const loserExpected = 1 / (1 + 10 ** (((winner.eloScore ?? config.pageant.defaultElo) - (loser.eloScore ?? config.pageant.defaultElo)) / 400));

  const winnerChange = Math.round(winnerK * (1 - winnerExpected));
  const loserChange = Math.round(loserK * (0 - loserExpected));

  return {
    winnerChange,
    loserChange,
  };
}

export const recordLocalVote = db.transaction(({ guildId, voterId, winnerId, loserId }) => {
  const latestVote = db.prepare(`
    SELECT created_at
    FROM local_votes
    WHERE voter_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(voterId);

  if (latestVote) {
    const elapsedMs = Date.now() - Date.parse(latestVote.created_at);
    if (elapsedMs < config.pageant.voteCooldownMs) {
      throw createError('Slow down a bit before casting another vote.', {
        kind: 'policy',
      });
    }
  }

  const todayVotes = db.prepare(`
    SELECT COUNT(*) AS count
    FROM local_votes
    WHERE voter_id = ?
      AND date(created_at) = date('now')
  `).get(voterId);

  if ((todayVotes?.count ?? 0) >= config.pageant.dailyVoteLimit) {
    throw createError('You hit the Discord pageant vote limit for today.', {
      kind: 'policy',
    });
  }

  const pairKey = pairKeyFor(winnerId, loserId);
  const recentPair = db.prepare(`
    SELECT created_at
    FROM local_votes
    WHERE voter_id = ?
      AND pair_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(voterId, pairKey);

  if (recentPair) {
    const elapsedHours = (Date.now() - Date.parse(recentPair.created_at)) / (60 * 60 * 1000);
    if (elapsedHours < config.pageant.duplicatePairCooldownHours) {
      throw createError('You already voted on this exact matchup recently.', {
        kind: 'policy',
      });
    }
  }

  const winner = getLocalStat(winnerId);
  const loser = getLocalStat(loserId);
  const deltas = calculateVoteDeltas(
    {
      eloScore: winner.elo_score,
      totalMatches: winner.total_matches,
    },
    {
      eloScore: loser.elo_score,
      totalMatches: loser.total_matches,
    },
  );

  db.prepare(`
    UPDATE local_harmie_stats
    SET
      elo_score = ?,
      total_matches = total_matches + 1,
      wins = wins + 1,
      updated_at = ?
    WHERE harmie_id = ?
  `).run(winner.elo_score + deltas.winnerChange, nowIso(), winnerId);

  db.prepare(`
    UPDATE local_harmie_stats
    SET
      elo_score = ?,
      total_matches = total_matches + 1,
      losses = losses + 1,
      updated_at = ?
    WHERE harmie_id = ?
  `).run(loser.elo_score + deltas.loserChange, nowIso(), loserId);

  db.prepare(`
    INSERT INTO local_votes (
      guild_id,
      voter_id,
      winner_harmie_id,
      loser_harmie_id,
      pair_key,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, voterId, winnerId, loserId, pairKey, nowIso());

  return {
    mode: 'discord',
    ...deltas,
  };
});

export function pickMatchup(harmies, { excludePairKey = null } = {}) {
  const eligible = harmies.filter((harmie) => harmie.image);

  if (eligible.length < 2) {
    throw createError('Not enough Harmies with images were loaded to build a matchup.');
  }

  const maxMatches = Math.max(...eligible.map((harmie) => harmie.totalMatches || 0), 1);
  const weights = eligible.map((harmie) => Math.max(1, maxMatches - (harmie.totalMatches || 0) + 10));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  const pickIndex = () => {
    let cursor = Math.random() * totalWeight;

    for (let index = 0; index < weights.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return index;
    }

    return weights.length - 1;
  };

  let leftIndex = 0;
  let rightIndex = 1;
  let attempts = 0;

  do {
    leftIndex = pickIndex();
    rightIndex = pickIndex();
    attempts += 1;
  } while (
    (leftIndex === rightIndex ||
      (excludePairKey && pairKeyFor(eligible[leftIndex].id, eligible[rightIndex].id) === excludePairKey)) &&
    attempts < 50
  );

  if (leftIndex === rightIndex) {
    rightIndex = (leftIndex + 1) % eligible.length;
  }

  return [eligible[leftIndex], eligible[rightIndex]];
}

import { db } from './db.js';

function nowIso() {
  return new Date().toISOString();
}

export function saveGuildCardMessage({
  guildId,
  cardKind,
  channelId,
  messageId,
}) {
  db.prepare(`
    INSERT INTO guild_card_messages (
      guild_id,
      card_kind,
      channel_id,
      message_id,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, card_kind) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `).run(guildId, cardKind, channelId, messageId, nowIso());
}

export function getGuildCardMessage(guildId, cardKind) {
  return (
    db.prepare(`
      SELECT guild_id, card_kind, channel_id, message_id, updated_at
      FROM guild_card_messages
      WHERE guild_id = ? AND card_kind = ?
    `).get(guildId, cardKind) || null
  );
}

export function removeGuildCardMessage(guildId, cardKind) {
  db.prepare(`
    DELETE FROM guild_card_messages
    WHERE guild_id = ? AND card_kind = ?
  `).run(guildId, cardKind);
}

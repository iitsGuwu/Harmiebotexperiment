import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
} from 'discord.js';

import {
  buildCommunityStatsEmbed,
  buildWalletAuditEmbed,
  buildWalletEmbed,
  buildWalletLinkEmbed,
  buildWalletLinkComponents,
  buildVerifyChannelMessage,
  MAGIC_EDEN_VERIFY_BUTTON_ID,
  VERIFY_BUTTON_ID,
} from './discord-ui.js';
import { getRandomBurntAsset } from './burnt-assets.js';
import './db.js';
import {
  getLocalStatsForHarmie,
} from './pageant-store.js';
import { config } from './config.js';
import {
  getCollectionMarketSnapshot,
  getGuildOwnershipSnapshot,
  getRecentCollectionTrades,
  getWalletHarmieCount,
  getWalletHarmieHoldings,
  refreshVerifiedWallet,
} from './collection-stats.js';
import { handleVerify, startVerification, startOwnershipMonitor, startMagicEdenVerificationWithWallet } from './verify-bio.js';
import { renderUnburnCard } from './unburn-card.js';
import {
  findSiteHarmie,
  getSiteRankings,
  listSiteHarmies,
} from './site-api.js';
import {
  getGuildWalletAuditSnapshot,
  listTrackedWalletMemberships,
  listWalletLinkHoldings,
  listWalletLinks,
  logWalletAuditEvent,
  markGuildTradeAnnounced,
  markWalletLinkRefreshFailure,
  removeWalletLink,
  replaceWalletHoldings,
  updateWalletLinkSnapshot,
  hasGuildTradeBeenAnnounced,
  hasGuildTradeHistory,
} from './wallet-store.js';
import { createVerificationLink, startWebServer } from './web-server.js';
import { getNextMemeAsset } from './meme-assets.js';
import {
  createPromptGeneration,
  createRandomGeneration,
  extractGenerationId,
  getCisStatus,
  waitForGeneratedImage,
} from './cis-client.js';
import {
  renderCommunityStatsCard,
  renderFlexCard,
  renderHarmieShowcaseCard,
  renderRankingsCard,
  renderTradeCard,
  renderWalletAuditCard,
  renderWalletLinkCard,
  renderWalletSummaryCard,
} from './neuko-cards.js';
import { findHarmieAsset, getRandomHarmieAsset } from './harmie-assets.js';
import { searchPrompts } from './prompt-library.js';
import {
  getGuildCardMessage,
  removeGuildCardMessage,
  saveGuildCardMessage,
} from './dashboard-store.js';
import { botEvents } from './bot-events.js';
import { startPriceTracking } from './price-tracker.js';
import {
  getAuditGuildOnlyLine,
  getCommunityGuildOnlyLine,
  getFlexNoHoldingsLine,
  getFlexNoWalletLine,
  getHarmieNotFoundLine,
  getMemeCaption,
  getMilkmanReply,
  getNoBurntLine,
  getNoHarmiesLine,
  getNoMemesLine,
  getNoWalletLinkedLine,
  getVoteRecordedLine,
  getWalletNotLinkedLine,
  getWalletRemovedLine,
  mentionsMilkman,
} from './bot-dialogue.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TRADE_SEED_SIGNATURE = '__seed__';
const MILKMAN_REPLY_COOLDOWN_MS = 30 * 1000;
const milkmanChannelCooldowns = new Map();

function defaultRankingScope() {
  return 'site';
}

function canReplyToMilkman(channelId) {
  if (!channelId) {
    return true;
  }

  const now = Date.now();
  const lastReplyAt = milkmanChannelCooldowns.get(channelId) || 0;
  if (now - lastReplyAt < MILKMAN_REPLY_COOLDOWN_MS) {
    return false;
  }

  milkmanChannelCooldowns.set(channelId, now);

  if (milkmanChannelCooldowns.size > 200) {
    for (const [key, value] of milkmanChannelCooldowns.entries()) {
      if (now - value > MILKMAN_REPLY_COOLDOWN_MS * 4) {
        milkmanChannelCooldowns.delete(key);
      }
    }
  }

  return true;
}

async function getDisplayHarmies(scope) {
  const harmies = await listSiteHarmies();
  return applyStatsScope(harmies, scope);
}

async function renderCardAttachment(filename, renderBuffer) {
  try {
    const buffer = await renderBuffer();
    return new AttachmentBuilder(buffer, { name: filename });
  } catch (error) {
    console.warn(`Card render failed for ${filename}:`, error.message);
    return null;
  }
}

function withAttachmentImage(embed, attachmentName) {
  return embed.setImage(`attachment://${attachmentName}`);
}

async function resolveCommunitySnapshot(guild) {
  const snapshot = await getGuildOwnershipSnapshot(guild.id);
  const topHolders = await Promise.all(
    snapshot.topHolders.map(async (holder) => {
      const member = await guild.members.fetch(holder.discord_user_id).catch(() => null);
      return {
        ...holder,
        display_name:
          member?.user?.username ||
          member?.displayName ||
          holder.discord_user_id,
      };
    }),
  );

  return {
    ...snapshot,
    topHolders,
  };
}

async function buildCommunityStatsPayload(guild) {
  const resolvedSnapshot = await resolveCommunitySnapshot(guild);
  const memeAsset = getNextMemeAsset();
  const cardFile = await renderCardAttachment('community-stats.png', () =>
    renderCommunityStatsCard({
      snapshot: resolvedSnapshot,
      imageSource: memeAsset?.path || null,
    }),
  );

  return cardFile
    ? { files: [cardFile] }
    : { embeds: [buildCommunityStatsEmbed({ snapshot: resolvedSnapshot })] };
}

async function refreshTrackedCommunityStatsCard(guildId) {
  if (!guildId) {
    return;
  }

  const tracked = getGuildCardMessage(guildId, 'community-stats');
  if (!tracked) {
    return;
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    removeGuildCardMessage(guildId, 'community-stats');
    return;
  }

  const channel = await client.channels.fetch(tracked.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    removeGuildCardMessage(guildId, 'community-stats');
    return;
  }

  const message = await channel.messages.fetch(tracked.message_id).catch(() => null);
  if (!message) {
    removeGuildCardMessage(guildId, 'community-stats');
    return;
  }

  const payload = await buildCommunityStatsPayload(guild);
  await message.edit(payload).catch((error) => {
    console.warn('Community stats refresh failed:', error.message);
  });
}

async function handleRankingsCommand(interaction) {
  await interaction.deferReply();
  const limit = interaction.options.getInteger('limit') || 10;
  const scope = defaultRankingScope();
  const rankings = await getSiteRankings(limit);
  const cardBuffer = await renderRankingsCard({ harmies: rankings, scope });
  const cardFile = new AttachmentBuilder(cardBuffer, { name: 'harmie-rankings.png' });

  await interaction.editReply({
    files: [cardFile],
  });
}

async function handleHarmieCommand(interaction) {
  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const asset = query ? findHarmieAsset(query) : getRandomHarmieAsset();
  const randomSiteHarmies = !query && !asset ? await listSiteHarmies().catch(() => []) : [];
  let siteHarmie = null;

  if (query) {
    siteHarmie = await findSiteHarmie(query).catch(() => null);
  } else if (asset?.token_number) {
    siteHarmie = await findSiteHarmie(String(asset.token_number)).catch(() => null);
  } else if (randomSiteHarmies.length > 0) {
    siteHarmie = randomSiteHarmies[Math.floor(Math.random() * randomSiteHarmies.length)] || null;
  }

  if (!asset && !siteHarmie) {
    await interaction.editReply({
      content: query
        ? getHarmieNotFoundLine(query)
        : getNoHarmiesLine(),
    });
    return;
  }

  const localStats = siteHarmie ? getLocalStatsForHarmie(siteHarmie.id) : {};
  const cardBuffer = await renderHarmieShowcaseCard({
    asset,
    harmie: siteHarmie,
    localStats,
  });
  const file = new AttachmentBuilder(cardBuffer, { name: 'harmie-showcase.png' });

  await interaction.editReply({
    files: [file],
  });
}

async function handleUnburnCommand(interaction) {
  await interaction.deferReply();

  const asset = getRandomBurntAsset();
  if (!asset) {
    await interaction.editReply({
      content: getNoBurntLine(),
    });
    return;
  }

  let file;

  try {
    const animationBuffer = await renderUnburnCard({ imagePath: asset.path });
    const attachmentName = `unburn-${asset.token_id || 'harmie'}.gif`;
    file = new AttachmentBuilder(animationBuffer, { name: attachmentName });
  } catch (error) {
    console.warn('Unburn render failed:', error.message);
    const extension = asset.filename?.split('.').pop() || 'png';
    const attachmentName = `unburn-${asset.token_id || 'harmie'}.${extension}`;
    file = new AttachmentBuilder(asset.path, { name: attachmentName });
  }

  await interaction.editReply({
    files: [file],
  });
}

async function handleMemeCommand(interaction) {
  await interaction.deferReply();

  const asset = getNextMemeAsset();
  if (!asset) {
    await interaction.editReply({
      content: getNoMemesLine(),
    });
    return;
  }

  const extension = asset.filename?.split('.').pop() || asset.path.split('.').pop() || 'png';
  const attachmentName = `harmie-meme.${extension}`;
  const file = new AttachmentBuilder(asset.path, { name: attachmentName });

  await interaction.editReply({
    files: [file],
  });
}

async function runCisGeneration(interaction, generationFn) {
  await interaction.deferReply();

  const MAX_ATTEMPTS = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const generation = await generationFn();
      const generationId = extractGenerationId(generation);
      if (!generationId) {
        throw new Error('Harmie CIS did not return a generation ID.');
      }

      const imageAsset = await waitForGeneratedImage(generationId);
      await interaction.editReply({
        files: [new AttachmentBuilder(imageAsset.buffer, { name: imageAsset.filename })],
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`CIS generation attempt ${attempt} failed, retrying: ${error.message}`);
      }
    }
  }

  throw lastError;
}

async function handleRandomCommand(interaction) {
  await runCisGeneration(interaction, () => createRandomGeneration());
}

async function handlePromptedCommand(interaction) {
  const prompt = interaction.options.getString('prompt', true).trim();
  await runCisGeneration(interaction, () => createPromptGeneration(prompt));
}

async function handleTopupCommand(interaction) {
  const baseUrl = config.cis.baseUrl.endsWith('/') ? config.cis.baseUrl : `${config.cis.baseUrl}/`;
  const topupUrl = new URL('topup', baseUrl).toString();

  await interaction.reply({
    embeds: [
      {
        title: 'Harmie CIS Credit Top Up',
        url: topupUrl,
        description: `Use this hidden link to top up your CIS credits:\n[Open CIS top up page](${topupUrl})`,
        color: 0xffea57,
      },
    ],
    ephemeral: true,
  });
}

async function logCisStatus() {
  if (!config.cis.configured && !config.web.isLocalhost) {
    console.warn(
      `HARMIE_CIS_BASE_URL is not set. /random and /prompted will keep falling back to ${config.cis.defaultBaseUrl} until you point it at the running CIS app.`,
    );
  }

  const status = await getCisStatus();
  if (status.ok) {
    console.log(`Harmie CIS reachable at ${status.baseUrl} (${status.elapsedMs}ms).`);
    return;
  }

  console.warn(`Harmie CIS check failed: ${status.error || `HTTP ${status.status}`}`);
}

async function sendWalletLink(interaction, options = {}) {
  const challenge = createVerificationLink({
    discordUserId: interaction.user.id,
    guildId: interaction.guildId || null,
    channelId: interaction.channelId,
    ...options,
  });
  const memeAsset = getNextMemeAsset();
  const attachmentName = 'wallet-link.png';
  const cardFile = await renderCardAttachment(attachmentName, () =>
    renderWalletLinkCard({
      expiresAt: challenge.expiresAt,
      operation: options.operation || 'link',
      imageSource: memeAsset?.path || null,
    }),
  );

  const payload = {
    components: buildWalletLinkComponents({ url: challenge.url }),
    ephemeral: true,
  };

  if (cardFile) {
    payload.embeds = [
      withAttachmentImage(
        buildWalletLinkEmbed({
          url: challenge.url,
          expiresAt: challenge.expiresAt,
        }),
        attachmentName,
      ),
    ];
    payload.files = [cardFile];
  } else {
    payload.embeds = [
      buildWalletLinkEmbed({
        url: challenge.url,
        expiresAt: challenge.expiresAt,
      }),
    ];
  }

  await interaction.reply(payload);
}

async function handleLinkWalletCommand(interaction) {
  await sendWalletLink(interaction, { operation: 'link' });
}

async function handleReverifyWalletCommand(interaction) {
  const requestedAddress = interaction.options.getString('address');
  const walletLinks = listWalletLinks(interaction.user.id);

  if (walletLinks.length === 0) {
    await interaction.reply({
      content: getNoWalletLinkedLine(),
      ephemeral: true,
    });
    return;
  }

  const target =
    (requestedAddress
      ? walletLinks.find((wallet) => wallet.wallet_address === requestedAddress)
      : walletLinks.find((wallet) => wallet.is_primary) || walletLinks[0]) || null;

  if (!target) {
    await interaction.reply({
      content: getWalletNotLinkedLine(),
      ephemeral: true,
    });
    return;
  }

  await sendWalletLink(interaction, {
    operation: 'reverify',
    targetWalletAddress: target.wallet_address,
  });
}

async function handleUnlinkWalletCommand(interaction) {
  const walletAddress = interaction.options.getString('address', true);
  const removed = removeWalletLink(interaction.user.id, walletAddress);

  if (!removed) {
    await interaction.reply({
      content: getWalletNotLinkedLine(),
      ephemeral: true,
    });
    return;
  }

  logWalletAuditEvent({
    eventType: 'wallet_unlinked',
    status: 'success',
    discordUserId: interaction.user.id,
    walletAddress,
    details: {
      guildId: interaction.guildId || null,
    },
  });

  await interaction.reply({
    content: getWalletRemovedLine(walletAddress),
    ephemeral: true,
  });

  const remainingWallets = listWalletLinks(interaction.user.id);
  if (interaction.guildId) {
    void refreshTrackedCommunityStatsCard(interaction.guildId);
    if (remainingWallets.length === 0) {
      void revokeVerifiedRole(interaction.guildId, interaction.user.id);
    }
  }
}

async function handleMagicEdenVerify(interaction) {
  // For Magic Eden verification, we need the user's wallet address first
  // We'll use a modal to collect the wallet address
  const modal = {
    title: 'Magic Eden Bio Verification',
    custom_id: 'magic_eden_verify_modal',
    components: [
      {
        type: 1, // Action Row
        components: [
          {
            type: 4, // Text Input
            custom_id: 'wallet_address',
            label: 'Your Solana Wallet Address',
            style: 1, // Short
            placeholder: 'Enter your Solana wallet address (e.g., 11111111111111111111111111111112)',
            required: true,
            min_length: 32,
            max_length: 44,
          },
        ],
      },
    ],
  };

  await interaction.showModal(modal);
}

async function startMagicEdenVerification(interaction, walletAddress) {
  // Use the existing verification logic but adapt it for modal interaction
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Generate verification code
  const code = "BLUB-" + Math.random().toString(36).substring(2, 8).toUpperCase();

  // Store verification data (we'll need to adapt the verify-bio.js logic)
  // For now, let's create a simple response
  await interaction.reply({
    content: `🧾 **Magic Eden Bio Verification Started**

**Your wallet:** \`${walletAddress}\`

**Step 1:** Go to [Magic Eden](https://magiceden.io/) and sign in with this wallet
**Step 2:** Go to your profile settings
**Step 3:** Paste this code into your bio:

\`${code}\`

**Step 4:** Click "Save" and wait for verification (checked every minute)

⏱ **Expires in 10 minutes**  
✅ **Role:** HarmonyTown Resident

The bot will automatically verify you once it detects the code in your Magic Eden bio and confirms you own Harmie NFTs.`,
    ephemeral: true,
  });

  // TODO: Integrate with the existing verification system
  // This would require modifying verify-bio.js to work with modal-collected wallet addresses
}

async function resolveBuysSalesChannel(guildId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return null;
  }

  await guild.channels.fetch().catch(() => null);

  const normalizeChannelName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = normalizeChannelName(config.wallet.activityChannelName);
  const fallbackNames = new Set([
    targetName,
    normalizeChannelName('sales-bot'),
    normalizeChannelName('buys-sales'),
    normalizeChannelName('buy sales'),
    normalizeChannelName('buys sales'),
    normalizeChannelName('buy/sales'),
    normalizeChannelName('buys/sales'),
  ]);

  return (
    guild.channels.cache.find(
      (candidate) =>
        candidate.isTextBased?.() &&
        fallbackNames.has(normalizeChannelName(candidate.name)),
    ) || null
  );
}

function findMatchingTrade(trades, walletAddress, mintAddress, action) {
  const normalizedWallet = String(walletAddress || '');
  const normalizedMint = String(mintAddress || '');

  return (
    trades.find((trade) => {
      if (trade.tokenMint !== normalizedMint) return false;
      if (action === 'buy') {
        return trade.buyer === normalizedWallet;
      }
      return trade.seller === normalizedWallet;
    }) || null
  );
}

async function announceWalletCountChange(membership, previousCount, nextCount) {
  if (previousCount === nextCount) {
    return;
  }

  const channel = await resolveBuysSalesChannel(membership.guild_id);
  if (!channel) {
    return;
  }

  if (nextCount > previousCount) {
    const delta = nextCount - previousCount;
    await channel.send(
      `Congrats on the purchase <@${membership.discord_user_id}>. Your Harmies total just moved from **${previousCount}** to **${nextCount}** (+${delta}).`,
    );
    return;
  }

  const delta = previousCount - nextCount;
  await channel.send(
    `<@${membership.discord_user_id}> just moved from **${previousCount}** Harmies to **${nextCount}** (-${delta}).`,
  );
}

async function announceWalletTradeChange(membership, action, holding, previousCount, nextCount, trade) {
  const channel = await resolveBuysSalesChannel(membership.guild_id);
  if (!channel) {
    return;
  }

  const verb = action === 'buy' ? 'PICKED UP' : 'SOLD';
  const priceText =
    typeof trade?.priceSol === 'number' && Number.isFinite(trade.priceSol) && trade.priceSol > 0
      ? `${trade.priceSol.toFixed(2)} SOL`
      : '—';
  const subtitle =
    action === 'buy'
      ? `<@${membership.discord_user_id}> just picked one up.`
      : `<@${membership.discord_user_id}> just let one go.`;

  const buffer = await renderTradeCard({
    kicker: `WALLET ${verb}`,
    title: holding.name || 'Harmie',
    statusText: action === 'sell' ? 'SOLD!' : 'BOUGHT!',
    subtitle: '',
    imageSource: holding.image || trade?.image || '',
    imageFallbackLabel: 'TRADE',
    metrics: [
      { label: action === 'buy' ? 'Buy Price' : 'Sale Price', value: priceText },
      { label: 'Total Held', value: `${previousCount} → ${nextCount}` },
      { label: 'Action', value: action === 'buy' ? 'Buy' : 'Sale' },
    ],
    parties: [],
    footerLabel: action === 'buy' ? 'WALLET PURCHASE' : 'WALLET SALE',
  });

  const file = new AttachmentBuilder(buffer, { name: `trade-${holding.mintAddress || 'harmie'}.png` });
  await channel.send({
    content: subtitle,
    files: [file],
  });
}

function formatTradePartyLabel(walletAddress, linkedUserIds) {
  if (linkedUserIds.length > 0) {
    return linkedUserIds.map((userId) => `<@${userId}>`).join(', ');
  }

  if (!walletAddress) {
    return 'Unknown';
  }

  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

async function announceCollectionTrades(memberships, harmieLookup, recentTrades) {
  const membershipsByGuild = new Map();

  for (const membership of memberships) {
    const guildMemberships = membershipsByGuild.get(membership.guild_id) || [];
    guildMemberships.push(membership);
    membershipsByGuild.set(membership.guild_id, guildMemberships);
  }

  for (const [guildId, guildMembershipList] of membershipsByGuild.entries()) {
    const channel = await resolveBuysSalesChannel(guildId);
    if (!channel) {
      continue;
    }

    const knownWallets = new Map();
    for (const membership of guildMembershipList) {
      const existing = knownWallets.get(membership.wallet_address) || [];
      existing.push(membership.discord_user_id);
      knownWallets.set(membership.wallet_address, existing);
    }

    const sortedTrades = [...recentTrades].sort(
      (left, right) => (left.blockTime || 0) - (right.blockTime || 0),
    );

    if (!hasGuildTradeHistory(guildId)) {
      const signaturesToSeed = [TRADE_SEED_SIGNATURE];
      for (const trade of sortedTrades) {
        if (trade.signature) {
          signaturesToSeed.push(trade.signature);
        }
      }

      markGuildTradeAnnounced(guildId, signaturesToSeed);
      continue;
    }

    for (const trade of sortedTrades) {
      if (!trade.signature || hasGuildTradeBeenAnnounced(guildId, trade.signature)) {
        continue;
      }

      const harmie = harmieLookup.get(trade.tokenMint) || {
        id: trade.tokenMint,
        name: 'Harmie',
        image: trade.image || '',
      };

      const buyerLabel = formatTradePartyLabel(trade.buyer, knownWallets.get(trade.buyer) || []);
      const sellerLabel = formatTradePartyLabel(trade.seller, knownWallets.get(trade.seller) || []);
      const priceText =
        typeof trade.priceSol === 'number' && Number.isFinite(trade.priceSol) && trade.priceSol > 0
          ? `${trade.priceSol.toFixed(2)} SOL`
          : '—';

      const buffer = await renderTradeCard({
        kicker: 'COLLECTION TRADE',
        title: harmie?.name || 'Harmie',
        subtitle: '',
        imageSource: trade.image || harmie?.image || '',
        imageFallbackLabel: 'TRADE',
        metrics: [
          { label: 'Price', value: priceText },
          { label: 'Type', value: trade.type === 'buyNow' ? 'Buy Now' : (trade.type || 'Trade') },
        ],
        parties: [
          { label: 'Buyer', body: buyerLabel },
          { label: 'Seller', body: sellerLabel },
        ],
        footerLabel: 'COLLECTION TRADE',
      });

      const file = new AttachmentBuilder(buffer, {
        name: `collection-trade-${trade.tokenMint || 'harmie'}.png`,
      });
      await channel.send({
        files: [file],
      });

      markGuildTradeAnnounced(guildId, [trade.signature]);
    }
  }
}

function buildTotalsByUser(memberships) {
  const totals = new Map();

  for (const membership of memberships) {
    const existing = totals.get(membership.discord_user_id) || 0;
    totals.set(membership.discord_user_id, existing + (membership.harmie_count || 0));
  }

  return totals;
}

async function pollVerifiedWalletChanges() {
  const memberships = listTrackedWalletMemberships();
  if (memberships.length === 0) {
    return;
  }

  const market = await getGuildOwnershipSnapshotCacheSafeTotalSupply();
  const recentTrades = await getRecentCollectionTrades(100).catch(() => []);
  const harmieLookup = new Map((await listSiteHarmies()).map((harmie) => [harmie.id, harmie]));

  const beforeTotalsByUser = buildTotalsByUser(memberships);
  const changesByWallet = new Map();
  const impactedGuildIds = new Set();
  let dnsFailureCount = 0;

  for (const membership of memberships) {
    try {
      const [snapshot, currentHoldings] = await Promise.all([
        getWalletHarmieCount(membership.wallet_address),
        getWalletHarmieHoldings(membership.wallet_address),
      ]);

      const previousCount = membership.harmie_count || 0;
      const nextCount = snapshot.count;
      const previousHoldings = listWalletLinkHoldings(membership.wallet_link_id);
      const previousByMint = new Map(
        previousHoldings.map((holding) => [
          holding.mint_address,
          {
            mintAddress: holding.mint_address,
            name: holding.name || harmieLookup.get(holding.mint_address)?.name || 'Harmie',
            image: holding.image_url || harmieLookup.get(holding.mint_address)?.image || '',
          },
        ]),
      );
      const currentByMint = new Map(
        currentHoldings.map((holding) => [
          holding.mintAddress,
          {
            ...holding,
            name: holding.name || harmieLookup.get(holding.mintAddress)?.name || 'Harmie',
            image: holding.image || harmieLookup.get(holding.mintAddress)?.image || '',
          },
        ]),
      );
      const added = [...currentByMint.values()].filter((holding) => !previousByMint.has(holding.mintAddress));
      const removed = [...previousByMint.values()].filter((holding) => !currentByMint.has(holding.mintAddress));

      if (previousCount !== nextCount || added.length > 0 || removed.length > 0) {
        updateWalletLinkSnapshot(membership.wallet_link_id, nextCount, market.totalSupply);
        replaceWalletHoldings(membership.wallet_link_id, currentHoldings);
        changesByWallet.set(membership.wallet_link_id, {
          membership,
          previousCount,
          nextCount,
          added,
          removed,
        });
        if (membership.guild_id) {
          impactedGuildIds.add(membership.guild_id);
        }
      }
    } catch (error) {
      markWalletLinkRefreshFailure(membership.wallet_link_id, error.message);
      logWalletAuditEvent({
        eventType: 'wallet_refresh',
        status: 'error',
        discordUserId: membership.discord_user_id,
        walletAddress: membership.wallet_address,
        details: {
          reason: error.message,
        },
      });
      // ENOTFOUND / EAI_AGAIN happen when the local resolver briefly fails for the
      // Supabase host. We log it once below, after the loop, instead of N times.
      const dnsCode = error?.cause?.code || error?.code;
      if (dnsCode !== 'ENOTFOUND' && dnsCode !== 'EAI_AGAIN') {
        console.error(`Wallet poll failed for ${membership.wallet_address}:`, error.message);
      } else {
        dnsFailureCount += 1;
      }
    }
  }
  if (dnsFailureCount > 0) {
    console.warn(
      `Wallet poll skipped ${dnsFailureCount} wallet(s): DNS could not resolve ${new URL(config.supabase.url).hostname}. Will retry next cycle.`,
    );
  }

  const refreshedMemberships = listTrackedWalletMemberships();
  const afterTotalsByUser = buildTotalsByUser(refreshedMemberships);
  const refreshedByWallet = new Map(
    refreshedMemberships.map((membership) => [membership.wallet_link_id, membership]),
  );

  const guildUserPairs = new Set();
  for (const membership of memberships) {
    const pairKey = `${membership.guild_id}:${membership.discord_user_id}`;
    if (guildUserPairs.has(pairKey)) {
      continue;
    }
    guildUserPairs.add(pairKey);

    const previousTotal = beforeTotalsByUser.get(membership.discord_user_id) || 0;
    const nextTotal = afterTotalsByUser.get(membership.discord_user_id) || 0;
    const walletChanges = [...changesByWallet.values()].filter(
      (change) => change.membership.discord_user_id === membership.discord_user_id,
    );

    for (const walletChange of walletChanges) {
      const latest = refreshedByWallet.get(walletChange.membership.wallet_link_id) || walletChange.membership;

      for (const added of walletChange.added) {
        await announceWalletTradeChange(
          latest,
          'buy',
          added,
          previousTotal,
          nextTotal,
          findMatchingTrade(recentTrades, latest.wallet_address, added.mintAddress, 'buy'),
        ).catch((error) => {
          console.error('Wallet buy announcement failed:', error.message);
        });
      }

      for (const removed of walletChange.removed) {
        await announceWalletTradeChange(
          latest,
          'sell',
          removed,
          previousTotal,
          nextTotal,
          findMatchingTrade(recentTrades, latest.wallet_address, removed.mintAddress, 'sell'),
        ).catch((error) => {
          console.error('Wallet sale announcement failed:', error.message);
        });
      }
    }

    const hadAssetDiff = walletChanges.some((change) => change.added.length > 0 || change.removed.length > 0);
    if (!hadAssetDiff && previousTotal !== nextTotal) {
      await announceWalletCountChange(
        membership,
        previousTotal,
        nextTotal,
      ).catch((error) => {
        console.error('Wallet announcement failed:', error.message);
      });
    }
  }

  await announceCollectionTrades(memberships, harmieLookup, recentTrades).catch((error) => {
    console.error('Collection trade announcements failed:', error.message);
  });

  for (const guildId of impactedGuildIds) {
    await refreshTrackedCommunityStatsCard(guildId).catch((error) => {
      console.error('Community stats refresh failed:', error.message);
    });
  }
}

async function getGuildOwnershipSnapshotCacheSafeTotalSupply() {
  try {
    return await getCollectionMarketSnapshot();
  } catch {
    return {
      totalSupply: 500,
    };
  }
}

function startWalletPolling() {
  let polling = false;

  const run = async () => {
    if (polling) return;
    polling = true;

    try {
      await pollVerifiedWalletChanges();
    } catch (error) {
      console.error('Wallet polling error:', error);
    } finally {
      polling = false;
    }
  };

  void run();
  setInterval(run, config.wallet.pollIntervalMs);
}

async function handleWalletCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const market = await getGuildOwnershipSnapshotCacheSafeTotalSupply();
  const wallet = await refreshVerifiedWallet(interaction.user.id, {
    force: true,
    totalSupply: market.totalSupply,
  });

  if (!wallet) {
    await interaction.editReply({
      content: getNoWalletLinkedLine(),
    });
    return;
  }

  const holdings = wallet.wallets.flatMap((link) =>
    listWalletLinkHoldings(link.id).map((holding) => ({
      walletAddress: link.wallet_address,
      mintAddress: holding.mint_address,
      name: holding.name || 'Harmie',
      image: holding.image_url || '',
    })),
  );
  const attachmentName = 'wallet-summary.png';
  const cardFile = await renderCardAttachment(attachmentName, () =>
    renderWalletSummaryCard({ wallet, holdings }),
  );

  await interaction.editReply(
    cardFile
      ? {
          embeds: [withAttachmentImage(buildWalletEmbed({ wallet }), attachmentName)],
          files: [cardFile],
        }
      : {
          embeds: [buildWalletEmbed({ wallet })],
        },
  );
}

async function handleFlexCommand(interaction) {
  await interaction.deferReply();

  const wallet = await refreshVerifiedWallet(interaction.user.id, { force: false });

  if (!wallet) {
    await interaction.editReply({
      content: getFlexNoWalletLine(),
    });
    return;
  }

  const holdings = wallet.wallets
    .flatMap((link) =>
      listWalletLinkHoldings(link.id).map((holding) => ({
        walletAddress: link.wallet_address,
        mintAddress: holding.mint_address,
        name: holding.name || 'Harmie',
        image: holding.image_url || '',
      })),
    )
    .filter((holding) => Boolean(holding.mintAddress));

  if (holdings.length === 0) {
    await interaction.editReply({
      content: getFlexNoHoldingsLine(),
    });
    return;
  }

  const shuffledHoldings = [...holdings]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(10, holdings.length));
  const cardBuffer = await renderFlexCard({
    wallet,
    holding: shuffledHoldings,
  });
  const cardFile = new AttachmentBuilder(cardBuffer, { name: 'harmie-flex.png' });

  await interaction.editReply({
    files: [cardFile],
  });
}

async function handleCommunityStatsCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: getCommunityGuildOnlyLine(),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  const payload = await buildCommunityStatsPayload(interaction.guild);
  const message = await interaction.editReply(payload);

  saveGuildCardMessage({
    guildId: interaction.guildId,
    cardKind: 'community-stats',
    channelId: interaction.channelId,
    messageId: message.id,
  });
}

async function handleWalletAuditCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: getAuditGuildOnlyLine(),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const snapshot = getGuildWalletAuditSnapshot(interaction.guildId);
  const memeAsset = getNextMemeAsset();
  const attachmentName = 'wallet-audit.png';
  const cardFile = await renderCardAttachment(attachmentName, () =>
    renderWalletAuditCard({
      snapshot,
      imageSource: memeAsset?.path || null,
    }),
  );
  await interaction.editReply(
    cardFile
      ? {
          embeds: [withAttachmentImage(buildWalletAuditEmbed({ snapshot }), attachmentName)],
          files: [cardFile],
        }
      : {
          embeds: [buildWalletAuditEmbed({ snapshot })],
        },
  );
}


async function resolveVerifiedRole(guild) {
  await guild.roles.fetch().catch(() => null);
  return guild.roles.cache.find((r) => r.name === config.discord.verifiedRoleName) || null;
}

async function grantVerifiedRole(guildId, discordUserId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const role = await resolveVerifiedRole(guild);
  if (!role) {
    console.warn(`Verified role "${config.discord.verifiedRoleName}" not found in guild ${guildId}.`);
    return;
  }

  const member = await guild.members.fetch(discordUserId).catch(() => null);
  if (!member) return;

  await member.roles.add(role).catch((error) => {
    console.warn(`Failed to grant verified role to ${discordUserId}:`, error.message);
  });
}

async function revokeVerifiedRole(guildId, discordUserId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const role = await resolveVerifiedRole(guild);
  if (!role) return;

  const member = await guild.members.fetch(discordUserId).catch(() => null);
  if (!member) return;

  await member.roles.remove(role).catch((error) => {
    console.warn(`Failed to revoke verified role from ${discordUserId}:`, error.message);
  });
}

botEvents.on('wallet-linked', async ({ guildId, discordUserId, walletAddress }) => {
  void refreshTrackedCommunityStatsCard(guildId);
  if (guildId && discordUserId) {
    void grantVerifiedRole(guildId, discordUserId);
    
    // Send confirmation DM to user
    try {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        if (member) {
          await member.send(
            `✅ **Wallet Verified!**\n\nWallet: \`${walletAddress}\`\nRole granted: **${config.discord.verifiedRoleName || 'HarmonyTown Resident'}**\n\nWelcome to the Harmie community! 🎉`
          ).catch(() => {
            // DM failed, maybe user has DMs disabled - that's okay
          });
        }
      }
    } catch (error) {
      console.warn('Failed to send verification DM:', error.message);
    }
  }
});

async function postVerifyChannelMessage(readyClient) {
  const targetName = normalizeChannelName(config.discord.verifyChannelName);
  if (!targetName) return;

  const guild = config.discord.guildId ? readyClient.guilds.cache.get(config.discord.guildId) : readyClient.guilds.cache.first();
  if (!guild) return;

  const channel = guild.channels.cache.find(
    (c) => c.isTextBased() && normalizeChannelName(c.name) === targetName,
  );
  if (!channel) {
    console.warn(`Verify channel "${config.discord.verifyChannelName}" not found — skipping persistent verify message.`);
    return;
  }

  // Check if we already posted a verify message (look for our buttons in recent messages)
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(
    (m) => m.author.id === readyClient.user.id &&
      m.components?.[0]?.components?.some(c => c.customId === VERIFY_BUTTON_ID || c.customId === MAGIC_EDEN_VERIFY_BUTTON_ID),
  );

  if (existing) return;

  await channel.send(buildVerifyChannelMessage()).catch((err) => {
    console.warn(`Could not post verify message in #${config.discord.verifyChannelName}: ${err.message}`);
  });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startWalletPolling();
  startPriceTracking(readyClient);
  startVerification(readyClient);
  startOwnershipMonitor(readyClient);
  void logCisStatus();
  void postVerifyChannelMessage(readyClient);
});

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAllowedCommandChannel(interaction) {
  // DMs are always fine — there's no concept of a "commands channel" off-server.
  if (!interaction.guildId) return true;

  const targetName = normalizeChannelName(config.discord.commandsChannelName);
  if (!targetName) return true;

  const channel = interaction.channel;
  if (!channel) return false;
  return normalizeChannelName(channel.name) === targetName;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'prompted' && interaction.options.getFocused(true).name === 'prompt') {
        const query = interaction.options.getFocused();
        const trimmed = String(query || '').trim();
        const matches = searchPrompts(query);
        const choices = [];
        if (trimmed.length >= 3 && !matches.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
          // Discord rejects autocomplete values it cannot match, so we always echo
          // the user's free-text input back as the first option. Names are capped
          // at 100 chars; values cap at 100 too — slice to keep Discord happy.
          const value = trimmed.slice(0, 100);
          const name = `Use my prompt: ${value}`.slice(0, 100);
          choices.push({ name, value });
        }
        for (const p of matches) {
          if (choices.length >= 25) break;
          choices.push({ name: p.slice(0, 100), value: p.slice(0, 100) });
        }
        await interaction.respond(choices);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (!isAllowedCommandChannel(interaction)) {
        await interaction.reply({
          content: `That command only runs in #${config.discord.commandsChannelName}.`,
          ephemeral: true,
        });
        return;
      }
      if (interaction.commandName === 'rankings') {
        await handleRankingsCommand(interaction);
      } else if (interaction.commandName === 'harmie') {
        await handleHarmieCommand(interaction);
      } else if (interaction.commandName === 'unburn') {
        await handleUnburnCommand(interaction);
      } else if (interaction.commandName === 'meme') {
        await handleMemeCommand(interaction);
      } else if (interaction.commandName === 'random') {
        await handleRandomCommand(interaction);
      } else if (interaction.commandName === 'prompted') {
        await handlePromptedCommand(interaction);
      } else if (interaction.commandName === 'topup') {
        await handleTopupCommand(interaction);
      } else if (interaction.commandName === 'link-wallet') {
        await handleLinkWalletCommand(interaction);
      } else if (interaction.commandName === 'reverify-wallet') {
        await handleReverifyWalletCommand(interaction);
      } else if (interaction.commandName === 'unlink-wallet') {
        await handleUnlinkWalletCommand(interaction);
      } else if (interaction.commandName === 'verify') {
        await handleVerify(interaction);
      } else if (interaction.commandName === 'wallet') {
        await handleWalletCommand(interaction);
      } else if (interaction.commandName === 'flex') {
        await handleFlexCommand(interaction);
      } else if (interaction.commandName === 'community-stats') {
        await handleCommunityStatsCommand(interaction);
      } else if (interaction.commandName === 'wallet-audit') {
        await handleWalletAuditCommand(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'magic_eden_verify_modal') {
      const walletAddress = interaction.fields.getTextInputValue('wallet_address');
      await startMagicEdenVerificationWithWallet(interaction, walletAddress);
      return;
    }

    if (interaction.isButton() && interaction.customId === VERIFY_BUTTON_ID) {
      await sendWalletLink(interaction, { operation: 'link' });
      return;
    }

    if (interaction.isButton() && interaction.customId === MAGIC_EDEN_VERIFY_BUTTON_ID) {
      await handleMagicEdenVerify(interaction);
      return;
    }


  } catch (error) {
    console.error('Interaction error:', error);

    const payload = {
      content: error.message || 'Something went wrong while handling that interaction.',
      ephemeral: true,
    };

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author?.bot) {
    return;
  }

  if (!message.content || !mentionsMilkman(message.content)) {
    return;
  }

  if (!canReplyToMilkman(message.channelId)) {
    return;
  }

  await message.reply({
    content: getMilkmanReply(),
    allowedMentions: {
      repliedUser: false,
    },
  }).catch((error) => {
    console.warn('Milkman reply failed:', error.message);
  });
});

startWebServer();
await client.login(config.discord.token);

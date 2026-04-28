import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  getCollectionTradeLine,
  getPageantLine,
  getWalletLinkDialogue,
  getWalletTradeLine,
} from './bot-dialogue.js';

const BRAND_RED = 0xd92d20;
const BRAND_GOLD = 0xf0b429;
const BRAND_AMBER = 0xf59e0b;
const BRAND_GREEN = 0x22c55e;
const BRAND_BLUE = 0x2563eb;

function modeLabel(mode) {
  if (mode === 'site' || mode === 'relay') return 'Live site votes';
  return 'Discord live votes';
}

function trim(text, max = 1024) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function percent(value, digits = 2) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

export function buildPageantMessage({
  sessionId,
  left,
  right,
  voteMode,
  expiresAt,
  voteSummary = { left: 0, right: 0, total: 0 },
  closed = false,
  winningSide = null,
  matchupImageUrl = '',
}) {
  const pageantLine = getPageantLine();
  const closesText = expiresAt
    ? closed
      ? `Voting closed ${new Date(expiresAt).toLocaleString()}`
      : `Voting closes <t:${Math.floor(Date.parse(expiresAt) / 1000)}:R>`
    : 'Voting window unavailable';

  const leftVotes = voteSummary.left || 0;
  const rightVotes = voteSummary.right || 0;
  const totalVotes = voteSummary.total || 0;
  const leftPct = totalVotes > 0 ? Math.round((leftVotes / totalVotes) * 100) : 0;
  const rightPct = totalVotes > 0 ? Math.round((rightVotes / totalVotes) * 100) : 0;
  const winnerText =
    closed && winningSide
      ? winningSide === 'tie'
        ? 'Result: **Tie**'
        : `Result: **${winningSide === 'left' ? 'Left' : 'Right'} wins**`
      : null;
  const outcomeBanner =
    closed && winningSide
      ? winningSide === 'tie'
        ? 'MATCH CLOSED • TIE'
        : `MATCH CLOSED • ${winningSide === 'left' ? trim(left.name, 80) : trim(right.name, 80)} WINS`
      : 'LIVE MATCHUP • VOTING OPEN';

  const header = new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle('Harmie Pageant')
    .setDescription(
      [
        closed
          ? 'Voting is closed for this matchup.'
          : 'Pick the stronger Harmie below. Everyone in this channel votes on the same live matchup.',
        '',
        pageantLine,
        '',
        `**Left** ${trim(left.name, 100)}`,
        `**Right** ${trim(right.name, 100)}`,
        '',
        closesText,
        winnerText ? '' : null,
        winnerText,
      ].filter(Boolean).join('\n'),
    )
    .addFields(
      {
        name: 'Contestants',
        value: `Left: **${trim(left.name, 100)}**\nRight: **${trim(right.name, 100)}**`,
      },
      {
        name: 'Live Vote Count',
        value: [
          `Left: **${compactNumber(leftVotes)}** (${leftPct}%)`,
          `Right: **${compactNumber(rightVotes)}** (${rightPct}%)`,
          `Total: **${compactNumber(totalVotes)}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Match Status',
        value: outcomeBanner,
        inline: true,
      },
    )
    .setFooter({
      text: closed
        ? `${modeLabel(voteMode)}`
        : `${modeLabel(voteMode)} • One vote per Discord user`,
    });

  if (matchupImageUrl) {
    header.setImage(matchupImageUrl);
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pageant:vote:left:${sessionId}`)
      .setLabel('Vote Left')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`pageant:vote:right:${sessionId}`)
      .setLabel('Vote Right')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`pageant:skip:${sessionId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
  );

  return {
    embeds: [header],
    components: [buttons],
  };
}

export function buildRankingsEmbed({ harmies, scope }) {
  const title = 'Site Harmie Rankings';
  const description =
    harmies.length === 0
      ? 'No rankings were returned from the site.'
      : harmies
          .map(
            (harmie, index) =>
              `**#${index + 1}** ${trim(harmie.name, 120)}\nELO ${compactNumber(harmie.eloScore)} • Record ${compactNumber(harmie.wins)}-${compactNumber(harmie.losses)} • ${compactNumber(harmie.totalMatches)} matches`,
          )
          .join('\n');

  return new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle(title)
    .setDescription(trim(description, 4096))
    .setFooter({
      text: 'Live standings from harmie.xyz',
    });
}

export function buildHarmieEmbed({ harmie, localStats }) {
  const attributes = Object.entries(harmie.attributes || {})
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setTitle(trim(harmie.name, 200))
    .setDescription(trim(harmie.description || 'Live Harmie profile from the site.', 4096))
    .addFields(
      {
        name: 'Live Site Stats',
        value: `ELO ${compactNumber(harmie.eloScore)} • ${compactNumber(harmie.wins)}-${compactNumber(harmie.losses)} • ${compactNumber(harmie.totalMatches)} matches`,
      },
      {
        name: 'Discord Stats',
        value: `ELO ${compactNumber(localStats.eloScore)} • ${compactNumber(localStats.wins)}-${compactNumber(localStats.losses)} • ${compactNumber(localStats.totalMatches)} matches`,
      },
      {
        name: 'Attributes',
        value: attributes || 'No attributes available.',
      },
      {
        name: 'Mint',
        value: trim(harmie.id, 1024),
      },
    );

  if (harmie.image) {
    embed.setImage(harmie.image);
  }

  return embed;
}

export function buildHarmieNotFoundMessage(query) {
  return `I couldn't find a Harmie matching \`${query}\`.`;
}

export function buildUnburnEmbed({ asset }) {
  const title = asset.name || (asset.token_id ? `Harmie #${asset.token_id}` : 'Burnt Harmie');
  const embed = new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setTitle(trim(title, 200))
    .setDescription('Recovered from the burnt Harmies set in the OpenSea activity feed.');

  if (asset.token_id) {
    embed.addFields({
      name: 'Token',
      value: `#${asset.token_id}`,
    });
  }

  if (asset.item_url) {
    embed.addFields({
      name: 'OpenSea',
      value: asset.item_url,
    });
  }

  return embed;
}

function shortAddress(value) {
  if (!value || value.length < 10) return value || 'Unknown';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function buildWalletLinkEmbed({ url, expiresAt }) {
  const dialogue = getWalletLinkDialogue('link');
  return new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setTitle('Verify Your Harmie Wallet')
    .setDescription(dialogue.subtitle)
    .addFields(
      {
        name: 'Supported Wallets',
        value: 'Phantom, Solflare, and other compatible Solana wallets detected in your browser.',
      },
      {
        name: 'What Gets Checked',
        value: dialogue.checks,
      },
      {
        name: 'Safety Guardrails',
        value: dialogue.safety,
      },
      {
        name: 'Direct Link',
        value: url,
      },
    )
    .setFooter({
      text: `Verification link expires at ${new Date(expiresAt).toLocaleString()}`,
    });
}

export function buildWalletLinkComponents({ url }) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open Secure Verifier')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    ),
  ];
}

export const VERIFY_BUTTON_ID = 'verify:link-wallet';
export const MAGIC_EDEN_VERIFY_BUTTON_ID = 'verify:magic-eden';

export function buildVerifyChannelMessage() {
  const embed = new EmbedBuilder()
    .setColor(BRAND_GOLD)
    .setTitle('Verify Your Harmie Holdings')
    .setDescription(
      [
        'Link your Solana wallet to verify your Harmie holdings and get the **HarmonyTown Resident** role.',
        '',
        'Choose your verification method below:',
        '',
        '**🔗 Web Verification**: Get a secure link to connect your wallet directly.',
        '**🪄 Magic Eden Bio**: Generate a code to paste into your Magic Eden profile bio.',
        '',
        'Both methods verify you own Harmie NFTs and grant the same role.',
      ].join('\n'),
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel('Web Verification')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(MAGIC_EDEN_VERIFY_BUTTON_ID)
      .setLabel('Magic Eden Bio')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

export function buildWalletEmbed({ wallet }) {
  const walletLines = wallet.wallets
    .slice(0, 5)
    .map((link, index) => {
      const flags = [
        link.is_primary ? 'Primary' : null,
        link.status === 'stale' ? 'Stale' : null,
        link.wallet_label || null,
      ].filter(Boolean);
      return `**${index + 1}.** \`${link.wallet_address}\`\n${compactNumber(link.harmie_count)} Harmies${flags.length ? ` • ${flags.join(' • ')}` : ''}`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle('Linked Harmie Wallets')
    .setDescription(
      [
        `Primary wallet: \`${wallet.primary_wallet_address}\``,
        `Total Harmies held: **${compactNumber(wallet.total_harmie_count)}**`,
        `Total collection share: **${percent(wallet.total_collection_share * 100)}**`,
      ].join('\n'),
    )
    .addFields({
      name: 'Linked Wallets',
      value: walletLines || 'No linked wallets.',
    })
    .setFooter({
      text: `Last checked ${new Date(wallet.last_checked_at).toLocaleString()}`,
    });
}

export function buildCommunityStatsEmbed({ snapshot }) {
  const market = snapshot.market;
  const recentSales = market.recentSales.length
    ? market.recentSales
        .map((sale, index) => {
          const when = sale.blockTime ? `<t:${sale.blockTime}:R>` : 'recently';
          return `${index + 1}. ${sale.priceSol.toFixed(2)} SOL • ${shortAddress(sale.tokenMint)} • ${when}`;
        })
        .join('\n')
    : 'No recent sales returned.';

  const topHolders = snapshot.topHolders.length
    ? snapshot.topHolders
        .map(
          (holder, index) =>
            `${index + 1}. <@${holder.discord_user_id}> — ${holder.harmie_count} Harmies`,
        )
        .join('\n')
    : 'No linked wallets yet.';

  return new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle('Harmie Community Stats')
    .setDescription(
      [
        `Linked members in this server: **${compactNumber(snapshot.linkedMembers)}**`,
        `Linked wallets in this server: **${compactNumber(snapshot.linkedWallets)}**`,
        `Harmies held by linked members: **${compactNumber(snapshot.totalHeld)}/${compactNumber(market.totalSupply)}**`,
        `Community share of supply: **${percent(snapshot.percentOwned)}**`,
        '',
        `Floor price: **${market.floorPriceSol.toFixed(2)} SOL**`,
        `Listed amount: **${compactNumber(market.listedCount)}**`,
        `24h sales: **${market.txns24hr ?? 'n/a'}**`,
        `24h volume: **${market.volume24hrSol.toFixed(2)} SOL**`,
        `Highest offer: **${market.highestOfferSol.toFixed(2)} SOL**`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Top Linked Holders',
        value: trim(topHolders, 1024),
      },
      {
        name: 'Recent Sales',
        value: trim(recentSales, 1024),
      },
    );
}

export function buildWalletAuditEmbed({ snapshot }) {
  const staleLines = snapshot.staleLinks.length
    ? snapshot.staleLinks
        .map(
          (link, index) =>
            `${index + 1}. <@${link.discord_user_id}> • \`${link.wallet_address}\` • ${link.last_status_reason || 'No detail recorded'}`,
        )
        .join('\n')
    : 'No stale wallet links right now.';

  return new EmbedBuilder()
    .setColor(snapshot.staleWallets > 0 ? BRAND_AMBER : BRAND_RED)
    .setTitle('Wallet Link Audit')
    .setDescription(
      [
        `Linked members: **${compactNumber(snapshot.linkedMembers)}**`,
        `Linked wallets: **${compactNumber(snapshot.linkedWallets)}**`,
        `Active wallets: **${compactNumber(snapshot.activeWallets)}**`,
        `Stale wallets: **${compactNumber(snapshot.staleWallets)}**`,
      ].join('\n'),
    )
    .addFields({
      name: 'Stale Wallets',
      value: trim(staleLines, 1024),
    });
}

export function buildWalletTradeEmbed({
  action,
  userId,
  holding,
  previousCount,
  nextCount,
  priceSol,
  blockTime,
}) {
  const flavor = getWalletTradeLine();
  const title = action === 'buy' ? 'Harmie Purchase' : 'Harmie Sale';
  const verb = action === 'buy' ? 'picked up' : 'sold';
  const priceText =
    typeof priceSol === 'number' && Number.isFinite(priceSol) && priceSol > 0
      ? `${priceSol.toFixed(2)} SOL`
      : 'Price unavailable';
  const when = blockTime ? `<t:${blockTime}:R>` : 'recently';

  const embed = new EmbedBuilder()
    .setColor(action === 'buy' ? BRAND_GOLD : BRAND_RED)
    .setTitle(title)
    .setDescription(
      [
        `<@${userId}> ${verb} **${holding.name || 'a Harmie'}** ${when}.`,
        `Price: **${priceText}**`,
        `Collection total: **${compactNumber(previousCount)} -> ${compactNumber(nextCount)}**`,
        flavor,
      ].join('\n'),
    )
    .setFooter({
      text: holding.mintAddress || '',
    });

  if (holding.image) {
    embed.setImage(holding.image);
  }

  return embed;
}

export function buildCollectionTradeEmbed({
  trade,
  harmie,
  buyerLabel,
  sellerLabel,
}) {
  const flavor = getCollectionTradeLine();
  const when = trade.blockTime ? `<t:${trade.blockTime}:R>` : 'recently';
  const title = `Harmie ${trade.type === 'buy' || trade.type === 'buyNow' ? 'Sale' : 'Trade'}`;
  const priceText =
    typeof trade.priceSol === 'number' && Number.isFinite(trade.priceSol) && trade.priceSol > 0
      ? `${trade.priceSol.toFixed(2)} SOL`
      : 'Price unavailable';

  const embed = new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle(title)
    .setDescription(
      [
        `**${harmie?.name || 'Harmie'}** traded ${when}.`,
        `Price: **${priceText}**`,
        `Buyer: ${buyerLabel}`,
        `Seller: ${sellerLabel}`,
        flavor,
      ].join('\n'),
    )
    .setFooter({
      text: trade.tokenMint || '',
    });

  const image = trade.image || harmie?.image || '';
  if (image) {
    embed.setImage(image);
  }

  return embed;
}

export function buildFlexShowcaseEmbed({
  userId,
  wallet,
  holding,
}) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_RED)
    .setTitle('Harmie Flex')
    .setDescription(
      [
        `<@${userId}> is showing off **${trim(holding.name || 'a Harmie', 150)}**.`,
        '',
        `Linked wallets: **${compactNumber(wallet.wallets.length)}**`,
        `Total Harmies: **${compactNumber(wallet.total_harmie_count)}**`,
        `Collection share: **${percent(wallet.total_collection_share * 100)}**`,
      ].join('\n'),
    )
    .setFooter({
      text: 'Use /flex again to show another Harmie',
    });

  if (holding.image) {
    embed.setImage(holding.image);
  }

  return embed;
}

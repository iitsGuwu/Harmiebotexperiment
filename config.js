import 'dotenv/config';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optionalBase64UrlSecret(name, fallback = '') {
  const value = process.env[name];
  if (value) {
    return value;
  }

  return fallback;
}

const generatedDevSigningKey = randomBytes(32).toString('base64url');
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const publicUrl = new URL(publicBaseUrl);
const trustedProxy = process.env.TRUST_PROXY || '';
const defaultCisBaseUrl = 'http://127.0.0.1:3001';
const cisBaseUrl = (process.env.HARMIE_CIS_BASE_URL || defaultCisBaseUrl).trim().replace(/\/+$/, '');
const cisProxyTarget = (process.env.HARMIE_CIS_PROXY_TARGET || defaultCisBaseUrl)
  .trim()
  .replace(/\/+$/, '');
const pageantVoteMode = String(process.env.PAGEANT_VOTE_MODE || 'discord').toLowerCase();
const normalizedPageantVoteMode =
  pageantVoteMode === 'site' || pageantVoteMode === 'relay' ? pageantVoteMode : 'discord';
const cardStyle = String(process.env.HARMIE_CARD_STYLE || 'cloud').toLowerCase();
const normalizedCardStyle = cardStyle === 'classic' ? 'classic' : 'cloud';

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || '',
    // Slash commands only run inside this channel (matched by name, e.g. "commands").
    // Buys/sales announcements still post to wallet.activityChannelName.
    commandsChannelName: process.env.COMMANDS_CHANNEL_NAME || 'commands',
    verifyChannelName: process.env.VERIFY_CHANNEL_NAME || 'verify',
    verifiedRoleName: process.env.VERIFIED_ROLE_NAME || 'HarmonyTown Resident',
  },
  supabase: {
    url: process.env.SUPABASE_URL || 'https://hqadajoepgoefznsomcm.supabase.co',
    key: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_nQAG0f_igApuh9U0pbEGOg_vRuO9IPG',
  },
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    collectionMint:
      process.env.HARMIES_COLLECTION_MINT || '5yKCYuZCcJU3aXwppGK87Gi59T6ceNKrTzyXYvJfsp3q',
    collectionSymbol: process.env.HARMIES_COLLECTION_SYMBOL || 'harmies',
    chainId: process.env.SOLANA_CHAIN_ID || 'solana:mainnet',
  },
  web: {
    port: Number(process.env.PORT || 3000),
    publicBaseUrl,
    origin: publicUrl.origin,
    hostname: publicUrl.hostname,
    host: publicUrl.host,
    isLocalhost: ['localhost', '127.0.0.1'].includes(publicUrl.hostname),
    trustedProxy,
  },
  market: {
    magicEdenApiBaseUrl: process.env.MAGIC_EDEN_API_BASE_URL || 'https://api-mainnet.magiceden.dev/v2',
    magicEdenCollectionUrl:
      process.env.MAGIC_EDEN_COLLECTION_URL || 'https://magiceden.io/marketplace/harmies',
  },
  cis: {
    baseUrl: cisBaseUrl,
    configured: Boolean(process.env.HARMIE_CIS_BASE_URL),
    defaultBaseUrl: defaultCisBaseUrl,
    proxyTarget: cisProxyTarget,
  },
  database: {
    path: path.resolve(process.env.DATABASE_PATH || './data/harmie-bot.sqlite'),
  },
  pageant: {
    voteMode: normalizedPageantVoteMode,
    votingWindowMinutes: Number(process.env.PAGEANT_VOTING_WINDOW_MINUTES || 60),
    defaultElo: 1200,
    voteCooldownMs: Number(process.env.PAGEANT_VOTE_COOLDOWN_MS || 3000),
    duplicatePairCooldownHours: Number(process.env.PAGEANT_DUPLICATE_PAIR_COOLDOWN_HOURS || 24),
    dailyVoteLimit: Number(process.env.PAGEANT_DAILY_VOTE_LIMIT || 50),
    establishedKFactor: Number(process.env.PAGEANT_ESTABLISHED_K_FACTOR || 16),
    newKFactor: Number(process.env.PAGEANT_NEW_K_FACTOR || 32),
    establishedThreshold: Number(process.env.PAGEANT_ESTABLISHED_THRESHOLD || 100),
    siteSessionRefreshSkewSeconds: Number(process.env.SITE_SESSION_REFRESH_SKEW_SECONDS || 120),
    relay: {
      url: (process.env.PAGEANT_RELAY_URL || '').trim(),
      secret: process.env.PAGEANT_RELAY_SECRET || '',
      timeoutMs: Number(process.env.PAGEANT_RELAY_TIMEOUT_MS || 8000),
    },
  },
  wallet: {
    nonceTtlSeconds: Number(process.env.WALLET_NONCE_TTL_SECONDS || 600),
    balanceCacheSeconds: Number(process.env.WALLET_BALANCE_CACHE_SECONDS || 600),
    pollIntervalMs: Number(process.env.WALLET_POLL_INTERVAL_MS || 60000),
    activityChannelName: process.env.WALLET_ACTIVITY_CHANNEL_NAME || 'buys-sales',
    maxWalletsPerUser: Number(process.env.WALLET_MAX_LINKED_WALLETS || 5),
    maxLinkRequestsPerIpWindow: Number(process.env.WALLET_LINK_RATE_LIMIT_PER_IP || 20),
    maxLinkRequestsPerUserWindow: Number(process.env.WALLET_LINK_RATE_LIMIT_PER_USER || 6),
    linkRateLimitWindowMs: Number(process.env.WALLET_LINK_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    maxVerifyAttemptsPerChallenge: Number(process.env.WALLET_MAX_VERIFY_ATTEMPTS || 5),
    staleFailureThreshold: Number(process.env.WALLET_STALE_FAILURE_THRESHOLD || 3),
  },
  cards: {
    // 'cloud' = #3d5cff royal blue + cloud-white accents (new default)
    // 'classic' = the original black + yellow look
    style: normalizedCardStyle,
  },
  security: {
    signingKey: optionalBase64UrlSecret('SECURITY_SIGNING_KEY', generatedDevSigningKey),
    tokenEncryptionKey:
      optionalBase64UrlSecret('TOKEN_ENCRYPTION_KEY') ||
      optionalBase64UrlSecret('SECURITY_SIGNING_KEY'),
    csrfCookieName: process.env.CSRF_COOKIE_NAME || 'harmie_verify',
  },
};

import { config } from './config.js';
import {
  getWalletSummary,
  listGuildVerifiedWallets,
  listWalletLinks,
  updateWalletLinkSnapshot,
} from './wallet-store.js';

const MARKET_CACHE_TTL_MS = 60 * 1000;

const marketCache = {
  data: null,
  fetchedAt: 0,
};

function createError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

async function jsonRpc(method, params) {
  const response = await fetch(config.solana.rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `harmie-bot:${method}`,
      method,
      params,
    }),
  });

  const payload = await response.json();

  if (!response.ok || payload.error) {
    const rawMessage = payload.error?.message || `RPC request failed with ${response.status}`;
    const methodMissing = String(rawMessage).toLowerCase().includes('method not found');
    const message = methodMissing
      ? 'Wallet lookups need a DAS-compatible SOLANA_RPC_URL that supports `searchAssets`.'
      : rawMessage;

    throw createError(message, {
      rpcError: payload.error,
    });
  }

  return payload.result;
}

export async function getWalletHarmieCount(walletAddress) {
  const result = await jsonRpc('searchAssets', {
    ownerAddress: walletAddress,
    grouping: ['collection', config.solana.collectionMint],
    page: 1,
    limit: 1000,
  });

  return {
    count: result.total ?? result.items?.length ?? 0,
  };
}

function pickAssetImage(asset) {
  const linksImage = asset?.content?.links?.image || asset?.content?.links?.thumbnail || '';
  if (linksImage) return linksImage;

  const files = Array.isArray(asset?.content?.files) ? asset.content.files : [];
  const preferredFile =
    files.find((file) => file?.mime?.startsWith?.('image/')) ||
    files.find((file) => file?.uri) ||
    null;

  return preferredFile?.uri || '';
}

function mapWalletHoldingAsset(asset) {
  const metadata = asset?.content?.metadata || {};
  return {
    mintAddress: asset?.id,
    name: metadata?.name || `Harmie ${String(asset?.id || '').slice(0, 6)}`,
    image: pickAssetImage(asset),
  };
}

export async function getWalletHarmieHoldings(walletAddress) {
  const result = await jsonRpc('searchAssets', {
    ownerAddress: walletAddress,
    grouping: ['collection', config.solana.collectionMint],
    page: 1,
    limit: 1000,
  });

  const items = Array.isArray(result.items) ? result.items : [];
  return items
    .map(mapWalletHoldingAsset)
    .filter((holding) => Boolean(holding.mintAddress));
}

export async function refreshVerifiedWallet(
  discordUserId,
  { force = false, totalSupply = 500 } = {},
) {
  const summary = getWalletSummary(discordUserId);
  if (!summary) return null;

  const refreshedWallets = [];
  for (const wallet of summary.wallets) {
    if (!force && wallet.last_checked_at) {
      const ageMs = Date.now() - Date.parse(wallet.last_checked_at);
      if (ageMs < config.wallet.balanceCacheSeconds * 1000) {
        refreshedWallets.push(wallet);
        continue;
      }
    }

    const snapshot = await getWalletHarmieCount(wallet.wallet_address);
    refreshedWallets.push(updateWalletLinkSnapshot(wallet.id, snapshot.count, totalSupply));
  }

  return getWalletSummary(discordUserId);
}

async function refreshWalletRecord(record, totalSupply) {
  if (!record.last_checked_at) {
    const snapshot = await getWalletHarmieCount(record.wallet_address);
    return updateWalletLinkSnapshot(record.wallet_link_id, snapshot.count, totalSupply);
  }

  const ageMs = Date.now() - Date.parse(record.last_checked_at);
  if (ageMs < config.wallet.balanceCacheSeconds * 1000) {
    return record;
  }

  const snapshot = await getWalletHarmieCount(record.wallet_address);
  return updateWalletLinkSnapshot(record.wallet_link_id, snapshot.count, totalSupply);
}

async function fetchMagicEdenJson(pathname) {
  const response = await fetch(`${config.market.magicEdenApiBaseUrl}${pathname}`, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Magic Eden request failed with ${response.status}`);
  }

  return response.json();
}

export async function getRecentCollectionTrades(limit = 100) {
  const activities = await fetchMagicEdenJson(
    `/collections/${config.solana.collectionSymbol}/activities?offset=0&limit=${limit}`,
  );

  return (Array.isArray(activities) ? activities : [])
    .filter((activity) => activity.type === 'buy' || activity.type === 'buyNow')
    .map((activity) => ({
      tokenMint: activity.tokenMint,
      buyer: activity.buyer || null,
      seller: activity.seller || null,
      priceSol: Number(activity.price || 0),
      image: activity.image || '',
      blockTime: activity.blockTime || null,
      signature: activity.signature || null,
      type: activity.type,
    }));
}

async function fetchMagicEdenPageSummary() {
  const response = await fetch(config.market.magicEdenCollectionUrl);
  if (!response.ok) {
    throw new Error(`Magic Eden page request failed with ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) {
    throw new Error('Magic Eden page data was not found.');
  }

  const data = JSON.parse(match[1]);
  const queries = data.props?.pageProps?.dehydratedState?.queries || [];
  const collection = queries.find((query) => query.queryKey?.[0] === 'sol-collection')?.state?.data || {};
  const stats =
    queries.find((query) => query.queryKey?.[0] === 'collection-escrow-stats')?.state?.data || {};

  return {
    // Use truthy fallback so a 0 (empty/dehydrated state) does not poison the cache.
    totalItems: Number(collection.totalItems) > 0 ? Number(collection.totalItems) : 500,
    floorPriceLamports: stats.floorPrice ?? null,
    listedCount: stats.listedCount ?? null,
    volume24hrLamports: stats.volume24hr ?? null,
    txns24hr: stats.txns24hr ?? null,
    highestGlobalOfferLamports: stats.highestGlobalOffer ?? null,
  };
}

export async function getCollectionMarketSnapshot({ force = false } = {}) {
  if (!force && marketCache.data && Date.now() - marketCache.fetchedAt < MARKET_CACHE_TTL_MS) {
    return marketCache.data;
  }

  const [stats, pageSummary, activities] = await Promise.all([
    fetchMagicEdenJson(`/collections/${config.solana.collectionSymbol}/stats`),
    fetchMagicEdenPageSummary(),
    fetchMagicEdenJson(`/collections/${config.solana.collectionSymbol}/activities?offset=0&limit=20`),
  ]);

  const recentSales = (Array.isArray(activities) ? activities : [])
    .filter((activity) => activity.type === 'buy' || activity.type === 'buyNow')
    .slice(0, 5)
    .map((activity) => ({
      tokenMint: activity.tokenMint,
      priceSol: Number(activity.price || 0),
      blockTime: activity.blockTime || null,
      // ME activity responses include these on most endpoints
      name: activity.tokenName || activity.name || null,
      image: activity.tokenImage || activity.image || null,
    }));

  const snapshot = {
    totalSupply: Number(pageSummary.totalItems) > 0 ? Number(pageSummary.totalItems) : 500,
    floorPriceSol: (pageSummary.floorPriceLamports ?? stats.floorPrice ?? 0) / 1_000_000_000,
    listedCount: pageSummary.listedCount ?? stats.listedCount ?? 0,
    avgPrice24hrSol: (stats.avgPrice24hr ?? 0) / 1_000_000_000,
    volume24hrSol: (pageSummary.volume24hrLamports ?? 0) / 1_000_000_000,
    txns24hr: pageSummary.txns24hr ?? null,
    highestOfferSol: (pageSummary.highestGlobalOfferLamports ?? 0) / 1_000_000_000,
    recentSales,
  };

  marketCache.data = snapshot;
  marketCache.fetchedAt = Date.now();

  return snapshot;
}

export async function getGuildOwnershipSnapshot(guildId) {
  const market = await getCollectionMarketSnapshot();
  const linkedWallets = listGuildVerifiedWallets(guildId);
  const refreshed = [];

  for (const wallet of linkedWallets) {
    refreshed.push(await refreshWalletRecord(wallet, market.totalSupply));
  }

  const totalsByUser = new Map();
  for (const wallet of refreshed) {
    const existing = totalsByUser.get(wallet.discord_user_id) || {
      discord_user_id: wallet.discord_user_id,
      harmie_count: 0,
      wallet_count: 0,
    };
    existing.harmie_count += wallet.harmie_count || 0;
    existing.wallet_count += 1;
    totalsByUser.set(wallet.discord_user_id, existing);
  }

  const totalHeld = refreshed.reduce((sum, wallet) => sum + (wallet.harmie_count || 0), 0);
  const topHolders = [...totalsByUser.values()]
    .sort((left, right) => right.harmie_count - left.harmie_count)
    .slice(0, 5);

  return {
    linkedMembers: totalsByUser.size,
    linkedWallets: refreshed.length,
    totalHeld,
    percentOwned: market.totalSupply > 0 ? (totalHeld / market.totalSupply) * 100 : 0,
    market,
    topHolders,
  };
}

export function listUserWalletLinks(discordUserId) {
  return listWalletLinks(discordUserId);
}

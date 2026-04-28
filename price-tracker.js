/**
 * price-tracker.js
 *
 * Keeps the bot's Discord activity status up to date with:
 *   SOL: $XXX  ·  Harmies FP: X.XX◎
 *
 * SOL price comes from Binance's public ticker endpoint (no API key needed).
 * Harmie floor price comes from the existing collection-stats module.
 */

import { ActivityType } from 'discord.js';
import { getCollectionMarketSnapshot } from './collection-stats.js';

const SOL_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT';
const UPDATE_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 minutes

async function fetchSolPriceUsd() {
  const response = await fetch(SOL_PRICE_URL, {
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Binance responded ${response.status}`);
  }

  const data = await response.json();
  const price = parseFloat(data.price || '0');
  if (!price || !Number.isFinite(price)) {
    throw new Error('Invalid SOL price in response');
  }

  return price;
}

function formatSolPrice(usd) {
  if (usd >= 10000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1000) return `$${Math.round(usd / 10) * 10}`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(1)}`;
}

async function buildStatusText() {
  const [solResult, marketResult] = await Promise.allSettled([
    fetchSolPriceUsd(),
    getCollectionMarketSnapshot(),
  ]);

  const parts = [];

  if (solResult.status === 'fulfilled' && solResult.value > 0) {
    parts.push(`SOL: ${formatSolPrice(solResult.value)}`);
  }

  if (
    marketResult.status === 'fulfilled' &&
    marketResult.value?.floorPriceSol > 0
  ) {
    parts.push(`Harmies FP: ${marketResult.value.floorPriceSol.toFixed(2)}◎`);
  }

  return parts.length > 0 ? parts.join('  ·  ') : null;
}

export function startPriceTracking(client) {
  const run = async () => {
    try {
      const text = await buildStatusText();
      if (text) {
        client.user?.setActivity(text, { type: ActivityType.Watching });
      }
    } catch (error) {
      console.warn('Price tracker update failed:', error.message);
    }
  };

  // Fire immediately so the status appears as soon as the bot is ready.
  void run();

  // Then refresh on a fixed interval.
  setInterval(run, UPDATE_INTERVAL_MS);
}

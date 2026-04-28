import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  HorizontalAlign,
  Jimp,
  JimpMime,
  intToRGBA,
  loadFont,
  measureText,
  rgbaToInt,
} from 'jimp';
import {
  SANS_16_BLACK,
  SANS_16_WHITE,
  SANS_32_BLACK,
  SANS_32_WHITE,
  SANS_64_BLACK,
  SANS_64_WHITE,
} from 'jimp/fonts';
import {
  getFlexDialogue,
  getHarmieDialogue,
  getRankingsDialogue,
  getWalletAuditDialogue,
  getWalletDialogue,
  getWalletLinkDialogue,
} from './bot-dialogue.js';
import { config } from './config.js';

const CARD_WIDTH = 1400;
const CARD_HEIGHT = 860;
const HERO_HEIGHT = 650;
const FOOTER_HEIGHT = CARD_HEIGHT - HERO_HEIGHT;
const IMAGE_WIDTH = 560;
const CARD_CACHE_ROOT = path.resolve(process.cwd(), 'data', 'card-cache');
const CARD_SHELL_CACHE_DIR = path.join(CARD_CACHE_ROOT, 'shells');
const CARD_IMAGE_CACHE_DIR = path.join(CARD_CACHE_ROOT, 'images');

// Two card palettes. Keys keep their original semantic names (black = hero base,
// yellow = footer + accent) so the rest of the file doesn't need to know which
// palette is active.
const CLASSIC_PALETTE = {
  black: 0x090909ff,
  blackSoft: 0x131313ff,
  yellow: 0xffea57ff,
  yellowSoft: 0xffea5790,
  yellowDark: 0xe8d13dff,
  white: 0xffffffff,
  muted: 0xcfcfcfff,
  slate: 0x282828ff,
};

// #3d5cff royal-blue hero, cloud-white footer/accents. White text reads on the
// hero, dark blue / black text reads on the footer.
const CLOUD_PALETTE = {
  black: 0x3d5cffff,        // hero base (royal blue #3d5cff)
  blackSoft: 0x5773ffff,    // hero gradient bottom (lighter blue)
  yellow: 0xf2f4fbff,       // accent / footer (cloud white)
  yellowSoft: 0xf2f4fb90,   // semi-transparent cloud (divider lines)
  yellowDark: 0xd6deedff,   // slightly darker cloud (shadows / borders)
  white: 0xffffffff,        // hero text
  muted: 0xcfd6ecff,        // muted blue-grey
  slate: 0x2a3fcfff,        // deep blue
};

const COLORS = config.cards.style === 'classic' ? CLASSIC_PALETTE : CLOUD_PALETTE;
const PALETTE_ID = config.cards.style === 'classic' ? 'classic' : 'cloud';

let fontPromise;
const execFileAsync = promisify(execFile);
const shellCache = new Map();
const processedImageCache = new Map();

mkdirSync(CARD_SHELL_CACHE_DIR, { recursive: true });
mkdirSync(CARD_IMAGE_CACHE_DIR, { recursive: true });

async function getFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      loadFont(SANS_16_BLACK),
      loadFont(SANS_16_WHITE),
      loadFont(SANS_32_BLACK),
      loadFont(SANS_32_WHITE),
      loadFont(SANS_64_BLACK),
      loadFont(SANS_64_WHITE),
    ]).then(([smallBlack, smallWhite, mediumBlack, mediumWhite, largeBlack, largeWhite]) => ({
      smallBlack,
      smallWhite,
      mediumBlack,
      mediumWhite,
      largeBlack,
      largeWhite,
    }));
  }

  return fontPromise;
}

function cacheKey(parts) {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

async function loadCachedCanvas(cacheDir, cacheStore, key, build) {
  const cachePath = path.join(cacheDir, `${key}.png`);
  const cached = cacheStore.get(key);
  if (cached) {
    return cached.clone();
  }

  let image;
  if (existsSync(cachePath)) {
    image = await Jimp.read(await readFile(cachePath));
  } else {
    image = await build();
    await writeFile(cachePath, await image.getBuffer(JimpMime.png));
  }

  cacheStore.set(key, image);
  return image.clone();
}

function drawRect(target, x, y, width, height, color) {
  target.composite(new Jimp({ width, height, color }), x, y);
}

function drawVerticalGradient(target, x, y, width, height, topColor, bottomColor) {
  const strip = new Jimp({ width, height, color: topColor });
  const top = intToRGBA(topColor);
  const bottom = intToRGBA(bottomColor);

  for (let py = 0; py < height; py += 1) {
    const t = height <= 1 ? 0 : py / (height - 1);
    const color = rgbaToInt(
      Math.round(top.r + (bottom.r - top.r) * t),
      Math.round(top.g + (bottom.g - top.g) * t),
      Math.round(top.b + (bottom.b - top.b) * t),
      Math.round(top.a + (bottom.a - top.a) * t),
    );

    for (let px = 0; px < width; px += 1) {
      strip.setPixelColor(color, px, py);
    }
  }

  target.composite(strip, x, y);
}

async function buildFeatureShell() {
  const card = new Jimp({ width: CARD_WIDTH, height: CARD_HEIGHT, color: COLORS.black });
  drawVerticalGradient(card, 0, 0, CARD_WIDTH, HERO_HEIGHT, COLORS.black, COLORS.blackSoft);
  drawRect(card, 0, HERO_HEIGHT, CARD_WIDTH, FOOTER_HEIGHT, COLORS.yellow);
  drawRect(card, 600, 80, 2, 500, COLORS.yellowSoft);
  return card;
}

async function buildCommunityShell() {
  const { smallWhite, largeWhite } = await getFonts();
  const card = await buildFeatureShell();

  card.print({
    font: smallWhite,
    x: 76,
    y: 78,
    text: 'COMMUNITY PULSE',
    maxWidth: 420,
    maxHeight: 22,
  });

  const titleImage = await createTintedTextImage({
    text: 'HARMIE\nCOMMUNITY\nSTATS',
    width: 520,
    height: 260,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, 116);

  return card;
}

async function buildFlexShell() {
  const card = new Jimp({ width: CARD_WIDTH, height: CARD_HEIGHT, color: COLORS.black });
  drawVerticalGradient(card, 0, 0, CARD_WIDTH, HERO_HEIGHT, COLORS.black, COLORS.blackSoft);
  drawRect(card, 0, HERO_HEIGHT, CARD_WIDTH, FOOTER_HEIGHT, COLORS.yellow);
  return card;
}

async function getCardShell(kind) {
  const builders = {
    community: buildCommunityShell,
    feature: buildFeatureShell,
    flex: buildFlexShell,
  };

  const build = builders[kind] || builders.feature;
  return loadCachedCanvas(
    CARD_SHELL_CACHE_DIR,
    shellCache,
    cacheKey(['shell', PALETTE_ID, kind, CARD_WIDTH, CARD_HEIGHT, HERO_HEIGHT, FOOTER_HEIGHT]),
    build,
  );
}

// Jimp's bundled Open Sans BMFonts only ship glyphs for ASCII + Latin-1 (cp 0-255),
// so any character above U+00FF (ellipsis, em-dash, bullet, curly quotes, etc.)
// renders as the missing-glyph fallback — a literal '?'. Every string we hand to
// `card.print` or `createTintedTextImage` must be normalised to ASCII first.
const BITMAP_TEXT_REPLACEMENTS = [
  [/[…]/g, '...'],
  [/[–—]/g, '-'],
  [/[•∙·]/g, '-'],
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/ /g, ' '],
];

function sanitizeBitmapText(text) {
  let value = String(text ?? '');
  for (const [pattern, replacement] of BITMAP_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

function trimText(text, max = 42) {
  const value = sanitizeBitmapText(String(text || '').trim());
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function toLines(text, width = 18) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.join('\n');
}

async function loadImage(source, width, height, fallbackLabel) {
  return loadProcessedImage({
    source,
    width,
    height,
    fallbackLabel,
    mode: 'cover',
  });
}

async function loadContainedImage(source, width, height, fallbackLabel) {
  return loadProcessedImage({
    source,
    width,
    height,
    fallbackLabel,
    mode: 'contain',
  });
}

async function loadProcessedImage({
  source,
  width,
  height,
  fallbackLabel,
  mode,
}) {
  if (Buffer.isBuffer(source)) {
    try {
      const image = await readRenderableImage(source, 'buffer');
      image[mode]({ w: width, h: height });
      return image;
    } catch {
      return buildFallbackImage(width, height, fallbackLabel);
    }
  }

  const normalizedSource = String(source || '');
  // Fallback images are tinted with the active palette (slate background), so the
  // cache key must include the palette — otherwise switching styles returns the
  // previous palette's fallback. Real photo crops are palette-independent but it
  // costs nothing to namespace them too.
  const imageKey = cacheKey([
    'processed-image',
    PALETTE_ID,
    normalizedSource || `fallback:${fallbackLabel}`,
    width,
    height,
    mode,
    fallbackLabel,
  ]);

  return loadCachedCanvas(
    CARD_IMAGE_CACHE_DIR,
    processedImageCache,
    imageKey,
    async () => {
      if (!normalizedSource) {
        return buildFallbackImage(width, height, fallbackLabel);
      }

      try {
        const input = /^https?:\/\//i.test(normalizedSource)
          ? Buffer.from(await fetch(normalizedSource).then((response) => response.arrayBuffer()))
          : await readFile(normalizedSource);
        const image = await readRenderableImage(input, normalizedSource);
        image[mode]({ w: width, h: height });
        return image;
      } catch {
        return buildFallbackImage(width, height, fallbackLabel);
      }
    },
  );
}

async function readRenderableImage(input, source) {
  try {
    return await Jimp.read(input);
  } catch {
    const converted = await convertImageToPng(input, source);
    return Jimp.read(converted);
  }
}

async function convertImageToPng(input, source) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'harmie-card-'));
  const ext = path.extname(String(source || 'input.img')) || '.img';
  const inputPath = path.join(tempDir, `input${ext}`);
  const outputPath = path.join(tempDir, 'output.png');

  try {
    await writeFile(inputPath, input);
    await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-frames:v', '1', outputPath]);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildFallbackImage(width, height, label) {
  const { mediumWhite } = await getFonts();
  const image = new Jimp({ width, height, color: COLORS.slate });

  image.print({
    font: mediumWhite,
    x: 24,
    y: Math.floor(height / 2) - 24,
    text: {
      text: label,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: width - 48,
    maxHeight: 48,
  });

  return image;
}

function formatMetric(label, value) {
  return { label: String(label), value: String(value) };
}

async function addMetricColumn(canvas, metric, x, y, width) {
  const { smallBlack, mediumBlack } = await getFonts();

  canvas.print({
    font: smallBlack,
    x,
    y,
    text: trimText(metric.label.toUpperCase(), 22),
    maxWidth: width,
    maxHeight: 22,
  });

  canvas.print({
    font: mediumBlack,
    x,
    y: y + 30,
    text: trimText(metric.value, 14),
    maxWidth: width,
    maxHeight: 44,
  });
}

async function addCompactMetricColumn(canvas, metric, x, y, width) {
  const { smallBlack, mediumBlack } = await getFonts();

  canvas.print({
    font: smallBlack,
    x,
    y,
    text: trimText(metric.label.toUpperCase(), 22),
    maxWidth: width,
    maxHeight: 20,
  });

  canvas.print({
    font: mediumBlack,
    x,
    y: y + 24,
    text: trimText(metric.value, 14),
    maxWidth: width,
    maxHeight: 34,
  });
}

async function drawFooterLabel(canvas, text) {
  const { smallBlack } = await getFonts();
  canvas.print({
    font: smallBlack,
    x: 72,
    y: HERO_HEIGHT + 22,
    text: trimText(String(text || '').toUpperCase(), 40),
    maxWidth: CARD_WIDTH - 144,
    maxHeight: 22,
  });
}

async function createTintedTextImage({ text, width, height, font, color, alignmentX = HorizontalAlign.LEFT }) {
  const image = new Jimp({ width, height, color: 0x00000000 });
  const tint = intToRGBA(color);

  image.print({
    font,
    x: 0,
    y: 0,
    text: {
      text: sanitizeBitmapText(text),
      alignmentX,
    },
    maxWidth: width,
    maxHeight: height,
  });

  image.scan(0, 0, width, height, function scan(pixelX, pixelY, idx) {
    const alpha = this.bitmap.data[idx + 3];
    if (alpha === 0) {
      return;
    }

    this.bitmap.data[idx] = tint.r;
    this.bitmap.data[idx + 1] = tint.g;
    this.bitmap.data[idx + 2] = tint.b;
  });

  return image;
}

async function renderCardBase({ kicker, title, subtitle, imageSource, imageFallbackLabel, metrics }) {
  const { smallWhite, mediumWhite, largeWhite } = await getFonts();
  const card = await getCardShell('feature');

  const accentImage = await loadImage(imageSource, IMAGE_WIDTH, HERO_HEIGHT - 80, imageFallbackLabel);
  accentImage.opacity(0.92);
  card.composite(accentImage, CARD_WIDTH - IMAGE_WIDTH - 36, 40);
  drawRect(card, CARD_WIDTH - IMAGE_WIDTH - 36, 40, IMAGE_WIDTH, HERO_HEIGHT - 80, 0x00000020);

  if (kicker) {
    card.print({
      font: smallWhite,
      x: 76,
      y: 78,
      text: trimText(kicker.toUpperCase(), 36),
      maxWidth: 420,
      maxHeight: 22,
    });
  }

  const titleImage = await createTintedTextImage({
    text: toLines(title.toUpperCase(), 14),
    width: 560,
    height: 200,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, kicker ? 110 : 90);

  card.print({
    font: mediumWhite,
    x: 76,
    y: 320,
    text: trimText(subtitle, 160),
    maxWidth: 500,
    maxHeight: 270,
  });

  await drawFooterLabel(card, 'LIVE SNAPSHOT');

  const metricWidth = Math.floor((CARD_WIDTH - 160) / Math.max(metrics.length, 1));
  for (const [index, metric] of metrics.entries()) {
    await addMetricColumn(card, metric, 72 + index * metricWidth, HERO_HEIGHT + 88, metricWidth - 24);
  }

  return card;
}

export async function renderCommunityStatsCard({ snapshot, imageSource }) {
  const market = snapshot.market;

  const marketBody = [
    `Floor   ${formatSol(market.floorPriceSol)}`,
    `Listed  ${compactNumber(market.listedCount)}`,
    `Avg     ${market.avgPrice24hrSol > 0 ? formatSol(market.avgPrice24hrSol) : '—'}`,
    `Offer   ${market.highestOfferSol > 0 ? formatSol(market.highestOfferSol) : '—'}`,
  ].join('\n');

  const activityBody = [
    `Volume  ${formatSol(market.volume24hrSol)}`,
    `Sales   ${market.txns24hr == null ? '—' : compactNumber(market.txns24hr)}`,
    `Held    ${Number(snapshot.percentOwned || 0).toFixed(1)}% of supply`,
  ].join('\n');

  return renderFeatureCard({
    kicker: 'Community Pulse',
    title: 'Community Stats',
    subtitle: '',
    imageSource,
    imageFallbackLabel: 'HARMIE',
    metrics: [
      formatMetric('Floor Price', formatSol(market.floorPriceSol)),
      formatMetric('Listed', compactNumber(market.listedCount)),
      formatMetric('24h Volume', formatSol(market.volume24hrSol)),
      formatMetric('Community %', `${Number(snapshot.percentOwned || 0).toFixed(1)}%`),
    ],
    leftLabel: 'Market',
    leftBody: marketBody,
    rightLabel: '24h Activity',
    rightBody: activityBody,
    footerLabel: 'Community Pulse',
    layout: { leftY: 340, rightY: 340, leftBodyHeight: 280, rightBodyHeight: 280 },
  });
}

function formatSol(value) {
  const number = Number(value || 0);
  return number > 0 ? `${number.toFixed(2)} SOL` : '-';
}

export async function renderHarmieProfileCard({ harmie, localStats, imageSource }) {
  const metrics = [
    formatMetric('Site ELO', `${harmie.eloScore}`),
    formatMetric('Site Record', `${harmie.wins}-${harmie.losses}`),
    formatMetric('Matches', `${harmie.totalMatches}`),
    formatMetric('Discord ELO', `${localStats.eloScore}`),
  ];

  const card = await renderCardBase({
    kicker: 'Collection Roll',
    title: harmie.name || 'Harmie',
    subtitle: trimText(harmie.description || 'Live Harmie profile from harmie.xyz.', 130),
    imageSource,
    imageFallbackLabel: 'HARMIE',
    metrics,
  });

  return card.getBuffer(JimpMime.png);
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function percent(value, digits = 2) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function shortAddress(value) {
  if (!value || value.length < 10) return value || 'Unknown';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildList(items, fallback, limit = 4) {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.slice(0, limit).join('\n');
}

async function drawLabeledCopy(canvas, { label, body, x, y, width, bodyHeight = 160 }) {
  const { smallWhite, mediumWhite } = await getFonts();

  canvas.print({
    font: smallWhite,
    x,
    y,
    text: trimText(String(label || '').toUpperCase(), 36),
    maxWidth: width,
    maxHeight: 22,
  });

  canvas.print({
    font: mediumWhite,
    x,
    y: y + 28,
    text: trimText(String(body || ''), 240),
    maxWidth: width,
    maxHeight: bodyHeight,
  });
}

async function renderFeatureCard({
  kicker,
  title,
  subtitle,
  imageSource,
  imageFallbackLabel,
  metrics,
  leftLabel,
  leftBody,
  rightLabel,
  rightBody,
  footerLabel = 'LIVE SNAPSHOT',
  layout = {},
}) {
  const { smallWhite, mediumWhite, largeWhite } = await getFonts();
  const card = await getCardShell('feature');
  const subtitleY = layout.subtitleY ?? 320;
  const subtitleMaxWidth = layout.subtitleMaxWidth ?? 500;
  const subtitleMaxHeight = layout.subtitleMaxHeight ?? 90;
  const leftX = layout.leftX ?? 76;
  const leftY = layout.leftY ?? 432;
  const leftWidth = layout.leftWidth ?? 230;
  const leftBodyHeight = layout.leftBodyHeight ?? 180;
  const rightX = layout.rightX ?? 332;
  const rightY = layout.rightY ?? 432;
  const rightWidth = layout.rightWidth ?? 240;
  const rightBodyHeight = layout.rightBodyHeight ?? 180;

  const accentImage = await loadImage(imageSource, IMAGE_WIDTH, HERO_HEIGHT - 80, imageFallbackLabel);
  accentImage.opacity(0.96);
  card.composite(accentImage, CARD_WIDTH - IMAGE_WIDTH - 36, 40);

  if (kicker) {
    card.print({
      font: smallWhite,
      x: 76,
      y: 78,
      text: trimText(kicker.toUpperCase(), 36),
      maxWidth: 500,
      maxHeight: 22,
    });
  }

  const titleImage = await createTintedTextImage({
    text: toLines(title.toUpperCase(), 14),
    width: 520,
    height: 200,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, 110);

  if (subtitle) {
    card.print({
      font: smallWhite,
      x: 76,
      y: subtitleY,
      text: trimText(subtitle, 120),
      maxWidth: subtitleMaxWidth,
      maxHeight: subtitleMaxHeight,
    });
  }

  await drawLabeledCopy(card, {
    label: leftLabel,
    body: leftBody,
    x: leftX,
    y: leftY,
    width: leftWidth,
    bodyHeight: leftBodyHeight,
  });

  await drawLabeledCopy(card, {
    label: rightLabel,
    body: rightBody,
    x: rightX,
    y: rightY,
    width: rightWidth,
    bodyHeight: rightBodyHeight,
  });

  await drawFooterLabel(card, footerLabel);

  const cols = Math.max(metrics.length, 1);
  const metricWidth = Math.floor((CARD_WIDTH - 160) / cols);
  for (const [index, metric] of metrics.entries()) {
    await addMetricColumn(card, metric, 72 + index * metricWidth, HERO_HEIGHT + 88, metricWidth - 24);
  }

  return card.getBuffer(JimpMime.png);
}

export async function renderRankingsCard({ harmies, scope = 'site' }) {
  const leader = harmies[0] || null;
  const dialogue = getRankingsDialogue({ leader });
  const rankingLines = harmies.length
    ? harmies
        .slice(0, 4)
        .map(
          (harmie, index) =>
            `#${index + 1} ${trimText(harmie.name, 12)} • ${compactNumber(harmie.eloScore)}`,
        )
        .join('\n')
    : 'No rankings were returned from the site.';
  const leaderLines = leader
    ? [
        trimText(leader.name, 28),
        `Record ${compactNumber(leader.wins)}-${compactNumber(leader.losses)}`,
        `${compactNumber(leader.totalMatches)} matches`,
      ].join('\n')
    : 'Waiting for live site data.';

  return renderFeatureCard({
    kicker: scope === 'discord' ? 'Discord Rankings' : 'Live Site Rankings',
    title: 'Harmie Rankings',
    subtitle: '',
    imageSource: leader?.image || null,
    imageFallbackLabel: 'RANKINGS',
    metrics: [
      formatMetric('Ranked', `${harmies.length}`),
      formatMetric('#1 ELO', `${leader?.eloScore ?? '—'}`),
      formatMetric('#1 Matches', `${leader?.totalMatches ?? '—'}`),
    ],
    leftLabel: 'Top Ranked',
    leftBody: rankingLines,
    rightLabel: '',
    rightBody: '',
    footerLabel: dialogue.footerLabel,
  });
}

/**
 * Trade card for the buys/sales channel — shares the yellow/black look of every
 * other embed so the channel reads like a continuation, not a different bot.
 *
 * Caller passes a `parties` array (left/right or buyer/seller labels) plus
 * metric tiles. Anything not provided is omitted gracefully.
 */
export async function renderTradeCard({
  kicker = 'BUYS / SALES',
  title,
  subtitle = '',
  statusText = '',
  imageSource,
  imageFallbackLabel = 'TRADE',
  metrics = [],
  parties = [],
  footerLabel = 'BUYS & SALES',
}) {
  const { mediumWhite, largeWhite, largeBlack } = await getFonts();
  const card = await getCardShell('feature');

  const accentImage = await loadImage(imageSource, IMAGE_WIDTH, HERO_HEIGHT - 80, imageFallbackLabel);
  accentImage.opacity(0.96);
  card.composite(accentImage, CARD_WIDTH - IMAGE_WIDTH - 36, 40);

  // Kicker bumped from small (16pt) to medium (32pt) — at 1400px wide, 16pt was unreadable.
  card.print({
    font: mediumWhite,
    x: 76,
    y: 70,
    text: trimText(String(kicker || '').toUpperCase(), 36),
    maxWidth: 500,
    maxHeight: 40,
  });

  // Title canvas is sized for ~2 lines of 64pt text (lineHeight 72) so it never
  // bleeds into the SOLD/BOUGHT badge below it.
  const titleImage = await createTintedTextImage({
    text: toLines(String(title || 'HARMIE').toUpperCase(), 14),
    width: 520,
    height: 160,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, 120);

  // SOLD! / BOUGHT! renders as a yellow stamp with black text — visually hard to miss.
  if (statusText) {
    const badgeText = trimText(String(statusText).toUpperCase(), 12);
    const badgeWidth = Math.min(520, Math.max(220, badgeText.length * 42 + 40));
    const badgeHeight = 80;
    const badgeY = 296;
    drawRect(card, 72, badgeY, badgeWidth, badgeHeight, COLORS.yellow);
    const labelImage = await createTintedTextImage({
      text: badgeText,
      width: badgeWidth - 32,
      height: badgeHeight - 8,
      font: largeBlack,
      color: COLORS.black,
      alignmentX: HorizontalAlign.CENTER,
    });
    card.composite(labelImage, 72 + 16, badgeY + 4);
  }

  if (subtitle) {
    const subtitleY = statusText ? 396 : 320;
    card.print({
      font: mediumWhite,
      x: 76,
      y: subtitleY,
      text: trimText(String(subtitle), 80),
      maxWidth: 500,
      maxHeight: 60,
    });
  }

  // Up to two parties (e.g. BUYER / SELLER) sit side-by-side beneath the badge.
  const slots = parties.slice(0, 2);
  const slotWidth = 240;
  const slotGap = 16;
  const partyY = statusText ? 460 : 432;
  for (const [index, party] of slots.entries()) {
    // Inline (rather than drawLabeledCopy) so we can use the larger 32pt label
    // without disturbing other cards that share that helper.
    const slotX = 76 + index * (slotWidth + slotGap);
    card.print({
      font: mediumWhite,
      x: slotX,
      y: partyY,
      text: trimText(String(party.label || '').toUpperCase(), 24),
      maxWidth: slotWidth,
      maxHeight: 36,
    });
    card.print({
      font: mediumWhite,
      x: slotX,
      y: partyY + 42,
      text: trimText(String(party.body || ''), 240),
      maxWidth: slotWidth,
      maxHeight: HERO_HEIGHT - (partyY + 42) - 8,
    });
  }

  await drawFooterLabel(card, footerLabel);

  if (metrics.length > 0) {
    const cols = Math.max(metrics.length, 1);
    const metricWidth = Math.floor((CARD_WIDTH - 160) / cols);
    for (const [index, metric] of metrics.entries()) {
      await addMetricColumn(
        card,
        metric,
        72 + index * metricWidth,
        HERO_HEIGHT + 88,
        metricWidth - 24,
      );
    }
  }

  return card.getBuffer(JimpMime.png);
}

export async function renderHarmieShowcaseCard({ asset, harmie, localStats }) {
  const dialogue = getHarmieDialogue({ harmie, asset });
  const parsedTokenNumber = Number.parseInt(
    String(harmie?.name || '').match(/\d+/)?.[0] || '',
    10,
  );
  const tokenNumber =
    asset?.token_number ??
    (Number.isFinite(parsedTokenNumber) ? parsedTokenNumber : '—');
  const title = harmie?.name || asset?.name || `Harmie #${asset?.token_number ?? '???'}`;
  const { smallWhite, mediumWhite, largeWhite } = await getFonts();
  const card = await getCardShell('feature');

  const accentImage = await loadImage(asset?.path || harmie?.image || null, IMAGE_WIDTH, HERO_HEIGHT - 80, 'HARMIE');
  accentImage.opacity(0.98);
  card.composite(accentImage, CARD_WIDTH - IMAGE_WIDTH - 36, 40);

  card.print({
    font: smallWhite,
    x: 76,
    y: 78,
    text: 'COLLECTION ROLL',
    maxWidth: 420,
    maxHeight: 22,
  });

  const titleImage = await createTintedTextImage({
    text: toLines(title.toUpperCase(), 12),
    width: 520,
    height: 160,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, 110);

  // Attributes only — no subtitle paragraph, no wins/losses copy block.
  await drawLabeledCopy(card, {
    label: dialogue.rightLabel,
    body: buildList(
      Object.entries(harmie?.attributes || {})
        .slice(0, 4)
        .map(([key, value]) => `${trimText(key, 12)}: ${trimText(String(value), 14)}`),
      '—',
      4,
    ),
    x: 76,
    y: 380,
    width: 480,
    bodyHeight: 220,
  });

  await drawFooterLabel(card, dialogue.footerLabel);

  const metrics = [
    formatMetric('Token', `#${tokenNumber}`),
    formatMetric('Site ELO', `${harmie?.eloScore ?? localStats?.eloScore ?? '—'}`),
    formatMetric('Matches', `${harmie?.totalMatches ?? localStats?.totalMatches ?? '—'}`),
  ];
  const metricWidth = Math.floor((CARD_WIDTH - 160) / metrics.length);
  for (const [index, metric] of metrics.entries()) {
    await addMetricColumn(card, metric, 72 + index * metricWidth, HERO_HEIGHT + 88, metricWidth - 26);
  }

  return card.getBuffer(JimpMime.png);
}

export async function renderWalletSummaryCard({ wallet, holdings = [] }) {
  const dialogue = getWalletDialogue();
  const primaryHolding = holdings.find((holding) => holding.image) || holdings[0] || null;
  const walletLines = wallet.wallets
    .slice(0, 4)
    .map((link, index) => `${index + 1}. ${shortAddress(link.wallet_address)} • ${compactNumber(link.harmie_count)}`)
    .join('\n');
  const infoLines = [
    `Primary ${shortAddress(wallet.primary_wallet_address)}`,
    `Checked ${wallet.last_checked_at ? new Date(wallet.last_checked_at).toLocaleDateString() : 'recently'}`,
    `${holdings.length} cached holding${holdings.length === 1 ? '' : 's'}`,
  ].join('\n');

  return renderFeatureCard({
    kicker: 'Wallet Snapshot',
    title: 'Linked Harmie Wallets',
    subtitle: '',
    imageSource: primaryHolding?.image || null,
    imageFallbackLabel: 'WALLET',
    metrics: [
      formatMetric('Wallets', `${wallet.wallets.length}`),
      formatMetric('Held', `${compactNumber(wallet.total_harmie_count)}`),
      formatMetric('Share', percent(wallet.total_collection_share * 100)),
    ],
    leftLabel: 'Linked Wallets',
    leftBody: walletLines || 'No linked wallets found.',
    rightLabel: '',
    rightBody: '',
    footerLabel: dialogue.footerLabel,
  });
}

export async function renderWalletLinkCard({ expiresAt, operation = 'link', imageSource = null }) {
  const dialogue = getWalletLinkDialogue(operation);
  const modeTitle = operation === 'reverify' ? 'Reverify Wallet' : 'Link Wallet';

  return renderFeatureCard({
    kicker: 'Secure Verification',
    title: modeTitle,
    subtitle: '',
    imageSource,
    imageFallbackLabel: 'VERIFY',
    metrics: [
      formatMetric('Action', operation === 'reverify' ? 'Refresh' : 'Link'),
      formatMetric('Wallets', 'Phantom + More'),
      formatMetric('Expires', new Date(expiresAt).toLocaleTimeString()),
    ],
    leftLabel: '',
    leftBody: '',
    rightLabel: '',
    rightBody: '',
    footerLabel: dialogue.footerLabel,
  });
}

export async function renderFlexCard({ wallet, holding }) {
  const holdings = Array.isArray(holding) ? holding : [holding].filter(Boolean);
  const featured = holdings.slice(0, 10);
  const dialogue = getFlexDialogue({
    shown: featured.length,
    total: wallet.total_harmie_count,
  });
  const { smallWhite, mediumWhite, largeWhite } = await getFonts();
  const card = await getCardShell('flex');

  // Kicker + title live at the top, with plenty of vertical room before the grid.
  const headerHeight = 120;
  card.print({
    font: smallWhite,
    x: 76,
    y: 40,
    text: trimText(dialogue.kicker, 36),
    maxWidth: 400,
    maxHeight: 22,
  });

  const titleText =
    featured.length > 1
      ? `${featured.length} FLEXED`
      : trimText((featured[0]?.name || 'HARMIE FLEX').toUpperCase(), 18);
  const titleImage = await createTintedTextImage({
    text: titleText,
    width: 600,
    height: 72,
    font: largeWhite,
    color: COLORS.yellow,
  });
  card.composite(titleImage, 72, 62);

  // Grid sits beneath the header and is sized to fit the hero area cleanly.
  const grid = resolveFlexGrid(featured.length);
  const gridTop = headerHeight + 24;
  const gridBottom = HERO_HEIGHT - 28;
  const gridHeight = gridBottom - gridTop;
  const gridWidth = CARD_WIDTH - 144;
  const gridX = Math.floor((CARD_WIDTH - gridWidth) / 2);
  const gridY = gridTop;
  const gap = 20;
  const cellWidth = Math.floor((gridWidth - gap * (grid.cols - 1)) / grid.cols);
  const cellHeight = Math.floor((gridHeight - gap * (grid.rows - 1)) / grid.rows);

  for (const [index, item] of featured.entries()) {
    const col = grid.order === 'column'
      ? Math.floor(index / grid.rows)
      : index % grid.cols;
    const row = grid.order === 'column'
      ? index % grid.rows
      : Math.floor(index / grid.cols);

    const x = gridX + col * (cellWidth + gap);
    const y = gridY + row * (cellHeight + gap);
    // For single-tile rows we still cap the frame so the hero never looks sparse.
    const maxFrameWidth = grid.cols === 1 ? Math.min(680, cellWidth) : cellWidth;
    const frameWidth = maxFrameWidth;
    const frameX = x + Math.floor((cellWidth - frameWidth) / 2);
    const tileFrame = new Jimp({ width: frameWidth, height: cellHeight, color: COLORS.blackSoft });
    const tile = await loadContainedImage(item?.image || null, frameWidth, cellHeight, 'FLEX');
    tileFrame.composite(tile, 0, 0);
    card.composite(tileFrame, frameX, y);
  }

  await drawFooterLabel(card, trimText(String(dialogue.summary || ''), 60));

  const metrics = [
    formatMetric('Wallets', `${wallet.wallets.length}`),
    formatMetric('Featured', `${featured.length}`),
    formatMetric('Held', `${compactNumber(wallet.total_harmie_count)}`),
    formatMetric('Share', percent(wallet.total_collection_share * 100)),
  ];
  const metricWidth = Math.floor((CARD_WIDTH - 160) / metrics.length);
  for (const [index, metric] of metrics.entries()) {
    await addMetricColumn(card, metric, 72 + index * metricWidth, HERO_HEIGHT + 88, metricWidth - 24);
  }

  return card.getBuffer(JimpMime.png);
}

function resolveFlexGrid(count) {
  if (count <= 1) return { cols: 1, rows: 1, order: 'row' };
  if (count === 2) return { cols: 2, rows: 1, order: 'row' };
  if (count <= 4) return { cols: 2, rows: 2, order: 'row' };
  if (count <= 6) return { cols: 3, rows: 2, order: 'row' };
  if (count <= 9) return { cols: 3, rows: 3, order: 'row' };
  return { cols: 5, rows: 2, order: 'row' };
}

export async function renderWalletAuditCard({ snapshot, imageSource = null }) {
  const dialogue = getWalletAuditDialogue(snapshot);
  const staleLines = snapshot.staleLinks.length
    ? snapshot.staleLinks
        .slice(0, 4)
        .map((link, index) => `${index + 1}. ${shortAddress(link.wallet_address)} • ${link.last_status_reason || 'Needs refresh'}`)
        .join('\n')
    : 'No stale wallet links right now.';

  return renderFeatureCard({
    kicker: 'Guild Audit',
    title: 'Wallet Health',
    subtitle: '',
    imageSource,
    imageFallbackLabel: 'AUDIT',
    metrics: [
      formatMetric('Linked', `${compactNumber(snapshot.linkedWallets)}`),
      formatMetric('Active', `${compactNumber(snapshot.activeWallets)}`),
      formatMetric('Stale', `${compactNumber(snapshot.staleWallets)}`),
    ],
    leftLabel: 'Stale Wallets',
    leftBody: staleLines,
    rightLabel: '',
    rightBody: '',
    footerLabel: dialogue.footerLabel,
  });
}

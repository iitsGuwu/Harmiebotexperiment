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
  SANS_16_WHITE,
  SANS_32_BLACK,
  SANS_32_WHITE,
  SANS_64_WHITE,
} from 'jimp/fonts';
import { config } from './config.js';

const CARD_WIDTH = 1400;
const CARD_HEIGHT = 860;
const OUTER_MARGIN = 40;
const TOP_MARGIN = 50;
const PANEL_WIDTH = 560;
const ART_HEIGHT = 620;
const FOOTER_HEIGHT = 130;
const CENTER_WIDTH = 160;
const PANEL_HEIGHT = ART_HEIGHT + FOOTER_HEIGHT;

const CLASSIC_PALETTE = {
  background: 0x0d1121ff,
  backgroundAlt: 0x171d39ff,
  footer: 0x20274cff,
  footerAlt: 0x2a3364ff,
  gold: 0xd4bf84ff,
  goldSoft: 0xd4bf8470,
  goldBright: 0xf3df98ff,
  darkBadge: 0x161b35ff,
  winner: 0xf0d37aff,
  loser: 0x5f688eff,
  pinkFallback: 0xe83392ff,
  topBar: 0x1c2244ff,
  centerDivider: 0x12162cff,
  raySecondary: 0xf2de9b99,
  // Top stripe of each name plate. Distinct from `gold` so the cloud variant can
  // give the plate its own accent without losing the warm-gold look here.
  nameAccent: 0xd4bf84ff,
  // Name-plate font is white on dark navy footer.
  namePlateFontIsBlack: false,
};

// Cloud variant: royal blue hero, cloud-white footer + accents.
const CLOUD_PALETTE = {
  background: 0x3d5cffff,
  backgroundAlt: 0x5773ffff,
  footer: 0xf2f4fbff,
  footerAlt: 0xe1e6f5ff,
  gold: 0xf2f4fbff,
  goldSoft: 0xf2f4fb70,
  goldBright: 0xffffffff,
  darkBadge: 0x3d5cffff,
  winner: 0xffffffff,
  loser: 0x8095e8ff,
  pinkFallback: 0xe83392ff,
  topBar: 0x2a3fcfff,
  centerDivider: 0x2a3fcfff,
  raySecondary: 0xffffff80,
  // Royal-blue stripe across the cloud-white name plate so the accent reads.
  nameAccent: 0x3d5cffff,
  // Name-plate font flips to black so it reads on the cloud-white footer.
  namePlateFontIsBlack: true,
};

const COLORS = config.cards.style === 'classic' ? CLASSIC_PALETTE : CLOUD_PALETTE;

let fontPromise;

// Jimp's bundled Open Sans BMFonts only cover ASCII + Latin-1, so any character
// above U+00FF (ellipsis, em-dash, bullet, curly quotes) renders as a literal '?'.
// Strip those before printing.
function sanitizeBitmapText(text) {
  return String(text ?? '')
    .replace(/[…]/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[•∙·]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"');
}

function trimLabel(text, max = 30) {
  const value = sanitizeBitmapText(String(text || 'Harmie').trim());
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

async function getFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      loadFont(SANS_16_WHITE),
      loadFont(SANS_32_WHITE),
      loadFont(SANS_32_BLACK),
      loadFont(SANS_64_WHITE),
    ]).then(([small, medium, mediumBlack, large]) => ({
      small,
      medium,
      mediumBlack,
      large,
      // Name-plate text uses the variant that contrasts with the footer color.
      namePlate: COLORS.namePlateFontIsBlack ? mediumBlack : medium,
    }));
  }

  return fontPromise;
}

function createBlock(width, height, color) {
  return new Jimp({ width, height, color });
}

function drawRect(target, x, y, width, height, color) {
  target.composite(createBlock(width, height, color), x, y);
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

function drawCircle(diameter, color) {
  const image = new Jimp({ width: diameter, height: diameter, color });
  return image.circle();
}

async function buildPlaceholder(width, height, label) {
  const { medium } = await getFonts();
  const image = new Jimp({ width, height, color: COLORS.pinkFallback });

  image.print({
    font: medium,
    x: 36,
    y: Math.floor(height / 2) - 24,
    text: {
      text: label,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: width - 72,
    maxHeight: 48,
  });

  return image;
}

async function loadContestantImage(source, width, height, fallbackLabel) {
  if (!source) {
    return buildPlaceholder(width, height, fallbackLabel);
  }

  try {
    const image = await Jimp.read(source);
    image.cover({ w: width, h: height });
    return image;
  } catch {
    return buildPlaceholder(width, height, fallbackLabel);
  }
}

function addRays(canvas, x, y, width, height) {
  const primaryAngles = [-72, -46, -24, 0, 24, 46, 72];

  for (const angle of primaryAngles) {
    const ray = createBlock(14, 220, COLORS.goldSoft);
    ray.rotate(angle);
    canvas.composite(
      ray,
      x + Math.floor((width - ray.bitmap.width) / 2),
      y + Math.floor((height - ray.bitmap.height) / 2),
    );
  }

  const secondaryAngles = [-58, -34, -12, 12, 34, 58];
  for (const angle of secondaryAngles) {
    const ray = createBlock(8, 150, COLORS.raySecondary);
    ray.rotate(angle);
    canvas.composite(
      ray,
      x + Math.floor((width - ray.bitmap.width) / 2),
      y + Math.floor((height - ray.bitmap.height) / 2),
    );
  }
}

async function addVsBadge(canvas, x, y, size) {
  const { medium } = await getFonts();
  const glow = drawCircle(size + 34, COLORS.goldSoft);
  const outer = drawCircle(size, COLORS.goldBright);
  const inner = drawCircle(size - 18, COLORS.darkBadge);

  inner.print({
    font: medium,
    x: 0,
    y: 24,
    text: {
      text: 'VS',
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: inner.bitmap.width,
    maxHeight: inner.bitmap.height - 28,
  });

  canvas.composite(glow, x - 17, y - 17);
  canvas.composite(outer, x, y);
  canvas.composite(inner, x + 9, y + 9);
}

async function addNamePlate(canvas, x, y, width, height, name, accentColor) {
  const { namePlate } = await getFonts();
  const label = trimLabel(String(name || 'Harmie').toUpperCase());
  const textWidth = measureText(namePlate, label);
  const centeredX = x + Math.max(26, Math.floor((width - textWidth) / 2));

  drawVerticalGradient(canvas, x, y, width, height, COLORS.footer, COLORS.footerAlt);
  drawRect(canvas, x, y, width, 6, accentColor);

  canvas.print({
    font: namePlate,
    x: centeredX,
    y: y + 40,
    text: label,
    maxWidth: width - 52,
    maxHeight: 40,
  });
}

function addPanelBorder(canvas, x, y, width, height, color, thickness = 8) {
  drawRect(canvas, x, y, width, thickness, color);
  drawRect(canvas, x, y + height - thickness, width, thickness, color);
  drawRect(canvas, x, y, thickness, height, color);
  drawRect(canvas, x + width - thickness, y, thickness, height, color);
}

export async function renderPageantCard({
  left,
  right,
  leftImageBuffer,
  rightImageBuffer,
  closed = false,
  winningSide = null,
}) {
  const canvas = new Jimp({
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    color: COLORS.background,
  });

  drawVerticalGradient(canvas, 0, 0, CARD_WIDTH, CARD_HEIGHT, COLORS.backgroundAlt, COLORS.background);
  drawRect(canvas, 0, 0, CARD_WIDTH, 18, COLORS.topBar);

  const leftX = OUTER_MARGIN;
  const rightX = CARD_WIDTH - OUTER_MARGIN - PANEL_WIDTH;
  const panelY = TOP_MARGIN;
  const footerY = panelY + ART_HEIGHT;
  const centerX = Math.floor((CARD_WIDTH - CENTER_WIDTH) / 2);

  const [leftArt, rightArt] = await Promise.all([
    loadContestantImage(leftImageBuffer, PANEL_WIDTH, ART_HEIGHT, 'LEFT IMAGE'),
    loadContestantImage(rightImageBuffer, PANEL_WIDTH, ART_HEIGHT, 'RIGHT IMAGE'),
  ]);

  canvas.composite(leftArt, leftX, panelY);
  canvas.composite(rightArt, rightX, panelY);

  await addNamePlate(canvas, leftX, footerY, PANEL_WIDTH, FOOTER_HEIGHT, left?.name || 'Left Harmie', COLORS.nameAccent);
  await addNamePlate(canvas, rightX, footerY, PANEL_WIDTH, FOOTER_HEIGHT, right?.name || 'Right Harmie', COLORS.nameAccent);

  drawRect(canvas, centerX, panelY, CENTER_WIDTH, PANEL_HEIGHT, COLORS.centerDivider);
  addRays(canvas, centerX, panelY + 120, CENTER_WIDTH, ART_HEIGHT - 140);
  await addVsBadge(canvas, centerX + 30, panelY + 285, 100);

  if (closed && winningSide === 'left') {
    addPanelBorder(canvas, leftX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.winner);
    addPanelBorder(canvas, rightX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.loser, 6);
  } else if (closed && winningSide === 'right') {
    addPanelBorder(canvas, rightX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.winner);
    addPanelBorder(canvas, leftX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.loser, 6);
  } else if (closed && winningSide === 'tie') {
    addPanelBorder(canvas, leftX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.gold, 6);
    addPanelBorder(canvas, rightX, panelY, PANEL_WIDTH, PANEL_HEIGHT, COLORS.gold, 6);
  }

  return canvas.getBuffer(JimpMime.png);
}

import fs from 'node:fs';
import path from 'node:path';

const ASSET_ROOT = path.resolve(process.cwd(), 'assets', 'Harmies');
const MANIFEST_PATH = path.join(ASSET_ROOT, 'manifest.json');

let manifestCache = null;
let fileCache = null;

function loadManifest() {
  if (manifestCache) {
    return manifestCache;
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    manifestCache = [];
    return manifestCache;
  }

  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    manifestCache = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    manifestCache = [];
  }

  return manifestCache;
}

function normalizeTokenNumber(value) {
  const match = String(value || '').match(/\d+/);
  if (!match) return null;
  return Number.parseInt(match[0], 10);
}

export function listHarmieAssets() {
  const manifestItems = loadManifest()
    .map((item) => ({
      ...item,
      token_number: normalizeTokenNumber(item.token_number ?? item.name),
      path: item.filename ? path.join(ASSET_ROOT, item.filename) : null,
    }))
    .filter((item) => item.token_number !== null && item.path && fs.existsSync(item.path));

  if (manifestItems.length > 0) {
    return manifestItems;
  }

  if (fileCache) {
    return fileCache;
  }

  if (!fs.existsSync(ASSET_ROOT)) {
    fileCache = [];
    return fileCache;
  }

  fileCache = fs
    .readdirSync(ASSET_ROOT)
    .filter((filename) => /\.(png|jpe?g|webp|gif)$/i.test(filename))
    .sort()
    .map((filename) => ({
      filename,
      name: `Harmies #${String(normalizeTokenNumber(filename) || '').padStart(3, '0')}`,
      token_number: normalizeTokenNumber(filename),
      path: path.join(ASSET_ROOT, filename),
    }))
    .filter((item) => item.token_number !== null);

  return fileCache;
}

export function getRandomHarmieAsset() {
  const items = listHarmieAssets();
  if (items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] || null;
}

export function findHarmieAsset(query) {
  const tokenNumber = normalizeTokenNumber(query);
  if (tokenNumber === null) {
    return null;
  }

  return listHarmieAssets().find((item) => item.token_number === tokenNumber) || null;
}

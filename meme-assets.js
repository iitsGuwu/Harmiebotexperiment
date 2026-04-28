import fs from 'node:fs';
import path from 'node:path';

const ASSET_ROOT = path.resolve(process.cwd(), 'assets', 'harmie-memes');
const MANIFEST_PATH = path.join(ASSET_ROOT, 'manifest.json');

let manifestCache = null;
let fileCache = null;
let shuffledQueue = [];
let shuffledIndex = 0;

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

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

export function getMemeAssetManifestPath() {
  return MANIFEST_PATH;
}

export function listMemeAssets() {
  const manifestItems = loadManifest().map((item) => ({
    ...item,
    path: path.join(ASSET_ROOT, item.filename),
  }));

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
      title: filename,
      path: path.join(ASSET_ROOT, filename),
    }));

  return fileCache;
}

export function getNextMemeAsset() {
  const items = listMemeAssets().filter((item) => fs.existsSync(item.path));
  if (items.length === 0) {
    return null;
  }

  if (shuffledQueue.length !== items.length || shuffledIndex >= shuffledQueue.length) {
    shuffledQueue = shuffle(items);
    shuffledIndex = 0;
  }

  const item = shuffledQueue[shuffledIndex] || shuffledQueue[0] || null;
  shuffledIndex += 1;
  return item;
}

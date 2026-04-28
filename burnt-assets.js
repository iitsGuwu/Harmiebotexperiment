import fs from 'node:fs';
import path from 'node:path';

const ASSET_ROOT = path.resolve(process.cwd(), 'assets', 'burnt');
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

export function listBurntAssets() {
  const manifestItems = loadManifest()
    .filter((item) => item?.filename && item?.token_id)
    .map((item) => ({
      ...item,
      path: path.join(ASSET_ROOT, item.filename),
    }))
    .filter((item) => fs.existsSync(item.path));

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
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
    .map((filename) => {
      const tokenId = Number.parseInt(path.parse(filename).name, 10);
      return {
        filename,
        token_id: Number.isFinite(tokenId) ? tokenId : null,
        name: Number.isFinite(tokenId) ? `Harmie #${tokenId}` : filename,
        path: path.join(ASSET_ROOT, filename),
      };
    });

  return fileCache;
}

export function getRandomBurntAsset() {
  const items = listBurntAssets();
  if (items.length === 0) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)] || null;
}

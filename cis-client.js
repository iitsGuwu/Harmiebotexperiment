import path from 'node:path';

import { config } from './config.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_IMAGE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
]);

function cisUrl(pathname) {
  const baseUrl = config.cis.baseUrl.endsWith('/')
    ? config.cis.baseUrl
    : `${config.cis.baseUrl}/`;
  const normalizedPath = String(pathname || '').replace(/^\/+/, '');
  return new URL(normalizedPath, baseUrl);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function connectivityCodeFor(error) {
  return error?.cause?.code || error?.code || '';
}

function normalizeCisError(error) {
  const code = connectivityCodeFor(error);
  if (isAbortError(error) || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new Error(`Harmie CIS timed out while contacting ${config.cis.baseUrl}.`);
  }

  if (CONNECTIVITY_ERROR_CODES.has(code)) {
    return new Error(
      `Harmie CIS is not reachable at ${config.cis.baseUrl}. Set HARMIE_CIS_BASE_URL to the running CIS app URL.`,
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error || 'Unknown Harmie CIS error.'));
}

function startTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => '');
  return text ? { detail: text } : {};
}

function extensionForContentType(contentType) {
  switch (String(contentType || '').toLowerCase().split(';')[0].trim()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/png':
    default:
      return '.png';
  }
}

function buildImageFilename(imageUrl, contentType, generationId) {
  const parsedUrl = new URL(imageUrl);
  const rawName = path.basename(parsedUrl.pathname || '');
  const extension = path.extname(rawName) || extensionForContentType(contentType);
  const baseName = rawName && path.extname(rawName) ? rawName : `harmie-cis-${generationId}${extension}`;
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function cisFetch(pathname, init = {}, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const url = cisUrl(pathname);
  const { controller, timeoutId } = startTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      throw new Error(payload?.detail || `Harmie CIS request failed with ${response.status}.`);
    }

    return payload;
  } catch (error) {
    throw normalizeCisError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractGenerationId(payload) {
  return payload?.generation_id || payload?.generationId || payload?.id || null;
}

export async function createPromptGeneration(prompt) {
  return cisFetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function createRandomGeneration() {
  return cisFetch('/api/random', {
    method: 'POST',
  });
}

export async function getCisStatus() {
  const startedAt = Date.now();
  const { controller, timeoutId } = startTimeout(DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(cisUrl('/'), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');

    return {
      ok: response.ok,
      status: response.status,
      baseUrl: config.cis.baseUrl,
      configured: config.cis.configured,
      elapsedMs: Date.now() - startedAt,
      body: body.trim().slice(0, 120),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      baseUrl: config.cis.baseUrl,
      configured: config.cis.configured,
      elapsedMs: Date.now() - startedAt,
      error: normalizeCisError(error).message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchGeneratedImage(downloadUrl, generationId, timeoutMs = DEFAULT_IMAGE_TIMEOUT_MS) {
  const resolvedUrl = new URL(downloadUrl, config.cis.baseUrl);
  const { controller, timeoutId } = startTimeout(timeoutMs);

  try {
    const response = await fetch(resolvedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Generated Harmie image download failed with ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
      filename: buildImageFilename(resolvedUrl, contentType, generationId),
      url: resolvedUrl.toString(),
    };
  } catch (error) {
    throw normalizeCisError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function waitForGeneratedImage(
  generationId,
  { timeoutMs = 5 * 60 * 1000, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {},
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await cisFetch(`/api/status/${generationId}`);

    if (status?.status === 'completed') {
      const download = await cisFetch(`/api/download/${generationId}`);
      const downloadUrl = download?.download_url || download?.downloadUrl || download?.url;
      if (!downloadUrl) {
        throw new Error('Generation completed, but no download URL was returned.');
      }
      return fetchGeneratedImage(downloadUrl, generationId);
    }

    if (status?.status === 'failed') {
      throw new Error(status?.error_message || status?.detail || 'Generation failed.');
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Timed out waiting for Harmie CIS generation to finish.');
}

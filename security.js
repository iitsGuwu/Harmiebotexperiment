import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

import { config } from './config.js';

let warnedPlaintextTokenStorage = false;

function base64UrlToBuffer(value) {
  return Buffer.from(value, 'base64url');
}

function bufferToBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function getSigningKey() {
  return base64UrlToBuffer(config.security.signingKey);
}

function getEncryptionKey() {
  if (!config.security.tokenEncryptionKey) {
    return null;
  }

  return base64UrlToBuffer(config.security.tokenEncryptionKey);
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

export function createWalletNonce(length = 20) {
  return randomToken(length).replace(/[^a-zA-Z0-9]/g, '').slice(0, Math.max(length, 12));
}

export function hashValue(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export function hashIpAddress(value) {
  if (!value) {
    return null;
  }

  return createHmac('sha256', getSigningKey()).update(String(value)).digest('hex');
}

export function createSignedRequestId(parts) {
  const payload = Buffer.from(JSON.stringify(parts)).toString('base64url');
  const signature = createHmac('sha256', getSigningKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySignedRequestId(requestId) {
  const [payload, signature] = String(requestId || '').split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = createHmac('sha256', getSigningKey()).update(payload).digest('base64url');
  if (signature !== expected) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function encryptSecret(value) {
  if (!value) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    if (!warnedPlaintextTokenStorage) {
      warnedPlaintextTokenStorage = true;
      console.warn(
        'TOKEN_ENCRYPTION_KEY is not set; site auth tokens will be stored in plaintext for this process.',
      );
    }
    return value;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:${bufferToBase64Url(iv)}.${bufferToBase64Url(tag)}.${bufferToBase64Url(encrypted)}`;
}

export function decryptSecret(value) {
  if (!value) {
    return value;
  }

  if (!String(value).startsWith('enc:')) {
    return value;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('Encrypted token storage is enabled but TOKEN_ENCRYPTION_KEY is not configured.');
  }

  const payload = String(value).slice(4);
  const [ivPart, tagPart, encryptedPart] = payload.split('.');

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Encrypted token payload is malformed.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    base64UrlToBuffer(ivPart),
  );
  decipher.setAuthTag(base64UrlToBuffer(tagPart));

  return Buffer.concat([
    decipher.update(base64UrlToBuffer(encryptedPart)),
    decipher.final(),
  ]).toString('utf8');
}

export function cookieOptions() {
  const secure = config.web.publicBaseUrl.startsWith('https://');
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure,
  };
}

export function isAllowedOrigin(originValue) {
  if (!originValue) {
    return false;
  }

  try {
    return new URL(originValue).origin === config.web.origin;
  } catch {
    return false;
  }
}

export function requireProductionHttps() {
  if (config.web.isLocalhost) {
    return;
  }

  if (!config.web.publicBaseUrl.startsWith('https://')) {
    throw new Error(
      `PUBLIC_BASE_URL must use HTTPS outside local development. Current value: ${config.web.publicBaseUrl}`,
    );
  }
}

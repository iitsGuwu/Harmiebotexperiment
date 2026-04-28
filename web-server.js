import path from 'node:path';

import bs58 from 'bs58';
import express from 'express';
import { createSignInMessage, verifyMessageSignature, verifySignIn } from '@solana/wallet-standard-util';

import { config } from './config.js';
import {
  getCollectionMarketSnapshot,
  getWalletHarmieCount,
  getWalletHarmieHoldings,
} from './collection-stats.js';
import {
  cookieOptions,
  hashIpAddress,
  isAllowedOrigin,
  requireProductionHttps,
  verifySignedRequestId,
} from './security.js';
import {
  countRecentWalletAuditEvents,
  countUserWalletLinks,
  createWalletChallenge,
  getWalletChallenge,
  incrementWalletChallengeAttempt,
  logWalletAuditEvent,
  markWalletChallengeUsed,
  replaceWalletHoldings,
  revokeWalletChallenge,
  saveVerifiedWalletLink,
} from './wallet-store.js';
import { botEvents } from './bot-events.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function cisProxyUrl(pathname, search = '') {
  const baseUrl = config.cis.proxyTarget.endsWith('/')
    ? config.cis.proxyTarget
    : `${config.cis.proxyTarget}/`;
  const normalizedPath = String(pathname || '').replace(/^\/+/, '');
  const target = new URL(normalizedPath, baseUrl);
  if (search) {
    target.search = search.startsWith('?') ? search : `?${search}`;
  }
  return target;
}

async function proxyToCis(req, res, pathname) {
  const headers = new Headers();
  const publicUrl = new URL(config.web.publicBaseUrl);

  for (const [key, value] of Object.entries(req.headers)) {
    if (
      value === undefined ||
      key === 'host' ||
      key === 'content-length' ||
      key === 'x-forwarded-host' ||
      key === 'x-forwarded-proto' ||
      key === 'x-forwarded-port'
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else {
      headers.set(key, value);
    }
  }

  headers.set('x-forwarded-host', publicUrl.host);
  headers.set('x-forwarded-proto', publicUrl.protocol.replace(':', ''));
  headers.set('x-forwarded-port', publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80'));
  headers.set('host', publicUrl.host);

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      body = JSON.stringify(req.body);
      headers.set('content-type', 'application/json');
    } else if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      body = req.body;
    }
  }

  const upstream = await fetch(cisProxyUrl(pathname, req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), {
    method: req.method,
    headers,
    body,
    redirect: 'follow',
  });

  res.status(upstream.status);

  for (const [key, value] of upstream.headers.entries()) {
    if (key === 'content-length' || key === 'transfer-encoding' || key === 'connection') {
      continue;
    }
    res.setHeader(key, value);
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.send(buffer);
}

function verificationContentSecurityPolicy() {
  // Wallet browser extensions inject providers into the page; blocking inline
  // scripts or restricting script-src breaks Wallet Standard registration for
  // some wallets. Keep connect-src strict but allow the page to interop freely.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf('=');
        if (index === -1) return [entry, ''];
        return [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
      }),
  );
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  const merged = { ...cookieOptions(), ...options };

  if (merged.httpOnly) parts.push('HttpOnly');
  if (merged.secure) parts.push('Secure');
  if (merged.sameSite) parts.push(`SameSite=${merged.sameSite}`);
  if (merged.path) parts.push(`Path=${merged.path}`);
  if (merged.maxAge !== undefined) parts.push(`Max-Age=${merged.maxAge}`);

  res.append('Set-Cookie', parts.join('; '));
}

function validateWalletAddress(walletAddress) {
  try {
    return bs58.decode(walletAddress).length === 32;
  } catch {
    return false;
  }
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function base58ToBytes(value) {
  return bs58.decode(value);
}

function getRequestIpHash(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  return hashIpAddress(raw);
}

function isChallengeExpired(challenge) {
  return Date.parse(challenge.expires_at) <= Date.now();
}

function ensureChallengeReady(challenge) {
  if (!challenge) {
    throw Object.assign(new Error('Verification session not found.'), { status: 404 });
  }

  if (challenge.status !== 'pending') {
    throw Object.assign(new Error('Verification session has already been used.'), { status: 410 });
  }

  if (isChallengeExpired(challenge)) {
    revokeWalletChallenge(challenge.token, 'expired');
    throw Object.assign(new Error('Verification session has expired.'), { status: 410 });
  }
}

function serializeAccountOutput(accountOutput) {
  const accountAddress = accountOutput?.address;

  if (!accountAddress || !validateWalletAddress(accountAddress)) {
    throw Object.assign(new Error('Invalid Solana wallet address.'), { status: 400 });
  }

  let publicKey;
  if (accountOutput?.publicKeyBase64) {
    publicKey = base64ToBytes(accountOutput.publicKeyBase64);
  } else if (accountOutput?.publicKeyBase58) {
    publicKey = base58ToBytes(accountOutput.publicKeyBase58);
  }

  if (!publicKey || publicKey.length !== 32) {
    throw Object.assign(new Error('Wallet public key is missing or invalid.'), { status: 400 });
  }

  if (bs58.encode(publicKey) !== accountAddress) {
    throw Object.assign(new Error('Wallet public key does not match the provided address.'), {
      status: 400,
    });
  }

  return {
    address: accountAddress,
    publicKey,
    label: accountOutput?.label || null,
  };
}

function serializeSignedOutput(payload, label = 'response') {
  const output = payload?.output;
  if (!output) {
    throw Object.assign(new Error(`Wallet ${label} is required.`), { status: 400 });
  }

  const account = serializeAccountOutput(output?.account);
  const signedMessageBase64 = output?.signedMessageBase64;
  const signatureBase64 = output?.signatureBase64;

  if (!signedMessageBase64 || !signatureBase64) {
    throw Object.assign(new Error(`Incomplete wallet ${label}.`), { status: 400 });
  }

  return {
    account,
    signedMessage: base64ToBytes(signedMessageBase64),
    signature: base64ToBytes(signatureBase64),
    signatureType: output?.signatureType || 'ed25519',
  };
}

function parseVerificationPayload(payload, fallbackMethod = null) {
  const method = payload?.method || payload?.verifyMethod || fallbackMethod;

  if (method === 'siws') {
    return {
      method,
      output: serializeSignedOutput(payload, 'SIWS response'),
    };
  }

  if (method === 'signMessage') {
    return {
      method,
      output: serializeSignedOutput(payload, 'signed message'),
    };
  }

  throw Object.assign(new Error('Unsupported wallet verification method.'), { status: 400 });
}

function ensureSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    return;
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      if (new URL(referer).origin === config.web.origin) {
        return;
      }
    } catch {
      // fall through
    }
  }

  throw Object.assign(new Error('Cross-origin verification request rejected.'), { status: 403 });
}

function ensureRateLimit({ discordUserId = null, ipHash = null, eventType }) {
  const windowMs = config.wallet.linkRateLimitWindowMs;

  if (ipHash) {
    const ipCount = countRecentWalletAuditEvents({
      eventType,
      requestIpHash: ipHash,
      sinceMs: windowMs,
    });
    if (ipCount >= config.wallet.maxLinkRequestsPerIpWindow) {
      throw Object.assign(new Error('Too many verification attempts from this network.'), { status: 429 });
    }
  }

  if (discordUserId) {
    const userCount = countRecentWalletAuditEvents({
      eventType,
      discordUserId,
      sinceMs: windowMs,
    });
    if (userCount >= config.wallet.maxLinkRequestsPerUserWindow) {
      throw Object.assign(new Error('Too many recent wallet link attempts for this Discord user.'), {
        status: 429,
      });
    }
  }
}

function buildPhantomBrowseUrl(token) {
  const verifyUrl = `${config.web.publicBaseUrl}/verify?token=${encodeURIComponent(token)}`;
  const encodedUrl = encodeURIComponent(verifyUrl);
  const encodedRef = encodeURIComponent(config.web.origin);
  return `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedRef}`;
}

function buildSolflareBrowseUrl(token) {
  const verifyUrl = `${config.web.publicBaseUrl}/verify?token=${encodeURIComponent(token)}`;
  const encodedUrl = encodeURIComponent(verifyUrl);
  const encodedRef = encodeURIComponent(config.web.origin);
  return `https://solflare.com/ul/v1/browse/${encodedUrl}?ref=${encodedRef}`;
}

export function createVerificationLink({
  discordUserId,
  guildId = null,
  channelId = null,
  operation = 'link',
  targetWalletAddress = null,
}) {
  ensureRateLimit({
    discordUserId,
    eventType: 'challenge_created',
  });

  if (operation === 'link' && countUserWalletLinks(discordUserId) >= config.wallet.maxWalletsPerUser) {
    throw Object.assign(
      new Error(`You can link up to ${config.wallet.maxWalletsPerUser} wallets right now.`),
      { kind: 'policy' },
    );
  }

  const challenge = createWalletChallenge({
    discordUserId,
    guildId,
    channelId,
    operation,
    targetWalletAddress,
  });

  logWalletAuditEvent({
    eventType: 'challenge_created',
    status: 'success',
    discordUserId,
    challengeToken: challenge.token,
    details: {
      operation,
      guildId,
      targetWalletAddress,
    },
  });

  const url = new URL('/verify', config.web.publicBaseUrl);
  url.searchParams.set('token', challenge.token);

  return {
    ...challenge,
    url: url.toString(),
  };
}

export function startWebServer() {
  requireProductionHttps();

  const app = express();
  const publicDir = path.resolve(process.cwd(), 'public');
  const vendorDir = path.resolve(process.cwd(), 'node_modules');

  if (config.web.trustedProxy) {
    app.set('trust proxy', config.web.trustedProxy);
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'strict-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    if (
      req.path === '/verify' ||
      req.path.endsWith('.css') ||
      req.path.endsWith('.js') ||
      req.path.startsWith('/vendor/')
    ) {
      res.setHeader('Content-Security-Policy', verificationContentSecurityPolicy());
    }

    next();
  });

  app.use('/harmie-references', async (req, res, next) => {
    try {
      await proxyToCis(req, res, `/harmie-references${req.path}`);
    } catch (error) {
      next(error);
    }
  });

  app.use('/harmie-cis', async (req, res, next) => {
    try {
      const proxiedPath = req.path === '/' ? '/' : req.path;
      await proxyToCis(req, res, proxiedPath);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(publicDir, { index: false, etag: false, maxAge: 0 }));
  app.use('/vendor', express.static(vendorDir, { index: false, etag: false, maxAge: '1h' }));

  app.get('/', (_req, res) => {
    noStore(res);
    res.type('text/plain').send('Harmie Bot verification server is running.');
  });

  app.get('/verify', (_req, res) => {
    noStore(res);
    res.sendFile(path.join(publicDir, 'verify.html'));
  });

  app.get('/api/verify-session/:token', (req, res) => {
    noStore(res);

    const ipHash = getRequestIpHash(req);
    ensureRateLimit({
      ipHash,
      eventType: 'challenge_loaded',
    });

    const challenge = getWalletChallenge(req.params.token);
    ensureChallengeReady(challenge);

    setCookie(res, config.security.csrfCookieName, challenge.csrf_token, {
      maxAge: config.wallet.nonceTtlSeconds,
    });

    logWalletAuditEvent({
      eventType: 'challenge_loaded',
      status: 'success',
      discordUserId: challenge.discord_user_id,
      challengeToken: challenge.token,
      requestIpHash: ipHash,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({
      operation: challenge.operation,
      targetWalletAddress: challenge.target_wallet_address,
      signInInput: challenge.sign_in_input,
      previewMessage: challenge.message,
      expiresAt: challenge.expires_at,
      maxWalletsPerUser: config.wallet.maxWalletsPerUser,
      phantomBrowseUrl: buildPhantomBrowseUrl(challenge.token),
      solflareBrowseUrl: buildSolflareBrowseUrl(challenge.token),
    });
  });

  app.post('/api/verify-session/:token/complete/:verifyMethod?', async (req, res, next) => {
    try {
    noStore(res);

    const ipHash = getRequestIpHash(req);
    const userAgent = req.headers['user-agent'] || null;
    ensureSameOrigin(req);

    const challenge = getWalletChallenge(req.params.token);
    ensureChallengeReady(challenge);

    ensureRateLimit({
      discordUserId: challenge.discord_user_id,
      ipHash,
      eventType: 'verify_attempt',
    });

    const cookies = parseCookies(req);
    if (!challenge.csrf_token || cookies[config.security.csrfCookieName] !== challenge.csrf_token) {
      incrementWalletChallengeAttempt(challenge.token, 'csrf_mismatch');
      logWalletAuditEvent({
        eventType: 'verify_attempt',
        status: 'rejected',
        discordUserId: challenge.discord_user_id,
        challengeToken: challenge.token,
        requestIpHash: ipHash,
        userAgent,
        details: { reason: 'csrf_mismatch' },
      });
      return res.status(403).json({ error: 'Verification session is no longer valid.' });
    }

    if ((challenge.attempts || 0) >= config.wallet.maxVerifyAttemptsPerChallenge) {
      revokeWalletChallenge(challenge.token, 'max_attempts');
      return res.status(429).json({ error: 'Verification session has been locked. Request a new link.' });
    }

    let parsedVerification;
    try {
      console.log('[verify] incoming payload:', {
        pathMethod: req.params?.verifyMethod,
        bodyMethod: req.body?.method,
        verifyMethod: req.body?.verifyMethod,
        queryMethod: req.query?.verifyMethod,
        hasOutput: Boolean(req.body?.output),
        outputKeys: req.body?.output ? Object.keys(req.body.output) : null,
        accountKeys: req.body?.output?.account ? Object.keys(req.body.output.account) : null,
        userAgent: req.headers['user-agent'],
      });
      const methodFromPath = req.params?.verifyMethod || null;
      const methodFromQuery = req.query?.verifyMethod || null;
      parsedVerification = parseVerificationPayload(
        req.body,
        methodFromPath || methodFromQuery,
      );
    } catch (error) {
      console.warn('[verify] parse failed:', error.message, req.body);
      incrementWalletChallengeAttempt(challenge.token, 'bad_payload');
      logWalletAuditEvent({
        eventType: 'verify_attempt',
        status: 'rejected',
        discordUserId: challenge.discord_user_id,
        challengeToken: challenge.token,
        requestIpHash: ipHash,
        userAgent,
        details: { reason: 'bad_payload' },
      });
      return res.status(error.status || 400).json({ error: error.message });
    }

    const requestIdPayload = verifySignedRequestId(challenge.request_id);
    if (
      !requestIdPayload ||
      requestIdPayload.token !== challenge.token ||
      requestIdPayload.discordUserId !== challenge.discord_user_id ||
      requestIdPayload.nonce !== challenge.nonce
    ) {
      incrementWalletChallengeAttempt(challenge.token, 'request_id_invalid');
      return res.status(400).json({ error: 'Verification request is invalid.' });
    }

    const walletAddress = parsedVerification.output.account.address;
    const verificationPassed =
      parsedVerification.method === 'siws'
        ? verifySignIn(challenge.sign_in_input, parsedVerification.output)
        : verifyMessageSignature({
            message: createSignInMessage({
              ...challenge.sign_in_input,
              address: walletAddress,
            }),
            signedMessage: parsedVerification.output.signedMessage,
            signature: parsedVerification.output.signature,
            publicKey: parsedVerification.output.account.publicKey,
          });

    if (!verificationPassed) {
      incrementWalletChallengeAttempt(
        challenge.token,
        parsedVerification.method === 'siws' ? 'siws_failed' : 'sign_message_failed',
      );
      logWalletAuditEvent({
        eventType: 'verify_attempt',
        status: 'rejected',
        discordUserId: challenge.discord_user_id,
        challengeToken: challenge.token,
        walletAddress,
        requestIpHash: ipHash,
        userAgent,
        details: {
          reason: parsedVerification.method === 'siws' ? 'siws_failed' : 'sign_message_failed',
          method: parsedVerification.method,
        },
      });
      return res.status(400).json({ error: 'Wallet verification failed.' });
    }

    if (challenge.target_wallet_address && challenge.target_wallet_address !== walletAddress) {
      incrementWalletChallengeAttempt(challenge.token, 'wallet_mismatch');
      return res.status(400).json({ error: 'This verification link is bound to a different wallet.' });
    }

    try {
      const [holdings, market, walletHoldings] = await Promise.all([
        getWalletHarmieCount(walletAddress),
        getCollectionMarketSnapshot(),
        getWalletHarmieHoldings(walletAddress),
      ]);

      const linkedWallet = saveVerifiedWalletLink({
        discordUserId: challenge.discord_user_id,
        guildId: challenge.guild_id,
        activityChannelId: challenge.channel_id,
        walletAddress,
        walletLabel: parsedVerification.output.account.label,
        harmieCount: holdings.count,
        totalSupply: market.totalSupply,
      });
      replaceWalletHoldings(linkedWallet.id, walletHoldings);

      markWalletChallengeUsed(challenge.token, walletAddress);
      logWalletAuditEvent({
        eventType: 'verify_attempt',
        status: 'success',
        discordUserId: challenge.discord_user_id,
        walletAddress,
        challengeToken: challenge.token,
        requestIpHash: ipHash,
        userAgent,
        details: {
          operation: challenge.operation,
          method: parsedVerification.method,
          harmieCount: linkedWallet.harmie_count,
        },
      });

      if (challenge.guild_id) {
        botEvents.emit('wallet-linked', {
          guildId: challenge.guild_id,
          discordUserId: challenge.discord_user_id,
          channelId: challenge.channel_id || null,
          walletAddress: linkedWallet.wallet_address,
        });
      }

      return res.json({
        walletAddress: linkedWallet.wallet_address,
        walletLabel: linkedWallet.wallet_label,
        harmieCount: linkedWallet.harmie_count,
        totalSupply: market.totalSupply,
        shareOfCollection: linkedWallet.collection_share,
        operation: challenge.operation,
      });
    } catch (error) {
      incrementWalletChallengeAttempt(challenge.token, error.message);
      logWalletAuditEvent({
        eventType: 'verify_attempt',
        status: 'error',
        discordUserId: challenge.discord_user_id,
        walletAddress,
        challengeToken: challenge.token,
        requestIpHash: ipHash,
        userAgent,
        details: {
          reason: error.message,
        },
      });

      if (error.kind === 'policy') {
        return res.status(409).json({ error: error.message });
      }

      return res.status(500).json({
        error: 'Verification failed while checking Harmie holdings.',
      });
    }
    } catch (error) {
      return next(error);
    }
  });

  app.use((_req, res) => {
    noStore(res);
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((error, _req, res, _next) => {
    console.error('Verification server error:', error);
    noStore(res);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error.',
    });
  });

  app.listen(config.web.port, () => {
    console.log(`Verification server listening on ${config.web.publicBaseUrl}`);
  });
}

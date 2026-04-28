import { getWallets } from '@wallet-standard/app';
import {
  SOLANA_MAINNET_CHAIN,
  SOLANA_CHAINS,
  isSolanaChain,
} from '@solana/wallet-standard-chains';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

const STANDARD_CONNECT = 'standard:connect';
const STANDARD_EVENTS = 'standard:events';
const SOLANA_SIGN_IN = 'solana:signIn';
const SOLANA_SIGN_MESSAGE = 'solana:signMessage';

const state = {
  session: null,
  selectedKey: null,
  entries: [],
  walletsApi: null,
  walletsUnsub: null,
  adapterFallbacks: [],
  debug: [],
};

function pushDebug(label, data) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${label}${
    data !== undefined ? ': ' + safeStringify(data) : ''
  }`;
  state.debug.unshift(entry);
  state.debug = state.debug.slice(0, 20);
  const element = document.getElementById('debug');
  if (element) element.textContent = state.debug.join('\n');
}

function safeStringify(data) {
  try {
    return JSON.stringify(
      data,
      (_key, value) => {
        if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
        if (value && typeof value === 'object' && value.constructor?.name === 'Object') return value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return Object.keys(value);
        }
        return value;
      },
      2,
    );
  } catch (error) {
    return `<unserializable: ${error?.message || 'err'}>`;
  }
}

const KNOWN_INSTALL_LINKS = {
  phantom: { name: 'Phantom', url: 'https://phantom.app/download' },
  solflare: { name: 'Solflare', url: 'https://solflare.com/download' },
  backpack: { name: 'Backpack', url: 'https://backpack.app/downloads' },
  glow: { name: 'Glow', url: 'https://glow.app/download' },
  metamask: { name: 'MetaMask', url: 'https://metamask.io/download/' },
  coinbase: { name: 'Coinbase Wallet', url: 'https://www.coinbase.com/wallet/downloads' },
  trust: { name: 'Trust Wallet', url: 'https://trustwallet.com/download' },
  exodus: { name: 'Exodus', url: 'https://www.exodus.com/download/' },
};

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function setButtonState(disabled, label) {
  const button = document.getElementById('verify-button');
  if (!button) return;
  button.disabled = disabled;
  if (label) button.textContent = label;
}

function bytesToBase64(bytes) {
  return window.btoa(String.fromCharCode(...Array.from(bytes)));
}

function supportsSolana(wallet) {
  const features = wallet.features || {};
  if (!features[STANDARD_CONNECT]) return false;
  if (!features[SOLANA_SIGN_IN] && !features[SOLANA_SIGN_MESSAGE]) return false;
  const chains = Array.isArray(wallet.chains) ? wallet.chains : [];
  if (chains.length && !chains.some(isSolanaChain)) return false;
  return true;
}

function walletSupportsSignIn(wallet) {
  return Boolean(wallet.features?.[SOLANA_SIGN_IN]);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function isDiscordBrowser() {
  const ua = navigator.userAgent || '';
  return /Discord/i.test(ua);
}

function detectKnownId(name) {
  const lowered = (name || '').toLowerCase();
  for (const key of Object.keys(KNOWN_INSTALL_LINKS)) {
    if (lowered.includes(key)) return key;
  }
  return null;
}

function buildStandardEntry(wallet) {
  return {
    key: `standard:${wallet.name}`,
    kind: 'standard',
    name: wallet.name,
    icon: wallet.icon || null,
    detail: walletSupportsSignIn(wallet)
      ? 'Ready. Approves with Sign In With Solana.'
      : 'Ready. Approves with a signed message.',
    badge: 'Detected',
    badgeTone: 'recommended',
    selectable: true,
    wallet,
  };
}

function mobileDeepLinkFor(fallbackId) {
  if (fallbackId === 'phantom') return state.session?.phantomBrowseUrl || null;
  if (fallbackId === 'solflare') return state.session?.solflareBrowseUrl || null;
  return null;
}

function buildAdapterFallbackEntry(fallback) {
  const readyState = fallback.adapter.readyState;
  const installed = readyState === WalletReadyState.Installed;
  const loadable = readyState === WalletReadyState.Loadable;
  const mobileUrl = mobileDeepLinkFor(fallback.id);
  const mobile = isMobile();

  if (installed) return null;

  const selectable = loadable || (mobile && Boolean(mobileUrl));

  return {
    key: `adapter:${fallback.id}`,
    kind: 'adapter',
    name: fallback.name,
    icon: fallback.adapter.icon || null,
    detail: mobile && mobileUrl
      ? `Tap to open in the ${fallback.name} app.`
      : loadable
        ? 'Tap to open in the wallet app.'
        : 'Not detected on this device.',
    badge: mobile || loadable ? 'Open app' : 'Install',
    badgeTone: 'fallback',
    selectable,
    adapter: fallback.adapter,
    fallbackId: fallback.id,
    installUrl: KNOWN_INSTALL_LINKS[fallback.id]?.url || null,
    mobileUrl,
  };
}

function buildInstallEntriesForMissing(detectedNames) {
  const detectedKnownIds = new Set();
  for (const name of detectedNames) {
    const id = detectKnownId(name);
    if (id) detectedKnownIds.add(id);
  }

  const covered = new Set(['phantom', 'solflare']);
  const entries = [];
  for (const [id, meta] of Object.entries(KNOWN_INSTALL_LINKS)) {
    if (detectedKnownIds.has(id) || covered.has(id)) continue;
    entries.push({
      key: `install:${id}`,
      kind: 'install',
      name: meta.name,
      icon: null,
      detail: 'Install or open to connect.',
      badge: 'Install',
      badgeTone: 'fallback',
      selectable: false,
      installUrl: meta.url,
    });
  }
  return entries;
}

function rebuildEntries() {
  const standardWallets = (state.walletsApi?.get() || []).filter(supportsSolana);

  const standardEntries = standardWallets.map(buildStandardEntry);
  const adapterEntries = state.adapterFallbacks
    .map(buildAdapterFallbackEntry)
    .filter(Boolean)
    .filter((entry) => {
      const matches = standardWallets.some(
        (wallet) => wallet.name.toLowerCase() === entry.name.toLowerCase(),
      );
      return !matches;
    });

  const detectedNames = standardWallets.map((wallet) => wallet.name);
  const installEntries = buildInstallEntriesForMissing(detectedNames);

  const sortKey = (entry) => {
    if (entry.selectable && entry.kind === 'standard') return 0;
    if (entry.selectable) return 1;
    return 2;
  };

  state.entries = [...standardEntries, ...adapterEntries, ...installEntries].sort(
    (a, b) => sortKey(a) - sortKey(b),
  );

  const currentValid = state.entries.some(
    (entry) => entry.key === state.selectedKey && entry.selectable,
  );
  if (!currentValid) {
    const firstSelectable = state.entries.find((entry) => entry.selectable);
    state.selectedKey = firstSelectable?.key || null;
  }

  renderWallets();
}

function renderWallets() {
  const container = document.getElementById('wallets');
  if (!container) return;

  const hint = document.getElementById('mobile-hint');
  if (hint) {
    hint.hidden = !isMobile();
    if (isDiscordBrowser()) {
      hint.textContent =
        "Discord's in-app browser can't launch wallet apps. Tap the ••• menu and choose ‘Open in browser’ first.";
    } else {
      hint.textContent = 'On mobile? Tap a wallet below to open this page inside its app.';
    }
  }

  container.innerHTML = '';

  if (state.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'wallet-empty';
    empty.textContent =
      'No Solana wallets detected. Install one of the wallets above, then reload this page.';
    container.appendChild(empty);
    setButtonState(true, 'Select a wallet to continue');
    return;
  }

  for (const entry of state.entries) {
    container.appendChild(createWalletCard(entry));
  }

  const selected = state.entries.find((entry) => entry.key === state.selectedKey);
  setButtonState(
    Boolean(!selected || !selected.selectable),
    selected ? `Verify with ${selected.name}` : 'Select a wallet to continue',
  );
}

function createWalletCard(entry) {
  const isMobileDeepLink = entry.kind === 'adapter' && entry.mobileUrl && isMobile();
  const isInstallLink = entry.kind === 'install' && entry.installUrl;
  const isAdapterInstall = entry.kind === 'adapter' && !entry.selectable && entry.installUrl;
  const useAnchor = isMobileDeepLink || isInstallLink || isAdapterInstall;

  const button = document.createElement(useAnchor ? 'a' : 'button');
  if (useAnchor) {
    if (isMobileDeepLink) {
      button.href = entry.mobileUrl;
    } else {
      button.href = entry.installUrl;
      button.target = '_blank';
      button.rel = 'noopener noreferrer';
    }
  } else {
    button.type = 'button';
    button.disabled = !entry.selectable;
  }
  button.className = `wallet-option${entry.key === state.selectedKey ? ' active' : ''}`;

  if (!useAnchor) {
    button.addEventListener('click', () => {
      if (!entry.selectable) return;
      state.selectedKey = entry.key;
      setText('result', '');
      renderWallets();
    });
  }

  const mark = document.createElement('div');
  mark.className = 'wallet-mark';
  if (entry.icon) {
    const img = document.createElement('img');
    img.src = entry.icon;
    img.alt = '';
    mark.appendChild(img);
  } else {
    mark.textContent = entry.name.slice(0, 2).toUpperCase();
  }

  const body = document.createElement('div');
  body.className = 'wallet-body';

  const title = document.createElement('div');
  title.className = 'wallet-title';
  title.textContent = entry.name;

  const subtitle = document.createElement('div');
  subtitle.className = 'wallet-subtitle';
  subtitle.textContent = entry.detail;

  body.append(title, subtitle);

  const tag = document.createElement('div');
  tag.className = `wallet-tag${entry.kind === 'standard' ? ' detected' : ''}`;
  tag.textContent =
    entry.kind === 'standard'
      ? 'detected'
      : entry.kind === 'adapter'
        ? entry.selectable
          ? 'open app'
          : 'install'
        : 'install';

  button.append(mark, body, tag);
  return button;
}

function createAdapterFallbacks() {
  const fallbacks = [
    { id: 'phantom', name: 'Phantom', adapter: new PhantomWalletAdapter() },
    {
      id: 'solflare',
      name: 'Solflare',
      adapter: new SolflareWalletAdapter({ network: 'mainnet-beta' }),
    },
  ];

  for (const fallback of fallbacks) {
    fallback.adapter.on('readyStateChange', rebuildEntries);
    fallback.adapter.on('error', (error) => {
      console.warn(`${fallback.name} adapter error`, error);
    });
  }

  return fallbacks;
}

function logDetected() {
  try {
    const all = state.walletsApi?.get() || [];
    const summary = all.map((w) => ({
      name: w.name,
      chains: w.chains,
      features: Object.keys(w.features || {}),
    }));
    console.info(`[verify] wallets detected: ${all.length}`, summary);
    pushDebug(`wallets detected: ${all.length}`, summary);
  } catch (error) {
    console.warn('[verify] detection log failed', error);
    pushDebug('detection log failed', String(error));
  }
}

function initializeWallets() {
  state.walletsApi = getWallets();
  state.adapterFallbacks = createAdapterFallbacks();

  const onRegister = state.walletsApi.on('register', () => {
    logDetected();
    rebuildEntries();
  });
  const onUnregister = state.walletsApi.on('unregister', rebuildEntries);
  state.walletsUnsub = () => {
    try {
      onRegister?.();
    } catch {}
    try {
      onUnregister?.();
    } catch {}
  };

  logDetected();
  rebuildEntries();

  // Extensions sometimes register slightly after `load`; re-check a few times.
  [200, 600, 1500].forEach((delay) => {
    setTimeout(() => {
      logDetected();
      rebuildEntries();
    }, delay);
  });
}

async function loadSession(token) {
  const response = await fetch(`/api/verify-session/${encodeURIComponent(token)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Failed to load verification session.');
  return payload;
}

async function completeVerification(token, signedPayload) {
  const verifyMethod = signedPayload?.method || 'signMessage';
  console.info('[verify] posting method:', verifyMethod, signedPayload);
  pushDebug(`POST method=${verifyMethod}`, {
    account: signedPayload?.output?.account,
    sigLen: signedPayload?.output?.signatureBase64?.length,
    msgLen: signedPayload?.output?.signedMessageBase64?.length,
  });
  const url = `/api/verify-session/${encodeURIComponent(token)}/complete/${encodeURIComponent(verifyMethod)}`;
  const body = { verifyMethod, ...signedPayload };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    pushDebug(`server ${response.status}`, payload);
    throw new Error(payload.error || 'Verification failed.');
  }
  pushDebug('server ok', { wallet: payload?.walletAddress, count: payload?.harmieCount });
  return payload;
}

function pickSolanaAccount(wallet) {
  const accounts = wallet.accounts || [];
  return (
    accounts.find((account) =>
      (account.chains || []).some((chain) => chain === SOLANA_MAINNET_CHAIN),
    ) ||
    accounts.find((account) => (account.chains || []).some(isSolanaChain)) ||
    accounts[0] ||
    null
  );
}

async function connectStandardWallet(wallet) {
  const connect = wallet.features[STANDARD_CONNECT];
  if (!connect) throw new Error(`${wallet.name} does not support connect.`);

  let account = pickSolanaAccount(wallet);
  if (!account) {
    const result = await connect.connect();
    const accounts = result?.accounts || wallet.accounts || [];
    account =
      accounts.find((entry) =>
        (entry.chains || []).some((chain) => chain === SOLANA_MAINNET_CHAIN),
      ) ||
      accounts.find((entry) => (entry.chains || []).some(isSolanaChain)) ||
      accounts[0] ||
      null;
  }

  if (!account) throw new Error(`${wallet.name} did not return a Solana account.`);
  return account;
}

async function verifyWithStandardWallet(entry) {
  const wallet = entry.wallet;
  pushDebug(`connecting ${wallet.name}`, Object.keys(wallet.features || {}));
  const account = await connectStandardWallet(wallet);
  pushDebug('account', { address: account.address, pkLen: account.publicKey?.length });

  const signMessageFeature = wallet.features[SOLANA_SIGN_MESSAGE];
  if (signMessageFeature) {
    try {
      const message = createSignInMessage({
        ...state.session.signInInput,
        address: account.address,
      });
      pushDebug(`signMessage bytes=${message.length}`);
      const results = await signMessageFeature.signMessage({ account, message });
      const output = Array.isArray(results) ? results[0] : results;
      pushDebug('signMessage result', {
        sig: output?.signature?.length,
        msg: output?.signedMessage?.length,
      });
      if (output && output.signedMessage && output.signature) {
        return {
          method: 'signMessage',
          output: {
            account: {
              address: account.address,
              publicKeyBase64: bytesToBase64(account.publicKey),
              label: account.label || wallet.name,
            },
            signedMessageBase64: bytesToBase64(output.signedMessage),
            signatureBase64: bytesToBase64(output.signature),
            signatureType: output.signatureType || 'ed25519',
          },
        };
      }
      pushDebug('signMessage output malformed', output);
    } catch (error) {
      pushDebug('signMessage error', String(error?.message || error));
      console.warn('[verify] signMessage failed, trying SIWS', error);
    }
  }

  const signInFeature = wallet.features[SOLANA_SIGN_IN];
  if (!signInFeature) {
    throw new Error(`${wallet.name} does not support message signing.`);
  }

  const input = {
    ...state.session.signInInput,
    address: account.address,
  };
  const results = await signInFeature.signIn(input);
  const output = Array.isArray(results) ? results[0] : results;
  if (!output || !output.signedMessage || !output.signature) {
    throw new Error(`${wallet.name} did not return a sign-in result.`);
  }

  return {
    method: 'siws',
    output: {
      account: {
        address: output.account?.address || account.address,
        publicKeyBase64: bytesToBase64(output.account?.publicKey || account.publicKey),
        label: output.account?.label || account.label || wallet.name,
      },
      signedMessageBase64: bytesToBase64(output.signedMessage),
      signatureBase64: bytesToBase64(output.signature),
      signatureType: output.signatureType || 'ed25519',
    },
  };
}

async function verifyWithAdapter(entry) {
  const adapter = entry.adapter;
  await adapter.connect();

  const address = adapter.publicKey?.toBase58?.() || adapter.publicKey?.toString?.() || '';
  if (!address) {
    setText('status', `Opening ${entry.name}...`);
    setButtonState(true, `Continue in ${entry.name}`);
    return null;
  }

  const message = createSignInMessage({
    ...state.session.signInInput,
    address,
  });
  const signature = await adapter.signMessage(message);

  return {
    method: 'signMessage',
    output: {
      account: {
        address,
        publicKeyBase58: address,
        label: entry.name,
      },
      signedMessageBase64: bytesToBase64(message),
      signatureBase64: bytesToBase64(signature),
      signatureType: 'ed25519',
    },
  };
}

async function verifyWithSelected() {
  const entry = state.entries.find((item) => item.key === state.selectedKey);
  if (!entry?.selectable) throw new Error('Choose a supported wallet first.');

  if (entry.kind === 'standard') return verifyWithStandardWallet(entry);
  if (entry.kind === 'adapter') return verifyWithAdapter(entry);
  throw new Error('This option cannot be used to verify.');
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    setText('status', 'Missing verification token.');
    return;
  }

  try {
    state.session = await loadSession(token);
    setText('status', 'Choose a wallet, then approve the secure verification request.');
    setText('meta', `Expires at: ${new Date(state.session.expiresAt).toLocaleString()}`);
    setText('message', state.session.previewMessage);
    initializeWallets();

    const button = document.getElementById('verify-button');
    button?.addEventListener('click', async () => {
      try {
        setButtonState(true, 'Waiting for wallet approval...');
        setText('result', '');

        const verificationPayload = await verifyWithSelected();
        if (!verificationPayload) return;

        setButtonState(true, 'Verifying wallet...');
        const result = await completeVerification(token, verificationPayload);
        setText(
          'result',
          `Linked ${result.walletAddress}. Harmies held: ${result.harmieCount}/${result.totalSupply}.`,
        );
        setText('status', 'Verification complete. You can return to Discord.');
        setButtonState(true, 'Verification complete');
      } catch (error) {
        console.error('Verification error:', error);
        setText('result', error?.message || 'Verification failed.');
        const selected = state.entries.find((entry) => entry.key === state.selectedKey);
        setButtonState(false, selected ? `Verify with ${selected.name}` : 'Select a wallet to continue');
      }
    });
  } catch (error) {
    setText('status', error?.message || 'Failed to load verification session.');
  }
}

window.addEventListener('load', main);

// Keep reference so bundlers do not tree-shake.
void SOLANA_CHAINS;

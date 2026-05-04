/**
 * Provider handler — processes Keplr-compatible API requests
 * received from the content script.
 *
 * Methods that need user approval (enable, signAmino, signDirect,
 * signArbitrary) open a popup window and wait for user consent.
 *
 * Methods that don't need approval (getKey, sendTx,
 * experimentalSuggestChain) execute immediately.
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { serializeSignDoc } from "@cosmjs/amino";
import { toBase64, fromHex, fromBech32 } from "@cosmjs/encoding";
import { Secp256k1, sha256 } from "@cosmjs/crypto";
import { SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { getMnemonic, getAddress, isUnlocked, getWalletList } from "./keystore";
import {
  GONKA_CHAIN_ID,
  GONKA_COIN_TYPE,
  GONKA_BECH32_PREFIX,
} from "@/lib/gonka";
import { getActiveEndpoint } from "@/lib/rpc";
import { storageGet, storageSet, KEYS, type ConnectedSite } from "@/lib/storage";
import { Slip10RawIndex, HdPath, Bip39, EnglishMnemonic, Slip10, Slip10Curve } from "@cosmjs/crypto";

// ------------------------------------------------------------------
//  HD Paths
// ------------------------------------------------------------------

const GONKA_HD: HdPath = [
  Slip10RawIndex.hardened(44),
  Slip10RawIndex.hardened(GONKA_COIN_TYPE),
  Slip10RawIndex.hardened(0),
  Slip10RawIndex.normal(0),
  Slip10RawIndex.normal(0),
];

const COSMOS_HD: HdPath = [
  Slip10RawIndex.hardened(44),
  Slip10RawIndex.hardened(118),
  Slip10RawIndex.hardened(0),
  Slip10RawIndex.normal(0),
  Slip10RawIndex.normal(0),
];

const COSMOSHUB_CHAIN_ID = "cosmoshub-4";
const COSMOSHUB_BECH32_PREFIX = "cosmos";

// ------------------------------------------------------------------
//  Suggested chains store — persisted to storage so they survive
//  service worker restarts.
// ------------------------------------------------------------------

const _suggestedChains = new Map<string, any>();

async function loadSuggestedChains(): Promise<void> {
  const stored = await storageGet<Record<string, any>>(KEYS.SUGGESTED_CHAINS);
  if (stored) {
    for (const [chainId, info] of Object.entries(stored)) {
      _suggestedChains.set(chainId, info);
    }
  }
}

async function persistSuggestedChain(chainId: string, chainInfo: any): Promise<void> {
  const stored = (await storageGet<Record<string, any>>(KEYS.SUGGESTED_CHAINS)) || {};
  stored[chainId] = chainInfo;
  await storageSet({ [KEYS.SUGGESTED_CHAINS]: stored });
}

// Load on module init (service worker startup)
loadSuggestedChains();

// ------------------------------------------------------------------
//  Pending approval requests + anti-spam controls
//
//  A malicious page can call enable() / signAmino() / signDirect() /
//  signArbitrary() in a tight loop and open an unbounded number of
//  approval popups (ref: https://github.com/gonkalabs/ggwallet/issues/2).
//
//  Defences, layered from cheap to expensive:
//
//    1. Per-origin approval queue. Only one approval popup is ever
//       visible per origin at a time; additional requests from the same
//       origin are FIFO-queued. Legitimate sequential flows (e.g. Hex's
//       enable → signAmino chain on hex.exchange) still pass through
//       without friction — each step awaits its predecessor, so the
//       queue rarely holds more than the active entry.
//
//    2. Bounded queue: once the queue reaches MAX_QUEUED_APPROVALS_PER_ORIGIN
//       (active + waiters), further requests are rejected immediately
//       and the currently-open popup is re-focused so the user knows
//       where to respond.
//
//    3. Global approval cap: at most MAX_PENDING_APPROVALS_GLOBAL in
//       flight across every origin, to stop a group of cooperating
//       iframes / origins from ganging up on the user.
// ------------------------------------------------------------------

const MAX_QUEUED_APPROVALS_PER_ORIGIN = 3;
const MAX_PENDING_APPROVALS_GLOBAL = 10;

interface PendingRequest {
  method: string;
  params: any;
  origin: string;
  resolve: (result: { result?: any; error?: string }) => void;
}

interface QueuedApproval {
  requestId: string;
  method: string;
  params: any;
  origin: string;
  resolve: (result: { result?: any; error?: string }) => void;
}

interface ApprovalQueueState {
  active: string | null;        // requestId shown in the active popup
  windowId: number | null;      // chrome.windows id of the active popup
  queued: QueuedApproval[];     // FIFO of waiting requests
}

const _pendingRequests = new Map<string, PendingRequest>();
const _approvalQueues = new Map<string, ApprovalQueueState>();
let _requestCounter = 0;

function generateRequestId(): string {
  return `req_${Date.now()}_${++_requestCounter}`;
}

function getOrCreateQueue(origin: string): ApprovalQueueState {
  let state = _approvalQueues.get(origin);
  if (!state) {
    state = { active: null, windowId: null, queued: [] };
    _approvalQueues.set(origin, state);
  }
  return state;
}

function queueDepth(state: ApprovalQueueState): number {
  return (state.active ? 1 : 0) + state.queued.length;
}

function totalInFlightApprovals(): number {
  let n = 0;
  for (const s of _approvalQueues.values()) n += queueDepth(s);
  return n;
}

function focusActivePopup(state: ApprovalQueueState): void {
  if (state.windowId == null) return;
  // Fire-and-forget; ignore errors (window may already be closed).
  chrome.windows
    .update(state.windowId, { focused: true, drawAttention: true })
    .catch(() => {});
}

/**
 * Enqueue an approval request. Opens the popup immediately if nothing
 * is pending for the origin, otherwise waits for the current popup to
 * settle. Excess requests (beyond the per-origin or global cap) are
 * rejected synchronously so the dApp gets an explicit error instead of
 * a dangling promise.
 */
function requestApproval(
  method: string,
  params: any,
  origin: string,
): Promise<{ result?: any; error?: string }> {
  const state = getOrCreateQueue(origin);

  if (queueDepth(state) >= MAX_QUEUED_APPROVALS_PER_ORIGIN) {
    focusActivePopup(state);
    return Promise.resolve({
      error:
        "Too many pending approval requests from this site. Respond to the open request first.",
    });
  }

  if (totalInFlightApprovals() >= MAX_PENDING_APPROVALS_GLOBAL) {
    return Promise.resolve({
      error:
        "Too many pending wallet approvals. Respond to the existing requests first.",
    });
  }

  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const entry: QueuedApproval = { requestId, method, params, origin, resolve };

    if (state.active) {
      state.queued.push(entry);
    } else {
      startApproval(entry);
    }
  });
}

/**
 * Register the approval in _pendingRequests, open its popup, and wire
 * up cleanup so the next queued entry (if any) is processed once this
 * one settles (approve, reject, or window closed).
 */
function startApproval(entry: QueuedApproval): void {
  const state = getOrCreateQueue(entry.origin);
  state.active = entry.requestId;

  const wrappedResolve = (result: { result?: any; error?: string }) => {
    entry.resolve(result);
    onApprovalSettled(entry.origin, entry.requestId);
  };

  _pendingRequests.set(entry.requestId, {
    method: entry.method,
    params: entry.params,
    origin: entry.origin,
    resolve: wrappedResolve,
  });

  const approvalUrl = chrome.runtime.getURL(
    `src/popup/approval.html?requestId=${encodeURIComponent(entry.requestId)}`
  );

  chrome.windows.create(
    {
      url: approvalUrl,
      type: "popup",
      width: 400,
      height: 630,
      focused: true,
    },
    (win) => {
      if (!win?.id) {
        _pendingRequests.delete(entry.requestId);
        wrappedResolve({ error: "Failed to open approval window" });
        return;
      }
      state.windowId = win.id;

      // If the user closes the window without responding, reject.
      const onRemoved = (windowId: number) => {
        if (windowId !== win.id) return;
        chrome.windows.onRemoved.removeListener(onRemoved);
        const pending = _pendingRequests.get(entry.requestId);
        if (pending) {
          _pendingRequests.delete(entry.requestId);
          pending.resolve({ error: "User rejected the request" });
        }
      };
      chrome.windows.onRemoved.addListener(onRemoved);
    }
  );
}

function onApprovalSettled(origin: string, requestId: string): void {
  const state = _approvalQueues.get(origin);
  if (!state) return;
  if (state.active === requestId) {
    state.active = null;
    state.windowId = null;
  }
  const next = state.queued.shift();
  if (next) {
    startApproval(next);
  } else if (!state.active && state.queued.length === 0) {
    _approvalQueues.delete(origin);
  }
}

// ------------------------------------------------------------------
//  Public API for the approval popup (called from background/index.ts)
// ------------------------------------------------------------------

/**
 * Get details of a pending request (for the approval popup to display).
 */
export function getPendingRequest(requestId: string): {
  method: string;
  params: any;
  origin: string;
} | null {
  const pending = _pendingRequests.get(requestId);
  if (!pending) return null;
  return { method: pending.method, params: pending.params, origin: pending.origin };
}

/**
 * Approve a pending request — execute the actual operation and resolve.
 */
export async function approveRequest(requestId: string): Promise<{ result?: any; error?: string }> {
  const pending = _pendingRequests.get(requestId);
  if (!pending) return { error: "Request not found or expired" };

  _pendingRequests.delete(requestId);

  try {
    let result: { result?: any; error?: string };

    switch (pending.method) {
      case "enable":
        result = await executeEnable(pending.params, pending.origin);
        break;
      case "signAmino":
        result = await executeSignAmino(pending.params);
        break;
      case "signDirect":
        result = await executeSignDirect(pending.params);
        break;
      case "signArbitrary":
        result = await executeSignArbitrary(pending.params);
        break;
      default:
        result = { error: `Unsupported approval method: ${pending.method}` };
    }

    // Resolve the original promise (unblocks the dApp)
    pending.resolve(result);
    return result;
  } catch (err: any) {
    const errorResult = { error: err.message || String(err) };
    pending.resolve(errorResult);
    return errorResult;
  }
}

/**
 * Reject a pending request.
 */
export function rejectRequest(requestId: string): { result?: any; error?: string } {
  const pending = _pendingRequests.get(requestId);
  if (!pending) return { error: "Request not found or expired" };

  _pendingRequests.delete(requestId);
  pending.resolve({ error: "User rejected the request" });
  return { result: true };
}

// ------------------------------------------------------------------
//  Connected sites management
// ------------------------------------------------------------------

export async function getConnectedSites(): Promise<ConnectedSite[]> {
  return (await storageGet<ConnectedSite[]>(KEYS.CONNECTED_SITES)) || [];
}

async function addConnectedSite(origin: string, chainIds: string[]): Promise<void> {
  const sites = await getConnectedSites();
  const existing = sites.find((s) => s.origin === origin);
  if (existing) {
    const merged = new Set([...existing.chainIds, ...chainIds]);
    existing.chainIds = Array.from(merged);
  } else {
    sites.push({ origin, chainIds, connectedAt: Date.now() });
  }
  await storageSet({ [KEYS.CONNECTED_SITES]: sites });
}

export async function disconnectSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  const filtered = sites.filter((s) => s.origin !== origin);
  await storageSet({ [KEYS.CONNECTED_SITES]: filtered });
}

async function isOriginConnected(origin: string, chainIds: string[]): Promise<boolean> {
  const sites = await getConnectedSites();
  const site = sites.find((s) => s.origin === origin);
  if (!site) return false;
  return chainIds.every((id) => site.chainIds.includes(id));
}

// ------------------------------------------------------------------
//  Crypto helpers
// ------------------------------------------------------------------

async function getWalletForChain(_chainId: string): Promise<DirectSecp256k1HdWallet> {
  const mnemonic = getMnemonic();
  if (!mnemonic) throw new Error("Wallet is locked");

  const prefix = getBech32Prefix(_chainId);
  const hdPaths = getHdPaths(_chainId);

  return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix, hdPaths });
}

function getBech32Prefix(chainId: string): string {
  if (chainId === GONKA_CHAIN_ID) return GONKA_BECH32_PREFIX;
  if (chainId === COSMOSHUB_CHAIN_ID) return COSMOSHUB_BECH32_PREFIX;
  const suggested = _suggestedChains.get(chainId);
  if (suggested?.bech32Config?.bech32PrefixAccAddr) {
    return suggested.bech32Config.bech32PrefixAccAddr;
  }
  return GONKA_BECH32_PREFIX;
}

function getHdPaths(chainId: string): HdPath[] {
  if (chainId === GONKA_CHAIN_ID) return [GONKA_HD];
  if (chainId === COSMOSHUB_CHAIN_ID) return [COSMOS_HD];
  const suggested = _suggestedChains.get(chainId);
  if (suggested?.bip44?.coinType) {
    return [[
      Slip10RawIndex.hardened(44),
      Slip10RawIndex.hardened(suggested.bip44.coinType),
      Slip10RawIndex.hardened(0),
      Slip10RawIndex.normal(0),
      Slip10RawIndex.normal(0),
    ] as HdPath];
  }
  return [GONKA_HD];
}

function isSupportedChain(chainId: string): boolean {
  return chainId === GONKA_CHAIN_ID || chainId === COSMOSHUB_CHAIN_ID || _suggestedChains.has(chainId);
}

async function derivePrivateKeyBytes(mnemonic: string, chainId: string): Promise<Uint8Array> {
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const hdPaths = getHdPaths(chainId);
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPaths[0]);
  return privkey;
}

// ------------------------------------------------------------------
//  Origin allow-list
//
//  GG Wallet only ever talks to HTTPS dApps. Plain HTTP (including
//  http://localhost), file://, and any other scheme is rejected up-front
//  so a malicious local server, a mixed-content downgrade, or a sniffable
//  Wi-Fi hop can never coerce the wallet into signing.
// ------------------------------------------------------------------

export function isAllowedDappOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
//  Per-origin request rate limit (defence in depth)
//
//  Even with the approval queue in place, a page could still pound
//  cheap methods like experimentalSuggestChain / getKey to bloat
//  storage or burn CPU. A sliding-window limiter gives every origin
//  a generous but finite budget of provider calls.
// ------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 60; // ~6 req/s sustained — plenty for legit dApps
const _requestLog = new Map<string, number[]>();

function recordAndCheckRate(origin: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const prev = _requestLog.get(origin) || [];
  // Drop timestamps outside the window (cheap because list is short).
  let i = 0;
  while (i < prev.length && prev[i] < cutoff) i++;
  const recent = i === 0 ? prev : prev.slice(i);
  recent.push(now);
  _requestLog.set(origin, recent);
  if (recent.length > RATE_LIMIT_MAX_REQUESTS) {
    return { ok: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - recent[0]) };
  }
  return { ok: true, retryAfterMs: 0 };
}

// ------------------------------------------------------------------
//  Main router
// ------------------------------------------------------------------

export async function handleProviderRequest(
  method: string,
  params: any,
  origin?: string,
): Promise<{ result?: any; error?: string }> {
  if (!isAllowedDappOrigin(origin)) {
    return {
      error: `GG Wallet only connects to HTTPS sites. Origin "${origin || "(unknown)"}" was blocked.`,
    };
  }

  const rate = recordAndCheckRate(origin as string);
  if (!rate.ok) {
    return {
      error: `Too many requests from this site. Try again in ${Math.ceil(
        rate.retryAfterMs / 1000
      )}s.`,
    };
  }

  try {
    switch (method) {
      // --- Methods that need approval ---
      case "enable":
        return await handleEnable(params, origin);
      case "signAmino":
        return await handleWithApproval("signAmino", params, origin);
      case "signDirect":
        return await handleWithApproval("signDirect", params, origin);
      case "signArbitrary":
        return await handleWithApproval("signArbitrary", params, origin);

      // --- Methods that don't need approval but do need unlock ---
      case "getKey":
        return await handleGetKey(params, origin);
      case "sendTx":
        return await executeSendTx(params);
      case "experimentalSuggestChain":
        return await executeSuggestChain(params);
      default:
        return { error: `Unsupported method: ${method}` };
    }
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

// ------------------------------------------------------------------
//  Unlock gate
//
//  When a dApp request arrives while the wallet is locked, we open the
//  extension popup and suspend the request until the user unlocks.
//
//  The unlock context (origin, method) is persisted in session storage
//  so the popup can display it even if the service worker restarts while
//  the user is typing their password. In-memory resolvers handle the
//  common case where the SW stays alive; the content script's locked-request
//  queue handles the fallback case where it doesn't.
// ------------------------------------------------------------------

const UNLOCK_CONTEXT_KEY = "gg_pending_unlock_context";

type UnlockResolver = { resolve: () => void; reject: (e: Error) => void };
const _unlockWaiters: Set<UnlockResolver> = new Set();

// Track the current unlock popup so a flood of locked dApp calls (e.g. a
// malicious site hammering enable() while we're locked) doesn't spawn
// a new unlock window for every call. All concurrent waiters share one
// popup; when it closes or unlock succeeds, the tracker is cleared.
//
// `_unlockWindowCreating` guards the brief window between the async
// `chrome.windows.create` call and its callback — without it, a burst
// of concurrent callers all see `_unlockWindowId == null` and each
// end up spawning a popup.
let _unlockWindowId: number | null = null;
let _unlockWindowCreating = false;

/**
 * Called by the background index after a successful UNLOCK message.
 * Resolves all pending requestUnlock() promises so dApp requests continue.
 */
export function notifyUnlocked(): void {
  for (const waiter of _unlockWaiters) {
    waiter.resolve();
  }
  _unlockWaiters.clear();
  _unlockWindowId = null;
  _unlockWindowCreating = false;
  // Clear stored context
  chrome.storage.session.remove(UNLOCK_CONTEXT_KEY).catch(() => {});
}

/**
 * Called when the user explicitly rejects a dApp unlock request.
 * Rejects all pending requestUnlock() promises so dApp requests fail
 * with a user-rejected error.
 */
export function rejectUnlock(): void {
  for (const waiter of _unlockWaiters) {
    waiter.reject(new Error("User rejected the request"));
  }
  _unlockWaiters.clear();
  _unlockWindowId = null;
  _unlockWindowCreating = false;
  chrome.storage.session.remove(UNLOCK_CONTEXT_KEY).catch(() => {});
}

/**
 * Store unlock context so the popup can read it even after a SW restart.
 */
async function storeUnlockContext(origin?: string, method?: string): Promise<void> {
  await chrome.storage.session.set({
    [UNLOCK_CONTEXT_KEY]: { origin: origin || "", method: method || "" },
  }).catch(() => {});
}

/**
 * Open the extension popup so the user can unlock the wallet, then wait
 * until notifyUnlocked() is called (i.e. UNLOCK succeeds in the background).
 *
 * @param origin  The dApp origin requesting access (shown in the popup).
 * @param method  The API method being requested (shown in the popup).
 */
/**
 * Open a fresh unlock popup, or re-focus the already-open one.
 *
 * Called when a dApp request hits the locked gate. All concurrent
 * waiters share a single popup — this prevents a page from spawning
 * hundreds of unlock windows by looping over locked requests.
 */
function openOrFocusUnlockWindow(): void {
  if (_unlockWindowId != null) {
    // Re-focus the existing window. If Chrome tells us the window is
    // gone (e.g. user already closed it), fall through to reopen.
    chrome.windows
      .update(_unlockWindowId, { focused: true, drawAttention: true })
      .then(() => {})
      .catch(() => {
        _unlockWindowId = null;
        openOrFocusUnlockWindow();
      });
    return;
  }
  // Guard against the race where several callers reach this point
  // before the first chrome.windows.create callback has set the id.
  if (_unlockWindowCreating) return;
  _unlockWindowCreating = true;

  // Always open a standalone popup window — chrome.action.openPopup()
  // requires a user gesture and never works from a background script.
  const popupUrl = chrome.runtime.getURL("src/popup/index.html");
  chrome.windows.create(
    { url: popupUrl, type: "popup", width: 400, height: 630, focused: true },
    (win) => {
      _unlockWindowCreating = false;
      if (!win?.id) return;
      _unlockWindowId = win.id;
      const onRemoved = (wid: number) => {
        if (wid !== win.id) return;
        chrome.windows.onRemoved.removeListener(onRemoved);
        if (_unlockWindowId === win.id) _unlockWindowId = null;
      };
      chrome.windows.onRemoved.addListener(onRemoved);
    },
  );
}

function requestUnlock(origin?: string, method?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const waiter: UnlockResolver = { resolve, reject };

    // Wrap resolve/reject to clear the 5-min timeout
    let timer: ReturnType<typeof setTimeout>;
    waiter.resolve = () => { clearTimeout(timer); resolve(); };
    waiter.reject  = (e) => { clearTimeout(timer); reject(e); };

    _unlockWaiters.add(waiter);

    // Persist context for the popup to read (survives SW restarts)
    storeUnlockContext(origin, method).then(() => {
      openOrFocusUnlockWindow();
    });

    // Timeout after 5 minutes
    timer = setTimeout(() => {
      if (_unlockWaiters.has(waiter)) {
        _unlockWaiters.delete(waiter);
        chrome.storage.session.remove(UNLOCK_CONTEXT_KEY).catch(() => {});
        reject(new Error("Wallet unlock timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

// ------------------------------------------------------------------
//  Approval wrapper
// ------------------------------------------------------------------

async function handleWithApproval(
  method: string,
  params: any,
  origin?: string,
): Promise<{ result?: any; error?: string }> {
  if (!isUnlocked()) {
    try {
      await requestUnlock(origin, method);
    } catch (err: any) {
      return { error: "Wallet is locked. Please unlock GG Wallet first." };
    }
  }
  return requestApproval(method, params, origin || "unknown");
}

// ------------------------------------------------------------------
//  enable — auto-approve if already connected, otherwise popup
// ------------------------------------------------------------------

async function handleEnable(
  params: { chainIds: string[] },
  origin?: string,
): Promise<{ result?: any; error?: string }> {
  // Filter to supported chains only — dApps may request chains we don't
  // support (e.g. osmosis-1) alongside ones we do. Proceed with what we can.
  const supported = params.chainIds.filter(isSupportedChain);
  if (supported.length === 0) {
    return { error: "None of the requested chains are supported." };
  }

  // If this origin is already connected for all supported chains, approve
  // immediately — no unlock required. The stored connection grant is
  // persistent and survives service worker restarts.
  if (origin && await isOriginConnected(origin, supported)) {
    return { result: true };
  }

  // New connection request — wallet must be unlocked to proceed
  if (!isUnlocked()) {
    try {
      await requestUnlock();
    } catch {
      return { error: "Wallet is locked. Please unlock GG Wallet first." };
    }
  }

  // Request approval via popup
  return requestApproval("enable", { ...params, chainIds: supported }, origin || "unknown");
}

// ------------------------------------------------------------------
//  Execution functions (run after approval or directly)
// ------------------------------------------------------------------

async function executeEnable(
  params: { chainIds: string[] },
  origin: string,
): Promise<{ result?: any; error?: string }> {
  if (origin) {
    await addConnectedSite(origin, params.chainIds);
  }
  return { result: true };
}

async function handleGetKey(params: { chainId: string }, origin?: string): Promise<{ result?: any; error?: string }> {
  if (!isSupportedChain(params.chainId)) {
    return { error: `Chain ${params.chainId} is not supported.` };
  }

  // Auto-trigger enable flow if the site hasn't connected yet.
  // Many Cosmos dApps call getKey() directly without enable() first
  // (Keplr handles this gracefully, so we must too for compatibility).
  if (origin && !(await isOriginConnected(origin, [params.chainId]))) {
    const enableResult = await handleEnable({ chainIds: [params.chainId] }, origin);
    if (enableResult.error) return enableResult;
  }

  if (!isUnlocked()) {
    try {
      await requestUnlock(origin, "getKey");
    } catch {
      return { error: "Wallet is locked. Please unlock GG Wallet first." };
    }
  }
  return executeGetKey(params);
}

async function executeGetKey(params: { chainId: string }): Promise<{ result?: any; error?: string }> {
  if (!isUnlocked()) return { error: "Wallet is locked" };

  const wallet = await getWalletForChain(params.chainId);
  const [account] = await wallet.getAccounts();

  const wallets = await getWalletList();
  const address = getAddress();
  const currentWallet = wallets.find((w) => w.address === address);
  const name = currentWallet?.name || "GG Wallet";

  const pubKeyArray = Array.from(account.pubkey);
  const addressArray = Array.from(fromBech32(account.address).data);

  return {
    result: {
      name,
      algo: account.algo,
      pubKey: pubKeyArray,
      address: addressArray,
      bech32Address: account.address,
      ethereumHexAddress: "",
      isNanoLedger: false,
      isKeystone: false,
    },
  };
}

async function executeSignAmino(params: {
  chainId: string;
  signer: string;
  signDoc: any;
  signOptions?: any;
}): Promise<{ result?: any; error?: string }> {
  if (!isUnlocked()) return { error: "Wallet is locked" };

  const mnemonic = getMnemonic();
  if (!mnemonic) return { error: "Wallet is locked" };

  const wallet = await getWalletForChain(params.chainId);
  const [account] = await wallet.getAccounts();

  if (account.address !== params.signer) {
    return { error: `Signer address mismatch: expected ${account.address}, got ${params.signer}` };
  }

  // Normalize the sign doc — postMessage serialization can turn arrays into
  // objects with numeric keys; serializeSignDoc requires real arrays.
  const signDoc = normalizeAminoSignDoc(params.signDoc);

  try {
    const serialized = serializeSignDoc(signDoc);
    const hash = sha256(serialized);

    const privKey = await derivePrivateKeyBytes(mnemonic, params.chainId);
    const signature = await Secp256k1.createSignature(hash, privKey);
    const signatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)]);

    return {
      result: {
        signed: signDoc,
        signature: {
          pub_key: {
            type: "tendermint/PubKeySecp256k1",
            value: toBase64(account.pubkey),
          },
          signature: toBase64(signatureBytes),
        },
      },
    };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

/**
 * Normalize an Amino sign doc that may have been mangled by postMessage
 * serialization (Uint8Arrays / arrays become plain objects with numeric keys).
 */
function normalizeAminoSignDoc(doc: any): any {
  return {
    ...doc,
    msgs: Array.isArray(doc.msgs) ? doc.msgs : Object.values(doc.msgs ?? {}),
    fee: {
      ...doc.fee,
      amount: Array.isArray(doc.fee?.amount)
        ? doc.fee.amount
        : Object.values(doc.fee?.amount ?? {}),
    },
  };
}

async function executeSignDirect(params: {
  chainId: string;
  signer: string;
  signDoc: any;
  signOptions?: any;
}): Promise<{ result?: any; error?: string }> {
  if (!isUnlocked()) return { error: "Wallet is locked" };

  const mnemonic = getMnemonic();
  if (!mnemonic) return { error: "Wallet is locked" };

  const wallet = await getWalletForChain(params.chainId);
  const [account] = await wallet.getAccounts();

  if (account.address !== params.signer) {
    return { error: `Signer address mismatch: expected ${account.address}, got ${params.signer}` };
  }

  // postMessage serialization can turn Uint8Arrays into objects with numeric
  // keys — coerce them back to Uint8Array via toUint8ArrayFromAny.
  const bodyBytes = toUint8ArrayFromAny(params.signDoc.bodyBytes);
  const authInfoBytes = toUint8ArrayFromAny(params.signDoc.authInfoBytes);

  try {
    const signDoc = SignDoc.fromPartial({
      bodyBytes,
      authInfoBytes,
      chainId: params.signDoc.chainId || params.chainId,
      accountNumber: BigInt(params.signDoc.accountNumber || "0"),
    });

    const signBytes = SignDoc.encode(signDoc).finish();
    const hash = sha256(signBytes);

    const privKey = await derivePrivateKeyBytes(mnemonic, params.chainId);
    const signature = await Secp256k1.createSignature(hash, privKey);
    const signatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)]);

    return {
      result: {
        signed: {
          bodyBytes: Array.from(bodyBytes),
          authInfoBytes: Array.from(authInfoBytes),
          chainId: signDoc.chainId,
          accountNumber: params.signDoc.accountNumber?.toString() || "0",
        },
        signature: {
          pub_key: {
            type: "tendermint/PubKeySecp256k1",
            value: toBase64(account.pubkey),
          },
          signature: toBase64(signatureBytes),
        },
      },
    };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

/**
 * Coerce any array-like value (plain array, object with numeric keys,
 * Uint8Array, Buffer-style {type,data}) into a Uint8Array.
 */
function toUint8ArrayFromAny(data: any): Uint8Array {
  if (!data) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data.type === "Buffer" && Array.isArray(data.data)) return new Uint8Array(data.data);
  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length > 0 && keys.every((k) => !isNaN(Number(k)))) {
      return new Uint8Array(keys.sort((a, b) => Number(a) - Number(b)).map((k) => data[k]));
    }
  }
  return new Uint8Array(0);
}

async function executeSendTx(params: {
  chainId: string;
  tx: number[];
  mode: string;
}): Promise<{ result?: any; error?: string }> {
  const endpoint = await getActiveEndpoint();
  const txBytes = toBase64(new Uint8Array(params.tx));

  let broadcastMode = "BROADCAST_MODE_SYNC";
  switch (params.mode) {
    case "block": broadcastMode = "BROADCAST_MODE_BLOCK"; break;
    case "sync": broadcastMode = "BROADCAST_MODE_SYNC"; break;
    case "async": broadcastMode = "BROADCAST_MODE_ASYNC"; break;
  }

  const resp = await fetch(`${endpoint.rest}cosmos/tx/v1beta1/txs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_bytes: txBytes, mode: broadcastMode }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Broadcast failed (${resp.status}): ${text}` };
  }

  const data = await resp.json();
  const txResponse = data.tx_response || data;

  if (txResponse.code && txResponse.code !== 0) {
    return { error: `Transaction failed with code ${txResponse.code}: ${txResponse.raw_log}` };
  }

  const txHash = txResponse.txhash || "";
  const hashBytes = fromHex(txHash);
  return { result: Array.from(hashBytes) };
}

async function executeSuggestChain(params: { chainInfo: any }): Promise<{ result?: any; error?: string }> {
  const chainInfo = params.chainInfo;
  if (!chainInfo || !chainInfo.chainId) {
    return { error: "Invalid chain info: missing chainId" };
  }
  _suggestedChains.set(chainInfo.chainId, chainInfo);
  await persistSuggestedChain(chainInfo.chainId, chainInfo);
  return { result: true };
}

async function executeSignArbitrary(params: {
  chainId: string;
  signer: string;
  data: string | number[];
}): Promise<{ result?: any; error?: string }> {
  if (!isUnlocked()) return { error: "Wallet is locked" };

  const mnemonic = getMnemonic();
  if (!mnemonic) return { error: "Wallet is locked" };

  const wallet = await getWalletForChain(params.chainId);
  const [account] = await wallet.getAccounts();

  let dataBytes: Uint8Array;
  if (Array.isArray(params.data)) {
    dataBytes = new Uint8Array(params.data);
  } else if (typeof params.data === "string") {
    dataBytes = new TextEncoder().encode(params.data);
  } else {
    return { error: "Invalid data format" };
  }

  const signDoc = {
    chain_id: "",
    account_number: "0",
    sequence: "0",
    fee: { gas: "0", amount: [] },
    msgs: [
      {
        type: "sign/MsgSignData",
        value: {
          signer: params.signer,
          data: toBase64(dataBytes),
        },
      },
    ],
    memo: "",
  };

  const serialized = serializeSignDoc(signDoc);
  const hash = sha256(serialized);

  const privKey = await derivePrivateKeyBytes(mnemonic, params.chainId);
  const signature = await Secp256k1.createSignature(hash, privKey);
  const signatureBytes = new Uint8Array([...signature.r(32), ...signature.s(32)]);

  return {
    result: {
      pub_key: {
        type: "tendermint/PubKeySecp256k1",
        value: toBase64(account.pubkey),
      },
      signature: toBase64(signatureBytes),
    },
  };
}

// ------------------------------------------------------------------
//  Test helpers
// ------------------------------------------------------------------

/**
 * Test-only: reset every piece of anti-spam state (approval queues,
 * pending-request map, rate-limit log, unlock popup tracking).
 *
 * Never call this in production — it will strand any in-flight approval
 * promises. Production lifetime of this state is tied to the service
 * worker; a SW restart naturally resets everything.
 */
export function __resetAntiSpamStateForTests(): void {
  _approvalQueues.clear();
  _pendingRequests.clear();
  _unlockWaiters.clear();
  _unlockWindowId = null;
  _unlockWindowCreating = false;
  _requestLog.clear();
}

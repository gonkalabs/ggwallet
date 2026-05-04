/**
 * rpc.gonka.gg auto-issued API key lifecycle.
 *
 * The wallet mints a per-install `wallet-install` tier API key against
 * rpc.gonka.gg the first time the service worker wakes up and finds none
 * in storage (`chrome.runtime.onInstalled` and SW cold-start both reach
 * here via {@link ensureAutoApiKey}).
 *
 * Issuance flow per the server contract (`WALLET_KEYS.md`):
 *   1.  POST /v1/keys/issue with {client, version, installId}.
 *   2.  Server replies 401 with `Challenge-Required: pow,difficulty=20`.
 *   3.  Client solves PoW: find nonce_hex such that
 *       `sha256(installId + ":" + nonce_hex)` has `difficulty` leading
 *       zero bits (run sync via @noble/hashes; ~1–3 s on a normal CPU).
 *   4.  POST /v1/keys/issue again with `pow: nonce_hex`.
 *   5.  Server replies 200 with the apiKey + quota.
 *   6.  Wallet immediately calls GET /v1/keys/info to consume the
 *       soft `/24` binding window so the key roams afterwards.
 *
 * 401 on an already-issued key triggers a silent rotate
 * ({@link rotateAutoKey}); a rotate that also 401s falls through to
 * a fresh issue.
 *
 * All HTTP exchanges with rpc.gonka.gg admin endpoints go through
 * {@link gonkaAdminFetch} so X-RateLimit-* headers feed the local
 * usage snapshot consumed by Settings + the near-limit UX.
 */

import { sha256 } from "@noble/hashes/sha256";
import {
  storageGet,
  storageSet,
  storageRemove,
  KEYS,
  type GonkaRpcAutoMeta,
  type GonkaRpcUsage,
} from "@/lib/storage";
import { GONKA_RPC_BASE_URL } from "@/lib/rpc";

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export interface IssueResponse {
  apiKey: string;
  tier: string;
  quota: { perMinute: number; perDay: number };
  issuedAt: string;
  expiresAt: string | null;
}

export interface KeyInfoResponse {
  tier: string;
  quota: { perMinute: number; perDay: number };
  usage: { lastMinute: number; today: number };
  issuedAt: string;
  lastSeen: string;
}

export interface AutoKeyState {
  apiKey: string | null;
  meta: GonkaRpcAutoMeta | null;
  usage: GonkaRpcUsage | null;
  installId: string;
}

// ---------------------------------------------------------------------------
//  Storage helpers (auto key state)
// ---------------------------------------------------------------------------

/** Read the auto-issued key, or null when none exists. */
export async function getAutoApiKey(): Promise<string | null> {
  try {
    const k = await storageGet<string>(KEYS.GONKA_RPC_API_KEY_AUTO);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

export async function getAutoMeta(): Promise<GonkaRpcAutoMeta | null> {
  return (await storageGet<GonkaRpcAutoMeta>(KEYS.GONKA_RPC_AUTO_META)) || null;
}

export async function getAutoUsage(): Promise<GonkaRpcUsage | null> {
  return (await storageGet<GonkaRpcUsage>(KEYS.GONKA_RPC_USAGE)) || null;
}

async function setAutoKeyState(apiKey: string, meta: GonkaRpcAutoMeta): Promise<void> {
  await storageSet({
    [KEYS.GONKA_RPC_API_KEY_AUTO]: apiKey,
    [KEYS.GONKA_RPC_AUTO_META]: meta,
  });
}

async function clearAutoKeyState(): Promise<void> {
  await storageRemove([
    KEYS.GONKA_RPC_API_KEY_AUTO,
    KEYS.GONKA_RPC_AUTO_META,
    KEYS.GONKA_RPC_USAGE,
    KEYS.GONKA_RPC_LAST_NEAR_LIMIT_NOTICE,
  ]);
}

/**
 * Return the stable per-install UUID, generating + persisting it on first
 * call. Used as the `installId` in /v1/keys/issue.
 */
export async function getInstallId(): Promise<string> {
  const existing = await storageGet<string>(KEYS.GONKA_RPC_INSTALL_ID);
  if (existing && existing.trim()) return existing.trim();
  const id = generateUuid();
  await storageSet({ [KEYS.GONKA_RPC_INSTALL_ID]: id });
  return id;
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish v4 fallback. crypto.randomUUID is available everywhere we
  // care about, but the SW runtime occasionally lags on older Chrome.
  const buf = new Uint8Array(16);
  (globalThis as any).crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
//  Proof of Work
//
//  sha256(installId + ":" + nonce_hex) with `difficulty` leading zero bits.
//  Nonce is a non-negative integer rendered in lowercase hex without
//  leading zeros (matches the reference solver in WALLET_KEYS.md).
// ---------------------------------------------------------------------------

/**
 * Solve the PoW puzzle for the given installId at the given difficulty.
 * Synchronous; runs in the service worker so blocking the JS thread for
 * ~1–3 s is fine (no UI to freeze).
 *
 * `maxIterations` is a safety net — the difficulty-20 default expects
 * ~1 M attempts on average; 16 M caps the worst-case to a few seconds.
 */
export function solvePow(
  installId: string,
  difficulty: number,
  maxIterations = 16_000_000,
): string {
  if (difficulty <= 0) return "0";
  const enc = new TextEncoder();
  const prefix = `${installId}:`;
  for (let n = 0; n < maxIterations; n++) {
    const nonce = n.toString(16);
    const h = sha256(enc.encode(prefix + nonce));
    if (hasLeadingZeroBits(h, difficulty)) return nonce;
  }
  throw new Error(`PoW unsolved in ${maxIterations} iterations (difficulty=${difficulty})`);
}

function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  const fullBytes = bits >> 3;
  const remBits = bits & 7;
  for (let i = 0; i < fullBytes; i++) if (hash[i] !== 0) return false;
  if (remBits === 0) return true;
  return (hash[fullBytes] >> (8 - remBits)) === 0;
}

// ---------------------------------------------------------------------------
//  Header parsing — turns X-RateLimit-* response headers into a
//  GonkaRpcUsage snapshot we persist for the UI.
// ---------------------------------------------------------------------------

/**
 * Parse `X-RateLimit-*` headers from a response. Returns null when the
 * minimum set of headers isn't present (e.g. hitting a public RPC, or the
 * response was a plain `Challenge-Required: pow` reply with no quota).
 */
export function parseRateLimitHeaders(headers: Headers): GonkaRpcUsage | null {
  const tier = headers.get("X-RateLimit-Tier");
  const limitDay = headers.get("X-RateLimit-Limit-Day");
  const remainingDay = headers.get("X-RateLimit-Remaining-Day");
  const limitMinute = headers.get("X-RateLimit-Limit-Minute");
  const remainingMinute = headers.get("X-RateLimit-Remaining-Minute");
  const resetAt = headers.get("X-RateLimit-Reset-At");
  if (
    !tier ||
    limitDay == null ||
    remainingDay == null ||
    limitMinute == null ||
    remainingMinute == null
  ) {
    return null;
  }
  return {
    tier,
    limitDay: Number(limitDay),
    remainingDay: Number(remainingDay),
    limitMinute: Number(limitMinute),
    remainingMinute: Number(remainingMinute),
    resetAt: resetAt || "",
    observedAt: new Date().toISOString(),
  };
}

/** Persist a fresh usage snapshot if the response carried one. */
export async function captureUsageFromHeaders(headers: Headers): Promise<void> {
  const u = parseRateLimitHeaders(headers);
  if (!u) return;
  await storageSet({ [KEYS.GONKA_RPC_USAGE]: u });
}

// ---------------------------------------------------------------------------
//  Admin fetch — wraps fetch() for /v1/keys/* calls.
//  Captures rate-limit headers but DOES NOT auto-rotate (we'd recurse).
// ---------------------------------------------------------------------------

async function gonkaAdminFetch(
  path: string,
  init: RequestInit & { apiKey?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.apiKey) headers.set("X-Api-Key", init.apiKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(`${GONKA_RPC_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  // Best-effort header capture; ignore errors (e.g. storage unavailable in tests).
  captureUsageFromHeaders(resp.headers).catch(() => {});
  return resp;
}

// ---------------------------------------------------------------------------
//  Issuance
// ---------------------------------------------------------------------------

/**
 * The version we declare to the server. Read from package.json at build
 * time so it stays in sync with the manifest.
 */
const CLIENT_NAME = "gg-wallet";
const CLIENT_VERSION = "0.1.9";

/**
 * Issue a fresh `wallet-install` API key for this install. Performs PoW
 * if the server demands it, then immediately calls `/v1/keys/info` to
 * consume the soft `/24` binding window.
 */
export async function issueAutoKey(): Promise<IssueResponse> {
  const installId = await getInstallId();

  // First attempt — no PoW. Most likely 401 with the challenge.
  let resp = await gonkaAdminFetch("/v1/keys/issue", {
    method: "POST",
    body: JSON.stringify({ client: CLIENT_NAME, version: CLIENT_VERSION, installId }),
  });

  if (resp.status === 401) {
    let difficulty = 20;
    try {
      const challenge = await resp.clone().json();
      if (typeof challenge?.difficulty === "number") difficulty = challenge.difficulty;
    } catch {
      // Fall through with default difficulty.
    }
    const pow = solvePow(installId, difficulty);
    resp = await gonkaAdminFetch("/v1/keys/issue", {
      method: "POST",
      body: JSON.stringify({ client: CLIENT_NAME, version: CLIENT_VERSION, installId, pow }),
    });
  }

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {}
    throw new Error(`rpc.gonka.gg issue failed (${resp.status}): ${detail}`);
  }

  const data = (await resp.json()) as IssueResponse;
  if (!data.apiKey || !data.tier) {
    throw new Error("rpc.gonka.gg issue: malformed response");
  }

  const meta: GonkaRpcAutoMeta = {
    installId,
    tier: data.tier,
    quotaPerMinute: data.quota.perMinute,
    quotaPerDay: data.quota.perDay,
    issuedAt: data.issuedAt,
    lastRefreshedAt: new Date().toISOString(),
  };
  await setAutoKeyState(data.apiKey, meta);

  // Bind by making an authenticated call; do this best-effort. If it
  // fails (network blip), the next real RPC call will still bind within
  // the 1 h window.
  try {
    await getKeyInfo(data.apiKey);
  } catch {
    /* noop */
  }

  return data;
}

/**
 * Rotate the current auto key. Skips PoW (the caller is already
 * authenticated). On 401 (e.g. server rotated us out from under), falls
 * through to a fresh issue.
 */
export async function rotateAutoKey(): Promise<IssueResponse> {
  const current = await getAutoApiKey();
  if (!current) return issueAutoKey();

  const resp = await gonkaAdminFetch("/v1/keys/rotate", {
    method: "POST",
    apiKey: current,
  });

  if (resp.status === 401 || resp.status === 403) {
    await clearAutoKeyState();
    return issueAutoKey();
  }
  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {}
    throw new Error(`rpc.gonka.gg rotate failed (${resp.status}): ${detail}`);
  }

  const data = (await resp.json()) as IssueResponse;
  const installId = await getInstallId();
  const meta: GonkaRpcAutoMeta = {
    installId,
    tier: data.tier,
    quotaPerMinute: data.quota.perMinute,
    quotaPerDay: data.quota.perDay,
    issuedAt: data.issuedAt,
    lastRefreshedAt: new Date().toISOString(),
  };
  await setAutoKeyState(data.apiKey, meta);
  return data;
}

/** DELETE /v1/keys/current — burns the key server-side and clears local state. */
export async function revokeAutoKey(): Promise<void> {
  const current = await getAutoApiKey();
  if (!current) return;
  try {
    await gonkaAdminFetch("/v1/keys/current", {
      method: "DELETE",
      apiKey: current,
    });
  } catch {
    // Even if the server call fails, drop local state — the user wants it gone.
  }
  await clearAutoKeyState();
}

/**
 * GET /v1/keys/info. Used to populate Settings on open and to prime the
 * /24 binding right after issuance.
 */
export async function getKeyInfo(apiKeyOverride?: string): Promise<KeyInfoResponse | null> {
  const key = apiKeyOverride || (await getAutoApiKey());
  if (!key) return null;
  const resp = await gonkaAdminFetch("/v1/keys/info", { apiKey: key });
  if (resp.status === 401) {
    // Silently rotate, then retry once.
    await rotateAutoKey().catch(() => {});
    const next = await getAutoApiKey();
    if (!next) return null;
    const retry = await gonkaAdminFetch("/v1/keys/info", { apiKey: next });
    if (!retry.ok) return null;
    return (await retry.json()) as KeyInfoResponse;
  }
  if (!resp.ok) return null;
  return (await resp.json()) as KeyInfoResponse;
}

// ---------------------------------------------------------------------------
//  Idempotent ensure
//
//  Multiple call sites (chrome.runtime.onInstalled + SW cold-start +
//  Settings refresh button) can race. We serialise via an in-memory
//  promise — the SW process is single-threaded, so this is enough.
// ---------------------------------------------------------------------------

let _ensureInFlight: Promise<string | null> | null = null;

export async function ensureAutoApiKey(): Promise<string | null> {
  if (_ensureInFlight) return _ensureInFlight;
  _ensureInFlight = (async () => {
    try {
      const existing = await getAutoApiKey();
      if (existing) return existing;
      const issued = await issueAutoKey();
      return issued.apiKey;
    } catch (err) {
      console.warn("[GG Wallet] ensureAutoApiKey failed:", err);
      return null;
    } finally {
      _ensureInFlight = null;
    }
  })();
  return _ensureInFlight;
}

// ---------------------------------------------------------------------------
//  Aggregate state — used by the popup to render Settings without three
//  round trips.
// ---------------------------------------------------------------------------

export async function getAutoKeyState(): Promise<AutoKeyState> {
  const [apiKey, meta, usage, installId] = await Promise.all([
    getAutoApiKey(),
    getAutoMeta(),
    getAutoUsage(),
    getInstallId(),
  ]);
  return { apiKey, meta, usage, installId };
}

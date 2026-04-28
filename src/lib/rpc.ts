/**
 * RPC endpoint configuration.
 *
 * Default behaviour: rpc.gonka.gg (with the auto-issued or manual API
 * key) is preferred whenever a key is available. Public node1/node2
 * are an explicit opt-in via {@link setActiveProvider}.
 *
 * Override precedence in {@link getActiveEndpoint}:
 *
 *   1. Provider preference = "public" (set by user in Settings or by the
 *      429 modal's "Use public RPC" CTA) → use the saved public endpoint.
 *   2. Effective API key (manual ?? auto) present → rpc.gonka.gg.
 *   3. Manually-saved custom endpoint.
 *   4. First public KNOWN_ENDPOINTS entry (final fallback when issuance
 *      failed and the user has never picked anything else).
 */

import {
  storageGet,
  storageSet,
  storageRemove,
  KEYS,
  type GonkaRpcProviderPref,
} from "@/lib/storage";

export interface RpcEndpoint {
  label: string;
  rpc: string;
  rest: string;
  /** True when this endpoint is the rpc.gonka.gg override driven by the API key. */
  isGonkaRpc?: boolean;
}

/** Known public Gonka endpoints. Used as fallback / opt-out destinations. */
export const KNOWN_ENDPOINTS: RpcEndpoint[] = [
  {
    label: "Node 1 (gonka.ai)",
    rpc: "http://node1.gonka.ai:8000/chain-rpc/",
    rest: "http://node1.gonka.ai:8000/chain-api/",
  },
  {
    label: "Node 2 (gonka.ai)",
    rpc: "http://node2.gonka.ai:8000/chain-rpc/",
    rest: "http://node2.gonka.ai:8000/chain-api/",
  },
];

const STORAGE_KEY_RPC = "gg_rpc_endpoint";

/** Base host for the managed Gonka RPC gateway. */
export const GONKA_RPC_BASE_URL = "https://rpc.gonka.gg";
/** Public landing page where users can acquire a paid API key. */
export const GONKA_RPC_SIGNUP_URL = "https://rpc.gonka.gg";

/**
 * Build the rpc.gonka.gg endpoint with the API key embedded in the URL path.
 * We use the path-based auth (Option 2 in the docs) because the wallet's
 * fetch / CosmJS paths don't attach custom headers today.
 */
export function buildGonkaRpcEndpoint(apiKey: string): RpcEndpoint {
  const key = apiKey.trim();
  return {
    label: "rpc.gonka.gg",
    rpc: `${GONKA_RPC_BASE_URL}/key/${key}/chain-rpc/`,
    rest: `${GONKA_RPC_BASE_URL}/key/${key}/chain-api/`,
    isGonkaRpc: true,
  };
}

/** First public endpoint — used as the safety-net fallback. */
export function getDefaultPublicEndpoint(): RpcEndpoint {
  return KNOWN_ENDPOINTS[0];
}

// ---------------------------------------------------------------------------
//  Manual API key (user-pasted, power-user override)
// ---------------------------------------------------------------------------

/** Read the manually-pasted rpc.gonka.gg API key, or null. */
export async function getGonkaRpcApiKey(): Promise<string | null> {
  try {
    const key = await storageGet<string>(KEYS.GONKA_RPC_API_KEY);
    return key && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

/** Persist or clear the manually-pasted API key. Pass null/"" to clear. */
export async function setGonkaRpcApiKey(key: string | null): Promise<void> {
  if (!key || !key.trim()) {
    await storageRemove(KEYS.GONKA_RPC_API_KEY);
    return;
  }
  await storageSet({ [KEYS.GONKA_RPC_API_KEY]: key.trim() });
}

// ---------------------------------------------------------------------------
//  Effective key (manual ?? auto-issued)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective API key for rpc.gonka.gg. Manual paste wins so
 * users with a paid tier always use their key; otherwise the auto-issued
 * `wallet-install` key is used. Returns null when neither is present.
 *
 * Lazy import on the auto-key service avoids a circular dependency
 * (gonka-key-service imports GONKA_RPC_BASE_URL from this file).
 */
export async function getEffectiveApiKey(): Promise<string | null> {
  const manual = await getGonkaRpcApiKey();
  if (manual) return manual;
  const { getAutoApiKey } = await import("@/lib/gonka-key-service");
  return getAutoApiKey();
}

// ---------------------------------------------------------------------------
//  Provider preference — "gonka" by default, "public" only on explicit
//  opt-out (Settings toggle or the 429 modal's session-only switch).
// ---------------------------------------------------------------------------

export async function getActiveProvider(): Promise<GonkaRpcProviderPref> {
  const pref = await storageGet<GonkaRpcProviderPref>(KEYS.GONKA_RPC_PROVIDER_PREF);
  return pref === "public" ? "public" : "gonka";
}

export async function setActiveProvider(pref: GonkaRpcProviderPref): Promise<void> {
  if (pref === "gonka") {
    await storageRemove(KEYS.GONKA_RPC_PROVIDER_PREF);
    return;
  }
  await storageSet({ [KEYS.GONKA_RPC_PROVIDER_PREF]: pref });
}

// ---------------------------------------------------------------------------
//  Saved public endpoint — preserved for the "use public RPC" path so
//  switching to public + back to gonka doesn't lose the user's last
//  picked node. Defaults to KNOWN_ENDPOINTS[0].
// ---------------------------------------------------------------------------

/** Persist a public-endpoint pick. Used by the Settings RPC list. */
export async function setActiveEndpoint(ep: RpcEndpoint): Promise<void> {
  await storageSet({ [STORAGE_KEY_RPC]: ep });
}

async function getSavedPublicEndpoint(): Promise<RpcEndpoint> {
  const saved = await storageGet<RpcEndpoint>(STORAGE_KEY_RPC);
  if (saved && saved.rpc && saved.rest && !saved.isGonkaRpc) return saved;
  return getDefaultPublicEndpoint();
}

// ---------------------------------------------------------------------------
//  Active endpoint resolver
// ---------------------------------------------------------------------------

export async function getActiveEndpoint(): Promise<RpcEndpoint> {
  const provider = await getActiveProvider();
  if (provider === "public") {
    return getSavedPublicEndpoint();
  }
  // Default: gonka.gg if we have any key.
  const key = await getEffectiveApiKey();
  if (key) return buildGonkaRpcEndpoint(key);
  // No key yet — first SW wake on a fresh install before issuance has
  // completed. Fall through to public so the wallet still works.
  return getSavedPublicEndpoint();
}

// ---------------------------------------------------------------------------
//  Deprecated alias — kept so existing imports of getDefaultEndpoint()
//  continue to work. Returns the current effective endpoint.
// ---------------------------------------------------------------------------

export async function getDefaultEndpoint(): Promise<RpcEndpoint> {
  return getActiveEndpoint();
}

// ---------------------------------------------------------------------------
//  Health check
// ---------------------------------------------------------------------------

export async function pingEndpoint(rpcUrl: string): Promise<number> {
  const start = performance.now();
  try {
    const resp = await fetch(rpcUrl + "status", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return -1;
    return Math.round(performance.now() - start);
  } catch {
    return -1;
  }
}

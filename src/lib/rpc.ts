/**
 * RPC endpoint configuration.
 *
 * Stores the active RPC/REST pair in chrome.storage.local and provides
 * a list of known public endpoints to choose from.
 */

import { storageGet, storageSet, storageRemove, KEYS } from "@/lib/storage";

export interface RpcEndpoint {
  label: string;
  rpc: string;
  rest: string;
  /** True when this endpoint is the rpc.gonka.gg override driven by the API key. */
  isGonkaRpc?: boolean;
}

/** Known public Gonka endpoints. */
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
/** Public landing page where users can acquire an API key. */
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

/** Return the default endpoint. */
export function getDefaultEndpoint(): RpcEndpoint {
  return KNOWN_ENDPOINTS[0];
}

/**
 * Read the stored rpc.gonka.gg API key. Returns null when unset
 * or when chrome.storage isn't available (e.g. in unit tests).
 */
export async function getGonkaRpcApiKey(): Promise<string | null> {
  try {
    const key = await storageGet<string>(KEYS.GONKA_RPC_API_KEY);
    return key && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

/** Persist or clear the rpc.gonka.gg API key. Pass null/"" to clear. */
export async function setGonkaRpcApiKey(key: string | null): Promise<void> {
  if (!key || !key.trim()) {
    await storageRemove(KEYS.GONKA_RPC_API_KEY);
    return;
  }
  await storageSet({ [KEYS.GONKA_RPC_API_KEY]: key.trim() });
}

/**
 * Load the active endpoint. When the rpc.gonka.gg API key is set it
 * takes precedence over whatever the user picked from the endpoint list.
 */
export async function getActiveEndpoint(): Promise<RpcEndpoint> {
  const gonkaKey = await getGonkaRpcApiKey();
  if (gonkaKey) return buildGonkaRpcEndpoint(gonkaKey);
  const saved = await storageGet<RpcEndpoint>(STORAGE_KEY_RPC);
  if (saved && saved.rpc && saved.rest) return saved;
  return getDefaultEndpoint();
}

/** Persist a new active endpoint. Ignored when the gonka.gg key is set. */
export async function setActiveEndpoint(ep: RpcEndpoint): Promise<void> {
  await storageSet({ [STORAGE_KEY_RPC]: ep });
}

/**
 * Ping an RPC endpoint and return latency in ms (or -1 on failure).
 * Uses the Tendermint /status lightweight endpoint.
 */
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

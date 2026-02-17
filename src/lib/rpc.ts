/**
 * RPC endpoint configuration.
 *
 * Stores the active RPC/REST pair in chrome.storage.local and provides
 * a list of known public endpoints to choose from.
 */

import { storageGet, storageSet } from "@/lib/storage";

export interface RpcEndpoint {
  label: string;
  rpc: string;
  rest: string;
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

/** Return the default endpoint. */
export function getDefaultEndpoint(): RpcEndpoint {
  return KNOWN_ENDPOINTS[0];
}

/** Load the saved endpoint (or default). */
export async function getActiveEndpoint(): Promise<RpcEndpoint> {
  const saved = await storageGet<RpcEndpoint>(STORAGE_KEY_RPC);
  if (saved && saved.rpc && saved.rest) return saved;
  return getDefaultEndpoint();
}

/** Persist a new active endpoint. */
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

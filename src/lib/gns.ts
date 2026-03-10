import { getActiveEndpoint } from "./rpc";
import { GNS_CONTRACT_ADDRESS, GNS_SUFFIX } from "./gonka";

interface GnsRecord {
  address: string;
  owner: string;
  expires_at: number;
  sale_price: string | null;
}

interface GnsResolveResponse {
  full_name: string;
  record: GnsRecord;
}

interface GnsReverseResponse {
  name: string | null;
}

/** Returns true if the input looks like a .gnk name */
export function isGnsName(input: string): boolean {
  return input.trim().endsWith(GNS_SUFFIX);
}

/** Strips suffix if present, lowercases */
export function normalizeName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.endsWith(GNS_SUFFIX)
    ? trimmed.slice(0, -GNS_SUFFIX.length)
    : trimmed;
}

/** Queries the GNS contract via the chain REST API */
async function queryContract<T>(query: object): Promise<T> {
  if (!GNS_CONTRACT_ADDRESS) {
    throw new Error("GNS contract address not configured");
  }
  const { rest } = await getActiveEndpoint();
  const encoded = btoa(JSON.stringify(query));
  const url = `${rest}/cosmwasm/wasm/v1/contract/${GNS_CONTRACT_ADDRESS}/smart/${encoded}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GNS query failed: ${text}`);
  }
  const json = await res.json();
  return json.data as T;
}

/**
 * Resolves a .gnk name to an address.
 * Accepts both "mike" and "mike.gnk".
 * Returns null if not found or expired.
 */
export async function resolveGnsName(name: string): Promise<string | null> {
  if (!GNS_CONTRACT_ADDRESS) return null;
  try {
    const normalized = normalizeName(name);
    const data = await queryContract<GnsResolveResponse>({
      resolve: { name: normalized },
    });
    return data.record.address;
  } catch {
    return null;
  }
}

/**
 * Reverse lookup: address -> primary .gnk name.
 * Returns null if none set.
 */
export async function reverseResolve(address: string): Promise<string | null> {
  if (!GNS_CONTRACT_ADDRESS) return null;
  try {
    const data = await queryContract<GnsReverseResponse>({
      reverse_lookup: { address },
    });
    return data.name ?? null;
  } catch {
    return null;
  }
}

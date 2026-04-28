/**
 * Typed helpers for chrome.storage.local.
 */

const KEYS = {
  /** Array of wallet entries: WalletEntry[] */
  WALLETS: "gg_wallets",
  /** Index of the active wallet */
  ACTIVE_INDEX: "gg_active_index",
  /** Whether any wallet has been set up */
  INITIALIZED: "gg_initialized",
  /** Connected dApp origins: ConnectedSite[] */
  CONNECTED_SITES: "gg_connected_sites",
  /** Auto-lock timeout in minutes (0 = never) */
  AUTO_LOCK_MINUTES: "gg_auto_lock_minutes",
  /** Address book entries: AddressBookEntry[] */
  ADDRESS_BOOK: "gg_address_book",
  /** Suggested chains from dApps: Record<chainId, ChainInfo> */
  SUGGESTED_CHAINS: "gg_suggested_chains",
  /** Manually-pasted rpc.gonka.gg API key (string). Power-user override. */
  GONKA_RPC_API_KEY: "gg_rpc_gonka_gg_api_key",
  /** Auto-issued rpc.gonka.gg API key (string). Per extension install. */
  GONKA_RPC_API_KEY_AUTO: "gg_rpc_gonka_gg_api_key_auto",
  /** Metadata for the auto-issued key: GonkaRpcAutoMeta. */
  GONKA_RPC_AUTO_META: "gg_rpc_gonka_gg_auto_meta",
  /** Stable per-install UUID used as installId in the issuance request. */
  GONKA_RPC_INSTALL_ID: "gg_rpc_gonka_gg_install_id",
  /** Latest rate-limit / quota usage snapshot: GonkaRpcUsage. */
  GONKA_RPC_USAGE: "gg_rpc_gonka_gg_usage",
  /** Date-string (YYYY-MM-DD UTC) of the last shown near-limit banner. */
  GONKA_RPC_LAST_NEAR_LIMIT_NOTICE: "gg_rpc_gonka_gg_last_near_limit",
  /** RPC provider preference: "gonka" (default) | "public" (opt-out). */
  GONKA_RPC_PROVIDER_PREF: "gg_rpc_gonka_gg_provider_pref",

  // --- Legacy single-wallet keys (migration) ---
  ENCRYPTED_MNEMONIC: "gg_encrypted_mnemonic",
  SALT: "gg_salt",
  IV: "gg_iv",
  ADDRESS: "gg_address",
} as const;

/**
 * Metadata about the auto-issued rpc.gonka.gg API key.
 * Stored alongside the key itself so Settings can show tier / age / quota
 * without an extra round trip on first load.
 */
export interface GonkaRpcAutoMeta {
  installId: string;
  tier: string;
  quotaPerMinute: number;
  quotaPerDay: number;
  issuedAt: string;
  /** ISO timestamp of the last successful issuance/rotate. */
  lastRefreshedAt: string;
}

/**
 * Rolling rate-limit snapshot, fed by the X-RateLimit-* response headers
 * that rpc.gonka.gg returns on every authenticated call.
 */
export interface GonkaRpcUsage {
  tier: string;
  /** Requests remaining in the current daily window. */
  remainingDay: number;
  limitDay: number;
  /** Requests remaining in the current minute. */
  remainingMinute: number;
  limitMinute: number;
  /** ISO timestamp at which the day quota resets. */
  resetAt: string;
  /** When this snapshot was captured. */
  observedAt: string;
}

export type GonkaRpcProviderPref = "gonka" | "public";

/**
 * A site that has been approved for provider access.
 */
export interface ConnectedSite {
  /** Origin, e.g. "https://app.example.com" */
  origin: string;
  /** Chain IDs that were enabled */
  chainIds: string[];
  /** Timestamp of first connection (ms) */
  connectedAt: number;
}

/**
 * A single wallet entry stored encrypted.
 * For watch-only wallets, viewOnly is true and ciphertext/salt/iv are empty strings.
 */
export interface WalletEntry {
  name: string;
  address: string;
  ciphertext: string;
  salt: string;
  iv: string;
  viewOnly?: boolean;
}

export interface AddressBookEntry {
  name: string;
  address: string;
  note?: string;
}

export { KEYS };

export async function storageGet<T = any>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

export async function storageSet(items: Record<string, any>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

export async function storageRemove(keys: string | string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

export async function storageClear(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.clear(resolve);
  });
}

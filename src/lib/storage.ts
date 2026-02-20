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

  // --- Legacy single-wallet keys (migration) ---
  ENCRYPTED_MNEMONIC: "gg_encrypted_mnemonic",
  SALT: "gg_salt",
  IV: "gg_iv",
  ADDRESS: "gg_address",
} as const;

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

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
 */
export interface WalletEntry {
  name: string;
  address: string;
  ciphertext: string;
  salt: string;
  iv: string;
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

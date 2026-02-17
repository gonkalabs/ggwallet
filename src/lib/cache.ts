/**
 * Simple cache layer using chrome.storage.local.
 * Each cache entry is keyed by address + purpose.
 */

const CACHE_PREFIX = "gg_cache_";

export interface CacheEntry<T> {
  data: T;
  ts: number; // timestamp of when cached
}

export async function getCache<T>(key: string): Promise<CacheEntry<T> | null> {
  return new Promise((resolve) => {
    const storageKey = CACHE_PREFIX + key;
    chrome.storage.local.get(storageKey, (result) => {
      const entry = result[storageKey] as CacheEntry<T> | undefined;
      resolve(entry ?? null);
    });
  });
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  return new Promise((resolve) => {
    const storageKey = CACHE_PREFIX + key;
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    chrome.storage.local.set({ [storageKey]: entry }, resolve);
  });
}

/** Build a cache key scoped to a specific address */
export function cacheKey(address: string, purpose: string): string {
  // Use last 12 chars of address to keep keys short
  const short = address.slice(-12);
  return `${short}_${purpose}`;
}

/**
 * Keystore: manages multiple encrypted wallets.
 *
 * Storage layout:
 *   gg_wallets:      WalletEntry[]  (each with name, address, ciphertext, salt, iv)
 *   gg_active_index: number         (index into the wallets array)
 *   gg_initialized:  boolean
 *
 * All wallets share the same password (verified against the active wallet).
 * The decrypted mnemonic of the active wallet is held in memory while unlocked.
 */

import { encrypt, decrypt } from "@/lib/crypto";
import { storageGet, storageSet, storageRemove, KEYS, WalletEntry } from "@/lib/storage";
import { deriveAddress, derivePrivateKey } from "@/lib/cosmos";

const DEFAULT_AUTO_LOCK_MINUTES = 5;
let _autoLockMs = DEFAULT_AUTO_LOCK_MINUTES * 60 * 1000;

let _mnemonic: string | null = null;
let _password: string | null = null; // kept to decrypt when switching wallets
let _address: string = "";
let _activeIndex: number = 0;
let _viewOnly: boolean = false;
let _lockTimer: ReturnType<typeof setTimeout> | null = null;

// ------------------------------------------------------------------ //
//  Wallet CRUD
// ------------------------------------------------------------------ //

/**
 * Add (create or import) a new wallet.
 * If this is the first wallet, it becomes the active one automatically.
 * If `password` is omitted, uses the cached password (must be unlocked).
 */
export async function addWallet(
  mnemonic: string,
  password?: string,
  name?: string
): Promise<{ address: string; index: number }> {
  const pwd = password || _password;
  if (!pwd) throw new Error("Wallet is locked — no password available");

  const address = await deriveAddress(mnemonic);
  const { ciphertext, salt, iv } = await encrypt(mnemonic, pwd);

  const wallets = await getWallets();
  const index = wallets.length;

  const entry: WalletEntry = {
    name: name || `Wallet ${index + 1}`,
    address,
    ciphertext,
    salt,
    iv,
  };

  wallets.push(entry);

  await storageSet({
    [KEYS.WALLETS]: wallets,
    [KEYS.ACTIVE_INDEX]: index,
    [KEYS.INITIALIZED]: true,
  });

  // Migrate: remove legacy single-wallet keys if present
  await storageRemove([KEYS.ENCRYPTED_MNEMONIC, KEYS.SALT, KEYS.IV, KEYS.ADDRESS]);

  _mnemonic = mnemonic;
  _password = pwd;
  _address = address;
  _activeIndex = index;
  resetLockTimer();

  return { address, index };
}

/**
 * Add a watch-only wallet (address only, no mnemonic).
 * Can be added while unlocked or without any prior wallet.
 */
export async function addViewOnlyWallet(
  address: string,
  name?: string
): Promise<{ address: string; index: number }> {
  const wallets = await getWallets();
  const index = wallets.length;

  const entry: WalletEntry = {
    name: name || `Watch ${index + 1}`,
    address,
    ciphertext: "",
    salt: "",
    iv: "",
    viewOnly: true,
  };

  wallets.push(entry);

  await storageSet({
    [KEYS.WALLETS]: wallets,
    [KEYS.ACTIVE_INDEX]: index,
    [KEYS.INITIALIZED]: true,
  });

  _mnemonic = null;
  _viewOnly = true;
  _address = address;
  _activeIndex = index;
  resetLockTimer();

  return { address, index };
}

/**
 * Switch to a different wallet by index (must be unlocked or switching to view-only).
 */
export async function switchWallet(index: number): Promise<string> {
  const wallets = await getWallets();
  if (index < 0 || index >= wallets.length) {
    throw new Error(`Invalid wallet index: ${index}`);
  }

  const entry = wallets[index];

  if (entry.viewOnly) {
    _mnemonic = null;
    _viewOnly = true;
  } else {
    if (!_password) throw new Error("Wallet is locked");
    const mnemonic = await decrypt(entry.ciphertext, entry.salt, entry.iv, _password);
    _mnemonic = mnemonic;
    _viewOnly = false;
  }

  _address = entry.address;
  _activeIndex = index;

  await storageSet({ [KEYS.ACTIVE_INDEX]: index });
  resetLockTimer();

  return _address;
}

/**
 * Rename a wallet.
 */
export async function renameWallet(index: number, name: string): Promise<void> {
  const wallets = await getWallets();
  if (index < 0 || index >= wallets.length) throw new Error("Invalid index");
  wallets[index].name = name;
  await storageSet({ [KEYS.WALLETS]: wallets });
}

/**
 * Remove a wallet by index. Cannot remove the last wallet.
 */
export async function removeWallet(index: number): Promise<void> {
  const wallets = await getWallets();
  if (wallets.length <= 1) throw new Error("Cannot remove the last wallet");
  if (index < 0 || index >= wallets.length) throw new Error("Invalid index");

  wallets.splice(index, 1);

  // Adjust active index
  let newActive = _activeIndex;
  if (index === _activeIndex) {
    newActive = 0;
    // Need to switch to wallet 0
    if (_password) {
      const entry = wallets[0];
      _mnemonic = await decrypt(entry.ciphertext, entry.salt, entry.iv, _password);
      _address = entry.address;
    }
  } else if (index < _activeIndex) {
    newActive = _activeIndex - 1;
  }
  _activeIndex = newActive;

  await storageSet({
    [KEYS.WALLETS]: wallets,
    [KEYS.ACTIVE_INDEX]: newActive,
  });
}

// ------------------------------------------------------------------ //
//  Unlock / Lock
// ------------------------------------------------------------------ //

/**
 * Unlock all wallets using the shared password.
 * Decrypts the active wallet's mnemonic into memory.
 * For view-only wallets with no regular wallets, no password is needed.
 */
export async function unlock(password: string): Promise<string> {
  const wallets = await getWallets();
  if (wallets.length === 0) {
    // Try legacy migration
    const migrated = await migrateLegacy(password);
    if (migrated) return migrated;
    throw new Error("No wallet found");
  }

  const activeIdx = (await storageGet<number>(KEYS.ACTIVE_INDEX)) ?? 0;
  const entry = wallets[activeIdx] || wallets[0];

  if (entry.viewOnly) {
    // View-only wallet: verify password against first non-view-only wallet if one exists.
    const regularWallet = wallets.find((w) => !w.viewOnly);
    if (regularWallet) {
      await decrypt(regularWallet.ciphertext, regularWallet.salt, regularWallet.iv, password);
      _password = password;
    }
    _mnemonic = null;
    _viewOnly = true;
  } else {
    const mnemonic = await decrypt(entry.ciphertext, entry.salt, entry.iv, password);
    _mnemonic = mnemonic;
    _password = password;
    _viewOnly = false;
  }

  _address = entry.address;
  _activeIndex = activeIdx;
  resetLockTimer();

  return _address;
}

/**
 * Lock the wallet (clear all in-memory secrets).
 */
export function lock(): void {
  _mnemonic = null;
  _password = null;
  _viewOnly = false;
  clearLockTimer();
}

// ------------------------------------------------------------------ //
//  State queries
// ------------------------------------------------------------------ //

export async function isInitialized(): Promise<boolean> {
  // Check new format
  const flag = await storageGet<boolean>(KEYS.INITIALIZED);
  if (flag) return true;
  // Check legacy format
  const legacy = await storageGet<string>(KEYS.ENCRYPTED_MNEMONIC);
  return !!legacy;
}

export function isUnlocked(): boolean {
  return _mnemonic !== null || _viewOnly;
}

export function isViewOnly(): boolean {
  return _viewOnly;
}

export function getAddress(): string {
  return _address;
}

export function getActiveIndex(): number {
  return _activeIndex;
}

export async function getStoredAddress(): Promise<string> {
  const wallets = await getWallets();
  const idx = (await storageGet<number>(KEYS.ACTIVE_INDEX)) ?? 0;
  return wallets[idx]?.address || wallets[0]?.address || "";
}

export async function getWallets(): Promise<WalletEntry[]> {
  return (await storageGet<WalletEntry[]>(KEYS.WALLETS)) || [];
}

/**
 * Return wallet list with only public info (no ciphertext).
 */
export async function getWalletList(): Promise<
  Array<{ name: string; address: string; index: number }>
> {
  const wallets = await getWallets();
  return wallets.map((w, i) => ({
    name: w.name,
    address: w.address,
    index: i,
  }));
}

export function getMnemonic(): string | null {
  if (_mnemonic) resetLockTimer();
  return _mnemonic;
}

export async function exportPrivateKeyHex(): Promise<string> {
  if (!_mnemonic) throw new Error("Wallet is locked");
  const privkey = await derivePrivateKey(_mnemonic);
  return Array.from(privkey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ------------------------------------------------------------------ //
//  Auto-lock timer
// ------------------------------------------------------------------ //

function resetLockTimer(): void {
  clearLockTimer();
  if (_autoLockMs === 0) return; // "Never" mode
  _lockTimer = setTimeout(() => lock(), _autoLockMs);
}

/** Load saved auto-lock setting from storage (called once on background start). */
export async function loadSettings(): Promise<void> {
  const minutes = await storageGet<number>(KEYS.AUTO_LOCK_MINUTES);
  if (minutes !== undefined && minutes !== null) {
    _autoLockMs = minutes === 0 ? 0 : minutes * 60 * 1000;
  }
}

export function getAutoLockMinutes(): number {
  return _autoLockMs === 0 ? 0 : Math.round(_autoLockMs / 60_000);
}

export async function setAutoLockTimeout(minutes: number): Promise<void> {
  _autoLockMs = minutes === 0 ? 0 : minutes * 60 * 1000;
  await storageSet({ [KEYS.AUTO_LOCK_MINUTES]: minutes });
  if (_mnemonic !== null || _viewOnly) resetLockTimer();
}

function clearLockTimer(): void {
  if (_lockTimer) {
    clearTimeout(_lockTimer);
    _lockTimer = null;
  }
}

export function touchActivity(): void {
  if (_mnemonic) {
    resetLockTimer();
  }
}

// ------------------------------------------------------------------ //
//  Legacy migration (single-wallet -> multi-wallet)
// ------------------------------------------------------------------ //

async function migrateLegacy(password: string): Promise<string | null> {
  const ciphertext = await storageGet<string>(KEYS.ENCRYPTED_MNEMONIC);
  const salt = await storageGet<string>(KEYS.SALT);
  const iv = await storageGet<string>(KEYS.IV);
  const address = await storageGet<string>(KEYS.ADDRESS);

  if (!ciphertext || !salt || !iv) return null;

  // Verify password
  const mnemonic = await decrypt(ciphertext, salt, iv, password);

  // Migrate to new format
  const entry: WalletEntry = {
    name: "Wallet 1",
    address: address || (await deriveAddress(mnemonic)),
    ciphertext,
    salt,
    iv,
  };

  await storageSet({
    [KEYS.WALLETS]: [entry],
    [KEYS.ACTIVE_INDEX]: 0,
    [KEYS.INITIALIZED]: true,
  });

  // Clean up legacy keys
  await storageRemove([KEYS.ENCRYPTED_MNEMONIC, KEYS.SALT, KEYS.IV, KEYS.ADDRESS]);

  _mnemonic = mnemonic;
  _password = password;
  _address = entry.address;
  _activeIndex = 0;
  resetLockTimer();

  return _address;
}

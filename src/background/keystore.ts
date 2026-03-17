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

const DEFAULT_AUTO_LOCK_MINUTES = 0; // Default: never auto-lock while open
let _autoLockMs = DEFAULT_AUTO_LOCK_MINUTES * 60 * 1000;

let _mnemonic: string | null = null;
let _password: string | null = null; // kept to decrypt when switching wallets
let _address: string = "";
let _activeIndex: number = 0;
let _viewOnly: boolean = false;
let _lockTimer: ReturnType<typeof setTimeout> | null = null;

// Track whether any popup/tab of our extension is open
let _popupOpen = false;

// Whether we've attempted to rehydrate from session storage on this SW lifecycle
let _rehydrated = false;

// Key used to persist the lock deadline across service worker restarts
const LOCK_DEADLINE_KEY = "gg_lock_deadline";

// Keys for persisting unlock state across service worker restarts.
// Stored in chrome.storage.session which survives SW restarts but is
// cleared when the browser closes — so secrets never touch disk.
const SESSION_PASSWORD_KEY = "gg_session_pwd";
const SESSION_UNLOCKED_KEY = "gg_session_unlocked";

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
  persistSessionUnlock(pwd);

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

  // Persist unlock state to session storage so we survive SW restarts
  persistSessionUnlock(password);

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
  // Clear all persisted session state
  chrome.storage.session.remove([LOCK_DEADLINE_KEY, SESSION_PASSWORD_KEY, SESSION_UNLOCKED_KEY]).catch(() => {
    chrome.storage.local.remove(LOCK_DEADLINE_KEY).catch(() => {});
  });
}

// ------------------------------------------------------------------ //
//  Session persistence — survive service worker restarts
// ------------------------------------------------------------------ //

function persistSessionUnlock(password: string): void {
  chrome.storage.session.set({
    [SESSION_PASSWORD_KEY]: password,
    [SESSION_UNLOCKED_KEY]: true,
  }).catch(() => {});
}

/**
 * Re-hydrate in-memory state from session storage after a service worker
 * restart. If the wallet was unlocked before the SW was terminated, this
 * re-decrypts the mnemonic so operations continue seamlessly.
 *
 * Called lazily on the first message that needs unlock state.
 */
export async function rehydrateIfNeeded(): Promise<void> {
  if (_rehydrated) return;
  _rehydrated = true;

  // Already unlocked in memory — nothing to do
  if (_mnemonic !== null || _viewOnly) return;

  try {
    const session = await chrome.storage.session.get([SESSION_PASSWORD_KEY, SESSION_UNLOCKED_KEY]);
    if (!session[SESSION_UNLOCKED_KEY]) return;

    const password = session[SESSION_PASSWORD_KEY] as string | undefined;
    if (!password) return;

    const wallets = await getWallets();
    if (wallets.length === 0) return;

    const activeIdx = (await storageGet<number>(KEYS.ACTIVE_INDEX)) ?? 0;
    const entry = wallets[activeIdx] || wallets[0];

    if (entry.viewOnly) {
      _viewOnly = true;
      _mnemonic = null;
      _password = password;
    } else {
      const mnemonic = await decrypt(entry.ciphertext, entry.salt, entry.iv, password);
      _mnemonic = mnemonic;
      _password = password;
      _viewOnly = false;
    }

    _address = entry.address;
    _activeIndex = activeIdx;
  } catch {
    // Decryption failed (session data stale) — stay locked
    chrome.storage.session.remove([SESSION_PASSWORD_KEY, SESSION_UNLOCKED_KEY]).catch(() => {});
  }
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

function persistLockDeadline(deadlineMs: number): void {
  // Prefer session storage (cleared on browser restart); fall back to local
  chrome.storage.session.set({ [LOCK_DEADLINE_KEY]: deadlineMs }).catch(() => {
    chrome.storage.local.set({ [LOCK_DEADLINE_KEY]: deadlineMs }).catch(() => {});
  });
}

function resetLockTimer(): void {
  clearLockTimer();
  if (_autoLockMs === 0) return; // "Never" mode
  if (_popupOpen) return; // Don't start timer while popup is open
  if (_autoLockMs === -1) {
    // "On close" mode — lock immediately (popup just closed)
    lock();
    return;
  }
  const deadline = Date.now() + _autoLockMs;
  persistLockDeadline(deadline);
  _lockTimer = setTimeout(() => lock(), _autoLockMs);
}

/**
 * Called by the chrome.alarms handler every minute.
 * Checks if the persisted deadline has passed and locks if so.
 * This handles the case where the service worker was terminated and
 * the in-memory setTimeout was lost.
 */
export async function checkAlarmLock(): Promise<void> {
  if (!isUnlocked()) return;
  if (_autoLockMs <= 0) return; // 0 = never, -1 = handled by popup close
  if (_popupOpen) return; // Never lock while popup is open

  let deadline: number | undefined;
  try {
    const result = await chrome.storage.session.get(LOCK_DEADLINE_KEY);
    deadline = result[LOCK_DEADLINE_KEY];
  } catch {
    try {
      const result = await chrome.storage.local.get(LOCK_DEADLINE_KEY);
      deadline = result[LOCK_DEADLINE_KEY];
    } catch {
      return;
    }
  }

  if (deadline !== undefined && Date.now() >= deadline) {
    lock();
  }
}

/** Load saved auto-lock setting from storage (called once on background start). */
export async function loadSettings(): Promise<void> {
  const minutes = await storageGet<number>(KEYS.AUTO_LOCK_MINUTES);
  if (minutes !== undefined && minutes !== null) {
    _autoLockMs = minutes <= 0 ? minutes : minutes * 60 * 1000;
  }
}

export function getAutoLockMinutes(): number {
  if (_autoLockMs <= 0) return _autoLockMs; // 0 = never, -1 = on close
  return Math.round(_autoLockMs / 60_000);
}

export async function setAutoLockTimeout(minutes: number): Promise<void> {
  // -1 = lock immediately on popup close, 0 = never, >0 = minutes after close
  _autoLockMs = minutes <= 0 ? minutes : minutes * 60 * 1000;
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
//  Popup lifecycle tracking
// ------------------------------------------------------------------ //

/**
 * Called when a popup/extension window opens.
 * Pauses the auto-lock timer while the UI is visible.
 */
export function notifyPopupOpen(): void {
  _popupOpen = true;
  clearLockTimer();
  // Clear persisted deadline so alarm handler doesn't lock while open
  chrome.storage.session.remove(LOCK_DEADLINE_KEY).catch(() => {
    chrome.storage.local.remove(LOCK_DEADLINE_KEY).catch(() => {});
  });
}

/**
 * Called when the last popup/extension window closes.
 * Restarts the auto-lock timer.
 */
export function notifyPopupClosed(): void {
  _popupOpen = false;
  if (isUnlocked()) {
    resetLockTimer();
  }
}

export function isPopupOpen(): boolean {
  return _popupOpen;
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
  persistSessionUnlock(password);

  return _address;
}

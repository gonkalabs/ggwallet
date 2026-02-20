import { create } from "zustand";
import { sendMessage } from "@/lib/messaging";
import type { TokenBalance } from "@/lib/cosmos";

export interface WalletInfo {
  name: string;
  address: string;
  index: number;
}

interface WalletState {
  isInitialized: boolean;
  isUnlocked: boolean;
  isViewOnly: boolean;
  address: string;
  balance: string;
  tokenBalances: TokenBalance[];
  mnemonic: string | null;
  wallets: WalletInfo[];
  activeIndex: number;

  checkState: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  createWallet: (mnemonic: string, password: string, name?: string) => Promise<boolean>;
  importWallet: (mnemonic: string, password: string, name?: string) => Promise<boolean>;
  addWallet: (mnemonic: string, password: string, name?: string) => Promise<boolean>;
  addViewOnlyWallet: (address: string, name?: string) => Promise<boolean>;
  switchWallet: (index: number) => Promise<boolean>;
  renameWallet: (index: number, name: string) => Promise<void>;
  removeWallet: (index: number) => Promise<boolean>;
  refreshWallets: () => Promise<void>;
  getBalance: () => Promise<void>;
  setMnemonic: (mnemonic: string | null) => void;
  setAddress: (address: string) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  isInitialized: false,
  isUnlocked: false,
  isViewOnly: false,
  address: "",
  balance: "0",
  tokenBalances: [],
  mnemonic: null,
  wallets: [],
  activeIndex: 0,

  checkState: async () => {
    const resp = await sendMessage({ type: "CHECK_STATE" });
    set({
      isInitialized: resp.isInitialized,
      isUnlocked: resp.isUnlocked,
      isViewOnly: resp.isViewOnly ?? false,
      address: resp.address || "",
      wallets: resp.wallets || [],
      activeIndex: resp.activeIndex ?? 0,
    });
  },

  unlock: async (password: string) => {
    const resp = await sendMessage({ type: "UNLOCK", password });
    if (resp.success) {
      set({
        isUnlocked: true,
        isViewOnly: resp.isViewOnly ?? false,
        address: resp.address,
        wallets: resp.wallets || [],
        activeIndex: resp.activeIndex ?? 0,
      });
      return true;
    }
    return false;
  },

  lock: async () => {
    await sendMessage({ type: "LOCK" });
    set({ isUnlocked: false, address: "", balance: "0" });
  },

  createWallet: async (mnemonic, password, name) => {
    const resp = await sendMessage({
      type: "CREATE_WALLET",
      mnemonic,
      password,
      name,
    });
    if (resp.success) {
      set({
        isInitialized: true,
        isUnlocked: true,
        address: resp.address,
        activeIndex: resp.index ?? 0,
        mnemonic: null,
      });
      await get().refreshWallets();
      return true;
    }
    return false;
  },

  importWallet: async (mnemonic, password, name) => {
    const resp = await sendMessage({
      type: "CREATE_WALLET",
      mnemonic,
      password,
      name,
    });
    if (resp.success) {
      set({
        isInitialized: true,
        isUnlocked: true,
        address: resp.address,
        activeIndex: resp.index ?? 0,
        mnemonic: null,
      });
      await get().refreshWallets();
      return true;
    }
    return false;
  },

  addWallet: async (mnemonic, password, name) => {
    const resp = await sendMessage({
      type: "ADD_WALLET",
      mnemonic,
      password,
      name,
    });
    if (resp.success) {
      set({
        address: resp.address,
        activeIndex: resp.index ?? 0,
        balance: "0",
      });
      await get().refreshWallets();
      return true;
    }
    return false;
  },

  addViewOnlyWallet: async (address, name) => {
    const resp = await sendMessage({ type: "ADD_VIEW_ONLY_WALLET", address, name });
    if (resp.success) {
      set({
        address: resp.address,
        activeIndex: resp.index ?? 0,
        balance: "0",
        tokenBalances: [],
        isViewOnly: true,
      });
      await get().refreshWallets();
      return true;
    }
    return false;
  },

  switchWallet: async (index: number) => {
    const resp = await sendMessage({ type: "SWITCH_WALLET", index });
    if (resp.success) {
      set({
        address: resp.address,
        activeIndex: index,
        balance: "0",
        tokenBalances: [],
        isViewOnly: resp.isViewOnly ?? false,
      });
      return true;
    }
    return false;
  },

  renameWallet: async (index: number, name: string) => {
    await sendMessage({ type: "RENAME_WALLET", index, name });
    await get().refreshWallets();
  },

  removeWallet: async (index: number) => {
    const resp = await sendMessage({ type: "REMOVE_WALLET", index });
    if (resp.success) {
      set({
        address: resp.address,
        activeIndex: resp.activeIndex ?? 0,
        balance: "0",
      });
      await get().refreshWallets();
      return true;
    }
    return false;
  },

  refreshWallets: async () => {
    const resp = await sendMessage({ type: "GET_WALLETS" });
    set({
      wallets: resp.wallets || [],
      activeIndex: resp.activeIndex ?? 0,
    });
  },

  getBalance: async () => {
    const resp = await sendMessage({ type: "GET_BALANCE" });
    if (resp.balance !== undefined) {
      set({ balance: resp.balance, tokenBalances: resp.tokenBalances ?? [] });
    }
  },

  setMnemonic: (mnemonic) => set({ mnemonic }),
  setAddress: (address) => set({ address }),
}));

/**
 * Background service worker for Gonka Wallet.
 * Handles all wallet operations via chrome.runtime.onMessage.
 */

import {
  addWallet,
  switchWallet,
  renameWallet,
  removeWallet,
  unlock,
  lock,
  isInitialized,
  isUnlocked,
  getAddress,
  getActiveIndex,
  getStoredAddress,
  getWalletList,
  getMnemonic,
  exportPrivateKeyHex,
  touchActivity,
} from "./keystore";
import { queryBalance, sendTokens, delegateTokens, undelegateTokens, withdrawRewards, resetClient } from "@/lib/cosmos";
import { getActiveEndpoint, setActiveEndpoint, RpcEndpoint } from "@/lib/rpc";
import {
  handleProviderRequest,
  getConnectedSites,
  disconnectSite,
  getPendingRequest,
  approveRequest,
  rejectRequest,
} from "./provider-handler";

// Notify all content scripts about keystore changes (Keplr compatibility).
function broadcastKeystoreChange(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: "KEYSTORE_CHANGED" }).catch(() => {
          // Tab may not have the content script — ignore
        });
      }
    }
  });
}

// Auto-lock alarm
const ALARM_NAME = "gg-wallet-auto-lock";

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    // Keeps service worker alive while wallet is unlocked
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || String(err) }));
  return true;
});

async function handleMessage(msg: any): Promise<any> {
  touchActivity();

  switch (msg.type) {
    // ---- State ----

    case "CHECK_STATE": {
      const initialized = await isInitialized();
      const unlocked = isUnlocked();
      const address = unlocked ? getAddress() : await getStoredAddress();
      const wallets = await getWalletList();
      return {
        isInitialized: initialized,
        isUnlocked: unlocked,
        address,
        wallets,
        activeIndex: unlocked ? getActiveIndex() : 0,
      };
    }

    // ---- Wallet management ----

    case "CREATE_WALLET": {
      try {
        const { address, index } = await addWallet(msg.mnemonic, msg.password, msg.name);
        return { success: true, address, index };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "ADD_WALLET": {
      // Used when adding a wallet while already unlocked.
      // Password is optional — uses cached password from keystore if omitted.
      try {
        const { address, index } = await addWallet(msg.mnemonic, msg.password || undefined, msg.name);
        return { success: true, address, index };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "VERIFY_PASSWORD": {
      try {
        await unlock(msg.password);
        return { success: true };
      } catch {
        return { success: false };
      }
    }

    case "SWITCH_WALLET": {
      try {
        const address = await switchWallet(msg.index);
        broadcastKeystoreChange();
        return { success: true, address };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "RENAME_WALLET": {
      await renameWallet(msg.index, msg.name);
      return { success: true };
    }

    case "REMOVE_WALLET": {
      try {
        await removeWallet(msg.index);
        const address = getAddress();
        return { success: true, address, activeIndex: getActiveIndex() };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "GET_WALLETS": {
      const wallets = await getWalletList();
      return { wallets, activeIndex: isUnlocked() ? getActiveIndex() : 0 };
    }

    // ---- Auth ----

    case "UNLOCK": {
      try {
        const address = await unlock(msg.password);
        const wallets = await getWalletList();
        broadcastKeystoreChange();
        return { success: true, address, wallets, activeIndex: getActiveIndex() };
      } catch {
        return { success: false, error: "Wrong password" };
      }
    }

    case "LOCK": {
      lock();
      broadcastKeystoreChange();
      return { success: true };
    }

    // ---- Queries ----

    case "GET_BALANCE": {
      const address = getAddress();
      if (!address) return { balance: "0" };
      try {
        const balance = await queryBalance(address);
        return { balance };
      } catch {
        return { balance: "0", error: "Failed to fetch balance" };
      }
    }

    // ---- Transactions ----

    case "SEND_TOKENS": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      const result = await sendTokens(mnemonic, msg.recipient, msg.amount, msg.memo || "");
      return { success: true, ...result };
    }

    case "DELEGATE": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      const result = await delegateTokens(mnemonic, msg.validator, msg.amount);
      return { success: true, ...result };
    }

    case "UNDELEGATE": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      const result = await undelegateTokens(mnemonic, msg.validator, msg.amount);
      return { success: true, ...result };
    }

    case "WITHDRAW_REWARDS": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      const result = await withdrawRewards(mnemonic, msg.validators);
      return { success: true, ...result };
    }

    // ---- Export ----

    case "EXPORT_PRIVATE_KEY": {
      try {
        const hex = await exportPrivateKeyHex();
        return { success: true, privateKey: hex };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "GET_MNEMONIC": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      return { success: true, mnemonic };
    }

    // ---- RPC ----

    case "GET_RPC_ENDPOINT": {
      const endpoint = await getActiveEndpoint();
      return { endpoint };
    }

    case "SET_RPC_ENDPOINT": {
      const ep: RpcEndpoint = msg.endpoint;
      await setActiveEndpoint(ep);
      resetClient();
      return { success: true };
    }

    // ---- Provider (Keplr-compatible API for dApps) ----

    case "PROVIDER_REQUEST": {
      const result = await handleProviderRequest(msg.method, msg.params, msg.origin);
      return result;
    }

    case "GET_CONNECTED_SITES": {
      const sites = await getConnectedSites();
      return { sites };
    }

    case "DISCONNECT_SITE": {
      await disconnectSite(msg.origin);
      return { success: true };
    }

    // ---- Approval popup ----

    case "GET_PENDING_REQUEST": {
      const request = getPendingRequest(msg.requestId);
      if (!request) return { error: "Request not found or expired" };
      return { request };
    }

    case "APPROVE_REQUEST": {
      const result = await approveRequest(msg.requestId);
      return result;
    }

    case "REJECT_REQUEST": {
      const result = rejectRequest(msg.requestId);
      return result;
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

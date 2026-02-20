/**
 * Background service worker for Gonka Wallet.
 * Handles all wallet operations via chrome.runtime.onMessage.
 */

import {
  addWallet,
  addViewOnlyWallet,
  switchWallet,
  renameWallet,
  removeWallet,
  unlock,
  lock,
  isInitialized,
  isUnlocked,
  isViewOnly,
  getAddress,
  getActiveIndex,
  getStoredAddress,
  getWalletList,
  getMnemonic,
  exportPrivateKeyHex,
  touchActivity,
  loadSettings,
  getAutoLockMinutes,
  setAutoLockTimeout,
  checkAlarmLock,
} from "./keystore";
import { storageGet, storageSet, KEYS, type AddressBookEntry } from "@/lib/storage";
import {
  queryAllBalances, sendTokens, delegateTokens, undelegateTokens, withdrawRewards, resetClient,
  queryProposals, queryProposal, queryProposalTally, queryVote, voteProposal, submitProposal, depositToProposal,
  type VoteOption,
} from "@/lib/cosmos";
import { getActiveEndpoint, setActiveEndpoint, RpcEndpoint } from "@/lib/rpc";
import {
  handleProviderRequest,
  getConnectedSites,
  disconnectSite,
  getPendingRequest,
  approveRequest,
  rejectRequest,
  notifyUnlocked,
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

// Load persisted settings on startup
loadSettings();

// Auto-lock alarm — fires every minute to check if the lock deadline
// has passed. This is the reliable fallback for when the service worker
// was terminated and the in-memory setTimeout was lost.
const ALARM_NAME = "gg-wallet-auto-lock";

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkAlarmLock().then(() => {
      if (!isUnlocked()) {
        broadcastKeystoreChange();
      }
    });
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
        isViewOnly: isViewOnly(),
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

    case "ADD_VIEW_ONLY_WALLET": {
      try {
        const { address, index } = await addViewOnlyWallet(msg.address, msg.name);
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
        return { success: true, address, isViewOnly: isViewOnly() };
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
        // Resume any dApp requests that were waiting for the wallet to unlock
        notifyUnlocked();
        return { success: true, address, wallets, activeIndex: getActiveIndex(), isViewOnly: isViewOnly() };
      } catch {
        return { success: false, error: "Wrong password" };
      }
    }

    case "GET_UNLOCK_CONTEXT": {
      const result = await chrome.storage.session.get("gg_pending_unlock_context").catch(() => ({} as Record<string, any>));
      return { context: (result as Record<string, any>)["gg_pending_unlock_context"] || null };
    }

    case "LOCK": {
      lock();
      broadcastKeystoreChange();
      return { success: true };
    }

    // ---- Queries ----

    case "GET_BALANCE": {
      const address = getAddress();
      if (!address) return { balance: "0", tokenBalances: [] };
      try {
        const tokenBalances = await queryAllBalances(address);
        const gnk = tokenBalances.find((b) => !b.isIbc);
        return { balance: gnk?.amount ?? "0", tokenBalances };
      } catch {
        return { balance: "0", tokenBalances: [], error: "Failed to fetch balance" };
      }
    }

    // ---- Transactions ----

    case "SEND_TOKENS": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      const result = await sendTokens(mnemonic, msg.recipient, msg.amount, msg.denom, msg.memo || "");
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

    // ---- Auto-lock settings ----

    case "GET_AUTO_LOCK": {
      return { minutes: getAutoLockMinutes() };
    }

    case "SET_AUTO_LOCK": {
      await setAutoLockTimeout(msg.minutes);
      return { success: true };
    }

    // ---- Address book ----

    case "GET_ADDRESS_BOOK": {
      const entries = (await storageGet<AddressBookEntry[]>(KEYS.ADDRESS_BOOK)) || [];
      return { entries };
    }

    case "ADD_ADDRESS_ENTRY": {
      const entries = (await storageGet<AddressBookEntry[]>(KEYS.ADDRESS_BOOK)) || [];
      const exists = entries.findIndex((e) => e.address === msg.entry.address);
      if (exists >= 0) {
        entries[exists] = msg.entry;
      } else {
        entries.push(msg.entry);
      }
      await storageSet({ [KEYS.ADDRESS_BOOK]: entries });
      return { success: true, entries };
    }

    case "REMOVE_ADDRESS_ENTRY": {
      const entries = (await storageGet<AddressBookEntry[]>(KEYS.ADDRESS_BOOK)) || [];
      const filtered = entries.filter((e) => e.address !== msg.address);
      await storageSet({ [KEYS.ADDRESS_BOOK]: filtered });
      return { success: true, entries: filtered };
    }

    // ---- Governance ----

    case "GET_PROPOSALS": {
      try {
        const proposals = await queryProposals();
        return { success: true, proposals };
      } catch (e: any) {
        return { success: false, error: e.message, proposals: [] };
      }
    }

    case "GET_PROPOSAL": {
      try {
        const proposal = await queryProposal(msg.proposalId);
        return { success: true, proposal };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "GET_PROPOSAL_TALLY": {
      try {
        const tally = await queryProposalTally(msg.proposalId);
        return { success: true, tally };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "GET_VOTE": {
      try {
        const address = getAddress();
        if (!address) return { success: false, vote: null };
        const vote = await queryVote(msg.proposalId, address);
        return { success: true, vote };
      } catch {
        return { success: false, vote: null };
      }
    }

    case "VOTE_PROPOSAL": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      try {
        const result = await voteProposal(mnemonic, msg.proposalId, msg.option as VoteOption);
        return { success: true, ...result };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "SUBMIT_PROPOSAL": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      try {
        const result = await submitProposal(mnemonic, msg.title, msg.description, msg.deposit || "0");
        return { success: true, ...result };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    case "DEPOSIT_PROPOSAL": {
      const mnemonic = getMnemonic();
      if (!mnemonic) return { success: false, error: "Wallet is locked" };
      try {
        const result = await depositToProposal(mnemonic, msg.proposalId, msg.amount);
        return { success: true, ...result };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

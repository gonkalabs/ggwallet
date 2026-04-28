import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { truncateAddress } from "@/lib/format";
import { GONKA_CHAIN_ID, GONKA_CHAIN_NAME, GONKA_BECH32_PREFIX } from "@/lib/gonka";
import { KNOWN_ENDPOINTS, pingEndpoint, GONKA_RPC_SIGNUP_URL, type RpcEndpoint } from "@/lib/rpc";
import type {
  ConnectedSite,
  AddressBookEntry,
  GonkaRpcAutoMeta,
  GonkaRpcUsage,
  GonkaRpcProviderPref,
} from "@/lib/storage";
import Layout from "@/popup/components/Layout";
import PasswordInput from "@/popup/components/PasswordInput";
import Spinner from "@/popup/components/Spinner";

type Reveal = null | "mnemonic" | "private-key";

export default function Settings() {
  const navigate = useNavigate();
  const { address, lock, wallets, activeIndex, renameWallet, removeWallet } = useWalletStore();
  const activeWallet = wallets[activeIndex];

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(activeWallet?.name || "");
  const [revealType, setRevealType] = useState<Reveal>(null);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealData, setRevealData] = useState("");
  const [revealError, setRevealError] = useState("");
  const [revealLoading, setRevealLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [comingSoon, setComingSoon] = useState(false);

  // Connected sites
  const [connectedSites, setConnectedSites] = useState<ConnectedSite[]>([]);
  const [sitesModal, setSitesModal] = useState(false);

  // Auto-lock
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(5);
  const [autoLockSaving, setAutoLockSaving] = useState(false);

  // Address book
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>([]);
  const [addrBookModal, setAddrBookModal] = useState(false);
  const [newEntryAddr, setNewEntryAddr] = useState("");
  const [newEntryName, setNewEntryName] = useState("");
  const [newEntryNote, setNewEntryNote] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [addrBookError, setAddrBookError] = useState("");

  // RPC settings
  const [rpcModal, setRpcModal] = useState(false);
  const [activeRpc, setActiveRpc] = useState<RpcEndpoint | null>(null);
  const [pings, setPings] = useState<Record<string, number>>({});
  const [pinging, setPinging] = useState(false);
  const [customRpc, setCustomRpc] = useState("");
  const [customRest, setCustomRest] = useState("");
  const [rpcSaving, setRpcSaving] = useState(false);

  // rpc.gonka.gg — manual API key (power-user override)
  const [gonkaKey, setGonkaKey] = useState<string | null>(null);
  const [gonkaKeyModal, setGonkaKeyModal] = useState(false);
  const [gonkaKeyInput, setGonkaKeyInput] = useState("");
  const [gonkaKeyVisible, setGonkaKeyVisible] = useState(false);
  const [gonkaKeySaving, setGonkaKeySaving] = useState(false);
  const [gonkaKeyError, setGonkaKeyError] = useState("");

  // rpc.gonka.gg — auto-issued key (per-install free tier)
  const [autoKey, setAutoKey] = useState<string | null>(null);
  const [autoMeta, setAutoMeta] = useState<GonkaRpcAutoMeta | null>(null);
  const [autoUsage, setAutoUsage] = useState<GonkaRpcUsage | null>(null);
  const [autoKeyVisible, setAutoKeyVisible] = useState(false);
  const [autoKeyBusy, setAutoKeyBusy] = useState<"" | "issue" | "rotate" | "revoke">("");

  // RPC provider preference: "gonka" (default) | "public" (opt-out)
  const [providerPref, setProviderPref] = useState<GonkaRpcProviderPref>("gonka");

  // Load all settings on mount
  useEffect(() => {
    sendMessage({ type: "GET_RPC_ENDPOINT" }).then((resp) => {
      if (resp.endpoint) setActiveRpc(resp.endpoint);
    });
    sendMessage({ type: "GET_CONNECTED_SITES" }).then((resp) => {
      if (resp.sites) setConnectedSites(resp.sites);
    });
    sendMessage({ type: "GET_AUTO_LOCK" }).then((resp) => {
      if (resp.minutes !== undefined) setAutoLockMinutes(resp.minutes);
    });
    sendMessage({ type: "GET_ADDRESS_BOOK" }).then((resp) => {
      if (resp.entries) setAddressBook(resp.entries);
    });
    sendMessage({ type: "GET_GONKA_RPC_KEY" }).then((resp) => {
      setGonkaKey(resp?.key || null);
    });
    sendMessage({ type: "GET_GONKA_AUTO_KEY_STATE" }).then((resp) => {
      const s = resp?.state;
      if (s) {
        setAutoKey(s.apiKey || null);
        setAutoMeta(s.meta || null);
        setAutoUsage(s.usage || null);
      }
    });
    sendMessage({ type: "GET_RPC_PROVIDER_PREF" }).then((resp) => {
      setProviderPref(resp?.pref === "public" ? "public" : "gonka");
    });
    // Authoritative usage refresh from the server (single round-trip).
    sendMessage({ type: "REFRESH_GONKA_USAGE" }).then((resp) => {
      const s = resp?.state;
      if (s) {
        setAutoKey(s.apiKey || null);
        setAutoMeta(s.meta || null);
        setAutoUsage(s.usage || null);
      }
    });
  }, []);

  const loadAddressBook = useCallback(() => {
    sendMessage({ type: "GET_ADDRESS_BOOK" }).then((resp) => {
      if (resp.entries) setAddressBook(resp.entries);
    });
  }, []);

  const handleSaveAutoLock = async (minutes: number) => {
    setAutoLockSaving(true);
    await sendMessage({ type: "SET_AUTO_LOCK", minutes });
    setAutoLockMinutes(minutes);
    setAutoLockSaving(false);
  };

  const handleAddEntry = async () => {
    setAddrBookError("");
    if (!newEntryAddr.startsWith(GONKA_BECH32_PREFIX) || newEntryAddr.length < 39) {
      setAddrBookError("Invalid Gonka address");
      return;
    }
    if (!newEntryName.trim()) {
      setAddrBookError("Name is required");
      return;
    }
    setAddingEntry(true);
    const entry: AddressBookEntry = {
      name: newEntryName.trim(),
      address: newEntryAddr.trim(),
      note: newEntryNote.trim() || undefined,
    };
    const resp = await sendMessage({ type: "ADD_ADDRESS_ENTRY", entry });
    if (resp.entries) setAddressBook(resp.entries);
    setNewEntryAddr("");
    setNewEntryName("");
    setNewEntryNote("");
    setAddingEntry(false);
  };

  const handleRemoveEntry = async (addr: string) => {
    const resp = await sendMessage({ type: "REMOVE_ADDRESS_ENTRY", address: addr });
    if (resp.entries) setAddressBook(resp.entries);
  };

  const loadConnectedSites = useCallback(() => {
    sendMessage({ type: "GET_CONNECTED_SITES" }).then((resp) => {
      if (resp.sites) setConnectedSites(resp.sites);
    });
  }, []);

  const handleDisconnectSite = async (origin: string) => {
    await sendMessage({ type: "DISCONNECT_SITE", origin });
    loadConnectedSites();
  };

  const runPings = useCallback(async () => {
    setPinging(true);
    const results: Record<string, number> = {};
    await Promise.all(
      KNOWN_ENDPOINTS.map(async (ep) => {
        const ms = await pingEndpoint(ep.rpc);
        results[ep.rpc] = ms;
      })
    );
    setPings(results);
    setPinging(false);
  }, []);

  const selectEndpoint = async (ep: RpcEndpoint) => {
    setRpcSaving(true);
    // Picking a node from the public list implies "use public RPC".
    await sendMessage({ type: "SET_RPC_ENDPOINT", endpoint: ep });
    await sendMessage({ type: "SET_RPC_PROVIDER_PREF", pref: "public" });
    setActiveRpc(ep);
    setProviderPref("public");
    setRpcSaving(false);
  };

  const openGonkaKeyModal = () => {
    setGonkaKeyInput("");
    setGonkaKeyError("");
    setGonkaKeyVisible(false);
    setGonkaKeyModal(true);
  };

  const handleSaveGonkaKey = async () => {
    const trimmed = gonkaKeyInput.trim();
    if (!trimmed) {
      setGonkaKeyError("API key is required");
      return;
    }
    setGonkaKeySaving(true);
    setGonkaKeyError("");
    const resp = await sendMessage({ type: "SET_GONKA_RPC_KEY", key: trimmed });
    setGonkaKeySaving(false);
    if (resp?.success) {
      setGonkaKey(trimmed);
      // Reload active endpoint so the "RPC Endpoint" row reflects the override.
      const rpcResp = await sendMessage({ type: "GET_RPC_ENDPOINT" });
      if (rpcResp?.endpoint) setActiveRpc(rpcResp.endpoint);
      setGonkaKeyModal(false);
      setGonkaKeyInput("");
    } else {
      setGonkaKeyError(resp?.error || "Failed to save API key");
    }
  };

  const handleClearGonkaKey = async () => {
    setGonkaKeySaving(true);
    setGonkaKeyError("");
    const resp = await sendMessage({ type: "SET_GONKA_RPC_KEY", key: null });
    setGonkaKeySaving(false);
    if (resp?.success) {
      setGonkaKey(null);
      const rpcResp = await sendMessage({ type: "GET_RPC_ENDPOINT" });
      if (rpcResp?.endpoint) setActiveRpc(rpcResp.endpoint);
      setGonkaKeyModal(false);
    } else {
      setGonkaKeyError(resp?.error || "Failed to clear API key");
    }
  };

  const maskedKey = (key: string) =>
    key.length <= 10 ? key : `${key.slice(0, 8)}…${key.slice(-4)}`;

  // ----- rpc.gonka.gg auto-key handlers -----------------------------------
  const reloadAutoKeyState = async () => {
    const resp = await sendMessage({ type: "GET_GONKA_AUTO_KEY_STATE" });
    const s = resp?.state;
    if (s) {
      setAutoKey(s.apiKey || null);
      setAutoMeta(s.meta || null);
      setAutoUsage(s.usage || null);
    }
    const epResp = await sendMessage({ type: "GET_RPC_ENDPOINT" });
    if (epResp?.endpoint) setActiveRpc(epResp.endpoint);
  };

  const handleIssueAutoKey = async () => {
    setAutoKeyBusy("issue");
    await sendMessage({ type: "ENSURE_GONKA_AUTO_KEY" });
    await reloadAutoKeyState();
    setAutoKeyBusy("");
  };

  const handleRotateAutoKey = async () => {
    if (!confirm("Rotate the rpc.gonka.gg auto key? The current key will be invalidated.")) return;
    setAutoKeyBusy("rotate");
    await sendMessage({ type: "REFRESH_GONKA_AUTO_KEY" });
    await reloadAutoKeyState();
    setAutoKeyBusy("");
  };

  const handleRevokeAutoKey = async () => {
    if (!confirm("Revoke the rpc.gonka.gg auto key? The wallet will fall back to public RPC until a new key is issued.")) return;
    setAutoKeyBusy("revoke");
    await sendMessage({ type: "REVOKE_GONKA_AUTO_KEY" });
    await reloadAutoKeyState();
    setAutoKeyBusy("");
  };

  const handleSetProviderPref = async (pref: GonkaRpcProviderPref) => {
    await sendMessage({ type: "SET_RPC_PROVIDER_PREF", pref });
    setProviderPref(pref);
    const epResp = await sendMessage({ type: "GET_RPC_ENDPOINT" });
    if (epResp?.endpoint) setActiveRpc(epResp.endpoint);
  };

  // ----- Display helpers --------------------------------------------------
  const effectiveKey: "manual" | "auto" | "none" = gonkaKey
    ? "manual"
    : autoKey
    ? "auto"
    : "none";

  const rpcRowDescription = (() => {
    if (providerPref === "public") {
      return `${activeRpc?.label || "Public RPC"} · public, slower`;
    }
    if (effectiveKey === "manual") return "rpc.gonka.gg · custom key";
    if (effectiveKey === "auto") {
      const tier = autoMeta?.tier || "wallet-install";
      const used = autoUsage ? autoUsage.limitDay - autoUsage.remainingDay : null;
      const limit = autoUsage?.limitDay ?? autoMeta?.quotaPerDay ?? null;
      if (used != null && limit != null) {
        return `rpc.gonka.gg · ${tier} · ${used.toLocaleString()}/${limit.toLocaleString()} today`;
      }
      return `rpc.gonka.gg · ${tier}`;
    }
    return "rpc.gonka.gg · issuing key…";
  })();

  const dayPct =
    autoUsage && autoUsage.limitDay > 0
      ? Math.min(100, Math.round(((autoUsage.limitDay - autoUsage.remainingDay) / autoUsage.limitDay) * 100))
      : 0;
  const minPct =
    autoUsage && autoUsage.limitMinute > 0
      ? Math.min(100, Math.round(((autoUsage.limitMinute - autoUsage.remainingMinute) / autoUsage.limitMinute) * 100))
      : 0;
  const renderBar = (pct: number) => {
    const total = 14;
    const filled = Math.round((pct / 100) * total);
    return "▓".repeat(filled) + "░".repeat(total - filled);
  };

  const handleLock = async () => {
    await lock();
    navigate("/");
  };

  const handleReveal = async () => {
    if (!revealPassword) return;
    setRevealLoading(true);
    setRevealError("");

    try {
      const unlockResp = await sendMessage({ type: "UNLOCK", password: revealPassword });
      if (!unlockResp.success) {
        setRevealError("Wrong password");
        setRevealLoading(false);
        return;
      }

      if (revealType === "mnemonic") {
        const resp = await sendMessage({ type: "GET_MNEMONIC" });
        if (resp.success) {
          setRevealData(resp.mnemonic);
        } else {
          setRevealError(resp.error || "Failed to retrieve mnemonic");
        }
      } else if (revealType === "private-key") {
        const resp = await sendMessage({ type: "EXPORT_PRIVATE_KEY" });
        if (resp.success) {
          setRevealData(resp.privateKey);
        } else {
          setRevealError(resp.error || "Failed to export private key");
        }
      }
    } catch (e: any) {
      setRevealError(e.message || "Failed");
    } finally {
      setRevealLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(revealData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const closeReveal = () => {
    setRevealType(null);
    setRevealPassword("");
    setRevealData("");
    setRevealError("");
    setCopied(false);
  };

  return (
    <Layout title="Settings">
      <div className="px-4 py-3 space-y-4">
        {/* Active wallet */}
        <div className="led-bezel animate-fade-in-up">
          <div className="led-display p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="led-eyebrow">
                <span className="led-eyebrow-dot" />
                Active Wallet
              </span>
              <span className="led-text text-[10px] font-bold text-white/40 tabular-nums">
                {wallets.length} wallet{wallets.length !== 1 ? "s" : ""}
              </span>
            </div>
            {renaming ? (
              <div className="flex gap-2 mb-1">
                <input
                  className="input-field text-sm py-2 flex-1"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim()) {
                      renameWallet(activeIndex, newName.trim());
                      setRenaming(false);
                    }
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
                <button
                  onClick={() => {
                    if (newName.trim()) renameWallet(activeIndex, newName.trim());
                    setRenaming(false);
                  }}
                  className="led-text px-3 py-1.5 text-[10px] font-extrabold bg-white text-surface-950 rounded-xl transition-colors hover:bg-white/90"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNewName(activeWallet?.name || "");
                  setRenaming(true);
                }}
                className="led-title text-base hover:opacity-90 transition-opacity flex items-center gap-1.5"
              >
                {activeWallet?.name || "Wallet"}
                <svg className="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                </svg>
              </button>
            )}
            <div className="led-divider-top mt-3 pt-3 space-y-1">
              <p className="led-text text-[10px] font-bold text-white/45">
                {truncateAddress(address, 14, 10)}
              </p>
              <p className="led-spec text-[10px]">
                {GONKA_CHAIN_NAME} · {GONKA_CHAIN_ID}
              </p>
            </div>
          </div>
        </div>

        {/* Wallets */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Wallets
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Add Wallet"
              description="Create or import another wallet"
              onClick={() => navigate("/add-wallet")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              }
            />
            {wallets.length > 1 && (
              <SettingsRow
                label="Remove This Wallet"
                description={`Remove "${activeWallet?.name}" from the extension`}
                onClick={async () => {
                  if (confirm(`Remove "${activeWallet?.name}"? This cannot be undone unless you have the recovery phrase.`)) {
                    await removeWallet(activeIndex);
                  }
                }}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                }
                danger
              />
            )}
          </div>
        </div>

        {/* Network / RPC */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Network
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="RPC Endpoint"
              description={rpcRowDescription}
              onClick={() => {
                setRpcModal(true);
                runPings();
              }}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A8.966 8.966 0 013 12c0-1.264.26-2.466.732-3.558" />
                </svg>
              }
            />
            <SettingsRow
              label="rpc.gonka.gg Key"
              description={
                gonkaKey
                  ? `Custom key · ${maskedKey(gonkaKey)}`
                  : autoKey
                  ? `Auto · ${autoMeta?.tier || "wallet-install"} · ${
                      autoUsage
                        ? `${(autoUsage.limitDay - autoUsage.remainingDay).toLocaleString()}/${autoUsage.limitDay.toLocaleString()} today`
                        : "free tier"
                    }`
                  : "Issuing free-tier key…"
              }
              onClick={openGonkaKeyModal}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Connected Sites */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Connected Sites
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Manage Connections"
              description={
                connectedSites.length === 0
                  ? "No sites connected"
                  : `${connectedSites.length} site${connectedSites.length !== 1 ? "s" : ""} connected`
              }
              onClick={() => {
                loadConnectedSites();
                setSitesModal(true);
              }}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.9-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.876 8.07" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Address Book */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Address Book
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Saved Addresses"
              description={
                addressBook.length === 0
                  ? "No saved addresses"
                  : `${addressBook.length} address${addressBook.length !== 1 ? "es" : ""} saved`
              }
              onClick={() => {
                loadAddressBook();
                setAddrBookModal(true);
              }}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Auto-Lock */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Auto-Lock
          </h3>
          <div className="card">
            <p className="led-text text-[11px] font-bold text-white/70 mb-1">
              Lock wallet after closing the extension
            </p>
            <p className="led-text text-[10px] font-medium text-white/35 mb-3 normal-case" style={{ textTransform: "none", letterSpacing: "0.01em" }}>
              Wallet never locks while the popup is open. Timer starts when you close it.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Never", value: 0 },
                { label: "On close", value: -1 },
                { label: "1 min", value: 1 },
                { label: "5 min", value: 5 },
                { label: "15 min", value: 15 },
                { label: "30 min", value: 30 },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  disabled={autoLockSaving}
                  onClick={() => handleSaveAutoLock(value)}
                  className={`led-text px-3.5 py-1.5 text-[10px] font-extrabold rounded-md border transition-all duration-200 ${
                    autoLockMinutes === value
                      ? "bg-white text-surface-950 border-white"
                      : "bg-transparent text-white/55 border-white/15 hover:border-white/35 hover:text-white"
                  }`}
                  style={
                    autoLockMinutes === value
                      ? { boxShadow: "0 0 12px -2px rgba(255,255,255,0.4)" }
                      : undefined
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Security */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Security
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Recovery Phrase"
              description="View your 24-word recovery phrase"
              onClick={() => setRevealType("mnemonic")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              }
            />
            <SettingsRow
              label="Export Private Key"
              description="Export hex-encoded private key (for opengnk)"
              onClick={() => setRevealType("private-key")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              }
            />
            <SettingsRow
              label="Lock Wallet"
              description="Lock wallet immediately"
              onClick={handleLock}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              danger
            />
          </div>
        </div>

        {/* GNS Names */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            GNS Names
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Manage .gnk Names"
              description="Transfer, configure, and list your names"
              onClick={() => navigate("/names")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Governance */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Governance
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Proposals"
              description="View, vote, and create governance proposals"
              onClick={() => navigate("/proposals")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Developer */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Developer
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="Run inferenced Command"
              description="Paste any inferenced tx or query command — the wallet handles signing"
              onClick={() => navigate("/run-command")}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Node Operations */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            Node Operations
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0 relative">
            <SettingsRow
              label="Grant ML Ops Permissions"
              description="Authorize an ML key for your inference node"
              onClick={() => {
                setComingSoon(true);
                setTimeout(() => setComingSoon(false), 2500);
              }}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 004.5 8.25v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
              }
            />
            {comingSoon && (
              <div className="absolute inset-x-0 -bottom-9 flex justify-center animate-fade-in-up">
                <span className="led-text text-[10px] font-extrabold text-white/70 bg-led-bg border border-white/15 px-3 py-1.5 rounded-md shadow-card">
                  Coming in a future update
                </span>
              </div>
            )}
          </div>
        </div>

        {/* About */}
        <div>
          <h3 className="led-eyebrow mb-2 ml-1">
            <span className="led-eyebrow-dot" />
            About
          </h3>
          <div className="card space-y-2">
            <p className="led-text text-[12px] font-extrabold text-white led-glow-soft">
              GG Wallet · v0.1.8
            </p>
            <p className="led-text text-[10px] font-medium text-white/55" style={{ letterSpacing: "0.04em" }}>
              Open-source, community wallet for the Gonka.ai blockchain
            </p>
            <div className="flex items-center gap-3 pt-1 led-divider-top mt-2">
              <a
                href="https://gonka.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="led-text text-[10px] font-bold text-white hover:text-white/80 transition-colors mt-2 led-glow-soft"
              >
                gonka.ai →
              </a>
              <span className="text-white/15 mt-2">|</span>
              <a
                href="https://gonkalabs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="led-text text-[10px] font-bold text-white/55 hover:text-white transition-colors mt-2"
              >
                by gonkalabs →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Reveal modal */}
      {revealType && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full led-display border-t border-white/[0.08] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal">
            <div className="flex items-center justify-between">
              <h3 className="led-title text-base">
                {revealType === "mnemonic" ? "Recovery Phrase" : "Private Key"}
              </h3>
              <button
                onClick={closeReveal}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {!revealData ? (
              <>
                <div className="led-panel p-3.5 border-red-500/30">
                  <p className="led-text text-[11px] font-bold text-red-300/90" style={{ letterSpacing: "0.05em" }}>
                    ▲ Warning · Never share your{" "}
                    {revealType === "mnemonic" ? "recovery phrase" : "private key"}{" "}
                    with anyone. Anyone with access can steal your funds.
                  </p>
                </div>

                <PasswordInput
                  label="Enter password to continue"
                  placeholder="Your wallet password"
                  value={revealPassword}
                  onChange={(e) => {
                    setRevealPassword(e.currentTarget.value);
                    setRevealError("");
                  }}
                  autoFocus
                />

                {revealError && (
                  <p className="text-xs text-red-400">{revealError}</p>
                )}

                <button
                  onClick={handleReveal}
                  disabled={revealLoading || !revealPassword}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {revealLoading ? (
                    <>
                      <Spinner size="sm" />
                      Verifying...
                    </>
                  ) : (
                    "Reveal"
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="led-panel p-4">
                  <p
                    className={`text-white led-glow-soft ${
                      revealType === "mnemonic"
                        ? "led-text text-[12px] font-bold leading-relaxed"
                        : "font-mono break-all text-xs"
                    }`}
                    style={revealType === "mnemonic" ? { letterSpacing: "0.06em" } : undefined}
                  >
                    {revealData}
                  </p>
                </div>

                <button
                  onClick={handleCopy}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    "Copy to clipboard"
                  )}
                </button>

                <button onClick={closeReveal} className="btn-primary">
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* RPC modal */}
      {rpcModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full led-display border-t border-white/[0.08] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[85%] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="led-title text-base">RPC Endpoint</h3>
              <button
                onClick={() => setRpcModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-3">
              {/* rpc.gonka.gg — default */}
              {(() => {
                const isActive = providerPref === "gonka";
                const hasKey = !!(gonkaKey || autoKey);
                return (
                  <button
                    onClick={() => handleSetProviderPref("gonka")}
                    disabled={rpcSaving || !hasKey}
                    className={`flex items-center gap-3 w-full p-3 rounded-xl text-left transition-all duration-200 border ${
                      isActive
                        ? "bg-white/[0.06] border-white/30"
                        : "bg-transparent border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                    } ${!hasKey ? "opacity-60" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="led-text text-[12px] font-extrabold text-white truncate">
                          rpc.gonka.gg
                        </p>
                        <span className="led-text text-[9px] font-extrabold text-white/65 border border-white/15 px-1.5 py-0.5 rounded-[3px]">
                          DEFAULT
                        </span>
                        {isActive && (
                          <span className="led-text text-[9px] font-extrabold text-surface-950 bg-white px-1.5 py-0.5 rounded-[3px]" style={{ boxShadow: "0 0 6px rgba(255,255,255,0.4)" }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="led-text text-[10px] font-medium text-white/55 truncate mt-0.5" style={{ letterSpacing: "0.04em" }}>
                        {gonkaKey ? `Custom key · ${maskedKey(gonkaKey)}` :
                         autoKey ? `Auto · ${autoMeta?.tier || "wallet-install"}` :
                         "Issuing free-tier key — retry from rpc.gonka.gg Key card"}
                      </p>
                    </div>
                    <div className="led-text text-[10px] font-extrabold tabular-nums text-white/65 shrink-0">
                      ~100×
                    </div>
                  </button>
                );
              })()}

              <div className="led-divider-top pt-3">
                <p className="led-eyebrow mb-2">
                  <span className="led-eyebrow-dot" />
                  Public RPCs (slower)
                </p>
              </div>

              {KNOWN_ENDPOINTS.map((ep) => {
                const isActive = providerPref === "public" && activeRpc?.rpc === ep.rpc;
                const ping = pings[ep.rpc];
                const pingColor =
                  ping === undefined
                    ? "text-surface-600"
                    : ping < 0
                    ? "text-red-400"
                    : ping < 300
                    ? "text-green-400"
                    : ping < 800
                    ? "text-yellow-400"
                    : "text-red-400";

                return (
                  <button
                    key={ep.rpc}
                    onClick={() => selectEndpoint(ep)}
                    disabled={rpcSaving}
                    className={`flex items-center gap-3 w-full p-3 rounded-xl text-left transition-all duration-200 border ${
                      isActive
                        ? "bg-white/[0.06] border-white/30"
                        : "bg-transparent border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="led-text text-[12px] font-extrabold text-white truncate">
                          {ep.label}
                        </p>
                        {isActive && (
                          <span className="led-text text-[9px] font-extrabold text-surface-950 bg-white px-1.5 py-0.5 rounded-[3px]" style={{ boxShadow: "0 0 6px rgba(255,255,255,0.4)" }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="led-text text-[10px] font-medium text-white/40 truncate mt-0.5" style={{ letterSpacing: "0.04em" }}>
                        {ep.rpc}
                      </p>
                    </div>
                    <div className={`led-text text-[10px] font-extrabold tabular-nums shrink-0 ${pingColor}`}>
                      {pinging ? (
                        <div className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin" />
                      ) : ping === undefined ? (
                        "..."
                      ) : ping < 0 ? (
                        "ERR"
                      ) : (
                        `${ping}MS`
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom RPC */}
            <div className="space-y-2 pt-3 led-divider-top">
              <p className="led-eyebrow">
                <span className="led-eyebrow-dot" />
                Custom endpoint
              </p>
              <input
                type="text"
                className="input-field text-xs font-mono py-2.5"
                placeholder="RPC URL (e.g. https://my-node:8443/chain-rpc/)"
                value={customRpc}
                onChange={(e) => setCustomRpc(e.target.value.trim())}
              />
              <input
                type="text"
                className="input-field text-xs font-mono py-2.5"
                placeholder="REST URL (e.g. https://my-node:8443/chain-api/)"
                value={customRest}
                onChange={(e) => setCustomRest(e.target.value.trim())}
              />
              <button
                onClick={() => {
                  if (customRpc && customRest) {
                    selectEndpoint({ label: "Custom", rpc: customRpc, rest: customRest });
                    setRpcModal(false);
                  }
                }}
                disabled={!customRpc || !customRest || rpcSaving}
                className="btn-secondary !py-2.5 text-sm"
              >
                Use Custom Endpoint
              </button>
            </div>

            <button
              onClick={() => runPings()}
              disabled={pinging}
              className="led-text w-full py-2 text-[10px] font-extrabold text-white/55 hover:text-white transition-colors flex items-center justify-center gap-1.5"
            >
              {pinging ? (
                <>
                  <Spinner size="sm" className="!w-3 !h-3" />
                  Pinging...
                </>
              ) : (
                "↻ Refresh latency"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Gonka RPC API Key modal */}
      {gonkaKeyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full led-display border-t border-white/[0.08] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[90%] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="led-title text-base">rpc.gonka.gg Key</h3>
              <button
                onClick={() => setGonkaKeyModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-4">
              {/* AUTO key — issued per install, free tier. */}
              <div className="led-panel p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="led-eyebrow">
                    <span className="led-eyebrow-dot" />
                    Auto Key (free tier)
                  </p>
                  {autoMeta?.tier && (
                    <span className="led-spec text-[10px]">
                      {autoMeta.tier}
                    </span>
                  )}
                </div>

                {autoKey ? (
                  <>
                    <p className="led-text text-[11px] font-extrabold text-white led-glow-soft tabular-nums break-all">
                      {autoKeyVisible ? autoKey : maskedKey(autoKey)}
                    </p>

                    {autoUsage && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="led-text font-bold text-white/55">USAGE TODAY</span>
                          <span className="led-text font-extrabold text-white tabular-nums">
                            {(autoUsage.limitDay - autoUsage.remainingDay).toLocaleString()}
                            {" / "}
                            {autoUsage.limitDay.toLocaleString()}
                          </span>
                        </div>
                        <div className="led-text text-[11px] font-extrabold tracking-widest text-white/80">
                          {renderBar(dayPct)}
                        </div>

                        <div className="flex items-center justify-between text-[10px] pt-1">
                          <span className="led-text font-bold text-white/55">USAGE / MIN</span>
                          <span className="led-text font-extrabold text-white tabular-nums">
                            {(autoUsage.limitMinute - autoUsage.remainingMinute).toLocaleString()}
                            {" / "}
                            {autoUsage.limitMinute.toLocaleString()}
                          </span>
                        </div>
                        <div className="led-text text-[11px] font-extrabold tracking-widest text-white/80">
                          {renderBar(minPct)}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setAutoKeyVisible((v) => !v)}
                        className="led-text flex-1 py-2 text-[10px] font-extrabold text-white/65 hover:text-white border border-white/15 hover:border-white/30 rounded-xl transition-colors"
                      >
                        {autoKeyVisible ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={handleRotateAutoKey}
                        disabled={autoKeyBusy !== ""}
                        className="led-text flex-1 py-2 text-[10px] font-extrabold text-white/65 hover:text-white border border-white/15 hover:border-white/30 rounded-xl transition-colors flex items-center justify-center gap-1"
                      >
                        {autoKeyBusy === "rotate" ? <Spinner size="sm" className="!w-3 !h-3" /> : "↻"}
                        Refresh
                      </button>
                      <button
                        onClick={handleRevokeAutoKey}
                        disabled={autoKeyBusy !== ""}
                        className="led-text flex-1 py-2 text-[10px] font-extrabold text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 rounded-xl transition-colors"
                      >
                        Revoke
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="led-text text-[11px] font-bold text-white/65" style={{ letterSpacing: "0.04em" }}>
                      No auto key yet. The wallet mints one on first install — if it failed, retry below.
                    </p>
                    <button
                      onClick={handleIssueAutoKey}
                      disabled={autoKeyBusy !== ""}
                      className="btn-secondary !py-2.5 text-sm flex items-center justify-center gap-2"
                    >
                      {autoKeyBusy === "issue" ? (
                        <>
                          <Spinner size="sm" />
                          Issuing…
                        </>
                      ) : (
                        "▶ Issue free-tier key"
                      )}
                    </button>
                  </>
                )}
              </div>

              {/* Tier upgrade CTA */}
              <button
                onClick={() => chrome.tabs.create({ url: `${GONKA_RPC_SIGNUP_URL}/?upgrade=1&from=ext` })}
                className="btn-secondary !py-2.5 text-sm flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Get a personal key
              </button>

              {/* MANUAL override */}
              <div className="led-panel p-3.5 space-y-3">
                <p className="led-eyebrow">
                  <span className="led-eyebrow-dot" />
                  Manual override
                </p>
                <p className="led-text text-[10px] font-medium text-white/55" style={{ letterSpacing: "0.04em" }}>
                  Paste a personal / paid key here. When set, this overrides the auto key for all RPC calls.
                </p>
                {gonkaKey && (
                  <p className="led-spec text-[10px]">
                    Active · {maskedKey(gonkaKey)}
                  </p>
                )}
                <div className="relative">
                  <input
                    type={gonkaKeyVisible ? "text" : "password"}
                    className="input-field text-xs py-2.5 pr-20"
                    placeholder="gg_live_..."
                    autoComplete="off"
                    spellCheck={false}
                    value={gonkaKeyInput}
                    onChange={(e) => {
                      setGonkaKeyInput(e.target.value.trim());
                      setGonkaKeyError("");
                    }}
                  />
                  <button
                    onClick={() => setGonkaKeyVisible((v) => !v)}
                    className="led-text absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-extrabold text-white/55 hover:text-white transition-colors"
                    type="button"
                  >
                    {gonkaKeyVisible ? "Hide" : "Show"}
                  </button>
                </div>
                {gonkaKeyError && (
                  <p className="led-text text-[10px] font-bold text-red-400">{gonkaKeyError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  {gonkaKey && (
                    <button
                      onClick={handleClearGonkaKey}
                      disabled={gonkaKeySaving}
                      className="led-text flex-1 py-2 text-[10px] font-extrabold text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 rounded-xl transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={handleSaveGonkaKey}
                    disabled={gonkaKeySaving || !gonkaKeyInput}
                    className="btn-primary !py-2 text-xs flex-1 flex items-center justify-center gap-2"
                  >
                    {gonkaKeySaving ? (
                      <>
                        <Spinner size="sm" />
                        Verifying…
                      </>
                    ) : gonkaKey ? (
                      "Replace"
                    ) : (
                      "Save"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Address Book modal */}
      {addrBookModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full led-display border-t border-white/[0.08] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[90%] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="led-title text-base">Address Book</h3>
              <button
                onClick={() => {
                  setAddrBookModal(false);
                  setAddrBookError("");
                  setNewEntryAddr("");
                  setNewEntryName("");
                  setNewEntryNote("");
                }}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Saved entries */}
            <div className="overflow-y-auto flex-1 space-y-1.5 -mx-1 px-1">
              {addressBook.length === 0 ? (
                <div className="text-center py-6 space-y-1">
                  <p className="led-text text-[11px] font-extrabold text-white/55">
                    No saved addresses yet
                  </p>
                  <p className="led-text text-[10px] font-medium text-white/30" style={{ letterSpacing: "0.04em" }}>
                    Add addresses below to quickly fill the Send form
                  </p>
                </div>
              ) : (
                addressBook.map((entry) => (
                  <div
                    key={entry.address}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                  >
                    <div className="w-8 h-8 rounded-[3px] bg-white flex items-center justify-center shrink-0" style={{ boxShadow: "0 0 6px rgba(255,255,255,0.3)" }}>
                      <span className="led-text text-[12px] font-extrabold text-surface-950">
                        {entry.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="led-text text-[12px] font-extrabold text-white truncate">
                        {entry.name}
                      </p>
                      <p className="led-text text-[10px] font-medium text-white/45 truncate" style={{ letterSpacing: "0.04em" }}>
                        {entry.address}
                      </p>
                      {entry.note && (
                        <p className="led-text text-[10px] font-medium text-white/30 truncate" style={{ letterSpacing: "0.04em" }}>
                          {entry.note}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveEntry(entry.address)}
                      className="led-text shrink-0 px-2.5 py-1.5 text-[10px] font-extrabold text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 rounded-md transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add new entry */}
            <div className="led-divider-top pt-4 space-y-2 shrink-0">
              <p className="led-eyebrow">
                <span className="led-eyebrow-dot" />
                Add address
              </p>
              <input
                type="text"
                className="input-field text-sm font-mono py-2.5"
                placeholder="gonka1..."
                value={newEntryAddr}
                onChange={(e) => { setNewEntryAddr(e.target.value.trim()); setAddrBookError(""); }}
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input-field text-sm py-2.5 flex-1"
                  placeholder="Name (required)"
                  value={newEntryName}
                  onChange={(e) => { setNewEntryName(e.target.value); setAddrBookError(""); }}
                />
                <input
                  type="text"
                  className="input-field text-sm py-2.5 flex-1"
                  placeholder="Note (optional)"
                  value={newEntryNote}
                  onChange={(e) => setNewEntryNote(e.target.value)}
                />
              </div>
              {addrBookError && <p className="text-xs text-red-400">{addrBookError}</p>}
              <button
                onClick={handleAddEntry}
                disabled={addingEntry || !newEntryAddr || !newEntryName}
                className="btn-secondary !py-2.5 text-sm flex items-center justify-center gap-2"
              >
                {addingEntry ? <Spinner size="sm" /> : null}
                Save Address
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connected sites modal */}
      {sitesModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full led-display border-t border-white/[0.08] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[85%] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="led-title text-base">Connected Sites</h3>
              <button
                onClick={() => setSitesModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {connectedSites.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <svg className="w-10 h-10 text-white/15 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.9-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.876 8.07" />
                </svg>
                <p className="led-text text-[11px] font-extrabold text-white/55">No connected sites yet</p>
                <p className="led-text text-[10px] font-medium text-white/30" style={{ letterSpacing: "0.04em" }}>
                  Sites that connect to your wallet will appear here
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1.5">
                {connectedSites.map((site) => {
                  let hostname: string;
                  try {
                    hostname = new URL(site.origin).hostname;
                  } catch {
                    hostname = site.origin;
                  }

                  return (
                    <div
                      key={site.origin}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                    >
                      <div className="w-8 h-8 rounded-[3px] bg-white/[0.08] flex items-center justify-center shrink-0 border border-white/[0.15]">
                        <span className="led-text text-[12px] font-extrabold text-white/70">
                          {hostname.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="led-text text-[12px] font-extrabold text-white truncate">
                          {hostname}
                        </p>
                        <p className="led-text text-[10px] font-medium text-white/45 truncate" style={{ letterSpacing: "0.04em" }}>
                          {site.chainIds.join(", ")}
                        </p>
                        <p className="led-text text-[9px] font-medium text-white/30">
                          Connected {new Date(site.connectedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDisconnectSite(site.origin)}
                        className="led-text shrink-0 px-2.5 py-1.5 text-[10px] font-extrabold text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 rounded-md transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {connectedSites.length > 0 && (
              <button
                onClick={async () => {
                  if (confirm("Disconnect all sites? They will need to reconnect to access your wallet.")) {
                    for (const site of connectedSites) {
                      await sendMessage({ type: "DISCONNECT_SITE", origin: site.origin });
                    }
                    loadConnectedSites();
                  }
                }}
                className="led-text w-full py-2.5 text-[10px] font-extrabold text-red-400 hover:text-red-300 transition-colors"
              >
                Disconnect All
              </button>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

function SettingsRow({
  label,
  description,
  onClick,
  icon,
  danger = false,
}: {
  label: string;
  description: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-3 w-full py-3.5 px-4 text-left hover:bg-white/[0.04] transition-all duration-200 active:scale-[0.99] ${
        danger ? "text-red-400" : ""
      }`}
    >
      <div className={`shrink-0 ${danger ? "text-red-400" : "text-white/55 group-hover:text-white transition-colors"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`led-text text-[12px] font-extrabold leading-tight ${
            danger ? "text-red-400" : "text-white"
          }`}
        >
          {label}
        </p>
        <p className="led-text text-[10px] font-medium text-white/45 mt-0.5 truncate" style={{ letterSpacing: "0.04em" }}>
          {description}
        </p>
      </div>
      <svg
        className="w-4 h-4 text-white/30 shrink-0 group-hover:text-white/60 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

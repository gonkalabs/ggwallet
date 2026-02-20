import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { truncateAddress } from "@/lib/format";
import { GONKA_CHAIN_ID, GONKA_CHAIN_NAME, GONKA_BECH32_PREFIX } from "@/lib/gonka";
import { KNOWN_ENDPOINTS, pingEndpoint, type RpcEndpoint } from "@/lib/rpc";
import type { ConnectedSite, AddressBookEntry } from "@/lib/storage";
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
    await sendMessage({ type: "SET_RPC_ENDPOINT", endpoint: ep });
    setActiveRpc(ep);
    setRpcSaving(false);
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
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-surface-500">Active Wallet</p>
            <span className="text-[10px] text-surface-600 tabular-nums">
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
                className="px-3 py-1.5 text-xs font-semibold bg-gonka-500 text-surface-950 rounded-xl transition-colors hover:bg-gonka-400"
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
              className="text-sm font-medium hover:text-gonka-400 transition-colors flex items-center gap-1.5"
            >
              {activeWallet?.name || "Wallet"}
              <svg className="w-3 h-3 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
              </svg>
            </button>
          )}
          <p className="text-xs font-mono text-surface-500 mt-0.5">{truncateAddress(address, 14, 10)}</p>
          <p className="text-xs text-surface-600 mt-1">
            {GONKA_CHAIN_NAME} ({GONKA_CHAIN_ID})
          </p>
        </div>

        {/* Wallets */}
        <div>
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
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
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
            Network
          </h3>
          <div className="card space-y-0 divide-y divide-white/[0.04] !p-0">
            <SettingsRow
              label="RPC Endpoint"
              description={activeRpc?.label || "Loading..."}
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
          </div>
        </div>

        {/* Connected Sites */}
        <div>
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
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
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
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
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
            Auto-Lock
          </h3>
          <div className="card">
            <p className="text-xs text-surface-500 mb-3">Lock wallet after period of inactivity</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "1 min", value: 1 },
                { label: "5 min", value: 5 },
                { label: "15 min", value: 15 },
                { label: "30 min", value: 30 },
                { label: "Never", value: 0 },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  disabled={autoLockSaving}
                  onClick={() => handleSaveAutoLock(value)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all duration-200 ${
                    autoLockMinutes === value
                      ? "bg-gonka-500/15 text-gonka-400 border-gonka-500/25"
                      : "bg-white/[0.04] text-surface-400 border-transparent hover:bg-white/[0.06]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Security */}
        <div>
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
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

        {/* Node Operations */}
        <div>
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
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
                <span className="text-xs text-surface-400 bg-surface-800 border border-white/[0.06] px-3 py-1.5 rounded-full shadow-card">
                  Coming in a future update
                </span>
              </div>
            )}
          </div>
        </div>

        {/* About */}
        <div>
          <h3 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">
            About
          </h3>
          <div className="card text-xs text-surface-500 space-y-1.5">
            <p className="text-surface-300 font-medium">GG Wallet v0.1.2</p>
            <p>Open-source, community wallet for the Gonka.ai blockchain</p>
            <div className="flex items-center gap-3 pt-1">
              <a
                href="https://gonka.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gonka-400 hover:text-gonka-300 transition-colors"
              >
                gonka.ai
              </a>
              <span className="text-surface-700">|</span>
              <a
                href="https://gonkalabs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-surface-400 hover:text-surface-300 transition-colors"
              >
                open-source by <span className="text-surface-300">gonkalabs</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Reveal modal */}
      {revealType && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
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
                <div className="bg-red-500/5 border border-red-500/10 rounded-2xl p-3.5">
                  <p className="text-xs text-red-200/70">
                    Warning: Never share your{" "}
                    {revealType === "mnemonic" ? "recovery phrase" : "private key"}{" "}
                    with anyone. Anyone with access to it can steal your funds.
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
                <div className="bg-white/[0.03] rounded-2xl p-4">
                  <p
                    className={`text-sm ${
                      revealType === "mnemonic"
                        ? "leading-relaxed"
                        : "font-mono break-all text-xs"
                    }`}
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
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[85%] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">RPC Endpoint</h3>
              <button
                onClick={() => setRpcModal(false)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-1.5">
              {KNOWN_ENDPOINTS.map((ep) => {
                const isActive = activeRpc?.rpc === ep.rpc;
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
                    className={`flex items-center gap-3 w-full p-3 rounded-2xl text-left transition-all duration-200 ${
                      isActive
                        ? "bg-gonka-500/10 border border-gonka-500/25"
                        : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{ep.label}</p>
                        {isActive && (
                          <span className="text-[10px] font-medium text-gonka-400 bg-gonka-500/10 px-1.5 py-0.5 rounded-full">
                            active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-surface-500 truncate mt-0.5">
                        {ep.rpc}
                      </p>
                    </div>
                    <div className={`text-xs font-medium tabular-nums shrink-0 ${pingColor}`}>
                      {pinging ? (
                        <div className="w-3 h-3 border border-surface-600 border-t-transparent rounded-full animate-spin" />
                      ) : ping === undefined ? (
                        "..."
                      ) : ping < 0 ? (
                        "err"
                      ) : (
                        `${ping}ms`
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Custom RPC */}
            <div className="space-y-2 pt-1 border-t border-white/[0.04]">
              <p className="text-xs font-medium text-surface-400">Custom endpoint</p>
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
              className="w-full py-2 text-xs text-gonka-400 hover:text-gonka-300 transition-colors flex items-center justify-center gap-1.5"
            >
              {pinging ? (
                <>
                  <Spinner size="sm" className="!w-3 !h-3" />
                  Pinging...
                </>
              ) : (
                "Refresh latency"
              )}
            </button>
          </div>
        </div>
      )}
      {/* Address Book modal */}
      {addrBookModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[90%] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold">Address Book</h3>
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
                <div className="text-center py-6">
                  <p className="text-sm text-surface-500">No saved addresses yet</p>
                  <p className="text-xs text-surface-600 mt-1">Add addresses below to quickly fill the Send form</p>
                </div>
              ) : (
                addressBook.map((entry) => (
                  <div
                    key={entry.address}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-transparent"
                  >
                    <div className="w-8 h-8 rounded-xl bg-gonka-500/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-gonka-400">
                        {entry.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{entry.name}</p>
                      <p className="text-[11px] font-mono text-surface-500 truncate">{entry.address}</p>
                      {entry.note && (
                        <p className="text-[11px] text-surface-600 truncate">{entry.note}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveEntry(entry.address)}
                      className="shrink-0 px-2.5 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add new entry */}
            <div className="border-t border-white/[0.04] pt-4 space-y-2 shrink-0">
              <p className="text-xs font-medium text-surface-400">Add address</p>
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
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal max-h-[85%] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Connected Sites</h3>
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
                <svg className="w-10 h-10 text-surface-700 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.9-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.876 8.07" />
                </svg>
                <p className="text-sm text-surface-500">No connected sites yet</p>
                <p className="text-xs text-surface-600">
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
                      className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-transparent"
                    >
                      <div className="w-8 h-8 rounded-xl bg-surface-800 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-surface-400">
                          {hostname.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{hostname}</p>
                        <p className="text-[11px] text-surface-600 truncate">
                          {site.chainIds.join(", ")}
                        </p>
                        <p className="text-[10px] text-surface-700">
                          Connected {new Date(site.connectedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDisconnectSite(site.origin)}
                        className="shrink-0 px-2.5 py-1.5 text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-colors"
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
                className="w-full py-2.5 text-xs text-red-400 hover:text-red-300 transition-colors font-medium"
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
      className={`flex items-center gap-3 w-full py-3.5 px-4 text-left hover:bg-white/[0.03] transition-all duration-200 active:scale-[0.99] ${
        danger ? "text-red-400" : ""
      }`}
    >
      <div className={`shrink-0 ${danger ? "text-red-400" : "text-surface-400"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${danger ? "text-red-400" : ""}`}>
          {label}
        </p>
        <p className="text-xs text-surface-600">{description}</p>
      </div>
      <svg
        className="w-4 h-4 text-surface-700 shrink-0"
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

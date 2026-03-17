import { useState, useEffect, useCallback, useRef } from "react";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { truncateAddress } from "@/lib/format";
import { GNS_CONTRACT_ADDRESS, GNS_SUFFIX, GONKA_DENOM, GONKA_DECIMALS } from "@/lib/gonka";
import { getActiveEndpoint } from "@/lib/rpc";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

interface OwnedName {
  name: string;
  fullName: string;
  address: string;
  owner: string;
  sale_price: string | null;
}

type ModalAction =
  | { type: "transfer"; name: string }
  | { type: "set_address"; name: string; currentAddress: string }
  | { type: "set_primary"; name: string }
  | { type: "set_record"; name: string }
  | { type: "list_sale"; name: string }
  | { type: "delist"; name: string }
  | null;

export default function GnsNames() {
  const { address, isViewOnly } = useWalletStore();
  const [names, setNames] = useState<OwnedName[]>([]);
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalAction>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const mountedRef = useRef(true);

  // Form fields
  const [transferTo, setTransferTo] = useState("");
  const [newResolveAddr, setNewResolveAddr] = useState("");
  const [recordKey, setRecordKey] = useState("");
  const [recordValue, setRecordValue] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, Record<string, string>>>({});

  const fetchOwnedNames = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError("");

    try {
      const endpoint = await getActiveEndpoint();
      const rest = endpoint.rest;
      const owned: OwnedName[] = [];
      let nextKey: string | null = null;

      do {
        const params = new URLSearchParams({ "pagination.limit": "100" });
        if (nextKey) params.set("pagination.key", nextKey);

        const url = `${rest}cosmwasm/wasm/v1/contract/${GNS_CONTRACT_ADDRESS}/state?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();

        for (const model of data.models || []) {
          try {
            const record = JSON.parse(atob(model.value));
            if (record.owner !== address) continue;

            // Keys come as uppercase hex strings from the API
            const keyBytes = hexToBytes(model.key);
            const nsLen = (keyBytes[0] << 8) | keyBytes[1];
            const ns = new TextDecoder().decode(keyBytes.slice(2, 2 + nsLen));
            if (ns !== "names") continue;

            const name = new TextDecoder().decode(keyBytes.slice(2 + nsLen));
            owned.push({
              name,
              fullName: name + GNS_SUFFIX,
              address: record.address || address,
              owner: record.owner,
              sale_price: record.sale_price || null,
            });
          } catch {
            // skip unparseable entries
          }
        }

        nextKey = data.pagination?.next_key || null;
      } while (nextKey);

      if (mountedRef.current) setNames(owned);

      // Fetch primary name
      const q = btoa(JSON.stringify({ reverse_lookup: { address } }));
      const primaryRes = await fetch(
        `${rest}cosmwasm/wasm/v1/contract/${GNS_CONTRACT_ADDRESS}/smart/${q}`
      );
      if (primaryRes.ok) {
        const primaryData = await primaryRes.json();
        if (mountedRef.current) {
          const pName = primaryData.data?.name || null;
          setPrimaryName(pName ? pName.replace(GNS_SUFFIX, "") : null);
        }
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message || "Failed to load names");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    mountedRef.current = true;
    fetchOwnedNames();
    return () => { mountedRef.current = false; };
  }, [fetchOwnedNames]);

  const fetchRecords = useCallback(async (name: string) => {
    const endpoint = await getActiveEndpoint();
    const rest = endpoint.rest;
    const knownKeys = ["twitter", "telegram", "discord", "email", "website", "avatar", "description"];
    const found: Record<string, string> = {};

    await Promise.all(
      knownKeys.map(async (key) => {
        try {
          const q = btoa(JSON.stringify({ get_record: { name, key } }));
          const res = await fetch(
            `${rest}cosmwasm/wasm/v1/contract/${GNS_CONTRACT_ADDRESS}/smart/${q}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.data?.value) found[key] = data.data.value;
          }
        } catch {
          // ignore
        }
      })
    );

    setRecords((prev) => ({ ...prev, [name]: found }));
  }, []);

  const toggleExpand = (name: string) => {
    if (expandedName === name) {
      setExpandedName(null);
    } else {
      setExpandedName(name);
      if (!records[name]) fetchRecords(name);
    }
  };

  const executeGns = async (contractMsg: object, funds?: { denom: string; amount: string }[]) => {
    setActionLoading(true);
    setActionError("");
    setActionSuccess("");

    try {
      const resp = await sendMessage({
        type: "GNS_EXECUTE",
        contractMsg,
        funds: funds || [],
      });

      if (!resp.success) throw new Error(resp.error || "Transaction failed");

      setActionSuccess(`TX: ${resp.txHash?.slice(0, 16)}...`);
      setTimeout(() => {
        setModal(null);
        setActionSuccess("");
        resetForm();
        fetchOwnedNames();
      }, 1500);
    } catch (e: any) {
      setActionError(e.message || "Transaction failed");
    } finally {
      setActionLoading(false);
    }
  };

  const resetForm = () => {
    setTransferTo("");
    setNewResolveAddr("");
    setRecordKey("");
    setRecordValue("");
    setSalePrice("");
    setActionError("");
    setActionSuccess("");
  };

  const handleTransfer = () => {
    if (!modal || modal.type !== "transfer") return;
    if (!transferTo.startsWith("gonka") || transferTo.length < 39) {
      setActionError("Invalid address");
      return;
    }
    executeGns({ transfer: { name: modal.name, new_owner: transferTo } });
  };

  const handleSetAddress = () => {
    if (!modal || modal.type !== "set_address") return;
    if (!newResolveAddr.startsWith("gonka") || newResolveAddr.length < 39) {
      setActionError("Invalid address");
      return;
    }
    executeGns({ set_address: { name: modal.name, address: newResolveAddr } });
  };

  const handleSetPrimary = () => {
    if (!modal || modal.type !== "set_primary") return;
    executeGns({ set_primary: { name: modal.name } });
  };

  const handleSetRecord = () => {
    if (!modal || modal.type !== "set_record") return;
    if (!recordKey.trim()) {
      setActionError("Key is required");
      return;
    }
    if (recordValue.trim()) {
      executeGns({ set_record: { name: modal.name, key: recordKey.trim(), value: recordValue.trim() } });
    } else {
      executeGns({ delete_record: { name: modal.name, key: recordKey.trim() } });
    }
  };

  const handleListSale = () => {
    if (!modal || modal.type !== "list_sale") return;
    const priceNum = parseFloat(salePrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setActionError("Enter a valid price in GNK");
      return;
    }
    const priceNgonka = (BigInt(Math.floor(priceNum * 1e9))).toString();
    executeGns({ list_for_sale: { name: modal.name, price: priceNgonka } });
  };

  const handleDelist = () => {
    if (!modal || modal.type !== "delist") return;
    executeGns({ delist_from_sale: { name: modal.name } });
  };

  return (
    <Layout title="GNS Names" showBack>
      <div className="px-4 py-3 space-y-4">
        {/* Header info */}
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Your .gnk Names</p>
              <p className="text-[11px] text-surface-500 mt-0.5">
                {names.length > 0
                  ? `${names.length} name${names.length !== 1 ? "s" : ""} owned`
                  : "No names yet"}
              </p>
            </div>
            <a
              href="https://gonka.gg/names"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-[11px] font-semibold bg-gonka-500 text-surface-950 rounded-xl hover:bg-gonka-400 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Get a Name
            </a>
          </div>
          {primaryName && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[10px] text-surface-500">Primary:</span>
              <span className="text-xs font-semibold text-gonka-400">{primaryName}{GNS_SUFFIX}</span>
            </div>
          )}
        </div>

        {/* Loading / Error */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-400 mb-3">{error}</p>
            <button onClick={fetchOwnedNames} className="text-xs text-gonka-400 hover:text-gonka-300">
              Retry
            </button>
          </div>
        ) : names.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 bg-gonka-500/10 border border-gonka-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
            </div>
            <p className="text-sm text-surface-400 mb-1">No .gnk names yet</p>
            <p className="text-xs text-surface-600">
              Visit{" "}
              <a href="https://gonka.gg/names" target="_blank" rel="noopener noreferrer" className="text-gonka-400 hover:text-gonka-300">
                gonka.gg/names
              </a>{" "}
              to register one
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {names.map((n) => {
              const isExpanded = expandedName === n.name;
              const isPrimary = primaryName === n.name;
              const nameRecords = records[n.name];

              return (
                <div key={n.name} className="card !p-0 overflow-hidden">
                  {/* Name header */}
                  <button
                    onClick={() => toggleExpand(n.name)}
                    className="flex items-center gap-3 w-full p-3.5 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gonka-500/10 border border-gonka-500/20 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-gonka-400">
                        {n.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{n.fullName}</p>
                        {isPrimary && (
                          <span className="text-[9px] font-semibold text-gonka-400 bg-gonka-500/10 px-1.5 py-0.5 rounded-full">
                            PRIMARY
                          </span>
                        )}
                        {n.sale_price && (
                          <span className="text-[9px] font-semibold text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">
                            FOR SALE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-surface-500 truncate mt-0.5">
                        → {truncateAddress(n.address, 12, 8)}
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-surface-600 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-white/[0.04] px-3.5 py-3 space-y-3 animate-fade-in-up">
                      {/* Records */}
                      {nameRecords && Object.keys(nameRecords).length > 0 && (
                        <div>
                          <p className="text-[10px] text-surface-500 mb-1.5">Records</p>
                          <div className="space-y-1">
                            {Object.entries(nameRecords).map(([k, v]) => (
                              <div key={k} className="flex justify-between text-[11px]">
                                <span className="text-surface-500">{k}</span>
                                <span className="text-surface-300 truncate ml-2 max-w-[180px]">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {n.sale_price && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-surface-500">Sale price</span>
                          <span className="text-yellow-300 font-medium">
                            {(Number(n.sale_price) / 1e9).toFixed(2)} GNK
                          </span>
                        </div>
                      )}

                      {/* Actions */}
                      {!isViewOnly && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {!isPrimary && (
                            <ActionChip
                              label="Set Primary"
                              onClick={() => { resetForm(); setModal({ type: "set_primary", name: n.name }); }}
                            />
                          )}
                          <ActionChip
                            label="Set Address"
                            onClick={() => { resetForm(); setNewResolveAddr(n.address); setModal({ type: "set_address", name: n.name, currentAddress: n.address }); }}
                          />
                          <ActionChip
                            label="Transfer"
                            onClick={() => { resetForm(); setModal({ type: "transfer", name: n.name }); }}
                          />
                          <ActionChip
                            label="Records"
                            onClick={() => { resetForm(); setModal({ type: "set_record", name: n.name }); }}
                          />
                          {n.sale_price ? (
                            <ActionChip
                              label="Delist"
                              onClick={() => { resetForm(); setModal({ type: "delist", name: n.name }); }}
                              danger
                            />
                          ) : (
                            <ActionChip
                              label="List for Sale"
                              onClick={() => { resetForm(); setModal({ type: "list_sale", name: n.name }); }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{getModalTitle(modal)}</h3>
              <button
                onClick={() => { setModal(null); resetForm(); }}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-surface-400">
              Name: <span className="text-gonka-400 font-semibold">{modal.name}{GNS_SUFFIX}</span>
            </p>

            {/* Transfer */}
            {modal.type === "transfer" && (
              <div className="space-y-3">
                <div className="bg-red-500/5 border border-red-500/10 rounded-2xl p-3">
                  <p className="text-[11px] text-red-200/70">
                    This will transfer ownership. You will lose control of this name.
                  </p>
                </div>
                <input
                  type="text"
                  className="input-field text-sm font-mono py-2.5"
                  placeholder="New owner address (gonka1...)"
                  value={transferTo}
                  onChange={(e) => { setTransferTo(e.target.value.trim()); setActionError(""); }}
                  autoFocus
                />
                <ActionButton label="Transfer Name" onClick={handleTransfer} loading={actionLoading} danger />
              </div>
            )}

            {/* Set Address */}
            {modal.type === "set_address" && (
              <div className="space-y-3">
                <p className="text-[11px] text-surface-500">
                  Change the address this name resolves to.
                </p>
                <input
                  type="text"
                  className="input-field text-sm font-mono py-2.5"
                  placeholder="Resolve address (gonka1...)"
                  value={newResolveAddr}
                  onChange={(e) => { setNewResolveAddr(e.target.value.trim()); setActionError(""); }}
                  autoFocus
                />
                <ActionButton label="Update Address" onClick={handleSetAddress} loading={actionLoading} />
              </div>
            )}

            {/* Set Primary */}
            {modal.type === "set_primary" && (
              <div className="space-y-3">
                <p className="text-[11px] text-surface-500">
                  Set this as your primary name for reverse lookups. When someone looks up your address, this name will be shown.
                </p>
                <ActionButton label="Set as Primary" onClick={handleSetPrimary} loading={actionLoading} />
              </div>
            )}

            {/* Set Record */}
            {modal.type === "set_record" && (
              <div className="space-y-3">
                <p className="text-[11px] text-surface-500">
                  Set or delete a text record. Leave value empty to delete.
                </p>
                <div className="flex gap-2">
                  <select
                    className="input-field text-sm py-2.5 flex-1"
                    value={recordKey}
                    onChange={(e) => { setRecordKey(e.target.value); setActionError(""); }}
                  >
                    <option value="">Select key...</option>
                    <option value="twitter">twitter</option>
                    <option value="telegram">telegram</option>
                    <option value="discord">discord</option>
                    <option value="email">email</option>
                    <option value="website">website</option>
                    <option value="avatar">avatar</option>
                    <option value="description">description</option>
                    <option value="__custom">Custom...</option>
                  </select>
                </div>
                {recordKey === "__custom" && (
                  <input
                    type="text"
                    className="input-field text-sm py-2.5"
                    placeholder="Custom key name"
                    onChange={(e) => { setRecordKey(e.target.value.trim()); }}
                    autoFocus
                  />
                )}
                <input
                  type="text"
                  className="input-field text-sm py-2.5"
                  placeholder="Value (empty to delete)"
                  value={recordValue}
                  onChange={(e) => { setRecordValue(e.target.value); setActionError(""); }}
                />
                <ActionButton
                  label={recordValue.trim() ? "Set Record" : "Delete Record"}
                  onClick={handleSetRecord}
                  loading={actionLoading}
                  danger={!recordValue.trim()}
                />
              </div>
            )}

            {/* List for Sale */}
            {modal.type === "list_sale" && (
              <div className="space-y-3">
                <p className="text-[11px] text-surface-500">
                  List this name on the GNS marketplace. Anyone can buy it at the price you set.
                </p>
                <div className="relative">
                  <input
                    type="number"
                    className="input-field text-sm py-2.5 pr-14"
                    placeholder="Price"
                    value={salePrice}
                    onChange={(e) => { setSalePrice(e.target.value); setActionError(""); }}
                    autoFocus
                    min="0"
                    step="0.1"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-surface-500 font-medium">
                    GNK
                  </span>
                </div>
                <ActionButton label="List for Sale" onClick={handleListSale} loading={actionLoading} />
              </div>
            )}

            {/* Delist */}
            {modal.type === "delist" && (
              <div className="space-y-3">
                <p className="text-[11px] text-surface-500">
                  Remove this name from the marketplace.
                </p>
                <ActionButton label="Delist from Sale" onClick={handleDelist} loading={actionLoading} />
              </div>
            )}

            {actionError && (
              <p className="text-xs text-red-400">{actionError}</p>
            )}
            {actionSuccess && (
              <p className="text-xs text-green-400">{actionSuccess}</p>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

function getModalTitle(modal: NonNullable<ModalAction>): string {
  switch (modal.type) {
    case "transfer": return "Transfer Name";
    case "set_address": return "Set Resolve Address";
    case "set_primary": return "Set Primary Name";
    case "set_record": return "Manage Records";
    case "list_sale": return "List for Sale";
    case "delist": return "Delist from Sale";
  }
}

function ActionChip({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${
        danger
          ? "text-red-400 bg-red-500/10 hover:bg-red-500/20"
          : "text-surface-300 bg-white/[0.04] hover:bg-white/[0.08]"
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full py-3 text-sm font-semibold rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 ${
        danger
          ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
          : "btn-primary"
      }`}
    >
      {loading ? (
        <>
          <Spinner size="sm" />
          Processing...
        </>
      ) : (
        label
      )}
    </button>
  );
}

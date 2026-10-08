import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { formatCompact, toMinimalDecimals, toDisplayDecimals } from "@/lib/format";
import { GONKA_BECH32_PREFIX, GONKA_DENOM } from "@/lib/gonka";
import { isGnsName, resolveGnsName } from "@/lib/gns";
import { KNOWN_IBC_CHANNELS } from "@/lib/cosmos";
import type { TokenBalance, IbcChannel } from "@/lib/cosmos";
import type { AddressBookEntry } from "@/lib/storage";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";
import GasHeadroomControl from "@/popup/components/GasHeadroomControl";
import { GAS_HEADROOM_RECOMMENDED, gasLimitForHeadroom } from "@/lib/gas-headroom";

type Step = "form" | "confirm" | "success" | "error";
type TransferMode = "same-chain" | "ibc";

export default function Send() {
  const navigate = useNavigate();
  const { balance, tokenBalances, address, getBalance } = useWalletStore();

  // Build token list — always show at least GNK even if balance is 0
  const tokens: TokenBalance[] =
    tokenBalances.length > 0
      ? tokenBalances
      : [{ denom: "ngonka", amount: balance, symbol: "GNK", decimals: 9, isIbc: false }];

  const [selectedToken, setSelectedToken] = useState<TokenBalance>(tokens[0]);
  const [mode, setMode] = useState<TransferMode>("same-chain");
  const [selectedChannel, setSelectedChannel] = useState<IbcChannel>(KNOWN_IBC_CHANNELS[0]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [gasUsed, setGasUsed] = useState<number | null>(null);
  const [feeEstimating, setFeeEstimating] = useState(false);
  const [headroom, setHeadroom] = useState(GAS_HEADROOM_RECOMMENDED);
  const [spendable, setSpendable] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedName, setResolvedName] = useState<string | null>(null);

  // Address book
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>([]);
  const [showBook, setShowBook] = useState(false);

  useEffect(() => {
    sendMessage({ type: "GET_ADDRESS_BOOK" }).then((r) => {
      if (r.entries) setAddressBook(r.entries);
    });
    sendMessage({ type: "GET_GAS_HEADROOM" }).then((r) => {
      if (typeof r?.multiplier === "number") setHeadroom(r.multiplier);
    });
    sendMessage({ type: "GET_SPENDABLE" }).then((r) => {
      const map: Record<string, string> = {};
      for (const coin of r?.balances ?? []) {
        if (coin?.denom) map[coin.denom] = String(coin.amount ?? "0");
      }
      setSpendable(map);
    });
  }, []);

  // Sync selectedToken when tokenBalances load
  useEffect(() => {
    if (tokenBalances.length > 0) {
      setSelectedToken((prev) => tokenBalances.find((t) => t.denom === prev.denom) ?? tokenBalances[0]);
    }
  }, [tokenBalances]);

  // IBC mode: only IBC tokens (plus GNK) make sense to cross-chain transfer.
  // When user switches to IBC mode and current token is a non-IBC unknown, keep as-is.
  // Reset recipient when mode changes — address format differs.
  const handleModeChange = (m: TransferMode) => {
    setMode(m);
    setRecipient("");
    setResolvedAddress(null);
    setResolvedName(null);
    setError("");
  };

  // Quote the fee the chain will require (padded simulated gas × 1 ngonka).
  useEffect(() => {
    if (step !== "confirm") return;
    let cancelled = false;
    setFeeEstimating(true);
    const minAmount = toMinimalDecimals(amount, selectedToken.decimals);
    const payload =
      mode === "ibc"
        ? {
            type: "ESTIMATE_TX_FEE",
            kind: "ibc",
            recipient,
            amount: minAmount,
            denom: selectedToken.denom,
            sourceChannel: selectedChannel.channelId,
            memo,
          }
        : {
            type: "ESTIMATE_TX_FEE",
            kind: "send",
            recipient: effectiveRecipient,
            amount: minAmount,
            denom: selectedToken.denom,
            memo,
          };
    sendMessage(payload)
      .then((resp) => {
        if (cancelled || !resp?.success || !resp.gasUsed) return;
        setGasUsed(Number(resp.gasUsed));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFeeEstimating(false);
      });
    return () => {
      cancelled = true;
    };
    // Quoted once when the user opens the confirm step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Resolve .gnk names (only valid in same-chain mode)
  useEffect(() => {
    setResolvedAddress(null);
    setResolvedName(null);
    if (mode !== "same-chain") return;
    if (!isGnsName(recipient)) return;

    let cancelled = false;
    setResolving(true);
    resolveGnsName(recipient).then((addr) => {
      if (cancelled) return;
      setResolving(false);
      if (addr) {
        setResolvedAddress(addr);
        setResolvedName(recipient.trim());
      } else {
        setResolvedAddress(null);
      }
    });
    return () => { cancelled = true; };
  }, [recipient, mode]);

  const validateSameChainAddress = (addr: string) =>
    addr.startsWith(GONKA_BECH32_PREFIX) && addr.length >= 39;

  const validateIbcAddress = (addr: string) =>
    addr.startsWith(selectedChannel.bech32Prefix) && addr.length >= 20;

  const effectiveRecipient = resolvedAddress ?? recipient;

  async function loadSpendable(): Promise<Record<string, string>> {
    const resp = await sendMessage({ type: "GET_SPENDABLE" });
    if (resp?.error) throw new Error(resp.error);
    const map: Record<string, string> = {};
    for (const coin of resp?.balances ?? []) {
      if (coin?.denom) map[coin.denom] = String(coin.amount ?? "0");
    }
    setSpendable(map);
    return map;
  }

  function estimatePayload(rawAmount: string) {
    return mode === "ibc"
      ? {
          type: "ESTIMATE_TX_FEE",
          kind: "ibc",
          recipient,
          amount: rawAmount,
          denom: selectedToken.denom,
          sourceChannel: selectedChannel.channelId,
          memo,
        }
      : {
          type: "ESTIMATE_TX_FEE",
          kind: "send",
          recipient: effectiveRecipient,
          amount: rawAmount,
          denom: selectedToken.denom,
          memo,
        };
  }

  /** Fee is paid in ngonka. A native send must leave that fee in the account. */
  function affordabilityError(
    balances: Record<string, string>,
    rawAmount: bigint,
    fee: bigint
  ): string | null {
    const tokenBal = BigInt(balances[selectedToken.denom] ?? "0");
    const gnkBal = BigInt(balances[GONKA_DENOM] ?? "0");
    const paysFeeInToken = selectedToken.denom === GONKA_DENOM;
    if (!paysFeeInToken && rawAmount > tokenBal) {
      return `Not enough spendable ${selectedToken.symbol}.`;
    }
    const have = paysFeeInToken ? tokenBal : gnkBal;
    const need = paysFeeInToken ? rawAmount + fee : fee;
    if (need > have) {
      if (paysFeeInToken) {
        const max = have > fee ? have - fee : 0n;
        return `Amount plus the network fee (${formatCompact(fee.toString())}) exceeds spendable GNK. Max you can send is ${toDisplayDecimals(max.toString(), selectedToken.decimals)} ${selectedToken.symbol}.`;
      }
      return `Not enough spendable GNK for the network fee (${formatCompact(fee.toString())}).`;
    }
    return null;
  }

  const handleReview = async () => {
    setError("");

    if (mode === "same-chain") {
      if (isGnsName(recipient) && !resolvedAddress) {
        setError(resolving ? "Resolving name…" : "Name not found or not registered");
        return;
      }
      if (!validateSameChainAddress(effectiveRecipient)) {
        setError("Invalid Gonka address");
        return;
      }
      if (effectiveRecipient === address) {
        setError("Cannot send to yourself");
        return;
      }
    } else {
      if (!validateIbcAddress(recipient)) {
        setError(`Enter a valid ${selectedChannel.chainName} address (starts with ${selectedChannel.bech32Prefix}1...)`);
        return;
      }
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount");
      return;
    }
    const minAmount = toMinimalDecimals(amount, selectedToken.decimals);
    setPreparing(true);
    try {
      const balances = await loadSpendable();
      const estimate = await sendMessage(estimatePayload(minAmount));
      if (!estimate?.success || !estimate.gasUsed) {
        setError(estimate?.error || "Could not estimate the network fee");
        return;
      }
      const fee = BigInt(gasLimitForHeadroom(Number(estimate.gasUsed), headroom));
      const shortfall = affordabilityError(balances, BigInt(minAmount), fee);
      if (shortfall) {
        setError(shortfall);
        return;
      }
      setGasUsed(Number(estimate.gasUsed));
      setStep("confirm");
    } catch (e: any) {
      setError(e.message || "Could not estimate the network fee");
    } finally {
      setPreparing(false);
    }
  };

  const handleSend = async () => {
    setLoading(true);
    setError("");
    try {
      const minAmount = toMinimalDecimals(amount, selectedToken.decimals);
      let resp: any;

      if (mode === "same-chain") {
        resp = await sendMessage({
          type: "SEND_TOKENS",
          recipient: effectiveRecipient,
          amount: minAmount,
          denom: selectedToken.denom,
          memo,
          headroom,
        });
      } else {
        resp = await sendMessage({
          type: "IBC_TRANSFER",
          recipient,
          amount: minAmount,
          denom: selectedToken.denom,
          sourceChannel: selectedChannel.channelId,
          memo,
          headroom,
        });
      }

      if (resp.success) {
        setTxHash(resp.txHash);
        setStep("success");
        getBalance();
      } else {
        setError(resp.error || "Transaction failed");
        setStep("error");
      }
    } catch (e: any) {
      setError(e.message || "Transaction failed");
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  const handleSetMax = async () => {
    setError("");
    const recipientReady =
      mode === "ibc" ? validateIbcAddress(recipient) : validateSameChainAddress(effectiveRecipient);
    if (!recipientReady) {
      setError(mode === "ibc" ? "Enter a destination address before using max" : "Enter a Gonka address before using max");
      return;
    }
    setPreparing(true);
    try {
      const balances = await loadSpendable();
      const tokenBal = BigInt(balances[selectedToken.denom] ?? "0");
      if (selectedToken.denom !== GONKA_DENOM) {
        setAmount(toDisplayDecimals(tokenBal.toString(), selectedToken.decimals));
        const gnkBal = BigInt(balances[GONKA_DENOM] ?? "0");
        const estimate = await sendMessage(estimatePayload("1"));
        if (estimate?.success && estimate.gasUsed) {
          const fee = BigInt(gasLimitForHeadroom(Number(estimate.gasUsed), headroom));
          if (fee > gnkBal) {
            setError(`Not enough spendable GNK for the network fee (${formatCompact(fee.toString())}).`);
          }
        }
        return;
      }
      // Simulate a 1-ngonka send so a max amount does not fail the estimate.
      const estimate = await sendMessage(estimatePayload("1"));
      if (!estimate?.success || !estimate.gasUsed) {
        setError(estimate?.error || "Could not estimate the network fee");
        return;
      }
      const fee = BigInt(gasLimitForHeadroom(Number(estimate.gasUsed), headroom));
      const max = tokenBal > fee ? tokenBal - fee : 0n;
      setAmount(toDisplayDecimals(max.toString(), selectedToken.decimals));
      if (max === 0n) {
        setError("Not enough spendable GNK to cover the network fee.");
      }
    } catch (e: any) {
      setError(e.message || "Could not estimate the network fee");
    } finally {
      setPreparing(false);
    }
  };

  // ---- Success ----
  if (step === "success") {
    return (
      <Layout title="Transaction Sent" showBack={false} showNav={false}>
        <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
          <div className="w-16 h-16 bg-gonka-500/10 border border-gonka-500/25 rounded-full flex items-center justify-center mb-5 animate-scale-in">
            <svg className="w-8 h-8 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-2">
            {mode === "ibc" ? "IBC Transfer Sent!" : "Transaction Sent!"}
          </h2>
          <p className="text-sm text-surface-400 mb-1">
            {amount} {selectedToken.symbol} sent to {mode === "ibc" ? selectedChannel.chainName : "Gonka"}
          </p>
          {mode === "ibc" && (
            <p className="text-xs text-surface-600 mb-4">
              IBC packets can take 1–2 minutes to arrive on {selectedChannel.chainName}
            </p>
          )}
          <div className="w-full bg-white/[0.03] rounded-2xl p-4 mb-6">
            <p className="text-xs text-surface-500 mb-1">Transaction Hash</p>
            <p className="text-xs font-mono text-surface-300 break-all">{txHash}</p>
          </div>
          <button onClick={() => navigate("/")} className="btn-primary">
            Back to Wallet
          </button>
        </div>
      </Layout>
    );
  }

  // ---- Confirm ----
  if (step === "confirm") {
    const confirmFee =
      gasUsed != null ? BigInt(gasLimitForHeadroom(gasUsed, headroom)) : null;
    const confirmBalanceError =
      confirmFee == null
        ? null
        : affordabilityError(
            spendable,
            BigInt(toMinimalDecimals(amount, selectedToken.decimals)),
            confirmFee
          );
    return (
      <Layout title="Confirm Transaction" showBack={false} showNav={false}>
        <div className="px-4 py-4 space-y-4">
          <div className="card space-y-3">
            {mode === "ibc" && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-surface-500">Route</span>
                  <span className="text-sm font-medium text-gonka-400">
                    Gonka → {selectedChannel.chainName} <span className="text-surface-500 font-mono text-xs">({selectedChannel.channelId})</span>
                  </span>
                </div>
                <div className="border-t border-white/[0.04]" />
              </>
            )}
            <div className="flex justify-between items-start gap-4">
              <span className="text-sm text-surface-500 shrink-0">To</span>
              <div className="text-right">
                {resolvedName && (
                  <p className="text-xs text-gonka-400 font-semibold mb-0.5">{resolvedName}</p>
                )}
                <span className="text-sm font-mono break-all">
                  {mode === "same-chain" ? effectiveRecipient : recipient}
                </span>
              </div>
            </div>
            <div className="border-t border-white/[0.04]" />
            <div className="flex justify-between">
              <span className="text-sm text-surface-500">Amount</span>
              <span className="text-sm font-bold">
                {amount} {selectedToken.symbol}
              </span>
            </div>
            {memo && (
              <>
                <div className="border-t border-white/[0.04]" />
                <div className="flex justify-between">
                  <span className="text-sm text-surface-500">Memo</span>
                  <span className="text-sm text-surface-300">{memo}</span>
                </div>
              </>
            )}
            <div className="border-t border-white/[0.04]" />
            {feeEstimating ? (
              <p className="text-sm text-surface-500">Estimating gas…</p>
            ) : (
              <GasHeadroomControl
                value={headroom}
                gasUsed={gasUsed}
                onChange={(next) => {
                  setHeadroom(next);
                  sendMessage({ type: "SET_GAS_HEADROOM", multiplier: next });
                }}
              />
            )}
            {confirmBalanceError && (
              <p className="text-xs text-red-400 leading-relaxed">{confirmBalanceError}</p>
            )}
            {mode === "ibc" && (
              <>
                <div className="border-t border-white/[0.04]" />
                <p className="text-xs text-surface-600 leading-relaxed">
                  IBC transfers are time-locked (10 min). If the packet times out, funds are automatically returned to your Gonka address.
                </p>
              </>
            )}
          </div>
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <div className="space-y-2">
            <button
              onClick={handleSend}
              disabled={loading || feeEstimating || !!confirmBalanceError}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  {mode === "ibc" ? "Sending via IBC…" : "Sending…"}
                </>
              ) : (
                mode === "ibc" ? `Send to ${selectedChannel.chainName}` : "Confirm & Send"
              )}
            </button>
            <button onClick={() => setStep("form")} disabled={loading} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // ---- Form ----
  const isIbcMode = mode === "ibc";
  const recipientPlaceholder = isIbcMode
    ? `${selectedChannel.bech32Prefix}1… (${selectedChannel.chainName} address)`
    : "gonka1… or mike.gnk";

  return (
    <Layout title="Send" showBack showNav={false}>
      <div className="px-4 py-4 space-y-4">

        {/* Token selector */}
        {tokens.length > 1 && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-300">Token</label>
            <div className="flex gap-2 flex-wrap">
              {tokens.map((t) => (
                <button
                  key={t.denom}
                  onClick={() => {
                    setSelectedToken(t);
                    setAmount("");
                    setError("");
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all duration-200 ${
                    selectedToken.denom === t.denom
                      ? "bg-gonka-500/15 text-gonka-400 border-gonka-500/25"
                      : "bg-white/[0.04] text-surface-400 border-transparent hover:bg-white/[0.06]"
                  }`}
                >
                  {t.symbol}
                  <span className="ml-1.5 text-[10px] opacity-60">
                    {toDisplayDecimals(t.amount, t.decimals)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Transfer mode toggle */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">Destination</label>
          <div className="flex rounded-xl bg-white/[0.04] p-0.5 gap-0.5">
            <button
              onClick={() => handleModeChange("same-chain")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${
                !isIbcMode
                  ? "bg-gonka-500/15 text-gonka-400"
                  : "text-surface-500 hover:text-surface-300"
              }`}
            >
              Gonka (same chain)
            </button>
            <button
              onClick={() => handleModeChange("ibc")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${
                isIbcMode
                  ? "bg-gonka-500/15 text-gonka-400"
                  : "text-surface-500 hover:text-surface-300"
              }`}
            >
              IBC (cross-chain)
            </button>
          </div>
        </div>

        {/* IBC channel picker */}
        {isIbcMode && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-300">Destination Chain</label>
            <div className="flex gap-2 flex-wrap">
              {KNOWN_IBC_CHANNELS.map((ch) => (
                <button
                  key={ch.channelId}
                  onClick={() => {
                    setSelectedChannel(ch);
                    setRecipient("");
                    setError("");
                  }}
                  className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all duration-200 ${
                    selectedChannel.channelId === ch.channelId
                      ? "bg-gonka-500/15 text-gonka-400 border-gonka-500/25"
                      : "bg-white/[0.04] text-surface-400 border-transparent hover:bg-white/[0.06]"
                  }`}
                >
                  <span>{ch.chainName}</span>
                  <span className="font-mono text-[10px] opacity-60">{ch.channelId}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recipient */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">Recipient</label>
          <div className="relative">
            <input
              type="text"
              className={`input-field font-mono text-sm pr-10 ${resolvedAddress ? "border-gonka-500/40" : ""}`}
              placeholder={recipientPlaceholder}
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value.trim());
                setError("");
              }}
              autoFocus
            />
            {/* Address book button — only in same-chain mode */}
            {!isIbcMode && addressBook.length > 0 && !isGnsName(recipient) && (
              <button
                onClick={() => setShowBook(true)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-gonka-400 transition-colors"
                title="Address book"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </button>
            )}
          </div>

          {/* GNS resolution status (same-chain only) */}
          {!isIbcMode && isGnsName(recipient) && (
            <div className="flex items-center gap-2 px-1">
              {resolving ? (
                <span className="text-xs text-surface-500 flex items-center gap-1.5">
                  <Spinner size="sm" /> Resolving {recipient}…
                </span>
              ) : resolvedAddress ? (
                <span className="text-xs text-gonka-400 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-mono truncate">{resolvedAddress}</span>
                </span>
              ) : recipient.length > 4 ? (
                <span className="text-xs text-red-400">Name not found</span>
              ) : null}
            </div>
          )}

          {/* IBC address hint */}
          {isIbcMode && recipient.length > 0 && !validateIbcAddress(recipient) && (
            <p className="text-xs text-surface-500 px-1">
              Must start with <span className="font-mono text-surface-400">{selectedChannel.bech32Prefix}1</span>
            </p>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-surface-300">Amount</label>
            <button
              onClick={handleSetMax}
              disabled={preparing}
              className="text-xs text-gonka-400 hover:text-gonka-300 transition-colors disabled:opacity-50"
            >
              Max: {toDisplayDecimals(spendable[selectedToken.denom] ?? selectedToken.amount, selectedToken.decimals)}
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              className="input-field pr-16"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setAmount(val);
                setError("");
              }}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-surface-500 font-medium">
              {selectedToken.symbol}
            </span>
          </div>
        </div>

        {/* Memo */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">
            Memo <span className="text-surface-600">(optional)</span>
          </label>
          <input
            type="text"
            className="input-field text-sm"
            placeholder={isIbcMode ? "Required for some exchange addresses" : "Add a note…"}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {/* IBC info callout */}
        {isIbcMode && (
          <div className="flex gap-2.5 p-3 rounded-xl bg-gonka-500/5 border border-gonka-500/15">
            <svg className="w-4 h-4 text-gonka-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-surface-400 leading-relaxed">
              Sending <span className="text-white/70">{selectedToken.symbol}</span> to{" "}
              <span className="text-white/70">{selectedChannel.chainName}</span> via IBC{" "}
              <span className="font-mono text-gonka-400">{selectedChannel.channelId}</span>.
              Arrival typically takes 1–2 minutes. If the transfer times out, funds are returned automatically.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          onClick={handleReview}
          disabled={!recipient || !amount || preparing}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {preparing ? (
            <>
              <Spinner size="sm" />
              Checking fee…
            </>
          ) : (
            "Review Transaction"
          )}
        </button>
      </div>

      {/* Address book modal */}
      {showBook && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-3 animate-slide-up shadow-modal max-h-[70%] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold">Address Book</h3>
              <button
                onClick={() => setShowBook(false)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5 -mx-1 px-1">
              {addressBook.map((entry) => (
                <button
                  key={entry.address}
                  onClick={() => {
                    setRecipient(entry.address);
                    setShowBook(false);
                    setError("");
                  }}
                  className="flex items-center gap-3 w-full p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-transparent text-left transition-all"
                >
                  <div className="w-8 h-8 rounded-xl bg-gonka-500/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-gonka-400">
                      {entry.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{entry.name}</p>
                    <p className="text-xs font-mono text-surface-500 truncate">{entry.address}</p>
                    {entry.note && (
                      <p className="text-xs text-surface-600 truncate">{entry.note}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

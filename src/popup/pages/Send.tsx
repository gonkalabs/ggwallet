import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { toMinimalDecimals, toDisplayDecimals } from "@/lib/format";
import { GONKA_BECH32_PREFIX } from "@/lib/gonka";
import type { TokenBalance } from "@/lib/cosmos";
import type { AddressBookEntry } from "@/lib/storage";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

type Step = "form" | "confirm" | "success" | "error";

export default function Send() {
  const navigate = useNavigate();
  const { balance, tokenBalances, address, getBalance } = useWalletStore();

  // Build token list — always show at least GNK even if balance is 0
  const tokens: TokenBalance[] =
    tokenBalances.length > 0
      ? tokenBalances
      : [{ denom: "ngonka", amount: balance, symbol: "GNK", decimals: 9, isIbc: false }];

  const [selectedToken, setSelectedToken] = useState<TokenBalance>(tokens[0]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  // Address book
  const [addressBook, setAddressBook] = useState<AddressBookEntry[]>([]);
  const [showBook, setShowBook] = useState(false);

  useEffect(() => {
    sendMessage({ type: "GET_ADDRESS_BOOK" }).then((r) => {
      if (r.entries) setAddressBook(r.entries);
    });
  }, []);

  // Sync selectedToken when tokenBalances load
  useEffect(() => {
    if (tokenBalances.length > 0) {
      setSelectedToken((prev) => tokenBalances.find((t) => t.denom === prev.denom) ?? tokenBalances[0]);
    }
  }, [tokenBalances]);

  const validateAddress = (addr: string) =>
    addr.startsWith(GONKA_BECH32_PREFIX) && addr.length >= 39;

  const handleReview = () => {
    setError("");
    if (!validateAddress(recipient)) {
      setError("Invalid Gonka address");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a valid amount");
      return;
    }
    const minAmount = toMinimalDecimals(amount, selectedToken.decimals);
    if (BigInt(minAmount) > BigInt(selectedToken.amount)) {
      setError("Insufficient balance");
      return;
    }
    if (recipient === address) {
      setError("Cannot send to yourself");
      return;
    }
    setStep("confirm");
  };

  const handleSend = async () => {
    setLoading(true);
    setError("");
    try {
      const minAmount = toMinimalDecimals(amount, selectedToken.decimals);
      const resp = await sendMessage({
        type: "SEND_TOKENS",
        recipient,
        amount: minAmount,
        denom: selectedToken.denom,
        memo,
      });
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

  const handleSetMax = () => {
    setAmount(toDisplayDecimals(selectedToken.amount, selectedToken.decimals));
  };

  if (step === "success") {
    return (
      <Layout title="Transaction Sent" showBack={false} showNav={false}>
        <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
          <div className="w-16 h-16 bg-gonka-500/10 border border-gonka-500/25 rounded-full flex items-center justify-center mb-5 animate-scale-in">
            <svg className="w-8 h-8 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-2">Transaction Sent!</h2>
          <p className="text-sm text-surface-400 mb-5">
            {amount} {selectedToken.symbol} sent successfully
          </p>
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

  if (step === "confirm") {
    return (
      <Layout title="Confirm Transaction" showBack={false} showNav={false}>
        <div className="px-4 py-4 space-y-4">
          <div className="card space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-surface-500">To</span>
              <span className="text-sm font-mono text-right max-w-[220px] break-all">{recipient}</span>
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
            <div className="flex justify-between">
              <span className="text-sm text-surface-500">Network Fee</span>
              <span className="text-sm text-surface-300">0 GNK</span>
            </div>
          </div>
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <div className="space-y-2">
            <button
              onClick={handleSend}
              disabled={loading}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  Sending...
                </>
              ) : (
                "Confirm & Send"
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

  return (
    <Layout title="Send" showBack showNav={false}>
      <div className="px-4 py-4 space-y-4">

        {/* Token selector (only shown when multiple tokens available) */}
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

        {/* Recipient */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">Recipient Address</label>
          <div className="relative">
            <input
              type="text"
              className="input-field font-mono text-sm pr-10"
              placeholder="gonka1..."
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value.trim());
                setError("");
              }}
              autoFocus
            />
            {addressBook.length > 0 && (
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
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-surface-300">Amount</label>
            <button
              onClick={handleSetMax}
              className="text-xs text-gonka-400 hover:text-gonka-300 transition-colors"
            >
              Max: {toDisplayDecimals(selectedToken.amount, selectedToken.decimals)}
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
            placeholder="Add a note..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          onClick={handleReview}
          disabled={!recipient || !amount}
          className="btn-primary"
        >
          Review Transaction
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

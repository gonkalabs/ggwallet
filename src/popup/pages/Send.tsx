import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { toMinimal, toDisplay, formatCompact } from "@/lib/format";
import { GONKA_DISPLAY_DENOM, GONKA_BECH32_PREFIX } from "@/lib/gonka";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

type Step = "form" | "confirm" | "success" | "error";

export default function Send() {
  const navigate = useNavigate();
  const { balance, address, getBalance } = useWalletStore();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const validateAddress = (addr: string) => {
    return addr.startsWith(GONKA_BECH32_PREFIX) && addr.length >= 39;
  };

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
    const minAmount = toMinimal(amount);
    if (BigInt(minAmount) > BigInt(balance)) {
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
      const minAmount = toMinimal(amount);
      const resp = await sendMessage({
        type: "SEND_TOKENS",
        recipient,
        amount: minAmount,
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
    setAmount(toDisplay(balance));
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
            {amount} {GONKA_DISPLAY_DENOM} sent successfully
          </p>
          <div className="w-full bg-white/[0.03] rounded-2xl p-4 mb-6">
            <p className="text-xs text-surface-500 mb-1">Transaction Hash</p>
            <p className="text-xs font-mono text-surface-300 break-all">
              {txHash}
            </p>
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
              <span className="text-sm font-mono text-right max-w-[220px] break-all">
                {recipient}
              </span>
            </div>
            <div className="border-t border-white/[0.04]" />
            <div className="flex justify-between">
              <span className="text-sm text-surface-500">Amount</span>
              <span className="text-sm font-bold">
                {amount} {GONKA_DISPLAY_DENOM}
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

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

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
            <button
              onClick={() => setStep("form")}
              disabled={loading}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Send GNK" showBack showNav={false}>
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">
            Recipient Address
          </label>
          <input
            type="text"
            className="input-field font-mono text-sm"
            placeholder="gonka1..."
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value.trim());
              setError("");
            }}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-surface-300">
              Amount
            </label>
            <button
              onClick={handleSetMax}
              className="text-xs text-gonka-400 hover:text-gonka-300 transition-colors"
            >
              Max: {formatCompact(balance)}
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              className="input-field pr-14"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setAmount(val);
                setError("");
              }}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-surface-500 font-medium">
              {GONKA_DISPLAY_DENOM}
            </span>
          </div>
        </div>

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
    </Layout>
  );
}

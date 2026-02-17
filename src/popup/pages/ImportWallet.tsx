import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";

export default function ImportWallet() {
  const navigate = useNavigate();
  const { setMnemonic } = useWalletStore();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const handleContinue = () => {
    const words = input.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError("Please enter a valid 12 or 24-word recovery phrase");
      return;
    }
    setError("");
    setMnemonic(words.join(" "));
    navigate("/set-password");
  };

  return (
    <div className="flex flex-col h-[600px] bg-surface-950">
      <header className="flex items-center gap-3 px-4 h-14 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="p-1.5 -ml-1.5 hover:bg-white/5 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Import Wallet</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-300 mb-1">
            Recovery Phrase
          </h2>
          <p className="text-xs text-surface-500 mb-3">
            Enter your 12 or 24-word recovery phrase to import your existing
            Gonka wallet.
          </p>
        </div>

        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          placeholder="Enter your recovery phrase, words separated by spaces..."
          rows={5}
          className="input-field resize-none font-mono text-sm"
          autoFocus
        />

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <div className="bg-white/[0.02] rounded-2xl p-3.5">
          <p className="text-xs text-surface-500">
            Your recovery phrase is never sent to any server. It is encrypted
            and stored locally on your device.
          </p>
        </div>
      </div>

      <div className="px-4 py-3 shrink-0">
        <button
          onClick={handleContinue}
          disabled={!input.trim()}
          className="btn-primary"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
